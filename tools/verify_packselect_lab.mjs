// Capture Choose a Starter Pack from the UI lab (the index.html New Game
// button is hidden once the native title screen draws).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/boot-gap-pack";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

await p.click('[data-scr="packselect"]');
const frame = p.frames().find((f) => f.url().includes("index.html"));
const canvas = await frame.$("canvas");
await p.waitForTimeout(600);
await canvas.screenshot({ path: `${out}/pack_A.png` });
await frame.evaluate(() => window.__state.packSelect.moveDown());
await p.waitForTimeout(200);
await canvas.screenshot({ path: `${out}/pack_B.png` });
await frame.evaluate(() => window.__state.packSelect.confirm());
await p.waitForTimeout(200);
await canvas.screenshot({ path: `${out}/pack_confirm.png` });
console.log("pack", JSON.stringify(await frame.evaluate(() => {
  const ps = window.__state.packSelect;
  if (!ps) return null;
  // The wizard runs translated code (web/packselect-translated.js), which has no
  // `phase()`; its own diagnostics carry the same facts.
  const d = ps.diagnostics();
  return { sel: ps.sel(), open: d.open, pending: d.pending, done: d.done, tasks: d.tasks, partners: d.partners };
})));
await b.close();
