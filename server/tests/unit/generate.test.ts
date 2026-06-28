import type { WorkflowInput } from "@bazak/shared";
import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_RESULTS_PART,
  type PartWriter,
  type TextGenerator,
  buildGroundingSystem,
  runGenerate,
  summarizeForPrompt,
} from "../../src/pipeline/generate";
import type { RetrieveState } from "../../src/pipeline/retrieve";
import { makeProduct } from "../helpers/products";

const input: WorkflowInput = {
  message: "wireless headphones under $100",
  threadId: "thread-1",
  resourceId: "local-user",
};

function collectingWriter() {
  const parts: Array<{ type: string; [k: string]: unknown }> = [];
  const writer: PartWriter = { custom: (data) => void parts.push(data) };
  return { writer, parts };
}

const textAgent = (text = "Here you go!"): TextGenerator => ({
  generate: vi.fn(async () => ({ text })),
});

describe("summarizeForPrompt / buildGroundingSystem", () => {
  it("instructs a brief redirect for chitchat", () => {
    expect(summarizeForPrompt({ kind: "chitchat", results: [], notes: [] })).toMatch(/small talk/i);
  });

  it("instructs an honest decline for off_catalog", () => {
    expect(summarizeForPrompt({ kind: "off_catalog", results: [], notes: [] })).toMatch(/can't fulfil/i);
  });

  it("lists only retrieved products and any notes for a product turn", () => {
    const state: RetrieveState = {
      kind: "product",
      results: [{ intent: "headphones", products: [makeProduct({ title: "Acme Buds", price: 80 })] }],
      notes: ["Relaxed something."],
    };
    const summary = summarizeForPrompt(state);
    expect(summary).toContain("Acme Buds ($80)");
    expect(summary).toContain("Relaxed something.");
    // The grounding system message carries the retrieved data + a reply instruction,
    // but NOT the user message (that's persisted separately as the user turn).
    const grounding = buildGroundingSystem(state);
    expect(grounding).toContain("Acme Buds ($80)");
    expect(grounding).toMatch(/reply/i);
    expect(grounding).not.toContain(input.message);
  });
});

describe("runGenerate", () => {
  it("emits one product-results part per intent, then returns the prose + results", async () => {
    const state: RetrieveState = {
      kind: "product",
      results: [
        { intent: "phone", products: [makeProduct({ id: 1 })] },
        { intent: "laptop bag", products: [makeProduct({ id: 2 })] },
      ],
      notes: [],
    };
    const { writer, parts } = collectingWriter();
    const agent = textAgent("Found these for you.");

    const out = await runGenerate({ input, state, agent, writer });

    // one custom part per intent, with the agreed part type
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.type === PRODUCT_RESULTS_PART)).toBe(true);
    // grounding: the returned results are exactly the retrieved ones (model can't add)
    expect(out.results).toEqual(state.results);
    expect(out.message).toBe("Found these for you.");
    // The real user message is what's sent (and thus persisted, US-3.1); the grounding
    // rides along as a non-persisted system message; memory context is threaded in.
    expect(agent.generate).toHaveBeenCalledWith(
      input.message,
      expect.objectContaining({
        memory: { thread: "thread-1", resource: "local-user" },
        system: expect.stringContaining("phone"),
      }),
    );
  });

  it("emits no parts for a chitchat turn but still replies", async () => {
    const { writer, parts } = collectingWriter();
    const out = await runGenerate({
      input,
      state: { kind: "chitchat", results: [], notes: [] },
      agent: textAgent("Hi! What are you shopping for?"),
      writer,
    });
    expect(parts).toHaveLength(0);
    expect(out.message).toContain("shopping");
    expect(out.results).toEqual([]);
  });
});
