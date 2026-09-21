"use client";

import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react";

import type { Model } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ProviderMark } from "@/components/chat/provider-mark";

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
    return models.filter((m) => m.id.toLowerCase().includes(needle));
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="max-w-56 gap-2 font-medium">
            <ProviderMark modelId={active?.id ?? ""} className="size-5" />
            <span className="truncate">{active?.name ?? "Select a model"}</span>
            <ChevronsUpDownIcon className="text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-80 min-w-80">
        <DropdownMenuLabel>
          {models.length} model{models.length === 1 ? "" : "s"} from your gateway
        </DropdownMenuLabel>

        {models.length > 8 ? (
          <div className="relative px-1 pb-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter models"
              className="h-7 pl-7 text-xs"
            />
          </div>
        ) : null}

        <div className="max-h-72 overflow-y-auto">
          {filtered.map((model) => (
            <DropdownMenuItem
              key={model.id}
              onClick={() => onValueChange(model.id)}
              className="items-center gap-2.5 py-2"
            >
              <ProviderMark modelId={model.id} />
              <span className="min-w-0 flex-1 truncate">{model.name}</span>
              {model.id === value ? (
                <CheckIcon className="size-4 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))}

          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No model matches “{query}”.
            </p>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
