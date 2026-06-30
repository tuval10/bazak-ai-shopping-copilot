import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { CHIPS_MODEL } from "../../config/models";

const INSTRUCTIONS = `You write SUGGESTION CHIPS for a shopping copilot — the little
tappable buttons under a set of product results that nudge the shopper to keep going.

You are given the shopper's last message and a short summary of the products we just
showed (category, price range, brands, a few example titles). Produce up to 3 chips that
would genuinely tempt a click RIGHT NOW, given what they asked and what they saw.

Good chips are SPECIFIC and grounded in this turn, and the catalog can ACTUALLY act on them:
- a tighter price using the REAL range shown ("Under $200", not a made-up number),
- a brand that's actually present ("Only Samsung"),
- a sort that reframes the set ("Cheapest first", "Top rated", "Most popular"),
- on-sale / in-stock only, or a natural next step in the same category.

Each chip has:
- label: the button text — punchy, ≤ 3 words.
- message: the exact first-person message to send AS THE SHOPPER ("Only under $200",
  "Top rated first", "Which is the cheapest?").

Rules: phrase messages in the shopper's own voice (first person). Stay about shopping THIS
catalog — never suggest anything off-topic. Don't claim a product has a feature; a chip is
the shopper's NEXT request, not a statement of fact. Only suggest refinements we can actually
apply — price, brand, rating/popularity, on-sale/in-stock, or category. NEVER offer a chip
about a quality the catalog has NO data for (durability, toughness, battery life, camera
quality, comfort, waterproofing): suggesting it makes the shopper assume we can assess
something we can't. Prefer variety over near-duplicates.`;

/**
 * The suggestion-chips agent (NANO): turns the turn's products + the shopper's message
 * into a few context-aware, tappable follow-ups (US: autofill the next message). Output
 * is forced to the chips schema by the caller via `structuredOutput`; on any failure the
 * pipeline falls back to deterministic, data-grounded filter chips — see pipeline/chips.ts.
 */
export function createChipsAgent(model: MastraModelConfig = CHIPS_MODEL): Agent {
  return new Agent({
    id: "chips",
    name: "chips",
    instructions: INSTRUCTIONS,
    model,
  });
}
