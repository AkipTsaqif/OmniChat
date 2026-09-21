/**
 * Regression guard: a flaky tool follow-up must be retried, and a persistently
 * empty one must name the model instead of saying "No response generated".
 *
 * Needs: node scripts/fake-gateway-flaky.mjs 20132 2   (recovers on 3rd)
 *        node scripts/fake-gateway-flaky.mjs 20133 99  (never recovers)
 */
import puppeteer from "puppeteer";
import { neon } from "@neondatabase/serverless";
import { readDatabaseUrl } from "./env.mjs";

const base = `http://localhost:${process.argv[2] ?? 3550}`;
const sql = neon(readDatabaseUrl());
const wait = ms => new Promise(r => setTimeout(r, ms));
const steps = [];
const browser = await puppeteer.launch({ headless:"new", args:["--no-sandbox"] });

async function run(gatewayPort) {
  const email = `retry${Date.now()}${Math.floor(performance.now())}@example.com`;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width:1440, height:900 });

  await page.goto(`${base}/signup`,{waitUntil:"networkidle0"});
  await page.type("#name","Retry"); await page.type("#email",email);
  await page.type("#password","correct horse battery");
  await Promise.all([page.waitForNavigation({waitUntil:"networkidle0"}).catch(()=>{}),page.click('button[type="submit"]')]);
  await wait(2500);

  await page.evaluate((p) => {
    const el = document.querySelector("#baseUrl");
    const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value");
    d.set.call(el, "http://localhost:" + p + "/v1");
    el.dispatchEvent(new Event("input",{bubbles:true}));
  }, gatewayPort);
  await page.type("#apiKey","sk_omniroute_test");
  for (const b of await page.$$("button")) {
    const l = await page.evaluate(e=>e.innerText.trim(), b);
    if (/^save settings$/i.test(l)) { await b.click(); break; }
  }
  await wait(3000);

  await page.click("textarea");
  await page.type("textarea","latest indonesia news");
  await page.keyboard.press("Enter");
  await wait(20000);

  const shown = await page.evaluate(()=>document.body.innerText);
  const [u] = await sql`SELECT id FROM users WHERE email=${email}`;
  const rows = await sql`
    SELECT m.role, m.content FROM messages m
    JOIN conversations c ON c.id=m.conversation_id
    WHERE c.user_id=${u.id} ORDER BY m.created_at`;
  await sql`DELETE FROM users WHERE email=${email}`;
  await ctx.close();
  return { shown, rows };
}

// Recovers on the 3rd attempt.
const a = await run(20132);
steps.push({
  step: "flaky follow-up recovered by retry",
  ok: a.rows.some(r => r.role === "assistant" && r.content.includes("RECOVERED")),
});
steps.push({
  step: "recovered answer has no error banner",
  ok: !a.shown.includes("No response generated"),
});

// Never recovers.
const b = await run(20133);
steps.push({
  step: "persistent failure names the model",
  ok: b.shown.includes("flaky-sonnet"),
});
steps.push({
  step: "persistent failure suggests an action",
  ok: /try another|turn off web search/i.test(b.shown),
});
steps.push({
  step: "no generic 'No response generated'",
  ok: !b.shown.includes("No response generated from the model"),
});

await browser.close();
console.log(JSON.stringify({ steps }, null, 2));
process.exit(steps.some(s=>!s.ok) ? 1 : 0);
