// Phase 4 oracle: engine/dw3/ui/native/folder-selection.ts must match the
// original pro/stcrddek bodies the picker calls:
//
//   F0x8008660C folderSelectOddCreate   (the "Edit Folder" grid object)
//   F0x800887D4 folderSelectEvenCreate  (the "Change name" keyboard object)
//   F0x80088634 folderSelectEvenSetName (the name field + blank padding)
//   F0x80088628 folderSelectEvenSetWindow
//   F0x80083594 folderMakePopup         (the closing popup)
//   F0x80083314 folderPopupFadeStart
//   F0x800834E0 folderPopupTick
//
// The factory F0x80014504 and the resident string service F0x8001FCC0 /
// F0x8002525C are deterministic boundaries on the original side and callbacks
// on the port side; everything else is compared: the ordered boundary call
// stream, the factory arguments and every field store.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    folderSelectEvenCreate, folderSelectEvenSetName, folderSelectEvenSetWindow,
    folderSelectOddCreate, folderMakePopup, folderPopupFadeStart, folderPopupTick,
} from "../engine/dw3/ui/native/folder-selection.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stcrddek = new Uint8Array(readFileSync(join(dir, "pro_stcrddek.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stcrddek.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const SOURCE = 0x80151000;
const COPY_STUB = 0x0fd20000;

