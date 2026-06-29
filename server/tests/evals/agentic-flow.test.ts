import { describe, expect, it, vi } from "vitest";
import type { OrchestrationPlan } from "../../src/pipeline/classification";
import { generateChips } from "../../src/pipeline/chips";
import {
  type DiscoveryPlan,
  type StructuredDiscovery,
  runDiscovery,
} from "../../src/pipeline/discovery";
import { summarizeForPrompt } from "../../src/pipeline/generate";
import { runOrchestrate, type StructuredOrchestrator } from "../../src/pipeline/orchestrate";
import type { CatalogDeps } from "../../src/pipeline/retrieve";
import { makeListResponse, makeProduct } from "../helpers/products";

/**
 * Evals for the agentic flow (orchestrator → budgeted discovery → chips). Drives the
 * real planning/retrieval functions with faked agents + a mocked catalog, asserting
 * the deterministic guarantees the interview will probe: the finder cap, soft vs hard
 * relaxation, the per-finder call budget, and data-grounded chips.
 */

const fakeOrchestrator = (plan: OrchestrationPlan): StructuredOrchestrator => ({
  generate: vi.fn(async () => ({ object: plan })),
});
const fakeDiscovery = (plan: DiscoveryPlan): StructuredDiscovery => ({
  generate: vi.fn(async () => ({ object: plan })),
});
function catalog(products = [makeProduct()], overrides: Partial<CatalogDeps> = {}): CatalogDeps {
  return {
    searchProducts: vi.fn(async () => makeListResponse(products)),
    getCategoryProducts: vi.fn(async () => makeListResponse(products)),
    getCategories: vi.fn(async () => [{ slug: "smartphones", name: "smartphones" }]),
    ...overrides,
  };
}

describe("orchestrate — planning + finder cap", () => {
  it("caps finders to MAX_PRODUCT_FINDERS regardless of what the model proposes", async () => {
    const finders = Array.from({ length: 8 }, (_, i) => ({ label: `f${i}`, keywords: `k${i}` }));
    const plan = await runOrchestrate("msg", fakeOrchestrator({ kind: "product", finders }), {
      maxFinders: 5,
    });
    expect(plan.finders).toHaveLength(5);
  });

  it("backfills one finder from the raw message for a product turn with none", async () => {
    const plan = await runOrchestrate(
      "something cool",
      fakeOrchestrator({ kind: "product", finders: [] }),
    );
    expect(plan.finders).toHaveLength(1);
    expect(plan.finders[0]?.keywords).toBe("something cool");
  });

  it("passes a continuation through untouched — no backfill, flag preserved", async () => {
    // "show me more" → continuation:true with no finders. Must NOT be backfilled
    // into a literal "show me more" finder (discovery reuses the prior finder).
    const plan = await runOrchestrate(
      "show me more",
      fakeOrchestrator({ kind: "product", finders: [], continuation: true }),
    );
    expect(plan.continuation).toBe(true);
    expect(plan.finders).toHaveLength(0);
  });
});

describe("discovery — strong vs weak", () => {
  it("strong focused result → one group, no relaxation, discovery agent never called", async () => {
    const deps = catalog([makeProduct({ id: 1 }), makeProduct({ id: 2 }), makeProduct({ id: 3 })]);
    const discovery = fakeDiscovery({ axes: [] });
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "phones", keywords: "phone" }] },
      deps,
      discovery,
      { maxCalls: 10 },
    );
    expect(state.results).toHaveLength(1);
    expect(state.results[0]?.relaxed).toBeUndefined();
    expect(discovery.generate).not.toHaveBeenCalled();
  });

  it("weak + SOFT maxPrice → relaxed group naming the constraint + the real value (US-4.4)", async () => {
    // Nothing under $100; cheapest available is $110.
    const deps = catalog([
      makeProduct({ id: 1, price: 110 }),
      makeProduct({ id: 2, price: 140 }),
    ]);
    const discovery = fakeDiscovery({
      axes: [{ drop: "maxPrice", sort: { field: "price", order: "asc" }, rationale: "closest just above budget" }],
    });
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "wireless under $100", keywords: "wireless", maxPrice: 100 }] },
      deps,
      discovery,
      { maxCalls: 10 },
    );
    const relaxed = state.results.find((r) => r.relaxed);
    expect(relaxed).toBeDefined();
    expect(relaxed?.relaxed?.constraint).toBe("maxPrice");
    expect(relaxed?.relaxed?.from).toContain("100");
    expect(relaxed?.relaxed?.to).toContain("110"); // the actual cheapest found
    expect(relaxed?.products.length).toBeGreaterThan(0);
    expect(relaxed?.rationale).toBeTruthy();
  });

  it("HARD maxPrice ('strictly under $100') is never relaxed → empty → decline", async () => {
    const deps = catalog([makeProduct({ id: 1, price: 110 }), makeProduct({ id: 2, price: 130 })]);
    // Even if the agent tries to drop maxPrice, code re-validates it out.
    const discovery = fakeDiscovery({ axes: [{ drop: "maxPrice", rationale: "tries to relax" }] });
    const state = await runDiscovery(
      {
        kind: "product",
        finders: [
          { label: "strictly under $100", keywords: "headphones", maxPrice: 100, hardConstraints: ["maxPrice"] },
        ],
      },
      deps,
      discovery,
      { maxCalls: 10 },
    );
    expect(state.results).toHaveLength(0); // no group breached the hard cap
  });
});

