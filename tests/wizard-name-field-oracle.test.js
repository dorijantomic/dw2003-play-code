// Phase 4 oracle: engine/dw3/ui/wizard-name-field.ts must match pro/stplnmet
// F0x80085D5C (name show/hide + caret scan) and F0x80085BB0 (box size). The
// originals run through engine/native with the child routine stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { wizardNameEntryShow, wizardNameFieldBox } from "../engine/dw3/ui/wizard-name-field.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stplnmet.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const CHILD = 0x80181000;
const NAME_CHILD = 0x80084060;
const FIELDS = [0x0c, 0x10, 0x5c, 0x60, 0x90];

let EVENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(NAME_CHILD, (c) => { EVENTS.push(["nameChild", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    return rt;
}

const rt = runtime();

function seed(o) {
    EVENTS = [];
    for (let i = 0; i <= 0xa4; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x24, CHILD);
    rt.mem.write32(OBJ + 0x94, (o.width ?? 0) >>> 0);
    for (let i = 0; i < 8; i++) rt.mem.write16(OBJ + 0x78 + i * 2, 0x4081);
    for (const [i, v] of o.cells ?? []) rt.mem.write16(OBJ + 0x78 + i * 2, v);
}

function fields() {
    return FIELDS.map((o) => rt.mem.read32(OBJ + o) >>> 0);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        nameEntryChildCall(obj, child, mode) { EVENTS.push(["nameChild", obj >>> 0, child >>> 0, mode]); },
    };
}

test("wizardNameEntryShow matches F0x80085D5C", () => {
    const cases = [
        { label: "hide", on: 0, width: 5 },
        { label: "show all blank", on: 1, width: 5 },
        { label: "show top filled", on: 1, width: 5, cells: [[4, 0x0041]] },
        { label: "show name of two", on: 1, width: 5, cells: [[0, 0x0041], [1, 0x0042]] },
        { label: "show zero width", on: 1, width: 0 },
        { label: "show width 1 filled", on: 1, width: 1, cells: [[0, 0x0041]] },
    ];
    for (const o of cases) {
        seed(o);
        rt.cpu.call(0x80085d5c, [OBJ, o.on]);
        const oracleEvents = norm(EVENTS.slice());
        const oracleFields = fields();

        seed(o);
        wizardNameEntryShow(rt.mem, OBJ, o.on, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${o.label}: calls`);
        assert.deepEqual(fields(), oracleFields, `${o.label}: fields`);
    }
});

test("wizardNameFieldBox matches F0x80085BB0", () => {
    seed({});
    rt.cpu.call(0x80085bb0, [OBJ, 0x140, 0x100]);
    const oracle = fields();
    seed({});
    wizardNameFieldBox(rt.mem, OBJ, 0x140, 0x100);
    assert.deepEqual(fields(), oracle, "fields");
});
