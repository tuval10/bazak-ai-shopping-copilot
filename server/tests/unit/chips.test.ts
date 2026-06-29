import { describe, expect, it, vi } from "vitest";
import { generateChips } from "../../src/pipeline/chips";
import { makeProduct } from "../helpers/products";

/**
 * Chip generation unit tests. With no chips agent (or a failing one) `generateChips`
 * uses the data-grounded heuristic, so those are deterministic; the agent path is
 * exercised with a mocked structured-output agent (no real LLM).
 */

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

  it("with a chips agent + products → model-authored context-aware chips win", async () => {
    const agent = {
      generate: vi.fn(async () => ({
        object: {
          chips: [
            { label: "Good camera", message: "show me phones with a great camera" },
            { label: "Under $200", message: "only show phones under $200" },
          ],
        },
      })),
    };
    const state = {
      kind: "product" as const,
      results: [{ intent: "phones", products: [makeProduct({ id: 1 }), makeProduct({ id: 2 })] }],
      notes: [],
    };
    const chips = await generateChips({ state, message: "I want a phone", agent });
    expect(agent.generate).toHaveBeenCalledTimes(1);
    expect(chips.map((c) => c.label)).toEqual(["Good camera", "Under $200"]);
  });

  it("products but a FAILING/absent agent → grounded filter chips, never 'Show similar'", async () => {
    const state = {
      kind: "product" as const,
      // a RELAXED result still gets real chips (the old code fell back to generic here)
      results: [
        {
          intent: "phones",
          relaxed: { constraint: "category", from: "smartphones", to: "a broader search" },
          products: [
            makeProduct({ id: 1, price: 100, brand: "Apple" }),
            makeProduct({ id: 2, price: 500, brand: "Samsung" }),
          ],
        },
      ],
      notes: [],
    };
    const failing = { generate: vi.fn(async () => ({ object: {} })) }; // bad shape → fallback
    const chips = await generateChips({ state, message: "phones", agent: failing });
    expect(chips.some((c) => c.label === "Show similar")).toBe(false);
    expect(chips.some((c) => /cheapest|under \$|top rated|only /i.test(c.label))).toBe(true);
  });
});
