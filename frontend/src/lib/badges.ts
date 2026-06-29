/**
 * The two spotlight flavours shared by the hero RecommendationCard and the inline
 * badge a recommended product wears inside the catalog grid (US-2.2/2.3/D16). One
 * source of truth so copy + accent stay consistent wherever a pick is marked.
 */
export const RECOMMEND_BADGE = {
  recommended: {
    label: "Recommended",
    short: "Recommended",
    icon: "⭐",
    ring: "border-bazak",
    chip: "bg-bazak text-white",
  },
  "best-value": {
    label: "Best value for money",
    short: "Best value",
    icon: "💰",
    ring: "border-emerald-400",
    chip: "bg-emerald-500 text-white",
  },
} as const;

export type RecommendBadge = keyof typeof RECOMMEND_BADGE;
