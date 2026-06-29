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
 * Build a turn's suggestion chips (US: autofill the next message). Abundant results
 * → deterministic filter chips with data-grounded options. Weak/empty/off-catalog
 * → context-aware follow-up chips (model-authored, deterministic fallback). Pure
 * chit-chat gets none. Never throws — chips are best-effort UX.
 */
export async function generateChips(args: {
  state: RetrieveState;
  message: string;
  agent?: StructuredChips;
}): Promise<SuggestionChip[]> {
  const { state, message, agent } = args;
  if (state.kind === "chitchat") return [];

  const products = state.results.flatMap((r) => r.products);
  const relaxed = state.results.some((r) => r.relaxed);
  const abundant =
    state.kind === "product" && !relaxed && state.results.length > 0 && products.length >= 3;

  return abundant ? filterChips(products) : followUpChips(message, state, agent);
}
