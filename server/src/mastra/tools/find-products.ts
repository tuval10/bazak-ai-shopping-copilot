import { type Product, type ProductResultsPart, PRODUCT_RESULTS_PART_TYPE } from "@bazak/shared";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { type Category } from "../../catalog";
import {
  type AgenticFinder,
  type ResolvedOptions,
  runFinder,
} from "../../pipeline/discovery";
import { searchIntentSchema } from "../../pipeline/classification";
import type { PartWriter } from "../../pipeline/generate";
import { type CatalogDeps } from "../../pipeline/retrieve";

/**
 * What the supervisor passes for one shopping angle: the structured finder
 * (label/keywords/category/bounds/sort/hardConstraints) plus a natural-language
 * `brief` — the situational "why". Reuses the finder schema so the brief persists
 * with the turn (continuation) and flows straight into the finder.
 */
export const findProductsInputSchema = searchIntentSchema;
export type FindProductsInput = z.infer<typeof findProductsInputSchema>;

/** A lean product view the model reasons over — never the full record (grounding). */
const leanProductSchema = z.object({
  id: z.number(),
  title: z.string(),
  price: z.number(),
  rating: z.number(),
  brand: z.string().optional(),
  stock: z.number(),
});

/**
 * What the tool returns TO THE SUPERVISOR (not the user): a compact narrative it
 * uses to reason + write per-item prose. The authoritative product cards are
 * streamed separately via the writer (grounding — code emits cards, not the model).
 */
export const findProductsOutputSchema = z.object({
  /** True when a hard per-turn cap (step or finder) was hit — no finder ran. */
  limitReached: z.boolean().optional(),
  /** Total grounded products this call surfaced (across its groups). */
  found: z.number(),
  groups: z.array(
    z.object({
      intent: z.string(),
      count: z.number(),
      /** The deterministic relaxed fact, if this group relaxed a soft constraint. */
      relaxed: z.object({ constraint: z.string(), from: z.string(), to: z.string() }).optional(),
      products: z.array(leanProductSchema),
    }),
  ),
  /** A short plain-English note (e.g. nothing matched, or a constraint was relaxed). */
  note: z.string(),
});

export type FindProductsOutput = z.infer<typeof findProductsOutputSchema>;

export interface FindProductsToolOptions {
  /** The workflow stream writer — grounded cards are emitted here as each group lands. */
  writer?: PartWriter;
  /** Catalog functions (injectable for tests). */
  deps: CatalogDeps;
  /** Real categories for slug grounding + the finder prompt. */
  categories: Category[];
  /** The inner agentic finder (the `discovery` agent) this tool drives. */
  finderAgent: AgenticFinder;
  /**
   * Product ids to exclude from every group — seeded with the thread's already-shown
   * ids and grown across calls so finders never repeat products (deterministic dedup).
   */
  exclude: Set<number>;
  /** Every grounded group this turn produced, in order — the turn's authoritative results. */
  accumulator: ProductResultsPart[];
  /**
   * Full product records by id — grown as groups land so the recommend_product /
   * compare_products tools can ground a follow-up by id. Optional (tests omit it).
   */
  registry?: Map<number, Product>;
  /** The finders actually run this turn — persisted so a later "show me more" can reuse them. */
  usedFinders: FindProductsInput[];
  /** Run-local finder-call counter — hard-caps actual finder runs at `maxFinders`. */
  counter: { count: number };
  /** The provable per-turn finder ceiling (MAX_PRODUCT_FINDERS). */
  maxFinders: number;
  /**
   * Run-local step counter — incremented on EVERY call (including refused ones) to
   * hard-cap the supervisor's tool-calling turns at `maxSteps`, independent of the
   * framework's soft `maxSteps` on `.generate`.
   */
  stepCounter: { count: number };
  /** The provable per-turn step ceiling (SUPERVISOR_MAX_STEPS). */
  maxSteps: number;
  /** Tool-call cap for the inner finder run (FINDER_MAX_STEPS). */
  finderMaxSteps: number;
  /** Products shown per group. */
  limit?: number;
  /** Products fetched per inner search before client-side filter/sort. */
  fetchSize?: number;
  /** Products a single inner search returns to the finder. */
  toolLimit?: number;
}

