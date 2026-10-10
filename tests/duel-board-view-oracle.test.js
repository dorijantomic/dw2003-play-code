// Oracle: engine/dw3/ui/duel-board-view.ts must reproduce the duel board view's
// own method bodies and browse passes. The originals run through engine/native
// on the shipped pro_cardgame.bin + resident.bin; the three plate/slot writers
// are pure memory writes and compared byte for byte, and the browse passes
// dispatch through the view's method slots (ED8/F14/F18/F3C), which are stubbed
// on both sides so the ordered calls and their arguments are compared too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    startAiPileBrowse,
    primeAiPileBrowseCounts,
    scaleSlot,
    openPlate,
    closePlate,
    BOARD_QUEUE,
} from "../engine/dw3/ui/duel-board-view.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const LOAD_BASE = 0x80082cb0;

const SCALE_SLOT = 0x8009c938;   // view+0xF24
const OPEN_PLATE = 0x8009be40;   // view+0xEA4
const CLOSE_PLATE = 0x8009be78;  // view+0xEA8
const PRIME_BROWSE = 0x8009df68;
const START_BROWSE = 0x8009dbe8;

const DUEL = 0x80194000;
const SCENE = 0x80195000;
const VIEW = 0x80190000;
const VIEW_SIZE = 0x0f48;

// The view's method slots the browse passes call.
const SLOT_ED8 = 0x0ed8;   // F0x80098864 (count, index) -> x offset
const SLOT_F14 = 0x0f14;   // F0x8009C510 (view, index, x, y)
const SLOT_F18 = 0x0f18;   // F0x8009CDFC (view, index)
const SLOT_F3C = 0x0f3c;   // F0x8009CFBC (view, index, value)
const ED8_STUB = 0x0fe50300;
const F14_STUB = 0x0fe50310;
const F18_STUB = 0x0fe50320;
const F3C_STUB = 0x0fe50330;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, LOAD_BASE, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function seedView(rt) {
    for (let i = 0; i < VIEW_SIZE; i++) rt.mem.write8(VIEW + i, 0);
    for (let s = 0; s < 12; s++) {
        const r = VIEW + s * 0x4c;
        rt.mem.write32(r + 0x108, 0x11110000 + s);
        rt.mem.write32(r + 0x10c, 0x22220000 + s);
        rt.mem.write16(r + 0x120, 0x0100 + s);
        rt.mem.write16(r + 0x122, 0x0200 + s);
    }
    for (let s = 0; s < 12; s++) {
        const r = VIEW + s * 0xc + 0xdc0;
        rt.mem.write16(r + 0x0, 0xaaaa);
        rt.mem.write16(r + 0x2, 0xbbbb);
        rt.mem.write16(r + 0x4, 0xcccc);
        rt.mem.write16(r + 0x6, 0xdddd);
        rt.mem.write16(r + 0x8, 0xeeee);
        rt.mem.write16(r + 0xa, 0xffff);
    }
}
function viewState(rt) {
    const out = [];
    for (let i = 0; i < VIEW_SIZE; i++) out.push(rt.mem.read8(VIEW + i));
    return out;
}

/** The duel region the browse passes touch (the request fields). */
function seedDuel(rt, o = {}) {
    for (let i = 0x490; i < 0x4e0; i++) rt.mem.write8(DUEL + i, 0);
    rt.mem.write32(DUEL + 0x4d4, o.rows ?? 0);
    rt.mem.write8(DUEL + 0x49c, o.flag ?? 0);
    for (let i = 0; i < 40; i++) rt.mem.write8(DUEL + 0x49e + i, (0x40 + i) & 0xff);
    // counts and badge tables live on the row's 0xC8-stride pile record
    const rowBase = DUEL + (o.row ?? 0) * 0xc8;
    rt.mem.write16(rowBase + 0x5a6, o.count0 ?? 0);
    rt.mem.write16(rowBase + 0x5a4, o.count2 ?? 0);
    rt.mem.write16(rowBase + 0x5a2, o.count1 ?? 0);
    for (let i = 0; i < 8; i++) {
        rt.mem.write16(rowBase + 0x600 + i * 2, 0x5000 + i);
        rt.mem.write16(rowBase + 0x614 + i * 2, 0x5100 + i);
        rt.mem.write16(rowBase + 0x5b0 + i * 2, 0x5200 + i);
    }
    rt.mem.write16(rowBase + 0x5a0, o.pileCount ?? 0);
    rt.mem.write32(SCENE + 0x18, VIEW);
}
function duelState(rt) {
    const out = [];
    for (let i = 0x490; i < 0x4e0; i++) out.push(rt.mem.read8(DUEL + i));
    return out;
}

// ── the three plate/slot writers: pure memory, compared whole ────────────────

test("scaleSlot matches F0x8009C938 across slot and argument edges", () => {
    const CASES = [
        { index: 0, span: 0x1000, from: 0, to: 0x1000 },
        { index: 5, span: 5, from: 0x1000, to: 0x1000 },
        { index: 0x27, span: 0xa, from: 0x1234, to: 0x5678 },
        { index: 3, span: 0xffff, from: 0x8000, to: 0x8000 },
    ];
    for (const c of CASES) {
        const a = runtime();
        seedView(a);
        a.mem.write32(a.cpu.sp + 0x10, c.to & 0xffffffff);
        a.cpu.call(SCALE_SLOT, [VIEW, c.index, c.span, c.from]);

        const b = runtime();
        seedView(b);
        scaleSlot(b.mem, VIEW, c.index, c.span, c.from, c.to);
        assert.deepEqual(viewState(b), viewState(a), JSON.stringify(c));
    }
});