describe("discovery — budget enforcement", () => {
  it("a finder makes at most DISCOVERY_MAX_CALLS catalog calls", async () => {
    const searchProducts = vi.fn(async () => makeListResponse([])); // always empty → keeps trying
    const deps = catalog([], { searchProducts });
    const discovery = fakeDiscovery({
      axes: [
        { keywords: "a", rationale: "a" },
        { keywords: "b", rationale: "b" },
        { keywords: "c", rationale: "c" },
        { keywords: "d", rationale: "d" },
      ],
    });
    await runDiscovery(
      { kind: "product", finders: [{ label: "x", keywords: "x" }] },
      deps,
      discovery,
      { maxCalls: 2 },
    );
    // focused (1) + at most one keyword axis (1) = 2; budget stops the rest.
    expect(searchProducts.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("per-turn ceiling holds: finders × maxCalls bounds total catalog calls", async () => {
    const searchProducts = vi.fn(async () => makeListResponse([]));
    const deps = catalog([], { searchProducts });
    const discovery = fakeDiscovery({
      axes: [
        { keywords: "a", rationale: "a" },
        { keywords: "b", rationale: "b" },
      ],
    });
    const finders = [
      { label: "f1", keywords: "k1" },
      { label: "f2", keywords: "k2" },
      { label: "f3", keywords: "k3" },
    ];
    await runDiscovery({ kind: "product", finders }, deps, discovery, { maxCalls: 10 });
    expect(searchProducts.mock.calls.length).toBeLessThanOrEqual(finders.length * 10);
  });
});

describe("discovery — continuation / show me more", () => {
  it("excludes already-shown ids and pages forward to the next products", async () => {
    // 8 phones, sorted by price asc → [1..8]. Turn 1 showed ids 1-5; "show me more"
    // reuses the finder and must return the NEXT page, no repeats.
    const products = Array.from({ length: 8 }, (_, i) =>
      makeProduct({ id: i + 1, price: (i + 1) * 10 }),
    );
    const deps = catalog(products);
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "phones", keywords: "phone", sort: { field: "price", order: "asc" } }] },
      deps,
      fakeDiscovery({ axes: [] }),
      { maxCalls: 10, limit: 5, excludeIds: [1, 2, 3, 4, 5] },
    );
    const ids = state.results.flatMap((r) => r.products.map((p) => p.id));
    expect(ids).toEqual([6, 7, 8]); // the next page, none of the already-shown 1-5
  });

  it("returns the finders it ran so the turn can persist them for the next continuation", async () => {
    const deps = catalog([makeProduct({ id: 1 }), makeProduct({ id: 2 }), makeProduct({ id: 3 })]);
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "phones", keywords: "phone", maxPrice: 500 }] },
      deps,
      fakeDiscovery({ axes: [] }),
      { maxCalls: 10 },
    );
    expect(state.finders).toHaveLength(1);
    expect(state.finders?.[0]?.keywords).toBe("phone");
    expect(state.finders?.[0]?.maxPrice).toBe(500); // the original constraint is preserved
  });

  it("yields no group when every matching product was already shown (exhausted)", async () => {
    const products = [makeProduct({ id: 1 }), makeProduct({ id: 2 }), makeProduct({ id: 3 })];
    const deps = catalog(products);
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "phones", keywords: "phone" }] },
      deps,
      fakeDiscovery({ axes: [] }),
      { maxCalls: 10, excludeIds: [1, 2, 3] },
    );
    expect(state.results).toHaveLength(0);
  });
});

describe("discovery — off-catalog merchandising", () => {
  it("retrieves adjacent finders for an off_catalog turn (still merchandises)", async () => {
    const deps = catalog([makeProduct({ id: 1 }), makeProduct({ id: 2 }), makeProduct({ id: 3 })]);
    const state = await runDiscovery(
      { kind: "off_catalog", finders: [{ label: "travel pillow", keywords: "travel pillow" }] },
      deps,
      fakeDiscovery({ axes: [] }),
      { maxCalls: 10 },
    );
    expect(state.kind).toBe("off_catalog");
    expect(state.results[0]?.products.length).toBeGreaterThan(0);
  });

  it("grounding prompt for off_catalog WITH results declines honestly but presents them", () => {
    const summary = summarizeForPrompt({
      kind: "off_catalog",
      results: [{ intent: "travel", products: [makeProduct()] }],
      notes: [],
    });
    expect(summary).toMatch(/don't claim|adjacent|keep searching/i);
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
    expect(chips.some((c) => /under \$\d/i.test(c.label))).toBe(true); // price band from real data
  });

  it("weak/off-catalog → deterministic follow-up chips when no agent", async () => {
    const chips = await generateChips({
      state: { kind: "off_catalog", results: [{ intent: "flight", products: [makeProduct()] }], notes: [] },
      message: "flight to tokyo",
    });
    expect(chips.length).toBeGreaterThan(0);
  });

  it("falls back deterministically when the chip agent output is unparseable", async () => {
    const badAgent = { generate: vi.fn(async () => ({ object: { not: "chips" } })) };
    const chips = await generateChips({
      state: { kind: "product", results: [], notes: [] },
      message: "xyzzy",
      agent: badAgent,
    });
    expect(chips.length).toBeGreaterThan(0); // never throws; deterministic fallback
  });

  it("pure chit-chat gets no chips", async () => {
    const chips = await generateChips({
      state: { kind: "chitchat", results: [], notes: [] },
      message: "hi",
    });
    expect(chips).toEqual([]);
  });
});
