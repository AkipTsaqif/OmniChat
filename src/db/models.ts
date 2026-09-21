import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { providerSettings } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { parseModelInfo } from "@/lib/data";
import type { Model } from "@/lib/types";

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
      .filter((entry): entry is { id: string; owned_by?: string } => !!entry.id)
      .filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      })
      .map((entry) => {
        const info = parseModelInfo(entry.id, entry.owned_by);
        return {
          id: entry.id,
          name: info.modelName,
          provider: info.providerId,
          providerName: info.providerName,
          providerMark: info.providerMark,
          description: entry.id,
          contextWindow: "",
        };
      });
  } catch {
    // Gateway down or timed out — the caller renders the empty case.
    return [];
  }
}
