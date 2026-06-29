import {
  type Product,
  type ProductResultsPart,
  type RelaxedConstraint,
  RESULTS_METADATA_KEY,
  workflowInputSchema,
} from "@bazak/shared";
import type { Mastra } from "@mastra/core";
import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { type Category, filterProducts } from "../catalog";
import { type SortField, paginate, sortProducts } from "../catalog/sort";
import { loadEnv } from "../config/env";
import { logger } from "../observability/logger";
import {
  type ConstraintKey,
  constraintKeySchema,
  FINDERS_METADATA_KEY,
  type OrchestrationPlan,
  orchestrationPlanSchema,
  type SearchIntent,
  searchIntentSchema,
  sortPrefSchema,
} from "./classification";
import {
  type CatalogDeps,
  defaultDeps,
  fetchForIntent,
  filtersFor,
  type RetrieveState,
  retrieveStateSchema,
} from "./retrieve";
import { looseSchema } from "./step-schema";

/**
 * How many matches a focused query needs to be considered "strong" — at or above
 * this we show that group and stop (offer filter chips instead of relaxing). Below
 * it, discovery plans relaxation axes. One tuned knob (plan: STRONG_RESULT).
 */
export const STRONG_RESULT = 3;

/** Structured trace for the concurrent finder fan-out (visible at LOG_LEVEL=debug). */
const trace = (msg: string, fields: Record<string, unknown> = {}) => {
  logger.debug(`discovery ${msg}`, { component: "discovery", ...fields });
};

/** One relaxation move the discovery agent proposes for a weak finder (US-4.4). */
export const relaxationAxisSchema = z.object({
  /** A single SOFT constraint to drop (e.g. "maxPrice"). */
  drop: constraintKeySchema.optional(),
  /** Alternative/broader keywords to search instead. */
  keywords: z.string().optional(),
  /** Alternative category to browse instead. */
  category: z.string().optional(),
  /** How to order this angle so the best options surface. */
  sort: sortPrefSchema.optional(),
  /** Short persuasive pitch for the resulting group (model-authored). */
  rationale: z.string(),
});

export type RelaxationAxis = z.infer<typeof relaxationAxisSchema>;

/** The discovery agent's structured fallback plan: ordered relaxation axes. */
export const discoveryPlanSchema = z.object({
  axes: z.array(relaxationAxisSchema).max(4).default([]),
});

export type DiscoveryPlan = z.infer<typeof discoveryPlanSchema>;

/** Minimal structural view of the discovery agent (injectable for tests). */
export interface StructuredDiscovery {
  generate(
    message: string,
    options: { structuredOutput: { schema: typeof discoveryPlanSchema } },
  ): Promise<{ object: unknown }>;
}

export interface DiscoveryOptions {
  /** Products shown per group. */
  limit?: number;
  /** Products fetched before client-side filter/sort. */
  fetchSize?: number;
  /** Matches at/above which a focused query is "strong" (no relaxation). */
  strongResult?: number;
  /** Catalog API calls a single finder may make (DISCOVERY_MAX_CALLS). */
  maxCalls?: number;
  /**
   * Product ids already shown earlier in this thread — excluded from every group
   * so a "show me more" continuation pages forward without repeats. Deterministic
   * (not the model's job): the dedup happens here in code.
   */
  excludeIds?: number[];
}

type ResolvedOptions = {
  limit: number;
  fetchSize: number;
  strongResult: number;
  maxCalls: number;
  exclude: Set<number>;
};

/** A budget of catalog API calls for one finder. Decremented on each fetch. */
interface CallBudget {
  remaining: number;
}

/** A group before pagination/dedup: its sorted matches plus framing. */
interface RawGroup {
  intent: string;
  sorted: Product[];
  rationale?: string;
  relaxed?: RelaxedConstraint;
}

/** Fetch for an intent, charging the finder's budget. Returns null when exhausted. */
async function chargedFetch(
  intent: SearchIntent,
  deps: CatalogDeps,
  categories: Category[],
  budget: CallBudget,
  fetchSize: number,
): Promise<Product[] | null> {
  if (budget.remaining <= 0) return null;
  budget.remaining -= 1;
  return fetchForIntent(intent, deps, categories, fetchSize);
}

