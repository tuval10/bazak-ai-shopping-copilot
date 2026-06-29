import type { Product } from "@bazak/shared";
import { describe, expect, it, vi } from "vitest";
import { runCategoryBrowse, runProductSearch } from "../../src/mastra/tools/search-products";
import { makeListResponse, makeProduct } from "../helpers/products";

describe("product_search tool core (runProductSearch)", () => {
  it("applies the agent's filters inside the tool and returns match counts", async () => {
    const search = vi.fn(async () =>
      makeListResponse([
        makeProduct({ id: 1, price: 50 }),
        makeProduct({ id: 2, price: 150 }),
        makeProduct({ id: 3, price: 90 }),
      ]),
    );
    const registry = new Map<number, Product>();
    const out = await runProductSearch({ keywords: "x", maxPrice: 100 }, { registry, search });

    expect(out.fetched).toBe(3);
    expect(out.matched).toBe(2); // 50 + 90 are under $100
    expect(out.cheapest).toBe(50);
    expect(out.products.map((p) => p.id).sort()).toEqual([1, 3]);
  });

  it("captures returned products into the grounding registry by id", async () => {
    const search = vi.fn(async () => makeListResponse([makeProduct({ id: 7 }), makeProduct({ id: 8 })]));
    const registry = new Map<number, Product>();
    await runProductSearch({ keywords: "x" }, { registry, search });
    expect([...registry.keys()].sort()).toEqual([7, 8]);
    expect(registry.get(7)?.id).toBe(7);
  });

  it("enforces hard constraints regardless of the agent's filters", async () => {
    // Agent passes NO maxPrice, but the finder's hard cap is $100.
    const search = vi.fn(async () =>
      makeListResponse([makeProduct({ id: 1, price: 80 }), makeProduct({ id: 2, price: 200 })]),
    );
    const registry = new Map<number, Product>();
    const out = await runProductSearch(
      { keywords: "x" },
      { registry, search, enforcedFilters: { maxPrice: 100 } },
    );
    expect(out.products.map((p) => p.id)).toEqual([1]); // $200 never surfaces
  });

  it("sorts and pages to the requested limit", async () => {
    const search = vi.fn(async () =>
      makeListResponse([
        makeProduct({ id: 1, price: 30 }),
        makeProduct({ id: 2, price: 10 }),
        makeProduct({ id: 3, price: 20 }),
      ]),
    );
    const registry = new Map<number, Product>();
    const out = await runProductSearch(
      { keywords: "x", sort: { field: "price", order: "asc" }, limit: 2 },
      { registry, search },
    );
    expect(out.products.map((p) => p.id)).toEqual([2, 3]); // cheapest two, in order
  });
});

describe("category_browse tool core (runCategoryBrowse)", () => {
  const categories = [
    { slug: "laptops", name: "laptops" },
    { slug: "mobile-accessories", name: "mobile accessories" },
  ];

  it("browses the category slug and applies filters inside the tool", async () => {
    const browse = vi.fn(async () =>
      makeListResponse([makeProduct({ id: 1, price: 50 }), makeProduct({ id: 2, price: 200 })]),
    );
    const registry = new Map<number, Product>();
    const out = await runCategoryBrowse(
      { category: "laptops", maxPrice: 100 },
      { registry, browse, categories },
    );

    expect(browse).toHaveBeenCalledWith("laptops", { limit: 100 });
    expect(out.products.map((p) => p.id)).toEqual([1]); // $200 filtered out
    expect([...registry.keys()]).toEqual([1]); // grounding capture
  });

  it("resolves a display name / fuzzy term to a real slug before browsing", async () => {
    const browse = vi.fn(async () => makeListResponse([makeProduct({ id: 9 })]));
    const registry = new Map<number, Product>();
    await runCategoryBrowse({ category: "mobile accessories" }, { registry, browse, categories });
    expect(browse).toHaveBeenCalledWith("mobile-accessories", { limit: 100 });
  });

  it("enforces hard constraints regardless of the agent's filters", async () => {
    const browse = vi.fn(async () =>
      makeListResponse([makeProduct({ id: 1, price: 80 }), makeProduct({ id: 2, price: 200 })]),
    );
    const registry = new Map<number, Product>();
    const out = await runCategoryBrowse(
      { category: "laptops" },
      { registry, browse, categories, enforcedFilters: { maxPrice: 100 } },
    );
    expect(out.products.map((p) => p.id)).toEqual([1]); // $200 never surfaces
  });
});
