// Phase 4 oracle: engine/dw3/ui/sound-test.ts must match pro/soundtst
// F0x80084B2C. The original runs through engine/native with the display view,
// the widget factory and the three sub-state functions stubbed to record the
// exact ordered calls; the port uses an equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { soundTestMenuTick, soundTestCategoryList, soundTestScrollList, soundTestSoundList, soundTestLoader } from "../engine/dw3/ui/sound-test.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_soundtst.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const ARG1 = 0x80190000;
const WIDGET = 0x801a0000;
const VIEW = 0x801b0000;
const ADVANCE = 0x800142ac;
const S = {
    d150: 0x0fe70000, d154: 0x0fe70010, d174: 0x0fe70020, d16c: 0x0fe70030,
    v12c: 0x0fe70040, factory: 0x8001ae38,
    ws110: 0x0fe70050, ws134: 0x0fe70060, ws144: 0x0fe70070,
    category: 0x0fe70080, loader: 0x0fe70090, soundList: 0x0fe700a0,
    transition: 0x0fe700b0,
    pad: 0x0fe700c0, padHeld: 0x0fe700c8, padRepeat: 0x0fe700d0, scroll: 0x0fe700e0,
    soundPlay: 0x0fe700f0, soundStop: 0x0fe700f8, soundLoad: 0x0fe70108,
    soundLoadCommon: 0x0fe70110, soundBusy: 0x0fe70118, soundStopAll: 0x0fe70120,
};
const PAD = { pressed: 0x8004b7d0 + 0x3f4, held: 0x8004b7d0 + 0x3f8, repeat: 0x8004b7d0 + 0x3fc };
const CAT_TABLE = 0x80085800;
const SOUND_TABLES = 0x800856e4;
let PAD_PRESSED = 0;
let PAD_HELD = 0;
let PAD_REPEAT = 0;
// Display service pointers live in the resident data block at 0x8004DE10.
const DISP = { p150: 0x8004de10 + 0x150, p154: 0x8004de10 + 0x154, p174: 0x8004de10 + 0x174, p16c: 0x8004de10 + 0x16c };

let EVENTS = [];

