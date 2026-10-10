// tools/verify_cardduel_arrival.mjs — the folder chooser's plate ARRIVAL and
// its TAKE-DOWN.
//
// The screen that opens a duel is the original's own machine F0x8009F110, read
// end to end on 2026-10-05 (claim
// cardgame-folder-chooser-every-state-anchored-2026-10-05, frontier CARD-Q007).
// It raises the title band and the first folder plate on tick 0, the second on
// tick 12 and the third on 24 — TWELVE apart, not the eleven the old reading
// took for a gap — then the cursor marker on 36, and it starts taking a button
// on 48. Confirming then holds for FIFTEEN ticks with nothing moving at all,
// shrinks the cursor marker away, takes the three plates down in folder order
// five ticks apart with a dismiss sound each, brings the title band down and
// builds the deck on tick 45.
//
// This drives the real chooser through window.__labDuel and reads the decoded
// schedule straight out of FOLDER_CHOOSER_OPEN_TICKS /
// FOLDER_CHOOSER_CLOSE_TICKS, so it cannot agree with a hand number.
//
// Needs the lab served:  python3 -m http.server 8742 --directory web
// Run through the wrapper: tools/run-playwright.sh tools/verify_cardduel_arrival.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
// The decoded schedule, straight from the machine's own table, so this file
// carries no hand number and cannot quietly agree with a wrong one.
import {
  FOLDER_CHOOSER_OPEN_TICKS as w_open,
  FOLDER_CHOOSER_CLOSE_TICKS as w_close,
  FOLDER_CHOOSER_STATES as w_states,
} from "../web/vendor/engine.js";
const w_ticks = { open: w_open, close: w_close };
// State 10's own bound: the fifteen ticks with nothing moving.
const w_hold = w_states[0x0a].wait;

