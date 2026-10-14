// tests/lane-b/wfightmn-phase-machine.test.js
//
// ORACLE FOR THE wfightmn #2 PHASE MACHINE (the battle's opening pipeline).
//
// The strongest check drives the ORIGINAL controller `F0x800a6c44` out of the committed
// overlay image and reads the original's own state writes, exactly as
// battle-action-sequencer.test.js drives the secondary sequencer:
//   - dispatch: with ctx+0x0c == 0 and ctx+0x10 == 2 the controller runs its 7-entry
//     phase table at file 0x01c (RAM 0x800a5dfc); for each phase the handler the original
//     jumps to is compared with the table word.
//   - transitions: each handler runs for real against the real resident base-task state
//     methods (ctx+0x38/+0x3c/+0x40 = F0x800142ac/c8/e0, exe/fns.s:4769-4793), so the
//     phase word ctx+0x14 after one pass is the original's own transition, not ours.
//
// The phases and their transitions are named in
//   .dw3-research/turn-loop-phases-2026-10-07/worker-aa.md
// and added to docs/research/battle/wfightmn-overlay-map.md. This file is the
// failing-if-wrong test a port of the machine is written against.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not assert anything about web/battle.js and
// does not change it. The walker's 16-value ST machine is NOT this 7-phase machine; the
// disagreements are written down in DISAGREEMENTS below, each with the case that exposes
// it, but the walker's behaviour is left alone (the brief for this task forbids changing
// it). The runner hook a later port would need is noted at the bottom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NativeStageRuntime } from "../../engine/native/runtime.ts";

