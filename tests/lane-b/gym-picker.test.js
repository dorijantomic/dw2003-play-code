// Oracle: engine/dw3/ui/native/gym-picker.ts must match the original pro/stgtrain drill picker:
// constructor F0x8008B838 and methods F0x8008B7F0 / F0x8008B800 / F0x8008B814, tick F0x8008B520,
// widget builder F0x8008A354, drill text F0x8008A3E0, draw F0x8008A524 and step machine
// F0x8008AAD4. The original runs through engine/native with the resident services and the widget
// methods as recording stubs; the port gets the same calls from a recording host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKit, installUi, rng, UI } from "./gym-kit.js";
import * as P from "../../engine/dw3/ui/native/gym-picker.ts";

const kit = createKit();
const mem = kit.mem;
const PICKER = 0x80150000;
const CHILDREN = 0x80150200;
const SCREEN = 0x80150400;
const NEW = 0x80150800;
mem.write32(0x8005cca8, 3);
const cfg = { pressed: 0, held: 0, repeat: 0, channel: 7, created: [], done: () => 0, waiting: () => 0, fold: () => 1, group: 0, rand: () => 0 };
const ui = installUi(kit, cfg);
const W = Array.from({ length: 4 }, (_, k) => ui.widgetAt(10 + k));
kit.at(0x80014504, "alloc", () => NEW, { args: 3 });
const ADVANCE = kit.stub("advance", 0, { args: 1 });
const SETSTATE0 = kit.stub("setState0", 0, { args: 2 });
const host = { ...ui.host,
    alloc(h, s, e) { kit.push("alloc", h, s, e); return NEW; },
    advance(self) { kit.push("advance", self); },
    frameTick() { return mem.read32(0x8004de20) | 0; }, packResolve: (h) => h,
    initDrawContext() {}, setLayer() {}, setOrigin() {}, setScale() {}, setPos() {}, paletteShift() {}, drawSprite() {},
};
const ranges = [[PICKER, 0x118], [CHILDREN, 0x10], [SCREEN, 0x100], [NEW, 0x118], [0x8008cfcc, 0x10]];
const PAD = (...bits) => bits.reduce((a, b) => a | (1 << b), 0);

function seed(c) {
    return () => {
        const r = rng(c.seed ?? 1);
        kit.fill(PICKER, 0x118, () => 0); kit.fill(CHILDREN, 0x10, () => 0); kit.fill(SCREEN, 0x100, () => 0); kit.fill(NEW, 0x118, () => 0);
        mem.write32(PICKER + 0x24, CHILDREN); mem.write32(PICKER + 0x38, ADVANCE); mem.write32(PICKER + 0x28, SETSTATE0);
        mem.write32(PICKER + 0x0c, c.state ?? 1);
        mem.write32(PICKER + 0x10, c.step ?? 0);
        mem.write32(PICKER + 0x14, c.cancel ?? 0);
        mem.write32(PICKER + 0x50, SCREEN); mem.write32(PICKER + 0x54, 0x1000); mem.write32(PICKER + 0x58, 6);
        mem.write32(PICKER + 0x68, c.col ?? 0); mem.write32(PICKER + 0x6c, c.row ?? 0); mem.write32(PICKER + 0x70, c.page ?? 0);
        const cells = c.cells ?? Array.from({ length: 16 }, () => [-1, 0, 0, 1, 5, 13, 24][(r() * 7) | 0]);
        for (let k = 0; k < 16; k++) mem.write32(PICKER + 0x88 + (k >> 3) * 0x20 + (k & 7) * 4, cells[k] >>> 0);
        for (const [off, v] of Object.entries(c.fields ?? {})) mem.write32(PICKER + Number(off), v);
        mem.write32(SCREEN + 0x78, c.drill ?? 0);
        for (let k = 0; k < 4; k++) mem.write32(CHILDREN + k * 4, W[k]);
        mem.write32(0x8008cfcc, c.count ?? 6);
        cfg.pressed = c.pressed ?? 0; cfg.repeat = c.repeat ?? 0; cfg.held = c.held ?? 0; cfg.fold = c.fold ?? (() => 1);
        cfg.group = c.group ?? 0;
        cfg.created = W.slice(); ui.resetCreated();
        mem.write32(0x8004de20, 100);
    };
}
function machine(label, c) {
    kit.compare(label, { seed: seed(c), ranges, ret: false,
        original: () => kit.call(0x8008aad4, [PICKER, CHILDREN], 400000),
        port: () => P.gymPickerMachine(mem, PICKER, CHILDREN, host) });
}

test("gymPickerMachine matches F0x8008AAD4 (the opening and closing steps)", () => {
    for (const step of [0, 1, 2, 3, 4, 0x32, 0x33, 0x34, 0xb, 0x35, 0x7fffffff]) {
        for (const f of [0, 1]) for (const count of [0, 5, 6, 12]) for (const page of [0, 1]) for (const cancel of [0, 1]) {
            machine(`step ${step} fold ${f} count ${count} page ${page} cancel ${cancel}`, { step, fold: () => f, count, page, cancel, col: step & 3, row: step & 1 });
        }
    }
});

