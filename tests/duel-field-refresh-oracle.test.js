// Oracle: engine/dw3/ui/duel-field-refresh.ts must reproduce pro/cardgame's
// refreshFieldCardViews (F0x8009E024) and its slot-colour query (F0x8009CF60).
// The original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin with the view's three method slots (view+0xF14 place, view+0xF3C
// bind, view+0xF40 colour) stubbed on BOTH sides, so the whole duel+view span,
// the ordered call log and the slot-colour call arguments are compared.
//
// The routine is constructor-installed and the m2c C for it is empty, so the
// two jump tables are pinned against the overlay words here — the walk's arm
// numbering is proved, not assumed.
//
// The comparison is discriminating: the hand counts, the browse flag, the
// played-card count and every played record's id/flag/side/filter-class/filter
// byte are varied, and four mutants (a constant colour, a dropped play row, a
// dropped browse flag and a dropped hand num) must diverge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    refreshFieldCardViews,
    BOARD_ROW_LAYOUT_TABLE,
    BOARD_LAYOUT_SELECTOR,
} from "../engine/dw3/ui/duel-field-refresh.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const REFRESH = 0x8009e024;
const LOAD_BASE = 0x80082cb0;
const ARM_TABLE = 0x800837c0;
const CLASS_TABLE = 0x800837e8;

const DUEL = 0x80194000;
const SCENE = 0x80195000;
const VIEW = 0x80190000;

// the view's three method slots
const POS_SLOT = 0xf14;
const BIND_SLOT = 0xf3c;
const COLOUR_SLOT = 0xf40;
const POS_STUB = 0x0fe50200;
const BIND_STUB = 0x0fe50210;
const COLOUR_STUB = 0x0fe50220;

