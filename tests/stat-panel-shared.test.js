// The thirteen-number panel is one walk (engine/dw3/ui/stat-panel.ts) behind four
// screens. This drives the three screens a player meets — the pause STATUS sheet,
// the gym's left plate and the Digimon Lab's partner detail — from ONE stat block
// and checks that they put the same thirteen numbers in front of the player, and
// that the only difference is the gym's missing 999 cap, which the original's
// F0x80084064 really does not have.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { statusStatsFill } from "../engine/dw3/ui/native/pause-status.ts";
import { gymStatReadoutsFill } from "../engine/dw3/ui/gym-hud.ts";
import { labDetailFill } from "../engine/dw3/ui/native/lab-detail.ts";
import { STAT_PANEL_CAP } from "../engine/dw3/ui/stat-panel.ts";

/** A block with thirteen numbers that straddle the cap, plus the three flags. */
const BLOCK = [
  /* 0 level */ 12, /* 1 tp */ 340, /* 2 hp */ 900, /* 3 hp max */ 1200,
  /* 4 mp */ 88, /* 5 mp max */ 120,
  /* 6..11 the six core stats */ 48, 44, 41, 34, 1200, 33,
  /* 12..18 the seven elements */ 85, 125, 80, 80, 115, 100, 95,
  /* 19, 20, 21 the three flags */ 1, 0, 3,
];
const CORE = BLOCK.slice(6, 12);
const ELEMENTS = BLOCK.slice(12, 19);

/** Byte-addressed memory: the three fills read and write halfwords, so words must
 *  not be allowed to straddle. */
function fakeMemory(words) {
  const bytes = new Map();
  const byte = (addr) => bytes.get(addr >>> 0) ?? 0;
  const put = (addr, value) => bytes.set(addr >>> 0, value & 0xff);
  for (const [addr, value] of words) {
    for (let i = 0; i < 4; i++) put(addr + i, (value >>> (8 * i)) & 0xff);
  }
  const read = (addr, n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v += byte(addr + i) * 2 ** (8 * i);
    return v >>> 0;
  };
  return {
    read8: (a) => byte(a),
    read16: (a) => read(a, 2),
    read16s: (a) => ((read(a, 2) << 16) >> 16),
    read32: (a) => read(a, 4),
    write8: (a, v) => put(a, v),
    write16: (a, v) => { put(a, v); put(a + 1, v >>> 8); },
    write32: (a, v) => { for (let i = 0; i < 4; i++) put(a + i, (v >>> (8 * i)) & 0xff); },
    bytes,
  };
}

// ── the pause STATUS sheet (F0x8008C1C0) ─────────────────────────────────────────────────────
function pauseNumbers(block) {
  const OBJ = 0x81000000, UI = 0x81001000, SCRATCH = 0x81002000;
  const words = [];
  for (let i = 0; i < 13; i++) words.push([UI + 0xd0 + i * 4, 0x10000 + i * 4]);
  words.push([UI + 0x104, 0x10200], [UI + 0x108, 0x10204], [OBJ + 0x7c, 0]);
  const mem = fakeMemory(words);
  const log = [];
  const host = {
    scratch: () => SCRATCH,
    languageBank: (id) => id,
    callMethod: (target, slot, args) => log.push([target, slot, ...args]),
    cards: {
      rosterSlot: () => 0,
      copyStats: (slot, dest) => {
        for (let i = 0; i < 0x2c; i += 2) mem.write16(dest + i, block[i / 2]);
      },
      widgetMeasure: () => {},
    },
  };
  statusStatsFill(mem, OBJ, UI, 1, host);
  const out = [];
  for (let i = 0; i < 13; i++) out.push(log.find(([t, s]) => t === 0x10000 + i * 4 && s === 0x118)?.[3]);
  return { numbers: out, marks: log.filter(([, s]) => s === 0x138).map(([t, , code]) => [t - 0x10000, code]) };
}

// ── the gym's left plate (F0x80084064) ──────────────────────────────────────────────────────
function gymNumbers(block) {
  const SCREEN = 0x81000000, HUD = 0x81001000, PROJ = 0x81002000;
  const words = [];
  for (let i = 0; i < 13; i++) words.push([HUD + (i < 6 ? 0x2c : 0x44) + (i < 6 ? i : i - 6) * 4, 0x10000 + i * 4]);
  words.push([SCREEN + 0x68, 0]);
  const mem = fakeMemory(words);
  const log = [];
  const host = {
    rosterSlot: () => 0,
    copyProjection: (slot, dest) => {
      for (let i = 0; i < 0x2c; i += 2) mem.write16(dest + i, block[i / 2]);
    },
    widgetSetLineNumber: (widget, line, value) => log.push([widget, value]),
    widgetMeasure: () => {},
    widgetSetC0: (widget, code) => log.push([widget, "c0", code]),
  };
  gymStatReadoutsFill(mem, SCREEN, HUD, 1, host, PROJ);
  const out = [];
  for (let i = 0; i < 13; i++) out.push(log.find(([t]) => t === 0x10000 + i * 4)?.[1]);
  return { numbers: out, marks: log.filter(([, k]) => k === "c0" && typeof log !== "string").length };
}

