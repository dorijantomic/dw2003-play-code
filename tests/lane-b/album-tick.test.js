// Lane B Phase 4 oracle: engine/dw3/ui/native/album-tick.ts must match the
// original pro/stcrdabm F0x80084C38 album tick.
//
// The original runs through engine/native (the interpreter) as the oracle. Every
// boundary the tick calls is a stub on both sides, pushing into one ordered
// CALLS log: the fold pair [0x8008B838]/[0x8008B83C], the page mask
// (0x80084BC8), the grid object (0x80083A78), the headings (0x80083E14), the
// cell paint (0x800840AC), the popup (0x80083008), the pad service
// [+0x3F4/+0x3F8/+0x3FC/+0x408], the SFX cell, the resource services, the base
// methods +0x28/+0x3C and the widget methods.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { albumScreenTick } from "../../engine/dw3/ui/native/album-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const album = new Uint8Array(readFileSync(join(dir, "pro_stcrdabm.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: album.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x801a0000;
const OBJ_B = 0x801a0400;
const CTX_A = 0x801a1000;
const CTX_B = 0x801a1200;
const GRID = 0x801b0000;
const POPUP = 0x801b0200;
const W_GRID = 0x801b0400;
const W_CARD = 0x801b1000;

const FOLD_START = 0x0fd90000;
const FOLD_TICK = 0x0fd90004;
const PAD_PRESSED = 0x0fd90008;
const PAD_HELD = 0x0fd9000c;
const PAD_REPEAT = 0x0fd90010;
const PAD_KEY = 0x0fd90014;
const SND = 0x0fd90018;
const RES_GET = 0x0fd9001c;
const RES_LINE = 0x0fd90020;
const M28 = 0x0fd90024;
const M3C = 0x0fd90028;
const W114 = 0x0fd90040;
const W118 = 0x0fd90044;
const W144 = 0x0fd90048;
const W148 = 0x0fd9004c;
const W84 = 0x0fd90050;
const W64 = 0x0fd90054;

let FOLD_DONE = 1;
let PAD_PRESSED_VAL = 0;
let PAD_HELD_VAL = 0;
let PAD_REPEAT_VAL = 0;
const KEYMAP = { 4: 4, 6: 6, 5: 5, 7: 7, 0xa: 0xa, 0xb: 0xb, 0xe: 0xe };
let GRID_STATE = 0;

const CALLS = [];

