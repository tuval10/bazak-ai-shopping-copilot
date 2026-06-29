import { describe, expect, it, vi } from "vitest";
import type { Category } from "../../src/catalog";
import { CategoriesProvider } from "../../src/catalog/categories-provider";

const CATS: Category[] = [
  { slug: "smartphones", name: "smartphones" },
  { slug: "laptops", name: "laptops" },
];

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
});
