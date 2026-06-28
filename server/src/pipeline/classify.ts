import { workflowInputSchema } from "@bazak/shared";
import type { Mastra } from "@mastra/core";
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
 * Builds the classifier prompt. With prior-turn context (US-4.5) it frames the
 * recent conversation so an implicit refinement ("show me cheaper", "the second
 * one") can be rewritten into a full, standalone search; without it, the raw
 * message is classified as before.
 */
export function buildClassifyPrompt(message: string, priorContext?: string): string {
  if (!priorContext) return message;
  return [
    "Recent conversation (use it to resolve follow-ups like \"show me cheaper\" or",
    '"the second one" into a complete, standalone search):',
    priorContext,
    "",
    `Current message: ${message}`,
  ].join("\n");
}

/**
 * Classify + extract (the first LLM step, D2). Validates the model's structured
 * output and guarantees a product turn carries at least one search — backfilling
 * one from the raw message so routing/retrieval always have something to work
 * with. `priorContext` (US-4.5) lets the classifier resolve follow-ups against the
 * previous turns; it stays a single LLM call.
 */
export async function runClassify(
  message: string,
  classifier: StructuredClassifier,
  priorContext?: string,
): Promise<Classification> {
  const result = await classifier.generate(buildClassifyPrompt(message, priorContext), {
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

/** Text of a stored message, flattening its content parts to a plain string. */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  const parts = (content as { parts?: Array<{ type?: string; text?: string }> })?.parts ?? [];
  return parts
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

/**
 * A compact digest of the last few turns for classifier context (US-4.5). Read-only:
 * pulls recent thread messages via the generator agent's memory. Best-effort — any
 * failure (no memory, fresh thread) yields no context and classify proceeds as before.
 */
async function recentTurnsDigest(
  mastra: Mastra,
  threadId: string,
  resourceId: string,
): Promise<string | undefined> {
  try {
    const mem = await mastra.getAgent("generator").getMemory();
    if (!mem) return undefined;
    const { messages } = await mem.recall({ threadId, resourceId, perPage: 6, page: 0 });
    const lines = messages
      .map((m) => ({ role: m.role, text: messageText(m.content) }))
      .filter((t) => t.text)
      .slice(-6)
      .map((t) => `${t.role}: ${t.text}`);
    return lines.length ? lines.join("\n") : undefined;
  } catch {
    return undefined;
  }
}

/** Workflow step wrapper: pulls the classifier agent + recent context from Mastra. */
export const classifyStep = createStep({
  id: "classify",
  inputSchema: looseSchema(workflowInputSchema),
  outputSchema: looseSchema(classificationSchema),
  execute: async ({ inputData, mastra }) => {
    const { message, threadId, resourceId } = workflowInputSchema.parse(inputData);
    const agent = mastra.getAgent("classifier") as unknown as StructuredClassifier;
    const priorContext = await recentTurnsDigest(mastra, threadId, resourceId);
    return runClassify(message, agent, priorContext);
  },
});
