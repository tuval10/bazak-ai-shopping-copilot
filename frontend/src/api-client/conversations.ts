import {
  type ChatMessage,
  type ConversationSummary,
  type ProductResultsPart,
  RESULTS_METADATA_KEY,
  chatMessageSchema,
  conversationSummarySchema,
  productResultsPartSchema,
} from "@bazak/shared";
import { AGENT_ID, type MastraClient, RESOURCE_ID, mastraClient } from "@/lib/mastra-client";

/** A chat message plus the product groups to re-render for an assistant turn (D12). */
export interface UiMessage extends ChatMessage {
  results?: ProductResultsPart[];
}

/** Structural view of a stored thread (Mastra `StorageThreadType`) — only the fields we map. */
interface RawThread {
  id: string;
  title?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

/** Structural view of a stored message (Mastra `MastraDBMessage`) — only the fields we map. */
interface RawMessage {
  id: string;
  role: string;
  createdAt?: string | Date;
  content:
    | string
    | {
        parts?: Array<{ type?: string; text?: string }>;
        content?: string;
        metadata?: Record<string, unknown>;
      };
}

function toIso(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  return new Date(0).toISOString();
}

/** Flatten a stored message's content to its plain text (US-3.1 transcript). */
function messageText(content: RawMessage["content"]): string {
  if (typeof content === "string") return content;
  const parts = content.parts ?? [];
  const text = parts
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  return text || (content.content ?? "");
}

/** Pull persisted results off an assistant message's metadata, validated (D12). */
function extractResults(content: RawMessage["content"]): ProductResultsPart[] | undefined {
  if (typeof content === "string") return undefined;
  const raw = content.metadata?.[RESULTS_METADATA_KEY];
  const parsed = productResultsPartSchema.array().safeParse(raw);
  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
}

/** Pure mapper: a stored thread → the list/summary shape (exported for unit tests). */
export function toConversationSummary(thread: RawThread): ConversationSummary {
  const createdAt = toIso(thread.createdAt);
  return conversationSummarySchema.parse({
    id: thread.id,
    title: thread.title?.trim() || "New conversation",
    createdAt,
    updatedAt: thread.updatedAt ? toIso(thread.updatedAt) : createdAt,
  });
}

/**
 * Pure mapper: stored messages → the transcript, dropping non-conversational roles and
 * rehydrating each assistant turn's product cards from metadata (exported for unit tests).
 */
export function toUiMessages(raw: RawMessage[]): UiMessage[] {
  const out: UiMessage[] = [];
  for (const m of raw) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const base = chatMessageSchema.safeParse({
      id: m.id,
      role: m.role,
      content: messageText(m.content),
      createdAt: toIso(m.createdAt),
    });
    if (!base.success) continue;
    const results = m.role === "assistant" ? extractResults(m.content) : undefined;
    out.push(results ? { ...base.data, results } : base.data);
  }
  return out;
}

function unwrapThreads(res: unknown): RawThread[] {
  if (Array.isArray(res)) return res as RawThread[];
  const threads = (res as { threads?: unknown })?.threads;
  return Array.isArray(threads) ? (threads as RawThread[]) : [];
}

/** List the user's conversations, newest activity first (US-3.3). */
export async function listConversations(
  client: MastraClient = mastraClient,
): Promise<ConversationSummary[]> {
  const res = await client.listMemoryThreads({
    resourceId: RESOURCE_ID,
    orderBy: { field: "updatedAt", direction: "DESC" },
  });
  return unwrapThreads(res)
    .map(toConversationSummary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Create a new conversation (US-3.2). */
export async function createConversation(
  client: MastraClient = mastraClient,
  title = "New conversation",
): Promise<ConversationSummary> {
  const res = await client.createMemoryThread({ resourceId: RESOURCE_ID, agentId: AGENT_ID, title });
  const thread = (res as { thread?: RawThread })?.thread ?? (res as RawThread);
  return toConversationSummary(thread);
}

/** Fetch a single conversation's metadata (resume header), or null if it's gone. */
export async function getConversation(
  client: MastraClient,
  threadId: string,
): Promise<ConversationSummary | null> {
  try {
    const thread = await client.getMemoryThread({ threadId, agentId: AGENT_ID }).get();
    return toConversationSummary(thread as unknown as RawThread);
  } catch {
    return null;
  }
}

/** Rename a conversation — used to set the title from the first user message (US-3.3). */
export async function renameConversation(
  client: MastraClient,
  threadId: string,
  title: string,
): Promise<void> {
  await client
    .getMemoryThread({ threadId, agentId: AGENT_ID })
    .update({ title, metadata: {}, resourceId: RESOURCE_ID });
}

/** Delete a conversation. Delete requires an agent scope on the server. */
export async function deleteConversation(client: MastraClient, threadId: string): Promise<void> {
  await client.deleteThread(threadId, { agentId: AGENT_ID });
}

/** Full transcript for a thread, rehydrated with cards (US-3.1). */
export async function getMessages(client: MastraClient, threadId: string): Promise<UiMessage[]> {
  const res = await client.getMemoryThread({ threadId, agentId: AGENT_ID }).listMessages();
  const messages = (res as { messages?: RawMessage[] })?.messages ?? [];
  return toUiMessages(messages);
}
