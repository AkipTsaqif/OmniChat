"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  Share2Icon,
  StarIcon,
} from "lucide-react";

import type {
  Conversation,
  Feedback,
  Message,
  Model,
  ProviderStatus,
  ThinkingLevel,
  ToolCallInfo,
} from "@/lib/types";
import {
  createUserMessage,
  prepareRegenerate,
  refreshChat,
  setConversationModel,
  setMessageFeedback,
  togglePinned,
} from "@/app/actions";
import { cn } from "cn";
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
import { ShareDialog } from "@/components/chat/share-dialog";

function ChatHeader({
  title,
  models,
  modelId,
  pinned,
  canShare,
  onModelChange,
  onTogglePin,
  onConfigure,
  onShare,
}: {
  title: string;
  models: Model[];
  modelId: string;
  pinned: boolean;
  canShare: boolean;
  onModelChange: (id: string) => void;
  onTogglePin: () => void;
  onConfigure: () => void;
  onShare: () => void;
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
                aria-disabled={!canShare}
                className={cn(!canShare && "opacity-40 cursor-not-allowed")}
                onClick={() => {
                  if (canShare) onTogglePin();
                }}
              >
                <StarIcon className={pinned ? "fill-current" : undefined} />
              </Button>
            }
          />
          <TooltipContent>{!canShare ? "Start a chat to pin" : pinned ? "Unpin" : "Pin"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Share chat"
                aria-disabled={!canShare}
                className={cn(!canShare && "opacity-40 cursor-not-allowed")}
                onClick={() => {
                  if (canShare) onShare();
                }}
              >
                <Share2Icon />
              </Button>
            }
          />
          <TooltipContent>{canShare ? "Share chat" : "Start a chat to share"}</TooltipContent>
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
  providerStatus = "none",
  providerMessage = null,
  user,
  initialActiveId = null,
}: {
  conversations: Conversation[];
  provider: ProviderSummary;
  models: Model[];
  providerStatus?: ProviderStatus;
  providerMessage?: string | null;
  user: SessionUser;
  initialActiveId?: string | null;
}) {
  const router = useRouter();
  const [prevInitialId, setPrevInitialId] = React.useState(initialActiveId);
  const [activeId, setActiveId] = React.useState<string | null>(initialActiveId);
  const [thinkingLevel, setThinkingLevel] = React.useState<ThinkingLevel>("off");
  const [shareDialogOpen, setShareDialogOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<"provider" | "prompts">("provider");

  function handleOpenSettings(tab: "provider" | "prompts" = "provider") {
    setSettingsTab(tab);
    setKeyDialogOpen(true);
  }

  if (initialActiveId !== prevInitialId) {
    setPrevInitialId(initialActiveId);
    setActiveId(initialActiveId);
  }

  function handleSelect(id: string) {
    if (!id) {
      handleNewChat();
      return;
    }
    setActiveId(id);
    router.push(`/c/${id}`);
  }

  function handleNewChat() {
    setActiveId(null);
    router.push("/");
  }
  // Null until the user picks explicitly, so a late-arriving model list (after
  // the key is saved) still supplies a sensible default without an effect.
  const [draftModelId, setDraftModelId] = React.useState<string | null>(null);
  // Only force the dialog open when nothing is configured, or when the stored
  // key genuinely cannot be used again. A gateway that is merely down or
  // briefly unreachable should not nag for a key that is still valid.
  const [keyDialogOpen, setKeyDialogOpen] = React.useState(
    !provider || providerStatus === "key_undecryptable",
  );
  const [, startTransition] = React.useTransition();

  // Local echo of the in-flight exchange, cleared once the server data lands.
  const [localUser, setLocalUser] = React.useState<Message | null>(null);
  const [streamText, setStreamText] = React.useState("");
  const [streamingToolCalls, setStreamingToolCalls] = React.useState<ToolCallInfo[]>([]);
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

  async function handleSend(text: string, webSearch: boolean = true) {
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
      id: "local-user",
      role: "user",
      content: text,
      createdAt: now,
    });
    setStreamText("");
    setStreamingToolCalls([]);
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
      if (!activeId) {
        window.history.replaceState(null, "", `/c/${conversationId}`);
      }
    } catch {
      setStreaming(false);
      setLocalUser(null);
      setStreamError("Could not save your message.");
      return;
    }

    await streamResponse(conversationId, modelId, thinkingLevel, webSearch);
  }

  async function streamResponse(
    conversationId: string,
    modelId: string,
    level: ThinkingLevel = "off",
    webSearch: boolean = true,
  ) {
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          modelId,
          thinkingLevel: level,
          webSearch,
        }),
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
          } else if (frame.includes("event: tool_start")) {
            setStreamingToolCalls((prev) => {
              const existing = prev.find((t) => t.id === payload.id);
              if (existing) {
                return prev.map((t) =>
                  t.id === payload.id ? { ...t, ...payload } : t,
                );
              }
              return [...prev, payload];
            });
          } else if (frame.includes("event: tool_done")) {
            setStreamingToolCalls((prev) => {
              return prev.map((t) =>
                t.id === payload.id
                  ? { ...t, ...payload, state: "done" }
                  : t,
              );
            });
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
      abortRef.current = null;
      try {
        await refreshChat();
      } finally {
        setStreaming(false);
        setLocalUser(null);
        setStreamText("");
        setStreamingToolCalls([]);
      }
    }
  }

  async function handleRegenerate(messageId: string) {
    if (!provider || !modelId || streaming) {
      if (!provider || !modelId) setKeyDialogOpen(true);
      return;
    }

    setStreamError(null);
    setStreamText("");
    setStreaming(true);

    let targetConversationId: string;
    let targetModelId: string;

    try {
      const prepared = await prepareRegenerate(messageId);
      targetConversationId = prepared.conversationId;
      targetModelId = prepared.modelId || modelId;
      await refreshChat();
    } catch (error) {
      setStreaming(false);
      setStreamError(
        error instanceof Error ? error.message : "Failed to regenerate.",
      );
      return;
    }

    await streamResponse(targetConversationId, targetModelId, thinkingLevel);
  }

  function handleFeedback(messageId: string, feedback: Feedback | null) {
    startTransition(async () => {
      await setMessageFeedback(messageId, feedback);
    });
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

  async function handleRetry() {
    if (!activeId || streaming) return;
    setStreamError(null);
    const lastMsg = active?.messages.at(-1);
    if (!lastMsg) return;

    if (lastMsg.role === "user") {
      setStreamText("");
      setStreamingToolCalls([]);
      setStreaming(true);
      await streamResponse(activeId, modelId, thinkingLevel, true);
    } else if (lastMsg.role === "assistant") {
      await handleRegenerate(lastMsg.id);
    }
  }

  const messages = active?.messages ?? [];
  const lastMessage = messages.at(-1);
  const lastMessageWasUserAndNoAssistantReply =
    !streaming && !streamText && lastMessage?.role === "user";
  const showTranscript =
    Boolean(activeId) ||
    messages.length > 0 ||
    Boolean(localUser) ||
    streaming ||
    Boolean(streamText) ||
    streamingToolCalls.length > 0;

  const chatTitle =
    active?.title ||
    (localUser?.content
      ? localUser.content.length > 40
        ? `${localUser.content.slice(0, 40)}…`
        : localUser.content
      : "New chat");

  return (
    <UserContext value={user}>
      <SidebarProvider>
        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelect}
          onNewChat={handleNewChat}
          onOpenSettings={handleOpenSettings}
          provider={provider}
          providerStatus={providerStatus}
        />

        <SidebarInset className="h-svh overflow-hidden">
          <ChatHeader
            title={chatTitle}
            models={models}
            modelId={modelId}
            pinned={active?.pinned ?? false}
            canShare={Boolean(active)}
            onModelChange={handleModelChange}
            onTogglePin={handleTogglePin}
            onConfigure={() => handleOpenSettings("provider")}
            onShare={() => setShareDialogOpen(true)}
          />

          <div className="flex min-h-0 flex-1 flex-col">
            {showTranscript ? (
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-3xl px-4 py-6">
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      isStreaming={streaming}
                      onRegenerate={handleRegenerate}
                      onFeedback={handleFeedback}
                    />
                  ))}

                  {localUser ? <MessageBubble message={localUser} /> : null}

                  {streamText || streamingToolCalls.length > 0 ? (
                    <MessageBubble
                      message={{
                        id: "streaming",
                        role: "assistant",
                        content: streamText,
                        toolCalls: streamingToolCalls,
                        createdAt: "",
                        modelId,
                      }}
                      streaming
                    />
                  ) : streaming ? (
                    <TypingBubble modelId={modelId} />
                  ) : null}

                  {streamError ? (
                    <div className="my-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
                      <div className="flex items-center gap-2">
                        <AlertCircleIcon className="size-4 shrink-0" />
                        <span>{streamError}</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRetry}
                        className="h-7 shrink-0 gap-1.5 border-destructive/30 text-xs text-destructive hover:bg-destructive/15 cursor-pointer"
                      >
                        <RefreshCwIcon className="size-3" />
                        Retry
                      </Button>
                    </div>
                  ) : lastMessageWasUserAndNoAssistantReply ? (
                    <div className="my-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground">
                      <span>Response was interrupted.</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRetry}
                        className="h-7 gap-1.5 text-xs"
                      >
                        <RefreshCwIcon className="size-3" />
                        Generate reply
                      </Button>
                    </div>
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
                  providerStatus={providerStatus}
                  providerMessage={providerMessage}
                  onConfigure={() => handleOpenSettings("provider")}
                />
              </div>
            )}

            <Composer
              models={models}
              modelId={modelId}
              thinkingLevel={thinkingLevel}
              onThinkingLevelChange={setThinkingLevel}
              onModelChange={handleModelChange}
              isStreaming={streaming}
              onSend={handleSend}
              onStop={handleStop}
              onConfigure={() => handleOpenSettings("provider")}
              onOpenPrompts={() => handleOpenSettings("prompts")}
            />
          </div>
        </SidebarInset>
      </SidebarProvider>

      <ProviderKeyDialog
        open={keyDialogOpen}
        onOpenChange={setKeyDialogOpen}
        current={provider}
        initialTab={settingsTab}
        initialSystemPrompt={user.systemPrompt}
      />

      <ShareDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        conversationId={active?.id ?? null}
        conversationTitle={active?.title ?? "Chat"}
      />
    </UserContext>
  );
}
