"use client";

import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react";

import type { Model } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ProviderMark } from "@/components/chat/provider-mark";
import { parseModelInfo } from "@/lib/data";

/**
 * Rows rendered at once. A gateway can serve thousands of models and every
 * keystroke re-renders the list, so rendering all of them is what made this
 * feel sluggish. The remainder is still searchable — the footer says how many
 * are hidden so the cap never reads as "these are all your models".
 */
const ROW_LIMIT = 60;

/**
 * parseModelInfo does regex work per id. Called inside the render loop it ran
 * thousands of times per keystroke; cached by id it runs once each.
 */
const infoCache = new Map<string, ReturnType<typeof parseModelInfo>>();
function infoFor(modelId: string) {
  let info = infoCache.get(modelId);
  if (!info) {
    info = parseModelInfo(modelId);
    infoCache.set(modelId, info);
  }
  return info;
}

type Entry = {
  model: Model;
  providerName: string;
  providerMark: string;
  haystack: string;
};

export function ModelPicker({
  models,
  value,
  onValueChange,
  onConfigure,
}: {
  models: Model[];
  value: string;
  onValueChange: (modelId: string) => void;
  onConfigure?: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Search text is derived once per model list, not once per keystroke.
  const entries = React.useMemo<Entry[]>(
    () =>
      models.map((model) => {
        const info = infoFor(model.id);
        const providerName = model.providerName || info.providerName;
        const providerMark = model.providerMark || info.providerMark;
        return {
          model,
          providerName,
          providerMark,
          haystack: [
            model.id,
            model.name,
            model.provider,
            providerName,
            providerMark,
          ]
            .join(" ")
            .toLowerCase(),
        };
      }),
    [models],
  );

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    // Pre-split so a single haystack substring can never match across a
    // boundary between two fields (e.g. "openai" matching "…open ai…").
    const terms = needle.split(/\s+/).filter(Boolean);
    return entries.filter((entry) =>
      terms.every((term) => entry.haystack.includes(term)),
    );
  }, [entries, query]);

  const visible = React.useMemo(
    () => filtered.slice(0, ROW_LIMIT),
    [filtered],
  );

  // Open on the search box, not on the first row: with a long list the whole
  // point is to type, and the menu's own typeahead would otherwise swallow the
  // first characters.
  React.useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // No gateway configured, or it returned nothing.
  if (models.length === 0) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onConfigure}
        className="gap-2 font-medium text-muted-foreground"
      >
        <ProviderMark modelId="" className="size-5" />
        No models
      </Button>
    );
  }

  const active = models.find((m) => m.id === value);
  const activeInfo = active ? infoFor(active.id) : null;
  const showSearch = models.length > 8;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="max-w-64 gap-2 font-medium">
            <ProviderMark modelId={active?.id ?? ""} className="size-5" />
            <span className="truncate">{active?.name ?? "Select a model"}</span>
            {active ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                {active.providerMark || activeInfo?.providerMark}
              </span>
            ) : null}
            <ChevronsUpDownIcon className="text-muted-foreground ml-auto shrink-0" />
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        className="w-88 min-w-88 sm:w-96 sm:min-w-96"
        onKeyDown={(e) => {
          // Route typing to the search box even if it is not focused yet —
          // the menu's own typeahead would otherwise claim the first letter.
          if (e.target === inputRef.current) return;
          if (e.key === "Escape" || e.key === "Tab") return;
          if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
          e.preventDefault();
          e.stopPropagation();
          inputRef.current?.focus();
          setQuery((prev) => prev + e.key);
        }}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {models.length} model{models.length === 1 ? "" : "s"} from your gateway
          </DropdownMenuLabel>

          {showSearch ? (
            <div className="relative px-1 pb-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Allow Escape to propagate so the menu can close
                  if (e.key === "Escape") return;
                  // Stop propagation so Base UI Menu's typeahead and keyboard
                  // navigation do not intercept keystrokes.
                  e.stopPropagation();
                }}
                placeholder="Filter models or providers"
                className="h-7 pl-7 text-xs"
              />
            </div>
          ) : null}

          <div className="max-h-72 overflow-y-auto">
            {visible.map((entry) => {
              const { model, providerName, providerMark } = entry;
              const isSelected = model.id === value;

              return (
                <DropdownMenuItem
                  key={model.id}
                  onClick={() => onValueChange(model.id)}
                  className="items-center gap-2.5 py-2 px-2"
                >
                  <ProviderMark modelId={model.id} className="size-6 text-[10px]" />
                  <div className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                    <span className="truncate text-xs font-medium">{model.name}</span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {providerName} • {model.id}
                    </span>
                  </div>
                  <span className="shrink-0 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {providerMark}
                  </span>
                  {isSelected ? (
                    <CheckIcon className="size-4 shrink-0 text-primary" />
                  ) : null}
                </DropdownMenuItem>
              );
            })}

            {filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No model matches “{query}”.
              </p>
            ) : null}

            {filtered.length > visible.length ? (
              <p className="px-2 py-2 text-center text-[10px] text-muted-foreground">
                Showing {visible.length} of {filtered.length} — keep typing to narrow it
                down.
              </p>
            ) : null}
          </div>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
