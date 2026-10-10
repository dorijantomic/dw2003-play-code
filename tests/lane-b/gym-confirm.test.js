// Oracle: engine/dw3/ui/native/gym-confirm.ts must match the original pro/stgtrain confirm panel:
// constructor F0x80089764, dismiss F0x80089758, tick F0x80089698, widget builder F0x80088214,
// draw F0x80088348 and step machine F0x800888BC. The original runs through engine/native with the
// resident services and the widget methods as recording stubs; the port gets the same calls from
// a recording host; the draw is compared as the recorded picture intents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKit, installUi, rng, UI } from "./gym-kit.js";
import * as C from "../../engine/dw3/ui/native/gym-confirm.ts";

const kit = createKit();
const mem = kit.mem;
const CONFIRM = 0x80150000;
const CHILDREN = 0x80150200;
const SCREEN = 0x80150400;
const NEW = 0x80150800;
mem.write32(0x8005cca8, 3);
const cfg = { pressed: 0, held: 0, repeat: 0, channel: 7, created: [], done: () => 0, waiting: () => 0, fold: () => 1, group: 0, rand: () => 0,
    projection: [], roster: (p) => p ^ 1 };
const ui = installUi(kit, cfg);
const W = Array.from({ length: 9 }, (_, k) => ui.widgetAt(10 + k));
kit.at(0x80014504, "alloc", () => NEW, { args: 3 });
const ADVANCE = kit.stub("advance", 0, { args: 1 });
// The projection lands on the original's stack: log the slot only.
kit.cell(0x8004b468, "projection", 0, { args: 2, silent: true, before: (_c, a) => {
    kit.push("projection", a[0]);
    for (let i = 0; i < 0x2c; i++) mem.write8(a[1] + i, (cfg.projection ?? [])[i] ?? 0);
} });
const host = { ...ui.host,
    copyProjection(slot, dest) { kit.push("projection", slot); for (let i = 0; i < 0x2c; i++) mem.write8(dest + i, (cfg.projection ?? [])[i] ?? 0); },
    alloc(h, s, e) { kit.push("alloc", h, s, e); return NEW; },
    advance(self) { kit.push("advance", self); },
    frameTick() { return mem.read32(0x8004de20) | 0; }, packResolve: (h) => h,
    initDrawContext() {}, setLayer() {}, setOrigin() {}, setScale() {}, setPos() {}, paletteShift() {}, drawSprite() {},
};
const ranges = [[CONFIRM, 0x100], [CHILDREN, 0x28], [SCREEN, 0x100], [NEW, 0x100], [UI.block + 0x0, 0x40]];
const PAD = (...bits) => bits.reduce((a, b) => a | (1 << b), 0);

function seed(c) {
    return () => {
        const r = rng(c.seed ?? 1);
        kit.fill(CONFIRM, 0x100, () => 0); kit.fill(CHILDREN, 0x28, () => 0); kit.fill(SCREEN, 0x100, () => 0); kit.fill(NEW, 0x100, () => 0);
        kit.fill(UI.block, 0x400, () => (r() * 0x100000000) >>> 0);
        mem.write32(CONFIRM + 0x24, CHILDREN);
        mem.write32(CONFIRM + 0x38, ADVANCE);
        mem.write32(CONFIRM + 0x0c, c.state ?? 1);
        mem.write32(CONFIRM + 0x10, c.step ?? 0);
        mem.write32(CONFIRM + 0x14, c.cancel ?? 0);
        mem.write32(CONFIRM + 0x50, SCREEN); mem.write32(CONFIRM + 0x54, 0x1000); mem.write32(CONFIRM + 0x58, 6);
        mem.write32(CONFIRM + 0x5c, c.tp ?? 0);
        mem.write32(CONFIRM + 0x6c, c.yes ?? 0);
        for (const [off, v] of Object.entries(c.fields ?? {})) mem.write32(CONFIRM + Number(off), v);
        mem.write32(SCREEN + 0x68, c.pod ?? 1); mem.write32(SCREEN + 0x78, c.drill ?? 5); mem.write32(SCREEN + 0x7c, c.lastTp ?? 1);
        for (let k = 0; k < 9; k++) mem.write32(CHILDREN + k * 4, W[k]);
        mem.write32(CHILDREN + 0x24, UI.cursor);
        cfg.pressed = c.pressed ?? 0; cfg.repeat = c.repeat ?? 0; cfg.held = 0; cfg.fold = c.fold ?? (() => 1);
        cfg.projection = c.projection ?? [];
        cfg.created = W.slice();
        ui.resetCreated();
        mem.write32(0x8004de20, 100);
        for (let i = 0; i < 0x1000; i += 4) mem.write32(0x801fef00 + i, 0);
    };
}
const projectionTp = (tp) => { const p = new Array(0x2c).fill(0); p[2] = tp & 0xff; p[3] = (tp >> 8) & 0xff; return p; };
function machine(label, c) {
    kit.compare(label, { seed: seed(c), ranges, ret: false,
        original: () => kit.call(0x800888bc, [CONFIRM, CHILDREN], 400000),
        port: () => C.gymConfirmMachine(mem, CONFIRM, CHILDREN, host) });
}

