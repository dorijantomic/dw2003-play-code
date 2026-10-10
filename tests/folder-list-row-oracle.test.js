// Phase 4 oracle: engine/dw3/ui/folder-list-row.ts must match the original
// pro/stcrddek body F0x80088D24 for both the show and the hide path.
//
// The original runs through engine/native with the five widget method slots
// (label +0x114, value +0x118, show +0x148, hide +0x144) stubbed to recorders,
// so the compared result is the ordered call list with its arguments. The body
// has no memory store on either side.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    FOLDER_RECORDS,
    FOLDER_RECORD_STRIDE,
    FOLDER_ROW_LABEL,
    FOLDER_ROW_STRIDE,
    FOLDER_ROW_VALUES,
    FOLDER_SCREEN_ROW_STRIDE,
    FOLDER_SCREEN_VALUES,
    folderListFillRow,
} from "../engine/dw3/ui/folder-list-row.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const folder = new Uint8Array(readFileSync(join(dir, "pro_stcrddek.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });

const ADDRESS = 0x80088d24;
const SCREEN = 0x80160000;
const WIDGETS = 0x80161000;
const WIDGET_BASE = 0x80162000; // 0x200 per widget: slots reach +0x148
const STUBS = [0x0fd76000, 0x0fd76004, 0x0fd76008, 0x0fd7600c, 0x0fd76010];
const SLOT = { label: 0x114, number: 0x118, show: 0x148, hide: 0x144 };

function writeLayout(rt) {
    // Screen values: row 0..1, six values each.
    for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 6; i++) {
            rt.mem.write32(SCREEN + row * FOLDER_SCREEN_ROW_STRIDE + FOLDER_SCREEN_VALUES + i * 4, 0x1000 + row * 0x10 + i);
        }
    }
    // Widget arrays: each row has a label at +8 and six values from +0xC.
    let widget = WIDGET_BASE;
    for (let row = 0; row < 2; row++) {
        const base = WIDGETS + row * FOLDER_ROW_STRIDE;
        rt.mem.write32(base + FOLDER_ROW_LABEL, widget);
        rt.mem.write32(widget + SLOT.label, STUBS[0]);
        // The hide path also calls the label's +0x144, so that slot is live too.
        rt.mem.write32(widget + SLOT.hide, STUBS[3]);
        widget += 0x200;
        for (let i = 0; i < 6; i++) {
            rt.mem.write32(base + FOLDER_ROW_VALUES + i * 4, widget);
            rt.mem.write32(widget + SLOT.number, STUBS[1]);
            rt.mem.write32(widget + SLOT.show, STUBS[2]);
            rt.mem.write32(widget + SLOT.hide, STUBS[3]);
            widget += 0x200;
        }
    }
}

function original(row, show) {
    const entry = { size: folder.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
    const rt = new NativeStageRuntime(folder, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    const calls = [];
    writeLayout(rt);
    for (const addr of STUBS) rt.cpu.setStub(addr, () => 0);
    rt.cpu.setStub(STUBS[0], (c) => {
        calls.push(["setResourceLine", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]);
        return 0;
    });
    rt.cpu.setStub(STUBS[1], (c) => {
        calls.push(["setNumber", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
        return 0;
    });
    rt.cpu.setStub(STUBS[2], (c) => {
        calls.push(["setVisible", c.reg(4) >>> 0, c.reg(5) | 0]);
        return 0;
    });
    rt.cpu.setStub(STUBS[3], (c) => {
        calls.push(["hide", c.reg(4) >>> 0, c.reg(5) | 0]);
        return 0;
    });
    rt.cpu.call(ADDRESS, [SCREEN, WIDGETS, row, show]);
    return calls;
}

function port(row, show) {
    // The port reads the same layout out of a plain object memory.
    const words = new Map();
    const rt = {
        mem: {
            write32: (addr, value) => words.set(addr >>> 0, value >>> 0),
            read32: () => 0,
        },
    };
    // Reuse the interpreter layout by replaying it into a map.
    const layout = originalLayoutWords();
    for (const [addr, value] of layout) words.set(addr, value);
    void rt;
    const calls = [];
    folderListFillRow(
        { read32: (addr) => words.get(addr >>> 0) ?? 0 },
        SCREEN,
        WIDGETS,
        row,
        show,
        {
            widgetSetResourceLine: (w, base, line) => calls.push(["setResourceLine", w >>> 0, base >>> 0, line | 0]),
            widgetSetNumber: (w, flag, value) => calls.push(["setNumber", w >>> 0, flag | 0, value | 0]),
            widgetSetVisible: (w, on) => calls.push(["setVisible", w >>> 0, on | 0]),
            widgetHide: (w, flag) => calls.push(["hide", w >>> 0, flag | 0]),
        },
    );
    return calls;
}

// The same layout the interpreter is given, produced once from a scratch runtime.
function originalLayoutWords() {
    const entry = { size: folder.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
    const rt = new NativeStageRuntime(folder, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    writeLayout(rt);
    const out = [];
    for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 6; i++) {
            out.push([SCREEN + row * FOLDER_SCREEN_ROW_STRIDE + FOLDER_SCREEN_VALUES + i * 4, rt.mem.read32(SCREEN + row * FOLDER_SCREEN_ROW_STRIDE + FOLDER_SCREEN_VALUES + i * 4) >>> 0]);
        }
    }
    let widget = WIDGET_BASE;
    for (let row = 0; row < 2; row++) {
        out.push([WIDGETS + row * FOLDER_ROW_STRIDE + FOLDER_ROW_LABEL, widget >>> 0]);
        widget += 0x200;
        for (let i = 0; i < 6; i++) {
            out.push([WIDGETS + row * FOLDER_ROW_STRIDE + FOLDER_ROW_VALUES + i * 4, widget >>> 0]);
            widget += 0x200;
        }
    }
    return out;
}

test("folderListFillRow matches F0x80088D24 on the show path", () => {
    for (const row of [0, 1]) {
        const a = original(row, 1);
        const b = port(row, 1);
        assert.deepEqual(b, a, `row ${row}`);
        // The label call must carry the row's record address and line -1.
        const label = WIDGET_BASE + row * 7 * 0x200; // 1 label + 6 value structs per row
        assert.deepEqual(a[0], ["setResourceLine", label, FOLDER_RECORDS + row * FOLDER_RECORD_STRIDE, -1]);
        assert.equal(a.length, 1 + 6 * 2);
    }
});

test("folderListFillRow matches F0x80088D24 on the hide path", () => {
    for (const row of [0, 1]) {
        const a = original(row, 0);
        const b = port(row, 0);
        assert.deepEqual(b, a, `row ${row}`);
        assert.equal(a.length, 1 + 6);
        assert.deepEqual(a[0], ["hide", WIDGET_BASE + row * 7 * 0x200, 0]);
    }
});
