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
 * Agentic roster (orchestrator + sub-agents).
 * - orchestrator → the stronger MINI model: it makes the turn's nuanced judgments
 *   (multi-intent decomposition, hard-vs-soft constraints, what NOT to invent). nano
 *   was unreliable here — over-marking plain "under $100" as a hard constraint — so we
 *   pay for one solid planning call per turn rather than patching its output in code.
 * - discovery (the agentic product finder) → MINI: it drives the `product_search`
 *   tool to retrieve + relax (broaden a keyword, drop a soft constraint) without
 *   drifting off-topic — real judgment nano was inconsistent at. Runs up to
 *   MAX_PRODUCT_FINDERS×/turn, each capped at FINDER_MAX_STEPS tool turns.
 * - concierge → mini: user-facing prose (chit-chat + honest decline).
 */
export const ORCHESTRATOR_MODEL: MastraModelConfig = "openai/gpt-5.4-mini";
export const DISCOVERY_MODEL: MastraModelConfig = "openai/gpt-5.4-mini";
export const CONCIERGE_MODEL: MastraModelConfig = "openai/gpt-5.4-mini";
