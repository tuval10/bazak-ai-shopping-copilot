import type { WorkflowInput } from "@bazak/shared";
import { describe, expect, it, vi } from "vitest";
import { generateChips } from "../../src/pipeline/chips";
import { buildSupervisorSystem, runConverse, type ThreadContext } from "../../src/pipeline/converse";
import type { CatalogDeps } from "../../src/pipeline/retrieve";
import { passthroughFinder, type ScriptedFind, scriptedSupervisor } from "../helpers/finder";
import { makeProduct, makeListResponse } from "../helpers/products";

/**
 * Evals for the supervisor turn (D15): the supervisor agent drives `find_products`,
 * which runs the real finder + assembly path against a mocked catalog. Asserts the
 * deterministic guarantees: grounding (cards emitted by code, by id), the direct-answer
 * path (no finder calls), the provable finder cap, continuation dedup, and chips.
 */

const CATS = [{ slug: "smartphones", name: "smartphones" }];
const input: WorkflowInput = { message: "phones", threadId: "t", resourceId: "local-user" };

function catalog(
  products = [makeProduct({ id: 1 }), makeProduct({ id: 2 }), makeProduct({ id: 3 })],
): CatalogDeps {
  return {
    searchProducts: vi.fn(async () => makeListResponse(products)),
    getCategoryProducts: vi.fn(async () => makeListResponse(products)),
    getCategories: vi.fn(async () => CATS),
  };
}

/** A catalog that returns DIFFERENT products per keyword — so distinct finders surface
 * distinct inventory (cross-finder dedup would otherwise collapse identical results). */
function catalogByKeyword(map: Record<string, ReturnType<typeof makeProduct>[]>): CatalogDeps {
  return {
    searchProducts: vi.fn(async (q: string) => makeListResponse(map[q] ?? [])),
    getCategoryProducts: vi.fn(async () => makeListResponse([])),
    getCategories: vi.fn(async () => CATS),
  };
}

/** Run one supervisor turn with a scripted supervisor + the real finder/assembly path. */
function runTurn(opts: {
  script: (find: ScriptedFind, message: string) => Promise<string>;
  deps?: CatalogDeps;
  context?: ThreadContext;
  turn?: WorkflowInput;
  maxFinders?: number;
}) {
  const parts: Array<{ type: string; [k: string]: unknown }> = [];
  const supervisor = scriptedSupervisor(opts.script);
  return runConverse({
    input: opts.turn ?? input,
    supervisor,
    finderAgent: passthroughFinder(),
    categories: CATS,
    context: opts.context ?? { shownIds: [], priorProducts: [] },
    deps: opts.deps ?? catalog(),
    writer: { custom: (d) => void parts.push(d) },
    maxFinders: opts.maxFinders ?? 5,
    finderMaxSteps: 4,
    supervisorMaxSteps: 8,
  }).then((result) => ({
    result,
    parts,
    supervisor,
    productParts: parts.filter((p) => p.type === "data-product-results"),
  }));
}

