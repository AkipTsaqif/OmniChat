"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  BrainIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  Share2Icon,
  StarIcon,
} from "lucide-react";

import type {
  Conversation,
  Feedback,
  Memory,
  MemorySuggestion,
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
  setConversationMemoryEnabled,
  setConversationModel,
  setMessageFeedback,
  suggestConversationTitle,
  suggestMemory,
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
  type SearchSummary,
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
  memoryEnabled = true,
  onToggleMemory,
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
  /** Per-conversation clean room: off means no remembered context is injected. */
  memoryEnabled?: boolean;
  onToggleMemory?: () => void;
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Memory"
                aria-disabled={!canShare}
                className={cn(
                  !canShare && "opacity-40 cursor-not-allowed",
                  memoryEnabled && canShare && "text-primary",
                )}
                onClick={() => {
                  if (canShare) onToggleMemory?.();
                }}
              >
                <BrainIcon
                  className={cn("size-4", !memoryEnabled && "opacity-50")}
                />
              </Button>
            }
          />
          <TooltipContent>
            {!canShare
              ? "Start a chat to set memory"
              : memoryEnabled
                ? "Memory on for this chat — click for a clean room"
                : "Memory off for this chat — click to allow it"}
          </TooltipContent>
        </Tooltip>
        <ThemeToggle />
      </div>
    </header>
  );
}

/** Survives the remount caused by rewriting the URL to /c/<id>. */
const STREAM_ERROR_KEY = "omnichat:last-stream-error";

/** sessionStorage is only written by this component, so same-tab writes
 *  notify through a custom event rather than the cross-tab `storage` event. */
const STREAM_ERROR_EVENT = "omnichat:stream-error-changed";

function subscribeToStreamError(onChange: () => void) {
  window.addEventListener(STREAM_ERROR_EVENT, onChange);
  return () => window.removeEventListener(STREAM_ERROR_EVENT, onChange);
}

