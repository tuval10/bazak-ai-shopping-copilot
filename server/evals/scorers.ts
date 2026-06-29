import {
  createScorer,
  type MastraScorer,
  type ScorerRunInputForAgent,
  type ScorerRunOutputForAgent,
} from "@mastra/core/evals";
import { checks } from "@mastra/evals/checks";
import { z } from "zod";
import { type ToolExpect } from "./scenarios";
import { toToolCallMessages, type TurnTrace } from "./trace";

/**
 * The judge model. Deliberately a STRONGER, INDEPENDENT model than the system under
 * test (the agents run `gpt-5.4-mini`) to reduce self-evaluation bias. Override with
 * `EVAL_JUDGE_MODEL` if your gateway exposes a different flagship id.
 */
export const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "openai/gpt-5.4";

/** What the judge is handed for one turn: the ask, the expectations, and prior context. */
export interface JudgeInput {
  message: string;
  expectations: string[];
  priorContext?: string;
}

const analysisSchema = z.object({
  summary: z.string(),
  criteria: z.array(
    z.object({
      name: z.string(),
      met: z.boolean(),
      note: z.string(),
    }),
  ),
});
type Analysis = z.infer<typeof analysisSchema>;

const JUDGE_INSTRUCTIONS = `You are a STRICT evaluator of a shopping-assistant turn. You are given the
user's message, a list of EXPECTED behaviors, and a faithful trace of what the assistant ACTUALLY did
(its reply text, which tools it called with what arguments, and the product cards it showed).

Grade each expected behavior independently as one criterion. A criterion is met ONLY if the trace
clearly shows it. Judge BEHAVIOR, not inventory: do not require specific products — but DO require that
products shown are grounded (the assistant must not claim a product/attribute absent from the cards).
Be skeptical: if the trace doesn't support an expectation, mark it NOT met. Do not give credit for good
intentions, apologies, or plausible-sounding prose that the trace contradicts. Reward correct tool
choice (e.g. searching when it should, NOT re-searching when answering from context, declining
out-of-scope without using tools).

Return one criterion per expected behavior, using the expectation text as the criterion name.`;

function renderTrace(t: TurnTrace): string {
  const tools = t.toolCalls.length
    ? t.toolCalls.map((c) => `${c.tool}(${JSON.stringify(c.args)}) -> ${c.outcome}`).join("\n  ")
    : "(no tools called)";
  const cards = t.cards.length
    ? t.cards
        .map(
          (c) =>
            `[${c.display}${c.badge ? `:${c.badge}` : ""}] ${c.intent} — ${c.products
              .map((p) => `#${p.id} ${p.title} ($${p.price}, ${p.rating}★)`)
              .join("; ")}${c.relaxed ? ` (relaxed ${c.relaxed.constraint}: ${c.relaxed.from}→${c.relaxed.to})` : ""}`,
        )
        .join("\n  ")
    : "(no cards shown)";
  return `REPLY:\n  ${t.message}\n\nTOOLS CALLED:\n  ${tools}\n\nCARDS SHOWN:\n  ${cards}\n\nCHIPS: ${
    t.chips.join(", ") || "(none)"
  }`;
}

function renderPrompt(input: JudgeInput, output: TurnTrace): string {
  const expectations = input.expectations.map((e, i) => `${i + 1}. ${e}`).join("\n");
  return [
    `USER MESSAGE: ${input.message}`,
    input.priorContext ? `PRIOR CONTEXT (already on screen):\n${input.priorContext}` : "",
    `\nEXPECTED BEHAVIORS (grade each as its own criterion):\n${expectations}`,
    `\nWHAT THE ASSISTANT ACTUALLY DID:\n${renderTrace(output)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The custom LLM-as-judge: compares the actual turn trace against the scenario's
 * expected behaviors and scores the fraction of expectations met. Score is `0..1`.
 */
export const behaviorJudge = createScorer({
  id: "behavior-judge",
  name: "Shopping behavior judge",
  description: "Grades a shopping-assistant turn against the scenario's expected behaviors.",
  judge: { model: JUDGE_MODEL, instructions: JUDGE_INSTRUCTIONS },
})
  .analyze({
    description: "Decide, per expected behavior, whether the trace shows it.",
    outputSchema: analysisSchema,
    createPrompt: ({ run }) => renderPrompt(run.input as JudgeInput, run.output as TurnTrace),
  })
  .generateScore(({ results }) => {
    const c = (results.analyzeStepResult as Analysis | undefined)?.criteria ?? [];
    return c.length ? c.filter((x) => x.met).length / c.length : 0;
  })
  .generateReason(({ results, score }) => {
    const a = results.analyzeStepResult as Analysis | undefined;
    const lines = (a?.criteria ?? []).map((c) => `  [${c.met ? "x" : " "}] ${c.name} — ${c.note}`);
    return `score=${score.toFixed(2)} — ${a?.summary ?? "(no summary)"}\n${lines.join("\n")}`;
  });

export interface ToolCheckResult {
  name: string;
  passed: boolean;
}

/**
 * Run the scenario's deterministic (zero-LLM) tool-usage checks via `@mastra/evals`
 * against the turn's recorded tool calls. Returns one result per declared check.
 */
// The `checks` are `type: 'agent'` scorers: their `.run` is typed for agent input/output
// (`extractToolCalls` only reads `output[].content.parts`). We feed a minimal empty input
// and the synthesized tool-call messages, cast to the agent shapes.
const EMPTY_AGENT_INPUT = {
  inputMessages: [],
  rememberedMessages: [],
  systemMessages: [],
  taggedSystemMessages: [],
} as unknown as ScorerRunInputForAgent;

export async function runToolChecks(
  expect: ToolExpect,
  toolCalls: TurnTrace["toolCalls"],
): Promise<ToolCheckResult[]> {
  const output = toToolCallMessages(toolCalls) as unknown as ScorerRunOutputForAgent;
  const specs: Array<{ name: string; scorer: MastraScorer<string> }> = [];

  if (expect.usedNoTools) specs.push({ name: "usedNoTools", scorer: checks.usedNoTools() });
  for (const c of expect.called ?? []) {
    const tool = typeof c === "string" ? c : c.tool;
    const times = typeof c === "string" ? 1 : (c.times ?? 1);
    specs.push({
      name: `calledTool(${tool}${times > 1 ? `×${times}` : ""})`,
      scorer: checks.calledTool(tool, { times }),
    });
  }
  for (const tool of expect.notCalled ?? []) {
    specs.push({ name: `didNotCall(${tool})`, scorer: checks.didNotCall(tool) });
  }
  if (expect.maxCalls !== undefined) {
    specs.push({ name: `maxToolCalls(${expect.maxCalls})`, scorer: checks.maxToolCalls(expect.maxCalls) });
  }
  if (expect.order) {
    specs.push({ name: `toolOrder(${expect.order.join("→")})`, scorer: checks.toolOrder(expect.order) });
  }

  const results: ToolCheckResult[] = [];
  for (const { name, scorer } of specs) {
    const r = await scorer.run({ input: EMPTY_AGENT_INPUT, output });
    results.push({ name, passed: r.score === 1 });
  }
  return results;
}
