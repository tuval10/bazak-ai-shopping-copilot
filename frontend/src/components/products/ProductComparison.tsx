"use client";

import type { Product, ProductResultsPart } from "@bazak/shared";
import { useState } from "react";
import { discountBadge, formatPrice, formatRating, hasDiscount, salePrice, stockInfo } from "@/lib/format";
import { FALLBACK_IMAGE } from "@/lib/images";

/** One product's image + title + price, used as a comparison column header. */
function ComparisonHeader({ product, isWinner }: { product: Product; isWinner: boolean }) {
  const [src, setSrc] = useState(product.thumbnail || FALLBACK_IMAGE);
  const [errored, setErrored] = useState(false);
  const discounted = hasDiscount(product);

  return (
    <div className="flex flex-col items-center text-center gap-1 p-2">
      {isWinner && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-bazak">
          ✓ Best pick
        </span>
      )}
      <div className="relative w-20 h-20 rounded-lg bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element -- plain <img> with JS fallback (no next/image). */}
        <img
          src={errored ? FALLBACK_IMAGE : src}
          alt={product.title}
          className="w-full h-full object-contain p-1.5"
          onError={() => {
            if (!errored) {
              setErrored(true);
              setSrc(FALLBACK_IMAGE);
            }
          }}
        />
      </div>
      {product.brand && (
        <p className="text-[9px] uppercase tracking-wide text-slate-400">{product.brand}</p>
      )}
      <h4 className="text-[11px] font-semibold text-slate-800 leading-snug line-clamp-2">
        {product.title}
      </h4>
      <span className="text-sm font-bold text-slate-900">{formatPrice(salePrice(product))}</span>
    </div>
  );
}

/** The spec rows compared across both columns — deterministic facts from each product. */
const ROWS: Array<{ label: string; value: (p: Product) => string }> = [
  { label: "Price", value: (p) => formatPrice(salePrice(p)) },
  { label: "Rating", value: (p) => formatRating(p.rating) },
  { label: "Availability", value: (p) => stockInfo(p).label },
  { label: "Brand", value: (p) => p.brand ?? "—" },
  { label: "Discount", value: (p) => (hasDiscount(p) ? discountBadge(p) : "—") },
];

/**
 * Two products side by side as a spec table (US-2.4): for "I'm torn between X and Y" or an
 * ambiguous "help me choose" with no clear winner. The optional `winnerId` column is
 * highlighted. Grounded — the server picks the two by id; this only renders.
 */
export function ProductComparison({ group }: { group: ProductResultsPart }) {
  const [a, b] = group.products;
  if (!a || !b) return null;
  const cols = [a, b];
  const isWinner = (p: Product) => group.winnerId === p.id;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" data-testid="product-comparison">
      {group.rationale && (
        <p className="px-3 pt-3 text-xs text-slate-600 leading-relaxed">{group.rationale}</p>
      )}

      <div className="grid grid-cols-2 divide-x divide-slate-100">
        {cols.map((p) => (
          <div key={p.id} className={isWinner(p) ? "bg-bazak-light/40" : ""}>
            <ComparisonHeader product={p} isWinner={isWinner(p)} />
          </div>
        ))}
      </div>

      <table className="w-full text-[11px] border-t border-slate-100">
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label} className="border-t border-slate-50">
              {cols.map((p, i) => (
                <td
                  key={p.id}
                  className={`px-3 py-1.5 align-top ${i === 0 ? "border-r border-slate-100" : ""} ${
                    isWinner(p) ? "bg-bazak-light/40 font-medium text-slate-800" : "text-slate-600"
                  }`}
                >
                  <span className="block text-[9px] uppercase tracking-wide text-slate-400">{row.label}</span>
                  {row.value(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
