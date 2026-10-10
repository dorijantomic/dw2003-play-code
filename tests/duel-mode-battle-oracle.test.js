// Oracle: engine/dw3/ui/duel-mode-battle.ts must reproduce pro/cardgame's three
// remaining mode updates, read from the overlay ASSEMBLY:
//   F0x8009FDD8 mode-5/7 update (Battle Phase)  — 19-arm table D0x80083910
//   F0x800A0B80 mode-6 update                   — 6-arm table D0x80083978
//   F0x800A0F94 mode-8 update (Set-End Phase)   — 27-arm table D0x80083990
//
// The original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin. Every edge the three updates drive is a recording stub on BOTH
// sides: the eight board-view method slots (view+0xEC8/+0xEAC/+0xEB0/+0xEE4/
// +0xEE8/+0xEA0/+0xED0/+0xED4), the mode-5/7 services (F0x8009D8FC, F0x800A4978,
// F0x8009F998, F0x8009FB18, F0x8009DEC4), the duel's +0x814 sort and +0x818
// method pointers, mode-6's F0x800A09FC / F0x800A0ACC, mode-8's F0x800A0CD4 /
// F0x800A367C and the score widget's +0x68/+0x6C method slots, the shared input
// port (pad block +0x3F4 / +0x408), the packed-sound cell [0x80055C48] and the
// frame-delta cell [0x8005DF9C]. The whole duel and view spans, the ordered call
// log and the return value are compared; two mutants must diverge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    updateDuelModeFiveSeven, updateDuelModeSix, updateDuelModeEight,
    BATTLE_57_TABLE, BATTLE_57_ARMS, BATTLE_MODE6_TABLE, BATTLE_MODE6_ARMS,
    BATTLE_MODE8_TABLE, BATTLE_MODE8_ARMS, BATTLE_NEXT_TABLE_ADDR, BATTLE_NEXT_BYTES,
} from "../engine/dw3/ui/duel-mode-battle.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const UPDATE_57 = 0x8009fdd8;
const UPDATE_6 = 0x800a0b80;
const UPDATE_8 = 0x800a0f94;
const D = 0x80194000;
const V = 0x80190000;
const SCENE = 0x80195000;

const OVERLAY_BASE = 0x80082cb0;
const word = (a) => (overlay[a - OVERLAY_BASE] | (overlay[a - OVERLAY_BASE + 1] << 8)
    | (overlay[a - OVERLAY_BASE + 2] << 16) | (overlay[a - OVERLAY_BASE + 3] << 24)) >>> 0;

// ---- the stub sites ---------------------------------------------------------
const S = {
    sortAiHand: 0x80140000, aiChoose: 0x80140010, commit: 0x80140020,
    mark: 0x80140030, wait: 0x80140040, mega: 0x80140050, recompute: 0x80140060,
    combo: 0x80140070, widgetCtor: 0x80140080, widget68: 0x80140090, widget6c: 0x801400a0,
    sortFn: 0x801400b0, method818: 0x801400c0,
    vIn: 0x80140100, vBanner: 0x80140110, vRecord: 0x80140120, vOpen: 0x80140130,
    vClose: 0x80140140, vHud: 0x80140150, vGrow: 0x80140160, vShrink: 0x80140170,
    padReset: 0x80140180, padWord: 0x80140190,
    sound: 0x801401a0, delta: 0x801401b0,
};
const WIDGET = 0x80160000;
const CELL_SOUND = 0x80055c48;
// NOTE: the frame-delta cell is [0x8004DF9C] (resident F0x8001D704), NOT
// [0x8005DF9C] — the same trap the coin-toss tick hit. It holds a function
// pointer, so the test writes a stub address into the cell and stubs it.
const CELL_DELTA = 0x8004df9c;
const PAD_BLOCK = 0x8004b7d0;

// The eight view method slots the three updates reach.
const VIEW_SLOTS = [
    [0x0ec8, S.vIn, "slidePanelsIn"], [0x0eac, S.vBanner, "openInfoBanner"],
    [0x0eb0, S.vRecord, "writeBannerRecord"], [0x0ee4, S.vOpen, "openPrompt"],
    [0x0ee8, S.vClose, "closePrompt"], [0x0ea0, S.vHud, "setHudCounter"],
    [0x0ed0, S.vGrow, "growTurnMarker"], [0x0ed4, S.vShrink, "shrinkTurnMarker"],
];

