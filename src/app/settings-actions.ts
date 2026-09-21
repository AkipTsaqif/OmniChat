"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import { conversations, providerSettings, users } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";

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
