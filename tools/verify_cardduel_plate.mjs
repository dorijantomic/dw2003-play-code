// tools/verify_cardduel_plate.mjs - the centre-plate wipe on a played slot.
//
// Decoded 2026-09-14 (gap K12): the two centre-plate "modes" are the open and
// close of a small plate drawn under each of the three played-card slots.
//   * F0x80096CF0 reads the record mode byte at record+0x8 (cardgame.s L20513);
//   * F0x8009BE40 (view+0xEA4) writes mode 1 with 0xDC0=0x1000, +0xDC2=0 and
//     10-frame durations (L25714-25720);
//   * F0x8009BE78 (view+0xEA8) writes mode 3 with a 5-frame duration
//     (L25729-25733);
//   * F0x80096C20 draws at table 0x800A5978 with clip payload+6 and the
//     record's vertical animScale.
// The engine (card-view.ts) already models this; this checks web/cardduel.js now
// opens/closes and draws it.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Run:  .opencode/autonomy/check-browser tools/verify_cardduel_plate.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.env.DUEL_PLATE_SHOT || ".dw3-research/autonomous-plan/shots/cardduel-plate";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
// The legacy duel: this check reads the old shell's own surface (labDuel.duel, labDuel.handleKey), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "load" });
await page.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
const inGame = (fn) => page.evaluate((src) => {
  const w = document.getElementById("game").contentWindow;
  // eslint-disable-next-line no-new-func
  return new Function("w", src)(w);
}, fn);

const failures = [];
const check = (ok, m) => { if (!ok) failures.push(m); else console.log("  ok:", m); };

try {
  await inGame(`w.__labOpen("cardduel");`);
  await page.waitForTimeout(800);
  for (let i = 0; i < 80; i++) {
    if (await inGame(`return !!w.__labDuel.duel;`)) break;
    await inGame(`w.__labDuel.handleKey("enter");`);
    await page.waitForTimeout(120);
  }
  check(await inGame(`return !!w.__labDuel.duel;`), "the duel started");

  // A fixture: pose a committed play on slot 0 by the player, then fire the
  // 0x12/0x13 move that carries the walker's own open call.
  const opened = await inGame(`
    const c = w.__labDuel, d = c.duel;
    c.view.plates.forEach((p, i) => { p.state = 0; p.animScale = 0; p.payload = 0; p.timer = 0; });
    c.__notePlayed(d.player.hand[0] ?? 5, 0);
    c.__raisePlayTableExtra();
    const p = c.view.plates[0];
    return { state: p.state, payload: p.payload, timer: p.timer,
             origins: [...c.view.plates].map((_, i) => i) };
  `);
  check(opened.state === 1, `playing a card opens the plate under slot 0 (state ${opened.state})`);
  check(opened.payload === 0, `the player's plate payload is side 0 -> clip 6 (payload ${opened.payload})`);

  const grow = await inGame(`
    const c = w.__labDuel;
    const cv = w.document.createElement("canvas"); cv.width = 320; cv.height = 240;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
    const out = [];
    let png = null;
    for (let f = 0; f < 14; f++) {
      c.draw(g, 320, 240);
      out.push({ s: c.view.plates[0].state, a: c.view.plates[0].animScale });
      if (f === 4) png = cv.toDataURL();
    }
    return { out, png };
  `);
  const ramp = grow.out.slice(0, 10).map((x) => x.a);
  console.log("  open ramp:", JSON.stringify(ramp), "states:", JSON.stringify(grow.out.map((x) => x.s)));
  // The disc's ten-frame wipe, read out of the mode-1 arm of the plate's own
  // update (cardgame.s:20524-20531): it writes 0x1000 - ((timer << 12) / duration)
  // from the timer AS IT STANDS, and only then takes the frame delta off it
  // (:20537-20540). So the tenth frame — the one whose timer is 1 — writes
  // 0x1000 - 409 = 3687 and the mode flips to 2 in the SAME frame
  // (:20541-20545, whose delay slot stores $s1 = 2). Mode 2 does not write the
  // record at all: it carries 0x1000 into the draw (:20546-20547). The ramp is
  // therefore ten frames ending at 3687, and full scale is what the plate is
  // DRAWN at once it holds open — not a tenth frame of the wipe.
  const discRamp = Array.from({ length: 10 }, (_, i) => {
    const timer = 10 - i;
    return 0x1000 - Math.floor((timer << 12) / 10);
  });
  check(JSON.stringify(ramp) === JSON.stringify(discRamp),
    `the plate wipes in over the disc's ten frames ${JSON.stringify(discRamp)} (got ${JSON.stringify(ramp)})`);
  check(grow.out[9].s === 2, "and it starts holding open on the tenth frame, not after it");
  check(grow.out[10].a === 4096 && grow.out[13].a === 4096,
    "held open, it is drawn at full 0x1000");
  check(grow.out[10].s === 2, "it holds open (state 2) once the wipe finishes");
  if (grow.png) writeFileSync(`${OUT}/plate-opening.png`, Buffer.from(grow.png.split(",")[1], "base64"));

  const close = await inGame(`
    const c = w.__labDuel;
    const cv = w.document.createElement("canvas"); cv.width = 320; cv.height = 240;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
    c.__closePlates();
    const out = [];
    for (let f = 0; f < 8; f++) {
      c.draw(g, 320, 240);
      out.push({ s: c.view.plates[0].state, a: c.view.plates[0].animScale });
    }
    return out;
  `);
  console.log("  close:", JSON.stringify(close.map((x) => [x.s, x.a])));
  check(close[0].s === 3, "clearing the row starts the close (state 3)");
  check(close[5].s === 0, "it shrinks away over five frames and goes idle");
  if (errors.length) check(false, `${errors.length} page error(s)`);
} catch (e) {
  check(false, `check threw: ${e.message}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nFAILED:");
  for (const m of failures) console.error(" -", m);
  process.exit(1);
}
console.log("\nOK: the centre plate wipes in under a played slot and shrinks on the row clear");
