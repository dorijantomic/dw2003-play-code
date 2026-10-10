// Phase 4 oracle: engine/dw3/ui/shock-test.ts must match pro/shocktst
// F0x80084714. The original runs through engine/native with the allocator, the
// BIOS file services, the text compiler, the pad service and the widget/state
// method slots stubbed to record the exact ordered calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shockTestTick } from "../engine/dw3/ui/shock-test.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_shocktst.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const ARG1 = 0x80190000;
const WIDGET = 0x801a0000;
const BUF_B = 0x801b0000;
const BUF_A = 0x801c0000;
const FILE_HANDLE = 0x2a;
const TEXT_ID = 0x4321;
const WIDGET_STRING = 0x0fe80000;
const ADVANCE = 0x0fe80010;
const SET_STATE3 = 0x0fe80020;
const MALLOC = 0x0fe80030;
const FOPEN = 0x0fe80040;
const FREAD = 0x0fe80050;
const FCLOSE = 0x0fe80060;
const COMPILE = 0x0fe80070;
const TO_BIN = 0x0fe80080;
const BIND = 0x0fe80090;
const PAD_PRESSED = 0x0fe800a0;
const PAD_SHIFT = 0x0fe800b0;
const FREE = 0x0fe800c0;
const TRANSITION = 0x0fe800d0;

const MALLOC_PTR = 0x8004b5dc + 0x20;
const PAD_PRESSED_PTR = 0x8004b7d0 + 0x3f4;
const PAD_SHIFT_PTR = 0x8004b7d0 + 0x408;
const FREE_PTR = 0x8004b5ec;
const TRANSITION_PTR = 0x8004b440;

