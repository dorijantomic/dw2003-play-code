// Lane B oracle: engine/dw3/ui/native/inn-screen.ts must match the resident
// inn screen — constructor F0x80011DAC, handler F0x800119A8 and its update
// F0x800110E0. The originals run through engine/native on resident.bin with
// the real inn table (D0x8003EDCC) and the real fold pair (f13 / F0x80010FE0);
// the allocator, text/icon factories, object methods, cells, fade object, the
// rest effect F0x8001104C and the draw context are stubbed identically on both
// sides, so the ordered calls and the screen memory compare frame by frame.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { windowFoldStart, windowFoldTick } from "../../engine/dw3/ui/window-fold.ts";
import {
    INN_SCREEN_CTOR, INN_SCREEN_HANDLER, INN_BIT_TOTAL, INN_MUSIC_CURRENT,
    innScreenCreate, innScreenHandler,
} from "../../engine/dw3/ui/native/inn-screen.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const EXTRA = 0x80150100;
const WIDGETS = [0x80151000, 0x80151200, 0x80151400, 0x80151600, 0x80151800, 0x80151a00];
const ICON = 0x80151c00;
const FADE = 0x80151e00;
const STUB = 0x0fe40000;
const PAD = 0x8004b7d0;
const CELLS = { screen: 0x8004b438, party: 0x8004b44c, bank: 0x80044f4c, lookup: 0x80044f5c, clock: 0x8004df98, sound: 0x80055c48 };
const TEXT_GLOBAL = 0x8005cca8;
const METHODS = { 0x38: 0, 0x114: 2, 0x118: 2, 0x148: 1, 0x144: 1, 0x80: 1, 0x84: 2, 0x64: 2 };
const CTX = { 0x74: 2, 0x7c: 2, 0x98: 1, 0x8c: 3, 0x94: 2, 0x84: 4 };
const CTX_HANDLE = 0x7ff00000;

