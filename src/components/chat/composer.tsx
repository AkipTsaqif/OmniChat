"use client";

import * as React from "react";
import {
  ArrowUpIcon,
  BrainIcon,
  CheckIcon,
  GlobeIcon,
  MicIcon,
  PaperclipIcon,
  SquareIcon,
  WandSparklesIcon,
} from "lucide-react";

import type { Model, ThinkingLevel } from "@/lib/types";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModelPicker } from "@/components/chat/model-picker";

const MAX_ROWS_HEIGHT = 200;

const THINKING_OPTIONS: {
  level: ThinkingLevel;
  label: string;
  desc: string;
}[] = [
  { level: "off", label: "Off", desc: "Fast response, standard thinking" },
  { level: "low", label: "Low", desc: "Light reasoning for quick tasks" },
  { level: "medium", label: "Medium", desc: "Balanced reasoning depth" },
  { level: "high", label: "High", desc: "Deep reasoning for complex problems" },
];

export function Composer({
  models,
  modelId,
  thinkingLevel = "off",
  onThinkingLevelChange,
  onModelChange,
  isStreaming,
  onSend,
  onStop,
  onConfigure,
  onOpenPrompts,
}: {
  models: Model[];
  modelId: string;
  thinkingLevel?: ThinkingLevel;
  onThinkingLevelChange?: (level: ThinkingLevel) => void;
  onModelChange: (modelId: string) => void;
  isStreaming: boolean;
  onSend: (text: string, webSearch?: boolean) => void;
  onStop: () => void;
  onConfigure: () => void;
  onOpenPrompts?: () => void;
}) {
  const [value, setValue] = React.useState("");
  const [webSearch, setWebSearch] = React.useState(true);
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
    onSend(text, webSearch);
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

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Thinking level"
                        className={cn(
                          "gap-1.5 text-xs font-medium",
                          thinkingLevel !== "off" &&
                            "bg-primary/10 text-primary hover:bg-primary/15",
                        )}
                      >
                        <BrainIcon className="size-3.5" />
                        <span>
                          {thinkingLevel === "off"
                            ? "Think"
                            : `Think: ${thinkingLevel.charAt(0).toUpperCase() + thinkingLevel.slice(1)}`}
                        </span>
                      </Button>
                    }
                  />
                }
              />
              <TooltipContent>
                {thinkingLevel === "off"
                  ? "Thinking: Off"
                  : `Thinking level: ${thinkingLevel}`}
              </TooltipContent>
            </Tooltip>

            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
                {THINKING_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.level}
                    onClick={() => onThinkingLevelChange?.(opt.level)}
                    className="items-center justify-between py-1.5 text-xs"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {opt.desc}
                      </span>
                    </div>
                    {thinkingLevel === opt.level ? (
                      <CheckIcon className="size-3.5 shrink-0 text-primary" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

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
                    "gap-1.5 text-xs font-medium",
                    webSearch && "bg-primary/10 text-primary hover:bg-primary/15",
                  )}
                >
                  <GlobeIcon className="size-3.5" />
                  <span>{webSearch ? "Search: Auto" : "Search: Off"}</span>
                </Button>
              }
            />
            <TooltipContent>
              {webSearch
                ? "Web search: Auto (searches when relevant)"
                : "Web search: Off"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={onOpenPrompts}
                >
                  <WandSparklesIcon />
                  Prompts
                </Button>
              }
            />
            <TooltipContent>Custom system prompt</TooltipContent>
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
