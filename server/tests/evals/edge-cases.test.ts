import type { WorkflowInput } from "@bazak/shared";
import { describe, expect, it, vi } from "vitest";
import type { Classification } from "../../src/pipeline/classification";
import type { StructuredClassifier } from "../../src/pipeline/classify";
import { runClassify } from "../../src/pipeline/classify";
import type { TextGenerator } from "../../src/pipeline/generate";
import { runGenerate, summarizeForPrompt } from "../../src/pipeline/generate";
import type { CatalogDeps } from "../../src/pipeline/retrieve";
import { runRetrieve } from "../../src/pipeline/retrieve";
import { planRoute } from "../../src/pipeline/route";
import { makeListResponse, makeProduct } from "../helpers/products";

/**
 * Epic 4 edge-case evals (US-6.1): drive the pipeline (classify → route →
 * retrieve → generate) with a faked classifier (canned classification) and a
 * mocked catalog, asserting the decided behavior for each case. Model prose isn't
 * asserted (it's faked); we assert the deterministic shape + the prompt the model
 * is grounded with.
 */

const input: WorkflowInput = { message: "x", threadId: "t", resourceId: "local-user" };

const fakeClassifier = (c: Classification): StructuredClassifier => ({
  generate: vi.fn(async () => ({ object: c })),
});
const fakeGenerator = (): TextGenerator => ({ generate: vi.fn(async () => ({ text: "reply" })) });

function catalog(products = [makeProduct({ id: 1 }), makeProduct({ id: 2 })]): CatalogDeps {
  return {
    searchProducts: vi.fn(async () => makeListResponse(products)),
    getCategoryProducts: vi.fn(async () => makeListResponse(products)),
    getCategories: vi.fn(async () => [{ slug: "smartphones", name: "smartphones" }]),
  };
}

async function run(classification: Classification, deps = catalog(), turn: WorkflowInput = input) {
  const classified = await runClassify(turn.message, fakeClassifier(classification));
  const state = await runRetrieve(planRoute(classified), deps);
  const gen = fakeGenerator();
  const parts: unknown[] = [];
  const output = await runGenerate({
    input: turn,
    state,
    agent: gen,
    writer: { custom: (d) => void parts.push(d) },
  });
  return { state, output, parts, gen };
}

describe("Epic 4 edge cases", () => {
  it("ambiguous/subjective → assume + show results (US-4.1)", async () => {
    // "something cheap and cool" → best-guess: budget + top-rated
    const { state, parts } = await run({
      kind: "product",
      searches: [{ label: "cheap & cool", keywords: "popular", maxPrice: 100, sort: { field: "rating", order: "desc" } }],
    });
    expect(state.kind).toBe("product");
    expect(parts).toHaveLength(1); // shows results immediately, doesn't block on a question
    expect(state.results[0]?.products.length).toBeGreaterThan(0);
  });

  it("off-catalog → decline + suggest nearest, no products (US-4.2)", async () => {
    const { state, parts, output } = await run({ kind: "off_catalog", searches: [] });
    expect(parts).toHaveLength(0);
    expect(output.results).toEqual([]);
    expect(summarizeForPrompt(state)).toMatch(/can't fulfil|nearest/i);
  });

  it("chit-chat → friendly reply, no products (US-4.3)", async () => {
    const { parts, output } = await run({ kind: "chitchat", searches: [] });
    expect(parts).toHaveLength(0);
    expect(output.message).toBeTruthy();
  });

  it("no results → admit + relax + name the constraint and value (US-4.4)", async () => {
    const pricey = [makeProduct({ id: 1, price: 100 }), makeProduct({ id: 2, price: 130 })];
    const { state } = await run(
      { kind: "product", searches: [{ label: "phone under $10", maxPrice: 10 }] },
      catalog(pricey),
    );
    expect(state.results[0]?.products.length).toBeGreaterThan(0); // nearest alternatives shown
    expect(state.notes[0]).toContain("$10"); // names the relaxed constraint
    expect(state.notes[0]).toContain("$100"); // and the actual cheapest found
  });

  it("multi-intent → decompose + answer all, grouped (US-1.3)", async () => {
    const { output, parts } = await run({
      kind: "product",
      searches: [
        { label: "a phone", keywords: "phone" },
        { label: "a laptop bag", keywords: "bag" },
      ],
    });
    expect(parts).toHaveLength(2);
    expect(output.results.map((r) => r.intent)).toEqual(["a phone", "a laptop bag"]);
  });

  it("grounding → only retrieved products are emitted, none invented (US-5.1)", async () => {
    const only = [makeProduct({ id: 42 }), makeProduct({ id: 43 })];
    const { output } = await run({ kind: "product", searches: [{ label: "thing", keywords: "thing" }] }, catalog(only));
    const ids = output.results.flatMap((r) => r.products.map((p) => p.id));
    expect(ids).toEqual([42, 43]); // exactly the catalog's products
  });

  it("follow-up → memory context is carried into generation (US-4.5, mechanism)", async () => {
    // The generator receives thread+resource memory, so replies are context-aware.
    // NOTE: classifier-level refinement resolution ("cheaper", "the second one")
    // re-querying against prior turns is not yet implemented — see commit/FUTURE.
    const { gen } = await run({ kind: "product", searches: [{ label: "p", keywords: "p" }] });
    expect(gen.generate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ memory: { thread: "t", resource: "local-user" } }),
    );
  });
});
