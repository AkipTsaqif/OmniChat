"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gt, or } from "drizzle-orm";

import { auth, signOut } from "@/auth";
import { db } from "@/db";
import {
  conversations,
  memories,
  messages,
  providerSettings,
  sharedChats,
  users,
} from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import type { MemoryCategory, MemorySuggestion } from "@/lib/types";

async function requireUserId() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

function titleFrom(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean;
}

async function assertOwned(conversationId: string, userId: string) {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Conversation not found");
}

/**
 * Persists the user's turn and returns the conversation to stream into.
 * The assistant reply is written by /api/chat once the stream completes.
 */
export async function createUserMessage(input: {
  conversationId: string | null;
  modelId: string;
  content: string;
}): Promise<{ conversationId: string }> {
  const userId = await requireUserId();
  const content = input.content.trim();
  if (!content) throw new Error("Message is empty");

  let conversationId = input.conversationId;

  if (conversationId) {
    await assertOwned(conversationId, userId);
  } else {
    const [created] = await db
      .insert(conversations)
      .values({
        userId,
        title: titleFrom(content),
        modelId: input.modelId,
      })
      .returning({ id: conversations.id });
    conversationId = created.id;
  }

  await db.insert(messages).values({
    conversationId,
    role: "user",
    content,
  });

  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return { conversationId };
}

export async function refreshChat() {
  revalidatePath("/", "layout");
}

export async function setConversationModel(
  conversationId: string,
  modelId: string,
) {
  const userId = await requireUserId();
  await db
    .update(conversations)
    .set({ modelId })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
      ),
    );
  revalidatePath("/");
}

export async function togglePinned(conversationId: string) {
  const userId = await requireUserId();
  const [row] = await db
    .select({ pinned: conversations.pinned })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
      ),
    )
    .limit(1);
  if (!row) return;

  await db
    .update(conversations)
    .set({ pinned: !row.pinned })
    .where(eq(conversations.id, conversationId));
  revalidatePath("/");
}

export async function renameConversation(
  conversationId: string,
  title: string,
) {
  const clean = title.trim();
  if (!clean) return;
  const userId = await requireUserId();
  await db
    .update(conversations)
    .set({ title: clean })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
      ),
    );
  revalidatePath("/");
}

export async function archiveConversation(conversationId: string) {
  const userId = await requireUserId();
  await db
    .update(conversations)
    .set({ archived: true })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
      ),
    );
  revalidatePath("/");
}

export async function deleteConversation(conversationId: string) {
  const userId = await requireUserId();
  await db
    .delete(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
      ),
    );
  revalidatePath("/");
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function prepareRegenerate(messageId: string): Promise<{
  conversationId: string;
  modelId: string;
}> {
  const userId = await requireUserId();

  const [row] = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      createdAt: messages.createdAt,
      role: messages.role,
      modelId: messages.modelId,
      convModelId: conversations.modelId,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(messages.id, messageId),
        eq(conversations.userId, userId),
      ),
    )
    .limit(1);

  if (!row) throw new Error("Message not found");
  if (row.role !== "assistant") {
    throw new Error("Can only regenerate assistant messages");
  }

  // Delete this assistant message and any messages created after it in this conversation
  await db
    .delete(messages)
    .where(
      and(
        eq(messages.conversationId, row.conversationId),
        or(
          eq(messages.id, row.id),
          gt(messages.createdAt, row.createdAt),
        ),
      ),
    );

  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, row.conversationId));

  return {
    conversationId: row.conversationId,
    modelId: row.modelId || row.convModelId,
  };
}

export async function setMessageFeedback(
  messageId: string,
  feedback: "like" | "dislike" | null,
) {
  const userId = await requireUserId();

  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(messages.id, messageId),
        eq(conversations.userId, userId),
      ),
    )
    .limit(1);

  if (!row) throw new Error("Message not found");

  await db
    .update(messages)
    .set({ feedback })
    .where(eq(messages.id, messageId));

  revalidatePath("/");
}

function clockTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function createOrUpdateShareLink(
  conversationId: string,
): Promise<{ shareId: string }> {
  const userId = await requireUserId();
  await assertOwned(conversationId, userId);

  const [conv] = await db
    .select({ title: conversations.title, modelId: conversations.modelId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conv) throw new Error("Conversation not found");

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      modelId: messages.modelId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  const snapshot = rows.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: clockTime(m.createdAt),
    modelId: m.modelId ?? undefined,
  }));

  const [existing] = await db
    .select({ id: sharedChats.id })
    .from(sharedChats)
    .where(eq(sharedChats.conversationId, conversationId))
    .limit(1);

  if (existing) {
    await db
      .update(sharedChats)
      .set({
        title: conv.title,
        modelId: conv.modelId,
        messagesSnapshot: snapshot,
        updatedAt: new Date(),
      })
      .where(eq(sharedChats.id, existing.id));
    return { shareId: existing.id };
  }

  const [created] = await db
    .insert(sharedChats)
    .values({
      conversationId,
      userId,
      title: conv.title,
      modelId: conv.modelId,
      messagesSnapshot: snapshot,
    })
    .returning({ id: sharedChats.id });

  return { shareId: created.id };
}

export async function getConversationShareInfo(
  conversationId: string,
): Promise<{ shareId: string } | null> {
  const userId = await requireUserId();
  await assertOwned(conversationId, userId);

  const [row] = await db
    .select({ id: sharedChats.id })
    .from(sharedChats)
    .where(eq(sharedChats.conversationId, conversationId))
    .limit(1);

  return row ? { shareId: row.id } : null;
}

export async function deleteShareLink(conversationId: string): Promise<void> {
  const userId = await requireUserId();
  await assertOwned(conversationId, userId);

  await db
    .delete(sharedChats)
    .where(eq(sharedChats.conversationId, conversationId));
}

/* ------------------------------------------------------------------ *
 * Cross-chat memory
 *
 * Every action here routes its lookup through messages -> conversations and
 * asserts conversations.userId, exactly like setMessageFeedback. A message or
 * memory id belonging to another account must fail closed rather than read or
 * write across users.
 * ------------------------------------------------------------------ */

const MEMORY_CATEGORIES: MemoryCategory[] = [
  "preference",
  "personal",
  "project",
  "constraint",
];

