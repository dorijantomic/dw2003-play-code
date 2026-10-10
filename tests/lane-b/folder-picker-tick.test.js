// Lane B Phase 4 oracle: engine/dw3/ui/native/folder-picker-tick.ts must match
// the original pro/stcrddek F0x80089354 folder picker tick.
//
// The original runs through engine/native (the interpreter) as the oracle. Every
// boundary the picker calls is a stub on both sides, pushing into one ordered
// CALLS log: the row reset/fill (0x8008924C / 0x80088D24), the fold pair
// [0x8008B838]/[0x8008B83C], the pad service [+0x3F4/+0x3FC/+0x408], the SFX
// cell [0x80055C48], the resource getter [0x80044F4C], the selection builders
// (0x8008660C / 0x800887D4), the popup builder (0x80083594), the base methods
// +0x28/+0x2C and the widget methods.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { folderPickerTick } from "../../engine/dw3/ui/native/folder-picker-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const folder = new Uint8Array(readFileSync(join(dir, "pro_stcrddek.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: folder.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x801a0000;
const OBJ_B = 0x801a0400;
const CTX_A = 0x801a1000;
const CTX_B = 0x801a1200;
const W4 = 0x801b0000;
const W5C = 0x801b0200;
const W60 = 0x801b0300;
const WID64 = 0x801b0400;
const POPUP = 0x801b0600;
const SAVE_BLOCK = 0x001b9800;

const FOLD_START = 0x0fd70000;
const FOLD_TICK = 0x0fd70004;
const PAD_PRESSED = 0x0fd70008;
const PAD_REPEAT = 0x0fd7000c;
const PAD_KEY = 0x0fd70010;
const SND = 0x0fd70014;
const RES_GET = 0x0fd70018;
const M28 = 0x0fd7001c;
const M2C = 0x0fd70020;
const W80 = 0x0fd70040;
const W84 = 0x0fd70044;
const W88 = 0x0fd70048;
const W94 = 0x0fd7004c;
const W114 = 0x0fd70050;
const W144 = 0x0fd70054;
const WM64 = 0x0fd70058;

let FOLD_DONE = 1;
let PAD_PRESSED_VAL = 0;
let PAD_REPEAT_VAL = 0;
const KEYMAP = { 4: 4, 6: 6, 0xd: 0xd, 0xe: 0xe };
let RES_HANDLE = 0x9000;
let SEL_ODD = 0x1234;
let SEL_EVEN = 0x5678;

const CALLS = [];

