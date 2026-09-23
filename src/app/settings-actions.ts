"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import { checkProviderHealth } from "@/db/models";
import { conversations, providerSettings, searchSettings, users } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import type { ProviderStatus } from "@/lib/types";

export type SettingsState = { error?: string; ok?: boolean };

async function requireUserId() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

export async function saveProviderSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const userId = await requireUserId();

  const provider = String(formData.get("provider") ?? "omniroute");
  const baseUrl = String(formData.get("baseUrl") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();

  if (!baseUrl) return { error: "Enter the gateway URL." };
  if (!apiKey) return { error: "Enter your API key." };

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { error: "That URL is not valid. Include http:// or https://." };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { error: "URL must start with http:// or https://." };
  }

  // Normalise: strip trailing slashes so we can append /chat/completions.
  const normalised = baseUrl.replace(/\/+$/, "");

  const values = {
    userId,
    provider,
    baseUrl: normalised,
    apiKeyCipher: encryptSecret(apiKey),
    apiKeyLast4: apiKey.slice(-4),
    updatedAt: new Date(),
  };

  await db
    .insert(providerSettings)
    .values(values)
    .onConflictDoUpdate({
      target: providerSettings.userId,
      set: values,
    });

  revalidatePath("/");
  return { ok: true };
}

export async function clearProviderSettings() {
  const userId = await requireUserId();
  await db
    .delete(providerSettings)
    .where(eq(providerSettings.userId, userId));
  revalidatePath("/");
}

