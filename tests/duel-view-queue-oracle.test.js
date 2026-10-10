// Phase 4 oracle: engine/dw3/ui/duel-view-queue.ts must reproduce pro/cardgame's
// dispatchDuelViewQueue. The original runs through engine/native on the shipped
// pro_cardgame.bin + resident.bin with the three far duel routines, the frame
// delta and the view's three method slots stubbed on both sides. The whole queue
// region of the duel, the view layout the setup arm writes, and the ordered
// boundary calls are compared.
//
// The two request switches are the shipped jump tables D0x80083800/D0x80083848;
// the first test pins the port's tables against the overlay words, so the case
// numbering of the arms is proved, not assumed (the m2c listing writes both as
// an irregular switch and does not recover which case is which request).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    CURRENT_VIEW_ARMS,
    DUEL_VIEW_QUEUE,
    PENDING_VIEW_ARMS,
    dispatchDuelViewQueue,
} from "../engine/dw3/ui/duel-view-queue.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const DISPATCH = 0x8009e668;
const LOAD_BASE = 0x80082cb0;
const PENDING_TABLE = 0x80083800;
const CURRENT_TABLE = 0x80083848;

const DUEL = 0x80194000;
const SCENE = 0x80195000;
const VIEW = 0x80190000;
const QUEUE_SPAN = 0x4e0 - 0x490;

// boundary stubs: the frame delta cell and the three far duel routines
const DELTA_CELL = 0x8004df9c;
const DELTA_STUB = 0x0fe50100;
const BROWSE_STUB = 0x0fe50110;
const PRIME_STUB = 0x0fe50120;
const REFRESH_STUB = 0x0fe50130;
// the view's three method slots
const SCALE_SLOT = 0xf24;
const OPEN_SLOT = 0xea4;
const CLOSE_SLOT = 0xea8;
const SCALE_STUB = 0x0fe50140;
const OPEN_STUB = 0x0fe50150;
const CLOSE_STUB = 0x0fe50160;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, LOAD_BASE, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** The value cell plus a per-case counter: the two delta calls must be ordered. */
function deltaSource() {
    const src = { n: 0, next: () => 0 };
    src.next = () => {
        src.n += 1;
        return src.n;
    };
    return src;
}

