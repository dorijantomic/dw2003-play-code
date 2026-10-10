// Oracle: engine/dw3/ui/native/pause-card-folders.ts against the original pro/ststatus
// CARD FOLDERS page bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import {
    cardFoldersChoice, cardFoldersCtor, cardFoldersDraw, cardFoldersFactory, cardFoldersRoot, cardFoldersTick,
} from "../../engine/dw3/ui/native/pause-card-folders.ts";
import { buildEffectiveStats } from "../../engine/dw3/effective-stats.ts";
import { itemRecord } from "../../engine/dw3/item-record.ts";
import { partyPositionToRosterSlot, persistentRosterSlot } from "../../engine/dw3/party-context.ts";

const F_START = 0x0fe20010, F_TICK = 0x0fe20014;
const FADE_FACTORY = 0x80084f10;
let h;
h = createHarness({
    overlayFile: "pro_ststatus.bin",
    functions: {
        foldStart: { address: F_START, args: [0, 0] },
        foldTick: { address: F_TICK, args: [0], result: () => h.next() & 1 },
        fadeFactory: { address: FADE_FACTORY, args: [], result: () => FADE },
    },
    tables: { 0x8009b5d8: F_START, 0x8009b5dc: F_TICK },
});
const CTX = 0x80048d34;
const OBJ = 0x80150000, UI = 0x80154000, SCRATCH = 0x80159000, FADE = 0x80153800;
const LANG = 0x8005cca8;
const bit = (n) => 1 << n;

