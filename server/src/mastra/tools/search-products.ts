import type { Product } from "@bazak/shared";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  type Category,
  filterProducts,
  getCategoryProducts as defaultBrowse,
  paginate,
  type ProductFilters,
  resolveCategorySlug,
  searchProducts as defaultSearch,
  type SortField,
  sortProducts,
} from "../../catalog";
import { sortPrefSchema } from "../../pipeline/classification";

/** The filter/sort/page knobs both finder tools share (applied INSIDE the tool). */
const commonSearchFields = {
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  minRating: z.number().min(0).max(5).optional(),
  brands: z.array(z.string()).optional(),
  inStockOnly: z.boolean().optional(),
  onSaleOnly: z.boolean().optional(),
  sort: sortPrefSchema.optional().describe("How to order results (e.g. price asc for cheapest)."),
  limit: z.number().int().positive().max(20).optional().describe("How many products to return."),
};

/** What the finder agent passes to one keyword search (the `/products/search` endpoint). */
export const productSearchInputSchema = z.object({
  keywords: z
    .string()
    .describe(
      "Short core product noun(s) for catalog search — 1–2 words ('headphones', 'laptop bag'). " +
        "The catalog does naive substring matching, so drop adjectives; broaden to the simplest noun to relax.",
    ),
  ...commonSearchFields,
});

export type ProductSearchInput = z.infer<typeof productSearchInputSchema>;

/** What the finder agent passes to browse a whole category (the `/products/category/{slug}` endpoint). */
export const categoryBrowseInputSchema = z.object({
  category: z
    .string()
    .describe(
      "A catalog category SLUG copied verbatim from the CATALOG CATEGORIES list " +
        "(e.g. 'mobile-accessories', 'sunglasses'). Browses every product in that category.",
    ),
  ...commonSearchFields,
});

export type CategoryBrowseInput = z.infer<typeof categoryBrowseInputSchema>;

/** A lean product view for the model — enough to choose/group, never the full record. */
const leanProductSchema = z.object({
  id: z.number(),
  title: z.string(),
  price: z.number(),
  rating: z.number(),
  brand: z.string().optional(),
  stock: z.number(),
  discountPercentage: z.number(),
});

export const productSearchOutputSchema = z.object({
  products: z.array(leanProductSchema),
  /** Products that matched the (applied) filters. */
  matched: z.number(),
  /** Raw products the keyword search returned before filtering. */
  fetched: z.number(),
  /** Cheapest matched price (null when nothing matched) — helps the agent decide to relax. */
  cheapest: z.number().nullable(),
  /** Best matched rating (null when nothing matched). */
  topRating: z.number().nullable(),
});

function lean(p: Product): z.infer<typeof leanProductSchema> {
  return {
    id: p.id,
    title: p.title,
    price: p.price,
    rating: p.rating,
    brand: p.brand,
    stock: p.stock,
    discountPercentage: p.discountPercentage,
  };
}

/** Shared options for both finder retrieval tools (keyword search + category browse). */
interface BaseToolOptions {
  /**
   * Run-local registry of every product the tool returned, keyed by id. The
   * finder selects products by id; code resolves those ids back to REAL `Product`
   * objects through this map (grounding — the model never authors product fields).
   * One map per finder run, captured in this closure → concurrency-safe.
   */
  registry: Map<number, Product>;
  /** How many products to fetch before client-side filter/sort. */
  fetchSize?: number;
  /** Default page size when the agent omits `limit`. */
  defaultLimit?: number;
  /**
   * The finder's HARD constraints, ALWAYS applied on top of the agent's chosen
   * filters so a non-negotiable bound can never be relaxed even if the model tries.
   */
  enforcedFilters?: ProductFilters;
}

export interface ProductSearchToolOptions extends BaseToolOptions {
  /** The catalog keyword search (injectable for tests). */
  search?: typeof defaultSearch;
}

export interface CategoryBrowseToolOptions extends BaseToolOptions {
  /** The catalog category browse (injectable for tests). */
  browse?: typeof defaultBrowse;
  /**
   * The real categories, used to resolve a fuzzy/display-name `category` arg to a
   * real slug before browsing. When omitted, the arg is used as-is.
   */
  categories?: Category[];
}

export type ProductSearchOutput = z.infer<typeof productSearchOutputSchema>;

