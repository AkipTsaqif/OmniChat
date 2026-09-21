"use client";

import * as React from "react";
import { PanelLeftIcon, Share2Icon, StarIcon } from "lucide-react";

import type { Conversation, Message, Model } from "@/lib/types";
import {
  createUserMessage,
  refreshChat,
  setConversationModel,
  togglePinned,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { Composer } from "@/components/chat/composer";
import { EmptyState } from "@/components/chat/empty-state";
import { MessageBubble, TypingBubble } from "@/components/chat/message-bubble";
import { ModelPicker } from "@/components/chat/model-picker";
import {
  ProviderKeyDialog,
  type ProviderSummary,
} from "@/components/chat/provider-key-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserContext, type SessionUser } from "@/components/chat/user-context";

function ChatHeader({
  title,
  models,
  modelId,
  pinned,
  onModelChange,
  onTogglePin,
  onConfigure,
}: {
  title: string;
  models: Model[];
  modelId: string;
  pinned: boolean;
  onModelChange: (id: string) => void;
  onTogglePin: () => void;
  onConfigure: () => void;
}) {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Toggle sidebar"
        onClick={toggleSidebar}
      >
        <PanelLeftIcon />
      </Button>

      <Separator orientation="vertical" className="mr-1 h-4" />

      <h2 className="truncate text-sm font-medium">{title}</h2>

      <div className="ml-auto flex items-center gap-1">
        <div className="hidden sm:block">
          <ModelPicker
            models={models}
            value={modelId}
            onValueChange={onModelChange}
            onConfigure={onConfigure}
          />
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Star chat"
                onClick={onTogglePin}
              >
                <StarIcon className={pinned ? "fill-current" : undefined} />
              </Button>
            }
          />
          <TooltipContent>{pinned ? "Unpin" : "Pin"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Share chat">
                <Share2Icon />
              </Button>
            }
          />
          <TooltipContent>Share</TooltipContent>
        </Tooltip>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function ChatView({
  conversations,
  provider,
  models,
  user,
}: {
  conversations: Conversation[];
  provider: ProviderSummary;
  models: Model[];
  user: SessionUser;
}) {
  const [activeId, setActiveId] = React.useState<string | null>(
    conversations[0]?.id ?? null,
  );
  // Null until the user picks explicitly, so a late-arriving model list (after
  // the key is saved) still supplies a sensible default without an effect.
  const [draftModelId, setDraftModelId] = React.useState<string | null>(null);
  // Prompt on first load when there is no usable connection. Covers both
  // "never configured" and "configured but the gateway returned no models"
  // (unreachable host, revoked key), which would otherwise strand the user.
  const [keyDialogOpen, setKeyDialogOpen] = React.useState(
    !provider || models.length === 0,
  );
  const [, startTransition] = React.useTransition();

  // Local echo of the in-flight exchange, cleared once the server data lands.
  const [localUser, setLocalUser] = React.useState<Message | null>(null);
  const [streamText, setStreamText] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [streamError, setStreamError] = React.useState<string | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const hasModels = models.length > 0;
  const modelId =
    active?.modelId ?? draftModelId ?? models[0]?.id ?? "";

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length, localUser, streamText, streaming]);

  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function handleModelChange(next: string) {
    setDraftModelId(next);
    if (!activeId) return;
    startTransition(async () => {
      await setConversationModel(activeId, next);
    });
  }

  async function handleSend(text: string) {
    // No gateway, or no model to send to — ask for setup instead of failing.
    if (!provider || !modelId) {
      setKeyDialogOpen(true);
      return;
    }

    const now = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });

    setStreamError(null);
    setLocalUser({
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: now,
    });
    setStreamText("");
    setStreaming(true);

    let conversationId = activeId;
    try {
      const created = await createUserMessage({
        conversationId,
        modelId,
        content: text,
      });
      conversationId = created.conversationId;
      setActiveId(conversationId);
    } catch {
      setStreaming(false);
      setLocalUser(null);
      setStreamError("Could not save your message.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, modelId }),
        signal: controller.signal,
      });

      if (response.status === 428) {
        setStreaming(false);
        setKeyDialogOpen(true);
        return;
      }
      if (!response.ok || !response.body) {
        throw new Error(
          (await response.text()) || `Gateway error ${response.status}`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const dataLine = frame
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (!dataLine) continue;

          const payload = JSON.parse(dataLine.slice(5).trim());
          if (frame.includes("event: delta")) {
            setStreamText((prev) => prev + payload.delta);
          } else if (frame.includes("event: error")) {
            throw new Error(payload.message);
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setStreamError(
          error instanceof Error ? error.message : "The request failed.",
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Pull the canonical rows, then drop the local echo.
      startTransition(async () => {
        await refreshChat();
        setLocalUser(null);
        setStreamText("");
      });
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleTogglePin() {
    if (!activeId) return;
    startTransition(async () => {
      await togglePinned(activeId);
    });
  }

  const messages = active?.messages ?? [];
  const showTranscript = messages.length > 0 || localUser || streaming;

  return (
    <UserContext value={user}>
      <SidebarProvider>
        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={setActiveId}
          onNewChat={() => setActiveId(null)}
          onOpenSettings={() => setKeyDialogOpen(true)}
          provider={provider}
        />

        <SidebarInset className="h-svh overflow-hidden">
          <ChatHeader
            title={active?.title ?? "New chat"}
            models={models}
            modelId={modelId}
            pinned={active?.pinned ?? false}
            onModelChange={handleModelChange}
            onTogglePin={handleTogglePin}
            onConfigure={() => setKeyDialogOpen(true)}
          />

          <div className="flex min-h-0 flex-1 flex-col">
            {showTranscript ? (
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-3xl px-4 py-6">
                  {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}

                  {localUser ? <MessageBubble message={localUser} /> : null}

                  {streamText ? (
                    <MessageBubble
                      message={{
                        id: "streaming",
                        role: "assistant",
                        content: streamText,
                        createdAt: "",
                        modelId,
                      }}
                      streaming
                    />
                  ) : streaming ? (
                    <TypingBubble modelId={modelId} />
                  ) : null}

                  {streamError ? (
                    <p className="my-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {streamError}
                    </p>
                  ) : null}

                  <div ref={bottomRef} className="h-4" />
                </div>
              </div>
            ) : (
              <div className="flex flex-1 overflow-y-auto">
                <EmptyState
                  onPick={handleSend}
                  hasProvider={!!provider && hasModels}
                  isConfigured={!!provider}
                  onConfigure={() => setKeyDialogOpen(true)}
                />
              </div>
            )}

            <Composer
              models={models}
              modelId={modelId}
              onModelChange={handleModelChange}
              isStreaming={streaming}
              onSend={handleSend}
              onStop={handleStop}
              onConfigure={() => setKeyDialogOpen(true)}
            />
          </div>
        </SidebarInset>
      </SidebarProvider>

      <ProviderKeyDialog
        open={keyDialogOpen}
        onOpenChange={setKeyDialogOpen}
        current={provider}
      />
    </UserContext>
  );
}
