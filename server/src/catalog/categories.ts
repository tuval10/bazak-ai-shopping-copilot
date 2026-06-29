import { z } from "zod";

/** A catalog category as returned by `/products/categories`. */
export const categorySchema = z.object({
  slug: z.string(),
  name: z.string(),
  url: z.string().optional(),
  /**
   * How many products this category holds, derived from a single
   * `/products?limit=0&select=category` count (US-1.6). Optional: present when the
   * provider could enrich the list, omitted (and so dropped from the prompt) otherwise.
   */
  count: z.number().int().nonnegative().optional(),
});
export type Category = z.infer<typeof categorySchema>;

export const categoryListSchema = z.array(categorySchema);

/**
 * Common user term → catalog slug synonyms (US-1.6). Catalog categories are the
 * source of truth; this only nudges everyday words toward the right slug before
 * the fuzzy fallback runs.
 */
const SYNONYMS: Record<string, string> = {
  phone: "smartphones",
  phones: "smartphones",
  smartphone: "smartphones",
  laptop: "laptops",
  computer: "laptops",
  perfume: "fragrances",
  fragrance: "fragrances",
  makeup: "beauty",
  cosmetics: "beauty",
  glasses: "sunglasses",
  watch: "mens-watches",
  furniture: "furniture",
  decoration: "home-decoration",
  grocery: "groceries",
  food: "groceries",
};

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Render the category list for prompt injection: one `slug — name (N items)` line
 * per category (the count is appended only when known, so a count-less list still
 * renders cleanly). Empty string when there are none, so the caller can omit the
 * block. Slug-first because agents must copy the SLUG verbatim — `resolveCategorySlug`
 * matches on exact slug first, and the finder/orchestrator emit slugs, not names.
 * The count lets the orchestrator judge how thin a category is (e.g. broaden a
 * finder when a category holds only a couple of items).
 */
export function formatCategoryList(categories: Category[]): string {
  return categories
    .map((c) => {
      const suffix = c.count === undefined ? "" : ` (${c.count} ${c.count === 1 ? "item" : "items"})`;
      return `${c.slug} — ${c.name}${suffix}`;
    })
    .join("\n");
}

/**
 * Resolve a user category term to a real catalog slug, or `null` if nothing is a
 * reasonable match. Order: exact slug → exact name → synonym → substring match.
 * Suggestions for US-4.2 are always drawn from real categories, never invented.
 */
export function resolveCategorySlug(
  term: string,
  categories: Category[],
): string | null {
  const t = normalize(term);
  if (!t) return null;

  const bySlug = categories.find((c) => normalize(c.slug) === t);
  if (bySlug) return bySlug.slug;

  const byName = categories.find((c) => normalize(c.name) === t);
  if (byName) return byName.name === undefined ? null : byName.slug;

  const synonym = SYNONYMS[t];
  if (synonym && categories.some((c) => c.slug === synonym)) return synonym;

  // Substring either direction: "men watches" ~ "mens-watches".
  const tokens = t.split(/\s+/).filter(Boolean);
  const bySubstring = categories.find((c) => {
    const hay = `${normalize(c.slug)} ${normalize(c.name)}`.replace(/-/g, " ");
    return tokens.every((tok) => hay.includes(tok));
  });
  return bySubstring ? bySubstring.slug : null;
}
