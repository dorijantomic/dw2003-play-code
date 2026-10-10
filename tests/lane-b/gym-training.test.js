// Oracle: engine/dw3/ui/native/gym-training.ts must match the original pro/stgtrain training
// session window: constructor F0x80088070, tick F0x80087F28, step machine F0x8008706C, rep
// dispatcher F0x800866CC, widget builder F0x80086B24 and picture draw F0x80086C0C. The original
// runs through engine/native with the resident services (pad, sound, text, folds, party, random),
// the widget and actor methods and the screen draw method as recording stubs; the port gets the
// same calls from a recording host. The stat rolls and the rank-menu lookup run as the real
// original on one side and as their ports on the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKit, installUi, rng, UI } from "./gym-kit.js";
import * as T from "../../engine/dw3/ui/native/gym-training.ts";
import * as R from "../../engine/dw3/ui/native/gym-rep-actor.ts";

const kit = createKit();
const mem = kit.mem;
const SELF = 0x80150000;
const CHILDREN = 0x80150400;
const SCREEN = 0x80150800;
const REP = 0x80150c00;
const NEWSELF = 0x80151000;
const NEWREP = 0x80151400;
mem.write32(0x8005cca8, 3);   // the language index

const cfg = { pressed: 0, held: 0, repeat: 0, channel: 7, created: [], done: () => 0, waiting: () => 0, fold: () => 1,
    group: 3, rand: () => 0, result: -1, projection: [] };
const ui = installUi(kit, cfg);
cfg.created = [ui.widgetAt(1), ui.widgetAt(2), ui.widgetAt(3), ui.widgetAt(4), ui.widgetAt(5), ui.widgetAt(6)];
const W = [0, 1, 2, 3, 4, 5].map((k) => ui.widgetAt(10 + k));

// Rep actor methods (recording stubs) and the task methods.
const REP_STUBS = { 0xa4: ["pageOrigin", 3], 0xa8: ["clutOrigin", 3], 0xac: ["hitPercent", 2], 0xb0: ["growIn", 1], 0xb8: ["resume", 1],
    0xbc: ["holdBoth", 1], 0xc0: ["repScale", 2], 0xc4: ["result", 1], 0xc8: ["closingPose", 1] };
const repAddr = {};
for (const [slot, [name, args]] of Object.entries(REP_STUBS)) repAddr[slot] = kit.stub(name, name === "result" ? () => cfg.result : 0, { args });
const SELF_STUBS = { 0x2c: ["setState1", 2], 0x38: ["advance", 1] };
const selfAddr = {};
for (const [slot, [name, args]] of Object.entries(SELF_STUBS)) selfAddr[slot] = kit.stub(name, 0, { args });
const SCREEN_DRAW = kit.stub("screenDraw", 0, { args: 2 });
kit.at(0x80014504, "alloc", (h) => ((h >>> 0) === 0x80087f28 ? NEWSELF : NEWREP), { args: 3 });
let realRep = false;
const PORT_REP = {
    0xa4: (a) => R.gymRepSetPageOrigin(mem, a[0], a[1], a[2]), 0xa8: (a) => R.gymRepSetClutOrigin(mem, a[0], a[1], a[2]),
    0xbc: (a) => R.gymRepHoldBoth(mem, a[0], { actor() { return 0; } }), 0xc0: (a) => R.gymRepSetScale(mem, a[0], a[1]),
};

