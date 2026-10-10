// Oracle: engine/dw3/ui/memcard-parts.ts and memcard-fill.ts against the original
// pro/stgmcard routines the disassembler's function list missed (slot transition
// object, block-grid methods, save-card show/hide/fill, window refresh/dismiss,
// the state machine's caption/teardown/hide helpers, the staging free, the entry
// actor and the fade constructor). Each original runs through engine/native on the
// shipped overlay and resident image with every service stubbed; the port runs
// with a host that logs the same calls, and the ordered calls and the words of the
// objects involved are compared. The libgte matrix helpers RotMatrix and
// ApplyMatrixSV and the GPU primitive services are stubbed on both sides
// (the reference interpreter executes no GTE instruction); ScaleMatrix is the
// ported body on the port side and the original's own code on the original side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import {
    memcardCardHide, memcardCardShow, memcardEntryTick, memcardFadeCreate, memcardFreeStaging,
    memcardGridChoose, memcardGridClose, memcardGridOpen, memcardGridSlideIn, memcardGridSlideOut,
    memcardHideStep, memcardSlotCaption, memcardTeardownScreen, memcardTransitionColourA,
    memcardTransitionColourB, memcardTransitionCreate, memcardTransitionPlay, memcardTransitionPosition,
    memcardTransitionTick, memcardWindowDismiss, memcardWindowRefresh,
} from "../../engine/dw3/ui/memcard-parts.ts";
import { memcardFillCard } from "../../engine/dw3/ui/memcard-fill.ts";
import { memcardSaveCardReset } from "../../engine/dw3/ui/memcard-save-card.ts";
import { scaleMatrix } from "../../engine/dw3/ui/native/wizard-misc.ts";

const T_TWEEN = 0x0fe50030, T_FREE = 0x0fe50031;
const M8C = 0x0fe30000 + 0x8c, MC4 = 0x0fe30000 + 0xc4;
const S_TEX = 0x0fe20020, S_SLOT = 0x0fe20024, S_PRIM = 0x0fe20028, S_COMMIT = 0x0fe2002c, S_ROT = 0x0fe20030;
const D_RESET = 0x0fe40150, D_PACKET = 0x0fe40154, D_REGION = 0x0fe40174, D_VIEW = 0x0fe4016c, D_COLOUR = 0x0fe4012c;
const OBJ = 0x80150000, CHILD = 0x80155000, PRIM = 0x80156000, OT = 0x80157000, TEX = 0x80158800;
const WIN = 0x80160000, NEW = 0x80154000, VIEW = 0x80158000, SHARED = 0x80088768;
const LANG = 0x8005cca8;