function runtime() {
    const rt = new NativeStageRuntime(stcrddek, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident, base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function clearObj(rt) {
    for (let i = 0; i < 0x500 / 4; i++) rt.mem.write32(OBJ + i * 4, 0);
}

/** The factory stub: record its arguments and return OBJ. */
function factoryStub(rt, calls) {
    rt.cpu.setStub(0x80014504, (c) => {
        calls.push([c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
        return OBJ;
    });
}

/** The resident string copy + length, as F0x80088634 reaches them. */
function stringStubs(rt, raw) {
    rt.cpu.setStub(0x8001fcc0, (c) => {
        rt.mem.write32((c.reg(4) >>> 0) + 0x8, COPY_STUB);
        return 0;
    });
    rt.cpu.setStub(COPY_STUB, (c) => {
        const dst = c.reg(4) >>> 0;
        const src = c.reg(5) >>> 0;
        for (let i = 0; ; i++) {
            const b = rt.mem.read8(src + i);
            rt.mem.write8(dst + i, b);
            if (b === 0 || i > 0x40) break;
        }
        return 0;
    });
    rt.cpu.setStub(0x8002525c, (c) => {
        const ptr = c.reg(4) >>> 0;
        // F0x8002525C(exe-decomp/c/F0x8002525c.c): count bytes after the first
        // until the terminator.
        let n = 0;
        let at = ptr;
        for (;;) {
            at += 1;
            if (rt.mem.read8(at) === 0) break;
            n += 1;
            if (n > 0x40) break;
        }
        raw.length = n;
        return n;
    });
}

const FIELDS = [0x50, 0x54, 0x58, 0x5c, 0x60, 0x64, 0x94, 0xec, 0xf0];

function compareFields(rt, portObj, what) {
    for (const off of FIELDS) {
        assert.equal(rt.mem.read32(portObj + off) >>> 0, rt.mem.read32(OBJ + off) >>> 0,
            `${what}: field +0x${off.toString(16)}`);
    }
}

test("folderMakePopup matches F0x80083594", () => {
    const rt = runtime();
    const oracleAllocs = [];
    factoryStub(rt, oracleAllocs);
    clearObj(rt);
    rt.cpu.call(0x80083594, []);
    const oracleFields = FIELDS.map((o) => rt.mem.read32(OBJ + o) >>> 0);

    clearObj(rt);
    const portAllocs = [];
    const obj = folderMakePopup(rt.mem, { allocate: (h, s, e) => {
        portAllocs.push([h >>> 0, s | 0, e | 0]);
        return OBJ;
    } });
    assert.equal(obj, OBJ);
    assert.deepEqual(portAllocs, oracleAllocs, "factory arguments");
    assert.deepEqual(portAllocs, [[0x800834e0, 0x68, 0]]);
    assert.deepEqual(FIELDS.map((o) => rt.mem.read32(OBJ + o) >>> 0), oracleFields, "popup fields");
});

test("folderSelectOddCreate matches F0x8008660C", () => {
    const rt = runtime();
    const oracleAllocs = [];
    factoryStub(rt, oracleAllocs);
    clearObj(rt);
    rt.mem.write32(OBJ + 0x50, 0);
    rt.cpu.call(0x8008660c, [0x1234, 0x2]);
    const oracleFields = FIELDS.map((o) => rt.mem.read32(OBJ + o) >>> 0);
    const oracleAlloc = oracleAllocs.slice();

    clearObj(rt);
    const portAllocs = [];
    folderSelectOddCreate(rt.mem, { allocate: (h, s, e) => {
        portAllocs.push([h >>> 0, s | 0, e | 0]);
        return OBJ;
    } }, 0x1234, 0x2);
    assert.deepEqual(portAllocs, oracleAlloc, "factory arguments");
    assert.deepEqual(portAllocs, [[0x80086574, 0x494, 0xd4]]);
    assert.deepEqual(FIELDS.map((o) => rt.mem.read32(OBJ + o) >>> 0), oracleFields, "odd fields");
});

test("folderSelectEvenCreate / set-name / set-window match F0x800887D4..F0x80088628", () => {
    const rt = runtime();
    const oracleAllocs = [];
    factoryStub(rt, oracleAllocs);
    // The name field the keyboard copies: "Ted" in the game's glyph encoding.
    for (const [i, b] of [0x39, 0x1b, 0x1a, 0x00].entries()) rt.mem.write8(SOURCE + i, b);
    clearObj(rt);
    stringStubs(rt, []);
    rt.cpu.call(0x800887d4, [SOURCE]);
    const oracleFields = FIELDS.map((o) => rt.mem.read32(OBJ + o) >>> 0);
    const oracleName = [];
    for (let i = 0; i < 0x94 - 0x78 + 0x10; i += 2) oracleName.push(rt.mem.read16(OBJ + 0x78 + i) & 0xffff);
    const oracleAlloc = oracleAllocs.slice();

    clearObj(rt);
    const portAllocs = [];
    folderSelectEvenCreate(rt.mem, {
        allocate: (h, s, e) => { portAllocs.push([h >>> 0, s | 0, e | 0]); return OBJ; },
        copyString: (dst, src) => {
            for (let i = 0; ; i++) {
                const b = rt.mem.read8(src + i);
                rt.mem.write8(dst + i, b);
                if (b === 0 || i > 0x40) break;
            }
        },
        stringLength: (ptr) => { 
            let n = 0; let at = ptr;
            for (;;) { at += 1; if (rt.mem.read8(at) === 0 || n > 0x40) break; n += 1; }
            return n;
        },
    }, SOURCE);
    assert.deepEqual(portAllocs, oracleAlloc, "factory arguments");
    assert.deepEqual(portAllocs, [[0x800884e8, 0xf4, 0x34]]);
    assert.deepEqual(FIELDS.map((o) => rt.mem.read32(OBJ + o) >>> 0), oracleFields, "even fields");
    const portName = [];
    for (let i = 0; i < 0x94 - 0x78 + 0x10; i += 2) portName.push(rt.mem.read16(OBJ + 0x78 + i) & 0xffff);
    assert.deepEqual(portName, oracleName, "name field + blank padding");
    // The blank glyph pads the ten-character field.
    assert.equal(oracleName[4], 0x4081, "blank glyph in the first empty slot");
});

test("folderSelectEvenSetName matches F0x80088634", () => {
    const rt = runtime();
    for (const [i, b] of [0x15, 0x39, 0x00].entries()) rt.mem.write8(SOURCE + i, b);
    clearObj(rt);
    stringStubs(rt, []);
    rt.mem.write32(OBJ + 0x94, 0xa);
    rt.cpu.call(0x80088634, [OBJ, SOURCE]);
    const oracle = [];
    for (let i = 0; i < 0x94 - 0x78; i += 2) oracle.push(rt.mem.read16(OBJ + 0x78 + i) & 0xffff);

    clearObj(rt);
    rt.mem.write32(OBJ + 0x94, 0xa);
    folderSelectEvenSetName(rt.mem, {
        copyString: (dst, src) => {
            for (let i = 0; ; i++) {
                const b = rt.mem.read8(src + i);
                rt.mem.write8(dst + i, b);
                if (b === 0 || i > 0x40) break;
            }
        },
        stringLength: (ptr) => { 
            let n = 0; let at = ptr;
            for (;;) { at += 1; if (rt.mem.read8(at) === 0 || n > 0x40) break; n += 1; }
            return n;
        },
    }, OBJ, SOURCE);
    const port = [];
    for (let i = 0; i < 0x94 - 0x78; i += 2) port.push(rt.mem.read16(OBJ + 0x78 + i) & 0xffff);
    assert.deepEqual(port, oracle, "name field");

    // Window setter.
    clearObj(rt);
    rt.mem.write32(OBJ + 0x5c, 0x11);
    rt.mem.write32(OBJ + 0x60, 0x22);
    folderSelectEvenSetWindow(rt.mem, OBJ, 0x280, 0x100);
    assert.equal(rt.mem.read32(OBJ + 0x5c) >>> 0, 0x280);
    assert.equal(rt.mem.read32(OBJ + 0x60) >>> 0, 0x100);
});

test("folderPopupFadeStart matches F0x80083314", () => {
    const rt = runtime();
    for (const [direction, frames] of [[0, 0xa], [1, 0xa], [0, 0x10], [1, 0x10]]) {
        const m28 = [];
        clearObj(rt);
        rt.mem.write32(OBJ + 0x28, 0x0fd30000);
        rt.cpu.setStub(0x0fd30000, (c) => { m28.push(c.reg(5) | 0); return 0; });
        rt.cpu.call(0x80083314, [OBJ, direction, frames]);
        const oracleValues = [rt.mem.read32(OBJ + 0x10) >>> 0, rt.mem.read32(OBJ + 0x58) >>> 0,
            rt.mem.read32(OBJ + 0x5c) >>> 0, rt.mem.read32(OBJ + 0x60) | 0];

        clearObj(rt);
        const portCalls = [];
        folderPopupFadeStart(rt.mem, { baseMethod28: (_o, v) => portCalls.push(v | 0), baseMethod38() {}, commitFade() {} },
            OBJ, direction, frames);
        const portValues = [rt.mem.read32(OBJ + 0x10) >>> 0, rt.mem.read32(OBJ + 0x58) >>> 0,
            rt.mem.read32(OBJ + 0x5c) >>> 0, rt.mem.read32(OBJ + 0x60) | 0];
        assert.deepEqual(portValues, oracleValues, `fade ${direction}/${frames} fields`);
        assert.deepEqual(portCalls, m28, `fade ${direction}/${frames} baseMethod28`);
        assert.deepEqual(portCalls, [1]);
    }
});

test("folderPopupTick matches F0x800834E0", () => {
    const rt = runtime();
    const cases = [
        { state: 0, run: 0, dir: 0, value: 0x100, step: 0x100 },
        { state: 0, run: 1, dir: 0, value: 0x100, step: 0x100 },
        { state: 1, run: 0, dir: 0, value: 0x100, step: 0x100 },
        { state: 1, run: 1, dir: 0, value: 0xff00, step: 0x100 },
        { state: 1, run: 1, dir: 0, value: 0xff80, step: 0x100 },
        { state: 1, run: 1, dir: 1, value: 0x80, step: -0x100 },
        { state: 1, run: 1, dir: 1, value: 0x10, step: -0x80 },
        { state: 2, run: 1, dir: 1, value: 0, step: -0x100 },
        { state: 3, run: 1, dir: 0, value: 0, step: 0 },
        { state: 5, run: 1, dir: 0, value: 0, step: 0 },
    ];
    for (const f of cases) {
        const label = `state ${f.state} dir ${f.dir} value ${f.value.toString(16)}`;
        const calls = [];
        clearObj(rt);
        rt.mem.write32(OBJ + 0x0c, f.state);
        rt.mem.write32(OBJ + 0x10, f.run);
        rt.mem.write32(OBJ + 0x58, f.dir);
        rt.mem.write32(OBJ + 0x5c, f.value);
        rt.mem.write32(OBJ + 0x60, f.step | 0);
        rt.mem.write32(OBJ + 0x38, 0x0fd30000);
        rt.cpu.setStub(0x0fd30000, (c) => { calls.push(["m38", c.reg(4) >>> 0]); return 0; });
        rt.cpu.setStub(0x8008339c, (c) => { calls.push(["fade", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
        rt.cpu.call(0x800834e0, [OBJ]);
        const oracle = {
            state: rt.mem.read32(OBJ + 0x0c) | 0, value: rt.mem.read32(OBJ + 0x5c) | 0,
            calls: calls.slice(),
        };

        clearObj(rt);
        const portCalls = [];
        rt.mem.write32(OBJ + 0x0c, f.state);
        rt.mem.write32(OBJ + 0x10, f.run);
        rt.mem.write32(OBJ + 0x58, f.dir);
        rt.mem.write32(OBJ + 0x5c, f.value);
        rt.mem.write32(OBJ + 0x60, f.step | 0);
        folderPopupTick(rt.mem, {
            baseMethod28() {},
            baseMethod38: (o) => portCalls.push(["m38", o >>> 0]),
            commitFade: (o) => portCalls.push(["fade", o >>> 0, o >>> 0]),
        }, OBJ);
        const port = {
            state: rt.mem.read32(OBJ + 0x0c) | 0, value: rt.mem.read32(OBJ + 0x5c) | 0,
            calls: portCalls.slice(),
        };
        assert.deepEqual(port, oracle, label);
    }
});
