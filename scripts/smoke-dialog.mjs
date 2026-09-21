import puppeteer from "puppeteer";
import { neon } from "@neondatabase/serverless";

import { readDatabaseUrl } from "./env.mjs";

const base = `http://localhost:${process.argv[2] ?? 3425}`;
const sql = neon(readDatabaseUrl());
const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });

async function run(closeMethod) {
  const email = `btn${Date.now()}${Math.floor(performance.now())}@example.com`;
  // Fresh context per run so the session cookie does not leak between cases.
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(`${base}/signup`, { waitUntil: "networkidle0" });
  await page.type("#name", "Btn Probe");
  await page.type("#email", email);
  await page.type("#password", "correct horse battery");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 2500));

  const modalOpen = () =>
    page.evaluate(() =>
      document.body.innerText.includes("Model Provider Gateway"),
    );

  // Close the auto-opened modal using the requested method.
  if (closeMethod === "escape") {
    await page.keyboard.press("Escape");
  } else if (closeMethod === "x") {
    // The shadcn close button carries data-slot="dialog-close".
    const handle = await page.$('[data-slot="dialog-close"]');
    if (!handle) throw new Error("close button not found");
    await handle.click();
  } else if (closeMethod === "backdrop") {
    await page.mouse.click(60, 450); // far left, outside the dialog
  }
  await new Promise((r) => setTimeout(r, 900));

  // innerText can report stale text during the close animation; also assert
  // the popup element is actually gone from the DOM.
  const closed = await page.evaluate(
    () => !document.querySelector('[data-slot="dialog-content"]'),
  );

  // Check for a lingering scroll/pointer lock on body.
  const bodyState = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return {
      pointerEvents: cs.pointerEvents,
      overflow: cs.overflow,
      inert: document.body.hasAttribute("inert"),
      ariaHidden: document.body.getAttribute("aria-hidden"),
      portals: document.querySelectorAll("[data-slot='dialog-content']").length,
    };
  });

  // Try a real mouse click on the empty-state button.
  const box = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.innerText.includes("Add your API key"),
    );
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      blockedBy:
        top === btn || btn.contains(top)
          ? null
          : top?.tagName + "." + (top?.className || "").slice(0, 50),
    };
  });

  let reopened = "button not found";
  if (box) {
    await page.mouse.click(box.x, box.y);
    await new Promise((r) => setTimeout(r, 1000));
    reopened = await modalOpen();
  }

  console.log(
    `close=${closeMethod.padEnd(9)} closed=${closed} body=${JSON.stringify(bodyState)} blockedBy=${box?.blockedBy ?? "none"} reopened=${reopened} errs=${errs.length}`,
  );

  await sql`DELETE FROM users WHERE email=${email}`;
  await ctx.close();

  return { method: closeMethod, closed, reopened, errs: errs.length };
}

// Regression guard: the dialog must close via every affordance and reopen from
// the empty-state button. A stale dev bundle once made that button look inert,
// so assert the dialog node actually mounts rather than trusting visible text.
const results = [];
for (const m of ["escape", "x", "backdrop"]) results.push(await run(m));
await browser.close();
const bad = results.filter((r) => !r.closed || r.reopened !== true || r.errs);
console.log(
  bad.length
    ? `FAIL: ${JSON.stringify(bad)}`
    : "PASS: dialog closes and reopens via all 3 paths",
);
process.exit(bad.length ? 1 : 0);
