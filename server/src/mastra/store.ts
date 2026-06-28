import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LibSQLStore } from "@mastra/libsql";
import { loadEnv } from "../config/env";
import { createMemory } from "./memory";

/**
 * The runtime singletons (memory + storage), kept in their own module so both
 * the Mastra instance and the custom profile route can import the same `memory`
 * without a circular dependency through `mastra/index.ts`. Importing this module
 * opens the LibSQL file; tests use the `createMemory(":memory:")` factory instead
 * and never import this.
 */
const env = loadEnv();

// Make sure the DB's parent directory exists before LibSQL tries to open it.
if (env.databaseUrl.startsWith("file:")) {
  mkdirSync(dirname(env.databaseUrl.slice("file:".length)), { recursive: true });
}

export const memory = createMemory(env.databaseUrl);
export const storage = new LibSQLStore({ id: "bazak-storage", url: env.databaseUrl });
