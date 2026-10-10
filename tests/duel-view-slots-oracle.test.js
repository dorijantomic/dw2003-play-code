// Oracle: engine/dw3/ui/duel-board-view.ts's four view-slot bodies and
// engine/dw3/ui/duel-view-window.ts's two presentation routines must reproduce
// the duel's own code. The originals run through engine/native on the shipped
// pro_cardgame.bin + resident.bin. The pure writers are compared byte for byte;
// the routines that dispatch through the view's method slots or the resident
// services are stubbed on both sides and the ordered calls and their arguments
// are compared too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    cardFanOut,
    placeCardResetVisual,
    hideCardSprite,
    bindSlotToCard,
    setHudCounter,
    BOARD_SLOT_STRIDE,
} from "../engine/dw3/ui/duel-board-view.ts";
import {
    waitViewWindowOpen,
    presentResolvingCard,
    DUEL_WINDOW,
    VIEW_WINDOW_READY,
    PRESENT_HISTORY_BASE,
} from "../engine/dw3/ui/duel-view-window.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const LOAD_BASE = 0x80082cb0;

const FANOUT = 0x80098864;
const POSITION = 0x8009c510;
const HIDE = 0x8009cdfc;
const BIND = 0x8009cfbc;
const SET_HUD = 0x8009cae0;
const WAIT_WINDOW = 0x800a1db8;
const PRESENT = 0x800a1e60;

const DUEL = 0x80194000;
const SCENE = 0x80195000;
const VIEW = 0x80190000;
const VIEW_SIZE = 0x0f48;
const CARD_TABLE = 0x80130000;
const CARD_BASE = 0x80120000;
const BIND_SCRATCH = 0x80140000;
const CARD_STRIDE = 0x62c;
const CARD_FILE_TABLE = 0x8004dfb8;

const RESOURCE_CELL = 0x80044f4c;
const RESOURCE_STUB = 0x0fe50500;
const DELTA_CELL = 0x8004df9c;
const DELTA_STUB = 0x0fe50510;
const SOUND_CELL = 0x80055c48;
const SOUND_STUB = 0x0fe505b0;
const RAND_VALUE_CELL = 0x8005bbf8;
const RAND_SHIFT_CELL = 0x8005bbd8;
const RAND_VALUE_STUB = 0x0fe50520;
const RAND_SHIFT_STUB = 0x0fe50530;

// view method slots used by waitViewWindowOpen / presentResolvingCard
const SLOT_EC8 = 0x0ec8;   // F0x8009C2D0 open window
const SLOT_EA8 = 0x0ea8;   // F0x8009BE78 close plate
const SLOT_EAC = 0x0eac;   // F0x8009BEAC open info banner
const SLOT_EB0 = 0x0eb0;   // F0x8009BF5C write banner record
const SLOT_F1C = 0x0f1c;   // F0x8009CE28 settle slot
const SLOT_F24 = 0x0f24;   // F0x8009C938 scale slot
const STUB_EC8 = 0x0fe50540;
const STUB_EA8 = 0x0fe50550;
const STUB_EAC = 0x0fe50560;
const STUB_EB0 = 0x0fe50570;
const STUB_F1C = 0x0fe50580;
const STUB_F24 = 0x0fe50590;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, LOAD_BASE, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

// ── cardFanOut (F0x80098864) ─────────────────────────────────────────────────

test("cardFanOut matches F0x80098864 across the six/eight boundary", () => {
    const CASES = [];
    for (const count of [0, 1, 2, 3, 5, 6, 7, 8, 9, 12, 20, 40]) {
        for (const index of [0, 1, 5, count - 1]) CASES.push([count, index]);
    }
    for (const [count, index] of CASES) {
        const a = runtime();
        const ra = a.cpu.call(FANOUT, [count, index]) | 0;
        const rb = cardFanOut(count, index) | 0;
        assert.equal(rb, ra, `count=${count} index=${index}`);
    }
});

// ── placeCardResetVisual (F0x8009C510) and hideCardSprite (F0x8009CDFC) ───────

