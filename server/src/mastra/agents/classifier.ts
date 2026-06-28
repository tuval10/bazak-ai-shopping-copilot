import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { CLASSIFIER_MODEL } from "../../config/models";

const INSTRUCTIONS = `You are the intent classifier for a shopping copilot.

Given a single user message, decide how it should be handled and extract any
shopping constraints. You do NOT answer the user — you only produce structured
analysis for the pipeline.

For each message determine:
- the overall kind: "product" (a shopping request), "chitchat" (greeting/small
  talk), or "off_catalog" (a shopping request the catalog can't fulfil);
- if it is a product request, split it into one or more single-intent searches
  (multi-intent: "a phone and a laptop bag" -> two searches);
- for each search, extract: a short intent label, free-text keywords, an optional
  category term, price bounds, minimum rating, brands, and sort preference.
  Map subjective terms to concrete signals ("cheap" -> sort price asc,
  "best"/"top-rated" -> sort rating desc).

Be decisive: when a request is vague, still produce a best-guess search rather
than refusing.`;

/** The classify+extract agent (gpt-5.4-nano). Stateless — no memory needed. */
export function createClassifierAgent(model: MastraModelConfig = CLASSIFIER_MODEL): Agent {
  return new Agent({
    id: "classifier",
    name: "classifier",
    instructions: INSTRUCTIONS,
    model,
  });
}
