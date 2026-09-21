/**
 * Regression guard: a gateway that reports failure *inside* a 200 SSE body
 * must surface its reason, and that error must clear on the next success.
 *
 * Needs: node scripts/fake-gateway-errorframe.mjs 20131
 *        node scripts/fake-gateway.mjs 20128
 */
import puppeteer from "puppeteer";
import { neon } from "@neondatabase/serverless";
import { readDatabaseUrl } from "./env.mjs";

const base = `http://localhost:${process.argv[2] ?? 3541}`;
const sql = neon(readDatabaseUrl());
const email = `gwerr${Date.now()}@example.com`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const steps = [];

const browser = await puppeteer.launch({ headless:"new", args:["--no-sandbox"] });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
const text = () => page.evaluate(() => document.body.innerText);

async function setGateway(port) {
  // Make sure the settings dialog is actually open before touching fields.
  if (!(await page.$("#baseUrl"))) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        /provider settings|connect a provider|add your api key|omniroute|model provider/i.test(
          b.innerText,
        ),
      );
      btn?.click();
    });
    await wait(1500);
  }
  await page.waitForSelector("#baseUrl", { timeout: 10000 });

  await page.evaluate((p) => {
    const el = document.querySelector("#baseUrl");
    const desc = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    );
    desc.set.call(el, "http://localhost:" + p + "/v1");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, port);
  const keyField = await page.$("#apiKey");
  await keyField.click({ clickCount: 3 });
  await page.type("#apiKey","sk_omniroute_test");
  for (const b of await page.$$("button")) {
    const l = await page.evaluate(e=>e.innerText.trim(), b);
    if (/^save settings$/i.test(l)) { await b.click(); break; }
  }
  await wait(3000);
}

await page.goto(`${base}/signup`,{waitUntil:"networkidle0"});
await page.type("#name","GwErr"); await page.type("#email",email);
await page.type("#password","correct horse battery");
await Promise.all([page.waitForNavigation({waitUntil:"networkidle0"}).catch(()=>{}),page.click('button[type="submit"]')]);
await wait(2500);

// Gateway that fails inside a 200 body.
await setGateway(20131);
await page.click("textarea"); await page.type("textarea","hello"); await page.keyboard.press("Enter");
await wait(7000);

const failed = await text();
steps.push({
  step: "gateway reason surfaced verbatim",
  ok: failed.includes("PROVIDER_POOL_EMPTY"),
});
steps.push({
  step: "not masked by a generic interrupted banner",
  ok: !failed.includes("Response was interrupted"),
});
steps.push({
  step: "no assistant row saved for an empty failure",
  ok: (await sql`
    SELECT count(*)::int n FROM messages m
    JOIN conversations c ON c.id=m.conversation_id
    JOIN users u ON u.id=c.user_id
    WHERE u.email=${email} AND m.role='assistant'`)[0].n === 0,
});

// Switch to a working gateway; the error must not stick.
await setGateway(20128);
await page.goto(base, { waitUntil: "networkidle0" });
await wait(1500);
steps.push({
  step: "stale error cleared after reconfiguring",
  ok: !(await text()).includes("PROVIDER_POOL_EMPTY"),
});

await sql`DELETE FROM users WHERE email=${email}`;
await browser.close();
console.log(JSON.stringify({ steps }, null, 2));
process.exit(steps.some(s => !s.ok) ? 1 : 0);
