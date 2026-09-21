import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ChatView } from "@/components/chat/chat-view";
import { getAvailableModels } from "@/db/models";
import { getConversations, getProviderSummary } from "@/db/queries";

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

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [conversations, provider, models] = await Promise.all([
    getConversations(session.user.id),
    getProviderSummary(session.user.id),
    getAvailableModels(session.user.id),
  ]);

  const email = session.user.email ?? "";

  return (
    <ChatView
      conversations={conversations}
      provider={provider}
      models={models}
      user={{
        name: session.user.name ?? email.split("@")[0],
        email,
        plan: "Free",
        initials: initialsFor(session.user.name, email),
      }}
    />
  );
}
