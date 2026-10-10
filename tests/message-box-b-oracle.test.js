// Phase 4 oracle: engine/dw3/ui/message-box-b.ts must match pro/cardgame
// F0x80098558 (messageBoxTickB). The original runs through engine/native on the
// shipped pro_cardgame.bin + resident.bin with the frame delta, the bank getter,
// the plate/text widget methods, the close prompt and the tail draw recorded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { messageBoxTickB } from "../engine/dw3/ui/message-box-b.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const VIEW = 0x80180000;
const BANK = 0x80181000;
const PLATE = 0x80182000;
const TEXTW = 0x80183000;
const DELTA_STUB = 0x0fe20000;
const BANK_STUB = 0x0fe70000;
const TAIL_STUB = 0x0fe90000;
const CLOSE_STUB = 0x0fea0000;
const PLATE_STUBS = [[0x80, 0x0fe90100], [0x84, 0x0fe90200], [0x8c, 0x0fe90300]];
const TEXT_STUBS = [[0x114, 0x0fe90400], [0x134, 0x0fe90500], [0x144, 0x0fe90600]];
const LANGUAGE = 0x8005cca8;

let EVENTS = [];
let DELTA = 1;
let BANK_RET = 0x1234;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(DELTA_STUB, () => { EVENTS.push(["delta", 0]); return DELTA; });
    rt.mem.write32(0x8004df9c, DELTA_STUB);
    rt.cpu.setStub(BANK_STUB, (c) => { EVENTS.push(["bank", c.reg(4) >>> 0]); return BANK_RET; });
    rt.mem.write32(0x80044f4c, BANK_STUB);
    rt.cpu.setStub(TAIL_STUB, (c) => {
        EVENTS.push(["tail", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0, c.reg(7) >>> 0,
            rt.mem.read32(rt.cpu.reg(29) + 0x10) >>> 0]);
    });
    rt.cpu.setStub(CLOSE_STUB, (c) => { EVENTS.push(["close", c.reg(4) >>> 0]); return 0; });
    for (const [method, stub] of [...PLATE_STUBS, ...TEXT_STUBS]) {
        rt.cpu.setStub(stub, (c) => {
            EVENTS.push(["w", method >>> 0, c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
            return 0;
        });
    }
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    DELTA = o.delta ?? 1;
    BANK_RET = o.bank ?? 0x1234;
    for (let i = 0; i <= 0x100; i += 4) rt.mem.write32(VIEW + i, 0);
    for (let i = 0; i <= 0x40; i += 4) rt.mem.write32(BANK + i, 0);
    rt.mem.write32(BANK + 0x00, PLATE);
    rt.mem.write32(BANK + 0x30, TEXTW);
    rt.mem.write32(VIEW + 0xef8, CLOSE_STUB);
    rt.cpu.setStub(0x8009848c, (c) => {
        EVENTS.push(["tail", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0, c.reg(7) >>> 0,
            rt.mem.read32(rt.cpu.reg(29) + 0x10) >>> 0]);
    });
    for (const w of [PLATE, TEXTW]) {
        for (let j = 0; j <= 0x150; j += 4) rt.mem.write32(w + j, 0);
    }
    for (const [method, stub] of PLATE_STUBS) rt.mem.write32(PLATE + method, stub);
    for (const [method, stub] of TEXT_STUBS) rt.mem.write32(TEXTW + method, stub);
    rt.mem.write16(VIEW + 0xe00, (o.timer ?? 0) & 0xffff);
    rt.mem.write16(VIEW + 0xe02, (o.duration ?? 0) & 0xffff);
    rt.mem.write16(VIEW + 0xe04, (o.layout ?? 0) & 0xffff);
    rt.mem.write16(VIEW + 0xe0a, (o.state ?? 0) & 0xffff);
    rt.mem.write32(LANGUAGE, o.lang ?? 0);
}

function fields() {
    return [rt.mem.read16(VIEW + 0xe00), rt.mem.read16(VIEW + 0xe02), rt.mem.read16(VIEW + 0xe0a)];
}
function events() { return EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v))); }

function portHost() {
    return {
        frameDelta() { EVENTS.push(["delta", 0]); return DELTA; },
        bankGet(h) { EVENTS.push(["bank", h >>> 0]); return BANK_RET; },
        callWidgetMethod(obj, method, a1, a2) {
            EVENTS.push(["w", method >>> 0, obj >>> 0, a1 | 0, a2 | 0]);
            return 0;
        },
        drawMessagePlate(view, bank, scale, arg3, arg4) {
            EVENTS.push(["tail", view >>> 0, bank >>> 0, scale | 0, arg3 >>> 0, arg4 >>> 0]);
        },
        callViewCloseFunction(fn, view) { EVENTS.push(["close", view >>> 0]); },
    };
}

function compare(label, o) {
    seed(o);
    rt.cpu.call(0x80098558, [VIEW, BANK]);
    const oEvents = events();
    const oFields = fields();

    seed(o);
    messageBoxTickB(rt.mem, VIEW, BANK, portHost());
    assert.deepEqual(events(), oEvents, `${label}: calls`);
    assert.deepEqual(fields(), oFields, `${label}: fields`);
}

test("messageBoxTickB matches F0x80098558", () => {
    compare("state 0", { state: 0 });
    compare("state 1 ramp", { state: 1, timer: 5, duration: 10, layout: 0 });
    compare("state 1 lands", { state: 1, timer: 1, duration: 10, layout: 0, lang: 2 });
    compare("state 2 hold", { state: 2, layout: 0, timer: 5, duration: 10 });
    compare("state 2 layout 3", { state: 2, layout: 3 });
    compare("state 3 default", { state: 3, timer: 4, duration: 10 });
    compare("state 4 slide", { state: 4, timer: 5, duration: 10, layout: 1 });
    compare("state 4 lands", { state: 4, timer: 1, duration: 10, layout: 0 });
    compare("state 5 hides", { state: 5, timer: 5, duration: 10 });
    compare("state 5 lands", { state: 5, timer: 1, duration: 10, timerEnd: true });
    compare("state above 5", { state: 7, timer: 4, duration: 8 });
});
