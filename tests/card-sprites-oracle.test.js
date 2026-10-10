// Phase 4 oracle: engine/dw3/ui/card-sprites.ts must match pro/cardgame's
// F0x8009B890 (cardSpriteUpdate), F0x8009B76C (drawSpinningCardBack) and
// F0x8009BAC8 (cardSpritesTickAll). Each original runs through engine/native on
// the shipped pro_cardgame.bin + resident.bin with the seven per-state bodies,
// the three card-sprite siblings, the pack resolver and the frame delta
// recorded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { cardSpriteUpdate, drawSpinningCardBack, cardSpritesTickAll, cardSpriteEntry } from "../engine/dw3/ui/card-sprites.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const VIEW = 0x80180000;
const SPRITE = 0x80181000;
const PACK_STUB = 0x0feb0000;
const PACK_PTR = 0x80190000;
const DELTA_STUB = 0x0fe20000;
const STATE_BODIES = [0x80099ffc, 0x8009a75c, 0x8009a1a0, 0x8009a62c, 0x8009a454, 0x8009a540, 0x8009a5b0];
const SIBLINGS = [[0x8009acac, "glow"], [0x8009a998, "badge"], [0x8009b168, "face"]];
const ARITY = { setOrigin: 2, setLayer: 2, setPos: 2, setScale: 3, m_0x88: 1, drawSprite: 4 };

