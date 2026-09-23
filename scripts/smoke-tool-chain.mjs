/**
 * Regression guard for tool-call chaining.
 *
 * 1. A follow-up that returns text AND a further tool call must execute that
 *    call and keep going — not end the turn with the interim note as the answer.
 *    (Observed as "it just stops midway": the model said "let me check the FAQ"
 *    and went silent because the call that followed was discarded.)
 * 2. Interim notes must not be concatenated onto the final saved answer.
 * 3. Every tool call in the turn must be recorded, not just the first round's.
 * 4. A model that only ever asks for more tools must hit the round cap and get
 *    an error naming the model and suggesting an action — never a silent stop.
 *
 * Needs: node scripts/fake-gateway-chain.mjs 20134 chain
 *        node scripts/fake-gateway-chain.mjs 20135 loop
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

async function run(gatewayPort, prompt) {
  const email = `chain${Date.now()}${Math.floor(performance.now())}@example.com`;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(`${base}/signup`, { waitUntil: "networkidle0" });
  await page.type("#name", "Chain");
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
  await wait(25000);

  const shown = await page.evaluate(() => document.body.innerText);
  const [u] = await sql`SELECT id FROM users WHERE email = ${email}`;
  const rows = await sql`
    SELECT m.role, m.content, m.tool_calls
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ${u.id} ORDER BY m.created_at`;
  await sql`DELETE FROM users WHERE email = ${email}`;
  await ctx.close();
  return { shown, rows };
}

// --- 1 & 2 & 3: a chained tool call must run, and the interim note must not be
//                presented as the answer.
const a = await run(20134, "itu booking online yg 80 tiket ga membatasi?");
const finalRow = a.rows.find(
  (r) => r.role === "assistant" && r.content.includes("FINAL-ANSWER-ROUND2"),
);
const fetchCall = finalRow?.tool_calls?.find((t) => t.name === "fetch_page");

steps.push({
  step: "second tool call ran and the turn reached a real answer",
  ok: !!finalRow,
});
steps.push({
  step: "interim note NOT concatenated onto the final answer",
  ok:
    !!finalRow &&
    finalRow.content.includes("FINAL-ANSWER-ROUND2") &&
    !finalRow.content.includes("Checking the FAQ"),
  detail: JSON.stringify(finalRow?.content ?? "(no final row)"),
});
steps.push({
  step: "every tool call in the turn is recorded",
  ok: Array.isArray(finalRow?.tool_calls) && finalRow.tool_calls.length === 2,
  detail: `${finalRow?.tool_calls?.length ?? 0} recorded`,
});
steps.push({
  step: "fetch_page read the page and returned its title",
  ok:
    !!fetchCall &&
    fetchCall.state === "done" &&
    fetchCall.title === "Syarat & Ketentuan",
  detail: JSON.stringify(fetchCall ?? "(no fetch call recorded)"),
});

// --- 4: a model that never answers must hit the cap and say so.
const b = await run(20135, "keep searching forever please");
steps.push({
  step: "round cap names the model",
  ok: b.shown.includes("chain-model"),
});
steps.push({
  step: "round cap suggests an action",
  ok: /turn off web search|try asking again/i.test(b.shown),
});
steps.push({
  step: "no silent stop — an interim note is never saved as the answer",
  ok: !b.rows.some(
    (r) => r.role === "assistant" && r.content.trim().length > 0,
  ),
});

await browser.close();
console.log(JSON.stringify({ steps }, null, 2));
process.exit(steps.some((s) => !s.ok) ? 1 : 0);
