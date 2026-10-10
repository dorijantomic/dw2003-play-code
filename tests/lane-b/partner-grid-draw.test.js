// Lane B Phase 4 oracle: engine/dw3/ui/native/partner-grid-draw.ts must match
// the original pro/stdgname keyboard-grid draw F0x8008559C.
//
// The original runs through engine/native as the oracle. The interpreter
// already installs the decoded draw-context fill (F0x8001F648) and the 12
// context-method hooks, so calls land in this test's overridden hooks. The
// resident services the draw reads — the pack resolver [0x80044F5C], the
// free-running frame counter [0x8004DF98] (== [0x8004DE10+0x188]) and the card
// slot service [0x80048D34+0x2728] — are stubbed on both sides so the ordered
// call log and every object counter can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    partnerGridDraw,
    GRID_PACK,
    GRID_HINT_TABLE,
    GRID_SELECTION_CELL,
    GRID_ANCHOR_TABLE,
    GRID_CLIP_TABLE,
    PARTNER_GRID_FIELDS,
} from "../../engine/dw3/ui/native/partner-grid-draw.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const name = new Uint8Array(readFileSync(join(dir, "pro_stdgname.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: name.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const GRID_FN = 0x8008559c;

// draw-context method addresses filled by F0x8001F648 (ctx: setOrigin,
// setLayer, drawSprite, paletteShift(0x88), setScale, setPos)
const CTX_SETORIGIN = 0x8001ecbc;
const CTX_SETLAYER = 0x8001ed34;
const CTX_DRAWSPRITE = 0x8001ed6c;
const CTX_PALETTE = 0x8001ecec;
const CTX_SETSCALE = 0x8001f5d0;
const CTX_SETPOS = 0x8001f608;

const PACK_CELL = 0x80044f5c;
const FRAME_TICK_CELL = 0x8004df98;
const CARD_PRESENT_CELL = 0x80048d34 + 0x2728;

const STUB = 0x0fe30000;
const PACK_STUB = STUB + 0x10;
const FRAME_STUB = STUB + 0x14;
const PRESENT_STUB = STUB + 0x18;

const LOG = [];
let seqIndex = 0;

const CONTROL = {
    present: [-1, -1, -1, -1, -1, -1, -1, -1],
    pack: 0x0abc0000,
    frame: [], // consumed in call order by every [0x8004DF98] call
};

function nextFrame() {
    const v = CONTROL.frame[seqIndex] ?? 0;
    seqIndex += 1;
    return v;
}

function installHooks(rt) {
    const draw = (name, arity) => (c) => {
        const args = [];
        for (let i = 0; i < arity; i++) args.push(c.reg(4 + i) | 0);
        LOG.push([name, ...args]);
        return 0;
    };
    rt.cpu.setStub(CTX_SETORIGIN, draw("setOrigin", 2));
    rt.cpu.setStub(CTX_SETLAYER, draw("setLayer", 2));
    rt.cpu.setStub(CTX_DRAWSPRITE, draw("drawSprite", 4));
    rt.cpu.setStub(CTX_PALETTE, draw("m_0x88", 1));
    rt.cpu.setStub(CTX_SETSCALE, draw("setScale", 3));
    rt.cpu.setStub(CTX_SETPOS, draw("setPos", 2));

    rt.cpu.setStub(PACK_STUB, (c) => { LOG.push(["packResolve", c.reg(4) >>> 0]); return CONTROL.pack; });
    rt.cpu.setStub(FRAME_STUB, () => { LOG.push(["frameTick"]); return nextFrame(); });
    rt.cpu.setStub(PRESENT_STUB, (c) => { LOG.push(["cardPresent", c.reg(4) | 0]); return CONTROL.present[c.reg(4) | 0] ?? -1; });
    rt.mem.write32(PACK_CELL, PACK_STUB);
    rt.mem.write32(FRAME_TICK_CELL, FRAME_STUB);
    rt.mem.write32(CARD_PRESENT_CELL, PRESENT_STUB);
}

