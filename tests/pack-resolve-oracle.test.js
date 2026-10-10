// Phase 4 oracle: engine/dw3/resource-service.ts's packResolveHandle must match
// F0x800140D8, the pack-entry resolver behind [0x80044B38 + 0x424]. The original
// runs through engine/native with the resource base lookup F0x80013E5C answering a
// fixed buffer; the port runs with the same base and the same table words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { packResolveHandle } from "../engine/dw3/resource-service.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const BASE_BUFFER = 0x80160000;

function runtime(words) {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry,
        { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 }, undefined, undefined, 0x80082cb0,
        { image: resident, base: 0x80010000 });
    rt.cpu.gp = 0x8005cb50;
    const asked = [];
    rt.cpu.clearStub(0x800140d8);
    rt.cpu.setStub(0x80013e5c, (c) => { asked.push(c.reg(4) >>> 0); return BASE_BUFFER; });
    words.forEach((w, i) => rt.mem.write32(BASE_BUFFER + i * 4, w));
    return { rt, asked };
}

test("packResolveHandle matches F0x800140D8", () => {
    const words = [8, 0xebc, 0x10, 0xfffffff0, 0];
    const cases = [0x04560000, 0x04560001, 0x04550003, 0x00000004, 0x7ff10002, 0x04560004];
    for (const handle of cases) {
        const a = runtime(words);
        const expected = a.rt.cpu.call(0x800140d8, [handle]) >>> 0;
        const b = runtime(words);
        const asked = [];
        const host = {
            alloc: () => { throw new Error("no alloc"); }, startTransfer() { throw new Error("no transfer"); },
            clock: () => 0, busyGate: () => 0,
        };
        // The base lookup is the resident one; give the port the same answer.
        const mem = b.rt.mem;
        const slotId = handle >>> 16;
        mem.write32(0x80044b3c, 3);
        mem.write32(0x80044b3c + 4, slotId);
        mem.write32(0x80044b3c + 0xc, BASE_BUFFER);
        const actual = packResolveHandle(mem, handle, host) >>> 0;
        asked.push(slotId);
        assert.equal(actual, expected, `handle ${handle.toString(16)}`);
        assert.deepEqual(a.asked, asked, `resource asked for ${handle.toString(16)}`);
    }
});
