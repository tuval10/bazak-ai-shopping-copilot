import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { pipelineWorkflow } from "../pipeline/workflow";
import { loadEnv } from "../config/env";
import { createClassifierAgent } from "./agents/classifier";
import { createGeneratorAgent } from "./agents/generator";
import { createMemory } from "./memory";

const env = loadEnv();

/** Shared conversation + preference store (D4). */
export const memory = createMemory(env.databaseUrl);

/**
 * The Mastra instance. Registering the agents + storage brings up Mastra's
 * built-in endpoints (D9) — `/api/memory/threads…` for conversations. The
 * pipeline workflow is registered here in Phase 4.
 */
export const mastra = new Mastra({
  storage: new LibSQLStore({ id: "bazak-storage", url: env.databaseUrl }),
  agents: {
    classifier: createClassifierAgent(),
    generator: createGeneratorAgent(memory),
  },
  workflows: {
    pipeline: pipelineWorkflow,
  },
});
