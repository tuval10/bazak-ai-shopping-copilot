import { z } from "zod";
import { productSchema } from "./product";

/**
 * A constraint the discovery finder loosened to surface results, with the actual
 * catalog value found (US-4.4). Deterministic facts computed from the catalog —
 * NOT model-authored — so the "Relaxed: under $100 → $110" badge can never lie.
 */
export const relaxedConstraintSchema = z.object({
  constraint: z.string(), // e.g. "maxPrice", "brand", "category"
  from: z.string(), // what the user asked for, e.g. "under $100"
  to: z.string(), // what we actually found, e.g. "$110"
});

export type RelaxedConstraint = z.infer<typeof relaxedConstraintSchema>;

/**
 * The D6 stream part: one merchandised group of products. The generate step
 * writes one of these per group onto the workflow stream; the frontend renders
 * each as a product-card group (US-1.3 multi-intent, US-2.1).
 *
 * A single finder can emit several groups when it relaxes soft constraints along
 * different axes (US-4.4): `rationale` is the model-authored pitch for the group,
 * `relaxed` is the deterministic fact about which constraint was loosened.
 */
export const productResultsPartSchema = z.object({
  intent: z.string(),
  products: z.array(productSchema),
  rationale: z.string().optional(),
  relaxed: relaxedConstraintSchema.optional(),
});

export type ProductResultsPart = z.infer<typeof productResultsPartSchema>;

/**
 * Wire constants shared by server and frontend (the anti-drift seam, D11):
 * - `PRODUCT_RESULTS_PART_TYPE` — the `type` discriminator on the streamed data part
 *   the generate step writes via `writer.custom(...)` and the FE reads off the stream (D6).
 * - `RESULTS_METADATA_KEY` — the `content.metadata` key under which a turn's results are
 *   persisted on the assistant message so history rehydrates the cards (D12).
 */
export const PRODUCT_RESULTS_PART_TYPE = "data-product-results";
export const RESULTS_METADATA_KEY = "productResults";
