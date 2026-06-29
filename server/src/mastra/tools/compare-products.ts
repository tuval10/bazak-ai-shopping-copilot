import { type Product, type ProductResultsPart, PRODUCT_RESULTS_PART_TYPE } from "@bazak/shared";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { PartWriter } from "../../pipeline/generate";

/**
 * What the supervisor passes to compare TWO already-shown products (US-2.4): the two
 * ids, the model-authored `reason` (reused as the group's `rationale`), and an
 * optional `winnerId` to mark the suggested pick.
 */
export const compareProductsInputSchema = z.object({
  productIds: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  reason: z.string(),
  winnerId: z.number().int().positive().optional(),
});
export type CompareProductsInput = z.infer<typeof compareProductsInputSchema>;

/** A lean acknowledgement the supervisor reasons over — the comparison is streamed separately. */
export const compareProductsOutputSchema = z.object({
  /** True when an id wasn't a shown product — nothing was compared. */
  notFound: z.boolean().optional(),
  note: z.string(),
});
export type CompareProductsOutput = z.infer<typeof compareProductsOutputSchema>;

export interface CompareProductsToolOptions {
  /** The workflow stream writer — the grounded comparison is emitted here. */
  writer?: PartWriter;
  /** Full product records by id — the grounding source (only shown products are present). */
  registry: Map<number, Product>;
  /** The turn's authoritative results — the comparison is appended so it persists/rehydrates. */
  accumulator: ProductResultsPart[];
  /** Shared step counter — a comparison is a step too, so it can't loop. */
  stepCounter: { count: number };
  /** The provable per-turn step ceiling (SUPERVISOR_MAX_STEPS). */
  maxSteps: number;
}

/**
 * Framework-free core of `compare_products`: enforce the step cap, ground BOTH ids
 * against the registry, and emit a two-product `comparison` group (CODE emits the
 * grounded cards; the model only picks ids + writes the reason). Exported for tests.
 */
export async function runCompareProducts(
  input: CompareProductsInput,
  opts: CompareProductsToolOptions,
): Promise<CompareProductsOutput> {
  if (opts.stepCounter.count >= opts.maxSteps) {
    return {
      note: `Step limit reached (${opts.maxSteps} tool calls per turn). Write your final reply now with what you already have.`,
    };
  }
  opts.stepCounter.count++;

  const [idA, idB] = input.productIds;
  const a = opts.registry.get(idA);
  const b = opts.registry.get(idB);
  const missing = [!a ? idA : null, !b ? idB : null].filter((x): x is number => x !== null);
  if (missing.length) {
    return {
      notFound: true,
      note: `No shown product has id ${missing.join(" or ")}. Only compare products that were already shown this conversation (use their real ids).`,
    };
  }

  const winnerId = input.winnerId === idA || input.winnerId === idB ? input.winnerId : undefined;
  const group: ProductResultsPart = {
    intent: "Side-by-side",
    products: [a as Product, b as Product],
    rationale: input.reason,
    display: "comparison",
    ...(winnerId ? { winnerId } : {}),
  };
  await opts.writer?.custom({ type: PRODUCT_RESULTS_PART_TYPE, data: group });
  opts.accumulator.push(group);

  return { note: `Comparing "${(a as Product).title}" vs "${(b as Product).title}" side by side.` };
}

/**
 * Build the `compare_products` tool for one turn. The supervisor calls it when the buyer
 * is torn between two already-shown products (or, for an ambiguous "help me choose" with
 * no clear winner, to lay the best two side by side — optionally leaning on `winnerId`).
 */
export function createCompareProductsTool(opts: CompareProductsToolOptions) {
  return createTool({
    id: "compare_products",
    description:
      "Lay TWO already-shown products side by side as a spec table. Use it when the buyer is torn between " +
      "two items, or for an ambiguous 'help me choose' where there's no clear single winner. Pass the two real " +
      "`productIds` (from PREVIOUSLY SHOWN PRODUCTS or a find_products result this turn), a short `reason` " +
      "(what the trade-off is), and an optional `winnerId` to suggest a pick. The comparison is shown to the " +
      "user automatically. Only use ids that were actually shown.",
    inputSchema: compareProductsInputSchema,
    outputSchema: compareProductsOutputSchema,
    execute: async (input: CompareProductsInput) => runCompareProducts(input, opts),
  });
}
