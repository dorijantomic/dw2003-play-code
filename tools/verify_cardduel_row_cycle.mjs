// tools/verify_cardduel_row_cycle.mjs — the folder chooser's selected-row CLUT.
//
// Original: F0x80095e58 (file 0x130e0-0x1327c) computes the folder-cursor
// marker's CLUT row, not from a table: while the marker loops (+0x63 clear) the
// row is (counter >> 2) mod 16 — a LINEAR 16-row wraparound at four counter
// units per row; confirm sets +0x63 and the row becomes the one-shot
// min(counter >> 1, 7). counter is the marker's own +0x50, incremented by the
// frame delta each tick. The walker used an 8-entry ping-pong table.
// Claim cardgame-folder-row-clut-cycle-2026-09-13.
//
// Needs the lab served:  python3 -m http.server 8742 --directory web
// Run through the wrapper: .opencode/autonomy/check-browser tools/verify_cardduel_row_cycle.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.env.DUEL_ROW_SHOT || ".dw3-research/autonomous-plan/shots/cardduel-row-cycle";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
p.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR:", e.message); });
// `?legacyDuel=1` because this drives the HAND-AUTHORED screen (web/cardduel.js).
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

// The decoded schedule, read from the machine's own table rather than retyped:
// the cursor marker is created on state 7 and the picker takes a button from
// state 9 (F0x8009F110, read end to end 2026-10-05).
import { FOLDER_CHOOSER_OPEN_TICKS } from "../web/vendor/engine.js";
const CURSOR_TICK = FOLDER_CHOOSER_OPEN_TICKS[7];
const READY_TICK = FOLDER_CHOOSER_OPEN_TICKS[9];
const state = (script) => p.evaluate((src) => {
  const w = document.getElementById("game").contentWindow;
  const d = w.__labDuel;
  const cv = document.createElement("canvas");
  cv.width = 320; cv.height = 240;
  const g = cv.getContext("2d");
  // eslint-disable-next-line no-new-func
  return new Function("w", "d", "cv", "g", src)(w, d, cv, g);
}, script);

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };

async function openChooser() {
  await p.evaluate(() => {
    const w = document.getElementById("game").contentWindow;
    w.__labOpen("cardduel");
    w.__labDuel.open(null, "Opponent", null, 13);
  });
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.getElementById("game").contentWindow.__labDuel.handleKey("circle"));
  await p.waitForTimeout(200);
}

try {
  // ── The looping row: (counter >> 2) mod 16, linear through 15 and back to 0.
  await openChooser();
  const loop = await state(`
    const out = [];
    const at = (t) => {
      while (d.chooserArrival().age < t) d.draw(g, 320, 240);
      out.push({ t, row: d.chooserArrival().selectedRow, age: d.chooserArrival().age });
    };
    at(${CURSOR_TICK});
    at(${CURSOR_TICK + 4});
    at(${CURSOR_TICK + 28});
    at(${CURSOR_TICK + 32});
    at(${CURSOR_TICK + 60});
    at(${CURSOR_TICK + 64});
    return out;
  `);
  console.log("loop timeline:", JSON.stringify(loop));
  const rowAt = (t) => loop.find((s) => s.t === t)?.row;
  if (rowAt(CURSOR_TICK) !== 0) fail(`row at cursor tick is ${rowAt(CURSOR_TICK)}, expected 0`);
  if (rowAt(CURSOR_TICK + 4) !== 1) fail(`row +4 is ${rowAt(CURSOR_TICK + 4)}, expected 1`);
  if (rowAt(CURSOR_TICK + 28) !== 7) fail(`row +28 is ${rowAt(CURSOR_TICK + 28)}, expected 7`);
  if (rowAt(CURSOR_TICK + 32) !== 8) fail(`row +32 is ${rowAt(CURSOR_TICK + 32)}, expected 8 (linear wrap, not ping-pong)`);
  if (rowAt(CURSOR_TICK + 60) !== 15) fail(`row +60 is ${rowAt(CURSOR_TICK + 60)}, expected 15`);
  if (rowAt(CURSOR_TICK + 64) !== 0) fail(`row +64 is ${rowAt(CURSOR_TICK + 64)}, expected 0 (mod 16)`);

  // ── The confirm one-shot: min(counter >> 1, 7).
  await openChooser();
  const confirm = await state(`
    const out = [];
    while (d.chooserArrival().age < ${READY_TICK}) d.draw(g, 320, 240);
    out.push({ t: "before", age: d.chooserArrival().age, row: d.chooserArrival().selectedRow, closing: d.chooserArrival().closing });
    d.handleKey("circle");                 // confirm the folder (input is open)
    d.draw(g, 320, 240);                   // the confirm frame itself
    out.push({ t: ${READY_TICK}, age: d.chooserArrival().age, row: d.chooserArrival().selectedRow, closing: d.chooserArrival().closing });
    for (const target of [${READY_TICK + 2}, ${READY_TICK + 4}, ${READY_TICK + 6}, ${READY_TICK + 10}]) {
      while (d.chooserArrival().age < target && d.chooserArrival().closing) d.draw(g, 320, 240);
      const a = d.chooserArrival();
      out.push({ t: target, age: a.age, row: a.selectedRow, closing: a.closing });
    }
    return out;
  `);
  console.log("confirm timeline:", JSON.stringify(confirm));
  const at = (t) => confirm.find((s) => s.t === t);
  if (at("before")?.closing) fail("the folder was already closing before the confirm");
  // After the confirm, every sampled row must equal min((age-cursorTick)>>1, 7)
  // with the marker age, and it must reach the clamp of 7. Every sample here is
  // inside the marker's life: state 11 shrinks it away fifteen ticks after the
  // confirm, and from then on there is no cursor and so no row to recolour
  // (`selectedRow` is null).
  for (const s of confirm.filter((x) => x.closing)) {
    const expect = Math.min((s.age - CURSOR_TICK) >> 1, 7);
    if (s.row !== expect) fail(`confirm row ${JSON.stringify(s)}, expected min((${s.age - CURSOR_TICK})>>1,7)=${expect}`);
  }
  if (!confirm.some((s) => s.row === 7)) fail("the confirm one-shot never reached its clamp of 7");
  if (confirm.some((s) => s.closing && s.row === null && s.age < READY_TICK + 21)) {
    fail("the cursor vanished before the marker's own five-tick shrink had run");
  }

  const png = await state(`
    while (d.chooserArrival().age < ${CURSOR_TICK + 12}) d.draw(g, 320, 240);
    return cv.toDataURL("image/png");
  `);
  writeFileSync(`${OUT}/chooser-row-cycle.png`, Buffer.from(png.split(",")[1], "base64"));
  if (errors.length) fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, errors, loop, confirm }));
} catch (e) {
  await fail(e.message);
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
