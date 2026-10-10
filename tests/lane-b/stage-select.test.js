// Lane B Phase 4 oracle: engine/dw3/ui/native/stage-select.ts must match the
// original pro/stagslct stage-select menu root tick F0x80084D9C.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// display service (0x8004DE10 + 0x150/0x154/0x174/0x16C), the shared card
// service (0x80048D34 + 0x2718/0x2750/0x270C and its +0x28/+0x2C/+0x263C cells),
// the three overlay helpers (F0x80084A5C / F0x80084B2C / F0x80084B70), the pad
// service (0x8004B7D0 + 0x3F4/0x3FC/0x3F8 and its +0x408 bit shifter), the
// frame-button cell (0x8004BBC4), the sound cell (0x80048A7C), the widget
// factory (F0x8001AE38) and every widget method are stubbed on both sides, so the
// ordered call sequence and the panel cells can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { stageSelectTick } from "../../engine/dw3/ui/native/stage-select.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stagslct.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARG1 = 0x80152000;
const WIDGET_BASE = 0x80160000;
const RECORD = 0x80170000;
const ENV = 0x80180000;
const TABLE = 0x80085eec;
const CARD = 0x80048d34;
const DISPLAY = 0x8004de10;
const PAD = 0x8004b7d0;

const WIDGET_FN = 0x8001ae38;
const MOVE_FN = 0x80084a5c;
const SCROLL_FN = 0x80084b2c;
const DRAW_FN = 0x80084b70;
const RELEASE_CELL = 0x8004b440;
const FRAME_BUTTON_CELL = 0x8004bbc4;
const SOUND_CELL = 0x80048a7c;
const CARD_INDEX_CELL = CARD + 0x2718;
const CARD_RECORD_CELL = CARD + 0x2750;
const DISPLAY_RESET = DISPLAY + 0x150;
const DISPLAY_MODE = DISPLAY + 0x154;
const DISPLAY_REGION = DISPLAY + 0x174;
const DISPLAY_ENV = DISPLAY + 0x16c;
const PAD_3F4 = PAD + 0x3f4;
const PAD_3FC = PAD + 0x3fc;
const PAD_3F8 = PAD + 0x3f8;
const PAD_SHIFT = PAD + 0x408;
const COL_BIT_A = 0xa;
const COL_BIT_B = 0xb;

const STUB = 0x0fda0000;
const M12C = STUB + 0x10;
const M110 = STUB + 0x14;
const M118 = STUB + 0x18;
const M134 = STUB + 0x1c;
const M144 = STUB + 0x20;
const M28 = STUB + 0x24;
const M38 = STUB + 0x28;
const M3C = STUB + 0x2c;
const DISPLAY_RESET_STUB = STUB + 0x30;
const DISPLAY_MODE_STUB = STUB + 0x34;
const DISPLAY_REGION_STUB = STUB + 0x38;
const DISPLAY_ENV_STUB = STUB + 0x3c;
const RELEASE_STUB = STUB + 0x40;
const CARD_INDEX_STUB = STUB + 0x44;
const CARD_RECORD_STUB = STUB + 0x48;
const PAD_3F4_STUB = STUB + 0x50;
const PAD_3FC_STUB = STUB + 0x54;
const PAD_3F8_STUB = STUB + 0x58;
const PAD_SHIFT_STUB = STUB + 0x5c;
const FRAME_BUTTON_STUB = STUB + 0x60;
const SOUND_STUB = STUB + 0x64;

const LOG = [];
const CONTROL = {
    pad: {},
    shift: {},
    frameButtons: 0,
    cardIndex: [0, 1, 2],
};
let made = 0;

