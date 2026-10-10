// Phase 4 oracle: engine/dw3/ui/repeat-callback.ts must match the original
// family bodies F0x80083780 (pro/stcrdabm) and F0x80085CD8 (pro/stcrdshp).
//
// The original runs through engine/native (the interpreter) with its two
// boundaries stubbed: the object's own +0x3C method and the free-running tick
// word [0x8004DF98]. Both sides see the same object fields and the same tick
// sequence, so the compared result is the field writes plus the ordered calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { REPEAT_CALLBACK_FIELDS, repeatCallbackWithDelay } from "../engine/dw3/ui/repeat-callback.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });

const OBJ = 0x80150000;
const M3C_STUB = 0x0fd75108;
const TIME_STUB = 0x0fd75200;

const CASES = [
    { state: 0, counter: 5, stamp: 100, now: 200 },
    { state: 1, counter: 5, stamp: 100, now: 200 },
    { state: 1, counter: 1, stamp: 7, now: 8 },
    { state: 1, counter: 0, stamp: 7, now: 8 },
    { state: 2, counter: 3, stamp: 100, now: 101 },
    { state: 2, counter: 3, stamp: 100, now: 102 },
    { state: 2, counter: 3, stamp: 100, now: 105 },
    { state: 3, counter: 3, stamp: 100, now: 200 },
    { state: 4, counter: 3, stamp: 100, now: 200 },
];

const FIELDS = ["next", "state", "stamp", "counter"];

function snapshot(rt) {
    const out = {};
    for (const f of FIELDS) out[f] = rt.mem.read32(OBJ + REPEAT_CALLBACK_FIELDS[f]) >>> 0;
    return out;
}

function original(address, image, kase) {
    const entry = { size: image.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
    const rt = new NativeStageRuntime(image, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    const calls = [];
    rt.cpu.setStub(M3C_STUB, () => {
        calls.push("slot3C");
        return 0;
    });
    rt.cpu.setStub(TIME_STUB, () => kase.now);
    rt.mem.write32(0x8004df98, TIME_STUB);
    rt.mem.write32(OBJ + 0x3c, M3C_STUB);
    rt.mem.write32(OBJ + REPEAT_CALLBACK_FIELDS.state, kase.state);
    rt.mem.write32(OBJ + REPEAT_CALLBACK_FIELDS.counter, kase.counter);
    rt.mem.write32(OBJ + REPEAT_CALLBACK_FIELDS.stamp, kase.stamp);
    rt.cpu.call(address, [OBJ]);
    return { mem: snapshot(rt), calls };
}

function port(kase) {
    const mem = new Uint32Array(0x100 / 4);
    const base = OBJ;
    const read32 = (addr) => mem[(addr - base) >> 2] | 0;
    const write32 = (addr, value) => {
        mem[(addr - base) >> 2] = value >>> 0;
    };
    const calls = [];
    write32(OBJ + REPEAT_CALLBACK_FIELDS.state, kase.state);
    write32(OBJ + REPEAT_CALLBACK_FIELDS.counter, kase.counter);
    write32(OBJ + REPEAT_CALLBACK_FIELDS.stamp, kase.stamp);
    repeatCallbackWithDelay({ read32, write32 }, OBJ, {
        callSlot3C: () => calls.push("slot3C"),
        now: () => kase.now,
    });
    const out = {};
    for (const f of FIELDS) out[f] = read32(OBJ + REPEAT_CALLBACK_FIELDS[f]) >>> 0;
    return { mem: out, calls };
}

for (const [module, address, file] of [
    ["pro/stcrdabm", 0x80083780, "pro_stcrdabm.bin"],
    ["pro/stcrdshp", 0x80085cd8, "pro_stcrdshp.bin"],
]) {
    test(`repeatCallbackWithDelay matches ${module} 0x${address.toString(16)}`, () => {
        const image = new Uint8Array(readFileSync(join(dir, file)));
        for (const kase of CASES) {
            const a = original(address, image, kase);
            const b = port(kase);
            assert.deepEqual(b.mem, a.mem, `fields for ${JSON.stringify(kase)}`);
            assert.deepEqual(b.calls, a.calls, `calls for ${JSON.stringify(kase)}`);
        }
        // The counter-0 branch must move the grid on without calling or stamping.
        const stopped = port({ state: 1, counter: 0, stamp: 7, now: 8 });
        assert.equal(stopped.mem.next, 3);
        assert.equal(stopped.mem.stamp, 7);
        assert.deepEqual(stopped.calls, []);
    });
}
