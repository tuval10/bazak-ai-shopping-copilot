"use client";

import type { ProductResultsPart } from "@bazak/shared";
import { useState } from "react";
import { RECOMMEND_BADGE } from "@/lib/badges";
import {
  discountBadge,
  formatPrice,
  formatRating,
  hasDiscount,
  salePrice,
  stockInfo,
} from "@/lib/format";
import { FALLBACK_IMAGE } from "@/lib/images";

/**
 * A single product spotlighted as the assistant's pick (US-2.2/2.3): a hero card with a
 * badge ribbon and the model-authored `rationale` (why it's the pick). Grounded — the
 * server picks the product by id; this only renders. Reuses the same display helpers and
 * image-fallback as ProductCard so price/stock/discount stay consistent.
 */
export function RecommendationCard({ group }: { group: ProductResultsPart }) {
  const product = group.products[0];
  const [src, setSrc] = useState(product?.thumbnail || FALLBACK_IMAGE);
  const [errored, setErrored] = useState(false);

  if (!product) return null;

  const badge = RECOMMEND_BADGE[group.badge ?? "recommended"];
  const stock = stockInfo(product);
  const discounted = hasDiscount(product);

  return (
    <article
      className={`bg-white rounded-2xl border-2 ${badge.ring} shadow-sm overflow-hidden`}
      data-testid="recommendation-card"
    >
      <div
        className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold ${badge.chip}`}
      >
        <span aria-hidden="true">{badge.icon}</span>
        {badge.label}
      </div>

      <div className="flex gap-3 p-3">
        <div className="relative w-28 h-28 shrink-0 rounded-xl bg-slate-50">
          {/* eslint-disable-next-line @next/next/no-img-element -- plain <img> with JS fallback (no next/image). */}
          <img
            src={errored ? FALLBACK_IMAGE : src}
            alt={product.title}
            className="w-full h-full object-contain p-2"
            onError={() => {
              if (!errored) {
                setErrored(true);
                setSrc(FALLBACK_IMAGE);
              }
            }}
          />
          {discounted && (
            <span className="absolute top-1 left-1 bg-rose-500 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
              {discountBadge(product)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex flex-col gap-0.5">
          {product.brand && (
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{product.brand}</p>
          )}
          <h4 className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">
            {product.title}
          </h4>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-base font-bold text-slate-900">{formatPrice(salePrice(product))}</span>
            {discounted && (
              <span className="text-[11px] text-slate-400 line-through">{formatPrice(product.price)}</span>
            )}
            <span className="text-[11px] text-amber-500">{formatRating(product.rating)}</span>
          </div>
          <span className="text-[11px] font-medium text-slate-500 mt-0.5">{stock.label}</span>
        </div>
      </div>

      {group.rationale && (
        <p className="px-3 pb-3 text-xs text-slate-600 leading-relaxed">{group.rationale}</p>
      )}
    </article>
  );
}
