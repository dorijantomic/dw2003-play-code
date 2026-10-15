// Headless verification of the LEGACY memory-card screen's slot chooser
// (web/save.js, the pro/stgmcard recreation) through the real ui-lab harness:
// the entry animation, the console's decoded x, and the two card-slot rows.
//
//   python3 -m http.server 8742 --directory web &
//   tools/run-playwright.sh tools/verify_save_slot_chooser.mjs [outdir]
//
// DECODED 2026-10-14 (see tests/save-slot-chooser.test.js): the four entry
// tweens of F0x800843D8 (cardsX 0xDE->0, stripY -0x55->0, consoleX 0->0x2F,
// cursorX previous*0x44->slot*0x44), the console at consoleX+cursorX+0x30, and
// the two rows (esmemcrd 3 "{1}" numbered 1 and 2) with the cursor at
// (0xC2, 0xBD + 0x0E*row). This script proves the strings actually reach the
// canvas (the __uiTextTrace hook) and captures before/after frames; the state
// seam (__saveLegacy.grid) proves the tweens run instead of jumping.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/save-slot-chooser-shots";
mkdirSync(out, { recursive: true });

const errors = [];
const b = await chromium.launch({
  channel: "chromium-headless-shell",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => { errors.push(e.message); console.log("PAGEERROR:", e.message); });

await p.goto(`${baseUrl(8742)}/ui-lab.html?legacySave=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f?.contentWindow?.__state?.started;
}, null, { timeout: 30000 });
console.log("game booted in iframe (legacy save route)");

const frame = p.frameLocator("#game");
const canvas = frame.locator("canvas#game");
const state = () => p.evaluate(() => {
  const s = document.getElementById("game").contentWindow.__saveLegacy;
  return { screen: s.screen, slot: s.slot, row: s.grid.slotRow, phase: s.grid.phase,
    cardsX: s.grid.cardsX.value, stripY: s.grid.stripY.value,
    consoleX: s.grid.consoleX.value, cursorX: s.grid.cursorX.value,
    clutFrame: s.grid.clutFrame };
});

await p.click('[data-scr="save"]');
await canvas.click();

// Mid-entry: sample as soon as the entry is under way. It is 33 frames long
// (10 strip + 10 cards + 8 console + 5 cursor), so polling catches it mid-slide
// on any machine speed; the old code was an instant jump and never left idle.
const mid = await p.evaluate(async () => {
  const s = document.getElementById("game").contentWindow.__saveLegacy;
  for (let i = 0; i < 400; i++) {
    if (["in-cards", "in-console", "in-cursor"].includes(s.grid.phase)) {
      return { phase: s.grid.phase, cardsX: s.grid.cardsX.value,
        stripY: s.grid.stripY.value, consoleX: s.grid.consoleX.value };
    }
    await new Promise((r) => setTimeout(r, 8));
  }
  return null;
});
console.log("mid-entry", JSON.stringify(mid));
if (!mid) {
  console.log("FAILED: the entry finished before it could be sampled (or never ran)");
  process.exit(1);
}
await canvas.screenshot({ path: `${out}/slot-chooser-entry-mid.png` });

// Landed: every tween at its rest pose.
await p.waitForFunction(() => {
  const s = document.getElementById("game").contentWindow.__saveLegacy;
  return s.grid.phase === "idle";
}, null, { timeout: 5000 });
const rest = await state();
console.log("landed", JSON.stringify(rest));
if (!(rest.cardsX === 0 && rest.stripY === 0 && rest.consoleX === 0x2f && rest.cursorX === 0)) {
  console.log("FAILED: the entry did not land on the decoded rest poses");
  process.exit(1);
}
await canvas.screenshot({ path: `${out}/slot-chooser.png` });

// The two rows and the cursor must actually reach the canvas. The trace hook
// collects every string the game draws, so this is the drawn-text check.
await p.evaluate(() => { document.getElementById("game").contentWindow.__uiTextTrace = new Set(); });
await p.waitForTimeout(150);
const drawn = await p.evaluate(() => [...document.getElementById("game").contentWindow.__uiTextTrace]);
console.log("drawn texts:", JSON.stringify(drawn));
for (const want of ["1", "2", "[arrow-right]"]) {
  if (!drawn.includes(want)) {
    console.log(`FAILED: the slot screen never drew ${JSON.stringify(want)}`);
    process.exit(1);
  }
}
await p.evaluate(() => { document.getElementById("game").contentWindow.__uiTextTrace = undefined; });

// A slot move is a 6-tick slide (5 steps of integer 8.8), and the row cursor
// answers up/down.
await p.keyboard.press("ArrowRight");
await p.waitForTimeout(50);
const moving = await state();
console.log("moving", JSON.stringify(moving));
if (moving.slot !== 1 || moving.phase !== "move" || moving.cursorX >= 0x44) {
  console.log("FAILED: the slot move did not tween");
  process.exit(1);
}
await canvas.screenshot({ path: `${out}/slot-chooser-move-mid.png` });
await p.waitForFunction(() => {
  const s = document.getElementById("game").contentWindow.__saveLegacy;
  return s.grid.phase === "idle" && s.grid.cursorX.value === 0x44;
}, null, { timeout: 5000 });
await canvas.screenshot({ path: `${out}/slot-chooser-move-done.png` });

await p.keyboard.press("ArrowDown");
await p.waitForTimeout(80);
const row2 = await state();
console.log("row2", JSON.stringify(row2));
if (row2.row !== 1) { console.log("FAILED: ArrowDown did not pick row 2"); process.exit(1); }
await canvas.screenshot({ path: `${out}/slot-chooser-row2.png` });

// The file card's window header (V4, decoded 2026-10-14): the SAVE tab at
// (205,98) and the SAVING word at (20,113). Both must reach the canvas.
await p.keyboard.press("Enter");            // circle -> the file card
await p.waitForTimeout(250);
await p.evaluate(() => { document.getElementById("game").contentWindow.__uiTextTrace = new Set(); });
await p.waitForTimeout(150);
const fileTexts = await p.evaluate(() => [...document.getElementById("game").contentWindow.__uiTextTrace]);
console.log("file card texts:", JSON.stringify(fileTexts));
for (const want of ["SAVE", "SAVING"]) {
  if (!fileTexts.includes(want)) {
    console.log(`FAILED: the file card never drew ${JSON.stringify(want)}`);
    process.exit(1);
  }
}
await p.evaluate(() => { document.getElementById("game").contentWindow.__uiTextTrace = undefined; });
await canvas.screenshot({ path: `${out}/file-card-header.png` });

await b.close();
if (errors.length) {
  console.error(`FAILED: ${errors.length} page error(s)`);
  process.exit(1);
}
console.log("OK");
