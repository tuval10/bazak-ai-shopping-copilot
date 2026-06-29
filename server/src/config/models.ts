import type { MastraModelConfig } from "@mastra/core/llm";

/**
 * Model selection (DECISIONS D2/D7): a small/fast model for classification +
 * extraction, a stronger one for response generation.
 *
 * Given as Mastra model-router strings (`provider/model`) so Mastra resolves the
 * provider with its own bundled AI-SDK and reads `OPENAI_API_KEY` from the
 * environment — avoiding a direct `@ai-sdk/openai` version coupling. Tests
 * inject a mock `LanguageModelV2` instead (Phase 4).
 */
export const CLASSIFIER_MODEL: MastraModelConfig = "openai/gpt-5.4-nano";
export const GENERATOR_MODEL: MastraModelConfig = "openai/gpt-5.4-mini";

/**
 * Agentic roster (supervisor + finder sub-agent).
 * - supervisor → the stronger MINI model: it drives the whole turn — decides whether
 *   to discover at all, calls `find_products` once per angle, reads the grounded
 *   results, and writes the user-facing reply (multi-intent decomposition, hard-vs-soft
 *   constraints, what NOT to invent, per-item reasoning). nano was unreliable at these
 *   judgments, so we pay for one capable agent driving the turn. Its tool-turns are
 *   bounded by SUPERVISOR_MAX_STEPS; actual finder runs by MAX_PRODUCT_FINDERS.
 * - discovery (the agentic product finder) → MINI: it drives the `product_search` +
 *   `category_browse` tools to retrieve + relax (broaden a keyword, browse a category,
 *   drop a soft constraint) without drifting off-topic. Each run is capped at
 *   FINDER_MAX_STEPS tool turns.
 */
export const SUPERVISOR_MODEL: MastraModelConfig = "openai/gpt-5.4-mini";
export const DISCOVERY_MODEL: MastraModelConfig = "openai/gpt-5.4-mini";