/**
 * Apply the agent's filters (with the finder's HARD constraints overlaid so they
 * win), sort, paginate, and capture the page into the grounding registry. Shared by
 * both retrieval tools — they differ only in how the raw candidates are fetched.
 */
function applyFiltersSortPage(
  raw: Product[],
  input: { sort?: ProductSearchInput["sort"]; limit?: number } & ProductFilters,
  opts: BaseToolOptions,
): ProductSearchOutput {
  const filters: ProductFilters = {
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    minRating: input.minRating,
    brands: input.brands,
    inStockOnly: input.inStockOnly,
    onSaleOnly: input.onSaleOnly,
    ...(opts.enforcedFilters ?? {}),
  };
  const matched = filterProducts(raw, filters);
  const sorted = sortProducts(matched, input.sort?.field as SortField | undefined, input.sort?.order);
  const page = paginate(sorted, input.limit ?? opts.defaultLimit ?? 10);
  for (const p of page) opts.registry.set(p.id, p); // grounding capture

  return {
    products: page.map(lean),
    matched: matched.length,
    fetched: raw.length,
    cheapest: matched.length ? Math.min(...matched.map((p) => p.price)) : null,
    topRating: matched.length ? Math.max(...matched.map((p) => p.rating)) : null,
  };
}

/**
 * The framework-free core of `product_search`: keyword search → filter → sort → page,
 * capturing returned products into `opts.registry` for id→product grounding. Exported
 * so it can be exercised directly in tests without the Mastra tool wrapper.
 */
export async function runProductSearch(
  input: ProductSearchInput,
  opts: ProductSearchToolOptions,
): Promise<ProductSearchOutput> {
  const search = opts.search ?? defaultSearch;
  const fetched = await search(input.keywords, { limit: opts.fetchSize ?? 100 });
  return applyFiltersSortPage(fetched.products, input, opts);
}

/**
 * The framework-free core of `category_browse`: resolve the slug → browse the whole
 * category → filter → sort → page, capturing into `opts.registry` for grounding.
 * Exported for direct testing.
 */
export async function runCategoryBrowse(
  input: CategoryBrowseInput,
  opts: CategoryBrowseToolOptions,
): Promise<ProductSearchOutput> {
  const browse = opts.browse ?? defaultBrowse;
  // Tolerate a display name / fuzzy term by resolving to a real slug when we can.
  const slug = (opts.categories?.length && resolveCategorySlug(input.category, opts.categories)) || input.category;
  const fetched = await browse(slug, { limit: opts.fetchSize ?? 100 });
  return applyFiltersSortPage(fetched.products, input, opts);
}

/**
 * Build the `product_search` tool for one finder run. Each call is a single traced
 * span showing the query + how many matched; returned products are captured in
 * `opts.registry` for downstream id→product grounding.
 */
export function createProductSearchTool(opts: ProductSearchToolOptions) {
  return createTool({
    id: "product_search",
    description:
      "Search the product catalog by keyword and return matching products. Apply price/rating/brand/" +
      "stock/sale filters and a sort. Call again with broader keywords or fewer filters to find more. " +
      "Returns a lean product list plus match counts so you can decide whether to relax.",
    inputSchema: productSearchInputSchema,
    outputSchema: productSearchOutputSchema,
    execute: async (input: ProductSearchInput) => runProductSearch(input, opts),
  });
}

/**
 * Build the `category_browse` tool for one finder run. Browses a whole category by
 * slug (good when the buyer wants a category rather than a specific keyword, e.g.
 * "show me laptops"). Same filters/sort/grounding as `product_search`.
 */
export function createCategoryBrowseTool(opts: CategoryBrowseToolOptions) {
  return createTool({
    id: "category_browse",
    description:
      "Browse every product in a catalog category by its SLUG (from the CATALOG CATEGORIES list). " +
      "Use this when the buyer wants a whole category rather than a specific keyword, or to widen a " +
      "keyword search that returned too few. Apply the same price/rating/brand/stock/sale filters and " +
      "sort. Returns a lean product list plus match counts.",
    inputSchema: categoryBrowseInputSchema,
    outputSchema: productSearchOutputSchema,
    execute: async (input: CategoryBrowseInput) => runCategoryBrowse(input, opts),
  });
}
