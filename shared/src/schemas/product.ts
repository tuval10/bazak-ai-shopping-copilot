import { z } from "zod";

/**
 * A catalog product, narrowed to the fields the UI card and ranking actually use
 * (US-2.1 card: title/description/price/image; US-1.7: stock + discount).
 *
 * DummyJSON returns more fields (sku, weight, dimensions, reviews, …); unknown
 * keys are stripped by default rather than rejected, so the schema stays robust
 * against catalog additions. URL-ish fields are plain strings (not `.url()`) on
 * purpose — a single odd value shouldn't drop an otherwise-real product (US-5.1).
 */
export const productSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  price: z.number().nonnegative(),
  discountPercentage: z.number().min(0).max(100).default(0),
  rating: z.number().min(0).max(5).default(0),
  stock: z.number().int().nonnegative().default(0),
  brand: z.string().optional(),
  tags: z.array(z.string()).default([]),
  availabilityStatus: z.string().optional(),
  thumbnail: z.string(),
  images: z.array(z.string()).default([]),
});

export type Product = z.infer<typeof productSchema>;

/**
 * Shape of DummyJSON's list endpoints (`/products`, `/products/search`,
 * `/products/category/{slug}`): the products plus pagination counters used to
 * drive "show more" (US-1.4).
 */
export const productListResponseSchema = z.object({
  products: z.array(productSchema),
  total: z.number().int().nonnegative(),
  skip: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
});

export type ProductListResponse = z.infer<typeof productListResponseSchema>;
