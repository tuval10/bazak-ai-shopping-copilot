import type { ProductResultsPart } from "@bazak/shared";
import { describe, expect, it, vi } from "vitest";
import { runFindProducts, type FindProductsToolOptions } from "../../src/mastra/tools/find-products";
import type { CatalogDeps } from "../../src/pipeline/retrieve";
import { passthroughFinder } from "../helpers/finder";
import { makeListResponse, makeProduct } from "../helpers/products";

function catalog(products = [makeProduct({ id: 1 }), makeProduct({ id: 2 })]): CatalogDeps {
  return {
    searchProducts: vi.fn(async () => makeListResponse(products)),
    getCategoryProducts: vi.fn(async () => makeListResponse(products)),
    getCategories: vi.fn(async () => [{ slug: "smartphones", name: "smartphones" }]),
  };
}

function opts(over: Partial<FindProductsToolOptions> = {}): FindProductsToolOptions {
  const parts: Array<{ type: string; [k: string]: unknown }> = [];
  const base: FindProductsToolOptions = {
    writer: { custom: (d) => void parts.push(d) },
    deps: catalog(),
    categories: [{ slug: "smartphones", name: "smartphones" }],
    finderAgent: passthroughFinder(),
    exclude: new Set<number>(),
    accumulator: [] as ProductResultsPart[],
    usedFinders: [],
    counter: { count: 0 },
    maxFinders: 5,
    finderMaxSteps: 4,
    stepCounter: { count: 0 },
    maxSteps: 8,
    ...over,
  };
  // stash parts for assertions
  (base as FindProductsToolOptions & { _parts: typeof parts })._parts = parts;
  return base;
}

describe("find_products tool core (runFindProducts)", () => {
  it("runs the finder, streams a grounded card, accumulates, and returns a lean narrative", async () => {
    const o = opts({ deps: catalog([makeProduct({ id: 1 }), makeProduct({ id: 2 }), makeProduct({ id: 3 })]) });
    const parts = (o as FindProductsToolOptions & { _parts: Array<{ type: string }> })._parts;

    const out = await runFindProducts({ label: "phones", keywords: "phone" }, o);

    expect(out.found).toBe(3);
    expect(out.groups[0]?.products.map((p) => p.id)).toEqual([1, 2, 3]); // grounded by id
    expect(parts.filter((p) => p.type === "data-product-results")).toHaveLength(1); // card streamed
    expect(o.accumulator).toHaveLength(1); // accumulated for the turn's results
    expect(o.counter.count).toBe(1); // counted against the cap
    expect(o.usedFinders).toHaveLength(1); // recorded for persistence/continuation
  });

  it("hard-stops at the finder cap — extra calls run no finder and stream no card", async () => {
    const o = opts({ maxFinders: 1 });
    const parts = (o as FindProductsToolOptions & { _parts: Array<{ type: string }> })._parts;

    const first = await runFindProducts({ label: "a", keywords: "phone" }, o);
    const second = await runFindProducts({ label: "b", keywords: "phone" }, o);

    expect(first.limitReached).toBeUndefined();
    expect(second.limitReached).toBe(true);
    expect(o.counter.count).toBe(1); // the over-limit call never incremented / ran
    expect(parts.filter((p) => p.type === "data-product-results")).toHaveLength(1); // only the first streamed
  });

  it("hard-stops at the step cap — counts EVERY call (incl. refused) and refuses past it", async () => {
    // maxSteps below maxFinders so the STEP cap is what bites: each call counts as a step.
    // Distinct inventory per call so dedup (not the cap) doesn't suppress the 2nd card.
    const byKeyword: Record<string, ReturnType<typeof makeProduct>[]> = {
      a: [makeProduct({ id: 1 })],
      b: [makeProduct({ id: 2 })],
      c: [makeProduct({ id: 3 })],
    };
    const deps: CatalogDeps = {
      searchProducts: vi.fn(async (q: string) => makeListResponse(byKeyword[q] ?? [])),
      getCategoryProducts: vi.fn(async () => makeListResponse([])),
      getCategories: vi.fn(async () => [{ slug: "smartphones", name: "smartphones" }]),
    };
    const o = opts({ maxSteps: 2, maxFinders: 10, deps });
    const parts = (o as FindProductsToolOptions & { _parts: Array<{ type: string }> })._parts;

    const a = await runFindProducts({ label: "a", keywords: "a" }, o);
    const b = await runFindProducts({ label: "b", keywords: "b" }, o);
    const c = await runFindProducts({ label: "c", keywords: "c" }, o);

    expect(a.limitReached).toBeUndefined();
    expect(b.limitReached).toBeUndefined();
    expect(c.limitReached).toBe(true); // 3rd call is past the 2-step ceiling
    expect(o.stepCounter.count).toBe(2); // the refused call never incremented
    expect(o.counter.count).toBe(2); // only the two allowed calls ran a finder
    expect(parts.filter((p) => p.type === "data-product-results")).toHaveLength(2);
  });

  it("the step cap counts refused finder-cap calls too (a refusal is still a step)", async () => {
    // maxFinders=1 so call 2 is refused by the finder cap — but it still spends a step.
    const o = opts({ maxFinders: 1, maxSteps: 5 });

    await runFindProducts({ label: "a", keywords: "phone" }, o); // step 1, finder 1
    const refused = await runFindProducts({ label: "b", keywords: "phone" }, o); // step 2, finder-capped

    expect(refused.limitReached).toBe(true);
    expect(o.stepCounter.count).toBe(2); // both calls consumed a step
    expect(o.counter.count).toBe(1); // only the first ran a finder
  });

  it("excludes already-shown ids and grows the shared exclude set (dedup across calls)", async () => {
    const exclude = new Set<number>([1, 2, 3]);
    const o = opts({
      exclude,
      deps: catalog([1, 2, 3, 4, 5].map((id) => makeProduct({ id }))),
    });
    const out = await runFindProducts({ label: "phones", keywords: "phone" }, o);
    const ids = out.groups.flatMap((g) => g.products.map((p) => p.id));
    expect(ids).toEqual([4, 5]); // 1-3 already shown → excluded
    expect([...exclude].sort()).toEqual([1, 2, 3, 4, 5]); // set grew with the new ids
  });
});