/** Which constraints are actually set on a finder. */
function activeConstraints(finder: SearchIntent): ConstraintKey[] {
  const keys: ConstraintKey[] = [];
  if (finder.minPrice !== undefined) keys.push("minPrice");
  if (finder.maxPrice !== undefined) keys.push("maxPrice");
  if (finder.minRating !== undefined) keys.push("minRating");
  if (finder.brands?.length) keys.push("brands");
  if (finder.category) keys.push("category");
  if (finder.inStockOnly) keys.push("inStockOnly");
  if (finder.onSaleOnly) keys.push("onSaleOnly");
  return keys;
}

/** Active constraints minus the ones the user marked hard — the relaxable set. */
function softConstraints(finder: SearchIntent): ConstraintKey[] {
  const hard = new Set(finder.hardConstraints ?? []);
  return activeConstraints(finder).filter((k) => !hard.has(k));
}

/** The soft-only view of a finder handed to the discovery agent (hard ones stripped). */
function softView(finder: SearchIntent): Record<string, unknown> {
  const soft = new Set(softConstraints(finder));
  const v: Record<string, unknown> = { label: finder.label };
  if (finder.keywords) v.keywords = finder.keywords;
  if (finder.sort) v.sort = finder.sort;
  if (soft.has("category") && finder.category) v.category = finder.category;
  if (soft.has("minPrice")) v.minPrice = finder.minPrice;
  if (soft.has("maxPrice")) v.maxPrice = finder.maxPrice;
  if (soft.has("minRating")) v.minRating = finder.minRating;
  if (soft.has("brands")) v.brands = finder.brands;
  if (soft.has("inStockOnly")) v.inStockOnly = finder.inStockOnly;
  if (soft.has("onSaleOnly")) v.onSaleOnly = finder.onSaleOnly;
  return v;
}

/** Build the discovery-agent prompt from the soft view + the focused outcome. */
function buildDiscoveryPrompt(finder: SearchIntent, fetched: Product[], matched: number): string {
  const outcome =
    fetched.length === 0
      ? `The focused query returned 0 products from the catalog.`
      : `${matched} of ${fetched.length} fetched matched. Closest available: cheapest $${Math.min(
          ...fetched.map((p) => p.price),
        )}, best rating ${Math.max(...fetched.map((p) => p.rating)).toFixed(1)}.`;
  const soft = softConstraints(finder);
  return [
    "Finder (only soft, relaxable constraints are shown):",
    JSON.stringify(softView(finder)),
    `Soft constraints you may drop: ${soft.length ? soft.join(", ") : "none — broaden via keywords/category instead"}.`,
    "",
    outcome,
    "",
    "Propose relaxation axes (best first).",
  ].join("\n");
}

/** The deterministic `relaxed` fact for a dropped constraint, from real catalog data. */
function relaxedFact(
  finder: SearchIntent,
  key: ConstraintKey,
  pool: Product[],
): RelaxedConstraint | undefined {
  switch (key) {
    case "maxPrice":
      if (finder.maxPrice === undefined || pool.length === 0) return undefined;
      return {
        constraint: "maxPrice",
        from: `under $${finder.maxPrice}`,
        to: `$${Math.min(...pool.map((p) => p.price))}`,
      };
    case "minPrice":
      if (finder.minPrice === undefined || pool.length === 0) return undefined;
      return {
        constraint: "minPrice",
        from: `over $${finder.minPrice}`,
        to: `$${Math.max(...pool.map((p) => p.price))}`,
      };
    case "minRating":
      if (finder.minRating === undefined || pool.length === 0) return undefined;
      return {
        constraint: "minRating",
        from: `${finder.minRating}★ and up`,
        to: `${Math.max(...pool.map((p) => p.rating)).toFixed(1)}★`,
      };
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
    default:
      return undefined;
  }
}

/** Run one relaxation axis → a raw group (sorted, unpaginated), or null if it's empty/over budget. */
async function runAxis(
  finder: SearchIntent,
  axis: RelaxationAxis,
  focusedPool: Product[],
  deps: CatalogDeps,
  categories: Category[],
  budget: CallBudget,
  opts: ResolvedOptions,
): Promise<RawGroup | null> {
  const derived: SearchIntent = { ...finder };
  if (axis.keywords) derived.keywords = axis.keywords;
  if (axis.category) derived.category = axis.category;
  if (axis.sort) derived.sort = axis.sort;
  if (axis.drop === "category") derived.category = undefined;

  // A dropped filter constraint reuses the already-fetched pool (no call). A new
  // keyword/category requires a fresh, budgeted fetch.
  let pool = focusedPool;
  if (axis.keywords || axis.category) {
    const fetched = await chargedFetch(derived, deps, categories, budget, opts.fetchSize);
    if (!fetched) return null;
    pool = fetched;
  }

  let filters = filtersFor(derived);
  if (axis.drop) filters = { ...filters, [axis.drop]: undefined };
  const relaxed = axis.drop ? relaxedFact(finder, axis.drop, pool) : undefined;

  const matched = filterProducts(pool, filters);
  if (matched.length === 0) return null;
  const sorted = sortProducts(matched, derived.sort?.field as SortField | undefined, derived.sort?.order);
  return { intent: finder.label, sorted, rationale: axis.rationale, relaxed };
}

