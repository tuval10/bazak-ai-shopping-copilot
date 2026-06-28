import {
  PRODUCT_RESULTS_PART_TYPE,
  type ProductResultsPart,
  RESULTS_METADATA_KEY,
  type WorkflowInput,
  type WorkflowOutput,
  workflowInputSchema,
  workflowOutputSchema,
} from "@bazak/shared";
import type { MastraMemory } from "@mastra/core/memory";
import { createStep } from "@mastra/core/workflows";
import type { RetrieveState } from "./retrieve";
import { retrieveStateSchema } from "./retrieve";
import { looseSchema } from "./step-schema";

/**
 * The custom stream-part type the frontend renders as a product-card group (D6/D8).
 * Re-exported from the shared contract so server and FE never drift; the local alias
 * keeps existing call sites + tests unchanged.
 */
export const PRODUCT_RESULTS_PART = PRODUCT_RESULTS_PART_TYPE;

export { RESULTS_METADATA_KEY };

/** Minimal structural view of a text-generating agent (injectable for tests). */
export interface TextGenerator {
  generate(
    message: string,
    options?: { memory?: { thread: string; resource: string }; system?: string },
  ): Promise<{ text: string }>;
}

/** Minimal structural view of the stream writer (Mastra's ToolStream satisfies it). */
export interface PartWriter {
  custom(data: { type: string; [key: string]: unknown }): Promise<void> | void;
}

/** Summarize retrieved results for the prompt — the ONLY product data the model sees (US-5.1). */
export function summarizeForPrompt(state: RetrieveState): string {
  if (state.kind === "chitchat") {
    return "The user sent a greeting or small talk. Reply briefly and warmly, then steer back to shopping.";
  }
  if (state.kind === "off_catalog") {
    return "The user asked for something the catalog can't fulfil. Say so honestly and suggest the nearest relevant category if there is one.";
  }
  const lines = state.results.map((r) => {
    if (r.products.length === 0) return `- For "${r.intent}": no matching products were found.`;
    const items = r.products.map((p) => `${p.title} ($${p.price})`).join("; ");
    return `- For "${r.intent}" (${r.products.length} shown): ${items}`;
  });
  const notes = state.notes.length ? `\nNotes: ${state.notes.join(" ")}` : "";
  return `Retrieved results — only refer to these, never invent products:\n${lines.join("\n")}${notes}`;
}

/**
 * The grounding handed to the model as a (non-persisted) system message: the
 * retrieved results plus the reply instruction. Kept separate from the user input
 * so the persisted user turn is the real message, not this prompt (US-3.1).
 */
export function buildGroundingSystem(state: RetrieveState): string {
  return `${summarizeForPrompt(state)}\n\nWrite a short, friendly reply to accompany these results.`;
}

export interface GenerateParams {
  input: WorkflowInput;
  state: RetrieveState;
  agent: TextGenerator;
  writer?: PartWriter;
}

/**
 * Generate (the second LLM step, D2). Emits one `product-results` part per intent
 * onto the stream (built from retrieved data — grounding is structural, the model
 * never produces the product list), then writes the prose reply.
 */
export async function runGenerate({
  input,
  state,
  agent,
  writer,
}: GenerateParams): Promise<WorkflowOutput> {
  for (const part of state.results) {
    await writer?.custom({ type: PRODUCT_RESULTS_PART, data: part });
  }

  // The real user message is the input (persisted as the user turn); the retrieved
  // grounding rides along as a non-persisted system message so history stays clean.
  const { text } = await agent.generate(input.message, {
    memory: { thread: input.threadId, resource: input.resourceId },
    system: buildGroundingSystem(state),
  });

  return { message: text, results: state.results };
}

/**
 * D12: attach this turn's results to the assistant message the agent just saved, so
 * a refresh rehydrates the product cards (not just the prose). `agent.generate` with
 * memory persists the assistant text; we recall that message and re-save it with the
 * results in `content.metadata` (LibSQL upserts by id, so this updates in place).
 * No-op for non-product turns (nothing to rehydrate). Best-effort: a persistence
 * hiccup must not fail the turn (US-5.2).
 */
export async function persistTurnResults(
  mem: MastraMemory,
  args: { threadId: string; resourceId: string; results: ProductResultsPart[] },
): Promise<void> {
  if (args.results.length === 0) return;
  try {
    const { messages } = await mem.recall({
      threadId: args.threadId,
      resourceId: args.resourceId,
      perPage: 10,
      page: 0,
    });
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const content = {
      ...lastAssistant.content,
      metadata: { ...lastAssistant.content.metadata, [RESULTS_METADATA_KEY]: args.results },
    };
    await mem.saveMessages({ messages: [{ ...lastAssistant, content }] });
  } catch {
    // Cards just won't rehydrate for this turn; the transcript still loads.
  }
}

/** Workflow step wrapper. */
export const generateStep = createStep({
  id: "generate",
  inputSchema: looseSchema(retrieveStateSchema),
  outputSchema: looseSchema(workflowOutputSchema),
  execute: async ({ inputData, getInitData, mastra, writer }) => {
    const input = workflowInputSchema.parse(getInitData());
    const state = retrieveStateSchema.parse(inputData);
    const generator = mastra.getAgent("generator");
    const output = await runGenerate({
      input,
      state,
      agent: generator as unknown as TextGenerator,
      writer,
    });
    // D12: persist the cards alongside the assistant message for resume.
    const mem = await generator.getMemory();
    if (mem) {
      await persistTurnResults(mem, {
        threadId: input.threadId,
        resourceId: input.resourceId,
        results: output.results,
      });
    }
    return output;
  },
});
