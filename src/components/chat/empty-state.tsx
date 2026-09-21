"use client";

import { ArrowUpRightIcon, KeyRoundIcon, MessagesSquareIcon } from "lucide-react";

import { SUGGESTIONS } from "@/lib/data";
import { Button } from "@/components/ui/button";

export function EmptyState({
  onPick,
  hasProvider,
  isConfigured,
  onConfigure,
}: {
  onPick: (prompt: string) => void;
  hasProvider: boolean;
  isConfigured: boolean;
  onConfigure: () => void;
}) {
  if (!hasProvider) {
    // Configured but no models means the gateway answered with nothing, or
    // could not be reached — say so instead of repeating the setup pitch.
    const stale = isConfigured;

    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-10 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <KeyRoundIcon className="size-5" />
        </div>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {stale ? "No models available" : "Connect a provider"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {stale
            ? "Your gateway is saved but returned no models. Check that it is running and that the key is still valid."
            : "OmniChat does not ship with any models of its own. Point it at your OmniRoute gateway and it will load whatever models you have available."}
        </p>

        <Button onClick={onConfigure} size="lg" className="mt-6">
          <KeyRoundIcon />
          {stale ? "Check connection" : "Add your API key"}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <MessagesSquareIcon className="size-5" />
      </div>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        What are we building today?
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Pick a starting point, or just start typing below.
      </p>

      <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.title}
            type="button"
            onClick={() => onPick(`${suggestion.title}: ${suggestion.subtitle}`)}
            className="group flex flex-col items-start gap-0.5 rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-ring/50 hover:bg-muted/50"
          >
            <span className="flex w-full items-center justify-between text-sm font-medium">
              {suggestion.title}
              <ArrowUpRightIcon className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
            <span className="text-xs text-muted-foreground">
              {suggestion.subtitle}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
