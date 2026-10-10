// Phase 4 oracle: engine/dw3/ui/memcard-root.ts memcardRootTick must match
// pro/stgmcard F0x800877F0. The original runs through engine/native with the
// identity/banks/audio/sound services, the message-window and fade factories,
// the transition methods and the draw-context methods stubbed; the port uses
// an equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { memcardRootTick } from "../engine/dw3/ui/memcard-root.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stgmcard = new Uint8Array(readFileSync(join(dir, "pro_stgmcard.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stgmcard.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const AUX = 0x80181000;
const WINDOW = 0x80182000;
const FADE = 0x80183000;
const PACK_STUB = 0x0fe20000;
const PACK_PTR = 0x80190000;
const ADV_STATE = 0x800142ac;
const ADV_SUB = 0x800142c8;
const STUBS = {
    identity: 0x0fe20010, banks: 0x0fe20020, audio: 0x0fe20030, sound: 0x0fe20040,
    soundExit: 0x0fe20050, window: 0x0fe20060, fadeCtor: 0x0fe20070,
    fadeStart: 0x0fe20080, transition: 0x0fe20090, selector: 0x0fe200a0,
    freeIcon: 0x0fe200b0,
};
const ARITY = { setOrigin: 2, setLayer: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };
const OFFSETS = [0x0c, 0x10, 0x14, 0x50, 0x54, 0x58, 0x5c];

let EVENTS = [];
let DRAW = [];
let BANKS = 0;
let AUDIO = 0;
let SELECTOR = 0x2d8;
let SAVE_SELECTOR = 0x99;

