import { describe, expect, it } from "vitest";
import { generateChips } from "../../src/pipeline/chips";
import { makeProduct } from "../helpers/products";

/**
 * Deterministic (no-LLM) chip generation: with no chips agent, `generateChips` uses
 * the data-grounded heuristic, so these are stable unit tests.
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
});