const host = {
    ...ui.host,
    alloc(h, s, e) { kit.push("alloc", h, s, e); return h === 0x80087f28 ? NEWSELF : NEWREP; },
    createRepActor(c, d, l, b) {
        return R.gymRepCreate(mem, { alloc(h, s, e) { kit.push("alloc", h, s, e); return NEWREP; } }, c, d, l, b);
    },
    call(target, slot, args) {
        target >>>= 0;
        if (realRep && target === NEWREP) { PORT_REP[slot]?.([target, ...args]); return 0; }
        if (target === (REP >>> 0) || target === NEWREP) {
            const [name, arity] = REP_STUBS[slot];
            kit.push(name, target, ...args.slice(0, arity - 1));
            return name === "result" ? cfg.result : 0;
        }
        if (target === SCREEN) { kit.push("screenDraw", target, ...args.slice(0, 1)); return 0; }
        const [name] = SELF_STUBS[slot];
        kit.push(name, target, ...args.slice(0, SELF_STUBS[slot][1] - 1));
        return 0;
    },
    frameTick() { kit.push("frameTick"); return cfg.frame; },
    packResolve(h) { return h >>> 0; },
    initDrawContext() {}, setLayer() {}, setOrigin() {}, setScale() {}, setPos() {}, paletteShift() {}, drawSprite() {},
};
void realRep;

const R_SELF = [[SELF, 0x140], [CHILDREN, 0x20], [NEWSELF, 0x140], [NEWREP, 0xd8], [REP, 0xd8], [UI.block + 0x3c0, 0x20]];

function seed(c) {
    return () => {
        const r = rng(c.seed ?? 1);
        kit.fill(SELF, 0x140, () => 0); kit.fill(CHILDREN, 0x20, () => 0); kit.fill(NEWSELF, 0x140, () => 0);
        kit.fill(NEWREP, 0xd8, () => 0); kit.fill(REP, 0xd8, () => 0); kit.fill(SCREEN, 0x140, () => 0);
        kit.fill(UI.block, 0x400, () => (r() * 0x100000000) >>> 0);
        for (const [slot, a] of Object.entries(repAddr)) mem.write32(REP + Number(slot), a);
        for (const [slot, a] of Object.entries(selfAddr)) mem.write32(SELF + Number(slot), a);
        mem.write32(SCREEN + 0x110, SCREEN_DRAW);
        // The rep actor is children[6]; widgets 0..5.
        for (let k = 0; k < 5; k++) mem.write32(CHILDREN + k * 4, W[k]);
        mem.write32(CHILDREN + 0x14, UI.cursor);
        mem.write32(CHILDREN + 0x18, REP);
        mem.write32(SELF + 0x24, CHILDREN);
        mem.write32(SELF + 0x0c, c.state ?? 1);
        mem.write32(SELF + 0x10, c.step ?? 0);
        mem.write32(SELF + 0x14, c.rep ?? 0);
        mem.write32(SELF + 0x18, c.last ?? 2);
        mem.write32(SELF + 0x50, SCREEN);
        mem.write32(SELF + 0x54, 0x1000); mem.write32(SELF + 0x58, 6);
        mem.write32(SELF + 0x5c, c.slot ?? 3);
        mem.write32(SELF + 0x60, c.drill ?? 1);
        mem.write32(SELF + 0xa0, c.group ?? 3);
        for (let k = 0; k < 5; k++) {
            mem.write32(SELF + 0x64 + k * 4, (c.results ?? [-1, -1, -1, -1, -1])[k] >>> 0);
            mem.write32(SELF + 0x78 + k * 4, (c.gains ?? [0, 0, 0, 0, 0])[k] >>> 0);
            mem.write32(SELF + 0x8c + k * 4, (c.losses ?? [0, 0, 0, 0, 0])[k] >>> 0);
        }
        for (let i = 0; i < 0x2c; i += 2) mem.write16(SELF + 0xa4 + i, c.snapshot?.[i >> 1] ?? ((r() * 1200) | 0));
        for (const off of [0xd0, 0xd4, 0xd8, 0xdc, 0xe0, 0xe4, 0xe8, 0xec]) mem.write32(SELF + off, c.fields?.[off] ?? 0);
        mem.write16(SELF + 0xf0, c.channel ?? 0x1234);
        for (const off of [0x104, 0x114, 0x124, 0xf4]) mem.write32(SELF + off, 10);
        for (const off of [0xfc, 0x10c, 0x11c, 0x12c]) mem.write32(SELF + off, c.fields?.[off] ?? 0);
        mem.write32(REP + 0x50, c.repState ?? 1);
        cfg.pressed = c.pressed ?? 0; cfg.held = c.held ?? 0; cfg.repeat = c.repeat ?? 0;
        cfg.channel = c.chan ?? 7; cfg.group = c.group ?? 3; cfg.frame = c.frame ?? 100;
        cfg.done = c.done ?? (() => 0); cfg.waiting = c.waiting ?? (() => 0); cfg.fold = c.fold ?? (() => 1);
        cfg.result = c.result ?? -1;
        const rs = c.rands ?? [0]; let ri = 0; cfg.rand = () => rs[ri++ % rs.length] & 0xffff;
        cfg.projection = c.projection ?? [];
        cfg.created = [ui.widgetAt(1), ui.widgetAt(2), ui.widgetAt(3), ui.widgetAt(4), ui.widgetAt(5), ui.widgetAt(6)];
        ui.resetCreated();
        // The original's stack: the garbage the summary step's two sums read when the entry is absent.
        for (let i = 0; i < 0x1000; i += 4) mem.write32(0x801fff00 - 0x1000 + i, 0);
    };
}

