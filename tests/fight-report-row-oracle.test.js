// Phase 4 oracle: engine/dw3/ui/fight-report-row.ts reportRowFill (F0x80083404)
// must make the same ordered calls as the original. The original runs through
// engine/native with the save-context cells, the stat-name table and every
// widget method stubbed; the port runs through the same recorders.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { reportRowFill } from "../engine/dw3/ui/fight-report-row.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stfgtrep = new Uint8Array(readFileSync(join(dir, "pro_stfgtrep.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stfgtrep.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ROW = 0x80180000;
const BLOCK = 0x80181000;
const HANDLE = 0x80190000;
const STATREC = 0x80190100;
const SOURCE = 0x80190200;
const WIDGET_BASE = 0x80182000;
const STUBS = {
    roster: 0x0fdd0000, handle: 0x0fdd0010, copyRow: 0x0fdd0020, copyStat: 0x0fdd0030,
    resolve: 0x0fdd0040, stat: 0x0fdd0050,
};
const WIDGET_METHODS = {
    0x800194e8: "setLine0", 0x800195b0: "setNumber", 0x8001a204: "glyph",
    0x8001a23c: "flag", 0x8001a25c: "measure",
};
const ARITY = {
    roster: 1, handle: 1, copyRow: 2, copyStat: 3, resolve: 1, stat: 1,
    setLine0: 3, setNumber: 3, glyph: 3, flag: 2, measure: 2,
};
const STAT_IDS = [5, 3, 9];

let EVENTS = [];

function widgetAddr(k) {
    return (WIDGET_BASE + k * 0x200) >>> 0;
}

function runtime() {
    const rt = new NativeStageRuntime(stfgtrep, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8005cca8, 0x40);
    rt.cpu.setStub(STUBS.roster, (c) => { EVENTS.push(["roster", c.reg(4)]); return c.reg(4) | 0; });
    rt.mem.write32(0x8004b44c, STUBS.roster);
    rt.cpu.setStub(STUBS.handle, (c) => { EVENTS.push(["handle", c.reg(4)]); return HANDLE; });
    rt.mem.write32(0x8004b484, STUBS.handle);
    rt.cpu.setStub(STUBS.copyRow, (c) => {
        EVENTS.push(["copyRow", c.reg(4), c.reg(5)]);
        const dest = c.reg(5) >>> 0;
        for (let i = 0; i < 3; i++) rt.mem.write16(dest + 2 * i, STAT_IDS[i]);
        return 0;
    });
    rt.mem.write32(0x8004b46c, STUBS.copyRow);
    rt.cpu.setStub(STUBS.copyStat, (c) => { EVENTS.push(["copyStat", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.mem.write32(0x8004b47c, STUBS.copyStat);
    rt.cpu.setStub(STUBS.resolve, (c) => { EVENTS.push(["resolve", c.reg(4)]); return SOURCE; });
    rt.mem.write32(0x80044f4c, STUBS.resolve);
    rt.cpu.setStub(STUBS.stat, (c) => { EVENTS.push(["stat", c.reg(4)]); return STATREC; });
    rt.mem.write32(0x8005cca0, STUBS.stat);
    for (const [addr, name] of Object.entries(WIDGET_METHODS)) {
        rt.cpu.setStub(Number(addr), (c) => {
            EVENTS.push([name, c.reg(4), c.reg(5), c.reg(6)]);
            return 0;
        });
    }
    return rt;
}

const rt = runtime();

function armBlock() {
    for (let k = 0; k < 11; k++) {
        const w = widgetAddr(k);
        rt.mem.write32(BLOCK + k * 4, w);
        rt.mem.write32(w + 0x114, 0x800194e8);
        rt.mem.write32(w + 0x118, 0x800195b0);
        rt.mem.write32(w + 0x140, 0x8001a204);
        rt.mem.write32(w + 0x144, 0x8001a23c);
        rt.mem.write32(w + 0x148, 0x8001a25c);
    }
}

function seed(o) {
    EVENTS = [];
    armBlock();
    for (let i = 0; i < 0x140; i += 4) rt.mem.write32(ROW + i, 0);
    rt.mem.write32(ROW + 0x5c, o.member ?? 0);
    rt.mem.write32(ROW + 0x138, o.value ?? 12345);
    rt.mem.write8(ROW + 0xd6, o.statByte ?? 0x80);
    rt.mem.write16(HANDLE + 0x1c, o.handle16 ?? 0x1234);
    rt.mem.write8(STATREC + 0x55, o.nameIndex ?? 7);
}

function norm(evs) {
    return evs.map(([name, ...args]) => [name, ...args.slice(0, ARITY[name]).map((v) => v >>> 0)]);
}

function runCase(label, show, o = {}) {
    seed(o);
    rt.cpu.call(0x80083404, [ROW, BLOCK, show]);
    const oracleEvents = norm(EVENTS.slice());

    seed(o);
    const portHost = {
        rosterSlot(position) { EVENTS.push(["roster", position | 0]); return position | 0; },
        rosterHandle(slot) { EVENTS.push(["handle", slot | 0]); return HANDLE; },
        copyRowStats(slot, dest) {
            EVENTS.push(["copyRow", slot | 0, dest]);
            for (let i = 0; i < 3; i++) rt.mem.write16(dest + 2 * i, STAT_IDS[i]);
        },
        copyStatValue(slot, statId, dest) { EVENTS.push(["copyStat", slot | 0, statId | 0, dest]); },
        resolveText(offset) { EVENTS.push(["resolve", (rt.mem.read32(0x8005cca8) + offset) >>> 0]); return SOURCE; },
        statTable(statId) { EVENTS.push(["stat", statId | 0]); return STATREC; },
        widgetSetLine0(widget, source, index) { EVENTS.push(["setLine0", widget, source, index]); },
        widgetSetLineNumber(widget, line, value) { EVENTS.push(["setNumber", widget, line, value]); },
        widgetSetGlyphCell(widget, a1, a2) { EVENTS.push(["glyph", widget, a1, a2]); },
        widgetSetFlagC1(widget, value) { EVENTS.push(["flag", widget, value]); },
        widgetMeasure(widget, value) { EVENTS.push(["measure", widget, value]); },
    };
    reportRowFill(rt.mem, ROW, BLOCK, show, portHost);
    const portEvents = norm(EVENTS.slice());
    assert.deepEqual(portEvents, oracleEvents, label);
}

test("reportRowFill matches F0x80083404", () => {
    runCase("show mixed stats", 1);
    runCase("show negative stat byte", 1, { statByte: 0xff, handle16: 0xffff, value: 0x7fffffff });
    runCase("show all high stats", 1, { statIds: [5, 6, 7] });
    runCase("hide", 0);
    runCase("hide again", 0, { member: 2 });
});
