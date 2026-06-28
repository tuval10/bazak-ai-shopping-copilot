import type { Product } from "@bazak/shared";

/**
 * Client-side product filters. DummyJSON has no server-side filter for price,
 * rating, brand, or stock (ARCHITECTURE §5), so these are applied after fetch.
 */
export interface ProductFilters {
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  /** Case-insensitive brand match; products without a brand never match. */
  brands?: string[];
  /** Keep only items with stock > 0 (US-1.7 "only in-stock"). */
  inStockOnly?: boolean;
  /** Keep only items with a discount (US-1.7 "what's on sale"). */
  onSaleOnly?: boolean;
}

/** The effective unit price after any discount. */
export function discountedPrice(product: Product): number {
  const factor = 1 - product.discountPercentage / 100;
  return Math.round(product.price * factor * 100) / 100;
}

export function filterProducts(
  products: Product[],
  filters: ProductFilters = {},
): Product[] {
  const brandSet = filters.brands?.length
    ? new Set(filters.brands.map((b) => b.toLowerCase()))
    : undefined;

  return products.filter((p) => {
    if (filters.minPrice !== undefined && p.price < filters.minPrice) return false;
    if (filters.maxPrice !== undefined && p.price > filters.maxPrice) return false;
    if (filters.minRating !== undefined && p.rating < filters.minRating) return false;
    if (brandSet && !(p.brand && brandSet.has(p.brand.toLowerCase()))) return false;
    if (filters.inStockOnly && p.stock <= 0) return false;
    if (filters.onSaleOnly && p.discountPercentage <= 0) return false;
    return true;
  });
}
