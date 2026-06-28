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
  };
}
