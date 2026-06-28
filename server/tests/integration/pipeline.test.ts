import type { WorkflowInput } from "@bazak/shared";
import { describe, expect, it, vi } from "vitest";
import type { Classification } from "../../src/pipeline/classification";
import type { StructuredClassifier } from "../../src/pipeline/classify";
import { runClassify } from "../../src/pipeline/classify";
import type { PartWriter, TextGenerator } from "../../src/pipeline/generate";
import { runGenerate } from "../../src/pipeline/generate";
import type { CatalogDeps } from "../../src/pipeline/retrieve";
import { runRetrieve } from "../../src/pipeline/retrieve";
import { planRoute } from "../../src/pipeline/route";
import { makeListResponse, makeProduct } from "../helpers/products";

/** A classifier whose model is faked to return a fixed classification. */
const fakeClassifier = (classification: Classification): StructuredClassifier => ({
  generate: vi.fn(async () => ({ object: classification })),
});

const fakeGenerator = (text = "Here are the results."): TextGenerator => ({
  generate: vi.fn(async () => ({ text })),
});

function collectingWriter() {
  const parts: Array<{ type: string; [k: string]: unknown }> = [];
  const writer: PartWriter = { custom: (data) => void parts.push(data) };
  return { writer, parts };
}

const catalog: CatalogDeps = {
  searchProducts: vi.fn(async (q: string) =>
    makeListResponse([makeProduct({ id: q.includes("bag") ? 20 : 10, title: q })]),
  ),
  getCategoryProducts: vi.fn(async () => makeListResponse([])),
  getCategories: vi.fn(async () => []),
};

/** Drive the full pipeline (classify → route → retrieve → generate) end to end. */
async function runPipeline(input: WorkflowInput, classification: Classification) {
  const { writer, parts } = collectingWriter();
  const classified = await runClassify(input.message, fakeClassifier(classification));
  const state = await runRetrieve(planRoute(classified), catalog);
  const output = await runGenerate({ input, state, agent: fakeGenerator(), writer });
  return { output, parts };
}

describe("pipeline (classify → route → retrieve → generate)", () => {
  it("decomposes a multi-intent message into grouped, grounded results", async () => {
    const input: WorkflowInput = {
      message: "a phone and a laptop bag",
      threadId: "t1",
      resourceId: "local-user",
    };
    const { output, parts } = await runPipeline(input, {
      kind: "product",
      searches: [
        { label: "a phone", keywords: "phone" },
        { label: "a laptop bag", keywords: "laptop bag" },
      ],
    });

    expect(output.results).toHaveLength(2);
    expect(parts).toHaveLength(2); // one streamed part per intent
    expect(output.results.map((r) => r.intent)).toEqual(["a phone", "a laptop bag"]);
    // grounding: every emitted product came from the catalog (ids 10/20), none invented
    const ids = output.results.flatMap((r) => r.products.map((p) => p.id));
    expect(ids).toEqual([10, 20]);
  });

  it("handles a chitchat turn with a reply and no product parts", async () => {
    const input: WorkflowInput = { message: "hi there", threadId: "t2", resourceId: "local-user" };
    const { output, parts } = await runPipeline(input, { kind: "chitchat", searches: [] });

    expect(parts).toHaveLength(0);
    expect(output.results).toEqual([]);
    expect(output.message).toBeTruthy();
  });

  it("backfills a search when the classifier marks a product turn with no extractions", async () => {
    const input: WorkflowInput = { message: "something cool", threadId: "t3", resourceId: "local-user" };
    const { output } = await runPipeline(input, { kind: "product", searches: [] });

    // runClassify backfills one search from the raw message, so we still retrieve
    expect(output.results).toHaveLength(1);
    expect(output.results[0]?.intent).toBe("something cool");
  });
});