let h;
h = createHarness({
    overlayFile: "pro_stgmcard.bin",
    functions: {
        tween: { address: T_TWEEN, args: [0, 0, 0, 0] },
        free: { address: T_FREE, args: [0] },
        rot: { address: 0x8002b65c, args: [0, 0] },
    },
    tables: { 0x80088798: T_TWEEN, 0x8004b5ec: T_FREE },
});
const mem = h.rt.mem;
h.CTL.alloc = NEW;
const st = (a, f) => h.rt.cpu.setStub(a, f);
const applyOut = (m, inp, out) => {
    const words = [0, 1, 2, 3, 4].map((i) => mem.read32(m + i * 4) >>> 0);
    const v = [0, 2, 4].map((o) => mem.read16(inp + o));
    h.LOG.push(["apply", ...words, ...v]);
    mem.write16(out, (((v[0] * (words[0] & 0xffff)) >> 12) + 3) & 0xffff);
    mem.write16(out + 2, (v[1] + (words[0] >>> 16)) & 0xffff);
    mem.write16(out + 4, (v[2] + (words[4] & 0xffff)) & 0xffff);
};
st(M8C, (c) => { h.LOG.push(["method", c.reg(4) | 0, 0x8c]); return 0; });
st(MC4, (c) => { h.LOG.push(["method", c.reg(4) | 0, 0xc4]); return 0; });
st(0x8002b1dc, (c) => { applyOut(c.reg(4), c.reg(5), c.reg(6)); return 0; });
st(S_TEX, (c) => { h.LOG.push(["gpuTexture", c.reg(4) | 0]); return TEX; });
st(S_SLOT, (c) => { h.LOG.push(["gpuSlot", c.reg(5) | 0]); return OT; });
st(S_PRIM, () => { h.LOG.push(["allocPrim"]); return PRIM; });
st(S_COMMIT, (c) => { h.LOG.push(["commit", c.reg(4) | 0, c.reg(5) >>> 0]); return 0; });
mem.write32(0x8004de10 + 0x17c, S_TEX);
mem.write32(0x8004de10 + 0x158, S_PRIM);
mem.write32(0x8004df6c, S_COMMIT);
st(D_RESET, () => { h.LOG.push(["displayReset"]); return 0; });
st(D_PACKET, (c) => { h.LOG.push(["displayPacketSize", c.reg(4) >>> 0]); return 0; });
st(D_REGION, (c) => { h.LOG.push(["displayRegion", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
st(D_VIEW, (c) => {
    const rect = c.reg(4) >>> 0;
    h.LOG.push(["displayView", mem.read16(rect), mem.read16(rect + 2), mem.read16(rect + 4), mem.read16(rect + 6), c.reg(5) | 0, c.reg(6) | 0]);
    return VIEW;
});
st(D_COLOUR, (c) => { h.LOG.push(["viewColour", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
mem.write32(0x8004de10 + 0x150, D_RESET);
mem.write32(0x8004de10 + 0x154, D_PACKET);
mem.write32(0x8004de10 + 0x174, D_REGION);
mem.write32(0x8004de10 + 0x16c, D_VIEW);
mem.write32(VIEW + 0x12c, D_COLOUR);
st(0x80087b08, () => { h.LOG.push(["createRoot"]); return 0x80161000; });
st(h.S.methodBase + 0x38, (c) => { h.LOG.push(["method", c.reg(4) | 0, 0x38]); return 0; });

const tweenHost = () => ({
    tweenStart(t, f, to, n) { h.LOG.push(["tween", t | 0, f | 0, to | 0, n | 0]); },
});
const host = (extra = {}) => h.host({
    ...tweenHost(),
    resourceGetBase(id) { h.LOG.push(["bank", id | 0]); return 0x5678; },
    rotMatrix(r, m) { h.LOG.push(["rot", r | 0, m | 0]); },
    scaleMatrix(m, s) { scaleMatrix(mem, m, s); },
    applyMatrix(m, i, o) { applyOut(m, i, o); },
    otSlot(layer, bucket) { h.LOG.push(["gpuTexture", layer | 0]); h.LOG.push(["gpuSlot", bucket | 0]); return OT; },
    allocPrim() { h.LOG.push(["allocPrim"]); return PRIM; },
    commitPrim(end) { h.LOG.push(["commit", end | 0, 0xff000000 >>> 0]); },
    scratch: () => 0x80159100,
    advance(obj) { h.LOG.push(["method", obj | 0, 0x38]); },
    reset(obj) { memcardSaveCardReset(mem, obj); },
    packResolve(handle) { h.LOG.push(["pack", handle >>> 0]); return 0x1234; },
    initDrawContext() { h.LOG.push(["drawInit"]); },
    setLayer(t, b) { h.LOG.push(["d7c", t | 0, b | 0]); },
    setOrigin(x, y) { h.LOG.push(["d74", x | 0, y | 0]); },
    ...extra,
});
const setSubstate = (card, v) => h.LOG.push(["method", card | 0, 0x2c, v | 0]);
const setState0 = (obj, v) => h.LOG.push(["method", obj | 0, 0x28, v | 0]);

function methodsOn(base, slots) {
    for (const slot of slots) mem.write32(base + slot, h.S.methodBase + slot);
}
const widgetsInto = (block, offsets, n0 = 0) => offsets.forEach((o, i) => mem.write32(block + o, h.widgetAt(n0 + i)));

function seed(c = {}) {
    return () => {
        for (let i = 0; i < 0x100; i += 4) { mem.write32(OBJ + i, 0); mem.write32(NEW + i, 0xabcd0000 + i); }
        for (let i = 0; i < 0x100; i += 4) mem.write32(CHILD + i, 0);
        for (let i = 0; i < 0x30; i += 4) mem.write32(PRIM + i, 0x11111111);
        for (let i = 0; i < 0x40; i += 4) mem.write32(0x80159100 + i, 0x22222222);
        for (let i = 0; i < 0x180; i += 4) mem.write32(TEX + i, 0);
        for (let i = 0; i < 0x300; i += 4) mem.write32(WIN + i, 0);
        mem.write32(TEX + 0x138, S_SLOT);
        mem.write32(OT, 0xa5123456);
        mem.write32(LANG, c.lang ?? 2);
        for (let i = 0; i < 0x20; i += 4) mem.write32(SHARED + i, 0);
        mem.write32(SHARED + 0x0c, c.sidePtr ?? 0x80190000);
        mem.write32(SHARED + 0x10, c.mainPtr ?? 0x80191000);
        mem.write32(SHARED + 4, c.index ?? 0);
        const set = (o, v) => mem.write32(OBJ + o, v | 0);
        set(0x0c, c.state ?? 1); set(0x10, c.mode ?? 0); set(0x50, c.p50 ?? 0x1000); set(0x54, c.p54 ?? 1);
        set(0x58, c.x ?? 0x40); set(0x5c, c.y ?? 0x30); set(0x60, c.w ?? 0x62); set(0x64, c.hgt ?? 0x0a);
        set(0x68, 0); set(0x6c, c.cA ?? 0x00f232ff); set(0x70, c.cB ?? 0x00de2fd1);
        set(0x74, c.frames ?? 20); set(0x78, c.step ?? 0); set(0x84, c.cx ?? 0x40); set(0x88, c.cy ?? 0x30);
        set(0x8c, c.scale ?? 0); set(0x90, 0x1000); set(0x94, 0x1000);
        set(0x9c, 0); set(0xa0, 0);
        for (let i = 0xa4; i < 0xc4; i += 4) set(i, 0);
        set(0x28, h.S.methodBase + 0x28); set(0x38, h.S.methodBase + 0x38);
        set(0x2c, h.S.methodBase + 0x2c);
        h.reset(c.seed ?? 5);
    };
}
const RANGES = [[OBJ, 0x100], [NEW, 0x100], [PRIM, 0x30], [OT, 4], [CHILD, 0x100], [WIN, 0x300], [SHARED, 0x20]];

test("the slot transition object: constructor, setters and reset match", () => {
    h.compare("create", seed(), RANGES, () => h.rt.cpu.call(0x80084058, [0xcd, 0xc1, 0x62, 0x0a], 20000),
        () => memcardTransitionCreate(mem, host(), 0xcd, 0xc1, 0x62, 0x0a));
    for (const [mode, frames] of [[1, 0x4c], [2, 0x14], [0, 0], [-1, 0x4f3]]) {
        h.compare("play", seed({ step: 7 }), RANGES, () => h.rt.cpu.call(0x80083c0c, [OBJ, mode, frames], 20000),
            () => memcardTransitionPlay(mem, OBJ, mode, frames));
    }
    h.compare("colourA", seed(), RANGES, () => h.rt.cpu.call(0x80083c1c, [OBJ, 0x17f, 0x32, 0xf2], 20000),
        () => memcardTransitionColourA(mem, OBJ, 0x17f, 0x32, 0xf2));
    h.compare("colourB", seed(), RANGES, () => h.rt.cpu.call(0x80083c30, [OBJ, 0xd1, 0x2f, 0xde], 20000),
        () => memcardTransitionColourB(mem, OBJ, 0xd1, 0x2f, 0xde));
    h.compare("position", seed(), RANGES, () => h.rt.cpu.call(0x80083c44, [OBJ, 0x55, -3], 20000),
        () => memcardTransitionPosition(mem, OBJ, 0x55, -3));
    h.compare("reset", seed({ scale: 77 }), RANGES, () => h.rt.cpu.call(0x80083bd8, [OBJ], 20000),
        () => memcardSaveCardReset(mem, OBJ));
});

test("the slot transition's per-frame routine matches across modes, steps and scales", () => {
    const seen = { open: 0, hold: 0, done: 0, idle: 0 };
    for (const state of [0, 1, 2, 3, 4, -1]) {
        for (const mode of [0, 1, 2, 3, -1]) {
            for (const frames of [0, 1, 20, 0x4c, 0x1000, 0x2000]) {
                for (const scale of [0, 1, 0x800, 0xf00, 0xf33, 0xfff, 0x1000, 0x1001]) {
                    for (const step of [0, 0x80, 0x100]) {
                        const c = { state, mode, frames, scale, step, x: 0x50, y: 0x40, cx: 0x22, cy: 0x11 };
                        const r = h.compare(`tick s${state} m${mode} f${frames} sc${scale} st${step}`, seed(c), RANGES,
                            () => h.rt.cpu.call(0x80083c50, [OBJ], 60000), () => memcardTransitionTick(mem, OBJ, host()));
                        if (state === 1 && mode === 1 && r.log.some((e) => e[0] === "commit")) seen.hold++;
                        if (state === 1 && mode === 2 && r.snap[0x68 / 4] === 1) seen.done++;
                        if (state === 1 && r.log.some((e) => e[0] === "commit")) seen.open++;
                        if (!r.log.some((e) => e[0] === "commit")) seen.idle++;
                    }
                }
            }
        }
    }
    for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `coverage: ${k}`);
});

test("the block-grid methods match", () => {
    const grid = () => {
        seed({ index: 2 })();
        mem.write32(OBJ + 0x50, WIN);
        mem.write32(WIN + 0x64, 1);
        mem.write32(OBJ + 0x24, CHILD);
        mem.write32(CHILD, h.widgetAt(3));
        methodsOn(OBJ, [0x28, 0x2c, 0x38]);
    };
    h.compare("slideIn", grid, RANGES, () => h.rt.cpu.call(0x8008410c, [OBJ], 20000), () => memcardGridSlideIn(mem, OBJ, host()));
    for (const index of [0, 1, 2, -1]) {
        h.compare("choose", grid, RANGES, () => h.rt.cpu.call(0x80084194, [OBJ, index], 20000), () => memcardGridChoose(mem, OBJ, index, host()));
    }
    h.compare("slideOut", grid, RANGES, () => h.rt.cpu.call(0x800841fc, [OBJ], 20000), () => memcardGridSlideOut(mem, OBJ, host()));
    h.compare("open", grid, RANGES, () => h.rt.cpu.call(0x800842a0, [OBJ], 20000), () => memcardGridOpen(mem, OBJ, host()));
    h.compare("close", grid, RANGES, () => h.rt.cpu.call(0x800842e4, [OBJ], 20000), () => memcardGridClose(mem, OBJ, host()));
});

function cardObj(c = {}) {
    return () => {
        seed(c)();
        const arr = CHILD;
        mem.write32(OBJ + 0x24, arr);
        mem.write32(OBJ + 0x20, c.count ?? 19);
        for (let i = 0; i < 19; i++) mem.write32(arr + i * 4, c.nulls && i % 3 === 1 ? 0 : h.widgetAt(i));
        mem.write32(OBJ + 0x50, WIN);
        methodsOn(OBJ, [0x28, 0x2c, 0x38]);
    };
}

test("the save-card show and hide methods match", () => {
    h.compare("show", cardObj(), RANGES, () => h.rt.cpu.call(0x800830b8, [OBJ], 20000), () => memcardCardShow(OBJ, setSubstate));
    for (const count of [0, 1, 19]) {
        for (const nulls of [false, true]) {
            h.compare(`hide ${count} ${nulls}`, cardObj({ count, nulls }), RANGES, () => h.rt.cpu.call(0x800830e0, [OBJ], 20000),
                () => memcardCardHide(mem, OBJ, setSubstate, (t, s, a) => h.LOG.push(["method", t | 0, s, ...a.map((v) => v | 0)])));
        }
    }
});

function windowObj(c = {}) {
    return () => {
        seed(c)();
        mem.write32(WIN + 0x24, CHILD);
        mem.write32(WIN + 0x64, c.handle ?? 1);
        mem.write32(WIN + 0x68, c.count ?? 3);
        mem.write32(WIN + 0x10, 0x21);
        const card = 0x80162000;
        for (let i = 0; i < 0x40; i += 4) mem.write32(card + i, 0);
        mem.write32(card + 0x8c, M8C);
        for (let i = 0; i < 0x30; i += 4) mem.write32(CHILD + i, 0);
        const w = (offset, n) => { if (!c.missing?.includes(offset)) mem.write32(CHILD + offset, h.widgetAt(n)); };
        [0x04, 0x08, 0x0c, 0x10, 0x14].forEach((o, i) => w(o, i));
        if (!c.missing?.includes(0x18)) mem.write32(CHILD + 0x18, h.iconAt(0));
        const trans = 0x80163000;
        for (let i = 0; i < 0x100; i += 4) mem.write32(trans + i, 0);
        mem.write32(trans + 0xc4, MC4);
        if (!c.missing?.includes(0x1c)) mem.write32(CHILD + 0x1c, trans);
        mem.write32(CHILD + 0x20, OBJ);
        mem.write32(CHILD + 0x24, card);
        methodsOn(WIN, [0x28, 0x2c, 0x38]);
    };
}

test("the window refresh, dismiss, caption, teardown and hide helpers match", () => {
    const call = (t, s, a) => h.LOG.push(["method", t | 0, s, ...a.map((v) => v | 0)]);
    h.compare("refresh", windowObj(), RANGES, () => h.rt.cpu.call(0x80084c70, [WIN], 20000), () => memcardWindowRefresh(mem, WIN, call));
    for (const missing of [[], [0x04], [0x14, 0x18], [0x1c], [0x08, 0x0c, 0x10]]) {
        h.compare(`dismiss ${missing}`, windowObj({ missing }), RANGES, () => h.rt.cpu.call(0x80084ca8, [WIN], 20000),
            () => memcardWindowDismiss(mem, WIN, call, setState0));
        h.compare(`teardown ${missing}`, windowObj({ missing, count: 5 }), RANGES, () => h.rt.cpu.call(0x80084b20, [WIN, CHILD], 20000),
            () => memcardTeardownScreen(mem, WIN, CHILD, call));
    }
    h.compare("hideStep", windowObj(), RANGES, () => h.rt.cpu.call(0x80084bf8, [WIN, CHILD], 20000),
        () => memcardHideStep(mem, WIN, CHILD, call));
    for (const show of [0, 1]) {
        for (const lang of [0, 2, 6]) {
            for (const handle of [0, 1, 2]) {
                h.compare(`caption s${show} l${lang} h${handle}`, windowObj({ lang, handle }), RANGES,
                    () => h.rt.cpu.call(0x80084a80, [WIN, CHILD, show], 20000),
                    () => memcardSlotCaption(mem, WIN, CHILD, show, { callMethod: call, resourceGetBase: (id) => { h.LOG.push(["bank", id | 0]); return 0x5678; } }));
            }
        }
    }
});

test("the staging free and the entry actor match", () => {
    for (const [sidePtr, mainPtr] of [[0, 0], [0x80190000, 0], [0, 0x80191000], [0x80190000, 0x80191000]]) {
        h.compare("free", seed({ sidePtr, mainPtr }), RANGES, () => h.rt.cpu.call(0x80087e78, [], 20000),
            () => memcardFreeStaging(mem, (p) => h.LOG.push(["free", p | 0])));
    }
    for (const state of [0, 1, 2, 3, 4, 9, -1]) {
        h.compare(`entry s${state}`, seed({ state }), RANGES, () => h.rt.cpu.call(0x80082cd0, [OBJ, CHILD], 20000),
            () => memcardEntryTick(mem, OBJ, CHILD, {
                displayReset() { h.LOG.push(["displayReset"]); },
                displayPacketSize(b) { h.LOG.push(["displayPacketSize", b >>> 0]); },
                displayRegion(w, hh, a, b) { h.LOG.push(["displayRegion", w | 0, hh | 0, a | 0, b | 0]); },
                displayView(r, k, p) { h.LOG.push(["displayView", r.x, r.y, r.w, r.h, k | 0, p | 0]); return VIEW; },
                viewColour(v, r, g, b) { h.LOG.push(["viewColour", v >>> 0, r | 0, g | 0, b | 0]); },
                createRoot() { h.LOG.push(["createRoot"]); return 0x80161000; },
                advance(self) { h.LOG.push(["method", self | 0, 0x38]); },
            }));
    }
});

test("the fade constructor matches", () => {
    h.compare("fade create", seed(), RANGES, () => h.rt.cpu.call(0x80083074, [], 20000),
        () => memcardFadeCreate(mem, { alloc(hd, s, e) { h.LOG.push(["alloc", hd | 0, s, e]); return NEW; } }));
});

test("the save card's text binder matches across records, indices and languages", () => {
    const cover = { hidden: 0, empty: 0, full: 0, padded: 0, noPad: 0, none: 0 };
    const fill = (c) => () => {
        cardObj(c)();
        mem.write32(OBJ + 0x60, c.on ?? 1);
        mem.write32(SHARED + 4, c.index ?? 0);
        const rec = WIN + 0x74 + (c.index ?? 0) * 0x44;
        for (let i = 0; i < 0x44 * 3; i += 4) mem.write32(WIN + 0x74 + i, 0);
        if (!c.emptyRec) {
            mem.write8(rec, 0x0e);
            mem.write32(rec + 0x18, 7); mem.write32(rec + 0x1c, 9); mem.write32(rec + 0x20, 1234567);
            mem.write16(rec + 0x28, 12); mem.write16(rec + 0x2a, c.minutes ?? 5); mem.write16(rec + 0x2c, c.seconds ?? 30);
            for (let i = 0; i < 3; i++) {
                mem.write32(rec + 0x30 + i * 4, c.types?.[i] ?? 3 + i);
                mem.write16(rec + 0x3c + i * 2, 10 + i);
            }
        }
        mem.write32(OBJ + 0x50, WIN);
        for (let i = 0; i < 3; i++) mem.write32(OBJ + 0x68 + i * 4, 9);
        mem.write32(OBJ + 0x64, 55);
    };
    const ranges = [...RANGES, [WIN, 0x300]];
    for (const on of [0, 1]) {
        for (const emptyRec of [false, true]) {
            for (const index of [0, 1, 2]) {
                for (const lang of [0, 2]) {
                    for (const [minutes, seconds] of [[5, 30], [30, 5], [9, 9], [10, 10], [0, 0]]) {
                        for (const types of [undefined, [0, 3, 10], [-1, 4, 5], [2, 2, 2]]) {
                            const c = { on, emptyRec, index, lang, minutes, seconds, types };
                            h.compare(`fill ${JSON.stringify(c)}`, fill(c), ranges, () => h.rt.cpu.call(0x8008316c, [OBJ], 60000),
                                () => memcardFillCard(mem, OBJ, {
                                    callMethod: (t, s, a) => h.LOG.push(["method", t | 0, s, ...a.map((v) => v | 0)]),
                                    resourceGetBase: (id) => { h.LOG.push(["bank", id | 0]); return 0x5678; },
                                }));
                            if (!on) cover.hidden++;
                            else if (emptyRec) cover.empty++;
                            else { cover.full++; if (minutes < 10) cover.padded++; else cover.noPad++; if (types?.some((t) => t < 3)) cover.none++; }
                        }
                    }
                }
            }
        }
    }
    for (const [k, v] of Object.entries(cover)) assert.ok(v > 0, `coverage: ${k}`);
});

test("the fade's start and tick are the fight report's bodies (same behaviour as F0x80082DF4 / F0x80082FC0)", async () => {
    const { reportFadeStart, reportFadeTick } = await import("../../engine/dw3/ui/native/fight-report-fade.ts");
    const fadeHost = () => ({
        alloc(hd, s, e) { h.LOG.push(["alloc", hd | 0, s, e]); return NEW; },
        callMethod(t, slot, args) { h.LOG.push(["method", t | 0, slot, ...(slot === 0x38 ? [t | 0] : args.map((a) => a | 0))]); },
        dimQuad(f) { h.LOG.push(["dimQuad", f | 0]); },
    });
    st(0x80082e7c, (c) => { h.LOG.push(["dimQuad", c.reg(4) | 0]); return 0; });
    st(h.S.methodBase + 0x28, (c) => { h.LOG.push(["method", c.reg(4) | 0, 0x28, c.reg(5) | 0]); return 0; });
    st(h.S.methodBase + 0x38, (c) => { h.LOG.push(["method", c.reg(4) | 0, 0x38, c.reg(4) | 0]); return 0; });
    for (const dirn of [0, 1, 2, -1]) {
        for (const frames of [1, 7, 30, 255, 0x10000, 0]) {
            h.compare(`start ${dirn} ${frames}`, seed({ state: 0 }), RANGES, () => h.rt.cpu.call(0x80082df4, [OBJ, dirn, frames], 20000),
                () => reportFadeStart(mem, OBJ, dirn, frames, fadeHost()));
        }
    }
    for (const state of [0, 1, 2, 3, 4, -1]) {
        for (const armed of [0, 1]) {
            for (const dirn of [0, 1]) {
                for (const level of [0, 0xfe00, 0xff00]) {
                    for (const step of [0x888, -0x888]) {
                        const c = () => { seed({ state })(); mem.write32(OBJ + 0x10, armed); mem.write32(OBJ + 0x58, dirn); mem.write32(OBJ + 0x5c, level); mem.write32(OBJ + 0x60, step); };
                        h.compare(`tick ${state} ${armed} ${dirn} ${level} ${step}`, c, RANGES, () => h.rt.cpu.call(0x80082fc0, [OBJ], 40000),
                            () => reportFadeTick(mem, OBJ, fadeHost()));
                    }
                }
            }
        }
    }
});
