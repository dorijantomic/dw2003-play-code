// Phase 4 oracle: engine/dw3/ui/gym-screen.ts gymScreenTick (F0x80085BB0) must
// make the same ordered boundary calls and land on the same screen fields as
// the original. The original runs through engine/native with every boundary
// (resident service cells, the two translated callees, the object
// state-machine methods) stubbed; the port uses an equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { gymScreenTick } from "../engine/dw3/ui/gym-screen.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stgtrain = new Uint8Array(readFileSync(join(dir, "pro_stgtrain.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stgtrain.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SCREEN = 0x80180000;
const HUD = 0x80181000;
const SET_STATE = 0x80014274;
const ADV_STATE = 0x800142ac;

const STUBS = {
    plate: 0x0fdd0000, requestBank: 0x0fdd0010, requestSound: 0x0fdd0020,
    bankPending: 0x0fdd0030, roster: 0x0fdd0040, audioPending: 0x0fdd0050,
    sound: 0x0fdd0060, soundExit: 0x0fdd0070, transition: 0x0fdd0080,
    hud: 0x0fdd0090, flow: 0x0fdd00a0, draw: 0x0fdd00b0,
};
const ARITY = {
    plate: 1, requestBank: 1, requestSound: 1, bankPending: 1, roster: 1,
    audioPending: 1, sound: 1, soundExit: 1, transition: 2, hud: 2, flow: 2,
    draw: 1, advancePhase: 1, setPhase: 2,
};

let EVENTS = [];
let LANG = 0x40;
let PENDING = 0;
let AUDIO_PENDING = 0;
let SELECTOR = 0x2d7;
let ROSTER = [0, -1, 0];

