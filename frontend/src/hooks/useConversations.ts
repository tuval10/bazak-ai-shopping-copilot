"use client";

import type { ConversationSummary } from "@bazak/shared";
import { useCallback, useEffect, useState } from "react";
import { createConversation, listConversations } from "@/api-client/conversations";
import { type MastraClient, mastraClient } from "@/lib/mastra-client";

export interface UseConversations {
  conversations: ConversationSummary[];
  loading: boolean;
  /** True if the thread list couldn't be read (storage error, US-5.2). */
  error: boolean;
  reload: () => Promise<void>;
  /** Create a new conversation and return its id (US-3.2). */
  create: () => Promise<string | null>;
}

/**
 * The conversations list, shared by the home screen and the in-chat sidebar
 * (US-3.2/3.3). Loads on mount; `create` makes a fresh thread and optimistically
 * prepends it. The Mastra client is injectable for tests.
 */
export function useConversations(client: MastraClient = mastraClient): UseConversations {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setConversations(await listConversations(client));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(async () => {
    try {
      const conversation = await createConversation(client);
      setConversations((prev) => [conversation, ...prev]);
      return conversation.id;
    } catch {
      setError(true);
      return null;
    }
  }, [client]);

  return { conversations, loading, error, reload, create };
}
