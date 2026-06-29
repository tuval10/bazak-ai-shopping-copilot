import { workflowInputSchema } from "@bazak/shared";
import type { Mastra } from "@mastra/core";
import { createStep } from "@mastra/core/workflows";
import { loadEnv } from "../config/env";
import { type OrchestrationPlan, orchestrationPlanSchema, type SearchIntent } from "./classification";
import { looseSchema } from "./step-schema";

/**
 * Defensive normalization for a finder. Structured-output models often FILL optional
 * numeric fields with 0 instead of omitting them — and `maxPrice: 0` then filters out
 * every product. Treat zero/empty numeric+brand constraints as "unset" so an invented
 * 0 can't silently nuke results (the prompt also forbids inventing constraints, but
 * this is the deterministic backstop).
 */
function normalizeFinder(f: SearchIntent): SearchIntent {
  const out: SearchIntent = { ...f };
  if (out.maxPrice === 0) out.maxPrice = undefined;
  if (out.minPrice === 0) out.minPrice = undefined;
  if (out.minRating === 0) out.minRating = undefined;
  if (out.brands && out.brands.length === 0) out.brands = undefined;
  return out;
}

/**
 * Minimal structural view of what orchestrate needs from an agent: a `generate`
 * that returns structured output. Lets tests inject a fake instead of mocking the
 * model layer.
 */
export interface StructuredOrchestrator {
  generate(
    message: string,
    options: { structuredOutput: { schema: typeof orchestrationPlanSchema } },
  ): Promise<{ object: unknown }>;
}

/**
 * Builds the orchestrator prompt. With prior-turn context (US-4.5) it frames the
 * recent conversation so an implicit refinement ("show me cheaper", "the second
 * one") can be rewritten into a full, standalone finder.
 */
export function buildOrchestratePrompt(message: string, priorContext?: string): string {
  if (!priorContext) return message;
  return [
    "Recent conversation (use it to resolve follow-ups like \"show me cheaper\" or",
    '"the second one" into a complete, standalone finder):',
    priorContext,
    "",
    `Current message: ${message}`,
  ].join("\n");
}

/**
 * Orchestrate (the planning LLM step). Validates the model's structured output,
 * enforces the per-turn finder cap (MAX_PRODUCT_FINDERS — the LLM may propose more,
 * only this many run), and guarantees a product turn carries at least one finder
 * (backfilling from the raw message). `priorContext` (US-4.5) lets it resolve
 * follow-ups; it stays a single LLM call.
 */
export async function runOrchestrate(
  message: string,
  orchestrator: StructuredOrchestrator,
  options: { priorContext?: string; maxFinders?: number } = {},
): Promise<OrchestrationPlan> {
  const result = await orchestrator.generate(
    buildOrchestratePrompt(message, options.priorContext),
    { structuredOutput: { schema: orchestrationPlanSchema } },
  );
  const parsed = orchestrationPlanSchema.parse(result.object);
  const plan = { ...parsed, finders: parsed.finders.map(normalizeFinder) };

  // A continuation ("show me more") legitimately carries no finders — discovery
  // reuses the prior turn's. Pass it straight through (don't backfill a literal
  // "show me more" finder, and keep the flag so discovery knows to page forward).
  if (plan.continuation) return plan;

  // Backfill: a product turn with no extracted finders still retrieves something.
  if (plan.kind === "product" && plan.finders.length === 0) {
    return { kind: "product", finders: [{ label: message, keywords: message }] };
  }

  // Hard cap the fan-out regardless of what the model proposed.
  const max = options.maxFinders ?? Number.POSITIVE_INFINITY;
  if (plan.finders.length > max) {
    return { ...plan, finders: plan.finders.slice(0, max) };
  }
  return plan;
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
 * A compact digest of the last few turns for orchestrator context (US-4.5). Read-only:
 * pulls recent thread messages via the generator agent's memory. Best-effort — any
 * failure (no memory, fresh thread) yields no context and orchestrate proceeds.
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

/** Workflow step wrapper: pulls the orchestrator agent + recent context from Mastra. */
export const orchestrateStep = createStep({
  id: "orchestrate",
  inputSchema: looseSchema(workflowInputSchema),
  outputSchema: looseSchema(orchestrationPlanSchema),
  execute: async ({ inputData, mastra }) => {
    const { message, threadId, resourceId } = workflowInputSchema.parse(inputData);
    const agent = mastra.getAgent("orchestrator") as unknown as StructuredOrchestrator;
    const priorContext = await recentTurnsDigest(mastra, threadId, resourceId);
    return runOrchestrate(message, agent, {
      priorContext,
      maxFinders: loadEnv().maxProductFinders,
    });
  },
});
