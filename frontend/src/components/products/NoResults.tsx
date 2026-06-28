"use client";

/**
 * The conversation-search no-match state (US-3.4): calm, not alarming, with a clear
 * way back. From `UX/mocks` · Conversation search · no match. (Catalog no-results is
 * handled in-chat by the assistant prose + nearest-alternatives cards, US-4.4.)
 */
export function NoResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="text-center py-8 px-6">
      <div className="text-3xl mb-3">🔍</div>
      <h2 className="font-medium text-slate-800 text-sm">No conversations match “{query}”</h2>
      <p className="text-xs text-slate-500 mt-1 mb-4">Try a different keyword, or clear the search.</p>
      <button type="button" onClick={onClear} className="text-bazak text-sm font-medium hover:underline">
        Clear search · show all
      </button>
    </div>
  );
}
