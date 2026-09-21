import puppeteer from "puppeteer";
import { neon } from "@neondatabase/serverless";

import { readDatabaseUrl } from "./env.mjs";

const PORT = process.argv[2] ?? "3201";
const base = `http://localhost:${PORT}`;
const sql = neon(readDatabaseUrl());

const marker = `persistence probe ${process.pid}`;
const steps = [];
const errors = [];

const count = async () =>
  (await sql`SELECT count(*)::int AS n FROM messages`)[0].n;

const before = await count();

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`CONSOLE: ${m.text()}`);
});

await page.setViewport({ width: 1440, height: 900 });
await page.goto(base, { waitUntil: "networkidle0" });

steps.push({
  step: "server-rendered seed data from Neon",
  ok: await page.evaluate(() =>
    document.body.innerText.includes("Streaming SSE in Next.js route handlers"),
  ),
});

// Start a new chat, then send a uniquely identifiable message.
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => b.textContent?.includes("New chat"))
    ?.click();
});
await new Promise((r) => setTimeout(r, 400));

await page.click("textarea");
await page.type("textarea", marker);
await page.keyboard.press("Enter");

// Wait for the server action + revalidate round trip.
await new Promise((r) => setTimeout(r, 6000));

const after = await count();
steps.push({
  step: "two rows written (user + assistant)",
  ok: after === before + 2,
  detail: `${before} -> ${after}`,
});

const [row] = await sql`
  SELECT m.content, m.role, c.title
  FROM messages m JOIN conversations c ON c.id = m.conversation_id
  WHERE m.content = ${marker}`;
steps.push({ step: "user message persisted with conversation", ok: !!row });

const [reply] = await sql`
  SELECT m.content FROM messages m
  WHERE m.role = 'assistant'
  ORDER BY m.created_at DESC LIMIT 1`;
steps.push({
  step: "assistant reply persisted",
  ok: !!reply && reply.content.includes("persisted in Postgres"),
});

// Hard reload: proves it came from the database, not client state.
await page.goto(base, { waitUntil: "networkidle0" });
steps.push({
  step: "survives full page reload",
  ok: await page.evaluate(
    (m) => document.body.innerText.includes(m),
    marker,
  ),
});

// Clean up the probe rows so the seeded data stays tidy.
if (row) {
  await sql`DELETE FROM conversations WHERE title = ${row.title}`;
}
const cleaned = await count();
steps.push({
  step: "probe rows cleaned up",
  ok: cleaned === before,
  detail: `${after} -> ${cleaned}`,
});

console.log(JSON.stringify({ steps, errors }, null, 2));
await browser.close();
process.exit(steps.some((s) => !s.ok) || errors.length ? 1 : 0);
