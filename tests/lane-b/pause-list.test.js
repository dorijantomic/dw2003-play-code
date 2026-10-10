// Lane B oracle: engine/dw3/ui/native/pause-list.ts must match the resident pause
// list (tick F0x8001270c with its fold, widget, card and MAP-gate helpers).
//
// The original runs from the shipped resident.bin through engine/native. Every
// service it reaches through a pointer (sound, text bank, pack, pad, clock, scene,
// party), the two widget creators, the draw context and the object/widget methods
// are stubbed on both sides. Each tick compares the ordered calls, the object, its
// widget slots and the two globals the list writes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { pauseListTick, PAUSE_LIST_SAVED_ROW } from "../../engine/dw3/ui/native/pause-list.ts";

const resident = new Uint8Array(readFileSync(new URL("../../web/assets/native/screens/resident.bin", import.meta.url)));
const OBJ = 0x801a0000, SLOTS = 0x801a0100, WIDGETS = 0x801b0000, NAMES = 0x80aa0000, BANK = 0x80bb0000, PACK = 0x80190000;
const TICK = 0x8001270c, DRAW_CTX = 0x8001f648, CREATE_TEXT = 0x8001ae38, CREATE_CURSOR = 0x8001b364;
const GAME = 0x80048d34;
const BIT = { 4: 12, 6: 2, 13: 7, 14: 10 }; // a deliberately scrambled logical-button map
const WIDGET_SLOTS = { 0x80: 1, 0x84: 2, 0x114: 2, 0x118: 2, 0x138: 1, 0x144: 1, 0x148: 1 };
const CTX = { 0x74: ["origin", 2], 0x7c: ["layer", 2], 0x84: ["sprite", 4], 0x88: ["palette", 1], 0x8c: ["scale", 3], 0x94: ["pivot", 2], 0x98: ["ctx98", 1] };
const STUB = 0x0fd40000;

function makeWorld(over = {}) {
    return { scene: 0x150, saved: 0x120, cardFlag: 0, money: 1234, slots: [3, 4, 5], ...over };
}
const statsOf = (slot) => (i) => (i === 3 ? -7 : slot * 100 + i);

function seed(mem, world) {
    mem.write8(0x80048f42, world.cardFlag);
    mem.write32(0x80048da0, world.money);
    mem.write32(GAME + 0x34, world.saved);
    mem.write32(OBJ + 0xc, 0);
    mem.write32(OBJ + 0x10, 0);
    mem.write32(OBJ + 0x50, 0x1002);
    mem.write32(OBJ + 0x54, 1);
    mem.write32(OBJ + 0x58, world.row ?? 0);
}

