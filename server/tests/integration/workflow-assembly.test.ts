import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { describe, expect, it } from "vitest";
import { pipelineWorkflow } from "../../src/pipeline/workflow";

/**
 * Validates the real Mastra assembly — that the workflow `.commit()`s and
 * registers on a Mastra instance (so `POST /api/workflows/pipeline/stream` will
 * exist). No model calls; this is structural wiring only. End-to-end execution
 * against the live model is covered by the `mastra dev` smoke (final verification).
 */
describe("pipeline workflow assembly", () => {
  it("registers under the id 'pipeline'", () => {
    const mastra = new Mastra({
      storage: new LibSQLStore({ id: "assembly-test", url: ":memory:" }),
      workflows: { pipeline: pipelineWorkflow },
    });

    expect(mastra.getWorkflow("pipeline")).toBeDefined();
  });
});
