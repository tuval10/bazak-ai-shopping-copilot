import { workflowInputSchema, workflowOutputSchema } from "@bazak/shared";
import { createWorkflow } from "@mastra/core/workflows";
import { discoverStep } from "./discovery";
import { generateStep } from "./generate";
import { orchestrateStep } from "./orchestrate";
import { looseSchema } from "./step-schema";

/**
 * The agentic pipeline as a Mastra workflow: orchestrate → discover → synthesize.
 * The deterministic workflow spine is the streaming/grounding rail; the "brains"
 * live in the steps — orchestrator (plan + finders), discovery (budgeted relaxation
 * fan-out), generator/concierge (grounded prose + chips). Fan-out across finders is
 * an implementation detail INSIDE discoverStep (Promise.all), not workflow-level
 * `.parallel()`, because the finder count is dynamic. Exposed to the client as
 * `POST /api/workflows/pipeline/stream` (D9).
 */
export const pipelineWorkflow = createWorkflow({
  id: "pipeline",
  inputSchema: looseSchema(workflowInputSchema),
  outputSchema: looseSchema(workflowOutputSchema),
})
  .then(orchestrateStep)
  .then(discoverStep)
  .then(generateStep)
  .commit();
