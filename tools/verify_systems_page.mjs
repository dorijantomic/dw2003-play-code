// Loads each view of web/systems.html (the System Status page) and checks that it
// renders with no page errors and shows the rows the records promise.
// Usage: VERIFY_PORT=8742 tools/run-playwright.sh tools/verify_systems_page.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const browser = await chromium.launch();
const errors = [];
const found = {};
try {
  for (const view of ["systems", "files", "gaps"]) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(`${view}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${view}: ${m.text()}`); });
    await page.goto(`${baseUrl(8742)}/systems.html#${view}`);
    await page.waitForFunction(() => document.querySelectorAll("table tr, ul.screens li").length > 5, null, { timeout: 15000 });
    found[view] = await page.evaluate(() => ({
      text: document.body.textContent,
      ids: [...document.querySelectorAll("tr[data-id]")].map((r) => r.dataset.id),
    }));
    await page.close();
  }
  const need = [
    ["systems", (f) => f.ids.includes("battle-3d"), "row battle-3d"],
    ["systems", (f) => f.ids.includes("story-gating"), "row story-gating"],
    ["systems", (f) => f.ids.includes("input"), "row input"],
    ["files", (f) => f.text.includes("pro/smdldata"), "pro/smdldata"],
    ["files", (f) => f.text.includes("pro/wstag260"), "pro/wstag260"],
    ["gaps", (f) => f.text.includes("Our files that no system owns"), "unowned-files list"],
    ["gaps", (f) => f.text.includes("Routines no one has read yet"), "unread-routines list"],
  ];
  const missing = need.filter(([v, ok]) => !ok(found[v])).map(([v, , what]) => `${v}: ${what}`);
  const systems = found.systems.ids.length;
  if (errors.length || missing.length) {
    console.log("FAIL", JSON.stringify({ errors, missing, systems }));
    process.exitCode = 1;
  } else {
    console.log("PASS", JSON.stringify({ systems }));
  }
} finally {
  await browser.close();
}
