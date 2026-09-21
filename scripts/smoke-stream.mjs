/**
 * Regression guard for the streaming/tool-calling path.
 *
 * 1. Tool-call preamble must not be concatenated onto the final answer.
 * 2. Pressing stop must persist the partial reply, not discard it.
 *
 * Requires the two mock gateways:
 *   node scripts/fake-gateway-tools.mjs 20129
 *   node scripts/fake-gateway-slow.mjs 20130
 */
import puppeteer from "puppeteer";
import { neon } from "@neondatabase/serverless";

import { readDatabaseUrl } from "./env.mjs";

const PORT = process.argv[2] ?? "3511";
const base = `http://localhost:${PORT}`;
const sql = neon(readDatabaseUrl());
const steps = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });

async function session(gatewayPort, prompt, { stopAfterMs } = {}) {
  const email = `stream${Date.now()}${Math.floor(performance.now())}@example.com`;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(`${base}/signup`, { waitUntil: "networkidle0" });
  await page.type("#name", "Stream Probe");
  await page.type("#email", email);
  await page.type("#password", "correct horse battery");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await wait(2500);

  await page.evaluate((p) => {
    const el = document.querySelector("#baseUrl");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(el, `http://localhost:${p}/v1`);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, gatewayPort);
  await page.type("#apiKey", "sk_omniroute_test");
  for (const b of await page.$$("button")) {
    const label = await page.evaluate((el) => el.innerText.trim(), b);
    if (/^save settings$/i.test(label)) {
      await b.click();
      break;
    }
  }
  await wait(3000);

  await page.click("textarea");
  await page.type("textarea", prompt);
  await page.keyboard.press("Enter");

  if (stopAfterMs) {
    await wait(stopAfterMs);
    const stop = await page.$('button[aria-label="Stop generating"]');
    if (stop) await stop.click();
    await wait(3000);
  } else {
    await wait(8000);
  }

  const [user] = await sql`SELECT id FROM users WHERE email=${email}`;
  const rows = await sql`
    SELECT m.role, m.content, m.tool_calls
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ${user.id} ORDER BY m.created_at`;

  const convoUrl = page.url();
  await page.goto(convoUrl, { waitUntil: "networkidle0" });
  await wait(1200);
  const rendered = await page.evaluate(() => document.body.innerText);

  await sql`DELETE FROM users WHERE email=${email}`;
  await ctx.close();
  return { rows, rendered };
}

// 1. Tool calling: preamble must not leak into the saved answer.
const tools = await session(20129, "what is the weather");
const assistant = tools.rows.find((r) => r.role === "assistant");
steps.push({
  step: "tool-call reply persisted",
  ok: !!assistant,
});
steps.push({
  step: "preamble NOT concatenated onto final answer",
  ok: !!assistant && !assistant.content.includes("Let me look that up."),
  detail: assistant?.content ?? null,
});
steps.push({
  step: "final answer present",
  ok: !!assistant?.content.includes("FINAL-ANSWER"),
});
steps.push({
  step: "tool call recorded on the message",
  ok: Array.isArray(assistant?.tool_calls) && assistant.tool_calls.length === 1,
});

// 2. Abort: partial reply must survive.
const stopped = await session(20130, "stream something long", {
  stopAfterMs: 2500,
});
const partial = stopped.rows.find((r) => r.role === "assistant");
steps.push({
  step: "stop persists the partial reply",
  ok: !!partial && partial.content.includes("TOKEN"),
  detail: partial ? `${partial.content.length} chars` : "no assistant row",
});
steps.push({
  step: "partial reply survives reload",
  ok: stopped.rendered.includes("TOKEN"),
});

await browser.close();
console.log(JSON.stringify({ steps }, null, 2));
process.exit(steps.some((s) => !s.ok) ? 1 : 0);
