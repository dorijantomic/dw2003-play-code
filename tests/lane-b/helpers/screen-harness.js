// A shared oracle harness for screen-object bodies. It runs an original body
// through engine/native on the shipped overlay and resident image with every
// service the body calls stubbed, and gives the port a host that logs the same
// call stream, so the ordered calls and the object memory can be compared.
//
// Services stubbed on the original side (and mirrored by `host()`):
//   allocator F0x80014504, text widget factory F0x8001AE38, cursor factory
//   F0x8001B364, the widget and cursor method slots, the pad service cell
//   0x8004B7D0 (pressed +0x3F4, held +0x3F8, repeat +0x3FC, bit map +0x408),
//   the sound cell, the pack and bank resolvers, the frame counter, the draw and
//   GPU context builders and their call tables, and the string services.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));

export const POOL = 0x80171000;
export const POOL_STEP = 0x200;
const S = {
    padPressed: 0x0fe10018, padHeld: 0x0fe1001c, padRepeat: 0x0fe10020, padBit: 0x0fe10024,
    sound: 0x0fe10028, pack: 0x0fe1002c, bank: 0x0fe10030, frame: 0x0fe10034,
    d74: 0x0fe10040, d7c: 0x0fe10044, dSprite: 0x0fe10048, d88: 0x0fe1004c, d8c: 0x0fe10050,
    d94: 0x0fe10054, d78: 0x0fe10060, rand: 0x0fe10058, methodBase: 0x0fe12000, iconBase: 0x0fe14000, tableBase: 0x0fe16000,
};
export const METHOD_ARITY = {
    0x110: 1, 0x114: 2, 0x118: 2, 0x134: 2, 0x138: 1, 0x140: 2, 0x144: 1, 0x148: 1, 0x15c: 1, 0x160: 1,
    0x38: 0, 0x3c: 0, 0x28: 1, 0x2c: 1,
};
const ICON_ARITY = { 0x80: 1, 0x84: 2, 0x88: 1, 0x8c: 1, 0x90: 1, 0x94: 1 };