function runtime() {
    const rt = new NativeStageRuntime(name, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    installHooks(rt);
    return rt;
}

function portHost() {
    return {
        setOrigin(x, y) { LOG.push(["setOrigin", x | 0, y | 0]); },
        setLayer(t, b) { LOG.push(["setLayer", t | 0, b | 0]); },
        drawSprite(p, clip, x, y) { LOG.push(["drawSprite", p | 0, clip | 0, x | 0, y | 0]); },
        paletteShift(v) { LOG.push(["m_0x88", v | 0]); },
        setScale(x, y, z) { LOG.push(["setScale", x | 0, y | 0, z | 0]); },
        setPos(x, y) { LOG.push(["setPos", x | 0, y | 0]); },
        packResolve(handle) { LOG.push(["packResolve", handle >>> 0]); return CONTROL.pack; },
        frameTick() { LOG.push(["frameTick"]); return nextFrame(); },
        cardPresent(index) { LOG.push(["cardPresent", index | 0]); return CONTROL.present[index | 0] ?? -1; },
    };
}

const HINTS = [
    { clip: 0x1d, x0: 24, y0: 21, x1: 24, y1: 32, flag: 0 },
    { clip: 0x23, x0: 198, y0: 192, x1: 320, y1: 206, flag: 0 },
    { clip: 0x20, x0: 28, y0: 49, x1: 109, y1: 71, flag: 1 },
];

function clear(rt, addr, size) {
    for (let i = 0; i < size; i++) rt.mem.write8(addr + i, 0);
}

function seed(rt, c) {
    clear(rt, OBJ, 0x100);
    clear(rt, GRID_HINT_TABLE, 3 * 0x1c);
    clear(rt, GRID_ANCHOR_TABLE, 0x20);
    clear(rt, GRID_CLIP_TABLE, 3 * 7 * 4);

    const hints = c.hints ?? HINTS;
    for (let i = 0; i < 3; i++) {
        const e = hints[i];
        const base = GRID_HINT_TABLE + i * 0x1c;
        rt.mem.write32(base + 0x00, e.clip | 0);
        rt.mem.write32(base + 0x08, e.x0 ?? 0);
        rt.mem.write32(base + 0x0c, e.y0 ?? 0);
        rt.mem.write32(base + 0x10, e.x1 ?? 0);
        rt.mem.write32(base + 0x14, e.y1 ?? 0);
        rt.mem.write32(base + 0x18, e.flag ?? 0);
    }
    rt.mem.write32(GRID_SELECTION_CELL + 4, c.page ?? 0);

    const anchors = c.anchors ?? [32, 53, 32, 79, 32, 46, 32, 73];
    for (let i = 0; i < 4; i++) {
        rt.mem.write32(GRID_ANCHOR_TABLE + i * 8, anchors[i * 2] | 0);
        rt.mem.write32(GRID_ANCHOR_TABLE + i * 8 + 4, anchors[i * 2 + 1] | 0);
    }

    const clipRows = c.clipRows ?? [
        [7, 8, 9, 10, 9, 8, -1],
        [14, 15, 16, 15, -1, -1, -1],
        [-1, 11, 12, 13, 12, -1, -1],
    ];
    for (let s = 0; s < 3; s++) {
        for (let f = 0; f < 7; f++) rt.mem.write32(GRID_CLIP_TABLE + (s * 7 + f) * 4, clipRows[s][f] | 0);
    }

    rt.mem.write32(OBJ + PARTNER_GRID_FIELDS.language, c.language ?? 2);
    rt.mem.write32(OBJ + PARTNER_GRID_FIELDS.flash, c.flash ?? 0);
    for (let i = 0; i < 3; i++) rt.mem.write32(OBJ + PARTNER_GRID_FIELDS.widgetScale + i * 0x10, c.hintScale?.[i] ?? 0x1000);
    for (let i = 0; i < 4; i++) rt.mem.write32(OBJ + PARTNER_GRID_FIELDS.widgetScale + (i + 3) * 0x10, c.letterScale?.[i] ?? 0x1000);
    for (let i = 0; i < 3; i++) {
        rt.mem.write32(OBJ + i * 8 + PARTNER_GRID_FIELDS.animFrame, c.animFrame?.[i] ?? 0);
        rt.mem.write32(OBJ + i * 8 + PARTNER_GRID_FIELDS.animTimer, c.animTimer?.[i] ?? 0);
    }
    // Letter count and page-blink sit above the three 8-byte animation records
    // (0x5c..0x73), so they are written last.
    rt.mem.write32(OBJ + PARTNER_GRID_FIELDS.letterCount, c.count ?? 0);
    rt.mem.write32(OBJ + PARTNER_GRID_FIELDS.pageBlink, c.pageBlink ?? 0);

    CONTROL.present = c.present ?? [-1, -1, -1, -1, -1, -1, -1, -1];
    CONTROL.frame = c.frame ?? [];
    seqIndex = 0;
}

function snap(rt) {
    const out = [];
    for (const off of [0x54, 0x58, 0x5c, 0x60, 0x64, 0x68, 0x6c, 0x70, 0x78, 0x7c, 0x88, 0x98, 0xa8]) {
        out.push(`${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    }
    return out;
}

const CASES = [
    { name: "three hints, no letters", count: 0, frame: [0, 0, 0, 0, 0, 0, 0, 0] },
    {
        name: "hint table breaks, one letter",
        hints: [{ clip: -1 }, HINTS[1], HINTS[2]],
        count: 1, present: [1, -1, -1, -1, -1, -1, -1, -1],
        letterScale: [0x1000], animFrame: [5], animTimer: [0],
        frame: [20, 20, 3, 0, 0, 0, 0, 0],
    },
    {
        name: "page icon blink hits, page shift",
        count: 0, page: 2, pageBlink: 0,
        frame: [3, 0, 0, 0, 0, 0, 0, 0],
    },
    {
        name: "page icon blink misses",
        count: 0, page: 1, pageBlink: 4,
        frame: [2, 0, 0, 0, 0, 0, 0, 0],
    },
    {
        name: "page icon blink wraps at 0x10",
        count: 0, page: 2, pageBlink: 15,
        frame: [3, 0, 0, 0, 0, 0, 0, 0],
    },
    {
        name: "label flash wraps at 0xe",
        count: 1, present: [1, -1, -1, -1, -1, -1, -1, -1],
        letterScale: [0x1000], animFrame: [0], animTimer: [0], flash: 13,
        frame: [0, 0, 3, 0, 0, 0, 0, 0],
    },
    {
        name: "hint scale swap flag 0 and 1",
        hints: [
            { clip: 0x1d, x0: 1, y0: 2, x1: 3, y1: 4, flag: 0 },
            { clip: 0x23, x0: 5, y0: 6, x1: 7, y1: 8, flag: 1 },
            { clip: 0x20, x0: 9, y0: 10, x1: 11, y1: 12, flag: 0 },
        ],
        count: 0, hintScale: [0x0800, 0xffff8000, 0x1000], page: 1,
        frame: [1, 0, 0, 0, 0, 0, 0, 0],
    },
    {
        name: "letter anim advance resets on -1",
        count: 1, present: [0, -1, -1, -1, -1, -1, -1, -1],
        letterScale: [0x1000], animFrame: [5], animTimer: [0],
        frame: [13, 13, 0, 0, 0, 0, 0, 0],
    },
    {
        name: "letter anim holds when timer young",
        count: 1, present: [2, -1, -1, -1, -1, -1, -1, -1],
        letterScale: [0x0800], animFrame: [3], animTimer: [1000],
        frame: [1012, 1012, 0, 0, 0, 0, 0, 0],
    },
    {
        name: "two letters, mixed slots and scales",
        count: 2, present: [1, -1, -1, -1, -1, -1, -1, -1],
        letterScale: [0x1000, 0x0c00], animFrame: [0, 2], animTimer: [0, 0],
        frame: [50, 50, 3, 0, 0, 0, 0, 0],
    },
];

test("partnerGridDraw matches F0x8008559C", () => {
    const rt = runtime();
    for (const c of CASES) {
        seed(rt, c);
        LOG.length = 0;
        rt.cpu.call(GRID_FN, [OBJ], 60000);
        const olog = LOG.slice();
        const osnap = snap(rt);

        seed(rt, c);
        LOG.length = 0;
        partnerGridDraw(rt.mem, OBJ, portHost());
        const plog = LOG.slice();

        assert.deepEqual(plog, olog, `${c.name}: calls`);
        assert.deepEqual(snap(rt), osnap, `${c.name}: fields`);
    }
});
