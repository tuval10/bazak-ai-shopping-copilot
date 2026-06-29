"use client";

import type { Product } from "@bazak/shared";
import { useState } from "react";
import { RECOMMEND_BADGE, type RecommendBadge } from "@/lib/badges";
import {
  discountBadge,
  formatPrice,
  formatRating,
  hasDiscount,
  salePrice,
  stockInfo,
} from "@/lib/format";
import { FALLBACK_IMAGE } from "@/lib/images";

/** Per-state styling for the availability pill (text + colour, never colour-only — a11y). */
const STOCK_PILL: Record<string, { dot: string; text: string }> = {
  in: { dot: "bg-emerald-500", text: "text-emerald-600" },
  low: { dot: "bg-amber-500", text: "text-amber-600" },
  out: { dot: "bg-slate-400", text: "text-slate-500" },
};

/**
 * One catalog product, rendered inside the chat (US-2.1, US-1.7). Shows title,
 * description, derived sale price + struck original, rating, availability and any
 * deal — out-of-stock items are de-emphasised. Built from `UX/mocks/components.html`.
 */
export function ProductCard({ product, badge }: { product: Product; badge?: RecommendBadge }) {
  const [src, setSrc] = useState(product.thumbnail || FALLBACK_IMAGE);
  const [errored, setErrored] = useState(false);

  const stock = stockInfo(product);
  const pill = STOCK_PILL[stock.state] ?? STOCK_PILL.in!;
  const discounted = hasDiscount(product);
  const outOfStock = stock.state === "out";
  const mark = badge ? RECOMMEND_BADGE[badge] : null;

  return (
    <article
      className={`bg-white rounded-xl shadow-sm hover:shadow-md transition overflow-hidden flex flex-col ${
        mark ? `border-2 ${mark.ring}` : `border ${stock.state === "low" ? "border-amber-200" : "border-slate-200"}`
      } ${outOfStock ? "opacity-60" : ""}`}
      data-testid="product-card"
    >
      {mark && (
        <div className={`flex items-center gap-1 px-2 py-1 text-[10px] font-semibold ${mark.chip}`}>
          <span aria-hidden="true">{mark.icon}</span>
          {mark.short}
        </div>
      )}
      <div className="relative aspect-square bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element -- plain <img> with JS fallback (no next/image). */}
        <img
          src={errored ? FALLBACK_IMAGE : src}
          alt={product.title}
          className={`w-full h-full object-contain p-3 ${outOfStock && !errored ? "grayscale" : ""}`}
          onError={() => {
            if (!errored) {
              setErrored(true);
              setSrc(FALLBACK_IMAGE);
            }
          }}
        />
        {discounted && (
          <span className="absolute top-2 left-2 bg-rose-500 text-white text-[11px] font-semibold px-2 py-0.5 rounded-full">
            {discountBadge(product)}
          </span>
        )}
      </div>

      <div className="p-2.5 grow flex flex-col gap-0.5">
        {product.brand && (
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{product.brand}</p>
        )}
        <h4 className="text-xs font-semibold text-slate-800 leading-snug line-clamp-2">{product.title}</h4>
        <p className="text-[11px] text-slate-500 line-clamp-2">{product.description}</p>

        <div className="mt-auto pt-1 flex items-center justify-between">
          <div>
            <span className="text-sm font-bold text-slate-900">{formatPrice(salePrice(product))}</span>
            {discounted && (
              <span className="text-[10px] text-slate-400 line-through ml-1">{formatPrice(product.price)}</span>
            )}
          </div>
          <span className="text-[11px] text-amber-500">{formatRating(product.rating)}</span>
        </div>

        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${pill.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} aria-hidden="true" />
          {stock.label}
        </span>
      </div>
    </article>
  );
}
