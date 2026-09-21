"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LoaderIcon,
  PlugZapIcon,
} from "lucide-react";

import {
  saveProviderSettings,
  testProviderConnection,
  type SettingsState,
} from "@/app/settings-actions";
import { GATEWAYS, getGateway } from "@/lib/providers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ProviderSummary = {
  provider: string;
  baseUrl: string;
  last4: string;
} | null;

export function ProviderKeyDialog({
  open,
  onOpenChange,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: ProviderSummary;
}) {
  const [provider, setProvider] = React.useState(
    current?.provider ?? "omniroute",
  );
  const [baseUrl, setBaseUrl] = React.useState(
    current?.baseUrl ?? getGateway("omniroute").defaultBaseUrl,
  );
  const [apiKey, setApiKey] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const [test, setTest] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [testing, setTesting] = React.useState(false);

  const [state, formAction, saving] = React.useActionState<
    SettingsState,
    FormData
  >(saveProviderSettings, {});

  const router = useRouter();
  const gateway = getGateway(provider);

  // Close once the save succeeds, and pull the new model list. revalidatePath
  // alone only marks the cache stale — without refresh() this client tree keeps
  // rendering the props it was mounted with, so the picker stays empty.
  React.useEffect(() => {
    if (!state.ok) return;
    onOpenChange(false);
    router.refresh();
  }, [state.ok, onOpenChange, router]);

  function handleProviderChange(value: string | null) {
    if (!value) return;
    const next = value;
    setProvider(next);
    setTest(null);
    const preset = getGateway(next).defaultBaseUrl;
    // Only overwrite the URL if the user has not typed a custom one.
    if (preset) setBaseUrl(preset);
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const result = await testProviderConnection({ baseUrl, apiKey });
      setTest({ ok: result.ok, message: result.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRoundIcon className="size-5" />
          </div>
          <DialogTitle className="mt-3">Connect a model provider</DialogTitle>
          <DialogDescription>
            OmniChat needs a gateway to talk to. Your key is encrypted before it
            is stored and never sent to the browser.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4 py-2">
          <input type="hidden" name="provider" value={provider} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-select">Provider</Label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger id="provider-select" className="w-full">
                {/* Base UI renders the raw value by default — map it to the label. */}
                <SelectValue>{(value) => getGateway(String(value)).name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {GATEWAYS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{gateway.hint}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="baseUrl">Gateway URL</Label>
            <Input
              id="baseUrl"
              name="baseUrl"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setTest(null);
              }}
              placeholder="http://localhost:20128/v1"
              spellCheck={false}
              required
            />
            <p className="text-xs text-muted-foreground">
              The base URL — OmniChat appends{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                /chat/completions
              </code>
              .
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="apiKey">API key</Label>
            <div className="relative">
              <Input
                id="apiKey"
                name="apiKey"
                type={reveal ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTest(null);
                }}
                placeholder={
                  current ? `•••• ${current.last4} — enter a new key to replace` : "sk_omniroute…"
                }
                autoComplete="off"
                spellCheck={false}
                className="pr-9"
                required
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Hide API key" : "Show API key"}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {reveal ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </button>
            </div>
          </div>

          {test ? (
            <p
              className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                test.ok
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {test.ok ? (
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
              ) : (
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              )}
              {test.message}
            </p>
          ) : null}

          {state.error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              {state.error}
            </p>
          ) : null}

          <DialogFooter className="mt-2 gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={runTest}
              disabled={testing || !baseUrl || !apiKey}
            >
              {testing ? (
                <LoaderIcon className="animate-spin" />
              ) : (
                <PlugZapIcon />
              )}
              {testing ? "Testing…" : "Test connection"}
            </Button>

            <Button type="submit" disabled={saving} aria-busy={saving}>
              {saving ? <LoaderIcon className="animate-spin" /> : null}
              {saving ? "Saving…" : "Save and start chatting"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
