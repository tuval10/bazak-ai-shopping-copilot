import { registerApiRoute } from "@mastra/core/server";
import type { Memory } from "@mastra/memory";
import { RESOURCE_ID } from "../config/env";
import { memory } from "../mastra/store";

/**
 * The one custom route (D9a): read + reset the user's remembered preferences
 * (US-7.4). Mastra has no built-in working-memory HTTP route, so we add this.
 *
 * Working memory is resource-scoped, but the read/write API needs a thread for
 * context — so we anchor to a stable per-resource thread. Since the scope is the
 * resource, this anchor sees the same preferences the generator agent writes
 * during real conversations.
 */
const ANCHOR_THREAD_ID = `profile-anchor-${RESOURCE_ID}`;

async function ensureAnchorThread(mem: Memory): Promise<void> {
  const existing = await mem.getThreadById({ threadId: ANCHOR_THREAD_ID });
  if (!existing) {
    await mem.createThread({
      threadId: ANCHOR_THREAD_ID,
      resourceId: RESOURCE_ID,
      title: "Profile anchor",
    });
  }
}

export interface RouteResult {
  status: 200 | 500;
  body: Record<string, unknown>;
}

/** Read remembered preferences (US-7.4). Returns a friendly error, never throws (US-5.2). */
export async function handleProfileGet(mem: Memory, resourceId: string): Promise<RouteResult> {
  try {
    await ensureAnchorThread(mem);
    const workingMemory = await mem.getWorkingMemory({
      threadId: ANCHOR_THREAD_ID,
      resourceId,
    });
    return { status: 200, body: { profile: workingMemory ?? null } };
  } catch {
    return { status: 500, body: { error: "Could not read your remembered preferences." } };
  }
}

/** Reset/clear remembered preferences (US-7.4). Returns a friendly error, never throws (US-5.2). */
export async function handleProfileReset(mem: Memory, resourceId: string): Promise<RouteResult> {
  try {
    await ensureAnchorThread(mem);
    await mem.updateWorkingMemory({
      threadId: ANCHOR_THREAD_ID,
      resourceId,
      workingMemory: "",
    });
    return { status: 200, body: { ok: true } };
  } catch {
    return { status: 500, body: { error: "Could not reset your remembered preferences." } };
  }
}

/**
 * Registered on the Mastra server (D9a). The path is `/profile`, NOT `/api/...`:
 * Mastra reserves the `/api` prefix for its built-in routes and rejects custom
 * routes under it (verified via `mastra dev`).
 */
export const profileRoutes = [
  registerApiRoute("/profile", {
    method: "GET",
    handler: async (c) => {
      const { status, body } = await handleProfileGet(memory, RESOURCE_ID);
      return c.json(body, status);
    },
  }),
  registerApiRoute("/profile", {
    method: "DELETE",
    handler: async (c) => {
      const { status, body } = await handleProfileReset(memory, RESOURCE_ID);
      return c.json(body, status);
    },
  }),
];
