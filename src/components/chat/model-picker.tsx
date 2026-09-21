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

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((m) => {
      const pName = m.providerName || parseModelInfo(m.id).providerName;
      const pMark = m.providerMark || parseModelInfo(m.id).providerMark;
      return (
        m.id.toLowerCase().includes(needle) ||
        m.name.toLowerCase().includes(needle) ||
        m.provider.toLowerCase().includes(needle) ||
        pName.toLowerCase().includes(needle) ||
        pMark.toLowerCase().includes(needle)
      );
    });
  }, [models, query]);

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
  const activeInfo = active ? parseModelInfo(active.id) : null;

  return (
    <DropdownMenu>
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
      <DropdownMenuContent align="start" className="w-88 min-w-88 sm:w-96 sm:min-w-96">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {models.length} model{models.length === 1 ? "" : "s"} from your gateway
          </DropdownMenuLabel>

          {models.length > 8 ? (
            <div className="relative px-1 pb-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Allow Escape to propagate so the menu can close
                  if (e.key === "Escape") return;
                  // Stop propagation so Base UI Menu's typeahead and keyboard navigation
                  // do not intercept keystrokes with preventDefault().
                  e.stopPropagation();
                }}
                placeholder="Filter models or providers"
                className="h-7 pl-7 text-xs"
              />
            </div>
          ) : null}

          <div className="max-h-72 overflow-y-auto">
            {filtered.map((model) => {
              const info = parseModelInfo(model.id);
              const providerName = model.providerName || info.providerName;
              const providerMark = model.providerMark || info.providerMark;
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
          </div>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
