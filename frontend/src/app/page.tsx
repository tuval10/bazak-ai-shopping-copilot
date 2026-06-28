"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ConversationRow } from "@/components/conversations/ConversationRow";
import { NoResults } from "@/components/products/NoResults";
import { RememberedPrefs } from "@/components/profile/RememberedPrefs";
import { useConversations } from "@/hooks/useConversations";

/** Conversations list (home): resume, new, and client-side search (US-3.2/3.3/3.4). */
export default function HomePage() {
  const router = useRouter();
  const { conversations, loading, error, create } = useConversations();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
  }, [conversations, query]);

  async function onNew() {
    const id = await create();
    if (id) router.push(`/c/${id}`);
  }

  const firstRun = !loading && !error && conversations.length === 0;

  return (
    <main className="min-h-screen py-10 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        <header className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-bazak text-white grid place-items-center font-bold text-sm">B</div>
              <span className="font-semibold text-slate-900">Bazak Copilot</span>
            </div>
            <RememberedPrefs />
          </div>
          <button
            type="button"
            onClick={onNew}
            className="w-full bg-bazak hover:bg-bazak-dark text-white text-sm font-medium rounded-lg py-2.5 flex items-center justify-center gap-2 transition"
          >
            <span className="text-lg leading-none">＋</span> New conversation
          </button>
          {!firstRun && (
            <div className="mt-3 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">
                ⌕
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bazak/40"
              />
            </div>
          )}
        </header>

        {error ? (
          <p className="p-8 text-center text-sm text-slate-500">
            Couldn&apos;t load your conversations. They&apos;re still saved — try again in a moment.
          </p>
        ) : loading ? (
          <ul className="p-4 space-y-2" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="skeleton h-12 rounded-lg" />
            ))}
          </ul>
        ) : firstRun ? (
          <div className="grow grid place-items-center p-10 text-center" data-testid="first-run">
            <div>
              <div className="w-16 h-16 rounded-2xl bg-bazak-light grid place-items-center mx-auto mb-4 text-3xl">
                🛍️
              </div>
              <h2 className="font-semibold text-slate-900">Start shopping with Bazak</h2>
              <p className="text-sm text-slate-500 mt-1 mb-5 max-w-xs mx-auto">
                Describe what you&apos;re looking for in plain language and I&apos;ll find it in the catalog.
              </p>
              <button
                type="button"
                onClick={onNew}
                className="bg-bazak hover:bg-bazak-dark text-white text-sm font-medium rounded-lg px-5 py-2.5 transition"
              >
                Start a conversation
              </button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <NoResults query={query} onClear={() => setQuery("")} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((c) => (
              <ConversationRow key={c.id} conversation={c} active={false} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
