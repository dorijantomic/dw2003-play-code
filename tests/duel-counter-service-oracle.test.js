// Oracle: engine/dw3/ui/duel-counter-service.ts must reproduce the duel's own
// counter/stat presentation services — the layer that keeps the HUD numbers and
// the two side totals honest. The originals run through engine/native on the
// shipped pro_cardgame.bin + resident.bin. The pure writers are compared byte
// for byte; refreshAllCounters dispatches every number through the view slot
// +0xEA0, so that slot is stubbed on both sides and the ordered calls and their
// arguments are compared too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    refreshAllCounters,
    recomputeSideTotals,
    applyDynamicStatMega,
    applyDynamicStatMegas,
    DUEL_DYNAMIC_STAT_MEGAS,
} from "../engine/dw3/ui/duel-counter-service.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const LOAD_BASE = 0x80082cb0;

const REFRESH = 0x8009edcc;
const RECOMPUTE = 0x800a0acc;
const MEGA = 0x800a0844;
const MEGAS = 0x800a09fc;

const DUEL = 0x80194000;
const VIEW = 0x80190000;
const CTX = 0x80195000;
const VIEW_SIZE = 0x800;
const VIEW_BASE = 0x400;
const STUB_SLOT = 0x0fe50500;
const MEGA_TABLE = 0x800a5c20;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, LOAD_BASE, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function fill(rt, base, len, seed) {
    let s = seed >>> 0;
    for (let i = 0; i < len; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        rt.mem.write8(base + i, (s >>> 24) & 0xff);
    }
}

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

function seedCounters(rt, c = {}) {
    fill(rt, DUEL + VIEW_BASE, VIEW_SIZE, c.fill ?? 1);
    for (let side = 0; side < 2; side++) {
        const block = DUEL + side * 0xc8;
        for (let k = 0; k < 5; k++) rt.mem.write8(block + 0x5a8 + k, (c.energy ? c.energy[side * 5 + k] : 10 + side * 5 + k) & 0xff);
        rt.mem.write16(block + 0x5a4, (c.deck ? c.deck[side] : 30 - side) & 0xffff);
        rt.mem.write16(block + 0x5a6, (c.hand ? c.hand[side] : 6 - side) & 0xffff);
        rt.mem.write16(block + 0x5a2, (c.trash ? c.trash[side] : 2 + side) & 0xffff);
        rt.mem.write16(block + 0x59c, (c.totalAp ? c.totalAp[side] : 100 + side) & 0xffff);
        rt.mem.write16(block + 0x59e, (c.totalHp ? c.totalHp[side] : 200 + side) & 0xffff);
    }
    // rows: count, per-slot card id, base, and the two summed stats
    for (let side = 0; side < 2; side++) {
        const row = DUEL + side * 0x72;
        rt.mem.write8(row + 0x72c, (c.nearCount ?? (side === 0 ? 3 : 2)) & 0xff);
        for (let i = 0; i < 6; i++) {
            const rec = row + 2 + i * 0xe;
            rt.mem.write16(rec + 0x0, (c.ids ? c.ids[side * 6 + i] : 20 + side * 6 + i) & 0xffff);
            rt.mem.write16(rec + 0x2, (c.bases ? c.bases[side * 6 + i] : 5 + i) & 0xffff);
            rt.mem.write16(rec + 0x734, (c.sumAp ? c.sumAp[side * 6 + i] : 10 + i) & 0xffff);
            rt.mem.write16(rec + 0x736, (c.sumHp ? c.sumHp[side * 6 + i] : 20 + i) & 0xffff);
        }
    }
    // the duel's card table and the two side counts the megas read
    const table = c.table ?? range(64, (i) => 0x300 + i);
    for (let i = 0; i < 64; i++) rt.mem.write16(DUEL + 0x50 + i * 2, table[i] & 0xffff);
    rt.mem.write32(CTX + 0x18, VIEW);
    rt.mem.write32(VIEW + 0xea0, STUB_SLOT);
}

function surface(rt) {
    const out = [];
    for (let i = 0; i < VIEW_SIZE; i++) out.push(rt.mem.read8(DUEL + VIEW_BASE + i));
    return out;
}

