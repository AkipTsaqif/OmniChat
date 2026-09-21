import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ChatView } from "@/components/chat/chat-view";
import { getAvailableModels } from "@/db/models";
import {
  getConversations,
  getProviderSummary,
  getUserSystemPrompt,
} from "@/db/queries";

export const dynamic = "force-dynamic";

function initialsFor(name: string | null | undefined, email: string) {
  const source = name?.trim() || email;
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;

  const [conversations, provider, models, systemPrompt] = await Promise.all([
    getConversations(session.user.id),
    getProviderSummary(session.user.id),
    getAvailableModels(session.user.id),
    getUserSystemPrompt(session.user.id),
  ]);

  // If conversation doesn't exist or is archived, redirect to /
  const exists = conversations.some((c) => c.id === id);
  if (!exists) {
    redirect("/");
  }

  const email = session.user.email ?? "";

  return (
    <ChatView
      initialActiveId={id}
      conversations={conversations}
      provider={provider}
      models={models}
      user={{
        name: session.user.name ?? email.split("@")[0],
        email,
        plan: "Free",
        initials: initialsFor(session.user.name, email),
        systemPrompt,
      }}
    />
  );
}