/** Verifies the endpoint answers before we save anything. */
export async function testProviderConnection(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: boolean; message: string; models?: string[] }> {
  await requireUserId();

  const base = input.baseUrl.trim().replace(/\/+$/, "");
  if (!base || !input.apiKey.trim()) {
    return { ok: false, message: "Enter both a URL and an API key." };
  }

  try {
    const response = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${input.apiKey.trim()}` },
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: "The gateway rejected that API key." };
    }
    if (!response.ok) {
      return {
        ok: false,
        message: `Gateway responded ${response.status}. Check the URL.`,
      };
    }

    const body = (await response.json()) as {
      data?: { id?: string }[];
    };
    const models =
      body.data?.map((m) => m.id).filter((id): id is string => !!id) ?? [];

    return {
      ok: true,
      message: models.length
        ? `Connected. ${models.length} models available.`
        : "Connected.",
      models: models.slice(0, 50),
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "timed out"
        : "could not be reached";
    return {
      ok: false,
      message: `The gateway ${reason}. Is it running at that URL?`,
    };
  }
}

export async function saveUserSystemPrompt(
  prompt: string,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId();
  const clean = prompt.trim();

  await db
    .update(users)
    .set({ systemPrompt: clean ? clean : null })
    .where(eq(users.id, userId));

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setConversationSystemPrompt(
  conversationId: string,
  prompt: string,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId();
  const clean = prompt.trim();

  await db
    .update(conversations)
    .set({ systemPrompt: clean ? clean : null, updatedAt: new Date() })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
      ),
    );

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Re-probes the saved gateway and reports whether it is still usable.
 * Lets the UI recover from a transient outage without making the user
 * re-enter their key, and explains *why* when models are unavailable.
 */
export async function recheckProvider(): Promise<{
  status: ProviderStatus;
  message: string | null;
  modelCount: number;
}> {
  const userId = await requireUserId();
  const health = await checkProviderHealth(userId);

  revalidatePath("/", "layout");
  return {
    status: health.status,
    message: health.message,
    modelCount: health.models.length,
  };
}

/* ------------------------------------------------------------------ *
 * Web search
 * ------------------------------------------------------------------ */

export type SearchSettingsState = { error?: string; ok?: boolean };

const SEARCH_PREFERENCES = ["auto", "tavily", "searxng", "duckduckgo"] as const;

/**
 * Saves the web search chain configuration.
 *
 * A blank Tavily key means "keep the one I already saved" — the field doubles
 * as its own placeholder, so re-saving without retyping the key must not erase
 * it. Use `clearTavilyKey` to deliberately remove one.
 */
export async function saveSearchSettings(
  _prev: SearchSettingsState,
  formData: FormData,
): Promise<SearchSettingsState> {
  const userId = await requireUserId();

  const preferred = String(formData.get("searchPreferred") ?? "auto");
  const tavilyApiKey = String(formData.get("tavilyApiKey") ?? "").trim();
  const searxngUrl = String(formData.get("searxngUrl") ?? "").trim();

  if (!SEARCH_PREFERENCES.includes(preferred as (typeof SEARCH_PREFERENCES)[number])) {
    return { error: "Choose a valid search engine." };
  }

  let normalisedUrl: string | null = null;
  if (searxngUrl) {
    let parsed: URL;
    try {
      parsed = new URL(searxngUrl);
    } catch {
      return {
        error: "That SearXNG URL is not valid. Include http:// or https://.",
      };
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      return { error: "The SearXNG URL must start with http:// or https://." };
    }
    // Normalise: strip trailing slashes so we can append /search.
    normalisedUrl = searxngUrl.replace(/\/+$/, "");
  }

  const [existing] = await db
    .select({
      tavilyApiKeyCipher: searchSettings.tavilyApiKeyCipher,
      tavilyApiKeyLast4: searchSettings.tavilyApiKeyLast4,
    })
    .from(searchSettings)
    .where(eq(searchSettings.userId, userId))
    .limit(1);

  const cipher = tavilyApiKey
    ? encryptSecret(tavilyApiKey)
    : (existing?.tavilyApiKeyCipher ?? null);
  const last4 = tavilyApiKey
    ? tavilyApiKey.slice(-4)
    : (existing?.tavilyApiKeyLast4 ?? null);

  const values = {
    userId,
    preferred,
    tavilyApiKeyCipher: cipher,
    tavilyApiKeyLast4: last4,
    searxngUrl: normalisedUrl,
    updatedAt: new Date(),
  };

  await db
    .insert(searchSettings)
    .values(values)
    .onConflictDoUpdate({
      target: searchSettings.userId,
      set: values,
    });

  revalidatePath("/");
  return { ok: true };
}

export async function clearTavilyKey(): Promise<{ ok: boolean }> {
  const userId = await requireUserId();

  await db
    .update(searchSettings)
    .set({ tavilyApiKeyCipher: null, tavilyApiKeyLast4: null, updatedAt: new Date() })
    .where(eq(searchSettings.userId, userId));

  revalidatePath("/");
  return { ok: true };
}

/** Verifies a search backend answers before we save it. */
export async function testSearchConnection(input: {
  source: "tavily" | "searxng";
  tavilyApiKey?: string;
  searxngUrl?: string;
}): Promise<{ ok: boolean; message: string }> {
  const userId = await requireUserId();

  if (input.source === "tavily") {
    let key = input.tavilyApiKey?.trim() ?? "";

    // Re-testing a saved key: the plaintext is not on the client, so resolve it
    // from the stored cipher rather than demanding it be retyped.
    if (!key) {
      const [stored] = await db
        .select({ cipher: searchSettings.tavilyApiKeyCipher })
        .from(searchSettings)
        .where(eq(searchSettings.userId, userId))
        .limit(1);
      if (stored?.cipher) {
        try {
          key = decryptSecret(stored.cipher);
        } catch {
          key = "";
        }
      }
    }

    if (!key) return { ok: false, message: "Enter your Tavily API key first." };

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ query: "ping", max_results: 1, search_depth: "basic" }),
        signal: AbortSignal.timeout(8_000),
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: "Tavily rejected that API key." };
      }
      if (response.status === 429) {
        return {
          ok: false,
          message: "Tavily is rate limiting this key — the free quota may be spent.",
        };
      }
      if (!response.ok) {
        return { ok: false, message: `Tavily responded ${response.status}.` };
      }
      return { ok: true, message: "Connected to Tavily." };
    } catch {
      return { ok: false, message: "Tavily could not be reached." };
    }
  }

  const base =
    input.searxngUrl?.trim().replace(/\/+$/, "") ||
    (
      await db
        .select({ url: searchSettings.searxngUrl })
        .from(searchSettings)
        .where(eq(searchSettings.userId, userId))
        .limit(1)
    )[0]?.url?.replace(/\/+$/, "") ||
    "";
  if (!base) return { ok: false, message: "Enter the SearXNG URL first." };

  try {
    const url = new URL(`${base}/search`);
    url.searchParams.set("q", "ping");
    url.searchParams.set("format", "json");

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 403) {
      return {
        ok: false,
        message:
          "SearXNG refused the request. Enable the `json` format and set `limiter: false` in its settings.yml.",
      };
    }
    if (!response.ok) {
      return { ok: false, message: `SearXNG responded ${response.status}.` };
    }
    try {
      await response.json();
    } catch {
      return {
        ok: false,
        message: "SearXNG did not return JSON. Enable the `json` format in settings.yml.",
      };
    }
    return { ok: true, message: "Connected to SearXNG." };
  } catch {
    return {
      ok: false,
      message: "SearXNG could not be reached. Is it running at that URL?",
    };
  }
}
