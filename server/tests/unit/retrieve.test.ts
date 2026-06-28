import { describe, expect, it, vi } from "vitest";
import type { CatalogDeps } from "../../src/pipeline/retrieve";
import { runRetrieve } from "../../src/pipeline/retrieve";
import { makeListResponse, makeProduct } from "../helpers/products";

function depsWith(overrides: Partial<CatalogDeps> = {}): CatalogDeps {
  return {
    searchProducts: vi.fn(async () => makeListResponse([])),
    getCategoryProducts: vi.fn(async () => makeListResponse([])),
    getCategories: vi.fn(async () => [{ slug: "smartphones", name: "smartphones" }]),
    ...overrides,
  };
}

describe("runRetrieve", () => {
  it("retrieves nothing for non-product branches", async () => {
    const deps = depsWith();
    const state = await runRetrieve({ kind: "chitchat" }, deps);
    expect(state).toEqual({ kind: "chitchat", results: [], notes: [] });
    expect(deps.searchProducts).not.toHaveBeenCalled();
  });

  it("searches by keyword, then filters + sorts + paginates client-side", async () => {
    const deps = depsWith({
      searchProducts: vi.fn(async () =>
        makeListResponse([
          makeProduct({ id: 1, price: 999, title: "Flagship" }),
          makeProduct({ id: 2, price: 299, title: "Mid" }),
          makeProduct({ id: 3, price: 199, title: "Budget" }),
        ]),
      ),
    });

    const state = await runRetrieve(
      { kind: "product", intents: [{ label: "cheap phone", keywords: "phone", maxPrice: 500, sort: { field: "price", order: "asc" } }] },
      deps,
      { limit: 5 },
    );

    expect(state.kind).toBe("product");
    expect(state.results).toHaveLength(1);
    expect(state.results[0]?.products.map((p) => p.id)).toEqual([3, 2]);
    expect(state.notes).toHaveLength(0);
  });

  it("relaxes a too-tight price ceiling and names the constraint + found value (US-4.4)", async () => {
    const deps = depsWith({
      searchProducts: vi.fn(async () =>
        makeListResponse([
          makeProduct({ id: 1, price: 100, title: "A" }),
          makeProduct({ id: 2, price: 150, title: "B" }),
        ]),
      ),
    });

    const state = await runRetrieve(
      { kind: "product", intents: [{ label: "phone under $50", maxPrice: 50 }] },
      deps,
    );

    expect(state.results[0]?.products.length).toBeGreaterThan(0);
    expect(state.notes[0]).toContain("$50");
    expect(state.notes[0]).toContain("$100"); // the cheapest actually available
  });

  it("resolves a category term to a slug and browses the category", async () => {
    const getCategoryProducts = vi.fn(async () => makeListResponse([makeProduct({ id: 7 })]));
    const deps = depsWith({ getCategoryProducts });

    const state = await runRetrieve(
      { kind: "product", intents: [{ label: "phones", category: "phones" }] },
      deps,
    );

    expect(getCategoryProducts).toHaveBeenCalledWith("smartphones", expect.anything());
    expect(state.results[0]?.products[0]?.id).toBe(7);
  });

  it("handles multiple intents independently (multi-intent, US-1.3)", async () => {
    const deps = depsWith({
      searchProducts: vi.fn(async (q: string) =>
        makeListResponse([makeProduct({ id: q === "phone" ? 1 : 2, title: q })]),
      ),
    });

    const state = await runRetrieve(
      {
        kind: "product",
        intents: [
          { label: "a phone", keywords: "phone" },
          { label: "a laptop bag", keywords: "bag" },
        ],
      },
      deps,
    );

    expect(state.results).toHaveLength(2);
    expect(state.results.map((r) => r.intent)).toEqual(["a phone", "a laptop bag"]);
  });
});
