// Phase 4 oracle: engine/dw3/ui/phase-banner.ts must reproduce pro/cardgame's
// inter-phase banner trio. The originals run through engine/native on the
// shipped pro_cardgame.bin + resident.bin with the view's four widget slots
// stubbed; the port calls an equivalent host. The duel/view fields, the ordered
// widget calls and the return values are compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    INTER_PHASE_TABLE,
    PAD_RECORD_STRIDE,
    PAD_RECORD_TABLE,
    PAD_SHIFT_BASE,
    PAD_WORD_OFFSET,
    PHASE_BANNER_ARMED,
    PHASE_BANNER_NEXT,
    PHASE_BANNER_OPCODE,
    PHASE_BANNER_PENDING,
    PHASE_BANNER_STEP,
    PHASE_BANNER_TABLE,
    PHASE_BANNER_WIDGET_STATE,
    queueInterPhaseBanner,
    showPhaseBanner,
    tickPhaseBanner,
} from "../engine/dw3/ui/phase-banner.ts";

import {
    openBannerSlot, openPromptSlot, closePromptSlot,
} from "../engine/dw3/ui/view-openers.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const QUEUE = 0x800a1af8;
const SHOW = 0x800894e4;
const TICK = 0x80089580;

const DUEL = 0x80194000;
const VIEW = 0x80190000;
const SHOW_SLOT = 0xee4;
const FRAME_SLOT = 0xeac;
const ADVANCE_SLOT = 0xeb0;
const FINISH_SLOT = 0xee8;
const SHOW_STUB = 0x0fe50000;
const FRAME_STUB = 0x0fe50010;
const ADVANCE_STUB = 0x0fe50020;
const FINISH_STUB = 0x0fe50030;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** The view's widget slots and the stubs the original calls through them. */
function stubView(rt, events) {
    rt.mem.write32(VIEW + SHOW_SLOT, SHOW_STUB);
    rt.mem.write32(VIEW + FRAME_SLOT, FRAME_STUB);
    rt.mem.write32(VIEW + ADVANCE_SLOT, ADVANCE_STUB);
    rt.mem.write32(VIEW + FINISH_SLOT, FINISH_STUB);
    const sp = (c) => c.reg(29) >>> 0;
    rt.cpu.setStub(SHOW_STUB, (c) => {
        events.push(["show", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0,
            rt.mem.read32(sp(c) + 0x10) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(FRAME_STUB, (c) => {
        events.push(["frame", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0,
            rt.mem.read32(sp(c) + 0x10) >>> 0, rt.mem.read32(sp(c) + 0x14) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(ADVANCE_STUB, (c) => {
        events.push(["advance", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(FINISH_STUB, (c) => {
        events.push(["finish", c.reg(4) >>> 0]);
        return 0;
    });
}

/** The same four calls, as the port's host receives them. */
function portHost(events) {
    return {
        showBannerWidget(view, id) {
            events.push(["show", view >>> 0, id >>> 0, 0, 0, 1]);
        },
        setBannerFrame(view, record) {
            events.push(["frame", view >>> 0, 5, 5, record >>> 0, 0, 0x42]);
        },
        advanceBanner(view, value) {
            events.push(["advance", view >>> 0, value >>> 0]);
        },
        finishBanner(view) {
            events.push(["finish", view >>> 0]);
        },
    };
}

function seedPad(rt, { word = 0, shiftD = 3, shiftE = 5 } = {}) {
    rt.mem.write16(PAD_RECORD_TABLE + PAD_WORD_OFFSET, word & 0xffff);
    rt.mem.write8(PAD_RECORD_TABLE + 0xd + PAD_SHIFT_BASE, shiftD & 0xff);
    rt.mem.write8(PAD_RECORD_TABLE + 0xe + PAD_SHIFT_BASE, shiftE & 0xff);
}

function seedDuel(rt, o = {}) {
    for (let i = 0x2f0; i < 0x300; i++) rt.mem.write8(DUEL + i, 0);
    for (let i = 0x420; i < 0x424; i++) rt.mem.write8(DUEL + i, 0);
    rt.mem.write8(DUEL + PHASE_BANNER_STEP, o.step ?? 0);
    rt.mem.write8(DUEL + PHASE_BANNER_PENDING, o.pending ?? 0);
    rt.mem.write8(VIEW + PHASE_BANNER_WIDGET_STATE, o.widget ?? 0);
    seedPad(rt, o.pad ?? {});
}

function duelFields(rt) {
    return {
        step: rt.mem.read8(DUEL + PHASE_BANNER_STEP),
        armed: rt.mem.read8(DUEL + PHASE_BANNER_ARMED),
        opcode: rt.mem.read8(DUEL + PHASE_BANNER_OPCODE),
        pending: rt.mem.read8(DUEL + PHASE_BANNER_PENDING),
        next: rt.mem.read8(DUEL + PHASE_BANNER_NEXT),
    };
}

test("queueInterPhaseBanner matches F0x800A1AF8", () => {
    // the routine's own eleven reachable table rows, plus two out-of-range ones
    for (const pending of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 0xff]) {
        const evA = [];
        const a = runtime();
        stubView(a, evA);
        seedDuel(a, { pending });
        const av = a.cpu.call(QUEUE, [DUEL]);

        const evB = [];
        const b = runtime();
        stubView(b, evB);
        seedDuel(b, { pending });
        const bv = queueInterPhaseBanner(b.mem, DUEL);

        assert.deepEqual(duelFields(b), duelFields(a), `pending ${pending}`);
        assert.equal(bv | 0, av | 0, `pending ${pending} return`);
        const record = (pending * 4 + INTER_PHASE_TABLE) >>> 0;
        assert.equal(a.mem.read8(DUEL + PHASE_BANNER_OPCODE), a.mem.read8(record));
        assert.equal(a.mem.read8(DUEL + PHASE_BANNER_NEXT), a.mem.read8(record + 2));
        assert.equal(a.mem.read8(DUEL + PHASE_BANNER_ARMED), 1);
    }
    // the shipped table's rows match the decoded (banner, next-mode) pairs
    const expected = [[0, 0], [166, 2], [160, 3], [161, 4], [162, 5], [163, 6], [164, 7], [165, 8], [160, 3], [160, 3]];
    for (let i = 0; i < expected.length; i++) {
        const record = (i * 4 + INTER_PHASE_TABLE) >>> 0;
        assert.equal(overlay[record - 0x80082cb0], expected[i][0], `row ${i} opcode`);
        assert.equal(overlay[record + 2 - 0x80082cb0], expected[i][1], `row ${i} next mode`);
    }
});

test("showPhaseBanner matches F0x800894E4", () => {
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
        const evA = [];
        const a = runtime();
        stubView(a, evA);
        seedDuel(a);
        a.cpu.call(SHOW, [DUEL, VIEW, index]);

        const evB = [];
        const b = runtime();
        stubView(b, evB);
        seedDuel(b);
        showPhaseBanner(b.mem, portHost(evB), DUEL, VIEW, index);

        assert.deepEqual(duelFields(b), duelFields(a), `index ${index}`);
        assert.deepEqual(evB, evA, `index ${index} widget calls`);
        assert.equal(a.mem.read8(DUEL + PHASE_BANNER_STEP), 1);
        // the record the shipped table holds for this index
        const record = (index * 2 + PHASE_BANNER_TABLE) >>> 0;
        assert.deepEqual(evA[0], ["show", VIEW, overlay[record + 1 - 0x80082cb0], 0, 0, 1], `index ${index} id`);
        assert.deepEqual(evA[1], ["frame", VIEW, 5, 5, overlay[record - 0x80082cb0], 0, 0x42], `index ${index} record`);
    }
});

test("tickPhaseBanner matches F0x80089580", () => {
    const CASES = [
        { step: 0, widget: 0 },
        { step: 0, widget: 2 },          // only step 1 advances on a ready widget
        { step: 1, widget: 0 },
        { step: 1, widget: 1 },
        { step: 1, widget: 2 },          // widget ready -> step 2
        { step: 2, widget: 2, pad: { word: 0 } },                    // no press
        { step: 2, widget: 2, pad: { word: 0x8, shiftD: 3, shiftE: 5 } },  // press via 0xD
        { step: 2, widget: 2, pad: { word: 0x20, shiftD: 3, shiftE: 5 } }, // press via 0xE only
        { step: 2, widget: 2, pad: { word: 0x4, shiftD: 5, shiftE: 7 } },  // word bit set, but not the shift bit
        { step: 2, widget: 2, pad: { word: 0x10, shiftD: 3, shiftE: 5 } }, // the bit above the shift bit: not a press
        { step: 3, widget: 0 },          // widget gone -> step 4
        { step: 3, widget: 1 },
        { step: 4, widget: 0 },          // finished
        { step: 5, widget: 0 },
        { step: 0xff, widget: 0 },
    ];
    for (const tc of CASES) {
        const evA = [];
        const a = runtime();
        stubView(a, evA);
        seedDuel(a, tc);
        const av = a.cpu.call(TICK, [DUEL, VIEW]);

        const evB = [];
        const b = runtime();
        stubView(b, evB);
        seedDuel(b, tc);
        const bv = tickPhaseBanner(b.mem, portHost(evB), DUEL, VIEW);

        assert.deepEqual(duelFields(b), duelFields(a), JSON.stringify(tc));
        assert.deepEqual(evB, evA, `${JSON.stringify(tc)} widget calls`);
        assert.equal(bv | 0, av | 0, `${JSON.stringify(tc)} return`);
    }
});

// The wiring oracle: point the view's +0xEE4 and +0xEAC slots at the REAL
// overlay bodies (not stubs) and let showPhaseBanner call them, then compare the
// whole view region against the port dispatching through openPromptSlot and
// openBannerSlot. This is what proves the phase-banner host picks the right two
// slots with the right constant arguments (id, 0, 0, 1 / 5, 5, record, 0, 0x42).
const SOUND_CELL = 0x80055c48;
const SOUND_STUB = 0x0fe50100;
const VIEW_SPAN = 0x3000;

function viewBytes(rt) {
    const out = [];
    for (let i = 0; i < VIEW_SPAN; i++) out.push(rt.mem.read8(VIEW + i));
    return out;
}

function wiredOriginal(a, ev) {
    for (let i = 0; i < VIEW_SPAN; i++) a.mem.write8(VIEW + i, 0x5a);
    for (let i = 0x2f0; i < 0x300; i++) a.mem.write8(DUEL + i, 0);
    for (let i = 0x420; i < 0x424; i++) a.mem.write8(DUEL + i, 0);
    a.mem.write32(VIEW + SHOW_SLOT, 0x8009c054);
    a.mem.write32(VIEW + FRAME_SLOT, 0x8009beac);
    a.mem.write32(SOUND_CELL, SOUND_STUB);
    a.cpu.setStub(SOUND_STUB, (c) => { ev.push(["sound", c.reg(4) >>> 0]); return 0; });
}

function wiredPortHost(mem, ev) {
    const sound = { playPackedSound: (id) => { ev.push(["sound", id >>> 0]); } };
    return {
        showBannerWidget: (view, id) => openPromptSlot(mem, sound, view, id, 0, 0, 1),
        setBannerFrame: (view, record) => openBannerSlot(mem, sound, view, 5, 5, record, 0, 0x42),
        advanceBanner: () => {},
        finishBanner: (view) => closePromptSlot(mem, sound, view),
    };
}

test("showPhaseBanner's view slots resolve to the real prompt/banner bodies", () => {
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
        const evA = [];
        const a = runtime();
        wiredOriginal(a, evA);
        a.cpu.call(SHOW, [DUEL, VIEW, index]);

        const evB = [];
        const b = runtime();
        wiredOriginal(b, evB);
        showPhaseBanner(b.mem, wiredPortHost(b.mem, evB), DUEL, VIEW, index);

        assert.deepEqual(viewBytes(b), viewBytes(a), `index ${index} view`);
        assert.deepEqual(duelFields(b), duelFields(a), `index ${index} duel`);
        assert.deepEqual(evB, evA, `index ${index} sounds`);
    }
});

test("the wiring mutant that swaps the two slots diverges", () => {
    const index = 1;
    const a = runtime();
    wiredOriginal(a, []);
    a.cpu.call(SHOW, [DUEL, VIEW, index]);

    const b = runtime();
    wiredOriginal(b, []);
    const sound = { playPackedSound: () => {} };
    // mutant: use openBannerSlot for the raise and openPromptSlot for the frame
    showPhaseBanner(b.mem, {
        showBannerWidget: (view) => openBannerSlot(b.mem, sound, view, 5, 5, 0, 0, 0x42),
        setBannerFrame: (view) => openPromptSlot(b.mem, sound, view, 0, 0, 0, 0),
        advanceBanner: () => {},
        finishBanner: () => {},
    }, DUEL, VIEW, index);
    assert.notDeepEqual(viewBytes(b), viewBytes(a), "the swapped wiring must diverge");
});
