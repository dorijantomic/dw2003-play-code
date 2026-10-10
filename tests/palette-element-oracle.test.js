// Phase 4 oracle: engine/dw3/ui/country-palette.ts's palette element pair must
// match pro/cnty_sel's F0x80083474 (the frame setter leaf) and F0x80083594 (the
// creator thunk). Both originals run through engine/native on the shipped
// pro_cnty_sel.bin + resident.bin with the task-object allocator stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    COUNTRY_PALETTE_ELEMENT_FRAME_FN, COUNTRY_PALETTE_ELEMENT_FRAME_SLOT,
    COUNTRY_PALETTE_ELEMENT_HANDLER, COUNTRY_PALETTE_ELEMENT_SIZE,
    createPaletteElement, paletteElementSetFrame,
} from "../engine/dw3/ui/country-palette.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cnty_sel.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ELEMENT = 0x80180000;
const ALLOC_STUB = 0x0fe50000;

let EVENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(ALLOC_STUB, (c) => {
        EVENTS.push(["alloc", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return ELEMENT;
    });
    rt.cpu.setStub(0x80014504, (c) => {
        EVENTS.push(["alloc", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return ELEMENT;
    });
    return rt;
}

const rt = runtime();

function seedElement() {
    EVENTS = [];
    for (let i = 0; i < COUNTRY_PALETTE_ELEMENT_SIZE; i += 4) rt.mem.write32(ELEMENT + i, 0xdeadbeef);
}

test("paletteElementSetFrame matches F0x80083474", () => {
    for (const frame of [0, 1, 7, -1, 0x1234, -0x8000, 0x7fff]) {
        seedElement();
        rt.cpu.call(0x80083474, [ELEMENT, frame | 0]);
        const oracle = rt.mem.read16(ELEMENT + 0x54);
        const oracleHigh = rt.mem.read16(ELEMENT + 0x56);

        seedElement();
        paletteElementSetFrame(rt.mem, ELEMENT, frame | 0);
        assert.equal(rt.mem.read16(ELEMENT + 0x54), oracle, `frame ${frame}`);
        assert.equal(rt.mem.read16(ELEMENT + 0x56), oracleHigh, `frame ${frame}: +0x56 untouched`);
    }
});

test("createPaletteElement matches F0x80083594", () => {
    seedElement();
    const oracleRet = rt.cpu.call(0x80083594, []);
    const oracleEvents = EVENTS.map((e) => e.map((v) => v | 0));
    const oracleSlot = rt.mem.read32(ELEMENT + COUNTRY_PALETTE_ELEMENT_FRAME_SLOT) >>> 0;

    seedElement();
    const ret = createPaletteElement(rt.mem, {
        allocate(handler, size, slot) {
            EVENTS.push(["alloc", handler >>> 0, size >>> 0, slot >>> 0]);
            return ELEMENT;
        },
    });
    assert.deepEqual(EVENTS.map((e) => e.map((v) => v | 0)), oracleEvents, "allocator call");
    assert.equal(rt.mem.read32(ELEMENT + COUNTRY_PALETTE_ELEMENT_FRAME_SLOT) >>> 0, oracleSlot, "+0x5C slot");
    assert.equal(oracleSlot, COUNTRY_PALETTE_ELEMENT_FRAME_FN, "the installed frame setter");
    assert.equal(ret >>> 0, oracleRet >>> 0, "return value");
    assert.equal(oracleEvents[0][1] >>> 0, COUNTRY_PALETTE_ELEMENT_HANDLER, "handler");
    assert.equal(oracleEvents[0][2] >>> 0, COUNTRY_PALETTE_ELEMENT_SIZE, "size");
});