export function createHarness({ overlayFile, functions = {}, tables = {} }) {
    const overlay = new Uint8Array(readFileSync(join(dir, overlayFile)));
    const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
    const LOG = [];
    const RNG = { s: 1 };
    const next = () => { RNG.s = (Math.imul(RNG.s, 1103515245) + 12345) >>> 0; return RNG.s >>> 8; };
    const CTL = { widgetN: 0, iconN: 0, alloc: 0x80158000, pad: { pressed: 0, held: 0, repeat: 0 }, frame: 100 };

    const rt = new NativeStageRuntime(overlay, entry, { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 },
        undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });

    const widgetAt = (n) => {
        const w = POOL + n * POOL_STEP;
        for (let i = 0; i < POOL_STEP; i += 4) rt.mem.write32(w + i, 0);
        for (const slot of Object.keys(METHOD_ARITY)) rt.mem.write32(w + Number(slot), S.methodBase + Number(slot));
        return w;
    };
    const iconAt = (n) => {
        const w = POOL + 0x10000 + n * POOL_STEP;
        for (let i = 0; i < POOL_STEP; i += 4) rt.mem.write32(w + i, 0);
        for (const slot of Object.keys(ICON_ARITY)) rt.mem.write32(w + Number(slot), S.iconBase + Number(slot));
        return w;
    };

    const st = (addr, fn) => rt.cpu.setStub(addr, fn);
    st(0x80014504, (c) => { LOG.push(["alloc", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return CTL.alloc; });
    st(0x8001ae38, (c) => {
        LOG.push(["widget", c.reg(4) << 16 >> 16, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return widgetAt(CTL.widgetN++);
    });
    st(0x8001b364, (c) => {
        LOG.push(["icon", c.reg(4) << 16 >> 16, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return iconAt(CTL.iconN++);
    });
    for (const [name, addr] of Object.entries(functions)) {
        st(addr.address, (c) => {
            const args = addr.args.map((_, i) => c.reg(4 + i) | 0);
            LOG.push([name, ...args]);
            return addr.result ? addr.result(args) : 0;
        });
    }
    st(S.padPressed, (c) => { const v = CTL.pad.pressed; LOG.push(["pressed", c.reg(4) | 0, v]); return v; });
    st(S.padHeld, (c) => { const v = CTL.pad.held; LOG.push(["held", c.reg(4) | 0, v]); return v; });
    st(S.padRepeat, (c) => { const v = CTL.pad.repeat; LOG.push(["repeat", c.reg(4) | 0, v]); return v; });
    st(S.padBit, (c) => { LOG.push(["bit", c.reg(4) | 0, c.reg(5) | 0]); return c.reg(5) | 0; });
    st(S.sound, (c) => { LOG.push(["sound", c.reg(4) >>> 0]); return 0; });
    st(S.pack, (c) => { LOG.push(["pack", c.reg(4) >>> 0]); return 0x1234; });
    st(S.bank, (c) => { LOG.push(["bank", c.reg(4) | 0]); return 0x5678; });
    st(S.frame, () => { LOG.push(["frame", CTL.frame]); return CTL.frame; });
    st(0x8001f648, (c) => {
        LOG.push(["drawInit"]);
        const t = c.reg(4);
        rt.mem.write32(t + 0x74, S.d74); rt.mem.write32(t + 0x78, S.d78); rt.mem.write32(t + 0x7c, S.d7c); rt.mem.write32(t + 0x84, S.dSprite);
        rt.mem.write32(t + 0x88, S.d88); rt.mem.write32(t + 0x8c, S.d8c); rt.mem.write32(t + 0x94, S.d94);
        return 0;
    });
    st(S.d74, (c) => { LOG.push(["d74", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.d78, (c) => { LOG.push(["d78", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.d7c, (c) => { LOG.push(["d7c", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.dSprite, (c) => { LOG.push(["sprite", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
    st(S.d88, (c) => { LOG.push(["d88", c.reg(4) | 0]); return 0; });
    st(S.d8c, (c) => { LOG.push(["d8c", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    st(S.d94, (c) => { LOG.push(["d94", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    for (const [slot, arity] of Object.entries(METHOD_ARITY)) {
        st(S.methodBase + Number(slot), (c) => {
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, Number(slot), ...args]);
            return 0;
        });
    }
    for (const [slot, arity] of Object.entries(ICON_ARITY)) {
        st(S.iconBase + Number(slot), (c) => {
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, Number(slot), ...args]);
            return 0;
        });
    }
    st(S.rand, () => { const v = next() & 0x7fff; LOG.push(["rand", v]); return v; });
    rt.mem.write32(0x8004dc0c, S.rand);
    rt.mem.write32(0x8004b7d0 + 0x3f4, S.padPressed);
    rt.mem.write32(0x8004b7d0 + 0x3f8, S.padHeld);
    rt.mem.write32(0x8004b7d0 + 0x3fc, S.padRepeat);
    rt.mem.write32(0x8004b7d0 + 0x408, S.padBit);
    rt.mem.write32(0x80055c48, S.sound);
    rt.mem.write32(0x80044b38 + 0x424, S.pack);
    rt.mem.write32(0x80044b38 + 0x414, S.bank);
    rt.mem.write32(0x8004de10 + 0x188, S.frame);
    for (const [addr, fnStub] of Object.entries(tables)) rt.mem.write32(Number(addr), fnStub);

    /** The port-side host: the same calls, logged in the same shape. */
    const host = (extra = {}) => ({
        alloc(h, s, e) { LOG.push(["alloc", h | 0, s, e]); return CTL.alloc; },
        createWidget(layer, kind, x, y) {
            LOG.push(["widget", layer << 16 >> 16, kind | 0, x, y]);
            return widgetAt(CTL.widgetN++);
        },
        createIcon(layer, order, x, y) {
            LOG.push(["icon", layer << 16 >> 16, order | 0, x, y]);
            return iconAt(CTL.iconN++);
        },
        createText(layer, kind, x, y) {
            LOG.push(["widget", layer << 16 >> 16, kind | 0, x, y]);
            return widgetAt(CTL.widgetN++);
        },
        foldStart(f, open) { LOG.push(["foldStart", f | 0, open | 0]); },
        foldTick(f) { LOG.push(["foldTick", f | 0]); return next() & 1; },
        rand() { const v = next() & 0x7fff; LOG.push(["rand", v]); return v; },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
        padPressed(n) { const v = CTL.pad.pressed; LOG.push(["pressed", n, v]); return v; },
        padHeld(n) { const v = CTL.pad.held; LOG.push(["held", n, v]); return v; },
        padRepeat(n) { const v = CTL.pad.repeat; LOG.push(["repeat", n, v]); return v; },
        padBit(pad, code) { LOG.push(["bit", pad | 0, code | 0]); return code | 0; },
        playSound(id) { LOG.push(["sound", id >>> 0]); },
        packHandle(id) { LOG.push(["pack", id >>> 0]); return 0x1234; },
        languageBank(id) { LOG.push(["bank", id | 0]); return 0x5678; },
        frameCount() { LOG.push(["frame", CTL.frame]); return CTL.frame; },
        drawInit() { LOG.push(["drawInit"]); },
        draw74(a, b) { LOG.push(["d74", a | 0, b | 0]); },
        draw78(a, b) { LOG.push(["d78", a | 0, b | 0]); },
        draw7C(a, b) { LOG.push(["d7c", a | 0, b | 0]); },
        drawSprite(h, c, x, y) { LOG.push(["sprite", h | 0, c | 0, x | 0, y | 0]); },
        draw88(n) { LOG.push(["d88", n | 0]); },
        draw8C(a, b, c) { LOG.push(["d8c", a | 0, b | 0, c | 0]); },
        draw94(a, b) { LOG.push(["d94", a | 0, b | 0]); },
        ...extra,
    });

    const reset = (seed = 7) => {
        CTL.widgetN = 0; CTL.iconN = 0; RNG.s = seed; LOG.length = 0;
    };

    /**
     * Run the original, then the port, from the same starting memory, and compare
     * the call logs and the words in each `ranges` entry ([start, byteLength]).
     */
    const compare = (name, seedFn, ranges, runOriginal, runPort) => {
        const snap = () => {
            const out = [];
            for (const [start, length] of ranges) {
                for (let i = 0; i < length; i += 4) out.push(rt.mem.read32(start + i) >>> 0);
            }
            return out;
        };
        seedFn(); LOG.length = 0; runOriginal();
        const olog = LOG.slice(); const osnap = snap();
        seedFn(); LOG.length = 0; runPort();
        assert.deepEqual(LOG, olog, `${name}: calls`);
        assert.deepEqual(snap(), osnap, `${name}: memory`);
        return { log: olog, snap: osnap };
    };

    return { rt, LOG, CTL, S, RNG, next, host, widgetAt, iconAt, reset, compare };
}
