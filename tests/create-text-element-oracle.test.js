// Phase 4 oracle: engine/dw3/ui/create-text-element.ts must build the same
// 0x174-byte text widget the original F0x8001AE38 builds. The resident image
// runs through engine/native as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    FONT_TABLE_CELL,
    TEXT_ELEMENT_SIZE,
    createTextElement,
} from "../engine/dw3/ui/create-text-element.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const PORT_HEAP = 0x80150000;

function runtime() {
    return new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

function portAlloc() {
    let next = PORT_HEAP;
    return {
        alloc(size) {
            const p = next;
            next += (size + 0xf) & ~0xf;
            return p;
        },
    };
}

function bytes(rt, base, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(rt.mem.read8(base + i));
    return out;
}

test("createTextElement matches the interpreter (F0x8001AE38)", () => {
    const rt = runtime();
    assert.equal(rt.mem.read32(FONT_TABLE_CELL) >>> 0, 0x8004dd74, "font table cell");
    const cases = [
        [0x1000, 1, 0x37, 0x24],
        [0x1005, 2, 0x83, 0x0e],
        [0x1000, 3, -1, -1],
        [0x1000, 0, 5, 6],
        [0x1000, 4, 5, 6],
        [0x1000, 1, 0x8000, 0x7fff],
        [-1, 1, 0, 0],
        [0x8000, 5, 0x9b, 0x60],
    ];
    for (const [target, kind, x, y] of cases) {
        const oracle = rt.cpu.call(0x8001ae38, [target, kind, x, y]) >>> 0;
        assert.notEqual(oracle, 0, `oracle ptr ${target}/${kind}`);
        const port = createTextElement(rt.mem, portAlloc(), target, kind, x, y) >>> 0;
        assert.notEqual(port, 0, `port ptr ${target}/${kind}`);
        assert.deepEqual(
            bytes(rt, port, TEXT_ELEMENT_SIZE),
            bytes(rt, oracle, TEXT_ELEMENT_SIZE),
            `object target=${target} kind=${kind} x=${x} y=${y}`,
        );
    }
});

test("createTextElement clamps the font kind to 1,2,3", () => {
    const rt = runtime();
    for (const [kind, expectedKind] of [[0, 1], [1, 1], [2, 2], [3, 3], [4, 1], [-1, 1], [0x100, 1]]) {
        const oracle = rt.cpu.call(0x8001ae38, [0x1000, kind, 0, 0]) >>> 0;
        const port = createTextElement(rt.mem, portAlloc(), 0x1000, kind, 0, 0) >>> 0;
        const fontBase = rt.mem.read32(FONT_TABLE_CELL) >>> 0;
        // +0x50 is base + kind*0x18; the port must land on the same record.
        assert.equal(rt.mem.read32(port + 0x50) >>> 0, fontBase + expectedKind * 0x18, `kind ${kind}`);
        assert.deepEqual(bytes(rt, port, TEXT_ELEMENT_SIZE), bytes(rt, oracle, TEXT_ELEMENT_SIZE), `kind ${kind}`);
    }
});
