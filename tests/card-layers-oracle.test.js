// Phase 4 oracle: engine/dw3/ui/card-layers.ts must match pro/cardgame's
// cardSpriteDraw (F0x8009BA3C), drawCardStatusPips (F0x8009B028),
// drawCardElementMark (F0x8009AF28) and drawCannotUseOverlay (F0x8009B678).
// Each original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin with the pack resolver and the three untranslated sibling draws
// recorded; the port uses an equivalent host over the same memory.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    cardSpriteDraw, drawCardStatusPips, drawCardElementMark, drawCannotUseOverlay,
} from "../engine/dw3/ui/card-layers.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const VIEW = 0x80181000;
const SPRITE = 0x80180000;
const PACK_STUB = 0x0feb0000;
const PACK_PTR = 0x80190000;
const SIBLINGS = [[0x8009acac, "glow"], [0x8009a998, "badge"], [0x8009b168, "face"]];
const ARITY = { setOrigin: 2, setLayer: 2, setPos: 2, setScale: 3, drawSprite: 4 };

let EVENTS = [];
let PORT_DRAW = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4) >>> 0]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    for (const [addr, name] of SIBLINGS) {
        rt.cpu.setStub(addr, (c) => { EVENTS.push([name, c.reg(4) >>> 0, c.reg(5) >>> 0]); });
    }
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    PORT_DRAW = [];
    for (let i = 0; i <= 0x50; i += 4) rt.mem.write32(SPRITE + i, 0);
    rt.mem.write32(SPRITE + 0x00, (o.x ?? 0) | 0);
    rt.mem.write32(SPRITE + 0x04, (o.y ?? 0) | 0);
    rt.mem.write16(SPRITE + 0x18, (o.scaleX ?? 0x1000) & 0xffff);
    rt.mem.write16(SPRITE + 0x1a, (o.scaleY ?? 0x1000) & 0xffff);
    rt.mem.write8(SPRITE + 0x3e, o.p0 ?? 0);
    rt.mem.write8(SPRITE + 0x3f, o.p1 ?? 0);
    rt.mem.write8(SPRITE + 0x40, o.p2 ?? 0);
    rt.mem.write8(SPRITE + 0x45, o.kind ?? 0);
    rt.mem.write8(SPRITE + 0x46, o.element ?? 0);
    rt.mem.write8(SPRITE + 0x49, o.cannotUse ?? 0);
}

function events() { return EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v >>> 0 : v))); }
function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        setPos(x, y) { PORT_DRAW.push(["setPos", [x, y, 0, 0]]); },
        setScale(x, y, z) { PORT_DRAW.push(["setScale", [x, y, z, 0]]); },
        setLayer(t, b) { PORT_DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setOrigin(x, y) { PORT_DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        drawSprite(p, c, x, y) { PORT_DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
        drawSelectionGlow(v, s) { EVENTS.push(["glow", v >>> 0, s >>> 0]); },
        drawEffectBadge(v, s) { EVENTS.push(["badge", v >>> 0, s >>> 0]); },
        drawFace(v, s) { EVENTS.push(["face", v >>> 0, s >>> 0]); },
    };
}

function compare(label, o, addr, portFn, args) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(addr, args);
    const oDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oEvents = events();

    seed(o);
    const host2 = portHost();
    if (addr === 0x8009ba3c) cardSpriteDraw(rt.mem, args[0], args[1], host2);
    else portFn(rt.mem, args[1], host2);
    assert.deepEqual(events(), oEvents, `${label}: calls`);
    assert.deepEqual(normDraw(PORT_DRAW), oDraw, `${label}: draw`);
}

test("drawCardStatusPips matches F0x8009B028", () => {
    compare("kind 0", { kind: 0, p0: 1, p1: 1, p2: 1 }, 0x8009b028, drawCardStatusPips, [VIEW, SPRITE]);
    compare("no pips", { kind: 1, p0: 0, p1: 0, p2: 0 }, 0x8009b028, drawCardStatusPips, [VIEW, SPRITE]);
    compare("one pip", { kind: 1, p0: 1, x: 0x10000, y: 0x20000 }, 0x8009b028, drawCardStatusPips, [VIEW, SPRITE]);
    compare("three pips", { kind: 1, p0: 1, p1: 1, p2: 1, x: 0x6400, y: 0x3200 }, 0x8009b028, drawCardStatusPips, [VIEW, SPRITE]);
    compare("skipped middle", { kind: 1, p0: 1, p1: 0, p2: 1, x: 100 << 8, y: 50 << 8 }, 0x8009b028, drawCardStatusPips, [VIEW, SPRITE]);
    compare("only middle", { kind: 1, p0: 0, p1: 1, p2: 0, x: 100 << 8, y: 50 << 8 }, 0x8009b028, drawCardStatusPips, [VIEW, SPRITE]);
    compare("scaled", { kind: 1, p0: 1, p1: 1, p2: 1, scaleX: 0x0800, scaleY: 0x1000 }, 0x8009b028, drawCardStatusPips, [VIEW, SPRITE]);
    compare("negative coords", { kind: 1, p0: 1, x: -4000, y: -300 }, 0x8009b028, drawCardStatusPips, [VIEW, SPRITE]);
});

test("drawCardElementMark matches F0x8009AF28", () => {
    compare("kind 0", { kind: 0, element: 3 }, 0x8009af28, drawCardElementMark, [VIEW, SPRITE]);
    compare("element 0", { kind: 1, element: 0 }, 0x8009af28, drawCardElementMark, [VIEW, SPRITE]);
    compare("element 3", { kind: 1, element: 3, x: 100 << 8, y: 50 << 8 }, 0x8009af28, drawCardElementMark, [VIEW, SPRITE]);
    compare("scaled", { kind: 1, element: 7, scaleX: 0x0800, scaleY: 0x0800 }, 0x8009af28, drawCardElementMark, [VIEW, SPRITE]);
});

test("drawCannotUseOverlay matches F0x8009B678", () => {
    compare("kind 0", { kind: 0, cannotUse: 1 }, 0x8009b678, drawCannotUseOverlay, [VIEW, SPRITE]);
    compare("allowed", { kind: 1, cannotUse: 0 }, 0x8009b678, drawCannotUseOverlay, [VIEW, SPRITE]);
    compare("locked", { kind: 1, cannotUse: 1, x: 100 << 8, y: 50 << 8 }, 0x8009b678, drawCannotUseOverlay, [VIEW, SPRITE]);
    compare("scaled lock", { kind: 1, cannotUse: 1, scaleX: 0x0800, scaleY: 0x1000 }, 0x8009b678, drawCannotUseOverlay, [VIEW, SPRITE]);
});

test("cardSpriteDraw matches F0x8009BA3C", () => {
    const full = { kind: 1, p0: 1, p1: 1, p2: 1, element: 2, cannotUse: 1, x: 100 << 8, y: 50 << 8 };
    compare("scaleX zero", { ...full, scaleX: 0 }, 0x8009ba3c, cardSpriteDraw, [VIEW, SPRITE]);
    compare("scaleY zero", { ...full, scaleY: 0 }, 0x8009ba3c, cardSpriteDraw, [VIEW, SPRITE]);
    compare("all layers", full, 0x8009ba3c, cardSpriteDraw, [VIEW, SPRITE]);
    compare("kind 0 siblings only", { ...full, kind: 0 }, 0x8009ba3c, cardSpriteDraw, [VIEW, SPRITE]);
    compare("scaled", { ...full, scaleX: 0x0800, scaleY: 0x0800 }, 0x8009ba3c, cardSpriteDraw, [VIEW, SPRITE]);
});
