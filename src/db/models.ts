import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { providerSettings } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { parseModelInfo } from "@/lib/data";
import type { Model, ProviderStatus } from "@/lib/types";

/** Network calls to a user's own gateway can be slow; be generous. */
const MODELS_TIMEOUT_MS = 15_000;

export type ProviderHealth = {
  status: ProviderStatus;
  /** Human-readable reason, shown in the UI when not "ok". */
  message: string | null;
  models: Model[];
};

function mapModels(
  data: { id?: string; owned_by?: string }[] | undefined,
): Model[] {
  const seen = new Set<string>();
  return (data ?? [])
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
}

/**
 * Checks the user's saved gateway and returns both its health and its models.
 *
 * Distinguishes the failure modes so the UI can explain itself instead of
 * flatly claiming there are no models:
 *   none          — nothing configured yet
 *   ok            — reachable, models returned
 *   empty         — reachable and authorised, but it serves no models
 *   unauthorized  — the gateway rejected the stored key
 *   unreachable   — DNS/connection failure or timeout
 *   key_undecryptable — OMNICHAT_ENCRYPTION_KEY changed since the key was saved
 */
export async function checkProviderHealth(
  userId: string,
): Promise<ProviderHealth> {
  const [settings] = await db
    .select()
    .from(providerSettings)
    .where(eq(providerSettings.userId, userId))
    .limit(1);

  if (!settings) {
    return { status: "none", message: null, models: [] };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(settings.apiKeyCipher);
  } catch {
    // The encryption key changed (or .env.local was regenerated), so the
    // stored ciphertext can never be read again. Saying "no models" here
    // would send the user hunting for a gateway problem that does not exist.
    return {
      status: "key_undecryptable",
      message:
        "Your saved API key can no longer be decrypted, which happens when OMNICHAT_ENCRYPTION_KEY changes. Re-enter the key to reconnect.",
      models: [],
    };
  }

  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      status: "unreachable",
      message: timedOut
        ? `${settings.baseUrl} did not respond within ${MODELS_TIMEOUT_MS / 1000}s.`
        : `Could not reach ${settings.baseUrl}. Check that the gateway is running.`,
      models: [],
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: "unauthorized",
      message:
        "The gateway rejected your API key. It may have been revoked or rotated.",
      models: [],
    };
  }

  if (!response.ok) {
    return {
      status: "unreachable",
      message: `The gateway responded ${response.status}.`,
      models: [],
    };
  }

  let models: Model[];
  try {
    const body = (await response.json()) as {
      data?: { id?: string; owned_by?: string }[];
    };
    models = mapModels(body.data);
  } catch {
    return {
      status: "unreachable",
      message: "The gateway returned a response that could not be parsed.",
      models: [],
    };
  }

  if (models.length === 0) {
    return {
      status: "empty",
      message: "The gateway is connected but is not serving any models.",
      models: [],
    };
  }

  return { status: "ok", message: null, models };
}

/**
 * Live model list from the user's configured gateway.
 * Returns an empty array when no provider is set up or the gateway is
 * unreachable — the UI must handle that rather than invent models.
 */
export async function getAvailableModels(userId: string): Promise<Model[]> {
  const { models } = await checkProviderHealth(userId);
  return models;
}
