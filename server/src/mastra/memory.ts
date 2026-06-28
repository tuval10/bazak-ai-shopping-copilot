import { profileSchema } from "@bazak/shared";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";

/**
 * Conversation + preference store (DECISIONS D4): Mastra Memory on LibSQL.
 * - **threads** hold the message transcript (US-3.x),
 * - **working memory** holds per-user preferences, scoped to the resource so it
 *   persists across all of a user's conversations (US-7.1), shaped by
 *   `profileSchema` from the shared contract.
 *
 * Semantic recall is off for now — no current story needs vector search, and
 * enabling it would require a vector store + embedder. It can be turned on later
 * (the messages are already persisted).
 */
export function createMemory(url: string): Memory {
  return new Memory({
    storage: new LibSQLStore({ id: "bazak-memory", url }),
    options: {
      workingMemory: {
        enabled: true,
        scope: "resource",
        schema: profileSchema,
      },
      semanticRecall: false,
      lastMessages: 10,
    },
  });
}
