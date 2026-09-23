"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LoaderIcon,
  PlugZapIcon,
  SearchIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";

import {
  clearTavilyKey,
  saveProviderSettings,
  saveSearchSettings,
  saveUserSystemPrompt,
  testProviderConnection,
  testSearchConnection,
  type SearchSettingsState,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export type ProviderSummary = {
  provider: string;
  baseUrl: string;
  last4: string;
} | null;

export type SearchSummary = {
  preferred: string;
  tavilyLast4: string | null;
  searxngUrl: string | null;
} | null;

const SEARCH_OPTIONS = [
  {
    id: "auto",
    name: "Automatic",
    hint: "Try Tavily, then SearXNG, then DuckDuckGo — whichever answers first.",
  },
  {
    id: "tavily",
    name: "Tavily",
    hint: "1,000 free searches a month, no card. Returns page content, not just links.",
  },
  {
    id: "searxng",
    name: "SearXNG",
    hint: "Self-hosted metasearch — free and unlimited, aggregates 70+ engines.",
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    hint: "Keyless and always available. Scrapes the Lite HTML endpoint.",
  },
] as const;

const PROMPT_PRESETS = [
  {
    name: "Software Engineer",
    prompt:
      "You are a Senior Full-Stack Software Engineer. Provide concise, production-ready code with minimal conversational filler. Write clean, idiomatic code and explain non-obvious architecture or performance trade-offs.",
  },
  {
    name: "Concise & Direct",
    prompt:
      "Answer directly and concisely. Omit pleasantries, conversational filler, and unsolicited disclaimers. Prioritize clear, direct answers.",
  },
  {
    name: "Technical Writer",
    prompt:
      "You are an expert technical communicator. Structure responses clearly with intuitive headings, step-by-step explanations, and clear examples.",
  },
  {
    name: "Socratic Tutor",
    prompt:
      "You are a patient, insightful tutor. Guide the user to discover solutions by explaining foundational concepts step-by-step and asking engaging questions.",
  },
];

export function ProviderKeyDialog({
  open,
  onOpenChange,
  current,
  initialTab = "provider",
  initialSystemPrompt = null,
  initialSearch = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: ProviderSummary;
  initialTab?: "provider" | "prompts" | "search";
  initialSystemPrompt?: string | null;
  initialSearch?: SearchSummary;
}) {
  const [tab, setTab] = React.useState<"provider" | "prompts" | "search">(
    initialTab,
  );
  const [prevInitialTab, setPrevInitialTab] = React.useState(initialTab);

  if (initialTab !== prevInitialTab) {
    setPrevInitialTab(initialTab);
    setTab(initialTab);
  }

  const [systemPrompt, setSystemPrompt] = React.useState(
    initialSystemPrompt ?? "",
  );
  const [prevInitialPrompt, setPrevInitialPrompt] = React.useState(
    initialSystemPrompt ?? "",
  );

  if ((initialSystemPrompt ?? "") !== prevInitialPrompt) {
    setPrevInitialPrompt(initialSystemPrompt ?? "");
    setSystemPrompt(initialSystemPrompt ?? "");
  }

  const [promptSaving, setPromptSaving] = React.useState(false);
  const [promptSaved, setPromptSaved] = React.useState(false);
  const [promptError, setPromptError] = React.useState<string | null>(null);

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

  const [searchPreferred, setSearchPreferred] = React.useState(
    initialSearch?.preferred ?? "auto",
  );
  const [tavilyKey, setTavilyKey] = React.useState("");
  const [searchReveal, setSearchReveal] = React.useState(false);
  const [searxngUrl, setSearxngUrl] = React.useState(
    initialSearch?.searxngUrl ?? "",
  );
  const [searchTest, setSearchTest] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [searchTesting, setSearchTesting] = React.useState(false);
  const [clearingKey, setClearingKey] = React.useState(false);

  const [prevInitialSearch, setPrevInitialSearch] =
    React.useState(initialSearch);
  if (initialSearch !== prevInitialSearch) {
    setPrevInitialSearch(initialSearch);
    setSearchPreferred(initialSearch?.preferred ?? "auto");
    setSearxngUrl(initialSearch?.searxngUrl ?? "");
  }

  const [searchState, searchFormAction, searchSaving] = React.useActionState<
    SearchSettingsState,
    FormData
  >(saveSearchSettings, {});

  const router = useRouter();
  const gateway = getGateway(provider);

  React.useEffect(() => {
    if (!state.ok) return;
    onOpenChange(false);
    router.refresh();
  }, [state.ok, onOpenChange, router]);

  React.useEffect(() => {
    if (!searchState.ok) return;
    onOpenChange(false);
    router.refresh();
  }, [searchState.ok, onOpenChange, router]);

  function handleProviderChange(value: string | null) {
    if (!value) return;
    const next = value;
    setProvider(next);
    setTest(null);
    const preset = getGateway(next).defaultBaseUrl;
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

  async function handleSavePrompt() {
    setPromptSaving(true);
    setPromptError(null);
    setPromptSaved(false);
    try {
      const res = await saveUserSystemPrompt(systemPrompt);
      if (res.ok) {
        setPromptSaved(true);
        window.setTimeout(() => setPromptSaved(false), 2500);
      } else if (res.error) {
        setPromptError(res.error);
      }
    } catch (err) {
      setPromptError(
        err instanceof Error ? err.message : "Failed to save system prompt.",
      );
    } finally {
      setPromptSaving(false);
    }
  }

  async function runSearchTest(source: "tavily" | "searxng") {
    setSearchTesting(true);
    setSearchTest(null);
    try {
      const result = await testSearchConnection({
        source,
        tavilyApiKey: tavilyKey,
        searxngUrl,
      });
      setSearchTest({ ok: result.ok, message: result.message });
    } finally {
      setSearchTesting(false);
    }
  }

  async function handleClearTavilyKey() {
    setClearingKey(true);
    try {
      await clearTavilyKey();
      setTavilyKey("");
      setSearchTest(null);
      router.refresh();
    } finally {
      setClearingKey(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "provider" | "prompts")}
        >
          <div className="border-b pb-3">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="provider" className="gap-2">
                <KeyRoundIcon className="size-4" />
                <span>Provider</span>
              </TabsTrigger>
              <TabsTrigger value="search" className="gap-2">
                <SearchIcon className="size-4" />
                <span>Web Search</span>
              </TabsTrigger>
              <TabsTrigger value="prompts" className="gap-2">
                <WandSparklesIcon className="size-4" />
                <span>System Prompt</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Provider Tab */}
          <TabsContent value="provider" className="pt-2">
            <DialogHeader className="mb-3">
              <DialogTitle>Model Provider Gateway</DialogTitle>
              <DialogDescription>
                OmniChat communicates with an OpenAI-compatible gateway (e.g.
                OmniRoute, OpenRouter, or direct providers). Keys are encrypted
                at rest.
              </DialogDescription>
            </DialogHeader>

            <form action={formAction} className="flex flex-col gap-4">
              <input type="hidden" name="provider" value={provider} />

              <div className="flex flex-col gap-2">
                <Label htmlFor="provider-select">Provider</Label>
                <Select value={provider} onValueChange={handleProviderChange}>
                  <SelectTrigger id="provider-select" className="w-full">
                    <SelectValue>
                      {(value) => getGateway(String(value)).name}
                    </SelectValue>
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
                      current
                        ? `•••• ${current.last4} — enter a new key to replace`
                        : "sk_omniroute…"
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
                  {saving ? "Saving…" : "Save settings"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          {/* Web Search Tab */}
          <TabsContent value="search" className="pt-2">
            <DialogHeader className="mb-3">
              <DialogTitle>Web Search</DialogTitle>
              <DialogDescription>
                Engines are tried in order and DuckDuckGo is always the keyless
                fallback, so search works with no configuration at all. If a
                search cannot run, the model is told so rather than allowed to
                answer from memory.
              </DialogDescription>
            </DialogHeader>

            <form
              action={searchFormAction}
              className="flex flex-col gap-4"
            >
              <input
                type="hidden"
                name="searchPreferred"
                value={searchPreferred}
              />

              <div className="flex flex-col gap-2">
                <Label htmlFor="search-preferred">Preferred engine</Label>
                <Select
                  value={searchPreferred}
                  onValueChange={(value) => {
                    if (value) setSearchPreferred(value);
                    setSearchTest(null);
                  }}
                >
                  <SelectTrigger id="search-preferred" className="w-full">
                    <SelectValue>
                      {(value) =>
                        SEARCH_OPTIONS.find((o) => o.id === String(value))
                          ?.name ?? "Automatic"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SEARCH_OPTIONS.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {SEARCH_OPTIONS.find((o) => o.id === searchPreferred)?.hint}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="tavilyApiKey">Tavily API key (optional)</Label>
                <div className="relative">
                  <Input
                    id="tavilyApiKey"
                    name="tavilyApiKey"
                    type={searchReveal ? "text" : "password"}
                    value={tavilyKey}
                    onChange={(e) => {
                      setTavilyKey(e.target.value);
                      setSearchTest(null);
                    }}
                    placeholder={
                      initialSearch?.tavilyLast4
                        ? `•••• ${initialSearch.tavilyLast4} — enter a new key to replace`
                        : "tvly-…"
                    }
                    autoComplete="off"
                    spellCheck={false}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setSearchReveal((v) => !v)}
                    aria-label={
                      searchReveal ? "Hide Tavily key" : "Show Tavily key"
                    }
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {searchReveal ? (
                      <EyeOffIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Leave blank to keep the saved key.
                  </p>
                  {initialSearch?.tavilyLast4 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={handleClearTavilyKey}
                      disabled={clearingKey}
                      className="shrink-0 gap-1 text-xs text-muted-foreground hover:text-destructive"
                    >
                      {clearingKey ? (
                        <LoaderIcon className="size-3 animate-spin" />
                      ) : (
                        <Trash2Icon className="size-3" />
                      )}
                      Remove key
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="searxngUrl">SearXNG URL (optional)</Label>
                <Input
                  id="searxngUrl"
                  name="searxngUrl"
                  value={searxngUrl}
                  onChange={(e) => {
                    setSearxngUrl(e.target.value);
                    setSearchTest(null);
                  }}
                  placeholder="http://localhost:8888"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Your instance needs the{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                    json
                  </code>{" "}
                  format enabled and{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                    limiter: false
                  </code>{" "}
                  in its settings.yml.
                </p>
              </div>

              {searchTest ? (
                <p
                  className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                    searchTest.ok
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {searchTest.ok ? (
                    <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  )}
                  {searchTest.message}
                </p>
              ) : null}

              {searchState.error ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  {searchState.error}
                </p>
              ) : null}

              <DialogFooter className="mt-2 gap-2 sm:justify-between">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => runSearchTest("tavily")}
                    disabled={
                      searchTesting ||
                      (!tavilyKey && !initialSearch?.tavilyLast4)
                    }
                  >
                    {searchTesting ? (
                      <LoaderIcon className="animate-spin" />
                    ) : (
                      <PlugZapIcon />
                    )}
                    Tavily
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => runSearchTest("searxng")}
                    disabled={searchTesting || !searxngUrl}
                  >
                    {searchTesting ? (
                      <LoaderIcon className="animate-spin" />
                    ) : (
                      <PlugZapIcon />
                    )}
                    SearXNG
                  </Button>
                </div>

                <Button
                  type="submit"
                  disabled={searchSaving}
                  aria-busy={searchSaving}
                >
                  {searchSaving ? <LoaderIcon className="animate-spin" /> : null}
                  {searchSaving ? "Saving…" : "Save web search"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          {/* System Prompt Tab */}
          <TabsContent value="prompts" className="pt-2 space-y-4">
            <DialogHeader>
              <DialogTitle>Custom System Prompt</DialogTitle>
              <DialogDescription>
                Instructions set here are provided as a system message to the
                model at the start of every turn to control persona, tone, and
                formatting.
              </DialogDescription>
            </DialogHeader>

            <div>
              <span className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Quick presets
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_PRESETS.map((preset) => (
                  <Button
                    key={preset.name}
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setSystemPrompt(preset.prompt)}
                    className="text-xs"
                  >
                    {preset.name}
                  </Button>
                ))}
                {systemPrompt ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setSystemPrompt("")}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="system-prompt" className="text-xs font-medium">
                Instructions
              </Label>
              <Textarea
                id="system-prompt"
                rows={6}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="e.g. You are a Senior Software Engineer. You write clean, idiomatic code in TypeScript. Always explain trade-offs and avoid unnecessary conversational filler..."
                className="font-mono text-xs leading-relaxed"
              />
              <span className="text-[11px] text-muted-foreground block text-right">
                {systemPrompt.length} characters
              </span>
            </div>

            {promptError ? (
              <p className="text-xs text-destructive">{promptError}</p>
            ) : null}

            {promptSaved ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2Icon className="size-3.5" />
                System prompt saved!
              </p>
            ) : null}

            <DialogFooter className="gap-2 sm:justify-end">
              <Button
                type="button"
                onClick={handleSavePrompt}
                disabled={promptSaving}
                className="gap-1.5"
              >
                {promptSaving ? (
                  <LoaderIcon className="size-3.5 animate-spin" />
                ) : (
                  <CheckIcon className="size-3.5" />
                )}
                Save system prompt
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
