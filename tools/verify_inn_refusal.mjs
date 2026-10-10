// Capture the inn's refusal panel — the decoded third fold (ledger
// UI-INN-THIRD-FOLD-2026-08-14). Opens the inn with the player unable to pay.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_inn_refusal.mjs [out-dir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
const out = process.argv[2] ?? "/tmp/inn-refusal";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
// Empty the wallet BEFORE opening, so the inn quotes an unaffordable stay with
// a real party — the decoded refusal, not the walker's empty-party fallback.
await p.click('[data-scr="inn"]');
const frame = p.frames().find((f) => f.url().includes("index.html"));
const canvas = await frame.$("canvas");
await p.waitForTimeout(1200);
await canvas.screenshot({ path: `${out}/inn-offer.png` });
console.log("shot", "inn-offer");
// Empty the wallet so the stay is refused, then accept.
// Three Digimon and an empty wallet: the stay costs 3 x 8 and cannot be paid,
// which is the decoded refusal rather than the walker's empty-party fallback.
await frame.evaluate(() => {
  window.__state.bits = 0;
  window.__state.party = [0, 1, 2].map(() => ({ hp: 1, maxHp: 20, mp: 0, maxMp: 10 }));
});
// Reopen so inn.open() re-quotes against the emptied wallet.
await p.click('[data-scr="inn"]');
await p.waitForTimeout(900);
await canvas.click();
await p.keyboard.press("Enter");
await p.waitForTimeout(120);
await canvas.screenshot({ path: `${out}/inn-refusal-opening.png` });
await p.waitForTimeout(900);
await canvas.screenshot({ path: `${out}/inn-refusal.png` });
console.log("shot", "inn-refusal");
await b.close();