const rt = new NativeStageRuntime(new Uint8Array(8), entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
const LOG = [];
const CTL = {};
let next = 0;
const st = (a, f) => rt.cpu.setStub(a, f);
const arg = (c, i) => c.reg(4 + i) | 0;

const slotAddr = {};
Object.entries(METHODS).forEach(([slot, n], i) => {
    const s = Number(slot);
    slotAddr[s] = STUB + 0x100 + 4 * i;
    st(slotAddr[s], (c) => hostImpl.callMethod(c.reg(4) >>> 0, s, Array.from({ length: n }, (_, k) => arg(c, 1 + k))));
});
const ctxAddr = {};
Object.entries(CTX).forEach(([slot, n], i) => {
    const s = Number(slot);
    ctxAddr[s] = STUB + 0x200 + 4 * i;
    st(ctxAddr[s], (c) => { hostImpl.drawCall(CTX_HANDLE, s, Array.from({ length: n }, (_, k) => arg(c, k))); return 0; });
});

const hostImpl = {
    callMethod(t, slot, args) {
        LOG.push(["method", t >>> 0, slot, ...args.map((a) => a | 0)]);
        if (slot === 0x38) { rt.mem.write32(t + 0x0c, 1); rt.mem.write32(t + 0x10, 0); }
        return 0;
    },
    allocObject(h, size, extra) { LOG.push(["alloc", h >>> 0, size | 0, extra | 0]); return OBJ; },
    createText(l, k, x, y) { LOG.push(["text", l | 0, k | 0, x | 0, y | 0]); return WIDGETS[next++ % WIDGETS.length]; },
    spawnIcon(l, k, x, y) { LOG.push(["icon", l | 0, k | 0, x | 0, y | 0]); return ICON; },
    screenId() { LOG.push(["screenId"]); return CTL.screen; },
    partyProbe(s) { LOG.push(["party", s | 0]); return CTL.party[s] ?? -1; },
    textBank(b) { LOG.push(["bank", b >>> 0]); return (0x80600000 + (b & 0xffff)) >>> 0; },
    lookup(h) { LOG.push(["lookup", h >>> 0]); return 0x80700000; },
    foldStart(fold, d) {
        hostImpl.playSound((d | 0) !== 0 ? 0x40019 : 0x4001a);
        windowFoldStart(rt.mem, fold, d);
    },
    foldTick(fold) { return windowFoldTick(rt.mem, fold); },
    padRead(p) { LOG.push(["padRead", p | 0]); return CTL.pad; },
    padAlt(p) { LOG.push(["padAlt", p | 0]); return CTL.alt; },
    padShift(p, b) { LOG.push(["padShift", p | 0, b | 0]); return b; },
    playSound(id) { LOG.push(["sound", id >>> 0]); },
    clock() { LOG.push(["clock"]); return CTL.clock; },
    createFade(l) { LOG.push(["fade", l | 0]); return FADE; },
    rest() { LOG.push(["rest"]); },
    drawInit() { LOG.push(["ctxInit"]); return CTX_HANDLE; },
    drawCall(ctx, slot, args) { LOG.push(["ctx", ctx >>> 0, slot, ...args.map((a) => a | 0)]); },
};
st(0x80014504, (c) => hostImpl.allocObject(c.reg(4), arg(c, 1), arg(c, 2)));
st(0x8001ae38, (c) => hostImpl.createText(arg(c, 0), arg(c, 1), arg(c, 2), arg(c, 3)));
st(0x8001b364, (c) => hostImpl.spawnIcon(arg(c, 0), arg(c, 1), arg(c, 2), arg(c, 3)));
st(0x8001206c, (c) => hostImpl.createFade(arg(c, 0)));
st(0x8001104c, () => { hostImpl.rest(); return 0; });
st(0x8001f648, (c) => {
    const ctx = c.reg(4) >>> 0;
    LOG.push(["ctxInit"]);
    for (const s of Object.keys(CTX)) rt.mem.write32(ctx + Number(s), ctxAddr[s]);
    return 0;
});
st(STUB + 0x10, (c) => hostImpl.padRead(arg(c, 0)));
st(STUB + 0x14, (c) => hostImpl.padAlt(arg(c, 0)));
st(STUB + 0x18, (c) => hostImpl.padShift(arg(c, 0), arg(c, 1)));
st(STUB + 0x1c, (c) => { hostImpl.playSound(c.reg(4)); return 0; });
st(STUB + 0x20, (c) => hostImpl.lookup(c.reg(4)));
st(STUB + 0x24, () => hostImpl.screenId());
st(STUB + 0x28, (c) => hostImpl.partyProbe(arg(c, 0)));
st(STUB + 0x2c, (c) => hostImpl.textBank(c.reg(4)));
st(STUB + 0x30, () => hostImpl.clock());

const DEFAULT = { screen: 522, party: [0, 1, -1], pad: 0, alt: 0, clock: 1000, bit: 500, music: 0x40040007, fadeState: 0, global: 0 };

function reset(c = {}) {
    for (let i = 0; i < 0xa0; i += 4) rt.mem.write32(OBJ + i, 0);
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(EXTRA + i, 0);
    for (const w of [...WIDGETS, ICON, FADE]) for (const s of Object.keys(METHODS)) rt.mem.write32(w + Number(s), slotAddr[s]);
    rt.mem.write32(OBJ + 0x38, slotAddr[0x38]);
    rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
    rt.mem.write32(OBJ + 0x10, c.step ?? 0);
    rt.mem.write32(OBJ + 0x14, c.flag ?? 0);
    rt.mem.write32(OBJ + 0x50, c.layer ?? 0x1002);
    rt.mem.write32(OBJ + 0x54, 1);
    rt.mem.write32(OBJ + 0x58, c.pos ?? 0);
    rt.mem.write32(OBJ + 0x5c, c.sel ?? 0);
    rt.mem.write32(OBJ + 0x60, c.count ?? 0);
    rt.mem.write32(OBJ + 0x68, c.start ?? 0);
    for (const [off, f] of [[0x6c, c.f1], [0x7c, c.f2], [0x8c, c.f3]])
        for (let i = 0; i < 4; i++) rt.mem.write32(OBJ + off + 4 * i, (f ?? [10, 0, 0, 0])[i]);
    if (c.widgets ?? (c.state === 1)) {
        rt.mem.write32(EXTRA, FADE);
        WIDGETS.forEach((w, i) => rt.mem.write32(EXTRA + 4 + 4 * i, w));
        rt.mem.write32(EXTRA + 0x1c, ICON);
    }
    Object.assign(CTL, DEFAULT, c.ctl ?? {});
    rt.mem.write32(FADE + 0x0c, CTL.fadeState);
    rt.mem.write32(INN_BIT_TOTAL, CTL.bit);
    rt.mem.write32(INN_MUSIC_CURRENT, CTL.music);
    rt.mem.write32(TEXT_GLOBAL, CTL.global);
    rt.mem.write32(PAD + 0x3f4, STUB + 0x10);
    rt.mem.write32(PAD + 0x3fc, STUB + 0x14);
    rt.mem.write32(PAD + 0x408, STUB + 0x18);
    rt.mem.write32(CELLS.sound, STUB + 0x1c);
    rt.mem.write32(CELLS.lookup, STUB + 0x20);
    rt.mem.write32(CELLS.screen, STUB + 0x24);
    rt.mem.write32(CELLS.party, STUB + 0x28);
    rt.mem.write32(CELLS.bank, STUB + 0x2c);
    rt.mem.write32(CELLS.clock, STUB + 0x30);
    next = 0;
    LOG.length = 0;
}
const snap = () => {
    const out = [];
    for (let i = 0; i < 0xa0; i += 4) out.push(rt.mem.read32(OBJ + i) >>> 0);
    for (let i = 0; i < 0x20; i += 4) out.push(rt.mem.read32(EXTRA + i) >>> 0);
    out.push(rt.mem.read32(INN_BIT_TOTAL) >>> 0, rt.mem.read32(FADE + 0x0c) >>> 0);
    return out;
};
const orig = () => rt.cpu.call(INN_SCREEN_HANDLER, [OBJ, EXTRA], 50000);
const port = () => innScreenHandler(rt.mem, OBJ, EXTRA, hostImpl);

/** Run `frames` handler ticks on both sides; script(f, ctl, mem) applies inputs first. */
function scenario(name, frames, script, c = {}) {
    const record = (fn) => {
        reset(c);
        const out = [];
        for (let f = 0; f < frames; f++) {
            script?.(f, CTL, rt.mem);
            LOG.length = 0;
            fn();
            out.push([LOG.slice(), snap()]);
        }
        return out;
    };
    const o = record(orig);
    const p = record(port);
    for (let f = 0; f < frames; f++) {
        assert.deepEqual(p[f][0], o[f][0], `${name} frame ${f}: calls`);
        assert.deepEqual(p[f][1], o[f][1], `${name} frame ${f}: memory`);
    }
    return o;
}

const BTN = { up: 1 << 4, down: 1 << 6, ok: 1 << 0xd, cancel: 1 << 0xe };
const flat = (frames) => frames.flatMap(([log]) => log);
const step = () => rt.mem.read32(OBJ + 0x10) | 0;
const play = (moves) => (f, ctl, mem) => {
    ctl.pad = 0; ctl.alt = 0;
    if (moves[f]) Object.assign(ctl, moves[f]);
    if (moves.fadeAt?.includes(f)) mem.write32(FADE + 0x0c, 2);
    if (moves.fadeOffAt?.includes(f)) mem.write32(FADE + 0x0c, 0);
    if (moves.clock?.[f] !== undefined) ctl.clock = moves.clock[f];
};
// Frames: 0 build, 1 header open, ~2..12 header ticks, then prompt; step 3 by ~frame 24.
const OPEN = 26;

test("constructor F0x80011DAC stores the layer and returns the object", () => {
    const run = (fn) => { reset(); for (let i = 0; i < 0xa0; i += 4) rt.mem.write32(OBJ + i, 0); LOG.length = 0; const r = fn(); return [r >>> 0, LOG.slice(), snap()]; };
    for (const layer of [0x1002, 0x1000, -5]) {
        const o = run(() => rt.cpu.call(INN_SCREEN_CTOR, [layer], 1000));
        const p = run(() => innScreenCreate(rt.mem, layer, hostImpl));
        assert.deepEqual(p, o);
        assert.deepEqual(o[1][0], ["alloc", INN_SCREEN_HANDLER, 0xa0, 0x20]);
    }
});

test("open: build, header then prompt folds, texts and price set", () => {
    const o = scenario("open", OPEN, null);
    assert.deepEqual(o[0][0].filter((e) => e[0] === "text" || e[0] === "icon"), [
        ["text", 0x1002, 1, 0x1d, 0x14], ["text", 0x1002, 3, 0x117, 0x17], ["text", 0x1002, 3, 0x11a, 0x17],
        ["text", 0x1002, 1, 0x79, 0x34], ["text", 0x1002, 1, 0xc5, 0x5f], ["text", 0x1002, 1, 0xc5, 0x6f],
        ["icon", 0x1002, 0, 0xb8, 0x5f]]);
    const all = flat(o);
    // Asuka Inn: eshtlnam name 1, 8 BIT a head, two party members.
    assert.ok(all.some((e) => e[0] === "method" && e[2] === 0x114 && e[4] === 1));
    assert.ok(all.some((e) => e[0] === "method" && e[2] === 0x118 && e[3] === 1 && e[4] === 8));
    assert.equal(rt.mem.read32(OBJ + 0x60) | 0, 2);
    assert.equal(step(), 3);
});

test("inn lookup: every table position, an unknown screen, and odd party probes", () => {
    for (const screen of [522, 603, 691, 9999, 0]) scenario(`screen ${screen}`, 1, null, { ctl: { screen } });
    for (const party of [[0, 0, 0], [-1, -1, -1], [5, -2, 0x7fffffff]]) scenario(`party ${party}`, 1, null, { ctl: { party }, count: 3 });
    scenario("layer sign", 1, null, { layer: 0x12348002 });
});

test("cursor moves: down, clamp, up on either pad word", () => {
    const all = flat(scenario("cursor", OPEN + 6, play({ [OPEN]: { pad: BTN.down }, [OPEN + 1]: { alt: BTN.down },
        [OPEN + 2]: { pad: BTN.up }, [OPEN + 3]: { alt: BTN.up }, [OPEN + 4]: { pad: BTN.down | BTN.up } })));
    assert.equal(all.filter((e) => e[0] === "sound" && e[1] === 0x8004513e).length, 2);
    assert.ok(all.some((e) => e[0] === "method" && e[2] === 0x84 && e[3] === 0xb8 && e[4] === 0x6f));
});

test("confirm with enough BIT: rest fade, charge, rest effect, music restored", () => {
    const moves = { [OPEN]: { pad: BTN.ok }, fadeAt: [OPEN + 3, OPEN + 10], fadeOffAt: [OPEN + 5], clock: { [OPEN + 6]: 1100, [OPEN + 7]: 1240, [OPEN + 8]: 1241 } };
    const all = flat(scenario("stay", OPEN + 12, play(moves), { ctl: { bit: 16 } }));
    assert.ok(all.some((e) => e[0] === "rest"));
    assert.ok(all.some((e) => e[0] === "sound" && e[1] === 0x4004000d));
    assert.ok(all.some((e) => e[0] === "sound" && e[1] === 0x40040007));
    assert.equal(rt.mem.read32(INN_BIT_TOTAL) | 0, 0);
    assert.equal(rt.mem.read32(OBJ + 0x0c) | 0, 3);
});

test("confirm without enough BIT: refusal panel, confirm, back to the prompt", () => {
    const moves = { [OPEN]: { pad: BTN.ok }, [OPEN + 30]: { pad: BTN.ok } };
    const o = scenario("refuse", OPEN + 56, play(moves), { ctl: { bit: 15 } });
    const all = flat(o);
    assert.ok(all.some((e) => e[0] === "method" && e[2] === 0x114 && e[4] === 0x14));
    assert.ok(!all.some((e) => e[0] === "rest"));
    assert.ok(all.some((e) => e[0] === "sound" && e[1] === 0x4001c));
    assert.equal(rt.mem.read32(INN_BIT_TOTAL) | 0, 15);
    assert.equal(step(), 3);
});

test("do-not-stay and cancel close the screen without charging", () => {
    for (const [name, moves] of [["no", { [OPEN]: { pad: BTN.down }, [OPEN + 1]: { pad: BTN.ok } }], ["cancel", { [OPEN]: { pad: BTN.cancel } }]]) {
        const all = flat(scenario(name, OPEN + 30, play(moves)));
        assert.ok(!all.some((e) => e[0] === "rest"), name);
        assert.equal(rt.mem.read32(OBJ + 0x0c) | 0, 3, `${name} closed`);
        assert.equal(rt.mem.read32(INN_BIT_TOTAL) | 0, 500);
    }
});

test("seeded single frames: task states, unused steps, edge selections, draw scales", () => {
    for (const state of [-1, 2, 3, 4, 7]) scenario(`state ${state}`, 1, null, { state, widgets: true });
    for (const s of [4, 9, 13, 19, 24, 29, 33, 0x7fffffff, -1]) scenario(`step ${s}`, 1, null, { state: 1, step: s });
    for (const sel of [0, 1, 2, -3]) for (const pad of [0, BTN.ok, BTN.up, BTN.down, BTN.cancel])
        scenario(`sel ${sel} pad ${pad}`, 1, (f, ctl) => { ctl.pad = pad; }, { state: 1, step: 3, sel, count: 3 });
    for (const bit of [-1, 23, 24, 0x7fffffff]) scenario(`bit ${bit}`, 1, (f, ctl) => { ctl.pad = BTN.ok; }, { state: 1, step: 3, count: 3, ctl: { bit } });
    for (const flag of [0, 1, 2]) scenario(`close flag ${flag}`, 1, null, { state: 1, step: 11, flag });
    for (const clock of [0, 0xf0, 0xf1, -5]) scenario(`clock ${clock}`, 1, null, { state: 1, step: 22, ctl: { clock } });
    for (const fadeState of [0, 2, 3]) for (const s of [21, 23]) scenario(`fade ${fadeState} step ${s}`, 1, null, { state: 1, step: s, count: 2, ctl: { fadeState } });
    for (const v of [0, 0x1000, 0x800, -5, 0x2000])
        scenario(`draw ${v}`, 1, null, { state: 1, step: 12, f1: [10, 0, v, 1], f2: [10, 0, v, 1], f3: [10, 0, v, 1] });
});
