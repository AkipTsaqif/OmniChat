import type { PageContent } from "@/lib/types";

/**
 * Downloads a page and reduces it to readable text.
 *
 * Deliberately dependency-free: a readability library would drag in a DOM.
 * This is a crude but predictable extractor — strip non-content elements,
 * promote block boundaries to newlines, drop tags, collapse space. Good enough
 * for an FAQ or a terms page, which is what it exists for.
 *
 * This tool makes the server fetch a caller-chosen URL, so `assertFetchable`
 * is the SSRF boundary. See that function for the trade-offs.
 */

const TIMEOUT_MS = 10_000;
/** Refuse obviously-large payloads before buffering them. */
const MAX_BYTES = 2_000_000;
/** Cap what reaches the model — a whole site's worth of chrome helps nobody. */
export const MAX_CHARS = 8_000;

/* ------------------------------------------------------------------ *
 * URL safety
 * ------------------------------------------------------------------ */

const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|::1|0\.0\.0\.0)$/i;
const PRIVATE_SUFFIX = /\.(local|internal|localdomain|home|lan)$/i;

/** Link-local metadata services — the classic cloud credential-theft target. */
const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "100.100.100.200",
]);

function isPrivateHost(host: string): boolean {
  return PRIVATE_HOST.test(host) || PRIVATE_SUFFIX.test(host);
}

/**
 * Validates a URL and returns its normalised form.
 *
 * Trade-off, stated plainly: this is a self-hosted, single-user app, so
 * blocking private ranges outright would stop someone reading their own local
 * docs to no security benefit. The genuinely dangerous targets — cloud
 * metadata endpoints — are always blocked. Set OMNICHAT_BLOCK_PRIVATE_FETCH=1
 * to also refuse private/loopback hosts if this ever sits on a shared or
 * internet-facing deployment.
 *
 * Known limitation: this checks the hostname as written. It does not resolve
 * DNS and re-check the resulting address, so it does not defend against DNS
 * rebinding. It is a guardrail, not a sandbox.
 */
export function assertFetchable(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("That is not a valid absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// pages can be read.");
  }

  const host = url.hostname.toLowerCase();
  if (METADATA_HOSTS.has(host)) {
    throw new Error("That address is blocked.");
  }
  if (
    process.env.OMNICHAT_BLOCK_PRIVATE_FETCH === "1" &&
    isPrivateHost(host)
  ) {
    throw new Error(
      "Private network addresses are blocked on this deployment.",
    );
  }

  return url.toString();
}

/* ------------------------------------------------------------------ *
 * HTML → text
 * ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(Number.parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) =>
      NAMED_ENTITIES[name.toLowerCase()] ?? m,
    );
}

export function extractReadable(html: string): { title: string; text: string } {
  const title = decodeEntities(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "",
  )
    .replace(/\s+/g, " ")
    .trim();

  let body = html;

  // Whole elements that are never prose.
  body = body.replace(
    /<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi,
    " ",
  );
  body = body.replace(/<!--[\s\S]*?-->/g, " ");

  // Block boundaries become newlines so paragraphs do not run together.
  body = body.replace(
    /<\/?(p|div|br|li|tr|td|th|h[1-6]|section|article|header|footer|nav|blockquote)\b[^>]*>/gi,
    "\n",
  );
  body = body.replace(/<[^>]+>/g, " ");

  const text = decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  return { title, text };
}

/* ------------------------------------------------------------------ *
 * Fetch
 * ------------------------------------------------------------------ */

export async function fetchPage(rawUrl: string): Promise<PageContent> {
  const url = assertFetchable(rawUrl);

  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      // A browser-shaped UA. Identifying ourselves as "OmniChat/0.1" earns a
      // 403 from Fandom, GitHub wikis and most forums, which then reads to the
      // model as "the page is gone" and sends it searching for substitutes.
      // The DuckDuckGo scraper below uses the same shape for the same reason.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "the site blocks automated readers. Do not retry this page or others on the same domain — use the search results you already have",
    );
  }

  if (response.status === 404) {
    throw new Error(
      "the page does not exist — the URL is wrong or the page has moved. Do not retry it",
    );
  }

  if (!response.ok) {
    throw new Error(`The page responded ${response.status}.`);
  }

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    throw new Error(
      `The page is too large to read (${Math.round(declared / 1_000_000)}MB).`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (/^(image|audio|video|application\/(pdf|zip|octet-stream))/i.test(contentType)) {
    throw new Error(`That is a ${contentType.split(";")[0]} file, not a page.`);
  }

  const raw = await response.text();
  const { title, text } = extractReadable(raw);

  if (!text.trim()) {
    throw new Error(
      "The page returned no readable text — it may render content with JavaScript.",
    );
  }

  return {
    url: response.url || url,
    title: title || response.url || url,
    text,
    truncated: text.length >= MAX_CHARS,
  };
}
