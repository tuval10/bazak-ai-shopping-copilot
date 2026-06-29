import type { ToolCallRecord, WorkflowOutput } from "@bazak/shared";

/**
 * A compact, judge-readable view of one turn: the reply prose, which finders the
 * supervisor ran, every tool call (incl. refused), and the merchandised cards. This
 * is exactly what an LLM-judge needs to decide whether the agent *behaved* correctly
 * — not just what it said.
 */
export interface TurnTrace {
  message: string;
  finders: unknown[];
  toolCalls: ToolCallRecord[];
  cards: Array<{
    intent: string;
    display: string;
    badge?: string;
    winnerId?: number;
    rationale?: string;
    relaxed?: { constraint: string; from: string; to: string };
    products: Array<{ id: number; title: string; price: number; rating: number; brand?: string }>;
  }>;
  chips: string[];
}

/** Build the compact trace from a (trace-exposed) workflow output. */
export function buildTrace(out: WorkflowOutput): TurnTrace {
  return {
    message: out.message,
    finders: out.finders ?? [],
    toolCalls: out.toolCalls ?? [],
    cards: out.results.map((r) => ({
      intent: r.intent,
      display: r.display ?? "grid",
      ...(r.badge ? { badge: r.badge } : {}),
      ...(r.winnerId !== undefined ? { winnerId: r.winnerId } : {}),
      ...(r.rationale ? { rationale: r.rationale } : {}),
      ...(r.relaxed ? { relaxed: r.relaxed } : {}),
      products: r.products.map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        rating: p.rating,
        ...(p.brand ? { brand: p.brand } : {}),
      })),
    })),
    chips: out.chips.map((c) => c.label),
  };
}

/**
 * Re-shape recorded tool calls into the agent-message format the `@mastra/evals`
 * `checks` (calledTool / usedNoTools / toolOrder / maxToolCalls) read via their
 * internal `extractToolCalls(output)` — one assistant message whose `content.parts`
 * are `tool-invocation` parts. This lets the deterministic checks grade tool usage
 * directly off our trace.
 */
export function toToolCallMessages(toolCalls: ToolCallRecord[]) {
  return [
    {
      role: "assistant",
      content: {
        parts: toolCalls.map((tc, i) => ({
          type: "tool-invocation",
          toolInvocation: {
            toolName: tc.tool,
            toolCallId: `tc-${i}`,
            state: "result",
            args: tc.args,
            result: { outcome: tc.outcome },
          },
        })),
      },
    },
  ];
}
