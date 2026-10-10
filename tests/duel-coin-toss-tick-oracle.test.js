// Oracle: engine/dw3/ui/duel-effect-ops.ts must reproduce pro/cardgame's coin
// toss TICK F0x80089974 (effect opcode 0xA7's update arm) together with the three
// sub-routines it calls — F0x800896F0 (the slide step), F0x80087DC8 (the pick
// readiness checker) and the two board-view starters it reaches through the view
// method slots (view+0xF0C F0x8009CA3C card_start_move_silent, view+0xF28
// F0x8009C5D8 card_start_flip) plus view+0xF24 (scaleSlot) and the two banner
// slots (view+0xEAC F0x8009BEAC, view+0xEB0 F0x8009BF5C).
//
// The original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin. The view method slots are pointed at their REAL overlay bodies,
// so the whole family executes natively; only the three truly external services
// are stubbed — the packed-sound cell [0x80055C48], the frame-delta cell
// [0x8004DF9C] (= resident F0x8001D704) and the controller getters (pressed
// F0x80018854, repeat F0x8001889C, map F0x80018980). The whole duel+view span
// and the ordered sound log are compared.
//
// The fields the state machine branches on are varied independently: the state
// byte (1..6, plus 0/7 for the bounds), the arm timer, the highlighted slot, the
// coin bit, the picked slot, the pad word and the frame delta. Mutants that pin
// the coin banner's record choice and that fail to flip the highlighted slot must
// diverge — the test proves its own discrimination.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    tickCoinToss, COIN_TOSS_JUMP_ARMS, COIN_TOSS_JUMP_TABLE, COIN_TOSS_SLIDE_TABLE,
    COIN_TOSS_SLIDE_TABLE_ADDR,
} from "../engine/dw3/ui/duel-effect-ops.ts";
import { scaleSlot, cardStartMoveSilent, cardStartFlip } from "../engine/dw3/ui/duel-board-view.ts";
import { openBannerSlot } from "../engine/dw3/ui/view-openers.ts";
import { writeBannerRecord } from "../engine/dw3/ui/duel-info-banner.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const TICK = 0x80089974;
const D = 0x80194000;   // the duel
const V = 0x80190000;   // the board view

// The real overlay bodies the view's method slots hold.
const SLOT_MOVE = 0x8009ca3c;   // view+0xF0C card_start_move_silent
const SLOT_SCALE = 0x8009c938;  // view+0xF24 scaleSlot
const SLOT_FLIP = 0x8009c5d8;   // view+0xF28 card_start_flip
const SLOT_BANNER = 0x8009beac; // view+0xEAC open_info_banner
const SLOT_BANNER_REC = 0x8009bf5c; // view+0xEB0 write_banner_record

// The external services (stubbed).
const CELL_SOUND = 0x80055c48;
const CELL_DELTA = 0x8004df9c;
const PAD_BLOCK = 0x8004b7d0;
const GET_PRESSED = 0x80018854;
const GET_REPEAT = 0x8001889c;
const GET_MAP = 0x80018980;
const STUB_SOUND = 0x80100040;
const STUB_DELTA = 0x80100030;

// What the oracle compares: everything the family writes.
const DUEL_SPAN = [0x400, 0x480];
const VIEW_SPANS = [[0x100, 0x200], [0xde0, 0xf00]];

const word = (a) => (overlay[a - 0x80082cb0] | (overlay[a - 0x80082cb0 + 1] << 8)
    | (overlay[a - 0x80082cb0 + 2] << 16) | (overlay[a - 0x80082cb0 + 3] << 24)) >>> 0;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** Seed both runtimes identically from a case. */
function seed(rt, c) {
    for (let a = DUEL_SPAN[0]; a < DUEL_SPAN[1]; a++) rt.mem.write8(D + a, 0);
    for (const [lo, hi] of VIEW_SPANS) for (let a = lo; a < hi; a++) rt.mem.write8(V + a, 0);
    rt.mem.write8(D + 0x422, c.state & 0xff);
    rt.mem.write32(D + 0x424, c.timer | 0);
    rt.mem.write32(D + 0x428, c.acc | 0);
    rt.mem.write32(D + 0x434, c.coin | 0);
    rt.mem.write32(D + 0x43c, c.slot | 0);
    rt.mem.write32(D + 0x440, c.pick | 0);
    // the view's method slots point at their real overlay bodies
    rt.mem.write32(V + 0xf0c, SLOT_MOVE);
    rt.mem.write32(V + 0xf24, SLOT_SCALE);
    rt.mem.write32(V + 0xf28, SLOT_FLIP);
    rt.mem.write32(V + 0xeac, SLOT_BANNER);
    rt.mem.write32(V + 0xeb0, SLOT_BANNER_REC);
    // the controller getter cells
    rt.mem.write32(PAD_BLOCK + 0x3f4, GET_PRESSED);
    rt.mem.write32(PAD_BLOCK + 0x3fc, GET_REPEAT);
    rt.mem.write32(PAD_BLOCK + 0x408, GET_MAP);
    // the two external service cells
    rt.mem.write32(CELL_SOUND, STUB_SOUND);
    rt.mem.write32(CELL_DELTA, STUB_DELTA);
}