describe("converse — supervisor loop + grounding", () => {
  it("one find_products call → one grounded card streamed + accumulated by id", async () => {
    const { result, productParts } = await runTurn({
      deps: catalog([makeProduct({ id: 1 }), makeProduct({ id: 2 }), makeProduct({ id: 3 })]),
      script: async (find) => {
        await find({ label: "phones", keywords: "phone" });
        return "Here are some phones.";
      },
    });
    expect(productParts).toHaveLength(1);
    expect(result.results[0]?.products.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(result.message).toBe("Here are some phones.");
    expect(result.finders).toHaveLength(1); // recorded for persistence
  });

  it("multi-intent → one find_products call per angle, grouped", async () => {
    const { result, productParts } = await runTurn({
      deps: catalogByKeyword({ phone: [makeProduct({ id: 1 })], bag: [makeProduct({ id: 2 })] }),
      script: async (find) => {
        await find({ label: "a phone", keywords: "phone" });
        await find({ label: "a bag", keywords: "bag" });
        return "A phone and a bag:";
      },
    });
    expect(productParts).toHaveLength(2);
    expect(result.results.map((r) => r.intent)).toEqual(["a phone", "a bag"]);
  });

  it("DIRECT ANSWER → no find_products call → no cards, prose only (which do you recommend?)", async () => {
    const { result, productParts } = await runTurn({
      turn: { message: "which one do you recommend?", threadId: "t", resourceId: "local-user" },
      context: {
        shownIds: [1, 2, 3],
        priorProducts: [{ id: 1, title: "Phone A", price: 200, rating: 4.5 }],
      },
      script: async () => "I'd go with Phone A — best value.", // never calls find
    });
    expect(productParts).toHaveLength(0);
    expect(result.results).toEqual([]);
    expect(result.message).toContain("Phone A");
    expect(result.chips).toEqual([]); // no products → no chips
  });

  it("hard finder cap → only MAX_PRODUCT_FINDERS finders run regardless of calls", async () => {
    let limitHits = 0;
    const { result, productParts } = await runTurn({
      maxFinders: 2,
      // Distinct inventory per call so the cap (not dedup) is what limits results.
      deps: catalogByKeyword({
        k0: [makeProduct({ id: 1 })],
        k1: [makeProduct({ id: 2 })],
        k2: [makeProduct({ id: 3 })],
        k3: [makeProduct({ id: 4 })],
      }),
      script: async (find) => {
        for (let i = 0; i < 4; i++) {
          const r = await find({ label: `f${i}`, keywords: `k${i}` });
          if (r.limitReached) limitHits++;
        }
        return "done";
      },
    });
    expect(productParts).toHaveLength(2); // only 2 finders ran + streamed
    expect(result.results).toHaveLength(2);
    expect(limitHits).toBe(2); // the 3rd + 4th calls were refused
  });

  it("continuation → already-shown ids excluded from the streamed group (no repeats)", async () => {
    const { result } = await runTurn({
      deps: catalog([1, 2, 3, 4, 5, 6].map((id) => makeProduct({ id }))),
      context: { shownIds: [1, 2, 3], priorProducts: [] },
      script: async (find) => {
        await find({ label: "phones", keywords: "phone", sort: { field: "price", order: "asc" } });
        return "More phones:";
      },
    });
    const ids = result.results.flatMap((r) => r.products.map((p) => p.id));
    expect(ids).toEqual([4, 5, 6]); // pages past the already-shown 1-3
  });

  it("off-catalog → supervisor merchandises adjacent finders + declines in prose", async () => {
    const { result, productParts } = await runTurn({
      turn: { message: "a flight to Tokyo", threadId: "t", resourceId: "local-user" },
      deps: catalogByKeyword({ bag: [makeProduct({ id: 1 })], headphones: [makeProduct({ id: 2 })] }),
      script: async (find) => {
        await find({ label: "travel bag", keywords: "bag", category: "smartphones", brief: "flying to Tokyo" });
        await find({ label: "headphones", keywords: "headphones", brief: "for the flight" });
        return "I can't book a flight, but for the trip these might help.";
      },
    });
    expect(productParts).toHaveLength(2); // adjacent products still merchandised
    expect(result.message).toMatch(/can't book|can't fulfil|for the trip/i);
  });
});

describe("converse — supervisor context wiring", () => {
  it("passes thread memory + a system message carrying the category slugs", async () => {
    const { supervisor } = await runTurn({ script: async () => "hi" });
    const [, options] = (supervisor.generate as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(options.memory).toEqual({ thread: "t", resource: "local-user" });
    expect(options.system).toContain("smartphones"); // real slug injected
    expect(options.maxSteps).toBe(8);
  });

  it("buildSupervisorSystem surfaces categories + previously-shown products, else undefined", () => {
    const sys = buildSupervisorSystem("smartphones — smartphones (16 items)", [
      { id: 7, title: "Phone X", price: 300, brand: "Acme", rating: 4.2 },
    ]);
    expect(sys).toContain("smartphones — smartphones (16 items)");
    expect(sys).toContain("#7 Phone X ($300, Acme, 4.2★)");
    expect(buildSupervisorSystem("", [])).toBeUndefined();
  });
});

describe("chips", () => {
  it("abundant results → filter chips with data-grounded options", async () => {
    const state = {
      kind: "product" as const,
      results: [
        {
          intent: "phones",
          products: [
            makeProduct({ id: 1, price: 50, brand: "Apple" }),
            makeProduct({ id: 2, price: 800, brand: "Samsung" }),
            makeProduct({ id: 3, price: 400, brand: "Apple" }),
          ],
        },
      ],
      notes: [],
    };
    const chips = await generateChips({ state, message: "phones" });
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.some((c) => /under \$\d/i.test(c.label))).toBe(true);
  });

  it("pure chit-chat / no products gets no chips", async () => {
    const chips = await generateChips({
      state: { kind: "chitchat", results: [], notes: [] },
      message: "hi",
    });
    expect(chips).toEqual([]);
  });
});
