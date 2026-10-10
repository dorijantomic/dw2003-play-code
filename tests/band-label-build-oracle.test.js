// Phase 4 oracle: engine/dw3/ui/band-label-build.ts bandLabelBuild
// (F0x80089A44) must create the same widgets, invoke the description line's
// +0x160 method at the same point, and write the same block. createTextElement
// is a deterministic boundary stub on the original side and a callback on the
// port side; the +0x160 slot is pre-armed with one method stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { bandLabelBuild } from "../engine/dw3/ui/band-label-build.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const OVERLAY_BASE = 0x80082cb0;

const OBJ = 0x80180000;
const BLOCK_A = 0x80181000;
const BLOCK_B = 0x80181100;
const METHOD_STUB = 0x0fd70000;
const BLOCK_SIZE = 0xac;
const MAX_WIDGETS = 48;

function widgetAddr(k) {
    return (0x80183000 + k * 0x200) >>> 0;
}

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, OVERLAY_BASE, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function seed(rt, target, mode, count) {
    rt.mem.write16(OBJ + 0x50, target & 0xffff);
    rt.mem.write32(OBJ + 0x58, mode >>> 0);
    rt.mem.write32(OBJ + 0x60, count >>> 0);
    for (let i = 0; i <= BLOCK_SIZE; i += 4) {
        rt.mem.write32(BLOCK_A + i, 0xdead);
        rt.mem.write32(BLOCK_B + i, 0xdead);
    }
    for (let k = 0; k < MAX_WIDGETS; k++) rt.mem.write32(widgetAddr(k) + 0x160, METHOD_STUB);
}

test("bandLabelBuild matches F0x80089A44", () => {
    const rt = runtime();
    let oracleEvents = [];
    let oracleCreates = 0;
    rt.cpu.setStub(0x8001ae38, (c) => {
        const w = widgetAddr(oracleCreates++);
        oracleEvents.push(["create", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return w;
    });
    rt.cpu.setStub(METHOD_STUB, (c) => {
        oracleEvents.push(["bf", c.reg(4) >>> 0, c.reg(5) | 0]);
        return 0;
    });

    const cases = [
        { target: 0x1005, mode: 0, count: 0 },
        { target: 0x1005, mode: 0, count: 3 },
        { target: 0xfffe, mode: 0, count: 1 },
        { target: 0x1005, mode: 1, count: 3 },
        { target: 0x0000, mode: 1, count: 0 },
    ];

    for (const c of cases) {
        seed(rt, c.target, c.mode, c.count);
        oracleEvents = [];
        oracleCreates = 0;
        rt.cpu.call(0x80089a44, [OBJ, BLOCK_A]);
        const oracle = oracleEvents.slice();
        const oracleBlock = [];
        for (let i = 0; i <= BLOCK_SIZE; i += 4) oracleBlock.push(rt.mem.read32(BLOCK_A + i) >>> 0);

        // Reset only the port's block; BLOCK_A is the oracle's output.
        for (let i = 0; i <= BLOCK_SIZE; i += 4) rt.mem.write32(BLOCK_B + i, 0xdead);
        const portEvents = [];
        let portCreates = 0;
        const portHost = {
            createTextElement(target, kind, x, y) {
                const w = widgetAddr(portCreates++);
                portEvents.push(["create", target | 0, kind | 0, x | 0, y | 0]);
                return w;
            },
            setWidgetFlagBF(w, v) { portEvents.push(["bf", w >>> 0, v | 0]); },
        };
        bandLabelBuild(rt.mem, OBJ, BLOCK_B, portHost);

        assert.deepEqual(portEvents, oracle, `case ${JSON.stringify(c)}: call sequence`);
        for (let i = 0; i <= BLOCK_SIZE; i += 4) {
            assert.equal(
                rt.mem.read32(BLOCK_B + i) >>> 0,
                oracleBlock[i >> 2],
                `case ${JSON.stringify(c)}: block +0x${i.toString(16)}`,
            );
        }
    }
});
