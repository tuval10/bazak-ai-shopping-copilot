import { describe, expect, it, vi } from "vitest";
import type { OrchestrationPlan } from "../../src/pipeline/classification";
import { generateChips } from "../../src/pipeline/chips";
import { type AgenticFinder, runDiscovery } from "../../src/pipeline/discovery";
import { summarizeForPrompt } from "../../src/pipeline/generate";
import {
  buildOrchestratePrompt,
  runOrchestrate,
  type StructuredOrchestrator,
} from "../../src/pipeline/orchestrate";
import type { CatalogDeps } from "../../src/pipeline/retrieve";
import { scriptedFinder } from "../helpers/finder";
import { makeListResponse, makeProduct } from "../helpers/products";

/**
 * Evals for the agentic flow (orchestrator → agentic finder → chips). Drives the
 * real planning/retrieval functions with faked agents + a mocked catalog, asserting
 * the deterministic guarantees the interview will probe: the finder cap, grounding
 * (id → real product), hard-constraint enforcement, dedup/continuation, and chips.
 */

const fakeOrchestrator = (plan: OrchestrationPlan): StructuredOrchestrator => ({
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

  it("injects the catalog category list into the orchestrator prompt", async () => {
    const orchestrator = fakeOrchestrator({ kind: "product", finders: [] });
    await runOrchestrate("flight to tokyo", orchestrator, {
      categoryList: "smartphones — smartphones\nsunglasses — sunglasses",
    });
    const [prompt] = (orchestrator.generate as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(prompt).toContain("CATALOG CATEGORIES");
    expect(prompt).toContain("sunglasses — sunglasses");
    expect(prompt).toContain("flight to tokyo");
  });

  it("buildOrchestratePrompt returns the bare message with no context/categories", () => {
    expect(buildOrchestratePrompt("hello")).toBe("hello");
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

describe("discovery — agentic finder grounding", () => {
  it("focused search → one group of REAL products resolved by id (grounding)", async () => {
    const deps = catalog([makeProduct({ id: 1 }), makeProduct({ id: 2 }), makeProduct({ id: 3 })]);
    const finder = scriptedFinder(async (search) => {
      const r = await search({ keywords: "phone" });
      return { groups: [{ intent: "phones", productIds: r.products.map((p) => p.id) }] };
    });
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "phones", keywords: "phone" }] },
      deps,
      finder,
    );
    expect(state.results).toHaveLength(1);
    expect(state.results[0]?.products.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(state.results[0]?.relaxed).toBeUndefined();
  });

  it("category_browse → group of REAL products resolved by id (browse-tool grounding)", async () => {
    const deps = catalog([makeProduct({ id: 4 }), makeProduct({ id: 5 })], {
      getCategories: vi.fn(async () => [{ slug: "laptops", name: "laptops" }]),
    });
    // The finder ignores keyword search and browses the whole category slug instead.
    const finder = scriptedFinder(async (_search, _finder, browse) => {
      const r = await browse({ category: "laptops" });
      return { groups: [{ intent: "laptops", productIds: r.products.map((p) => p.id) }] };
    });
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "laptops", category: "laptops" }] },
      deps,
      finder,
    );
    expect(deps.getCategoryProducts).toHaveBeenCalledWith("laptops", expect.anything());
    expect(state.results[0]?.products.map((p) => p.id)).toEqual([4, 5]);
  });

  it("ids the search never returned are dropped (no hallucinated products)", async () => {
    const deps = catalog([makeProduct({ id: 1 }), makeProduct({ id: 2 })]);
    const finder = scriptedFinder(async (search) => {
      await search({ keywords: "phone" }); // registry now holds 1, 2
      return { groups: [{ intent: "phones", productIds: [1, 2, 999] }] }; // 999 was never returned
    });
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "phones", keywords: "phone" }] },
      deps,
      finder,
    );
    expect(state.results[0]?.products.map((p) => p.id)).toEqual([1, 2]); // 999 dropped
  });

  it("a relaxed SOFT maxPrice → group names the constraint + the real value (US-4.4)", async () => {
    // Nothing under $100; cheapest available is $110. The finder drops the soft ceiling.
    const deps = catalog([makeProduct({ id: 1, price: 110 }), makeProduct({ id: 2, price: 140 })]);
    const finder = scriptedFinder(async (search) => {
      const focused = await search({ keywords: "wireless", maxPrice: 100 }); // 0 matched
      expect(focused.matched).toBe(0);
      const relaxed = await search({ keywords: "wireless", sort: { field: "price", order: "asc" } });
      return {
        groups: [
          {
            intent: "closest just above budget",
            productIds: relaxed.products.map((p) => p.id),
            rationale: "a little above $100, but the closest options",
            droppedConstraint: "maxPrice",
          },
        ],
      };
    });
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "wireless under $100", keywords: "wireless", maxPrice: 100 }] },
      deps,
      finder,
    );
    const relaxed = state.results.find((r) => r.relaxed);
    expect(relaxed).toBeDefined();
    expect(relaxed?.relaxed?.constraint).toBe("maxPrice");
    expect(relaxed?.relaxed?.from).toContain("100");
    expect(relaxed?.relaxed?.to).toContain("110"); // the actual cheapest found
    expect(relaxed?.products.length).toBeGreaterThan(0);
    expect(relaxed?.rationale).toBeTruthy();
  });

  it("HARD maxPrice is enforced INSIDE the tool — over-budget items are never returned", async () => {
    const deps = catalog([makeProduct({ id: 1, price: 110 }), makeProduct({ id: 2, price: 130 })]);
    // Even though the finder ignores the cap and searches without maxPrice, the tool
    // enforces the hard constraint, so nothing over $100 is ever surfaced.
    const finder = scriptedFinder(async (search) => {
      const r = await search({ keywords: "headphones" }); // no maxPrice passed by the model
      return { groups: [{ intent: "headphones", productIds: r.products.map((p) => p.id) }] };
    });
    const state = await runDiscovery(
      {
        kind: "product",
        finders: [
          { label: "strictly under $100", keywords: "headphones", maxPrice: 100, hardConstraints: ["maxPrice"] },
        ],
      },
      deps,
      finder,
    );
    expect(state.results).toHaveLength(0); // no group breached the hard cap
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
    const finder = scriptedFinder(async (search) => {
      const r = await search({ keywords: "phone", sort: { field: "price", order: "asc" }, limit: 20 });
      return { groups: [{ intent: "phones", productIds: r.products.map((p) => p.id) }] };
    });
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "phones", keywords: "phone", sort: { field: "price", order: "asc" } }] },
      deps,
      finder,
      { limit: 5, excludeIds: [1, 2, 3, 4, 5] },
    );
    const ids = state.results.flatMap((r) => r.products.map((p) => p.id));
    expect(ids).toEqual([6, 7, 8]); // the next page, none of the already-shown 1-5
  });

  it("returns the finders it ran so the turn can persist them for the next continuation", async () => {
    const deps = catalog([makeProduct({ id: 1 }), makeProduct({ id: 2 }), makeProduct({ id: 3 })]);
    const finder = scriptedFinder(async (search) => {
      const r = await search({ keywords: "phone" });
      return { groups: [{ intent: "phones", productIds: r.products.map((p) => p.id) }] };
    });
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "phones", keywords: "phone", maxPrice: 500 }] },
      deps,
      finder,
    );
    expect(state.finders).toHaveLength(1);
    expect(state.finders?.[0]?.keywords).toBe("phone");
    expect(state.finders?.[0]?.maxPrice).toBe(500); // the original constraint is preserved
  });

  it("yields no group when every matching product was already shown (exhausted)", async () => {
    const products = [makeProduct({ id: 1 }), makeProduct({ id: 2 }), makeProduct({ id: 3 })];
    const deps = catalog(products);
    const finder = scriptedFinder(async (search) => {
      const r = await search({ keywords: "phone", limit: 20 });
      return { groups: [{ intent: "phones", productIds: r.products.map((p) => p.id) }] };
    });
    const state = await runDiscovery(
      { kind: "product", finders: [{ label: "phones", keywords: "phone" }] },
      deps,
      finder,
      { excludeIds: [1, 2, 3] },
    );
    expect(state.results).toHaveLength(0);
  });
});

describe("discovery — off-catalog merchandising", () => {
  it("retrieves adjacent finders for an off_catalog turn (still merchandises)", async () => {
    const deps = catalog([makeProduct({ id: 1 }), makeProduct({ id: 2 }), makeProduct({ id: 3 })]);
    const finder = scriptedFinder(async (search) => {
      const r = await search({ keywords: "pillow" });
      return { groups: [{ intent: "travel pillow", productIds: r.products.map((p) => p.id) }] };
    });
    const state = await runDiscovery(
      { kind: "off_catalog", finders: [{ label: "travel pillow", keywords: "pillow" }] },
      deps,
      finder,
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
