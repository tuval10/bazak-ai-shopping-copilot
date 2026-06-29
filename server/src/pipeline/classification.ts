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
 * The orchestrator's structured output (agentic flow). `kind` routes the turn;
 * `finders` is one search per angle the orchestrator decided to pursue — multi-
 * intent ("phone + bag") and off-catalog merchandising ("flight" → travel pillow,
 * luggage) both produce several. Capped to MAX_PRODUCT_FINDERS downstream.
 */
export const orchestrationPlanSchema = z.object({
  kind: z.enum(["product", "chitchat", "off_catalog"]),
  finders: z.array(searchIntentSchema).default([]),
  /**
   * True when the user only asked for MORE of the previous results ("show me
   * more", "next", "others"). The app then reuses the prior turn's finder and
   * pages forward (excluding already-shown products) instead of re-planning — so
   * the orchestrator need not (and must not) re-extract constraints (US "show me
   * more"). Optional/absent means false; we only branch on truthiness.
   */
  continuation: z.boolean().optional(),
});

export type OrchestrationPlan = z.infer<typeof orchestrationPlanSchema>;

/**
 * Thread-metadata key under which a turn's finders are persisted (alongside the
 * results). A follow-up "show me more" reuses the exact prior finder from here
 * rather than trusting the model to re-derive (or re-invent) constraints.
 */
export const FINDERS_METADATA_KEY = "finders";
