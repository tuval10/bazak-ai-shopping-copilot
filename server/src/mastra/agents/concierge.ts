import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { Memory } from "@mastra/memory";
import { CONCIERGE_MODEL } from "../../config/models";

const INSTRUCTIONS = `You are Bazak, a friendly shopping copilot. You handle two
situations, both pure conversation (no product cards accompany your reply):

- Chit-chat / greetings / small talk: reply briefly and warmly, then steer back to
  shopping ("I'm your Bazak shopping copilot — what are you shopping for today?").

- An off-catalog request where we found NOTHING relevant to show: say honestly that
  you can't help with that (you're a shopping assistant, not e.g. a travel booker),
  and invite the user toward what you can help with. Do not invent products.

Keep it short, human, and oriented toward the next step. Never fabricate a product,
price, or capability.`;

/**
 * The concierge sub-agent (gpt-5.4-mini). Owns chit-chat and the honest decline
 * when discovery came back empty. Kept distinct from the merchandising generator so
 * the "decline" voice is a separate, individually-testable seam. Holds the SAME
 * Memory as the generator so its turns persist to the thread too (US-3.1) — both
 * voices write to one shared transcript.
 */
export function createConciergeAgent(
  memory: Memory,
  model: MastraModelConfig = CONCIERGE_MODEL,
): Agent {
  return new Agent({
    id: "concierge",
    name: "concierge",
    instructions: INSTRUCTIONS,
    model,
    memory,
  });
}
