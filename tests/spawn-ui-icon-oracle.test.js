// Phase 4 oracle: engine/dw3/ui/spawn-ui-icon.ts must reproduce the whole
// 0x98-byte object the original F0x8001B364 builds, and the six +0x80..+0x94
// method bodies it installs (F0x8001B04C/B068/B07C/B08C/B094/B09C). The original
// constructor and setters run through engine/native from the resident image;
// the port runs on an equivalent zeroing allocator. The factory's secondary
// buffer pointer at +0x24 differs by allocation, so it is compared as non-null
// with its 4 bytes zeroed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    UI_ICON_SIZE,
    spawnUiIcon,
    uiIconSetCycleTicks,
    uiIconSetPos,
    uiIconSetRestTicks,
    uiIconSetUnk60,
    uiIconSetUnk7c,
    uiIconSetVisible,
} from "../engine/dw3/ui/spawn-ui-icon.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const TARGET = 0x1002;
const ORDER = 3;
const X = 0x1d;
const Y = 0x24;
let PORT_HEAP = 0x80190000;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function portHost(rt) {
    return {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = PORT_HEAP;
            PORT_HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
    };
}

function snapshot(rt, obj) {
    const words = [];
    for (let off = 0; off < UI_ICON_SIZE; off += 4) words.push(rt.mem.read32(obj + off) >>> 0);
    return words;
}

function compareObject(label, rt, objA, objB) {
    // The secondary buffer pointer at +0x24 is a heap address.
    const extraA = rt.mem.read32(objA + 0x24) >>> 0;
    const extraB = rt.mem.read32(objB + 0x24) >>> 0;
    assert.notEqual(extraA, 0, `${label}: original extra buffer`);
    assert.notEqual(extraB, 0, `${label}: port extra buffer`);
    for (let i = 0; i < 4; i++) {
        assert.equal(rt.mem.read8(extraA + i), 0, `${label}: original extra byte ${i}`);
        assert.equal(rt.mem.read8(extraB + i), 0, `${label}: port extra byte ${i}`);
    }
    const a = snapshot(rt, objA);
    const b = snapshot(rt, objB);
    a[0x24 / 4] = 0;
    b[0x24 / 4] = 0;
    assert.deepEqual(b, a, label);
}

function buildBoth(rt) {
    const objA = rt.cpu.call(0x8001b364, [TARGET, ORDER, X, Y]) >>> 0;
    PORT_HEAP = 0x80190000;
    const objB = spawnUiIcon(rt.mem, portHost(rt), TARGET, ORDER, X, Y) >>> 0;
    return [objA, objB];
}

test("spawnUiIcon matches F0x8001B364", () => {
    const rt = runtime();
    const [objA, objB] = buildBoth(rt);
    compareObject("constructor", rt, objA, objB);
    // Spot-check the load-bearing fields.
    assert.equal(rt.mem.read32(objA + 0x54), ORDER, "order is a raw word");
    assert.equal(rt.mem.read32(objA + 0x50), TARGET);
    assert.equal(rt.mem.read32(objA + 0x64), 1);
    assert.equal(rt.mem.read32(objA + 0x74), 0x20);
    assert.equal(rt.mem.read32(objA + 0x78), 6);
    assert.equal(rt.mem.read32(objA + 0x48) >>> 0, 0x8001b0a4);

    // Negative and wide values exercise the sign extension of a0/a2/a3 while
    // a1 stays a raw word.
    const rt2 = runtime();
    const a0 = rt2.cpu.call(0x8001b364, [0xffff8000 | 0, -5, -1, 0x7fff]) >>> 0;
    PORT_HEAP = 0x80190000;
    const b0 = spawnUiIcon(rt2.mem, portHost(rt2), 0xffff8000 | 0, -5, -1, 0x7fff) >>> 0;
    compareObject("sign-extension", rt2, a0, b0);
});

const SETTER_CASES = [
    { name: "visible=1", addr: 0x8001b04c, args: [1], port: uiIconSetVisible },
    { name: "visible=0", addr: 0x8001b04c, args: [0], port: uiIconSetVisible },
    { name: "pos", addr: 0x8001b068, args: [0x30, 0x44], port: uiIconSetPos },
    { name: "unk60", addr: 0x8001b07c, args: [7], port: uiIconSetUnk60 },
    { name: "restTicks", addr: 0x8001b08c, args: [0x40], port: uiIconSetRestTicks },
    { name: "cycleTicks", addr: 0x8001b094, args: [0x0a], port: uiIconSetCycleTicks },
    { name: "unk7c", addr: 0x8001b09c, args: [0xff], port: uiIconSetUnk7c },
];

test("spawnUiIcon method bodies match their install slots", () => {
    const rt = runtime();
    for (const c of SETTER_CASES) {
        const [objA, objB] = buildBoth(rt);
        rt.cpu.call(c.addr, [objA, ...c.args]);
        c.port(rt.mem, objB, ...c.args);
        compareObject(c.name, rt, objA, objB);
    }
});
