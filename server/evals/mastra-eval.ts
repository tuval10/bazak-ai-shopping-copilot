import type { WorkflowInput, WorkflowOutput } from "@bazak/shared";
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { createDiscoveryAgent } from "../src/mastra/agents/discovery";
import { createSupervisorAgent } from "../src/mastra/agents/supervisor";
import { createMemory } from "../src/mastra/memory";
import { pipelineWorkflow } from "../src/pipeline/workflow";

/**
 * An ISOLATED Mastra instance for evals — never import the app's `mastra`
 * (`src/mastra/index.ts`) or `src/mastra/store.ts`: those open the real on-disk
 * LibSQL DB at import time, so an eval run would read prod thread history and write
 * eval turns back into it. Here memory + storage are in-memory and live only for the
 * test process, so each `npm run eval` starts from a clean slate.
 *
 * The real `supervisor` + `discovery` agents and the real `pipeline` workflow are
 * registered, so a turn exercises the exact production orchestration. The turn's
 * trace (finders + tool calls) rides back on the workflow output because the eval
 * process sets `EVAL_EXPOSE_TRACE=1` (see `converseStep`).
 */
export const evalMastra = new Mastra({
  storage: new LibSQLStore({ id: "eval-storage", url: ":memory:" }),
  agents: {
    supervisor: createSupervisorAgent(createMemory(":memory:")),
    discovery: createDiscoveryAgent(),
  },
  workflows: { pipeline: pipelineWorkflow },
});

let threadSeq = 0;

/** A fresh, collision-proof thread id so no scenario inherits another's memory. */
export function freshThreadId(label: string): string {
  threadSeq += 1;
  return `eval-${label}-${Date.now()}-${threadSeq}`;
}

/**
 * Drive ONE real turn through the `pipeline` workflow and return its output. With
 * `EVAL_EXPOSE_TRACE=1` the output carries `finders` + `toolCalls` for grading.
 * Throws if the workflow doesn't reach `success` (surfaced, not masked).
 */
export async function runTurn(input: WorkflowInput): Promise<WorkflowOutput> {
  const run = await evalMastra.getWorkflow("pipeline").createRun();
  const res = await run.start({ inputData: input });
  if (res.status !== "success") {
    throw new Error(`pipeline workflow did not succeed (status=${res.status})`);
  }
  return res.result as WorkflowOutput;
}
