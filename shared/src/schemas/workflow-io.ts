import { z } from "zod";
import { productResultsPartSchema } from "./product-results";
import { suggestionChipSchema } from "./suggested-chips";

/**
 * Input to the pipeline workflow — the body of `POST /api/workflows/{id}/stream`
 * (D9). `resourceId` is the user (fixed for the local app), `threadId` the
 * conversation.
 */
export const workflowInputSchema = z.object({
  message: z.string().min(1),
  threadId: z.string(),
  resourceId: z.string(),
});

export type WorkflowInput = z.infer<typeof workflowInputSchema>;

/**
 * One supervisor tool invocation, recorded for EVALUATION only (not user-facing).
 * `args` is the raw tool input (a finder, a recommend/compare payload); `outcome`
 * is a coarse label ("ok" | "empty" | "notFound" | "limitReached"). Surfaced on the
 * workflow output only when `EVAL_EXPOSE_TRACE=1` so an LLM-judge can grade *which*
 * tools the agent chose; production turns never carry it.
 */
export const toolCallRecordSchema = z.object({
  tool: z.string(),
  args: z.unknown(),
  outcome: z.string(),
});

export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;

/**
 * The workflow's final (non-streamed) result: the assistant summary plus one
 * results group per intent. The same content is streamed incrementally as text +
 * `product-results` parts (D6); this is the aggregate shape for tests and
 * non-streaming callers.
 *
 * `finders` + `toolCalls` are optional EVAL-ONLY trace fields (see
 * `toolCallRecordSchema`): present only under `EVAL_EXPOSE_TRACE=1`, absent in
 * production so the user-facing contract is unchanged.
 */
export const workflowOutputSchema = z.object({
  message: z.string(),
  results: z.array(productResultsPartSchema),
  chips: z.array(suggestionChipSchema).default([]),
  finders: z.array(z.unknown()).optional(),
  toolCalls: z.array(toolCallRecordSchema).optional(),
});

export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;
