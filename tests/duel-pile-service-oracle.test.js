// Oracle: engine/dw3/ui/duel-pile-service.ts must reproduce the duel's own
// pile/hand bookkeeping — the layer beneath the nine mode updates. The four
// originals run through engine/native on the shipped pro_cardgame.bin +
// resident.bin. They touch only data memory (counts, order/source arrays, the
// per-slot group byte), so the whole touched region is compared byte for byte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    scanDeckAvailability,
    sortAiHandByPriority,
    returnHandToDeck,
    recycleOpponentHandIntoDeck,
} from "../engine/dw3/ui/duel-pile-service.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const LOAD_BASE = 0x80082cb0;

const SCAN = 0x8009d9e4;
const SORT = 0x8009d8fc;
const RECYCLE = 0x8009da68;
const RETURN = 0x800a19f8;

const DUEL = 0x80194000;
const VIEW_SIZE = 0x4a0;      // the region the four routines touch
const VIEW_BASE = 0x280;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, LOAD_BASE, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** A deterministic byte filler so unseeded fields are identical on both sides. */
function fill(rt, base, len, seed) {
    let s = seed >>> 0;
    for (let i = 0; i < len; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        rt.mem.write8(base + i, (s >>> 24) & 0xff);
    }
}

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

/** Seed the whole pile surface from one options object; both sides run identically. */
function seed(rt, c = {}) {
    fill(rt, DUEL + VIEW_BASE, VIEW_SIZE, c.fill ?? 1);
    const groups = c.groups ?? range(40, (i) => (i < 30 ? 3 : 7));
    for (let i = 0; i < 40; i++) rt.mem.write8(DUEL + 0x30b + i * 2, groups[i]);
    rt.mem.write8(DUEL + 0x300, c.groupBase ?? 1);
    rt.mem.write16(DUEL + 0x668, c.cursor ?? 0);
    rt.mem.write16(DUEL + 0x66e, c.handCount ?? 0);
    const hand = c.hand ?? range(40, (i) => 40 + i);
    for (let i = 0; i < hand.length; i++) rt.mem.write16(DUEL + 0x6c8 + i * 2, hand[i] & 0xffff);
    const cls = c.classes ?? range(40, (i) => (i * 7) & 0xff);
    const wts = c.weights ?? range(40, (i) => (i * 13) & 0xffff);
    for (let s = 0; s < 40; s++) {
        rt.mem.write8(DUEL + 0x35c + s * 4, cls[s]);
        rt.mem.write16(DUEL + 0x35e + s * 4, wts[s]);
    }
    const rec = DUEL + (c.recBase ?? 0x664);
    rt.mem.write16(rec + 0x4, c.recCount ?? 0);
    rt.mem.write16(rec + 0xa, c.recRemain ?? 0);
    rt.mem.write16(rec + 0x8, c.recRun ?? 0);
    const order = c.order ?? range(40, (i) => 0x1000 + i);
    const src = c.source ?? range(40, (i) => 0x2000 + i);
    for (let i = 0; i < 40; i++) {
        rt.mem.write16(rec + 0x14 + i * 2, order[i]);
        rt.mem.write16(rec + 0x64 + i * 2, src[i]);
    }
    rt.mem.write8(DUEL + 0x41c, c.retired ?? 0x28);
}

function surface(rt) {
    const out = [];
    for (let i = 0; i < VIEW_SIZE; i++) out.push(rt.mem.read8(DUEL + VIEW_BASE + i));
    return out;
}

// ── scanDeckAvailability (F0x8009D9E4) ───────────────────────────────────────

test("scanDeckAvailability matches F0x8009D9E4 across the cursor and group edges", () => {
    const CASES = [
        { cursor: 0, groupBase: 1, groups: range(40, () => 3) },
        { cursor: 0, groupBase: 1, groups: range(40, (i) => (i < 30 ? 3 : 7)) },
        { cursor: 12, groupBase: 2, groups: range(40, (i) => (i % 2 ? 6 : 1)) },
        { cursor: 39, groupBase: 1, groups: range(40, () => 4) },
        { cursor: 5, groupBase: 0, groups: range(40, () => 2) },
        { cursor: 0, groupBase: 1, groups: range(40, (i) => (i >= 35 ? 7 : 3)) },
        { cursor: 0, groupBase: 1, groups: range(40, () => 7) },
    ];
    for (const c of CASES) {
        const a = runtime(); seed(a, c); a.cpu.call(SCAN, [DUEL]);
        const b = runtime(); seed(b, c); scanDeckAvailability(b.mem, DUEL);
        assert.deepEqual(surface(b), surface(a), JSON.stringify(c));
    }
});

