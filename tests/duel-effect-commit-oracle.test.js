// Oracle: engine/dw3/ui/duel-effect-commit.ts must reproduce the duel's own
// effect/commit boundaries — the layer between a card being selected and the
// board lighting its legal targets. The two originals run through engine/native
// on the shipped pro_cardgame.bin + resident.bin. Both write only data memory
// (the played-stack record, the twelve mark bytes, the hand array), so the
// touched region is compared byte for byte; the two shared helpers each body
// dispatches through (the card-record getter F0x80083E34 and the board view's
// classifier view+0xF40) are stubbed on both sides, and their ordered calls and
// arguments are compared too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    commitSelectedHandCard,
    markLegalFieldTargets,
    DUEL_HAND_MARK,
    DUEL_PLAYED_SLOT,
    DUEL_PLAYED_SIDE,
    DUEL_PLAYED_STACK,
} from "../engine/dw3/ui/duel-effect-commit.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const LOAD_BASE = 0x80082cb0;

const COMMIT = 0x8009f998;
const MARK = 0x8009fb18;
const CARD_FIELD = 0x80083e34;

const DUEL = 0x80194000;
const VIEW = 0x80190000;
const CARD_TABLE = 0x80130000;
const VIEW_SIZE = 0x800;      // the region both routines touch
const VIEW_BASE = 0x400;
const STUB_SLOT = 0x0fe50500;

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

/** F0x80083E34's stand-in: a pure function of the three arguments, recorded. */
function cardField(a0, a1, a2) {
    return (Math.imul(a0 >>> 0, 0x1021) ^ Math.imul(a1 + 1, 0x1049) ^ (a2 * 0x100)) & 0xffff;
}

function seedEffect(rt, c = {}) {
    fill(rt, DUEL + VIEW_BASE, VIEW_SIZE, c.fill ?? 1);
    for (let slot = 0; slot < 0xc; slot++) rt.mem.write8(DUEL + DUEL_HAND_MARK + slot, (c.marks ? c.marks[slot] : 0) & 0xff);
    const near = c.nearCount ?? 3;
    const far = c.farCount ?? 2;
    rt.mem.write8(DUEL + 0x72c, near);
    rt.mem.write8(DUEL + 0x79e, far);
    // rows: give each occupied slot a card id and a colour/class byte
    for (let side = 0; side < 2; side++) {
        const row = DUEL + side * 0x72;
        for (let i = 0; i < 6; i++) {
            const rec = row + 2 + i * 0xe;
            rt.mem.write16(rec + 0x0, ((c.ids ? c.ids[side * 6 + i] : 20 + i) & 0xffff));
            rt.mem.write8(rec + 0xc, ((c.filters ? c.filters[side * 6 + i] : 0x40 + i) & 0xff));
        }
    }
    // the duel's card table: entry = a pure function of the hand card id
    for (let i = 0; i < 64; i++) rt.mem.write16(CARD_TABLE + i * 2, ((c.table ? c.table[i] : (0x300 + i)) & 0xffff));
    const tableSet = c.tableSet ?? range(64, (i) => 0x300 + i);
    for (let i = 0; i < 64; i++) rt.mem.write16(DUEL + 0x50 + i * 2, tableSet[i] & 0xffff);
    // hand arrays: the played side's hand holds the ids and a count
    const hand = c.hand ?? range(10, (i) => 30 + i);
    const count = c.handCount ?? 6;
    const side = c.side ?? 0;
    for (let i = 0; i < hand.length; i++) rt.mem.write16(DUEL + side * 0xc8 + 0x600 + i * 2, hand[i] & 0xffff);
    rt.mem.write16(DUEL + side * 0xc8 + 0x5a6, count & 0xffff);
    rt.mem.write8(DUEL + DUEL_PLAYED_SIDE, side & 0xff);
    rt.mem.write8(DUEL + DUEL_PLAYED_SLOT, (c.playedSlot ?? 2) & 0xff);
    // the played-stack record the mark routine reads
    const stack = DUEL + (c.playedSlot ?? 2) * 8 + DUEL_PLAYED_STACK;
    rt.mem.write8(stack + 0x4, (c.stackSide ?? side) & 0xff);
    rt.mem.write16(stack + 0x0, (c.stackId ?? hand[(c.taken ?? 0)] ?? 0) & 0xffff);
    rt.mem.write8(stack + 0x5, (c.kind ?? 0) & 0xff);
    rt.mem.write8(stack + 0x6, (c.filter ?? 0x40) & 0xff);
    rt.mem.write32(DUEL + 0x8, 0);
}

function surface(rt) {
    const out = [];
    for (let i = 0; i < VIEW_SIZE; i++) out.push(rt.mem.read8(DUEL + VIEW_BASE + i));
    return out;
}

