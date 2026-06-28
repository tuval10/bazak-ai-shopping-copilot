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