const lean = (p: ProductResultsPart["products"][number]) => ({
  id: p.id,
  title: p.title,
  price: p.price,
  rating: p.rating,
  brand: p.brand,
  stock: p.stock,
});

/**
 * Framework-free core of `find_products`: enforce the run-local cap, run ONE finder
 * for the brief, stream its grounded groups as product-results parts, accumulate
 * them, grow the exclude set, and return a lean narrative to the supervisor. Exported
 * so tests can drive it without the Mastra tool wrapper.
 */
export async function runFindProducts(
  input: FindProductsInput,
  opts: FindProductsToolOptions,
): Promise<FindProductsOutput> {
  // Provable step ceiling: hard-stop the agentic loop in CODE (not just the framework's
  // soft maxSteps). Count this call before any other check — refused calls are steps too.
  if (opts.stepCounter.count >= opts.maxSteps) {
    return {
      limitReached: true,
      found: 0,
      groups: [],
      note: `Step limit reached (${opts.maxSteps} tool calls per turn). Stop calling find_products and write your final reply now with what you already have.`,
    };
  }
  opts.stepCounter.count++;

  // Provable ceiling: refuse beyond MAX_PRODUCT_FINDERS even though the loop is agentic.
  if (opts.counter.count >= opts.maxFinders) {
    return {
      limitReached: true,
      found: 0,
      groups: [],
      note: `Finder limit reached (${opts.maxFinders} per turn). Work with what you already have.`,
    };
  }
  opts.counter.count++;
  opts.usedFinders.push(input);

  const resolved: ResolvedOptions = {
    limit: opts.limit ?? 5,
    fetchSize: opts.fetchSize ?? 100,
    toolLimit: opts.toolLimit ?? 10,
    maxSteps: opts.finderMaxSteps,
    // A COPY so the finder's internal dedup starts from the current exclude set; we
    // grow the shared set ourselves below as groups are accepted.
    exclude: new Set(opts.exclude),
  };

  const groups = await runFinder(input, opts.finderAgent, opts.deps, opts.categories, resolved);

  for (const group of groups) {
    await opts.writer?.custom({ type: PRODUCT_RESULTS_PART_TYPE, data: group });
    opts.accumulator.push(group);
    for (const p of group.products) {
      opts.exclude.add(p.id);
      opts.registry?.set(p.id, p);
    }
  }

  const found = groups.reduce((n, g) => n + g.products.length, 0);
  const note = found
    ? groups.some((g) => g.relaxed)
      ? "Found products, but relaxed a soft constraint to do so — be honest about the trade-off."
      : "Found matching products."
    : "Nothing relevant matched for this angle.";

  return {
    found,
    groups: groups.map((g) => ({
      intent: g.intent,
      count: g.products.length,
      ...(g.relaxed ? { relaxed: g.relaxed } : {}),
      products: g.products.map(lean),
    })),
    note,
  };
}

/**
 * Build the `find_products` tool for one turn. The supervisor calls it once per
 * shopping angle; each call streams grounded product cards to the client and returns
 * a lean narrative the supervisor reasons over to write its reply.
 */
export function createFindProductsTool(opts: FindProductsToolOptions) {
  return createTool({
    id: "find_products",
    description:
      "Search the catalog for ONE shopping angle and return matching products. Pass a rich `brief` " +
      "(the situational why, e.g. 'flying to Tokyo, wants a carry-on bag'), short `keywords` (1–2 nouns), " +
      "and an optional real category slug + price/rating/brand bounds + sort. Call once per distinct angle " +
      "(multiple items, or adjacent ideas for an off-catalog request). The matching product CARDS are shown " +
      "to the user automatically; this returns a compact summary so you can write your reply. Do NOT call it " +
      "when the user only asks about products already shown — answer those directly.",
    inputSchema: findProductsInputSchema,
    outputSchema: findProductsOutputSchema,
    execute: async (input: FindProductsInput) => runFindProducts(input, opts),
  });
}
