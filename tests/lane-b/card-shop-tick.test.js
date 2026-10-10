// Lane B Phase 4 oracle: engine/dw3/ui/native/card-shop-tick.ts must match the
// original pro/stcrdshp F0x8008838C shop root tick.
//
// The original runs through engine/native (the interpreter) as the oracle. Every
// boundary the tick calls is a stub on both sides, pushing into one ordered CALLS
// log: the fold pair (0x8008CB88 / 0x8008CB8C), the pad service
// (0x8004B7D0 + 0x3F4 / +0x3FC / +0x408), the [0x80042B98] list service
// (+0x04 / +0x0C), the SFX cell [0x80055C48], the resource getter [0x80044F4C],
// the widget constructors/selectors, the widget methods, and the base +0x2C.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { shopRootTick } from "../../engine/dw3/ui/native/card-shop-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const shop = new Uint8Array(readFileSync(join(dir, "pro_stcrdshp.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: shop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x801a0000;
const OBJ_B = 0x801a0400;
const CTX_A = 0x801a1000;
const CTX_B = 0x801a1200;
const W8 = 0x801b0000;
const W20 = 0x801b0200;
const POPUP = 0x801b0600;
const SAVE_BLOCK = 0x001b9800;

const FOLD_START = 0x0fd60000;
const FOLD_TICK = 0x0fd60004;
const M2C = 0x0fd60008;
const PAD_PRESSED = 0x0fd6000c;
const PAD_REPEAT = 0x0fd60010;
const PAD_KEY = 0x0fd60014;
const LIST_ITEM = 0x0fd60018;
const LIST_COUNT = 0x0fd6001c;
const SND = 0x0fd60020;
const RES_GET = 0x0fd60024;
const W80 = 0x0fd60040;
const W84 = 0x0fd60044;
const W88 = 0x0fd60048;
const W94 = 0x0fd6004c;
const W114 = 0x0fd60050;
const W144 = 0x0fd60054;
const W64 = 0x0fd60058;

let FOLD_DONE = 1;
let PAD_PRESSED_VAL = 0;
let PAD_REPEAT_VAL = 0;
const KEYMAP = { 4: 4, 6: 6, 0xd: 0xd, 0xe: 0xe };
let LIST_N = 0;
let LIST_ITEM_RET = 0;
let SELDEF_RET = 0x11;
let SELCARD_RET = 0;
let RES_HANDLE = 0x9000;

const CALLS = [];

