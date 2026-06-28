import { z } from "zod";

/**
 * Mastra declares workflow/step IO with Zod schemas and, at boot, converts them
 * to JSON Schema (for Studio/OpenAPI) using zod's v4 converter. Our nested
 * schemas (Product → results, optionals/defaults) both (a) explode TS inference
 * (TS2589) and (b) hit "non-representable optional" in that converter.
 *
 * `looseSchema` sidesteps both: the step/workflow declares `z.any()` (trivially
 * convertible, no validation/stripping, so data flows between steps intact),
 * while the real, fully-typed contracts live in the `run*` core functions and
 * each step `execute` re-parses its input with the real schema. The schema arg
 * is kept only to document intent at the call site.
 */
// biome-ignore lint/suspicious/noExplicitAny: intentional — see doc comment.
export function looseSchema(_schema: z.ZodType): any {
  return z.any();
}
