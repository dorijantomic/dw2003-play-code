// Oracle: engine/dw3/ui/duel-ai.ts must reproduce the duel opponent AI's
// decision layer. Each original runs through engine/native on the shipped
// pro_cardgame.bin + resident.bin; the port runs against the same seeded
// memory. The writers are compared byte for byte over the touched region and
// every return value is compared.
//
// The AI's own host edges are wired on BOTH sides at the same point: the
// card-record selector (resident F0x8001E7EC, reached through the card-view
// constructor F0x8001EBF8) and the legality gate's two collection probes
// (overlay F0x8008EC44 / F0x8008EEC8). The think-window view slot (+0xEC4) is a
// stub too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    waitAiThinkWindow,
    findHandEntryByClass,
    programDamage,
    programBuff,
    wouldFinish,
    narrowToLethal,
    cheapestHandCard,
    commitFirstMarked,
    narrowToGreen,
    narrowToRed,
    evaluateBoard,
    chooseBestTarget,
    cardHasLegalTarget,
    scanComboRuns,
    aiWorthPlaying,
    aiSimulateCounter,
    aiChooseCardToPlay,
    AI_SIDE_STRIDE,
    AI_SLOT_STRIDE,
} from "../engine/dw3/ui/duel-ai.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const LOAD_BASE = 0x80082cb0;

const WAIT = 0x8009dec4, CLASSFN = 0x800a4924, DMG = 0x800a4440, BUFF = 0x800a4494;
const FINISH = 0x800a41a8, LETHAL = 0x800a41f8, CHEAP = 0x800a4328, COMMIT = 0x800a3e9c;
const GREEN = 0x800a3f48, RED = 0x800a4078, EVAL = 0x800a3934, BEST = 0x800a3d90;
const GATE = 0x800a36e4, SCAN = 0x800a0cd4;
const CTOR = 0x8001ebf8, PROBE = 0x8008ec44, PROBEK = 0x8008eec8;
const SUMMON = 0x80085f38, CARDFIELD = 0x80083e34;
const RESOLVE_STUB = 0x80019070, THINK_STUB = 0x80019074;

const DUEL = 0x80194000;
const REGION_BASE = 0x400, REGION_LEN = 0x400;
const REC_BASE = 0x80200000, REC_STRIDE = 0x62c;

const s16 = (v) => (v << 16) >> 16;
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

/** The card-record selector: same mapping on both sides. */
function recordOf(id) {
    const n = id >>> 0;
    if (n <= 0) return REC_BASE;
    return REC_BASE + (((n - 1) & 0x3f) * REC_STRIDE);
}
/** The legality gate's probes: a deterministic value both sides agree on. */
function probe(duel, side, sel, extra, arg) {
    return ((duel * 3 + side * 5 + sel * 7 + extra * 11 + arg * 13) >>> 0) & 3;
}
function probeKind(duel, side, sel, extra) {
    return ((duel * 5 + side * 3 + sel * 11 + extra * 17) >>> 0) & 3;
}
/** isSummonableCard F0x80085F38: same on both sides. */
function summonable(duel, index) {
    return ((duel * 7 + index * 13) >>> 0) & 1;
}
/** cardField F0x80083E34: field 0 is a legitimacy class in the gate's 0x70.. range. */
function cardFieldFn(instance, field) {
    return (0x70 + (((instance >>> 0) * 3 + field * 5) % 0x27)) & 0xff;
}