/** Resolves a message and proves the caller owns the conversation it is in. */
async function requireOwnedMessage(messageId: string) {
  const userId = await requireUserId();
  const [row] = await db
    .select({
      id: messages.id,
      role: messages.role,
      conversationId: messages.conversationId,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(eq(messages.id, messageId), eq(conversations.userId, userId)),
    )
    .limit(1);
  if (!row) throw new Error("Message not found");
  return { userId, ...row };
}

/** Same, for a memory id. */
async function requireOwnedMemory(memoryId: string) {
  const userId = await requireUserId();
  const [row] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Memory not found");
  return { userId };
}

/**
 * Saves a fact the user explicitly confirmed. Nothing reaches this function
 * without a click — capture is opt-in by construction.
 *
 * `global` decides binding only: a global memory keeps its provenance in
 * `sourceMessageId` but gets no `conversationId`, so it applies everywhere.
 */
export async function saveMemory(input: {
  messageId: string;
  category: MemoryCategory;
  content: string;
  global: boolean;
}): Promise<{ ok: boolean; error?: string; memoryId?: string }> {
  const content = input.content.trim();
  if (!content) return { ok: false, error: "A memory cannot be empty." };
  if (content.length > 400) {
    return { ok: false, error: "Keep a memory to one or two sentences." };
  }
  if (!MEMORY_CATEGORIES.includes(input.category)) {
    return { ok: false, error: "Choose a valid category." };
  }

  const owner = await requireOwnedMessage(input.messageId);

  const [created] = await db
    .insert(memories)
    .values({
      userId: owner.userId,
      conversationId: input.global ? null : owner.conversationId,
      category: input.category,
      content,
      sourceMessageId: input.messageId,
    })
    .returning({ id: memories.id });

  revalidatePath("/", "layout");
  return { ok: true, memoryId: created.id };
}

export async function updateMemory(
  memoryId: string,
  patch: { content?: string; category?: MemoryCategory },
): Promise<{ ok: boolean; error?: string }> {
  await requireOwnedMemory(memoryId);

  const content = patch.content?.trim();
  if (content !== undefined && !content) {
    return { ok: false, error: "A memory cannot be empty." };
  }
  if (content && content.length > 400) {
    return { ok: false, error: "Keep a memory to one or two sentences." };
  }
  if (patch.category && !MEMORY_CATEGORIES.includes(patch.category)) {
    return { ok: false, error: "Choose a valid category." };
  }

  await db
    .update(memories)
    .set({
      ...(content ? { content } : {}),
      ...(patch.category ? { category: patch.category } : {}),
      updatedAt: new Date(),
    })
    .where(eq(memories.id, memoryId));

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Flip a memory between "everywhere" and "this conversation only". */
export async function setMemoryScope(
  memoryId: string,
  global: boolean,
): Promise<{ ok: boolean }> {
  await requireOwnedMemory(memoryId);

  const [row] = await db
    .select({
      bound: memories.conversationId,
      origin: messages.conversationId,
    })
    .from(memories)
    .leftJoin(messages, eq(memories.sourceMessageId, messages.id))
    .where(eq(memories.id, memoryId))
    .limit(1);

  await db
    .update(memories)
    .set({
      // Going global drops the binding. Going back needs one, and a global
      // memory has already let go of it — so fall back to the conversation its
      // source message lived in, which is the only one it can mean anything in.
      conversationId: global ? null : (row?.bound ?? row?.origin ?? null),
      updatedAt: new Date(),
    })
    .where(eq(memories.id, memoryId));

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Deactivate or restore. Archived is a soft forget, not a delete. */
export async function setMemoryStatus(
  memoryId: string,
  status: "active" | "archived",
): Promise<{ ok: boolean }> {
  await requireOwnedMemory(memoryId);

  await db
    .update(memories)
    .set({ status, updatedAt: new Date() })
    .where(eq(memories.id, memoryId));

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteMemory(memoryId: string): Promise<{ ok: boolean }> {
  await requireOwnedMemory(memoryId);

  await db.delete(memories).where(eq(memories.id, memoryId));

  revalidatePath("/", "layout");
  return { ok: true };
}

/** The fast forgetting path: stop all of it being injected, keep the list. */
export async function deactivateAllMemories(): Promise<{ ok: boolean }> {
  const userId = await requireUserId();

  await db
    .update(memories)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(memories.userId, userId));

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Per-conversation clean room: a generic question gets no remembered context. */
export async function setConversationMemoryEnabled(
  conversationId: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  await assertOwned(conversationId, userId);

  await db
    .update(conversations)
    .set({ memoryEnabled: enabled, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  revalidatePath("/", "layout");
  return { ok: true };
}

const EXTRACTION_PROMPT = `Extract at most ONE fact about the USER that is worth carrying into future conversations — a stated preference, a personal detail, an ongoing project, or a hard constraint.

Rules:
- Only if the user is talking about themselves or stating how they want things done.
- Do NOT capture the topic of a question, task details, or anything merely asked about.
- Phrase it as one standalone sentence, understandable with no other context.
- When there is nothing worth keeping, return exactly: null

Reply with JSON only: {"category":"preference|personal|project|constraint","content":"..."}`;

/**
 * Whether to offer a memory suggestion after each turn. Off means the extra
 * extraction call is never made at all.
 */
export async function setAutoSuggestMemory(
  enabled: boolean,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();

  await db
    .update(users)
    .set({ autoSuggestMemory: enabled })
    .where(eq(users.id, userId));

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Proposes a memory. Writes NOTHING — the user sees and edits the text before
 * anything is stored, which is the whole difference between this and silent
 * extraction.
 */
export async function suggestMemory(
  messageId: string,
): Promise<MemorySuggestion | null> {
  const owner = await requireOwnedMessage(messageId);

  const [settings] = await db
    .select()
    .from(providerSettings)
    .where(eq(providerSettings.userId, owner.userId))
    .limit(1);
  if (!settings) return null;

  const [conversation] = await db
    .select({ modelId: conversations.modelId })
    .from(conversations)
    .where(eq(conversations.id, owner.conversationId))
    .limit(1);

  // The durable fact is usually in the user's turn, not the assistant's, so
  // give the extractor a little of both.
  const recent = (
    await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, owner.conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(4)
  ).reverse();

  const transcript = recent
    .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
    .join("\n\n");

  try {
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${decryptSecret(settings.apiKeyCipher)}`,
      },
      body: JSON.stringify({
        model: conversation?.modelId,
        stream: false,
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: transcript },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = body.choices?.[0]?.message?.content ?? "";
    const match = /\{[\s\S]*\}/.exec(raw);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as {
      category?: string;
      content?: string;
    };
    const content = parsed.content?.trim();
    if (!content || content.length > 400) return null;
    if (!parsed.category || !MEMORY_CATEGORIES.includes(parsed.category as MemoryCategory)) {
      return null;
    }

    return {
      category: parsed.category as MemoryCategory,
      content,
    };
  } catch {
    // A suggestion is a convenience; never let it surface as an error.
    return null;
  }
}
