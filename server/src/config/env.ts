import { resolve, sep } from "node:path";

/**
 * The single local user. Mastra scopes working memory and threads to a
 * `resourceId`; for this local, single-user app it is a fixed constant
 * (ARCHITECTURE §6 "Identity").
 */
export const RESOURCE_ID = "local-user";

export interface ServerEnv {
  openaiApiKey: string;
  /** LibSQL connection string — an absolute file URL by default, `:memory:` in tests. */
  databaseUrl: string;
  /**
   * Max Product Discovery finders the orchestrator may spawn per turn (the LLM may
   * propose more; only this many run). Caps the per-turn fan-out.
   */
  maxProductFinders: number;
  /**
   * Max tool-calling turns the agentic finder may take per finder run (its
   * `product_search` calls + the final structured answer). Bounds cost/latency.
   * Worst case per turn ≈ maxProductFinders × finderMaxSteps tool calls.
   */
  finderMaxSteps: number;
}

/** Parse a positive integer env var, falling back to `fallback` when unset/invalid. */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * The server package root. `mastra dev` runs the bundle from
 * `<pkg>/.mastra/output`, so a relative `./data` would resolve there and vanish
 * on rebuild; strip that suffix to anchor the DB at the real package root.
 */
function packageRoot(): string {
  const cwd = process.cwd();
  const marker = `${sep}.mastra${sep}output`;
  return cwd.endsWith(marker) ? cwd.slice(0, -marker.length) : cwd;
}

export function loadEnv(): ServerEnv {
  const databaseUrl =
    process.env.DATABASE_URL ?? `file:${resolve(packageRoot(), "data", "mastra.db")}`;
  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    databaseUrl,
    maxProductFinders: parsePositiveInt(process.env.MAX_PRODUCT_FINDERS, 5),
    finderMaxSteps: parsePositiveInt(process.env.FINDER_MAX_STEPS, 4),
  };
}