const out = process.argv[2] ?? "/tmp/cardduel-arrival";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
// `?legacyDuel=1` because this drives the HAND-AUTHORED screen (web/cardduel.js);
// the lab defaults to the native one, whose chooser is not this code's to read.
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "ok" : "FAIL"}: ${label}`);
  if (!ok) failures++;
};

async function openChooser() {
  await p.evaluate(() => {
    const w = document.getElementById("game").contentWindow;
    w.__labOpen("cardduel");
    w.__labDuel.open(null, "Opponent", null, 13);
  });
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    document.getElementById("game").contentWindow.__labDuel.handleKey("circle");
  });
}

await openChooser();
check(
  await p.evaluate(() => document.getElementById("game").contentWindow.__labDuel.openingScreen()) === "chooser",
  "confirming the challenge screen opens the folder chooser",
);

// Advance the duel one frame at a time and snapshot what each plate count the
// screen reports; save the frames that show 1, 2 and 3 plates.
const shots = await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  const d = w.__labDuel;
  const cv = document.createElement("canvas");
  cv.width = 320; cv.height = 240;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;
  const targets = [0, 5, 17, 29, 42, 52];
  const seen = [];
  const pngs = {};
  for (const s of targets) {
    while (d.chooserArrival().age < s) d.draw(g, 320, 240);
    const a = d.chooserArrival();
    seen.push({ at: s, ...a });
    if (s === 5 || s === 17 || s === 29) pngs[s] = cv.toDataURL();
  }
  return { seen, pngs };
});

for (const s of shots.seen) {
  console.log(`tick ${String(s.at).padStart(2)}: plates=${s.rowsShown} cursor=${s.cursorUp ? "up" : "--"} input=${s.ready ? "open" : "locked"}`);
}
const at = (n) => shots.seen.find((s) => s.at === n);
check(at(5).rowsShown === 1, "at tick 5 only the first plate has arrived");
check(at(17).rowsShown === 2, "at tick 17 the second plate has arrived");
check(at(29).rowsShown === 3, "at tick 29 all three plates are up");
// The plate ARRIVES by growing its width over 12 ticks (F0x80096418 state 1:
// +0x5C = 0x1000 - (counter<<12)/0xC). The 6-frame helper F0x80096808 is the
// CLOSE, not this. Claim cardgame-folder-chooser-machine-2026-09-13 + gap A6.
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-6;
check(near(at(5).rowScales[0], 5 / 12) && at(5).rowScales[1] === null && at(5).rowScales[2] === null,
  "row 0 is a 12-tick grow from 0 (tick 5 -> 5/12)");
check(near(at(17).rowScales[0], 1) && near(at(17).rowScales[1], 5 / 12) && at(17).rowScales[2] === null,
  "row 1 grows while row 0 is already full");
check(near(at(29).rowScales[2], 5 / 12),
  "row 2 grows last, still mid-grow at tick 29");
check(at(5).cursorUp === false && at(29).cursorUp === false, "the cursor marker is not up while the plates arrive");
check(at(42).cursorUp === true, "the cursor marker is up by tick 42");
check(at(17).ready === false && at(42).ready === false, "input stays locked until the last wait elapses");
check(at(52).ready === true, "input opens by tick 52");
// Each plate rings as it appears: states 1, 3 and 5 (cardgame.s:29018/:29043/
// :29068). The screen was silent through the whole arrival before this.
check(JSON.stringify(at(5).heard) === JSON.stringify([1, 0, 0]), "plate 0 rang once");
check(JSON.stringify(at(17).heard) === JSON.stringify([1, 1, 0]), "plate 1 rang once");
check(JSON.stringify(at(29).heard) === JSON.stringify([1, 1, 1]), "plate 2 rang once");
check(JSON.stringify(at(52).heard) === JSON.stringify([1, 1, 1]), "and none of them rang twice");

for (const [tick, url] of Object.entries(shots.pngs)) {
  writeFileSync(`${out}/arrival-${tick}.png`, Buffer.from(url.split(",")[1], "base64"));
}

// A key pressed before the plates settle must do nothing.
await openChooser();
const before = await p.evaluate(() => {
  const d = document.getElementById("game").contentWindow.__labDuel;
  d.handleKey("down");
  return d.chooserArrival();
});
check(before.ready === false, "a fresh chooser starts with input locked");
check(before.cursor === 0, "a Down pressed before the plates settle does not move the cursor");
await p.evaluate(() => {
  const d = document.getElementById("game").contentWindow.__labDuel;
  const cv = document.createElement("canvas");
  cv.width = 320; cv.height = 240;
  const g = cv.getContext("2d");
  while (d.chooserArrival().age < 52) d.draw(g, 320, 240);
  d.handleKey("down");
});
const after = await p.evaluate(() => document.getElementById("game").contentWindow.__labDuel.chooserArrival());
check(after.cursor === 1, "a Down pressed once the plates have settled moves the cursor");

// The TAKE-DOWN. States 10..21 of the same machine: fifteen ticks with NOTHING
// moving, the cursor marker shrinking away, then the three plates in FOLDER
// ORDER five ticks apart, each over six ticks of its own (F0x80096808 sets
// +0x6A=6, +0x66=2 and +0x5C=0x1000; F0x80096418 state 2 computes
// (counter<<12)/6), then the title band down over six units, then the deck.
const closeResult = await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  const d = w.__labDuel;
  const cv = document.createElement("canvas");
  cv.width = 320; cv.height = 240;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;
  d.handleKey("circle");
  const frames = [];
  const shots = {};
  for (let i = 0; i < 70; i++) {
    d.draw(g, 320, 240);
    const a = d.chooserArrival();
    if (!a) { frames.push({ at: i, closeAge: i + 1, duel: true }); break; }
    frames.push({ at: i, closeAge: i + 1, scales: a.rowScales, shown: a.rowsShown,
                  cursorUp: a.cursorUp, band: a.bandScale, heard: a.heard });
    if (i + 1 === 20 || i + 1 === 24 || i + 1 === 40) shots[i + 1] = cv.toDataURL();
  }
  return { frames, shots };
});
const close = closeResult.frames;
const closeShots = closeResult.shots;
console.log("close frames:", JSON.stringify(close.map((f) =>
  f.duel ? "duel"
    : `${f.closeAge}:${f.scales.map((v) => (v === null ? "-" : v.toFixed(2))).join(",")}`
      // `heard` and `band` are absent on a screen that predates this schedule,
      // so print them as `-` rather than throwing: the run must reach the
      // checks below and report which ones the old screen fails.
      + ` band${f.band ?? "-"} mark${f.cursorUp ? 1 : 0} heard${(f.heard ?? ["-"]).join("")}`)));

// The schedule, read from the machine's own table rather than retyped here.
// Frame 0 is already closeAge 1, so closeAge N is frame N-1.
const HOLD = w_ticks.close[0x0d];                  // state 13, the first plate leaves
const STEP = w_ticks.close[0x0f] - w_ticks.close[0x0d];
const MARK = w_ticks.close[0x0b] + 5;              // state 11 plus its five-tick shrink
const BAND = w_ticks.close[0x13];                  // state 19, the title band goes
const LOAD = w_ticks.close[0x15];                  // state 21, the duel is built
check(close[0] && !close[0].duel && close[0].scales[0] === 1
  && close[0].scales[1] === 1 && close[0].scales[2] === 1,
  "nothing at all moves on the first frame after the confirm");
// State 10's own bound, straight off the table: fifteen ticks with nothing at
// all moving. After that the marker goes, and the plates still stand full until
// state 13 reaches them.
const HOLDWAIT = w_hold;
const hold = close.slice(0, HOLDWAIT);
check(hold.length === HOLDWAIT && hold.every((f) =>
  f.scales[0] === 1 && f.scales[1] === 1 && f.scales[2] === 1
  && f.cursorUp === true && f.band === 4096 && (f.heard ?? []).every((h) => h === 1)
  && (f.heard ?? []).length === 3),
`all ${HOLDWAIT} ticks of the hold still show three full-width plates, the cursor up, the band full and no dismiss sound`);
check(close.slice(HOLDWAIT, HOLD - 1).every((f) =>
  f.scales.every((v) => v === 1) && (f.heard ?? []).every((h) => h === 1)),
  "and between the hold and the first plate the three plates are still untouched");
// A plate is FULL width until its own turn, then shrinks: the first of its six
// drawn frames is still full (F0x80096418 case 2 computes +0x5C from the counter
// BEFORE it decrements it), then 5/6, 4/6, 3/6, 2/6, 1/6, then it is gone.
const shrinking = (i) => close.findIndex((f) => !f.duel && f.scales && f.scales[i] != null && f.scales[i] < 1);
const r0 = shrinking(0), r1 = shrinking(1), r2 = shrinking(2);
check(close[HOLD - 1]?.scales?.every((v) => v === 1) === true && near(close[HOLD]?.scales?.[0], 5 / 6),
  `the first plate is still at full width on closeAge ${HOLD} and starts moving on ${HOLD + 1}`);
check(r0 === HOLD, `the first plate starts shrinking on closeAge ${HOLD + 1} (frame ${r0})`);
check(r1 === r0 + STEP, `the second plate starts ${STEP} ticks after the first`);
check(r2 === r0 + 2 * STEP, `the third plate starts ${2 * STEP} ticks after the first`);
check(r0 >= 0 && close.slice(r0, r0 + 5).every((f) => f.scales[0] > 0) && close[r0 + 5]?.scales?.[0] === null,
  "each plate's own shrink is six drawn frames and they no longer overlap");
check(near(close[r0]?.scales?.[0], 5 / 6) && near(close[r0 + 4]?.scales?.[0], 1 / 6),
  "and it runs 5/6, 4/6, 3/6, 2/6, 1/6");
const markerGone = close.findIndex((f) => !f.duel && f.cursorUp === false);
check(close[MARK - 2]?.cursorUp === true && markerGone === MARK - 1,
  `the cursor marker is up through the hold and is gone by closeAge ${MARK}, before any plate moves`);
check(close[BAND - 1]?.band === 4096 && close[BAND + 4]?.band > 0 && close[BAND + 5]?.band === 0,
  "the title band wipes shut over its own six units");
// Every plate rang as it went: states 13, 15 and 17 (cardgame.s:29264/:29289/
// :29314).
check(close[r0]?.heard?.[0] === 2 && close[r0 + 2 * STEP]?.heard?.join("") === "222",
  "each plate rings its dismiss sound as it goes, and rings it once");
const duelAt = close.findIndex((f) => f.duel);
check(duelAt === LOAD - 1, `the duel opens on closeAge ${LOAD} (frame ${duelAt})`);
check(await p.evaluate(() => {
  const d = document.getElementById("game").contentWindow.__labDuel;
  return d.chooserArrival() === null && !!d.duel;
}), "and on that frame the chooser is down and the duel is up");

for (const [tick, url] of Object.entries(closeShots)) {
  writeFileSync(`${out}/close-${tick}.png`, Buffer.from(url.split(",")[1], "base64"));
}
await p.screenshot({ path: `${out}/chooser.png` });
console.log(`wrote ${out}`);
await b.close();
if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log("arrival OK");
