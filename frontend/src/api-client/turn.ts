import {
  PRODUCT_RESULTS_PART_TYPE,
  type ProductResultsPart,
  productResultsPartSchema,
} from "@bazak/shared";
import {
  type MastraClient,
  PIPELINE_WORKFLOW_ID,
  RESOURCE_ID,
  mastraClient,
} from "@/lib/mastra-client";

/**
 * A turn's progressive state, yielded as the workflow stream advances: product-card
 * groups accumulate as `data-product-results` parts arrive (D6); the prose `text`
 * lands at the end (the generate step returns full text — prose is not token-streamed).
 */
export interface TurnState {
  groups: ProductResultsPart[];
  text: string;
  status: "streaming" | "done";
}

/** A workflow-stream chunk, kept loose — we read fields defensively (see `parseTurnStream`). */
export interface RawTurnChunk {
  type?: string;
  payload?: unknown;
  data?: unknown;
  [key: string]: unknown;
}

/** The generate step's terminal output carried on a `workflow-step-result` chunk. */
interface FinalOutput {
  message: string;
  results: ProductResultsPart[];
}

/**
 * Pull the product-results payload out of a data part. Mastra surfaces a custom part
 * (`writer.custom({ type, data })`) as a stream chunk; depending on the layer the body
 * sits under `data`, `payload.data`, or `payload`. Try each, then validate.
 */
function extractProductPart(chunk: RawTurnChunk): ProductResultsPart | null {
  const payload = chunk.payload as { data?: unknown } | undefined;
  for (const candidate of [chunk.data, payload?.data, chunk.payload]) {
    const parsed = productResultsPartSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * Pull the terminal `{ message, results }` out of whatever chunk carries it. The generate
 * step's output rides on a `workflow-step-result` chunk under `payload.output`; we accept
 * `payload.output`, `payload`, or `data` and require BOTH a string `message` and a
 * `results` array, which uniquely identifies the generate output (classify/retrieve
 * outputs have one but not both).
 */
function extractFinalOutput(chunk: RawTurnChunk): FinalOutput | null {
  const payload = chunk.payload as { output?: unknown } | undefined;
  for (const candidate of [payload?.output, chunk.payload, chunk.data]) {
    const c = candidate as { message?: unknown; results?: unknown } | undefined;
    if (!c || typeof c.message !== "string" || !Array.isArray(c.results)) continue;
    const results: ProductResultsPart[] = [];
    let allValid = true;
    for (const r of c.results) {
      const parsed = productResultsPartSchema.safeParse(r);
      if (!parsed.success) {
        allValid = false;
        break;
      }
      results.push(parsed.data);
    }
    if (allValid) return { message: c.message, results };
  }
  return null;
}

/**
 * The pure stream parser: fold a sequence of raw workflow chunks into progressive
 * `TurnState`s. Yields once per product group (cards appear as each intent resolves)
 * and a final `done` state carrying the prose + authoritative results. Decoupled from
 * the transport so it's unit-tested against canned chunks.
 */
export async function* parseTurnStream(
  chunks: AsyncIterable<RawTurnChunk>,
): AsyncGenerator<TurnState> {
  const groups: ProductResultsPart[] = [];
  let text = "";
  let finalResults: ProductResultsPart[] | null = null;

  for await (const chunk of chunks) {
    if (!chunk || typeof chunk.type !== "string") continue;

    if (chunk.type === PRODUCT_RESULTS_PART_TYPE) {
      const part = extractProductPart(chunk);
      if (part) {
        groups.push(part);
        yield { groups: [...groups], text, status: "streaming" };
      }
      continue;
    }

    const final = extractFinalOutput(chunk);
    if (final) {
      text = final.message;
      finalResults = final.results;
    }
  }

  // Prefer the generate step's authoritative results; fall back to what streamed in.
  const resolved = finalResults && finalResults.length > 0 ? finalResults : groups;
  yield { groups: resolved, text, status: "done" };
}

/** ReadableStream → async iterable, tolerant of runtimes where it isn't already iterable. */
async function* toAsyncIterable<T>(stream: ReadableStream<T> | AsyncIterable<T>): AsyncIterable<T> {
  if (Symbol.asyncIterator in (stream as AsyncIterable<T>)) {
    yield* stream as AsyncIterable<T>;
    return;
  }
  const reader = (stream as ReadableStream<T>).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Run one turn through the pipeline workflow and stream its progressive state (D9).
 * Throws on a transport/stream error so the caller can show the retry fallback (US-5.2).
 */
export async function* runTurn(
  args: { threadId: string; message: string },
  client: MastraClient = mastraClient,
): AsyncGenerator<TurnState> {
  const workflow = client.getWorkflow(PIPELINE_WORKFLOW_ID);
  const run = await workflow.createRun();
  const stream = await run.stream({
    inputData: { message: args.message, threadId: args.threadId, resourceId: RESOURCE_ID },
  });
  yield* parseTurnStream(toAsyncIterable(stream as unknown as ReadableStream<RawTurnChunk>));
}
