// @ts-check
/**
 * 375px-viewport screenshot of a running app — the visual-verification loop.
 *
 *   npm run shot -- <path> <outfile> [section-h2-text] [height]
 *
 *   npm run shot -- / /tmp/home.png
 *   npm run shot -- /pokemon/kingambit /tmp/kingambit.png "Threat Profile"
 *   PORT=3300 npm run shot -- / /tmp/dev-home.png        # target the dev server
 *
 * When a section heading is given, only that <section> is captured (scrolled
 * into view first). Requires Google Chrome at the default macOS location and
 * a server already running (default port 3210).
 */

import puppeteer from "puppeteer-core";

const [, , path = "/", out = "/tmp/shot.png", h2text = "", height = "700"] = process.argv;
const port = process.env.PORT ?? "3210";

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
});
const page = await browser.newPage();
await page.setViewport({ width: 375, height: Number(height), deviceScaleFactor: 2 });
await page.goto(`http://localhost:${port}${path}`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 1200));
if (h2text) {
  await page.waitForFunction(
    (t) => [...document.querySelectorAll("h2")].some((h) => h.textContent?.includes(t)),
    { timeout: 10000 },
    h2text,
  );
  const el = await page.evaluateHandle(
    (t) =>
      [...document.querySelectorAll("h2")]
        .find((h) => h.textContent?.includes(t))
        ?.closest("section"),
    h2text,
  );
  const section = el.asElement();
  if (!section) throw new Error(`no <section> with an h2 containing "${h2text}"`);
  await section.scrollIntoView();
  await new Promise((r) => setTimeout(r, 300));
  await section.screenshot({ path: out });
} else {
  await page.screenshot({ path: out });
}
await browser.close();
console.log("saved", out);
