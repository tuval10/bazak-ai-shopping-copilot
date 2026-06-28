import { describe, expect, it } from "vitest";
import {
  conversationSummarySchema,
  productListResponseSchema,
  productResultsPartSchema,
  productSchema,
  profileSchema,
  workflowInputSchema,
} from "../src/schemas";

const validProduct = {
  id: 1,
  title: "Wireless Headphones",
  description: "Over-ear, noise cancelling.",
  category: "audio",
  price: 89.99,
  discountPercentage: 10,
  rating: 4.5,
  stock: 12,
  brand: "Acme",
  tags: ["wireless", "audio"],
  availabilityStatus: "In Stock",
  thumbnail: "https://cdn.example.com/1.png",
  images: ["https://cdn.example.com/1.png"],
};

describe("productSchema", () => {
  it("parses a valid product", () => {
    expect(productSchema.parse(validProduct)).toMatchObject({
      id: 1,
      title: "Wireless Headphones",
      price: 89.99,
    });
  });

  it("strips unknown catalog fields instead of failing", () => {
    const parsed = productSchema.parse({
      ...validProduct,
      sku: "ABC-123",
      weight: 2,
      dimensions: { width: 1, height: 1, depth: 1 },
    });
    expect(parsed).not.toHaveProperty("sku");
    expect(parsed).not.toHaveProperty("dimensions");
  });

  it("applies defaults for missing optional numerics/arrays", () => {
    const parsed = productSchema.parse({
      id: 2,
      title: "Mug",
      description: "Ceramic.",
      category: "kitchen",
      price: 5,
      thumbnail: "https://cdn.example.com/2.png",
    });
    expect(parsed.discountPercentage).toBe(0);
    expect(parsed.rating).toBe(0);
    expect(parsed.stock).toBe(0);
    expect(parsed.tags).toEqual([]);
    expect(parsed.images).toEqual([]);
    expect(parsed.brand).toBeUndefined();
  });

  it("rejects a negative price", () => {
    expect(() => productSchema.parse({ ...validProduct, price: -1 })).toThrow();
  });

  it("rejects a missing required field (title)", () => {
    const { title: _omit, ...rest } = validProduct;
    expect(() => productSchema.parse(rest)).toThrow();
  });
});

describe("productListResponseSchema", () => {
  it("parses a paginated list response", () => {
    const parsed = productListResponseSchema.parse({
      products: [validProduct],
      total: 24,
      skip: 0,
      limit: 5,
    });
    expect(parsed.products).toHaveLength(1);
    expect(parsed.total).toBe(24);
  });
});

describe("productResultsPartSchema", () => {
  it("validates nested products under an intent", () => {
    const parsed = productResultsPartSchema.parse({
      intent: "wireless headphones under $100",
      products: [validProduct],
    });
    expect(parsed.intent).toContain("headphones");
    expect(parsed.products[0]?.id).toBe(1);
  });

  it("rejects when a nested product is invalid", () => {
    expect(() =>
      productResultsPartSchema.parse({
        intent: "x",
        products: [{ ...validProduct, price: -5 }],
      }),
    ).toThrow();
  });
});

describe("profileSchema", () => {
  it("treats a fresh (empty) profile as valid", () => {
    expect(profileSchema.parse({})).toEqual({});
  });

  it("parses partial preferences", () => {
    const parsed = profileSchema.parse({
      budget: "~$50",
      preferredCategories: ["audio"],
    });
    expect(parsed.budget).toBe("~$50");
    expect(parsed.preferredCategories).toEqual(["audio"]);
  });
});

describe("workflowInputSchema", () => {
  it("requires a non-empty message", () => {
    expect(() =>
      workflowInputSchema.parse({ message: "", threadId: "t", resourceId: "u" }),
    ).toThrow();
  });

  it("parses a valid turn input", () => {
    const parsed = workflowInputSchema.parse({
      message: "show me cheap mugs",
      threadId: "thread-1",
      resourceId: "local-user",
    });
    expect(parsed.message).toBe("show me cheap mugs");
  });
});

describe("conversationSummarySchema", () => {
  it("parses a summary", () => {
    const parsed = conversationSummarySchema.parse({
      id: "thread-1",
      title: "Headphones hunt",
      createdAt: "2026-06-28T10:00:00.000Z",
      updatedAt: "2026-06-28T10:05:00.000Z",
    });
    expect(parsed.title).toBe("Headphones hunt");
  });
});
