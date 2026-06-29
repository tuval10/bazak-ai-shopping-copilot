import { type ProductResultsPart, RESULTS_METADATA_KEY } from "@bazak/shared";
import { describe, expect, it } from "vitest";
import { RESOURCE_ID } from "../../src/config/env";
import { createMemory } from "../../src/mastra/memory";
import { persistTurnResults } from "../../src/pipeline/generate";
import { makeProduct } from "../helpers/products";

/**
 * D12 (US-3.1): a turn's product results are persisted as metadata on the assistant
 * message, so loading history rehydrates the cards — not just the prose. Real
 * (in-memory) LibSQL store; no model calls.
 */
describe("persistTurnResults (D12)", () => {
  it("round-trips a turn's results through history as assistant-message metadata", async () => {
    const mem = createMemory(":memory:");
    const thread = await mem.createThread({ resourceId: RESOURCE_ID, title: "Headphones" });

    // Stand in for the assistant message that agent.generate persists for the turn.
    await mem.saveMessages({
      messages: [
        {
          id: "assistant-turn-1",
          role: "assistant",
          createdAt: new Date(),
          threadId: thread.id,
          resourceId: RESOURCE_ID,
          type: "v2",
          content: { format: 2, parts: [{ type: "text", text: "Here are some picks." }] },
        },
      ],
    } as Parameters<typeof mem.saveMessages>[0]);

    const results: ProductResultsPart[] = [
      { intent: "headphones", products: [makeProduct({ id: 7, title: "Acme Buds" })] },
    ];

    await persistTurnResults(mem, { threadId: thread.id, resourceId: RESOURCE_ID, results });

    const { messages } = await mem.recall({ threadId: thread.id, resourceId: RESOURCE_ID, perPage: 10, page: 0 });
    const assistant = messages.find((m) => m.role === "assistant");

    // The prose is untouched and the cards are now retrievable from metadata.
    expect(assistant?.content.metadata?.[RESULTS_METADATA_KEY]).toEqual(results);
  });

  it("is a no-op for a turn with no results (chitchat / off-catalog)", async () => {
    const mem = createMemory(":memory:");
    await expect(
      persistTurnResults(mem, { threadId: "no-thread", resourceId: RESOURCE_ID, results: [] }),
    ).resolves.toBeUndefined();
  });
});
