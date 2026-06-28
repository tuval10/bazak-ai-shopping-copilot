"use client";

import type { ProductResultsPart } from "@bazak/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { type UiMessage, getMessages, renameConversation } from "@/api-client/conversations";
import { runTurn } from "@/api-client/turn";
import { type MastraClient, mastraClient } from "@/lib/mastra-client";

export type ConversationStatus = "loading" | "idle" | "streaming" | "error";

/** The assistant turn being streamed: cards accumulate, prose lands at the end. */
export interface StreamingTurn {
  groups: ProductResultsPart[];
  text: string;
}

export interface UseConversation {
  messages: UiMessage[];
  status: ConversationStatus;
  streaming: StreamingTurn | null;
  /** Set when a turn failed; the same message can be retried. */
  failedMessage: string | null;
  /** True if history couldn't be loaded (storage error, US-5.2). */
  loadError: boolean;
  send: (message: string) => Promise<void>;
  retry: () => Promise<void>;
  showMore: () => Promise<void>;
}

let tempCounter = 0;
const tempId = (role: string) => `temp-${role}-${Date.now()}-${tempCounter++}`;

/**
 * Drives one conversation screen (US-3.1, US-1.x, US-5.2): loads history on mount,
 * sends a turn with an optimistic user bubble, renders the workflow stream
 * progressively (cards as they arrive, prose at the end), and exposes retry +
 * "show more" (a follow-up turn, US-1.4/US-4.5). The Mastra client is injectable for
 * tests; the real singleton is the default.
 */
export function useConversation(
  threadId: string,
  client: MastraClient = mastraClient,
): UseConversation {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [status, setStatus] = useState<ConversationStatus>("loading");
  const [streaming, setStreaming] = useState<StreamingTurn | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Tracks whether this turn is the first, to set the conversation title from it.
  const messageCountRef = useRef(0);
  messageCountRef.current = messages.length;

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setLoadError(false);
    getMessages(client, threadId)
      .then((history) => {
        if (cancelled) return;
        setMessages(history);
        setStatus("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setStatus("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, client]);

  const runStream = useCallback(
    async (message: string, isFirstTurn: boolean) => {
      setStatus("streaming");
      setStreaming({ groups: [], text: "" });
      setFailedMessage(null);
      try {
        let last: StreamingTurn = { groups: [], text: "" };
        for await (const state of runTurn({ threadId, message }, client)) {
          last = { groups: state.groups, text: state.text };
          setStreaming(last);
        }
        const assistant: UiMessage = {
          id: tempId("assistant"),
          role: "assistant",
          content: last.text,
          createdAt: new Date().toISOString(),
          ...(last.groups.length > 0 ? { results: last.groups } : {}),
        };
        setMessages((prev) => [...prev, assistant]);
        setStreaming(null);
        setStatus("idle");
        // First user message becomes the conversation title (US-3.3). Best-effort.
        if (isFirstTurn) {
          renameConversation(client, threadId, message).catch(() => {});
        }
      } catch {
        setStreaming(null);
        setStatus("error");
        setFailedMessage(message);
      }
    },
    [threadId, client],
  );

  const send = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || status === "streaming") return;
      const isFirstTurn = messageCountRef.current === 0;
      const userMessage: UiMessage = {
        id: tempId("user"),
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      await runStream(trimmed, isFirstTurn);
    },
    [status, runStream],
  );

  const retry = useCallback(async () => {
    if (!failedMessage) return;
    // The user bubble is already on screen from the failed attempt — don't re-add it.
    await runStream(failedMessage, false);
  }, [failedMessage, runStream]);

  const showMore = useCallback(async () => {
    await send("Show me more options.");
  }, [send]);

  return { messages, status, streaming, failedMessage, loadError, send, retry, showMore };
}