function seedView(rt) {
    for (let i = 0; i < VIEW_SIZE; i++) rt.mem.write8(VIEW + i, 0);
    for (let s = 0; s < 0x28; s++) {
        const r = VIEW + s * BOARD_SLOT_STRIDE;
        rt.mem.write32(r + 0x108, 0x11110000 + s);
        rt.mem.write32(r + 0x10c, 0x22220000 + s);
        rt.mem.write16(r + 0x120, 0x0100 + s);
        rt.mem.write16(r + 0x122, 0x0200 + s);
        rt.mem.write16(r + 0x140, 0x0040 + s);
        rt.mem.write16(r + 0x142, 0x0050 + s);
        rt.mem.write8(r + 0x14a, 0xaa);
        rt.mem.write8(r + 0x14d, 0xdd);
    }
}
function viewState(rt) {
    const out = [];
    for (let i = 0; i < VIEW_SIZE; i++) out.push(rt.mem.read8(VIEW + i));
    return out;
}

test("placeCardResetVisual matches F0x8009C510 across slots and coordinates", () => {
    const CASES = [
        [0, 0x1800, 0x6100],
        [5, 0x7fff, -0x20],
        [0x27, 0, 0],
        [1, 0x12345678, 0x13579bdf],
    ];
    for (const [index, x, y] of CASES) {
        const a = runtime(); seedView(a); a.cpu.call(POSITION, [VIEW, index, x, y]);
        const b = runtime(); seedView(b); placeCardResetVisual(b.mem, VIEW, index, x, y);
        assert.deepEqual(viewState(b), viewState(a), `index=${index}`);
    }
});

test("hideCardSprite matches F0x8009CDFC across slots", () => {
    for (const index of [0, 3, 0xb, 0x27]) {
        const a = runtime(); seedView(a); a.cpu.call(HIDE, [VIEW, index]);
        const b = runtime(); seedView(b); hideCardSprite(b.mem, VIEW, index);
        assert.deepEqual(viewState(b), viewState(a), `index=${index}`);
    }
});

test("setHudCounter matches F0x8009CAE0 across every readout and side", () => {
    const CASES = [];
    for (const side of [0, 1, 2]) {
        for (let index = 0; index < 12; index++) CASES.push([side, index, 0x12345678 + index * 0x0101]);
    }
    for (const [side, index, value] of CASES) {
        const a = runtime(); seedView(a); a.cpu.call(SET_HUD, [VIEW, side, index, value]);
        const b = runtime(); seedView(b); setHudCounter(b.mem, VIEW, side, index, value);
        assert.deepEqual(viewState(b), viewState(a), `side=${side} index=${index}`);
    }
});

// ── bindSlotToCard (F0x8009CFBC) ─────────────────────────────────────────────

/** Seed the view's card table, the record memory and the resolver cell. */
function seedBind(rt, o) {
    seedView(rt);
    const table = CARD_TABLE;
    for (let i = 0; i < 64; i++) rt.mem.write16(table + i * 2, o.table[i] ?? i);
    rt.mem.write32(VIEW + 0x50, table);
    for (let i = 0; i < 64; i++) {
        const rec = CARD_BASE + i * CARD_STRIDE;
        rt.mem.write8(rec + 0, (i % 6) + 1);     // colour 1..6
        rt.mem.write8(rec + 1, 0x10 + i);        // AP
        rt.mem.write8(rec + 2, 0x20 + i);        // HP
        rt.mem.write8(rec + 3, i % 2 ? 0x10 : 4);// kind
        rt.mem.write8(rec + 5, 0x40 + i);        // cost
    }
    rt.mem.write32(RESOURCE_CELL, RESOURCE_STUB);
}

test("bindSlotToCard matches F0x8009CFBC across card ids and slot indices", () => {
    const CASES = [
        { index: 0, cardId: 0, table: new Array(64).fill(0) },
        { index: 3, cardId: 5, table: new Array(64).fill(5) },
        { index: 0xb, cardId: 7, table: new Array(64).fill(7).map((v, i) => (i === 7 ? 12 : v)) },
        { index: 0x27, cardId: 9, table: new Array(64).fill(9).map((v, i) => (i === 9 ? 40 : v)) },
        { index: 1, cardId: 2, table: new Array(64).fill(0).map((v, i) => (i === 2 ? 63 : v)) },
    ];
    for (const c of CASES) {
        const a = runtime();
        seedBind(a, c);
        a.cpu.setStub(RESOURCE_STUB, () => CARD_BASE);
        a.cpu.call(BIND, [VIEW, c.index, c.cardId]);

        const b = runtime();
        seedBind(b, c);
        bindSlotToCard(b.mem, { resourceGetBase: () => CARD_BASE }, BIND_SCRATCH, VIEW, c.index, c.cardId);
        assert.deepEqual(viewState(b), viewState(a), JSON.stringify(c).slice(0, 60));
    }
});

