import { type Product, type ProductResultsPart } from "@bazak/shared";
import { describe, expect, it } from "vitest";
import {
  runRecommendProduct,
  type RecommendProductToolOptions,
} from "../../src/mastra/tools/recommend-product";
import { makeProduct } from "../helpers/products";

function opts(over: Partial<RecommendProductToolOptions> = {}): RecommendProductToolOptions {
  const parts: Array<{ type: string; [k: string]: unknown }> = [];
  const registry = new Map<number, Product>([[1, makeProduct({ id: 1, title: "Acme Buds" })]]);
  const base: RecommendProductToolOptions = {
    writer: { custom: (d) => void parts.push(d) },
    registry,
    accumulator: [] as ProductResultsPart[],
    stepCounter: { count: 0 },
    maxSteps: 8,
    ...over,
  };
  (base as RecommendProductToolOptions & { _parts: typeof parts })._parts = parts;
  return base;
}

const parts = (o: RecommendProductToolOptions) =>
  (o as RecommendProductToolOptions & { _parts: Array<{ type: string; data: ProductResultsPart }> })._parts;

describe("recommend_product tool core (runRecommendProduct)", () => {
  it("grounds the id, streams a recommendation card, and accumulates it", async () => {
    const o = opts();
    const out = await runRecommendProduct(
      { productId: 1, badge: "recommended", reason: "Best all-rounder." },
      o,
    );

    expect(out.notFound).toBeUndefined();
    const emitted = parts(o).filter((p) => p.type === "data-product-results");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.data.display).toBe("recommendation");
    expect(emitted[0]?.data.badge).toBe("recommended");
    expect(emitted[0]?.data.products.map((p) => p.id)).toEqual([1]); // grounded by id
    expect(emitted[0]?.data.rationale).toBe("Best all-rounder."); // reason → rationale
    expect(o.accumulator).toHaveLength(1);
    expect(o.stepCounter.count).toBe(1);
  });

  it("uses the best-value intent label for the best-value badge", async () => {
    const o = opts();
    await runRecommendProduct({ productId: 1, badge: "best-value", reason: "Cheapest solid pick." }, o);
    expect(parts(o)[0]?.data.intent).toBe("Best value for money");
  });

  it("refuses an id that wasn't shown — no card, no accumulation", async () => {
    const o = opts();
    const out = await runRecommendProduct({ productId: 99, badge: "recommended", reason: "x" }, o);

    expect(out.notFound).toBe(true);
    expect(parts(o)).toHaveLength(0);
    expect(o.accumulator).toHaveLength(0);
    expect(o.stepCounter.count).toBe(1); // a refused-by-grounding call still spent a step
  });

  it("hard-stops at the step cap without emitting", async () => {
    const o = opts({ maxSteps: 0 });
    const out = await runRecommendProduct({ productId: 1, badge: "recommended", reason: "x" }, o);
    expect(out.note).toMatch(/Step limit/);
    expect(parts(o)).toHaveLength(0);
    expect(o.stepCounter.count).toBe(0);
  });
});
