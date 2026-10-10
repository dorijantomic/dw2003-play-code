// Oracle: engine/dw3/ui/duel-view-methods.ts and the new bodies in
// engine/dw3/ui/duel-board-view.ts must reproduce the board view's panel,
// highlight and card-motion methods from pro/cardgame:
//   F0x8009C2D0 slideBothPanelsIn    (view+0xEC8)
//   F0x8009C350 slideBothPanelsOut   (view+0xEC4)
//   F0x8009CC4C setHudHighlights     (view+0xEB8)
//   F0x8009C9A0 cardStartMoveWithSfx (view+0xF08)
//   F0x8009C904 setCardScaleEndpoints(view+0xF20)
//   F0x8009CE28 cardStartSettle      (view+0xF1C)
// plus the deal ceremony's directly-called per-row counter step
//   F0x8008D854 settleRowCard
//
// The original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin. The panel/highlight/motion methods are self-contained: they
// reach only the overlay bodies F0x8009C898 (the slot tween core) and
// F0x8009C960 (the card-move core) by direct `jal`, so those execute for real.
// The only external services are the packed-sound cell [0x80055C48], the card-
// record cursor (F0x8001EBF8 + its +0x2C method) and the view's HUD counter slot
// view+0xEA0, which are stubbed. Both sides see identical seeds; the whole
// view/duel spans and the ordered sound/select log are compared.
//
// Every stored field is seeded to nonzero garbage so a store to the wrong slot
// diverges, the HUD mask is swept over single bits and mixtures, and the record
// byte settleRowCard branches on is swept across the in-range and out-of-range
// edges. Two mutants (a swapped panel mode byte, a skipped counter increment)
// must diverge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    slideBothPanelsIn, slideBothPanelsOut, setHudHighlights, settleRowCard,
    SLIDE_PANELS_IN_STORES, SLIDE_PANELS_OUT_STORES, HUD_HIGHLIGHT_BYTES,
} from "../engine/dw3/ui/duel-view-methods.ts";
import {
    cardStartMoveWithSfx, setCardScaleEndpoints, cardStartSettle,
} from "../engine/dw3/ui/duel-board-view.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const D = 0x80194000;   // the duel
const V = 0x80190000;   // the board view
const CURSOR = 0x80198000;
const METHOD = 0x80198040;
const RECORD = 0x80196000;

const PANEL_IN = 0x8009c2d0;
const PANEL_OUT = 0x8009c350;
const HIGHLIGHTS = 0x8009cc4c;
const MOVE_SFX = 0x8009c9a0;
const SCALE_ENDS = 0x8009c904;
const SETTLE = 0x8009ce28;
const ROW_STEP = 0x8008d854;

const CELL_SOUND = 0x80055c48;
const STUB_SOUND = 0x80100040;
const SLOT_HUD = 0x80100050;   // view+0xEA0 written by settleRowCard

const VIEW_SPAN = [0x40, 0x480];
const DUEL_SPAN = [0x40, 0x760];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function seedCommon(rt) {
    for (let o = V + VIEW_SPAN[0]; o < V + VIEW_SPAN[1]; o++) rt.mem.write8(o, 0xa5);
    for (let o = D + DUEL_SPAN[0]; o < D + DUEL_SPAN[1]; o++) rt.mem.write8(o, 0x5a);
    rt.mem.write32(V + 0xea0, SLOT_HUD);
    rt.mem.write32(CELL_SOUND, STUB_SOUND);
}

const viewBytes = (mem) => {
    const out = [];
    for (let a = VIEW_SPAN[0]; a < VIEW_SPAN[1]; a++) out.push(mem.read8(V + a) & 0xff);
    return out;
};
const duelBytes = (mem) => {
    const out = [];
    for (let a = DUEL_SPAN[0]; a < DUEL_SPAN[1]; a++) out.push(mem.read8(D + a) & 0xff);
    return out;
};

const soundHost = (ev) => ({ playPackedSound: (id) => ev.push(["sound", id >>> 0]) });

