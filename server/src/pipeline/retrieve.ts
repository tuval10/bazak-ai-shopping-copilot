import { type Product, productResultsPartSchema } from "@bazak/shared";
import { z } from "zod";
import {
  type Category,
  getCategories,
  getCategoryProducts,
  resolveCategorySlug,
  searchProducts,
} from "../catalog";
import { type ProductFilters } from "../catalog/filter";
import { type SearchIntent, searchIntentSchema } from "./classification";

/** Catalog functions retrieve depends on — injectable so tests can mock them. */
export interface CatalogDeps {
  searchProducts: typeof searchProducts;
  getCategoryProducts: typeof getCategoryProducts;
  getCategories: typeof getCategories;
}

export const defaultDeps: CatalogDeps = { searchProducts, getCategoryProducts, getCategories };

/** State handed to generate: the branch, the per-intent results, and any notes. */
export const retrieveStateSchema = z.object({
  kind: z.enum(["product", "chitchat", "off_catalog"]),
  results: z.array(productResultsPartSchema),
  /** Human-readable notes, e.g. a relaxed constraint (US-4.4). */
  notes: z.array(z.string()),
  /**
   * The finders that produced these results — persisted with the turn so a
   * "show me more" follow-up can reuse the exact search and page forward.
   * Optional so existing callers/literals (and non-product turns) stay valid.
   */
  finders: z.array(searchIntentSchema).optional(),
});

export type RetrieveState = z.infer<typeof retrieveStateSchema>;

export function filtersFor(intent: SearchIntent): ProductFilters {
  return {
    minPrice: intent.minPrice,
    maxPrice: intent.maxPrice,
    minRating: intent.minRating,
    brands: intent.brands,
    inStockOnly: intent.inStockOnly,
    onSaleOnly: intent.onSaleOnly,
  };
}

/**
 * Pick the endpoint and fetch the raw candidate products for one intent (the §5
 * retrieval strategy, pre-filter): a category term → category browse, else keyword
 * search. The budgeted discovery loop charges each call of this against a finder's
 * call budget (DISCOVERY_MAX_CALLS).
 */
export async function fetchForIntent(
  intent: SearchIntent,
  deps: CatalogDeps,
  categories: Category[],
  fetchSize: number,
): Promise<Product[]> {
  const slug = intent.category ? resolveCategorySlug(intent.category, categories) : null;
  const fetched = slug
    ? await deps.getCategoryProducts(slug, { limit: fetchSize })
    : await deps.searchProducts(intent.keywords ?? intent.label, { limit: fetchSize });
  return fetched.products;
}