h.rt.cpu.setStub(0x0fe20080, (c) => { h.LOG.push(["method", c.reg(4) | 0, 0x64, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
h.rt.cpu.setStub(0x0fe20084, (c) => { h.LOG.push(["changeScreen", c.reg(4) | 0, c.reg(5) | 0]); return 0; });

const seed = (c = {}) => () => {
    const m = h.rt.mem;
    for (let i = 0; i < 0xd8; i += 4) m.write32(OBJ + i, 0);
    for (let i = 0; i < 0xa0; i += 4) m.write32(UI + i, 0);
    for (let i = 0; i < 0x70; i += 4) m.write32(FADE + i, 0);
    m.write32(LANG, c.lang ?? 2);
    for (let i = 0; i < 3; i++) m.write32(CTX + 0x70 + i * 4, c.map?.[i] ?? i);
    for (let slot = 0; slot < 3; slot++) {
        const rec = 0x8004949c + slot * 0x3dc;
        for (let k = 0; k < 0x2c; k += 2) m.write16(rec + 0x1c + k, (slot * 31 + k * 5) & 0x3ff);
        m.write32(0x80049494 + slot * 0x3dc, slot + 3);
    }
    const set = (o, v) => m.write32(OBJ + o, v | 0);
    set(0xc, c.state ?? 1); set(0x10, c.sub ?? 0); set(0x14, c.mode ?? 0); set(0x20, c.slots ?? 40); set(0x24, UI); set(0x50, 0x80170000);
    set(0x54, 0x1000); set(0x58, 6); set(0x5c, c.size ?? 3);
    for (let i = 0; i < 3; i++) set(0x60 + i * 4, c.frames?.[i] ?? i);
    set(0x6c, c.t6c ?? 90); set(0x70, c.choice ?? 0);
    for (const [k, off] of [0x7c, 0x8c, 0x9c, 0xac, 0xbc, 0xcc].entries()) set(off, c.folds?.[k] ?? 0x1000);
    set(0x2c, h.S.methodBase + 0x2c); set(0x28, h.S.methodBase + 0x28); set(0x38, h.S.methodBase + 0x38);
    m.write32(FADE + 0x28, h.S.methodBase + 0x28);
    m.write32(FADE + 0x64, 0x0fe20080);
    m.write32(FADE + 0xc, c.fadeState ?? 0);
    m.write32(0x8004b440, 0x0fe20084);
    h.CTL.alloc = OBJ;
    h.reset(c.rseed ?? 3);
    for (let i = 0; i < 0x98; i += 4) m.write32(UI + i, h.widgetAt(8 + i / 4));
    m.write32(UI + 0x98, h.iconAt(0));
    m.write32(UI + 0x9c, c.fade ? FADE : 0);
    h.CTL.pad = c.pad ?? { pressed: 0, held: 0, repeat: 0 };
    h.CTL.frame = c.frame ?? 130;
};
const RANGES = [[OBJ, 0xd8], [UI, 0xa0], [CTX + 0x70, 12], [FADE, 0x70]];
const host = () => {
    const base = h.host();
    const mem = h.rt.mem;
    return {
        ...base, scratch: () => SCRATCH,
        dimQuadFactory: () => { h.LOG.push(["fadeFactory"]); return FADE; },
        changeScreen: (id, arg) => { h.LOG.push(["changeScreen", id | 0, arg | 0]); },
        cards: {
            rosterSlot: (r) => partyPositionToRosterSlot(mem, r),
            copyStats: (slot, dest) => buildEffectiveStats(mem, { definitionRecord: (k) => itemRecord(k) }, slot, dest),
            cardRecord: (slot) => persistentRosterSlot(slot),
            resolveText: (off) => base.languageBank((mem.read32(LANG) | 0) + off),
            widgetSetLine0: (w, src, i) => base.callMethod(w, 0x114, [src, i]),
            widgetSetLineNumber: (w, l, v) => base.callMethod(w, 0x118, [l, v]),
            widgetSetFlagC1: (w, v) => base.callMethod(w, 0x144, [v]),
            widgetMeasure: (w, v) => base.callMethod(w, 0x148, [v]),
        },
    };
};
const original = (address, args, budget = 900000) => () => h.rt.cpu.call(address, args, budget);

test("card folders factory, constructor and choice match", () => {
    h.compare("factory", seed(), RANGES, original(0x80084c48, [0x80170000], 20000),
        () => cardFoldersFactory(h.rt.mem, 0x80170000, host()));
    for (const slots of [40, 38, 3, 2, 0]) {
        h.compare(`ctor ${slots}`, seed({ slots }), RANGES, original(0x80083680, [OBJ, UI], 200000),
            () => cardFoldersCtor(h.rt.mem, OBJ, UI, host()));
    }
    for (const show of [0, 1]) {
        h.compare(`choice ${show}`, seed(), RANGES, original(0x80083b58, [OBJ, UI, show]),
            () => cardFoldersChoice(h.rt.mem, UI, show, host()));
    }
});

const pads = [
    {}, { pressed: bit(4) }, { pressed: bit(6) }, { repeat: bit(4) }, { repeat: bit(6) },
    { pressed: bit(0xd) }, { pressed: bit(0xe) }, { pressed: bit(4) | bit(0xd) }, { pressed: bit(6) | bit(0xd) },
];
const SUBS = [0, 1, 2, 3, 4, 5, 6, 7, 0xa, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x64, 0x65, 0x66, 0x60];

test("card folders tick matches in every sub-state", () => {
    const seen = new Set();
    for (const sub of SUBS) {
        for (const size of [1, 2, 3]) {
            for (const p of pads) {
                for (const v of [0, 1, 2]) {
                    const c = {
                        sub, size, choice: v & 1, mode: v, fade: v !== 1 || sub === 0x65 || sub === 0x66, fadeState: v === 2 ? 2 : 1, rseed: 2 + v,
                        pad: { pressed: 0, held: 0, repeat: 0, ...p },
                    };
                    const r = h.compare(`tick sub${sub.toString(16)} n${size} v${v} ${JSON.stringify(p)}`, seed(c), RANGES,
                        original(0x80084238, [OBJ, UI], 1500000), () => cardFoldersTick(h.rt.mem, OBJ, UI, host()));
                    seen.add(r.snap[0x10 / 4]);
                }
            }
        }
    }
    assert.ok(seen.size >= 14, `reached ${seen.size} next states`);
});

test("card folders draw and root match", () => {
    for (const size of [1, 2, 3]) {
        for (const folds of [Array(6).fill(0x1000), Array(6).fill(0), Array(6).fill(0x400), [0x1000, 0x600, 0, 0x300, 0x1000, 0x800], [0x200, 0x1000, 0x1000, 0, 0x500, 0x1000]]) {
            for (const frame of [100, 108, 140]) {
                const c = { size, folds, frame, t6c: 100 };
                h.compare(`draw n${size} ${folds} f${frame}`, seed(c), RANGES, original(0x80083c94, [OBJ], 900000),
                    () => cardFoldersDraw(h.rt.mem, OBJ, host()));
            }
        }
    }
    for (const state of [0, 1, 2, 3, 4, 9]) {
        for (const map of [[0, 1, 2], [0, -1, -1], [0, 1, -1]]) {
            h.compare(`root s${state} ${map}`, seed({ state, map, sub: 0x60 }), RANGES,
                original(0x80084a98, [OBJ, UI], 1200000), () => cardFoldersRoot(h.rt.mem, OBJ, UI, host()));
        }
    }
});