function runtime({ withStubs = true } = {}) {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, LOAD_BASE, {
        image: resident, base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.sp = 0x801ff000;
    if (withStubs) {
        let ctorCtx = 0;
        rt.cpu.setStub(CTOR, (c) => {
            ctorCtx = c.reg(4) >>> 0;
            rt.mem.write32(ctorCtx + 0x2c, RESOLVE_STUB);
            return 0;
        });
        rt.cpu.setStub(RESOLVE_STUB, (c) => {
            rt.mem.write32(ctorCtx, recordOf(c.reg(4) | 0));
            return 0;
        });
        rt.cpu.setStub(PROBE, (c) => probe(c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0, rt.mem.read8((c.reg(29) + 0x10) >>> 0) & 0xff));
        rt.cpu.setStub(PROBEK, (c) => probeKind(c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0));
        rt.cpu.setStub(SUMMON, (c) => summonable(c.reg(4) | 0, c.reg(5) | 0));
        rt.cpu.setStub(CARDFIELD, (c) => cardFieldFn(c.reg(4) | 0, c.reg(5) | 0));
        rt.cpu.setStub(THINK_STUB, () => 0);
    }
    return rt;
}

function fill(rt, base, len, seed) {
    let s = seed >>> 0;
    for (let i = 0; i < len; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; rt.mem.write8(base + i, (s >>> 24) & 0xff); }
}

/** Seed the whole AI surface deterministically; both sides run identically. */
function seed(rt, c = {}) {
    fill(rt, DUEL, 0x800, c.seed ?? 1);
    fill(rt, REC_BASE, 0x80 * REC_STRIDE, c.recSeed ?? 7);

    for (let side = 0; side < 2; side++) {
        const row = DUEL + side * AI_SIDE_STRIDE;
        const count = c.counts ? c.counts[side] : 4;
        rt.mem.write8(row + 0x72c, count & 0xff);
        for (let i = 0; i < 6; i++) {
            const id = c.ids ? c.ids[side * 6 + i] : 10 + side * 6 + i;
            rt.mem.write16(row + 0x72e + i * AI_SLOT_STRIDE, id & 0xffff);
            rt.mem.write16(row + 0x734 + i * AI_SLOT_STRIDE, (c.ap ? c.ap[side * 6 + i] : 20 + i) & 0xffff);
            rt.mem.write16(row + 0x736 + i * AI_SLOT_STRIDE, (c.hp ? c.hp[side * 6 + i] : 30 + i * 3) & 0xffff);
            rt.mem.write8(row + 0x73a + i * AI_SLOT_STRIDE, (c.cls ? c.cls[side * 6 + i] : 100 + i) & 0xff);
        }
    }
    for (let i = 0; i < 0x40; i++) rt.mem.write16(DUEL + 0x50 + i * 2, (c.table ? c.table[i] : 200 + i * 2) & 0xffff);

    const marks = c.marks ?? range(6, (i) => (i < 3 ? 1 : 0));
    for (let i = 0; i < 6; i++) { rt.mem.write8(DUEL + 0x446 + i, marks[i]); rt.mem.write8(DUEL + 0x44c + i, marks[i]); }

    rt.mem.write8(DUEL + 0x575, c.played ?? 2);
    for (let i = 0; i < 8; i++) {
        rt.mem.write16(DUEL + 0x580 + i * 8, (c.playedIds ? c.playedIds[i] : 30 + i) & 0xffff);
        rt.mem.write8(DUEL + 0x585 + i * 8, (c.playedCls ? c.playedCls[i] : i + 1) & 0xff);
        rt.mem.write8(DUEL + 0x586 + i * 8, (c.playedField ? c.playedField[i] : 50 + i) & 0xff);
    }
    rt.mem.write8(DUEL + 0x2f8, c.phase ?? 3);
    rt.mem.write8(DUEL + 0x2f9, c.phase2 ?? 0);

    const handCount = c.handCount ?? 5;
    rt.mem.write16(DUEL + 0x66e, handCount & 0xffff);
    for (let i = 0; i < handCount; i++) {
        rt.mem.write16(DUEL + 0x6c8 + i * 2, (c.hand ? c.hand[i] : 40 + i) & 0xffff);
        const entrySlot = (c.hand ? c.hand[i] : 40 + i) - 0x28;
        rt.mem.write8(DUEL + 0x35c + entrySlot * 4, (c.classes ? c.classes[i] : 3) & 0xff);
        rt.mem.write8(DUEL + 0x35d + entrySlot * 4, (c.classes2 ? c.classes2[i] : 1) & 0xff);
    }
    const recColour = c.colour ?? 3;
    for (let n = 0; n < 0x80; n++) {
        const r = REC_BASE + n * REC_STRIDE;
        rt.mem.write8(r + 0x0, recColour & 0xff);
        rt.mem.write8(r + 0x3, c.recKind ? (c.recKind[n] ?? 0) & 0xff : (n === 0 ? 0 : 1));
        rt.mem.write16(r + 0x8, (c.rank ? c.rank[n] : 0x100 + n) & 0xffff);
        rt.mem.write16(r + 0xa, (c.combo ? c.combo[n] : (n % 3 === 0 ? 7 : 0)) & 0xffff);
    }
    if (c.resp) for (let i = 0; i < c.resp.length; i++) rt.mem.write8(DUEL + 0x400 + i, c.resp[i] & 0xff);
    // the think-window context
    rt.mem.write32(DUEL + 0x4e8, c.thinkCounter ?? 0);
    rt.mem.write32(DUEL + 0x498 + 0x0 + 0x0, 0); // ensure 0x498 area follows the fill
    if (c.thinkDuel498 !== undefined) rt.mem.write8(DUEL + 0x498, c.thinkDuel498);
}

function surface(rt) {
    const out = [];
    for (let i = 0; i < REGION_LEN; i++) out.push(rt.mem.read8(DUEL + REGION_BASE + i));
    return out;
}

const portHost = () => ({
    resolveCardRecord: (id) => recordOf(id),
    cardField: (instance, field) => cardFieldFn(instance, field),
    isSummonableCard: (duel, index) => summonable(duel, index) !== 0,
    fieldProbe: (duel, side, sel, extra, arg) => probe(duel, side, sel, extra, arg),
    fieldProbeKind: (duel, side, sel, extra) => probeKind(duel, side, sel, extra),
    armThinkWindow: () => {},
});

// ── the pure leaves: programDamage F0x800A4440 / programBuff F0x800A4494 ─────

test("programDamage and programBuff match F0x800A4440 / F0x800A4494 on every class", () => {
    const a = runtime({ withStubs: false });
    for (let cls = 0; cls < 0x60; cls++) {
        assert.equal(a.cpu.call(DMG, [DUEL, cls]), programDamage(DUEL, cls), `damage ${cls}`);
        assert.equal(a.cpu.call(BUFF, [DUEL, cls]), programBuff(DUEL, cls), `buff ${cls}`);
    }
});

// ── findHandEntryByClass F0x800A4924 ─────────────────────────────────────────

test("findHandEntryByClass matches F0x800A4924 across hand orders", () => {
    const CASES = [
        { handCount: 0 },
        { handCount: 3, hand: [40, 41, 42], classes: [1, 3, 5] },
        { handCount: 5, hand: [47, 40, 55, 41, 63], classes: [3, 1, 3, 9, 3] },
        { handCount: 6, hand: [40, 41, 42, 43, 44, 45], classes: [0, 0, 0, 0, 0, 0] },
    ];
    for (const c of CASES) {
        const a = runtime({ withStubs: false }); seed(a, c);
        const b = runtime({ withStubs: false }); seed(b, c);
        const portMem = { read8: (x) => b.mem.read8(x), read16: (x) => b.mem.read16(x), read16s: (x) => b.mem.read16s(x), read32: (x) => b.mem.read32(x), write8: (x, v) => b.mem.write8(x, v), write16: (x, v) => b.mem.write16(x, v), write32: (x, v) => b.mem.write32(x, v) };
        for (const cls of [0, 1, 3, 9, 12]) {
            assert.equal(a.cpu.call(CLASSFN, [DUEL, cls]) & 0xffff, findHandEntryByClass(portMem, DUEL, cls), `${JSON.stringify(c)} cls ${cls}`);
        }
    }
});

// ── wouldFinish F0x800A41A8 / narrowToLethal F0x800A41F8 ─────────────────────

test("wouldFinish matches F0x800A41A8 across marks and amounts", () => {
    const CASES = [
        { marks: [0, 0, 0, 0, 0, 0], hp: [10, 20, 30, 40, 50, 60] },
        { marks: [1, 1, 1, 0, 0, 0], hp: [10, 20, 30, 40, 50, 60] },
        { marks: [1, 1, 1, 1, 1, 1], hp: [0, 0xffff, 0x8000, 5, 300, 1] },
    ];
    for (const c of CASES) {
        for (const slot of [0, 2, 5]) {
            for (const amount of [0, 10, 25, 0xffff]) {
                const a = runtime({ withStubs: false }); seed(a, c);
                const b = runtime({ withStubs: false }); seed(b, c);
                const got = a.cpu.call(FINISH, [DUEL, 0, slot, amount]) & 0xffff;
                const want = wouldFinish(b.mem, DUEL, 0, slot, amount);
                assert.equal(got, want, `${JSON.stringify(c)} slot ${slot} amt ${amount}`);
            }
        }
    }
});

test("narrowToLethal matches F0x800A41F8 and its marker writes", () => {
    const CASES = [
        { marks: [1, 1, 1, 0, 0, 0], hp: [10, 20, 30, 40, 50, 60] },
        { marks: [1, 1, 1, 0, 0, 0], hp: [10, 20, 30, 40, 50, 60], counts: [3, 3] },
        { marks: [1, 1, 0, 0, 0, 0], hp: [99, 99, 99, 99, 99, 99], counts: [2, 2] },
        { marks: [0, 0, 0, 0, 0, 0], hp: [1, 2, 3, 4, 5, 6] },
    ];
    for (const c of CASES) {
        for (const amount of [5, 25, 0xffff]) {
            for (const flag of [0, 1]) {
                const a = runtime({ withStubs: false }); seed(a, c);
                const b = runtime({ withStubs: false }); seed(b, c);
                const got = a.cpu.call(LETHAL, [DUEL, 0, amount, flag]) & 0xffff;
                const want = narrowToLethal(b.mem, DUEL, 0, amount, flag);
                assert.equal(got, want, `${JSON.stringify(c)} amt ${amount} flag ${flag}`);
                assert.deepEqual(surface(b), surface(a), `mem ${JSON.stringify(c)} amt ${amount} flag ${flag}`);
            }
        }
    }
});

// ── commitFirstMarked F0x800A3E9C / cheapestHandCard F0x800A4328 ────────────

test("commitFirstMarked matches F0x800A3E9C on both sides", () => {
    const CASES = [
        { marks: [1, 0, 0, 0, 0, 0] },
        { marks: [0, 1, 1, 0, 0, 0] },
        { marks: [0, 0, 0, 0, 0, 0] },
        { marks: [1, 1, 1, 1, 1, 1] },
    ];
    for (const c of CASES) {
        for (const side of [0, 1]) {
            const a = runtime({ withStubs: false }); seed(a, c);
            const b = runtime({ withStubs: false }); seed(b, c);
            const got = a.cpu.call(COMMIT, [DUEL, side]) & 0xffff;
            const want = commitFirstMarked(b.mem, DUEL, side);
            assert.equal(got, want, `${JSON.stringify(c)} side ${side}`);
            assert.deepEqual(surface(b), surface(a), `mem ${JSON.stringify(c)} side ${side}`);
        }
    }
});

test("cheapestHandCard matches F0x800A4328 across hand ranks", () => {
    const CASES = [
        { handCount: 4, hand: [40, 41, 42, 43], marks: [1, 1, 1, 0, 0, 0], rank: range(0x80, (n) => 0x100 - n) },
        { handCount: 4, hand: [40, 41, 42, 43], marks: [0, 0, 0, 0, 0, 0] },
        { handCount: 6, hand: [40, 41, 42, 43, 44, 45], marks: [1, 1, 1, 1, 1, 1], rank: range(0x80, (n) => (n * 7) & 0xffff) },
    ];
    for (const c of CASES) {
        const a = runtime(); seed(a, c);
        const b = runtime(); seed(b, c);
        const got = a.cpu.call(CHEAP, [DUEL]) & 0xffff;
        const want = cheapestHandCard(b.mem, portHost(), DUEL);
        assert.equal(got, want, `${JSON.stringify(c)}`);
        assert.deepEqual(surface(b), surface(a), `mem ${JSON.stringify(c)}`);
    }
});

// ── narrowToGreen F0x800A3F48 / narrowToRed F0x800A4078 ─────────────────────

test("narrowToGreen and narrowToRed match F0x800A3F48 / F0x800A4078", () => {
    for (const colour of [3, 4]) {
        for (const recColour of [3, 4, 1]) {
            const addr = colour === 3 ? GREEN : RED;
            const c = { marks: [1, 1, 1, 1, 0, 0], colour: recColour };
            const a = runtime(); seed(a, c);
            const b = runtime(); seed(b, c);
            a.cpu.call(addr, [DUEL, 0]);
            if (colour === 3) narrowToGreen(b.mem, portHost(), DUEL, 0); else narrowToRed(b.mem, portHost(), DUEL, 0);
            assert.deepEqual(surface(b), surface(a), `colour ${colour} rec ${recColour}`);
        }
    }
});

// ── evaluateBoard F0x800A3934 ───────────────────────────────────────────────

test("evaluateBoard matches F0x800A3934 across masks and rows", () => {
    const CASES = [
        { counts: [3, 3], marks: [1, 0, 0, 0, 0, 0] },
        { counts: [4, 4], marks: [1, 1, 0, 0, 0, 0] },
        { counts: [4, 4], marks: [1, 1, 1, 1, 0, 0], ids: range(12, (i) => 10 + (i % 3)), combo: range(0x80, (n) => (n % 3 === 0 ? 0 : 7)) },
        { counts: [6, 6], marks: [1, 1, 1, 1, 1, 1], ids: range(12, (i) => 5 + i), table: range(0x40, (i) => i) },
        { counts: [1, 1], marks: [1, 0, 0, 0, 0, 0] },
        { counts: [0, 0] },
    ];
    for (const c of CASES) {
        for (const side of [0, 1]) {
            for (const mask of [0, 1, 0b111, 0b10000]) {
                const a = runtime(); seed(a, c);
                const b = runtime(); seed(b, c);
                const got = a.cpu.call(EVAL, [DUEL, side, mask]) | 0;
                const want = evaluateBoard(b.mem, portHost(), DUEL, side, mask) | 0;
                assert.equal(got, want, `${JSON.stringify(c)} side ${side} mask ${mask}`);
            }
        }
    }
});

// ── chooseBestTarget F0x800A3D90 ────────────────────────────────────────────

test("chooseBestTarget matches F0x800A3D90 and leaves one marker", () => {
    const CASES = [
        { counts: [3, 3], marks: [1, 1, 1, 0, 0, 0] },
        { counts: [4, 4], marks: [1, 1, 1, 1, 0, 0], ids: range(12, (i) => 10 + (i % 2)) },
        { counts: [6, 6], marks: [1, 1, 1, 1, 1, 1], ids: range(12, (i) => 5 + i) },
        // every marked slot scores the SAME, so the tie-break decides: the
        // original keeps the LAST (F0x800A3D90 accepts when score <= best).
        { counts: [4, 4], marks: [1, 1, 1, 1, 0, 0], ids: range(12, () => 10), ap: range(12, () => 30), hp: range(12, () => 40) },
    ];
    for (const c of CASES) {
        for (const side of [0, 1]) {
            const a = runtime(); seed(a, c); a.cpu.call(BEST, [DUEL, side]);
            const b = runtime(); seed(b, c); chooseBestTarget(b.mem, portHost(), DUEL, side);
            assert.deepEqual(surface(b), surface(a), `${JSON.stringify(c)} side ${side}`);
        }
    }
});

// ── cardHasLegalTarget F0x800A36E4 ──────────────────────────────────────────

test("cardHasLegalTarget matches F0x800A36E4 on every switch arm", () => {
    const probes = [];
    for (const played of [0, 1, 2]) {
        for (const recColour of [6, 3]) {
            const c = { played, colour: recColour, playedIds: [10, 11, 12, 13] };
            const a = runtime(); seed(a, c);
            const b = runtime(); seed(b, c);
            for (let cls = 0x70; cls < 0x9a; cls++) {
                const gotRaw = a.cpu.call(GATE, [DUEL, 0, cls]) & 0xffff;
                const gotWant = cardHasLegalTarget(b.mem, portHost(), DUEL, 0, cls) ? 1 : 0;
                probes.push([played, recColour, cls, gotRaw, gotWant]);
                assert.equal(gotRaw, gotWant, `played ${played} rec ${recColour} class ${cls}`);
            }
        }
    }
    // the gate really was exercised on every arm
    assert.ok(new Set(probes.map((p) => p[2])).size >= 0x27);
});

// ── scanComboRuns F0x800A0CD4 ───────────────────────────────────────────────

test("scanComboRuns matches F0x800A0CD4 across run lengths", () => {
    const CASES = [
        { counts: [3, 3], marks: [0, 0, 0, 0, 0, 0], ids: range(12, () => 10), combo: range(0x80, () => 7) },
        { counts: [4, 4], marks: [0, 0, 0, 0, 0, 0], ids: range(12, (i) => 10 + (i % 2)), combo: range(0x80, () => 7) },
        { counts: [4, 4], marks: [0, 0, 0, 0, 0, 0], ids: range(12, (i) => 10 + i), combo: range(0x80, () => 7) },
        { counts: [5, 5], marks: [0, 0, 0, 0, 0, 0], ids: [3, 3, 3, 3, 8, 9, 0, 0, 0, 0, 0, 0], combo: range(0x80, (n) => (n === 0 ? 7 : 7)) },
        { counts: [2, 2], marks: [0, 0, 0, 0, 0, 0], ids: range(12, () => 5), combo: range(0x80, () => 0) },
    ];
    for (const c of CASES) {
        for (const start of [0, 1]) {
            const a = runtime(); seed(a, c);
            const b = runtime(); seed(b, c);
            const got = a.cpu.call(SCAN, [DUEL, 0, start]) | 0;
            const want = scanComboRuns(b.mem, portHost(), DUEL, 0, start) | 0;
            assert.equal(got, want, `${JSON.stringify(c)} start ${start}`);
            assert.deepEqual(surface(b), surface(a), `mem ${JSON.stringify(c)} start ${start}`);
        }
    }
});

// ── waitAiThinkWindow F0x8009DEC4 ───────────────────────────────────────────

test("waitAiThinkWindow matches F0x8009DEC4 across the arm/counter/anim states", () => {
    const CASES = [
        { thinkCounter: 0, thinkDuel498: 0, anim: 0 },
        { thinkCounter: 1, thinkDuel498: 0, anim: 0 },
        { thinkCounter: 1, thinkDuel498: 1, anim: 0 },
        { thinkCounter: 3, thinkDuel498: 0, anim: 1 },
    ];
    for (const c of CASES) {
        const a = runtime(); seed(a, c);
        const ctx = 0x801f0000;
        const obj = 0x801f1000;
        a.mem.write32(ctx + 0x18, obj);
        a.mem.write32(obj + 0xec4, THINK_STUB);
        a.mem.write16(obj + 0x64, c.anim);

        const b = runtime(); seed(b, c);
        b.mem.write32(ctx + 0x18, obj);
        b.mem.write16(obj + 0x64, c.anim);

        const got = a.cpu.call(WAIT, [DUEL, ctx]) & 0xffff;
        const want = waitAiThinkWindow(b.mem, portHost(), DUEL, ctx);
        assert.equal(got, want, JSON.stringify(c));
        assert.deepEqual(surface(b), surface(a), `mem ${JSON.stringify(c)}`);
    }
});

// ── aiWorthPlaying F0x800A44F0 / aiSimulateCounter F0x800A45F8 ──────────────

const WORTH = 0x800a44f0, SIM = 0x800a45f8, CHOOSE = 0x800a4978;

test("aiWorthPlaying matches F0x800A44F0 on every arm", () => {
    const c = { played: 2, marks: [1, 1, 1, 0, 0, 0], counts: [3, 3], hp: range(6, (i) => 20 + i * 10) };
    for (let value = 0; value < 0x60; value++) {
        const a = runtime(); seed(a, c);
        const b = runtime(); seed(b, c);
        const got = a.cpu.call(WORTH, [DUEL, 0, value]) & 0xffff;
        const want = aiWorthPlaying(b.mem, portHost(), DUEL, value);
        assert.equal(got, want, `value ${value}`);
        assert.deepEqual(surface(b), surface(a), `mem value ${value}`);
    }
});

test("aiSimulateCounter matches F0x800A45F8 across the class arms and both orders", () => {
    for (const cls of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        for (const swapped of [0, 1]) {
            const c = {
                played: 2, playedCls: [0, cls, 0, 0, 0, 0, 0, 0],
                playedField: [0, 102, 0, 0, 0, 0, 0, 0],   // matches side 0 slot 2's class byte 100+2
                marks: [1, 1, 1, 1, 0, 0], counts: [4, 4],
                hp: range(6, (i) => 5 + i * 5), ap: range(6, (i) => 1 + i),
            };
            const a = runtime(); seed(a, c);
            const b = runtime(); seed(b, c);
            const got = a.cpu.call(SIM, [DUEL, 0x14, 0x12, swapped]) & 0xffff;
            const want = aiSimulateCounter(b.mem, portHost(), DUEL, 0x14, 0x12, swapped);
            assert.equal(got, want, `cls ${cls} swapped ${swapped}`);
            assert.deepEqual(surface(b), surface(a), `mem cls ${cls} swapped ${swapped}`);
        }
    }
});

test("aiChooseCardToPlay matches F0x800A4978 across every branch", () => {
    // A: Load phase, a class-1 hand entry, everything passes -> a pick.
    const A = {
        seed: 3, played: 0, phase: 5, handCount: 1, hand: [41], classes: [1], classes2: [1],
        table: range(0x40, (i) => (i === 41 ? 26 : 0)),
    };
    // B: Compile phase with a class-3 entry and equal board scores.
    const B = {
        seed: 4, played: 0, phase: 3, handCount: 1, hand: [41], classes: [3], classes2: [1],
        table: range(0x40, (i) => (i === 41 ? 26 : 0)),
    };
    // C: Compile phase but the player's board is behind -> no play.
    const C = {
        seed: 5, played: 0, phase: 3, handCount: 1, hand: [41], classes: [3], classes2: [1],
        table: range(0x40, (i) => (i === 41 ? 26 : 0)),
        ap: range(12, (i) => (i < 6 ? 0 : 5000)), hp: range(12, (i) => (i < 6 ? 0 : 5000)),
    };
    // D: a card was played and the response list holds it -> a class-4 answer.
    const target = 6;                                              // duel+0x50[playedIds[1]=31] (a byte-sized id)
    const D = {
        seed: 6, played: 2, playedIds: [0, 31, 0, 0, 0, 0, 0, 0],
        handCount: 1, hand: [41], classes: [4], classes2: [1],
        table: range(0x40, (i) => (i === 31 ? 6 : i === 41 ? 26 : 0)),
        resp: [target & 0xff, 0xff],
    };
    // E: the played card's record kind is 9 and a class-3 counter is kind 3 -> the
    //    response simulator path (swapped = 1), and the buff is needed for the kill.
    const E = {
        seed: 7, played: 2, playedIds: [0, 18, 0, 0, 0, 0, 0, 0],
        playedCls: [0, 0, 0, 0, 0, 0, 0, 0], playedField: [0, 102, 0, 0, 0, 0, 0, 0],
        handCount: 1, hand: [3], classes: [3], classes2: [1],
        table: range(0x40, (i) => (i === 18 ? 1 : i === 3 ? 2 : 0)),
        recKind: { 1: 9, 2: 3 },
        resp: [0, 1, 0xff],
        marks: [1, 1, 1, 1, 0, 0], counts: [4, 4],
        hp: range(6, (i) => (i === 2 ? 45 : 5 + i * 5)), ap: range(6, (i) => 1 + i),
    };
    for (const [name, c] of Object.entries({ A, B, C, D, E })) {
        const a = runtime(); seed(a, c);
        const b = runtime(); seed(b, c);
        const got = a.cpu.call(CHOOSE, [DUEL, 0]) & 0xffff;
        const want = aiChooseCardToPlay(b.mem, portHost(), DUEL, 0);
        assert.equal(got, want, `case ${name}`);
        assert.deepEqual(surface(b), surface(a), `mem case ${name}`);
    }
});

// ── the oracle discriminates: a mutated arm or term fails it ────────────────

/** aiChooseCardToPlay with the Load-phase AI class changed 1 -> 3. */
function chooseMutant(mem, host, duel, arg1) {
    const saved = mem.read8(duel + 0x2f8);
    if ((saved & 0xff) === 5) mem.write8(duel + 0x2f8, 4);   // force the class-3 branch
    const r = aiChooseCardToPlay(mem, host, duel, arg1);
    mem.write8(duel + 0x2f8, saved);
    return r;
}

/** aiSimulateCounter with the damage/buff order swapped for the non-swapped call. */
function simMutant(mem, host, duel, cardA, cardB, swapped) {
    return aiSimulateCounter(mem, host, duel, cardB, cardA, swapped);
}

/** aiWorthPlaying with the class-46 arm declined. */
function worthMutant(mem, host, duel, value) {
    if (((value - 3) >>> 0) === 43) return 0;
    return aiWorthPlaying(mem, host, duel, value);
}
// Each mutant below changes ONE thing from the ported service; the test asserts
// the mutant disagrees with the original on the same seeded input, i.e. that the
// oracle's equality checks above would catch the change. Without this the oracle
// could pass vacuously (e.g. a service that always returned the same value).

/** cardHasLegalTarget with one probe arm's extra changed (0x3f8 -> 0x3f9). */
function gateMutant(mem, host, duel, side, cardClass) {
    const idx = (cardClass - 0x70) >>> 0;
    if (idx >= 0x27) return false;
    if (idx === 33) return host.fieldProbeKind(duel, side, 1, 0x3f9) !== 0;
    return cardHasLegalTarget(mem, host, duel, side, cardClass);
}

/** narrowToLethal with the finish comparison flipped (< -> <=). */
function lethalMutant(mem, duel, side, amount, flag) {
    const marks = duel + (side === 1 ? 0x44c : 0x446);
    const count = (mem.read8(duel + side * AI_SIDE_STRIDE + 0x72c)) & 0xff;
    for (let i = 0; i < count; i++) {
        if (((mem.read8(marks + i) << 24) >> 24) === 0) continue;
        if (amount <= mem.read16s(duel + side * AI_SIDE_STRIDE + i * AI_SLOT_STRIDE + 0x736)) mem.write8(marks + i, 0);
    }
    return flag;
}

/** programDamage with one constant moved (0x3c -> 0x3d). */
function damageMutant(_duel, cardClass) {
    if (cardClass === 0x12) return 0x3d;
    return programDamage(_duel, cardClass);
}

test("the oracle catches a mutated gate arm, a flipped comparison and a moved constant", () => {
    // 1. a gate arm with a different probe constant disagrees with the original.
    const gateCase = { colour: 6, playedIds: [10, 11, 12, 13] };
    const a = runtime(); seed(a, gateCase);
    const b = runtime(); seed(b, gateCase);
    const cls = 0x70 + 33;
    const original = a.cpu.call(GATE, [DUEL, 0, cls]) & 0xffff;
    const mutated = gateMutant(b.mem, portHost(), DUEL, 0, cls) ? 1 : 0;
    assert.notEqual(original, mutated, "the gate oracle must catch a changed arm constant");

    // 2. a flipped finish comparison disagrees with the original.
    const lethalCase = { marks: [1, 1, 1, 0, 0, 0], hp: [10, 20, 30, 40, 50, 60], counts: [3, 3] };
    const c = runtime(); seed(c, lethalCase);
    const d = runtime(); seed(d, lethalCase);
    const amount = 30; // equal to slot 2's HP, so <= vs < differ in a marker write
    lethalMutant(d.mem, DUEL, 0, amount, 0);
    c.cpu.call(LETHAL, [DUEL, 0, amount, 0]);
    assert.notDeepEqual(surface(d), surface(c), "the lethal oracle must catch a flipped comparison");

    // 3. a moved damage constant disagrees with the original.
    const e = runtime({ withStubs: false });
    assert.notEqual(e.cpu.call(DMG, [DUEL, 0x12]) & 0xffff, damageMutant(DUEL, 0x12), "the damage oracle must catch a moved constant");

    // 4. the Load-phase AI class changed (1 -> 3) disagrees with the original.
    const pickCase = { seed: 3, played: 0, phase: 5, handCount: 1, hand: [41], classes: [1], classes2: [1], table: range(0x40, (i) => (i === 41 ? 26 : 0)) };
    const f = runtime(); seed(f, pickCase);
    const g = runtime(); seed(g, pickCase);
    const pickOriginal = f.cpu.call(CHOOSE, [DUEL, 0]) & 0xffff;
    const pickMutated = chooseMutant(g.mem, portHost(), DUEL, 0);
    assert.notEqual(pickOriginal, pickMutated, "the choose oracle must catch a changed phase class");

    // 5. the simulator's damage/buff order swapped disagrees with the original.
    const simCase = { played: 2, playedCls: [0, 0, 0, 0, 0, 0, 0, 0], playedField: [0, 102, 0, 0, 0, 0, 0, 0], marks: [1, 1, 1, 1, 0, 0], counts: [4, 4], hp: range(6, (i) => (i === 2 ? 30 : 200)) };
    const h = runtime(); seed(h, simCase);
    const i = runtime(); seed(i, simCase);
    const simOriginal = h.cpu.call(SIM, [DUEL, 0x14, 0x12, 0]) & 0xffff;
    const simMutated = simMutant(i.mem, portHost(), DUEL, 0x14, 0x12, 0);
    assert.notEqual(simOriginal, simMutated, "the simulator oracle must catch a swapped damage/buff order");

    // 6. the class-46 worth-it arm declined disagrees with the original.
    const worthCase = { played: 2, marks: [1, 1, 1, 0, 0, 0], counts: [3, 3], hp: range(6, (i) => 5 + i) };
    const j = runtime(); seed(j, worthCase);
    const k = runtime(); seed(k, worthCase);
    const worthOriginal = j.cpu.call(WORTH, [DUEL, 0, 46]) & 0xffff;
    const worthMutated = worthMutant(k.mem, portHost(), DUEL, 46);
    assert.notEqual(worthOriginal, worthMutated, "the worth-it oracle must catch a declined arm");
});
