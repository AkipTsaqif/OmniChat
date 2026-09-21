"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";

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
  revalidatePath("/");
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
