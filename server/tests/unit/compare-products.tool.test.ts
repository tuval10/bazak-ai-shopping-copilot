import { type Product, type ProductResultsPart } from "@bazak/shared";
import { describe, expect, it } from "vitest";
import {
  runCompareProducts,
  type CompareProductsToolOptions,
} from "../../src/mastra/tools/compare-products";
import { makeProduct } from "../helpers/products";

function opts(over: Partial<CompareProductsToolOptions> = {}): CompareProductsToolOptions {
  const parts: Array<{ type: string; [k: string]: unknown }> = [];
  const registry = new Map<number, Product>([
    [1, makeProduct({ id: 1, title: "Acme Buds" })],
    [2, makeProduct({ id: 2, title: "Beats Flex" })],
  ]);
  const base: CompareProductsToolOptions = {
    writer: { custom: (d) => void parts.push(d) },
    registry,
    accumulator: [] as ProductResultsPart[],
    stepCounter: { count: 0 },
    maxSteps: 8,
    ...over,
  };
  (base as CompareProductsToolOptions & { _parts: typeof parts })._parts = parts;
  return base;
}

const parts = (o: CompareProductsToolOptions) =>
  (o as CompareProductsToolOptions & { _parts: Array<{ type: string; data: ProductResultsPart }> })._parts;

describe("compare_products tool core (runCompareProducts)", () => {
  it("grounds both ids, streams a comparison group, and accumulates it", async () => {
    const o = opts();
    const out = await runCompareProducts(
      { productIds: [1, 2], reason: "Acme is cheaper; Beats sounds better.", winnerId: 2 },
      o,
    );

    expect(out.notFound).toBeUndefined();
    const emitted = parts(o).filter((p) => p.type === "data-product-results");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.data.display).toBe("comparison");
    expect(emitted[0]?.data.products.map((p) => p.id)).toEqual([1, 2]); // grounded, in order
    expect(emitted[0]?.data.winnerId).toBe(2);
    expect(emitted[0]?.data.rationale).toBe("Acme is cheaper; Beats sounds better.");
    expect(o.accumulator).toHaveLength(1);
    expect(o.stepCounter.count).toBe(1);
  });

  it("drops a winnerId that isn't one of the two compared products", async () => {
    const o = opts();
    await runCompareProducts({ productIds: [1, 2], reason: "x", winnerId: 9 }, o);
    expect(parts(o)[0]?.data.winnerId).toBeUndefined();
  });

  it("refuses when an id wasn't shown — no card, no accumulation", async () => {
    const o = opts();
    const out = await runCompareProducts({ productIds: [1, 99], reason: "x" }, o);

    expect(out.notFound).toBe(true);
    expect(parts(o)).toHaveLength(0);
    expect(o.accumulator).toHaveLength(0);
    expect(o.stepCounter.count).toBe(1);
  });

  it("hard-stops at the step cap without emitting", async () => {
    const o = opts({ maxSteps: 0 });
    const out = await runCompareProducts({ productIds: [1, 2], reason: "x" }, o);
    expect(out.note).toMatch(/Step limit/);
    expect(parts(o)).toHaveLength(0);
    expect(o.stepCounter.count).toBe(0);
  });
});
