import puppeteer from "puppeteer";
import { neon } from "@neondatabase/serverless";

import { readDatabaseUrl } from "./env.mjs";

const PORT = process.argv[2] ?? "3300";
const base = `http://localhost:${PORT}`;
const sql = neon(readDatabaseUrl());

const stamp = Date.now();
const email = `probe${stamp}@example.com`;
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

// 1. Unauthenticated visitors are redirected to /login
await page.goto(base, { waitUntil: "networkidle0" });
steps.push({
  step: "unauthenticated redirect to /login",
  ok: page.url().includes("/login"),
  detail: page.url(),
});

// 2. Sign up
await page.goto(`${base}/signup`, { waitUntil: "networkidle0" });
await page.type("#name", "Probe User");
await page.type("#email", email);
await page.type("#password", password);
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await wait(2500);

steps.push({
  step: "signup lands on chat",
  ok: !page.url().includes("/signup") && !page.url().includes("/login"),
  detail: page.url(),
});

const [dbUser] = await sql`SELECT id,name,email,password_hash FROM users WHERE email=${email}`;
steps.push({ step: "user row created", ok: !!dbUser });
steps.push({
  step: "password stored hashed, not plaintext",
  ok: !!dbUser && dbUser.password_hash.includes(":") && !dbUser.password_hash.includes(password),
});

// 3. Key modal auto-opens for a fresh account
steps.push({
  step: "provider modal opens on first login",
  ok: (await text()).includes("Model Provider Gateway"),
});

// 4. Configure the fake gateway
await page.type("#baseUrl", "", { delay: 0 });
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

// Test connection button
const buttons = await page.$$("button");
for (const b of buttons) {
  const label = await page.evaluate((el) => el.textContent, b);
  if (label?.includes("Test connection")) {
    await b.click();
    break;
  }
}
await wait(2000);
steps.push({
  step: "test connection succeeds",
  ok: (await text()).includes("Connected"),
  detail: (await text()).match(/Connected[^\n]*/)?.[0],
});

// Save
for (const b of await page.$$("button")) {
  const label = await page.evaluate((el) => el.textContent, b);
  if (label?.includes("Save settings")) {
    await b.click();
    break;
  }
}
await wait(2500);

const [settings] = await sql`
  SELECT provider, base_url, api_key_cipher, api_key_last4
  FROM provider_settings WHERE user_id=${dbUser.id}`;
steps.push({ step: "provider settings saved", ok: !!settings });
steps.push({
  step: "api key encrypted at rest (not plaintext)",
  ok:
    !!settings &&
    !settings.api_key_cipher.includes("sk_omniroute_test") &&
    settings.api_key_cipher.split(":").length === 3,
  detail: settings?.api_key_cipher.slice(0, 24) + "…",
});
steps.push({
  step: "only last4 stored in clear",
  ok: settings?.api_key_last4 === "test",
});

// 5. Send a message and stream a reply
await page.click("textarea");
await page.type("textarea", "hello gateway");
await page.keyboard.press("Enter");
await wait(6000);

const afterSend = await text();
steps.push({
  step: "streamed reply rendered",
  ok: afterSend.includes("Streaming works end to end"),
});

const rows = await sql`
  SELECT m.role, m.content FROM messages m
  JOIN conversations c ON c.id=m.conversation_id
  WHERE c.user_id=${dbUser.id} ORDER BY m.created_at`;
steps.push({
  step: "both turns persisted",
  ok: rows.length === 2 && rows[0].role === "user" && rows[1].role === "assistant",
  detail: `${rows.length} rows`,
});

// 6. Reload → history restored from DB.
// Sending rewrites the URL to /c/<id>, so reload that deep link rather than
// the bare root, which intentionally opens a fresh chat.
const convoUrl = page.url();
await page.goto(convoUrl, { waitUntil: "networkidle0" });
await wait(1200);
steps.push({
  step: "history survives reload",
  ok: (await text()).includes("Streaming works end to end"),
  detail: convoUrl.replace(base, ""),
});
steps.push({
  step: "provider modal stays closed once configured",
  ok: !(await text()).includes("Model Provider Gateway"),
});

// 7. Data isolation: a second account in a clean session sees nothing
const email2 = `probe2${stamp}@example.com`;
const ctx = await browser.createBrowserContext();
const page2 = await ctx.newPage();
await page2.goto(`${base}/signup`, { waitUntil: "networkidle0" });
await page2.waitForSelector("#name", { timeout: 10000 });
await page2.type("#name", "Other User");
await page2.type("#email", email2);
await page2.type("#password", password);
await Promise.all([
  page2.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
  page2.click('button[type="submit"]'),
]);
await wait(2500);
const otherText = await page2.evaluate(() => document.body.innerText);
steps.push({
  step: "second account cannot see first account's chats",
  ok: !otherText.includes("Streaming works end to end"),
});

// cleanup
await sql`DELETE FROM users WHERE email IN (${email}, ${email2})`;

console.log(JSON.stringify({ steps, errors }, null, 2));
await browser.close();
process.exit(steps.some((s) => !s.ok) || errors.length ? 1 : 0);
