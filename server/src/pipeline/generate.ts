import {
  type WorkflowInput,
  type WorkflowOutput,
  workflowInputSchema,
  workflowOutputSchema,
} from "@bazak/shared";
import { createStep } from "@mastra/core/workflows";
import type { RetrieveState } from "./retrieve";
import { retrieveStateSchema } from "./retrieve";
import { looseSchema } from "./step-schema";

/** The custom stream part type the frontend binds a tool UI to (D6/D8). */
export const PRODUCT_RESULTS_PART = "data-product-results";

/** Minimal structural view of a text-generating agent (injectable for tests). */
export interface TextGenerator {
  generate(
    message: string,
    options?: { memory?: { thread: string; resource: string } },
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

export function buildGeneratePrompt(message: string, state: RetrieveState): string {
  return `User message: "${message}"\n\n${summarizeForPrompt(state)}\n\nWrite a short, friendly reply to accompany these results.`;
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

  const prompt = buildGeneratePrompt(input.message, state);
  const { text } = await agent.generate(prompt, {
    memory: { thread: input.threadId, resource: input.resourceId },
  });

  return { message: text, results: state.results };
}

/** Workflow step wrapper. */
export const generateStep = createStep({
  id: "generate",
  inputSchema: looseSchema(retrieveStateSchema),
  outputSchema: looseSchema(workflowOutputSchema),
  execute: async ({ inputData, getInitData, mastra, writer }) => {
    const input = workflowInputSchema.parse(getInitData());
    const state = retrieveStateSchema.parse(inputData);
    const agent = mastra.getAgent("generator") as unknown as TextGenerator;
    return runGenerate({ input, state, agent, writer });
  },
});