function runtime() {
    const rt = new NativeStageRuntime(album, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    const relA = (a) => { const v = a >>> 0; return v >= OBJ_A && v < OBJ_A + 0x400 ? v - OBJ_A : v; };
    const relCtx = (a, base) => { const v = a >>> 0; return v >= base && v < base + 0x400 ? v - base : v; };
    rt.cpu.setStub(FOLD_START, (c) => { CALLS.push(["foldStart", relA(c.reg(4)), c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(FOLD_TICK, (c) => { CALLS.push(["foldTick", relA(c.reg(4))]); return FOLD_DONE; });
    rt.cpu.setStub(0x80084bc8, (c) => { CALLS.push(["mask", relA(c.reg(4))]); return 0; });
    rt.cpu.setStub(0x80083a78, (c) => { CALLS.push(["grid", relA(c.reg(4))]); return GRID; });
    rt.cpu.setStub(0x80083e14, (c) => { CALLS.push(["headings", relA(c.reg(4)), relCtx(c.reg(5), CTX_A), c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(0x800840ac, (c) => { CALLS.push(["cellPaint", relA(c.reg(4)), relCtx(c.reg(5), CTX_A), c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(0x80083008, () => { CALLS.push(["popup"]); return POPUP; });
    rt.cpu.setStub(M28, (c) => { CALLS.push(["m28", relA(c.reg(4)), c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(M3C, (c) => { CALLS.push(["m3c", relA(c.reg(4))]); return 0; });
    rt.cpu.setStub(PAD_PRESSED, (c) => { CALLS.push(["pressed", c.reg(4) | 0]); return PAD_PRESSED_VAL; });
    rt.cpu.setStub(PAD_HELD, (c) => { CALLS.push(["held", c.reg(4) | 0]); return PAD_HELD_VAL; });
    rt.cpu.setStub(PAD_REPEAT, (c) => { CALLS.push(["repeat", c.reg(4) | 0]); return PAD_REPEAT_VAL; });
    rt.cpu.setStub(PAD_KEY, (c) => { CALLS.push(["key", c.reg(4) | 0, c.reg(5) | 0]); return KEYMAP[c.reg(5)] ?? 0; });
    rt.cpu.setStub(SND, (c) => { CALLS.push(["snd", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(RES_GET, (c) => { CALLS.push(["res", c.reg(4) | 0]); return 0x9000; });
    rt.cpu.setStub(RES_LINE, (c) => { CALLS.push(["line", c.reg(4) | 0]); return 0x9100; });
    rt.cpu.setStub(W114, (c) => { CALLS.push(["w114", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(W118, (c) => { CALLS.push(["w118", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(W144, (c) => { CALLS.push(["w144", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(W148, (c) => { CALLS.push(["w148", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(W84, (c) => { CALLS.push(["w84", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(W64, (c) => { CALLS.push(["w64", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.mem.write32(0x80085a6c, FOLD_START);
    rt.mem.write32(0x80085a70, FOLD_TICK);
    rt.mem.write32(0x8004bbc4, PAD_PRESSED);
    rt.mem.write32(0x8004bbc8, PAD_HELD);
    rt.mem.write32(0x8004bbcc, PAD_REPEAT);
    rt.mem.write32(0x8004b7d0 + 0x3f4, PAD_PRESSED);
    rt.mem.write32(0x8004b7d0 + 0x3f8, PAD_HELD);
    rt.mem.write32(0x8004b7d0 + 0x3fc, PAD_REPEAT);
    rt.mem.write32(0x8004b7d0 + 0x408, PAD_KEY);
    rt.mem.write32(0x80055c48, SND);
    rt.mem.write32(0x80044f4c, RES_GET);
    rt.mem.write32(0x80044f44, RES_LINE);
    return rt;
}

function relB(a) { const v = a >>> 0; return v >= OBJ_B && v < OBJ_B + 0x400 ? v - OBJ_B : v; }
function relCtxB(a) { const v = a >>> 0; return v >= CTX_B && v < CTX_B + 0x400 ? v - CTX_B : v; }

function portHost() {
    return {
        baseMethod28(obj, value) { CALLS.push(["m28", relB(obj), value | 0]); },
        baseMethod3C(obj) { CALLS.push(["m3c", relB(obj)]); },
        pageMask(obj) { CALLS.push(["mask", relB(obj)]); },
        gridObject(obj) { CALLS.push(["grid", relB(obj)]); return GRID; },
        fillHeadings(obj, ctx, show) { CALLS.push(["headings", relB(obj), relCtxB(ctx), show | 0]); },
        cellPaint(obj, ctx, show) { CALLS.push(["cellPaint", relB(obj), relCtxB(ctx), show | 0]); },
        makePopup() { CALLS.push(["popup"]); return POPUP; },
        resourceGet(id) { CALLS.push(["res", id | 0]); return 0x9000; },
        resourceLine(id) { CALLS.push(["line", id | 0]); return 0x9100; },
        padPressed(port) { CALLS.push(["pressed", port | 0]); return PAD_PRESSED_VAL; },
        padHeld(port) { CALLS.push(["held", port | 0]); return PAD_HELD_VAL; },
        padRepeat(port) { CALLS.push(["repeat", port | 0]); return PAD_REPEAT_VAL; },
        padKey(port, code) { CALLS.push(["key", port | 0, code | 0]); return KEYMAP[code] ?? 0; },
        playSound(id) { CALLS.push(["snd", id | 0]); },
        foldStart(sub, direction) { CALLS.push(["foldStart", relB(sub), direction | 0]); },
        foldTick(sub) { CALLS.push(["foldTick", relB(sub)]); return FOLD_DONE; },
        widget114(w, s, i) { CALLS.push(["w114", w | 0, s | 0, i | 0]); },
        widget118(w, l, v) { CALLS.push(["w118", w | 0, l | 0, v | 0]); },
        widget144(w, v) { CALLS.push(["w144", w | 0, v | 0]); },
        widget148(w, v) { CALLS.push(["w148", w | 0, v | 0]); },
        widget84(w, x, y) { CALLS.push(["w84", w | 0, x | 0, y | 0]); },
        widget64(w, a, b) { CALLS.push(["w64", w | 0, a | 0, b | 0]); },
    };
}

const SLOTS = [0x1c, 0x20, 0x24, 0x28, 0x2c, 0x30, 0x34, 0x38, 0x3c, 0x40];

function initPair(rt, f) {
    const clear = (base, n) => { for (let i = 0; i < n; i += 4) rt.mem.write32(base + i, 0); };
    clear(OBJ_A, 0x140); clear(OBJ_B, 0x140);
    clear(CTX_A, 0x80); clear(CTX_B, 0x80);
    for (const [obj, ctx] of [[OBJ_A, CTX_A], [OBJ_B, CTX_B]]) {
        rt.mem.write32(obj + 0x28, M28);
        rt.mem.write32(obj + 0x3c, M3C);
        rt.mem.write32(obj + 0x0c, f.mode ?? 3);
        rt.mem.write32(obj + 0x10, f.state ?? 0);
        rt.mem.write32(obj + 0x14, f.flag14 ?? 0);
        rt.mem.write32(obj + 0x60, f.page ?? 0);
        rt.mem.write32(obj + 0x64, f.pageCount ?? 3);
        rt.mem.write32(obj + 0x68, f.flag68 ?? 0);
        rt.mem.write32(obj + 0x74, f.cell ?? 0);
        rt.mem.write32(obj + 0x78, f.card ?? 0);
        rt.mem.write32(obj + 0x7c, f.anyFlag ?? 0);
        rt.mem.write32(obj + 0xd0, f.d0 ?? 0);
        for (let i = 0; i < 0xc; i++) rt.mem.write32(obj + 0x80 + i * 4, (f.slots && f.slots[i]) || 0);
        rt.mem.write32(ctx + 0x0, f.ctx0 ?? 0);
        rt.mem.write32(ctx + 0x44, f.grid ?? 0);
        rt.mem.write32(ctx + 0x48, f.popup ?? 0);
    }
    rt.mem.write32(GRID + 0x0c, GRID_STATE);
    rt.mem.write32(GRID + 0x84, W84);
    rt.mem.write32(GRID + 0x80, W84);
    for (const off of SLOTS) rt.mem.write32(W_CARD + off, W_CARD);
    rt.mem.write32(POPUP + 0x64, W64);
}

function runCase(rt, f) {
    FOLD_DONE = f.fold ?? 1;
    PAD_PRESSED_VAL = f.pressed ?? 0;
    PAD_HELD_VAL = f.held ?? 0;
    PAD_REPEAT_VAL = f.repeat ?? 0;
    GRID_STATE = f.gridState ?? 0;
    initPair(rt, f);

    CALLS.length = 0;
    rt.cpu.call(0x80084c38, [OBJ_A, CTX_A], 50000);
    const oracleCalls = CALLS.slice();

    CALLS.length = 0;
    albumScreenTick(rt.mem, OBJ_B, CTX_B, portHost());
    const portCalls = CALLS.slice();

    assert.deepEqual(portCalls, oracleCalls, `${f.name}: calls`);
    if (f.name === "state32 go") assert.equal(rt.mem.read32(OBJ_A + 0x0c) >>> 0, 3, "state32: mode");
    if (f.name === "state35 null") assert.ok(oracleCalls.length > 0, "state35 null: m28");
    if (!f.silent) assert.ok(oracleCalls.length > 0, `${f.name}: oracle exercised`);
    for (const off of [0x0c, 0x10, 0x14, 0x60, 0x68, 0x74, 0x78, 0x7c]) {
        assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
            `${f.name}: obj +0x${off.toString(16)}`);
    }
    for (const off of [0x44, 0x48]) {
        assert.equal(rt.mem.read32(CTX_B + off) >>> 0, rt.mem.read32(CTX_A + off) >>> 0,
            `${f.name}: ctx +0x${off.toString(16)}`);
    }
}

test("albumScreenTick matches F0x80084C38", () => {
    const rt = runtime();
    const cases = [
        { name: "default", state: 4 },
        { name: "state1 done", state: 1, fold: 1, anyFlag: 1 },
        { name: "state1 waiting", state: 1, fold: 0 },
        { name: "state1 empty", state: 1, fold: 1, anyFlag: 0 },
        { name: "state3", state: 3, silent: true },
        { name: "state4 idle", state: 4, cell: 3, slots: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
        { name: "state4 page right", state: 4, page: 0, pageCount: 3, pressed: 1 << 0xb },
        { name: "state4 page left", state: 4, page: 2, pressed: 1 << 0xa },
        { name: "state4 page repeat", state: 4, page: 1, repeat: 1 << 0xb },
        { name: "state4 cell down", state: 4, cell: 0, slots: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], pressed: 1 << 4 },
        { name: "state4 cell up", state: 4, cell: 8, slots: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], pressed: 1 << 6 },
        { name: "state4 cell prev", state: 4, cell: 5, slots: [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1], pressed: 1 << 7 },
        { name: "state4 cell next", state: 4, cell: 5, slots: [1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1], pressed: 1 << 5 },
        { name: "state4 cell clamp", state: 4, cell: 11, slots: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], pressed: 1 << 5 },
        { name: "state4 cancel", state: 4, pressed: 1 << 0xe },
        { name: "stateA close", state: 0xa, flag14: 0 },
        { name: "stateA open", state: 0xa, flag14: 1 },
        { name: "stateB done", state: 0xb, fold: 1 },
        { name: "stateB waiting", state: 0xb, fold: 0 },
        { name: "stateF skip", state: 0xf, grid: GRID, gridState: 0, silent: true },
        { name: "stateF keep", state: 0xf, grid: GRID, gridState: 1, d0: 1, cell: 2, slots: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { name: "state32 go", state: 0x32, popup: POPUP, silent: true },
        { name: "state33 done", state: 0x33, fold: 1 },
        { name: "state34 done", state: 0x34, fold: 1 },
        { name: "state35 null", state: 0x35, grid: 0, silent: true },
        { name: "state35 grid", state: 0x35, grid: GRID, silent: true },
    ];
    for (const f of cases) {
        if (f.name === "state32 go" || f.name === "state35 null" || f.name === "state35 grid") rt.mem.write32(POPUP + 0x0c, 2);
        runCase(rt, f);
    }
});
