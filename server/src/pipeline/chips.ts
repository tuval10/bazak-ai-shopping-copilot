import {
  type Product,
  type SuggestionChip,
  suggestedChipsPartSchema,
} from "@bazak/shared";
import type { RetrieveState } from "./retrieve";

/** Minimal structural view of an agent that can phrase follow-up chips (injectable). */
export interface StructuredChips {
  generate(
    message: string,
    options: { structuredOutput: { schema: typeof suggestedChipsPartSchema } },
  ): Promise<{ object: unknown }>;
}

/** Round a price up to a "nice" band so a filter chip reads cleanly. */
function niceBand(n: number): number {
  if (n <= 20) return Math.ceil(n / 5) * 5;
  if (n <= 100) return Math.ceil(n / 10) * 10;
  return Math.ceil(n / 50) * 50;
}

/**
 * Filter-style chips when results are abundant — every OPTION is derived from the
 * actual retrieved products (real price spread, brands present), so a chip can never
 * point at something we don't have (grounding, US-5.1).
 */
function filterChips(products: Product[]): SuggestionChip[] {
  const chips: SuggestionChip[] = [
    { label: "Cheapest first", message: "sort these by cheapest first" },
    { label: "Top rated", message: "show me the top-rated ones" },
  ];
  const prices = products.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max - min > 1) {
    const band = niceBand((min + max) / 2);
    chips.push({ label: `Under $${band}`, message: `only show the ones under $${band}` });
  }
  const brands = [...new Set(products.map((p) => p.brand).filter((b): b is string => Boolean(b)))];
  if (brands.length > 1) {
    chips.push({ label: `Only ${brands[0]}`, message: `only show ${brands[0]}` });
  }
  return chips.slice(0, 4);
}

/** Deterministic fallback follow-up chips (used when no agent, or on parse failure). */
function fallbackFollowUp(state: RetrieveState): SuggestionChip[] {
  if (state.kind === "off_catalog") {
    return [
      { label: "Travel essentials", message: "show me travel essentials" },
      { label: "Most popular", message: "what are your most popular items?" },
    ];
  }
  return [
    { label: "Show similar", message: "show me similar options" },
    { label: "Most popular", message: "show me your most popular items" },
  ];
}

/** A compact, grounded summary of what we showed, so model chips reference REAL options. */
function productContext(products: Product[]): string {
  const prices = products.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const brands = [...new Set(products.map((p) => p.brand).filter((b): b is string => Boolean(b)))];
  const cats = [...new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))];
  const titles = products.slice(0, 5).map((p) => p.title);
  return [
    `Category: ${cats.join(", ") || "various"}.`,
    `Price range: $${min}–$${max}.`,
    brands.length ? `Brands present: ${brands.slice(0, 5).join(", ")}.` : "",
    `Examples: ${titles.join("; ")}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Model-authored, context-aware chips grounded in the products we just showed — the
 * enticing "Best camera quality" / "Under $200" refinements. Empty on failure so the
 * caller can drop to the deterministic, data-grounded filter chips.
 */
async function refinementChips(
  message: string,
  products: Product[],
  agent: StructuredChips,
): Promise<SuggestionChip[]> {
  const prompt = [
    `The shopper said: "${message}".`,
    `We just showed them these products. ${productContext(products)}`,
    "Write up to 3 tappable follow-up chips that would tempt them to keep shopping —",
    "use the real price range, features they may want next, or a brand present.",
  ].join("\n");
  try {
    const res = await agent.generate(prompt, {
      structuredOutput: { schema: suggestedChipsPartSchema },
    });
    const parsed = suggestedChipsPartSchema.safeParse(res.object);
    if (parsed.success && parsed.data.chips.length > 0) return parsed.data.chips.slice(0, 4);
  } catch {
    // fall through to deterministic chips
  }
  return [];
}

/** Model-authored, context-aware follow-up chips with a deterministic fallback. */
async function followUpChips(
  message: string,
  state: RetrieveState,
  agent?: StructuredChips,
): Promise<SuggestionChip[]> {
  if (!agent) return fallbackFollowUp(state);
  const context =
    state.kind === "off_catalog"
      ? "We can't fulfil this directly but showed some adjacent products."
      : "We found few or no exact matches and showed alternatives.";
  const prompt = [
    `The user said: "${message}".`,
    context,
    "Suggest up to 3 short follow-up messages the user could tap to keep shopping,",
    'phrased in the user\'s own first-person voice (e.g. "What should I buy for my flight?").',
    "Each chip needs a short button label and the exact message to send.",
  ].join("\n");
  try {
    const res = await agent.generate(prompt, {
      structuredOutput: { schema: suggestedChipsPartSchema },
    });
    const parsed = suggestedChipsPartSchema.safeParse(res.object);
    if (parsed.success && parsed.data.chips.length > 0) return parsed.data.chips.slice(0, 4);
  } catch {
    // fall through to deterministic chips
  }
  return fallbackFollowUp(state);
}

/**
 * Build a turn's suggestion chips (US: autofill the next message). When we showed
 * products, prefer MODEL-authored, context-aware refinements grounded in those products
 * ("Best camera quality", "Under $200"), falling back to deterministic, data-grounded
 * filter chips if the model is absent or fails — never the generic "Show similar". No
 * products (empty / off-catalog) → context-aware follow-up chips. Pure chit-chat gets
 * none. Never throws — chips are best-effort UX.
 */
export async function generateChips(args: {
  state: RetrieveState;
  message: string;
  agent?: StructuredChips;
}): Promise<SuggestionChip[]> {
  const { state, message, agent } = args;
  if (state.kind === "chitchat") return [];

  const products = state.results.flatMap((r) => r.products);
  if (products.length === 0) return followUpChips(message, state, agent);

  // We have products: enticing model chips first, deterministic grounded chips as fallback.
  if (agent) {
    const refined = await refinementChips(message, products, agent);
    if (refined.length > 0) return refined;
  }
  return filterChips(products);
}
