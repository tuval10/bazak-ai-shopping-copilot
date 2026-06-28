import { z } from "zod";
import { productSchema } from "./product";

/**
 * The D6 stream part: one intent and the products retrieved for it. The generate
 * step writes one of these per intent onto the workflow stream; the frontend
 * renders each as a product-card group (US-1.3 multi-intent, US-2.1).
 */
export const productResultsPartSchema = z.object({
  intent: z.string(),
  products: z.array(productSchema),
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
