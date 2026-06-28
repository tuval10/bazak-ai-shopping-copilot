import { type ProductResultsPart, productResultsPartSchema } from "@bazak/shared";
import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import {
  type Category,
  getCategories,
  getCategoryProducts,
  resolveCategorySlug,
  searchProducts,
} from "../catalog";
import { type ProductFilters, filterProducts } from "../catalog/filter";
import { type SortField, paginate, sortProducts } from "../catalog/sort";
import type { SearchIntent } from "./classification";
import { classificationSchema } from "./classification";
import { type RoutePlan, planRoute } from "./route";
import { looseSchema } from "./step-schema";

/** Catalog functions retrieve depends on — injectable so tests can mock them. */
export interface CatalogDeps {
  searchProducts: typeof searchProducts;
  getCategoryProducts: typeof getCategoryProducts;
  getCategories: typeof getCategories;
}

const defaultDeps: CatalogDeps = { searchProducts, getCategoryProducts, getCategories };

export interface RetrieveOptions {
  /** How many products to show per intent. */
  limit?: number;
  /** How many to fetch before client-side filter/sort. */
  fetchSize?: number;
}

/** State handed to generate: the branch, the per-intent results, and any notes. */
export const retrieveStateSchema = z.object({
  kind: z.enum(["product", "chitchat", "off_catalog"]),
  results: z.array(productResultsPartSchema),
  /** Human-readable notes, e.g. a relaxed constraint (US-4.4). */
  notes: z.array(z.string()),
});

export type RetrieveState = z.infer<typeof retrieveStateSchema>;

function filtersFor(intent: SearchIntent): ProductFilters {
  return {
    minPrice: intent.minPrice,
    maxPrice: intent.maxPrice,
    minRating: intent.minRating,
    brands: intent.brands,
    inStockOnly: intent.inStockOnly,
    onSaleOnly: intent.onSaleOnly,
  };
}

async function retrieveOneIntent(
  intent: SearchIntent,
  deps: CatalogDeps,
  categories: Category[],
  opts: Required<RetrieveOptions>,
): Promise<{ part: ProductResultsPart; notes: string[] }> {
  // Pick the endpoint: a category term → category browse, else keyword search.
  const slug = intent.category ? resolveCategorySlug(intent.category, categories) : null;
  const fetched = slug
    ? await deps.getCategoryProducts(slug, { limit: opts.fetchSize })
    : await deps.searchProducts(intent.keywords ?? intent.label, { limit: opts.fetchSize });

  const all = fetched.products;
  const filters = filtersFor(intent);
  let matched = filterProducts(all, filters);
  const notes: string[] = [];

  // US-4.4: if a price ceiling left nothing but products exist, relax it and say so.
  if (matched.length === 0 && intent.maxPrice !== undefined && all.length > 0) {
    const cheapest = Math.min(...all.map((p) => p.price));
    notes.push(
      `No "${intent.label}" under $${intent.maxPrice} — the cheapest available is $${cheapest}, showing those instead.`,
    );
    matched = filterProducts(all, { ...filters, maxPrice: undefined });
  }

  const sorted = sortProducts(matched, intent.sort?.field as SortField | undefined, intent.sort?.order);
  const products = paginate(sorted, opts.limit);

  return { part: { intent: intent.label, products }, notes };
}

/**
 * Plan + retrieve (D2). Non-product branches retrieve nothing. For a product
 * turn, each intent is retrieved independently (US-1.3) via the §5 strategy:
 * pick endpoint → fetch → filter/sort/paginate client-side.
 */
export async function runRetrieve(
  plan: RoutePlan,
  deps: CatalogDeps = defaultDeps,
  options: RetrieveOptions = {},
): Promise<RetrieveState> {
  const opts: Required<RetrieveOptions> = {
    limit: options.limit ?? 5,
    fetchSize: options.fetchSize ?? 100,
  };

  if (plan.kind !== "product") {
    return { kind: plan.kind, results: [], notes: [] };
  }

  const needsCategories = plan.intents.some((i) => i.category);
  const categories = needsCategories ? await deps.getCategories() : [];

  const results: ProductResultsPart[] = [];
  const notes: string[] = [];
  for (const intent of plan.intents) {
    const { part, notes: intentNotes } = await retrieveOneIntent(intent, deps, categories, opts);
    results.push(part);
    notes.push(...intentNotes);
  }

  return { kind: "product", results, notes };
}

/** Workflow step wrapper. */
export const retrieveStep = createStep({
  id: "retrieve",
  inputSchema: looseSchema(classificationSchema),
  outputSchema: looseSchema(retrieveStateSchema),
  execute: async ({ inputData }) => runRetrieve(planRoute(classificationSchema.parse(inputData))),
});
