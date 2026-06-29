import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category } from "../../src/catalog";
import { CategoriesProvider } from "../../src/catalog/categories-provider";

const CATS: Category[] = [
  { slug: "smartphones", name: "smartphones" },
  { slug: "laptops", name: "laptops" },
];

/**
 * Route the two catalog endpoints the default fetcher hits: the category list and
 * the single count call. `countOk:false` simulates the count call failing.
 */
function stubCatalog(countOk = true) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/products/categories")) {
        return { ok: true, status: 200, json: async () => CATS } as Response;
      }
      // /products?limit=0&select=category
      if (!countOk) return { ok: false, status: 500, json: async () => ({}) } as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          products: [{ category: "smartphones" }, { category: "smartphones" }, { category: "laptops" }],
          total: 3,
        }),
      } as Response;
    }),
  );
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CategoriesProvider", () => {
  it("caches within the TTL — fetcher runs once across calls", async () => {
    const fetcher = vi.fn(async () => CATS);
    const p = new CategoriesProvider({ fetcher, now: () => 0, ttlMs: 1000 });
    expect(await p.get()).toEqual(CATS);
    expect(await p.get()).toEqual(CATS);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    const fetcher = vi.fn(async () => CATS);
    let t = 0;
    const p = new CategoriesProvider({ fetcher, now: () => t, ttlMs: 1000 });
    await p.get();
    t = 1500; // past the TTL
    await p.get();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent cold callers onto a single in-flight fetch", async () => {
    let resolve!: (c: Category[]) => void;
    const fetcher = vi.fn(() => new Promise<Category[]>((r) => (resolve = r)));
    const p = new CategoriesProvider({ fetcher, now: () => 0 });
    const a = p.get();
    const b = p.get();
    resolve(CATS);
    expect(await a).toEqual(CATS);
    expect(await b).toEqual(CATS);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns [] on failure WITHOUT caching it — the next call retries", async () => {
    const fetcher = vi
      .fn<() => Promise<Category[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(CATS);
    const p = new CategoriesProvider({ fetcher, now: () => 0 });
    expect(await p.get()).toEqual([]); // failure → empty, not cached
    expect(await p.get()).toEqual(CATS); // retried, now succeeds
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reset() forces a refetch", async () => {
    const fetcher = vi.fn(async () => CATS);
    const p = new CategoriesProvider({ fetcher, now: () => 0, ttlMs: 1000 });
    await p.get();
    p.reset();
    await p.get();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("default fetcher enriches the category list with per-category counts (one count call)", async () => {
    const { calls } = stubCatalog();
    const p = new CategoriesProvider({ now: () => 0 }); // real default fetcher
    const cats = await p.get();

    expect(cats.find((c) => c.slug === "smartphones")?.count).toBe(2);
    expect(cats.find((c) => c.slug === "laptops")?.count).toBe(1);
    // exactly two endpoints behind the cache — the list + ONE count call
    expect(calls.some((u) => u.includes("/products/categories"))).toBe(true);
    expect(calls.filter((u) => /\/products\?/.test(u))).toHaveLength(1);
  });

  it("degrades to a count-less list when the count call fails (counts are nice-to-have)", async () => {
    stubCatalog(false);
    const p = new CategoriesProvider({ now: () => 0 });
    const cats = await p.get();

    expect(cats.map((c) => c.slug)).toEqual(["smartphones", "laptops"]); // list still served
    expect(cats.every((c) => c.count === undefined)).toBe(true); // no counts, no crash
  });
});
