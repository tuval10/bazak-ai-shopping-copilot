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
