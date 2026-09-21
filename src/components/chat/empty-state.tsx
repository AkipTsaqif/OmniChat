"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRightIcon,
  KeyRoundIcon,
  LoaderIcon,
  MessagesSquareIcon,
  PlugZapIcon,
  RefreshCwIcon,
} from "lucide-react";

import { recheckProvider } from "@/app/settings-actions";
import { SUGGESTIONS } from "@/lib/data";
import type { ProviderStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";

/** Copy for each way a saved gateway can fail. */
const STATUS_COPY: Record<
  string,
  { title: string; body: string; action: "retry" | "key" }
> = {
  unreachable: {
    title: "Gateway unreachable",
    body: "Your provider is saved, but OmniChat could not reach it. Your API key is still stored — start the gateway and try again.",
    action: "retry",
  },
  unauthorized: {
    title: "API key rejected",
    body: "The gateway is running but refused your key. It may have been revoked or rotated.",
    action: "key",
  },
  key_undecryptable: {
    title: "Saved key cannot be read",
    body: "Your stored API key can no longer be decrypted, which happens when OMNICHAT_ENCRYPTION_KEY changes. Re-enter the key to reconnect.",
    action: "key",
  },
  empty: {
    title: "No models available",
    body: "The gateway is connected but is not serving any models.",
    action: "retry",
  },
};

export function EmptyState({
  onPick,
  hasProvider,
  isConfigured,
  providerStatus = "none",
  providerMessage = null,
  onConfigure,
}: {
  onPick: (prompt: string) => void;
  hasProvider: boolean;
  isConfigured: boolean;
  providerStatus?: ProviderStatus;
  providerMessage?: string | null;
  onConfigure: () => void;
}) {
  const [rechecking, setRechecking] = React.useState(false);
  const [recheckNote, setRecheckNote] = React.useState<string | null>(null);
  const router = useRouter();

  async function handleRecheck() {
    setRechecking(true);
    setRecheckNote(null);
    try {
      const result = await recheckProvider();
      if (result.status === "ok") {
        router.refresh();
        return;
      }
      setRecheckNote(result.message ?? "Still unavailable.");
    } catch {
      setRecheckNote("Could not check the gateway.");
    } finally {
      setRechecking(false);
    }
  }

  if (!hasProvider) {
    const copy = isConfigured ? STATUS_COPY[providerStatus] : undefined;

    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-10 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {copy?.action === "retry" ? (
            <PlugZapIcon className="size-5" />
          ) : (
            <KeyRoundIcon className="size-5" />
          )}
        </div>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {copy?.title ?? "Connect a provider"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {providerMessage ??
            copy?.body ??
            "OmniChat does not ship with any models of its own. Point it at your OmniRoute gateway and it will load whatever models you have available."}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {copy?.action === "retry" ? (
            <Button onClick={handleRecheck} size="lg" disabled={rechecking}>
              {rechecking ? (
                <LoaderIcon className="animate-spin" />
              ) : (
                <RefreshCwIcon />
              )}
              {rechecking ? "Checking…" : "Retry connection"}
            </Button>
          ) : null}

          <Button
            onClick={onConfigure}
            size="lg"
            variant={copy?.action === "retry" ? "outline" : "default"}
          >
            <KeyRoundIcon />
            {isConfigured ? "Provider settings" : "Add your API key"}
          </Button>
        </div>

        {recheckNote ? (
          <p className="mt-3 text-xs text-muted-foreground">{recheckNote}</p>
        ) : null}
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
