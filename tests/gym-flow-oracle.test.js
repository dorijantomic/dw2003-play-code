// Phase 4 oracle: engine/dw3/ui/gym-flow.ts gymFlowTick (F0x8008517C) must make
// the same ordered calls and land on the same screen fields as the original.
// The original runs through engine/native with the child-screen factories, the
// pad cells, the gate/sound hooks and every widget method stubbed; the fold
// steppers are the real ones on the interpreter side and the translated pair on
// the port side.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { gymFlowTick } from "../engine/dw3/ui/gym-flow.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stgtrain = new Uint8Array(readFileSync(join(dir, "pro_stgtrain.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stgtrain.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SCREEN = 0x80180000;
const HUD = 0x80181000;
const PROJ = 0x80187000;
const PROJ_A = 0x80187080;
const HANDLE = 0x80190000;
const SOURCE = 0x80190100;
const PICKER = 0x80192000;
const CONFIRM = 0x80192100;
const SESSION = 0x80192200;
const PANEL = 0x80192300;
const WIDGET_BASE = 0x80182000;
const FOLDS = [0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0, 0x100];
const STUBS = {
    roster: 0x0fdc0000, handle: 0x0fdc0010, copy: 0x0fdc0020, resolve: 0x0fdc0030,
    drill: 0x0fdc0040, confirm: 0x0fdc0050, session: 0x0fdc0060, panel: 0x0fdc0070,
    preload: 0x0fdc0080, offer: 0x0fdc0090, sound: 0x0fdc00a0,
    padPressed: 0x0fdc00b0, padRepeat: 0x0fdc00c0, padMask: 0x0fdc00d0,
    closeConfirm: 0x0fdc00e0, panelRun: 0x0fdc00f0,
};
const WIDGET_METHODS = {
    0x800194e8: "setLine0", 0x800195b0: "setNumber", 0x8001a1f4: "setC0",
    0x8001a23c: "flag", 0x8001a25c: "measure",
};
const ARITY = {
    roster: 1, handle: 1, copy: 1, resolve: 1, drill: 1, confirm: 1, session: 3, panel: 1,
    preload: 1, offer: 0, sound: 1, padPressed: 0, padRepeat: 0, padMask: 1,
    closeConfirm: 1, panelRun: 3,
    setLine0: 3, setNumber: 3, setC0: 2, flag: 2, measure: 2,
};

// A distinct 0x2C-byte projection with every field the HUD fills read.
const PROJECTION = new Uint8Array(0x2c);
PROJECTION[0x00] = 0x07; PROJECTION[0x02] = 0xc8;
PROJECTION[0x04] = 0x64; PROJECTION[0x06] = 0xc8;
PROJECTION[0x08] = 0x19; PROJECTION[0x0a] = 0x32;
for (let i = 0; i < 6; i++) PROJECTION[0x0c + 2 * i] = 10 + i;
for (let j = 0; j < 7; j++) PROJECTION[0x18 + 2 * j] = 20 + j;
PROJECTION[0x26] = 1; PROJECTION[0x2a] = 1;

let EVENTS = [];
let PAD_PRESSED = 0;
let PAD_REPEAT = 0;

function widgetAddr(k) {
    return (WIDGET_BASE + k * 0x200) >>> 0;
}

