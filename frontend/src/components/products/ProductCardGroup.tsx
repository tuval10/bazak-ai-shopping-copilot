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