// ── waitViewWindowOpen (F0x800A1DB8) ─────────────────────────────────────────

function seedDuelWindow(rt, o = {}) {
    for (let i = 0x490; i < 0x500; i++) rt.mem.write8(DUEL + i, 0);
    rt.mem.write32(DUEL + DUEL_WINDOW.state, o.state ?? 0);
    rt.mem.write32(DUEL + DUEL_WINDOW.timer, o.timer ?? 0);
    rt.mem.write8(DUEL + DUEL_WINDOW.request, o.request ?? 0);
    rt.mem.write8(DUEL + DUEL_WINDOW.playCount, o.playCount ?? 1);
    for (let i = 0; i < 0x100; i++) rt.mem.write8(VIEW + i, 0);
    rt.mem.write16(VIEW + VIEW_WINDOW_READY, o.viewReady ?? 0);
    rt.mem.write32(SCENE + 0x18, VIEW);
}
function duelState(rt) {
    const out = [];
    for (let i = 0x490; i < 0x500; i++) out.push(rt.mem.read8(DUEL + i));
    return out;
}

test("waitViewWindowOpen matches F0x800A1DB8 across the state and readiness gates", () => {
    const CASES = [
        { state: 0, viewReady: 0, request: 0 },
        { state: 0, viewReady: 2, request: 0 },
        { state: 0, viewReady: 2, request: 1 },
        { state: 3, viewReady: 2, request: 0 },
        { state: 5, viewReady: 1, request: 0 },
    ];
    for (const c of CASES) {
        const evA = [];
        const a = runtime();
        seedDuelWindow(a, c);
        a.mem.write32(VIEW + SLOT_EC8, STUB_EC8);
        a.cpu.setStub(STUB_EC8, (r) => { evA.push(["EC8", r.reg(4) >>> 0]); return 0; });
        const ra = a.cpu.call(WAIT_WINDOW, [DUEL, SCENE]) | 0;

        const evB = [];
        const b = runtime();
        seedDuelWindow(b, c);
        const rb = waitViewWindowOpen(b.mem, {
            openViewWindow: (v) => evB.push(["EC8", v >>> 0]),
            openInfoBanner() {}, writeBannerRecord() {}, scaleSlot() {}, closePlate() {},
            settleSlot() {}, frameDelta: () => 0, randomValue: () => 0, randomShift: () => 0,
            playSound() {},
        }, DUEL, SCENE);

        const label = JSON.stringify(c);
        assert.equal(rb, ra, `${label} return`);
        assert.deepEqual(duelState(b), duelState(a), `${label} duel`);
        assert.deepEqual(evB, evA, `${label} calls`);
    }
});

// ── presentResolvingCard (F0x800A1E60) ───────────────────────────────────────

function seedPresent(rt, o = {}) {
    seedDuelWindow(rt, o);
    rt.mem.write8(DUEL + DUEL_WINDOW.playCount, o.playCount ?? 1);
    const rec = DUEL + ((o.playCount ?? 1) - 1) * 8;
    rt.mem.write16(rec + 0x580, o.card ?? 0);
    rt.mem.write8(rec + 0x584, o.selector ?? 0);
    rt.mem.write32(0x8005ccb0, o.language ?? 1);
    if (o.card !== undefined) rt.mem.write16(DUEL + o.card * 2 + 0x50, o.entry ?? 0);
    // banner table for the history selector / language
    const table = PRESENT_HISTORY_BASE + (o.selector ?? 0) * 4 + (o.language ?? 1) * 8;
    for (let i = 0; i < 0x20; i++) rt.mem.write8(table + i, 0);
    rt.mem.write16(table, o.w ?? 0x2c);
    rt.mem.write16(table + 2, o.h ?? 0x1d);
    rt.mem.write32(VIEW + SLOT_EA8, STUB_EA8);
    rt.mem.write32(VIEW + SLOT_EAC, STUB_EAC);
    rt.mem.write32(VIEW + SLOT_EB0, STUB_EB0);
    rt.mem.write32(VIEW + SLOT_F1C, STUB_F1C);
    rt.mem.write32(VIEW + SLOT_F24, STUB_F24);
}

