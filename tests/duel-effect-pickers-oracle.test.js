// Oracle: engine/dw3/ui/duel-effect-pickers.ts must reproduce pro/cardgame's
// opcode-0x98 own-field picker (F0x80086330) and the two "can this hand card
// pay the effect" predicates (F0x80085F38, F0x80085FD0).
//
// The originals run through engine/native on the shipped pro_cardgame.bin +
// resident.bin. The predicates are read-only, so only their RETURN is compared,
// with both sides resolving the hand card's record to the same seeded record
// pointer (the original through the resident card-view constructor and a stub
// on its record-selector slot; the port through its card-view host). The picker
// enter writes the duel and view, so its whole span and its ordered call log are
// compared, with the panel slide (view+0xEC8) and the predicate (F0x80085FD0)
// stubbed on both sides.
//
// The comparison is discriminating: the duel mode byte, the record's kind byte,
// the cost/energy bytes and the cost parameter are all varied, and four mutants
// (a dropped slide gate, a dropped hand scan, an always-usable predicate and a
// constant kind word) must diverge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { CURRENT_VIEW_CELL } from "../engine/dw3/globals.ts";
import { CARD_KIND_TABLE } from "../engine/dw3/ui/card-view.ts";
import {
    cardUsableKind,
    handUsableCheck,
    effectOp98OpenOwnFieldPicker,
} from "../engine/dw3/ui/duel-effect-pickers.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const CARD_USABLE = 0x80085f38;
const HAND_USABLE = 0x80085fd0;
const OPEN_98 = 0x80086330;
const LOAD_BASE = 0x80082cb0;
const RECORD_SELECT = 0x8001e7ec;

const DUEL = 0x80194000;
const SCENE = 0x80195000;
const VIEW = 0x80190000;
const RECORD = 0x80180000;   // the seeded card record
const SCRATCH = 0x80170000;  // the port's card-view scratch

const SLIDE_SLOT = 0xec8;
const SLIDE_STUB = 0x0fe50300;
const HAND_STUB = 0x0fe50310;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, LOAD_BASE, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

const cardHost = () => ({
    resourceGetBase: () => RECORD,
    loadImage: () => {},
    findRegisteredHandleByKey: () => 0,
    callViewMethod: () => 0,
});

/** The record the predicates resolve: duel+0x50 = 0 makes id 1, n 0, offset 0. */
function seedRecord(rt, o) {
    for (let i = 0; i < 8; i++) rt.mem.write8(RECORD + i, 0);
    rt.mem.write8(RECORD + 0x0, o.rec0 ?? 1);
    rt.mem.write8(RECORD + 0x3, o.rec3 ?? 0x10);
    rt.mem.write8(RECORD + 0x5, o.rec5 ?? 0);
    rt.mem.write8(DUEL + 0x2f8, o.mode ?? 6);
    rt.mem.write16(DUEL + 0x50, 0);
    for (let i = 0; i < 0x100; i++) rt.mem.write8(DUEL + 0x5a0 + i, 0);
    rt.mem.write8(DUEL + 0x5a8 + (o.rec0 ?? 1) - 1 + 0x10, o.energy ?? 0); // param block past +0x10
    // a kind-table word for every kind byte the record has
    for (let k = 0; k < 0x40; k++) rt.mem.write32(CARD_KIND_TABLE + k * 4, 0);
    rt.mem.write32(CARD_KIND_TABLE + (o.rec3 ?? 0x10) * 4, o.kindWord ?? 2);
}

function retOriginal(rt, addr, args, sel) {
    if (sel) {
        // The routine reads the record pointer from its own card-view context
        // (+0x00 of the published ctx). The real constructor has already
        // published it to CURRENT_VIEW_CELL; the record selector is stubbed to
        // write the seeded record there.
        rt.cpu.setStub(RECORD_SELECT, () => {
            const ctx = rt.mem.read32(CURRENT_VIEW_CELL) | 0;
            rt.mem.write32(ctx, RECORD);
            return 0;
        });
    }
    return rt.cpu.call(addr, args) | 0;
}

