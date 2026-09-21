"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, gt, or } from "drizzle-orm";

import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { conversations, messages, sharedChats } from "@/db/schema";

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
