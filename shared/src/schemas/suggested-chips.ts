import { z } from "zod";

/**
 * A suggestion chip: a one-tap affordance that prefills the composer with the
 * buyer's next message. `label` is what's shown on the button; `message` is the
 * text dropped into the input (editable before sending).
 *
 * Two flavours, distinguished only by content (not type):
 * - filter-style when results are abundant ("Under $50", "Only Apple") — options
 *   are derived deterministically from the retrieved products so they never lie;
 * - follow-up-search-style when results are weak/off-catalog ("What should I buy
 *   for my flight?") — phrasing is model-authored.
 */
export const suggestionChipSchema = z.object({
  label: z.string(),
  message: z.string(),
});

export type SuggestionChip = z.infer<typeof suggestionChipSchema>;

/**
 * The streamed data part carrying a turn's chips. Capped at 4 so the UI stays
 * scannable.
 */
export const suggestedChipsPartSchema = z.object({
  chips: z.array(suggestionChipSchema).max(4),
});

export type SuggestedChipsPart = z.infer<typeof suggestedChipsPartSchema>;

/**
 * Wire constants (the anti-drift seam, D11), mirroring product-results.ts:
 * - `SUGGESTED_CHIPS_PART_TYPE` — the `type` discriminator on the streamed data
 *   part the generate step writes via `writer.custom(...)` and the FE reads (D6).
 * - `CHIPS_METADATA_KEY` — the `content.metadata` key under which a turn's chips
 *   are persisted on the assistant message so history rehydrates them (D12).
 */
export const SUGGESTED_CHIPS_PART_TYPE = "data-suggested-chips";
export const CHIPS_METADATA_KEY = "suggestedChips";
