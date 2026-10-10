// Lane B Phase 4 oracle: engine/dw3/ui/native/country-select-tick.ts must match
// the original pro/cnty_sel F0x80083D18 country-select root tick.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// five child-object factories, the child/screen object methods, the pad reads
// and the [0x8004B440] service are stubbed on both sides so the ordered calls,
// the screen fields and the chosen-country byte can be compared directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { countrySelectTick } from "../../engine/dw3/ui/native/country-select-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const cnty = new Uint8Array(readFileSync(join(dir, "pro_cnty_sel.bin")));
const entry = { size: cnty.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARG1 = 0x80160000;
const CHILD_A = 0x80151000; // arg1+0x10
const CHILD_B = 0x80151400; // arg1+0x8
const CHILD_C = 0x80151800; // arg1+0x4
const CHILD_D = 0x80151c00; // arg1+0xC
const MENU = 0x80152000;   // arg1+0x0

const CREATE_A = 0x800832d8;
const CREATE_B = 0x80083804;
const CREATE_C = 0x80083a68;
const CREATE_D = 0x80083cec;
const CREATE_MENU = 0x80083594;
const PAD_A_PTR = 0x8004b7d0 + 0x3f4;
const PAD_B_PTR = 0x8004b7d0 + 0x3fc;
const PAD_BUTTON_PTR = 0x8004b7d0 + 0x408;
const SERVICE_PTR = 0x8004b440;
const TABLE = 0x80084424;
const GLOBAL = 0x8005cca8;

const PAD_A_STUB = 0x0fdb0000;
const PAD_B_STUB = 0x0fdb0004;
const PAD_BUTTON_STUB = 0x0fdb0008;
const SERVICE_STUB = 0x0fdb000c;
const SLOT_BASE = 0x0fda0000;

const SLOT_ARITY = { 0x28: 1, 0x30: 1, 0x38: 0, 0x3c: 0, 0x5c: 1 };
const SLOTS = Object.keys(SLOT_ARITY).map(Number);

const LOG = [];
const CONTROL = { padA: 0, padB: 0, global: 0 };

function runtime() {
    const host = {
        setFlag() {}, getFlag: () => 0, rand16: () => 0x777,
        playPackedSound(id) { LOG.push(["playSound", id | 0]); },
    };
    const rt = new NativeStageRuntime(cnty, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    const factory = (addr, name, value) => {
        rt.cpu.setStub(addr, () => { LOG.push([name]); return value; });
    };
    factory(CREATE_A, "createA", CHILD_A);
    factory(CREATE_B, "createB", CHILD_B);
    factory(CREATE_C, "createC", CHILD_C);
    factory(CREATE_D, "createD", CHILD_D);
    factory(CREATE_MENU, "createMenu", MENU);

    rt.cpu.setStub(PAD_A_STUB, (c) => { LOG.push(["padA", c.reg(4) | 0]); return CONTROL.padA; });
    rt.cpu.setStub(PAD_B_STUB, (c) => { LOG.push(["padB", c.reg(4) | 0]); return CONTROL.padB; });
    rt.cpu.setStub(PAD_BUTTON_STUB, (c) => { LOG.push(["padButton", c.reg(4) | 0, c.reg(5) | 0]); return c.reg(5) | 0; });
    rt.cpu.setStub(SERVICE_STUB, (c) => { LOG.push(["invoke", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    for (const slot of SLOTS) {
        rt.cpu.setStub(SLOT_BASE + slot, (c) => {
            const target = c.reg(4) | 0;
            const arity = SLOT_ARITY[slot];
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", target, slot, ...args]);
            return 0;
        });
    }

    rt.mem.write32(PAD_A_PTR, PAD_A_STUB);
    rt.mem.write32(PAD_B_PTR, PAD_B_STUB);
    rt.mem.write32(PAD_BUTTON_PTR, PAD_BUTTON_STUB);
    rt.mem.write32(SERVICE_PTR, SERVICE_STUB);

    for (const target of [CHILD_A, CHILD_B, CHILD_C, CHILD_D, MENU]) {
        for (const slot of SLOTS) rt.mem.write32(target + slot, SLOT_BASE + slot);
    }
    for (let i = 0; i <= 6; i++) rt.mem.write8(TABLE + i, 0x10 + i);
    return rt;
}

function seed(rt, c) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x28, SLOT_BASE + 0x28);
    rt.mem.write32(OBJ + 0x30, SLOT_BASE + 0x30);
    rt.mem.write32(OBJ + 0x38, SLOT_BASE + 0x38);
    rt.mem.write32(OBJ + 0x3c, SLOT_BASE + 0x3c);
    rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
    rt.mem.write32(OBJ + 0x10, c.sub ?? 0);
    rt.mem.write32(OBJ + 0x14, c.rowSel ?? 0);
    rt.mem.write16(OBJ + 0x50, c.sel ?? 0);
    rt.mem.write16(OBJ + 0x52, c.timer ?? 0);

    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(ARG1 + i, 0);
    if (c.initSlots) {
        rt.mem.write32(ARG1 + 0x00, 0);
        rt.mem.write32(ARG1 + 0x04, 0);
        rt.mem.write32(ARG1 + 0x08, 0);
        rt.mem.write32(ARG1 + 0x0c, 0);
        rt.mem.write32(ARG1 + 0x10, 0);
    } else {
        rt.mem.write32(ARG1 + 0x00, MENU);
        rt.mem.write32(ARG1 + 0x04, CHILD_C);
        rt.mem.write32(ARG1 + 0x08, CHILD_B);
        rt.mem.write32(ARG1 + 0x0c, CHILD_D);
        rt.mem.write32(ARG1 + 0x10, CHILD_A);
    }

    CONTROL.padA = c.padA ?? 0;
    CONTROL.padB = c.padB ?? 0;
    CONTROL.global = c.global ?? 0;
    rt.mem.write8(GLOBAL, CONTROL.global);
}

function portHost() {
    return {
        createA() { LOG.push(["createA"]); return CHILD_A; },
        createB() { LOG.push(["createB"]); return CHILD_B; },
        createC() { LOG.push(["createC"]); return CHILD_C; },
        createD() { LOG.push(["createD"]); return CHILD_D; },
        createMenu() { LOG.push(["createMenu"]); return MENU; },
        padReadA(port) { LOG.push(["padA", port | 0]); return CONTROL.padA; },
        padReadB(port) { LOG.push(["padB", port | 0]); return CONTROL.padB; },
        padButton(port, code) { LOG.push(["padButton", port | 0, code | 0]); return code | 0; },
        playSound(id) { LOG.push(["playSound", id | 0]); },
        invoke(id, arg) { LOG.push(["invoke", id | 0, arg | 0]); },
        callMethod(target, slot, args) {
            LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]);
        },
    };
}

function fields(rt) {
    const out = [];
    for (const off of [0x0c, 0x10, 0x14]) out.push(`obj+${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    for (const off of [0x50, 0x52]) out.push(`obj+${off.toString(16)}=${rt.mem.read16(OBJ + off) >>> 0}`);
    for (const off of [0x00, 0x04, 0x08, 0x0c, 0x10]) out.push(`a1+${off.toString(16)}=${rt.mem.read32(ARG1 + off) >>> 0}`);
    out.push(`global=${rt.mem.read8(GLOBAL) >>> 0}`);
    return out;
}

function runBoth(rt, c) {
    seed(rt, c);
    LOG.length = 0;
    rt.cpu.call(0x80083d18, [OBJ, ARG1], 40000);
    const oracleLog = LOG.slice();
    const oracleFields = fields(rt);

    seed(rt, c);
    LOG.length = 0;
    countrySelectTick(rt.mem, OBJ, ARG1, portHost());
    return { oracleLog, oracleFields, portLog: LOG.slice(), portFields: fields(rt) };
}

const CASES = [
    { name: "state 0 init", state: 0, initSlots: true },
    { name: "state 4 init", state: 4, initSlots: true },
    { name: "state 2 idle", state: 2 },
    { name: "state 3 idle", state: 3 },
    { name: "sub 0 block39", state: 1, sub: 0 },
    { name: "sub 1 hold", state: 1, sub: 1, timer: 0 },
    { name: "sub 1 fires", state: 1, sub: 1, timer: 6 },
    { name: "sub 2 step", state: 1, sub: 2 },
    { name: "sub 3 hold", state: 1, sub: 3, timer: 0x0a },
    { name: "sub 4 step", state: 1, sub: 4 },
    { name: "sub 5 hold", state: 1, sub: 5, timer: 5 },
    { name: "sub 6 menu", state: 1, sub: 6 },
    { name: "sub 7 idle pad7", state: 1, sub: 7, rowSel: 0 },
    { name: "sub 7 confirm", state: 1, sub: 7, rowSel: 0, sel: 2, padA: 1 << 3 },
    { name: "sub 7 code4 down", state: 1, sub: 7, rowSel: 0, sel: 3, padA: 1 << 4 },
    { name: "sub 7 code4 floor", state: 1, sub: 7, rowSel: 0, sel: 0, padA: 1 << 4 },
    { name: "sub 7 code6 up", state: 1, sub: 7, rowSel: 0, sel: 2, padA: 1 << 6 },
    { name: "sub 7 code6 ceiling", state: 1, sub: 7, rowSel: 0, sel: 4, padA: 1 << 6 },
    { name: "sub 7 code4 alt pad", state: 1, sub: 7, rowSel: 0, sel: 3, padB: 1 << 4 },
    { name: "sub 7 code7 to 6", state: 1, sub: 7, rowSel: 1, sel: 2, padA: 1 << 7 },
    { name: "sub 7 code7 already 6", state: 1, sub: 7, rowSel: 1, sel: 6, padA: 1 << 7 },
    { name: "sub 7 code5 from 6", state: 1, sub: 7, rowSel: 1, sel: 6, padA: 1 << 5 },
    { name: "sub 7 code5 launch", state: 1, sub: 7, rowSel: 1, sel: 2, padA: 1 << 5 },
    { name: "sub 8 hold", state: 1, sub: 8, timer: 0x29 },
    { name: "sub 8 fires", state: 1, sub: 8, timer: 0x2a },
    { name: "sub 9 trio", state: 1, sub: 9 },
    { name: "sub a hold", state: 1, sub: 0x0a, timer: 4 },
    { name: "sub a fires", state: 1, sub: 0x0a, timer: 5 },
    { name: "sub b step", state: 1, sub: 0x0b },
    { name: "sub c hold", state: 1, sub: 0x0c, timer: 0x1d },
    { name: "sub c fires", state: 1, sub: 0x0c, timer: 0x1e },
    { name: "sub d clear", state: 1, sub: 0x0d, global: 0 },
    { name: "sub d set", state: 1, sub: 0x0d, global: 1 },
    { name: "sub e default", state: 1, sub: 0x0e },
    { name: "sub ff default", state: 1, sub: 0xff },
];

test("countrySelectTick matches F0x80083D18", () => {
    const rt = runtime();
    for (const c of CASES) {
        const r = runBoth(rt, c);
        assert.deepEqual(r.portLog, r.oracleLog, `${c.name}: calls`);
        assert.deepEqual(r.portFields, r.oracleFields, `${c.name}: fields`);
    }
});

test("countrySelectTick confirm writes the chosen country byte", () => {
    const rt = runtime();
    const c = { state: 1, sub: 7, rowSel: 0, sel: 5, padA: 1 << 3 };
    const r = runBoth(rt, c);
    assert.deepEqual(r.portLog, r.oracleLog);
    assert.ok(r.portLog.some(([m]) => m === "playSound"), "confirm sound");
    const globalEntry = r.portFields.find((f) => f.startsWith("global="));
    assert.equal(globalEntry, `global=${0x10 + 5}`, "country byte from the table");
});
