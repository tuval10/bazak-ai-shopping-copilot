import { logger } from "../observability/logger";
import { type Category } from "./categories";
import { getCategories } from "./client";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CategoriesProviderOptions {
  /** Cache lifetime in ms (default 24h). */
  ttlMs?: number;
  /** The underlying fetch (default the real `/products/categories` client). Injectable for tests. */
  fetcher?: () => Promise<Category[]>;
  /** Clock, injectable so tests can advance past the TTL. */
  now?: () => number;
}

/**
 * Process-wide in-memory cache for the catalog category list (US-1.6). The list is
 * tiny (~24 entries) and changes rarely, but it is now read on EVERY turn (the
 * orchestrator and finder both see it), so we fetch it at most once per day.
 *
 * Concurrent callers during a cold/expired window share a single in-flight request
 * (no thundering herd). A failed fetch resolves to `[]` and is NOT cached, so the
 * next turn retries and every consumer degrades to its pre-categories behavior
 * (keyword search, no category-grounded planning) rather than breaking the turn.
 */
export class CategoriesProvider {
  private value: Category[] | null = null;
  private expiresAt = 0;
  private inFlight: Promise<Category[]> | null = null;
  private readonly ttlMs: number;
  private readonly fetcher: () => Promise<Category[]>;
  private readonly now: () => number;

  constructor(opts: CategoriesProviderOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DAY_MS;
    this.fetcher = opts.fetcher ?? getCategories;
    this.now = opts.now ?? Date.now;
  }

  /**
   * The cached category list. Serves the cache while fresh; otherwise fetches once
   * (deduping concurrent callers) and caches for `ttlMs`. Returns `[]` on failure
   * without caching, so a transient catalog outage retries on the next call.
   */
  async get(): Promise<Category[]> {
    if (this.value && this.now() < this.expiresAt) return this.value;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetcher()
      .then((cats) => {
        this.value = cats;
        this.expiresAt = this.now() + this.ttlMs;
        return cats;
      })
      .catch((err) => {
        logger.debug("categories fetch failed; serving empty list", {
          component: "catalog",
          err: err instanceof Error ? err.message : String(err),
        });
        return [] as Category[]; // do NOT cache a failure — retry next call
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  /** Clear the cache + any in-flight request so the next `get()` refetches. */
  reset(): void {
    this.value = null;
    this.expiresAt = 0;
    this.inFlight = null;
  }
}

/** The process-wide singleton (24h TTL, real `/products/categories`). */
export const categoriesProvider = new CategoriesProvider();
