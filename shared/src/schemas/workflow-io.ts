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
 * The workflow's final (non-streamed) result: the assistant summary plus one
 * results group per intent. The same content is streamed incrementally as text +
 * `product-results` parts (D6); this is the aggregate shape for tests and
 * non-streaming callers.
 */
export const workflowOutputSchema = z.object({
  message: z.string(),
  results: z.array(productResultsPartSchema),
  chips: z.array(suggestionChipSchema).default([]),
});

export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;