function pkey(cell, port) {
    return `${cell}:${port}`;
}
function pad(cell, port) {
    return CONTROL.pad[pkey(cell, port)] ?? 0;
}
function shiftFor(port, bitIndex) {
    return CONTROL.shift[pkey(port, bitIndex)] ?? bitIndex;
}

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(WIDGET_FN, (c) => {
        LOG.push(["widget", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const widget = WIDGET_BASE + made * 0x100;
        made += 1;
        rt.mem.write32(widget + 0x12c, M12C);
        rt.mem.write32(widget + 0x110, M110);
        rt.mem.write32(widget + 0x118, M118);
        rt.mem.write32(widget + 0x134, M134);
        rt.mem.write32(widget + 0x144, M144);
        return widget;
    });
    const methods = [[M12C, 0x12c, 3], [M110, 0x110, 1], [M118, 0x118, 2], [M134, 0x134, 2], [M144, 0x144, 1], [M28, 0x28, 1], [M38, 0x38, 0], [M3C, 0x3c, 0]];
    for (const [addr, slot, arity] of methods) {
        rt.cpu.setStub(addr, (c) => {
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, slot, ...args]);
            return 0;
        });
    }
    rt.cpu.setStub(DISPLAY_RESET_STUB, (c) => { LOG.push(["displayReset", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(DISPLAY_MODE_STUB, (c) => { LOG.push(["displayMode", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(DISPLAY_REGION_STUB, (c) => { LOG.push(["displayRegion", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
    rt.cpu.setStub(DISPLAY_ENV_STUB, (c) => { LOG.push(["displayEnv", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return ENV; });
    rt.cpu.setStub(RELEASE_STUB, (c) => { LOG.push(["releaseEntry", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(CARD_INDEX_STUB, (c) => { LOG.push(["cardIndex", c.reg(4) | 0]); return CONTROL.cardIndex[c.reg(4) | 0] ?? -1; });
    rt.cpu.setStub(CARD_RECORD_STUB, (c) => { LOG.push(["cardRecord", c.reg(4) | 0]); return RECORD; });
    rt.cpu.setStub(PAD_3F4_STUB, (c) => pad(PAD_3F4, c.reg(4) | 0));
    rt.cpu.setStub(PAD_3FC_STUB, (c) => pad(PAD_3FC, c.reg(4) | 0));
    rt.cpu.setStub(PAD_3F8_STUB, (c) => pad(PAD_3F8, c.reg(4) | 0));
    rt.cpu.setStub(PAD_SHIFT_STUB, (c) => shiftFor(c.reg(4) | 0, c.reg(5) | 0));
    rt.cpu.setStub(FRAME_BUTTON_STUB, () => CONTROL.frameButtons);
    rt.cpu.setStub(SOUND_STUB, (c) => { LOG.push(["sound", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(MOVE_FN, (c) => {
        LOG.push(["moveColumn", c.reg(4) | 0, c.reg(5) | 0]);
        const obj = c.reg(4) | 0;
        rt.mem.write32(obj + 0x54, ((rt.mem.read32(obj + 0x54) | 0) + (c.reg(5) | 0)) | 0);
        return 0;
    });
    rt.cpu.setStub(SCROLL_FN, (c) => { LOG.push(["scrollColumn", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(DRAW_FN, (c) => { LOG.push(["drawRows", c.reg(4) | 0, c.reg(5) | 0]); return 0; });

    rt.mem.write32(DISPLAY_RESET, DISPLAY_RESET_STUB);
    rt.mem.write32(DISPLAY_MODE, DISPLAY_MODE_STUB);
    rt.mem.write32(DISPLAY_REGION, DISPLAY_REGION_STUB);
    rt.mem.write32(DISPLAY_ENV, DISPLAY_ENV_STUB);
    rt.mem.write32(RELEASE_CELL, RELEASE_STUB);
    rt.mem.write32(CARD_INDEX_CELL, CARD_INDEX_STUB);
    rt.mem.write32(CARD_RECORD_CELL, CARD_RECORD_STUB);
    rt.mem.write32(PAD_3F4, PAD_3F4_STUB);
    rt.mem.write32(PAD_3FC, PAD_3FC_STUB);
    rt.mem.write32(PAD_3F8, PAD_3F8_STUB);
    rt.mem.write32(PAD_SHIFT, PAD_SHIFT_STUB);
    rt.mem.write32(FRAME_BUTTON_CELL, FRAME_BUTTON_STUB);
    rt.mem.write32(SOUND_CELL, SOUND_STUB);
    rt.mem.write32(ENV + 0x12c, M12C);
    return rt;
}

function portHost() {
    const mem = currentMem;
    return {
        displayReset(arg) { LOG.push(["displayReset", arg | 0]); },
        displayMode(value) { LOG.push(["displayMode", value | 0]); },
        displayRegion(a, b, c, d) { LOG.push(["displayRegion", a | 0, b | 0, c | 0, d | 0]); },
        displayEnv(pack, a, b) { LOG.push(["displayEnv", pack | 0, a | 0, b | 0]); return ENV; },
        releaseEntry(a, b) { LOG.push(["releaseEntry", a | 0, b | 0]); },
        cardIndexOf(index) { LOG.push(["cardIndex", index | 0]); return CONTROL.cardIndex[index | 0] ?? -1; },
        cardRecord(index) { LOG.push(["cardRecord", index | 0]); return RECORD; },
        moveColumn(obj, delta) {
            LOG.push(["moveColumn", obj | 0, delta | 0]);
            mem.write32(obj + 0x54, ((mem.read32(obj + 0x54) | 0) + (delta | 0)) | 0);
        },
        scrollColumn(obj, delta) { LOG.push(["scrollColumn", obj | 0, delta | 0]); },
        drawRows(obj, a1) { LOG.push(["drawRows", obj | 0, a1 | 0]); },
        padButtons(cell, port) { return pad(cell, port); },
        padShift(port, bitIndex) { return shiftFor(port, bitIndex); },
        frameButtons() { return CONTROL.frameButtons; },
        playSound(a0) { LOG.push(["sound", a0 | 0]); },
        createWidget(y, x) {
            LOG.push(["widget", 0x1000, 1, y | 0, x | 0]);
            const widget = WIDGET_BASE + made * 0x100;
            made += 1;
            return widget;
        },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
    };
}

let currentMem = null;

function clear(rt, addr, size) {
    for (let i = 0; i < size; i += 4) rt.mem.write32(addr + i, 0);
}

function writeTable(rt, entries) {
    clear(rt, TABLE, 0x200);
    for (let i = 0; i < entries.length; i++) {
        rt.mem.write32(TABLE + i * 0x10 + 0x00, entries[i][0]);
        rt.mem.write32(TABLE + i * 0x10 + 0x04, entries[i][1]);
        rt.mem.write32(TABLE + i * 0x10 + 0x08, entries[i][2]);
        rt.mem.write32(TABLE + i * 0x10 + 0x0c, entries[i][3]);
    }
}

function seedInit(rt, c) {
    clear(rt, OBJ, 0x100);
    clear(rt, ARG1, 0x200);
    clear(rt, WIDGET_BASE, 0x1000);
    rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
    rt.mem.write32(OBJ + 0x38, M38);
    rt.mem.write32(CARD + 0x28, c.indexA ?? 0);
    rt.mem.write32(CARD + 0x2c, c.indexB ?? 0);
    rt.mem.write32(0x80042b1c, c.menu ?? 0);
    writeTable(rt, c.table);
    made = 0;
}

function seedInput(rt, c) {
    clear(rt, OBJ, 0x100);
    clear(rt, ARG1, 0x200);
    clear(rt, WIDGET_BASE, 0x1000);
    clear(rt, RECORD, 0x100);
    rt.mem.write32(OBJ + 0x0c, 1);
    rt.mem.write32(OBJ + 0x10, c.sub ?? 1);
    rt.mem.write32(OBJ + 0x54, c.row ?? 0);
    rt.mem.write32(OBJ + 0x50, c.col ?? 0);
    rt.mem.write32(OBJ + 0x58, c.shown ?? 3);
    rt.mem.write32(OBJ + 0x28, M28);
    rt.mem.write32(OBJ + 0x38, M38);
    rt.mem.write32(OBJ + 0x3c, M3C);
    const shown = c.shown ?? 3;
    for (let i = 0; i < shown; i++) {
        const a = WIDGET_BASE + (i * 2) * 0x100;
        const b = WIDGET_BASE + (i * 2 + 1) * 0x100;
        for (const w of [a, b]) {
            rt.mem.write32(w + 0x110, M110);
            rt.mem.write32(w + 0x118, M118);
            rt.mem.write32(w + 0x134, M134);
            rt.mem.write32(w + 0x144, M144);
        }
        rt.mem.write32(ARG1 + i * 4 + 0x08, a);
        rt.mem.write32(ARG1 + i * 4 + 0x40, b);
    }
    for (const off of [0x00, 0x04, 0x80, 0x84, 0x88, 0x8c, 0x90, 0x94, 0x98]) {
        const w = WIDGET_BASE + (shown * 2 + (off >> 2)) * 0x100;
        rt.mem.write32(w + 0x110, M110);
        rt.mem.write32(w + 0x118, M118);
        rt.mem.write32(w + 0x134, M134);
        rt.mem.write32(w + 0x144, M144);
        rt.mem.write32(ARG1 + off, w);
    }
    writeTable(rt, c.table ?? [[0x11111111, 0x22222222, 0x33333333, 0]]);
    rt.mem.write32(0x8005cca8, c.frame ?? 0);
    rt.mem.write32(0x80042b1c, c.menu ?? 0);
    rt.mem.write32(0x80042b20, c.value ?? -1);
    rt.mem.write32(0x80042b24, c.field ?? -1);
    rt.mem.write32(0x8004b370, c.cursor ?? 0);
    rt.mem.write32(CARD + 0x263c, c.counter ?? 0);
    rt.mem.write32(RECORD + 0x32, c.recordLevel ?? 5);
    rt.mem.write32(RECORD + 0x1c, c.recordStat ?? 5);
    CONTROL.pad = c.pad ?? {};
    CONTROL.shift = c.shift ?? {};
    CONTROL.frameButtons = c.frameButtons ?? 0;
    CONTROL.cardIndex = c.cardIndex ?? [0, 1, 2];
    made = 0;
}

function snap(rt) {
    const out = [];
    for (const off of [0x0c, 0x10, 0x28, 0x38, 0x3c, 0x50, 0x54, 0x58, 0x5c]) {
        out.push(`o${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    }
    for (let i = 0; i < 0x20; i++) out.push(`a${i}=${rt.mem.read32(ARG1 + i * 4) >>> 0}`);
    out.push(`frame=${rt.mem.read32(0x8005cca8) >>> 0}`);
    out.push(`menu=${rt.mem.read32(0x80042b1c) >>> 0}`);
    out.push(`val=${rt.mem.read32(0x80042b20) >>> 0}`);
    out.push(`fld=${rt.mem.read32(0x80042b24) >>> 0}`);
    out.push(`cursor=${rt.mem.read32(0x8004b370) >>> 0}`);
    out.push(`counter=${rt.mem.read32(CARD + 0x263c) >>> 0}`);
    out.push(`ia=${rt.mem.read32(CARD + 0x28) >>> 0}`);
    out.push(`ib=${rt.mem.read32(CARD + 0x2c) >>> 0}`);
    out.push(`lv=${rt.mem.read32(RECORD + 0x32) >>> 0}`);
    out.push(`st=${rt.mem.read32(RECORD + 0x1c) >>> 0}`);
    return out;
}

test("stageSelectTick init matches F0x80084D9C", () => {
    const rt = runtime();
    const list = (n) => {
        const rows = [];
        for (let i = 0; i < n; i++) rows.push([0x1000 + i, 0x2000 + i, 0x3000 + i, i]);
        rows.push([0, 0, -1, 0]);
        return rows;
    };
    const cases = [
        { name: "two entries", table: list(2), indexA: 1, indexB: 0 },
        { name: "three entries", table: list(3), indexA: 0, indexB: 1 },
        { name: "cap at 14", table: list(16), indexA: 0, indexB: 0 },
        { name: "state 4", table: list(2), state: 4 },
        { name: "zero entries", table: [[0, 0, -1, 0]], indexA: 0, indexB: 0 },
    ];
    for (const c of cases) {
        seedInit(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x80084d9c, [OBJ, ARG1], 80000);
        const olog = LOG.slice();
        const osnap = snap(rt);
        const omade = made;

        seedInit(rt, c);
        currentMem = rt.mem;
        LOG.length = 0;
        stageSelectTick(rt.mem, OBJ, ARG1, portHost());
        assert.deepEqual(LOG.slice(), olog, `${c.name}: calls`);
        assert.deepEqual(snap(rt), osnap, `${c.name}: cells`);
        assert.equal(made, omade, `${c.name}: widgets made`);
    }
});

test("stageSelectTick non-input states match F0x80084D9C", () => {
    const rt = runtime();
    const cases = [
        { name: "state 2 returns", state: 2, table: [[0, 0, -1, 0]] },
        { name: "state 3 releases pair", state: 3, table: [[1, 1, 1, 1], [0, 0, 0x1234, 0x8005]], row: 1, col: 0 },
        { name: "state 3 directly", state: 3, table: [[0, 0, 0x300, 0x77]], row: 0, col: 0 },
    ];
    for (const c of cases) {
        seedInput(rt, c);
        writeTable(rt, c.table);
        rt.mem.write32(OBJ + 0x0c, c.state);
        rt.mem.write32(OBJ + 0x54, c.row ?? 0);
        rt.mem.write32(OBJ + 0x50, c.col ?? 0);
        LOG.length = 0;
        rt.cpu.call(0x80084d9c, [OBJ, ARG1], 80000);
        const olog = LOG.slice();
        const osnap = snap(rt);

        seedInput(rt, c);
        writeTable(rt, c.table);
        rt.mem.write32(OBJ + 0x0c, c.state);
        rt.mem.write32(OBJ + 0x54, c.row ?? 0);
        rt.mem.write32(OBJ + 0x50, c.col ?? 0);
        currentMem = rt.mem;
        LOG.length = 0;
        stageSelectTick(rt.mem, OBJ, ARG1, portHost());
        assert.deepEqual(LOG.slice(), olog, `${c.name}: calls`);
        assert.deepEqual(snap(rt), osnap, `${c.name}: cells`);
    }
});

test("stageSelectTick input matches F0x80084D9C", () => {
    const rt = runtime();
    const key = (cell, port) => pkey(cell, port);
    const cases = [
        { name: "sub 0 title", sub: 0 },
        { name: "idle", sub: 1 },
        { name: "up moves column", sub: 1, pad: { [key(PAD_3F4, 0)]: 0x10 } },
        { name: "down moves column", sub: 1, pad: { [key(PAD_3F4, 0)]: 0x40 } },
        { name: "shoulder scroll down", sub: 1, pad: { [key(PAD_3F4, 0)]: 1 << COL_BIT_A } },
        { name: "shoulder scroll up", sub: 1, pad: { [key(PAD_3F4, 0)]: 1 << COL_BIT_B } },
        { name: "start toggles", sub: 1, pad: { [key(PAD_3F4, 0)]: 0x1 }, menu: 0 },
        { name: "start toggles back", sub: 1, pad: { [key(PAD_3F4, 0)]: 0x1 }, menu: 1 },
        { name: "confirm moves cursor", sub: 1, pad: { [key(PAD_3F4, 0)]: 0x2000 }, table: [[0x11, 0x22, 0x300, 0x77]] },
        { name: "confirm commits", sub: 1, pad: { [key(PAD_3F4, 0)]: 0x2000 }, table: [[0x11, 0x22, 0x1234, 0x05]] },
        { name: "frame counter", sub: 1, frameButtons: 8, frame: 3 },
        { name: "frame wraps", sub: 1, frameButtons: 8, frame: 6 },
        { name: "shoulder counter dec", sub: 1, pad: { [key(PAD_3F4, 0)]: 0x200 }, counter: 4 },
        { name: "shoulder counter inc", sub: 1, pad: { [key(PAD_3F4, 0)]: 0x100 }, counter: 4 },
        { name: "stat up", sub: 1, pad: { [key(PAD_3F8, 1)]: 0, [key(PAD_3F4, 1)]: 1 << COL_BIT_B } },
        { name: "stat down", sub: 1, pad: { [key(PAD_3F8, 1)]: 0, [key(PAD_3F4, 1)]: 1 << COL_BIT_A } },
        { name: "level up", sub: 1, pad: { [key(PAD_3F8, 1)]: 0, [key(PAD_3F4, 1)]: 1 << 9 } },
        { name: "level down", sub: 1, pad: { [key(PAD_3F8, 1)]: 0, [key(PAD_3F4, 1)]: 1 << 8 } },
        { name: "menu right", sub: 1, pad: { [key(PAD_3F4, 1)]: 0x10 }, menu: 1 },
        { name: "menu left", sub: 1, pad: { [key(PAD_3F4, 1)]: 0x40 }, menu: 1 },
        { name: "field right", sub: 1, pad: { [key(PAD_3F4, 1)]: 0x20 }, field: 2 },
        { name: "field left", sub: 1, pad: { [key(PAD_3F4, 1)]: 0x80 }, field: 2 },
        { name: "footer shown", sub: 1, value: 3, field: 2 },
        { name: "footer hidden", sub: 1, value: -1, field: -1 },
        { name: "selection changed", sub: 1, row: 1, col: 0, pad: { [key(PAD_3F4, 0)]: 0x10 } },
    ];
    for (const c of cases) {
        seedInput(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x80084d9c, [OBJ, ARG1], 120000);
        const olog = LOG.slice();
        const osnap = snap(rt);

        seedInput(rt, c);
        currentMem = rt.mem;
        LOG.length = 0;
        stageSelectTick(rt.mem, OBJ, ARG1, portHost());
        assert.deepEqual(LOG.slice(), olog, `${c.name}: calls`);
        assert.deepEqual(snap(rt), osnap, `${c.name}: cells`);
    }
});
