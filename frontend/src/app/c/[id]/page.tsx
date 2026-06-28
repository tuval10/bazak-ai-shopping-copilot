"use client";

import { useParams } from "next/navigation";
import { ConversationView } from "@/components/chat/ConversationView";
import { Sidebar } from "@/components/conversations/Sidebar";

/** A conversation (US-3.1, D5): the app shell — sidebar + chat column. `{id}` is the thread id. */
export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const threadId = params.id;

  return (
    <main className="flex h-screen bg-white">
      <Sidebar activeId={threadId} />
      <ConversationView threadId={threadId} />
    </main>
  );
}
