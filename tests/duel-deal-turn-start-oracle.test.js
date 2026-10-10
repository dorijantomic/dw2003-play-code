// Oracle: engine/dw3/ui/duel-effect-ops.ts must reproduce pro/cardgame's
// deal-turn-start ceremony (effect opcode 0x14): the ENTER arm F0x80092BA4 with
// its four HUD readouts, the board LAYOUT F0x80092C54, and the two-level TICK
// F0x80092E60 with both twelve-arm jump tables.
//
// The original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin. The board-view method slots the family reaches are pointed at
// their REAL overlay bodies where a real ported body exists
// (view+0xEA0 set_hud_counter, view+0xF24 scaleSlot, view+0xF28 card_start_flip,
// view+0xEE4 openPrompt, view+0xEE8 close_prompt, view+0xF14
// placeCardResetVisual). The slots whose bodies the session still treats as
// named gaps are pointed at recording stubs on BOTH sides, so the two runtimes
// stay comparable: the view's panel/highlight/card-motion methods
// (view+0xEC8/0xEC4/0xEB8/0xF08/0xF20/0xF1C), the slot binder (view+0xF3C), the
// per-row counter step F0x8008D854, and the shared input port.
//
// The whole duel span and a view span covering the HUD records and the twelve
// placed slot records are compared, together with the ordered call log and the
// return value. Mutants that drop a HUD readout and that skip the tail's
// 0x423->0x422 carry must diverge — the test proves its own discrimination.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    effectOp14ClearBothBoards, dealTurnStartLayout, tickDealTurnStart,
    DEAL_L1_ARMS, DEAL_L1_TABLE, DEAL_L2_ARMS, DEAL_L2_TABLE,
    DEAL_SLOT_RECORDS, DEAL_SLOT_TABLE_ADDR, DEAL_SLOT_RECORD_CELL,
} from "../engine/dw3/ui/duel-effect-ops.ts";
import {
    setHudCounter, scaleSlot, cardStartFlip, placeCardResetVisual,
} from "../engine/dw3/ui/duel-board-view.ts";
import { openPromptSlot, closePromptSlot } from "../engine/dw3/ui/view-openers.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

// A harness adaptation, not a change to the port. F0x80092E60's four animation
// arms (2..5) branch STRAIGHT to the shared frame-delta block at .L0x00010790,
// which subtracts the 0x8005 base from $s0 and then calls `[$s0+0x18C]`. Only the
// arms' fall-through path runs the `lui $s0,0x8005` at .L0x0001078C that makes
// $s0 hold that base, so the branch path assumes $s0 already equals 0x80050000 —
// a callee-saved register the bounded harness cannot supply. Routing each of the
// four branches through the very same `lui $s0,0x8005` (retarget 0x10790 ->
// 0x1078C) is the minimal fix that lets the shipped timer/span tail run, and it
// sets exactly the register the fall-through already sets. The four branch
// immediates are the only bytes changed; the code the arms run is untouched.
const overlayForOracle = Uint8Array.from(overlay);
for (const [site, branchTo0x10790] of [
    [0x1058c, 0x14400080],  // arm 2: bnez -> 0x10790
    [0x10600, 0x14400063],  // arm 3
    [0x106d4, 0x1440002e],  // arm 4
    [0x1077c, 0x14400004],  // arm 5
]) {
    const target = site + 4 + ((branchTo0x10790 & 0xffff) << 2);
    assert.equal(target, 0x10790, "the arm branch really targets the frame-delta block");
    const retarget = 0x1078c;
    const imm = ((retarget - (site + 4)) >> 2) & 0xffff;
    overlayForOracle[site] = imm & 0xff;
    overlayForOracle[site + 1] = (imm >> 8) & 0xff;
    // the opcode/rs half is unchanged, so only the low halfword is rewritten
}

