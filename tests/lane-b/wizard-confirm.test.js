// Oracle: engine/dw3/ui/native/wizard-confirm.ts against the original
// pro/stplnmet "Register account?" panel bodies (build, bind, tick, draw, panel
// tick). The libgte helpers RotMatrix and ApplyMatrixSV and the GPU primitive
// services are stubbed on both sides; ScaleMatrix is the ported body.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import {
    confirmDraw, confirmPanelTick, confirmTick, confirmWidgetsBind, confirmWidgetsBuild,
} from "../../engine/dw3/ui/native/wizard-confirm.ts";
import { scaleMatrix } from "../../engine/dw3/ui/native/wizard-misc.ts";
import { wizardConfirmShow } from "../../engine/dw3/ui/wizard-methods.ts";

const F_START = 0x0fe20010, F_TICK = 0x0fe20014, S_TEX = 0x0fe20020, S_SLOT = 0x0fe20024;
const S_PRIM = 0x0fe20028, S_COMMIT = 0x0fe2002c;
const OBJ = 0x80150000, UI = 0x80155000, PRIM = 0x80156000, OT = 0x80157000, TEX = 0x80158800;
const NAME = 0x80159000, SCRATCH = 0x8015a000;
const LANG = 0x8005cca8;

let h;
h = createHarness({
    overlayFile: "pro_stplnmet.bin",
    functions: {
        foldStart: { address: F_START, args: [0, 0] },
        foldTick: { address: F_TICK, args: [0], result: () => h.next() & 1 },
        rot: { address: 0x8002b65c, args: [0, 0] },
    },
    tables: { 0x80089ba0: F_START, 0x80089ba4: F_TICK },
});
const st = (a, f) => h.rt.cpu.setStub(a, f);
const applyOut = (mem, m, inp, out, log) => {
    const words = [0, 1, 2, 3, 4].map((i) => mem.read32(m + i * 4) >>> 0);
    const v = [0, 2, 4].map((o) => mem.read16(inp + o));
    log.push(["apply", ...words, ...v]);
    mem.write16(out, (v[0] * 2 + (words[0] & 0xffff)) & 0xffff);
    mem.write16(out + 2, (v[1] + (words[0] >>> 16)) & 0xffff);
    mem.write16(out + 4, (v[2] + (words[4] & 0xffff)) & 0xffff);
};
st(0x8002b1dc, (c) => { applyOut(h.rt.mem, c.reg(4), c.reg(5), c.reg(6), h.LOG); return 0; });
st(S_TEX, (c) => { h.LOG.push(["gpuTexture", c.reg(4) | 0]); return TEX; });
st(S_SLOT, (c) => { h.LOG.push(["gpuSlot", c.reg(5) | 0]); return OT; });
st(S_PRIM, () => { h.LOG.push(["allocPrim"]); return PRIM; });
st(S_COMMIT, (c) => { h.LOG.push(["commit", c.reg(4) | 0, c.reg(5) >>> 0]); return 0; });
h.rt.mem.write32(0x8004de10 + 0x17c, S_TEX);
h.rt.mem.write32(0x8004de10 + 0x158, S_PRIM);
h.rt.mem.write32(0x8004df6c, S_COMMIT);

const host = () => {
    const mem = h.rt.mem;
    const base = h.host({
        foldStart(f, open) { h.LOG.push(["foldStart", f | 0, open | 0]); },
        foldTick(f) { h.LOG.push(["foldTick", f | 0]); return h.next() & 1; },
        rotMatrix(r, m) { h.LOG.push(["rot", r | 0, m | 0]); },
        scaleMatrix(m, s) { scaleMatrix(mem, m, s); },
        applyMatrix(m, i, o) { applyOut(mem, m, i, o, h.LOG); },
        otSlot(layer, bucket) { h.LOG.push(["gpuTexture", layer | 0]); h.LOG.push(["gpuSlot", bucket | 0]); return OT; },
        allocPrim() { h.LOG.push(["allocPrim"]); return PRIM; },
        commitPrim(end) { h.LOG.push(["commit", end | 0, 0xff000000 >>> 0]); },
        scratch: () => SCRATCH,
        show(obj, on) {
            wizardConfirmShow(mem, obj, on, {
                confirmChildCall: (o, child, mode) => confirmWidgetsBind(mem, o, child, mode, host()),
                packChildCall: () => { throw new Error("not reached"); },
            });
        },
    });
    return base;
};