let EVENTS = [];
let PORT_DRAW = [];
let DELTA = 1;
let STATE5_RET = 0;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4) >>> 0]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(DELTA_STUB, () => { EVENTS.push(["delta", 0]); return DELTA; });
    rt.mem.write32(0x8004df9c, DELTA_STUB);
    for (const addr of STATE_BODIES) {
        rt.cpu.setStub(addr, (c) => {
            EVENTS.push(["state", addr >>> 0, c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
            return addr === 0x8009a1a0 ? STATE5_RET : 0;
        });
    }
    for (const [addr, name] of SIBLINGS) {
        rt.cpu.setStub(addr, (c) => { EVENTS.push([name, c.reg(4) >>> 0, c.reg(5) >>> 0]); });
    }
    return rt;
}

const rt = runtime();

function seedSprite(view, sprite, o = {}) {
    for (let i = 0; i <= 0x50; i += 4) rt.mem.write32(sprite + i, 0);
    rt.mem.write32(sprite + 0x00, (o.x ?? 0) | 0);
    rt.mem.write32(sprite + 0x04, (o.y ?? 0) | 0);
    rt.mem.write16(sprite + 0x18, (o.scaleX ?? 0) & 0xffff);
    rt.mem.write16(sprite + 0x1a, (o.scaleY ?? 0) & 0xffff);
    rt.mem.write16(sprite + 0x26, (o.layerFlag ?? 0) & 0xffff);
    rt.mem.write32(sprite + 0x2c, (o.anim ?? 0) >>> 0);
    rt.mem.write8(sprite + 0x42, o.state ?? 0);
    rt.mem.write8(sprite + 0x45, o.kind ?? 0);
}

function seed(o = {}) {
    EVENTS = [];
    PORT_DRAW = [];
    DELTA = o.delta ?? 1;
    STATE5_RET = o.state5 ?? 0;
    for (let i = 0; i <= 0x60; i += 4) rt.mem.write32(VIEW + i, 0);
    for (let i = 0; i < 40; i++) seedSprite(VIEW, cardSpriteEntry(VIEW, i), (o.sprites ?? {})[i] ?? {});
    seedSprite(VIEW, SPRITE, o.sprite ?? {});
}

function fields() {
    const out = [rt.mem.read32(VIEW + 0x54) >>> 0];
    for (let i = 0; i < 6; i++) {
        const s = cardSpriteEntry(VIEW, i);
        out.push(rt.mem.read16(s + 0x26), rt.mem.read32(s + 0x2c) >>> 0, rt.mem.read8(s + 0x42), rt.mem.read8(s + 0x45));
    }
    return out;
}
function events() { return EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v >>> 0 : v))); }
function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        frameDelta() { EVENTS.push(["delta", 0]); return DELTA; },
        setPos(x, y) { PORT_DRAW.push(["setPos", [x, y, 0, 0]]); },
        setScale(x, y, z) { PORT_DRAW.push(["setScale", [x, y, z, 0]]); },
        setLayer(t, b) { PORT_DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setOrigin(x, y) { PORT_DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setFrame(n) { PORT_DRAW.push(["m_0x88", [n, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { PORT_DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
        drawSelectionGlow(v, s) { EVENTS.push(["glow", v >>> 0, s >>> 0]); },
        drawEffectBadge(v, s) { EVENTS.push(["badge", v >>> 0, s >>> 0]); },
        drawFace(v, s) { EVENTS.push(["face", v >>> 0, s >>> 0]); },
        callSpriteStateBody(addr, view, sprite, arg) {
            EVENTS.push(["state", addr >>> 0, view >>> 0, sprite >>> 0, arg >>> 0]);
            return addr === 0x8009a1a0 ? STATE5_RET : 0;
        },
    };
}

function compare(label, o, kind) {
    seed(o);
    const before = rt.drawCalls.length;
    if (kind === "update") rt.cpu.call(0x8009b890, [VIEW, 0, SPRITE]);
    else if (kind === "shine") rt.cpu.call(0x8009b76c, [VIEW, SPRITE]);
    else rt.cpu.call(0x8009bac8, [VIEW, 0]);
    const oDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oEvents = events();
    const oFields = kind === "all" ? fields() : [rt.mem.read32(VIEW + 0x54) >>> 0,
        rt.mem.read16(SPRITE + 0x26), rt.mem.read32(SPRITE + 0x2c) >>> 0,
        rt.mem.read8(SPRITE + 0x42), rt.mem.read8(SPRITE + 0x45)];

    seed(o);
    const h = portHost();
    if (kind === "update") cardSpriteUpdate(rt.mem, VIEW, SPRITE, h);
    else if (kind === "shine") drawSpinningCardBack(rt.mem, SPRITE, h);
    else cardSpritesTickAll(rt.mem, VIEW, h);
    assert.deepEqual(events(), oEvents, `${label}: calls`);
    assert.deepEqual(normDraw(PORT_DRAW), oDraw, `${label}: draw`);
    const pFields = kind === "all" ? fields() : [rt.mem.read32(VIEW + 0x54) >>> 0,
        rt.mem.read16(SPRITE + 0x26), rt.mem.read32(SPRITE + 0x2c) >>> 0,
        rt.mem.read8(SPRITE + 0x42), rt.mem.read8(SPRITE + 0x45)];
    assert.deepEqual(pFields, oFields, `${label}: fields`);
}

test("cardSpriteUpdate matches F0x8009B890", () => {
    compare("state 0 hides", { sprites: { 0: { state: 0, kind: 1 } } }, "update");
    compare("state 1 idle", {}, "update");
    compare("state 2", {}, "update");
    compare("state 3", {}, "update");
    for (const st of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
        seedSprite(SPRITE, SPRITE, { state: st, anim: 4 });
        seed({});
        rt.mem.write8(SPRITE + 0x42, st);
        rt.mem.write32(SPRITE + 0x2c, 4);
        rt.mem.write32(VIEW + 0x54, 0);
        rt.cpu.call(0x8009b890, [VIEW, 0, SPRITE]);
        const oE = events(); const oF = [rt.mem.read32(VIEW + 0x54) >>> 0, rt.mem.read32(SPRITE + 0x2c) >>> 0, rt.mem.read8(SPRITE + 0x42), rt.mem.read8(SPRITE + 0x45)];
        seed({});
        rt.mem.write8(SPRITE + 0x42, st);
        rt.mem.write32(SPRITE + 0x2c, 4);
        cardSpriteUpdate(rt.mem, VIEW, SPRITE, portHost());
        assert.deepEqual(events(), oE, `state ${st}: calls`);
        assert.deepEqual([rt.mem.read32(VIEW + 0x54) >>> 0, rt.mem.read32(SPRITE + 0x2c) >>> 0, rt.mem.read8(SPRITE + 0x42), rt.mem.read8(SPRITE + 0x45)], oF, `state ${st}: fields`);
    }
    // state 5 both return paths; state 11 crossing the limit.
    compare("state 5 returns zero", { state5: 0, sprite: { state: 5 } }, "update");
    compare("state 5 returns nonzero", { state5: 1, sprite: { state: 5 } }, "update");
    compare("state 11 below limit", { sprite: { state: 11, anim: 3 }, delta: 1 }, "update");
    compare("state 11 settles", { sprites: { 0: { state: 11, anim: 10 } }, delta: 1 }, "all");
});

test("drawSpinningCardBack matches F0x8009B76C", () => {
    compare("kind 0", { sprite: { kind: 0, state: 11 } }, "shine");
    compare("not settled", { sprite: { kind: 1, state: 5 } }, "shine");
    compare("shine frame 0", { sprite: { kind: 1, state: 11, anim: 0, scaleX: 0x1000, scaleY: 0x1000 } }, "shine");
    compare("shine frame 2", { sprite: { kind: 1, state: 11, anim: 5, scaleX: 0x0800, scaleY: 0x1000 } }, "shine");
    compare("shine frame wraps", { sprite: { kind: 1, state: 11, anim: 10, scaleX: 0x1000, scaleY: 0x1000 } }, "shine");
    compare("shine frame four", { sprite: { kind: 1, state: 11, anim: 8, scaleX: 0x1000, scaleY: 0x1000 } }, "shine");
    compare("shine negative anim", { sprite: { kind: 1, state: 11, anim: -5, x: -1000, y: 200 } }, "shine");
});

test("cardSpritesTickAll matches F0x8009BAC8", () => {
    compare("empty pool", {}, "all");
    compare("mixed pool", {
        delta: 1,
        sprites: {
            0: { state: 2, kind: 1, scaleX: 0x1000, scaleY: 0x1000, x: 100 << 8, y: 50 << 8 },
            1: { state: 5, kind: 1, scaleX: 0x1000, scaleY: 0x1000, layerFlag: 1 },
            2: { state: 9, kind: 1, scaleX: 0x1000, scaleY: 0x1000 },
            3: { state: 11, anim: 0, kind: 1, scaleX: 0x1000, scaleY: 0x1000, layerFlag: 1 },
            4: { state: 11, anim: 10, kind: 1, scaleX: 0x1000, scaleY: 0x1000 },
            5: { state: 0, kind: 1, scaleX: 0x1000, scaleY: 0x1000 },
        },
    }, "all");
});
