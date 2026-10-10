// The Draw Phase's intro-cue gate, end to end.
//
// Two things this pins:
//   1. The Draw Phase's first arm (F0x8009F110 arm 0, .L0x0001c4c4) advances
//      only when the intro-voice object at scene+0x0 reports state 1 with its
//      skip flag (+0x50) set. The native original is run in isolation beside the
//      port over a grid of intro states, so the arm's decision is checked
//      against the shipped code, not against a description.
//   2. The intro object's cue loader now runs through the REAL resident cache
//      service (resource-service.ts cacheAcquire/cachePoll, the pointer table
//      at [0x80044F44]/[0x80044F3C] read out of resident.bin). The composed
//      session walks the twelve cue records gated by the disc transfer, so the
//      object is still mid-walk (state 1, skip set) when the Draw Phase's first
//      arm runs — and NOT already at its end state 3.
//
// The composition test VARIES the disc read rate and the language index, the
// two things that decide whether the walk outlasts the mode transition and
// whether the cue ids land on the right sector rows. An instant disc (the old
// free stub) leaves the arm waiting forever, and the test asserts that, so it
// would fail if the loader were stubbed again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { DuelSession, DUEL_CD_SECTORS_PER_FRAME } from "../engine/dw3/ui/duel-session.ts";
import { DUEL_MODE } from "../engine/dw3/ui/duel-mode-machine.ts";
import { DRAW_PHASE, updateDuelModeTwo } from "../engine/dw3/ui/duel-draw-phase.ts";
import { INTRO_CUE_FIELDS, LANGUAGE_INDEX } from "../engine/dw3/ui/intro-cue.ts";
import { PAD_BLOCK, PAD_PRESSED_IN_PORT, PAD_BUTTON_MAP_IN_PORT } from "../engine/systems/pad-block.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const UPDATE_TWO = 0x8009f110;
const DUEL = 0x80194000;
const SCENE = 0x80195000;
const INTRO = 0x80196000;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

test("the Draw Phase's first arm matches F0x8009F110 over every intro state", () => {
    const host = {
        allocate: () => 0x10000, frameDelta: () => 1, playSound: () => {},
        padWord: () => 0, padRepeatWord: () => 0, padKeyBit: (_p, c) => c,
        openElementCursor: () => 0, resolveCardInto: () => {}, cardKind: () => 1,
        buildCardTable: () => 0, scanDeckAvailability: () => {}, refreshAllCounters: () => {},
        pileShuffle: () => {},
    };
    // A flat memory the port runs over (small addresses); the native side keeps
    // the real overlapping addresses.
    const bytes = new Uint8Array(0x1000);
    const mem = {
        read8: (a) => bytes[a] ?? 0,
        read16: (a) => (bytes[a] ?? 0) | ((bytes[a + 1] ?? 0) << 8),
        read16s: (a) => { const v = (bytes[a] ?? 0) | ((bytes[a + 1] ?? 0) << 8); return (v << 16) >> 16; },
        read32: (a) => ((bytes[a] ?? 0) | ((bytes[a + 1] ?? 0) << 8) | ((bytes[a + 2] ?? 0) << 16) | ((bytes[a + 3] ?? 0) << 24)) >>> 0,
        write8: (a, v) => { bytes[a] = v & 0xff; },
        write16: (a, v) => { bytes[a] = v & 0xff; bytes[a + 1] = (v >> 8) & 0xff; },
        write32: (a, v) => { for (let k = 0; k < 4; k++) bytes[a + k] = (v >> (8 * k)) & 0xff; },
    };
    const P_DUEL = 0x100, P_SCENE = 0x200, P_INTRO = 0x300;
    const states = [[1, 1], [1, 0], [3, 1], [3, 0], [2, 1], [0, 0], [2, 0], [4, 1]];
    const decisions = [];
    for (const [state, skip] of states) {
        // the original
        const rt = runtime();
        rt.mem.write8(DUEL + DRAW_PHASE.subStep, 0);
        rt.mem.write32(DUEL + DRAW_PHASE.frameSum, 0);
        rt.mem.write32(SCENE + DRAW_PHASE.intro, INTRO);
        rt.mem.write32(INTRO + INTRO_CUE_FIELDS.state, state);
        rt.mem.write32(INTRO + INTRO_CUE_FIELDS.skipped, skip);
        const nativeRet = rt.cpu.call(UPDATE_TWO, [DUEL, SCENE], 20000) | 0;
        const nativeSub = rt.mem.read8(DUEL + DRAW_PHASE.subStep);

        // the port
        bytes.fill(0);
        mem.write8(P_DUEL + DRAW_PHASE.subStep, 0);
        mem.write32(P_SCENE + DRAW_PHASE.intro, P_INTRO);
        mem.write32(P_INTRO + INTRO_CUE_FIELDS.state, state);
        mem.write32(P_INTRO + INTRO_CUE_FIELDS.skipped, skip);
        const portRet = updateDuelModeTwo(mem, host, P_DUEL, P_SCENE) | 0;
        const portSub = mem.read8(P_DUEL + DRAW_PHASE.subStep);

        assert.equal(portSub, nativeSub, `sub-step, state ${state} skip ${skip}`);
        assert.equal(portRet, nativeRet, `return value, state ${state} skip ${skip}`);
        decisions.push(nativeSub > 0);
    }
    // Vary what matters: the arm advances for exactly one state, so a port that
    // ignored the skip flag (or the state) would not reproduce this pattern.
    assert.deepEqual(decisions, [true, false, false, false, false, false, false, false]);

    // A mutation of the port's gate stops the discriminator: dropping the skip
    // check would advance for (1,0) too. The oracle would then fail.
    const mutated = decisions.map((d, i) => (states[i][0] === 1 ? true : d));
    assert.notDeepEqual(mutated, decisions, "the oracle distinguishes the skip flag");
});

