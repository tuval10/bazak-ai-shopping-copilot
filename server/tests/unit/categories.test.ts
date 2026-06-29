import { describe, expect, it } from "vitest";
import { type Category, formatCategoryList, resolveCategorySlug } from "../../src/catalog/categories";

const categories: Category[] = [
  { slug: "smartphones", name: "smartphones" },
  { slug: "laptops", name: "laptops" },
  { slug: "fragrances", name: "fragrances" },
  { slug: "mens-watches", name: "mens watches" },
  { slug: "home-decoration", name: "home decoration" },
];

describe("resolveCategorySlug", () => {
  it("matches an exact slug", () => {
    expect(resolveCategorySlug("laptops", categories)).toBe("laptops");
  });

  it("maps a common synonym (phones → smartphones)", () => {
    expect(resolveCategorySlug("phones", categories)).toBe("smartphones");
    expect(resolveCategorySlug("phone", categories)).toBe("smartphones");
  });

  it("maps perfume → fragrances", () => {
    expect(resolveCategorySlug("perfume", categories)).toBe("fragrances");
  });

  it("matches via multi-token substring (men watches → mens-watches)", () => {
    expect(resolveCategorySlug("men watches", categories)).toBe("mens-watches");
  });

  it("is case-insensitive", () => {
    expect(resolveCategorySlug("  LAPTOPS ", categories)).toBe("laptops");
  });

  it("returns null when nothing reasonably matches", () => {
    expect(resolveCategorySlug("airplane tickets", categories)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(resolveCategorySlug("", categories)).toBeNull();
  });
});

describe("formatCategoryList", () => {
  it("renders one 'slug — name' line per category", () => {
    const out = formatCategoryList([
      { slug: "smartphones", name: "smartphones" },
      { slug: "mens-watches", name: "mens watches" },
    ]);
    expect(out).toBe("smartphones — smartphones\nmens-watches — mens watches");
  });

  it("returns an empty string for no categories", () => {
    expect(formatCategoryList([])).toBe("");
  });
});
