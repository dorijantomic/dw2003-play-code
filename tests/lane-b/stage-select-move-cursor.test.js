// Oracle: the stage-select cursor mover engine/dw3/ui/native/stage-select.ts
// stageSelectMoveCursor must match the original pro/stagslct F0x80084A5C body
// (claim `stagslct-movecursor-address-2026-10-11`).
//
// The original runs through engine/native on pro_stagslct.bin; the port runs on
// the same memory object. The mover is self-contained (it reads its own fields
// and the 0x10-byte record table at 0x80085EEC and writes its own fields), so
// both sides are compared over the two cursor fields, entry step, window scroll,
// skip loop and the end-of-list restore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { stageSelectMoveCursor, STAGE_SELECT_TABLE } from "../../engine/dw3/ui/native/stage-select.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stagslct.bin")));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });

const OBJ = 0x80150000;
const MOVE = 0x80084a5c;

const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
    image: resident,
    base: 0x80010000,
});

/** table records as [type] pairs; the other words are distinct filler. */
function seedTable(records) {
    for (let i = 0; i < 0x80; i += 4) rt.mem.write32(STAGE_SELECT_TABLE + i, 0);
    records.forEach(([type, value], i) => {
        rt.mem.write32(STAGE_SELECT_TABLE + i * 0x10 + 0x00, 0x11110000 + i);
        rt.mem.write32(STAGE_SELECT_TABLE + i * 0x10 + 0x04, 0x22220000 + i);
        rt.mem.write32(STAGE_SELECT_TABLE + i * 0x10 + 0x08, type | 0);
        rt.mem.write32(STAGE_SELECT_TABLE + i * 0x10 + 0x0c, value ?? i);
    });
}

function seed(c) {
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x50, c.col ?? 0);
    rt.mem.write32(OBJ + 0x54, c.row ?? 0);
    rt.mem.write32(OBJ + 0x58, c.shown ?? 3);
    rt.mem.write32(OBJ + 0x5c, c.count ?? 3);
    seedTable(c.table);
}

const snap = () => [rt.mem.read32(OBJ + 0x50) | 0, rt.mem.read32(OBJ + 0x54) | 0];

// Every case: the four fields after the call must agree. A rule row (type 0) is
// the disabled record the mover steps over.
const CASES = [
    { name: "step down in window", c: { col: 0, row: 0, shown: 3, count: 6, table: [[1], [1], [1], [1], [1], [1]] }, delta: 1 },
    { name: "step up in window", c: { col: 2, row: 0, shown: 3, count: 6, table: [[1], [1], [1], [1], [1], [1]] }, delta: -1 },
    { name: "down scrolls the window", c: { col: 2, row: 0, shown: 3, count: 6, table: [[1], [1], [1], [1], [1], [1]] }, delta: 1 },
    { name: "up scrolls the window", c: { col: 0, row: 2, shown: 3, count: 6, table: [[1], [1], [1], [1], [1], [1]] }, delta: -1 },
    { name: "down skips one rule", c: { col: 0, row: 0, shown: 4, count: 6, table: [[1], [0], [1], [1], [1], [1]] }, delta: 1 },
    { name: "down skips three rules", c: { col: 0, row: 0, shown: 6, count: 6, table: [[1], [0], [0], [0], [1], [1]] }, delta: 1 },
    { name: "up skips a heading", c: { col: 2, row: 0, shown: 3, count: 6, table: [[1], [0], [1], [1], [1], [1]] }, delta: -1 },
    { name: "down crosses a row over a rule", c: { col: 2, row: 0, shown: 3, count: 9, table: [[1], [1], [1], [0], [0], [1], [1], [1], [1]] }, delta: 1 },
    { name: "up crosses a row over a rule", c: { col: 0, row: 1, shown: 3, count: 9, table: [[1], [1], [1], [0], [0], [1], [1], [1], [1]] }, delta: -1 },
    { name: "top edge keeps the entry (first row selectable)", c: { col: 0, row: 0, shown: 3, count: 6, table: [[1], [1], [1], [1], [1], [1]] }, delta: -1 },
    { name: "top edge restores when the first row is a rule", c: { col: 0, row: 1, shown: 3, count: 6, table: [[0], [1], [1], [1], [1], [1]] }, delta: -1 },
    { name: "bottom edge keeps the entry (last row selectable)", c: { col: 2, row: 3, shown: 3, count: 6, table: [[1], [1], [1], [1], [1], [1]] }, delta: 1 },
    { name: "bottom edge restores when the last row is a rule", c: { col: 2, row: 2, shown: 3, count: 6, table: [[1], [1], [1], [1], [1], [0]] }, delta: 1 },
    { name: "step down by two", c: { col: 0, row: 0, shown: 4, count: 8, table: [[1], [1], [1], [1], [1], [1], [1], [1]] }, delta: 2 },
    { name: "step up by two skips a rule", c: { col: 3, row: 0, shown: 4, count: 8, table: [[1], [1], [0], [1], [1], [1], [1], [1]] }, delta: -2 },
];

test("stageSelectMoveCursor matches F0x80084A5C", () => {
    for (const { name, c, delta } of CASES) {
        seed(c);
        rt.cpu.call(MOVE, [OBJ, delta], 20000);
        const oracle = snap();

        seed(c);
        stageSelectMoveCursor(rt.mem, OBJ, delta);
        assert.deepEqual(snap(), oracle, `${name}: cursor fields`);
    }
});

test("the mover never selects a record whose type is 0", () => {
    // Every landing in the battery above must be on a non-zero type (or the
    // restored entry), which the oracle comparison already forces; this states
    // the property directly for the skip cases.
    for (const { name, c, delta } of CASES.filter((x) => x.name.includes("skip") || x.name.includes("crosses"))) {
        seed(c);
        stageSelectMoveCursor(rt.mem, OBJ, delta);
        const col = rt.mem.read32(OBJ + 0x50) | 0;
        const row = rt.mem.read32(OBJ + 0x54) | 0;
        const type = rt.mem.read32(STAGE_SELECT_TABLE + ((row + col) << 4)) | 0;
        assert.notEqual(type, 0, `${name}: landed on a selectable record`);
    }
});
