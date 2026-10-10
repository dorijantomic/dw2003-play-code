// Phase 4 oracle: engine/dw3/ui/window-fold.ts must touch exactly the same fold
// fields and return exactly the same done-flag as the original stitshop pair
// F0x8008C2DC (start) and F0x8008C370 (tick). The screen overlay runs through
// engine/native (the interpreter) as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    FOLD_ACTIVE,
    WINDOW_FOLD_CLOSE_SFX,
    FOLD_DELTA,
    FOLD_DURATION,
    FOLD_FULL,
    WINDOW_FOLD_OPEN_SFX,
    FOLD_VALUE,
    windowFoldStart,
    windowFoldTick,
} from "../engine/dw3/ui/window-fold.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

// Two objects in scratch RAM above the loaded images: A is driven by the
// interpreter, B by the TypeScript port.
const OBJ_A = 0x80150000;
const OBJ_B = 0x80150040;

function runtime() {
    // pro_stitshop loads at its real slot base 0x80082cb0; the resident EXE image
    // sits underneath so the overlay's global calls have their real addresses.
    return new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
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

test("windowFoldStart matches the interpreter (F0x8008C2DC)", () => {
    const rt = runtime();
    for (const duration of [1, 3, 7, 10, 16]) {
        for (const open of [true, false]) {
            initObj(rt, OBJ_A, duration);
            initObj(rt, OBJ_B, duration);
            rt.resetSfx();
            rt.cpu.call(0x8008c2dc, [OBJ_A, open ? 1 : 0]);
            windowFoldStart(rt.mem, OBJ_B, open ? 1 : 0);
            assert.deepEqual(fields(rt, OBJ_A), fields(rt, OBJ_B), `duration ${duration} open ${open}`);
            // The port deliberately does not play sound; the original does, and
            // the host serves it. Assert the exact id the start branch requests.
            assert.deepEqual(rt.sfx, [open ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX], `sfx duration ${duration} open ${open}`);
        }
    }
});

test("windowFoldTick matches the interpreter (F0x8008C370)", () => {
    const rt = runtime();
    for (const duration of [1, 3, 7, 10, 16]) {
        for (const open of [true, false]) {
            initObj(rt, OBJ_A, duration);
            initObj(rt, OBJ_B, duration);
            rt.cpu.call(0x8008c2dc, [OBJ_A, open ? 1 : 0]);
            windowFoldStart(rt.mem, OBJ_B, open ? 1 : 0);
            let done = 0;
            // Walk well past the fold so the post-completion "already inactive
            // returns 1" branch is compared too.
            for (let tick = 0; tick < duration + 5; tick++) {
                const oracleRet = rt.cpu.call(0x8008c370, [OBJ_A]) | 0;
                const portRet = windowFoldTick(rt.mem, OBJ_B);
                assert.equal(portRet, oracleRet, `duration ${duration} open ${open} tick ${tick} return`);
                assert.deepEqual(fields(rt, OBJ_A), fields(rt, OBJ_B), `duration ${duration} open ${open} tick ${tick} state`);
                if (oracleRet === 1) done++;
            }
            // Opening reaches 0x1000; closing reaches 0.
            assert.equal(rt.mem.read32(OBJ_A + FOLD_VALUE), open ? FOLD_FULL : 0, `end value open ${open}`);
            assert.equal(rt.mem.read32(OBJ_A + FOLD_ACTIVE), 0, `inactive at end open ${open}`);
            assert.ok(done >= 1, `fold completed open ${open}`);
        }
    }
});

test("windowFoldTick on an inactive tween leaves it untouched and returns 1", () => {
    const rt = runtime();
    initObj(rt, OBJ_A, 10);
    initObj(rt, OBJ_B, 10);
    // active = 0 already (sentinels are nonzero, so clear explicitly).
    rt.mem.write32(OBJ_A + FOLD_ACTIVE, 0);
    rt.mem.write32(OBJ_B + FOLD_ACTIVE, 0);
    const oracleRet = rt.cpu.call(0x8008c370, [OBJ_A]) | 0;
    const portRet = windowFoldTick(rt.mem, OBJ_B);
    assert.equal(portRet, 1);
    assert.equal(oracleRet, 1);
    assert.deepEqual(fields(rt, OBJ_A), fields(rt, OBJ_B));
});