test("gymPickerMachine matches F0x8008AAD4 (choosing a drill)", () => {
    const pads = [0, PAD(7), PAD(5), PAD(4), PAD(6), PAD(0xd), PAD(0xe), PAD(7, 4), PAD(5, 6), PAD(0xa), PAD(0xb), PAD(0xa, 0xb), PAD(7, 0xd)];
    for (let n = 0; n < 1500; n++) {
        const r = rng(n + 3);
        const pick = (...v) => v[(r() * v.length) | 0];
        machine(`choose ${n}`, {
            seed: n, step: 0xa, page: pick(0, 1), col: pick(0, 1, 2, 3), row: pick(0, 1), count: pick(5, 6, 9),
            pressed: pick(...pads), repeat: pick(0, 0, PAD(7), PAD(5), PAD(4), PAD(6)), held: pick(0, 0, PAD(0xa), PAD(0xb), PAD(0xa, 0xb)),
            cells: Array.from({ length: 16 }, () => pick(-1, 0, 0, 1, 5, 13, 24, 7)), drill: pick(0, 3, -1),
        });
    }
});

test("gymPickerTick, gymPickerWidgets, gymPickerDrillText, create and the methods match", () => {
    for (const group of [0, 1, 2, 4, 7, 12, 13, 14, 15, -1]) for (const drill of [0, 1, 5, 13, 24, 99]) for (const state of [0, 4, 5, -1, 2, 3, 1]) {
        kit.compare(`tick ${group} ${drill} ${state}`, { seed: seed({ group, drill, state, step: 1, cells: Array(16).fill(0) }), ranges, ret: false,
            original: () => kit.call(0x8008b520, [PICKER, CHILDREN], 400000),
            port: () => P.gymPickerTick(mem, PICKER, CHILDREN, host) });
    }
    for (const show of [0, 1]) for (let n = 0; n < 60; n++) {
        const r = rng(n);
        kit.compare(`text ${show} ${n}`, { seed: seed({ seed: n, page: n & 1, col: n & 3, row: (n >> 2) & 1 }), ranges, ret: false,
            original: () => kit.call(0x8008a3e0, [PICKER, CHILDREN, show]),
            port: () => P.gymPickerDrillText(mem, PICKER, CHILDREN, show, host) });
        void r;
    }
    kit.compare("widgets", { seed: seed({}), ranges, ret: false,
        original: () => kit.call(0x8008a354, [PICKER, CHILDREN]), port: () => P.gymPickerWidgets(mem, PICKER, CHILDREN, host) });
    kit.compare("create", { seed: seed({}), ranges,
        original: () => kit.call(0x8008b838, [SCREEN]), port: () => P.gymPickerCreate(mem, host, SCREEN) });
    kit.compare("open", { seed: seed({ step: 9 }), ranges, ret: false, original: () => kit.call(0x8008b7f0, [PICKER]), port: () => P.gymPickerOpen(mem, PICKER) });
    kit.compare("close", { seed: seed({ step: 9 }), ranges, ret: false, original: () => kit.call(0x8008b800, [PICKER]), port: () => P.gymPickerClose(mem, PICKER) });
    kit.compare("refresh", { seed: seed({ page: 1, col: 2, row: 1 }), ranges, ret: false,
        original: () => kit.call(0x8008b814, [PICKER]), port: () => P.gymPickerDrillText(mem, PICKER, CHILDREN, 1, host) });
});

kit.cell(0x80044f5c, "packResolve", (h) => h, { args: 1, silent: true });
const DARGS = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };
test("gymPickerDraw matches F0x8008A524", () => {
    for (let n = 0; n < 500; n++) {
        const r = rng(n + 55);
        const pick = (...v) => v[(r() * v.length) | 0];
        const c = { seed: n, page: pick(0, 1), col: pick(0, 1, 2, 3), row: pick(0, 1),
            cells: Array.from({ length: 16 }, () => pick(-1, 0, 1, 5, 13, 24, 7)),
            fields: { 0xd0: pick(0, 0x800, 0x1000), 0x5c: pick(0, 1), 0x60: pick(0, 2), 0x64: 100 - pick(0, 4, 11, 30), 0xf0: pick(0, 0x700, 0x1000),
                0x80: pick(0, 1, 3), 0x84: 100 - pick(0, 4, 16, 50), 0x74: pick(0, 1), 0x78: pick(0, 2), 0x7c: 100 - pick(0, 4, 11, 30),
                0xe0: pick(0, 0x333, 0x1000), 0x100: pick(0, 0x444, 0x1000) } };
        seed(c)();
        const before = kit.rt.drawCalls.length;
        kit.call(0x8008a524, [PICKER]);
        const oracle = kit.rt.drawCalls.slice(before).map((d) => [d.method, d.args.slice(0, DARGS[d.method] ?? 4).map((v) => v >>> 0)]);
        kit.rt.drawCalls.length = before;
        const oMem = kit.words(ranges);
        seed(c)();
        const got = [];
        P.gymPickerDraw(mem, PICKER, {
            initDrawContext() {}, setLayer(t, b) { got.push(["setLayer", [t, b]]); }, setOrigin(x, y) { got.push(["setOrigin", [x, y]]); },
            setScale(x, y, z) { got.push(["setScale", [x, y, z]]); }, setPos(x, y) { got.push(["setPos", [x, y]]); },
            paletteShift(v) { got.push(["m_0x88", [v]]); }, drawSprite(p, cl, x, y) { got.push(["drawSprite", [p, cl, x, y]]); },
            packResolve: (h) => h, frameTick: () => mem.read32(0x8004de20) | 0,
        });
        assert.ok(oracle.length >= 2);
        assert.deepEqual(got.map(([m, a]) => [m, a.map((v) => v >>> 0)]), oracle, `draw ${n}`);
        assert.deepEqual(kit.words(ranges), oMem, `draw ${n}: memory`);
    }
});
