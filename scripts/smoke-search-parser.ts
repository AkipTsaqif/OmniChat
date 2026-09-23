/**
 * Regression guard for parseDuckDuckGoLite (the DuckDuckGo Lite scraper).
 * Run with:  bun scripts/smoke-search-parser.ts   (needs bun — it imports TS)
 */
import { parseDuckDuckGoLite } from "../src/lib/tools/web-search";

const row = (inner: string) => `<html><body><table>
<tr><th>results</th></tr>
${inner}
</table></body></html>`;

const link = (href: string, title: string, attrs = 'rel="nofollow" href="' + href + '" class="result-link"') =>
  `<a ${attrs === "" ? "" : attrs}>${title}</a>`;

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
}

/* 1. Normal row: title + href + snippet all parsed. */
{
  const html = row(`<tr>
    <td valign="top">1.</td>
    <td>${link("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Falpha&rut=x", "Alpha")}
      <td class="result-snippet">Snippet about alpha.</td>
    </td>
  </tr>`);
  const out = parseDuckDuckGoLite(html, 5);
  check(
    "normal row parses title+url+snippet",
    out.length === 1 &&
      out[0].title === "Alpha" &&
      out[0].url === "https://example.com/alpha" &&
      out[0].snippet === "Snippet about alpha.",
    JSON.stringify(out),
  );
}

/* 2. THE REGRESSION: three results, only one has a snippet.
 *    The old index-coupled zip truncated to Math.min(3, 3, 1) === 1. */
{
  const html = row(`<tr><td>1.</td><td>${link("https://a.test/", "First")}
      <td class="result-snippet">Only one with a snippet.</td></td></tr>
    <tr><td>2.</td><td>${link("https://b.test/", "Second")}</td></tr>
    <tr><td>3.</td><td>${link("https://c.test/", "Third")}</td></tr>`);
  const out = parseDuckDuckGoLite(html, 5);
  check(
    "missing snippets no longer drop results (old bug)",
    out.length === 3 &&
      out[0].snippet === "Only one with a snippet." &&
      out[1].snippet === "" &&
      out[2].snippet === "",
    `got ${out.length} results: ${out.map((r) => r.title).join(", ")}`,
  );
}

/* 3. Attribute order must not matter. */
{
  const html = row(`<tr><td>1.</td><td>
      <a class="result-link" href="https://ordered.test/">Reordered</a>
      <td class="result-snippet">Fine.</td></td></tr>`);
  const out = parseDuckDuckGoLite(html, 5);
  check(
    "class-before-href attribute order still parses",
    out.length === 1 && out[0].url === "https://ordered.test/",
    JSON.stringify(out),
  );
}

/* 4. Ad / redirect rows are excluded. */
{
  const html = row(`<tr><td>1.</td><td>${link("https://duckduckgo.com/y.js?ad=1", "Ad")}</td></tr>
    <tr><td>2.</td><td>${link("https://bing.com/aclick?id=1", "Ad2")}</td></tr>
    <tr><td>3.</td><td>${link("https://real.test/", "Real")}</td></tr>`);
  const out = parseDuckDuckGoLite(html, 5);
  check(
    "ad/redirect rows skipped, organic kept",
    out.length === 1 && out[0].title === "Real",
    `got ${out.length}: ${out.map((r) => r.title).join(", ")}`,
  );
}

/* 5. uddg= redirect is decoded. */
{
  const html = row(`<tr><td>1.</td><td>${link(
    "//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeep.test%2Fpath%3Fq%3D1&rut=zz",
    "Deep",
  )}</td></tr>`);
  const out = parseDuckDuckGoLite(html, 5);
  check(
    "uddg= redirect decoded",
    out.length === 1 && out[0].url === "https://deep.test/path?q=1",
    JSON.stringify(out.map((r) => r.url)),
  );
}

/* 6. limit is respected. */
{
  const html = row(
    [1, 2, 3, 4, 5]
      .map((i) => `<tr><td>${link(`https://n${i}.test/`, `N${i}`)}</td></tr>`)
      .join("\n"),
  );
  const out = parseDuckDuckGoLite(html, 3);
  check("limit honoured", out.length === 3, `got ${out.length}`);
}

/* 7. Malformed markup degrades rather than crashing. */
{
  const out = parseDuckDuckGoLite("<html><body>no results here</body></html>", 5);
  check("garbage input returns empty, does not throw", out.length === 0);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  -> ${r.detail}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
