import { RESULTS_METADATA_KEY } from "@bazak/shared";
import { toConversationSummary, toUiMessages } from "@/api-client/conversations";
import { mockGroup } from "../mocks/product-results";

describe("toConversationSummary", () => {
  it("maps a stored thread, normalising dates to ISO", () => {
    const summary = toConversationSummary({
      id: "t1",
      title: "Wireless headphones under $100",
      createdAt: new Date("2026-06-28T10:00:00.000Z"),
      updatedAt: new Date("2026-06-28T11:00:00.000Z"),
    });
    expect(summary).toEqual({
      id: "t1",
      title: "Wireless headphones under $100",
      createdAt: "2026-06-28T10:00:00.000Z",
      updatedAt: "2026-06-28T11:00:00.000Z",
    });
  });

  it("falls back to a default title and to createdAt when updatedAt is absent", () => {
    const summary = toConversationSummary({ id: "t2", title: "  ", createdAt: "2026-06-28T10:00:00.000Z" });
    expect(summary.title).toBe("New conversation");
    expect(summary.updatedAt).toBe(summary.createdAt);
  });
});

describe("toUiMessages", () => {
  it("maps user/assistant turns and flattens content parts to text", () => {
    const msgs = toUiMessages([
      {
        id: "m1",
        role: "user",
        createdAt: "2026-06-28T10:00:00.000Z",
        content: { parts: [{ type: "text", text: "wireless headphones under $100" }] },
      },
      {
        id: "m2",
        role: "assistant",
        createdAt: "2026-06-28T10:00:01.000Z",
        content: { parts: [{ type: "text", text: "Here are the cheapest options 👇" }] },
      },
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ id: "m1", role: "user", content: "wireless headphones under $100" });
    expect(msgs[1]).toMatchObject({ role: "assistant", content: "Here are the cheapest options 👇" });
    expect(msgs[1]!.results).toBeUndefined();
  });

  it("rehydrates an assistant turn's product cards from metadata (D12)", () => {
    const group = mockGroup();
    const [msg] = toUiMessages([
      {
        id: "m3",
        role: "assistant",
        createdAt: "2026-06-28T10:00:00.000Z",
        content: { parts: [{ type: "text", text: "Found these." }], metadata: { [RESULTS_METADATA_KEY]: [group] } },
      },
    ]);
    expect(msg!.results).toHaveLength(1);
    expect(msg!.results![0]!.intent).toBe(group.intent);
    expect(msg!.results![0]!.products).toHaveLength(2);
  });

  it("drops system / working-memory messages", () => {
    const msgs = toUiMessages([
      { id: "s1", role: "system", createdAt: "2026-06-28T10:00:00.000Z", content: "working memory blob" },
      { id: "u1", role: "user", createdAt: "2026-06-28T10:00:01.000Z", content: "hi" },
    ]);
    expect(msgs.map((m) => m.id)).toEqual(["u1"]);
  });

  it("ignores malformed persisted results", () => {
    const [msg] = toUiMessages([
      {
        id: "m4",
        role: "assistant",
        createdAt: "2026-06-28T10:00:00.000Z",
        content: { parts: [{ type: "text", text: "x" }], metadata: { [RESULTS_METADATA_KEY]: [{ junk: true }] } },
      },
    ]);
    expect(msg!.results).toBeUndefined();
  });
});