function installStubs(rt, c, ev) {
    rt.cpu.setStub(GET_PRESSED, () => c.padWord & 0xffff);
    rt.cpu.setStub(GET_REPEAT, () => c.padRepeat & 0xffff);
    rt.cpu.setStub(GET_MAP, (cc) => cc.reg(5) >>> 0);
    rt.cpu.setStub(STUB_DELTA, () => c.delta | 0);
    rt.cpu.setStub(STUB_SOUND, (cc) => { ev.push(["sound", cc.reg(4) >>> 0]); return 0; });
}

function duelBytes(mem) {
    const out = [];
    for (let a = DUEL_SPAN[0]; a < DUEL_SPAN[1]; a++) out.push(mem.read8(D + a) & 0xff);
    return out;
}
function viewBytes(mem) {
    const out = [];
    for (const [lo, hi] of VIEW_SPANS) for (let a = lo; a < hi; a++) out.push(mem.read8(V + a) & 0xff);
    return out;
}

/** Run the original family natively with the three external services stubbed. */
function runOriginal(c, ev) {
    const rt = runtime();
    seed(rt, c);
    installStubs(rt, c, ev);
    return rt.cpu.call(TICK, [D, V]);
}

/** The port's host: the view slots run their real bodies; the rest are options. */
function portHost(mem, c, ev) {
    return {
        playPackedSound: (id) => ev.push(["sound", id >>> 0]),
        frameDelta: () => c.delta | 0,
        padPressed: () => c.padWord & 0xffff,
        padRepeat: () => c.padRepeat & 0xffff,
        padKeyBit: (_p, code) => code,
        scaleSlot: (v, i, s, f, t) => scaleSlot(mem, v, i, s, f, t),
        cardStartMoveSilent: (v, i, s, x, y) => cardStartMoveSilent(mem, v, i, s, x, y),
        cardStartFlip: (v, i) => cardStartFlip(mem, { playPackedSound: (id) => ev.push(["sound", id >>> 0]) }, v, i),
        openInfoBanner: (v, i, a2, a3, a4, a5) =>
            openBannerSlot(mem, { playPackedSound: (id) => ev.push(["sound", id >>> 0]) }, v, i, a2, a3, a4, a5),
        writeBannerRecord: (v, i) =>
            writeBannerRecord(mem, { playSound: (id) => ev.push(["sound", id >>> 0]) }, v, i),
    };
}

const BASE = { state: 2, timer: 0, acc: 0, coin: 0x777, slot: 0, pick: 0, padWord: 0, padRepeat: 0, delta: 1 };
const CASES = [
    { name: "state 1, timer 0 scales slot 0", ...BASE, state: 1, timer: 0 },
    { name: "state 1, timer 4 scales slot 1", ...BASE, state: 1, timer: 4 },
    { name: "state 1, timer 3 skips the scale", ...BASE, state: 1, timer: 3 },
    { name: "state 1, timer 14 arms state 2 and starts slot 0's move", ...BASE, state: 1, timer: 14 },
    { name: "state 2, slide key 7 hops the highlight", ...BASE, state: 2, padWord: 1 << 7 },
    { name: "state 2, slide key 5 hops the highlight", ...BASE, state: 2, padWord: 1 << 5 },
    { name: "state 2, confirm picks the slot", ...BASE, state: 2, padWord: 1 << 0xd, slot: 1 },
    { name: "state 2, no input waits", ...BASE, state: 2, padWord: 0 },
    { name: "state 3, checker step 0 scales from 0x1400", ...BASE, state: 3, timer: 0 },
    { name: "state 3, checker step 2 scales from 0x1000", ...BASE, state: 3, timer: 2 },
    { name: "state 3, checker not ready (step 1)", ...BASE, state: 3, timer: 1, acc: 2, delta: 1 },
    { name: "state 3, ready (step 3, acc reaches 5) arms state 4 and flips", ...BASE, state: 3, timer: 3, acc: 4, delta: 1, slot: 1 },
    { name: "state 4, timer 20 flips the other slot and opens banner 0x43 (bit != pick)", ...BASE, state: 4, timer: 0x14, coin: 1, pick: 0 },
    { name: "state 4, timer 20 opens banner 0x44 (bit == pick)", ...BASE, state: 4, timer: 0x14, coin: 1, pick: 1 },
    { name: "state 4, confirm at timer 31 resets the timer to 0x5A", ...BASE, state: 4, timer: 0x1f, padWord: 1 << 0xd },
    { name: "state 4, timer 90 arms state 5 and retires banner 5", ...BASE, state: 4, timer: 0x5a, delta: 1 },
    { name: "state 5, timer 0 scales slot 0", ...BASE, state: 5, timer: 0 },
    { name: "state 5, timer 4 scales slot 1", ...BASE, state: 5, timer: 4 },
    { name: "state 5, timer 14 arms state 6", ...BASE, state: 5, timer: 14 },
    { name: "state 6, coin bit equals the pick", ...BASE, state: 6, coin: 0, pick: 0 },
    { name: "state 6, coin bit differs from the pick", ...BASE, state: 6, coin: 1, pick: 0 },
    { name: "state 0 is out of range", ...BASE, state: 0 },
    { name: "state 7 is out of range", ...BASE, state: 7 },
];

