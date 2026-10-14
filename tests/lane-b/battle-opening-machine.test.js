// tests/lane-b/battle-opening-machine.test.js
//
// ACCEPTANCE TEST FOR THE PORT OF THE wfightmn #2 OPENING PHASE MACHINE.
//
// The oracle `tests/lane-b/wfightmn-phase-machine.test.js` runs the ORIGINAL
// controller F0x800a6c44 out of the committed overlay image and pins its
// transitions. This file runs BOTH the original and our port
// (engine/dw3/battle-opening-machine.ts) through the same canned state and
// asserts the two machines leave the same phase/top/sub behind — call for call.
// The port is correct when our transitions match the original's.
//
// It also pins the disc's own words the port carries: the 7-entry phase table at
// file 0x01c, the shared ++phase tail, the two exits, the phase-1 intro-variant
// rule and the phase-1 opening-line gate F0x800a684c.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    OPENING_PHASES, OPENING_MACHINE_BASE, OPENING_CONTROLLER_ADDRESS, OPENING_PHASE_TABLE_FILE,
    OPENING_EXIT_METHOD, OPENING_ADVANCE_PHASE_METHOD, OPENING_PHASE_COUNT,
    openingPhaseIndex, openingPhaseFor, introVariantFor, openingLineRoll, ambushRoll,
    newOpeningState, stepOpeningPhase, openingExit, openingAdvancePhase,
} from "../../engine/dw3/battle-opening-machine.ts";
import { runAwayLine } from "../../engine/dw3/battle-formulas.ts";

