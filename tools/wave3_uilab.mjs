import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
const out = process.argv[2] ?? "/tmp/wave3-lab";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({
  channel: "chromium-headless-shell",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
console.log("game booted in iframe");
for (const scr of ["fightreport", "cntysel", "menu"]) {
  await p.click(`[data-scr="${scr}"]`);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/${scr}.png` });
  console.log("shot", scr);
}
await b.close();
