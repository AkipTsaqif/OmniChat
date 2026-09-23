/**
 * Regression probe for the "Provider returned empty content" failure on the
 * web-search tool follow-up.
 *
 * Reproduces the two shapes the route now uses and measures them against the
 * REAL configured gateway: the assistant(tool_calls) -> tool round trip, and
 * the flattened form that passes the results as a plain message. On OmniRoute's
 * Anthropic backend the round trip measured 0/4-0/6 and the flattened form
 * 6/6, which is why route.ts falls back to it.
 *
 * Costs real API calls. Prints only diagnostics — never message content.
 *
 * Run with:  bun scripts/check-tool-followup.ts [modelId] [trials]
 */
import { createDecipheriv, scryptSync } from "node:crypto";
import fs from "node:fs";

import { neon } from "@neondatabase/serverless";

import { readDatabaseUrl } from "./env.mjs";
import { searchWeb } from "../src/lib/tools/web-search";

const MODEL = process.argv[2] ?? "claude/claude-sonnet-5";
const TRIALS = Number(process.argv[3] ?? 6);
const sql = neon(readDatabaseUrl());

function loadEnv(name: string): string {
  const raw = fs.readFileSync(".env.local", "utf8");
  const m = raw.match(new RegExp(`^\\s*${name}\\s*=\\s*['"]?([^'"\\r\\n]+)`, "m"));
  if (!m) throw new Error(`${name} not found in .env.local`);
  return m[1];
}
function decryptSecret(payload: string): string {
  const key = scryptSync(loadEnv("OMNICHAT_ENCRYPTION_KEY"), "omnichat.provider.key", 32);
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([d.update(Buffer.from(dataHex, "hex")), d.final()]).toString("utf8");
}

const [settings] = await sql`SELECT base_url, api_key_cipher FROM provider_settings LIMIT 1`;
const apiKey = decryptSecret(settings.api_key_cipher);
const BASE = String(settings.base_url).replace(/\/+$/, "");

const userRows = (await sql`SELECT system_prompt FROM users LIMIT 1`.catch(
  () => [{ system_prompt: null }],
)) as { system_prompt: string | null }[];
const sys = (userRows[0]?.system_prompt ?? "").trim();

const outcome = await searchWeb("latest indonesia news", 5, { preferred: "auto" });
const results = outcome.ok ? outcome.results : [];
const resultsJson = JSON.stringify(results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })));
const toolId = "toolu_01RealProbeId00000000000000000";

console.log(`model=${MODEL} trials=${TRIALS} systemPrompt=${sys ? sys.length : 0}c results=${results.length}\n`);

const head: { role: string; content: string }[] = [];
if (sys) head.push({ role: "system", content: sys });
head.push({ role: "user", content: "latest indonesia news" });

async function attempt(payload: Record<string, unknown>) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  let text = "";
  const errors: { message?: string }[] = [];
  if (res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const p = t.slice(5).trim();
        if (p === "[DONE]") continue;
        try {
          const j: {
            error?: { message?: string };
            choices?: { delta?: { content?: string } }[];
          } = JSON.parse(p);
          if (j.error) errors.push(j.error);
          const c = j.choices?.[0];
          if (typeof c?.delta?.content === "string") text += c.delta.content;
        } catch { /* keep-alive */ }
      }
    }
  }
  return { ok: res.ok && text.trim().length > 0 && errors.length === 0, text, errors, status: res.status };
}

const roundTrip = (content: string | null | undefined) => ({
  model: MODEL,
  messages: [
    ...head,
    {
      role: "assistant",
      ...(content === undefined ? {} : { content }),
      tool_calls: [
        { id: toolId, type: "function", function: { name: "web_search", arguments: `{"query":"latest indonesia news"}` } },
      ],
    },
    { role: "tool", tool_call_id: toolId, content: resultsJson },
  ],
  stream: true,
  reasoning_effort: "medium",
});

const candidates: { label: string; note: string; build: () => Record<string, unknown> }[] = [
  {
    label: "A round-trip (current route.ts)",
    note: "control — assistant tool_calls + tool result",
    build: () => roundTrip("\n\n"),
  },
  {
    label: "B round-trip, content: ''",
    note: "empty string rather than null — avoids the 400 path",
    build: () => roundTrip(""),
  },
  {
    label: "C FLATTENED (results as plain message)",
    note: "no tool_calls anywhere — never exercises the broken translation",
    build: () => ({
      model: MODEL,
      messages: [
        ...head,
        {
          role: "user",
          content:
            `Web search results for "latest indonesia news":\n${resultsJson}\n\n` +
            `Answer the user's question using these results. Cite sources by URL. If the results are insufficient, say so plainly.`,
        },
      ],
      stream: true,
      reasoning_effort: "medium",
    }),
  },
  {
    label: "D FLATTENED, keeping the assistant turn as text",
    note: "preserves conversational continuity without tool_calls",
    build: () => ({
      model: MODEL,
      messages: [
        ...head,
        { role: "assistant", content: "Let me look that up for you." },
        {
          role: "user",
          content: `Web search results:\n${resultsJson}\n\nAnswer using these, citing sources.`,
        },
      ],
      stream: true,
      reasoning_effort: "medium",
    }),
  },
  {
    label: "E FLATTENED + max_tokens",
    note: "belt and braces",
    build: () => ({
      model: MODEL,
      messages: [
        ...head,
        {
          role: "user",
          content: `Web search results:\n${resultsJson}\n\nAnswer using these, citing sources.`,
        },
      ],
      stream: true,
      reasoning_effort: "medium",
      max_tokens: 8192,
    }),
  },
];

const summary: string[] = [];
for (const c of candidates) {
  let pass = 0;
  const lens: number[] = [];
  const errs = new Set<string>();
  for (let i = 1; i <= TRIALS; i++) {
    const r = await attempt(c.build());
    lens.push(r.text.length);
    if (r.ok) pass++;
    else errs.add(r.errors[0]?.message ?? `status=${r.status} empty`);
  }
  const rate = Math.round((pass / TRIALS) * 100);
  console.log(`[${String(rate).padStart(3)}%] ${c.label}`);
  console.log(`        ${c.note}`);
  console.log(`        textLen per trial: ${lens.join(", ")}`);
  if (errs.size) console.log(`        failures: ${[...errs].join(" | ")}`);
  summary.push(`${c.label.padEnd(46)} ${pass}/${TRIALS} (${rate}%)`);
}

console.log("\n" + "=".repeat(64) + "\nSUMMARY\n" + "=".repeat(64));
for (const s of summary) console.log("  " + s);
