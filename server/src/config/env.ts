/**
 * The single local user. Mastra scopes working memory and threads to a
 * `resourceId`; for this local, single-user app it is a fixed constant
 * (ARCHITECTURE §6 "Identity").
 */
export const RESOURCE_ID = "local-user";

export interface ServerEnv {
  openaiApiKey: string;
  /** LibSQL connection string — a local file by default, `:memory:` in tests. */
  databaseUrl: string;
}

export function loadEnv(): ServerEnv {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "file:./data/mastra.db",
  };
}
