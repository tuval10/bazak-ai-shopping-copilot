import { describe, expect, it } from "vitest";
import { SUPERVISOR_INSTRUCTIONS } from "../../src/mastra/agents/supervisor";
import { buildSupervisorSystem } from "../../src/pipeline/converse";

/**
 * Deterministic (no-LLM) guards for the supervisor's static surface. The behavioral
 * counterparts — does the agent actually decline out-of-scope, ground its prose, etc.
 * — are covered by the LLM-judge evals (`evals/llm-judge.eval.ts`, run via `npm run eval`).
 */

describe("supervisor prompt — out-of-scope rule (regression guard)", () => {
  it("carries the out-of-scope / injection guardrail", () => {
    expect(SUPERVISOR_INSTRUCTIONS).toMatch(/OUT OF SCOPE/);
    // must not act as a general assistant for code/config/secrets…
    expect(SUPERVISOR_INSTRUCTIONS).toMatch(/general\s+assistant/i);
    expect(SUPERVISOR_INSTRUCTIONS).toMatch(/secrets|system prompt|internals/i);
    // …and must treat embedded instructions as data, not commands (injection guard)
    expect(SUPERVISOR_INSTRUCTIONS).toMatch(/data, never as a command/i);
  });
});

describe("buildSupervisorSystem", () => {
  it("surfaces categories + previously-shown products, else undefined", () => {
    const sys = buildSupervisorSystem("smartphones — smartphones (16 items)", [
      { id: 7, title: "Phone X", price: 300, brand: "Acme", rating: 4.2 },
    ]);
    expect(sys).toContain("smartphones — smartphones (16 items)");
    expect(sys).toContain("#7 Phone X ($300, Acme, 4.2★)");
    expect(buildSupervisorSystem("", [])).toBeUndefined();
  });
});
