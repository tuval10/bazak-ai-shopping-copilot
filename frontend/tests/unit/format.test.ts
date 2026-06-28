import {
  discountBadge,
  formatPrice,
  formatRating,
  formatRelativeTime,
  hasDiscount,
  salePrice,
  stockInfo,
} from "@/lib/format";
import { mockProduct } from "../mocks/product-results";

describe("formatPrice", () => {
  it("shows whole dollars with thousands separators", () => {
    expect(formatPrice(1011)).toBe("$1,011");
    expect(formatPrice(62.1)).toBe("$62");
    expect(formatPrice(0)).toBe("$0");
  });
});

describe("salePrice / discount", () => {
  it("derives the discounted price from list price + discount", () => {
    expect(salePrice({ price: 69, discountPercentage: 10 })).toBeCloseTo(62.1);
    expect(salePrice({ price: 100, discountPercentage: 0 })).toBe(100);
  });

  it("only flags a discount worth showing", () => {
    expect(hasDiscount({ discountPercentage: 10 })).toBe(true);
    expect(hasDiscount({ discountPercentage: 0 })).toBe(false);
    expect(hasDiscount({ discountPercentage: 0.2 })).toBe(false);
  });

  it("renders the badge as a rounded negative percent", () => {
    expect(discountBadge({ discountPercentage: 8.4 })).toBe("-8%");
    expect(discountBadge({ discountPercentage: 10 })).toBe("-10%");
  });
});

describe("stockInfo", () => {
  it("is in-stock for ample stock", () => {
    expect(stockInfo(mockProduct({ stock: 50 }))).toEqual({ state: "in", label: "In stock" });
  });

  it("names the remaining count when low", () => {
    expect(stockInfo(mockProduct({ stock: 3 }))).toEqual({ state: "low", label: "Low stock — 3 left" });
  });

  it("is out of stock at zero or when the catalog says so", () => {
    expect(stockInfo(mockProduct({ stock: 0 })).state).toBe("out");
    expect(stockInfo(mockProduct({ stock: 99, availabilityStatus: "Out of Stock" })).state).toBe("out");
  });

  it("trusts an explicit Low Stock status even with a higher count", () => {
    expect(stockInfo(mockProduct({ stock: 40, availabilityStatus: "Low Stock" })).state).toBe("low");
  });
});

describe("formatRating", () => {
  it("renders a star with one decimal", () => {
    expect(formatRating(4.567)).toBe("★ 4.6");
    expect(formatRating(4)).toBe("★ 4.0");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-06-28T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("bands recent times the way the mocks do", () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe("Just now");
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe("5m ago");
    expect(formatRelativeTime(ago(2 * 3_600_000), now)).toBe("2h ago");
    expect(formatRelativeTime(ago(25 * 3_600_000), now)).toBe("Yesterday");
  });

  it("uses a weekday within the week and a month-day beyond it", () => {
    // Exact weekday/day depend on the runner's locale TZ; assert the banding shape.
    expect(formatRelativeTime(ago(3 * 86_400_000), now)).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/);
    expect(formatRelativeTime(ago(10 * 86_400_000), now)).toMatch(/^Jun \d{1,2}$/);
  });

  it("returns empty for an unparseable timestamp", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("");
  });
});
