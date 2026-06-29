import {
  type Product,
  type ProductResultsPart,
  RESULTS_METADATA_KEY,
  type SuggestionChip,
  type ToolCallRecord,
  type WorkflowInput,
  workflowInputSchema,
  workflowOutputSchema,
} from "@bazak/shared";
import type { Mastra } from "@mastra/core";
import { createStep } from "@mastra/core/workflows";
import { categoriesProvider, type Category, formatCategoryList } from "../catalog";
import { loadEnv } from "../config/env";
import { createCompareProductsTool } from "../mastra/tools/compare-products";
import { createFindProductsTool, type FindProductsInput } from "../mastra/tools/find-products";
import { createRecommendProductTool } from "../mastra/tools/recommend-product";
import { logger } from "../observability/logger";
import { generateChips, type StructuredChips } from "./chips";
import { type SearchIntent } from "./classification";
import { type AgenticFinder } from "./discovery";
import { type PartWriter, persistTurnResults } from "./generate";
import { type CatalogDeps, defaultDeps, type RetrieveState } from "./retrieve";
import { looseSchema } from "./step-schema";

/** Structured trace for the supervisor turn (visible at LOG_LEVEL=debug). */
const trace = (msg: string, fields: Record<string, unknown> = {}) => {
  logger.debug(`converse ${msg}`, { component: "converse", ...fields });
};

/**
 * Minimal structural view of the supervisor agent (injectable for tests): a
 * tool-using, free-text `generate`. It drives `find_products` (provided per-run via
 * `toolsets`) and returns its reply as plain text.
 */
export interface SupervisorAgent {
  generate(
    message: string,
    options: {
      system?: string;
      toolsets?: Record<string, Record<string, unknown>>;
      maxSteps?: number;
      memory?: { thread: string; resource: string };
    },
  ): Promise<{ text: string }>;
}

/** A compact view of an already-shown product, for grounding the direct-answer path. */
export interface LeanShown {
  id: number;
  title: string;
  price: number;
  brand?: string;
  rating: number;
}

/** What the supervisor needs about earlier turns: shown ids (dedup) + the last shown products. */
export interface ThreadContext {
  /** Every product id already shown in this thread — excluded so finders never repeat. */
  shownIds: number[];
  /** The most recent turn's shown products — lets the supervisor answer "which do you recommend?". */
  priorProducts: LeanShown[];
  /**
   * Full product records by id for every product shown in this thread — the grounding
   * source for recommend_product / compare_products on a follow-up (the `priorProducts`
   * block above is lean and lacks image/stock/discount the spotlight cards need).
   * Optional: a turn's own find_products results also feed the registry.
   */
  registry?: Map<number, Product>;
}

/**
 * The non-persisted system message: the live category list (so the supervisor uses
 * REAL slugs) and the products already on screen (so it can recommend/compare without
 * re-searching). Returns `undefined` when there's nothing to add.
 */
export function buildSupervisorSystem(
  categoryList: string,
  priorProducts: LeanShown[],
): string | undefined {
  const blocks: string[] = [];
  if (categoryList) {
    blocks.push(
      "CATALOG CATEGORIES — the catalog's real categories as 'slug — name (N items)'.",
      "Use these EXACT slugs for any find_products category; the counts show how thin a category is:",
      categoryList,
      "",
    );
  }
  if (priorProducts.length) {
    blocks.push(
      "PREVIOUSLY SHOWN PRODUCTS — already on screen this conversation. For a follow-up about",
      "these (a recommendation, a comparison, a question) answer from this list; do NOT search again:",
      ...priorProducts.map(
        (p) => `- #${p.id} ${p.title} ($${p.price}${p.brand ? `, ${p.brand}` : ""}, ${p.rating}★)`,
      ),
      "",
    );
  }
  return blocks.length ? blocks.join("\n") : undefined;
}

