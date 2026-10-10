// Phase 4 oracle: engine/dw3/ui/player-hud.ts must match pro/cardgame's
// F0x80099440 (slidePlayerPanel) and F0x80098898 (drawPlayerCardRow). Both
// originals run through engine/native on the shipped pro_cardgame.bin +
// resident.bin with the frame delta and pack resolver stubbed and the draw
// context recorded; the port uses an equivalent host over the same memory.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { drawPlayerCardRow, slidePlayerPanel } from "../engine/dw3/ui/player-hud.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const SCRATCH = 0x80170000;
const PACK_STUB = 0x0feb0000;
const DELTA_STUB = 0x0fe20000;
const PACK_PTR = 0x80190000;
const HZ_FLAG = 0x8005ccb0;
const LANGUAGE = 0x8005cca8;
const CTX_ARITY = { setOrigin: 2, setLayer: 2, setPos: 2, setScale: 3, drawSprite: 4, setFrame: 1, m_0x88: 1 };

let EVENTS = [];
let PORT_DRAW = [];
let DELTA = 1;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4) >>> 0]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(DELTA_STUB, () => { EVENTS.push(["delta"]); return DELTA; });
    rt.mem.write32(0x8004df9c, DELTA_STUB);
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    PORT_DRAW = [];
    DELTA = o.delta ?? 1;
    for (let i = 0; i < 0x60; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write16(OBJ + 0x00, (o.timer ?? 10) & 0xffff);
    rt.mem.write16(OBJ + 0x02, (o.duration ?? 10) & 0xffff);
    rt.mem.write16(OBJ + 0x04, (o.state ?? 0) & 0xffff);
    rt.mem.write16(OBJ + 0x06, (o.arrival ?? 0) & 0xffff);
    rt.mem.write32(OBJ + 0x08, (o.phase ?? 0) >>> 0);
    rt.mem.write16(OBJ + 0x0c, (o.x ?? 0) & 0xffff);
    rt.mem.write16(OBJ + 0x0e, (o.y ?? 0x8d) & 0xffff);
    rt.mem.write16(OBJ + 0x10, (o.totalA ?? 0) & 0xffff);
    rt.mem.write16(OBJ + 0x12, (o.totalB ?? 0) & 0xffff);
    for (let i = 0; i < 5; i++) rt.mem.write8(OBJ + 0x18 + i, o.slots?.[i] ?? 0);
    rt.mem.write8(OBJ + 0x1d, o.counterA ?? 0);
    rt.mem.write8(OBJ + 0x1e, o.counterB ?? 0);
    rt.mem.write16(OBJ + 0x20, (o.altX ?? 288) & 0xffff);
    rt.mem.write16(OBJ + 0x22, (o.altY ?? 0x8f) & 0xffff);
    rt.mem.write16(OBJ + 0x28, (o.altNumber ?? 0) & 0xffff);
    for (let i = 0; i < 5; i++) rt.mem.write8(OBJ + 0x30 + i, o.flags?.[i] ?? 0);
    rt.mem.write8(OBJ + 0x35, o.altMarkerGate ?? 0);
    rt.mem.write8(OBJ + 0x36, o.deckGate ?? 0);
    rt.mem.write8(OBJ + 0x37, o.trashGate ?? 0);
    rt.mem.write8(OBJ + 0x38, o.apGlow ?? 0);
    rt.mem.write8(OBJ + 0x39, o.hpGlow ?? 0);
    rt.mem.write16(OBJ + 0x3c, (o.plateX ?? 0x113) & 0xffff);
    rt.mem.write16(OBJ + 0x3e, (o.plateY ?? 0xbd) & 0xffff);
    rt.mem.write32(OBJ + 0x44, (o.plateIndex ?? 0) >>> 0);
    rt.mem.write32(HZ_FLAG, o.hz ?? 0);
    rt.mem.write32(LANGUAGE, o.lang ?? 2);
}

function fields() {
    const out = [];
    for (let off = 0; off <= 0x0e; off += 2) out.push(rt.mem.read16(OBJ + off));
    out.push(rt.mem.read32(OBJ + 0x08) >>> 0);
    for (let off = 0x10; off <= 0x28; off += 2) out.push(rt.mem.read16(OBJ + off));
    for (let off = 0x30; off <= 0x39; off++) out.push(rt.mem.read8(OBJ + off));
    for (let off = 0x3c; off <= 0x4a; off += 2) out.push(rt.mem.read16(OBJ + off));
    out.push(rt.mem.read32(OBJ + 0x44) >>> 0);
    return out;
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, CTX_ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        setOrigin(x, y) { PORT_DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { PORT_DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setFrame(n) { PORT_DRAW.push(["m_0x88", [n, 0, 0, 0]]); },
        setPos(x, y) { PORT_DRAW.push(["setPos", [x, y, 0, 0]]); },
        setScale(x, y, z) { PORT_DRAW.push(["setScale", [x, y, z, 0]]); },
        drawSprite(p, c, x, y) { PORT_DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
        frameDelta() { EVENTS.push(["delta"]); return DELTA; },
        scratch() { for (let i = 0; i < 0x12; i++) rt.mem.write8(SCRATCH + i, 0); return SCRATCH; },
    };
}

function compare(label, o, original, port) {
    seed(o);
    original();
    const oEvents = EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v)));
    const oDraws = normDraw(rt.drawCalls.map((c) => [c.method, c.args]));
    rt.drawCalls.length = 0;
    const oFields = fields();

    seed(o);
    port(rt.mem);
    assert.deepEqual(EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v))), oEvents,
        `${label}: calls`);
    assert.deepEqual(normDraw(PORT_DRAW), oDraws, `${label}: draw`);
    assert.deepEqual(fields(), oFields, `${label}: fields`);
}