const PAD = (...bits) => bits.reduce((a, b) => a | (1 << b), 0);

function machine(label, c) {
    kit.compare(label, {
        seed: seed(c), ranges: R_SELF, ret: false,
        original: () => kit.call(0x8008706c, [SELF, CHILDREN], 800000),
        port: () => T.gymTrainingMachine(mem, SELF, CHILDREN, host),
    });
}

test("gymTrainingMachine matches F0x8008706C (the rep loop)", () => {
    machine("default", { step: 0 });
    machine("unnamed 7", { step: 7 }); machine("unnamed 0x33", { step: 0x33 }); machine("unnamed big", { step: 0x7fffffff });
    for (const fold of [0, 1]) for (const ready of [0, 1]) {
        machine(`one ${fold}${ready}`, { step: 1, repState: ready, fold: () => fold, slot: 2 });
    }
    for (const accessory of [0, 0x151, 0x152]) {
        seed({})();
        machine(`one bonus ${accessory}`, { step: 1, repState: 1 });
    }
    for (const result of [-1, 0, 1]) for (const rep of [0, 1, 2, 3, 4]) for (const last of [2, 4]) for (const drill of [1, 12, 13, 24]) {
        for (const prior of [[-1, -1, -1, -1, -1], [1, 1, -1, -1, -1], [1, 0, -1, -1, -1], [1, 1, 0, -1, -1]]) {
            machine(`two ${result} ${rep} ${last} ${drill} ${prior}`, {
                step: 2, rep, last, drill, result, results: prior, rands: [5, 70, 1, 30, 2, 9], group: 3, slot: 3,
            });
        }
    }
    machine("three", { step: 3 });
    machine("four ready", { step: 4, repState: 1 }); machine("four not ready", { step: 4, repState: 4 });
});