function runtime() {
    const rt = new NativeStageRuntime(shop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    const relA = (a) => { const v = a >>> 0; return v >= OBJ_A && v < OBJ_A + 0x400 ? v - OBJ_A : v; };
    rt.cpu.setStub(FOLD_START, (c) => { CALLS.push(["foldStart", relA(c.reg(4)), c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(FOLD_TICK, (c) => { CALLS.push(["foldTick", relA(c.reg(4))]); return FOLD_DONE; });
    rt.cpu.setStub(M2C, (c) => { CALLS.push(["m2c", relA(c.reg(4)), c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(PAD_PRESSED, (c) => { CALLS.push(["pressed", c.reg(4) | 0]); return PAD_PRESSED_VAL; });
    rt.cpu.setStub(PAD_REPEAT, (c) => { CALLS.push(["repeat", c.reg(4) | 0]); return PAD_REPEAT_VAL; });
    rt.cpu.setStub(PAD_KEY, (c) => { CALLS.push(["key", c.reg(4) | 0, c.reg(5) | 0]); return KEYMAP[c.reg(5)] ?? 0; });
    rt.cpu.setStub(LIST_ITEM, (c) => { CALLS.push(["item", c.reg(4) | 0]); return LIST_ITEM_RET; });
    rt.cpu.setStub(LIST_COUNT, (c) => { CALLS.push(["count", c.reg(4) | 0, relA(c.reg(5))]); return LIST_N; });
    rt.cpu.setStub(SND, (c) => { CALLS.push(["snd", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(RES_GET, (c) => { CALLS.push(["res", c.reg(4) | 0]); return RES_HANDLE; });
    rt.cpu.setStub(0x80087e8c, (c) => { CALLS.push(["fill", relA(c.reg(4)), 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(0x80087fac, (c) => { CALLS.push(["clear", relA(c.reg(4)), 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(0x80087b84, (c) => { CALLS.push(["seldef", relA(c.reg(4)), c.reg(5) | 0]); return SELDEF_RET; });
    rt.cpu.setStub(0x8008536c, (c) => { CALLS.push(["selcard", relA(c.reg(4))]); return SELCARD_RET; });
    rt.cpu.setStub(0x80085634, () => { CALLS.push(["popup"]); return POPUP; });
    rt.cpu.setStub(W80, (c) => { CALLS.push(["w80", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(W84, (c) => { CALLS.push(["w84", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(W88, (c) => { CALLS.push(["w88", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(W94, (c) => { CALLS.push(["w94", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(W114, (c) => { CALLS.push(["w114", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(W144, (c) => { CALLS.push(["w144", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(W64, (c) => { CALLS.push(["w64", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    // cells
    rt.mem.write32(0x8008cb88, FOLD_START);
    rt.mem.write32(0x8008cb8c, FOLD_TICK);
    rt.mem.write32(0x8004bbc4, PAD_PRESSED);
    rt.mem.write32(0x8004bbcc, PAD_REPEAT);
    rt.mem.write32(0x8004bbd8, PAD_KEY);
    rt.mem.write32(0x80042b9c, LIST_ITEM);
    rt.mem.write32(0x80042ba4, LIST_COUNT);
    rt.mem.write32(0x80055c48, SND);
    rt.mem.write32(0x80044f4c, RES_GET);
    rt.mem.write32(0x8005cca8, SAVE_BLOCK);
    rt.mem.write32(W20 + 0x80, W80);
    rt.mem.write32(W20 + 0x84, W84);
    rt.mem.write32(W20 + 0x88, W88);
    rt.mem.write32(W20 + 0x94, W94);
    rt.mem.write32(W8 + 0x114, W114);
    rt.mem.write32(W8 + 0x144, W144);
    rt.mem.write32(POPUP + 0x64, W64);
    return rt;
}

function relB(a) { const v = a >>> 0; return v >= OBJ_B && v < OBJ_B + 0x400 ? v - OBJ_B : v; }

function portHost() {
    return {
        baseMethod2C(obj, value) { CALLS.push(["m2c", relB(obj), value | 0]); },
        fillWidgets(obj, ctx, flag) { CALLS.push(["fill", relB(obj), 0, flag | 0]); },
        clearWidgets(obj, ctx, flag) { CALLS.push(["clear", relB(obj), 0, flag | 0]); },
        selectDefault(obj, value) { CALLS.push(["seldef", relB(obj), value | 0]); return SELDEF_RET; },
        selectCard(obj) { CALLS.push(["selcard", relB(obj)]); return SELCARD_RET; },
        makePopup() { CALLS.push(["popup"]); return POPUP; },
        resourceGet(id) { CALLS.push(["res", id | 0]); return RES_HANDLE; },
        listCount(tag, ptr) { CALLS.push(["count", tag | 0, relB(ptr)]); return LIST_N; },
        listItem(value) { CALLS.push(["item", value | 0]); return LIST_ITEM_RET; },
        padPressed(port) { CALLS.push(["pressed", port | 0]); return PAD_PRESSED_VAL; },
        padRepeat(port) { CALLS.push(["repeat", port | 0]); return PAD_REPEAT_VAL; },
        padKey(port, code) { CALLS.push(["key", port | 0, code | 0]); return KEYMAP[code] ?? 0; },
        playSound(id) { CALLS.push(["snd", id | 0]); },
        foldStart(sub, direction) { CALLS.push(["foldStart", relB(sub), direction | 0]); },
        foldTick(sub) { CALLS.push(["foldTick", relB(sub)]); return FOLD_DONE; },
        widget84(w, x, y) { CALLS.push(["w84", w | 0, x | 0, y | 0]); },
        widget80(w, v) { CALLS.push(["w80", w | 0, v | 0]); },
        widget94(w, v) { CALLS.push(["w94", w | 0, v | 0]); },
        widget88(w, v) { CALLS.push(["w88", w | 0, v | 0]); },
        widget114(w, s, i) { CALLS.push(["w114", w | 0, s | 0, i | 0]); },
        widget144(w, v) { CALLS.push(["w144", w | 0, v | 0]); },
        widget64(w, a, b) { CALLS.push(["w64", w | 0, a | 0, b | 0]); },
    };
}

function initPair(rt, f) {
    const clear = (base, n) => { for (let i = 0; i < n; i += 4) rt.mem.write32(base + i, 0); };
    clear(OBJ_A, 0x400); clear(OBJ_B, 0x400);
    clear(CTX_A, 0x40); clear(CTX_B, 0x40);
    for (const [obj, ctx] of [[OBJ_A, CTX_A], [OBJ_B, CTX_B]]) {
        rt.mem.write32(obj + 0x2c, M2C);
        rt.mem.write32(ctx + 0x8, W8);
        rt.mem.write32(ctx + 0x20, W20);
        rt.mem.write32(ctx + 0x28, f.ctx28 ?? 0);
        rt.mem.write32(ctx + 0x24, f.ctx24 ?? 0);
        rt.mem.write32(obj + 0x0c, f.mode ?? 3);
        rt.mem.write32(obj + 0x10, f.state ?? 0);
        rt.mem.write32(obj + 0x14, f.flag14 ?? 0);
        rt.mem.write32(obj + 0x60, f.menuValue ?? 0);
        rt.mem.write32(obj + 0x68, f.flag68 ?? 0);
        rt.mem.write32(obj + 0x6c, f.cursor ?? 0);
        for (let i = 0; i < 6; i++) rt.mem.write16(obj + 0x70 + i * 2, f.listValues ? (f.listValues[i] ?? 0) : 0);
    }
}

function runCase(rt, f) {
    FOLD_DONE = f.fold ?? 1;
    PAD_PRESSED_VAL = f.pressed ?? 0;
    PAD_REPEAT_VAL = f.repeat ?? 0;
    LIST_N = f.listN ?? 0;
    LIST_ITEM_RET = f.itemRet ?? 0;
    SELDEF_RET = f.selDef ?? 0x11;
    SELCARD_RET = f.selCard ?? 0;
    RES_HANDLE = f.resHandle ?? 0x9000;
    initPair(rt, f);

    CALLS.length = 0;
    rt.cpu.call(0x8008838c, [OBJ_A, CTX_A], 40000);
    const oracleCalls = CALLS.slice();

    CALLS.length = 0;
    shopRootTick(rt.mem, OBJ_B, CTX_B, portHost());
    const portCalls = CALLS.slice();

    assert.deepEqual(portCalls, oracleCalls, `${f.name}: calls`);
    if (!f.silent) assert.ok(oracleCalls.length > 0, `${f.name}: oracle exercised`);
    if (f.name === "stateA cursor2") {
        assert.equal(rt.mem.read32(OBJ_A + 0x10) >>> 0, 0x64, "stateA cursor2: state");
        assert.equal(rt.mem.read32(OBJ_A + 0x68) >>> 0, 1, "stateA cursor2: flag68");
    }
    if (f.name === "stateB clear") assert.equal(rt.mem.read32(OBJ_A + 0x10) >>> 0, 1, "stateB: state");
    if (f.name === "stateB keep") assert.equal(rt.mem.read32(OBJ_A + 0x10) >>> 0, 0xb, "stateB keep: held");
    if (f.name === "state65 popup2") assert.equal(rt.mem.read32(OBJ_A + 0x0c) >>> 0, 3, "state65: mode");
    for (const off of [0x0c, 0x10, 0x14, 0x68, 0x6c]) {
        assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
            `${f.name}: obj +0x${off.toString(16)}`);
    }
    assert.equal(rt.mem.read32(CTX_B + 0x24) >>> 0, rt.mem.read32(CTX_A + 0x24) >>> 0, `${f.name}: ctx+0x24`);
    assert.equal(rt.mem.read32(CTX_B + 0x28) >>> 0, rt.mem.read32(CTX_A + 0x28) >>> 0, `${f.name}: ctx+0x28`);
}

test("shopRootTick matches F0x8008838C", () => {
    const rt = runtime();
    const cases = [
        { name: "default", state: 4 },
        { name: "state1 done", state: 1, fold: 1 },
        { name: "state1 waiting", state: 1, fold: 0 },
        { name: "state2 done", state: 2, fold: 1, cursor: 1 },
        { name: "state3 idle", state: 3, cursor: 1 },
        { name: "state3 left", state: 3, cursor: 1, pressed: 1 << 4 },
        { name: "state3 right", state: 3, cursor: 1, pressed: 1 << 6 },
        { name: "state3 repeat", state: 3, cursor: 1, repeat: 1 << 4 },
        { name: "state3 at zero", state: 3, cursor: 0, pressed: 1 << 4 },
        { name: "state3 confirm", state: 3, cursor: 1, pressed: 1 << 0xd },
        { name: "state3 cancel", state: 3, cursor: 1, pressed: 1 << 0xe },
        { name: "stateA default", state: 0xa, cursor: 0, menuValue: 5 },
        { name: "stateA cursor2", state: 0xa, cursor: 2, silent: true },
        { name: "stateA match", state: 0xa, cursor: 1, listN: 3, itemRet: 0x62, selCard: 0x55 },
        { name: "stateA nomatch", state: 0xa, cursor: 1, listN: 3, itemRet: 0 },
        { name: "stateA keep", state: 0xa, cursor: 1, listN: 1, itemRet: 0, ctx24: 0x77 },
        { name: "stateB clear", state: 0xb, silent: true },
        { name: "stateB keep", state: 0xb, ctx24: 1, silent: true },
        { name: "state14", state: 0x14 },
        { name: "state15 done", state: 0x15, fold: 1 },
        { name: "state15 waiting", state: 0x15, fold: 0 },
        { name: "state16 confirm", state: 0x16, pressed: 1 << 0xd },
        { name: "state17 done", state: 0x17, fold: 1 },
        { name: "state32 open", state: 0x32, flag14: 0, cursor: 2 },
        { name: "state32 skip", state: 0x32, flag14: 1 },
        { name: "state33 close", state: 0x33, fold: 1, flag14: 0 },
        { name: "state33 to B", state: 0x33, fold: 1, flag14: 1 },
        { name: "state34 done", state: 0x34, fold: 1 },
        { name: "state64", state: 0x64 },
        { name: "state65 popup2", state: 0x65, ctx28: POPUP, silent: true },
    ];
    for (const f of cases) {
        if (f.name === "state65 popup2") rt.mem.write32(POPUP + 0x0c, 2);
        runCase(rt, f);
    }
});
