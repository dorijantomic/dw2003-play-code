// Phase 4 oracle: engine/dw3/ui/wizard-name-save.ts must match pro/stplnmet
// F0x80085C50. The original runs through engine/native with the text-context
// builder and its copy slot stubbed; the port compares calls, field cells and
// the save block.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { wizardNameFieldSave } from "../engine/dw3/ui/wizard-name-save.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stplnmet.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const SAVE = 0x80182000;
const SLOT8 = 0x0fef0010;
const WIDTH = 6;

let EVENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x8001fcc0, (c) => {
        rt.mem.write32(c.reg(4) + 0x08, SLOT8);
        EVENTS.push(["initTextContext"]);
        return 0;
    });
    rt.cpu.setStub(SLOT8, (c) => { EVENTS.push(["copy", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    return rt;
}

const rt = runtime();

function seed(o) {
    EVENTS = [];
    for (let i = 0; i <= 0xa4; i += 4) rt.mem.write32(OBJ + i, 0);
    for (let i = 0; i < WIDTH + 2; i++) rt.mem.write16(OBJ + 0x78 + i * 2, 0x4081);
    for (const [i, v] of o.cells ?? []) rt.mem.write16(OBJ + 0x78 + i * 2, v);
    rt.mem.write32(OBJ + 0x94, o.width);
    for (let i = 0; i < 32; i++) rt.mem.write8(SAVE + i, 0xaa);
}

function cells() {
    const out = [];
    for (let i = 0; i < WIDTH + 2; i++) out.push(rt.mem.read16(OBJ + 0x78 + i * 2) >>> 0);
    return out;
}

function saveBytes() {
    const out = [];
    for (let i = 0; i < 16; i++) out.push(rt.mem.read8(SAVE + i) >>> 0);
    return out;
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        initTextContext() { EVENTS.push(["initTextContext"]); },
        textContextCopy(saveCtx, fieldPtr, mode) {
            EVENTS.push(["copy", saveCtx >>> 0, fieldPtr >>> 0, mode]);
        },
    };
}

test("wizardNameFieldSave matches F0x80085C50", () => {
    const cases = [
        { label: "short name", width: 5, cells: [[0, 0x0041], [1, 0x0042]] },
        { label: "leading blanks", width: 5, cells: [[2, 0x0041], [3, 0x0042]] },
        { label: "all blank", width: 5, cells: [] },
        { label: "zero width", width: 0, cells: [] },
        { label: "full width", width: 6, cells: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]] },
        { label: "middle gap", width: 6, cells: [[0, 0x41], [2, 0x42]] },
    ];
    for (const o of cases) {
        seed(o);
        rt.cpu.call(0x80085c50, [OBJ, SAVE]);
        const oracleEvents = norm(EVENTS.slice());
        const oracleCells = cells();
        const oracleSave = saveBytes();

        seed(o);
        wizardNameFieldSave(rt.mem, OBJ, SAVE, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${o.label}: calls`);
        assert.deepEqual(cells(), oracleCells, `${o.label}: field cells`);
        assert.deepEqual(saveBytes(), oracleSave, `${o.label}: save block`);
    }
});
