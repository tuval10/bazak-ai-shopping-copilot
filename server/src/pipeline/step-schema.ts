import type { z } from "zod";

/**
 * Mastra's `createStep`/`createWorkflow` generics infer step IO from the Zod
 * schema *types*. Our schemas nest deeply enough (Product → results → workflow
 * output) that the inference hits TS2589 ("excessively deep").
 *
 * `looseSchema` returns the schema unchanged at runtime (so Mastra still
 * validates against the real schema) but types it as `any`, which severs the
 * compile-time inference. The real, fully-typed contracts live in the `run*`
 * core functions, which are unit tested directly; the step `execute` bodies
 * re-parse their input with the real schema to recover typed locals.
 */
// biome-ignore lint/suspicious/noExplicitAny: intentional — see doc comment.
export function looseSchema(schema: z.ZodType): any {
  return schema;
}
