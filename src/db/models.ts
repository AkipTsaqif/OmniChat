import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { providerSettings } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import type { Model } from "@/lib/types";

/** Best-effort inference of a vendor from an OpenAI-style model id. */
function vendorFor(id: string): Model["provider"] {
  const lower = id.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) {
    return "anthropic";
  }
  if (lower.includes("gemini") || lower.includes("google")) return "google";
  if (lower.includes("llama") || lower.includes("meta")) return "meta";
  if (lower.includes("mistral") || lower.includes("mixtral")) return "mistral";
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3")) {
    return "openai";
  }
  return "unknown";
}

/** Strips a leading `vendor/` segment for display. */
function displayName(id: string) {
  const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return tail;
}

/**
 * Live model list from the user's configured gateway.
 * Returns an empty array when no provider is set up or the gateway is
 * unreachable — the UI must handle that rather than invent models.
 */
export async function getAvailableModels(userId: string): Promise<Model[]> {
  const [settings] = await db
    .select()
    .from(providerSettings)
    .where(eq(providerSettings.userId, userId))
    .limit(1);

  if (!settings) return [];

  try {
    const response = await fetch(`${settings.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${decryptSecret(settings.apiKeyCipher)}`,
      },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });

    if (!response.ok) return [];

    const body = (await response.json()) as {
      data?: { id?: string; owned_by?: string }[];
    };

    const seen = new Set<string>();
    return (body.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => !!id)
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((id) => ({
        id,
        name: displayName(id),
        provider: vendorFor(id),
        description: id,
        contextWindow: "",
      }));
  } catch {
    // Gateway down or timed out — the caller renders the empty case.
    return [];
  }
}
