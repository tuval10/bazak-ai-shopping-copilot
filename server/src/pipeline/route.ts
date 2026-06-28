import type { Classification, SearchIntent } from "./classification";

/**
 * The deterministic routing decision (DECISIONS D2). Pure: given the
 * classification, decide whether to retrieve products and for which intents, or
 * to take a non-product branch (Epic 4).
 */
export type RoutePlan =
  | { kind: "product"; intents: SearchIntent[] }
  | { kind: "chitchat" }
  | { kind: "off_catalog" };

export function planRoute(classification: Classification): RoutePlan {
  if (classification.kind === "chitchat") return { kind: "chitchat" };
  if (classification.kind === "off_catalog") return { kind: "off_catalog" };
  // kind === "product": the classifier guarantees at least one search (the
  // classify step backfills one from the raw message if needed), so this branch
  // always has intents to retrieve.
  if (classification.searches.length === 0) return { kind: "off_catalog" };
  return { kind: "product", intents: classification.searches };
}
