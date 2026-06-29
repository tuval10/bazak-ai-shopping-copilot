import {
  CHIPS_METADATA_KEY,
  PRODUCT_RESULTS_PART_TYPE,
  type ProductResultsPart,
  RESULTS_METADATA_KEY,
  SUGGESTED_CHIPS_PART_TYPE,
  type SuggestionChip,
  type WorkflowInput,
  type WorkflowOutput,
  workflowInputSchema,
  workflowOutputSchema,
} from "@bazak/shared";
import type { MastraMemory } from "@mastra/core/memory";
import { createStep } from "@mastra/core/workflows";
import { generateChips, type StructuredChips } from "./chips";
import { FINDERS_METADATA_KEY, type SearchIntent } from "./classification";
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
  const hasResults = state.results.length > 0;
  if (state.kind === "off_catalog" && !hasResults) {
    return "The user asked for something the catalog can't fulfil and nothing relevant was found. Say so honestly and suggest the nearest relevant category if there is one.";
  }
  if (state.kind === "product" && !hasResults) {
    return "No products matched the user's request. Say so plainly and invite them to broaden or adjust the search — never invent products.";
  }

  // One line per group, surfacing the model-authored angle (rationale) and the
  // deterministic relaxation fact so the prose can paraphrase but never exceed them.
  const lines = state.results.map((r) => {
    const relaxed = r.relaxed
      ? ` — RELAXED ${r.relaxed.constraint} (${r.relaxed.from} → ${r.relaxed.to})`
      : "";
    const angle = r.rationale ? ` [angle: ${r.rationale}]` : "";
    const items = r.products.length
      ? r.products.map((p) => `${p.title} ($${p.price})`).join("; ")
      : "no products";
    return `- "${r.intent}"${relaxed}${angle} (${r.products.length} shown): ${items}`;
  });

  const preface =
    state.kind === "off_catalog"
      ? "The user asked for something we don't sell directly. Decline honestly (do NOT claim these ARE the requested item), but present these adjacent products as helpful options and offer to keep searching."
      : "Retrieved results — only refer to these, never invent products:";
  const notes = state.notes.length ? `\nNotes: ${state.notes.join(" ")}` : "";
  return `${preface}\n${lines.join("\n")}${notes}`;
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
  /** The voice that writes the prose — generator (merchandise) or concierge (decline). */
  agent: TextGenerator;
  /** Optional agent used to phrase context-aware follow-up chips. */
  chipsAgent?: StructuredChips;
  writer?: PartWriter;
}

/**
 * Generate (the synthesis step). Emits one `product-results` part per group onto the
 * stream (built from retrieved data — grounding is structural, the model never
 * produces the product list), writes the prose reply, then emits the turn's
 * suggestion chips. Multiple groups per finder (US-4.4) stream as separate parts.
 */
export async function runGenerate({
  input,
  state,
  agent,
  chipsAgent,
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

  const chips = await generateChips({ state, message: input.message, agent: chipsAgent });
  if (chips.length > 0) {
    await writer?.custom({ type: SUGGESTED_CHIPS_PART_TYPE, data: { chips } });
  }

  return { message: text, results: state.results, chips };
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
  args: {
    threadId: string;
    resourceId: string;
    results: ProductResultsPart[];
    chips?: SuggestionChip[];
    /** The finders that produced these results — stored so a "show me more"
     * follow-up reuses the exact search instead of re-planning. */
    finders?: SearchIntent[];
  },
): Promise<void> {
  const chips = args.chips ?? [];
  const finders = args.finders ?? [];
  if (args.results.length === 0 && chips.length === 0 && finders.length === 0) return;
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
      metadata: {
        ...lastAssistant.content.metadata,
        ...(args.results.length > 0 ? { [RESULTS_METADATA_KEY]: args.results } : {}),
        ...(chips.length > 0 ? { [CHIPS_METADATA_KEY]: chips } : {}),
        ...(finders.length > 0 ? { [FINDERS_METADATA_KEY]: finders } : {}),
      },
    };
    await mem.saveMessages({ messages: [{ ...lastAssistant, content }] });
  } catch {
    // Cards/chips just won't rehydrate for this turn; the transcript still loads.
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

    // Route the voice: concierge handles pure chit-chat and the honest off-catalog
    // decline (nothing relevant found); the generator merchandises everything else.
    const empty = state.results.length === 0;
    const useConcierge = state.kind === "chitchat" || (state.kind === "off_catalog" && empty);
    const voice = mastra.getAgent(useConcierge ? "concierge" : "generator");
    const generator = mastra.getAgent("generator");

    const output = await runGenerate({
      input,
      state,
      agent: voice as unknown as TextGenerator,
      chipsAgent: generator as unknown as StructuredChips,
      writer,
    });

    // D12: persist the cards + chips alongside the assistant message for resume. The
    // voice agent holds the memory that just saved the assistant turn.
    const mem = await voice.getMemory();
    if (mem) {
      await persistTurnResults(mem, {
        threadId: input.threadId,
        resourceId: input.resourceId,
        results: output.results,
        chips: output.chips,
        finders: state.finders,
      });
    }
    return output;
  },
});
