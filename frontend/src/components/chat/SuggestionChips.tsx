"use client";

import type { SuggestionChip } from "@bazak/shared";

/**
 * One-tap suggestion chips under a bot turn. Clicking a chip autofills the composer
 * with its `message` (the user can edit before sending) — filter-style when results
 * were abundant, follow-up-search-style when they were weak/off-catalog.
 */
export function SuggestionChips({
  chips,
  onSelect,
}: {
  chips: SuggestionChip[];
  onSelect: (message: string) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="pl-9 flex flex-wrap gap-2" data-testid="suggestion-chips">
      {chips.map((chip, i) => (
        <button
          key={`${chip.label}-${i}`}
          type="button"
          onClick={() => onSelect(chip.message)}
          className="bg-bazak-light border border-bazak/20 hover:border-bazak text-bazak text-xs font-medium rounded-full px-3 py-1.5 transition"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
