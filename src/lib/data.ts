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
  unknown: {
    id: "unknown",
    name: "Model",
    mark: "//",
    accent: "bg-muted text-muted-foreground",
  },
};

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
