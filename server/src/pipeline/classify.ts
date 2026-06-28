import { workflowInputSchema } from "@bazak/shared";
import { createStep } from "@mastra/core/workflows";
import { type Classification, classificationSchema } from "./classification";
import { looseSchema } from "./step-schema";

/**
 * Minimal structural view of what classify needs from an agent: a `generate`
 * that returns structured output. Lets tests inject a fake instead of mocking
 * the model layer.
 */
export interface StructuredClassifier {
  generate(
    message: string,
    options: { structuredOutput: { schema: typeof classificationSchema } },
  ): Promise<{ object: unknown }>;
}

/**
 * Classify + extract (the first LLM step, D2). Validates the model's structured
 * output and guarantees a product turn carries at least one search — backfilling
 * one from the raw message so routing/retrieval always have something to work
 * with.
 */
export async function runClassify(
  message: string,
  classifier: StructuredClassifier,
): Promise<Classification> {
  const result = await classifier.generate(message, {
    structuredOutput: { schema: classificationSchema },
  });
  const classification = classificationSchema.parse(result.object);

  if (classification.kind === "product" && classification.searches.length === 0) {
    return {
      kind: "product",
      searches: [{ label: message, keywords: message }],
    };
  }
  return classification;
}

/** Workflow step wrapper: pulls the classifier agent from the Mastra instance. */
export const classifyStep = createStep({
  id: "classify",
  inputSchema: looseSchema(workflowInputSchema),
  outputSchema: looseSchema(classificationSchema),
  execute: async ({ inputData, mastra }) => {
    const { message } = workflowInputSchema.parse(inputData);
    const agent = mastra.getAgent("classifier") as unknown as StructuredClassifier;
    return runClassify(message, agent);
  },
});
