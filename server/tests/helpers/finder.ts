import { vi } from "vitest";
import type { SearchIntent } from "../../src/pipeline/classification";
import type { SupervisorAgent } from "../../src/pipeline/converse";
import type { AgenticFinder, FinderResult } from "../../src/pipeline/discovery";
import type {
  CategoryBrowseInput,
  ProductSearchInput,
  ProductSearchOutput,
} from "../../src/mastra/tools/search-products";
import type {
  FindProductsInput,
  FindProductsOutput,
} from "../../src/mastra/tools/find-products";

/** A search call against the run's `product_search` tool (populates the grounding registry). */
export type ScriptedSearch = (input: ProductSearchInput) => Promise<ProductSearchOutput>;

/** A browse call against the run's `category_browse` tool (populates the grounding registry). */
export type ScriptedBrowse = (input: CategoryBrowseInput) => Promise<ProductSearchOutput>;

/** Recover the finder the run is about from the prompt (built by `buildFinderPrompt`). */
function finderFromPrompt(prompt: string): SearchIntent {
  // Line 0 is the header "Find products for this finder:", line 1 is the JSON.
  try {
    return JSON.parse(prompt.split("\n")[1] ?? "{}") as SearchIntent;
  } catch {
    return { label: "" } as SearchIntent;
  }
}

/**
 * A deterministic stand-in for the agentic finder. Instead of an LLM driving the
 * `product_search` tool, the test supplies a `script` that calls the real tool
 * (exercising the grounding registry + assembly) and returns the groups by id.
 *
 * The script receives a `search` and a `browse` bound to the run's tools (so any
 * product they return is captured for id→product resolution exactly as in
 * production) and the parsed finder for convenience.
 */
export function scriptedFinder(
  script: (search: ScriptedSearch, finder: SearchIntent, browse: ScriptedBrowse) => Promise<FinderResult>,
): AgenticFinder {
  return {
    generate: vi.fn(async (prompt, options) => {
      const searchTool = options.toolsets?.catalog?.product_search as {
        execute: (input: ProductSearchInput, ctx?: unknown) => Promise<ProductSearchOutput>;
      };
      const browseTool = options.toolsets?.catalog?.category_browse as {
        execute: (input: CategoryBrowseInput, ctx?: unknown) => Promise<ProductSearchOutput>;
      };
      const search: ScriptedSearch = (input) => searchTool.execute(input, {});
      const browse: ScriptedBrowse = (input) => browseTool.execute(input, {});
      return { object: await script(search, finderFromPrompt(prompt), browse) };
    }),
  };
}

/** A finder that returns no groups (the no-op / nothing-found path). */
export const emptyFinder = (): AgenticFinder => scriptedFinder(async () => ({ groups: [] }));

/** A call against the run's `find_products` tool (drives the finder + grounding/streaming). */
export type ScriptedFind = (input: FindProductsInput) => Promise<FindProductsOutput>;

/**
 * A deterministic stand-in for the supervisor agent. Instead of an LLM driving the
 * `find_products` tool and writing prose, the test supplies a `script` that calls the
 * real injected tool (exercising the grounding registry, card streaming, dedup, and the
 * run-local cap exactly as in production) and returns the reply text. The script
 * receives a `find` bound to the run's tool and the user message.
 */
export function scriptedSupervisor(
  script: (find: ScriptedFind, message: string) => Promise<string>,
): SupervisorAgent {
  return {
    generate: vi.fn(async (message, options) => {
      const tool = options.toolsets?.catalog?.find_products as {
        execute: (input: FindProductsInput, ctx?: unknown) => Promise<FindProductsOutput>;
      };
      const find: ScriptedFind = (input) => tool.execute(input, {});
      return { text: await script(find, message) };
    }),
  };
}

/**
 * A "happy path" finder: one focused search using the finder's own keywords +
 * constraints, returned as a single group labelled by the finder. No relaxation —
 * the common case where the focused query already finds products.
 */
export const passthroughFinder = (): AgenticFinder =>
  scriptedFinder(async (search, finder) => {
    const r = await search({
      keywords: finder.keywords ?? finder.label,
      minPrice: finder.minPrice,
      maxPrice: finder.maxPrice,
      minRating: finder.minRating,
      brands: finder.brands,
      inStockOnly: finder.inStockOnly,
      onSaleOnly: finder.onSaleOnly,
      sort: finder.sort,
      limit: 20,
    });
    return {
      groups: r.products.length
        ? [{ intent: finder.label, productIds: r.products.map((p) => p.id) }]
        : [],
    };
  });
