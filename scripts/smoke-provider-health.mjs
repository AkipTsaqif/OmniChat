/**
 * Verifies the app distinguishes provider failure modes instead of always
 * claiming "no models available".
 *
 * Needs a mock gateway on 20128 (scripts/fake-gateway.mjs).
 */
import puppeteer from "puppeteer";
import { neon } from "@neondatabase/serverless";

import { readDatabaseUrl } from "./env.mjs";

const PORT = process.argv[2] ?? "3520";
const base = `http://localhost:${PORT}`;
const sql = neon(readDatabaseUrl());
const steps = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1440, height: 900 });
const text = () => page.evaluate(() => document.body.innerText);

const email = `health${Date.now()}@example.com`;
await page.goto(`${base}/signup`, { waitUntil: "networkidle0" });
await page.type("#name", "Health Probe");
await page.type("#email", email);
await page.type("#password", "correct horse battery");
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await wait(2500);

// Configure against the working mock gateway.
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
  const label = await page.evaluate((el) => el.innerText.trim(), b);
  if (/^save settings$/i.test(label)) {
    await b.click();
    break;
  }
}
await wait(3000);

const [user] = await sql`SELECT id FROM users WHERE email=${email}`;
steps.push({
  step: "healthy gateway lists models",
  ok: !(await text()).includes("No models"),
});

// --- Case 1: gateway saved but unreachable (the restart scenario) ---
await sql`
  UPDATE provider_settings SET base_url = 'http://localhost:29999/v1'
  WHERE user_id = ${user.id}`;
await page.goto(base, { waitUntil: "networkidle0" });
await wait(2000);
const unreachable = await text();

steps.push({
  step: "unreachable gateway is named as such",
  ok: unreachable.includes("Gateway unreachable"),
});
steps.push({
  step: "unreachable does NOT claim the key is missing",
  ok: !unreachable.includes("Add your API key"),
});
steps.push({
  step: "offers a retry instead of forcing re-entry",
  ok: unreachable.includes("Retry connection"),
});
steps.push({
  step: "settings modal does not auto-open on a transient outage",
  ok: !unreachable.includes("Model Provider Gateway"),
});

// --- Case 2: stored key cannot be decrypted (encryption key changed) ---
await sql`
  UPDATE provider_settings
  SET base_url = 'http://localhost:20128/v1',
      api_key_cipher = 'deadbeef:deadbeef:deadbeef'
  WHERE user_id = ${user.id}`;
await page.goto(base, { waitUntil: "networkidle0" });
await wait(2000);
const undecryptable = await text();

steps.push({
  step: "undecryptable key is diagnosed precisely",
  ok: undecryptable.includes("cannot be read") ||
      undecryptable.includes("decrypted"),
});
steps.push({
  step: "undecryptable key prompts for re-entry",
  ok: undecryptable.includes("Model Provider Gateway") ||
      undecryptable.includes("Provider settings"),
});

// --- Case 3: recovery without re-entering the key ---
await sql`DELETE FROM provider_settings WHERE user_id = ${user.id}`;
await page.goto(base, { waitUntil: "networkidle0" });
await wait(1500);
steps.push({
  step: "no provider still shows the original setup pitch",
  ok: (await text()).includes("Connect a provider"),
});

await sql`DELETE FROM users WHERE email=${email}`;
await browser.close();
console.log(JSON.stringify({ steps }, null, 2));
process.exit(steps.some((s) => !s.ok) ? 1 : 0);