function runtime({ stubCategory = true, stubSubstates = true } = {}) {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;

    rt.cpu.setStub(S.d150, (c) => { EVENTS.push(["displaySetA", c.reg(4)]); return 0; });
    rt.cpu.setStub(S.d154, (c) => { EVENTS.push(["displaySetB", c.reg(4)]); return 0; });
    rt.cpu.setStub(S.d174, (c) => { EVENTS.push(["displaySetRect", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]); return 0; });
    rt.cpu.setStub(S.d16c, (c) => {
        EVENTS.push(["displayViewCreate", c.reg(4), c.reg(5), c.reg(6)]);
        rt.mem.write32(VIEW + 0x12c, S.v12c);
        return VIEW;
    });
    rt.cpu.setStub(S.v12c, (c) => { EVENTS.push(["viewSetColour", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]); return 0; });
    rt.mem.write32(DISP.p150, S.d150);
    rt.mem.write32(DISP.p154, S.d154);
    rt.mem.write32(DISP.p174, S.d174);
    rt.mem.write32(DISP.p16c, S.d16c);

    rt.cpu.setStub(S.factory, (c) => {
        EVENTS.push(["createWidget", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        rt.mem.write32(WIDGET + 0x110, S.ws110);
        rt.mem.write32(WIDGET + 0x134, S.ws134);
        rt.mem.write32(WIDGET + 0x144, S.ws144);
        return WIDGET;
    });
    rt.cpu.setStub(S.ws110, (c) => { EVENTS.push(["widgetSetString", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(S.ws134, (c) => { EVENTS.push(["widgetSetPos", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(S.ws144, (c) => { EVENTS.push(["widgetSetVisible", c.reg(4), c.reg(5)]); return 0; });

    rt.cpu.setStub(S.category, (c) => { EVENTS.push(["categoryList", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(S.loader, (c) => { EVENTS.push(["loader", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(S.soundList, (c) => { EVENTS.push(["soundList", c.reg(4), c.reg(5)]); return 0; });
    if (stubCategory) {
        rt.cpu.setStub(0x800848bc, (c) => { EVENTS.push(["categoryList", c.reg(4), c.reg(5)]); return 0; });
    }
    if (stubSubstates) {
        rt.cpu.setStub(0x80084808, (c) => { EVENTS.push(["loader", c.reg(4), c.reg(5)]); return 0; });
        rt.cpu.setStub(0x800844a8, (c) => { EVENTS.push(["soundList", c.reg(4), c.reg(5)]); return 0; });
    }

    rt.cpu.setStub(S.pad, () => PAD_PRESSED);
    rt.cpu.setStub(S.padHeld, () => PAD_HELD);
    rt.cpu.setStub(S.padRepeat, () => PAD_REPEAT);
    rt.mem.write32(PAD.pressed, S.pad);
    rt.mem.write32(PAD.held, S.padHeld);
    rt.mem.write32(PAD.repeat, S.padRepeat);
    // The mover is not stubbed: both the original and the port run the real
    // F0x8008443c logic, so the oracle also checks that translation.
    rt.cpu.setStub(ADVANCE, (c) => { EVENTS.push(["advance", c.reg(4)]); return 0; });
    rt.cpu.setStub(S.transition, (c) => { EVENTS.push(["transition", c.reg(4), c.reg(5)]); return 0; });
    rt.mem.write32(0x8004b440, S.transition);

    // Resident sound-service pointer block (D0x80055c48..64) used by the loader
    // and the sound list; the targets are synthetic recording stubs.
    rt.cpu.setStub(S.soundPlay, (c) => { EVENTS.push(["previewStart", c.reg(4)]); return SOUND_PLAY_HANDLE; });
    rt.cpu.setStub(S.soundStop, (c) => { EVENTS.push(["previewStop", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(S.soundLoad, (c) => { EVENTS.push(["loadArchive", c.reg(4)]); return 0; });
    rt.cpu.setStub(S.soundLoadCommon, (c) => { EVENTS.push(["loadCommon", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(S.soundBusy, () => LOAD_BUSY);
    rt.cpu.setStub(S.soundStopAll, () => { EVENTS.push(["stopAll"]); return 0; });
    rt.mem.write32(0x80055c48, S.soundPlay);
    rt.mem.write32(0x80055c50, S.soundStop);
    rt.mem.write32(0x80055c54, S.soundLoad);
    rt.mem.write32(0x80055c58, S.soundLoadCommon);
    rt.mem.write32(0x80055c60, S.soundBusy);
    rt.mem.write32(0x80055c64, S.soundStopAll);
    return rt;
}

const rt = runtime();
const rtCat = runtime({ stubCategory: false });
const rtSub = runtime({ stubCategory: false, stubSubstates: false });

function seed(o = {}) {
    EVENTS = [];
    for (let i = 0; i < 0x30; i += 4) rt.mem.write32(ARG1 + i, 0);
    rt.mem.write32(OBJ + 0x0c, o.state ?? 0);
    rt.mem.write32(OBJ + 0x10, o.substate ?? 0);
    rt.mem.write32(OBJ + 0x38, ADVANCE);
}

function slots() {
    return [0, 4, 8, 0xc, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x24, 0x28]
        .map((off) => rt.mem.read32(ARG1 + off) >>> 0);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        displaySetA(arg) { EVENTS.push(["displaySetA", arg >>> 0]); },
        displaySetB(arg) { EVENTS.push(["displaySetB", arg >>> 0]); },
        displaySetRect(x, y, w, h) { EVENTS.push(["displaySetRect", x >>> 0, y >>> 0, w >>> 0, h >>> 0]); },
        displayViewCreate(d, a1, a2) { EVENTS.push(["displayViewCreate", d >>> 0, a1 >>> 0, a2 >>> 0]); return VIEW; },
        viewSetColour(v, r, g, b) { EVENTS.push(["viewSetColour", v >>> 0, r >>> 0, g >>> 0, b >>> 0]); },
        createWidget(k, a1, x, y) { EVENTS.push(["createWidget", k >>> 0, a1 >>> 0, x >>> 0, y >>> 0]); return WIDGET; },
        widgetSetString(w, id) { EVENTS.push(["widgetSetString", w >>> 0, id >>> 0]); },
        advance(o) { EVENTS.push(["advance", o >>> 0]); },
        categoryList(o, a1) { EVENTS.push(["categoryList", o >>> 0, a1 >>> 0]); },
        loader(o, a1) { EVENTS.push(["loader", o >>> 0, a1 >>> 0]); },
        soundList(o, a1) { EVENTS.push(["soundList", o >>> 0, a1 >>> 0]); },
        requestTransition(s, a) { EVENTS.push(["transition", s >>> 0, a >>> 0]); },
    };
}

function runTick(label, o) {
    seed(o);
    rt.cpu.call(0x80084b2c, [OBJ, ARG1]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleSlots = slots();

    seed(o);
    soundTestMenuTick(rt.mem, OBJ, ARG1, portHost());
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
    assert.deepEqual(slots(), oracleSlots, `${label}: arg1 slots`);
}

test("soundTestMenuTick matches F0x80084B2C", () => {
    runTick("state 0 builds", { state: 0 });
    runTick("state 4 rebuilds with selector", { state: 4 });
    runTick("state 2 idle", { state: 2 });
    runTick("state 3 transitions", { state: 3 });
    runTick("state 1 category list", { state: 1, substate: 0 });
    runTick("state 1 category list high substate", { state: 1, substate: 3 });
    runTick("state 1 loader", { state: 1, substate: 1 });
    runTick("state 1 sound list", { state: 1, substate: 2 });
});

test("the original build really creates the eleven widgets in order", () => {
    seed({ state: 0 });
    rt.cpu.call(0x80084b2c, [OBJ, ARG1]);
    const creates = EVENTS.filter((e) => e[0] === "createWidget");
    assert.equal(creates.length, 11, "widget count");
    assert.deepEqual(creates[0], ["createWidget", 0x1000, 1, 0x10, 0x1e], "title");
    assert.deepEqual(creates[1], ["createWidget", 0x1000, 1, 0x20, 0x32], "heading");
    assert.deepEqual(creates[2], ["createWidget", 0x1000, 1, 0x30, 0x46], "row 0");
    assert.deepEqual(creates[9], ["createWidget", 0x1000, 1, 0x30, 0xb6], "row 7");
    assert.deepEqual(creates[10], ["createWidget", 0x1000, 1, 0x20, 0x46], "cursor");
    assert.deepEqual(EVENTS[EVENTS.length - 1], ["advance", OBJ | 0], "advance last");
});

// --- category list (F0x800848BC) -------------------------------------------

const CAT_OBJ = OBJ;
const METHOD_40 = 0x0fe70100;
const METHOD_3C = 0x0fe70110;

function seedCategory(o = {}) {
    EVENTS = [];
    PAD_PRESSED = o.pressed ?? 0;
    PAD_REPEAT = o.repeat ?? 0;
    for (let i = 0; i < 0x60; i += 4) rtCat.mem.write32(CAT_OBJ + i, 0);
    rtCat.mem.write32(CAT_OBJ + 0x14, o.substate ?? 0);
    rtCat.mem.write32(CAT_OBJ + 0x50, o.cursor ?? 0);
    rtCat.mem.write32(CAT_OBJ + 0x54, o.scroll ?? 0);
    rtCat.mem.write32(CAT_OBJ + 0x58, o.count ?? 0);
    rtCat.mem.write32(CAT_OBJ + 0x5c, o.selected ?? 0);
    rtCat.mem.write32(CAT_OBJ + 0x40, METHOD_40);
    rtCat.mem.write32(CAT_OBJ + 0x3c, METHOD_3C);
    rtCat.cpu.setStub(METHOD_40, (c) => { EVENTS.push(["taskCall", 0x40, c.reg(4)]); return 0; });
    rtCat.cpu.setStub(METHOD_3C, (c) => { EVENTS.push(["taskCall", 0x3c, c.reg(4)]); return 0; });
    rtCat.mem.write32(WIDGET + 0x110, S.ws110);
    rtCat.mem.write32(WIDGET + 0x134, S.ws134);
    rtCat.mem.write32(WIDGET + 0x144, S.ws144);
    for (const off of [0x04, 0x08, 0x0c, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x24, 0x28]) {
        rtCat.mem.write32(ARG1 + off, WIDGET);
    }
    const entries = o.entries ?? 3;
    for (let i = 0; i < entries; i++) {
        rtCat.mem.write32(CAT_TABLE + i * 8, 0x1000 + i);
        rtCat.mem.write32(CAT_TABLE + i * 8 + 4, 1);
    }
    rtCat.mem.write32(CAT_TABLE + entries * 8, 0xdead);
    rtCat.mem.write32(CAT_TABLE + entries * 8 + 4, 0);
}

function catFields() {
    return [0x14, 0x50, 0x54, 0x58, 0x5c].map((off) => rtCat.mem.read32(CAT_OBJ + off) >>> 0);
}

function portCategoryHost() {
    return {
        padPressed() { return PAD_PRESSED; },
        padRepeat() { return PAD_REPEAT; },
        taskCall(slot, obj) { EVENTS.push(["taskCall", slot, obj >>> 0]); },
        widgetSetString(w, id) { EVENTS.push(["widgetSetString", w >>> 0, id >>> 0]); },
        widgetSetVisible(w, v) { EVENTS.push(["widgetSetVisible", w >>> 0, v >>> 0]); },
        widgetSetPos(w, x, y) { EVENTS.push(["widgetSetPos", w >>> 0, x >>> 0, y >>> 0]); },
    };
}

function runCategory(label, o) {
    seedCategory(o);
    rtCat.cpu.call(0x800848bc, [CAT_OBJ, ARG1]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = catFields();

    seedCategory(o);
    soundTestCategoryList(rtCat.mem, CAT_OBJ, ARG1, portCategoryHost());
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
    assert.deepEqual(catFields(), oracleFields, `${label}: fields`);
}

test("soundTestCategoryList matches F0x800848BC", () => {
    runCategory("build and show three entries", {});
    runCategory("substate 1 skips the build", { substate: 1 });
    runCategory("ten entries fills eight rows", { entries: 10 });
    runCategory("pad down scrolls", { pressed: 0x40 });
    runCategory("pad up scrolls", { repeat: 0x10 });
    runCategory("circle confirms", { pressed: 0x2000, cursor: 2 });
    runCategory("cursor offset", { cursor: 5, scroll: 2, entries: 10 });
    runCategory("scrolled render", { cursor: 4, scroll: 3, entries: 10 });
});

test("the original category build counts the table and fills eight rows", () => {
    seedCategory({ entries: 10 });
    rtCat.cpu.call(0x800848bc, [CAT_OBJ, ARG1]);
    assert.equal(rtCat.mem.read32(CAT_OBJ + 0x58) >>> 0, 10, "count");
    const shown = EVENTS.filter((e) => e[0] === "widgetSetVisible" && e[2] === 1);
    assert.equal(shown.length, 8, "eight rows shown");
    assert.deepEqual(EVENTS.filter((e) => e[0] === "taskCall"), [["taskCall", 0x40, CAT_OBJ | 0]], "task 0x40");
});

// --- shared list mover (F0x8008443C) ---------------------------------------

const MOVER = 0x8008443c;
const MOVER_CURSOR = OBJ + 0x60;
const MOVER_SCROLL = OBJ + 0x64;

function runMover(label, delta, cursor0, scroll0, count) {
    rtSub.mem.write32(MOVER_CURSOR, cursor0);
    rtSub.mem.write32(MOVER_SCROLL, scroll0);
    rtSub.mem.write32(rtSub.cpu.sp + 0x10, count);
    rtSub.cpu.call(MOVER, [0, delta, MOVER_CURSOR, MOVER_SCROLL]);
    const oracle = [rtSub.mem.read32(MOVER_CURSOR) >>> 0, rtSub.mem.read32(MOVER_SCROLL) >>> 0];

    rtSub.mem.write32(MOVER_CURSOR, cursor0);
    rtSub.mem.write32(MOVER_SCROLL, scroll0);
    soundTestScrollList(rtSub.mem, delta, MOVER_CURSOR, MOVER_SCROLL, count);
    assert.deepEqual(
        [rtSub.mem.read32(MOVER_CURSOR) >>> 0, rtSub.mem.read32(MOVER_SCROLL) >>> 0],
        oracle,
        `${label}: cursor/scroll`,
    );
}

test("soundTestScrollList matches F0x8008443C", () => {
    runMover("down", 1, 0, 0, 4);
    runMover("up clamps at zero", -1, 0, 0, 4);
    runMover("down clamps at count", 1, 3, 0, 4);
    runMover("bottom scrolls the window", 1, 8, 0, 20);
    runMover("top scrolls the window", -1, 9, 9, 10);
    runMover("inside the window moves nothing", 1, 3, 2, 20);
    runMover("count zero refuses", 1, 0, 0, 0);
});

// --- sound list (F0x800844A8) ----------------------------------------------

const SL_OBJ = OBJ;
const SL_TABLE = 0x801c0000;
const SL_METHOD_2C = 0x0fe70130;
const SL_METHOD_40 = 0x0fe70140;
let SOUND_PLAY_HANDLE = 7;
let LOAD_BUSY = 0;

function seedSoundList(o = {}) {
    EVENTS = [];
    PAD_PRESSED = o.pressed ?? 0;
    PAD_HELD = o.held ?? 0;
    PAD_REPEAT = o.repeat ?? 0;
    const category = o.category ?? 0;
    for (let i = 0; i < 0x80; i += 4) rtSub.mem.write32(SL_OBJ + i, 0);
    rtSub.mem.write32(SL_OBJ + 0x14, o.stage ?? 1);
    rtSub.mem.write32(SL_OBJ + 0x50, category);
    rtSub.mem.write32(SL_OBJ + 0x60, o.cursor ?? 0);
    rtSub.mem.write32(SL_OBJ + 0x64, o.scroll ?? 0);
    rtSub.mem.write32(SL_OBJ + 0x68, o.count ?? 0);
    rtSub.mem.write32(SL_OBJ + 0x6c, o.previewing ?? 0);
    rtSub.mem.write32(SL_OBJ + 0x70, o.handle ?? 0);
    rtSub.mem.write32(SL_OBJ + 0x2c, SL_METHOD_2C);
    rtSub.mem.write32(SL_OBJ + 0x40, SL_METHOD_40);
    rtSub.cpu.setStub(SL_METHOD_2C, (c) => { EVENTS.push(["taskCall", 0x2c, c.reg(4) >>> 0]); return 0; });
    rtSub.cpu.setStub(SL_METHOD_40, (c) => { EVENTS.push(["taskCall", 0x40, c.reg(4) >>> 0]); return 0; });
    rtSub.mem.write32(SOUND_TABLES + category * 4, SL_TABLE);
    rtSub.mem.write32(CAT_TABLE + category * 8, 0x2222 + category);
    rtSub.mem.write32(CAT_TABLE + category * 8 + 4, 1);
    const entries = o.entries ?? 3;
    for (let i = 0; i < entries; i++) {
        rtSub.mem.write32(SL_TABLE + i * 8, 0x3000 + i);
        rtSub.mem.write32(SL_TABLE + i * 8 + 4, 100 + i);
    }
    rtSub.mem.write32(SL_TABLE + entries * 8, 0xdead);
    rtSub.mem.write32(SL_TABLE + entries * 8 + 4, 0);
    rtSub.mem.write32(WIDGET + 0x110, S.ws110);
    rtSub.mem.write32(WIDGET + 0x134, S.ws134);
    rtSub.mem.write32(WIDGET + 0x144, S.ws144);
    for (const off of [0x04, 0x08, 0x0c, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x24, 0x28]) {
        rtSub.mem.write32(ARG1 + off, WIDGET);
    }
}

function slFields() {
    return [0x14, 0x50, 0x60, 0x64, 0x68, 0x6c, 0x70].map((off) => rtSub.mem.read32(SL_OBJ + off) >>> 0);
}

function portSoundListHost() {
    return {
        padPressed() { return PAD_PRESSED; },
        padHeld() { return PAD_HELD; },
        padRepeat() { return PAD_REPEAT; },
        stopAll() { EVENTS.push(["stopAll"]); },
        previewStart(id) { EVENTS.push(["previewStart", id >>> 0]); return SOUND_PLAY_HANDLE; },
        previewStop(id, handle) { EVENTS.push(["previewStop", id >>> 0, handle | 0]); },
        taskCall(slot, obj) { EVENTS.push(["taskCall", slot, obj >>> 0]); },
        widgetSetString(w, id) { EVENTS.push(["widgetSetString", w >>> 0, id >>> 0]); },
        widgetSetVisible(w, v) { EVENTS.push(["widgetSetVisible", w >>> 0, v >>> 0]); },
        widgetSetPos(w, x, y) { EVENTS.push(["widgetSetPos", w >>> 0, x >>> 0, y >>> 0]); },
    };
}

function runSoundList(label, o) {
    seedSoundList(o);
    rtSub.cpu.call(0x800844a8, [SL_OBJ, ARG1]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = slFields();

    seedSoundList(o);
    soundTestSoundList(rtSub.mem, SL_OBJ, ARG1, portSoundListHost());
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
    assert.deepEqual(slFields(), oracleFields, `${label}: fields`);
}

test("soundTestSoundList matches F0x800844A8", () => {
    runSoundList("build and show three entries", { stage: 0 });
    runSoundList("build with ten entries", { stage: 0, entries: 10 });
    runSoundList("stage 1 skips the build", {});
    runSoundList("pad down scrolls", { pressed: 0x40 });
    runSoundList("pad up scrolls", { repeat: 0x10 });
    runSoundList("square stops everything", { pressed: 0x8000 });
    runSoundList("cross goes back", { pressed: 0x4000 });
    runSoundList("circle previews", { pressed: 0x2000, cursor: 2, handle: 0 });
    runSoundList("held circle keeps playing", { held: 0x2000, previewing: 1, handle: 7 });
    runSoundList("released circle stops", { previewing: 1, handle: 7, cursor: 2 });
    runSoundList("scrolled render", { cursor: 4, scroll: 3, entries: 10 });
});

// --- archive loader (F0x80084808) ------------------------------------------

const LOADER_METHOD_3C = 0x0fe70150;

function seedLoader(o = {}) {
    EVENTS = [];
    LOAD_BUSY = o.busy ?? 0;
    for (let i = 0; i < 0x80; i += 4) rtSub.mem.write32(SL_OBJ + i, 0);
    rtSub.mem.write32(SL_OBJ + 0x14, o.stage ?? 0);
    rtSub.mem.write32(SL_OBJ + 0x5c, o.archive ?? 5);
    rtSub.mem.write32(SL_OBJ + 0x3c, LOADER_METHOD_3C);
    rtSub.cpu.setStub(LOADER_METHOD_3C, (c) => { EVENTS.push(["taskCall", 0x3c, c.reg(4) >>> 0]); return 0; });
}

function loaderFields() {
    return [0x14, 0x5c].map((off) => rtSub.mem.read32(SL_OBJ + off) >>> 0);
}

function portLoaderHost() {
    return {
        loadArchive(id) { EVENTS.push(["loadArchive", id >>> 0]); },
        loadCommon(a, b) { EVENTS.push(["loadCommon", a >>> 0, b >>> 0]); },
        loadBusy() { return LOAD_BUSY; },
        taskCall(slot, obj) { EVENTS.push(["taskCall", slot, obj >>> 0]); },
    };
}

function runLoader(label, o) {
    seedLoader(o);
    rtSub.cpu.call(0x80084808, [SL_OBJ]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = loaderFields();

    seedLoader(o);
    soundTestLoader(rtSub.mem, SL_OBJ, portLoaderHost());
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
    assert.deepEqual(loaderFields(), oracleFields, `${label}: fields`);
}

test("soundTestLoader matches F0x80084808", () => {
    runLoader("loads a general archive then advances", { archive: 5 });
    runLoader("archive 1 uses the common path", { archive: 1 });
    runLoader("stage 1 only polls", { stage: 1, archive: 5 });
    runLoader("busy stays on the loader", { archive: 5, busy: 1 });
    runLoader("done advances to the sound list", { stage: 1, archive: 5, busy: 0 });
});
