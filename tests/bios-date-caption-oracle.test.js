// Oracle test for bios_date_caption (pro/stagslct F0x80084B70).
// The function reads 10 bytes from the PS1 BIOS ROM address 0x1FC0012C,
// converts each byte to fullwidth Shift-JIS, byte-swaps into big-endian,
// stores the result in overlay buffer 0x80087194 (NUL at 0x800871A8),
// creates a text element via F0x8001AE38, then positions it at (220, 20)
// and sets its string to the converted buffer.
//
// The MIPS interpreter is the oracle; the TypeScript implementation must
// produce identical memory side-effects and widget method calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stagslct.bin")));
const mkHost = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

// BIOS date caption lives at overlay offset 0x1ec0 = address 0x80084b70
const BIOS_DATE_CAPTION = 0x80084b70;
const BIOS_ROM = 0x1fc0012c;
const BUFFER = 0x80087194;
const BUFFER_NUL = 0x800871a8;
const OBJ = 0x80150000;
const ARG1 = 0x80152000;
const WIDGET_BASE = 0x80160000;
const WIDGET_FN = 0x8001ae38;

// Widget method stub addresses (same pattern as stage-select.test.js)
const STUB = 0x0fda0000;
const M134 = STUB + 0x1c;
const M110 = STUB + 0x14;

const LOG = [];
let made = 0;