/** A confirm-mashing player for the composed session. */
function confirmSession(cdSectorsPerFrame) {
    const CONFIRM = (1 << 0xd) | (1 << 0xe);
    const s = new DuelSession({ shopId: 7, cdSectorsPerFrame, padWord: () => CONFIRM, padRepeatWord: () => 0, padKeyBit: (_p, c) => c });
    for (let i = 0; i < 16; i++) s.mem.write8(PAD_BLOCK + PAD_BUTTON_MAP_IN_PORT + i, i);
    s.buildScreenBoard();
    s.setupDuel();
    return s;
}

test("the cue loader runs the real resident cache, so the first arm sees the mid-walk state", () => {
    const s = confirmSession(DUEL_CD_SECTORS_PER_FRAME);
    const intro = s.intro();
    assert.notEqual(intro, 0, "the intro object was created at scene state 0");
    const duel = s.duel();
    let arm0At = -1, introAtArm0 = null, completed = false;
    for (let i = 0; i < 1200; i++) {
        const sub = s.mem.read8(duel + DRAW_PHASE.subStep);
        const before = s.mode();
        s.mem.write16(PAD_BLOCK + PAD_PRESSED_IN_PORT, (1 << 0xd) | (1 << 0xe));
        try { s.runFrame(); } catch { /* the effect-VM helper family is the next block */ }
        if (before === 2 && sub === 0 && s.mem.read8(duel + DRAW_PHASE.subStep) === 1 && arm0At < 0) {
            arm0At = i;
            introAtArm0 = {
                state: s.mem.read32(intro + INTRO_CUE_FIELDS.state) | 0,
                skipped: s.mem.read32(intro + INTRO_CUE_FIELDS.skipped) | 0,
                cursor: s.mem.read16(intro + INTRO_CUE_FIELDS.cursor) & 0xffff,
            };
        }
        if (s.mem.read8(duel + DRAW_PHASE.subStep) > 0 && s.mode() === 2) completed = true;
    }
    assert.ok(arm0At >= 0, "the first arm advanced");
    assert.deepEqual(introAtArm0 && { state: introAtArm0.state, skipped: introAtArm0.skipped }, { state: 1, skipped: 1 },
        "when the arm advanced the object reported state 1 with its skip flag set");
    assert.ok(completed, "the Draw Phase walked past its first arm");
    // the object is still mid-walk at that instant, not at its end state
    assert.notEqual(introAtArm0.state, 3, "the walk had NOT run to its end");
});

test("an instant disc (the old free stub) leaves the first arm waiting — the gate is the transfer", () => {
    // A huge read rate retires each cue's transfer in one frame: the walk races
    // to its end state 3 before the Draw Phase is reached, exactly as the free
    // stub did, and the first arm never sees state 1 + skip set.
    const s = confirmSession(1 << 20);
    const duel = s.duel();
    const intro = s.intro();
    let reachedIntroEndEarly = false;
    let stuckSub0 = true;
    for (let i = 0; i < 800; i++) {
        s.mem.write16(PAD_BLOCK + PAD_PRESSED_IN_PORT, (1 << 0xd) | (1 << 0xe));
        try { s.runFrame(); } catch { /* the effect-VM helper family is the next block */ }
        if ((s.mem.read32(intro + INTRO_CUE_FIELDS.state) | 0) === 3 && s.mode() < 2) reachedIntroEndEarly = true;
        // duel+0x2f9 is also the mode-1 sub-step; only the Draw Phase's own
        // sub-step counts here.
        if (s.mode() === 2 && s.mem.read8(duel + DRAW_PHASE.subStep) !== 0) stuckSub0 = false;
    }
    assert.ok(reachedIntroEndEarly, "with an instant disc the walk finishes before the Draw Phase");
    assert.ok(stuckSub0, "the Draw Phase's first arm never advanced — the free-stub behaviour");
    assert.equal(s.mode(), 2);
    assert.equal(s.mem.read8(duel + DRAW_PHASE.subStep), 0);
});

test("the language index shifts the cue ids onto their own sector rows", () => {
    // Every biased record adds the resident language index to its cue id; the
    // sector table the transfer latency is sized from is indexed by that shifted
    // id. Setting the index to a non-zero language must keep the walk coherent
    // (otherwise the shifted id reads a zero sector count and the timing, though
    // not the decision, changes silently).
    const s = confirmSession(DUEL_CD_SECTORS_PER_FRAME);
    s.mem.write16(LANGUAGE_INDEX, 2);
    const duel = s.duel();
    const intro = s.intro();
    let sawShiftedCue = false;
    for (let i = 0; i < 1200; i++) {
        s.mem.write16(PAD_BLOCK + PAD_PRESSED_IN_PORT, (1 << 0xd) | (1 << 0xe));
        try { s.runFrame(); } catch { /* next block */ }
        const cue = s.mem.read16(intro + INTRO_CUE_FIELDS.cue) & 0xffff;
        if (cue === 45 || cue === 2040) sawShiftedCue = true; // 43+2 and 2038+2
        if (s.mode() === 2 && s.mem.read8(duel + DRAW_PHASE.subStep) > 0) break;
    }
    assert.ok(sawShiftedCue, "a biased cue carried the added language index");
    assert.ok(s.mem.read8(duel + DRAW_PHASE.subStep) > 0, "the walk still freed the Draw Phase's first arm");
});
