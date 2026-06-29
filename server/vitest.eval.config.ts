import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Separate config for the LLM-as-judge evals (`npm run eval`). They hit real models +
 * the live catalog, so they are slow and NOT part of `npm test` — kept under `evals/`
 * (the default config only includes `tests/**`). Runs serially to avoid rate limits.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@bazak/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["evals/**/*.eval.ts"],
    environment: "node",
    setupFiles: ["./evals/setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
