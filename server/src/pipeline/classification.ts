import { z } from "zod";

/** Sort preference extracted from the message (maps to catalog sort, US-1.5). */
export const sortPrefSchema = z.object({
  field: z.enum(["price", "rating", "discount", "title"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

/**
 * One single-intent search extracted from the user's message (US-1.2). A
 * multi-intent message produces several of these (US-1.3).
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
});

export type SearchIntent = z.infer<typeof searchIntentSchema>;

/** The classifier's structured output for a turn. */
export const classificationSchema = z.object({
  kind: z.enum(["product", "chitchat", "off_catalog"]),
  searches: z.array(searchIntentSchema).default([]),
});

export type Classification = z.infer<typeof classificationSchema>;