const DUEL_SPAN = [0x490, 0x800];
const VIEW_SPAN = 0x2000;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, LOAD_BASE, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** Every method stub records the same tuples the port's host records. */
function stubOriginal(rt, events) {
    rt.cpu.setStub(POS_STUB, (c) => {
        events.push(["positionSlot", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(BIND_STUB, (c) => {
        events.push(["writeSlotValue", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(COLOUR_STUB, (c) => {
        events.push(["slotColour", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return (c.reg(5) >>> 0) % 7;
    });
}

/** A delegating memory wrapper so a single method can be mutated in a test. */
function wrapMem(m, over = {}) {
    return {
        read8: over.read8 ?? ((x) => m.read8(x)),
        read8s: over.read8s ?? ((x) => m.read8s(x)),
        read16: over.read16 ?? ((x) => m.read16(x)),
        read16s: over.read16s ?? ((x) => m.read16s(x)),
        read32: over.read32 ?? ((x) => m.read32(x)),
        write8: over.write8 ?? ((x, v) => m.write8(x, v)),
        write16: over.write16 ?? ((x, v) => m.write16(x, v)),
        write32: over.write32 ?? ((x, v) => m.write32(x, v)),
    };
}

function portHost(events) {
    return {
        positionSlot(view, index, x, y) {
            events.push(["positionSlot", view >>> 0, index >>> 0, x >>> 0, y >>> 0]);
        },
        writeSlotValue(view, index, value) {
            events.push(["writeSlotValue", view >>> 0, index >>> 0, value >>> 0]);
        },
        slotColour(view, cardId) {
            events.push(["slotColour", view >>> 0, cardId >>> 0]);
            return (cardId >>> 0) % 7;
        },
    };
}

/** A deterministic board: counts, the browse flag, plays and per-slot bytes. */
function seed(rt, o = {}) {
    for (let i = DUEL_SPAN[0]; i < DUEL_SPAN[1]; i++) rt.mem.write8(DUEL + i, 0);
    for (let i = 0; i < VIEW_SPAN; i++) rt.mem.write8(VIEW + i, 0);
    rt.mem.write32(BOARD_LAYOUT_SELECTOR, o.selector ?? 0);
    rt.mem.write32(SCENE + 0x18, VIEW);
    // the three view method slots (identical on both sides; the port dispatches
    // through its host, the original through these installed addresses)
    rt.mem.write32(VIEW + POS_SLOT, POS_STUB);
    rt.mem.write32(VIEW + BIND_SLOT, BIND_STUB);
    rt.mem.write32(VIEW + COLOUR_SLOT, COLOUR_STUB);

    const playerHand = o.playerHand ?? 3;
    const oppHand = o.oppHand ?? 5;
    rt.mem.write8(DUEL + 0x72c, playerHand & 0xff);
    rt.mem.write8(DUEL + 0x72c + 0x72, oppHand & 0xff);

    for (let i = 0; i < 6; i++) {
        const near = DUEL + i * 0xe + 0x72e;
        rt.mem.write16(near, (o.nearId ?? 0x100) + i);
        rt.mem.write8(near + 0x6, (0x20 + i) & 0xff);        // +0x734
        rt.mem.write8(near + 0x8, (0x30 + i) & 0xff);        // +0x736
        rt.mem.write8(near + 0xc, ((o.nearColour ?? 3) + i) & 0xff); // +0x73a (kind 0)
        const far = DUEL + i * 0xe + 0x7a0;
        rt.mem.write16(far, (o.farId ?? 0x200) + i);
        rt.mem.write8(far + 0x6, (0x40 + i) & 0xff);         // +0x7a6
        rt.mem.write8(far + 0x8, (0x50 + i) & 0xff);         // +0x7a8
    }
    for (let s0 = 6; s0 < 12; s0++) {
        rt.mem.write8(DUEL + 0x74c + s0 * 0xe + 0xc, ((o.farColour ?? 5) + s0) & 0xff);
    }

    rt.mem.write8(DUEL + 0x49c, o.flag ?? 0);
    const playCount = o.playCount ?? 2;
    rt.mem.write8(DUEL + 0x575, playCount & 0xff);
    const kinds = o.kinds ?? [0, 3];
    const sides = o.sides ?? [0, 1];
    const filters = o.filters ?? [4, 9];
    const flags = o.playFlags ?? [0, 1];
    for (let i = 0; i < 8; i++) {
        const rec = DUEL + i * 8 + 0x580;
        rt.mem.write16(rec, (o.playId ?? 0x300) + i);
        rt.mem.write16(rec + 0x2, (flags[i] ?? 0) & 0xffff);
        rt.mem.write8(rec + 0x4, (sides[i] ?? 0) & 0xff);
        rt.mem.write8(rec + 0x5, (kinds[i] ?? 9) & 0xff);
        rt.mem.write8(rec + 0x6, (filters[i] ?? 0) & 0xff);
    }
}

function snapshot(rt, events) {
    const duel = [];
    for (let i = DUEL_SPAN[0]; i < DUEL_SPAN[1]; i++) duel.push(rt.mem.read8(DUEL + i) & 0xff);
    const view = [];
    for (let i = 0; i < VIEW_SPAN; i++) view.push(rt.mem.read8(VIEW + i) & 0xff);
    return { duel, view, events };
}

function runOriginal(tc) {
    const events = [];
    const rt = runtime();
    seed(rt, tc);
    stubOriginal(rt, events);
    rt.cpu.call(REFRESH, [DUEL, SCENE]);
    return { rt, got: snapshot(rt, events) };
}

function runPort(tc, hostOverride, memOverride) {
    const events = [];
    const rt = runtime();
    seed(rt, tc);
    const mem = memOverride ? wrapMem(rt.mem, memOverride(rt.mem)) : rt.mem;
    refreshFieldCardViews(mem, hostOverride ? hostOverride(portHost(events)) : portHost(events), DUEL, SCENE);
    return { rt, got: snapshot(rt, events) };
}

function compare(tc) {
    const a = runOriginal(tc);
    const b = runPort(tc);
    const label = JSON.stringify(tc);
    assert.deepEqual(b.got.duel, a.got.duel, `${label} duel`);
    assert.deepEqual(b.got.view, a.got.view, `${label} view`);
    assert.deepEqual(b.got.events, a.got.events, `${label} calls`);
    return a;
}

test("the refresh's two jump tables are the shipped words", () => {
    const word = (addr) => {
        const off = addr - LOAD_BASE;
        return (overlay[off] | (overlay[off + 1] << 8) | (overlay[off + 2] << 16) | (overlay[off + 3] << 24)) >>> 0;
    };
    const arms = [];
    for (let i = 0; i < 10; i++) arms.push(word(ARM_TABLE + i * 4));
    const classes = [];
    for (let i = 0; i < 5; i++) classes.push(word(CLASS_TABLE + i * 4));
    assert.deepEqual(arms, [
        0x8009e278, 0x8009e304, 0x8009e35c, 0x8009e3b4, 0x8009e3e0,
        0x8009e3e0, 0x8009e3e0, 0x8009e3e0, 0x8009e3e0, 0x8009e4fc,
    ], "filter-class arms 0..9");
    assert.deepEqual(classes, [
        0x8009e444, 0x8009e464, 0x8009e488, 0x8009e4a0, 0x8009e4c4,
    ], "class 4..8 arms");
    // the row-layout table is 16-byte records; the selector cell picks one
    assert.ok(BOARD_ROW_LAYOUT_TABLE >= LOAD_BASE && BOARD_ROW_LAYOUT_TABLE < LOAD_BASE + overlay.length);
});

test("every filter class, count and flag matches F0x8009E024", () => {
    const CASES = [
        { playCount: 0 },
        { playCount: -1 & 0xff },
        { playCount: 1, kinds: [0], filters: [1], sides: [0], playFlags: [0] },
        { playCount: 1, kinds: [0], filters: [4], sides: [0], playFlags: [1] },
        { playCount: 1, kinds: [1], sides: [0], playFlags: [0] },
        { playCount: 1, kinds: [1], sides: [1], playFlags: [1] },
        { playCount: 1, kinds: [2], sides: [0] },
        { playCount: 1, kinds: [2], sides: [1] },
        { playCount: 1, kinds: [3] },
        { playCount: 1, kinds: [4] },
        { playCount: 1, kinds: [5] },
        { playCount: 1, kinds: [6] },
        { playCount: 1, kinds: [7] },
        { playCount: 1, kinds: [8] },
        { playCount: 1, kinds: [9] },
        { playCount: 1, kinds: [12] },   // out of range: no arm
        { playCount: 2, kinds: [0, 4], filters: [4, 0], sides: [0, 1], playFlags: [1, 0] },
        { playCount: 3, kinds: [1, 2, 3], sides: [0, 1, 0], playFlags: [0, 1, 0] },
        { playCount: 6, kinds: [0, 1, 2, 3, 6, 8], sides: [0, 1, 0, 1, 0, 1], filters: [2, 0, 0, 0, 0, 0], playFlags: [1, 1, 0, 0, 1, 0] },
        { playCount: 2, playerHand: 0, oppHand: 0, flag: 1 },
        { playCount: 1, playerHand: 6, oppHand: 6, flag: 1, kinds: [0], filters: [7] },
        { playCount: 0, playerHand: 0, oppHand: 0, flag: 1 },
        { playCount: 1, selector: 1, kinds: [3] },
        { playCount: 1, selector: 3, kinds: [0], filters: [2] },
        { playCount: 1, kinds: [9], playFlags: [2] },       // the +2 flag folds into the mark address
        { playCount: 1, kinds: [9], playFlags: [0xffff] },  // signed -1: the mark moves back one byte
        { playCount: 2, kinds: [9, 9], playFlags: [1, 3], playerHand: 6, oppHand: 6, flag: 1 },
        { playCount: 4, nearColour: 0, farColour: 0, kinds: [0, 0, 0, 0], filters: [0, 1, 0, 5], playerHand: 6, oppHand: 6 },
    ];
    for (const tc of CASES) compare(tc);
});

test("the played-row x pitch accumulates and the hand pitch does too", () => {
    // a full six-card play row exercises the 0x3200 x step and the ordinal bytes
    const a = compare({
        playCount: 6, kinds: [4, 4, 4, 4, 4, 4], playerHand: 6, oppHand: 6, flag: 1, playFlags: [1, 1, 1, 1, 1, 1],
    });
    const calls = a.got.events.filter((e) => e[0] === "positionSlot" && e[2] >= 0xc);
    assert.equal(calls.length, 6, "six played cards placed");
    assert.deepEqual(calls.map((c) => c[3] >>> 0), [0x5100, 0x8300, 0xb500, 0xe700, 0x11900, 0x14b00], "x pitch 0x3200");
    assert.deepEqual(calls.map((c) => c[4] >>> 0), [0x6100, 0x6100, 0x6100, 0x6100, 0x6100, 0x6100], "fixed y");
});

test("mutants: a constant colour, a dropped play row, a dropped flag and a dropped num diverge", () => {
    const tc = { playCount: 2, kinds: [4, 0], filters: [0, 3], sides: [0, 1], playFlags: [0, 1], playerHand: 6, oppHand: 6, flag: 1 };

    // mutant 1: the slot-colour query always answers 0 (classes 4..8 break).
    const a1 = runOriginal(tc);
    const b1 = runPort(tc, (h) => ({ ...h, slotColour: () => 0 }));
    assert.notDeepEqual(b1.got.view, a1.got.view, "a constant colour must diverge");

    // mutant 2: the played row is never placed.
    const b2 = runPort(tc, (h) => ({ ...h, positionSlot: (v, i, x, y) => { if (i < 0xc) h.positionSlot(v, i, x, y); } }));
    assert.notDeepEqual(b2.got.events, a1.got.events, "a dropped play row must diverge");

    // mutant 3: the browse flag never sets the opponent slots' +0x14D.
    const b3 = runPort(tc, null, (m) => ({
        write8: (x, v) => { if (!(v === 2 && (x >>> 0) >= VIEW)) m.write8(x, v); },
    }));
    assert.notDeepEqual(b3.got.view, a1.got.view, "a dropped browse flag must diverge");

    // mutant 4: the hand loop never overrides the slot's first printed number.
    const b4 = runPort(tc, null, (m) => ({
        write8: (x, v) => {
            const off = (x >>> 0) - VIEW;
            if (off >= 0 && off < VIEW_SPAN && off % 0x4c === 0x14b % 0x4c) return; // WRONG: skip numA
            m.write8(x, v);
        },
    }));
    assert.notDeepEqual(b4.got.view, a1.got.view, "a dropped hand num must diverge");
});
