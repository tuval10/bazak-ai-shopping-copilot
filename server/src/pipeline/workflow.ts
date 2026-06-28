import { workflowInputSchema, workflowOutputSchema } from "@bazak/shared";
import { createWorkflow } from "@mastra/core/workflows";
import { classifyStep } from "./classify";
import { generateStep } from "./generate";
import { retrieveStep } from "./retrieve";
import { looseSchema } from "./step-schema";

/**
 * The D2 pipeline as a Mastra workflow: classify → retrieve → generate. The two
 * LLM steps (classify, generate) bracket plain, deterministic retrieval. Exposed
 * to the client as `POST /api/workflows/pipeline/stream` (D9).
 */
export const pipelineWorkflow = createWorkflow({
  id: "pipeline",
  inputSchema: looseSchema(workflowInputSchema),
  outputSchema: looseSchema(workflowOutputSchema),
})
  .then(classifyStep)
  .then(retrieveStep)
  .then(generateStep)
  .commit();