function runtime() {
    const rt = new NativeStageRuntime(stgtrain, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8005cca8, 0x40);
    // Real fold steppers in their overlay cells.
    rt.mem.write32(0x8008d2b0, 0x8008b8fc);
    rt.mem.write32(0x8008d2b4, 0x8008b990);
    rt.cpu.setStub(STUBS.roster, (c) => { EVENTS.push(["roster", c.reg(4)]); return 0; });
    rt.mem.write32(0x8004b44c, STUBS.roster);
    rt.cpu.setStub(STUBS.handle, (c) => { EVENTS.push(["handle", c.reg(4)]); return HANDLE; });
    rt.mem.write32(0x8004b484, STUBS.handle);
    rt.cpu.setStub(STUBS.copy, (c) => {
        EVENTS.push(["copy", c.reg(4)]);
        const dest = c.reg(5) >>> 0;
        for (let i = 0; i < PROJECTION.length; i++) rt.mem.write8(dest + i, PROJECTION[i]);
        return 0;
    });
    rt.mem.write32(0x8004b468, STUBS.copy);
    rt.cpu.setStub(STUBS.resolve, (c) => { EVENTS.push(["resolve", c.reg(4)]); return SOURCE; });
    rt.mem.write32(0x80044f4c, STUBS.resolve);
    rt.cpu.setStub(0x8008b838, (c) => { EVENTS.push(["drill", c.reg(4)]); return PICKER; });
    rt.cpu.setStub(0x80089764, (c) => { EVENTS.push(["confirm", c.reg(4)]); return CONFIRM; });
    rt.cpu.setStub(0x80088070, (c) => {
        EVENTS.push(["session", c.reg(4), c.reg(5), c.reg(6)]);
        return SESSION;
    });
    rt.cpu.setStub(0x80086174, (c) => { EVENTS.push(["panel", c.reg(4)]); return PANEL; });
    rt.cpu.setStub(0x8008baa8, (c) => { EVENTS.push(["preload", c.reg(4)]); return 0; });
    rt.cpu.setStub(0x8008bb38, () => { EVENTS.push(["offer"]); return 1; });
    rt.cpu.setStub(0x8002006c, (c) => { const id = c.reg(4) | 0; if (id !== 0x40019 && id !== 0x4001a) EVENTS.push(["sound", id]); return 0; });
    rt.cpu.setStub(STUBS.padPressed, () => { EVENTS.push(["padPressed"]); return PAD_PRESSED; });
    rt.mem.write32(0x8004b7d0 + 0x3f4, STUBS.padPressed);
    rt.cpu.setStub(STUBS.padRepeat, () => { EVENTS.push(["padRepeat"]); return PAD_REPEAT; });
    rt.mem.write32(0x8004b7d0 + 0x3fc, STUBS.padRepeat);
    rt.cpu.setStub(STUBS.padMask, (c) => { EVENTS.push(["padMask", c.reg(5)]); return c.reg(5) & 0xffff; });
    rt.mem.write32(0x8004b7d0 + 0x408, STUBS.padMask);
    for (const [addr, name] of Object.entries(WIDGET_METHODS)) {
        rt.cpu.setStub(Number(addr), (c) => {
            EVENTS.push([name, c.reg(4), c.reg(5), c.reg(6)]);
            return 0;
        });
    }
    rt.cpu.setStub(STUBS.closeConfirm, (c) => { EVENTS.push(["closeConfirm", c.reg(4)]); return 0; });
    rt.cpu.setStub(STUBS.panelRun, (c) => { EVENTS.push(["panelRun", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    return rt;
}

const rt = runtime();

function armHud() {
    for (let k = 0; k < 28; k++) {
        const w = widgetAddr(k);
        rt.mem.write32(HUD + k * 4, w);
        rt.mem.write32(w + 0x114, 0x800194e8);
        rt.mem.write32(w + 0x118, 0x800195b0);
        rt.mem.write32(w + 0x138, 0x8001a1f4);
        rt.mem.write32(w + 0x144, 0x8001a23c);
        rt.mem.write32(w + 0x148, 0x8001a25c);
    }
    // Child method slots.
    rt.mem.write32(CONFIRM + 0xf8, STUBS.closeConfirm);
    rt.mem.write32(PANEL + 0x64, STUBS.panelRun);
}

function seedFolds(ready) {
    for (const off of FOLDS) {
        const isReady = ready.includes(off);
        rt.mem.write32(SCREEN + off + 0x0, 10);
        rt.mem.write32(SCREEN + off + 0x4, 0);
        rt.mem.write32(SCREEN + off + 0x8, 0);
        rt.mem.write32(SCREEN + off + 0xc, isReady ? 0 : 1);
    }
}

function seedScreen(o) {
    EVENTS = [];
    armHud();
    for (let i = 0; i < 0x114; i += 4) rt.mem.write32(SCREEN + i, 0);
    rt.mem.write32(SCREEN + 0x10, o.state);
    rt.mem.write32(SCREEN + 0x64, o.podCount ?? 3);
    rt.mem.write32(SCREEN + 0x68, o.pod ?? 0);
    rt.mem.write32(SCREEN + 0x78, o.drill ?? 0);
    rt.mem.write32(HUD + 0x70, o.picker ?? 0);
    rt.mem.write32(HUD + 0x74, o.confirm ?? 0);
    rt.mem.write32(HUD + 0x78, o.session ?? 0);
    rt.mem.write32(HUD + 0x7c, o.panel ?? 0);
    if (o.confirmState !== undefined) rt.mem.write32(CONFIRM + 0x10, o.confirmState);
    if (o.confirmMode !== undefined) rt.mem.write32(CONFIRM + 0x0c, o.confirmMode);
    if (o.pickerState !== undefined) rt.mem.write32(PICKER + 0x0c, o.pickerState);
    if (o.sessionState !== undefined) rt.mem.write32(SESSION + 0x0c, o.sessionState);
    if (o.panelState !== undefined) rt.mem.write32(PANEL + 0x0c, o.panelState);
    seedFolds(o.ready ?? []);
    PAD_PRESSED = o.pressed ?? 0;
    PAD_REPEAT = o.repeat ?? 0;
}

function snapshot() {
    const out = [];
    for (let i = 0; i < 0x114; i += 4) out.push(rt.mem.read32(SCREEN + i) >>> 0);
    for (const off of [0x70, 0x74, 0x78, 0x7c]) out.push(rt.mem.read32(HUD + off) >>> 0);
    if (rt.mem.read32(HUD + 0x74) !== 0) out.push(rt.mem.read32(CONFIRM + 0xc) >>> 0);
    if (rt.mem.read32(HUD + 0x70) !== 0) out.push(rt.mem.read32(PICKER + 0xc) >>> 0);
    if (rt.mem.read32(HUD + 0x78) !== 0) out.push(rt.mem.read32(SESSION + 0xc) >>> 0);
    if (rt.mem.read32(HUD + 0x7c) !== 0) out.push(rt.mem.read32(PANEL + 0xc) >>> 0);
    return out;
}

function norm(evs) {
    return evs.map(([name, ...args]) => [name, ...args.slice(0, ARITY[name] ?? 4).map((v) => v >>> 0)]);
}

function runCase(label, o) {
    seedScreen(o);
    rt.cpu.call(0x8008517c, [SCREEN, HUD]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = snapshot();

    seedScreen(o);
    const portHost = {
        rosterSlot(position) { EVENTS.push(["roster", position | 0]); return 0; },
        rosterHandle(slot) { EVENTS.push(["handle", slot | 0]); return HANDLE; },
        copyProjection(slot, dest) {
            EVENTS.push(["copy", slot | 0]);
            for (let i = 0; i < PROJECTION.length; i++) rt.mem.write8(dest + i, PROJECTION[i]);
        },
        resolveText(offset) { EVENTS.push(["resolve", (rt.mem.read32(0x8005cca8) + offset) >>> 0]); return SOURCE; },
        createTextElement() { return 0; },
        widgetSetLine0(widget, source, index) { EVENTS.push(["setLine0", widget, source, index]); },
        widgetSetLineNumber(widget, line, value) { EVENTS.push(["setNumber", widget, line, value]); },
        widgetSetC0(widget, code) { EVENTS.push(["setC0", widget, code]); },
        widgetSetFlagC1(widget, value) { EVENTS.push(["flag", widget, value]); },
        widgetMeasure(widget, value) { EVENTS.push(["measure", widget, value]); },
        padPressed() { EVENTS.push(["padPressed"]); return PAD_PRESSED; },
        padRepeat() { EVENTS.push(["padRepeat"]); return PAD_REPEAT; },
        padBit(logical) { EVENTS.push(["padMask", logical]); return logical; },
        playSound(id) { EVENTS.push(["sound", id]); },
        drillPicker(screen) { EVENTS.push(["drill", screen]); return PICKER; },
        confirmScreen(screen) { EVENTS.push(["confirm", screen]); return CONFIRM; },
        trainingSession(screen, slot, drill) { EVENTS.push(["session", screen, slot, drill]); return SESSION; },
        panel(screen) { EVENTS.push(["panel", screen]); return PANEL; },
        closeConfirm(child) { EVENTS.push(["closeConfirm", child]); },
        panelRun(child, a1, a2) { EVENTS.push(["panelRun", child, a1, a2]); },
        preloadGym(index) { EVENTS.push(["preload", index]); },
        trainingOfferReady() { EVENTS.push(["offer"]); return 1; },
    };
    gymFlowTick(rt.mem, SCREEN, HUD, portHost, PROJ_A);
    const portEvents = norm(EVENTS.slice());
    const portFields = snapshot();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("gymFlowTick matches F0x8008517C", () => {
    runCase("default state 0", { state: 0 });
    runCase("unknown state 0x30", { state: 0x30 });
    runCase("state 1 opens", { state: 1, ready: [0xa0] });
    runCase("state 1 waits", { state: 1 });
    runCase("state 2 opens", { state: 2, ready: [0xb0] });
    runCase("state 3 opens", { state: 3, ready: [0xc0] });
    runCase("state 4 settles", { state: 4, ready: [0xf0] });
    runCase("state 5 left move", { state: 5, pod: 2, pressed: 1 << 7 });
    runCase("state 5 left clamp", { state: 5, pod: 0, pressed: 1 << 7 });
    runCase("state 5 right clamp", { state: 5, pod: 2, podCount: 3, pressed: 1 << 5 });
    runCase("state 5 repeat left", { state: 5, pod: 1, repeat: 1 << 7 });
    runCase("state 5 both directions", { state: 5, pod: 1, pressed: (1 << 7) | (1 << 5) });
    runCase("state 5 circle", { state: 5, pod: 1, pressed: 1 << 0xd, picker: PICKER });
    runCase("state 5 move beats circle", { state: 5, pod: 1, pressed: (1 << 7) | (1 << 0xd) });
    runCase("state 5 cross", { state: 5, pod: 1, pressed: 1 << 0xe });
    runCase("state A construct", { state: 0xa });
    runCase("state A exists", { state: 0xa, picker: PICKER });
    runCase("state B confirm", { state: 0xb, picker: PICKER, pickerState: 2, drill: 5 });
    runCase("state B wait", { state: 0xb, picker: PICKER, pickerState: 1 });
    runCase("state B gone", { state: 0xb });
    runCase("state 14 close", { state: 0x14 });
    runCase("state 15 done", { state: 0x15, ready: [0xd0] });
    runCase("state 19 open", { state: 0x19 });
    runCase("state 1A", { state: 0x1a, ready: [0xd0] });
    runCase("state 1B", { state: 0x1b, ready: [0xe0] });
    runCase("state 1C", { state: 0x1c, ready: [0x100] });
    runCase("state 1E construct", { state: 0x1e, drill: 7 });
    runCase("state 1F session live", { state: 0x1f, confirm: CONFIRM, confirmState: 0x23, session: SESSION });
    runCase("state 1F no session", { state: 0x1f, confirm: CONFIRM, confirmState: 0x23 });
    runCase("state 1F confirm close", { state: 0x1f, confirm: CONFIRM, confirmState: 1, confirmMode: 2 });
    runCase("state 23 session", { state: 0x23, pod: 1, drill: 9 });
    runCase("state 23 exists", { state: 0x23, session: SESSION });
    runCase("state 24 close", { state: 0x24, confirm: CONFIRM });
    runCase("state 25 refill", { state: 0x25 });
    runCase("state 32 teardown", { state: 0x32 });
    runCase("state 33 all folded", { state: 0x33, ready: [0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0x100] });
    runCase("state 34 exit", { state: 0x34, panel: PANEL, panelState: 2 });
});