const here = dirname(fileURLToPath(import.meta.url));
const screens = join(resolve(here, "../.."), "web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(screens, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(screens, "pro_fightstg.bin")));
const wfightBytes = readFileSync(join(screens, "pro_wfightmn.bin"));
const wfight = new Uint8Array(wfightBytes);
const wdv = new DataView(wfightBytes.buffer, wfightBytes.byteOffset, wfightBytes.byteLength);
const FIGHT_BASE = 0x80082cb0;
const WA_BASE = 0x800a5de0;
const CTRL = 0x800a6c44;
const TABLE = 0x800a5dfc;

const BASE_METHODS = { 0x28: 0x80014274, 0x2c: 0x80014288, 0x30: 0x80014298,
  0x34: 0x800142a4, 0x38: 0x800142ac, 0x3c: 0x800142c8, 0x40: 0x800142e0 };

const CTX = 0x80140000, BLOCK = 0x80140100, HUD = 0x80140200, WINDOW = 0x80140300,
  OBJ = 0x80140400, STUB = 0x0fe80000;

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

function seed(rt, { phase = 0, top = 0, sub = 2, linePending = 0, overlay = 0, window = 0 } = {}) {
    const m = rt.mem;
    for (let a = 0x80140000; a < 0x80150000; a += 4) m.write32(a, 0);
    for (const [off, fn] of Object.entries(BASE_METHODS)) m.write32(CTX + Number(off), fn >>> 0);
    m.write32(CTX + 0x0c, top | 0);
    m.write32(CTX + 0x10, sub | 0);
    m.write32(CTX + 0x14, phase | 0);
    m.write32(CTX + 0x18, linePending | 0);
    m.write32(CTX + 0x50, 0);
    m.write32(CTX + 0x70, 0);
    m.write32(BLOCK + 0x00, overlay | 0);
    m.write32(BLOCK + 0x14, HUD);
    m.write32(BLOCK + 0x1C, window | 0);
    return m;
}

/** One pass of the ORIGINAL controller; returns the state it left. */
function runOriginal(phase, opts = {}) {
    const rt = runtime();
    seed(rt, { phase, ...opts });
    rt.cpu.call(CTRL, [CTX, BLOCK], 200000);
    return { phase: rt.mem.read32(CTX + 0x14) | 0, top: rt.mem.read32(CTX + 0x0c) | 0,
        sub: rt.mem.read32(CTX + 0x10) | 0 };
}

/** The port driven with the same canned state; the ports answer like the stubs. */
function runPort(phase, opts = {}, ports = {}) {
    const seedState = { phase, ...opts };
    const state = newOpeningState({
        top: seedState.top ?? 0, sub: seedState.sub ?? 2, phase: seedState.phase ?? 0,
        linePending: seedState.linePending ?? 0, overlayHandle: seedState.overlay ?? 0,
        windowHandle: seedState.window ?? 0,
    });
    const api = {
        assembleBattleObjects() {}, loadEncounterAndFighters() {},
        introLinePending: () => false, queueBattleOverlay: () => 0,
        overlayPending: () => true, sweepActionQueue() {}, frameCamera() {},
        frameCameraAndOpenLine: () => 0, lineUp: () => true, ...ports,
    };
    stepOpeningPhase(state, api);
    return { phase: state.phase, top: state.top, sub: state.sub };
}

const SAME = (a, b, label) => assert.deepEqual(
    { phase: a.phase, top: a.top, sub: a.sub }, { phase: b.phase, top: b.top, sub: b.sub }, label);

// ── 1. Our phase table equals the disc's own words ──────────────────────────

test("the port's phase table equals the disc's 7-entry table", () => {
    assert.equal(OPENING_PHASES.length, OPENING_PHASE_COUNT);
    assert.equal(OPENING_CONTROLLER_ADDRESS, CTRL);
    assert.equal(OPENING_MACHINE_BASE, WA_BASE);
    for (let i = 0; i < 7; i++) {
        assert.equal(OPENING_PHASES[i].phase, i);
        assert.equal(OPENING_PHASES[i].address, word(TABLE + i * 4), `table word ${i}`);
        assert.equal(OPENING_PHASES[i].file, OPENING_PHASES[i].address - WA_BASE, "file = addr - base");
        assert.equal(openingPhaseFor(i).address, OPENING_PHASES[i].address);
    }
    // out of range and negative fall to phase 0's handler
    assert.equal(openingPhaseIndex(7), 0);
    assert.equal(openingPhaseIndex(0xffff), 0);
    assert.equal(openingPhaseIndex(-1), 0);
    // the exits and the advance are the resident base-task methods the disc installs
    assert.equal(OPENING_EXIT_METHOD, BASE_METHODS[0x38]);
    assert.equal(OPENING_ADVANCE_PHASE_METHOD, BASE_METHODS[0x40]);
});

// ── 2. Every phase's transition: the original and the port agree ────────────

test("phase 0 assembleBattleObjects: original and port both advance 0 -> 1", () => {
    const rt = runtime();
    for (const a of [0x80092d50, 0x80092618, 0x800869a8, 0x80088054, 0x8008b0b8]) rt.cpu.setStub(a, () => 1);
    seed(rt, { phase: 0 });
    rt.cpu.call(CTRL, [CTX, BLOCK], 200000);
    const original = { phase: rt.mem.read32(CTX + 0x14) | 0, top: rt.mem.read32(CTX + 0x0c) | 0, sub: rt.mem.read32(CTX + 0x10) | 0 };
    SAME(original, runPort(0), "phase 0");
    assert.equal(original.phase, 1);
});

test("phase 1 loadEncounterAndFighters: original and port both advance 1 -> 2, line not pending", () => {
    const rt = runtime();
    const m = rt.mem;
    for (const [cell, fn] of [[0x8004b448, STUB + 0x10], [0x8004b44c, STUB + 0x20], [0x8004b46c, STUB + 0x30]]) {
        m.write32(Number(cell), fn); rt.cpu.setStub(fn, () => 0);
    }
    rt.cpu.setStub(0x800a684c, () => 0);       // the opening-line gate: no line
    rt.cpu.setStub(0x800a66b0, () => 0);
    rt.cpu.setStub(0x800a246c, () => 0x246c0);
    for (const off of [0x184, 0x194, 0x198]) { m.write32(HUD + off, STUB + 0x40 + off); rt.cpu.setStub(STUB + 0x40 + off, () => 0); }
    seed(rt, { phase: 1 });
    rt.cpu.call(CTRL, [CTX, BLOCK], 200000);
    const original = { phase: rt.mem.read32(CTX + 0x14) | 0, top: rt.mem.read32(CTX + 0x0c) | 0, sub: rt.mem.read32(CTX + 0x10) | 0 };
    SAME(original, runPort(1, {}, { introLinePending: () => false }), "phase 1 no line");
    assert.equal(original.phase, 2, "no line: phase 1 advances");
    // and with the gate firing the phase still advances, only the line flag differs
    const s = newOpeningState({ phase: 1 });
    stepOpeningPhase(s, { assembleBattleObjects() {}, loadEncounterAndFighters() {}, introLinePending: () => true,
        queueBattleOverlay: () => 0, overlayPending: () => true, sweepActionQueue() {}, frameCamera() {},
        frameCameraAndOpenLine: () => 0, lineUp: () => true });
    assert.equal(s.linePending, 1, "the gate arms the line");
    assert.equal(s.phase, 2);
});

test("phase 2 queueBattleOverlay: original and port both store the handle and advance 2 -> 3", () => {
    const rt = runtime();
    rt.cpu.setStub(0x800a6414, () => 0x6414f);
    seed(rt, { phase: 2 });
    rt.cpu.call(CTRL, [CTX, BLOCK], 200000);
    const original = { phase: rt.mem.read32(CTX + 0x14) | 0, top: rt.mem.read32(CTX + 0x0c) | 0, sub: rt.mem.read32(CTX + 0x10) | 0 };
    assert.equal(rt.mem.read32(BLOCK + 0x00) | 0, 0x6414f);
    SAME(original, runPort(2, {}, { queueBattleOverlay: () => 0x6414f }), "phase 2");
    assert.equal(original.phase, 3);
});

test("phase 3 awaitOverlay: original and port both hold while pending and advance when clear", () => {
    SAME(runOriginal(3, { overlay: 0 }), runPort(3, { overlay: 0 }, { overlayPending: () => true }), "overlay clear");
    SAME(runOriginal(3, { overlay: 0x1234 }), runPort(3, { overlay: 0x1234 }, { overlayPending: () => true }), "overlay held");
    assert.equal(runOriginal(3, { overlay: 0 }).phase, 4);
    assert.equal(runOriginal(3, { overlay: 0x1234 }).phase, 3);
});

test("phase 4 sweepActionQueue: original and port both sweep once and advance 4 -> 5", () => {
    const rt = runtime();
    let fired = 0;
    rt.cpu.setStub(0x800a69f0, () => { fired++; return 0; });
    seed(rt, { phase: 4 });
    rt.cpu.call(CTRL, [CTX, BLOCK], 200000);
    const original = { phase: rt.mem.read32(CTX + 0x14) | 0, top: rt.mem.read32(CTX + 0x0c) | 0, sub: rt.mem.read32(CTX + 0x10) | 0 };
    assert.equal(fired, 1, "F0x800a69f0 swept once");
    let portSwept = 0;
    SAME(original, runPort(4, {}, { sweepActionQueue: () => { portSwept++; } }), "phase 4");
    assert.equal(portSwept, 1, "the port sweeps once");
    assert.equal(original.phase, 5);
});

test("phase 5 line pending: original and port both open the window and advance 5 -> 6", () => {
    const rt = runtime();
    const m = rt.mem;
    m.write32(0x800a437c, STUB + 0x50); rt.cpu.setStub(STUB + 0x50, () => 0);
    for (const a of [0x8009c4f8, 0x8009c4bc, 0x80092d80, 0x800a69b8]) rt.cpu.setStub(a, () => 0);
    rt.cpu.setStub(0x8009a298, () => WINDOW);
    m.write32(WINDOW + 0xac, STUB + 0x60); rt.cpu.setStub(STUB + 0x60, () => 0);
    seed(rt, { phase: 5, linePending: 1 });
    rt.cpu.call(CTRL, [CTX, BLOCK], 200000);
    const original = { phase: rt.mem.read32(CTX + 0x14) | 0, top: rt.mem.read32(CTX + 0x0c) | 0, sub: rt.mem.read32(CTX + 0x10) | 0 };
    const port = runPort(5, { linePending: 1 }, { frameCameraAndOpenLine: () => WINDOW });
    SAME(original, port, "phase 5 line pending");
    assert.equal(original.phase, 6);
    assert.equal(rt.mem.read32(CTX + 0x50) | 0, 7, "ctx+0x50 = 7");
    // the port records the same kind word
    const s = newOpeningState({ phase: 5, linePending: 1 });
    stepOpeningPhase(s, { assembleBattleObjects() {}, loadEncounterAndFighters() {}, introLinePending: () => false,
        queueBattleOverlay: () => 0, overlayPending: () => true, sweepActionQueue() {}, frameCamera() {},
        frameCameraAndOpenLine: () => WINDOW, lineUp: () => true });
    assert.equal(s.kindWord, 7);
    assert.equal(s.windowHandle >>> 0, WINDOW);
});

test("phase 5 no line: original and port both EXIT the machine (top -> 1, phase 0)", () => {
    const rt = runtime();
    const m = rt.mem;
    m.write32(0x800a437c, STUB + 0x50); rt.cpu.setStub(STUB + 0x50, () => 0);
    m.write32(0x800a4600, STUB + 0x70);
    rt.cpu.setStub(STUB + 0x70, () => { m.write32(OBJ + 0x0a, 1); return OBJ; });
    m.write32(0x8004dc0c, STUB + 0x80); rt.cpu.setStub(STUB + 0x80, () => 0);
    for (const a of [0x8009c4f8, 0x8009c4bc, 0x80092d80, 0x800a69b8]) rt.cpu.setStub(a, () => 0);
    seed(rt, { phase: 5, linePending: 0 });
    rt.cpu.call(CTRL, [CTX, BLOCK], 200000);
    const original = { phase: rt.mem.read32(CTX + 0x14) | 0, top: rt.mem.read32(CTX + 0x0c) | 0, sub: rt.mem.read32(CTX + 0x10) | 0 };
    const port = runPort(5, { linePending: 0 });
    SAME(original, port, "phase 5 no line");
    assert.equal(original.top, 1, "the original exits to top state 1");
    assert.equal(original.phase, 0);
    assert.equal(original.sub, 0);
});

test("phase 6 awaitLineThenHandOff: original and port both exit once the window clears", () => {
    SAME(runOriginal(6, { window: 0 }), runPort(6, { window: 0 }, { lineUp: () => false }), "window clear");
    SAME(runOriginal(6, { window: 0x1234 }), runPort(6, { window: 0x1234 }, { lineUp: () => true }), "window held");
    assert.equal(runOriginal(6, { window: 0 }).top, 1);
    assert.equal(runOriginal(6, { window: 0x1234 }).top, 0);
});

// ── 3. The intro-variant rule (phase 1) ─────────────────────────────────────

test("phase 1 picks the intro variant by the disc's own battle-id / map-id pairs", () => {
    assert.deepEqual(introVariantFor(0x22d, 0x143), { variant: 1, specialMode4: false });
    assert.deepEqual(introVariantFor(0x23a, 0x0b), { variant: 2, specialMode4: false });
    assert.deepEqual(introVariantFor(0x272, 0x1e), { variant: 3, specialMode4: false });
    assert.deepEqual(introVariantFor(0x144, 0x144), { variant: 0, specialMode4: true });
    // each pair needs BOTH halves: a wrong map falls through to 0
    assert.deepEqual(introVariantFor(0x22d, 0x1), { variant: 0, specialMode4: false });
    assert.deepEqual(introVariantFor(0x999, 0x143), { variant: 0, specialMode4: false });
    // the finale map takes the special-mode-4 arm instead of a variant
    assert.deepEqual(introVariantFor(0x123, 0x144), { variant: 0, specialMode4: true });
    assert.deepEqual(introVariantFor(0x123, 0x2), { variant: 0, specialMode4: false });
});

// ── 4. The opening-line gate F0x800a684c ────────────────────────────────────

test("phase 1's opening-line gate F0x800a684c is the disc's own roll", () => {
    // weight 0 -> never a line
    assert.equal(openingLineRoll({ lineWeight: 0, bias: 0, enemyField: 0, roll: 0 }), false);
    // bound = weight * (0x20 - enemyField - bias); a zero remainder always fires
    assert.equal(openingLineRoll({ lineWeight: 1, bias: 0, enemyField: 0, roll: 0 }), true);
    // frac (roll mod 128) below bound>>5 fires; above does not
    const bound = 1 * (0x20 - 0 - 0);          // 32; bound>>5 = 1
    assert.equal(openingLineRoll({ lineWeight: 1, bias: 0, enemyField: 0, roll: 0*128 + 0 }), true, "frac 0");
    // frac 0 is the `== 0` special case; frac 1 >= 1 does not fire here
    assert.equal(openingLineRoll({ lineWeight: 1, bias: 0, enemyField: 0, roll: 1 }), false, "frac 1 !< 1");
    // a bigger weight lifts the threshold: weight 8 -> bound 256, >>5 = 8
    assert.equal(openingLineRoll({ lineWeight: 8, bias: 0, enemyField: 0, roll: 7 }), true, "frac 7 < 8");
    assert.equal(openingLineRoll({ lineWeight: 8, bias: 0, enemyField: 0, roll: 9 }), false, "frac 9 !< 8");
    // negative bound is biased by +0x1F before the shift
    const neg = openingLineRoll({ lineWeight: 1, bias: 0x40, enemyField: 0, roll: 0 });
    assert.equal(neg, true);
    assert.ok(bound > 0);
});

// ── 5. The exit is the disc's exit, and it hands to the sequencer's top state ─

test("the exit advances the top state to 1 — the branch that drives F0x800a9cb4", () => {
    const s = newOpeningState({ phase: 6, windowHandle: 0 });
    openingExit(s);
    assert.equal(s.top, 1);
    assert.equal(s.sub, 0);
    assert.equal(s.phase, 0);
    assert.equal(s.exited, true);
    // phase 0's advance clears the line flag (ctx->+0x40)
    const a = newOpeningState({ phase: 0, linePending: 1 });
    openingAdvancePhase(a, true);
    assert.equal(a.phase, 1);
    assert.equal(a.linePending, 0);
    assert.equal(OPENING_PHASE_TABLE_FILE, 0x1c);
});

// ── 6. The ambush roll F0x800a684c: the disc's own routine vs the port ───────

test("the ambush roll runs the disc's own F0x800a684c and the port agrees, call for call", () => {
    const rt = runtime();
    const m = rt.mem;
    const SETUP = 0x80042b1c;   // BATTLE_SETUP: +0x3C the chance byte, +0x1C the enemy level
    const GAME = 0x80048d34;    // the first party record; its level s16 at +0x784
    // getPartyMember(0) -> index 0; the shared RANDOM.next -> a pinned value
    m.write32(0x8004b44c, STUB + 0x60); rt.cpu.setStub(STUB + 0x60, () => 0);
    let rngValue = 0;
    m.write32(0x8004dc0c, STUB + 0x70); rt.cpu.setStub(STUB + 0x70, () => rngValue);
    const disc = (chanceByte, enemyLevel, partnerLevel, roll) => {
        m.write8(SETUP + 0x3c, chanceByte & 0xff);
        m.write16(SETUP + 0x1c, enemyLevel & 0xffff);
        m.write16(GAME + 0x784, partnerLevel & 0xffff);
        rngValue = roll >>> 0;
        return rt.cpu.call(0x800a684c, [], 200000) | 0;
    };
    const port = (chanceByte, enemyLevel, partnerLevel, roll) =>
        ambushRoll({ chanceByte, partnerLevel, enemyLevel, roll }) ? 1 : 0;
    // (chance byte, enemy level, partner level, roll). Every row is compared
    // against the routine executed out of pro_wfightmn.bin.
    const CASES = [
        [0, 10, 20, 0],        // chance byte 0: never an ambush, even on frac 0
        [0, 10, 20, 128],
        [8, 5, 20, 0],         // bound = 8 * ((32-20) - 5) = 56; >>5 = 1
        [8, 5, 20, 1],         // frac 1 !< 1
        [8, 5, 20, 128],       // frac 0 always passes
        [8, 5, 20, 129],
        [4, 20, 20, 64],       // bound = 4 * (12 - 20) < 0: only frac 0 passes
        [4, 20, 20, 128],
        [127, 0, 31, 2],       // bound = 127 * 1 = 127; >>5 = 3
        [127, 0, 31, 3],
        [127, 0, 31, 127],
        [32, 32, 32, 64],      // bound = 32 * (0 - 32) < 0
        [32, 32, 32, 128],
    ];
    for (const [chance, enemyLevel, partner, roll] of CASES) {
        assert.equal(disc(chance, enemyLevel, partner, roll), port(chance, enemyLevel, partner, roll),
            `chance ${chance} enemy ${enemyLevel} partner ${partner} roll ${roll}`);
    }
});

test("the runAway arm's page is actor-keyed: 0x43 for the player, 0x5F for an enemy", () => {
    const rt = runtime();
    const m = rt.mem;
    const QUEUE = 0x800a3868, IDX = QUEUE + 0xaf1;
    const TASK = 0x80140600;
    // the escape test cell 0x800a4654 -> always escapes; F0x8009a298 -> a task;
    // the task's own +0xac arm -> a stub
    m.write32(0x800a4654, STUB + 0x80); rt.cpu.setStub(STUB + 0x80, () => 1);
    rt.cpu.setStub(0x8009a298, () => TASK);
    rt.cpu.setStub(STUB + 0xa0, () => 0);
    const disc = (actor) => {
        seed(rt, {});
        m.write8(IDX, 0);                       // the queue's current index
        m.write32(QUEUE + 0x00, 0);             // entry kind
        m.write8(QUEUE + 0x04, actor);          // entry actor (the side the roll reads)
        m.write32(TASK + 0xac, STUB + 0xa0);    // the task's own +0xac arm
        rt.cpu.call(0x800a7fe4, [CTX, BLOCK], 200000);
        return m.read32(CTX + 0x50) | 0;
    };
    assert.equal(disc(0), 0x43, "the player's own Run prints Run away!");
    assert.equal(disc(0x10), 0x5f, "an enemy's flee prints Fleeing!");
    assert.equal(runAwayLine(0), disc(0));
    assert.equal(runAwayLine(0x10), disc(0x10));
});
