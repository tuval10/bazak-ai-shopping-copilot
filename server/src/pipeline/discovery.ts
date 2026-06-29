import {
  type Product,
  type ProductResultsPart,
  type RelaxedConstraint,
} from "@bazak/shared";
import { z } from "zod";
import {
  type Category,
  filterProducts,
  formatCategoryList,
  paginate,
  type ProductFilters,
  type SortField,
  sortProducts,
} from "../catalog";
import { createCategoryBrowseTool, createProductSearchTool } from "../mastra/tools/search-products";
import { logger } from "../observability/logger";
import { type ConstraintKey, type SearchIntent } from "./classification";
import { type CatalogDeps, filtersFor } from "./retrieve";

/** Structured trace for a finder run (visible at LOG_LEVEL=debug). */
const trace = (msg: string, fields: Record<string, unknown> = {}) => {
  logger.debug(`discovery ${msg}`, { component: "discovery", ...fields });
};

/** One product group the finder agent selected (by id) for a single angle (US-4.4). */
export const finderGroupSchema = z.object({
  /** Short label for this group, e.g. "cheapest wireless". */
  intent: z.string(),
  /** Ids the agent chose for THIS group — must come from a `product_search` result. */
  productIds: z.array(z.number()).default([]),
  /** Model-authored pitch for the group's trade-off. */
  rationale: z.string().optional(),
  /** The SOFT constraint this group exists by relaxing (omitted for the focused group). */
  droppedConstraint: z
    .enum(["minPrice", "maxPrice", "minRating", "brands", "inStockOnly", "onSaleOnly", "category"])
    .optional(),
});

export type FinderGroup = z.infer<typeof finderGroupSchema>;

/** The finder agent's structured output: ordered product groups (best first). */
export const finderResultSchema = z.object({
  groups: z.array(finderGroupSchema).default([]),
});

export type FinderResult = z.infer<typeof finderResultSchema>;

/**
 * Minimal structural view of the agentic finder (injectable for tests). It is given
 * the `product_search` tool per-run via `toolsets` and a `maxSteps` cap, and returns
 * the selected groups as structured output.
 */
export interface AgenticFinder {
  generate(
    prompt: string,
    options: {
      structuredOutput: { schema: typeof finderResultSchema };
      toolsets?: Record<string, Record<string, unknown>>;
      maxSteps?: number;
    },
  ): Promise<{ object: unknown }>;
}

/** Per-run knobs for one finder: page sizes, the step cap, and the exclude (dedup) set. */
export type ResolvedOptions = {
  limit: number;
  fetchSize: number;
  toolLimit: number;
  maxSteps: number;
  exclude: Set<number>;
};

/** A finder's HARD constraints as a filter — always enforced, never relaxed. */
function hardFiltersFor(finder: SearchIntent): ProductFilters {
  const hard = new Set(finder.hardConstraints ?? []);
  const all = filtersFor(finder);
  const out: ProductFilters = {};
  if (hard.has("minPrice")) out.minPrice = all.minPrice;
  if (hard.has("maxPrice")) out.maxPrice = all.maxPrice;
  if (hard.has("minRating")) out.minRating = all.minRating;
  if (hard.has("brands")) out.brands = all.brands;
  if (hard.has("inStockOnly")) out.inStockOnly = all.inStockOnly;
  if (hard.has("onSaleOnly")) out.onSaleOnly = all.onSaleOnly;
  return out;
}

/**
 * The deterministic `relaxed` fact for a group whose soft constraint was dropped,
 * computed from the REAL products shown (never model-authored — the badge can't lie).
 */
function relaxedFactFor(
  finder: SearchIntent,
  key: ConstraintKey,
  pool: Product[],
): RelaxedConstraint | undefined {
  switch (key) {
    case "maxPrice":
      if (finder.maxPrice === undefined || pool.length === 0) return undefined;
      return { constraint: "maxPrice", from: `under $${finder.maxPrice}`, to: `$${Math.min(...pool.map((p) => p.price))}` };
    case "minPrice":
      if (finder.minPrice === undefined || pool.length === 0) return undefined;
      return { constraint: "minPrice", from: `over $${finder.minPrice}`, to: `$${Math.max(...pool.map((p) => p.price))}` };
    case "minRating":
      if (finder.minRating === undefined || pool.length === 0) return undefined;
      return { constraint: "minRating", from: `${finder.minRating}★ and up`, to: `${Math.max(...pool.map((p) => p.rating)).toFixed(1)}★` };
    case "brands":
      if (!finder.brands?.length) return undefined;
      return { constraint: "brands", from: finder.brands.join(", "), to: "other brands" };
    case "inStockOnly":
      return { constraint: "inStockOnly", from: "in stock only", to: "incl. limited stock" };
    case "onSaleOnly":
      return { constraint: "onSaleOnly", from: "on sale only", to: "incl. full price" };
    case "category":
      return finder.category
        ? { constraint: "category", from: finder.category, to: "a broader search" }
        : undefined;
  }
}