// ── the two predicates ───────────────────────────────────────────────────────
test("the usability predicates match F0x80085F38 / F0x80085FD0", () => {
    const CASES = [
        { mode: 6, rec3: 0x10, rec0: 1, rec5: 0, energy: 0 },
        { mode: 6, rec3: 0x10, rec0: 1, rec5: 3, energy: 3 },   // equal: usable
        { mode: 6, rec3: 0x10, rec0: 1, rec5: 3, energy: 2 },   // cost over energy: not usable
        { mode: 6, rec3: 0x10, rec0: 5, rec5: 7, energy: 9, kindWord: 0 },
        { mode: 6, rec3: 0x00, rec0: 1, rec5: 0, energy: 5 },   // not a Digimon
        { mode: 0, rec3: 0x10, rec0: 1, kindWord: 5 },
        { mode: 5, rec3: 0x10, rec0: 1, kindWord: 2 },
        { mode: 5, rec3: 0x10, rec0: 1, kindWord: 3 },
        { mode: 7, rec3: 0x20, rec0: 1, kindWord: 1 },
        { mode: 7, rec3: 0x20, rec0: 1, kindWord: 0 },          // zero kind word: unusable
        { mode: 8, rec3: 0x10, rec0: 1, kindWord: 9 },
    ];
    for (const tc of CASES) {
        // cardUsableKind
        const a1 = runtime(); seedRecord(a1, tc);
        const oa = retOriginal(a1, CARD_USABLE, [DUEL, 0], true);
        const pb = runtime(); seedRecord(pb, tc);
        const ob = cardUsableKind(pb.mem, cardHost(), SCRATCH, DUEL, 0) | 0;
        assert.equal(ob, oa, `cardUsableKind ${JSON.stringify(tc)}`);

        // handUsableCheck (param = duel + 0x5a8 + 0x10 region)
        const a2 = runtime(); seedRecord(a2, tc);
        const pa = retOriginal(a2, HAND_USABLE, [DUEL, DUEL + 0x5a8 + 0x10, 0], true);
        const p2 = runtime(); seedRecord(p2, tc);
        const pb2 = handUsableCheck(p2.mem, cardHost(), SCRATCH, DUEL, DUEL + 0x5a8 + 0x10, 0) | 0;
        assert.equal(pb2, pa, `handUsableCheck ${JSON.stringify(tc)}`);
    }
});

// ── the opcode-0x98 enter ─────────────────────────────────────────────────────
function stubOriginalEnter(rt, events, usable) {
    rt.mem.write32(VIEW + SLIDE_SLOT, SLIDE_STUB);
    rt.cpu.setStub(SLIDE_STUB, (c) => { events.push(["slidePanelsIn", c.reg(4) >>> 0]); return 0; });
    // the enter reaches its predicate by a direct `jal F0x80085FD0`, so the stub
    // must sit at the routine address itself, not at a view slot.
    rt.cpu.setStub(HAND_USABLE, (c) => {
        const cardId = c.reg(6) >>> 0;
        events.push(["handUsable", c.reg(4) >>> 0, c.reg(5) >>> 0, cardId]);
        return usable(cardId);
    });
}

function seedEnter(rt, o) {
    for (let i = 0x400; i < 0x600; i++) rt.mem.write8(DUEL + i, 0);
    for (let i = 0; i < 0x1000; i++) rt.mem.write8(VIEW + i, 0);
    rt.mem.write32(SCENE + 0x18, VIEW);
    rt.mem.write32(VIEW + SLIDE_SLOT, SLIDE_STUB);   // identical on both sides
    rt.mem.write16(VIEW + 0x64, o.slide ?? 1);   // nonzero: skip the slide
    rt.mem.write16(DUEL + 0x5a6, o.count ?? 4);
    for (let i = 0; i < 8; i++) rt.mem.write16(DUEL + 0x600 + i * 2, (o.cards?.[i] ?? 0x10 + i) & 0xffff);
    rt.mem.write32(DUEL + 0x440, 0xe5e5e5e5);
    rt.mem.write8(DUEL + 0x422, 0xe5);
    rt.mem.write32(VIEW + 0xde8, 0xe5e5e5e5);
    rt.mem.write32(VIEW + 0xde4, 0xe5e5e5e5);
    rt.mem.write16(VIEW + 0xdf4, 0xe5e5);
}

const duelSpan = (rt) => { const o = []; for (let i = 0x400; i < 0x600; i++) o.push(rt.mem.read8(DUEL + i) & 0xff); return o; };
const viewSpan = (rt) => { const o = []; for (let i = 0; i < 0x1000; i++) o.push(rt.mem.read8(VIEW + i) & 0xff); return o; };

