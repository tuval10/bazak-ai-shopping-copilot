import { Mastra } from "@mastra/core";
import { MastraStorageExporter, Observability } from "@mastra/observability";
import { profileRoutes } from "../api/profile";
import { logger } from "../observability/logger";
import { pipelineWorkflow } from "../pipeline/workflow";
import { createChipsAgent } from "./agents/chips";
import { createDiscoveryAgent } from "./agents/discovery";
import { createSupervisorAgent } from "./agents/supervisor";
import { memory, storage } from "./store";
import { registerStudioTools } from "./tools/studio-tools";

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
  // Turns on Mastra AI tracing. The MastraStorageExporter persists trace spans
  // to the LibSQL `storage` above so Mastra Studio's Observability → Traces tab
  // can read them. Captures agent `.generate()` runs, LLM steps, and tool calls
  // (including the ones injected per-run via `toolsets` in the pipeline).
  observability: new Observability({
    configs: {
      default: {
        serviceName: "bazak",
        exporters: [new MastraStorageExporter()],
      },
    },
  }),
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

// Surface standalone copies of the catalog tools in Mastra Studio's Tools page. This is
// playground-only and does NOT affect agent runs — turns inject their own per-run tools
// via `toolsets` (Mastra's top-level tool registry is never auto-injected into agents).
// Added after construction so find_products can resolve the registered `discovery` agent.
registerStudioTools(mastra);
