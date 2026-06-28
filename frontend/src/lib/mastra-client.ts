import { MastraClient } from "@mastra/client-js";

/**
 * The single local user (mirrors the server's `RESOURCE_ID`, ARCHITECTURE §6). Mastra
 * scopes threads + working memory to this; for a local single-user app it's a constant.
 */
export const RESOURCE_ID = "local-user";

/** The agent thread/delete ops are scoped to (the generator owns conversation memory). */
export const AGENT_ID = "generator";

/** The pipeline workflow id (the front door for a turn, D9). */
export const PIPELINE_WORKFLOW_ID = "pipeline";

/**
 * Base URL of the Mastra server. Overridable for non-local deploys; defaults to the
 * Mastra dev/prod port. The FE is client-only (D11), so this is a browser-reachable URL.
 */
export const MASTRA_BASE_URL =
  process.env.NEXT_PUBLIC_MASTRA_URL ?? "http://localhost:4111";

/** Shared browser client to the Mastra endpoints (D8). */
export const mastraClient = new MastraClient({ baseUrl: MASTRA_BASE_URL });

export type { MastraClient };