let EVENTS = [];
let MALLOC_MODE = "ok";
let OPEN_MODE = "ok";
let PAD_WORD = 0;
let PAD_LOGICAL_SHIFT = 3;
let MALLOC_CALLS = 0;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x80084af0, 0x8008abcd);

    rt.cpu.setStub(0x8001ae38, (c) => {
        EVENTS.push(["createWidget", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        rt.mem.write32(WIDGET + 0x110, WIDGET_STRING);
        return WIDGET;
    });
    rt.cpu.setStub(WIDGET_STRING, (c) => { EVENTS.push(["widgetSetString", c.reg(4), c.reg(5)]); return 0; });

    rt.cpu.setStub(MALLOC, (c) => {
        EVENTS.push(["malloc", c.reg(4), c.reg(5)]);
        MALLOC_CALLS += 1;
        if (MALLOC_MODE === "failFirst" && MALLOC_CALLS === 1) return 0;
        if (MALLOC_MODE === "failSecond" && MALLOC_CALLS === 2) return 0;
        return MALLOC_CALLS === 1 ? BUF_B : BUF_A;
    });
    rt.mem.write32(MALLOC_PTR, MALLOC);

    rt.cpu.setStub(0x800250ac, (c) => {
        EVENTS.push(["fileOpen", c.reg(4), c.reg(5)]);
        return OPEN_MODE === "ok" ? FILE_HANDLE : -1;
    });
    rt.cpu.setStub(0x800250bc, (c) => { EVENTS.push(["fileRead", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(0x800250dc, (c) => { EVENTS.push(["fileClose", c.reg(4)]); return 0; });
    rt.cpu.setStub(0x800843f0, (c) => { EVENTS.push(["compileText", c.reg(4)]); return 0; });
    rt.cpu.setStub(0x8008436c, (c) => { EVENTS.push(["textToBin", c.reg(4)]); return TEXT_ID; });
    rt.cpu.setStub(0x800842e0, (c) => { EVENTS.push(["bindBin", c.reg(4), c.reg(5)]); return 0; });

    rt.cpu.setStub(PAD_PRESSED, (c) => { EVENTS.push(["padPressed", c.reg(4)]); return PAD_WORD; });
    rt.cpu.setStub(PAD_SHIFT, (c) => { EVENTS.push(["padShift", c.reg(4), c.reg(5)]); return PAD_LOGICAL_SHIFT; });
    rt.mem.write32(PAD_PRESSED_PTR, PAD_PRESSED);
    rt.mem.write32(PAD_SHIFT_PTR, PAD_SHIFT);

    rt.cpu.setStub(FREE, (c) => { EVENTS.push(["free", c.reg(4)]); return 0; });
    rt.mem.write32(FREE_PTR, FREE);
    rt.cpu.setStub(TRANSITION, (c) => { EVENTS.push(["transition", c.reg(4), c.reg(5)]); return 0; });
    rt.mem.write32(TRANSITION_PTR, TRANSITION);
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    MALLOC_MODE = o.malloc ?? "ok";
    OPEN_MODE = o.open ?? "ok";
    PAD_WORD = o.pad ?? 0;
    PAD_LOGICAL_SHIFT = o.shift ?? 3;
    MALLOC_CALLS = 0;
    rt.mem.write32(OBJ + 0x0c, o.state ?? 0);
    rt.mem.write32(OBJ + 0x38, ADVANCE);
    rt.mem.write32(OBJ + 0x28, SET_STATE3);
    rt.mem.write32(OBJ + 0x50, o.bufferA ?? 0);
    rt.mem.write32(OBJ + 0x54, o.bufferB ?? 0);
    rt.cpu.setStub(ADVANCE, (c) => { EVENTS.push(["advance", c.reg(4)]); return 0; });
    rt.cpu.setStub(SET_STATE3, (c) => { EVENTS.push(["setState3", c.reg(4), c.reg(5)]); return 0; });
    for (let i = 0; i < 0x10; i += 4) rt.mem.write32(ARG1 + i, 0);
    rt.mem.write32(BUF_A, o.textWord ?? 0x0badf00d);
    rt.mem.write32(BUF_B, 0);
}

function fields() {
    return [0x0c, 0x50, 0x54].map((off) => rt.mem.read32(OBJ + off) >>> 0)
        .concat([rt.mem.read32(ARG1 + 0x0c) >>> 0]);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        advance(obj) { EVENTS.push(["advance", obj >>> 0]); },
        createWidget(kind, a1, x, y) { EVENTS.push(["createWidget", kind >>> 0, a1 >>> 0, x >>> 0, y >>> 0]); return WIDGET; },
        widgetSetString(w, id) { EVENTS.push(["widgetSetString", w >>> 0, id >>> 0]); },
        malloc(size, tag) {
            EVENTS.push(["malloc", size >>> 0, tag >>> 0]);
            MALLOC_CALLS += 1;
            if (MALLOC_MODE === "failFirst" && MALLOC_CALLS === 1) return 0;
            if (MALLOC_MODE === "failSecond" && MALLOC_CALLS === 2) return 0;
            return MALLOC_CALLS === 1 ? BUF_B : BUF_A;
        },
        fileOpen(namePtr, mode) { EVENTS.push(["fileOpen", namePtr >>> 0, mode >>> 0]); return OPEN_MODE === "ok" ? FILE_HANDLE : -1; },
        fileRead(h, dest, size) { EVENTS.push(["fileRead", h >>> 0, dest >>> 0, size >>> 0]); },
        fileClose(h) { EVENTS.push(["fileClose", h >>> 0]); },
        compileText(obj) { EVENTS.push(["compileText", obj >>> 0]); },
        textToBin(value) { EVENTS.push(["textToBin", value >>> 0]); return TEXT_ID; },
        bindBin(id, ptr) { EVENTS.push(["bindBin", id >>> 0, ptr >>> 0]); },
        padPressed(port) { EVENTS.push(["padPressed", port >>> 0]); return PAD_WORD; },
        padShift(port, logical) { EVENTS.push(["padShift", port >>> 0, logical >>> 0]); return PAD_LOGICAL_SHIFT; },
        setState3(obj) { EVENTS.push(["setState3", obj >>> 0, 3]); },
        free(ptr) { EVENTS.push(["free", ptr >>> 0]); },
        requestTransition(s, a) { EVENTS.push(["transition", s >>> 0, a >>> 0]); },
    };
}

function runTick(label, o) {
    seed(o);
    rt.cpu.call(0x80084714, [OBJ, ARG1]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = fields();

    seed(o);
    shockTestTick(rt.mem, OBJ, ARG1, portHost());
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
    assert.deepEqual(fields(), oracleFields, `${label}: fields`);
}

test("shockTestTick matches F0x80084714", () => {
    runTick("state 0 full build", {});
    runTick("state 4 rebuilds", { state: 4 });
    runTick("state 0 second buffer null", { malloc: "failSecond" });
    runTick("state 0 first buffer null", { malloc: "failFirst" });
    runTick("state 0 open fails", { open: "fail" });
    runTick("state 2 idles", { state: 2 });
    runTick("state 1 no gate", { state: 1 });
    runTick("state 1 gate fires", { state: 1, pad: 1 << 3 });
    runTick("state 1 different logical bit", { state: 1, pad: 1 << 5 });
    runTick("state 3 frees and transitions", { state: 3, bufferA: BUF_A, bufferB: BUF_B });
    runTick("state 3 null buffers", { state: 3 });
});
