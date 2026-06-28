import { describe, expect, it } from "vitest";
import { planRoute } from "../../src/pipeline/route";

describe("planRoute", () => {
  it("routes chitchat to the chitchat branch", () => {
    expect(planRoute({ kind: "chitchat", searches: [] })).toEqual({ kind: "chitchat" });
  });

  it("routes off_catalog to the off_catalog branch", () => {
    expect(planRoute({ kind: "off_catalog", searches: [] })).toEqual({ kind: "off_catalog" });
  });

  it("routes a product turn to retrieval with its intents", () => {
    const intents = [{ label: "phone under $500", maxPrice: 500 }];
    expect(planRoute({ kind: "product", searches: intents })).toEqual({
      kind: "product",
      intents,
    });
  });

  it("treats a product turn with no extracted searches as off_catalog", () => {
    expect(planRoute({ kind: "product", searches: [] })).toEqual({ kind: "off_catalog" });
  });
});
