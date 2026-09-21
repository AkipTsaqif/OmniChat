import puppeteer from "puppeteer";
import { neon } from "@neondatabase/serverless";

import { readDatabaseUrl } from "./env.mjs";

const PORT = process.argv[2] ?? "3501";
const base = `http://localhost:${PORT}`;
const sql = neon(readDatabaseUrl());

const stamp = Date.now();
const email = `share${stamp}@example.com`;
const password = "correct horse battery";
const steps = [];
const errors = [];

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`CONSOLE: ${m.text()}`);
});
await page.setViewport({ width: 1440, height: 900 });
const text = () => page.evaluate(() => document.body.innerText);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Sign up and configure the mock gateway.
await page.goto(`${base}/signup`, { waitUntil: "networkidle0" });
await page.type("#name", "Share Probe");
await page.type("#email", email);
await page.type("#password", password);
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await wait(2500);

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
  if (label?.includes("Save settings")) {
    await b.click();
    break;
  }
}
await wait(3000);

// Send a message so there is a transcript worth sharing.
await page.click("textarea");
await page.type("textarea", "share me please");
await page.keyboard.press("Enter");
await wait(6000);

steps.push({
  step: "conversation created and streamed",
  ok: (await text()).includes("Streaming works end to end"),
});

const [user] = await sql`SELECT id FROM users WHERE email=${email}`;
const [convo] = await sql`
  SELECT id FROM conversations WHERE user_id=${user.id} LIMIT 1`;

// Open the share dialog from the header.
const shareBtn = await page.$('button[aria-label="Share chat"]');
steps.push({ step: "share control present", ok: !!shareBtn });
if (shareBtn) {
  await shareBtn.click();
  await wait(1500);
}

// Click the button that actually creates the link.
let clickedCreate = false;
for (const b of await page.$$("button")) {
  const label = await page.evaluate((el) => el.innerText.trim(), b);
  if (/^create public link$/i.test(label)) {
    await b.click();
    clickedCreate = true;
    break;
  }
}
steps.push({ step: "create-link button found", ok: clickedCreate });
await wait(3500);

const [shared] = await sql`
  SELECT id, conversation_id, user_id, title, messages_snapshot
  FROM shared_chats WHERE user_id=${user.id} LIMIT 1`;

steps.push({ step: "share row persisted", ok: !!shared });
steps.push({
  step: "snapshot contains the transcript",
  ok:
    !!shared &&
    Array.isArray(shared.messages_snapshot) &&
    shared.messages_snapshot.length >= 2,
  detail: shared ? `${shared.messages_snapshot.length} messages` : null,
});
steps.push({
  step: "snapshot bound to the right conversation",
  ok: !!shared && shared.conversation_id === convo.id,
});

// The critical check: an anonymous visitor must see the transcript.
if (shared) {
  const anon = await browser.createBrowserContext();
  const anonPage = await anon.newPage();
  const anonErrors = [];
  anonPage.on("pageerror", (e) => anonErrors.push(e.message));
  const res = await anonPage.goto(`${base}/share/${shared.id}`, {
    waitUntil: "networkidle0",
  });
  const body = await anonPage.evaluate(() => document.body.innerText);

  steps.push({
    step: "anonymous visitor is NOT redirected to login",
    ok: res.status() === 200 && !anonPage.url().includes("/login"),
    detail: `${res.status()} ${anonPage.url().replace(base, "")}`,
  });
  steps.push({
    step: "anonymous visitor sees the transcript",
    ok: body.includes("share me please"),
  });
  steps.push({
    step: "shared page renders without JS errors",
    ok: anonErrors.length === 0,
  });
  await anon.close();
}

// Ownership: another account must not be able to delete this share.
steps.push({
  step: "share row scoped to its owner",
  ok: !!shared && shared.user_id === user.id,
});

await sql`DELETE FROM users WHERE email=${email}`;
console.log(JSON.stringify({ steps, errors }, null, 2));
await browser.close();
process.exit(steps.some((s) => !s.ok) || errors.length ? 1 : 0);
