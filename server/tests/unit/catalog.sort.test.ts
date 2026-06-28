import { describe, expect, it } from "vitest";
import { paginate, sortProducts } from "../../src/catalog/sort";
import { makeProduct } from "../helpers/products";

describe("sortProducts", () => {
  const products = [
    makeProduct({ id: 1, price: 100, rating: 4.0, discountPercentage: 0, title: "Banana" }),
    makeProduct({ id: 2, price: 50, rating: 4.9, discountPercentage: 50, title: "Apple" }),
    makeProduct({ id: 3, price: 200, rating: 3.1, discountPercentage: 10, title: "Cherry" }),
  ];

  it("sorts by effective (discounted) price ascending", () => {
    // id2: 50*0.5=25, id1: 100, id3: 200*0.9=180
    expect(sortProducts(products, "price", "asc").map((p) => p.id)).toEqual([2, 1, 3]);
  });

  it("sorts by rating descending ('best-rated')", () => {
    expect(sortProducts(products, "rating", "desc").map((p) => p.id)).toEqual([2, 1, 3]);
  });

  it("sorts by title ascending", () => {
    expect(sortProducts(products, "title", "asc").map((p) => p.title)).toEqual([
      "Apple",
      "Banana",
      "Cherry",
    ]);
  });

  it("does not mutate the input and preserves order with no field", () => {
    const copy = [...products];
    const result = sortProducts(products);
    expect(result.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(products).toEqual(copy);
  });
});

describe("paginate", () => {
  const items = [1, 2, 3, 4, 5, 6, 7];

  it("returns the first page", () => {
    expect(paginate(items, 3)).toEqual([1, 2, 3]);
  });

  it("returns a later page via skip", () => {
    expect(paginate(items, 3, 3)).toEqual([4, 5, 6]);
  });

  it("returns a partial last page", () => {
    expect(paginate(items, 3, 6)).toEqual([7]);
  });

  it("returns empty past the end", () => {
    expect(paginate(items, 3, 99)).toEqual([]);
  });
});