/** The original's boundaries; `events` records what the port must call too. */
function stubOriginal(rt, events, deltas) {
    rt.mem.write32(DELTA_CELL, DELTA_STUB);
    rt.cpu.setStub(DELTA_STUB, () => deltas.next());
    rt.cpu.setStub(0x8009dbe8, (c) => {
        events.push(["startAiPileBrowse", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(0x8009df68, (c) => {
        events.push(["primeAiPileBrowseCounts", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(0x8009e024, (c) => {
        events.push(["refreshFieldCardViews", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return 0;
    });
    rt.mem.write32(VIEW + SCALE_SLOT, SCALE_STUB);
    rt.mem.write32(VIEW + OPEN_SLOT, OPEN_STUB);
    rt.mem.write32(VIEW + CLOSE_SLOT, CLOSE_STUB);
    rt.cpu.setStub(SCALE_STUB, (c) => {
        events.push(["scaleSlot", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0,
            rt.mem.read32(c.reg(29) + 0x10) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(OPEN_STUB, (c) => {
        events.push(["openPlate", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(CLOSE_STUB, (c) => {
        events.push(["closePlate", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return 0;
    });
}

/** The same nine boundaries as the port's host, recording the same tuples. */
function portHost(rt, events, deltas) {
    return {
        frameDelta: () => deltas.next(),
        startAiPileBrowse(duel, scene, a, b) {
            events.push(["startAiPileBrowse", duel >>> 0, scene >>> 0, a >>> 0, b >>> 0]);
        },
        primeAiPileBrowseCounts(duel, scene, a, b) {
            events.push(["primeAiPileBrowseCounts", duel >>> 0, scene >>> 0, a >>> 0, b >>> 0]);
        },
        refreshFieldCardViews(duel, scene) {
            events.push(["refreshFieldCardViews", duel >>> 0, scene >>> 0]);
        },
        scaleSlot(view, index, span, from, to) {
            events.push(["scaleSlot", view >>> 0, index >>> 0, span >>> 0, from >>> 0, to >>> 0]);
        },
        openPlate(view, index, value) {
            events.push(["openPlate", view >>> 0, index >>> 0, value >>> 0]);
        },
        closePlate(view, index) {
            events.push(["closePlate", view >>> 0, index >>> 0]);
        },
    };
}

/**
 * A deterministic queue region: the request fields, the 40 slot bytes, both hand
 * counts, the played-card count and its play-history card ids.
 */
function seed(rt, o = {}) {
    const Q = DUEL_VIEW_QUEUE;
    for (let i = 0x490; i < 0x4e0; i++) rt.mem.write8(DUEL + i, 0);
    rt.mem.write8(DUEL + Q.current, o.current ?? 0);
    rt.mem.write8(DUEL + Q.pending, o.pending ?? 0);
    rt.mem.write8(DUEL + Q.next, o.next ?? 0xe5);
    rt.mem.write32(DUEL + Q.acc, o.acc ?? 0);
    rt.mem.write32(DUEL + Q.cursor, o.cursor ?? 0);
    rt.mem.write32(DUEL + Q.budget, o.budget ?? 4);
    rt.mem.write32(DUEL + Q.rows, o.rows ?? 4);
    rt.mem.write32(DUEL + Q.limit, o.limit ?? 100);
    for (let i = 0; i < Q.slotByteCount; i++) rt.mem.write8(DUEL + Q.slotBytes + i, 0x10 + i);
    rt.mem.write8(DUEL + Q.handCount, o.hand?.[0] ?? 3);
    rt.mem.write8(DUEL + Q.opponentHandCount, o.hand?.[1] ?? 5);
    rt.mem.write8(DUEL + Q.playCount, o.playCount ?? 2);
    for (let i = 0; i < 8; i++) rt.mem.write8(DUEL + Q.playCardId + i * Q.playRecordStride, 0x60 + i);
    for (let i = 0; i < 0x100; i++) rt.mem.write8(VIEW + i, 0);
    for (let i = 0; i < Q.slotByteCount; i++) {
        rt.mem.write8(VIEW + Q.layout + i * Q.layoutStride, 0xa0 + i);
    }
    rt.mem.write32(SCENE + 0x18, VIEW);
    rt.mem.write32(SCENE + 0x1c, 0xdeadbeef);
}

/** Everything the routine may touch: the queue region, the layout, the scene cell. */
function state(rt, events) {
    const Q = DUEL_VIEW_QUEUE;
    const out = { queue: [], layout: [], scene: rt.mem.read32(SCENE + 0x18) >>> 0, events };
    for (let i = 0; i < QUEUE_SPAN; i++) out.queue.push(rt.mem.read8(DUEL + 0x490 + i));
    for (let i = 0; i < Q.slotByteCount; i++) out.layout.push(rt.mem.read8(VIEW + Q.layout + i * Q.layoutStride));
    return out;
}

function runOriginal(tc) {
    const events = [];
    const deltas = deltaSource();
    const rt = runtime();
    stubOriginal(rt, events, deltas);
    seed(rt, tc);
    rt.cpu.call(DISPATCH, [DUEL, SCENE]);
    return { rt, got: state(rt, events), deltas: deltas.n };
}

function runPort(tc) {
    const events = [];
    const deltas = deltaSource();
    const rt = runtime();
    seed(rt, tc);
    dispatchDuelViewQueue(rt.mem, portHost(rt, events, deltas), DUEL, SCENE);
    return { rt, got: state(rt, events), deltas: deltas.n };
}

function compare(tc) {
    const a = runOriginal(tc);
    const b = runPort(tc);
    const label = JSON.stringify(tc);
    assert.deepEqual(b.got, a.got, label);
    assert.equal(b.deltas, a.deltas, `${label} frame-delta call count`);
    return a;
}

test("the two request tables are the shipped jump tables", () => {
    assert.equal(PENDING_VIEW_ARMS.length, 18);
    assert.equal(CURRENT_VIEW_ARMS.length, 18);
    for (let i = 0; i < 18; i++) {
        const off = PENDING_TABLE - LOAD_BASE + i * 4;
        const word = (overlay[off] | (overlay[off + 1] << 8) | (overlay[off + 2] << 16) | (overlay[off + 3] << 24)) >>> 0;
        assert.equal(word, PENDING_VIEW_ARMS[i] >>> 0, `pending request ${i + 1}`);
        const off2 = CURRENT_TABLE - LOAD_BASE + i * 4;
        const word2 = (overlay[off2] | (overlay[off2 + 1] << 8) | (overlay[off2 + 2] << 16) | (overlay[off2 + 3] << 24)) >>> 0;
        assert.equal(word2, CURRENT_VIEW_ARMS[i] >>> 0, `current request ${i + 1}`);
    }
});

test("every queued request matches F0x8009E668", () => {
    for (const pending of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 0xff]) {
        const a = compare({ pending });
        // the promotion happened whatever the request number was
        assert.equal(a.rt.mem.read8(DUEL + DUEL_VIEW_QUEUE.pending), 0, `pending ${pending} cleared`);
        if (pending === 17 || pending === 18) {
            // the two report requests finish in the frame they are promoted
            assert.equal(a.rt.mem.read8(DUEL + DUEL_VIEW_QUEUE.current), 0, `pending ${pending} finished`);
            assert.equal(a.rt.mem.read8(DUEL + DUEL_VIEW_QUEUE.next), pending === 17 ? 6 : 0xc, `pending ${pending} chain`);
        } else {
            assert.equal(a.rt.mem.read8(DUEL + DUEL_VIEW_QUEUE.next), (pending + 1) & 0xff, `pending ${pending} next`);
            // every other request keeps running (requests 1/2 chain a plate
            // request only once the elapsed counter passes the window)
            assert.equal(a.rt.mem.read8(DUEL + DUEL_VIEW_QUEUE.current), pending, `pending ${pending} keeps current`);
            assert.equal(a.rt.mem.read8(DUEL + DUEL_VIEW_QUEUE.pending), 0, `pending ${pending} no chain at the default seeds`);
        }
    }
});

test("the queued setup arms match F0x8009E668 with the cadence spent", () => {
    const CASES = [
        { pending: 1, hand: [6, 6] },
        { pending: 1, hand: [0, 0], budget: 0 },
        { pending: 1, hand: [3, 5], cursor: 2, acc: 40, limit: 10 },
        { pending: 2, hand: [0, 6] },
        { pending: 2, hand: [255, 255] },
        { pending: 3, playCount: 0 },
        { pending: 3, playCount: 6 },
        { pending: 3, playCount: 0xff }, // -1: the limit goes negative
        { pending: 4, playCount: 6 },
        { pending: 4, playCount: 0xff },
        { pending: 5, rows: 6 },
        { pending: 7, rows: 1 },
        { pending: 6, rows: 0 },
        { pending: 8 },
        { pending: 10 },
        { pending: 12, rows: 3 },
        { pending: 14 },
        { pending: 16 },
        { pending: 17 },
        { pending: 18 },
        { pending: 11, rows: 0 },
        { pending: 13, rows: 0 },
        { pending: 15, rows: 0 },
        { pending: 9, rows: 0 },
        { pending: 1, current: 7, hand: [2, 2] },   // the promotion overrides the current
    ];
    for (const tc of CASES) {
        const a = compare(tc);
        // every request's tick accumulates the frame delta twice; the two report
        // requests (17, 18) only chain and never tick, so they call it zero times.
        const expect = tc.pending === 17 || tc.pending === 18 ? 0 : 2;
        assert.equal(a.deltas, expect, `${JSON.stringify(tc)} delta calls`);
    }
});

test("every current request matches F0x8009E668", () => {
    const CASES = [];
    for (const current of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
        CASES.push({ current, cursor: 1, acc: 0, limit: 100, rows: 4, playCount: 2 });
    }
    CASES.push(
        { current: 0 },                       // nothing queued
        { current: 19 },                      // outside the table
        { current: 0xff },
        // request 1: the cadence gate, both row bounds and the chain into 3
        { current: 1, budget: 4, cursor: 0, acc: 0, limit: 100, hand: [3, 5] },
        { current: 1, budget: 3, cursor: 0, acc: 0, limit: 100, hand: [3, 5] },
        { current: 1, budget: 8, cursor: 4, acc: 7, limit: 7, hand: [6, 0] },
        { current: 1, budget: 4, cursor: 0, acc: 5, limit: 6, hand: [0, 2] },
        { current: 1, budget: 4, cursor: 9, acc: 5, limit: 6, hand: [3, 5] },
        { current: 1, budget: 4, cursor: 3, acc: 40, limit: 12, hand: [3, 3] },
        // request 2: the settle arm and its chain into 4
        { current: 2, budget: 4, cursor: 1, acc: 0, limit: 100, hand: [3, 5] },
        { current: 2, budget: 4, cursor: 40, acc: 20, limit: 10, hand: [3, 5] },
        // request 3: the plate open walk, both cursor edges and the report
        { current: 3, budget: 4, cursor: 0, acc: 0, limit: 100, playCount: 3 },
        { current: 3, budget: 4, cursor: 2, acc: 0, limit: 100, playCount: 3 },
        { current: 3, budget: 4, cursor: 3, acc: 0, limit: 100, playCount: 3 },
        { current: 3, budget: 4, cursor: 4, acc: 0, limit: 100, playCount: 3 },
        { current: 3, budget: 0, cursor: 1, acc: 50, limit: 10, playCount: 2 },
        { current: 3, budget: 4, cursor: 1, acc: 10, limit: 10, playCount: 2 },
        { current: 3, budget: 4, cursor: 0, acc: 0, limit: 100, playCount: 0 },
        // request 4: the plate close walk
        { current: 4, budget: 4, cursor: 0, acc: 0, limit: 100, playCount: 2 },
        { current: 4, budget: 4, cursor: 2, acc: 0, limit: 100, playCount: 2 },
        { current: 4, budget: 4, cursor: 4, acc: 40, limit: 10, playCount: 2 },
        { current: 4, budget: 4, cursor: 0, acc: 0, limit: 100, playCount: 0 },
        // the browse walk: the zero-row bound, the budget gate and the report
        { current: 5, budget: 4, cursor: 0, acc: 0, limit: 100, rows: 4 },
        { current: 5, budget: 4, cursor: 4, acc: 0, limit: 100, rows: 4 },
        { current: 5, budget: 0, cursor: 1, acc: 0, limit: 100, rows: 4 },
        { current: 5, budget: 4, cursor: 1, acc: 30, limit: 10, rows: 4 },
        { current: 5, budget: 4, cursor: 0, acc: 0, limit: 100, rows: 0 },
        { current: 7, budget: 4, cursor: 0, acc: 0, limit: 100, rows: -1 },
        { current: 12, budget: 4, cursor: 0, acc: 0, limit: 100, rows: 2 },
        { current: 16, budget: 4, cursor: 1, acc: 0, limit: 100, rows: 2 },
        { current: 17, budget: 4, cursor: 0, acc: 0, limit: 100 },
        { current: 18, budget: 4, cursor: 0, acc: 0, limit: 100 },
    );
    for (const tc of CASES) compare(tc);
});
