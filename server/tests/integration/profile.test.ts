import type { Memory } from "@mastra/memory";
import { describe, expect, it } from "vitest";
import { RESOURCE_ID } from "../../src/config/env";
import { handleProfileGet, handleProfileReset } from "../../src/api/profile";
import { createMemory } from "../../src/mastra/memory";

describe("profile route (US-7.4)", () => {
  it("returns null when nothing is remembered yet", async () => {
    const mem = createMemory(":memory:");
    const res = await handleProfileGet(mem, RESOURCE_ID);
    expect(res.status).toBe(200);
    expect(res.body.profile ?? null).toBeNull();
  });

  it("reads back remembered preferences", async () => {
    const mem = createMemory(":memory:");
    // seed working memory the way the generator agent would
    await handleProfileGet(mem, RESOURCE_ID); // ensures the anchor thread exists
    await mem.updateWorkingMemory({
      threadId: `profile-anchor-${RESOURCE_ID}`,
      resourceId: RESOURCE_ID,
      workingMemory: "# User Profile\n- Budget: ~$50",
    });

    const res = await handleProfileGet(mem, RESOURCE_ID);
    expect(res.status).toBe(200);
    expect(String(res.body.profile)).toContain("$50");
  });

  it("resets remembered preferences", async () => {
    const mem = createMemory(":memory:");
    await handleProfileGet(mem, RESOURCE_ID);
    await mem.updateWorkingMemory({
      threadId: `profile-anchor-${RESOURCE_ID}`,
      resourceId: RESOURCE_ID,
      workingMemory: "# User Profile\n- Budget: ~$50",
    });

    const reset = await handleProfileReset(mem, RESOURCE_ID);
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ ok: true });

    const after = await handleProfileGet(mem, RESOURCE_ID);
    expect(String(after.body.profile ?? "")).not.toContain("$50");
  });

  it("degrades gracefully when the store errors (US-5.2)", async () => {
    const broken = {
      getThreadById: async () => {
        throw new Error("disk full");
      },
    } as unknown as Memory;

    const res = await handleProfileGet(broken, RESOURCE_ID);
    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
    // never leak the raw DB error
    expect(JSON.stringify(res.body)).not.toContain("disk full");
  });
});