const seedObj = (c = {}) => () => {
    const mem = h.rt.mem;
    for (let i = 0; i < 0x100; i += 4) mem.write32(OBJ + i, 0);
    for (let i = 0; i < 0x40; i += 4) mem.write32(UI + i, 0);
    for (let i = 0; i < 0x30; i += 4) { mem.write32(PRIM + i, 0x11111111); }
    mem.write32(OT, c.ot ?? 0xa5000000 | 0x123456);
    for (let i = 0; i < 0x180; i += 4) mem.write32(TEX + i, 0);
    mem.write32(TEX + 0x138, S_SLOT);
    for (let i = 0; i < 24; i += 2) mem.write16(NAME + i, c.name?.[i / 2] ?? (i < 6 ? 0x4081 : 0x8260 + i));
    mem.write16(NAME + 24, 0);
    mem.write32(LANG, c.lang ?? 2);
    const set = (o, v) => mem.write32(OBJ + o, v | 0);
    set(0x0c, c.state ?? 1); set(0x10, c.sub ?? 0); set(0x14, c.s2 ?? 0); set(0x24, UI);
    set(0x54, 0x1001); set(0x58, 6); set(0x5c, c.pack ?? 0); set(0x60, c.yn ?? 0);
    set(0x64, c.blink ?? 0); set(0x68, c.bt ?? 95); set(0x6c, NAME);
    set(0x70, c.p0 ?? 0); set(0x74, c.p1 ?? 3); set(0x78, c.p2 ?? 6); set(0x7c, c.pt ?? 90);
    set(0x80, c.prog ?? 0);
    set(0xbc, c.fa ?? 0xa); set(0xc4, c.foldA ?? 0x1000); set(0xcc, c.fb ?? 0xa); set(0xd4, c.foldB ?? 0x1000);
    set(0x28, h.S.methodBase + 0x28); set(0x38, h.S.methodBase + 0x38); set(0x3c, h.S.methodBase + 0x3c);
    h.reset(c.seed ?? 3);
    for (let i = 0; i < 0x20; i += 4) mem.write32(UI + i, i === 0x1c ? h.iconAt(0) : h.widgetAt(20 + i / 4));
    h.CTL.pad = c.pad ?? { pressed: 0, held: 0, repeat: 0 };
    h.CTL.frame = c.frame ?? 130;
};
const RANGES = [[OBJ, 0x100], [UI, 0x40], [PRIM, 0x30], [OT, 4]];
const bit = (n) => 1 << n;

test("confirmWidgetsBuild and confirmWidgetsBind match", () => {
    h.compare("build", seedObj(), RANGES, () => h.rt.cpu.call(0x80085ecc, [OBJ, UI], 60000),
        () => confirmWidgetsBuild(h.rt.mem, OBJ, UI, host()));
    for (const lang of [0, 2]) {
        for (const pack of [0, 1, 2]) {
            for (const yn of [0, 1]) {
                for (const show of [0, 1]) {
                    for (const name of [undefined, [0x8260, 0x8261, 0x8262, 0, 0], [0x4081, 0x4081, 0x4081, 0x8263, 0]]) {
                        h.compare(`bind l${lang} p${pack} yn${yn} s${show}`, seedObj({ lang, pack, yn, name }), RANGES,
                            () => h.rt.cpu.call(0x80086074, [OBJ, UI, show], 60000),
                            () => confirmWidgetsBind(h.rt.mem, OBJ, UI, show, host()));
                    }
                }
            }
        }
    }
});

test("confirmTick matches across every sub-state and pad", () => {
    const pads = [0, bit(4), bit(6), bit(0xd), bit(0xe), bit(4) | bit(0xd), bit(6) | bit(0xd), bit(0xd) | bit(0xe)];
    const subs = [0, 1, 2, 3, 0x31, 0x32, 0x33, 0x34, 0x63, 0x64, 0x65, 0xc7, 0xc8, 0xc9];
    const seen = { closing: 0, register: 0, back: 0, count: 0, done: 0 };
    for (const sub of subs) {
        for (const pressed of pads) {
            for (const yn of [0, 1]) {
                for (const prog of [0, 50, 0x63, 0x64]) {
                    for (const s2 of [0, 0x77, 0x78]) {
                        const c = { sub, yn, prog, s2, pad: { pressed, held: 0, repeat: 0 } };
                        const r = h.compare(`tick sub${sub.toString(16)} pad${pressed.toString(16)} yn${yn} prog${prog} s2${s2}`,
                            seedObj(c), RANGES, () => h.rt.cpu.call(0x800869c8, [OBJ, UI], 200000),
                            () => confirmTick(h.rt.mem, OBJ, UI, host()));
                        const nsub = r.snap[0x10 / 4];
                        if (sub === 0x32 && nsub === 0x33) seen.closing++;
                        if (sub === 0 && nsub === 1) seen.register++;
                        if (sub === 0 && nsub === 0xc8) seen.back++;
                        if (sub === 1 && r.log.some((e) => e[0] === "sound" && e[1] === 0x80045341)) seen.count++;
                        if (sub === 2 && nsub === 0x64) seen.done++;
                    }
                }
            }
        }
    }
    for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `coverage: ${k}`);
});

test("confirmDraw matches across folds, clocks and the progress bar", () => {
    for (const foldA of [0, 0x1000, 0x800]) {
        for (const foldB of [0, 0x1000, 0x400]) {
            for (const sub of [0, 1, 2, 3]) {
                for (const prog of [0, 1, 50, 0x63, 0x64]) {
                    for (const frame of [100, 105, 130]) {
                        const c = { foldA, foldB, sub, prog, frame, pack: (prog + sub) % 3, bt: 100, pt: 100 - (frame % 3) * 20 };
                        h.compare(`draw a${foldA} b${foldB} s${sub} p${prog} f${frame}`, seedObj(c), RANGES,
                            () => h.rt.cpu.call(0x800862f0, [OBJ], 200000), () => confirmDraw(h.rt.mem, OBJ, host()));
                    }
                }
            }
        }
    }
});

test("confirmPanelTick matches across states", () => {
    for (const state of [0, 1, 2, 3, 4, 9]) {
        for (const pressed of [0, bit(0xd)]) {
            h.compare(`panel s${state} pad${pressed}`, seedObj({ state, pad: { pressed, held: 0, repeat: 0 } }), RANGES,
                () => h.rt.cpu.call(0x80086eb8, [OBJ, UI], 400000), () => confirmPanelTick(h.rt.mem, OBJ, UI, host()));
        }
    }
});
