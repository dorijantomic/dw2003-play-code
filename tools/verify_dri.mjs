// Headless screenshot verifier for all native stgdglab states.
// Compare against docs/research/ui/dri-states. Usage:
//   ~/.local/share/playwright-shot/run.sh tools/verify_dri.mjs [outdir]
// Requires: cd web && python3 -m http.server 8741
//
// Also runs an ORDERED draw-call regression check for the s3 ("digivolve")
// and s6 ("chart") states: the exact sequence of drawClip/drawText calls is
// captured by monkeypatching CanvasRenderingContext2D inside the page (so no
// pixel comparison is involved) and diffed against the checked-in baseline
// at tests/fixtures/dri-draw-sequence.json. A silent removal/reordering of a
// disasm-cited draw call trips this even when the screenshot still "looks"
// right (antialiasing/compositing can hide a missing/extra call visually).
//
// What the baseline records is what was DRAWN -- the source sheet, the source
// rectangle and the destination point of every call, and every string -- and not
// where in web/dri.js the call was written. It used to record `dri.js:<line>` too, and
// that made the fixture a second copy of the file's line numbering: 93 of its 240
// entries broke on a commit that only moved code, with the drawn sequence
// byte-identical. The citation for each call lives in the source comment above it;
// the fixture's job is the ORDER and the CONTENT of the draw list.
//
// The states are captured with `d.time` frozen, so the one clip in these two states
// that is a function of the clock -- the shared Digimon-picture reader, the turning
// partner figure (web/portraits.js `starterPortraitClip`, fed by
// `Math.floor(d.time / PORTRAIT_PERIOD)`) -- is pinned at frame 0, a property of the
// decoded table rather than of when the check ran. `timeFrozen` asserts that, so a
// clock leak into the capture fails here instead of showing up as a flaky diff.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl } from "./verify-base-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(__dirname, "..", "tests", "fixtures", "dri-draw-sequence.json");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