function runtime() {
    const rt = new NativeStageRuntime(stgmcard, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(STUBS.identity, () => { EVENTS.push(["identity"]); return 0; });
    rt.mem.write32(0x80088784, STUBS.identity);
    rt.cpu.setStub(STUBS.banks, () => { EVENTS.push(["banksReady"]); return BANKS; });
    rt.mem.write32(0x80088788, STUBS.banks);
    rt.cpu.setStub(STUBS.audio, (c) => { EVENTS.push(["audioPending", c.reg(4)]); return AUDIO; });
    rt.mem.write32(0x80055c60, STUBS.audio);
    rt.cpu.setStub(STUBS.sound, (c) => { EVENTS.push(["sound", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c48, STUBS.sound);
    rt.cpu.setStub(STUBS.soundExit, (c) => { EVENTS.push(["soundExit", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c68, STUBS.soundExit);
    rt.cpu.setStub(0x80087798, (c) => { EVENTS.push(["createWindow", c.reg(4)]); return WINDOW; });
    rt.cpu.setStub(0x80083074, () => { EVENTS.push(["fadeCtor"]); return FADE; });
    rt.cpu.setStub(STUBS.fadeStart, (c) => { EVENTS.push(["fadeStart", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.mem.write32(FADE + 0x64, STUBS.fadeStart);
    rt.cpu.setStub(STUBS.transition, (c) => { EVENTS.push(["transition", c.reg(4), c.reg(5)]); return 0; });
    rt.mem.write32(0x80048d34 + 0x270c, STUBS.transition);
    rt.mem.write32(0x8004b440, STUBS.transition);
    rt.cpu.setStub(STUBS.selector, () => { EVENTS.push(["selector"]); return SELECTOR; });
    rt.mem.write32(0x80048d34 + 0x2714, STUBS.selector);
    rt.cpu.setStub(STUBS.freeIcon, () => { EVENTS.push(["freeIconTitle"]); return 0; });
    rt.mem.write32(0x8008878c, STUBS.freeIcon);
    rt.cpu.setStub(PACK_STUB, () => PACK_PTR);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(ADV_STATE, (c) => {
        const o = c.reg(4);
        const v = (rt.mem.read32(o + 0xc) + 1) | 0;
        rt.mem.write32(o + 0x10, 0);
        rt.mem.write32(o + 0x14, 0);
        rt.mem.write32(o + 0x18, 0);
        rt.mem.write32(o + 0xc, v);
        EVENTS.push(["advance", o]);
        return v;
    });
    rt.cpu.setStub(ADV_SUB, (c) => { EVENTS.push(["advanceSub", c.reg(4)]); return 0; });
    return rt;
}

const rt = runtime();

function seed(o) {
    EVENTS = [];
    DRAW = [];
    BANKS = o.banks ?? 0;
    AUDIO = o.audio ?? 0;
    SELECTOR = o.selector ?? 0x2d8;
    SAVE_SELECTOR = o.saveSelector ?? 0x99;
    rt.mem.write32(0x80048d68, SAVE_SELECTOR);
    for (let i = 0; i < 0x70; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x38, ADV_STATE);
    rt.mem.write32(OBJ + 0x3c, ADV_SUB);
    rt.mem.write32(OBJ + 0x0c, o.state ?? 0);
    rt.mem.write32(OBJ + 0x10, o.substate ?? 0);
    rt.mem.write32(OBJ + 0x14, o.step ?? 0);
    rt.mem.write32(OBJ + 0x50, o.side ?? 0);
    rt.mem.write32(OBJ + 0x54, o.target ?? 0x1000);
    rt.mem.write32(OBJ + 0x58, o.ambient ?? 0);
    rt.mem.write32(OBJ + 0x5c, o.ambientToggle ?? 0);
    rt.mem.write32(AUX + 0x00, o.window ?? 0);
    rt.mem.write32(AUX + 0x04, o.fade ?? 0);
    rt.mem.write32(WINDOW + 0x0c, o.windowState ?? 0);
    rt.mem.write32(FADE + 0x0c, o.fadeState ?? 0);
}

function fields() {
    const out = OFFSETS.map((off) => rt.mem.read32(OBJ + off) >>> 0);
    out.push(rt.mem.read32(AUX + 0x00) >>> 0, rt.mem.read32(AUX + 0x04) >>> 0);
    return out;
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        advancePhase(o) {
            const v = (rt.mem.read32(o + 0xc) + 1) | 0;
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0xc, v);
            EVENTS.push(["advance", o]);
        },
        advanceSubstate(o) { EVENTS.push(["advanceSub", o]); },
        buildIdentity() { EVENTS.push(["identity"]); },
        banksReady() { EVENTS.push(["banksReady"]); return BANKS; },
        audioPending(arg) { EVENTS.push(["audioPending", arg]); return AUDIO; },
        playSound(id) { EVENTS.push(["sound", id >>> 0]); },
        playSoundExit(id) { EVENTS.push(["soundExit", id >>> 0]); },
        createMessageWindow(screen) { EVENTS.push(["createWindow", screen]); return WINDOW; },
        fadeCtor() { EVENTS.push(["fadeCtor"]); return FADE; },
        fadeStart(fade, a1, a2) { EVENTS.push(["fadeStart", fade >>> 0, a1, a2]); },
        requestTransition(selector, arg) { EVENTS.push(["transition", selector >>> 0, arg]); },
        selectorMethod() { EVENTS.push(["selector"]); return SELECTOR; },
        saveSelector() { return SAVE_SELECTOR; },
        freeIconTitle() { EVENTS.push(["freeIconTitle"]); },
        initDrawContext() {},
        setLayer(t, b) { DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setOrigin(x, y) { DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        drawSprite(p, c, x, y) { DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve() { return PACK_PTR; },
    };
}

function runCase(label, o) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x800877f0, [OBJ, AUX]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleFields = fields();

    seed(o);
    memcardRootTick(rt.mem, OBJ, AUX, portHost());
    const portEvents = norm(EVENTS.slice());
    const portDraw = normDraw(DRAW);
    const portFields = fields();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portDraw, oracleDraw, `${label}: draw`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("memcardRootTick matches F0x800877F0", () => {
    runCase("state 0 builds identity", { state: 0, substate: 0 });
    runCase("state 0 late substate", { state: 0, substate: 5 });
    runCase("state 4 builds", { state: 4, substate: 0 });
    runCase("state 0 banks pending", { state: 0, substate: 1, banks: 1 });
    runCase("state 0 audio pending", { state: 0, substate: 1, audio: 1 });
    runCase("state 0 ready", { state: 0, substate: 1 });
    runCase("state 2 idle", { state: 2 });
    runCase("state 1 creates window", { state: 1, substate: 0, ambientToggle: 1, ambient: 5 });
    runCase("state 1 existing window", { state: 1, substate: 0, window: WINDOW });
    runCase("state 1 fade starts", { state: 1, substate: 1, window: WINDOW, windowState: 2 });
    runCase("state 1 fade waiting", { state: 1, substate: 1, window: WINDOW, windowState: 1 });
    runCase("state 1 fade done", { state: 1, substate: 2, fade: FADE, fadeState: 2 });
    runCase("state 1 fade not done", { state: 1, substate: 2, fade: FADE, fadeState: 1 });
    runCase("state 1 late substate", { state: 1, substate: 5 });
    runCase("state 3 save selector", { state: 3, step: 0 });
    runCase("state 3 side selector", { state: 3, step: 1, side: 1 });
    runCase("state 3 previous selector", { state: 3, step: 1, side: 0, selector: 0x2ff });
    runCase("ambient wrap", { state: 1, substate: 5, ambientToggle: 1, ambient: 0x5f });
    runCase("ambient off", { state: 1, substate: 5, ambientToggle: 0, ambient: 0x10 });
});
