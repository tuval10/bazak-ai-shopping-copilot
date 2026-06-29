import { describe, expect, it, vi } from "vitest";
import { type CatalogDeps, fetchForIntent, filtersFor } from "../../src/pipeline/retrieve";
import { makeListResponse, makeProduct } from "../helpers/products";

/**
 * Unit tests for the retrieval primitives the budgeted discovery loop reuses:
 * `fetchForIntent` (endpoint selection — keyword search vs category browse) and
 * `filtersFor` (intent → catalog filter mapping). The relaxation/notes behavior
 * that used to live in `runRetrieve` is now the discovery agent's job and is
 * covered in `evals/agentic-flow.test.ts`.
 */

function depsWith(overrides: Partial<CatalogDeps> = {}): CatalogDeps {
  return {
    searchProducts: vi.fn(async () => makeListResponse([])),
    getCategoryProducts: vi.fn(async () => makeListResponse([])),
    getCategories: vi.fn(async () => [{ slug: "smartphones", name: "smartphones" }]),
    ...overrides,
  };
}

describe("fetchForIntent", () => {
  it("searches by keyword when no category is given", async () => {
    const searchProducts = vi.fn(async () =>
      makeListResponse([makeProduct({ id: 1 }), makeProduct({ id: 2 })]),
    );
    const products = await fetchForIntent(
      { label: "cheap phone", keywords: "phone" },
      depsWith({ searchProducts }),
      [],
      100,
    );
    expect(searchProducts).toHaveBeenCalledWith("phone", { limit: 100 });
    expect(products.map((p) => p.id)).toEqual([1, 2]);
  });

  it("falls back to the label as the query when keywords are absent", async () => {
    const searchProducts = vi.fn(async () => makeListResponse([]));
    await fetchForIntent({ label: "sunglasses" }, depsWith({ searchProducts }), [], 50);
    expect(searchProducts).toHaveBeenCalledWith("sunglasses", { limit: 50 });
  });

  it("resolves a category term to a slug and browses the category (US-1.6)", async () => {
    const getCategoryProducts = vi.fn(async () => makeListResponse([makeProduct({ id: 7 })]));
    const categories = [{ slug: "smartphones", name: "smartphones" }];
    const products = await fetchForIntent(
      { label: "phones", category: "phones" },
      depsWith({ getCategoryProducts }),
      categories,
      100,
    );
    expect(getCategoryProducts).toHaveBeenCalledWith("smartphones", { limit: 100 });
    expect(products[0]?.id).toBe(7);
  });
});

describe("filtersFor", () => {
  it("maps an intent's constraints onto the catalog filter shape", () => {
    const filters = filtersFor({
      label: "x",
      minPrice: 10,
      maxPrice: 100,
      minRating: 4,
      brands: ["Apple"],
      inStockOnly: true,
      onSaleOnly: false,
    });
    expect(filters).toEqual({
      minPrice: 10,
      maxPrice: 100,
      minRating: 4,
      brands: ["Apple"],
      inStockOnly: true,
      onSaleOnly: false,
    });
  });
});
