import type { WorkflowInput } from "@bazak/shared";
import { describe, expect, it, vi } from "vitest";
import { runConverse, type ThreadContext } from "../../src/pipeline/converse";
import type { CatalogDeps } from "../../src/pipeline/retrieve";
import { passthroughFinder, type ScriptedFind, scriptedFinder, scriptedSupervisor } from "../helpers/finder";
import { makeListResponse, makeProduct } from "../helpers/products";

/**
 * Epic 4 edge-case evals (US-6.1): drive the supervisor turn (D15) with a scripted
 * supervisor + the real finder/assembly path against a mocked catalog, asserting the
 * decided behavior per case. Model prose is scripted (not asserted for wording); we
 * assert the deterministic shape: which cards stream, grounding, relaxation, and the
 * direct-answer path. The cap / soft-vs-hard guarantees live in `agentic-flow.test.ts`.
 */

const CATS = [{ slug: "smartphones", name: "smartphones" }];
const input: WorkflowInput = { message: "x", threadId: "t", resourceId: "local-user" };

function catalog(
  products = [
    makeProduct({ id: 1, price: 20 }),
    makeProduct({ id: 2, price: 50 }),
    makeProduct({ id: 3, price: 80 }),
  ],
): CatalogDeps {
  return {
    searchProducts: vi.fn(async () => makeListResponse(products)),
    getCategoryProducts: vi.fn(async () => makeListResponse(products)),
    getCategories: vi.fn(async () => CATS),
  };
}

/** A catalog returning DIFFERENT products per keyword (so distinct finders don't dedup away). */
function catalogByKeyword(map: Record<string, ReturnType<typeof makeProduct>[]>): CatalogDeps {
  return {
    searchProducts: vi.fn(async (q: string) => makeListResponse(map[q] ?? [])),
    getCategoryProducts: vi.fn(async () => makeListResponse([])),
    getCategories: vi.fn(async () => CATS),
  };
}

function runTurn(opts: {
  script: (find: ScriptedFind, message: string) => Promise<string>;
  deps?: CatalogDeps;
  context?: ThreadContext;
  turn?: WorkflowInput;
  finderAgent?: ReturnType<typeof passthroughFinder>;
}) {
  const parts: Array<{ type: string; [k: string]: unknown }> = [];
  return runConverse({
    input: opts.turn ?? input,
    supervisor: scriptedSupervisor(opts.script),
    finderAgent: opts.finderAgent ?? passthroughFinder(),
    categories: CATS,
    context: opts.context ?? { shownIds: [], priorProducts: [] },
    deps: opts.deps ?? catalog(),
    writer: { custom: (d) => void parts.push(d) },
    maxFinders: 5,
    finderMaxSteps: 4,
    supervisorMaxSteps: 8,
  }).then((result) => ({
    result,
    parts,
    productParts: parts.filter((p) => p.type === "data-product-results"),
  }));
}

describe("Epic 4 edge cases", () => {
  it("ambiguous/subjective → assume + show results immediately (US-4.1)", async () => {
    const { result, productParts } = await runTurn({
      script: async (find) => {
        await find({ label: "cheap & cool", keywords: "popular", maxPrice: 100, sort: { field: "rating", order: "desc" } });
        return "Some popular picks:";
      },
    });
    expect(productParts).toHaveLength(1); // shows results, doesn't block on a question
    expect(result.results[0]?.products.length).toBeGreaterThan(0);
  });

  it("multi-intent → decompose + answer all, grouped (US-1.3)", async () => {
    const { result, productParts } = await runTurn({
      deps: catalogByKeyword({ phone: [makeProduct({ id: 1 })], bag: [makeProduct({ id: 2 })] }),
      script: async (find) => {
        await find({ label: "a phone", keywords: "phone" });
        await find({ label: "a laptop bag", keywords: "bag" });
        return "Both:";
      },
    });
    expect(productParts).toHaveLength(2);
    expect(result.results.map((r) => r.intent)).toEqual(["a phone", "a laptop bag"]);
  });

  it("grounding → only retrieved products are emitted, none invented (US-5.1)", async () => {
    const { result } = await runTurn({
      deps: catalog([makeProduct({ id: 42 }), makeProduct({ id: 43 })]),
      script: async (find) => {
        await find({ label: "thing", keywords: "thing" });
        return "Found:";
      },
    });
    const ids = result.results.flatMap((r) => r.products.map((p) => p.id));
    expect(ids).toEqual([42, 43]); // exactly the catalog's products
  });

  it("no results → relax a SOFT constraint and name it + the real value (US-4.4)", async () => {
    // Nothing under $100; cheapest is $110. The inner finder drops the soft ceiling.
    const deps = catalog([makeProduct({ id: 1, price: 110 }), makeProduct({ id: 2, price: 140 })]);
    const finder = scriptedFinder(async (search) => {
      await search({ keywords: "phone", maxPrice: 100 }); // 0 matched
      const relaxed = await search({ keywords: "phone", sort: { field: "price", order: "asc" } });
      return {
        groups: [
          {
            intent: "closest above budget",
            productIds: relaxed.products.map((p) => p.id),
            rationale: "closest above budget",
            droppedConstraint: "maxPrice",
          },
        ],
      };
    });
    const { result } = await runTurn({
      deps,
      finderAgent: finder,
      script: async (find) => {
        const out = await find({ label: "phone under $100", keywords: "phone", maxPrice: 100 });
        // The lean narrative tells the supervisor a constraint was relaxed + the real value.
        expect(out.groups[0]?.relaxed?.constraint).toBe("maxPrice");
        return "Nothing under $100, but here's the closest.";
      },
    });
    const relaxed = result.results.find((r) => r.relaxed);
    expect(relaxed?.relaxed?.from).toContain("100");
    expect(relaxed?.relaxed?.to).toContain("110"); // the actual cheapest found
    expect(relaxed?.products.length).toBeGreaterThan(0);
  });

  it("off-catalog with nothing relevant → decline, no products (US-4.2)", async () => {
    const empty = catalog([]);
    const { result, productParts } = await runTurn({
      deps: empty,
      turn: { message: "a flight to Tokyo", threadId: "t", resourceId: "local-user" },
      script: async (find) => {
        await find({ label: "travel pillow", keywords: "pillow", brief: "for the flight" });
        return "I can't book flights, and didn't find anything relevant to suggest.";
      },
    });
    expect(productParts).toHaveLength(0); // nothing matched → no cards
    expect(result.results).toEqual([]);
    expect(result.message).toMatch(/can't book|didn't find/i);
  });

  it("chit-chat → friendly reply, no products, no finder call (US-4.3)", async () => {
    const { result, parts } = await runTurn({
      turn: { message: "hi there", threadId: "t", resourceId: "local-user" },
      script: async () => "Hi! What are you shopping for today?",
    });
    expect(parts).toHaveLength(0);
    expect(result.message).toContain("shopping");
    expect(result.results).toEqual([]);
  });

  it("follow-up about shown products → answers directly from context, no new search (US-4.5)", async () => {
    const { result, productParts } = await runTurn({
      turn: { message: "what's the difference between them?", threadId: "t", resourceId: "local-user" },
      context: {
        shownIds: [1, 2],
        priorProducts: [
          { id: 1, title: "Phone A", price: 200, rating: 4.5 },
          { id: 2, title: "Phone B", price: 350, rating: 4.8 },
        ],
      },
      script: async () => "Phone A is cheaper; Phone B is higher rated.",
    });
    expect(productParts).toHaveLength(0); // no re-search
    expect(result.message).toContain("Phone A");
  });
});