const DUEL_SPAN = [0x2e0, 0x800];
const VIEW_SPAN = [0x40, 0x180];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, OVERLAY_BASE, {
        image: resident, base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** Seed both runtimes identically from a case. */
function seed(rt, c) {
    for (let a = DUEL_SPAN[0]; a < DUEL_SPAN[1]; a++) rt.mem.write8(D + a, 0);
    for (let a = VIEW_SPAN[0]; a < VIEW_SPAN[1]; a++) rt.mem.write8(V + a, 0);
    rt.mem.write32(SCENE + 0x18, V);
    // duel fields
    const b8 = {
        0x574: c.arm, 0x575: c.counter, 0x576: c.step, 0x577: c.played,
        0x578: c.side, 0x579: c.side2, 0x57a: c.latch, 0x2f5: c.carry,
        0x2f8: c.modeCur, 0x2f4: c.tickArm, 0x421: c.opcode, 0x498: c.gate498,
        0x2f9: c.sub, 0x301: c.award, 0x302: c.outcome, 0x304: c.gate304,
        0x305: c.count305, 0x5ae: c.setCount, 0x676: c.setCount1,
    };
    for (const [off, v] of Object.entries(b8)) rt.mem.write8(D + Number(off), (v ?? 0) & 0xff);
    rt.mem.write32(D + 0x57c, c.timer | 0);
    rt.mem.write32(D + 0x2fc, c.timer8 | 0);
    rt.mem.write16(D + 0x5a6, c.row0Count & 0xffff);
    rt.mem.write16(D + 0x66e, c.row1Count & 0xffff);
    rt.mem.write16(D + 0x59e, c.row0Total & 0xffff);
    rt.mem.write16(D + 0x666, c.row1Total & 0xffff);
    rt.mem.write8(D + 0x72c, c.rowCount & 0xff);
    rt.mem.write8(D + 0x79e, c.rowCount1 & 0xff);
    rt.mem.write32(D + 0x2ec, c.promptArg | 0);
    // view fields
    rt.mem.write16(V + 0x64, c.panel & 0xffff);
    rt.mem.write8(V + 0xe9b, c.bannerState & 0xff);
    rt.mem.write8(V + 0xdfa, c.settleState & 0xff);
    rt.mem.write8(V + 0x104, c.slideSide & 0xff);
    // the method pointers
    for (const [off, target] of VIEW_SLOTS) rt.mem.write32(V + off, target);
    rt.mem.write32(D + 0x814, S.sortFn);
    rt.mem.write32(D + 0x818, S.method818);
    rt.mem.write32(PAD_BLOCK + 0x3f4, S.padReset);
    rt.mem.write32(PAD_BLOCK + 0x408, S.padWord);
    rt.mem.write32(CELL_SOUND, S.sound);
    rt.mem.write32(CELL_DELTA, S.delta);
    rt.mem.write32(WIDGET + 0x68, S.widget68);
    rt.mem.write32(WIDGET + 0x6c, S.widget6c);
}

function installStubs(rt, c, ev) {
    const rec = (name, ...args) => { ev.push([name, ...args.map((v) => v >>> 0)]); };
    // The direct-jal services are stubbed at their REAL overlay addresses, since
    // the original calls them by `jal F0x...` (not through a pointer).
    rt.cpu.setStub(0x8009d8fc, (cc) => { rec("sortAiHand", cc.reg(4)); return 0; });
    rt.cpu.setStub(0x800a4978, (cc) => { rec("aiChoose", cc.reg(4), cc.reg(5)); return c.aiChoose | 0; });
    rt.cpu.setStub(0x8009f998, (cc) => { rec("commit", cc.reg(4), cc.reg(5)); return c.commitClass | 0; });
    rt.cpu.setStub(0x8009fb18, (cc) => { rec("mark", cc.reg(4), cc.reg(5)); return 0; });
    rt.cpu.setStub(0x8009dec4, (cc) => { rec("wait", cc.reg(4), cc.reg(5)); return c.think | 0; });
    rt.cpu.setStub(0x800a09fc, (cc) => { rec("mega", cc.reg(4)); return c.mega | 0; });
    rt.cpu.setStub(0x800a0acc, (cc) => { rec("recompute", cc.reg(4), cc.reg(5)); return 0; });
    rt.cpu.setStub(0x800a0cd4, (cc) => { rec("combo", cc.reg(4), cc.reg(5), cc.reg(6)); return c.combo | 0; });
    rt.cpu.setStub(0x800a367c, (cc) => { rec("widgetCtor", cc.reg(4)); return WIDGET; });
    rt.cpu.setStub(S.widget68, (cc) => { rec("widget68", cc.reg(4), cc.reg(5), cc.reg(6), cc.reg(7)); return 0; });
    rt.cpu.setStub(S.widget6c, (cc) => {
        rec("widget6c", cc.reg(4), cc.reg(5), cc.reg(6), cc.reg(7),
            rt.mem.read32((cc.reg(29) + 0x10) >>> 0), rt.mem.read32((cc.reg(29) + 0x14) >>> 0));
        return 0;
    });
    rt.cpu.setStub(S.sortFn, (cc) => { rec("sortHand", cc.reg(4), cc.reg(5), cc.reg(6), cc.reg(7)); return 0; });
    rt.cpu.setStub(S.method818, (cc) => { rec("method818", cc.reg(4), cc.reg(5)); return 0; });
    rt.cpu.setStub(S.vIn, (cc) => { rec("slidePanelsIn", cc.reg(4)); return 0; });
    rt.cpu.setStub(S.vBanner, (cc) => {
        rec("openInfoBanner", cc.reg(4), cc.reg(5), cc.reg(6), cc.reg(7),
            rt.mem.read32((cc.reg(29) + 0x10) >>> 0), rt.mem.read32((cc.reg(29) + 0x14) >>> 0));
        return 0;
    });
    rt.cpu.setStub(S.vRecord, (cc) => { rec("writeBannerRecord", cc.reg(4), cc.reg(5)); return 0; });
    rt.cpu.setStub(S.vOpen, (cc) => {
        rec("openPrompt", cc.reg(4), cc.reg(5), cc.reg(6), cc.reg(7),
            rt.mem.read32((cc.reg(29) + 0x10) >>> 0));
        return 0;
    });
    rt.cpu.setStub(S.vClose, (cc) => { rec("closePrompt", cc.reg(4)); return 0; });
    rt.cpu.setStub(S.vHud, (cc) => { rec("setHudCounter", cc.reg(4), cc.reg(5), cc.reg(6), cc.reg(7)); return 0; });
    rt.cpu.setStub(S.vGrow, (cc) => { rec("growTurnMarker", cc.reg(4), cc.reg(5)); return 0; });
    rt.cpu.setStub(S.vShrink, (cc) => { rec("shrinkTurnMarker", cc.reg(4), cc.reg(5)); return 0; });
    rt.cpu.setStub(S.padReset, () => c.padReset | 0);
    rt.cpu.setStub(S.padWord, (cc) => { rec("padWord", cc.reg(4), cc.reg(5)); return c.padWord | 0; });
    rt.cpu.setStub(S.sound, (cc) => { rec("sound", cc.reg(4)); return 0; });
    rt.cpu.setStub(S.delta, () => c.delta | 0);
}

/** The port's host: every edge is the matching recording stub. */
function portHost(c, ev) {
    const rec = (name, ...args) => { ev.push([name, ...args.map((v) => v >>> 0)]); };
    return {
        slidePanelsIn: (v) => rec("slidePanelsIn", v),
        openInfoBanner: (v, k, a2, a3, w, h) => rec("openInfoBanner", v, k, a2, a3, w, h),
        writeBannerRecord: (v, k) => rec("writeBannerRecord", v, k),
        openPrompt: (v, a1, a2, a3, a4) => rec("openPrompt", v, a1, a2, a3, a4),
        closePrompt: (v) => rec("closePrompt", v),
        setHudCounter: (v, s, i, val) => rec("setHudCounter", v, s, i, val),
        growTurnMarker: (v, s) => rec("growTurnMarker", v, s),
        shrinkTurnMarker: (v, s) => rec("shrinkTurnMarker", v, s),
        playPackedSound: (id) => rec("sound", id),
        frameDelta: () => c.delta | 0,
        inputPortReset: () => c.padReset | 0,
        inputPortWord: (_p, code) => { rec("padWord", 0, code); return c.padWord | 0; },
        sortAiHand: (duel) => rec("sortAiHand", duel),
        aiChooseCard: (duel, view) => { rec("aiChoose", duel, view); return c.aiChoose | 0; },
        commitSelectedHandCard: (duel, scene) => { rec("commit", duel, scene); return c.commitClass | 0; },
        markLegalFieldTargets: (duel, view) => rec("mark", duel, view),
        waitAiThinkWindow: (duel, scene) => { rec("wait", duel, scene); return c.think | 0; },
        handSelectionSort: (a, b, packed, flags) => rec("sortHand", a, b, packed, flags),
        duelMethod818: (duel, arg) => rec("method818", duel, arg),
        applyDynamicStatMegas: (duel) => { rec("mega", duel); return c.mega | 0; },
        recomputeSideTotals: (duel, side) => rec("recompute", duel, side),
        scanComboRuns: (duel, side, cell) => { rec("combo", duel, side, cell); return c.combo | 0; },
        createScoreWidget: () => { rec("widgetCtor", 1); return WIDGET; },
        scoreWidgetConfigure: (w, a1, a2, a3) => rec("widget68", w, a1, a2, a3),
        scoreWidgetRun: (w, a1, a2, a3, ww, xx) => rec("widget6c", w, a1, a2, a3, ww, xx),
    };
}

function duelBytes(mem) {
    const out = [];
    for (let a = DUEL_SPAN[0]; a < DUEL_SPAN[1]; a++) out.push(mem.read8(D + a) & 0xff);
    return out;
}
function viewBytes(mem) {
    const out = [];
    for (let a = VIEW_SPAN[0]; a < VIEW_SPAN[1]; a++) out.push(mem.read8(V + a) & 0xff);
    return out;
}

const BASE = {
    arm: 0, counter: 0, step: 0, played: 0, side: 0, side2: 0, latch: 0, carry: 0,
    modeCur: 0, tickArm: 0, opcode: 0, gate498: 0, sub: 0, award: 0, outcome: 0,
    gate304: 0, count305: 0, setCount: 0, setCount1: 0, timer: 0, timer8: 0,
    row0Count: 0, row1Count: 0, row0Total: 0, row1Total: 0, rowCount: 0, rowCount1: 0,
    promptArg: 0, panel: 0, bannerState: 0, settleState: 0, slideSide: 0,
    aiChoose: 0, commitClass: 0, think: 0, mega: 0, combo: 0,
    padReset: 0, padWord: 0, delta: 1,
};

const A = (name, over) => ({ ...BASE, ...over, name });

test("the shipped tables and the next-state bytes are the port's constants", () => {
    for (let k = 0; k < BATTLE_57_ARMS.length; k++) assert.equal(word(BATTLE_57_TABLE + 4 * k), BATTLE_57_ARMS[k], `57 arm ${k}`);
    for (let k = 0; k < BATTLE_MODE6_ARMS.length; k++) assert.equal(word(BATTLE_MODE6_TABLE + 4 * k), BATTLE_MODE6_ARMS[k], `6 arm ${k}`);
    for (let k = 0; k < BATTLE_MODE8_ARMS.length; k++) assert.equal(word(BATTLE_MODE8_TABLE + 4 * k), BATTLE_MODE8_ARMS[k], `8 arm ${k}`);
    for (let k = 0; k < BATTLE_NEXT_BYTES.length; k++) {
        assert.equal(overlay[BATTLE_NEXT_TABLE_ADDR - OVERLAY_BASE + k], BATTLE_NEXT_BYTES[k], `next byte ${k}`);
    }
});

const CASES_57 = [
    A("arm 0 copies the carry into both side latches and slides the panels in", { arm: 0, carry: 0x2f5 & 1 }),
    A("arm 0 with a zero carry", { arm: 0, carry: 0 }),
    A("arm 1 with an even counter latches side 0 and fires the HUD", { arm: 1, counter: 0, side: 0 }),
    A("arm 1 with counter 1 and the side flag set", { arm: 1, counter: 1, side: 1 }),
    A("arm 1 with counter 12 on the flagged side", { arm: 1, counter: 12, side: 1 }),
    A("arm 1 with a negative counter", { arm: 1, counter: 0xff, side: 0 }),
    A("arm 2 arms the pick effect opcode", { arm: 2, latch: 0xff }),
    A("arm 2 with the latch handed back (side 0)", { arm: 2, latch: 0, side2: 0, played: 0 }),
    A("arm 2 with the latch handed back, played set, side 1", { arm: 2, latch: 0, side2: 1, played: 1 }),
    A("arm 2 with a stale latch", { arm: 2, latch: 1, side2: 0 }),
    A("arm 3 the AI turn arms the deal opcode", { arm: 3, latch: 0xff, aiChoose: 0, counter: 0 }),
    A("arm 3 the AI turn with the counter set", { arm: 3, latch: 0xff, aiChoose: 0, counter: 1 }),
    A("arm 3 commits a Program card", { arm: 3, latch: 0xff, aiChoose: 1, commitClass: 0x83, played: 1, counter: 1 }),
    A("arm 3 commits a Digimon card", { arm: 3, latch: 0xff, aiChoose: 1, commitClass: 0x84, played: 0, counter: 2 }),
    A("arm 3 commits some other card", { arm: 3, latch: 0xff, aiChoose: 1, commitClass: 0x40, played: 0, counter: 2 }),
    A("arm 4 arms the pick effect opcode", { arm: 4, latch: 0xff }),
    A("arm 4 with the latch handed back (played 0)", { arm: 4, latch: 0, side2: 0, played: 0 }),
    A("arm 5 with the latch handed back (played 1)", { arm: 5, latch: 0, side2: 1, played: 1 }),
    A("arm 5 with a stale latch", { arm: 5, latch: 2, side2: 1 }),
    A("arm 6 the commit arm", { arm: 6, latch: 0xff, commitClass: 0x55 }),
    A("arm 6 stages a card (side 0, counter 1)", { arm: 6, latch: 0, side2: 0, counter: 1, row0Count: 2 }),
    A("arm 7 stages a card (side 1, counter 2)", { arm: 7, latch: 0, side2: 1, counter: 2, row0Count: 3, row1Count: 1 }),
    A("arm 6 with a stale latch", { arm: 6, latch: 3, side2: 0 }),
    A("arm 8 arms the reset effect opcode", { arm: 8 }),
    A("arm 9 arms the other reset effect opcode", { arm: 9 }),
    A("arm 10 flips the side and bumps the counter", { arm: 10, side2: 1, counter: 3 }),
    A("arm 11 ticks the timer down", { arm: 11, timer: 5 }),
    A("arm 11 with the timer at the boundary", { arm: 11, timer: 1 }),
    A("arm 12 advances the carry", { arm: 12, counter: 1 }),
    A("arm 12 with a zero counter", { arm: 12, counter: 0 }),
    A("arm 13 loops back to the pick", { arm: 13 }),
    A("arm 14 flips the sides and steps", { arm: 14, side: 0, step: 0, played: 0 }),
    A("arm 14 with played at 2", { arm: 14, side: 1, step: 1, played: 2 }),
    A("arm 15 shrinks both markers and waits", { arm: 15, think: 0 }),
    A("arm 15 shrinks both markers and settles", { arm: 15, think: 1 }),
    A("arm 16 opens the phase banner", { arm: 16, panel: 2, gate498: 0, modeCur: 5 }),
    A("arm 16 in mode 7 opens the other banner", { arm: 16, panel: 2, gate498: 0, modeCur: 7 }),
    A("arm 16 while the panel is still moving", { arm: 16, panel: 1 }),
    A("arm 16 with the field gate set", { arm: 16, panel: 2, gate498: 1 }),
    A("arm 17 takes the confirm on button D", { arm: 17, bannerState: 2, padReset: 1 << 0xd, padWord: 0xd }),
    A("arm 17 takes the confirm on button E", { arm: 17, bannerState: 2, padReset: 1 << 0xe, padWord: 0xe }),
    A("arm 17 waits with no input", { arm: 17, bannerState: 2, padReset: 0, padWord: 0xd }),
    A("arm 17 before the banner settles", { arm: 17, bannerState: 1 }),
    A("arm 18 returns to the side machine", { arm: 18, bannerState: 0 }),
    A("arm 18 still waiting", { arm: 18, bannerState: 2 }),
    A("an out-of-range arm behaves like arm 0", { arm: 19, carry: 1 }),
];

test("updateDuelModeFiveSeven reproduces F0x8009FDD8 across every arm and branch", () => {
    for (const c of CASES_57) {
        const a = runtime(); seed(a, c); const evA = []; installStubs(a, c, evA);
        const retA = a.cpu.call(UPDATE_57, [D, SCENE]);
        const b = runtime(); seed(b, c); const evB = [];
        const retB = updateDuelModeFiveSeven(b.mem, portHost(c, evB), D, SCENE);
        assert.deepEqual(duelBytes(b.mem), duelBytes(a.mem), `${c.name} duel`);
        assert.deepEqual(viewBytes(b.mem), viewBytes(a.mem), `${c.name} view`);
        assert.deepEqual(evB, evA, `${c.name} calls`);
        assert.equal(retB, retA, `${c.name} return`);
    }
});

const CASES_6 = [
    A("mode 6 arm 0 arms the effect opcode", { sub: 0 }),
    A("mode 6 arm 1 repaints and pushes the side-0 readout", { sub: 1, row0Count: 4 }),
    A("mode 6 arm 2 re-sorts the AI hand", { sub: 2 }),
    A("mode 6 arm 3 applies the megas and pushes the side-1 readout", { sub: 3, mega: 5, row1Count: 7 }),
    A("mode 6 arm 4 arms the last effect opcode", { sub: 4 }),
    A("mode 6 arm 5 returns 1", { sub: 5 }),
    A("mode 6 out of range returns 0", { sub: 6 }),
];

test("updateDuelModeSix reproduces F0x800A0B80 across every arm", () => {
    for (const c of CASES_6) {
        const a = runtime(); seed(a, c); const evA = []; installStubs(a, c, evA);
        const retA = a.cpu.call(UPDATE_6, [D, SCENE]);
        const b = runtime(); seed(b, c); const evB = [];
        const retB = updateDuelModeSix(b.mem, portHost(c, evB), D, SCENE);
        assert.deepEqual(duelBytes(b.mem), duelBytes(a.mem), `${c.name} duel`);
        assert.deepEqual(viewBytes(b.mem), viewBytes(a.mem), `${c.name} view`);
        assert.deepEqual(evB, evA, `${c.name} calls`);
        assert.equal(retB, retA, `${c.name} return`);
    }
});

const CASES_8 = [
    A("mode 8 arm 0 opens the reveal", { sub: 0, panel: 2, gate498: 0 }),
    A("mode 8 arm 0 while the panel moves", { sub: 0, panel: 1 }),
    A("mode 8 arm 1 scans side 0 and keeps waiting", { sub: 1, combo: -1 }),
    A("mode 8 arm 1 scans side 0 and arms opcode 0x19", { sub: 1, combo: 9 }),
    A("mode 8 arm 2 scans side 1 and advances", { sub: 2, combo: -1 }),
    A("mode 8 arm 2 scans side 1 and arms opcode 0x1A", { sub: 2, combo: 3 }),
    A("mode 8 arm 3 waits for the banner", { sub: 3, bannerState: 2 }),
    A("mode 8 arm 3 before the banner settles", { sub: 3, bannerState: 1 }),
    A("mode 8 arm 4 takes the confirm", { sub: 4, padReset: 1 << 0xd, padWord: 0xd }),
    A("mode 8 arm 4 waits", { sub: 4, padReset: 0, padWord: 0xd }),
    A("mode 8 arm 5 returns to the roll", { sub: 5, bannerState: 0 }),
    A("mode 8 arm 6 arms the set banner", { sub: 6 }),
    A("mode 8 arm 7 arms the score banner", { sub: 7 }),
    A("mode 8 arm 8 counts the extra banner down", { sub: 8, gate304: 1, count305: 2 }),
    A("mode 8 arm 8 with the gate clear advances", { sub: 8, gate304: 0, count305: 0 }),
    A("mode 8 arm 9 reveals the losing row", { sub: 9, rowCount: 1, rowCount1: 1 }),
    A("mode 8 arm 9 with empty rows picks the side", { sub: 9, rowCount: 0, rowCount1: 0, row0Total: 5, row1Total: 3 }),
    A("mode 8 arm 9 with a filled losing row waits", { sub: 9, rowCount: 0, rowCount1: 0, row0Total: 3, row1Total: 5, setCount: 1 }),
    A("mode 8 arm 10 arms the award from a side-0 win", { sub: 10, row0Total: 5, row1Total: 3 }),
    A("mode 8 arm 10 arms the award from a side-1 win", { sub: 10, row0Total: 3, row1Total: 5 }),
    A("mode 8 arm 11 rolls the set counter (mid-roll)", { sub: 11, award: 0, timer8: 3, setCount: 1 }),
    A("mode 8 arm 11 on the first tick builds the widget", { sub: 11, award: 0, timer8: 0, setCount: 1 }),
    A("mode 8 arm 11 finishes the roll on side 0", { sub: 11, award: 0, timer8: 0x33, setCount: 2, delta: 1 }),
    A("mode 8 arm 11 finishes the roll on side 1 with a tied set", { sub: 11, award: 1, timer8: 0x32, setCount: 2, row0Total: 4, row1Total: 4, delta: 2 }),
    A("mode 8 arm 11 finishes the roll on side 1 with a won set", { sub: 11, award: 1, timer8: 0x40, setCount: 2, row0Total: 4, row1Total: 6, delta: 1 }),
    A("mode 8 arm 12 waits for the reveal", { sub: 12, row0Total: 5, row1Total: 3, settleState: 2 }),
    A("mode 8 arm 12 advances", { sub: 12, row0Total: 5, row1Total: 3, settleState: 1 }),
    A("mode 8 arm 12 on a tie reads the settle flag", { sub: 12, row0Total: 4, row1Total: 4, settleState: 2 }),
    A("mode 8 arm 13 takes the confirm and closes the prompt", { sub: 13, padReset: 1 << 0xe, padWord: 0xe }),
    A("mode 8 arm 13 takes the confirm and advances the record", { sub: 13, row0Total: 6, row1Total: 4, padReset: 1 << 0xd, padWord: 0xd }),
    A("mode 8 arm 14 opens the score prompt", { sub: 14, settleState: 2, row0Total: 4, row1Total: 4 }),
    A("mode 8 arm 14 before the settle", { sub: 14, settleState: 1, row0Total: 4, row1Total: 4 }),
    A("mode 8 arm 15 waits for the settle", { sub: 15, settleState: 2 }),
    A("mode 8 arm 15 still waiting", { sub: 15, settleState: 1 }),
    A("mode 8 arm 16 takes the confirm", { sub: 16, padReset: 1 << 0xd, padWord: 0xd }),
    A("mode 8 arm 16 waits", { sub: 16, padReset: 0, padWord: 0xd }),
    A("mode 8 arm 17 raises the win banner", { sub: 17, settleState: 0, setCount: 2 }),
    A("mode 8 arm 17 raises the loss banner", { sub: 17, settleState: 0, setCount: 0, setCount1: 2 }),
    A("mode 8 arm 17 waits", { sub: 17, settleState: 0, setCount: 0, setCount1: 0 }),
    A("mode 8 arm 18 arms the closing effect opcode (winner)", { sub: 18, award: 0 }),
    A("mode 8 arm 18 arms the closing effect opcode (loser)", { sub: 18, award: 1 }),
    A("mode 8 arm 19 waits for the banner", { sub: 19, bannerState: 2 }),
    A("mode 8 arm 20 takes the confirm on a won set", { sub: 20, award: 0, padReset: 1 << 0xd, padWord: 0xd }),
    A("mode 8 arm 20 takes the confirm on a lost set", { sub: 20, award: 1, padReset: 1 << 0xe, padWord: 0xe }),
    A("mode 8 arm 21 opens the last prompt", { sub: 21, bannerState: 0, think: 1, promptArg: 0x1234 }),
    A("mode 8 arm 21 waits for the think window", { sub: 21, bannerState: 0, think: 0, promptArg: 0x1234 }),
    A("mode 8 arm 22 waits for the settle", { sub: 22, settleState: 2 }),
    A("mode 8 arm 23 takes the confirm", { sub: 23, padReset: 1 << 0xd, padWord: 0xd }),
    A("mode 8 arm 23 waits", { sub: 23, padReset: 0, padWord: 0xd }),
    A("mode 8 arm 24 is the bare epilogue", { sub: 24 }),
    A("mode 8 arm 25 reports finished", { sub: 25 }),
    A("mode 8 arm 26 reports the next phase", { sub: 26 }),
    A("mode 8 out of range returns 0", { sub: 27 }),
];

test("updateDuelModeEight reproduces F0x800A0F94 across every arm and branch", () => {
    for (const c of CASES_8) {
        const a = runtime(); seed(a, c); const evA = []; installStubs(a, c, evA);
        const retA = a.cpu.call(UPDATE_8, [D, SCENE]);
        const b = runtime(); seed(b, c); const evB = [];
        const retB = updateDuelModeEight(b.mem, portHost(c, evB), D, SCENE);
        assert.deepEqual(duelBytes(b.mem), duelBytes(a.mem), `${c.name} duel`);
        assert.deepEqual(viewBytes(b.mem), viewBytes(a.mem), `${c.name} view`);
        assert.deepEqual(evB, evA, `${c.name} calls`);
        assert.equal(retB, retA, `${c.name} return`);
    }
});

test("mutants: a dropped side readout and a skipped set-counter roll both diverge", () => {
    // mutant 1 (mode 5/7 arm 1): the side-1 HUD readout is never written.
    const c = A("m", { arm: 1, counter: 0, side: 0, row0Count: 3, row1Count: 4 });
    const a = runtime(); seed(a, c); const evA = []; installStubs(a, c, evA); a.cpu.call(UPDATE_57, [D, SCENE]);
    const b = runtime(); seed(b, c); const evB = [];
    const h = portHost(c, evB);
    const orig = h.setHudCounter;
    h.setHudCounter = (v, s, i, val) => { if (s === 1 && i === 6) return; orig(v, s, i, val); };
    updateDuelModeFiveSeven(b.mem, h, D, SCENE);
    assert.notDeepEqual(evB, evA, "the dropped side-1 readout must diverge");

    // mutant 2 (mode 8 arm 11): the winning set counter is never rolled forward.
    const c2 = A("m", { sub: 11, award: 0, timer8: 0x33, setCount: 2, delta: 1 });
    const a2 = runtime(); seed(a2, c2); const evA2 = []; installStubs(a2, c2, evA2); a2.cpu.call(UPDATE_8, [D, SCENE]);
    const b2 = runtime(); seed(b2, c2); const evB2 = [];
    const wrap = {
        read8: (x) => b2.mem.read8(x), read16: (x) => b2.mem.read16(x),
        read16s: (x) => b2.mem.read16s(x), read32: (x) => b2.mem.read32(x),
        write8: (x, v) => { if (x !== D + 0x5ae) b2.mem.write8(x, v); }, // WRONG: skip the roll
        write16: (x, v) => b2.mem.write16(x, v), write32: (x, v) => b2.mem.write32(x, v),
    };
    updateDuelModeEight(wrap, portHost(c2, evB2), D, SCENE);
    assert.notDeepEqual(duelBytes(b2.mem), duelBytes(a2.mem), "skipping the set-counter roll must diverge");
    assert.equal(a2.mem.read8(D + 0x5ae) & 0xff, 3, "the real roll advanced the winner's set counter");
});