function stubHud(rt, ev) {
    rt.cpu.setStub(STUB_SLOT, (c) => {
        ev.push([c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return 0;
    });
}

// ── refreshAllCounters (F0x8009EDCC) ─────────────────────────────────────────

test("refreshAllCounters matches F0x8009EDCC across both sides' ten readouts", () => {
    const CASES = [
        {},
        { energy: range(10, (i) => 0x80 + i), deck: [0, 40], hand: [0xfffe, 0x7fff], trash: [-1, 0], totalAp: [0xffff, 1], totalHp: [0x8000, 0x7fff] },
        { deck: [0, 0], hand: [0, 0], trash: [0, 0], totalAp: [0, 0], totalHp: [0, 0] },
    ];
    for (const c of CASES) {
        const evA = [];
        const a = runtime(); seedCounters(a, c); stubHud(a, evA);
        a.cpu.call(REFRESH, [DUEL, CTX]);

        const evB = [];
        const b = runtime(); seedCounters(b, c);
        refreshAllCounters(b.mem, { setHudCounter(view, side, index, value) { evB.push([view | 0, side | 0, index | 0, value | 0]); } }, DUEL, CTX);

        const label = JSON.stringify(c).slice(0, 70);
        assert.deepEqual(surface(b), surface(a), `${label} region`);
        assert.deepEqual(evB, evA, `${label} calls`);
    }
});

// ── recomputeSideTotals (F0x800A0ACC) ────────────────────────────────────────

test("recomputeSideTotals matches F0x800A0ACC across sides and row counts", () => {
    const CASES = [
        { nearCount: 3 },
        { nearCount: 0 },
        { nearCount: 6, sumAp: range(12, (i) => 0x7000 + i * 0x111), sumHp: range(12, (i) => 0xffff - i) },
        { nearCount: 4, sumAp: range(12, () => 0xffff), sumHp: range(12, () => 1) },
    ];
    for (const c of CASES) {
        for (const side of [0, 1]) {
            const a = runtime(); seedCounters(a, c); a.cpu.call(RECOMPUTE, [DUEL, side]);
            const b = runtime(); seedCounters(b, c); recomputeSideTotals(b.mem, DUEL, side);
            assert.deepEqual(surface(b), surface(a), `${JSON.stringify(c).slice(0, 40)} side=${side}`);
        }
    }
});

// ── applyDynamicStatMega (F0x800A0844) ───────────────────────────────────────

test("applyDynamicStatMega matches F0x800A0844 across colours, sides and card ids", () => {
    // card table: make ids 20,21,22,23,24 be the five megas, and 40 a non-mega
    const table = range(64, (i) => 0x300 + i);
    [68, 111, 154, 197, 240].forEach((id, k) => { table[20 + k] = id; });
    const CASES = [];
    for (let colour = 0; colour < 5; colour++) {
        for (const cardId of [20 + colour, 40, 21]) {
            CASES.push({ colour, cardId, table, bases: range(12, () => 7 + colour) });
        }
    }
    for (const c of CASES) {
        const side = c.colour % 2;
        const slot = DUEL + side * 0x72 + 2 + 2 * 0xe;
        const ids = range(12, () => c.cardId);
        const a = runtime(); seedCounters(a, { ...c, ids }); a.cpu.call(MEGA, [DUEL, slot, side, c.colour]);
        const b = runtime(); seedCounters(b, { ...c, ids }); applyDynamicStatMega(b.mem, DUEL, slot, side, c.colour);
        assert.deepEqual(surface(b), surface(a), `colour=${c.colour} card=${c.cardId}`);
    }
});

// ── applyDynamicStatMegas (F0x800A09FC) ──────────────────────────────────────

test("applyDynamicStatMegas matches F0x800A09FC across row contents", () => {
    const table = range(64, (i) => 0x300 + i);
    [68, 111, 154, 197, 240].forEach((id, k) => { table[20 + k] = id; });
    const CASES = [
        { nearCount: 3, table },
        { nearCount: 0, table },
        { nearCount: 6, table, hand: [3, 4], trash: [2, 5] },
        { nearCount: 6, table, ids: range(12, (i) => (i < 5 ? 20 + (i % 5) : 20 + (i % 5))), bases: range(12, (i) => i) },
        { nearCount: 6, table, ids: range(12, () => 40) },
    ];
    for (const c of CASES) {
        const a = runtime(); seedCounters(a, c);
        const ra = a.cpu.call(MEGAS, [DUEL]) | 0;
        const b = runtime(); seedCounters(b, c);
        const rb = applyDynamicStatMegas(b.mem, DUEL) | 0;
        const label = JSON.stringify(c).slice(0, 60);
        assert.equal(rb, ra, `${label} return`);
        assert.deepEqual(surface(b), surface(a), `${label} region`);
    }
});

// The port's built-in mega id list is the disc's own table, read at runtime.
test("the mega id list equals the overlay table D0x800A5C20", () => {
    const rt = runtime();
    const fromImage = DUEL_DYNAMIC_STAT_MEGAS.map((_, k) => rt.mem.read16s(MEGA_TABLE + k * 2));
    assert.deepEqual(fromImage, [...DUEL_DYNAMIC_STAT_MEGAS]);
});

// The four bodies read and write only data; no instruction image is fetched.
test("the counter/stat port never fetches an overlay instruction", () => {
    const b = runtime(); seedCounters(b, {});
    refreshAllCounters(b.mem, { setHudCounter() {} }, DUEL, CTX);
    recomputeSideTotals(b.mem, DUEL, 0);
    applyDynamicStatMegas(b.mem, DUEL);
    applyDynamicStatMega(b.mem, DUEL, DUEL + 2, 0, 0);
    assert.equal(typeof b.mem.read8(DUEL + 0x59c), "number");
});
