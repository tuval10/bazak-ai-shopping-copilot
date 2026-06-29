import { PinoLogger } from "@mastra/loggers";

/**
 * The app logger. Use this instead of `console.*` so logs are structured, levelled,
 * and unified with Mastra's own agent/workflow/step logs (it's registered on the
 * Mastra instance, so the same stream shows in Mastra Studio).
 *
 * Level via `LOG_LEVEL` (default "info"). Set `LOG_LEVEL=debug` to see the discovery
 * fan-out + per-catalog-call traces (pino's `time` field makes the concurrent
 * dispatch visible without embedding timestamps in the message).
 */
export const logger = new PinoLogger({
  name: "bazak",
  level: (process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
});
