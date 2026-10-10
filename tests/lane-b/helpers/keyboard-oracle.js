// Oracle: engine/dw3/ui/native/name-keyboard.ts must match the original
// pro/stdgname keyboard bodies. The original runs through engine/native on the
// shipped overlay + resident image; every service the bodies call is stubbed on
// both sides so the ordered calls, the object fields and the name buffer can be
// compared. Pad answers and starting states come from a fixed pseudo-random
// stream, so each seeded case repeats identically for original and port.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
    nameEntryCreate,
    nameEntryReseed,
    nameEntryCommit,
    nameEntrySeedAndPad,
    nameEntrySetOrigin,
    nameEntryTick,
    nameEntryWidgetsBind,
    nameEntryWidgetsBuild,
    nameKeyboardDraw,
    nameKeyboardTick,
} from "../../../engine/dw3/ui/native/name-keyboard.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));

export function defineKeyboardOracle(V) {
const overlay = new Uint8Array(readFileSync(join(dir, V.overlayFile)));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const OBJ = 0x80150000;
const UI = 0x80155000;
const DST = 0x80156000;
const SRC = 0x80157000;
const POOL = 0x80171000;
const POOL_STEP = 0x200;
const LANG = 0x8005cca8;
const PAGES = V.layout.t.pageStruct;
const F = V.layout.f;
const T = V.layout.t;

const S = {
    alloc: 0x0fe10000, widget: 0x0fe10004, copy: 0x0fe10008, len: 0x0fe1000c,
    foldStart: 0x0fe10010, foldTick: 0x0fe10014, padPressed: 0x0fe10018, padHeld: 0x0fe1001c,
    padRepeat: 0x0fe10020, padBit: 0x0fe10024, sound: 0x0fe10028, pack: 0x0fe1002c,
    bank: 0x0fe10030, frame: 0x0fe10034, drawInit: 0x0fe10038, gpuInit: 0x0fe1003c,
    d74: 0x0fe10040, d7c: 0x0fe10044, dSprite: 0x0fe10048, d88: 0x0fe1004c,
    d8c: 0x0fe10050, d94: 0x0fe10054, g24: 0x0fe10058, g2c: 0x0fe1005c,
    methodBase: 0x0fe12000,
};
const METHOD_ARITY = { 0x110: 1, 0x114: 2, 0x138: 1, 0x140: 2, 0x144: 1, 0x15c: 1, 0x160: 1, 0x38: 0 };

const LOG = [];
const RNG = { s: 1 };
const next = () => { RNG.s = (Math.imul(RNG.s, 1103515245) + 12345) >>> 0; return RNG.s >>> 8; };
const CTL = { widgetN: 0, alloc: 0x80158000, len: 6, padMode: 0 };
const padBits = (kind) => {
    // Bias toward few bits set so single-button paths get exercised.
    const r = next();
    if (CTL.padMode === 0) return 0;
    // Modes 3 and 4 hold exactly the confirm or the back button.
    if (CTL.padMode === 3) return kind === "pressed" ? 1 << 13 : 0;
    if (CTL.padMode === 4) return kind === "pressed" ? 1 << 14 : 0;
    if (CTL.padMode === 1) return 1 << (3 + (r % 12));
    return (r >>> 4) & 0xffff;
};

function widgetAt(rt, n) {
    const w = POOL + n * POOL_STEP;
    for (let i = 0; i < POOL_STEP; i += 4) rt.mem.write32(w + i, 0);
    for (const slot of Object.keys(METHOD_ARITY)) rt.mem.write32(w + Number(slot), S.methodBase + Number(slot));
    return w;
}

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
    const rt = new NativeStageRuntime(overlay, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident, base: 0x80010000,
    });
    const st = (addr, fn) => rt.cpu.setStub(addr, fn);
    st(0x80014504, (c) => { LOG.push(["alloc", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return CTL.alloc; });
    st(0x8001ae38, (c) => {
        LOG.push(["widget", c.reg(4) << 16 >> 16, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return widgetAt(rt, CTL.widgetN++);
    });
    st(0x8001fcc0, (c) => { LOG.push(["copyInit"]); rt.mem.write32(c.reg(4) + 8, S.copy); return 0; });
    st(S.copy, (c) => { LOG.push(["copy", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    st(0x8002525c, (c) => { LOG.push(["len", c.reg(4) | 0]); return CTL.len; });
    st(V.addrs.foldStart, (c) => { LOG.push(["foldStart", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(V.addrs.foldTick, (c) => { LOG.push(["foldTick", c.reg(4) | 0]); return next() & 1; });
    st(S.padPressed, (c) => { const v = padBits("pressed"); LOG.push(["pressed", c.reg(4) | 0, v]); return v; });
    st(S.padHeld, (c) => { const v = padBits("held"); LOG.push(["held", c.reg(4) | 0, v]); return v; });
    st(S.padRepeat, (c) => { const v = padBits("repeat"); LOG.push(["repeat", c.reg(4) | 0, v]); return v; });
    st(S.padBit, (c) => { LOG.push(["bit", c.reg(4) | 0, c.reg(5) | 0]); return c.reg(5) | 0; });
    st(S.sound, (c) => { LOG.push(["sound", c.reg(4) >>> 0]); return 0; });
    st(S.pack, (c) => { LOG.push(["pack", c.reg(4) >>> 0]); return 0x1234; });
    st(S.bank, (c) => { LOG.push(["bank", c.reg(4) | 0]); return 0x5678; });
    st(S.frame, () => { const v = 100 + (next() % 40); LOG.push(["frame", v]); return v; });
    st(0x8001f648, (c) => {
        LOG.push(["drawInit"]);
        const t = c.reg(4);
        rt.mem.write32(t + 0x74, S.d74); rt.mem.write32(t + 0x7c, S.d7c); rt.mem.write32(t + 0x84, S.dSprite);
        rt.mem.write32(t + 0x88, S.d88); rt.mem.write32(t + 0x8c, S.d8c); rt.mem.write32(t + 0x94, S.d94);
        return 0;
    });
    st(0x8001ffa8, (c) => {
        LOG.push(["gpuInit"]);
        rt.mem.write32(c.reg(4) + 0x24, S.g24); rt.mem.write32(c.reg(4) + 0x2c, S.g2c);
        return 0;
    });
    st(S.d74, (c) => { LOG.push(["d74", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.d7c, (c) => { LOG.push(["d7c", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.dSprite, (c) => { LOG.push(["sprite", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
    st(S.d88, (c) => { LOG.push(["d88", c.reg(4) | 0]); return 0; });
    st(S.d8c, (c) => { LOG.push(["d8c", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    st(S.d94, (c) => { LOG.push(["d94", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.g24, (c) => { LOG.push(["g24", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.g2c, (c) => { LOG.push(["g2c", c.reg(4) | 0]); return 0; });
    for (const [slot, arity] of Object.entries(METHOD_ARITY)) {
        st(S.methodBase + Number(slot), (c) => {
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, Number(slot), ...args]);
            return 0;
        });
    }
    rt.mem.write32(0x8004b7d0 + 0x3f4, S.padPressed);
    rt.mem.write32(0x8004b7d0 + 0x3f8, S.padHeld);
    rt.mem.write32(0x8004b7d0 + 0x3fc, S.padRepeat);
    rt.mem.write32(0x8004b7d0 + 0x408, S.padBit);
    rt.mem.write32(0x80055c48, S.sound);
    rt.mem.write32(0x80044b38 + 0x424, S.pack);
    rt.mem.write32(0x80044b38 + 0x414, S.bank);
    rt.mem.write32(0x8004de10 + 0x188, S.frame);
    return rt;
}

const host = () => ({
    alloc(handler, size, extra) { LOG.push(["alloc", handler | 0, size, extra]); return CTL.alloc; },
    createWidget(layer, x, y) {
        LOG.push(["widget", layer << 16 >> 16, 1, x, y]);
        return widgetAt(RT, CTL.widgetN++);
    },
    callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
    copyString(dst, src, mode) { LOG.push(["copyInit"]); LOG.push(["copy", dst | 0, src | 0, mode | 0]); },
    stringLength(ptr) { LOG.push(["len", ptr | 0]); return CTL.len; },
    foldStart(f, d) { LOG.push(["foldStart", f | 0, d | 0]); },
    foldTick(f) { LOG.push(["foldTick", f | 0]); return next() & 1; },
    padPressed(n) { const v = padBits("pressed"); LOG.push(["pressed", n, v]); return v; },
    padHeld(n) { const v = padBits("held"); LOG.push(["held", n, v]); return v; },
    padRepeat(n) { const v = padBits("repeat"); LOG.push(["repeat", n, v]); return v; },
    padBit(pad, code) { LOG.push(["bit", pad | 0, code | 0]); return code | 0; },
    playSound(id) { LOG.push(["sound", id >>> 0]); },
    packHandle(id) { LOG.push(["pack", id >>> 0]); return 0x1234; },
    languageBank(id) { LOG.push(["bank", id | 0]); return 0x5678; },
    frameCount() { const v = 100 + (next() % 40); LOG.push(["frame", v]); return v; },
    drawInit() { LOG.push(["drawInit"]); },
    draw74(a, b) { LOG.push(["d74", a | 0, b | 0]); },
    draw7C(a, b) { LOG.push(["d7c", a | 0, b | 0]); },
    drawSprite(h, c, x, y) { LOG.push(["sprite", h | 0, c | 0, x | 0, y | 0]); },
    draw88(n) { LOG.push(["d88", n | 0]); },
    draw8C(a, b, c) { LOG.push(["d8c", a | 0, b | 0, c | 0]); },
    draw94(a, b) { LOG.push(["d94", a | 0, b | 0]); },
    gpuInit() { LOG.push(["gpuInit"]); },
    gpu24(x, y) { LOG.push(["g24", x | 0, y | 0]); },
    gpu2C(h) { LOG.push(["g2c", h | 0]); },
});

let RT;

function seedObj(rt, c) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(OBJ + i, 0);
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(UI + i, 0);
    rt.mem.write32(LANG, c.lang);
    if (c.lang === 0) {
        rt.mem.write32(PAGES, 3); rt.mem.write32(PAGES + 4, T.lang0.labels); rt.mem.write32(PAGES + 8, T.lang0.grid);
    } else {
        rt.mem.write32(PAGES, 1); rt.mem.write32(PAGES + 4, T.other.labels); rt.mem.write32(PAGES + 8, T.other.grid);
    }
    const limit = c.lang === 0 ? 5 : 8;
    const set = (off, v) => rt.mem.write32(OBJ + off, v | 0);
    set(0x0c, c.state ?? 1); set(0x10, c.sub ?? 2);
    set(0x50, c.mode ?? 1); set(0x54, 0x1000); set(0x58, 3);
    set(0x5c, 0x280); set(0x60, 0x100); set(0x64, c.index ?? 1);
    set(0x68, c.a68 ?? 0); set(0x6c, c.a6c ?? 90); set(0x70, c.a70 ?? 0); set(0x74, c.a74 ?? 95);
    set(0x90, c.insert ?? 0); set(0x94, limit);
    set(F.col, c.col ?? 0); set(F.row, c.row ?? 0); set(F.blinkFrame, c.a4 ?? 0); set(F.blinkTime, c.a8 ?? 98);
    set(F.cursorOn, c.ac ?? 1); set(F.page, c.page ?? 0); set(F.arrowFrame, c.b4 ?? 0); set(F.arrowTime, c.b8 ?? 99);
    set(F.scale, c.d8 ?? 0x1000); set(F.overlay, c.e8 ?? 0);
    set(0x38, S.methodBase + 0x38);
    // The name buffer is 12 halfwords (0x78..0x90); +0x90 is the insert index.
    for (let i = 0; i < 12; i++) rt.mem.write16(OBJ + 0x78 + i * 2, c.slots?.[i] ?? 0x4081);
    CTL.widgetN = 0;
    for (let i = 0; i < 0x34; i += 4) {
        const w = widgetAt(rt, 20 + i / 4);
        rt.mem.write32(UI + i, w);
        rt.mem.write32(w + 0x50, T.glyph);
    }
    CTL.widgetN = 0;
    CTL.len = c.len ?? 6;
    CTL.padMode = c.pad ?? 0;
    RNG.s = c.seed ?? 7;
}

function snapshot(rt) {
    const out = [];
    for (let i = 0; i < 0x100; i += 4) out.push(rt.mem.read32(OBJ + i) >>> 0);
    for (let i = 0; i < 0x40; i += 4) out.push(rt.mem.read32(UI + i) >>> 0);
        for (const a of [PAGES, PAGES + 4, PAGES + 8, T.wideKeys + 0x18, T.wideKeys + 0x24, T.wideKeys + 0x30]) out.push(rt.mem.read32(a) >>> 0);
    return out;
}

function compare(name, c, runOrig, runPort) {
    RT = runtime.cache ??= runtime();
    seedObj(RT, c);
    LOG.length = 0;
    runOrig(RT);
    const olog = LOG.slice();
    const osnap = snapshot(RT);
    seedObj(RT, c);
    LOG.length = 0;
    runPort(RT);
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(snapshot(RT), osnap, `${name}: memory`);
    return { log: olog, snap: osnap };
}

if (V.createTests) {
test(`${V.label}: nameEntrySetOrigin, nameEntryCommit match`, () => {
    compare("origin", { lang: 0 }, (rt) => rt.cpu.call(0x800851b8, [OBJ, 0x11, 0x22], 4000), (rt) => nameEntrySetOrigin(rt.mem, OBJ, 0x11, 0x22));
    compare("commit", { lang: 0 }, (rt) => rt.cpu.call(0x80085358, [OBJ], 4000), (rt) => nameEntryCommit(rt.mem, OBJ));
});

test(`${V.label}: nameEntrySeedAndPad and nameEntryCreate match`, () => {
    for (const lang of [0, 1, 2]) {
        for (const len of [0, 2, 4, 6, 10, 16, 20]) {
            compare(`seed lang${lang} len${len}`, { lang, len }, (rt) => rt.cpu.call(0x800851c4, [OBJ, SRC], 20000), (rt) => nameEntrySeedAndPad(rt.mem, OBJ, SRC, host()));
        }
        compare(`create lang${lang}`, { lang, len: 4 }, (rt) => rt.cpu.call(0x80085364, [SRC, 3], 40000), (rt) => nameEntryCreate(rt.mem, SRC, 3, host()));
    }
});

test(`${V.label}: nameEntryReseed matches`, () => {
    const shapes = [
        [0x4081, 0x4081, 0x4081, 0x4081, 0x4081],
        [0x4182, 0x4183, 0x4081, 0x4081, 0x4081],
        [0x4081, 0x4081, 0x4182, 0x4183, 0x4184],
        [0x4081, 0x4182, 0x4081, 0x4183, 0x4081],
        [0, 0, 0x4182, 0x4081, 0x4081],
    ];
    for (const lang of [0, 1]) {
        for (const [i, slots] of shapes.entries()) {
            compare(`reseed lang${lang} #${i}`, { lang, slots },
                (rt) => { for (let k = 0; k < 40; k++) rt.mem.write8(DST + k, 0xee); rt.cpu.call(0x80085258, [OBJ, DST], 40000); },
                (rt) => { for (let k = 0; k < 40; k++) rt.mem.write8(DST + k, 0xee); nameEntryReseed(rt.mem, OBJ, DST, host()); });
        }
    }
});

}

test(`${V.label}: nameEntryWidgetsBuild and nameEntryWidgetsBind match`, () => {
    for (const lang of [0, 1]) {
        compare(`build lang${lang}`, { lang }, (rt) => rt.cpu.call(V.addrs.build, [OBJ, UI], 60000), (rt) => nameEntryWidgetsBuild(rt.mem, OBJ, UI, host(), V.layout));
        for (const show of [0, 1]) {
            for (const page of [0, 1, 2]) {
                compare(`bind lang${lang} show${show} page${page}`, { lang, page }, (rt) => rt.cpu.call(V.addrs.bind, [OBJ, UI, show], 60000), (rt) => nameEntryWidgetsBind(rt.mem, OBJ, UI, show, host(), V.layout));
            }
        }
    }
});

test(`${V.label}: nameEntryTick matches across states`, () => {
    for (const lang of [0, 1]) {
        for (const state of [0, 1, 2, 3, 4, 9]) {
            compare(`tick lang${lang} state${state}`, { lang, state, sub: 2, pad: 0 }, (rt) => rt.cpu.call(V.addrs.entryTick, [OBJ, UI], 400000), (rt) => nameEntryTick(rt.mem, OBJ, UI, host(), V.layout));
        }
    }
});

test(`${V.label}: nameKeyboardDraw matches over seeded cursor states`, () => {
    for (let n = 0; n < 240; n++) {
        RNG.s = n * 7919 + 3;
        const lang = n % 3 === 0 ? 0 : 1;
        const page = lang === 0 ? next() % 3 : 0;
        const c = {
            lang, page, mode: next() % 3, index: (next() % 5) - 1, ac: next() % 2, d8: next() % 4 === 0 ? 0 : (next() % 2 ? 0x1000 : 0x800),
            e8: next() % 3 === 0 ? 0 : (next() % 2 ? 0x1000 : 0x400), col: next() % 15, row: next() % 7,
            insert: next() % (lang === 0 ? 5 : 8), a4: next() % 5, a8: 100 + (next() % 40), a68: next() % 8, a6c: 100 + (next() % 40),
            a70: next() % 15, a74: 100 + (next() % 40), b4: next() % 7, b8: 100 + (next() % 40), seed: n + 1,
        };
        compare(`draw #${n}`, c, (rt) => rt.cpu.call(V.addrs.draw, [OBJ], 400000), (rt) => nameKeyboardDraw(rt.mem, OBJ, host(), V.layout));
    }
});

test(`${V.label}: nameKeyboardTick matches over seeded typing states`, () => {
    const seen = { accepted: 0, rejected: 0, confirm: 0, back: 0, text: 0, move: 0 };
    const subs = [0, 1, 2, 2, 2, 2, 2, 2, 0xa, 0xb, 0x14, 0x15, 0x16, 0x17, 0x30];
    for (let n = 0; n < 1500; n++) {
        RNG.s = n * 104729 + 11;
        const lang = n % 3 === 0 ? 0 : 1;
        const page = lang === 0 ? next() % 3 : 0;
        const limit = lang === 0 ? 5 : 8;
        const slots = [];
        for (let i = 0; i < limit; i++) slots.push([0x4081, 0x4182, 0, 0x4283][next() % 4]);
        const c = {
            lang, page, sub: subs[next() % subs.length], col: next() % 15, row: next() % 7,
            insert: next() % limit, pad: 1 + (next() % 2), seed: n + 5, slots, index: next() % 4,
        };
        const { log, snap } = compare(`tick #${n} sub${c.sub.toString(16)} pad${c.pad}`, c, (rt) => rt.cpu.call(V.addrs.tick, [OBJ, UI], 400000), (rt) => nameKeyboardTick(rt.mem, OBJ, UI, host(), V.layout));
        const sub = snap[0x10 / 4];
        if (sub === 0x64) seen.accepted++;
        if (sub === 0x14 && c.sub === 2) seen.rejected++;
        if (log.some((e) => e[0] === "sound" && e[1] === 0x4001c)) seen.confirm++;
        if (log.some((e) => e[0] === "sound" && e[1] === 0x800450bd)) seen.back++;
        if (log.some((e) => e[0] === "method" && e[2] === 0x110)) seen.text++;
        if (log.some((e) => e[0] === "sound" && e[1] === 0x4001b)) seen.move++;
    }
    // Targeted cases: the cursor on each special key and on ordinary keys,
    // pressing confirm or back, with empty, partial and full names.
    const fills = [
        [0x4081, 0x4081, 0x4081, 0x4081, 0x4081, 0x4081, 0x4081, 0x4081],
        [0x4182, 0x4081, 0x4081, 0x4081, 0x4081, 0x4081, 0x4081, 0x4081],
        [0x4182, 0x4183, 0x4184, 0x4081, 0x4081, 0x4081, 0x4081, 0x4081],
        [0x4182, 0x4183, 0x4184, 0x4185, 0x4186, 0x4187, 0x4188, 0x4189],
    ];
    for (const lang of [0, 1]) {
        for (let page = 0; page < (lang === 0 ? 3 : 1); page++) {
            for (let row = 0; row < 7; row++) {
                for (let col = 0; col < 15; col++) {
                    for (const mode of [3, 4]) {
                        const slots = fills[(row + col + page) % fills.length];
                        const limit = lang === 0 ? 5 : 8;
                        const c = { lang, page, sub: 2, col, row, pad: mode, seed: row * 31 + col, slots: slots.slice(0, limit), insert: (row + col) % limit };
                        const { log, snap } = compare(`target l${lang} p${page} r${row} c${col} m${mode}`, c, (rt) => rt.cpu.call(V.addrs.tick, [OBJ, UI], 400000), (rt) => nameKeyboardTick(rt.mem, OBJ, UI, host(), V.layout));
                        const sub = snap[0x10 / 4];
                        if (sub === 0x64) seen.accepted++;
                        if (sub === 0x14) seen.rejected++;
                        if (log.some((e) => e[0] === "sound" && e[1] === 0x4001c)) seen.confirm++;
                        if (log.some((e) => e[0] === "sound" && e[1] === 0x800450bd)) seen.back++;
                        if (log.some((e) => e[0] === "method" && e[2] === 0x110)) seen.text++;
                    }
                }
            }
        }
    }
    // The OK key with every kind of name, so accept and reject are both hit.
    for (const lang of [0, 1]) {
        for (let page = 0; page < (lang === 0 ? 3 : 1); page++) {
            for (const col of [13, 14]) {
                for (const slots of fills) {
                    const limit = lang === 0 ? 5 : 8;
                    const c = { lang, page, sub: 2, col, row: 6, pad: 3, seed: col, slots: slots.slice(0, limit), insert: 1 };
                    const { snap } = compare(`ok l${lang} p${page} c${col}`, c, (rt) => rt.cpu.call(V.addrs.tick, [OBJ, UI], 400000), (rt) => nameKeyboardTick(rt.mem, OBJ, UI, host(), V.layout));
                    if (snap[0x10 / 4] === 0x64) seen.accepted++;
                    if (snap[0x10 / 4] === 0x14) seen.rejected++;
                }
            }
        }
    }
    // The seeded states must reach the confirm, back, OK and reject paths, or
    // a green run proves little.
    for (const [k, v] of Object.entries(seen)) assert.ok(v >= 5, `coverage: ${k} reached ${v} times`);
});

}
