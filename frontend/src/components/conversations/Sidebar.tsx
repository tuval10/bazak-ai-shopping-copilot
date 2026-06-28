"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useConversations } from "@/hooks/useConversations";
import type { MastraClient } from "@/lib/mastra-client";
import { ConversationRow } from "./ConversationRow";

/**
 * The conversations sidebar in the chat shell (US-3.2/3.3/3.4): brand, "New
 * conversation", client-side search, and the thread list with the active one
 * highlighted. Search filtering is client-side (no server text-search endpoint, D9).
 */
export function Sidebar({ activeId, client }: { activeId?: string; client?: MastraClient }) {
  const router = useRouter();
  const { conversations, loading, error, create } = useConversations(client);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
  }, [conversations, query]);

  async function onNew() {
    const id = await create();
    if (id) router.push(`/c/${id}`);
  }

  return (
    <aside className="w-64 border-r border-slate-100 hidden md:flex flex-col shrink-0">
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-bazak text-white grid place-items-center font-bold text-sm">B</div>
          <span className="font-semibold text-slate-900">Bazak Copilot</span>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="w-full bg-bazak hover:bg-bazak-dark text-white text-sm font-medium rounded-lg py-2 flex items-center justify-center gap-2 transition"
        >
          <span className="text-lg leading-none">＋</span> New conversation
        </button>
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
      </div>

      {error ? (
        <p className="p-4 text-xs text-slate-500">Couldn&apos;t load conversations. They&apos;re still saved — try again.</p>
      ) : loading ? (
        <ul className="p-3 space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="skeleton h-10 rounded-lg" />
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        <p className="p-4 text-xs text-slate-500">
          {query ? `No conversations match “${query}”.` : "No conversations yet — start one above."}
        </p>
      ) : (
        <ul className="overflow-y-auto text-sm divide-y divide-slate-100">
          {filtered.map((c) => (
            <ConversationRow key={c.id} conversation={c} active={c.id === activeId} />
          ))}
        </ul>
      )}
    </aside>
  );
}
