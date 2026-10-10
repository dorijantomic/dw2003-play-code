// Headless capture of the MEMORY CARD save/load screen (web/save.js, the
// pro/stgmcard recreation) through the real ui-lab harness, so the screen is
// verified in the actual game module rather than a mock.
//
//   python3 -m http.server 8742 --directory web &
//   tools/run-playwright.sh tools/verify_save_ui.mjs /tmp/save-shots
//
// Fails loudly on any page error; the ordered state walk below is also a
// smoke test of the slot -> file -> confirm -> message flow.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/save-shots";
mkdirSync(out, { recursive: true });

const errors = [];
const b = await chromium.launch({
  channel: "chromium-headless-shell",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => { errors.push(e.message); console.log("PAGEERROR:", e.message); });

await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
console.log("game booted in iframe");

const canvas = p.frameLocator("#game").locator("canvas#game");
async function shot(name) {
  await p.waitForTimeout(900);
  await canvas.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
}

await p.click('[data-scr="save"]');
await canvas.click();
await shot("save-slots");
await p.keyboard.press("Enter"); await shot("save-file-empty");
await p.keyboard.press("Enter"); await shot("save-confirm");
await p.keyboard.press("Enter"); await shot("save-message");
await p.keyboard.press("Enter");

// Re-open: the slot now holds a file, so the card renders a populated record
// (name / area / place / BIT / party icons + levels / play time).
await p.click('[data-scr="save"]');
await canvas.click();
await shot("save-slots-populated");
await p.keyboard.press("Enter"); await shot("save-file-populated");

// The decoded close stagger (UI-STGMCARD-CLOSE-STAGGER-2026-08-14): leaving the
// card clears the record-text flag and starts the fold closing together, and
// the frame plus party icons keep drawing until the fold lands. Caught two
// frames in, so the frame is still on screen with the text already gone.
await p.keyboard.press("Escape");
await p.waitForTimeout(25);
await canvas.screenshot({ path: `${out}/save-file-folding-out.png` });
console.log("shot", "save-file-folding-out");
await p.waitForTimeout(600);

await p.click('[data-scr="load"]');
await canvas.click();
await p.keyboard.press("Enter"); await shot("load-file");

await b.close();
if (errors.length) {
  console.error(`FAILED: ${errors.length} page error(s)`);
  process.exit(1);
}
console.log("OK");
