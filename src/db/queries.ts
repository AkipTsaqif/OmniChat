import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { conversations, messages, providerSettings, searchSettings, sharedChats, users } from "@/db/schema";
import type { Conversation, Message } from "@/lib/types";

function bucketFor(date: Date): Conversation["bucket"] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const diffDays = Math.floor(
    (startOfToday.getTime() - date.getTime()) / 86_400_000,
  );

  if (date.getTime() >= startOfToday.getTime()) return "Today";
  if (diffDays < 1) return "Yesterday";
  if (diffDays < 7) return "Previous 7 days";
  return "Older";
}

function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

function clockTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: clockTime(row.createdAt),
    modelId: row.modelId ?? undefined,
    attachments: row.attachments ?? undefined,
    toolCalls: row.toolCalls ?? undefined,
    feedback: row.feedback ?? undefined,
    stats:
      row.tokens != null && row.latencyMs != null
        ? {
            tokens: row.tokens,
            latency: `${(row.latencyMs / 1000).toFixed(1)}s`,
          }
        : undefined,
  };
}

export async function getConversations(
  userId: string,
): Promise<Conversation[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.userId, userId), eq(conversations.archived, false)),
    )
    .orderBy(desc(conversations.updatedAt));

  if (rows.length === 0) return [];

  const ids = new Set(rows.map((r) => r.id));
  const allMessages = await db
    .select()
    .from(messages)
    .orderBy(asc(messages.createdAt));

  const byConversation = new Map<string, Message[]>();
  for (const row of allMessages) {
    if (!ids.has(row.conversationId)) continue;
    const list = byConversation.get(row.conversationId) ?? [];
    list.push(toMessage(row));
    byConversation.set(row.conversationId, list);
  }

  return rows.map((row) => {
    const list = byConversation.get(row.id) ?? [];
    return {
      id: row.id,
      title: row.title,
      modelId: row.modelId,
      systemPrompt: row.systemPrompt,
      updatedAt: relativeTime(row.updatedAt),
      bucket: bucketFor(row.updatedAt),
      pinned: row.pinned,
      preview: list.at(-1)?.content.slice(0, 120) ?? "",
      messages: list,
    };
  });
}

/** Non-secret summary of the stored provider settings, safe for the client. */
export async function getProviderSummary(userId: string) {
  const [row] = await db
    .select({
      provider: providerSettings.provider,
      baseUrl: providerSettings.baseUrl,
      last4: providerSettings.apiKeyLast4,
    })
    .from(providerSettings)
    .where(eq(providerSettings.userId, userId))
    .limit(1);

  return row ?? null;
}

/** Non-secret summary of the web search settings, safe for the client. */
export async function getSearchSummary(userId: string) {
  const [row] = await db
    .select({
      preferred: searchSettings.preferred,
      tavilyLast4: searchSettings.tavilyApiKeyLast4,
      searxngUrl: searchSettings.searxngUrl,
    })
    .from(searchSettings)
    .where(eq(searchSettings.userId, userId))
    .limit(1);

  return row ?? null;
}

export async function getUserSystemPrompt(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ systemPrompt: users.systemPrompt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row?.systemPrompt ?? null;
}

export async function getSharedChat(id: string) {
  const [row] = await db
    .select()
    .from(sharedChats)
    .where(eq(sharedChats.id, id))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    modelId: row.modelId,
    messages: row.messagesSnapshot,
    createdAt: clockTime(row.createdAt),
    updatedAt: relativeTime(row.updatedAt),
  };
}