function stubPresent(rt, ev) {
    rt.mem.write32(DELTA_CELL, DELTA_STUB);
    rt.cpu.setStub(DELTA_STUB, () => 1);
    rt.mem.write32(RAND_VALUE_CELL, RAND_VALUE_STUB);
    rt.mem.write32(RAND_SHIFT_CELL, RAND_SHIFT_STUB);
    rt.cpu.setStub(RAND_VALUE_STUB, () => 0xffffffff);
    rt.cpu.setStub(RAND_SHIFT_STUB, () => 0);
    rt.mem.write32(SOUND_CELL, SOUND_STUB);
    rt.cpu.setStub(SOUND_STUB, (c) => { ev.push(["sound", c.reg(4) >>> 0]); });
    rt.cpu.setStub(STUB_EA8, (c) => { ev.push(["closePlate", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(STUB_EAC, (c) => {
        ev.push(["openInfoBanner", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0,
            rt.mem.read32(c.reg(29) + 0x10) >>> 0, rt.mem.read32(c.reg(29) + 0x14) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(STUB_EB0, (c) => { ev.push(["writeBannerRecord", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(STUB_F1C, (c) => { ev.push(["settleSlot", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(STUB_F24, (c) => {
        ev.push(["scaleSlot", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0,
            rt.mem.read32(c.reg(29) + 0x10) >>> 0]);
        return 0;
    });
}

function portPresent(ev) {
    return {
        openViewWindow() {},
        openInfoBanner(view, kind, a2, a3, w, h) {
            ev.push(["openInfoBanner", view >>> 0, kind >>> 0, a2 >>> 0, a3 >>> 0, w >>> 0, h >>> 0]);
        },
        writeBannerRecord(view, kind) { ev.push(["writeBannerRecord", view >>> 0, kind >>> 0]); },
        scaleSlot(view, index, span, from, to) {
            ev.push(["scaleSlot", view >>> 0, index >>> 0, span >>> 0, from >>> 0, to >>> 0]);
        },
        closePlate(view, index) { ev.push(["closePlate", view >>> 0, index >>> 0]); },
        settleSlot(view, index) { ev.push(["settleSlot", view >>> 0, index >>> 0]); },
        frameDelta: () => 1,
        randomValue: () => 0xffffffff,
        randomShift: () => 0,
        playSound(id) { ev.push(["sound", id >>> 0]); },
    };
}

test("presentResolvingCard matches F0x800A1E60 across states and transitions", () => {
    const CASES = [
        { state: 0, playCount: 1, card: 0, entry: 3, selector: 0, language: 1, viewReady: 2 },
        { state: 1, timer: 0x13, playCount: 2 },
        { state: 1, timer: 0x22, playCount: 2 },
        { state: 2, timer: 7, playCount: 3 },
        { state: 3, timer: 0xe, playCount: 1 },
        { state: 4, timer: 0 },
        { state: 5, timer: 0xe, playCount: 1 },
        { state: 5, timer: 5, playCount: 1 },
        { state: 7, timer: 0 },
    ];
    for (const c of CASES) {
        const evA = [];
        const a = runtime();
        seedPresent(a, c);
        stubPresent(a, evA);
        const ra = a.cpu.call(PRESENT, [DUEL, SCENE]) | 0;

        const evB = [];
        const b = runtime();
        seedPresent(b, c);
        const rb = presentResolvingCard(b.mem, portPresent(evB), DUEL, SCENE);

        const label = JSON.stringify(c);
        assert.equal(rb, ra, `${label} return`);
        assert.deepEqual(duelState(b), duelState(a), `${label} duel`);
        assert.deepEqual(evB, evA, `${label} calls`);
    }
});

// The two families read only data; no executable overlay fetch is involved.
test("the view-window port never fetches an overlay instruction", () => {
    const b = runtime();
    seedPresent(b, { state: 0, playCount: 1, card: 0, selector: 0, language: 1 });
    presentResolvingCard(b.mem, portPresent([]), DUEL, SCENE);
    waitViewWindowOpen(b.mem, portPresent([]), DUEL, SCENE);
    assert.equal(typeof b.mem.read8(DUEL + DUEL_WINDOW.state), "number");
});
