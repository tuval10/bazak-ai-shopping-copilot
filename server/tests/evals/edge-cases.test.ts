import type { WorkflowInput } from "@bazak/shared";
import { describe, expect, it, vi } from "vitest";
import type { OrchestrationPlan } from "../../src/pipeline/classification";
import {
  type DiscoveryPlan,
  runDiscovery,
  type StructuredDiscovery,
} from "../../src/pipeline/discovery";
import { PRODUCT_RESULTS_PART, type TextGenerator } from "../../src/pipeline/generate";
import { runGenerate, summarizeForPrompt } from "../../src/pipeline/generate";
import { runOrchestrate, type StructuredOrchestrator } from "../../src/pipeline/orchestrate";
import type { CatalogDeps } from "../../src/pipeline/retrieve";
import { makeListResponse, makeProduct } from "../helpers/products";

/**
 * Epic 4 edge-case evals (US-6.1): drive the agentic pipeline (orchestrate →
 * discover → generate) with a faked orchestrator/discovery (canned plan) and a
 * mocked catalog, asserting the decided behavior for each case. Model prose isn't
 * asserted (it's faked); we assert the deterministic shape + the prompt the model
 * is grounded with. The finder-cap / budget / soft-vs-hard guarantees live in
 * `agentic-flow.test.ts`; this file covers the end-to-end turn behaviors.
 */

const input: WorkflowInput = { message: "x", threadId: "t", resourceId: "local-user" };

const fakeOrchestrator = (plan: OrchestrationPlan): StructuredOrchestrator => ({
  generate: vi.fn(async () => ({ object: plan })),
});
const fakeDiscovery = (plan: DiscoveryPlan): StructuredDiscovery => ({
  generate: vi.fn(async () => ({ object: plan })),
});
const fakeGenerator = (): TextGenerator => ({ generate: vi.fn(async () => ({ text: "reply" })) });

// A "strong" catalog: ≥ STRONG_RESULT cheap products, so a focused query shows them
// as-is without triggering relaxation.
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
    getCategories: vi.fn(async () => [{ slug: "smartphones", name: "smartphones" }]),
  };
}

/** Drive orchestrate → discover → generate end to end with a faked plan + catalog. */
async function run(
  plan: OrchestrationPlan,
  deps = catalog(),
  turn: WorkflowInput = input,
  discovery?: StructuredDiscovery,
) {
  const orchestrated = await runOrchestrate(turn.message, fakeOrchestrator(plan));
  const state = await runDiscovery(orchestrated, deps, discovery, { maxCalls: 10 });
  const gen = fakeGenerator();
  const parts: Array<{ type: string }> = [];
  const output = await runGenerate({
    input: turn,
    state,
    agent: gen,
    writer: { custom: (d) => void parts.push(d) },
  });
  const productParts = parts.filter((p) => p.type === PRODUCT_RESULTS_PART);
  return { state, output, parts, productParts, gen };
}

describe("Epic 4 edge cases", () => {
  it("ambiguous/subjective → assume + show results (US-4.1)", async () => {
    // "something cheap and cool" → best-guess: budget + top-rated, shown immediately.
    const { state, productParts } = await run({
      kind: "product",
      finders: [
        { label: "cheap & cool", keywords: "popular", maxPrice: 100, sort: { field: "rating", order: "desc" } },
      ],
    });
    expect(state.kind).toBe("product");
    expect(productParts).toHaveLength(1); // shows results immediately, doesn't block on a question
    expect(state.results[0]?.products.length).toBeGreaterThan(0);
  });

  it("multi-intent → decompose + answer all, grouped (US-1.3)", async () => {
    const { output, productParts } = await run({
      kind: "product",
      finders: [
        { label: "a phone", keywords: "phone" },
        { label: "a laptop bag", keywords: "bag" },
      ],
    });
    expect(productParts).toHaveLength(2);
    expect(output.results.map((r) => r.intent)).toEqual(["a phone", "a laptop bag"]);
  });

  it("grounding → only retrieved products are emitted, none invented (US-5.1)", async () => {
    const only = [makeProduct({ id: 42 }), makeProduct({ id: 43 })];
    const { output } = await run(
      { kind: "product", finders: [{ label: "thing", keywords: "thing" }] },
      catalog(only),
    );
    const ids = output.results.flatMap((r) => r.products.map((p) => p.id));
    expect(ids).toEqual([42, 43]); // exactly the catalog's products
  });

  it("no results → relax a SOFT constraint and name it + the real value (US-4.4)", async () => {
    // Nothing under $100; cheapest available is $110. Discovery drops the soft ceiling.
    const deps = catalog([makeProduct({ id: 1, price: 110 }), makeProduct({ id: 2, price: 140 })]);
    const discovery = fakeDiscovery({
      axes: [{ drop: "maxPrice", sort: { field: "price", order: "asc" }, rationale: "closest above budget" }],
    });
    const { state } = await run(
      { kind: "product", finders: [{ label: "phone under $100", keywords: "phone", maxPrice: 100 }] },
      deps,
      input,
      discovery,
    );
    const relaxed = state.results.find((r) => r.relaxed);
    expect(relaxed?.products.length).toBeGreaterThan(0); // nearest alternatives shown
    // The grounding prompt surfaces the relaxed constraint + the actual cheapest found.
    const prompt = summarizeForPrompt(state);
    expect(prompt).toMatch(/RELAXED maxPrice/);
    expect(prompt).toContain("under $100"); // names the relaxed constraint
    expect(prompt).toContain("$110"); // and the actual cheapest available
  });

  it("off-catalog with nothing relevant → decline + suggest nearest, no products (US-4.2)", async () => {
    // Off-catalog finders that the (empty) catalog can't fulfil → concierge decline.
    const empty = catalog([]);
    const { state, productParts, output } = await run(
      { kind: "off_catalog", finders: [{ label: "travel pillow", keywords: "travel pillow" }] },
      empty,
    );
    expect(productParts).toHaveLength(0);
    expect(output.results).toEqual([]);
    expect(summarizeForPrompt(state)).toMatch(/can't fulfil|nearest/i);
  });

  it("chit-chat → friendly reply, no products (US-4.3)", async () => {
    const { parts, output } = await run({ kind: "chitchat", finders: [] });
    expect(parts).toHaveLength(0);
    expect(output.message).toBeTruthy();
  });

  it("follow-up → memory context is carried into generation (US-4.5, mechanism)", async () => {
    // The generator receives thread+resource memory, so replies are context-aware.
    const { gen } = await run({ kind: "product", finders: [{ label: "p", keywords: "p" }] });
    expect(gen.generate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ memory: { thread: "t", resource: "local-user" } }),
    );
  });

  it("follow-up → orchestrator resolves refinements against prior turns (US-4.5)", async () => {
    // With prior-turn context, orchestrate rewrites an implicit refinement ("show me
    // cheaper") into a full finder. Assert the orchestrator prompt now carries BOTH the
    // current message and the recent conversation.
    const orchestrator = fakeOrchestrator({
      kind: "product",
      finders: [{ label: "cheaper headphones", keywords: "headphones", sort: { field: "price", order: "asc" } }],
    });
    const prior = "user: wireless headphones under $100\nassistant: Here are some budget picks.";

    const plan = await runOrchestrate("show me cheaper", orchestrator, { priorContext: prior });

    expect(plan.kind).toBe("product");
    const [prompt] = (orchestrator.generate as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(prompt).toContain("show me cheaper");
    expect(prompt).toContain("wireless headphones under $100");
  });
});
