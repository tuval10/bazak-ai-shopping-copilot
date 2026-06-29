import type { ProductResultsPart } from "@bazak/shared";
import { intentEmoji } from "@/lib/format";
import { ProductCard } from "./ProductCard";

/**
 * One intent's results as a labelled card grid (US-1.3). The label is shown when a
 * turn has multiple groups (multi-intent), so each block is identifiable; a single
 * group leans on the assistant's summary instead. An empty group states it plainly.
 */
export function ProductCardGroup({
  group,
  showLabel = false,
}: {
  group: ProductResultsPart;
  showLabel?: boolean;
}) {
  return (
    <div data-testid="product-group">
      {showLabel && (
        <p className="text-xs font-semibold text-slate-500 mb-1.5">
          {intentEmoji(group.intent)} {group.intent}
        </p>
      )}
      {/* Why we're showing these: the model-authored angle + the deterministic relaxation. */}
      {(group.rationale || group.relaxed) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          {group.relaxed && (
            <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              Relaxed: {group.relaxed.from} → {group.relaxed.to}
            </span>
          )}
          {group.rationale && <span className="text-xs text-slate-500">{group.rationale}</span>}
        </div>
      )}
      {group.products.length === 0 ? (
        <p className="text-xs text-slate-500">No matching products for “{group.intent}”.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {group.products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
