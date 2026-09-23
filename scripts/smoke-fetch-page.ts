/**
 * Offline regression guard for src/lib/tools/fetch-page.ts.
 *
 * Covers the HTML -> text extractor and the SSRF guard. No network, no API
 * calls, no database. Run with:  bun scripts/smoke-fetch-page.ts
 */
import { assertFetchable, extractReadable } from "../src/lib/tools/fetch-page";

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") =>
  results.push({ name, ok, detail });

/* ----------------------------- extractor ----------------------------- */

{
  const html = `<!doctype html><html><head>
    <title>  FAQ &amp; Syarat  </title>
    <style>.x{color:red}</style>
    <script>alert(1)</script>
    </head><body>
      <nav>Home | About | Contact</nav>
      <h1>Pertanyaan Umum</h1>
      <p>Booking online untuk 80 tiket tidak membatasi pembelian OTS.</p>
      <p>Syarat &amp; ketentuan berlaku.</p>
    </body></html>`;
  const { title, text } = extractReadable(html);
  check(
    "title decoded and trimmed",
    title === "FAQ & Syarat",
    JSON.stringify(title),
  );
  check(
    "script/style stripped, prose kept",
    text.includes("Booking online untuk 80 tiket") &&
      !text.includes("alert(1)") &&
      !text.includes("color:red"),
  );
  check(
    "entities decoded and paragraphs separated",
    text.includes("Syarat & ketentuan berlaku.") &&
      text.includes("\n"),
  );
}

{
  const { text } = extractReadable(
    "<p>one</p><p>two</p><div>three</div><br>four",
  );
  check(
    "block boundaries become newlines",
    text.split("\n").length >= 3,
    JSON.stringify(text),
  );
}

{
  const long = `<p>${"word ".repeat(5000)}</p>`;
  const { text, title } = extractReadable(long);
  check(
    "very long input is bounded by the extractor",
    text.length <= 40_000 && title === "",
    `${text.length} chars`,
  );
}

{
  const { text } = extractReadable("<html><body></body></html>");
  check("empty body yields empty text, does not throw", text === "");
}

/* ------------------------------ SSRF guard ---------------------------- */

check(
  "http/https accepted",
  (() => {
    try {
      return (
        assertFetchable("https://example.com/faq") === "https://example.com/faq"
      );
    } catch {
      return false;
    }
  })(),
);

const rejects = (url: string) => {
  try {
    assertFetchable(url);
    return false;
  } catch {
    return true;
  }
};

check("javascript: scheme blocked", rejects("javascript:alert(1)"));
check("file: scheme blocked", rejects("file:///etc/passwd"));
check("data: scheme blocked", rejects("data:text/html,hi"));
check("relative URL blocked", rejects("/faq"));
check(
  "cloud metadata endpoint blocked",
  rejects("http://169.254.169.254/latest/meta-data/"),
);
check(
  "GCP metadata host blocked",
  rejects("http://metadata.google.internal/computeMetadata/v1/"),
);

{
  const before = process.env.OMNICHAT_BLOCK_PRIVATE_FETCH;
  process.env.OMNICHAT_BLOCK_PRIVATE_FETCH = "1";
  const blocked =
    rejects("http://localhost:3000/") &&
    rejects("http://127.0.0.1:5432/") &&
    rejects("http://10.0.0.5/") &&
    rejects("http://192.168.1.1/") &&
    rejects("http://nas.local/");
  process.env.OMNICHAT_BLOCK_PRIVATE_FETCH = before;
  check(
    "OMNICHAT_BLOCK_PRIVATE_FETCH=1 blocks private/loopback hosts",
    blocked,
  );
}

{
  delete process.env.OMNICHAT_BLOCK_PRIVATE_FETCH;
  check(
    "localhost stays readable by default (self-hosted app)",
    !rejects("http://localhost:20128/v1"),
  );
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  -> ${r.detail}`}`,
  );
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
