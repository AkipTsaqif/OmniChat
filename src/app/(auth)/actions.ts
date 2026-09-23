"use server";

import { AuthError } from "next-auth";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import { signIn } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";
import { rateLimit, THROTTLED_MESSAGE } from "@/lib/rate-limit";

export type AuthState = { error?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Attempts and window in ms. Every value is env-overridable so CI and shared
 * deployments can tune without a code change.
 */
function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const LIMITS = {
  // The security-critical control: guessing at existing credentials.
  signInPerIp: {
    limit: envInt("OMNICHAT_RATE_SIGNIN_IP_LIMIT", 10),
    windowMs: envInt("OMNICHAT_RATE_SIGNIN_IP_WINDOW_MS", 60_000),
  },
  signInPerEmail: {
    limit: envInt("OMNICHAT_RATE_SIGNIN_EMAIL_LIMIT", 5),
    windowMs: envInt("OMNICHAT_RATE_SIGNIN_EMAIL_WINDOW_MS", 10 * 60_000),
  },
  // Abuse prevention, not security — so it is deliberately looser. A first cut
  // of 5/hour was too tight in practice: every request without a proxy shares
  // one bucket (localhost, a LAN demo, a household behind one router), and it
  // bricked this repo's own smoke suite after five sign-ups. 20/hour still
  // stops burst account creation while leaving legitimate onboarding alone.
  signUpPerIp: {
    limit: envInt("OMNICHAT_RATE_SIGNUP_IP_LIMIT", 20),
    windowMs: envInt("OMNICHAT_RATE_SIGNUP_IP_WINDOW_MS", 60 * 60_000),
  },
} as const;

/**
 * Best-effort client identity. `x-forwarded-for` is attacker-controlled when
 * the app is exposed directly rather than behind a proxy, so this throttles —
 * it does not authenticate, and must never be treated as a security boundary.
 */
async function clientIp(): Promise<string> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || list.get("x-real-ip")?.trim() || "local";
}

function throttled(key: string, limit: number, windowMs: number): boolean {
  return !rateLimit(key, limit, windowMs).allowed;
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  // Throttled before any validation or lookup, so the limit cannot be used as
  // a probe: the same message comes back whether or not the address is real.
  if (
    throttled(
      `signup:ip:${await clientIp()}`,
      LIMITS.signUpPerIp.limit,
      LIMITS.signUpPerIp.windowMs,
    )
  ) {
    return { error: THROTTLED_MESSAGE };
  }

  if (!name) return { error: "Enter your name." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) return { error: "An account with that email already exists." };

  await db.insert(users).values({
    name,
    email,
    passwordHash: hashPassword(password),
  });

  // signIn redirects on success, so anything after it only runs on failure.
  await signIn("credentials", { email, password, redirectTo: "/" });
  return {};
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  // Two independent counters: one per source address to blunt credential
  // stuffing across many accounts, one per submitted address to blunt sustained
  // guessing at a single account from many sources.
  const ip = await clientIp();
  if (
    throttled(
      `signin:ip:${ip}`,
      LIMITS.signInPerIp.limit,
      LIMITS.signInPerIp.windowMs,
    ) ||
    (email !== "" &&
      throttled(
        `signin:email:${email}`,
        LIMITS.signInPerEmail.limit,
        LIMITS.signInPerEmail.windowMs,
      ))
  ) {
    return { error: THROTTLED_MESSAGE };
  }

  if (!email || !password) return { error: "Enter your email and password." };

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Incorrect email or password." };
    }
    // Redirects are thrown; let them through.
    throw error;
  }
}
