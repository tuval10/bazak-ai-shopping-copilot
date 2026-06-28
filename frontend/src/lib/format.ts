import type { Product } from "@bazak/shared";

/**
 * Pure display helpers shared across the product card and conversation rows. No
 * React, no I/O — unit-tested directly (the highest-value FE logic per D11).
 */

/** Whole-dollar price with thousands separators, matching the mocks ("$1,011", "$62"). */
export function formatPrice(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/**
 * The discounted price the card shows as primary, derived from the catalog's list
 * `price` and `discountPercentage` (the catalog has no explicit sale price). The
 * original `price` is shown struck-through alongside it when a discount applies.
 */
export function salePrice(product: Pick<Product, "price" | "discountPercentage">): number {
  return product.price * (1 - product.discountPercentage / 100);
}

/** True when there's a discount worth showing a struck original price for. */
export function hasDiscount(product: Pick<Product, "discountPercentage">): boolean {
  return product.discountPercentage >= 0.5;
}

/** The discount badge text, e.g. "-10%". */
export function discountBadge(product: Pick<Product, "discountPercentage">): string {
  return `-${Math.round(product.discountPercentage)}%`;
}

export type StockState = "in" | "low" | "out";

export interface StockInfo {
  state: StockState;
  /** Text label (never colour-only — a11y, US per ARCHITECTURE §8). */
  label: string;
}

/** Threshold below which remaining stock is surfaced as "low" (mirrors DummyJSON's own banding). */
const LOW_STOCK_THRESHOLD = 10;

/**
 * Availability for the stock pill (US-1.7). Prefers the catalog's own
 * `availabilityStatus` string when it says out/low, else falls back to the numeric
 * `stock` with a low-stock threshold.
 */
export function stockInfo(product: Pick<Product, "stock" | "availabilityStatus">): StockInfo {
  const status = product.availabilityStatus?.toLowerCase();
  if (status === "out of stock" || product.stock <= 0) {
    return { state: "out", label: "Out of stock" };
  }
  if (status === "low stock" || product.stock < LOW_STOCK_THRESHOLD) {
    return { state: "low", label: `Low stock — ${product.stock} left` };
  }
  return { state: "in", label: "In stock" };
}

/** Rounded rating for the "★ 4.6" affordance. */
export function formatRating(rating: number): string {
  return `★ ${rating.toFixed(1)}`;
}

/** A small leading emoji for a multi-intent group label, guessed from its keywords. */
export function intentEmoji(label: string): string {
  const l = label.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/phone|smartphone|iphone|galaxy/, "📱"],
    [/laptop|notebook|macbook/, "💻"],
    [/bag|backpack|tote|purse|handbag/, "👜"],
    [/watch|smartwatch/, "⌚"],
    [/headphone|earbud|earphone|airpod|audio/, "🎧"],
    [/shoe|sneaker|boot|footwear/, "👟"],
    [/shirt|dress|jacket|apparel|clothing/, "👕"],
    [/camera|lens/, "📷"],
    [/tv|monitor|display/, "🖥️"],
    [/beauty|fragrance|skincare|makeup/, "💄"],
    [/grocery|food|snack/, "🛒"],
  ];
  for (const [re, emoji] of map) {
    if (re.test(l)) return emoji;
  }
  return "🛍️";
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Conversation-row timestamp, matching the mocks' banding: "Just now" / "2h ago" /
 * "Yesterday" / weekday within the last week / "Jun 20" beyond that. `now` is
 * injectable so the formatting is deterministic in tests.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  if (Number.isNaN(ms)) return "";

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 2) return "Yesterday";
  if (days < 7) return DAY_NAMES[then.getDay()] ?? "";

  return `${MONTH_NAMES[then.getMonth()]} ${then.getDate()}`;
}
