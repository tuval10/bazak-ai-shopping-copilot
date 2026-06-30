import { z } from "zod";

/**
 * Per-user remembered preferences (US-7.x). This same schema is handed to Mastra
 * Memory `workingMemory` so the agent fills it structurally, and is surfaced
 * read-only via `GET /api/profile` (US-7.4).
 *
 * Every field is optional: working memory starts empty and fills as the user
 * reveals preferences, so a fresh user validly parses as `{}`.
 *
 * Fields are `.nullish()` (accept `null` as well as `undefined`): Mastra's
 * `updateWorkingMemory` tool sends `null` for not-yet-known fields, and a plain
 * `.optional()` would REJECT that — silently failing every working-memory write
 * (durable preferences would never persist). Accepting null keeps writes valid.
 */
export const profileSchema = z.object({
  name: z.string().nullish(),
  budget: z.string().nullish(),
  preferredCategories: z.array(z.string()).nullish(),
  preferredBrands: z.array(z.string()).nullish(),
  dislikes: z.array(z.string()).nullish(),
  notes: z
    .string()
    .nullish()
    .describe(
      "Durable, generalizable preferences only (e.g. 'prefers minimalist design'). Never the current query, what they're shopping for now, or a conversation summary.",
    ),
});

export type Profile = z.infer<typeof profileSchema>;