/** Build the turn's chips from the grounded products it surfaced (reuses the grounded logic). */
async function buildChips(
  results: ProductResultsPart[],
  message: string,
  agent?: StructuredChips,
): Promise<SuggestionChip[]> {
  // No products → treat as conversational (greeting / direct answer) → no chips.
  const state: RetrieveState = { kind: results.length ? "product" : "chitchat", results, notes: [] };
  return generateChips({ state, message, agent });
}

export interface ConverseParams {
  input: WorkflowInput;
  supervisor: SupervisorAgent;
  /** The inner finder agent (`discovery`) that `find_products` drives. */
  finderAgent: AgenticFinder;
  categories: Category[];
  context: ThreadContext;
  deps?: CatalogDeps;
  writer?: PartWriter;
  chipsAgent?: StructuredChips;
  maxFinders: number;
  finderMaxSteps: number;
  supervisorMaxSteps: number;
}

export interface ConverseResult {
  message: string;
  results: ProductResultsPart[];
  chips: SuggestionChip[];
  /** The finders the supervisor actually ran — persisted for a later "show me more". */
  finders: SearchIntent[];
  /**
   * Every supervisor tool call this turn (find/recommend/compare, incl. refused),
   * in order — for EVAL grading of tool usage. Not persisted, not user-facing.
   */
  toolCalls: ToolCallRecord[];
}

/**
 * Run one turn as a supervisor loop. The supervisor decides whether to call
 * `find_products` (0..N times); each call streams grounded product cards via the
 * writer and returns a lean narrative. The supervisor then writes the reply. Cards are
 * code-emitted (grounded by id); the model authors only prose. Returns the turn's
 * authoritative results + chips + the finders run. Testable: inject fake agents.
 */
export async function runConverse(params: ConverseParams): Promise<ConverseResult> {
  const deps = params.deps ?? defaultDeps;
  const accumulator: ProductResultsPart[] = [];
  const usedFinders: FindProductsInput[] = [];
  // EVAL trace: every tool call this turn (find/recommend/compare, incl. refused), in order.
  const toolCalls: ToolCallRecord[] = [];
  const counter = { count: 0 };
  const stepCounter = { count: 0 };
  const exclude = new Set<number>(params.context.shownIds);
  // Seed the grounding registry with prior turns' full products; find_products grows it
  // as new groups land, so recommend/compare can ground any shown id by full record.
  const registry = new Map<number, Product>(params.context.registry);

  const findTool = createFindProductsTool({
    writer: params.writer,
    deps,
    categories: params.categories,
    finderAgent: params.finderAgent,
    exclude,
    accumulator,
    registry,
    usedFinders,
    counter,
    maxFinders: params.maxFinders,
    finderMaxSteps: params.finderMaxSteps,
    stepCounter,
    maxSteps: params.supervisorMaxSteps,
    toolCalls,
  });

  const recommendTool = createRecommendProductTool({
    writer: params.writer,
    registry,
    accumulator,
    stepCounter,
    maxSteps: params.supervisorMaxSteps,
    toolCalls,
  });

  const compareTool = createCompareProductsTool({
    writer: params.writer,
    registry,
    accumulator,
    stepCounter,
    maxSteps: params.supervisorMaxSteps,
    toolCalls,
  });

  const system = buildSupervisorSystem(
    formatCategoryList(params.categories),
    params.context.priorProducts,
  );

  trace(`turn START "${params.input.message}"`, { shown: params.context.shownIds.length });
  const { text } = await params.supervisor.generate(params.input.message, {
    ...(system ? { system } : {}),
    toolsets: {
      catalog: {
        find_products: findTool,
        recommend_product: recommendTool,
        compare_products: compareTool,
      },
    },
    maxSteps: params.supervisorMaxSteps,
    memory: { thread: params.input.threadId, resource: params.input.resourceId },
  });
  trace(`turn DONE: ${counter.count} finder(s) ran, ${accumulator.length} group(s)`, {
    finders: counter.count,
    steps: stepCounter.count,
    groups: accumulator.length,
  });

  const chips = await buildChips(accumulator, params.input.message, params.chipsAgent);
  return { message: text, results: accumulator, chips, finders: usedFinders, toolCalls };
}

