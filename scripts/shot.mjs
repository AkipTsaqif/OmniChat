import puppeteer from "puppeteer";

const OUT = process.argv[2] ?? "shot.png";
const DARK = process.argv.includes("dark");
const NEW_CHAT = process.argv.includes("new");

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.emulateMediaFeatures([
  { name: "prefers-color-scheme", value: DARK ? "dark" : "light" },
]);

await page.goto("http://localhost:3000", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 700));

// Hide the Next.js dev-tools badge so it does not sit on top of the UI.
await page.evaluate(() => {
  document.querySelector("nextjs-portal")?.remove();
});

if (NEW_CHAT) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("New chat"),
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
}

await page.screenshot({ path: OUT });
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
