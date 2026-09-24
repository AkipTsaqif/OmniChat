import type { SearchOutcome, SearchSource, SearchResult } from "@/lib/types";

/**
 * Web search with a guaranteed keyless floor.
 *
 * Engines are tried in order and the first that returns results wins.
 * DuckDuckGo is always last and always present, so a fresh install with no
 * configuration can still search. A preferred engine that is not configured
 * is not an error — the chain simply starts further down.
 */

const TIMEOUT_MS = 8_000;

/**
 * DuckDuckGo Lite throttles rapid successive requests from one address. A
 * tool chain that searches three times in three seconds will get the first two
 * answered and the third dropped — which looks like a broken parser and reads
 * to the model like "search failed, try again", producing a retry loop. A
 * small floor between calls avoids manufacturing that failure ourselves.
 */
const DDG_MIN_INTERVAL_MS = 500;
let lastDuckDuckGoCall = 0;

export type SearchPreference = "auto" | SearchSource;

export type SearchConfig = {
  preferred: SearchPreference;
  /** Decrypted Tavily key. Null when unset. */
  tavilyApiKey?: string | null;
  /** Base URL of a self-hosted SearXNG instance. Null when unset. */
  searxngUrl?: string | null;
};

type Engine = {
  source: SearchSource;
  label: string;
  run: (query: string, limit: number) => Promise<SearchResult[]>;
};

/* ------------------------------------------------------------------ *
 * Chain assembly
 * ------------------------------------------------------------------ */

function buildChain(config: SearchConfig): Engine[] {
  const configured: Engine[] = [];

  if (config.tavilyApiKey) {
    configured.push({
      source: "tavily",
      label: "Tavily",
      run: (q, l) => runTavily(q, l, config.tavilyApiKey!),
    });
  }

  if (config.searxngUrl) {
    configured.push({
      source: "searxng",
      label: "SearXNG",
      run: (q, l) => runSearxng(q, l, config.searxngUrl!),
    });
  }

  const floor: Engine = {
    source: "duckduckgo",
    label: "DuckDuckGo",
    run: runDuckDuckGo,
  };

  if (config.preferred === "auto" || config.preferred === "duckduckgo") {
    return [...configured, floor];
  }

  // Honour the user's ordering preference, then fall through the rest and
  // finally the floor. Never return fewer than the fallbacks we have.
  const preferred = configured.filter((e) => e.source === config.preferred);
  const others = configured.filter((e) => e.source !== config.preferred);
  return [...preferred, ...others, floor];
}

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ */

