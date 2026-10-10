// Phase 4 oracle: engine/dw3/ui/wizard-methods.ts must match pro/stplnmet
// F0x80085D50, F0x80086E40, F0x80086EAC and F0x800879E0. The originals run
// through engine/native with their child-call callees stubbed; the port
// compares ordered calls and every touched field.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    wizardNameEntryState, wizardConfirmAccept, wizardConfirmShow, wizardPackListShow,
} from "../engine/dw3/ui/wizard-methods.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stplnmet.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const CHILD = 0x80181000;
const CONFIRM_CHILD = 0x80086074;
const PACK_CHILD = 0x80087190;
const FIELDS = [0x0c, 0x10, 0x60, 0x70, 0x74, 0x78];

let EVENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(CONFIRM_CHILD, (c) => { EVENTS.push(["confirmChild", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(PACK_CHILD, (c) => { EVENTS.push(["packChild", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    return rt;
}

const rt = runtime();

function seed() {
    EVENTS = [];
    for (let i = 0; i <= 0x80; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x24, CHILD);
}

function fields() {
    return FIELDS.map((o) => rt.mem.read32(OBJ + o) >>> 0);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        confirmChildCall(obj, child, mode) { EVENTS.push(["confirmChild", obj >>> 0, child >>> 0, mode]); },
        packChildCall(obj, child, mode) { EVENTS.push(["packChild", obj >>> 0, child >>> 0, mode]); },
    };
}

test("wizardConfirmShow matches F0x80086E40", () => {
    for (const on of [1, 0]) {
        seed();
        rt.cpu.call(0x80086e40, [OBJ, on]);
        const oracleEvents = norm(EVENTS.slice());
        const oracleFields = fields();

        seed();
        wizardConfirmShow(rt.mem, OBJ, on, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `on ${on}: calls`);
        assert.deepEqual(fields(), oracleFields, `on ${on}: fields`);
    }
});

test("wizardPackListShow matches F0x800879E0", () => {
    for (const on of [1, 0]) {
        seed();
        rt.cpu.call(0x800879e0, [OBJ, on]);
        const oracleEvents = norm(EVENTS.slice());
        const oracleFields = fields();

        seed();
        wizardPackListShow(rt.mem, OBJ, on, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `on ${on}: calls`);
        assert.deepEqual(fields(), oracleFields, `on ${on}: fields`);
    }
});

test("wizardNameEntryState matches F0x80085D50", () => {
    seed();
    rt.cpu.call(0x80085d50, [OBJ]);
    const oracle = fields();
    seed();
    wizardNameEntryState(rt.mem, OBJ);
    assert.deepEqual(fields(), oracle, "fields");
});

test("wizardConfirmAccept matches F0x80086EAC", () => {
    seed();
    rt.cpu.call(0x80086eac, [OBJ]);
    const oracle = fields();
    seed();
    wizardConfirmAccept(rt.mem, OBJ);
    assert.deepEqual(fields(), oracle, "fields");
});
