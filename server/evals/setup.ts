import { resolve } from "node:path";

/**
 * Eval setup: vitest does NOT auto-load `.env`, and these evals hit real OpenAI
 * (agents + judge) and the live catalog. Load `server/.env`, force the eval-only
 * trace flag on, and fail fast with a clear message if no API key is present.
 */

// Node >=20.12 has process.loadEnvFile; .env is optional (CI may inject env directly).
try {
  (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.(
    resolve(process.cwd(), ".env"),
  );
} catch {
  // No .env file — rely on the ambient environment.
}

// Surface the turn trace (finders + tool calls) on the workflow output for grading.
process.env.EVAL_EXPOSE_TRACE ??= "1";

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY is required for LLM-judge evals (the agents and the judge call OpenAI). " +
      "Set it in server/.env or the environment, then re-run `npm run eval`.",
  );
}
