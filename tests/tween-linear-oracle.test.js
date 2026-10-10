// Phase 4 oracle: engine/dw3/ui/tween-linear.ts must match every executed
// copy of the resident 8.8 linear tween. The original runs through
// engine/native per module; the port uses the plain memory object.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { tweenLinearStart, tweenLinearTick } from "../engine/dw3/ui/tween-linear.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });

const FAMILY = [
    { module: "pro/stgmcard", file: "pro_stgmcard.bin", start: 0x80087fdc, tick: 0x8008801c },
    { module: "pro/stgdglab", file: "pro_stgdglab.bin", start: 0x8008f32c, tick: 0x8008f36c },
];

const OBJ_A = 0x80180000;
const OBJ_B = 0x80181000;
const FIELDS = [0x00, 0x08, 0x0c, 0x10, 0x14, 0x18];

function runtimeFor(file) {
    const overlay = new Uint8Array(readFileSync(join(dir, file)));
    const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function seed(rt, obj, o) {
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(obj + i, 0xdeadbeef);
    rt.mem.write32(obj + 0x00, o.steps ?? 0xdeadbeef);
    rt.mem.write32(obj + 0x08, o.value ?? 0xdeadbeef);
    rt.mem.write32(obj + 0x0c, o.accum ?? 0xdeadbeef);
    rt.mem.write32(obj + 0x10, o.target ?? 0xdeadbeef);
    rt.mem.write32(obj + 0x14, o.delta ?? 0xdeadbeef);
    rt.mem.write32(obj + 0x18, o.active ?? 0xdeadbeef);
}

function fields(rt, obj) {
    return FIELDS.map((off) => rt.mem.read32(obj + off) >>> 0);
}

for (const f of FAMILY) {
    const rt = runtimeFor(f.file);

    function runStart(label, from, to, steps) {
        seed(rt, OBJ_A, {});
        rt.cpu.call(f.start, [OBJ_A, from, to, steps]);
        const oracle = fields(rt, OBJ_A);
        seed(rt, OBJ_B, {});
        tweenLinearStart(rt.mem, OBJ_B, from, to, steps);
        assert.deepEqual(fields(rt, OBJ_B), oracle, `${label}: start`);
    }

    function runTick(label, o) {
        seed(rt, OBJ_A, o);
        const oracleRet = rt.cpu.call(f.tick, [OBJ_A]) | 0;
        const oracle = fields(rt, OBJ_A);
        seed(rt, OBJ_B, o);
        const portRet = tweenLinearTick(rt.mem, OBJ_B) | 0;
        assert.equal(portRet, oracleRet, `${label}: tick return`);
        assert.deepEqual(fields(rt, OBJ_B), oracle, `${label}: tick fields`);
    }

    test(`${f.module} tween start ${f.start.toString(16)} matches tweenLinearStart`, () => {
        runStart("open 10 steps", 0, 0x1000, 0x0a);
        runStart("slide down", 0x97, 0, 0x0a);
        runStart("negative from", -1, 0, 1);
        runStart("same from/to", 0x40, 0x40, 0x0a);
        runStart("one step", 0, 0x1000, 1);
        runStart("fractional delta", 0, 0x1000, 7);
        runStart("negative delta", 0x1000, 0, 10);
        runStart("large values", 0x1234, 0x5678, 0x0d);
    });

    test(`${f.module} tween tick ${f.tick.toString(16)} matches tweenLinearTick`, () => {
        runTick("inactive", { active: 0, accum: 0x100, delta: 0x10, target: 0x1000, value: 0 });
        runTick("rising below", { active: 1, accum: 0x100 << 8, delta: 0x100, target: 0x1000, value: 0x100 });
        runTick("rising lands", { active: 1, accum: 0xfc0 << 8, delta: 0x100, target: 0x1000, value: 0xfc0 });
        runTick("rising at target", { active: 1, accum: 0x1000 << 8, delta: 0x100, target: 0x1000, value: 0x1000 });
        runTick("rising past target", { active: 1, accum: 0x1100 << 8, delta: 0x100, target: 0x1000, value: 0x1100 });
        runTick("falling above", { active: 1, accum: 0x1000 << 8, delta: -0x100, target: 0, value: 0x1000 });
        runTick("falling below", { active: 1, accum: 0x80 << 8, delta: -0x100, target: 0, value: 0x80 });
        runTick("falling at target", { active: 1, accum: 0, delta: -0x100, target: 0, value: 0 });
        runTick("negative accum", { active: 1, accum: -0x100, delta: -0x40, target: -0x400, value: 0xffff });
        runTick("movement jump", { active: 1, accum: 0x97 << 8, delta: -0x18, target: 0, value: 0x97 });
    });
}
