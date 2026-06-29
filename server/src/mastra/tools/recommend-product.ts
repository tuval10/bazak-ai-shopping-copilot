import { type Product, type ProductResultsPart, PRODUCT_RESULTS_PART_TYPE } from "@bazak/shared";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { PartWriter } from "../../pipeline/generate";

/**
 * What the supervisor passes to spotlight ONE product (US-2.2/2.3): the id of an
 * already-shown product, which badge to stamp, and the model-authored `reason`
 * (the per-item pitch, reused as the group's `rationale`).
 */
export const recommendProductInputSchema = z.object({
  productId: z.number().int().positive(),
  badge: z.enum(["recommended", "best-value"]),
  reason: z.string(),
});
export type RecommendProductInput = z.infer<typeof recommendProductInputSchema>;

/** A lean acknowledgement the supervisor reasons over — the CARD is streamed separately (grounding). */
export const recommendProductOutputSchema = z.object({
  /** True when the id wasn't a shown product — nothing was spotlighted. */
  notFound: z.boolean().optional(),
  note: z.string(),
});
export type RecommendProductOutput = z.infer<typeof recommendProductOutputSchema>;

export interface RecommendProductToolOptions {
  /** The workflow stream writer — the grounded card is emitted here. */
  writer?: PartWriter;
  /** Full product records by id — the grounding source (only shown products are present). */
  registry: Map<number, Product>;
  /** The turn's authoritative results — the spotlight is appended so it persists/rehydrates. */
  accumulator: ProductResultsPart[];
  /** Shared step counter — a spotlight is a step too, so it can't loop. */
  stepCounter: { count: number };
  /** The provable per-turn step ceiling (SUPERVISOR_MAX_STEPS). */
  maxSteps: number;
}

const BADGE_INTENT: Record<RecommendProductInput["badge"], string> = {
  recommended: "My pick for you",
  "best-value": "Best value for money",
};

/**
 * Framework-free core of `recommend_product`: enforce the step cap, ground the id
 * against the registry, and emit a single-product `recommendation` group (the model
 * picks the id + writes the reason; CODE emits the grounded card). Exported for tests.
 */
export async function runRecommendProduct(
  input: RecommendProductInput,
  opts: RecommendProductToolOptions,
): Promise<RecommendProductOutput> {
  if (opts.stepCounter.count >= opts.maxSteps) {
    return {
      note: `Step limit reached (${opts.maxSteps} tool calls per turn). Write your final reply now with what you already have.`,
    };
  }
  opts.stepCounter.count++;

  const product = opts.registry.get(input.productId);
  if (!product) {
    return {
      notFound: true,
      note: `No shown product has id ${input.productId}. Only recommend a product that was already shown this conversation (use its real id).`,
    };
  }

  const group: ProductResultsPart = {
    intent: BADGE_INTENT[input.badge],
    products: [product],
    rationale: input.reason,
    display: "recommendation",
    badge: input.badge,
  };
  await opts.writer?.custom({ type: PRODUCT_RESULTS_PART_TYPE, data: group });
  opts.accumulator.push(group);

  return { note: `Spotlighted "${product.title}" as ${input.badge}.` };
}

/**
 * Build the `recommend_product` tool for one turn. The supervisor calls it to spotlight
 * a single already-shown product with a "Recommended" or "Best value for money" badge —
 * for "choose one for me" / value asks, or proactively when one product clearly converts.
 */
export function createRecommendProductTool(opts: RecommendProductToolOptions) {
  return createTool({
    id: "recommend_product",
    description:
      "Spotlight ONE already-shown product as your pick, with a badge. Use badge='recommended' for " +
      "'choose one for me' / a clear best fit, and badge='best-value' for a 'worth my money' ask. Pass the " +
      "product's real `id` (from PREVIOUSLY SHOWN PRODUCTS or a find_products result this turn) and a short " +
      "`reason` (why it's the pick). The product CARD is shown to the user automatically. You MAY also call " +
      "this right after a search to highlight a standout that will help the buyer decide. Only use ids that " +
      "were actually shown.",
    inputSchema: recommendProductInputSchema,
    outputSchema: recommendProductOutputSchema,
    execute: async (input: RecommendProductInput) => runRecommendProduct(input, opts),
  });
}
