import type { ProductResultsPart } from "@bazak/shared";
import type { RecommendBadge } from "@/lib/badges";
import { intentEmoji } from "@/lib/format";
import { ProductCard } from "./ProductCard";

/** The catalog shows at most this many cards per group (UI cap; the backend also limits). */
const MAX_GRID_PRODUCTS = 3;

/**
 * One intent's results as a labelled card grid (US-1.3). The label is shown when a
 * turn has multiple groups (multi-intent), so each block is identifiable; a single
 * group leans on the assistant's summary instead. An empty group states it plainly.
 * A product whose id is in `recommendedBadges` wears an inline pick badge.
 */
export function ProductCardGroup({
  group,
  showLabel = false,
  recommendedBadges,
}: {
  group: ProductResultsPart;
  showLabel?: boolean;
  recommendedBadges?: Map<number, RecommendBadge>;
}) {
  return (
    <div data-testid="product-group">
      {showLabel && (
        <p className="text-xs font-semibold text-slate-500 mb-1.5">
          {intentEmoji(group.intent)} {group.intent}
        </p>
      )}
      {/* The retrieval `relaxed`/`rationale` are internal orchestration notes — never shown
          to the shopper; the assistant's prose does any honest framing (US-4.4). */}
      {group.products.length === 0 ? (
        <p className="text-xs text-slate-500">No matching products for “{group.intent}”.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {group.products.slice(0, MAX_GRID_PRODUCTS).map((product) => (
            <ProductCard key={product.id} product={product} badge={recommendedBadges?.get(product.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
