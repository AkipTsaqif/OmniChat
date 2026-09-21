import puppeteer from "puppeteer";
import { neon } from "@neondatabase/serverless";

import { readDatabaseUrl } from "./env.mjs";

const PORT = process.argv[2] ?? "3423";
const base = `http://localhost:${PORT}`;
const sql = neon(readDatabaseUrl());

const email = `models${Date.now()}@example.com`;
const password = "correct horse battery";
const steps = [];
const errors = [];

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`CONSOLE: ${m.text()}`);
});
await page.setViewport({ width: 1440, height: 900 });
const text = () => page.evaluate(() => document.body.innerText);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Sign up -> no provider configured yet.
await page.goto(`${base}/signup`, { waitUntil: "networkidle0" });
await page.type("#name", "Models Probe");
await page.type("#email", email);
await page.type("#password", password);
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await wait(2500);

// Dismiss the auto-opened modal to inspect what is behind it.
await page.keyboard.press("Escape");
await wait(600);

const before = await text();
steps.push({
  step: "no invented model names anywhere",
  ok:
    !before.includes("Claude Sonnet 4.5") &&
    !before.includes("GPT-5") &&
    !before.includes("Gemini 3 Pro"),
});
steps.push({
  step: "picker shows 'No models' before setup",
  ok: before.includes("No models"),
});
steps.push({
  step: "empty state asks to connect a provider",
  ok: before.includes("Connect a provider"),
});
steps.push({
  step: "composer placeholder reflects no provider",
  ok: await page.evaluate(() =>
    document.querySelector("textarea")?.placeholder.includes("Connect a provider"),
  ),
});

// Configure the fake gateway.
const [dbUser] = await sql`SELECT id FROM users WHERE email=${email}`;
await page.reload({ waitUntil: "networkidle0" });
await wait(800);
await page.evaluate(() => {
  const el = document.querySelector("#baseUrl");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(el, "http://localhost:20128/v1");
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.type("#apiKey", "sk_omniroute_test");
for (const b of await page.$$("button")) {
  const label = await page.evaluate((el) => el.textContent, b);
  if (label?.includes("Save and start chatting")) {
    await b.click();
    break;
  }
}
await wait(3000);

const after = await text();
steps.push({
  step: "real gateway models now listed",
  ok: after.includes("claude-sonnet-4.5") || after.includes("gpt-5.2"),
  detail: after.match(/claude-sonnet-4\.5|gpt-5\.2/)?.[0],
});
steps.push({
  step: "'No models' gone once configured",
  ok: !after.includes("No models"),
});

// The model actually sent must be one the gateway offers.
await page.click("textarea");
await page.type("textarea", "which model are you");
await page.keyboard.press("Enter");
await wait(6000);

const [row] = await sql`
  SELECT m.model_id FROM messages m
  JOIN conversations c ON c.id=m.conversation_id
  WHERE c.user_id=${dbUser.id} AND m.role='assistant' LIMIT 1`;
steps.push({
  step: "persisted model id came from the gateway",
  ok: !!row && ["claude-sonnet-4.5", "gpt-5.2"].includes(row.model_id),
  detail: row?.model_id,
});

await sql`DELETE FROM users WHERE email=${email}`;
console.log(JSON.stringify({ steps, errors }, null, 2));
await browser.close();
process.exit(steps.some((s) => !s.ok) || errors.length ? 1 : 0);