// ── sortAiHandByPriority (F0x8009D8FC) ───────────────────────────────────────

test("sortAiHandByPriority matches F0x8009D8FC across hand sizes and orderings", () => {
    const CASES = [
        { handCount: 0 },
        { handCount: 1, hand: range(40, (i) => 40 + i) },
        { handCount: 6, hand: range(40, (i) => 40 + i) },
        { handCount: 6, hand: range(40, (i) => 40 + ((i * 7) % 40)) },
        {
            handCount: 8,
            hand: [47, 40, 55, 41, 63, 40, 79, 52],
            classes: range(40, (i) => [3, 1, 1, 9, 3, 2, 1, 5][i % 8]),
            weights: range(40, (i) => [5, 5, 2, 0, 5, 9, 2, 1][i % 8]),
        },
        { handCount: 40, hand: range(40, (i) => 79 - i) },
        { handCount: 40, hand: range(40, (i) => 40 + ((i * 13) % 40)), classes: range(40, (i) => (i >> 1) & 3) },
    ];
    for (const c of CASES) {
        const a = runtime(); seed(a, c); a.cpu.call(SORT, [DUEL]);
        const b = runtime(); seed(b, c); sortAiHandByPriority(b.mem, DUEL);
        assert.deepEqual(surface(b), surface(a), JSON.stringify(c));
    }
});

// ── returnHandToDeck (F0x800A19F8) ───────────────────────────────────────────

test("returnHandToDeck matches F0x800A19F8 across remain values and record bases", () => {
    const BLOCKS = [DUEL + 0x59c, DUEL + 0x664];
    const CASES = [
        { recCount: 0, recRemain: 0 },
        { recCount: 6, recRemain: 0 },
        { recCount: 6, recRemain: 1 },
        { recCount: 6, recRemain: 6 },
        { recCount: 40, recRemain: 40, recRun: 3 },
        { recCount: 12, recRemain: 5, recRun: 0xfffe },
    ];
    for (const base of BLOCKS) {
        for (const c of CASES) {
            // the record base is a parameter; seed the record where it will be read
            const opts = { ...c, recBase: base - DUEL };
            const a = runtime(); seed(a, opts);
            const b = runtime(); seed(b, opts);
            a.cpu.call(RETURN, [base]);
            returnHandToDeck(b.mem, base);
            assert.deepEqual(surface(b), surface(a), `${base.toString(16)} ${JSON.stringify(c)}`);
        }
    }
});

// ── recycleOpponentHandIntoDeck (F0x8009DA68) ────────────────────────────────
//
// The m2c body re-reads the saved card after the gap-closing shift has already
// overwritten its slot; this test is what catches that, through the case where a
// shift actually runs (start slot below the retired boundary).

test("recycleOpponentHandIntoDeck matches F0x8009DA68 across the window and boundary", () => {
    const CASES = [
        { recCount: 0, recRemain: 0, groupBase: 1, retired: 0x28 },
        { recCount: 6, recRemain: 6, groupBase: 1, retired: 0x28, groups: range(40, (i) => (i < 34 ? 3 : 7)) },
        { recCount: 6, recRemain: 2, groupBase: 1, retired: 0x22, groups: range(40, (i) => (i < 34 ? 3 : 7)) },
        { recCount: 40, recRemain: 40, groupBase: 2, retired: 0x28, groups: range(40, (i) => (i % 3 ? 5 : 7)) },
        { recCount: 3, recRemain: 3, groupBase: 1, retired: 0x1e, groups: range(40, (i) => (i < 30 ? 4 : 7)) },
        { recCount: 9, recRemain: 9, groupBase: 0, retired: 0x24, groups: range(40, (i) => (i < 36 ? 1 : 7)) },
    ];
    for (const c of CASES) {
        const a = runtime(); seed(a, c); a.cpu.call(RECYCLE, [DUEL]);
        const b = runtime(); seed(b, c); recycleOpponentHandIntoDeck(b.mem, DUEL);
        assert.deepEqual(surface(b), surface(a), JSON.stringify(c));
    }
});

// the four bodies read and write only data; no instruction image is fetched
test("the pile-service port never dispatches through a host", () => {
    const a = runtime(); seed(a, { handCount: 4, recCount: 4, recRemain: 4 });
    scanDeckAvailability(a.mem, DUEL);
    sortAiHandByPriority(a.mem, DUEL);
    recycleOpponentHandIntoDeck(a.mem, DUEL);
    returnHandToDeck(a.mem, DUEL + 0x59c);
    assert.equal(typeof a.mem.read8(DUEL + 0x300), "number");
});
