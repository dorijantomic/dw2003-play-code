// Oracle: engine/dw3/ui/duel-phase-enters.ts must reproduce pro/cardgame's
// pending-9 enter F0x800A1A5C. The original runs through engine/native on the
// shipped pro_cardgame.bin + resident.bin with its five far callees (four direct
// and the duel object's +0x810 method pointer) stubbed to recording stubs, so
// only the arm's own stores and the ordered call log are compared.
//
// The fields that matter are varied independently: the hand block's offset and
// count (the shuffle's two arguments), the round counter, and every word the arm
// clears. A mutant that skips the round increment and mis-clears the pair must
// fail — the test proves its own discrimination.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    enterPendingNine, handSelectionSort, enterPendingFiveSeven, enterPendingEight,
    DUEL_HAND_BLOCK, DUEL_CLEAR_574, DUEL_HAND_STORE, DUEL_HAND_COUNT,
} from "../engine/dw3/ui/duel-phase-enters.ts";
import { slideBothPanelsIn } from "../engine/dw3/ui/duel-view-methods.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ENTER_NINE = 0x800a1a5c;
const RETURN_HAND = 0x800a19f8;
const RECYCLE_HAND = 0x8009da68;
const REFRESH_COUNTERS = 0x8009edcc;
const SCAN_DECK = 0x8009d9e4;
const SHUFFLE_STUB = 0x8000ff00;

const DUEL = 0x80194000;
const SCENE = 0x80195000;
const DUEL_METHOD_810 = 0x810;

/** Every byte the arm can write, plus the call arguments. */
const SPAN = 0x400;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function seed(mem, o) {
    for (let i = 0; i < SPAN; i++) mem.write8(DUEL + i, 0x5a);
    mem.write32(DUEL + 0x810, SHUFFLE_STUB);
    mem.write8(DUEL + 0x300, o.counter);
    mem.write8(DUEL + 0x304, o.flag304);
    mem.write8(DUEL + 0x305, o.flag305);
    mem.write16(DUEL + DUEL_HAND_BLOCK, o.hand0);
    mem.write16(DUEL + DUEL_HAND_BLOCK + 2, o.hand1);
    mem.write16(DUEL + 0x5a0, o.offset);
    mem.write16(DUEL + 0x5a4, o.count);
    mem.write16(DUEL + 0x664, o.clear664);
    mem.write16(DUEL + 0x666, o.clear666);
}

function fields(mem) {
    const out = [];
    for (let i = 0; i < SPAN; i++) out.push(mem.read8(DUEL + i));
    return out;
}

