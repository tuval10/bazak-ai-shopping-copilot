import { Mastra } from "@mastra/core";
import { profileRoutes } from "../api/profile";
import { pipelineWorkflow } from "../pipeline/workflow";
import { createClassifierAgent } from "./agents/classifier";
import { createGeneratorAgent } from "./agents/generator";
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
  agents: {
    classifier: createClassifierAgent(),
    generator: createGeneratorAgent(memory),
  },
  workflows: {
    pipeline: pipelineWorkflow,
  },
  server: {
    apiRoutes: profileRoutes,
  },
});