const out = process.argv[2] ?? "/tmp/dri";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium-headless-shell",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
// Without a saved assetMode, web/assets.js shows the first-launch Visuals
// chooser and every capture below comes out covered by that modal.
await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
// The hand-authored desk is the ?legacyDri=1 rollback now that the native
// pro/stgdglab route is the default (Phase 6.3).
await page.goto(`${baseUrl(8741)}/?skipTitle=1&noEncounters=1&legacyDri=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state && window.__dri, null, { timeout: 30000 });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 10000 });
await page.evaluate(async () => {
  await window.__dri.dataReady;
  const s = window.__state;
  s.party = ["p009rena", "p003pken", "p004kogu"];
  s.partyStats = [null, null, null];
  s.partnerStats = {
    digimonId: 7, level: 99, hp: 9999, maxHp: 9999, mp: 9999, maxMp: 9999,
    stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 },
    bonuses: {}, elemBonuses: {},
  };
  s.digimonNames = {};
  s.rosterOwned = 0xff;          // every roster slot obtained, so the Switch
                                 // screen's second list has partners waiting.
  window.__dri.open(() => {}, () => {});
});
await page.waitForTimeout(300);

const shots = [
  ["root", "root"],
  ["switch_from", "switch_from"],
  ["switch_to", "switch_to"],
  ["digivolve_picker", "digivolve_picker"],
  ["digivolve_menu", "digivolve_menu"],
  ["load_tech", "load_tech"],
  ["digivolve", "digivolve"],
  ["chart", "chart"],
];
// Sets up the same fixture state as the screenshot loop below, but also
// freezes d.time (blink/CLUT-pulse timers and the shared Digimon-picture frame
// index all read it) and monkeypatches the live canvas#game 2D context to record
// every drawImage/fillText call the draw pass makes. What is recorded is the call's
// effect -- source sheet, source rectangle, destination, text -- not the dri.js line
// the call was written on. Returns the ordered record list plus a read-out of the
// turning-picture clip the frozen clock produced.
async function captureDrawSequence(screen) {
  return page.evaluate(async (screen) => {
    // Loaded BEFORE anything is drawn: an `await` after the draw would let the page's
    // own animation frame advance `d.time` before the read-out below.
    const portraits = await import("./portraits.js");
    const d = window.__dri;
    d.openState(screen, window.__state, window.__battle);
    d.cursor = 0;
    d.scroll = 0;
    d.switchFrom = null;
    d.selectedPartner = screen === "chart" ? 1 : 0;
    d.time = 0;
    const canvas = document.querySelector("canvas#game");
    const ctx = canvas.getContext("2d");
    const seq = [];
    const origDrawImage = ctx.drawImage.bind(ctx);
    ctx.drawImage = function patched(...args) {
      const [img, a0, a1, , , a4, a5] = args;
      const [sx, sy, dx, dy] = args.length >= 9 ? [a0, a1, a4, a5] : [0, 0, a0, a1];
      seq.push({
        op: "clip",
        src: img && img.src ? String(img.src).split("/").pop() : "canvas",
        sx: Math.round(sx), sy: Math.round(sy), dx: Math.round(dx), dy: Math.round(dy),
      });
      return origDrawImage(...args);
    };
    const origFillText = ctx.fillText.bind(ctx);
    ctx.fillText = function patched(text, x, y, ...rest) {
      seq.push({ op: "text", text, dx: Math.round(x), dy: Math.round(y) });
      return origFillText(text, x, y, ...rest);
    };
    d.draw(ctx, 320, 240);
    ctx.drawImage = origDrawImage;
    ctx.fillText = origFillText;
    // The shared turning-picture reader the tube sprites use, at the frame the
    // frozen clock selected, and the clip a second frame would give. Equal means the
    // capture really is frame 0 and nothing leaked the clock into it.
    const lead = window.__state.partnerStats?.digimonId ?? -1;
    return {
      seq,
      clock: { lead, frame0: portraits.starterPortraitClip(lead, 0),
               frame1: portraits.starterPortraitClip(lead, 1), time: d.time },
    };
  }, screen);
}

const sequences = {};
const clocks = {};
for (const [state, file] of shots) {
  // One synchronous pass per state: set the fixture up, freeze `d.time`, draw the
  // frame ONCE and read the pixels back from that same frame. Playwright's element
  // screenshot can wait forever for a "stable" element on a canvas that animates every
  // frame, and a live-clock draw would make the picture a different frame from the one
  // the baseline diffs, so both come out of this one evaluate.
  const shot = await page.evaluate((screen) => {
    const d = window.__dri;
    d.openState(screen, window.__state, window.__battle);
    d.cursor = screen === "switch_to" ? 1 : 0;
    d.switchFrom = screen === "switch_to" ? 0 : null;
    d.selectedPartner = screen === "digivolve" ? 0 : screen === "chart" ? 1 : 0;
    // Blink timers, the CLUT-pulse ladders and the shared Digimon-picture frame index
    // all read `d.time`, so freezing it here pins every one of them.
    d.time = 0;
    if (screen === "digivolve") {
      // Three equipped forms plus "Do nothing." is four rows: one more than the
      // three-row window, so the scrollbar thumb and the down arrow both draw.
      window.__state.partnerStats.equippedForms = [15, 27, 39];
    }
    if (screen === "load_tech") {
      // Loadable techs need a dvexp'd alternate form on the lead.
      window.__state.partnerStats.dvexpByForm = { 15: 100 };
    }
    if (screen === "chart") {
      // Kotemon reference: Dinohumon + Kyukimon unlocked.
      window.__state.partyStats[1].level = 99;
      window.__state.partyStats[1].dvexpByForm = { 9: 100, 20: 100 };
    }
    const canvas = document.querySelector("canvas#game");
    const ctx = canvas.getContext("2d");
    d.draw(ctx, 320, 240);
    return { png: canvas.toDataURL("image/png"), time: d.time };
  }, state);
  if (shot.time !== 0) throw new Error(`dri ${state}: the shot drew at d.time ${shot.time}`);
  writeFileSync(`${out}/${file}.png`, Buffer.from(shot.png.split(",")[1], "base64"));
  console.log(`shot ${state}`);
  if (state === "digivolve" || state === "chart") {
    const captured = await captureDrawSequence(state);
    sequences[state] = captured.seq;
    clocks[state] = captured.clock;
    console.log(`captured ${sequences[state].length}-call draw sequence for ${state}`);
  }
}

// The one clock-derived clip in these two states must be frame 0 of the SHARED
// Digimon-picture reader, and frame 0 must actually differ from frame 1 -- otherwise
// this proves nothing about the clock being frozen.
for (const [state, c] of Object.entries(clocks)) {
  if (c.time !== 0) throw new Error(`dri ${state}: d.time was ${c.time} during the capture`);
  if (c.frame0 == null || c.frame1 == null)
    throw new Error(`dri ${state}: the lead (${c.lead}) has no shared turning-picture row`);
  if (c.frame0 === c.frame1)
    throw new Error(`dri ${state}: frame 0 and frame 1 of the shared reader agree, so the `
      + `frozen-clock assertion (${c.frame0}) cannot fail`);
}

// ---- Scrolling-backdrop check ----
// The lab wall is stdglabo clip 0x37 drawn at (counter, counter), where the
// counter advances every SECOND vsync and wraps at 0x60 (F0x8008ed0c):
// +0.5px/vsync down-right, one 96px loop. drawPackBackdrop() renders that as a
// repeating pattern fill, so the drawImage/fillText sequence recorder above is
// blind to it — assert it on pixels instead. PAL 50Hz => 25px/s, so t=0.4s is
// exactly +10px and t=3.84s is exactly one full period.
const scroll = await page.evaluate(() => {
  const d = window.__dri;
  d.openState("root", window.__state, window.__battle);
  d.cursor = 0;
  const canvas = document.querySelector("canvas#game");
  const ctx = canvas.getContext("2d");
  // A window that is plain wall on the root screen (the options sit right).
  const BOX = { x: 8, y: 120, w: 100, h: 80 };
  const grab = (t, dx = 0, dy = 0) => {
    d.time = t;
    d.draw(ctx, 320, 240);
    return [...ctx.getImageData(BOX.x + dx, BOX.y + dy, BOX.w, BOX.h).data];
  };
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const base = grab(0);
  const moved = grab(0.4);                 // +10px, same coordinates
  const shifted = grab(0.4, 10, 10);       // +10px, sampled 10px further along
  const looped = grab(96 / 25);            // one full 96px period later
  return {
    moves: !same(base, moved),
    shiftMatches: same(base, shifted),
    periodMatches: same(base, looped),
    nonBlank: new Set(base).size > 1,
  };
});
if (!scroll.nonBlank) throw new Error("dri backdrop sample region is blank - fixture/box is wrong");
if (!scroll.moves) throw new Error("dri backdrop does not scroll: t=0 and t=0.4s are identical");
if (!scroll.shiftMatches)
  throw new Error("dri backdrop scroll is not the decoded +1px/2vsync diagonal (10px at t=0.4s)");
if (!scroll.periodMatches)
  throw new Error("dri backdrop scroll period is not the decoded 96px");
console.log("backdrop scrolls down-right at the decoded rate (10px @ 0.4s, 96px period)");

// ---- Ordered draw-call regression check (s3 "digivolve", s6 "chart") ----
if (UPDATE_BASELINE) {
  mkdirSync(path.dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify(sequences, null, 2) + "\n");
  console.log(`wrote baseline -> ${BASELINE}`);
} else if (existsSync(BASELINE)) {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  for (const state of Object.keys(sequences)) {
    const got = JSON.stringify(sequences[state]);
    const want = JSON.stringify(baseline[state] ?? null);
    if (got !== want) {
      throw new Error(
        `dri draw-call sequence regression on "${state}": ${sequences[state].length} calls captured, ` +
        `differs from tests/fixtures/dri-draw-sequence.json (rerun with --update-baseline if intentional)`);
    }
  }
  console.log("draw-call sequence matches baseline for digivolve + chart");
} else {
  console.log(`no baseline at ${BASELINE} yet — rerun with --update-baseline to create one`);
}

// Exercise the same key-driven mutations the launcher uses.
await page.evaluate(() => {
  const s = window.__state;
  const d = window.__dri;
  // The digivolve Select Action submenu folds its own windows open before it
  // takes input, and shuts them before a child runs (F0x8008820c / F0x80087600).
  const settleMenu = () => {
    for (let i = 0; i < 20 && d.folds && Object.values(d.folds).some((f) => f.active); i++) d.update(0.02);
  };
  const fixture = () => {
    s.party = ["p009rena", "p003pken", "p004kogu"];
    s.partyStats = [null, null, null];
    s.equipment = [{}, {}, {}];
    s.partnerStats = {
      digimonId: 7, level: 99, hp: 9999, maxHp: 9999, mp: 9999, maxMp: 9999,
      stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 },
      bonuses: {}, elemBonuses: {},
      // Kyubimon, Taomon and Sakuyamon are reached and slotted, so the standing
      // list is four rows: three forms plus "Do nothing." (esdglabo 0x23).
      equippedForms: [15, 27, 39],
      formLedger: [
        { id: 15, formLevel: 99, dvexp: 0, techSlots: [0x2069, 0, 0, 0, 0, 0] },
        { id: 27, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
        { id: 39, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
        // A fourth acquired form: the Change-type row needs >= 4 (F0x80087600).
        { id: 41, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
      ],
    };
    s.rosterOwned = 0xff;
    s.reserveStats = {};
    s.charId = "p009rena";
    s.charIdx = s.manifest.characters.findIndex((c) => c.id === s.charId);
    d.feedback = null;
    d.prompt = null;
  };

  // --- Switch: the second list is the RESERVE, not the deployed three
  // (claim PARTY-C004), so the incoming partner comes from d.reserveRows().
  fixture();
  d.openAction(0, s, window.__battle);
  d.handleKey("circle");            // pick the lead slot -> reserve list, folds open
  const waiting = d.reserveRows();
  if (!waiting.length) throw new Error("DRI Switch offered nobody waiting");
  // The confirm panel folds open before it takes input (F0x8008b798 cases 1-3).
  for (let i = 0; i < 16 && d.folds && Object.values(d.folds).some((f) => f.active); i++) d.update(0.02);
  d.cursor = 0;
  d.handleKey("circle");            // confirm -> the swap waits for the shut folds
  for (let i = 0; i < 16 && d.screen === "switch_to"; i++) d.update(0.02);
  if (s.party[0] !== waiting[0].charId)
    throw new Error(`DRI Switch left slot 0 as ${s.party[0]}`);

  // --- Change digivolve type: under four acquired forms the row is refused
  // (F0x80087600 case 2 writes esdglabo 0x24 "Can't change digivolve.").
  fixture();
  s.partnerStats.formLedger = s.partnerStats.formLedger.slice(0, 3);
  d.openAction(1, s, window.__battle);
  d.handleKey("circle");            // picker -> Select Action submenu
  settleMenu();                     // the submenu windows fold open
  d.handleKey("circle");            // "Change digivolve type." with 3 forms
  if (d.screen !== "digivolve_menu" || d.feedback !== "Can't change digivolve.")
    throw new Error(`DRI Change type with 3 forms: screen ${d.screen} feedback ${d.feedback}`);

  // --- Change digivolve type: the acquired grid writes an equipped slot.
  fixture();
  s.partnerStats.equippedForms = [];
  d.openAction(1, s, window.__battle);
  d.handleKey("circle");            // picker -> Select Action submenu
  settleMenu();                     // the submenu windows fold open
  d.handleKey("circle");            // "Change digivolve type." -> shut, then grid
  // The submenu shuts first, then the grid folds in on entry (fold +0xDC).
  for (let i = 0; i < 24 && (!d.gridFold || d.gridFold.active); i++) d.update(0.02);
  d.handleKey("circle");            // slot the first acquired form
  if (!(s.partnerStats.equippedForms ?? []).map(Number).includes(15))
    throw new Error(`DRI Change digivolve type slotted ${s.partnerStats.equippedForms}`);

  // --- The standing list: three rows visible over four entries, so the window
  // holds until the bottom row and then scrolls (F0x8008e018 case 2).
  fixture();
  d.openAction(1, s, window.__battle);
  d.selectedPartner = 0;
  d.screen = "digivolve";
  d.cursor = 0;
  d.scroll = 0;
  d.handleKey("circle");            // stand as Kyubimon
  if (s.partnerStats.digimonId !== 15)
    throw new Error(`DRI standing list left form id ${s.partnerStats.digimonId}`);

  // --- Load technique: a Yes/No prompt, then the loaded flag on the slot.
  d.feedback = null;
  d.openAction(1, s, window.__battle);
  d.handleKey("circle");            // picker -> submenu
  settleMenu();                     // the submenu windows fold open
  d.handleKey("arrowdown");
  d.handleKey("circle");            // "Load technique." -> shut, then chooser
  for (let i = 0; i < 24 && d.screen !== "load_tech"; i++) d.update(0.02);
  d.handleKey("circle");            // ask
  if (d.prompt?.message !== "Load?")
    throw new Error("DRI Load technique did not raise the Yes/No prompt");
  d.handleKey("circle");            // answer Yes
  const record = (s.partnerStats.formLedger ?? []).find((r) => Number(r.id) === 15);
  if (!(Number(record?.techSlots?.[0]) & 0x4000))
    throw new Error("DRI Load technique did not set the loaded flag");

  // --- Walk the standing list to its fourth row and back to "Do nothing.".
  d.feedback = null;
  d.openAction(1, s, window.__battle);
  d.selectedPartner = 0;
  d.screen = "digivolve";
  d.cursor = 0;
  d.scroll = 0;
  d.handleKey("arrowdown");
  d.handleKey("arrowdown");
  if (d.cursor !== 2 || d.scroll !== 0)
    throw new Error(`DRI list scrolled early at cursor ${d.cursor}, top ${d.scroll}`);
  d.handleKey("arrowdown");
  if (d.cursor !== 3 || d.scroll !== 1)
    throw new Error(`DRI list did not scroll: cursor ${d.cursor}, top ${d.scroll}`);
  d.handleKey("arrowdown");
  if (d.cursor !== 3 || d.scroll !== 1)
    throw new Error(`DRI list ran past its last row: cursor ${d.cursor}`);
  d.handleKey("circle");            // "Do nothing." returns them to the rookie
  if (s.partnerStats.digimonId !== 7)
    throw new Error(`"Do nothing." left form id ${s.partnerStats.digimonId}`);
});
console.log("asserted Switch, Change type, standing list, Load technique and the three-row window");

await browser.close();
console.log("done ->", out);