function portEnter(tc, hostOverride) {
    const events = [];
    const rt = runtime();
    seedEnter(rt, tc);
    const usable = (id) => (id % 3 === 1 ? 1 : 0);
    let hostApi = {
        slidePanelsIn(view) { events.push(["slidePanelsIn", view >>> 0]); },
        handUsable(duel, param, cardId) {
            events.push(["handUsable", duel >>> 0, param >>> 0, cardId >>> 0]);
            return usable(cardId);
        },
    };
    if (hostOverride) hostApi = hostOverride(hostApi, usable);
    effectOp98OpenOwnFieldPicker(rt.mem, hostApi, DUEL, VIEW, 0x1234);
    return { rt, events };
}

test("the opcode-0x98 enter matches F0x80086330", () => {
    const usable = (id) => (id % 3 === 1 ? 1 : 0);
    const CASES = [
        {},                                                  // slide skipped, first card usable
        { cards: [0x20, 0x21, 0x22, 0x23] },                 // none usable -> "nothing"
        { cards: [0x19, 0x1a, 0x1b, 0x1c] },                 // the third is usable
        { slide: 0, count: 2 },                              // panel slide runs
        { count: 0 },                                        // empty hand
        { count: 0xff },                                     // negative count: no scan
    ];
    for (const tc of CASES) {
        const events = [];
        const a = runtime(); seedEnter(a, tc); stubOriginalEnter(a, events, usable);
        a.cpu.call(OPEN_98, [DUEL, VIEW, 0x1234]);
        const b = portEnter(tc);
        const label = JSON.stringify(tc);
        assert.deepEqual(duelSpan(b.rt), duelSpan(a), `${label} duel`);
        assert.deepEqual(viewSpan(b.rt), viewSpan(a), `${label} view`);
        assert.deepEqual(b.events, events, `${label} calls`);
    }
});

test("mutants: a dropped slide gate, a dropped scan, an always-usable predicate and a constant kind word diverge", () => {
    const usable = (id) => (id % 3 === 1 ? 1 : 0);
    const tc = { slide: 0, count: 4 };
    const events = [];
    const a = runtime(); seedEnter(a, tc); stubOriginalEnter(a, events, usable);
    a.cpu.call(OPEN_98, [DUEL, VIEW, 0x1234]);

    // mutant 1: the panel slide is never taken (the view+0x64 gate is ignored).
    const b1 = portEnter(tc, (h) => ({ ...h, slidePanelsIn: () => {} }));
    assert.notDeepEqual(b1.events, events, "a dropped slide must diverge");

    // mutant 2: the hand scan never runs (nothing is ever found).
    const b2 = portEnter(tc, (h) => ({ ...h, handUsable: () => 0 }));
    assert.notDeepEqual(duelSpan(b2.rt), duelSpan(a), "a dropped scan must diverge");

    // mutant 3: an always-usable predicate turns "nothing to pick" into "found".
    const cards = [0x20, 0x21, 0x22, 0x23];
    const b3 = portEnter({ count: 4, cards }, (h) => ({ ...h, handUsable: () => 1 }));
    const a3 = runtime(); seedEnter(a3, { count: 4, cards });
    const ev3 = []; stubOriginalEnter(a3, ev3, () => 0); a3.cpu.call(OPEN_98, [DUEL, VIEW, 0x1234]);
    assert.notDeepEqual(duelSpan(b3.rt), duelSpan(a3), "an always-usable predicate must diverge");

    // mutant 4: the kind-table word always reads 0, so a mode-5 kind-2 card
    // (usable for real) is seen as unusable by the port.
    const tc4 = { mode: 5, rec3: 0x10, rec0: 1, kindWord: 2 };
    const a4 = runtime(); seedRecord(a4, tc4);
    const realRet = retOriginal(a4, CARD_USABLE, [DUEL, 0], true) | 0;
    assert.equal(realRet, 1, "the real predicate accepts kind 2 in mode 5");
    const b4 = runtime(); seedRecord(b4, tc4);
    const base = b4.mem;
    const wrap = {
        read8: (x) => base.read8(x), read8s: (x) => base.read8s(x),
        read16: (x) => base.read16(x), read16s: (x) => base.read16s(x),
        read32: (x) => (((x >>> 0) >= CARD_KIND_TABLE && (x >>> 0) < CARD_KIND_TABLE + 0x100) ? 0 : base.read32(x)),
        write8: (x, v) => base.write8(x, v), write16: (x, v) => base.write16(x, v),
        write32: (x, v) => base.write32(x, v),
    };
    const mutantRet = cardUsableKind(wrap, cardHost(), SCRATCH, DUEL, 0) | 0;
    assert.notEqual(mutantRet, realRet, "a constant zero kind word must diverge");
});