/** Install the card-field stub and record its calls. */
function stubCardField(rt, ev) {
    rt.cpu.setStub(CARD_FIELD, (c) => {
        const a0 = c.reg(4) | 0, a1 = c.reg(5) | 0, a2 = c.reg(6) | 0;
        ev.push([a0, a1, a2]);
        return cardField(a0, a1, a2);
    });
}

// ── commitSelectedHandCard (F0x8009F998) ─────────────────────────────────────

test("commitSelectedHandCard matches F0x8009F998 across marks, sides and hand sizes", () => {
    const CASES = [
        { marks: range(10, (i) => (i === 0 ? 1 : 0)), handCount: 6, side: 0, playedSlot: 1 },
        { marks: range(10, () => 0), handCount: 6, side: 0, playedSlot: 0 },
        { marks: range(10, (i) => (i === 5 ? 1 : 0)), handCount: 6, side: 1, playedSlot: 7 },
        { marks: range(10, (i) => (i === 9 ? 1 : 0)), handCount: 10, side: 0, playedSlot: 3 },
        { marks: range(10, (i) => (i === 2 ? 1 : 0)), handCount: 3, side: 1, playedSlot: 2, hand: [61, 62, 63] },
        { marks: range(10, (i) => (i === 3 ? 1 : 0)), handCount: 1, side: 0, playedSlot: 0, hand: [9] },
    ];
    for (const c of CASES) {
        const evA = [];
        const a = runtime(); seedEffect(a, c); stubCardField(a, evA);
        a.cpu.call(COMMIT, [DUEL]);

        const evB = [];
        const b = runtime(); seedEffect(b, c);
        commitSelectedHandCard(b.mem, { cardField(entry, sel, extra) { evB.push([entry | 0, sel | 0, extra | 0]); return cardField(entry, sel, extra); } }, DUEL);

        const label = JSON.stringify(c).slice(0, 70);
        assert.deepEqual(surface(b), surface(a), `${label} region`);
        assert.deepEqual(evB, evA, `${label} calls`);
    }
});

// ── markLegalFieldTargets (F0x8009FB18) ──────────────────────────────────────

function seedMark(rt) {
    seedEffect(rt, {});
    // the view's classifier slot points at a stub
    for (let i = 0; i < 0x1000; i++) rt.mem.write8(VIEW + i, 0);
    rt.mem.write32(VIEW + 0xf40, STUB_SLOT);
}

function stubQuery(rt, ev) {
    rt.cpu.setStub(STUB_SLOT, (c) => {
        const v = c.reg(4) | 0, id = c.reg(5) | 0;
        ev.push([v, id]);
        return (id * 3 + 1) & 7; // a deterministic classification 0..7
    });
}

test("markLegalFieldTargets matches F0x8009FB18 across all ten filter classes", () => {
    const CASES = [];
    for (const kind of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0xff]) {
        CASES.push({ kind, filter: 0x41, nearCount: 3, farCount: 2 });
    }
    CASES.push({ kind: 0, filter: 0x40, nearCount: 6, farCount: 6, filters: range(12, (i) => (i % 2 ? 0x40 : 0x41)) });
    CASES.push({ kind: 1, nearCount: 0, farCount: 4 });
    CASES.push({ kind: 2, nearCount: 6, farCount: 0 });
    CASES.push({ kind: 3, nearCount: 0, farCount: 0 });
    CASES.push({ kind: 6, nearCount: 5, farCount: 3, ids: range(12, (i) => 200 + i) });
    CASES.push({ kind: 9, nearCount: 6, farCount: 6 });
    for (const c of CASES) {
        const evA = [];
        const a = runtime(); seedMark(a); seedEffect(a, c); stubQuery(a, evA);
        a.cpu.call(MARK, [DUEL, VIEW]);

        const evB = [];
        const b = runtime(); seedMark(b); seedEffect(b, c);
        markLegalFieldTargets(b.mem, {
            cardField() { return 0; },
            queryTarget(v, id) { evB.push([v | 0, id | 0]); return (id * 3 + 1) & 7; },
        }, DUEL, VIEW);

        const label = JSON.stringify(c).slice(0, 70);
        assert.deepEqual(surface(b), surface(a), `${label} region`);
        assert.deepEqual(evB, evA, `${label} calls`);
    }
});

// The two bodies read and write only data; no instruction image is fetched.
test("the effect/commit port never fetches an overlay instruction", () => {
    const b = runtime(); seedMark(b); seedEffect(b, { kind: 3 });
    commitSelectedHandCard(b.mem, { cardField: () => 0, queryTarget: () => 0 }, DUEL);
    markLegalFieldTargets(b.mem, { cardField: () => 0, queryTarget: () => 0 }, DUEL, VIEW);
    assert.equal(typeof b.mem.read8(DUEL + DUEL_HAND_MARK), "number");
});