export async function searchWeb(
  query: string,
  limit = 5,
  config: SearchConfig = { preferred: "auto" },
): Promise<SearchOutcome> {
  const clean = query.trim();
  if (!clean) return { ok: false, reason: "The search query was empty." };

  const errors: string[] = [];
  let anyCleanEmpty = false;
  let lastCleanSource: SearchSource = "duckduckgo";

  for (const engine of buildChain(config)) {
    try {
      const results = await engine.run(clean, limit);
      if (results.length > 0) {
        return { ok: true, source: engine.source, results };
      }
      // Ran fine and found nothing — worth trying the next engine, but it
      // counts as a real answer rather than a tooling failure.
      anyCleanEmpty = true;
      lastCleanSource = engine.source;
    } catch (error) {
      errors.push(
        `${engine.label}: ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  }

  // At least one backend answered cleanly and found nothing. That is a real
  // empty result set, not a broken tool, and the model must be told the
  // difference — see the route's handling of `ok: true` with zero results.
  if (anyCleanEmpty) {
    return { ok: true, source: lastCleanSource, results: [] };
  }

  return {
    ok: false,
    reason: `every search backend failed (${errors.join("; ")})`,
  };
}

/* ------------------------------------------------------------------ *
 * Tavily
 * ------------------------------------------------------------------ */

type RawResult = { title?: string; url?: string; content?: string };

function normalise(entries: RawResult[] | undefined, limit: number): SearchResult[] {
  return (entries ?? [])
    .filter((r): r is RawResult & { url: string } => !!r.url)
    .slice(0, limit)
    .map((r) => ({
      title: r.title?.trim() || r.url,
      url: r.url,
      snippet: (r.content ?? "").replace(/\s+/g, " ").trim(),
    }));
}

async function runTavily(
  query: string,
  limit: number,
  apiKey: string,
): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: limit,
      // Pinned explicitly: `advanced` costs 2 credits against a 1,000/month
      // free tier where `basic` costs 1. A default drift here would silently
      // halve the allowance.
      search_depth: "basic",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("the API key was rejected");
  }
  if (response.status === 429) {
    throw new Error("the monthly quota is exhausted or rate limited");
  }
  if (!response.ok) throw new Error(`responded ${response.status}`);

  const body = (await response.json()) as { results?: RawResult[] };
  return normalise(body.results, limit);
}

/* ------------------------------------------------------------------ *
 * SearXNG
 * ------------------------------------------------------------------ */

async function runSearxng(
  query: string,
  limit: number,
  baseUrl: string,
): Promise<SearchResult[]> {
  const url = new URL(`${baseUrl.trim().replace(/\/+$/, "")}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  if (response.status === 403) {
    // SearXNG disables the JSON format by default; a missing `formats: [json]`
    // entry in settings.yml surfaces here as a 403 rather than as HTML.
    throw new Error(
      "refused the request — enable the `json` format in settings.yml and set `limiter: false`",
    );
  }
  if (!response.ok) throw new Error(`responded ${response.status}`);

  let body: { results?: RawResult[] };
  try {
    body = (await response.json()) as { results?: RawResult[] };
  } catch {
    throw new Error(
      "did not return JSON — enable the `json` format in settings.yml",
    );
  }

  return normalise(body.results, limit);
}

/* ------------------------------------------------------------------ *
 * DuckDuckGo Lite (keyless floor)
 *
 * Parsed one result row at a time rather than as three parallel match arrays.
 * The old shape zipped `linkMatches`, `hrefMatches` and `snippetMatches` by
 * index and truncated to the shortest, so a single mismatched snippet silently
 * dropped results. Here each row yields its own title, url and (optional)
 * snippet, and a missing snippet degrades the row instead of deleting it.
 * ------------------------------------------------------------------ */

const ROW_SPLIT = /<tr\b[^>]*>/i;
const ANCHOR = /<a\b[^>]*class=["'][^"']*result-link[^"']*["'][^>]*>[\s\S]*?<\/a>/i;
const HREF = /href=["']([^"']+)["']/i;
const SNIPPET =
  /<td\b[^>]*class=["'][^"']*result-snippet[^"']*["'][^>]*>([\s\S]*?)<\/td>/i;

function stripTags(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDuckDuckGoLite(
  html: string,
  limit: number,
): SearchResult[] {
  const results: SearchResult[] = [];

  for (const row of html.split(ROW_SPLIT)) {
    if (results.length >= limit) break;

    const anchor = ANCHOR.exec(row)?.[0];
    if (!anchor) continue;

    const href = HREF.exec(anchor)?.[1];
    if (!href) continue;

    let url = href;
    if (url.includes("uddg=")) {
      try {
        url = decodeURIComponent(url.split("uddg=")[1].split("&")[0]);
      } catch {
        // Keep the raw redirect href rather than dropping the result.
      }
    }

    // Ad / redirect rows, not organic results.
    if (url.includes("duckduckgo.com/y.js") || url.includes("bing.com/aclick")) {
      continue;
    }

    const snippet = SNIPPET.exec(row)?.[1];

    results.push({
      title: stripTags(anchor) || url,
      url,
      snippet: snippet ? stripTags(snippet) : "",
    });
  }

  return results;
}

async function runDuckDuckGo(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const wait = lastDuckDuckGoCall + DDG_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastDuckDuckGoCall = Date.now();

  const response = await fetch("https://lite.duckduckgo.com/lite/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    body: `q=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`responded ${response.status}`);

  const html = await response.text();
  const results = parseDuckDuckGoLite(html, limit);
  if (results.length > 0) return results;

  // Distinguish "the web had nothing" from "we could not read the page". Both
  // used to collapse into an empty array, which let the model answer from stale
  // training data while the user believed the web had been checked.
  if (/result-link/i.test(html)) {
    throw new Error("markup changed and results could not be parsed");
  }
  if (/no results/i.test(html)) return [];

  // No result list at all and no explicit "no results" notice. In practice
  // this is a rate limit or a bot check, not a markup change — say which, so
  // the caller does not go hunting for a parsing bug that is not there.
  throw new Error(
    "returned no result list — most likely rate limiting or a bot check. Pause before searching again",
  );
}
