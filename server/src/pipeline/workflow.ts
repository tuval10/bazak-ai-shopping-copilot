import { workflowInputSchema, workflowOutputSchema } from "@bazak/shared";
import { createWorkflow } from "@mastra/core/workflows";
import { converseStep } from "./converse";
import { looseSchema } from "./step-schema";

/**
 * The turn as a Mastra workflow: a single `converse` step that runs the supervisor
 * agent loop (D15). The supervisor decides whether to discover, drives the
 * `find_products` tool to retrieve grounded products (streamed as cards as each finder
 * completes), and writes the reply. The deterministic workflow shell is just the
 * streaming rail + the persistence boundary; the "brains" are the supervisor + its
 * finder sub-agent. Exposed to the client as `POST /api/workflows/pipeline/stream` (D9).
 */
export const pipelineWorkflow = createWorkflow({
  id: "pipeline",
  inputSchema: looseSchema(workflowInputSchema),
  outputSchema: looseSchema(workflowOutputSchema),
})
  .then(converseStep)
  .commit();
