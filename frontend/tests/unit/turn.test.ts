import { PRODUCT_RESULTS_PART_TYPE, SUGGESTED_CHIPS_PART_TYPE } from "@bazak/shared";
import { type RawTurnChunk, type TurnState, parseTurnStream } from "@/api-client/turn";
import { mockGroup } from "../mocks/product-results";

async function* fromArray(chunks: RawTurnChunk[]): AsyncIterable<RawTurnChunk> {
  for (const c of chunks) yield c;
}

async function collect(chunks: RawTurnChunk[]): Promise<TurnState[]> {
  const states: TurnState[] = [];
  for await (const s of parseTurnStream(fromArray(chunks))) states.push(s);
  return states;
}

const phones = mockGroup({ intent: "phones under $500" });
const bags = mockGroup({ intent: "laptop bags" });

describe("parseTurnStream", () => {
  it("accumulates a product group per data part, then finishes with the prose", async () => {
    const states = await collect([
      { type: "workflow-start", payload: {} },
      { type: PRODUCT_RESULTS_PART_TYPE, data: phones },
      { type: PRODUCT_RESULTS_PART_TYPE, data: bags },
      { type: "workflow-step-result", payload: { id: "generate", output: { message: "Here you go!", results: [phones, bags] } } },
      { type: "workflow-finish", payload: {} },
    ]);

    const final = states.at(-1)!;
    expect(final.status).toBe("done");
    expect(final.text).toBe("Here you go!");
    expect(final.groups.map((g) => g.intent)).toEqual(["phones under $500", "laptop bags"]);

    // Cards stream in progressively, before the prose lands.
    const streaming = states.filter((s) => s.status === "streaming");
    expect(streaming).toHaveLength(2);
    expect(streaming[0]!.groups).toHaveLength(1);
    expect(streaming[0]!.text).toBe("");
  });

  it("parses a suggestion-chips part and carries chips through to the final state", async () => {
    const chips = [{ label: "Under $50", message: "only under $50" }];
    const states = await collect([
      { type: PRODUCT_RESULTS_PART_TYPE, data: phones },
      { type: SUGGESTED_CHIPS_PART_TYPE, data: { chips } },
      { type: "workflow-step-result", payload: { output: { message: "ok", results: [phones], chips } } },
    ]);
    // chips appear progressively...
    expect(states.some((s) => s.status === "streaming" && s.chips.length === 1)).toBe(true);
    // ...and on the authoritative final state.
    expect(states.at(-1)!.chips).toEqual(chips);
  });

  it("reads the data part whether it sits under data, payload.data, or payload", async () => {
    const a = await collect([{ type: PRODUCT_RESULTS_PART_TYPE, data: phones }]);
    const b = await collect([{ type: PRODUCT_RESULTS_PART_TYPE, payload: { data: phones } }]);
    const c = await collect([{ type: PRODUCT_RESULTS_PART_TYPE, payload: phones }]);
    for (const states of [a, b, c]) {
      expect(states.at(-1)!.groups).toHaveLength(1);
    }
  });

  it("prefers the generate output's authoritative results over streamed groups", async () => {
    const states = await collect([
      { type: PRODUCT_RESULTS_PART_TYPE, data: phones },
      { type: "workflow-step-result", payload: { output: { message: "ok", results: [phones, bags] } } },
    ]);
    expect(states.at(-1)!.groups.map((g) => g.intent)).toEqual(["phones under $500", "laptop bags"]);
  });

  it("ignores non-generate step results (no message+results pair)", async () => {
    const states = await collect([
      { type: "workflow-step-result", payload: { id: "retrieve", output: { kind: "product", results: [phones], notes: [] } } },
      { type: PRODUCT_RESULTS_PART_TYPE, data: phones },
      { type: "workflow-step-result", payload: { id: "generate", output: { message: "done", results: [phones] } } },
    ]);
    expect(states.at(-1)!.text).toBe("done");
    expect(states.at(-1)!.groups).toHaveLength(1);
  });

  it("handles a no-results / chitchat turn (prose, no groups)", async () => {
    const states = await collect([
      { type: "workflow-step-result", payload: { output: { message: "I can't book flights.", results: [] } } },
    ]);
    const final = states.at(-1)!;
    expect(final.status).toBe("done");
    expect(final.text).toBe("I can't book flights.");
    expect(final.groups).toEqual([]);
  });

  it("drops malformed product parts rather than throwing", async () => {
    const states = await collect([
      { type: PRODUCT_RESULTS_PART_TYPE, data: { intent: "broken", products: [{ not: "a product" }] } },
      { type: "workflow-step-result", payload: { output: { message: "ok", results: [] } } },
    ]);
    expect(states.at(-1)!.groups).toEqual([]);
  });
});