function makeRuntime() {
    const rt = new NativeStageRuntime(overlay, entry, mkHost(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    // Stub the text element factory (F0x8001AE38)
    rt.cpu.setStub(WIDGET_FN, (c) => {
        LOG.push(["widget", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const widget = WIDGET_BASE + made * 0x100;
        made += 1;
        // Install method pointers on the widget (same as stage-select.test.js)
        rt.mem.write32(widget + 0x134, M134);
        rt.mem.write32(widget + 0x110, M110);
        return widget;
    });
    // Stub widget->unk134 (position setter: widget, x, y)
    rt.cpu.setStub(M134, (c) => {
        LOG.push(["setPosition", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]);
        return 0;
    });
    // Stub widget->unk110 (string setter: widget, strPtr)
    rt.cpu.setStub(M110, (c) => {
        LOG.push(["setString", c.reg(4) | 0, c.reg(5) | 0]);
        return 0;
    });
    return rt;
}

/** Convert one BIOS ROM byte to fullwidth Shift-JIS, matching the MIPS logic. */
function biosByteToShiftJis(b) {
    if (b >= 0x30 && b <= 0x39) return (b & 0xff) - 0x7de1; // digits
    if (b >= 0x41 && b <= 0x5a) return (b & 0xff) - 0x7de1; // uppercase
    if ((b & 0xff) === 0x2d) return 0x815c; // dash
    return 0x8140; // ideographic space
}

/** Byte-swap a u16 (same as the MIPS: lhu -> srl 8 + sll 8 + addu). */
function swap16(v) {
    const u16 = v & 0xffff;
    return (((u16 >>> 8) & 0xff) + ((u16 & 0xff) << 8)) & 0xffff;
}

test("bios_date_caption converts BIOS ROM bytes and calls widget methods", () => {
    const rt = makeRuntime();
    const mem = rt.mem;

    // Set up first-time flag: obj+0x60 = 0 (not yet initialized)
    mem.write32(OBJ + 0x60, 0);
    // Set up arg1+0x78 = 0 (widget pointer, will be filled by the function)
    mem.write32(ARG1 + 0x78, 0);

    // Seed BIOS ROM with test data: "2003.09.1\0" (10 bytes)
    const testBytes = [0x32, 0x30, 0x30, 0x33, 0x2e, 0x30, 0x39, 0x2e, 0x31, 0x00];
    for (let i = 0; i < 10; i++) {
        mem.write8(BIOS_ROM + i, testBytes[i]);
    }

    LOG.length = 0;
    made = 0;

    // Run the MIPS function
    rt.cpu.call(BIOS_DATE_CAPTION, [OBJ, ARG1], 500);

    // Check: widget was created
    const widgetCreated = LOG.some((e) => e[0] === "widget");
    assert.ok(widgetCreated, "F0x8001AE38 should have been called to create a text element");

    // Check: widget was stored at arg1+0x78
    const widget = mem.read32(ARG1 + 0x78) >>> 0;
    assert.ok(widget !== 0, "arg1+0x78 should contain the widget pointer");

    // Check: first-time flag set
    assert.equal(mem.read32(OBJ + 0x60) | 0, 1, "obj+0x60 should be 1 after first call");

    // Check: buffer contains converted Shift-JIS characters (byte-swapped)
    const expectedBuffer = [];
    for (let i = 0; i < 10; i++) {
        const raw = biosByteToShiftJis(testBytes[i]);
        expectedBuffer.push(swap16(raw));
    }
    for (let i = 0; i < 10; i++) {
        const actual = mem.read16(BUFFER + i * 2) & 0xffff;
        assert.equal(actual, expectedBuffer[i],
            `buffer[${i}] should be 0x${expectedBuffer[i].toString(16)} (from byte 0x${testBytes[i].toString(16)}), got 0x${actual.toString(16)}`);
    }
    // NUL terminator
    assert.equal(mem.read16(BUFFER_NUL) & 0xffff, 0, "NUL terminator at buffer+20");

    // Check: setPosition called with (widget, 0xdc, 0x14) = (220, 20)
    const posCall = LOG.find((e) => e[0] === "setPosition");
    assert.ok(posCall, "setPosition should have been called");
    assert.equal(posCall[1] >>> 0, widget, "setPosition widget arg");
    assert.equal(posCall[2], 0xdc, "setPosition x = 220");
    assert.equal(posCall[3], 0x14, "setPosition y = 20");

    // Check: setString called with (widget, BUFFER)
    const strCall = LOG.find((e) => e[0] === "setString");
    assert.ok(strCall, "setString should have been called");
    assert.equal(strCall[1] >>> 0, widget, "setString widget arg");
    assert.equal(strCall[2] >>> 0, BUFFER, "setString buffer address");
});

test("bios_date_caption is idempotent on second call", () => {
    const rt = makeRuntime();
    const mem = rt.mem;

    // Pre-initialize: obj+0x60 = 1, arg1+0x78 already set
    mem.write32(OBJ + 0x60, 1);
    const fakeWidget = WIDGET_BASE + 0x100;
    mem.write32(fakeWidget + 0x134, M134);
    mem.write32(fakeWidget + 0x110, M110);
    mem.write32(ARG1 + 0x78, fakeWidget);

    // Seed BIOS ROM with different data (should not be re-read)
    for (let i = 0; i < 10; i++) mem.write8(BIOS_ROM + i, 0xff);

    // Clear buffer
    for (let i = 0; i < 22; i++) mem.write8(BUFFER + i, 0);

    LOG.length = 0;
    made = 0;

    // Run the MIPS function
    rt.cpu.call(BIOS_DATE_CAPTION, [OBJ, ARG1], 200);

    // Check: widget was NOT re-created (no call to F0x8001AE38)
    const widgetCreated = LOG.some((e) => e[0] === "widget");
    assert.ok(!widgetCreated, "F0x8001AE38 should NOT be called on second call");

    // Check: first-time flag unchanged
    assert.equal(mem.read32(OBJ + 0x60) | 0, 1, "obj+0x60 should still be 1");

    // Check: buffer should still be empty (not re-written)
    const bufferNonZero = (mem.read32(BUFFER) | 0) !== 0;
    assert.ok(!bufferNonZero, "buffer should remain zeroed on second call");

    // Check: setPosition still called
    const posCall = LOG.find((e) => e[0] === "setPosition");
    assert.ok(posCall, "setPosition should still be called on second call");
    assert.equal(posCall[1] >>> 0, fakeWidget, "setPosition uses the existing widget");

    // Check: setString still called (with the zeroed buffer)
    const strCall = LOG.find((e) => e[0] === "setString");
    assert.ok(strCall, "setString should still be called on second call");
    assert.equal(strCall[2] >>> 0, BUFFER, "setString points to the buffer");
});

test("bios_date_caption Shift-JIS conversion covers all character classes", () => {
    const rt = makeRuntime();
    const mem = rt.mem;

    mem.write32(OBJ + 0x60, 0);
    mem.write32(ARG1 + 0x78, 0);

    // Test: digit '0' (0x30), uppercase 'A' (0x41), dash '-' (0x2d), space ' ' (0x20)
    const testBytes = [0x30, 0x41, 0x2d, 0x20, 0x39, 0x5a, 0x31, 0x42, 0x2e, 0x00];
    for (let i = 0; i < 10; i++) mem.write8(BIOS_ROM + i, testBytes[i]);

    LOG.length = 0;
    made = 0;
    rt.cpu.call(BIOS_DATE_CAPTION, [OBJ, ARG1], 500);

    // Verify each byte's conversion
    for (let i = 0; i < 10; i++) {
        const raw = biosByteToShiftJis(testBytes[i]);
        const expected = swap16(raw);
        const actual = mem.read16(BUFFER + i * 2) & 0xffff;
        assert.equal(actual, expected,
            `byte 0x${testBytes[i].toString(16)}: expected 0x${expected.toString(16)}, got 0x${actual.toString(16)}`);
    }
});