function runtime() {
    const rt = new NativeStageRuntime(folder, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    const relA = (a) => { const v = a >>> 0; return v >= OBJ_A && v < OBJ_A + 0x400 ? v - OBJ_A : v; };
    rt.cpu.setStub(0x8008924c, (c) => { CALLS.push(["reset", relA(c.reg(4))]); return 0; });
    rt.cpu.setStub(0x80088d24, (c) => { CALLS.push(["row", relA(c.reg(4)), c.reg(6) | 0, c.reg(7) | 0]); return 0; });
    rt.cpu.setStub(FOLD_START, (c) => { CALLS.push(["foldStart", relA(c.reg(4)), c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(FOLD_TICK, (c) => { CALLS.push(["foldTick", relA(c.reg(4))]); return FOLD_DONE; });
    rt.cpu.setStub(M28, (c) => { CALLS.push(["m28", relA(c.reg(4)), c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(M2C, (c) => { CALLS.push(["m2c", relA(c.reg(4)), c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(PAD_PRESSED, (c) => { CALLS.push(["pressed", c.reg(4) | 0]); return PAD_PRESSED_VAL; });
    rt.cpu.setStub(PAD_REPEAT, (c) => { CALLS.push(["repeat", c.reg(4) | 0]); return PAD_REPEAT_VAL; });
    rt.cpu.setStub(PAD_KEY, (c) => { CALLS.push(["key", c.reg(4) | 0, c.reg(5) | 0]); return KEYMAP[c.reg(5)] ?? 0; });
    rt.cpu.setStub(SND, (c) => { CALLS.push(["snd", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(RES_GET, (c) => { CALLS.push(["res", c.reg(4) | 0]); return RES_HANDLE; });
    rt.cpu.setStub(0x8008660c, (c) => { CALLS.push(["selodd", relA(c.reg(4)), c.reg(5) | 0]); return SEL_ODD; });
    rt.cpu.setStub(0x800887d4, (c) => { CALLS.push(["seleven", c.reg(4) | 0]); return SEL_EVEN; });
    rt.cpu.setStub(0x80083594, () => { CALLS.push(["popup"]); return POPUP; });
    rt.cpu.setStub(W80, (c) => { CALLS.push(["w80", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(W84, (c) => { CALLS.push(["w84", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(W88, (c) => { CALLS.push(["w88", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(W94, (c) => { CALLS.push(["w94", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(W114, (c) => { CALLS.push(["w114", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(W144, (c) => { CALLS.push(["w144", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(WM64, (c) => { CALLS.push(["w64", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.mem.write32(0x8008b838, FOLD_START);
    rt.mem.write32(0x8008b83c, FOLD_TICK);
    rt.mem.write32(0x8004bbc4, PAD_PRESSED);
    rt.mem.write32(0x8004bbcc, PAD_REPEAT);
    rt.mem.write32(0x8004bbd8, PAD_KEY);
    rt.mem.write32(0x80055c48, SND);
    rt.mem.write32(0x80044f4c, RES_GET);
    rt.mem.write32(0x8005cca8, SAVE_BLOCK);
    rt.mem.write32(WID64 + 0x80, W80);
    rt.mem.write32(WID64 + 0x84, W84);
    rt.mem.write32(WID64 + 0x88, W88);
    rt.mem.write32(WID64 + 0x94, W94);
    rt.mem.write32(W4 + 0x114, W114);
    rt.mem.write32(W5C + 0x114, W114);
    rt.mem.write32(W60 + 0x114, W114);
    rt.mem.write32(W4 + 0x144, W144);
    rt.mem.write32(W5C + 0x144, W144);
    rt.mem.write32(W60 + 0x144, W144);
    rt.mem.write32(POPUP + 0x64, WM64);
    return rt;
}

function relB(a) { const v = a >>> 0; return v >= OBJ_B && v < OBJ_B + 0x400 ? v - OBJ_B : v; }

function portHost() {
    return {
        resetRows(obj) { CALLS.push(["reset", relB(obj)]); },
        fillRow(obj, ctx, row, flag) { CALLS.push(["row", relB(obj), row | 0, flag | 0]); },
        selectOdd(obj, index) { CALLS.push(["selodd", relB(obj), index | 0]); return SEL_ODD; },
        selectEven(record) { CALLS.push(["seleven", record | 0]); return SEL_EVEN; },
        makePopup() { CALLS.push(["popup"]); return POPUP; },
        resourceGet(id) { CALLS.push(["res", id | 0]); return RES_HANDLE; },
        baseMethod28(obj, value) { CALLS.push(["m28", relB(obj), value | 0]); },
        baseMethod2C(obj, value) { CALLS.push(["m2c", relB(obj), value | 0]); },
        padPressed(port) { CALLS.push(["pressed", port | 0]); return PAD_PRESSED_VAL; },
        padRepeat(port) { CALLS.push(["repeat", port | 0]); return PAD_REPEAT_VAL; },
        padKey(port, code) { CALLS.push(["key", port | 0, code | 0]); return KEYMAP[code] ?? 0; },
        playSound(id) { CALLS.push(["snd", id | 0]); },
        foldStart(sub, direction) { CALLS.push(["foldStart", relB(sub), direction | 0]); },
        foldTick(sub) { CALLS.push(["foldTick", relB(sub)]); return FOLD_DONE; },
        widget114(w, s, i) { CALLS.push(["w114", w | 0, s | 0, i | 0]); },
        widget144(w, v) { CALLS.push(["w144", w | 0, v | 0]); },
        widget84(w, x, y) { CALLS.push(["w84", w | 0, x | 0, y | 0]); },
        widget80(w, v) { CALLS.push(["w80", w | 0, v | 0]); },
        widget94(w, v) { CALLS.push(["w94", w | 0, v | 0]); },
        widget88(w, v) { CALLS.push(["w88", w | 0, v | 0]); },
        widget64(w, a, b) { CALLS.push(["w64", w | 0, a | 0, b | 0]); },
    };
}

function initPair(rt, f) {
    const clear = (base, n) => { for (let i = 0; i < n; i += 4) rt.mem.write32(base + i, 0); };
    clear(OBJ_A, 0x140); clear(OBJ_B, 0x140);
    clear(CTX_A, 0x80); clear(CTX_B, 0x80);
    for (const [obj, ctx] of [[OBJ_A, CTX_A], [OBJ_B, CTX_B]]) {
        rt.mem.write32(obj + 0x28, M28);
        rt.mem.write32(obj + 0x2c, M2C);
        rt.mem.write32(obj + 0x0c, f.mode ?? 3);
        rt.mem.write32(obj + 0x10, f.state ?? 0);
        rt.mem.write32(obj + 0x14, f.flag14 ?? 0);
        rt.mem.write32(obj + 0x60, f.cursor ?? 0);
        rt.mem.write32(obj + 0x64, f.flag64 ?? 0);
        rt.mem.write32(obj + 0x70, f.flag70 ?? 0);
        rt.mem.write32(ctx + 0x0, f.ctx0 ?? 0);
        rt.mem.write32(ctx + 0x4, W4);
        rt.mem.write32(ctx + 0x5c, W5C);
        rt.mem.write32(ctx + 0x60, W60);
        rt.mem.write32(ctx + 0x64, WID64);
        rt.mem.write32(ctx + 0x68, f.ctx68 ?? 0);
    }
}

function runCase(rt, f) {
    FOLD_DONE = f.fold ?? 1;
    PAD_PRESSED_VAL = f.pressed ?? 0;
    PAD_REPEAT_VAL = f.repeat ?? 0;
    RES_HANDLE = f.resHandle ?? 0x9000;
    initPair(rt, f);

    CALLS.length = 0;
    rt.cpu.call(0x80089354, [OBJ_A, CTX_A], 40000);
    const oracleCalls = CALLS.slice();

    CALLS.length = 0;
    folderPickerTick(rt.mem, OBJ_B, CTX_B, portHost());
    const portCalls = CALLS.slice();

    assert.deepEqual(portCalls, oracleCalls, `${f.name}: calls`);
    if (!f.silent) assert.ok(oracleCalls.length > 0, `${f.name}: oracle exercised`);
    for (const off of [0x0c, 0x10, 0x14, 0x60, 0x64, 0x70]) {
        assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
            `${f.name}: obj +0x${off.toString(16)}`);
    }
    assert.equal(rt.mem.read32(CTX_B + 0x0) >>> 0, rt.mem.read32(CTX_A + 0x0) >>> 0, `${f.name}: ctx+0x0`);
    assert.equal(rt.mem.read32(CTX_B + 0x68) >>> 0, rt.mem.read32(CTX_A + 0x68) >>> 0, `${f.name}: ctx+0x68`);
}

test("folderPickerTick matches F0x80089354", () => {
    const rt = runtime();
    const cases = [
        { name: "default", state: 0 },
        { name: "state1 waiting", state: 1, fold: 0 },
        { name: "state1 done", state: 1, fold: 1 },
        { name: "state2 done", state: 2, fold: 1 },
        { name: "state3 done", state: 3, fold: 1 },
        { name: "state4 idle", state: 4, cursor: 1 },
        { name: "state4 left", state: 4, cursor: 1, pressed: 1 << 4 },
        { name: "state4 right", state: 4, cursor: 1, pressed: 1 << 6 },
        { name: "state4 repeat", state: 4, cursor: 1, repeat: 1 << 4 },
        { name: "state4 at zero", state: 4, cursor: 0, pressed: 1 << 4 },
        { name: "state4 confirm", state: 4, cursor: 1, pressed: 1 << 0xd },
        { name: "state4 cancel", state: 4, cursor: 1, pressed: 1 << 0xe },
        { name: "stateA", state: 0xa },
        { name: "stateB done", state: 0xb, fold: 1 },
        { name: "stateB waiting", state: 0xb, fold: 0 },
        { name: "stateC done", state: 0xc, fold: 1 },
        { name: "stateD left", state: 0xd, flag70: 1, pressed: 1 << 4 },
        { name: "stateD right", state: 0xd, flag70: 0, pressed: 1 << 6 },
        { name: "stateD confirm", state: 0xd, flag70: 0, pressed: 1 << 0xd },
        { name: "stateD cancel", state: 0xd, flag70: 0, pressed: 1 << 0xe },
        { name: "stateF", state: 0xf },
        { name: "state10 done", state: 0x10, fold: 1 },
        { name: "state11 done", state: 0x11, fold: 1 },
        { name: "state32 plain", state: 0x32, flag14: 0 },
        { name: "state32 shown", state: 0x32, flag14: 1 },
        { name: "state33 done", state: 0x33, fold: 1 },
        { name: "state34 shown", state: 0x34, fold: 1, flag14: 1 },
        { name: "state34 plain", state: 0x34, fold: 1, flag14: 0 },
        { name: "state35 shown", state: 0x35, fold: 1, flag14: 1 },
        { name: "state35 plain", state: 0x35, fold: 1, flag14: 0 },
        { name: "state36 odd", state: 0x36, flag14: 1, flag70: 0, cursor: 1 },
        { name: "state36 even", state: 0x36, flag14: 1, flag70: 1, cursor: 1 },
        { name: "state36 plain", state: 0x36, flag14: 0, silent: true },
        { name: "state64", state: 0x64 },
        { name: "state65 popup2", state: 0x65, ctx68: POPUP, silent: true },
        { name: "state65 wait", state: 0x65, ctx68: POPUP, silent: true },
    ];
    for (const f of cases) {
        if (f.name === "state65 popup2") rt.mem.write32(POPUP + 0x0c, 2);
        if (f.name === "state65 wait") rt.mem.write32(POPUP + 0x0c, 0);
        runCase(rt, f);
    }
});
