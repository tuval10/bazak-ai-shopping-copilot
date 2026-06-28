"use client";

import type { ConversationSummary } from "@bazak/shared";
import Link from "next/link";
import { formatRelativeTime } from "@/lib/format";

/** One row in the conversations list: title + relative time, highlighted when active. */
export function ConversationRow({
  conversation,
  active,
}: {
  conversation: ConversationSummary;
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={`/c/${conversation.id}`}
        className={`block p-3.5 cursor-pointer transition ${
          active ? "bg-bazak-light/50 border-l-2 border-bazak" : "hover:bg-bazak-light/60 border-l-2 border-transparent"
        }`}
      >
        <div className="flex justify-between items-baseline gap-2">
          <p className="font-medium text-slate-900 text-sm truncate">{conversation.title}</p>
          <span className="text-[11px] text-slate-400 shrink-0">
            {formatRelativeTime(conversation.updatedAt)}
          </span>
        </div>
      </Link>
    </li>
  );
}
