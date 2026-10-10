// Phase 4 oracle: engine/dw3/ui/task-registration.ts must match the three
// overlay create thunks F0x80085EA4 (stagslct), F0x8008499C (shocktst) and
// F0x80084D48 (soundtst). Each original runs through engine/native with
// F0x80014504 stubbed to record its handler/size/widget arguments.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    stageSelectMenuCreate,
    shockTestCreate,
    soundTestCreate,
} from "../engine/dw3/ui/task-registration.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const OBJ = 0x80180000;

function runThunk(binName, addr) {
    const overlay = new Uint8Array(readFileSync(join(dir, binName)));
    const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0);
    rt.cpu.gp = 0x8005cb50;
    const events = [];
    rt.cpu.setStub(0x80014504, (c) => {
        events.push([c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return OBJ;
    });
    const ret = rt.cpu.call(addr, []) >>> 0;
    return { events, ret };
}

function compareThunk(label, binName, addr, port) {
    const oracle = runThunk(binName, addr);
    const events = [];
    const ret = port({
        allocTask(handler, selfSize, widgetSize) {
            events.push([handler >>> 0, selfSize >>> 0, widgetSize >>> 0]);
            return OBJ;
        },
    });
    assert.equal(ret, oracle.ret, `${label}: return`);
    assert.deepEqual(events, oracle.events, `${label}: alloc args`);
}

test("stageSelectMenuCreate matches F0x80085EA4", () => {
    compareThunk("stagslct", "pro_stagslct.bin", 0x80085ea4, stageSelectMenuCreate);
});

test("shockTestCreate matches F0x8008499C", () => {
    compareThunk("shocktst", "pro_shocktst.bin", 0x8008499c, shockTestCreate);
});

test("soundTestCreate matches F0x80084D48", () => {
    compareThunk("soundtst", "pro_soundtst.bin", 0x80084d48, soundTestCreate);
});