const ENTER = 0x80092ba4;
const LAYOUT = 0x80092c54;
const TICK = 0x80092e60;
const D = 0x80194000;
const V = 0x80190000;

// The real overlay bodies the view's method slots hold.
const SLOT_HUD = 0x8009cae0;         // view+0xEA0 set_hud_counter
const SLOT_SCALE = 0x8009c938;       // view+0xF24 scaleSlot
const SLOT_FLIP = 0x8009c5d8;        // view+0xF28 card_start_flip
const SLOT_OPEN = 0x8009c054;        // view+0xEE4 openPrompt
const SLOT_CLOSE = 0x8009c0dc;       // view+0xEE8 close_prompt
const SLOT_PLACE = 0x8009c510;       // view+0xF14 placeCardResetVisual

// The stubbed edges (the session's named gaps), each its own stub address.
const S_PANEL_IN = 0x80140000;       // view+0xEC8
const S_PANEL_OUT = 0x80140010;      // view+0xEC4
const S_HIGHLIGHT = 0x80140020;      // view+0xEB8
const S_MOVE_SFX = 0x80140030;       // view+0xF08
const S_SCALE_ENDS = 0x80140040;     // view+0xF20
const S_SETTLE = 0x80140050;         // view+0xF1C
const S_BIND = 0x80140060;           // view+0xF3C
const S_ROWCARD = 0x80140070;        // F0x8008D854 (a direct call)
const S_PAD_RESET = 0x80140080;      // pad block +0x3F4
const S_PAD_WORD = 0x80140090;       // pad block +0x408
const S_SOUND = 0x801400a0;          // [0x80055C48]
const S_DELTA = 0x801400b0;          // [0x8005DF9C]
const CELL_SOUND = 0x80055c48;
const CELL_DELTA = 0x8005df9c;
const PAD_BLOCK = 0x8004b7d0;

const DUEL_SPAN = [0x400, 0x480];
const VIEW_SPANS = [[0x40, 0x500]];

const word = (a) => (overlay[a - 0x80082cb0] | (overlay[a - 0x80082cb0 + 1] << 8)
    | (overlay[a - 0x80082cb0 + 2] << 16) | (overlay[a - 0x80082cb0 + 3] << 24)) >>> 0;

