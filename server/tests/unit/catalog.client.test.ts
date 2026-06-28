import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CatalogError,
  getCategories,
  getCategoryProducts,
  getProduct,
  searchProducts,
} from "../../src/catalog/client";
import { filterProducts } from "../../src/catalog/filter";
import { resolveCategorySlug } from "../../src/catalog/categories";
import { sortProducts } from "../../src/catalog/sort";
import { makeListResponse, makeProduct } from "../helpers/products";

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string | URL) => {
    calls.push(String(url));
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catalog client", () => {
  it("searchProducts hits /products/search with q + pagination and parses the envelope", async () => {
    const { calls } = mockFetchOnce(makeListResponse([makeProduct({ id: 7 })], 24));
    const res = await searchProducts("headphones", { limit: 5, skip: 10 });

    expect(res.total).toBe(24);
    expect(res.products[0]?.id).toBe(7);
    const url = new URL(calls[0]!);
    expect(url.pathname).toBe("/products/search");
    expect(url.searchParams.get("q")).toBe("headphones");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("skip")).toBe("10");
  });

  it("getCategoryProducts hits /products/category/{slug}", async () => {
    const { calls } = mockFetchOnce(makeListResponse([makeProduct()]));
    await getCategoryProducts("smartphones", { limit: 3 });
    const url = new URL(calls[0]!);
    expect(url.pathname).toBe("/products/category/smartphones");
    expect(url.searchParams.get("limit")).toBe("3");
  });

  it("getCategories parses the category list", async () => {
    mockFetchOnce([
      { slug: "smartphones", name: "smartphones", url: "x" },
      { slug: "laptops", name: "laptops", url: "y" },
    ]);
    const cats = await getCategories();
    expect(cats.map((c) => c.slug)).toEqual(["smartphones", "laptops"]);
  });

  it("getProduct parses a single product", async () => {
    mockFetchOnce(makeProduct({ id: 42, title: "Thing" }));
    const p = await getProduct(42);
    expect(p.id).toBe(42);
    expect(p.title).toBe("Thing");
  });

  it("throws CatalogError on a non-ok response", async () => {
    mockFetchOnce({}, { ok: false, status: 404 });
    await expect(getProduct(999)).rejects.toBeInstanceOf(CatalogError);
  });

  it("proves the §5 flow: 'phones under $500' → resolve slug → fetch category → filter + sort", async () => {
    // 1) categories → resolve "phones" to a real slug
    mockFetchOnce([{ slug: "smartphones", name: "smartphones" }]);
    const slug = resolveCategorySlug("phones", await getCategories());
    expect(slug).toBe("smartphones");

    // 2) fetch the category, then filter/sort client-side (no server-side price filter)
    mockFetchOnce(
      makeListResponse([
        makeProduct({ id: 1, price: 999, title: "Flagship" }),
        makeProduct({ id: 2, price: 299, title: "Mid" }),
        makeProduct({ id: 3, price: 199, title: "Budget" }),
      ]),
    );
    const { products } = await getCategoryProducts(slug!);
    const result = sortProducts(filterProducts(products, { maxPrice: 500 }), "price", "asc");

    expect(result.map((p) => p.id)).toEqual([3, 2]);
  });
});
