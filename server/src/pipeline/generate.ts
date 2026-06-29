import {
  CHIPS_METADATA_KEY,
  type ProductResultsPart,
  RESULTS_METADATA_KEY,
  type SuggestionChip,
} from "@bazak/shared";
import type { MastraMemory } from "@mastra/core/memory";
import { FINDERS_METADATA_KEY, type SearchIntent } from "./classification";

/**
 * Minimal structural view of the stream writer (Mastra's ToolStream satisfies it).
 * The supervisor turn streams grounded product cards through this from inside the
 * `find_products` tool — see pipeline/find-products + pipeline/converse.
 */
export interface PartWriter {
  custom(data: { type: string; [key: string]: unknown }): Promise<void> | void;
}

/**
 * D12: attach this turn's results to the assistant message the agent just saved, so a
 * refresh rehydrates the product cards (not just the prose). The supervisor's
 * `.generate` with memory persists the assistant text; we recall that message and
 * re-save it with the results in `content.metadata` (LibSQL upserts by id, so this
 * updates in place). No-op for a turn that produced nothing to rehydrate. Best-effort:
 * a persistence hiccup must not fail the turn (US-5.2).
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