/** Run one finder: focused query, then (if weak) budgeted relaxation fan-out. */
async function runFinder(
  finder: SearchIntent,
  deps: CatalogDeps,
  categories: Category[],
  discovery: StructuredDiscovery,
  opts: ResolvedOptions,
): Promise<ProductResultsPart[]> {
  const budget: CallBudget = { remaining: opts.maxCalls };
  trace(`finder START "${finder.label}"`);

  const all = await chargedFetch(finder, deps, categories, budget, opts.fetchSize);
  if (!all) return [];
  const matched = filterProducts(all, filtersFor(finder));
  const focusedSorted = sortProducts(
    matched,
    finder.sort?.field as SortField | undefined,
    finder.sort?.order,
  );

  // Strong result → show it, no relaxation (filter chips offered downstream).
  // On a continuation turn, opts.exclude drops already-shown ids so we page forward.
  if (matched.length >= opts.strongResult) {
    const products = paginate(
      focusedSorted.filter((p) => !opts.exclude.has(p.id)),
      opts.limit,
    );
    trace(`finder "${finder.label}" STRONG (${matched.length} matched) → no relaxation`);
    return products.length === 0 ? [] : [{ intent: finder.label, products }];
  }

  // Weak → ask the discovery agent for relaxation axes, then execute within budget.
  trace(`finder "${finder.label}" WEAK (${matched.length} matched) → planning relaxation`);
  const plan = discoveryPlanSchema.parse(
    (await discovery.generate(buildDiscoveryPrompt(finder, all, matched.length), {
      structuredOutput: { schema: discoveryPlanSchema },
    })).object,
  );
  trace(`finder "${finder.label}" → ${plan.axes.length} axes, fanning out within budget`);

  const raw: RawGroup[] = [];
  if (matched.length > 0) raw.push({ intent: finder.label, sorted: focusedSorted });

  const hard = new Set(finder.hardConstraints ?? []);
  for (const axis of plan.axes) {
    if (budget.remaining <= 0 && (axis.keywords || axis.category)) continue;
    if (axis.drop && hard.has(axis.drop)) continue; // defense-in-depth: never drop a hard constraint
    const group = await runAxis(finder, axis, all, deps, categories, budget, opts);
    if (group) raw.push(group);
  }

  // Dedupe products across this finder's groups, then paginate each. Seeding with
  // opts.exclude also drops anything already shown earlier in the thread (continuation).
  const seen = new Set<number>(opts.exclude);
  const out: ProductResultsPart[] = [];
  for (const g of raw) {
    const products = paginate(
      g.sorted.filter((p) => !seen.has(p.id)),
      opts.limit,
    );
    if (products.length === 0) continue;
    for (const p of products) seen.add(p.id);
    out.push({
      intent: g.intent,
      products,
      ...(g.rationale ? { rationale: g.rationale } : {}),
      ...(g.relaxed ? { relaxed: g.relaxed } : {}),
    });
  }
  trace(`finder DONE "${finder.label}" → ${out.length} groups, ${opts.maxCalls - budget.remaining} catalog calls used`);
  return out;
}

/**
 * Budgeted, agentic product discovery (the "sub-agent" brain). For each finder:
 * focused query first; if weak, the discovery agent proposes relaxation axes and we
 * fan them out within the per-finder call budget, returning several merchandised
 * groups (US-4.4). Finders run concurrently; each gets its own DISCOVERY_MAX_CALLS.
 * Non-product/off-catalog finders are retrieved identically — declining honestly is
 * the generator's job (off-catalog merchandising); only an all-empty result declines.
 */
