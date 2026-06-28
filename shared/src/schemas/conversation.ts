import { z } from "zod";

export const messageRoleSchema = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

/** A single chat message, mirroring the Mastra thread-message shape we expose. */
export const chatMessageSchema = z.object({
  id: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.string(), // ISO 8601
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** A conversation as shown in the list (US-3.3); search filters these by title (US-3.4). */
export const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/** Full transcript for one thread, used to rehydrate on refresh (US-3.1). */
export const messageHistorySchema = z.object({
  threadId: z.string(),
  messages: z.array(chatMessageSchema),
});

export type MessageHistory = z.infer<typeof messageHistorySchema>;
