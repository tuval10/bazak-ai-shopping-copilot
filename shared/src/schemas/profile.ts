import { z } from "zod";

/**
 * Per-user remembered preferences (US-7.x). This same schema is handed to Mastra
 * Memory `workingMemory` so the agent fills it structurally, and is surfaced
 * read-only via `GET /api/profile` (US-7.4).
 *
 * Every field is optional: working memory starts empty and fills as the user
 * reveals preferences, so a fresh user validly parses as `{}`.
 */
export const profileSchema = z.object({
  name: z.string().optional(),
  budget: z.string().optional(),
  preferredCategories: z.array(z.string()).optional(),
  preferredBrands: z.array(z.string()).optional(),
  dislikes: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type Profile = z.infer<typeof profileSchema>;