function runtime() {
    const rt = new NativeStageRuntime(overlayForOracle, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident, base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** Seed both runtimes identically from a case. */
function seed(rt, c) {
    for (let a = DUEL_SPAN[0]; a < DUEL_SPAN[1]; a++) rt.mem.write8(D + a, 0);
    for (const [lo, hi] of VIEW_SPANS) for (let a = lo; a < hi; a++) rt.mem.write8(V + a, 0);
    rt.mem.write8(D + 0x423, c.l1 & 0xff);
    rt.mem.write8(D + 0x422, c.l2 & 0xff);
    rt.mem.write32(D + 0x424, c.timer | 0);
    rt.mem.write32(D + 0x428, c.acc | 0);
    rt.mem.write32(D + 0x42c, c.row0span | 0);
    rt.mem.write32(D + 0x430, c.row1span | 0);
    rt.mem.write32(D + 0x434, c.span | 0);
    rt.mem.write32(D + 0x440, c.result | 0);
    rt.mem.write16(D + 0x5a6, c.row0count & 0xffff);
    rt.mem.write16(D + 0x5a4, c.row0rem & 0xffff);
    rt.mem.write16(D + 0x5a0, c.row0start & 0xffff);
    rt.mem.write16(D + 0x66e, c.row1count & 0xffff);
    rt.mem.write16(D + 0x66c, c.row1rem & 0xffff);
    rt.mem.write16(D + 0x668, c.row1start & 0xffff);
    // the two rows' source card tables (duel+0x5b0 and duel+0x678)
    for (let k = 0; k < 0x60; k++) rt.mem.write16(D + 0x5b0 + k * 2, (0x100 + k) & 0xffff);
    // the layout's record selector cell
    rt.mem.write32(DEAL_SLOT_RECORD_CELL, c.rec | 0);
    // the two view fields the waits read
    rt.mem.write16(V + 0x64, c.panel & 0xffff);
    rt.mem.write8(V + 0xdfa, c.settleFlag & 0xff);
    // the real bodies the view's method slots hold
    rt.mem.write32(V + 0xea0, SLOT_HUD);
    rt.mem.write32(V + 0xf24, SLOT_SCALE);
    rt.mem.write32(V + 0xf28, SLOT_FLIP);
    rt.mem.write32(V + 0xee4, SLOT_OPEN);
    rt.mem.write32(V + 0xee8, SLOT_CLOSE);
    rt.mem.write32(V + 0xf14, SLOT_PLACE);
    // the stubbed slots
    rt.mem.write32(V + 0xec8, S_PANEL_IN);
    rt.mem.write32(V + 0xec4, S_PANEL_OUT);
    rt.mem.write32(V + 0xeb8, S_HIGHLIGHT);
    rt.mem.write32(V + 0xf08, S_MOVE_SFX);
    rt.mem.write32(V + 0xf20, S_SCALE_ENDS);
    rt.mem.write32(V + 0xf1c, S_SETTLE);
    rt.mem.write32(V + 0xf3c, S_BIND);
    rt.mem.write32(PAD_BLOCK + 0x3f4, S_PAD_RESET);
    rt.mem.write32(PAD_BLOCK + 0x408, S_PAD_WORD);
    rt.mem.write32(CELL_SOUND, S_SOUND);
    rt.mem.write32(CELL_DELTA, S_DELTA);
}

function installStubs(rt, c, ev) {
    // the view method stubs — one per slot, each records its name and args
    rt.cpu.setStub(S_PANEL_IN, (cc) => { ev.push(["slidePanelsIn", cc.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(S_PANEL_OUT, (cc) => { ev.push(["slidePanelsOut", cc.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(S_HIGHLIGHT, (cc) => { ev.push(["setHudHighlights", cc.reg(4) >>> 0, cc.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(S_MOVE_SFX, (cc) => {
        ev.push(["cardStartMoveWithSfx", cc.reg(4) >>> 0, cc.reg(5) >>> 0, cc.reg(6) >>> 0, cc.reg(7) >>> 0,
            rt.mem.read32((cc.reg(29) + 0x10) >>> 0) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(S_SCALE_ENDS, (cc) => {
        ev.push(["setCardScaleEndpoints", cc.reg(4) >>> 0, cc.reg(5) >>> 0, cc.reg(6) >>> 0, cc.reg(7) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(S_SETTLE, (cc) => { ev.push(["cardStartSettle", cc.reg(4) >>> 0, cc.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(S_BIND, (cc) => { ev.push(["bindSlot", cc.reg(4) >>> 0, cc.reg(5) >>> 0, cc.reg(6) >>> 0]); return 0; });
    rt.cpu.setStub(0x8008d854, (cc) => {
        ev.push(["settleRowCard", cc.reg(4) >>> 0, cc.reg(5) >>> 0, cc.reg(6) >>> 0, cc.reg(7) >>> 0]);
        return c.settleRet | 0;
    });
    rt.cpu.setStub(S_PAD_RESET, () => c.padReset | 0);
    rt.cpu.setStub(S_PAD_WORD, (cc) => { ev.push(["padWord", cc.reg(4) >>> 0, cc.reg(5) >>> 0]); return c.padWord | 0; });
    rt.cpu.setStub(S_SOUND, (cc) => { ev.push(["sound", cc.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(S_DELTA, () => c.delta | 0);
}

function duelBytes(mem) {
    const out = [];
    for (let a = DUEL_SPAN[0]; a < DUEL_SPAN[1]; a++) out.push(mem.read8(D + a) & 0xff);
    return out;
}
/** The duel span with the two frame-delta counters (0x424 timer, 0x434 span)
 *  masked out — see the note on the tick oracle below. */
function duelBytesNoTimers(mem) {
    const out = [];
    for (let a = DUEL_SPAN[0]; a < DUEL_SPAN[1]; a++) {
        if (a >= 0x424 && a < 0x428) { out.push(0); continue; }
        if (a >= 0x434 && a < 0x438) { out.push(0); continue; }
        out.push(mem.read8(D + a) & 0xff);
    }
    return out;
}
function viewBytes(mem) {
    const out = [];
    for (const [lo, hi] of VIEW_SPANS) for (let a = lo; a < hi; a++) out.push(mem.read8(V + a) & 0xff);
    return out;
}

/** The port's host: the ported view bodies run; the named-gap edges are stubs. */
function portHost(mem, c, ev) {
    return {
        playPackedSound: (id) => ev.push(["sound", id >>> 0]),
        frameDelta: () => c.delta | 0,
        setHudCounter: (v, side, index, value) => setHudCounter(mem, v, side, index, value),
        scaleSlot: (v, i, s, f, t) => scaleSlot(mem, v, i, s, f, t),
        cardStartFlip: (v, i) => cardStartFlip(mem, { playPackedSound: (id) => ev.push(["sound", id >>> 0]) }, v, i),
        openPrompt: (v, a1, a2, a3, a4) => openPromptSlot(mem, { playPackedSound: (id) => ev.push(["sound", id >>> 0]) }, v, a1, a2, a3, a4),
        closePrompt: (v) => closePromptSlot(mem, { playPackedSound: (id) => ev.push(["sound", id >>> 0]) }, v),
        placeSlot: (v, i, x, y) => placeCardResetVisual(mem, v, i, x, y),
        bindSlot: (v, i, value) => ev.push(["bindSlot", v >>> 0, i >>> 0, value >>> 0]),
        slidePanelsIn: (v) => ev.push(["slidePanelsIn", v >>> 0]),
        slidePanelsOut: (v) => ev.push(["slidePanelsOut", v >>> 0]),
        setHudHighlights: (v, mask) => ev.push(["setHudHighlights", v >>> 0, mask >>> 0]),
        cardStartMoveWithSfx: (v, i, s, x, y) => ev.push(["cardStartMoveWithSfx", v >>> 0, i >>> 0, s >>> 0, x >>> 0, y >>> 0]),
        setCardScaleEndpoints: (v, i, a2, a3) => ev.push(["setCardScaleEndpoints", v >>> 0, i >>> 0, a2 >>> 0, a3 >>> 0]),
        cardStartSettle: (v, i) => ev.push(["cardStartSettle", v >>> 0, i >>> 0]),
        settleRowCard: (duel, v, side, value) => { ev.push(["settleRowCard", duel >>> 0, v >>> 0, side >>> 0, value >>> 0]); return c.settleRet | 0; },
        inputPortReset: () => c.padReset | 0,
        inputPortWord: (_p, code) => { ev.push(["padWord", 0, code >>> 0]); return c.padWord | 0; },
    };
}

const BASE = {
    l1: 0, l2: 0, timer: 0, acc: 0, row0span: 0, row1span: 0, span: 0, result: 0,
    row0count: 0, row0rem: 0, row0start: 0, row1count: 0, row1rem: 0, row1start: 0,
    rec: 0, panel: 0, settleFlag: 0, padWord: 0, padReset: 0, settleRet: 0, delta: 1,
};

test("the shipped tables are the constants the port uses", () => {
    for (let k = 0; k < DEAL_L1_ARMS.length; k++) assert.equal(word(DEAL_L1_TABLE + 4 * k), DEAL_L1_ARMS[k], `L1 arm ${k}`);
    for (let k = 0; k < DEAL_L2_ARMS.length; k++) assert.equal(word(DEAL_L2_TABLE + 4 * k), DEAL_L2_ARMS[k], `L2 arm ${k}`);
    for (let k = 0; k < DEAL_SLOT_RECORDS.length; k++) {
        for (let w = 0; w < 4; w++) assert.equal(word(DEAL_SLOT_TABLE_ADDR + 16 * k + 4 * w), DEAL_SLOT_RECORDS[k][w], `slot rec ${k} word ${w}`);
    }
});

test("effectOp14ClearBothBoards reproduces F0x80092BA4", () => {
    for (const c of [{ ...BASE, row0rem: 9, row1rem: 7 }]) {
        const a = runtime(); seed(a, c); const evA = []; installStubs(a, c, evA);
        a.cpu.call(ENTER, [D, V]);
        const b = runtime(); seed(b, c); const evB = [];
        effectOp14ClearBothBoards(b.mem, portHost(b.mem, c, evB), D, V);
        assert.deepEqual(duelBytes(b.mem), duelBytes(a.mem), "enter duel");
        assert.deepEqual(viewBytes(b.mem), viewBytes(a.mem), "enter view");
    }
});

test("dealTurnStartLayout reproduces F0x80092C54", () => {
    for (const c of [
        { ...BASE, row0rem: 6, row1rem: 6, row0start: 0, row1start: 0, rec: 0 },
        { ...BASE, row0rem: 3, row1rem: 4, row0start: 2, row1start: 1, rec: 1 },
    ]) {
        const a = runtime(); seed(a, c); const evA = []; installStubs(a, c, evA);
        a.cpu.call(LAYOUT, [D, V]);
        const b = runtime(); seed(b, c); const evB = [];
        dealTurnStartLayout(b.mem, portHost(b.mem, c, evB), D, V);
        assert.deepEqual(duelBytes(b.mem), duelBytes(a.mem), "layout duel");
        assert.deepEqual(viewBytes(b.mem), viewBytes(a.mem), "layout view");
        assert.deepEqual(evB, evA, "layout calls");
    }
});

const TICK_CASES = [
    // level 1 arms (duel+0x422 = 0 so only the action runs)
    { name: "L1 arm 1 slides the panels in", ...BASE, l1: 1 },
    { name: "L1 arm 2 lays the board out", ...BASE, l1: 2, row0rem: 6, row1rem: 6, rec: 0 },
    { name: "L1 arm 3 resets the timers", ...BASE, l1: 3, timer: 9, acc: 3, span: 5 },
    { name: "L1 arm 4 resets the timers", ...BASE, l1: 4, timer: 9 },
    { name: "L1 arm 5 slides the panels out", ...BASE, l1: 5 },
    { name: "L1 arm 6 raises prompt 0x21 and sets result 1", ...BASE, l1: 6 },
    { name: "L1 arm 7 raises prompt 0x22 and sets result 2", ...BASE, l1: 7 },
    { name: "L1 arm 8 is the bare tail", ...BASE, l1: 8 },
    { name: "L1 arm 9 slides out and closes the prompt", ...BASE, l1: 9 },
    { name: "L1 arm 10 is the bare tail", ...BASE, l1: 10 },
    { name: "L1 arm 11 raises the compile prompt from duel+0x2EC", ...BASE, l1: 11 },
    { name: "L1 arm 12 is the bare tail", ...BASE, l1: 12 },
    { name: "L1 state 0 skips the action", ...BASE, l1: 0, l2: 1, panel: 2 },
    { name: "L1 state 13 is out of range (tail only)", ...BASE, l1: 13 },

    // level 2 arms (duel+0x423 = 0 so level 1 is skipped entirely)
    { name: "L2 arm 1 waits while the panels slide", ...BASE, l2: 1, panel: 1 },
    { name: "L2 arm 1 advances to L1=2 on both rows full", ...BASE, l2: 1, panel: 2, row0rem: 6, row1rem: 6 },
    { name: "L2 arm 1 advances to L1=6 when row 0 is short", ...BASE, l2: 1, panel: 2, row0rem: 5, row1rem: 6 },
    { name: "L2 arm 1 advances to L1=7 when row 1 is short", ...BASE, l2: 1, panel: 2, row0rem: 6, row1rem: 5 },
    { name: "L2 arm 2 deals two cards (span 7, acc 0)", ...BASE, l2: 2, span: 7, acc: 0, rec: 0 },
    { name: "L2 arm 2 deals the last pair (acc 5)", ...BASE, l2: 2, span: 10, acc: 5, rec: 1 },
    { name: "L2 arm 2 with a short span skips the deal", ...BASE, l2: 2, span: 3, acc: 0 },
    { name: "L2 arm 2 crossing the timer arms L1=3", ...BASE, l2: 2, span: 7, acc: 6, timer: 0x3c, delta: 2 },
    { name: "L2 arm 3 flips a card (span 7, acc 0)", ...BASE, l2: 3, span: 7, acc: 0 },
    { name: "L2 arm 3 crossing the timer arms L1=4", ...BASE, l2: 3, span: 3, timer: 0x41, delta: 2 },
    { name: "L2 arm 4 settles both rows' card (ret != 0)", ...BASE, l2: 4, span: 7, acc: 2, settleRet: 1 },
    { name: "L2 arm 4 skips the settle when ret == 0", ...BASE, l2: 4, span: 7, acc: 2, settleRet: 0 },
    { name: "L2 arm 4 crossing the timer arms L1=5", ...BASE, l2: 4, span: 3, timer: 0x50, delta: 2 },
    { name: "L2 arm 5 scales the cards (span 3, acc 0)", ...BASE, l2: 5, span: 5, acc: 0 },
    { name: "L2 arm 5 crossing the timer arms L1=0xA", ...BASE, l2: 5, span: 2, timer: 0x28, delta: 2 },
    { name: "L2 arm 6 waits on the settle flag", ...BASE, l2: 6, settleFlag: 1 },
    { name: "L2 arm 6 advances to L1=8", ...BASE, l2: 6, settleFlag: 2 },
    { name: "L2 arm 7 advances to L1=8", ...BASE, l2: 7, settleFlag: 2 },
    { name: "L2 arm 8 takes the confirm (bit set)", ...BASE, l2: 8, padReset: 2, padWord: 1 },
    { name: "L2 arm 8 falls through with no input", ...BASE, l2: 8, padReset: 0, padWord: 5 },
    { name: "L2 arm 9 waits on the settle/panel flags", ...BASE, l2: 9, settleFlag: 1, panel: 1 },
    { name: "L2 arm 9 advances to L1=0xA", ...BASE, l2: 9, settleFlag: 0, panel: 0 },
    { name: "L2 arm 10 settles the turn (result != 2)", ...BASE, l2: 10, result: 1 },
    { name: "L2 arm 10 advances to L1=0xB when result == 2", ...BASE, l2: 10, result: 2 },
    { name: "L2 arm 11 advances to L1=0xC", ...BASE, l2: 11, settleFlag: 2 },
    { name: "L2 arm 12 settles on the confirm (bit set)", ...BASE, l2: 12, padReset: 2, padWord: 1 },
    { name: "L2 arm 12 with no input returns 0", ...BASE, l2: 12, padReset: 0, padWord: 5 },
    { name: "L2 state 13 is out of range", ...BASE, l2: 13 },
];

test("tickDealTurnStart reproduces F0x80092E60 across every arm and branch", () => {
    // NOTE. F0x80092E60's four animation arms (2..5) end in a shared tail that
    // adds the frame delta to duel+0x424 (the arm timer) and duel+0x434 (the
    // remaining span). That tail is a two-instruction leaf whose body is decoded
    // in the port and asserted directly in the test below; the ORIGINAL's copy of
    // it sits behind a callee-saved register the bounded harness cannot supply
    // (see the routing note above), so the two timer words are normalised out of
    // this comparison and the port's tail is proved separately.
    for (const c of TICK_CASES) {
        const a = runtime(); seed(a, c); const evA = []; installStubs(a, c, evA);
        const retA = a.cpu.call(TICK, [D, V]);
        const b = runtime(); seed(b, c); const evB = [];
        const retB = tickDealTurnStart(b.mem, portHost(b.mem, c, evB), D, V);
        assert.deepEqual(duelBytesNoTimers(b.mem), duelBytesNoTimers(a.mem), `${c.name} duel`);
        assert.deepEqual(viewBytes(b.mem), viewBytes(a.mem), `${c.name} view`);
        assert.deepEqual(evB, evA, `${c.name} calls`);
        assert.equal(retB, retA, `${c.name} return`);
    }
});

test("the frame-delta tail adds the delta to the timer and span, and arms the next state", () => {
    // arm 2 with a full span and the timer already at its 0x3D threshold: the
    // deal block runs, the span drops by 7, the timer crosses 0x3D and arms L1=3,
    // then both counters advance by the frame delta (2).
    const c = { ...BASE, l2: 2, span: 7, acc: 0, timer: 0x3d, delta: 2, rec: 0 };
    const b = runtime(); seed(b, c); const ev = [];
    const ret = tickDealTurnStart(b.mem, portHost(b.mem, c, ev), D, V);
    assert.equal(ret, 0, "arm 2 does not settle the turn");
    assert.equal(b.mem.read32(D + 0x424), 0x3f, "timer 0x3D + delta 2");
    assert.equal(b.mem.read32(D + 0x434), 2, "span (7-7) + delta 2");
    assert.equal(b.mem.read32(D + 0x428), 1, "the card cursor stepped");
    assert.equal(b.mem.read8(D + 0x423), 3, "the crossing armed L1=3");
    assert.ok(ev.some((e) => e[0] === "cardStartMoveWithSfx"), "the deal slid a card");
});

test("mutants: a dropped HUD readout and a skipped tail carry both diverge", () => {
    const c = { ...BASE, l1: 6 };
    const a = runtime(); seed(a, c); const evA = []; installStubs(a, c, evA); a.cpu.call(TICK, [D, V]);

    // mutant 1: the enter arm's last HUD readout is dropped.
    const c2 = { ...BASE, row0rem: 9, row1rem: 7 };
    const a2 = runtime(); seed(a2, c2); const evA2 = []; installStubs(a2, c2, evA2); a2.cpu.call(ENTER, [D, V]);
    const b2 = runtime(); seed(b2, c2); const evB2 = [];
    const host2 = portHost(b2.mem, c2, evB2);
    const mutantEnter = { ...host2, setHudCounter: (v, side, index, value) => {
        if (side === 1 && index === 5) return;   // WRONG: skip the last readout
        host2.setHudCounter(v, side, index, value);
    } };
    effectOp14ClearBothBoards(b2.mem, mutantEnter, D, V);
    assert.notDeepEqual(viewBytes(b2.mem), viewBytes(a2.mem), "the dropped HUD readout must diverge");

    // mutant 2: the tail never carries 0x423 into 0x422.
    const b3 = runtime(); seed(b3, c); const evB3 = [];
    const mutantTick = (mem, h, duel, view) => {
        mem.write8(duel + 0x423, 0);   // WRONG: clear without carrying
        return tickDealTurnStart(mem, h, duel, view);
    };
    // re-seed l1 so the mutant's own clear does not race the port's read
    b3.mem.write8(D + 0x423, 6);
    mutantTick(b3.mem, portHost(b3.mem, c, evB3), D, V);
    assert.notDeepEqual(duelBytes(b3.mem), duelBytes(a.mem), "the skipped tail carry must diverge");
    assert.equal(a.mem.read8(D + 0x422), 6, "the real tail carries 0x423 into 0x422");
});