test("gymTrainingMachine matches F0x8008706C (the summary and the choice)", () => {
    for (const group of [0, 1, 4, 7, 13]) for (const drill of [1, 3, 6, 7, 10, 12, 13, 14, 19, 24]) {
        for (const pressed of [0, PAD(0xd)]) for (const tier of [0, 1, 2]) {
            const gains = [5, 0, 7, 3, 0].map((g) => g * (tier + 1) * 40);
            const losses = [1, 2, 0, 4, 0].map((g) => g * (tier + 1) * 30);
            machine(`five ${group} ${drill} ${pressed} ${tier}`, { step: 5, group, drill, pressed, gains, losses,
                snapshot: Array.from({ length: 22 }, (_, i) => [0, 500, 990, 999, 9900, 9999, 10, 100][(i + tier) % 8]) });
        }
    }
    machine("five no gains", { step: 5, pressed: PAD(0xd), group: 3, drill: 1 });
    for (const done of [0, 1]) for (const waiting of [0, 1]) for (const pressed of [0, PAD(0xd)]) {
        machine(`six ${done}${waiting}${pressed}`, { step: 6, pressed, done: () => done, waiting: () => waiting });
    }
    for (const drill of [1, 12, 13, 20]) machine(`ten ${drill}`, { step: 10, drill });
    machine("eleven", { step: 11 });
    for (const f of [0, 1]) machine(`twelve ${f}`, { step: 12, fold: () => f });
    for (const f of [0, 1]) for (const cur of [0, 1]) machine(`thirteen ${f}`, { step: 13, fold: () => f, fields: { 0xd0: cur } });
    for (const cur of [0, 1]) for (const pressed of [0, PAD(4), PAD(6), PAD(0xd), PAD(0xe), PAD(4, 0xd)]) for (const repeat of [0, PAD(4), PAD(6)]) {
        machine(`fourteen ${cur} ${pressed} ${repeat}`, { step: 14, pressed, repeat, fields: { 0xd0: cur } });
    }
    machine("fifteen", { step: 15 });
    for (const f of [0, 1]) for (const last of [0, 2, 4]) for (const book of [0, 13, 12]) {
        machine(`sixteen ${f} ${last} ${book}`, { step: 16, last, fold: () => f, drill: 12 });
    }
    for (const result of [-1, 0, 1]) for (const drill of [1, 12, 300]) machine(`twenty ${result} ${drill}`, { step: 20, result, drill, rands: [3, 9], chan: 9 });
    machine("fifty", { step: 50 });
});

test("gymTrainingMachine matches with a remembered Ultra drill", () => {
    for (const [remembered, drill] of [[0, 12], [12, 12], [5, 12], [255, 255]]) {
        kit.compare(`sixteen remembered ${remembered} ${drill}`, {
            seed: () => { seed({ step: 16, last: 0, drill, fold: () => 1 })(); mem.write8(UI.block + 0x3cc, remembered); },
            ranges: R_SELF, ret: false,
            original: () => kit.call(0x8008706c, [SELF, CHILDREN], 800000),
            port: () => T.gymTrainingMachine(mem, SELF, CHILDREN, host),
        });
    }
});

test("gymTrainingMachine's bonus percent follows the worn accessory", () => {
    for (const [a, b] of [[0, 0], [0x151, 0], [0, 0x151], [0x152, 0], [0x151, 0x152], [0x152, 0x151]]) {
        kit.compare(`bonus ${a.toString(16)} ${b.toString(16)}`, {
            seed: () => { seed({ step: 1, repState: 1 })(); mem.write16(UI.block + 0x3c8, a); mem.write16(UI.block + 0x3ca, b); },
            ranges: R_SELF, ret: false,
            original: () => kit.call(0x8008706c, [SELF, CHILDREN], 800000),
            port: () => T.gymTrainingMachine(mem, SELF, CHILDREN, host),
        });
    }
});

test("gymTrainingRoll matches F0x800866CC", () => {
    for (const group of [0, 1, 3, 4, 7, 13]) for (const drill of [1, 2, 5, 6, 7, 9, 12, 13, 16, 19, 24, 25, 99]) {
        for (const rep of [0, 2, 3]) for (const hit of [0, 1]) for (const rands of [[0], [9, 3, 77], [1, 0, 1, 5]]) {
            kit.compare(`roll ${group} ${drill} ${rep} ${hit} ${rands}`, {
                seed: seed({ group, drill, results: [hit, hit, 1, hit, 0], rands, gains: [1, 2, 3, 4, 5], slot: 4 }), ranges: R_SELF, ret: false,
                original: () => kit.call(0x800866cc, [SELF, rep], 800000),
                port: () => T.gymTrainingRoll(mem, SELF, rep, host),
            });
        }
    }
});

