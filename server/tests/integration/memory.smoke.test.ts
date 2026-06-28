import { describe, expect, it } from "vitest";
import { RESOURCE_ID } from "../../src/config/env";
import { createMemory } from "../../src/mastra/memory";

/**
 * Validates that Mastra Memory on LibSQL round-trips against a real (in-memory)
 * store: thread create/read, and working-memory write/read scoped to the
 * resource (US-3.x, US-7.1). No model calls here — pure persistence.
 */
describe("Mastra Memory (LibSQL) smoke", () => {
  it("creates and re-reads a thread", async () => {
    const memory = createMemory(":memory:");
    const thread = await memory.createThread({
      resourceId: RESOURCE_ID,
      title: "Headphones hunt",
    });

    expect(thread.id).toBeTruthy();

    const fetched = await memory.getThreadById({ threadId: thread.id });
    expect(fetched?.title).toBe("Headphones hunt");
    expect(fetched?.resourceId).toBe(RESOURCE_ID);
  });

  it("writes and reads back resource-scoped working memory", async () => {
    const memory = createMemory(":memory:");
    const thread = await memory.createThread({ resourceId: RESOURCE_ID });

    await memory.updateWorkingMemory({
      threadId: thread.id,
      resourceId: RESOURCE_ID,
      workingMemory: "# User Profile\n- Budget: ~$50\n- Likes: audio",
    });

    const wm = await memory.getWorkingMemory({
      threadId: thread.id,
      resourceId: RESOURCE_ID,
    });

    expect(wm).toBeTruthy();
    expect(String(wm)).toContain("$50");
  });

  it("lists threads for the resource", async () => {
    const memory = createMemory(":memory:");
    await memory.createThread({ resourceId: RESOURCE_ID, title: "A" });
    await memory.createThread({ resourceId: RESOURCE_ID, title: "B" });

    const { threads } = await memory.listThreads({
      filter: { resourceId: RESOURCE_ID },
    });

    expect(threads.length).toBeGreaterThanOrEqual(2);
  });
});