test("gymConfirmMachine matches F0x800888BC", () => {
    for (const step of [0, 1, 2, 3, 4, 5, 0xa, 0xb, 0xc, 0xd, 0xf, 0x10, 0x11, 0x13, 0x14, 0x19, 0x1a, 0x1e, 0x1f, 0x23, 0x32, 0x33, 0x34, 7, 0x7fffffff]) {
        for (const f of [0, 1]) for (const pressed of [0, PAD(0xd)]) {
            machine(`step ${step} fold ${f} pressed ${pressed}`, { step, fold: () => f, pressed, drill: 3 + (step & 7), tp: step & 1, cancel: f });
        }
    }
    for (const tp of [0, 1, 2]) for (const pressed of [0, PAD(7), PAD(5), PAD(0xd), PAD(0xe), PAD(7, 5), PAD(7, 0xd)]) for (const repeat of [0, PAD(7), PAD(5)]) {
        for (const have of [0, 0, 1, 4, 5, 9, 10, 11, 999]) {
            machine(`six ${tp} ${pressed} ${repeat} ${have}`, { step: 6, tp, pressed, repeat, projection: projectionTp(have), lastTp: tp });
        }
    }
    for (const yes of [0, 1]) for (const pressed of [0, PAD(4), PAD(6), PAD(0xd), PAD(0xe)]) for (const repeat of [0, PAD(4), PAD(6)]) for (const tp of [0, 1, 2]) {
        machine(`eighteen ${yes} ${pressed} ${repeat} ${tp}`, { step: 0x12, yes, pressed, repeat, tp, pod: 2 });
    }
});

test("gymConfirmTick, gymConfirmWidgets, gymConfirmCreate and gymConfirmDismiss match", () => {
    for (const state of [0, 1, 2, 3, 4, -1, 9]) {
        for (const lastTp of [0, 1, 2]) {
            kit.compare(`tick ${state} ${lastTp}`, { seed: seed({ state, lastTp, step: 1, fields: { 0xa0: 0x1000, 0x68: 1 } }), ranges, ret: false,
                original: () => kit.call(0x80089698, [CONFIRM, CHILDREN], 400000),
                port: () => C.gymConfirmTick(mem, CONFIRM, CHILDREN, host) });
        }
    }
    kit.compare("create", { seed: seed({}), ranges,
        original: () => kit.call(0x80089764, [SCREEN]), port: () => C.gymConfirmCreate(mem, host, SCREEN) });
    kit.compare("dismiss", { seed: seed({ step: 9 }), ranges, ret: false,
        original: () => kit.call(0x80089758, [CONFIRM]), port: () => C.gymConfirmDismiss(mem, CONFIRM) });
});

kit.cell(0x80044f5c, "packResolve", (h) => h, { args: 1, silent: true });
const DARGS = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };
test("gymConfirmDraw matches F0x80088348", () => {
    for (let n = 0; n < 500; n++) {
        const r = rng(n + 99);
        const pick = (...v) => v[(r() * v.length) | 0];
        const c = { seed: n, drill: pick(1, 5, 12, 24), tp: pick(0, 1, 2), fields: {
            0xa0: pick(0, 0x800, 0x1000), 0xb0: pick(0, 0x300, 0x1000), 0x90: pick(0, 0x555, 0x1000), 0x80: pick(0, 0x999, 0x1000),
            0x68: pick(0, 1), 0xe0: pick(0, 0x400, 0x1000), 0xd0: pick(0, 0x222, 0x1000), 0xf0: pick(0, 0xf00, 0x1000), 0xc0: pick(0, 0x1, 0x1000),
            0x60: pick(0, 1, 3), 0x64: 100 - pick(0, 5, 11, 20), 0x70: pick(0, 2, 3), 0x74: 100 - pick(0, 4, 16, 40) } };
        seed(c)();
        const before = kit.rt.drawCalls.length;
        kit.call(0x80088348, [CONFIRM]);
        const oracle = kit.rt.drawCalls.slice(before).map((d) => [d.method, d.args.slice(0, DARGS[d.method] ?? 4).map((v) => v >>> 0)]);
        kit.rt.drawCalls.length = before;
        const oMem = kit.words(ranges);
        seed(c)();
        const got = [];
        C.gymConfirmDraw(mem, CONFIRM, {
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