/** Build the finder-agent prompt: the finder + which constraints are hard + the real categories. */
export function buildFinderPrompt(finder: SearchIntent, categories: Category[]): string {
  const hard = finder.hardConstraints ?? [];
  const catBlock = categories.length
    ? [
        "",
        "CATALOG CATEGORIES (real category slugs — keyword-search a noun, or browse a whole slug):",
        formatCategoryList(categories),
      ]
    : [];
  const briefBlock = finder.brief
    ? ["", `CONTEXT (why the shopper wants this — use it to choose good queries): ${finder.brief}`]
    : [];
  return [
    "Find products for this finder:",
    JSON.stringify(finder),
    `HARD constraints (never relax these): ${hard.length ? hard.join(", ") : "none"}.`,
    ...briefBlock,
    ...catBlock,
    "",
    "Use `product_search` (by keyword) or `category_browse` (by slug) to retrieve, relax if too few, and return the best groups.",
  ].join("\n");
}

/**
 * Assemble the deterministic result groups from the agent's id-based selection:
 * resolve ids → REAL products via the run registry (dropping unknown/hallucinated
 * ids), re-enforce hard constraints, exclude already-shown ids, dedup across the
 * finder's groups, paginate, and compute the deterministic `relaxed` fact.
 */
export function assembleGroups(
  finder: SearchIntent,
  groups: FinderGroup[],
  registry: Map<number, Product>,
  opts: { limit: number; exclude: Set<number> },
): ProductResultsPart[] {
  const hardFilters = hardFiltersFor(finder);
  const seen = new Set<number>(opts.exclude);
  const out: ProductResultsPart[] = [];

  for (const g of groups) {
    // Resolve ids → real products, in the order the model listed them. Drop unknown ids.
    const resolved = g.productIds.map((id) => registry.get(id)).filter((p): p is Product => p !== undefined);
    // Defensive: hard constraints can never be relaxed, even if the model returned a violator.
    const safe = filterProducts(resolved, hardFilters);
    const fresh = safe.filter((p) => !seen.has(p.id));
    const products = paginate(fresh, opts.limit);
    if (products.length === 0) continue;
    for (const p of products) seen.add(p.id);

    const relaxed = g.droppedConstraint ? relaxedFactFor(finder, g.droppedConstraint, products) : undefined;
    out.push({
      intent: g.intent || finder.label,
      products,
      ...(g.rationale ? { rationale: g.rationale } : {}),
      ...(relaxed ? { relaxed } : {}),
    });
  }
  return out;
}

/**
 * Run one finder agentically: hand the agent a run-local `product_search` tool
 * (bound to a grounding registry) and let it search + relax within `maxSteps`, then
 * assemble its id-based selection into grounded, deduped, paginated groups.
 */
export async function runFinder(
  finder: SearchIntent,
  agent: AgenticFinder,
  deps: CatalogDeps,
  categories: Category[],
  opts: ResolvedOptions,
): Promise<ProductResultsPart[]> {
  trace(`finder START "${finder.label}"`);
  const registry = new Map<number, Product>();
  const enforcedFilters = hardFiltersFor(finder);
  // Both retrieval tools share ONE run-local registry so ids from either grounds.
  const searchTool = createProductSearchTool({
    registry,
    search: deps.searchProducts,
    fetchSize: opts.fetchSize,
    defaultLimit: opts.toolLimit,
    enforcedFilters,
  });
  const browseTool = createCategoryBrowseTool({
    registry,
    browse: deps.getCategoryProducts,
    categories,
    fetchSize: opts.fetchSize,
    defaultLimit: opts.toolLimit,
    enforcedFilters,
  });

  let parsed: FinderResult;
  try {
    const result = await agent.generate(buildFinderPrompt(finder, categories), {
      structuredOutput: { schema: finderResultSchema },
      toolsets: { catalog: { product_search: searchTool, category_browse: browseTool } },
      maxSteps: opts.maxSteps,
    });
    parsed = finderResultSchema.parse(result.object);
  } catch (err) {
    trace(`finder "${finder.label}" FAILED`, { err: err instanceof Error ? err.message : String(err) });
    return [];
  }

  const groups = assembleGroups(finder, parsed.groups, registry, { limit: opts.limit, exclude: opts.exclude });
  trace(`finder DONE "${finder.label}" → ${groups.length} groups, ${registry.size} products seen`);
  return groups;
}
