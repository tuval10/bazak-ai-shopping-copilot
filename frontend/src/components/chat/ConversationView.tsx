"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { UiMessage } from "@/api-client/conversations";
import { useConversation } from "@/hooks/useConversation";
import type { MastraClient } from "@/lib/mastra-client";
import { ProductResults } from "@/components/products/ProductResults";
import { BotMessage } from "./BotMessage";
import { Composer } from "./Composer";
import { Loading } from "./Loading";
import { SuggestionChips } from "./SuggestionChips";
import { UserMessage } from "./UserMessage";

const EXAMPLE_PROMPTS = ["a phone under $500", "best-rated headphones", "something cheap and cool"];

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex-1 grid place-items-center p-6 text-center" data-testid="empty-state">
      <div>
        <div className="w-14 h-14 rounded-2xl bg-bazak-light grid place-items-center mx-auto mb-3 text-2xl">
          🛍️
        </div>
        <h3 className="font-semibold text-slate-900">Hi, I&apos;m your Bazak copilot</h3>
        <p className="text-sm text-slate-500 mt-1 mb-4">Tell me what you&apos;re shopping for in your own words.</p>
        <div className="flex flex-wrap gap-2 justify-center">
          {EXAMPLE_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPick(p)}
              className="bg-slate-50 border border-slate-200 hover:border-bazak rounded-full px-3 py-1.5 text-xs text-slate-600 transition"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AssistantTurn({
  message,
  isLatest,
  onShowMore,
  showMorePending,
  onSelectChip,
}: {
  message: UiMessage;
  isLatest: boolean;
  onShowMore: () => void;
  showMorePending: boolean;
  onSelectChip: (message: string) => void;
}) {
  return (
    <div className="space-y-3">
      {message.content && <BotMessage text={message.content} />}
      {message.results && message.results.length > 0 && (
        <div className="pl-9">
          <ProductResults
            groups={message.results}
            onShowMore={isLatest ? onShowMore : undefined}
            showMorePending={showMorePending}
          />
        </div>
      )}
      {/* Chips drive the NEXT message, so only the latest turn's are actionable. */}
      {isLatest && message.chips && message.chips.length > 0 && (
        <SuggestionChips chips={message.chips} onSelect={onSelectChip} />
      )}
    </div>
  );
}

/**
 * The chat column (US-1.x, US-3.1, US-5.2): transcript, progressive streaming (cards as
 * they arrive, typing indicator until the prose lands), empty/new-chat state, error +
 * Retry, autoscroll, and the composer. State lives in `useConversation`.
 */
export function ConversationView({
  threadId,
  client,
}: {
  threadId: string;
  client?: MastraClient;
}) {
  const { messages, status, streaming, failedMessage, loadError, draft, setDraft, send, retry, showMore } =
    useConversation(threadId, client);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Guard: jsdom (tests) doesn't implement Element.scrollTo.
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming, status]);

  const title = messages.find((m) => m.role === "user")?.content ?? "New conversation";
  const isEmpty = messages.length === 0 && status !== "loading" && !streaming;
  const lastId = messages.at(-1)?.id;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900 text-sm truncate">{title}</h2>
        <Link href="/" className="text-xs text-slate-500 hover:text-bazak">
          ＋ New
        </Link>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
        {status === "loading" && <Loading status="Loading conversation…" showSkeletons={false} />}

        {loadError && (
          <BotMessage tone="error" text="Couldn't load this conversation. It's still saved — try reopening it." />
        )}

        {isEmpty && !loadError && <EmptyState onPick={send} />}

        {messages.map((m) =>
          m.role === "user" ? (
            <UserMessage key={m.id} text={m.content} />
          ) : (
            <AssistantTurn
              key={m.id}
              message={m}
              isLatest={m.id === lastId}
              onShowMore={showMore}
              showMorePending={status === "streaming"}
              onSelectChip={setDraft}
            />
          ),
        )}

        {streaming && (
          <div className="space-y-3">
            <Loading showSkeletons={streaming.groups.length === 0} />
            {streaming.groups.length > 0 && (
              <div className="pl-9">
                <ProductResults groups={streaming.groups} />
              </div>
            )}
            {streaming.chips.length > 0 && (
              <SuggestionChips chips={streaming.chips} onSelect={setDraft} />
            )}
          </div>
        )}

        {status === "error" && failedMessage && (
          <BotMessage
            tone="error"
            text="Something went wrong reaching the catalog. Your conversation is saved — try again in a moment."
            onRetry={retry}
          />
        )}
      </div>

      <Composer
        onSend={send}
        disabled={status === "streaming"}
        value={draft}
        onValueChange={setDraft}
      />
    </div>
  );
}
