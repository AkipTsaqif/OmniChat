/**
 * End-to-end guard for cross-chat memory.
 *
 * fake-gateway-echo.mjs answers with the request's system message, so whether a
 * memory was injected is directly readable from the saved reply — absence is
 * just as observable as presence.
 *
 * Covers the three promises the feature is built on:
 *   capture is opt-in, injection is scoped and disclosed, forgetting is easy —
 * plus per-user isolation, which must never leak between accounts.
 *
 * Needs: node scripts/fake-gateway-echo.mjs 20140
 */
import puppeteer from "puppeteer";
import { neon } from "@neondatabase/serverless";

import { readDatabaseUrl } from "./env.mjs";

const base = `http://localhost:${process.argv[2] ?? 3000}`;
const sql = neon(readDatabaseUrl());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox"],
});

const check = (step, ok, detail = "") => steps.push({ step, ok, detail });

async function signUp(name) {
  const email = `mem${Date.now()}${Math.floor(performance.now())}@example.com`;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(`${base}/signup`, { waitUntil: "networkidle0" });
  await page.type("#name", name);
  await page.type("#email", email);
  await page.type("#password", "correct horse battery");
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
    setter.call(el, "http://localhost:20140/v1");
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

  const [row] = await sql`SELECT id FROM users WHERE email = ${email}`;
  return { ctx, page, userId: row.id };
}

async function send(page, text) {
  await page.click("textarea");
  await page.type("textarea", text);
  await page.keyboard.press("Enter");
  await wait(11000);
}

const memories = async (userId) =>
  await sql`
    SELECT id, content, status, conversation_id
    FROM memories WHERE user_id = ${userId} ORDER BY created_at`;

/** The echo gateway writes the system message here, so this is the prompt. */
const lastReply = async (userId) => {
  const rows = await sql`
    SELECT m.content FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ${userId} AND m.role = 'assistant'
    ORDER BY m.created_at DESC LIMIT 1`;
  return rows[0]?.content ?? "";
};

const FACT = "Prefers bullet points.";

const a = await signUp("MemA");

// 1. Capture is opt-in: a turn must not create anything by itself.
await send(a.page, "I like answers in bullet points");
check(
  "a turn alone saves nothing",
  (await memories(a.userId)).length === 0,
  `${(await memories(a.userId)).length} rows`,
);

// 2. Capture via the bookmark beside thumbs-down. The text is typed by the
//    user — nothing is written until Save.
await a.page.click('button[aria-label="Remember"]');
await wait(600);
await a.page.type(
  'textarea[placeholder*="One standalone sentence"]',
  FACT,
);
for (const button of await a.page.$$("button")) {
  const label = await a.page.evaluate((el) => el.innerText.trim(), button);
  if (/^save memory$/i.test(label)) {
    await button.click();
    break;
  }
}
await wait(2500);

const saved = await memories(a.userId);
check("saving is a deliberate click", saved.length === 1, `${saved.length} rows`);
check(
  "the saved text is exactly what the user typed",
  saved[0]?.content === FACT,
  JSON.stringify(saved[0]?.content ?? null),
);

// 3. Injection: the saved fact reaches the gateway on a later turn.
await send(a.page, "what is the weather like?");
const injected = await lastReply(a.userId);
check(
  "memory is injected into a later conversation turn",
  injected.includes(FACT),
  `${injected.length} chars`,
);

// 4. Scope. Uncheck "Apply to all conversations" and it must stop reaching a
//    different conversation.
await sql`UPDATE memories SET conversation_id = (
  SELECT id FROM conversations WHERE user_id = ${a.userId} ORDER BY created_at LIMIT 1
) WHERE user_id = ${a.userId}`;

for (const button of await a.page.$$("button")) {
  const label = await a.page.evaluate((el) => el.innerText.trim(), button);
  if (/^new chat$/i.test(label)) {
    await button.click();
    break;
  }
}
await wait(1500);
await send(a.page, "and tomorrow?");
const scopedOut = await lastReply(a.userId);
check(
  "a scoped memory does not reach another conversation",
  !scopedOut.includes(FACT),
);

await sql`UPDATE memories SET conversation_id = NULL WHERE user_id = ${a.userId}`;
await send(a.page, "and the day after?");
check(
  "a global memory reaches every conversation",
  (await lastReply(a.userId)).includes(FACT),
);

// 5. Clean room: the per-conversation switch must stop injection while the
//    memory stays active.
await a.page.click('button[aria-label="Memory"]');
await wait(2000);
await send(a.page, "remind me what I like?");
const cleanRoom = await lastReply(a.userId);
const stillActive = (await memories(a.userId)).every((m) => m.status === "active");
check(
  "memory off for a conversation stops injection",
  !cleanRoom.includes(FACT),
);
check("the memory stays active while off", stillActive);

// 6. Isolation: another account must never see it.
const b = await signUp("MemB");
await send(b.page, "what does the user prefer?");
check(
  "another account never receives this user's memory",
  !(await lastReply(b.userId)).includes(FACT),
);

// 7. Forgetting: deactivate stops injection but keeps the row listed.
await a.page.click('button[aria-label="Memory"]'); // back on
await wait(1500);
await sql`UPDATE memories SET status = 'archived' WHERE user_id = ${a.userId}`;
await send(a.page, "one more time?");
const forgotten = await lastReply(a.userId);
const stillListed = (await memories(a.userId)).length === 1;
check("a deactivated memory stops being injected", !forgotten.includes(FACT));
check("a deactivated memory is still listed, not deleted", stillListed);

await sql`DELETE FROM users WHERE email LIKE 'mem%@example.com'`;
await a.ctx.close();
await b.ctx.close();
await browser.close();

console.log(JSON.stringify({ steps }, null, 2));
process.exit(steps.some((s) => !s.ok) ? 1 : 0);
