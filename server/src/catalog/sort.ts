import type { Product } from "@bazak/shared";
import { discountedPrice } from "./filter";

export type SortField = "price" | "rating" | "discount" | "title";
export type SortOrder = "asc" | "desc";

const comparators: Record<SortField, (a: Product, b: Product) => number> = {
  price: (a, b) => discountedPrice(a) - discountedPrice(b),
  rating: (a, b) => a.rating - b.rating,
  discount: (a, b) => a.discountPercentage - b.discountPercentage,
  title: (a, b) => a.title.localeCompare(b.title),
};

/**
 * Sort products client-side (ARCHITECTURE §5). Returns a new array; the input is
 * left untouched. With no field, the original order (catalog relevance) is kept.
 */
export function sortProducts(
  products: Product[],
  field?: SortField,
  order: SortOrder = "asc",
): Product[] {
  if (!field) return [...products];
  const cmp = comparators[field];
  const sorted = [...products].sort(cmp);
  return order === "desc" ? sorted.reverse() : sorted;
}

/** Slice a page out of an array (US-1.4 "show more" via limit/skip). */
export function paginate<T>(items: T[], limit: number, skip = 0): T[] {
  return items.slice(skip, skip + limit);
}