test("openPlate and closePlate match F0x8009BE40 / F0x8009BE78", () => {
    for (const index of [0, 1, 6, 0xb]) {
        const a = runtime();
        seedView(a);
        a.cpu.call(OPEN_PLATE, [VIEW, index, 0x37]);
        const b = runtime();
        seedView(b);
        openPlate(b.mem, VIEW, index, 0x37);
        assert.deepEqual(viewState(b), viewState(a), `open ${index}`);

        const c = runtime();
        seedView(c);
        c.cpu.call(CLOSE_PLATE, [VIEW, index]);
        const d = runtime();
        seedView(d);
        closePlate(d.mem, VIEW, index);
        assert.deepEqual(viewState(d), viewState(c), `close ${index}`);
    }
});

// ── the two browse passes ────────────────────────────────────────────────────

function writeSlotPointers(rt) {
    rt.mem.write32(VIEW + SLOT_ED8, ED8_STUB);
    rt.mem.write32(VIEW + SLOT_F14, F14_STUB);
    rt.mem.write32(VIEW + SLOT_F18, F18_STUB);
    rt.mem.write32(VIEW + SLOT_F3C, F3C_STUB);
}

function stubSlots(rt, events) {
    writeSlotPointers(rt);
    rt.cpu.setStub(ED8_STUB, (c) => {
        events.push(["ED8", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return ((c.reg(5) >>> 0) * 0x2900) | 0;
    });
    rt.cpu.setStub(F14_STUB, (c) => {
        events.push(["F14", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(F18_STUB, (c) => {
        events.push(["F18", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(F3C_STUB, (c) => {
        events.push(["F3C", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return 0;
    });
}

function portHost(events) {
    return {
        positionSlot(view, index, x, y) { events.push(["F14", view >>> 0, index >>> 0, x >>> 0, y >>> 0]); },
        writeSlotValue(view, index, value) { events.push(["F3C", view >>> 0, index >>> 0, value >>> 0]); },
        hideSlot(view, index) { events.push(["F18", view >>> 0, index >>> 0]); },
        slotRevealOffset(count, index) { events.push(["ED8", count >>> 0, index >>> 0]); return ((index >>> 0) * 0x2900) | 0; },
    };
}

test("primeAiPileBrowseCounts matches F0x8009DF68 across the kinds", () => {
    const CASES = [
        { kind: 0, row: 0, count0: 6 }, { kind: 0, row: 1, count0: 3 },
        { kind: 1, row: 0, count1: 40 }, { kind: 1, row: 1, count1: 5 },
        { kind: 2, row: 0, count2: 2 }, { kind: 2, row: 1, count2: 0xfffe },
        { kind: 3, row: 0, rows: 0x11 }, { kind: 7, row: 1, rows: 0 },
    ];
    for (const c of CASES) {
        const a = runtime();
        seedDuel(a, c);
        a.cpu.call(PRIME_BROWSE, [DUEL, SCENE, c.row, c.kind]);
        const b = runtime();
        seedDuel(b, c);
        primeAiPileBrowseCounts(b.mem, DUEL, c.row, c.kind);
        assert.deepEqual(duelState(b), duelState(a), JSON.stringify(c));
    }
});

test("startAiPileBrowse matches F0x8009DBE8 across the kinds and the empty pile", () => {
    const CASES = [
        { kind: 0, row: 0, count0: 6 },
        { kind: 0, row: 1, count0: 3, flag: 1 },
        { kind: 0, row: 0, count0: 40 },
        { kind: 0, row: 0, count0: 0 },   // empty pile path
        { kind: 1, row: 0, count1: 40, flag: 1, pileCount: 40 },
        { kind: 2, row: 0, count2: 5, pileCount: 3 },
        { kind: 2, row: 1, count2: 2, pileCount: 1, flag: 1 },
        { kind: 3, row: 0, rows: 4 },
        { kind: 5, row: 1, rows: 0 },
    ];
    for (const c of CASES) {
        const evA = [];
        const a = runtime();
        seedView(a);
        seedDuel(a, c);
        stubSlots(a, evA);
        a.cpu.call(START_BROWSE, [DUEL, SCENE, c.row, c.kind]);

        const evB = [];
        const b = runtime();
        seedView(b);
        seedDuel(b, c);
        writeSlotPointers(b);
        startAiPileBrowse(b.mem, portHost(evB), DUEL, SCENE, c.row, c.kind);

        const label = JSON.stringify(c);
        assert.deepEqual(duelState(b), duelState(a), `${label} duel`);
        assert.deepEqual(viewState(b), viewState(a), `${label} view`);
        assert.deepEqual(evB, evA, `${label} calls`);
    }
});

// everything is data: no executable overlay fetch is involved in these ports
test("the board-view port reads only data, never an instruction image", () => {
    const a = runtime();
    seedView(a);
    seedDuel(a, { kind: 0, row: 0, count0: 2 });
    const ev = [];
    stubSlots(a, ev);
    a.cpu.call(START_BROWSE, [DUEL, SCENE, 0, 0]);
    // a spread of touched fields for documentation of the compared surface
    assert.equal(a.mem.read8(DUEL + BOARD_QUEUE.flag), 0);
});
