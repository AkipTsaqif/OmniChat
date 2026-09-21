import type { Provider, ProviderId } from "@/lib/types";

export const PROVIDERS: Record<ProviderId, Provider> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    mark: "OA",
    accent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    mark: "AN",
    accent: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  google: {
    id: "google",
    name: "Google",
    mark: "GO",
    accent: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  meta: {
    id: "meta",
    name: "Meta",
    mark: "ME",
    accent: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    mark: "MI",
    accent: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    mark: "DS",
    accent: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  },
  xai: {
    id: "xai",
    name: "xAI",
    mark: "xA",
    accent: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
  qwen: {
    id: "qwen",
    name: "Qwen",
    mark: "QW",
    accent: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    mark: "CO",
    accent: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
  unknown: {
    id: "unknown",
    name: "Custom",
    mark: "//",
    accent: "bg-muted text-muted-foreground",
  },
};

const KNOWN_MAP: Record<string, { name: string; mark: string; accent: string }> = {
  openai: {
    name: "OpenAI",
    mark: "OA",
    accent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  anthropic: {
    name: "Anthropic",
    mark: "AN",
    accent: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  google: {
    name: "Google",
    mark: "GO",
    accent: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  meta: {
    name: "Meta",
    mark: "ME",
    accent: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  "meta-llama": {
    name: "Meta Llama",
    mark: "ME",
    accent: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  mistral: {
    name: "Mistral",
    mark: "MI",
    accent: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  mistralai: {
    name: "Mistral AI",
    mark: "MI",
    accent: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  deepseek: {
    name: "DeepSeek",
    mark: "DS",
    accent: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  },
  xai: {
    name: "xAI",
    mark: "xA",
    accent: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
  "x-ai": {
    name: "xAI",
    mark: "xA",
    accent: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
  qwen: {
    name: "Qwen",
    mark: "QW",
    accent: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
  cohere: {
    name: "Cohere",
    mark: "CO",
    accent: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
  groq: {
    name: "Groq",
    mark: "GQ",
    accent: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
  ollama: {
    name: "Ollama",
    mark: "OL",
    accent: "bg-stone-500/10 text-stone-600 dark:text-stone-400",
  },
  openrouter: {
    name: "OpenRouter",
    mark: "OR",
    accent: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  omniroute: {
    name: "OmniRoute",
    mark: "OR",
    accent: "bg-primary/10 text-primary",
  },
};

function formatProviderName(raw: string): string {
  return raw
    .split(/[-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatProviderMark(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, "");
  if (clean.length >= 2) {
    return clean.slice(0, 2).toUpperCase();
  }
  return clean.toUpperCase() || "//";
}

/**
 * Extracts provider information and clean model display name directly from
 * OmniRoute's `<provider>/<model>` format, falling back to name inference
 * only when a bare model ID without a provider prefix is supplied.
 */
export function parseModelInfo(id: string, ownedBy?: string) {
  let rawProvider = "";
  let modelName = id;

  if (id.includes("/")) {
    const slashIdx = id.indexOf("/");
    rawProvider = id.slice(0, slashIdx);
    modelName = id.slice(slashIdx + 1);
  } else if (ownedBy && !["system", "user", "organization"].includes(ownedBy)) {
    rawProvider = ownedBy;
  }

  if (!rawProvider) {
    rawProvider = vendorFor(id);
  }

  const norm = rawProvider.toLowerCase();
  const known = KNOWN_MAP[norm];

  const providerName = known?.name ?? formatProviderName(rawProvider);
  const providerMark = known?.mark ?? formatProviderMark(rawProvider);
  const accent = known?.accent ?? "bg-muted text-muted-foreground";

  return {
    providerId: rawProvider,
    providerName,
    providerMark,
    modelName,
    accent,
  };
}

/**
 * Infers the vendor badge / provider identity from a model id.
 */
export function vendorFor(id: string): ProviderId {
  const lower = id.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) return "anthropic";
  if (lower.includes("gemini") || lower.includes("google")) return "google";
  if (lower.includes("llama") || lower.includes("meta")) return "meta";
  if (lower.includes("mistral") || lower.includes("mixtral") || lower.includes("codestral")) return "mistral";
  if (lower.includes("deepseek")) return "deepseek";
  if (lower.includes("grok") || lower.includes("xai") || lower.includes("x-ai")) return "xai";
  if (lower.includes("qwen") || lower.includes("alibaba")) return "qwen";
  if (lower.includes("command") || lower.includes("cohere")) return "cohere";
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3") || lower.includes("o4") || lower.includes("openai")) {
    return "openai";
  }
  return "unknown";
}

/**
 * Vendor styling only. The model catalog itself is fetched from the user's
 * gateway at runtime — nothing about it is hardcoded.
 */
export function getProvider(providerId: string): Provider {
  return PROVIDERS[providerId as ProviderId] ?? PROVIDERS.unknown;
}

export const SUGGESTIONS = [
  {
    title: "Explain a codebase",
    subtitle: "Walk me through this repo's architecture",
  },
  {
    title: "Draft a migration plan",
    subtitle: "Postgres → Planetscale, zero downtime",
  },
  {
    title: "Review my SQL",
    subtitle: "Find N+1 queries and missing indexes",
  },
  {
    title: "Write unit tests",
    subtitle: "Vitest coverage for the auth module",
  },
];

export const HISTORY_BUCKETS = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Older",
] as const;