// ── the Digimon Lab's partner detail (F0x80087248) ─────────────────────────────────────────
function labNumbers(block) {
  const SELF = 0x81000000, AUX = 0x81001000, STATS = 0x81002000;
  const words = [[SELF + 0x50, 0x81003000], [SELF + 0x24, AUX], [SELF + 0x20, 0x18]];
  // AUX+0x00 is the title; the thirteen numbers are AUX+0x04..AUX+0x34.
  for (let i = 0; i < 0x18; i++) words.push([AUX + i * 4, 0x10000 + i * 4]);
  words.push([0x8005cca8, 0x80050000]);
  const mem = fakeMemory(words);
  const log = [];
  const host = {
    scratch: () => STATS,
    effectiveStats: (slot, dest) => {
      for (let i = 0; i < 0x2c; i += 2) mem.write16(dest + i, block[i / 2]);
    },
    partnerSlot: () => 0,
    textBank: (id) => id,
    callMethod: (target, slot, args) => log.push([target, slot, ...args]),
    profileRecord: () => 0,
  };
  labDetailFill(mem, SELF, AUX, 1, host);
  const out = [];
  for (let i = 0; i < 13; i++) out.push(log.find(([t, s]) => t === 0x10000 + (i + 1) * 4 && s === 0x118)?.[3]);
  return {
    numbers: out,
    marks: log.filter(([, s]) => s === 0x138).map(([t, , code]) => [(t - 0x10000) / 4 - 1, code]),
  };
}

test("the pause sheet, the gym plate and the Lab detail show the same thirteen numbers", () => {
  const pause = pauseNumbers(BLOCK);
  assert.equal(pause.numbers.length, 13);
  const gym = gymNumbers(BLOCK);
  const lab = labNumbers(BLOCK);
  assert.deepEqual(pause.numbers.slice(0, 6), CORE.map((v) => (v >= 1000 ? STAT_PANEL_CAP : v)));
  assert.deepEqual(pause.numbers.slice(6), ELEMENTS);
  assert.deepEqual(lab.numbers, pause.numbers, "the Lab detail and the pause sheet are the same block, capped");
  // The gym is the one screen with no 999 cap: it shows the block's own value.
  assert.deepEqual(gym.numbers.slice(0, 6), CORE);
  assert.deepEqual(gym.numbers.slice(6), ELEMENTS);
});

test("only the capped screens hold a number at 999", () => {
  const capped = [999, 1000, 5000].map((value) => pauseNumbers([...BLOCK.slice(0, 6), value, ...BLOCK.slice(7)]).numbers[0]);
  assert.deepEqual(capped, [999, STAT_PANEL_CAP, STAT_PANEL_CAP]);
  const gym = [999, 1000, 5000].map((value) => gymNumbers([...BLOCK.slice(0, 6), value, ...BLOCK.slice(7)]).numbers[0]);
  assert.deepEqual(gym, [999, 1000, 5000], "F0x80084064 never compares the value against 999");
});

test("the three grey marks land on the same three widgets in all three screens", () => {
  const flags = [...BLOCK.slice(0, 19), 1, 1, 1];
  // The three flagged numbers are widgets 0 (STR), 1 (DEF) and 4 (SPD).
  const greyed = pauseNumbers(flags).marks.filter(([, code]) => code === 6).map(([w]) => w / 4);
  assert.deepEqual(greyed, [0, 1, 4]);
  const labGreyed = labNumbers(flags).marks.filter(([, code]) => code === 6).map(([w]) => w);
  assert.deepEqual(labGreyed, [0, 1, 4]);
});
// ── one walk, four callers ────────────────────────────────────────────────────────────────
// The behaviour above is what the screens owe the player. This is the shape of the
// fix: the numbers live in engine/dw3/ui/stat-panel.ts and each screen is a caller,
// so the next screen that wants the panel gets the walk instead of a fifth copy.
const CALLERS = [
  "engine/dw3/ui/native/pause-status.ts",
  "engine/dw3/ui/gym-hud.ts",
  "engine/dw3/ui/native/lab-detail.ts",
  "engine/dw3/ui/native/lab-roster.ts",
];

test("the four screens are callers of the one walk, not copies of it", () => {
  for (const file of CALLERS) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /import \{[^}]*fillStatPanel[^}]*\} from "\.\.?\/stat-panel\.ts";/,
      `${file} must take the walk from ui/stat-panel.ts`);
    assert.equal(source.match(/fillStatPanel\(/g)?.length, 1, `${file} calls it once`);
    // The panel's own numbers must not be re-declared: a caller that walks the
    // block's halfwords itself is a copy again. (pause-status.ts keeps a `clamp`
    // for the equipment preview's delta marks, F0x8008C460, which is not the
    // panel, and that is the only 0x3e8 left outside the walk.)
    assert.doesNotMatch(source, /STAT_PANEL_OFFSET|STAT_FLAG_OFFSETS/,
      `${file} must not re-declare the panel's block layout`);
  }
  const walk = readFileSync(new URL("../engine/dw3/ui/stat-panel.ts", import.meta.url), "utf8");
  assert.match(walk, /STAT_PANEL_CAP = 999/, "the one cap lives in the shared walk");
  for (const routine of ["F0x8008C1C0", "F0x80084064", "F0x80087248", "F0x8008D9BC"]) {
    assert.ok(walk.includes(routine), `the walk names the original it came from: ${routine}`);
  }
});