/**
 * Recover what earlier turns in this thread already showed: every product id (to page
 * past them with no repeats) and the most recent turn's products (so the supervisor can
 * answer a follow-up about them without re-searching). Read from the persisted
 * assistant-message metadata (D12). Best-effort: any failure yields empty context.
 */
export async function loadThreadContext(
  mastra: Mastra,
  threadId: string,
  resourceId: string,
): Promise<ThreadContext> {
  const empty: ThreadContext = { shownIds: [], priorProducts: [], registry: new Map() };
  try {
    const mem = await mastra.getAgent("supervisor").getMemory();
    if (!mem) return empty;
    const { messages } = await mem.recall({ threadId, resourceId, perPage: 10, page: 0 });
    const shown = new Set<number>();
    const registry = new Map<number, Product>();
    let priorProducts: LeanShown[] = [];
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      const meta = (m.content as { metadata?: Record<string, unknown> })?.metadata ?? {};
      const results = meta[RESULTS_METADATA_KEY];
      if (!Array.isArray(results)) continue;
      const turnProducts: LeanShown[] = [];
      for (const group of results) {
        for (const p of (group as ProductResultsPart)?.products ?? []) {
          if (typeof p?.id === "number") {
            shown.add(p.id);
            registry.set(p.id, p as Product);
            turnProducts.push({ id: p.id, title: p.title, price: p.price, brand: p.brand, rating: p.rating });
          }
        }
      }
      // Messages come oldest→newest, so the last assistant turn with products wins.
      if (turnProducts.length) priorProducts = turnProducts.slice(0, 12);
    }
    return { shownIds: [...shown], priorProducts, registry };
  } catch {
    return empty;
  }
}

/**
 * The single workflow step: the supervisor drives the whole turn (orchestrate +
 * discover + generate collapsed into one agentic loop). Streams grounded cards as
 * finders complete, writes the reply, builds chips, and persists the turn (D12).
 */
export const converseStep = createStep({
  id: "converse",
  inputSchema: looseSchema(workflowInputSchema),
  outputSchema: looseSchema(workflowOutputSchema),
  execute: async ({ inputData, mastra, writer }) => {
    const input = workflowInputSchema.parse(inputData);
    const supervisor = mastra.getAgent("supervisor") as unknown as SupervisorAgent;
    const finderAgent = mastra.getAgent("discovery") as unknown as AgenticFinder;
    const env = loadEnv();
    const categories = await categoriesProvider.get();
    const context = await loadThreadContext(mastra, input.threadId, input.resourceId);

    const result = await runConverse({
      input,
      supervisor,
      finderAgent,
      categories,
      context,
      writer,
      maxFinders: env.maxProductFinders,
      finderMaxSteps: env.finderMaxSteps,
      supervisorMaxSteps: env.supervisorMaxSteps,
    });

    // D12: persist the cards + chips + finders alongside the assistant message the
    // supervisor's memory just saved, so a refresh rehydrates and "show me more" reuses.
    const mem = await mastra.getAgent("supervisor").getMemory();
    if (mem) {
      await persistTurnResults(mem, {
        threadId: input.threadId,
        resourceId: input.resourceId,
        results: result.results,
        chips: result.chips,
        finders: result.finders,
      });
    }

    const output = { message: result.message, results: result.results, chips: result.chips };
    // EVAL-ONLY: surface the turn's trace so an LLM-judge can grade tool usage. Gated by
    // EVAL_EXPOSE_TRACE so production turns return only the lean user-facing shape above.
    return env.evalExposeTrace
      ? { ...output, finders: result.finders, toolCalls: result.toolCalls }
      : output;
  },
});