const here = dirname(fileURLToPath(import.meta.url));
const screens = join(resolve(here, "../.."), "web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(screens, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(screens, "pro_fightstg.bin")));
const wfightBytes = readFileSync(join(screens, "pro_wfightmn.bin"));
const wfight = new Uint8Array(wfightBytes);
const wdv = new DataView(wfightBytes.buffer, wfightBytes.byteOffset, wfightBytes.byteLength);
const FIGHT_BASE = 0x80082cb0;
const WA_BASE = 0x800a5de0;

/** The controller entry (F0x800a6c44, file 0xe64). Its #2 arm is at file 0xf60. */
const CTRL = 0x800a6c44;
/** The 7-entry phase table, file 0x01c (wfightmn.s:13-19). */
const TABLE = 0x800a5dfc;
/** The dispatcher's out-of-range target, file 0xf90 (wfightmn.s:994). */
const DEFAULT_HANDLER = 0x800a6d70;

/** The 7 phases: index -> handler RAM, file offset, and the name worker-aa gave it. */
const PHASES = [
  { phase: 0, addr: 0x800a6d70, file: 0xf90, name: "assembleBattleObjects" },
  { phase: 1, addr: 0x800a6dbc, file: 0xfdc, name: "loadEncounterAndFighters" },
  { phase: 2, addr: 0x800a7030, file: 0x1250, name: "queueBattleOverlay" },
  { phase: 3, addr: 0x800a7048, file: 0x1268, name: "awaitOverlay" },
  { phase: 4, addr: 0x800a7060, file: 0x1280, name: "sweepActionQueue" },
  { phase: 5, addr: 0x800a707c, file: 0x129c, name: "frameCameraOrOpenLine" },
  { phase: 6, addr: 0x800a7220, file: 0x1440, name: "awaitLineThenHandOff" },
];

/** The resident base-task state methods the ctx method slots point at (exe/fns.s). */
const BASE_METHODS = { 0x28: 0x80014274, 0x2c: 0x80014288, 0x30: 0x80014298,
  0x34: 0x800142a4, 0x38: 0x800142ac, 0x3c: 0x800142c8, 0x40: 0x800142e0 };

// scratch blocks (outside every loaded image)
const CTX = 0x80140000;    // the battle controller object (the task)
const BLOCK = 0x80140100;  // the controller's child-pointer block (arg1)
const HUD = 0x80140200;    // the object at block+0x14 (the HUD text setter, phase 1)
const WINDOW = 0x80140300; // the object at block+0x1C (the message window, phase 5/6)
const OBJ = 0x80140400;    // what [0x800A4600] returns in phase 5's else branch
const STUB = 0x0fe80000;   // recorder/return stubs

const word = (a) => wdv.getUint32(a - WA_BASE, true) >>> 0;

const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

function runtime() {
  const rt = new NativeStageRuntime(fight, entry,
    { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, FIGHT_BASE, { image: resident, base: 0x80010000 });
  rt.mem.load(wfight, WA_BASE);
  const inner = rt.cpu.execGuard;
  rt.cpu.execGuard = (pc) => inner(pc) || (pc >= WA_BASE && pc < WA_BASE + wfight.length);
  rt.cpu.gp = 0x8005cb50;
  return rt;
}

/** The canned RAM the controller reads before anything runs. */
function seed(rt, { phase = 0, top = 0, sub = 2, linePending = 0, overlay = 0, window = 0 } = {}) {
  const m = rt.mem;
  for (let a = 0x80140000; a < 0x80150000; a += 4) m.write32(a, 0);
  for (const [off, fn] of Object.entries(BASE_METHODS)) m.write32(CTX + Number(off), fn >>> 0);
  m.write32(CTX + 0x0c, top | 0);          // top state (the controller's +0x0c)
  m.write32(CTX + 0x10, sub | 0);          // sub-state 2 selects the phase machine
  m.write32(CTX + 0x14, phase | 0);        // the phase word the dispatcher reads
  m.write32(CTX + 0x18, linePending | 0);  // the "opening line pending" flag
  m.write32(CTX + 0x50, 0);
  m.write32(CTX + 0x70, 0);
  m.write32(BLOCK + 0x00, overlay | 0);    // phase 2 stores the overlay handle here
  m.write32(BLOCK + 0x14, HUD);
  m.write32(BLOCK + 0x1C, window | 0);
  return m;
}

/** One pass of the original controller; returns the phase word it left behind. */
function pass(rt, opts) {
  seed(rt, opts);
  rt.cpu.call(CTRL, [CTX, BLOCK], 200000);
  return { phase: rt.mem.read32(CTX + 0x14) | 0, top: rt.mem.read32(CTX + 0x0c) | 0,
    sub: rt.mem.read32(CTX + 0x10) | 0 };
}

// ── 1. The 7-entry phase table is the disc's own words ──────────────────────

test("the #2 phase table at file 0x01c is the disc's 7 handler addresses", () => {
  assert.equal(CTRL - WA_BASE, 0xe64, "the controller opens at file 0xe64");
  // the dispatcher is at file 0xf60 and loads the table from 0x800a5dfc
  // (wfightmn.s:993-1000: `sltiu $v0,$v1,0x7` / `addiu $v0,0x5dfc` / `jr $v0`).
  assert.equal(word(CTRL + 0xfc), 0x8e430014, "file 0xf60: lw $v1, 0x14($s2) — the dispatcher reads the phase");
  assert.equal(word(CTRL + 0x104), 0x2c620007, "file 0xf68: sltiu $v0, $v1, 7");
  for (const p of PHASES) {
    assert.equal(word(TABLE + p.phase * 4), p.addr,
      `phase ${p.phase} (${p.name}) table word`);
  }
  // out of range falls to file 0xf90, which is phase 0's own handler
  assert.equal(DEFAULT_HANDLER, PHASES[0].addr, "the default target is phase 0's handler");
});

// ── 2. Dispatch: ctx+0x14 selects the table's handler, out-of-range the default ──

test("the original controller routes ctx+0x14 through the 7-phase table", () => {
  const rt = runtime();
  const fired = [];
  for (const p of PHASES) rt.cpu.setStub(p.addr, () => { fired.push(p.addr); return 0; });
  for (const p of [...PHASES, { phase: 7 }, { phase: 0xffff }]) {
    fired.length = 0;
    seed(rt, { phase: p.phase });
    rt.cpu.call(CTRL, [CTX, BLOCK], 4000);
    const want = p.addr ?? DEFAULT_HANDLER;
    assert.deepEqual(fired, [want], `phase ${p.phase} enters 0x${want.toString(16)}`);
  }
});

// ── 3. Each phase's own transition, read off the original's state writes ─────

test("phase 0 assembleBattleObjects: builds the 5 objects, advances 0->1", () => {
  const rt = runtime();
  const m = rt.mem;
  const rets = new Map([[0x80092d50, 0xa1], [0x80092618, 0xa2], [0x800869a8, 0xa3],
    [0x80088054, 0xa4], [0x8008b0b8, 0xa5]]);
  for (const [a, v] of rets) rt.cpu.setStub(a, () => v);
  const r = pass(rt, { phase: 0 });
  assert.equal(r.phase, 1, "phase 0 advances to 1 via ctx->+0x40 (F0x800142e0)");
  assert.equal(m.read32(BLOCK + 0x04) | 0, 0xa1, "block+0x04 = the 0x80092D50 object");
  assert.equal(m.read32(BLOCK + 0x08) | 0, 0xa2, "block+0x08 = the 0x80092618 object");
  assert.equal(m.read32(BLOCK + 0x10) | 0, 0xa3, "block+0x10 = the 0x800869A8 object");
  assert.equal(m.read32(BLOCK + 0x14) | 0, 0xa4, "block+0x14 = the 0x80088054 object");
  assert.equal(m.read32(BLOCK + 0x0c) | 0, 0xa5, "block+0x0c = the 0x8008B0B8 object");
});

test("phase 1 loadEncounterAndFighters: reads the encounter, arms the line, advances 1->2", () => {
  const rt = runtime();
  const m = rt.mem;
  // the battle-id cell holds a function pointer; the encounter index cells likewise
  const cells = { 0x8004b448: STUB + 0x10, 0x8004b44c: STUB + 0x20, 0x8004b46c: STUB + 0x30 };
  for (const [cell, fn] of Object.entries(cells)) { m.write32(Number(cell), fn); rt.cpu.setStub(fn, () => 0); }
  rt.cpu.setStub(0x800a684c, () => 0);   // the intro chance roll
  rt.cpu.setStub(0x800a66b0, () => 0);   // the combatant-table loader
  rt.cpu.setStub(0x800a246c, () => 0x246c0); // the intro object
  for (const off of [0x184, 0x194, 0x198]) { m.write32(HUD + off, STUB + 0x40 + off); rt.cpu.setStub(STUB + 0x40 + off, () => 0); }
  const r = pass(rt, { phase: 1 });
  assert.equal(r.phase, 2, "phase 1 advances to 2");
  assert.equal(m.read32(BLOCK + 0x18) >>> 0, 0x246c0, "block+0x18 = the armed intro object 0x800A246C()");
  assert.equal(m.read32(0x8004de28) | 0, 1, "[0x8004DE28] armed");
});

test("phase 2 queueBattleOverlay: stores the overlay handle, advances 2->3", () => {
  const rt = runtime();
  rt.cpu.setStub(0x800a6414, () => 0x6414f);
  const r = pass(rt, { phase: 2 });
  assert.equal(r.phase, 3, "phase 2 advances to 3");
  assert.equal(rt.mem.read32(BLOCK + 0x00) | 0, 0x6414f, "block+0x00 = F0x800a6414()'s handle");
  assert.equal(rt.mem.read32(0x8004de28) | 0, 1, "[0x8004DE28] armed");
});

test("phase 3 awaitOverlay: waits while block+0 != 0, then advances 3->4", () => {
  const rt = runtime();
  assert.equal(pass(rt, { phase: 3, overlay: 0 }).phase, 4, "cleared handle advances to 4");
  assert.equal(pass(rt, { phase: 3, overlay: 0x1234 }).phase, 3, "held handle stays in 3");
});

test("phase 4 sweepActionQueue: calls the sweep, advances 4->5", () => {
  const rt = runtime();
  let fired = 0;
  rt.cpu.setStub(0x800a69f0, () => { fired++; return 0; });
  const r = pass(rt, { phase: 4 });
  assert.equal(r.phase, 5, "phase 4 advances to 5");
  assert.equal(fired, 1, "F0x800a69f0 swept once");
});

test("phase 5 frameCameraOrOpenLine: line pending -> open it, advance 5->6", () => {
  const rt = runtime();
  const m = rt.mem;
  m.write32(0x800a437c, STUB + 0x50); rt.cpu.setStub(STUB + 0x50, () => 0);
  for (const a of [0x8009c4f8, 0x8009c4bc, 0x80092d80, 0x800a69b8]) rt.cpu.setStub(a, () => 0);
  rt.cpu.setStub(0x8009a298, () => WINDOW);
  m.write32(WINDOW + 0xac, STUB + 0x60); rt.cpu.setStub(STUB + 0x60, () => 0);
  const r = pass(rt, { phase: 5, linePending: 1 });
  assert.equal(r.phase, 6, "with the line pending, phase 5 advances to 6");
  assert.equal(m.read32(CTX + 0x50) | 0, 7, "ctx+0x50 = 7 (the line's kind word)");
  assert.equal(m.read32(BLOCK + 0x1c) >>> 0, WINDOW, "block+0x1C = the message window");
});

test("phase 5 frameCameraOrOpenLine: no line -> camera beat + exit the machine", () => {
  const rt = runtime();
  const m = rt.mem;
  m.write32(0x800a437c, STUB + 0x50); rt.cpu.setStub(STUB + 0x50, () => 0);
  m.write32(0x800a4600, STUB + 0x70);
  rt.cpu.setStub(STUB + 0x70, () => { m.write32(OBJ + 0x0a, 1); return OBJ; });
  m.write32(0x8004dc0c, STUB + 0x80); rt.cpu.setStub(STUB + 0x80, () => 0);
  for (const a of [0x8009c4f8, 0x8009c4bc, 0x80092d80, 0x800a69b8]) rt.cpu.setStub(a, () => 0);
  const r = pass(rt, { phase: 5, linePending: 0 });
  assert.equal(r.top, 1, "no line: ctx->+0x38 (F0x800142ac) advances the top state to 1");
  assert.equal(r.phase, 0, "and clears the phase word to 0");
  assert.equal(r.sub, 0, "and clears the sub-state to 0");
});

test("phase 6 awaitLineThenHandOff: exits once block+0x1C clears", () => {
  const rt = runtime();
  assert.equal(pass(rt, { phase: 6, window: 0 }).top, 1, "window done: top state -> 1");
  const held = pass(rt, { phase: 6, window: 0x1234 });
  assert.equal(held.top, 0, "window still open: top state unchanged");
  assert.equal(held.phase, 6, "and the machine waits in phase 6");
});

// ── 3b. The transition mechanism is the disc's own bytes ────────────────────

test("the phase advance and the two exits are the disc's own words", () => {
  // the shared advance tail at file 0x1288: phase = phase + 1 (used by phases 1,2,4)
  assert.equal(word(0x800a7068), 0x8e420014, "lw $v0, 0x14($s2) — read the phase");
  assert.equal(word(0x800a7070), 0x24420001, "addiu $v0, 1");
  assert.equal(word(0x800a7078), 0xae420014, "sw $v0, 0x14($s2) — write the phase");
  // phase 0 ends by calling ctx->+0x40 (F0x800142e0 = phase+1, clear +0x18)
  assert.equal(word(0x800a6db0), 0x8e420040, "phase 0: lw $v0, 0x40($s2) at file 0xfd0");
  assert.equal(word(0x800a7234), 0x00000000, "the shared ++phase tail is reached by a jump");
  assert.equal(word(0x800a7238), 0x0040f809, "… and calls the method it loaded: jalr $v0");
  // phase 6 reads block+0x1C then exits via ctx->+0x38 (F0x800142ac = top+1)
  assert.equal(word(0x800a7220), 0x8e62001c, "phase 6: lw $v0, 0x1c($s3)");
  assert.equal(word(0x800a7230), 0x8e420038, "phase 6: lw $v0, 0x38($s2)");
});

// ── 4. The disagreement list the port must close (walker ST vs the original) ──

/**
 * The walker's own state machine (web/battle.js:680) is a FLAT 16-value enum that
 * stands in for the original's THREE-LEVEL state word (ctx+0x0c top / ctx+0x10 sub /
 * ctx+0x14 phase). This array names, per #2 phase, what the walker does today and the
 * concrete case that exposes the mismatch. It is documentation-with-a-guard: the test
 * below keeps every phase mapped, so a later port cannot silently drop one.
 */
const DISAGREEMENTS = [
  { phase: 0, walker: "INTRO (ST.INTRO=1, b.timer>1.2 -> PLAYER_MENU)",
    disagreement: "the walker's INTRO is a 1.2s timer; the original's phase 0 builds five sub-objects and hands to phase 1 through ctx->+0x40. Case: a battle whose sub-object build takes longer than 1.2s (or fails) times the walker into the menu while the original is still in phase 0." },
  { phase: 1, walker: "the opening machine's phase 1 (loadEncounterAndFighters + the ambush roll)",
    disagreement: "the walker ports the intro-variant rule (introVariantFor) and the ambush roll F0x800a684c (ambushRoll, fed the encounter's own chance byte, the first enemy's level and the first party member's level), so the 'Ambush!' line now appears at the encounter's own rate; what it does NOT port is the ambush branch's forced opening form (table 0x8003ef5c[idx*0x58] / GAME+0x2738 / record +0x764). Case: a battle whose roll returns 1 opens the partner in the record's own opening form in the original, while the walker keeps the roster's configured form." },
  { phase: 2, walker: "no state (the walker never re-queues its own overlay)",
    disagreement: "the original's phase 2 re-queues the battle overlay (F0x800a6414) and phase 3 blocks on it; the walker has no equivalent load beat. Case: watching the frame the fight is armed — the original holds two frames in 2/3, the walker goes straight to the menu." },
  { phase: 3, walker: "no state",
    disagreement: "loading pause has no walker counterpart. Case: same as phase 2 — the frame the fight is armed; the original holds two frames in 2/3, the walker goes straight to the menu." },
  { phase: 4, walker: "no state",
    disagreement: "the queue sweep F0x800a69f0 has no walker counterpart; the walker's queue is rebuilt ad hoc. Case: a battle entered with stale queued entries — invisible in both, but the original clears them here." },
  { phase: 5, walker: "PLAYER_MENU / camera claim (ST.PLAYER_MENU, battle.js:2827-2839)",
    disagreement: "the original's phase 5 is a camera/line beat that can EXIT the machine (ctx->+0x38) when no line is pending; the walker's menu is a stable state. Case: an intro with no line pending leaves the original's phase machine immediately, while the walker still runs its INTRO-to-MENU timer." },
  { phase: 6, walker: "PLAYER_MENU (turn machinery)",
    disagreement: "the original's phase 6 hands off to the action loop behind ctx+0x0c==1 (the already-ported F0x800a9cb4); the walker's hand-off is its own PLAYER_MENU. Case: the first frame control returns — the original is inside the secondary sequencer, the walker in its menu draw." },
];

test("every #2 phase carries a named walker disagreement (no phase silently dropped)", () => {
  assert.equal(DISAGREEMENTS.length, PHASES.length, "one entry per phase");
  for (const p of PHASES) {
    const d = DISAGREEMENTS.find((x) => x.phase === p.phase);
    assert.ok(d, `phase ${p.phase} (${p.name}) mapped`);
    assert.ok(d.walker.length > 0 && d.disagreement.includes("Case:"),
      `phase ${p.phase} names its walker state and the case that exposes it`);
  }
  // the walker's own enum is flat and larger than the original's 7 phases — the reason
  // for a named disagreement list rather than a 1:1 mapping.
  assert.equal(PHASES.length, 7, "the original machine is 7 phases");
});

test("the walker ST machine this oracle disagrees with is still the one in web/battle.js", () => {
  // The disagreements above name the walker's own states and one concrete transition, so
  // pin them at the source. This does not assert the walker is right or wrong — only that
  // the machine the list describes is the one still shipped (it fails loudly if the walker
  // is refactored, so the list is revisited rather than left stale).
  const src = readFileSync(join(resolve(here, "../.."), "web/battle.js"), "utf8");
  assert.ok(/const ST = \{/.test(src), "the walker still declares its ST enum");
  for (const [name, value] of [["INTRO", 1], ["PLAYER_MENU", 2], ["PLAYER_ACT", 5],
    ["ENEMY_ACT", 6], ["RESULT_MSG", 7], ["WIN", 8], ["LOSE", 9]]) {
    assert.ok(new RegExp(`\\b${name}:\\s*${value},`).test(src), `ST.${name} = ${value}`);
  }
  // the INTRO->PLAYER_MENU 1.2s timer that phase 0's object build has no counterpart for
  assert.ok(/if \(b\.timer > 1\.2\) \{\s*b\.state = ST\.PLAYER_MENU/.test(src),
    "ST.INTRO advances on a 1.2s timer, the disagreement for phase 0");
});

// Runner hook a later port needs (ADDED by the port, 2026-10-07): `web/battle.js` now
// exports its opening-machine seam through `peek().opening` — `{ phase, phaseName, lineArmed,
// introVariant, ... }` (engine/dw3/battle-opening-machine.ts), and carries a `?legacyIntroTimer=1`
// rollback flag that restores the old flat timer verbatim. This file still pins the ORIGINAL
// only; the port is proven to match it by tests/lane-b/battle-opening-machine.test.js, which
// drives both machines through the same canned state.

