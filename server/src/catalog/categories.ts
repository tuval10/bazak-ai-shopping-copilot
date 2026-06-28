import { z } from "zod";

/** A catalog category as returned by `/products/categories`. */
export const categorySchema = z.object({
  slug: z.string(),
  name: z.string(),
  url: z.string().optional(),
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