test("gymTrainingWidgets and gymTrainingCreate match F0x80086B24 and F0x80088070", () => {
    kit.compare("widgets", { seed: seed({}), ranges: R_SELF, ret: false,
        original: () => kit.call(0x80086b24, [SELF, CHILDREN]), port: () => T.gymTrainingWidgets(mem, SELF, CHILDREN, host) });
    for (const group of [0, 5]) {
        kit.compare("create", { seed: seed({ group }), ranges: R_SELF,
            original: () => kit.call(0x80088070, [SCREEN, 3, 12]),
            port: () => T.gymTrainingCreate(mem, host, SCREEN, 3, 12) });
    }
});

test("gymTrainingTick matches F0x80087F28 (building the window, idling, stepping)", () => {
    for (const state of [0, 4, 5, -1, 2, 3]) {
        kit.compare(`tick build ${state}`, {
            seed: seed({ state, slot: 2, drill: 5, projection: Array.from({ length: 0x2c }, (_, i) => (i * 7) & 0xff) }), ranges: R_SELF, ret: false,
            original: () => kit.call(0x80087f28, [SELF, CHILDREN], 800000),
            port: () => { realRep = true; try { T.gymTrainingTick(mem, SELF, CHILDREN, host); } finally { realRep = false; } },
        });
    }
});

// The picture draw: the original records its picture-service calls; the port records the same.
kit.cell(0x80044f5c, "packResolve", (h) => h, { args: 1, silent: true });
const DARGS = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };
test("gymTrainingDraw matches F0x80086C0C", () => {
    for (let n = 0; n < 400; n++) {
        const r = rng(n + 7);
        const pick = (...v) => v[(r() * v.length) | 0];
        const c = {
            seed: n,
            results: [0, 1, 2, 3, 4].map(() => pick(-1, 0, 1)),
            fields: { 0xd4: pick(0, 1), 0xd8: pick(0, 1), 0xdc: pick(0, 1), 0xe0: 100 - pick(0, 1, 2, 3, 5), 0xe4: pick(0, 1), 0xe8: pick(0, 2, 4), 0xec: 100 - pick(0, 3, 4, 9),
                0xfc: pick(0, 0x800, 0x1000), 0x10c: pick(0, 0x400, 0x1000), 0x11c: pick(0, 0xf00, 0x1000), 0x12c: pick(0, 0x1, 0x1000) },
        };
        seed(c)();
        mem.write32(0x8004de20, 100);
        const before = kit.rt.drawCalls.length;
        kit.call(0x80086c0c, [SELF]);
        const oracle = kit.rt.drawCalls.slice(before).map((d) => [d.method, d.args.slice(0, DARGS[d.method] ?? 4).map((v) => v >>> 0)]);
        kit.rt.drawCalls.length = before;
        const oSnap = kit.words(R_SELF);
        seed(c)();
        mem.write32(0x8004de20, 100);
        const got = [];
        T.gymTrainingDraw(mem, SELF, {
            initDrawContext() {},
            setLayer(t, b) { got.push(["setLayer", [t, b]]); },
            setOrigin(x, y) { got.push(["setOrigin", [x, y]]); },
            setScale(x, y, z) { got.push(["setScale", [x, y, z]]); },
            setPos(x, y) { got.push(["setPos", [x, y]]); },
            paletteShift(v) { got.push(["m_0x88", [v]]); },
            drawSprite(p, cl, x, y) { got.push(["drawSprite", [p, cl, x, y]]); },
            packResolve: (h) => h,
            frameTick: () => mem.read32(0x8004de20) | 0,
        });
        assert.ok(oracle.length >= 2, "the original recorded its picture calls");
        assert.deepEqual(got.map(([m, a]) => [m, a.map((v) => v >>> 0)]), oracle, `draw ${n}`);
        assert.deepEqual(kit.words(R_SELF), oSnap, `draw ${n}: memory`);
    }
});
