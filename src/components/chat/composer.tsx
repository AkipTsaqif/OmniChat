"use client";

import * as React from "react";
import {
  ArrowUpIcon,
  GlobeIcon,
  MicIcon,
  PaperclipIcon,
  SquareIcon,
  WandSparklesIcon,
} from "lucide-react";

import type { Model } from "@/lib/types";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ModelPicker } from "@/components/chat/model-picker";

const MAX_ROWS_HEIGHT = 200;

export function Composer({
  models,
  modelId,
  onModelChange,
  isStreaming,
  onSend,
  onStop,
  onConfigure,
}: {
  models: Model[];
  modelId: string;
  onModelChange: (modelId: string) => void;
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onConfigure: () => void;
}) {
  const [value, setValue] = React.useState("");
  const [webSearch, setWebSearch] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Grow the textarea with its content, up to a ceiling.
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_HEIGHT)}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setValue("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      <div className="rounded-2xl border bg-background shadow-sm transition-shadow focus-within:border-ring/60 focus-within:shadow-md">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={
            models.length === 0
              ? "Connect a provider to start chatting…"
              : "Message OmniChat…"
          }
          className="max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
        />

        <div className="flex items-center gap-1 px-2 pb-2">
          <ModelPicker
            models={models}
            value={modelId}
            onValueChange={onModelChange}
            onConfigure={onConfigure}
          />

          <div className="mx-1 h-4 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Attach file">
                  <PaperclipIcon />
                </Button>
              }
            />
            <TooltipContent>Attach file</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={webSearch}
                  onClick={() => setWebSearch((prev) => !prev)}
                  className={cn(
                    "gap-1.5",
                    webSearch && "bg-primary/10 text-primary hover:bg-primary/15",
                  )}
                >
                  <GlobeIcon />
                  Search
                </Button>
              }
            />
            <TooltipContent>
              {webSearch ? "Web search on" : "Web search off"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <WandSparklesIcon />
                  Prompts
                </Button>
              }
            />
            <TooltipContent>Prompt library</TooltipContent>
          </Tooltip>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Dictate">
              <MicIcon />
            </Button>
            {isStreaming ? (
              <Button
                size="icon-sm"
                aria-label="Stop generating"
                onClick={onStop}
              >
                <SquareIcon className="fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                aria-label="Send message"
                disabled={!value.trim()}
                onClick={submit}
              >
                <ArrowUpIcon />
              </Button>
            )}
          </div>
        </div>
      </div>

      <p className="pt-2 text-center text-[11px] text-muted-foreground">
        OmniChat can make mistakes. Verify important information.
      </p>
    </div>
  );
}