function installStubs(rt, ev) {
    rt.cpu.setStub(STUB_SOUND, (c) => { ev.push(["sound", c.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(SLOT_HUD, (c) => { ev.push(["hud", c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
}

/** Stub the card-record cursor the way the effect-VM oracle does. */
function installCursor(rt, ev) {
    let frame = 0;
    rt.cpu.setStub(0x8001ebf8, (c) => {
        frame = c.reg(4) >>> 0;
        ev.push(["cursorCreate"]);
        rt.mem.write32(frame + 0x00, RECORD);
        rt.mem.write32(frame + 0x2c, METHOD);
        return 0;
    });
    rt.cpu.setStub(METHOD, (c) => {
        ev.push(["cursorSelect", c.reg(4) | 0]);
        rt.mem.write32(frame + 0x00, RECORD);
        return 0;
    });
}

/** Run the original around one call and snapshot. The two 5-arg methods read
 *  their last argument from the callee frame at sp+0x10. */
function runOriginal(addr, args, ev, extra = () => {}) {
    const rt = runtime();
    seedCommon(rt);
    installStubs(rt, ev);
    if (addr === ROW_STEP) installCursor(rt, ev);
    extra(rt);
    if (args.length > 4) rt.mem.write32(rt.cpu.sp + 0x10, args[4] | 0);
    const ret = rt.cpu.call(addr, args.slice(0, 4));
    return { mem: rt.mem, ret };
}

test("the panel-slide and highlight store sets are the immediates the routines write", () => {
    const rd = (addr) => (overlay[addr - 0x80082cb0] | (overlay[addr - 0x80082cb0 + 1] << 8)
        | (overlay[addr - 0x80082cb0 + 2] << 16) | (overlay[addr - 0x80082cb0 + 3] << 24)) >>> 0;
    /** Walk a routine from its start (through the jr delay slot), tracking the
     *  immediate each register holds, and collect every `sh rt, off($a0)` store. */
    function halfwordStores(addr) {
        const regs = new Map();
        const out = [];
        for (let pc = addr; pc < addr + 0x400; pc += 4) {
            const w = rd(pc);
            const op = w >>> 26, rs = (w >>> 21) & 0x1f, rt = (w >>> 16) & 0x1f, imm = w & 0xffff;
            if (op === 0x09 && rs === 0) regs.set(rt, (imm << 16) >> 16);          // addiu rt, zero, imm
            else if (op === 0x0f) regs.set(rt, (imm << 16) | (regs.get(rt) ?? 0)); // lui
            else if (op === 0x0d) regs.set(rt, (regs.get(rt) ?? 0) | imm);         // ori
            else if (op === 0x29 && rs === 4) { // sh rt, imm($a0)
                out.push([imm, (regs.get(rt) ?? 0) & 0xffff]);
            }
            if (w === 0x03e00008) { // jr $ra — the next word is its delay slot
                const d = rd(pc + 4);
                if ((d >>> 26) === 0x29 && ((d >>> 21) & 0x1f) === 4) {
                    out.push([d & 0xffff, (regs.get((d >>> 16) & 0x1f) ?? 0) & 0xffff]);
                }
                break;
            }
        }
        return new Map(out);
    }
    const inStores = halfwordStores(PANEL_IN);
    const outStores = halfwordStores(PANEL_OUT);
    for (const [off, value] of SLIDE_PANELS_IN_STORES) {
        assert.equal(inStores.get(off), value & 0xffff, `panels-in store view+0x${off.toString(16)}`);
    }
    for (const [off, value] of SLIDE_PANELS_OUT_STORES) {
        assert.equal(outStores.get(off), value & 0xffff, `panels-out store view+0x${off.toString(16)}`);
    }
    assert.equal(SLIDE_PANELS_IN_STORES.find(([o]) => o === 0xb8)?.[1], 1);
    assert.equal(SLIDE_PANELS_OUT_STORES.find(([o]) => o === 0x64)?.[1], 3);

    // the highlight routine: 20 bit tests — 16 `andi v0,$a1,bit`, then four
    // `lui v0,hi` + `and v0,$a1,v0` — each answered by a `sb v0,off($a0)`.
    const bits = [];
    const offs = [];
    let lastLui = 0;
    for (let pc = HIGHLIGHTS; pc < HIGHLIGHTS + 0x300; pc += 4) {
        const w = rd(pc);
        const op = w >>> 26, rs = (w >>> 21) & 0x1f, rt = (w >>> 16) & 0x1f, rdd = (w >>> 11) & 0x1f;
        if (op === 0x0f && rt === 2) lastLui = ((w & 0xffff) << 16) >>> 0;        // lui v0, hi
        else if (op === 0x0c && rs === 5 && rt === 2) bits.push(w & 0xffff);      // andi v0, $a1, bit
        else if (op === 0x00 && (w & 0x3f) === 0x24 && rs === 5 && rt === 2 && rdd === 2) bits.push(lastLui); // and v0,$a1,v0
        else if (op === 0x28 && rs === 4 && rt === 2) offs.push(w & 0xffff);      // sb v0, off($a0)
        if (w === 0x03e00008) break;
    }
    assert.equal(bits.length, HUD_HIGHLIGHT_BYTES.length);
    assert.equal(offs.length, HUD_HIGHLIGHT_BYTES.length);
    for (let i = 0; i < HUD_HIGHLIGHT_BYTES.length; i++) {
        assert.deepEqual([bits[i], offs[i]], [HUD_HIGHLIGHT_BYTES[i][0], HUD_HIGHLIGHT_BYTES[i][1]], `highlight ${i}`);
    }
});

test("the six self-contained methods match the overlay byte for byte", () => {
    const CASES = [
        { name: "panels in", addr: PANEL_IN, args: [V], port: (m, ev) => slideBothPanelsIn(m, V) },
        { name: "panels out", addr: PANEL_OUT, args: [V], port: (m, ev) => slideBothPanelsOut(m, V) },
        { name: "highlights 0x1", addr: HIGHLIGHTS, args: [V, 0x1], port: (m) => setHudHighlights(m, V, 0x1) },
        { name: "highlights 0x4000", addr: HIGHLIGHTS, args: [V, 0x4000], port: (m) => setHudHighlights(m, V, 0x4000) },
        { name: "highlights 0x20000", addr: HIGHLIGHTS, args: [V, 0x20000], port: (m) => setHudHighlights(m, V, 0x20000) },
        { name: "highlights mixed 0x15555", addr: HIGHLIGHTS, args: [V, 0x15555], port: (m) => setHudHighlights(m, V, 0x15555) },
        { name: "highlights all 0xfffff", addr: HIGHLIGHTS, args: [V, 0xfffff], port: (m) => setHudHighlights(m, V, 0xfffff) },
        { name: "highlights none 0", addr: HIGHLIGHTS, args: [V, 0], port: (m) => setHudHighlights(m, V, 0) },
        { name: "move sfx slot 0", addr: MOVE_SFX, args: [V, 0, 0x14, 0x7400, 0x6100], port: (m, ev) => cardStartMoveWithSfx(m, soundHost(ev), V, 0, 0x14, 0x7400, 0x6100) },
        { name: "move sfx slot 11", addr: MOVE_SFX, args: [V, 11, 0x2a, 0x100, -0x40], port: (m, ev) => cardStartMoveWithSfx(m, soundHost(ev), V, 11, 0x2a, 0x100, -0x40) },
        { name: "scale ends slot 3", addr: SCALE_ENDS, args: [V, 3, 0x1000, 0x800], port: (m) => setCardScaleEndpoints(m, V, 3, 0x1000, 0x800) },
        { name: "scale ends slot 0", addr: SCALE_ENDS, args: [V, 0, 0xc00, 0x1400], port: (m) => setCardScaleEndpoints(m, V, 0, 0xc00, 0x1400) },
        { name: "settle slot 5", addr: SETTLE, args: [V, 5], port: (m, ev) => cardStartSettle(m, soundHost(ev), V, 5) },
    ];
    for (const c of CASES) {
        const evA = [];
        const a = runOriginal(c.addr, c.args, evA);
        const b = runtime(); seedCommon(b);
        const evB = []; installStubs(b, evB);
        c.port(b.mem, evB);
        assert.deepEqual(viewBytes(b.mem), viewBytes(a.mem), `${c.name} view`);
        assert.deepEqual(evB, evA, `${c.name} log`);
    }
});

test("settleRowCard matches F0x8008D854 across the record byte and both rows", () => {
    const seedRows = (mem, row0, row1) => {
        for (let i = -1; i < 5; i++) {
            mem.write8(D + 0 * 0xc8 + 0x5a8 + i, row0);
            mem.write8(D + 1 * 0xc8 + 0x5a8 + i, row1);
        }
    };
    const CASES = [];
    for (const recByte of [0, 1, 3, 5, 6, 0x40]) {
        for (const side of [0, 1]) {
            CASES.push({ name: `record ${recByte} side ${side}`, recByte, side, value: 2, row0: 0x11, row1: 0x22, id: 0x0301 });
        }
    }
    CASES.push({ name: "row byte at the 0x63 cap", recByte: 3, side: 0, value: 4, row0: 0x63, row1: 0, id: 0x0102 });

    for (const c of CASES) {
        const evA = [];
        const a = runOriginal(ROW_STEP, [D, V, c.side, c.value], evA, (rt) => {
            rt.mem.write8(RECORD, c.recByte);
            rt.mem.write16(D + c.value * 2 + 0x50, c.id & 0xffff);
            seedRows(rt.mem, c.row0, c.row1);
        });

        const b = runtime(); seedCommon(b);
        const evB = [];
        b.mem.write8(RECORD, c.recByte);
        b.mem.write16(D + c.value * 2 + 0x50, c.id & 0xffff);
        seedRows(b.mem, c.row0, c.row1);
        const retB = settleRowCard(b.mem, {
            cardCursorScratch: () => CURSOR,
            cardCursorCreate: () => { evB.push(["cursorCreate"]); b.mem.write32(CURSOR + 0x2c, METHOD); },
            cardRecordSelect: (_s, id) => { evB.push(["cursorSelect", id | 0]); b.mem.write32(CURSOR, RECORD); },
            setHudCounter: (view, side, index, value) => evB.push(["hud", side | 0, index | 0, value | 0]),
        }, D, V, c.side, c.value);

        assert.deepEqual(duelBytes(b.mem), duelBytes(a.mem), `${c.name} duel`);
        assert.deepEqual(evB, evA, `${c.name} log`);
        assert.equal(retB, a.ret, `${c.name} return`);
    }
});

test("mutants diverge: a swapped panel mode byte and a skipped counter increment", () => {
    // mutant 1: slideBothPanelsIn writes panel 1's mode byte as 0x14 (panel 0's timer).
    const a = runOriginal(PANEL_IN, [V], []);
    const b = runtime(); seedCommon(b);
    for (const [off, value] of SLIDE_PANELS_IN_STORES) {
        const v = off === 0xb8 ? 0x14 : value;   // WRONG
        b.mem.write16(V + off, v & 0xffff);
    }
    assert.notDeepEqual(viewBytes(b.mem), viewBytes(a.mem), "the swapped panel state must diverge");
    assert.equal(a.mem.read16(V + 0xb8) & 0xffff, 1, "the real routine arms panel 1 at mode 1");

    // mutant 2: settleRowCard never bumps the row counter (it still pushes the HUD value).
    const c = { recByte: 3, side: 0, value: 2, row0: 0x11, id: 0x0301 }; // recByte 3 -> idx 2 -> cell 0x5A8+2
    const seedOne = (mem) => {
        mem.write8(RECORD, c.recByte);
        mem.write16(D + c.value * 2 + 0x50, c.id);
        for (let i = -1; i < 5; i++) {
            mem.write8(D + 0 * 0xc8 + 0x5a8 + i, c.row0);
            mem.write8(D + 1 * 0xc8 + 0x5a8 + i, c.row0);
        }
    };
    const mkHost = (mem, bump) => ({
        cardCursorScratch: () => CURSOR,
        cardCursorCreate: () => mem.write32(CURSOR + 0x2c, METHOD),
        cardRecordSelect: () => mem.write32(CURSOR, RECORD),
        setHudCounter: (_v, _s, _i, val) => { if (bump) mem.write8(D + 0x7ff, val & 0xff); },
    });
    const a2 = runOriginal(ROW_STEP, [D, V, c.side, c.value], [], (rt) => seedOne(rt.mem));
    const b2 = runtime(); seedCommon(b2); seedOne(b2.mem);
    settleRowCard(b2.mem, mkHost(b2.mem, true), D, V, c.side, c.value);
    assert.deepEqual(duelBytes(b2.mem), duelBytes(a2.mem), "the real body matches the original");

    const b3 = runtime(); seedCommon(b3); seedOne(b3.mem);
    // the mutant: same cursor walk, but no increment — it pushes the un-bumped byte.
    b3.mem.write32(CURSOR + 0x2c, METHOD);
    b3.mem.write32(CURSOR, RECORD);
    const idx = (b3.mem.read8(RECORD) & 0xff) - 1;
    const cell = D + 0x5a8 + idx + c.side * 0xc8;
    b3.mem.write8(D + 0x7ff, b3.mem.read8(cell) & 0xff);

    assert.equal(a2.mem.read8(D + 0x5a8 + 2), 0x12, "the real routine bumps row 0 by one");
    assert.equal(b3.mem.read8(D + 0x5a8 + 2), 0x11, "the mutant left it at its seed");
    assert.notEqual(b3.mem.read8(D + 0x5a8 + 2), a2.mem.read8(D + 0x5a8 + 2), "the skipped increment diverges");
});
