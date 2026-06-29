import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { RESOURCE_ID } from "../src/config/env";
import { freshThreadId, runTurn } from "./mastra-eval";
import { DEFAULT_THRESHOLD, SCENARIOS } from "./scenarios";
import { behaviorJudge, runToolChecks } from "./scorers";
import { buildTrace, type TurnTrace } from "./trace";

/**
 * End-to-end LLM-as-judge evals: drive each scenario through the REAL `pipeline`
 * workflow (real supervisor + finder + live catalog), then grade the turn's trace
 * with a custom LLM judge (behaviour vs the scenario's expectations) plus zero-LLM
 * tool-usage checks. Run via `npm run eval` (NOT `npm test`).
 */

interface Report {
  scenario: string;
  score: number;
  threshold: number;
  judgePassed: boolean;
  toolChecks: Array<{ name: string; passed: boolean }>;
  passed: boolean;
  reason: string;
}

const reports: Report[] = [];

/** Compact "#id Title ($price)" list of what a seed turn put on screen — context for the judge. */
function cardsSummary(trace: TurnTrace): string {
  return trace.cards
    .flatMap((c) => c.products.map((p) => `#${p.id} ${p.title} ($${p.price})`))
    .join("\n");
}

describe("LLM-as-judge evals (real pipeline)", () => {
  for (const scenario of SCENARIOS) {
    const threshold = scenario.threshold ?? DEFAULT_THRESHOLD;

    it(
      scenario.name,
      async () => {
        const threadId = freshThreadId(scenario.name);

        // Optional prior turn (same thread) to set up context for a follow-up.
        let priorContext: string | undefined;
        if (scenario.seed) {
          const seedOut = await runTurn({ message: scenario.seed, threadId, resourceId: RESOURCE_ID });
          priorContext = cardsSummary(buildTrace(seedOut));
        }

        const out = await runTurn({ message: scenario.message, threadId, resourceId: RESOURCE_ID });
        const trace = buildTrace(out);

        const judged = await behaviorJudge.run({
          input: { message: scenario.message, expectations: scenario.expectations, priorContext },
          output: trace,
        });

        const toolChecks = scenario.toolExpect
          ? await runToolChecks(scenario.toolExpect, trace.toolCalls)
          : [];

        const judgePassed = judged.score >= threshold;
        const toolsPassed = toolChecks.every((c) => c.passed);
        const passed = judgePassed && toolsPassed;

        reports.push({
          scenario: scenario.name,
          score: judged.score,
          threshold,
          judgePassed,
          toolChecks,
          passed,
          reason: judged.reason ?? "",
        });

        // Surface the judge's reasoning + any failed tool checks when a scenario fails.
        if (!passed) {
          const failedTools = toolChecks.filter((c) => !c.passed).map((c) => c.name);
          console.error(
            `\n✗ ${scenario.name} (score ${judged.score.toFixed(2)} < ${threshold}` +
              `${failedTools.length ? `, failed checks: ${failedTools.join(", ")}` : ""})\n${judged.reason}\n`,
          );
        }

        expect(judged.score, `behaviour judge below threshold\n${judged.reason}`).toBeGreaterThanOrEqual(
          threshold,
        );
        for (const c of toolChecks) {
          expect(c.passed, `tool check failed: ${c.name}`).toBe(true);
        }
      },
      120_000,
    );
  }
});

afterAll(() => {
  if (!reports.length) return;
  console.log("\n=== LLM-judge eval summary ===");
  console.table(
    reports.map((r) => ({
      scenario: r.scenario,
      score: r.score.toFixed(2),
      threshold: r.threshold,
      tools: r.toolChecks.length ? `${r.toolChecks.filter((c) => c.passed).length}/${r.toolChecks.length}` : "—",
      passed: r.passed ? "✓" : "✗",
    })),
  );
  // JSON artifact for trend tracking (gitignored).
  const outDir = resolve(fileURLToPath(new URL(".", import.meta.url)), ".out");
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `results-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(reports, null, 2));
  console.log(`\nWrote ${reports.length} results to ${file}`);
});
