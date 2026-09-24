"use client";

import * as React from "react";
import {
  CheckIcon,
  BookmarkIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";

import { useSessionUser } from "@/components/chat/user-context";

/** Gateways return ids like `anthropic/claude-sonnet-4.5`; show the tail. */
function modelLabel(id: string) {
  if (!id) return "Assistant";
  return id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
}
import { cn } from "cn";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { saveMemory } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  Feedback,
  MemoryCategory,
  MemorySuggestion,
  Message,
} from "@/lib/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Markdown } from "@/components/chat/markdown";
import { ProviderMark } from "@/components/chat/provider-mark";
import { ToolCallPill } from "@/components/chat/tool-call-pill";

function IconAction({
  label,
  icon,
  onClick,
  active,
  disabled,
  className,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={cn(
              "text-muted-foreground hover:text-foreground",
              active && "bg-accent text-foreground",
              className,
            )}
          >
            {icon}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const MEMORY_CATEGORIES: { id: MemoryCategory; name: string }[] = [
  { id: "preference", name: "Preference" },
  { id: "personal", name: "Personal" },
  { id: "project", name: "Project" },
  { id: "constraint", name: "Constraint" },
];

/**
 * The remember affordance: a bookmark beside thumbs-down that opens an inline
 * editor under the turn.
 *
 * Nothing is written until Save is pressed and the text is visible and editable
 * first. That is the whole difference between this and silent extraction — the
 * system proposes, the user decides, and the user can see exactly what will be
 * replayed into every future conversation.
 */
function MemoryAction({
  messageId,
  suggestion,
  onMemorySaved,
}: {
  messageId: string;
  suggestion?: MemorySuggestion | null;
  onMemorySaved?: (messageId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [content, setContent] = React.useState("");
  const [category, setCategory] =
    React.useState<MemoryCategory>("preference");
  const [global, setGlobal] = React.useState(true);
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  // A suggestion arrives asynchronously after the turn. Pre-fill only while
  // the user has not started typing — never overwrite their words. Adjusted
  // during render rather than in an effect, matching provider-key-dialog.tsx.
  const [prevSuggestion, setPrevSuggestion] = React.useState(suggestion);
  if (suggestion !== prevSuggestion) {
    setPrevSuggestion(suggestion);
    if (suggestion && !touched) {
      setContent(suggestion.content);
      setCategory(suggestion.category);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await saveMemory({
        messageId,
        category,
        content,
        global,
      });
      if (result.ok) {
        setSaved(true);
        setOpen(false);
        onMemorySaved?.(messageId);
      } else {
        setError(result.error ?? "Could not save that memory.");
      }
    } catch {
      setError("Could not save that memory.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="contents">
      <span className="relative">
        <IconAction
          label={
            saved
              ? "Saved to memory"
              : suggestion && !touched
                ? "Suggested memory"
                : "Remember"
          }
          active={saved}
          icon={<BookmarkIcon className="size-3.5" />}
          onClick={() => setOpen((prev) => !prev)}
        />
        {suggestion && !saved && !touched ? (
          <span className="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary" />
        ) : null}
      </span>

      {open ? (
        <div className="mt-2 w-full max-w-xl rounded-xl border bg-card p-3 text-xs">
          <div className="mb-2 text-[11px] font-medium text-muted-foreground">
            {suggestion && !touched ? "Suggested — edit before saving" : "Remember this"}
          </div>

          <Textarea
            rows={3}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setTouched(true);
            }}
            placeholder="One standalone sentence, understandable on its own…"
            className="text-xs"
          />

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-[11px] text-muted-foreground">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => v && setCategory(v as MemoryCategory)}
              >
                <SelectTrigger size="sm" className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMORY_CATEGORIES.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Switch checked={global} onCheckedChange={setGlobal} />
              Apply to all conversations
            </label>
          </div>

          {error ? (
            <p role="alert" className="mt-2 text-[11px] text-destructive">
              {error}
            </p>
          ) : null}

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleSave}
              disabled={saving || !content.trim()}
            >
              {saving ? "Saving…" : "Save memory"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CopyAction({ content }: { content: string }) {
  const [copied, setCopied] = React.useState(false);

  return (
    <IconAction
      label={copied ? "Copied" : "Copy"}
      icon={copied ? <CheckIcon /> : <CopyIcon />}
      onClick={() => {
        void navigator.clipboard.writeText(content);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}

function Attachments({ message }: { message: Message }) {
  if (!message.attachments?.length) return null;

  return (
    <div className="mb-2 flex flex-wrap justify-end gap-2">
      {message.attachments.map((file) => (
        <div
          key={file.id}
          className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5"
        >
          {file.kind === "image" ? (
            <ImageIcon className="size-4 text-muted-foreground" />
          ) : (
            <FileTextIcon className="size-4 text-muted-foreground" />
          )}
          <div className="flex flex-col">
            <span className="text-xs font-medium">{file.name}</span>
            <span className="text-[10px] text-muted-foreground">
              {file.size}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageBubble({
  message,
  streaming = false,
  isStreaming = false,
  onRegenerate,
  onFeedback,
  memorySuggestion,
  onMemorySaved,
}: {
  message: Message;
  streaming?: boolean;
  isStreaming?: boolean;
  onRegenerate?: (messageId: string) => void;
  onFeedback?: (messageId: string, feedback: Feedback | null) => void;
  memorySuggestion?: MemorySuggestion | null;
  onMemorySaved?: (messageId: string) => void;
}) {
  const user = useSessionUser();
  const [feedbackOverride, setFeedbackOverride] = React.useState<{
    messageId: string;
    feedback: Feedback | null;
  } | null>(null);

  const feedback =
    feedbackOverride && feedbackOverride.messageId === message.id
      ? feedbackOverride.feedback
      : (message.feedback ?? null);

  function handleFeedback(next: Feedback) {
    const updated = feedback === next ? null : next;
    setFeedbackOverride({ messageId: message.id, feedback: updated });
    onFeedback?.(message.id, updated);
  }

  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="group/message flex flex-col items-end gap-1.5 py-3">
        <Attachments message={message} />
        <div className="flex max-w-[min(42rem,85%)] items-start gap-3">
          <div className="rounded-2xl rounded-tr-sm bg-muted px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap">
            {message.content}
          </div>
          <Avatar size="sm" className="mt-1">
            <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
              {user.initials}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="flex items-center gap-0.5 pr-10 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
          <span className="mr-1 text-[11px] text-muted-foreground">
            {message.createdAt}
          </span>
          <CopyAction content={message.content} />
          <IconAction label="Edit" icon={<PencilIcon />} />
        </div>
      </div>
    );
  }

  const modelId = message.modelId ?? "";

  return (
    <div className="group/message flex gap-3 py-3">
      <ProviderMark modelId={modelId} className="mt-1 size-7" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{modelLabel(modelId)}</span>
          <span className="text-[11px] text-muted-foreground">
            {message.createdAt}
          </span>
        </div>
        {message.toolCalls?.map((toolCall) => (
          <ToolCallPill key={toolCall.id} toolCall={toolCall} />
        ))}

        <div className="relative">
          <Markdown content={message.content} />
          {streaming ? (
            <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-foreground" />
          ) : null}
        </div>
        {streaming ? null : (
        <div className="flex items-center gap-0.5">
          <CopyAction content={message.content} />
          <IconAction
            label="Regenerate"
            icon={<RefreshCwIcon className="size-3.5" />}
            disabled={isStreaming}
            onClick={() => onRegenerate?.(message.id)}
          />
          <IconAction
            label={feedback === "like" ? "Remove like" : "Good response"}
            active={feedback === "like"}
            className={
              feedback === "like"
                ? "text-primary hover:text-primary"
                : undefined
            }
            icon={
              <ThumbsUpIcon
                className={cn(
                  "size-3.5",
                  feedback === "like" && "fill-current text-primary",
                )}
              />
            }
            onClick={() => handleFeedback("like")}
          />
          <IconAction
            label={
              feedback === "dislike" ? "Remove dislike" : "Bad response"
            }
            active={feedback === "dislike"}
            className={
              feedback === "dislike"
                ? "text-destructive hover:text-destructive"
                : undefined
            }
            icon={
              <ThumbsDownIcon
                className={cn(
                  "size-3.5",
                  feedback === "dislike" && "fill-current text-destructive",
                )}
              />
            }
            onClick={() => handleFeedback("dislike")}
          />
          <MemoryAction
            messageId={message.id}
            suggestion={memorySuggestion}
            onMemorySaved={onMemorySaved}
          />
          {message.stats ? (
            <span
              className={cn(
                "ml-1.5 font-mono text-[11px] text-muted-foreground",
                "opacity-0 transition-opacity group-hover/message:opacity-100",
              )}
            >
              {message.stats.tokens} tok · {message.stats.latency}
            </span>
          ) : null}
        </div>
        )}
      </div>
    </div>
  );
}

export function TypingBubble({ modelId }: { modelId: string }) {
  return (
    <div className="flex gap-3 py-3">
      <ProviderMark modelId={modelId} className="mt-1 size-7" />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">{modelLabel(modelId)}</span>
        <div className="flex items-center gap-1 py-2">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
