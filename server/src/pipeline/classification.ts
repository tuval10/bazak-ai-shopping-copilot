import { z } from "zod";

/** Sort preference extracted from the message (maps to catalog sort, US-1.5). */
export const sortPrefSchema = z.object({
  field: z.enum(["price", "rating", "discount", "title"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

/**
 * The constrainable attributes of a search. Used to mark which constraints the
 * user stated as HARD ("strictly under $100", "must be Apple") — those are never
 * relaxed by discovery. Everything not listed is soft (relaxable).
 */
export const constraintKeySchema = z.enum([
  "minPrice",
  "maxPrice",
  "minRating",
  "brands",
  "category",
  "inStockOnly",
  "onSaleOnly",
]);

export type ConstraintKey = z.infer<typeof constraintKeySchema>;

/**
 * One single-intent search extracted from the user's message (US-1.2). A
 * multi-intent message produces several of these (US-1.3); in the agentic flow
 * each is a "finder".
 */
export const searchIntentSchema = z.object({
  /** Short human-readable label, e.g. "phone under $500". */
  label: z.string(),
  /**
   * Rich, natural-language situational context the supervisor hands the finder —
   * the "why" behind this angle (e.g. "the user is flying to Tokyo and may want a
   * carry-on bag for the flight"). Guides how the finder breaks the angle into
   * queries; never a hard filter. Optional so existing finders/literals stay valid.
   */
  brief: z.string().optional(),
  /** Free-text keywords for `/products/search`. */
  keywords: z.string().optional(),
  /** A category term to resolve to a real slug (US-1.6). */
  category: z.string().optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  minRating: z.number().min(0).max(5).optional(),
  brands: z.array(z.string()).optional(),
  inStockOnly: z.boolean().optional(),
  onSaleOnly: z.boolean().optional(),
  sort: sortPrefSchema.optional(),
  /**
   * Constraints the user stated as non-negotiable (US: "strictly under $100").
   * Discovery strips these before planning relaxation and re-validates them out
   * of any proposed axis, so a hard constraint is never loosened.
   */
  hardConstraints: z.array(constraintKeySchema).optional(),
});

export type SearchIntent = z.infer<typeof searchIntentSchema>;

/**
 * Thread-metadata key under which a turn's finders are persisted (alongside the
 * results). A follow-up "show me more" reuses the exact prior finder from here
 * rather than trusting the model to re-derive (or re-invent) constraints.
 */
export const FINDERS_METADATA_KEY = "finders";