test("slidePlayerPanel matches F0x80099440", () => {
    const slide = (label, o) => compare(label, o,
        () => rt.cpu.call(0x80099440, [OBJ, 0, o.side ?? 0]),
        (mem) => slidePlayerPanel(mem, OBJ, o.side ?? 0, portHost()));
    slide("idle 0", { state: 0, side: 0 });
    slide("idle 2", { state: 2, side: 0 });
    slide("state 6 is out of range", { state: 6, side: 0 });
    slide("negative state", { state: -1, side: 0 });
    slide("arrival 1 clears", { state: 0, arrival: 1, side: 0 });
    slide("arrival 2 clears", { state: 0, arrival: 2, side: 0 });
    slide("arrival 5 stays", { state: 0, arrival: 5, side: 0 });
    slide("in tick", { state: 1, timer: 10, duration: 10, side: 0 });
    slide("in lands", { state: 1, timer: 1, duration: 10, side: 0 });
    slide("in side 1", { state: 1, timer: 3, duration: 12, side: 1 });
    slide("out tick", { state: 3, timer: 6, duration: 10, side: 0 });
    slide("out lands", { state: 3, timer: 1, duration: 10, side: 1 });
    slide("y-only in", { state: 4, timer: 4, duration: 8, side: 0 });
    slide("y-only in lands", { state: 4, timer: 1, duration: 8, side: 1 });
    slide("y-only out", { state: 5, timer: 4, duration: 8, side: 0 });
    slide("y-only out lands", { state: 5, timer: 1, duration: 8, side: 1 });
    slide("zero duration in", { state: 1, timer: 5, duration: 0, side: 0 });
    slide("zero duration out", { state: 3, timer: 5, duration: 0, side: 1 });
    slide("delta 3", { state: 1, timer: 8, duration: 8, delta: 3, side: 0 });
    slide("timer wraps", { state: 3, timer: 0, duration: 4, delta: 5, side: 1 });
    slide("half in", { state: 1, timer: 5, duration: 20, side: 0 });
    slide("half out", { state: 3, timer: 15, duration: 20, side: 1 });
});

test("drawPlayerCardRow matches F0x80098898", () => {
    const row = (label, o) => compare(label, o,
        () => rt.cpu.call(0x80098898, [OBJ, 0, o.side ?? 0]),
        (mem) => drawPlayerCardRow(mem, OBJ, o.side ?? 0, portHost()));
    row("rest side 0", { side: 0, phase: 0 });
    row("rest side 1", { side: 1, phase: 0 });
    row("phase 5", { side: 0, phase: 5 });
    row("phase 6", { side: 0, phase: 6 });
    row("phase 29", { side: 0, phase: 29 });
    row("phase 30", { side: 0, phase: 30 });
    row("phase 36", { side: 1, phase: 36 });
    row("phase 123", { side: 0, phase: 123 });
    row("all slot flags", { side: 0, flags: [1, 1, 1, 1, 1], phase: 12 });
    row("one slot flag", { side: 0, flags: [0, 0, 1, 0, 0], phase: 7 });
    row("ap glow", { side: 0, apGlow: 1, phase: 30 });
    row("hp glow", { side: 1, hpGlow: 1, phase: 54 });
    row("deck icon", { side: 0, deckGate: 1, phase: 18 });
    row("trash icon", { side: 1, trashGate: 1, phase: 18 });
    row("alt marker", { side: 0, altMarkerGate: 1, phase: 24 });
    row("phase 36 gates", {
        side: 0, flags: [1, 0, 0, 0, 0], deckGate: 1, trashGate: 1, altMarkerGate: 1, phase: 36,
    });
    row("phase 42 gates", {
        side: 1, flags: [1, 1, 0, 0, 0], deckGate: 1, trashGate: 1, phase: 42,
    });
    row("every flag", {
        side: 0, flags: [1, 1, 1, 1, 1], apGlow: 1, hpGlow: 1, deckGate: 1, trashGate: 1,
        altMarkerGate: 1, phase: 60,
    });
    row("numbers", {
        side: 0, counterA: 12, counterB: 34, totalA: 567, totalB: 999, slots: [1, 2, 3, 4, 5],
        altNumber: 77, phase: 3,
    });
    row("50hz side 0", { side: 0, hz: 1, phase: 9 });
    row("50hz side 1", { side: 1, hz: 1, phase: 9 });
    row("plate index", { side: 0, plateIndex: 3, phase: 9 });
    row("low language", { side: 0, lang: 0, phase: 9 });
    row("delta 4", { side: 0, phase: 100, delta: 4 });
    row("negative phase", { side: 0, phase: -36 });
});
