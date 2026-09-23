import "server-only";

/**
 * In-process sliding-window rate limiter.
 *
 * Deliberately memory-backed and dependency-free. OmniChat is a self-hosted,
 * single-instance app, so a shared store (Redis) or a durable one (Postgres)
 * would be machinery with no requirement behind it. The honest cost is that
 * counters reset on restart and do not coordinate across processes — that is a
 * throttle for a login form, not an authentication control, and it is
 * documented as such rather than quietly implied to be more.
 */

type Hits = number[];

/**
 * Kept on globalThis so Next's dev HMR — which re-evaluates modules on every
 * edit — does not silently reset everyone's counters mid-test.
 */
const store = globalThis as typeof globalThis & {
  __omnichatRateLimits?: Map<string, Hits>;
};

const buckets: Map<string, Hits> = (store.__omnichatRateLimits ??= new Map());

/** Hard ceiling so a flood of distinct keys cannot exhaust memory. */
const MAX_KEYS = 5_000;

export type RateLimitVerdict = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the oldest hit ages out. Always 0 when allowed. */
  retryAfterSeconds: number;
};

/**
 * Records an attempt and reports whether it is allowed.
 *
 * @param key        Bucket identity — include the action and the subject so
 *                   unrelated limits never share a counter.
 * @param limit      Attempts permitted per window.
 * @param windowMs   Sliding window width.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitVerdict {
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);

  if (hits.length >= limit) {
    buckets.set(key, hits);
    const oldest = hits[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  hits.push(now);
  buckets.set(key, hits);
  evictIfNeeded(now, windowMs);

  return {
    allowed: true,
    remaining: limit - hits.length,
    retryAfterSeconds: 0,
  };
}

function evictIfNeeded(now: number, windowMs: number) {
  if (buckets.size <= MAX_KEYS) return;

  // Retire buckets that are already outside any live window first — these are
  // pure garbage and cost nothing to lose.
  for (const [key, hits] of buckets) {
    if (buckets.size <= MAX_KEYS) break;
    if ((hits.at(-1) ?? 0) <= now - windowMs) buckets.delete(key);
  }

  // Still full. Map preserves insertion order, so the first key is the
  // least recently created bucket and the cheapest to drop.
  while (buckets.size > MAX_KEYS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey === undefined) break;
    buckets.delete(oldestKey);
  }
}

/**
 * Generic wait message.
 *
 * Note the deliberate omission of the retry delay: naming it would leak which
 * limit tripped, and an attacker could use that difference to tell existing
 * accounts from non-existent ones.
 */
export const THROTTLED_MESSAGE =
  "Too many attempts. Please wait a moment and try again.";
