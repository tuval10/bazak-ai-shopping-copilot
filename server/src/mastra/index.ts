import { Mastra } from "@mastra/core";
import { profileRoutes } from "../api/profile";
import { logger } from "../observability/logger";
import { pipelineWorkflow } from "../pipeline/workflow";
import { createChipsAgent } from "./agents/chips";
import { createDiscoveryAgent } from "./agents/discovery";
import { createSupervisorAgent } from "./agents/supervisor";
import { memory, storage } from "./store";

export { memory };

/**
 * The Mastra instance. Registering the agents + storage + workflow brings up
 * Mastra's built-in endpoints (D9): `/api/memory/threads…` for conversations and
 * `/api/workflows/pipeline/stream` for a turn. The custom profile route (D9a) is
 * added under `server.apiRoutes`.
 */
export const mastra = new Mastra({
  storage,
  logger,
  agents: {
    // Agentic roster (D15): the supervisor drives the turn and holds Memory so it
    // persists the transcript (US-3.1) + learns preferences (US-7.1); discovery is the
    // stateless finder sub-agent the supervisor's `find_products` tool invokes. Both
    // are registered as real agents → visible in Mastra Studio traces.
    supervisor: createSupervisorAgent(memory),
    discovery: createDiscoveryAgent(),
    // Stateless helper: phrases the turn's context-aware suggestion chips (cheap nano).
    chips: createChipsAgent(),
  },
  workflows: {
    pipeline: pipelineWorkflow,
  },
  server: {
    apiRoutes: profileRoutes,
    // Allow the standalone frontend (a separate origin, e.g. localhost:3000) to call
    // the API from the browser (D11 — the FE is client-only, no proxy). Local single
    // user, so a permissive origin is fine; expose nothing sensitive. PATCH/PUT are
    // needed for thread rename and working-memory writes.
    cors: {
      origin: "*",
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    },
  },
});
