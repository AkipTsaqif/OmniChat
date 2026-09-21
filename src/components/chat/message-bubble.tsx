"use client";

import * as React from "react";
import {
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";

import type { Feedback, Message } from "@/lib/types";
import { useSessionUser } from "@/components/chat/user-context";

/** Gateways return ids like `anthropic/claude-sonnet-4.5`; show the tail. */
function modelLabel(id: string) {
  if (!id) return "Assistant";
  return id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
}
import { cn } from "cn";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
}: {
  message: Message;
  streaming?: boolean;
  isStreaming?: boolean;
  onRegenerate?: (messageId: string) => void;
  onFeedback?: (messageId: string, feedback: Feedback | null) => void;
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