export async function runDiscovery(
  plan: OrchestrationPlan,
  deps: CatalogDeps = defaultDeps,
  discovery?: StructuredDiscovery,
  options: DiscoveryOptions = {},
): Promise<RetrieveState> {
  const opts: ResolvedOptions = {
    limit: options.limit ?? 5,
    fetchSize: options.fetchSize ?? 100,
    strongResult: options.strongResult ?? STRONG_RESULT,
    maxCalls: options.maxCalls ?? Number.POSITIVE_INFINITY,
    exclude: new Set(options.excludeIds ?? []),
  };

  if (plan.kind === "chitchat" || plan.finders.length === 0) {
    return { kind: plan.kind, results: [], notes: [], finders: [] };
  }

  // A no-op discovery agent for the happy path / tests that never relax.
  const agent: StructuredDiscovery =
    discovery ?? { generate: async () => ({ object: { axes: [] } }) };

  const needsCategories = plan.finders.some((f) => f.category);
  const categories = needsCategories ? await deps.getCategories() : [];

  trace(`fan-out: ${plan.finders.length} finders concurrently (kind=${plan.kind})`, {
    event: "fanout_start",
    finders: plan.finders.length,
    kind: plan.kind,
  });
  const perFinder = await Promise.all(
    plan.finders.map((f) => runFinder(f, deps, categories, agent, opts)),
  );
  const groups = perFinder.flat();
  trace(`fan-out complete: ${groups.length} total groups`, {
    event: "fanout_done",
    groups: groups.length,
  });
  // Carry the finders forward so the turn can persist them (reused by a later
  // "show me more" continuation).
  return { kind: plan.kind, results: groups, notes: [], finders: plan.finders };
}

const searchIntentArraySchema = z.array(searchIntentSchema);

/**
 * For a "show me more" continuation, recover what the previous turns in this thread
 * already did: the finders that ran (to reuse the exact search) and every product id
 * already shown (to page past them). Read from the assistant messages' persisted
 * metadata — the single source of truth we already write each turn. Best-effort: any
 * failure yields empty context and discovery falls back to the plan as-is.
 */
async function loadContinuationContext(
  mastra: Mastra,
  threadId: string,
  resourceId: string,
): Promise<{ priorFinders: SearchIntent[]; shownIds: number[] }> {
  const empty = { priorFinders: [] as SearchIntent[], shownIds: [] as number[] };
  try {
    const mem = await mastra.getAgent("generator").getMemory();
    if (!mem) return empty;
    const { messages } = await mem.recall({ threadId, resourceId, perPage: 10, page: 0 });
    const shown = new Set<number>();
    let priorFinders: SearchIntent[] = [];
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      const meta = (m.content as { metadata?: Record<string, unknown> })?.metadata ?? {};
      const results = meta[RESULTS_METADATA_KEY];
      if (Array.isArray(results)) {
        for (const group of results) {
          for (const p of (group as ProductResultsPart)?.products ?? []) {
            if (typeof p?.id === "number") shown.add(p.id);
          }
        }
      }
      // Messages come oldest→newest, so the last assistant turn with finders wins.
      const finders = searchIntentArraySchema.safeParse(meta[FINDERS_METADATA_KEY]);
      if (finders.success && finders.data.length) priorFinders = finders.data;
    }
    return { priorFinders, shownIds: [...shown] };
  } catch {
    return empty;
  }
}

/** Workflow step wrapper: pulls the discovery agent + budget from Mastra/env. */
export const discoverStep = createStep({
  id: "discover",
  inputSchema: looseSchema(orchestrationPlanSchema),
  outputSchema: looseSchema(retrieveStateSchema),
  execute: async ({ inputData, mastra, getInitData }) => {
    const plan = orchestrationPlanSchema.parse(inputData);
    const discovery = mastra.getAgent("discovery") as unknown as StructuredDiscovery;
    const maxCalls = loadEnv().discoveryMaxCalls;

    // "Show me more": reuse the prior finder + page past already-shown products,
    // rather than re-planning (which would re-extract — or invent — constraints).
    if (plan.continuation) {
      const { threadId, resourceId } = workflowInputSchema.parse(getInitData());
      const { priorFinders, shownIds } = await loadContinuationContext(mastra, threadId, resourceId);
      if (priorFinders.length > 0) {
        trace(
          `continuation: reusing ${priorFinders.length} prior finder(s), excluding ${shownIds.length} shown id(s)`,
        );
        const reused: OrchestrationPlan = { kind: "product", finders: priorFinders, continuation: true };
        return runDiscovery(reused, defaultDeps, discovery, { maxCalls, excludeIds: shownIds });
      }
      trace("continuation requested but no prior context found → planning fresh");
    }

    return runDiscovery(plan, defaultDeps, discovery, { maxCalls });
  },
});
