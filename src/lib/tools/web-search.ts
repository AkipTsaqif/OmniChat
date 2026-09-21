import type { SearchResult } from "@/lib/types";

/**
 * Executes an organic web search using DuckDuckGo Lite endpoint, which works
 * globally across networks without connection blocks or third-party API keys.
 */
export async function searchWeb(
  query: string,
  limit: number = 5,
): Promise<SearchResult[]> {
  const clean = query.trim();
  if (!clean) return [];

  try {
    const response = await fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      body: `q=${encodeURIComponent(clean)}`,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });

    if (!response.ok) return [];

    const html = await response.text();

    const linkMatches = [
      ...html.matchAll(
        /<a[^>]+class=[\x27"]result-link[\x27"][^>]*>([\s\S]*?)<\/a>/g,
      ),
    ];
    const hrefMatches = [
      ...html.matchAll(
        /href=[\x27"]([^\x27"]+)[\x27"][^>]*class=[\x27"]result-link[\x27"]/g,
      ),
    ];
    const snippetMatches = [
      ...html.matchAll(
        /<td[^>]+class=[\x27"]result-snippet[\x27"][^>]*>([\s\S]*?)<\/td>/g,
      ),
    ];

    const results: SearchResult[] = [];
    const count = Math.min(
      linkMatches.length,
      hrefMatches.length,
      snippetMatches.length,
      limit,
    );

    for (let i = 0; i < count; i++) {
      let url = hrefMatches[i][1];
      if (url.includes("uddg=")) {
        try {
          url = decodeURIComponent(url.split("uddg=")[1].split("&")[0]);
        } catch {}
      }

      if (
        !url.includes("duckduckgo.com/y.js") &&
        !url.includes("bing.com/aclick")
      ) {
        results.push({
          title: linkMatches[i][1].replace(/<[^>]+>/g, "").trim(),
          url,
          snippet: snippetMatches[i][1].replace(/<[^>]+>/g, "").trim(),
        });
      }
    }

    return results;
  } catch (error) {
    console.error("Web search failed:", error);
    return [];
  }
}
