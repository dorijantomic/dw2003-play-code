// Phase 4 oracle: the shared fold-tween port
// engine/dw3/ui/window-fold.ts windowFoldStart/windowFoldTick must match every
// executed family member on the screen port, not only the stitshop pair. The
// canonical family doc (docs/research/ui/window-fold-tween-homolog-family-
// 2026-08-04.md) fingerprints 15 start + 17 tick homologues; this test drives the
// ones the coverage report marks executed on booted roots.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    FOLD_ACTIVE,
    FOLD_DELTA,
    FOLD_DURATION,
    FOLD_FULL,
    FOLD_VALUE,
    WINDOW_FOLD_CLOSE_SFX,
    WINDOW_FOLD_OPEN_SFX,
    windowFoldStart,
    windowFoldTick,
} from "../engine/dw3/ui/window-fold.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });

const OBJ_A = 0x80150000;
const OBJ_B = 0x80150040;

const FAMILY = [
    { module: "pro/stcrdabm", file: "pro_stcrdabm.bin", start: 0x800858a0, tick: 0x80085934 },
    { module: "pro/stcrddek", file: "pro_stcrddek.bin", start: 0x8008a2d8, tick: 0x8008a36c },
    { module: "pro/stcrdshp", file: "pro_stcrdshp.bin", start: 0x80088fb4, tick: 0x80089048 },
    { module: "pro/stdgname", file: "pro_stdgname.bin", start: 0x80083378, tick: 0x8008340c },
    { module: "pro/stplnmet", file: "pro_stplnmet.bin", start: 0x80083d70, tick: 0x80083e04 },
    { module: "pro/stdgname", file: "pro_stdgname.bin", start: 0x80086730, tick: 0x800867c4 },
    { module: "pro/stfgtrep", file: "pro_stfgtrep.bin", start: 0x80085c90, tick: 0x80085d24 },
    { module: "pro/stgdglab", file: "pro_stgdglab.bin", start: 0x8008f22c, tick: 0x8008f2c0 },
    { module: "pro/stgtrain", file: "pro_stgtrain.bin", start: 0x8008b8fc, tick: 0x8008b990 },
    { module: "pro/ststatus", file: "pro_ststatus.bin", start: 0x80099d5c, tick: 0x80099df0 },
    { module: "pro/stgmcard", file: "pro_stgmcard.bin", start: 0x80087edc, tick: 0x80087f70 },
];

function runtimeFor(file) {
    const overlay = new Uint8Array(readFileSync(join(dir, file)));
    const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
    return new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

function initObj(rt, obj, duration) {
    rt.mem.write32(obj + FOLD_DURATION, duration);
    rt.mem.write32(obj + FOLD_DELTA, 0xdeadbeef);
    rt.mem.write32(obj + FOLD_VALUE, 0xdeadbeef);
    rt.mem.write32(obj + FOLD_ACTIVE, 0xdeadbeef);
}

function fields(rt, obj) {
    return [
        rt.mem.read32(obj + FOLD_DELTA),
        rt.mem.read32(obj + FOLD_VALUE),
        rt.mem.read32(obj + FOLD_ACTIVE),
    ];
}

for (const f of FAMILY) {
    test(`${f.module} fold start ${f.start.toString(16)} matches windowFoldStart`, () => {
        const rt = runtimeFor(f.file);
        for (const duration of [1, 3, 7, 10, 16]) {
            for (const open of [true, false]) {
                initObj(rt, OBJ_A, duration);
                initObj(rt, OBJ_B, duration);
                rt.resetSfx();
                rt.cpu.call(f.start, [OBJ_A, open ? 1 : 0]);
                windowFoldStart(rt.mem, OBJ_B, open ? 1 : 0);
                assert.deepEqual(fields(rt, OBJ_A), fields(rt, OBJ_B), `${f.module} duration ${duration} open ${open}`);
                assert.deepEqual(rt.sfx, [open ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX], `${f.module} sfx`);
            }
        }
    });

    test(`${f.module} fold tick ${f.tick.toString(16)} matches windowFoldTick`, () => {
        const rt = runtimeFor(f.file);
        for (const duration of [1, 3, 7, 10, 16]) {
            for (const open of [true, false]) {
                initObj(rt, OBJ_A, duration);
                initObj(rt, OBJ_B, duration);
                rt.cpu.call(f.start, [OBJ_A, open ? 1 : 0]);
                windowFoldStart(rt.mem, OBJ_B, open ? 1 : 0);
                for (let t = 0; t < duration + 5; t++) {
                    const oracleRet = rt.cpu.call(f.tick, [OBJ_A]) | 0;
                    const portRet = windowFoldTick(rt.mem, OBJ_B);
                    assert.equal(portRet, oracleRet, `${f.module} duration ${duration} open ${open} tick ${t} return`);
                    assert.deepEqual(fields(rt, OBJ_A), fields(rt, OBJ_B), `${f.module} duration ${duration} open ${open} tick ${t}`);
                }
                assert.equal(rt.mem.read32(OBJ_A + FOLD_VALUE), open ? FOLD_FULL : 0, `${f.module} end value`);
                assert.equal(rt.mem.read32(OBJ_A + FOLD_ACTIVE), 0, `${f.module} inactive at end`);
            }
        }
    });
}
