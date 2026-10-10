import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e && e.message || e).slice(0, 200)));
await page.goto(`${baseUrl(8741)}/`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 20000 });
await page.waitForTimeout(3000);
// Bypass input: invoke the carrier directly (what titleInput would do on success).
await page.evaluate(() => document.getElementById("title-newgame").click());
await page.waitForTimeout(1500);
console.log("after carrier click:", JSON.stringify(await page.evaluate(() => ({
  started: window.__state?.started,
  map: window.__state?.manifest?.maps[window.__state.mapIdx]?.id,
  hidden: document.getElementById("title-screen")?.hidden,
}))));
// Now exercise the title state machine directly to see if IT advances.
const tsProbe = await page.evaluate(async () => {
  // fresh machine, skip the logo reveal, drive the real rhythm
  const m = await import("./titlescreen.js");
  const ts = m.createTitleScreen({ skipReveal: true });
  // The title is driven by real elapsed seconds; 1/50 spends one PAL field.
  const FIELD = 1 / 50;
  const seen = [];
  for (let i = 0; i < 30; i++) { ts.tick(FIELD); if (ts.phase && ts.phase() === "prompt") break; }
  seen.push("phase=" + (ts.phase ? ts.phase() : "?"));
  seen.push("confirm1=" + ts.confirm());
  for (let i = 0; i < 60; i++) { ts.tick(FIELD); if (ts.phase && ts.phase() === "menu") break; }
  seen.push("phase=" + (ts.phase ? ts.phase() : "?"));
  seen.push("confirm2=" + ts.confirm());
  for (let i = 0; i < 120; i++) { ts.tick(FIELD); if (ts.isDone()) break; }
  seen.push("done=" + ts.isDone() + " result=" + ts.result());
  return seen;
});
console.log("machine probe:", JSON.stringify(tsProbe));
await browser.close();
