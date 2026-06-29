"use client";

import type { ProductResultsPart } from "@bazak/shared";
import type { RecommendBadge } from "@/lib/badges";
import { ProductCardGroup } from "./ProductCardGroup";
import { ProductComparison } from "./ProductComparison";
import { RecommendationCard } from "./RecommendationCard";

/** Render one group by its presentation variant (US-2.2/2.3/2.4); default is the card grid. */
function ResultsGroup({
  group,
  showLabel,
  recommendedBadges,
}: {
  group: ProductResultsPart;
  showLabel: boolean;
  recommendedBadges?: Map<number, RecommendBadge>;
}) {
  if (group.display === "recommendation") return <RecommendationCard group={group} />;
  if (group.display === "comparison") return <ProductComparison group={group} />;
  return <ProductCardGroup group={group} showLabel={showLabel} recommendedBadges={recommendedBadges} />;
}

/** Ids shown in a grid this turn → so a recommendation of one is marked inline, not duplicated. */
function gridProductIds(groups: ProductResultsPart[]): Set<number> {
  return new Set(
    groups.filter((g) => !g.display || g.display === "grid").flatMap((g) => g.products.map((p) => p.id)),
  );
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
  // A product the bot recommended that is ALSO in a grid this turn gets an inline badge on
  // its card; its standalone hero is dropped so the catalog marks the pick without a dupe.
  const gridIds = gridProductIds(groups);
  const recommendedBadges = new Map<number, RecommendBadge>();
  const visible = groups.filter((g) => {
    if (g.display !== "recommendation") return true;
    const pick = g.products[0];
    if (pick && gridIds.has(pick.id)) {
      recommendedBadges.set(pick.id, g.badge ?? "recommended");
      return false; // marked inline on the grid card instead of a duplicate hero
    }
    return true;
  });

  // Only plain grid groups get a multi-intent label; spotlights stand on their own.
  const multi = visible.filter((g) => !g.display || g.display === "grid").length > 1;
  const shownCount = visible.reduce((n, g) => n + g.products.length, 0);
  if (shownCount === 0 && visible.length === 0) return null;

  return (
    <div className="space-y-3">
      {visible.map((group, i) => (
        <ResultsGroup
          key={`${group.intent}-${i}`}
          group={group}
          showLabel={multi}
          recommendedBadges={recommendedBadges}
        />
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
