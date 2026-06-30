import type { Mastra } from "@mastra/core";
import { loadEnv } from "../../config/env";
import type { AgenticFinder } from "../../pipeline/discovery";
import { defaultDeps } from "../../pipeline/retrieve";
import { createCompareProductsTool } from "./compare-products";
import { createFindProductsTool } from "./find-products";
import { createRecommendProductTool } from "./recommend-product";
import { createCategoryBrowseTool, createProductSearchTool } from "./search-products";

/**
 * Register standalone instances of the catalog tools on the Mastra instance so they
 * show up (and can be invoked) in Mastra Studio's Tools page.
 *
 * IMPORTANT: the agents do NOT use these instances. At runtime every turn injects its
 * own per-run tools via `toolsets` (see pipeline/converse.ts + pipeline/discovery.ts)
 * with live state — the grounding registry, the stream writer, the per-turn step/finder
 * counters. Mastra's top-level `tools` registry is a reuse/playground surface only; it
 * is never auto-injected into agent runs. So this is purely additive for Studio and
 * changes nothing about how the pipeline behaves.
 *
 * Because the registered copies carry fresh placeholder state, fidelity varies:
 *   - product_search / category_browse work fully against the live catalog.
 *   - find_products drives the real discovery agent but has no stream writer (it returns
 *     its summary note; no cards are streamed) and starts from an empty category list.
 *   - recommend_product / compare_products ground against an empty registry, so they
 *     return "no shown product has id …" unless you've nothing to ground against. They
 *     exist mainly so the full tool roster is visible.
 *
 * Called after `new Mastra(...)` (via `mastra.addTool`) so find_products can resolve the
 * already-registered `discovery` agent — it can't be referenced inside the same
 * constructor call.
 */
export function registerStudioTools(mastra: Mastra): void {
  const env = loadEnv();

  mastra.addTool(createProductSearchTool({ registry: new Map() }));
  mastra.addTool(createCategoryBrowseTool({ registry: new Map() }));

  mastra.addTool(
    createFindProductsTool({
      deps: defaultDeps,
      categories: [],
      finderAgent: mastra.getAgent("discovery") as unknown as AgenticFinder,
      exclude: new Set(),
      accumulator: [],
      registry: new Map(),
      usedFinders: [],
      counter: { count: 0 },
      maxFinders: env.maxProductFinders,
      finderMaxSteps: env.finderMaxSteps,
      stepCounter: { count: 0 },
      maxSteps: env.supervisorMaxSteps,
    }),
  );

  mastra.addTool(
    createRecommendProductTool({
      registry: new Map(),
      accumulator: [],
      stepCounter: { count: 0 },
      maxSteps: env.supervisorMaxSteps,
    }),
  );

  mastra.addTool(
    createCompareProductsTool({
      registry: new Map(),
      accumulator: [],
      stepCounter: { count: 0 },
      maxSteps: env.supervisorMaxSteps,
    }),
  );
}