/** Run the original with all five callees stubbed, recording the call log. */
function runOriginal(rt, ev) {
    rt.cpu.setStub(RETURN_HAND, (c) => { ev.push(["returnHandToDeck", c.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(RECYCLE_HAND, (c) => { ev.push(["recycleOpponentHandIntoDeck", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(SHUFFLE_STUB, (c) => { ev.push(["shufflePile", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]); return 0; });
    rt.cpu.setStub(REFRESH_COUNTERS, (c) => { ev.push(["refreshCounters", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(SCAN_DECK, (c) => { ev.push(["scanDeck", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
    rt.cpu.call(ENTER_NINE, [DUEL, SCENE]);
}

function portHost(ev) {
    return {
        returnHandToDeck: (b) => ev.push(["returnHandToDeck", b >>> 0]),
        recycleOpponentHandIntoDeck: (d, s) => ev.push(["recycleOpponentHandIntoDeck", d >>> 0, s >>> 0]),
        shufflePile: (d, off, n) => ev.push(["shufflePile", d >>> 0, off >>> 0, n >>> 0]),
        refreshCounters: (d, s) => ev.push(["refreshCounters", d >>> 0, s >>> 0]),
        scanDeck: (d, s) => ev.push(["scanDeck", d >>> 0, s >>> 0]),
        sortHand: (a, b, packed, flags) => ev.push(["sortHand", a >>> 0, b >>> 0, packed | 0, flags | 0]),
        slidePanelsIn: (v) => ev.push(["slidePanelsIn", v >>> 0]),
    };
}

const CASES = [
    { counter: 0, flag304: 1, flag305: 2, hand0: 0x1111, hand1: 0x2222, offset: 0, count: 40, clear664: 0xffff, clear666: 0xffff },
    { counter: 7, flag304: 0, flag305: 0, hand0: 0, hand1: 0, offset: 12, count: 3, clear664: 0, clear666: 0 },
    { counter: 0xff, flag304: 0x5a, flag305: 0x5a, hand0: 0xabcd, hand1: 0x8000, offset: 0x7fff, count: 0xffff, clear664: 0x1234, clear666: 0x5678 },
];

test("enterPendingNine matches F0x800A1A5C", () => {
    for (const o of CASES) {
        const evA = [];
        const a = runtime();
        seed(a.mem, o);
        runOriginal(a, evA);

        const evB = [];
        const b = runtime();
        seed(b.mem, o);
        enterPendingNine(b.mem, portHost(evB), DUEL, SCENE);

        assert.deepEqual(fields(b.mem), fields(a.mem), JSON.stringify(o));
        assert.deepEqual(evB, evA, `${JSON.stringify(o)} calls`);
    }
});

test("the arm's call order and arguments are pinned", () => {
    const o = CASES[0];
    const evA = [];
    const a = runtime();
    seed(a.mem, o);
    runOriginal(a, evA);
    assert.deepEqual(evA, [
        ["returnHandToDeck", DUEL + DUEL_HAND_BLOCK],
        ["recycleOpponentHandIntoDeck", DUEL, SCENE],
        ["shufflePile", DUEL, o.offset, o.count],
        ["refreshCounters", DUEL, SCENE],
        ["scanDeck", DUEL, SCENE],
    ]);
    // the round counter ticked and the cleared words are zero
    assert.equal(a.mem.read8(DUEL + 0x300), (o.counter + 1) & 0xff);
    assert.equal(a.mem.read16(DUEL + 0x666), 0);
});

test("a mutant that skips the round tick and mis-clears fails", () => {
    const o = CASES[0];
    const a = runtime();
    seed(a.mem, o);
    runOriginal(a, []);

    const mutant = (mem, h) => {
        // the same five calls, but: no round increment, and 0x664 written twice
        h.returnHandToDeck(DUEL + DUEL_HAND_BLOCK);
        h.recycleOpponentHandIntoDeck(DUEL, SCENE);
        h.shufflePile(DUEL, mem.read16s(DUEL + DUEL_HAND_BLOCK + 4), mem.read16s(DUEL + DUEL_HAND_BLOCK + 8));
        mem.write8(DUEL + 0x304, 0);
        mem.write8(DUEL + 0x305, 0);
        mem.write16(DUEL + DUEL_HAND_BLOCK, 0);
        mem.write16(DUEL + DUEL_HAND_BLOCK + 2, 0);
        mem.write16(DUEL + 0x664, 0);
        mem.write16(DUEL + 0x664, 0);
        h.refreshCounters(DUEL, SCENE);
        h.scanDeck(DUEL, SCENE);
    };
    const b = runtime();
    seed(b.mem, o);
    const ev = [];
    mutant(b.mem, portHost(ev));
    assert.notDeepEqual(fields(b.mem), fields(a.mem), "the mutant must diverge");
    assert.notEqual(b.mem.read8(DUEL + 0x300), a.mem.read8(DUEL + 0x300), "the round counter is the telltale");
    assert.equal(b.mem.read16(DUEL + 0x666), o.clear666, "0x666 was left un-cleared");
});

// ── pending 5/7 (with the hand selection sort) and pending 8 ─────────────────

const SORT = 0x8009eefc;
const ENTER_5 = 0x800a0548;
const ENTER_8 = 0x800a0f4c;
const VIEW = 0x80190000;
const SORT_SPAN = 0x700;

/** Every duel byte the sort and the two enters can touch (0x000..0x700). */
function sortFields(mem) {
    const out = [];
    for (let i = 0; i < SORT_SPAN; i++) out.push(mem.read8(DUEL + i));
    return out;
}

/** Seed the sort's A (duel) / B (duel+0x600) arrays plus the key and meta tables. */
function seedSort(mem, c) {
    for (let a = 0; a < 0x800; a++) mem.write8(DUEL + a, 0);
    for (let i = 0; i < c.b.length; i++) mem.write16(DUEL + DUEL_HAND_STORE + i * 2, c.b[i] & 0xffff);
    for (let idx = 0; idx < c.keys.length; idx++) mem.write16(DUEL + idx * 2 + 0x50, c.keys[idx] & 0xffff);
    for (let idx = 0; idx < c.tags.length; idx++) {
        mem.write8(DUEL + idx * 2 + 0x30a, c.tags[idx][0]);
        mem.write8(DUEL + idx * 2 + 0x30b, c.tags[idx][1]);
    }
    for (let i = 0; i < c.extra.length; i++) mem.write8(DUEL + i + 0x446, c.extra[i]);
}

const SORT_CASES = [
    { name: "empty", packed: 0, flags: 0 },
    { name: "single", packed: (1 << 16), flags: 0 },
    { name: "two", packed: (2 << 16), flags: 0 },
    { name: "five ascending", packed: (5 << 16), flags: 0 },
    { name: "six with flagA", packed: (6 << 16), flags: 1 },
    { name: "six with both flags", packed: (6 << 16), flags: 3 },
    { name: "start 1", packed: (6 << 16) | 1, flags: 1 },
].map((c) => ({
    ...c,
    b: [4, 0, 5, 2, 3, 1], keys: [2, 7, 1, 9, 4, 6],
    tags: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]], extra: [1, 2, 3, 4, 5, 6],
}));

test("handSelectionSort matches the duel's +0x814 selection sort F0x8009EEFC", () => {
    for (const c of SORT_CASES) {
        const a = runtime(); seedSort(a.mem, c);
        a.cpu.call(SORT, [DUEL, DUEL + DUEL_HAND_STORE, c.packed | 0, c.flags | 0]);

        const b = runtime(); seedSort(b.mem, c);
        handSelectionSort(b.mem, DUEL, DUEL + DUEL_HAND_STORE, c.packed | 0, c.flags | 0);

        assert.deepEqual(sortFields(b.mem), sortFields(a.mem), `${c.name} duel`);
    }
});

test("enterPendingFiveSeven matches F0x800A0548", () => {
    const c = SORT_CASES[4];
    const a = runtime(); seedSort(a.mem, c);
    a.mem.write16(DUEL + DUEL_HAND_COUNT, 6);
    a.mem.write32(DUEL + 0x814, SORT);
    a.cpu.setStub(REFRESH_COUNTERS, (cc) => { a.mem.write32(DUEL + 0x7ff, cc.reg(4) >>> 0); return 0; });
    a.cpu.call(ENTER_5, [DUEL, SCENE]);

    const b = runtime(); seedSort(b.mem, c);
    b.mem.write16(DUEL + DUEL_HAND_COUNT, 6);
    const ev = [];
    enterPendingFiveSeven(b.mem, {
        refreshCounters: (d, s) => ev.push(["hud", d >>> 0, s >>> 0]),
        sortHand: (aa, bb, packed, flags) => handSelectionSort(b.mem, aa, bb, packed, flags),
        returnHandToDeck: () => {}, recycleOpponentHandIntoDeck: () => {}, shufflePile: () => {},
        scanDeck: () => {}, slidePanelsIn: () => {},
    }, DUEL, SCENE);

    assert.deepEqual(sortFields(b.mem), sortFields(a.mem), "pending-5/7 duel");
    assert.equal(b.mem.read8(DUEL + DUEL_CLEAR_574), 0);
    assert.deepEqual(ev, [["hud", DUEL, SCENE]]);
});

test("enterPendingEight matches F0x800A0F4C", () => {
    const seed8 = (mem) => {
        for (let o = 0; o < 0x800; o++) mem.write8(DUEL + o, 0x5a);
        for (let o = 0; o < 0x400; o++) mem.write8(SCENE + o, 0x5a);
        mem.write32(SCENE + 0x18, VIEW);
        for (let o = 0x40; o < 0x480; o++) mem.write8(VIEW + o, 0xa5);
    };
    const a = runtime(); seed8(a.mem);
    a.mem.write32(VIEW + 0xec8, 0x8009c2d0);   // the real slideBothPanelsIn
    a.cpu.call(ENTER_8, [DUEL, SCENE]);

    const b = runtime(); seed8(b.mem);
    let seen = -1;
    enterPendingEight(b.mem, {
        slidePanelsIn: (view) => { seen = view | 0; slideBothPanelsIn(b.mem, view); },
        returnHandToDeck: () => {}, recycleOpponentHandIntoDeck: () => {}, shufflePile: () => {},
        refreshCounters: () => {}, scanDeck: () => {}, sortHand: () => {},
    }, DUEL, SCENE);

    assert.equal(seen >>> 0, VIEW);
    const vb = [], va = [];
    for (let o = 0x40; o < 0x480; o++) { vb.push(b.mem.read8(VIEW + o)); va.push(a.mem.read8(VIEW + o)); }
    assert.deepEqual(vb, va, "pending-8 view");
    assert.deepEqual(fields(b.mem), fields(a.mem), "pending-8 duel");
});

test("a sort that never swaps its hand store diverges", () => {
    const c = SORT_CASES[3];
    const a = runtime(); seedSort(a.mem, c);
    a.cpu.call(SORT, [DUEL, DUEL + DUEL_HAND_STORE, (5 << 16) | 0, 0]);
    const b = runtime(); seedSort(b.mem, c);   // WRONG: the mutant leaves the store as seeded
    assert.notDeepEqual(sortFields(b.mem), sortFields(a.mem), "the un-sorted hand store must diverge");
    assert.notEqual(a.mem.read16(DUEL + DUEL_HAND_STORE) & 0xffff, c.b[0], "the real sort reorders slot 0");
});