function originalSide(world, input) {
    const rt = new NativeStageRuntime(new Uint8Array(8),
        { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
        { setFlag() {}, getFlag: () => 0, rand16: () => 0 }, undefined, undefined, 0x80082cb0,
        { image: resident, base: 0x80010000 });
    const log = [];
    let stub = STUB, widgets = 0;
    const add = (fn) => { const at = stub; stub += 4; rt.cpu.setStub(at, fn); return at; };
    const ptr = (addr, fn) => rt.mem.write32(addr, add(fn));
    ptr(0x80055c48, (c) => { log.push(["sfx", c.reg(4) >>> 0]); return 0; });
    ptr(0x80044f4c, (c) => { log.push(["bank", c.reg(4) | 0]); return BANK; });
    ptr(0x80044f5c, (c) => { log.push(["pack", c.reg(4) >>> 0]); return PACK; });
    ptr(0x8004b7d0 + 0x3f4, () => { log.push(["pressed"]); return input().pressed; });
    ptr(0x8004b7d0 + 0x3fc, () => { log.push(["repeat"]); return input().repeat; });
    ptr(0x8004b7d0 + 0x408, (c) => { log.push(["bit", c.reg(5)]); return BIT[c.reg(5)]; });
    ptr(0x8004de10 + 0x188, () => { log.push(["now"]); return input().clock; });
    ptr(GAME + 0x2704, () => { log.push(["scene"]); return world.scene; });
    ptr(GAME + 0x270c, (c) => { log.push(["change", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    ptr(GAME + 0x2718, (c) => { log.push(["party", c.reg(4)]); return world.slots[c.reg(4)] ?? -1; });
    ptr(GAME + 0x2750, (c) => { log.push(["name", c.reg(4)]); return NAMES + c.reg(4); });
    ptr(GAME + 0x2734, (c) => {
        log.push(["stats", c.reg(4)]);
        for (let i = 0; i < 16; i++) rt.mem.write16(c.reg(5) + i * 2, statsOf(c.reg(4))(i) & 0xffff);
        return 0;
    });
    const methods = {};
    for (const [slot, arity] of Object.entries(WIDGET_SLOTS)) {
        methods[slot] = add((c) => { log.push(["m", c.reg(4) >>> 0, Number(slot), ...[5, 6].slice(0, arity).map((r) => c.reg(r) | 0)]); return 0; });
    }
    const widget = (kind) => (c) => {
        const at = WIDGETS + widgets++ * 0x200;
        for (const [slot, fn] of Object.entries(methods)) rt.mem.write32(at + Number(slot), fn);
        log.push([kind, c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return at;
    };
    rt.cpu.setStub(CREATE_TEXT, widget("text"));
    rt.cpu.setStub(CREATE_CURSOR, widget("cursor"));
    const ctxFns = Object.fromEntries(Object.entries(CTX).map(([off, [name, arity]]) =>
        [off, add((c) => { log.push([name, ...[4, 5, 6, 7].slice(0, arity).map((r) => c.reg(r) | 0)]); return 0; })]));
    rt.cpu.setStub(DRAW_CTX, (c) => {
        log.push(["drawctx"]);
        for (const [off, fn] of Object.entries(ctxFns)) rt.mem.write32(c.reg(4) + Number(off), fn);
        return 0;
    });
    rt.mem.write32(OBJ + 0x28, add((c) => {
        log.push(["m", c.reg(4) >>> 0, 0x28, c.reg(5) | 0]);
        rt.mem.write32(OBJ + 0xc, c.reg(5)); rt.mem.write32(OBJ + 0x10, 0); return 0;
    }));
    rt.mem.write32(OBJ + 0x38, add((c) => {
        log.push(["m", c.reg(4) >>> 0, 0x38]);
        rt.mem.write32(OBJ + 0xc, 1); rt.mem.write32(OBJ + 0x10, 0); return 0;
    }));
    seed(rt.mem, world);
    return { mem: rt.mem, log, tick: () => rt.cpu.call(TICK, [OBJ, SLOTS], 200000) };
}

function portSide(world, input) {
    const rt = new NativeStageRuntime(new Uint8Array(8),
        { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
        { setFlag() {}, getFlag: () => 0, rand16: () => 0 }, undefined, undefined, 0x80082cb0,
        { image: resident, base: 0x80010000 });
    const mem = rt.mem, log = [];
    let widgets = 0;
    const widget = (kind) => (layer, k, x, y) => { log.push([kind, layer, k, x, y]); return WIDGETS + widgets++ * 0x200; };
    const host = {
        sfx: (id) => log.push(["sfx", id >>> 0]),
        callMethod(target, slot, args) {
            log.push(["m", target >>> 0, slot, ...args.map((v) => v | 0)]);
            if (target === OBJ && slot === 0x28) { mem.write32(OBJ + 0xc, args[0]); mem.write32(OBJ + 0x10, 0); }
            if (target === OBJ && slot === 0x38) { mem.write32(OBJ + 0xc, 1); mem.write32(OBJ + 0x10, 0); }
            return 0;
        },
        textBank: (id) => { log.push(["bank", id]); return BANK; },
        packResolve: (h) => { log.push(["pack", h >>> 0]); return PACK; },
        padPressed: () => { log.push(["pressed"]); return input().pressed; },
        padRepeat: () => { log.push(["repeat"]); return input().repeat; },
        padBit: (b) => { log.push(["bit", b]); return BIT[b]; },
        now: () => { log.push(["now"]); return input().clock; },
        sceneId: () => { log.push(["scene"]); return world.scene; },
        changeScene: (s, a) => log.push(["change", s, a]),
        partySlot: (c) => { log.push(["party", c]); return world.slots[c] ?? -1; },
        slotName: (s) => { log.push(["name", s]); return NAMES + s; },
        slotStats: (s) => { log.push(["stats", s]); return statsOf(s); },
        createText: widget("text"),
        createCursor: widget("cursor"),
        initDrawContext: () => log.push(["drawctx"]),
        setOrigin: (x, y) => log.push(["origin", x, y]),
        setLayer: (a, b) => log.push(["layer", a, b]),
        context98: (v) => log.push(["ctx98", v]),
        paletteShift: (v) => log.push(["palette", v]),
        setScale: (x, y, z) => log.push(["scale", x, y, z]),
        setPivot: (x, y) => log.push(["pivot", x, y]),
        drawSprite: (p, c, x, y) => log.push(["sprite", p | 0, c, x, y]),
    };
    seed(mem, world);
    return { mem, log, tick: () => pauseListTick(mem, OBJ, SLOTS, host) };
}

const snapshot = (mem) => [
    // +0x28 / +0x38 hold the test's method stubs on the original side only.
    ...Array.from({ length: 0xac / 4 }, (_, i) => (i === 0x28 / 4 || i === 0x38 / 4 ? 0 : mem.read32(OBJ + i * 4) >>> 0)),
    ...Array.from({ length: 0x84 / 4 }, (_, i) => mem.read32(SLOTS + i * 4) >>> 0),
    mem.read32(PAUSE_LIST_SAVED_ROW) >>> 0, mem.read32(0x8005ccf4) >>> 0,
];

// script: one entry per tick, { press: [buttons], hold: [buttons] }; an empty entry is an idle tick.
function run(name, world, script) {
    let current = { pressed: 0, repeat: 0, clock: 0 };
    const input = () => current;
    const orig = originalSide(world, input), port = portSide(world, input);
    script.forEach((step, i) => {
        const bits = (list = []) => list.reduce((m, b) => m | (1 << BIT[b]), 0);
        current = { pressed: bits(step.press), repeat: bits(step.hold), clock: i };
        orig.log.length = 0; port.log.length = 0;
        orig.tick(); port.tick();
        assert.deepEqual(port.log, orig.log, `${name}: tick ${i} calls`);
        assert.deepEqual(snapshot(port.mem), snapshot(orig.mem), `${name}: tick ${i} state`);
    });
    return { state: orig.mem.read32(OBJ + 0xc), step: orig.mem.read32(OBJ + 0x10), row: orig.mem.read32(OBJ + 0x58) };
}

const idle = (n) => Array.from({ length: n }, () => ({}));
const UP = 4, DOWN = 6, CONFIRM = 13, BACK = 14;

test("pauseListTick matches F0x8001270c: field START, move, choose a row, wipe to the pages", () => {
    const end = run("open-choose", makeWorld(), [
        ...idle(36), { press: [DOWN] }, { hold: [DOWN] }, { press: [UP] }, { press: [CONFIRM] }, ...idle(140),
    ]);
    assert.equal(end.state, 2, "the list ends in the row wipe");
    assert.ok(end.step > 6, "the wipe reached the scene change");
});

test("pauseListTick matches with CARD FOLDERS, a refused MAP and Back to the field", () => {
    const end = run("refused-map", makeWorld({ cardFlag: 1, scene: 0x2d8 }), [
        ...idle(36), { press: [DOWN] }, { press: [DOWN] }, { press: [CONFIRM] }, { hold: [DOWN] }, { hold: [DOWN] },
        { hold: [DOWN] }, { hold: [DOWN] }, { press: [BACK] }, ...idle(30),
    ]);
    assert.equal(end.state, 3, "Back on the field list removes it");
});

test("pauseListTick matches inside the pages scene: Back wipes to the saved field, an empty card", () => {
    const end = run("pages-back", makeWorld({ scene: 0x1000, slots: [3, -1, 5], row: 4 }), [
        ...idle(36), { press: [BACK] }, ...idle(140),
    ]);
    assert.equal(end.state, 2);
});

test("pauseListTick matches inside the pages scene: MAP refused by the saved field, then a row removes the list", () => {
    const end = run("pages-choose", makeWorld({ scene: 0x1000, saved: 0x2d9, row: 2 }), [
        ...idle(36), { press: [CONFIRM] }, { press: [DOWN] }, { press: [CONFIRM] }, ...idle(30),
    ]);
    assert.equal(end.state, 3);
});