export function ChatView({
  conversations,
  provider,
  search,
  models,
  providerStatus = "none",
  providerMessage = null,
  user,
  initialActiveId = null,
  memoryAutoSuggest = true,
  memories = [],
}: {
  conversations: Conversation[];
  provider: ProviderSummary;
  search?: SearchSummary;
  /** Everything remembered for this user, for the Memory panel. */
  memories?: Memory[];
  models: Model[];
  providerStatus?: ProviderStatus;
  providerMessage?: string | null;
  user: SessionUser;
  initialActiveId?: string | null;
  /** Whether to offer a memory suggestion after each turn. */
  memoryAutoSuggest?: boolean;
}) {
  const router = useRouter();
  const [prevInitialId, setPrevInitialId] = React.useState(initialActiveId);
  const [activeId, setActiveId] = React.useState<string | null>(initialActiveId);
  const [thinkingLevel, setThinkingLevel] = React.useState<ThinkingLevel>("off");
  const [shareDialogOpen, setShareDialogOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<
    "provider" | "prompts" | "search" | "memory"
  >("provider");

  function handleOpenSettings(
    tab: "provider" | "prompts" | "search" | "memory" | "memory" = "provider",
  ) {
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

  // A model chosen once should stay chosen. Without this every new chat falls
  // back to models[0], so a large gateway always hands you the same arbitrary
  // first entry no matter how often you have picked something else. Loaded in
  // an effect rather than the initialiser so server and client render the same
  // markup on the first pass.
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem("omnichat.lastModel");
      if (saved) {
        setDraftModelId((current) => current ?? saved);
      }
    } catch {
      // Private browsing or a locked-down profile: a missing preference is
      // not worth failing the page over.
    }
  }, []);
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

  /**
   * A finished turn awaiting the server's copy of it.
   *
   * The streamed reply lives in `streamText` while it runs, which is a
   * different thing from `active.messages` (server data). Clearing the former
   * before the latter had arrived left a gap where the whole turn was simply
   * not on screen — it reappeared only once refreshChat() landed. Keeping the
   * turn here until the server count has caught up makes the handover seamless.
   */
  const [pending, setPending] = React.useState<Message[]>([]);
  const serverBaselineRef = React.useRef(0);
  const toolCallsRef = React.useRef<ToolCallInfo[]>([]);

  /**
   * Proposed memories awaiting the user's click. Held here only — nothing is
   * persisted until they edit the text and press Save in the message editor.
   */
  const [memorySuggestions, setMemorySuggestions] = React.useState<
    Record<string, MemorySuggestion>
  >({});
  const savedMessageIdRef = React.useRef<string | null>(null);
  /** Set when this turn opened a new conversation, cleared once titled. */
  const pendingTitleRef = React.useRef(false);

  /** Optimistic override for the per-conversation memory switch. */
  const [memoryOverride, setMemoryOverride] = React.useState<
    Record<string, boolean>
  >({});

  async function handleSuggest(messageId: string) {
    if (!memoryAutoSuggest) return;
    const suggestion = await suggestMemory(messageId);
    if (suggestion) {
      setMemorySuggestions((prev) => ({ ...prev, [messageId]: suggestion }));
    }
  }

  /** A memory was saved from this message — stop offering the suggestion. */
  function handleRemember(messageId: string) {
    setMemorySuggestions((prev) => {
      if (!(messageId in prev)) return prev;
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  }

  async function handleToggleMemory() {
    if (!active) return;
    const next = !(memoryOverride[active.id] ?? active.memoryEnabled);
    setMemoryOverride((prev) => ({ ...prev, [active.id]: next }));
    await setConversationMemoryEnabled(active.id, next).catch(() => {});
  }

  // Streamed text is accumulated here and revealed at animation-frame cadence
  // rather than on network arrival. Without this the reveal rate is at the
  // mercy of TCP: a chunk arriving alone renders one word, a coalesced burst
  // renders a whole paragraph at once, so the same stream looks smooth or
  // blocky at random. Revealing a slice per frame makes it consistent and
  // self-catching-up.
  const queuedTextRef = React.useRef("");
  const shownTextRef = React.useRef("");
  const rafRef = React.useRef<number | null>(null);

  const scheduleReveal = React.useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(function tick() {
      rafRef.current = null;
      const backlog = queuedTextRef.current;
      if (!backlog) return;
      // Small enough to read as streaming, large enough that a paragraph
      // clears in a fraction of a second rather than lagging behind.
      const slice = backlog.slice(
        0,
        Math.max(24, Math.ceil(backlog.length / 12)),
      );
      queuedTextRef.current = backlog.slice(slice.length);
      shownTextRef.current += slice;
      setStreamText(shownTextRef.current);
      if (queuedTextRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      }
    });
  }, []);

  const pushStreamText = React.useCallback(
    (delta: string) => {
      queuedTextRef.current += delta;
      scheduleReveal();
    },
    [scheduleReveal],
  );

  /** Returns everything streamed so far, including what is still queued. */
  const takeStreamText = React.useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const all = shownTextRef.current + queuedTextRef.current;
    queuedTextRef.current = "";
    shownTextRef.current = "";
    return all;
  }, []);

  const resetStreamText = React.useCallback(() => {
    takeStreamText();
    setStreamText("");
  }, [takeStreamText]);
  const [streaming, setStreaming] = React.useState(false);
  // Starting a chat rewrites the URL to /c/<id>, which remounts this tree and
  // destroys local state. A gateway error raised during that window would be
  // lost, so it is parked in sessionStorage and rehydrated on mount.
  const [streamErrorState, setStreamErrorState] = React.useState<string | null>(
    null,
  );

  const setStreamError = React.useCallback((value: string | null) => {
    setStreamErrorState(value);
    if (typeof window === "undefined") return;
    if (value) {
      window.sessionStorage.setItem(STREAM_ERROR_KEY, value);
    } else {
      window.sessionStorage.removeItem(STREAM_ERROR_KEY);
    }
    window.dispatchEvent(new Event(STREAM_ERROR_EVENT));
  }, []);

  // Read the parked error without an effect, so a remount picks it up on the
  // first client render rather than after a cascading setState.
  const rehydratedError = React.useSyncExternalStore(
    subscribeToStreamError,
    () => window.sessionStorage.getItem(STREAM_ERROR_KEY),
    () => null,
  );

  const streamError = streamErrorState ?? rehydratedError;

  const abortRef = React.useRef<AbortController | null>(null);
  /** True only when the user pressed stop, so unmount aborts stay reportable. */
  const stopRequestedRef = React.useRef(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const hasModels = models.length > 0;
  const modelId =
    active?.modelId ?? draftModelId ?? models[0]?.id ?? "";

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length, localUser, streamText, streaming, pending]);

  // Drop the pending copy once the server's own copy of the turn has landed.
  // The count is measured from before the turn started, so a refresh that
  // arrives mid-stream (createUserMessage triggers one) cannot trip it early.
  React.useEffect(() => {
    if (pending.length === 0) return;
    const serverCount = active?.messages.length ?? 0;
    if (serverCount >= serverBaselineRef.current + pending.length) {
      setPending([]);
      return;
    }
    // Safety net: never leave a stale copy on screen if the refresh silently
    // fails or comes back without the turn.
    const timer = setTimeout(() => setPending([]), 8000);
    return () => clearTimeout(timer);
  }, [active?.messages.length, pending]);

  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function handleModelChange(next: string) {
    setDraftModelId(next);
    try {
      window.localStorage.setItem("omnichat.lastModel", next);
    } catch {
      // Persisting the preference is a nicety; never let it break the picker.
    }
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

    // A brand new conversation gets its title summarised once the first
    // exchange has landed — an opening message alone is a question, not a
    // subject worth naming.
    if (!activeId) pendingTitleRef.current = true;

    const now = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });

    setStreamError(null);
    serverBaselineRef.current = active?.messages.length ?? 0;
    toolCallsRef.current = [];
    const userMessage: Message = {
      id: "local-user",
      role: "user",
      content: text,
      createdAt: now,
    };
    setLocalUser(userMessage);
    resetStreamText();
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

    await streamResponse(
      conversationId,
      modelId,
      thinkingLevel,
      webSearch,
      userMessage,
    );
  }

  async function streamResponse(
    conversationId: string,
    modelId: string,
    level: ThinkingLevel = "off",
    webSearch: boolean = true,
    userMessage?: Message,
  ) {
    const controller = new AbortController();
    abortRef.current = controller;
    stopRequestedRef.current = false;
    let failure: string | null = null;

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

      const handleFrame = (frame: string) => {
          const dataLine = frame
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (!dataLine) return;

          const payload = JSON.parse(dataLine.slice(5).trim());
          if (frame.includes("event: delta")) {
            pushStreamText(payload.delta);
          } else if (frame.includes("event: tool_start")) {
            setStreamingToolCalls((prev) => {
              const existing = prev.find((t) => t.id === payload.id);
              const next = existing
                ? prev.map((t) =>
                    t.id === payload.id ? { ...t, ...payload } : t,
                  )
                : [...prev, payload];
              toolCallsRef.current = next;
              return next;
            });
          } else if (frame.includes("event: tool_done")) {
            setStreamingToolCalls((prev) => {
              const next = prev.map((t) =>
                t.id === payload.id ? { ...t, ...payload, state: "done" } : t,
              );
              toolCallsRef.current = next;
              return next;
            });
          } else if (frame.includes("event: done")) {
            if (typeof payload.id === "string") {
              savedMessageIdRef.current = payload.id;
            }
          } else if (frame.includes("event: error")) {
            throw new Error(payload.message);
          }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) handleFrame(frame);
      }

      // The final frame can be left in the buffer when the stream ends without
      // a trailing blank line — which is exactly how error frames arrive.
      if (buffer.trim()) handleFrame(buffer);
    } catch (error) {
      // Only treat it as a user-initiated stop when we actually asked to
      // abort. An AbortError from an unmount or a dropped connection still
      // needs its reason surfaced, otherwise real gateway failures vanish.
      const userStopped = stopRequestedRef.current;
      if (!userStopped) {
        failure =
          error instanceof Error && error.name === "AbortError"
            ? "The connection to the gateway was interrupted."
            : error instanceof Error
              ? error.message
              : "The request failed.";
      }
    } finally {
      abortRef.current = null;

      // Hand the turn to a pending copy BEFORE clearing the live overlay, so
      // there is no frame in which the message is missing from the screen. It
      // stays until the server's copy has landed (see the effect above).
      const streamed = takeStreamText();
      const handoff: Message[] = [];
      if (userMessage) handoff.push(userMessage);
      if (streamed.trim() || toolCallsRef.current.length > 0) {
        handoff.push({
          id: "local-assistant",
          role: "assistant",
          content: streamed,
          createdAt: "",
          modelId,
          toolCalls:
            toolCallsRef.current.length > 0 ? toolCallsRef.current : undefined,
        });
      }
      if (handoff.length > 0) setPending(handoff);

      setStreaming(false);
      setLocalUser(null);
      setStreamText("");
      setStreamingToolCalls([]);
      toolCallsRef.current = [];

      // refreshChat may fail — the pending copy is the fallback either way.
      await refreshChat().catch(() => {});
      if (failure) setStreamError(failure);

      // Offer a memory for the finished turn. This never saves anything.
      const savedId = savedMessageIdRef.current;
      savedMessageIdRef.current = null;
      if (savedId && !failure) void handleSuggest(savedId);

      // Summarise the sidebar title once the first exchange is complete.
      if (pendingTitleRef.current && !failure) {
        pendingTitleRef.current = false;
        void suggestConversationTitle(conversationId);
      }
    }
  }

  async function handleRegenerate(messageId: string) {
    if (!provider || !modelId || streaming) {
      if (!provider || !modelId) setKeyDialogOpen(true);
      return;
    }

    setStreamError(null);
    serverBaselineRef.current = active?.messages.length ?? 0;
    toolCallsRef.current = [];
    resetStreamText();
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
    stopRequestedRef.current = true;
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
      serverBaselineRef.current = active?.messages.length ?? 0;
      toolCallsRef.current = [];
      resetStreamText();
      setStreamingToolCalls([]);
      setStreaming(true);
      await streamResponse(activeId, modelId, thinkingLevel, true);
    } else if (lastMsg.role === "assistant") {
      await handleRegenerate(lastMsg.id);
    }
  }

  const messages = active?.messages ?? [];
  const visibleMessages = [...messages, ...pending];
  const lastMessage = visibleMessages.at(-1);
  const lastMessageWasUserAndNoAssistantReply =
    !streaming && !streamText && lastMessage?.role === "user";
  const showTranscript =
    Boolean(activeId) ||
    visibleMessages.length > 0 ||
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
            memoryEnabled={
              active ? (memoryOverride[active.id] ?? active.memoryEnabled) : true
            }
            onToggleMemory={handleToggleMemory}
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
                      memorySuggestion={memorySuggestions[message.id]}
                      onMemorySaved={handleRemember}
                    />
                  ))}

                  {/* The just-finished turn, until the server's copy lands. */}
                  {pending.map((message) => (
                    <MessageBubble key={message.id} message={message} />
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
        initialSearch={search}
        memories={memories}
        memoryAutoSuggest={memoryAutoSuggest}
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
