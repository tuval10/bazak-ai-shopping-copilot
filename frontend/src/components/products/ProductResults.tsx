"use client";

import type { ProductResultsPart } from "@bazak/shared";
import { ProductCardGroup } from "./ProductCardGroup";
import { ProductComparison } from "./ProductComparison";
import { RecommendationCard } from "./RecommendationCard";

/** Render one group by its presentation variant (US-2.2/2.3/2.4); default is the card grid. */
function ResultsGroup({ group, showLabel }: { group: ProductResultsPart; showLabel: boolean }) {
  if (group.display === "recommendation") return <RecommendationCard group={group} />;
  if (group.display === "comparison") return <ProductComparison group={group} />;
  return <ProductCardGroup group={group} showLabel={showLabel} />;
}

/**
 * All product groups for one assistant turn, plus the "Show more" affordance (US-1.4).
 * Multiple groups (multi-intent, US-1.3) each get a label; a single group doesn't.
 * A group may instead be a focused spotlight (recommendation) or a side-by-side
 * comparison (US-2.2/2.3/2.4). "Show more" issues a follow-up turn (wired by the
 * conversation, enabled by US-4.5).
 */
export function ProductResults({
  groups,
  onShowMore,
  showMorePending = false,
}: {
  groups: ProductResultsPart[];
  onShowMore?: () => void;
  showMorePending?: boolean;
}) {
  // Only plain grid groups get a multi-intent label; spotlights stand on their own.
  const multi = groups.filter((g) => !g.display || g.display === "grid").length > 1;
  const shownCount = groups.reduce((n, g) => n + g.products.length, 0);
  if (shownCount === 0 && groups.length === 0) return null;

  return (
    <div className="space-y-3">
      {groups.map((group, i) => (
        <ResultsGroup key={`${group.intent}-${i}`} group={group} showLabel={multi} />
      ))}

      {shownCount > 0 && onShowMore && (
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-xs text-slate-500">Showing {shownCount}</span>
          <button
            type="button"
            onClick={onShowMore}
            disabled={showMorePending}
            className="bg-white border border-slate-200 hover:border-bazak text-bazak text-sm font-medium rounded-lg px-4 py-1.5 transition disabled:opacity-50"
          >
            {showMorePending ? "Loading…" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}