function runtime() {
    const rt = new NativeStageRuntime(stgtrain, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8005cca8, LANG);
    rt.mem.write32(0x80048d68, SELECTOR);
    // Resident/indirect boundary cells.
    rt.cpu.setStub(STUBS.plate, (c) => { EVENTS.push(["plate", c.reg(4)]); return 0; });
    rt.mem.write32(0x8008d2ac, 0x8008b8a4); // the real overlay entry is stubbed below
    rt.cpu.setStub(0x8008b8a4, (c) => { EVENTS.push(["plate", c.reg(4)]); return 0; });
    rt.cpu.setStub(STUBS.requestBank, (c) => { EVENTS.push(["requestBank", c.reg(4)]); return 0; });
    rt.mem.write32(0x80044f44, STUBS.requestBank);
    rt.cpu.setStub(STUBS.bankPending, (c) => { EVENTS.push(["bankPending", c.reg(4)]); return PENDING; });
    rt.mem.write32(0x80044f3c, STUBS.bankPending);
    rt.cpu.setStub(STUBS.requestSound, (c) => { EVENTS.push(["requestSound", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c54, STUBS.requestSound);
    rt.cpu.setStub(STUBS.audioPending, (c) => { EVENTS.push(["audioPending", c.reg(4)]); return AUDIO_PENDING; });
    rt.mem.write32(0x80055c60, STUBS.audioPending);
    rt.cpu.setStub(STUBS.sound, (c) => { EVENTS.push(["sound", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c48, STUBS.sound);
    rt.cpu.setStub(STUBS.soundExit, (c) => { EVENTS.push(["soundExit", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c68, STUBS.soundExit);
    rt.cpu.setStub(STUBS.roster, (c) => { EVENTS.push(["roster", c.reg(4)]); return ROSTER[c.reg(4) & 3] ?? -1; });
    rt.mem.write32(0x8004b44c, STUBS.roster);
    rt.cpu.setStub(STUBS.transition, (c) => { EVENTS.push(["transition", c.reg(4), c.reg(5)]); return 0; });
    rt.mem.write32(0x8004b440, STUBS.transition);
    rt.cpu.setStub(0x80083aec, (c) => { EVENTS.push(["hud", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(0x8008517c, (c) => { EVENTS.push(["flow", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(0x80084838, (c) => { EVENTS.push(["draw", c.reg(4)]); return 0; });
    // The object state-machine methods, recorded and mutating like the originals.
    rt.cpu.setStub(SET_STATE, (c) => {
        const o = c.reg(4);
        rt.mem.write32(o + 0xc, c.reg(5));
        rt.mem.write32(o + 0x10, 0);
        rt.mem.write32(o + 0x14, 0);
        rt.mem.write32(o + 0x18, 0);
        EVENTS.push(["setPhase", o, c.reg(5)]);
        return 0;
    });
    rt.cpu.setStub(ADV_STATE, (c) => {
        const o = c.reg(4);
        const v = (rt.mem.read32(o + 0xc) + 1) | 0;
        rt.mem.write32(o + 0x10, 0);
        rt.mem.write32(o + 0x14, 0);
        rt.mem.write32(o + 0x18, 0);
        rt.mem.write32(o + 0xc, v);
        EVENTS.push(["advancePhase", o]);
        return v;
    });
    return rt;
}

const rt = runtime();

function seed(o) {
    EVENTS = [];
    LANG = o.lang ?? 0x40;
    PENDING = o.pending ?? 0;
    AUDIO_PENDING = o.audioPending ?? 0;
    SELECTOR = o.selector ?? 0x2d7;
    ROSTER = o.roster ?? [0, -1, 0];
    rt.mem.write32(0x8005cca8, LANG);
    rt.mem.write32(0x80048d68, SELECTOR);
    for (let i = 0; i < 0x114; i += 4) rt.mem.write32(SCREEN + i, 0);
    rt.mem.write32(SCREEN + 0x28, SET_STATE);
    rt.mem.write32(SCREEN + 0x38, ADV_STATE);
    rt.mem.write32(SCREEN + 0x0c, o.state ?? 0);
    rt.mem.write32(SCREEN + 0x10, o.sub ?? 0);
    rt.mem.write32(SCREEN + 0x64, o.podCount ?? 0);
    rt.mem.write32(SCREEN + 0x14, 0x11);
    rt.mem.write32(SCREEN + 0x18, 0x22);
    for (const off of [0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0x100, 0xf0]) rt.mem.write32(SCREEN + off, 0xdead);
}

function snapshot() {
    const out = [];
    for (let i = 0; i < 0x114; i += 4) out.push(rt.mem.read32(SCREEN + i) >>> 0);
    return out;
}

function norm(evs) {
    return evs.map(([name, ...args]) => [name, ...args.slice(0, ARITY[name] ?? 2).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        backgroundPlate() { EVENTS.push(["plate", 1]); },
        requestTextBank(id) { EVENTS.push(["requestBank", id >>> 0]); },
        requestSoundArchive(id) { EVENTS.push(["requestSound", id >>> 0]); },
        textBankPending(id) { EVENTS.push(["bankPending", id >>> 0]); return PENDING; },
        rosterSlot(i) { EVENTS.push(["roster", i]); return ROSTER[i & 3] ?? -1; },
        audioPending(arg) { EVENTS.push(["audioPending", arg]); return AUDIO_PENDING; },
        playSound(id) { EVENTS.push(["sound", id >>> 0]); },
        playSoundPhaseExit(id) { EVENTS.push(["soundExit", id >>> 0]); },
        transitionSelector() { return SELECTOR; },
        requestScreenTransition(sel, arg) { EVENTS.push(["transition", sel >>> 0, arg]); },
        languageIndex() { return LANG; },
        flowTick(screen, hud) { EVENTS.push(["flow", screen, hud]); },
        partnerDraw(screen) { EVENTS.push(["draw", screen]); },
        advancePhase(o) {
            const v = (rt.mem.read32(o + 0xc) + 1) | 0;
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0xc, v);
            EVENTS.push(["advancePhase", o]);
        },
        gymHudConstruct(screen, hud) { EVENTS.push(["hud", screen, hud]); },
        setPhase(o, phase) {
            rt.mem.write32(o + 0xc, phase >>> 0);
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            EVENTS.push(["setPhase", o, phase >>> 0]);
        },
    };
}

function runCase(label, o) {
    seed(o);
    rt.cpu.call(0x80085bb0, [SCREEN, HUD]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = snapshot();

    seed(o);
    gymScreenTick(rt.mem, SCREEN, HUD, portHost());
    const portEvents = norm(EVENTS.slice());
    const portFields = snapshot();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("gymScreenTick matches F0x80085BB0", () => {
    runCase("state 0 sub 0 opens", { state: 0, sub: 0 });
    runCase("state 0 sub 5 late", { state: 0, sub: 5 });
    runCase("state 0 sub 1 waiting", { state: 0, sub: 1, pending: 1 });
    runCase("state 0 sub 1 ready", { state: 0, sub: 1, podCount: 1, roster: [0, 1, -1] });
    runCase("state 0 sub 1 all empty", { state: 0, sub: 1, roster: [-1, -1, -1] });
    runCase("state 4 default band", { state: 4, sub: 0 });
    runCase("state 0x30 default band", { state: 0x30, sub: 1, pending: 0 });
    runCase("state 1 live", { state: 1, sub: 0 });
    runCase("state 2 audio waiting", { state: 2, audioPending: 1 });
    runCase("state 2 audio ready", { state: 2, audioPending: 0 });
    runCase("state 3 exit", { state: 3, selector: 0xc00 });
    runCase("state 3 japanese", { state: 3, selector: 0xe01, lang: 0 });
});
