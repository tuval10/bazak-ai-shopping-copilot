import { describe, expect, it } from "vitest";
import { discountedPrice, filterProducts } from "../../src/catalog/filter";
import { makeProduct } from "../helpers/products";

describe("filterProducts", () => {
  const products = [
    makeProduct({ id: 1, price: 50, rating: 4.8, brand: "Acme", stock: 5, discountPercentage: 0 }),
    makeProduct({ id: 2, price: 150, rating: 3.2, brand: "Globex", stock: 0, discountPercentage: 20 }),
    makeProduct({ id: 3, price: 500, rating: 4.1, brand: "Acme", stock: 10, discountPercentage: 5 }),
    makeProduct({ id: 4, price: 600, rating: 2.0, stock: 2, discountPercentage: 0 }),
  ];

  it("filters by max price", () => {
    expect(filterProducts(products, { maxPrice: 500 }).map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("filters by min price", () => {
    expect(filterProducts(products, { minPrice: 500 }).map((p) => p.id)).toEqual([3, 4]);
  });

  it("filters by min rating", () => {
    expect(filterProducts(products, { minRating: 4 }).map((p) => p.id)).toEqual([1, 3]);
  });

  it("filters by brand case-insensitively and excludes brandless products", () => {
    expect(filterProducts(products, { brands: ["acme"] }).map((p) => p.id)).toEqual([1, 3]);
  });

  it("keeps only in-stock items", () => {
    expect(filterProducts(products, { inStockOnly: true }).map((p) => p.id)).toEqual([1, 3, 4]);
  });

  it("keeps only on-sale items", () => {
    expect(filterProducts(products, { onSaleOnly: true }).map((p) => p.id)).toEqual([2, 3]);
  });

  it("combines constraints (the 'under $500, in stock, 4★+' case)", () => {
    expect(
      filterProducts(products, { maxPrice: 500, inStockOnly: true, minRating: 4 }).map((p) => p.id),
    ).toEqual([1, 3]);
  });

  it("returns everything for empty filters", () => {
    expect(filterProducts(products)).toHaveLength(4);
  });
});

describe("discountedPrice", () => {
  it("applies the discount percentage", () => {
    expect(discountedPrice(makeProduct({ price: 100, discountPercentage: 25 }))).toBe(75);
  });

  it("returns the full price when there is no discount", () => {
    expect(discountedPrice(makeProduct({ price: 80, discountPercentage: 0 }))).toBe(80);
  });
});