test("the shipped jump table and slide table are the constants the port uses", () => {
    for (let k = 0; k < COIN_TOSS_JUMP_ARMS.length; k++) {
        assert.equal(word(COIN_TOSS_JUMP_TABLE + 4 * k), COIN_TOSS_JUMP_ARMS[k], `jump arm ${k}`);
    }
    for (let k = 0; k < COIN_TOSS_SLIDE_TABLE.length; k++) {
        const rec = COIN_TOSS_SLIDE_TABLE_ADDR + 8 * k;
        assert.equal(word(rec), COIN_TOSS_SLIDE_TABLE[k][0], `slide x ${k}`);
        assert.equal(word(rec + 4), COIN_TOSS_SLIDE_TABLE[k][1], `slide y ${k}`);
    }
});

test("tickCoinToss reproduces F0x80089974 across every arm and branch", () => {
    for (const c of CASES) {
        const a = runtime();
        seed(a, c);
        const evA = [];
        const retA = runOriginalOn(a, c, evA);

        const b = runtime();
        seed(b, c);
        const evB = [];
        const retB = tickCoinToss(b.mem, portHost(b.mem, c, evB), D, V);

        assert.deepEqual(viewBytes(b.mem), viewBytes(a.mem), `${c.name} view`);
        assert.deepEqual(duelBytes(b.mem), duelBytes(a.mem), `${c.name} duel`);
        assert.deepEqual(evB, evA, `${c.name} call log`);
        assert.equal(retB, retA, `${c.name} return`);
    }
});

/** The original family, run on a fresh runtime. */
function runOriginalOn(rt, c, ev) {
    seed(rt, c);
    installStubs(rt, c, ev);
    return rt.cpu.call(TICK, [D, V]);
}

test("mutants: pinning the coin banner choice, and failing to flip the slide slot, both diverge", () => {
    // mutant 1: state 4 always opens banner record 0x44.
    const mutantBanner = (mem, h, duel, view) => {
        if ((mem.read8(duel + 0x422) & 0xff) !== 4) return tickCoinToss(mem, h, duel, view);
        let t = mem.read32(duel + 0x424) | 0;
        if (t === 0x14) {
            h.cardStartFlip(view, (mem.read32(duel + 0x43c) | 0) ^ 1);
            h.openInfoBanner(view, 5, 5, 0x44, 0, 0x42);   // WRONG: ignores the coin bit
            h.playPackedSound(0x40019);
        }
        t = mem.read32(duel + 0x424) | 0;
        if (t >= 0x1f && ((h.padPressed(0) & 0xffff) & (1 << 0xd))) mem.write32(duel + 0x424, 0x5a);
        t = (mem.read32(duel + 0x424) + h.frameDelta()) | 0;
        mem.write32(duel + 0x424, t);
        if (t >= 0x5b) {
            mem.write8(duel + 0x422, 5);
            mem.write32(duel + 0x42c, 0);
            mem.write32(duel + 0x428, 0);
            mem.write32(duel + 0x424, 0);
            h.writeBannerRecord(view, 5);
        }
        return 0;
    };
    const c = { ...BASE, state: 4, timer: 0x14, coin: 0, pick: 1 }; // bit != pick -> real banner 0x43
    const a = runtime(); seed(a, c); const evA = []; installStubs(a, c, evA); a.cpu.call(TICK, [D, V]);
    const b = runtime(); seed(b, c);
    const evB = []; mutantBanner(b.mem, portHost(b.mem, c, evB), D, V);
    assert.notDeepEqual(viewBytes(b.mem), viewBytes(a.mem), "the pinned banner record must diverge");
    assert.equal(a.mem.read8(V + 5 * 0x18 + 0xe0c + 0x10 + 3), 0); // payload word 0x43's high byte region

    // mutant 2: the slide step never flips duel+0x43c.
    const mutantSlide = (mem, h, duel, view) => {
        if ((mem.read8(duel + 0x422) & 0xff) !== 2) return tickCoinToss(mem, h, duel, view);
        h.playPackedSound(0x4001b);
        const idx = mem.read32(duel + 0x43c) | 0;
        const rec = COIN_TOSS_SLIDE_TABLE[idx];
        h.cardStartMoveSilent(view, idx, 5, rec[0], rec[1]);
        return 0; // WRONG: never flips the slot
    };
    const c2 = { ...BASE, state: 2, padWord: 1 << 7, slot: 0 };
    const a2 = runtime(); seed(a2, c2); const evA2 = []; installStubs(a2, c2, evA2); a2.cpu.call(TICK, [D, V]);
    const b2 = runtime(); seed(b2, c2);
    const evB2 = []; mutantSlide(b2.mem, portHost(b2.mem, c2, evB2), D, V);
    assert.notDeepEqual(duelBytes(b2.mem), duelBytes(a2.mem), "the un-flipped slot must diverge");
    assert.equal(a2.mem.read32(D + 0x43c), 1, "the real slide flips the slot");
});
