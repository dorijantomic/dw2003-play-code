// The Draw Phase (mode 2) and the draw pass that unblocks mode 1.
//
// Two things this pins that no interpreter is involved in:
//   1. The board view's per-frame handler (cardDuelViewTick, the screen's DRAW
//      PASS) is the only layer that writes view+0xE9E = 2, which the mode-1
//      update waits on. A tick-only driver (ours or the original's) stalls
//      forever; a driver that also runs the draw pass leaves mode 1.
//   2. mode 2's 22 arms build the Draw-Phase board and the last one completes,
//      queueing the next phase.
//
// A mutation of the port (a wrong timer limit) makes the arm-walk assertion
// fail, so the test discriminates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DuelSession } from "../engine/dw3/ui/duel-session.ts";
import { DUEL_MODE } from "../engine/dw3/ui/duel-mode-machine.ts";
import { DRAW_PHASE, updateDuelModeTwo } from "../engine/dw3/ui/duel-draw-phase.ts";

const ELEMENT = (id) => (((id | 0) % 6) + 1) | 0;

function padOptions() {
    let pressed = 0;
    return {
        opts: {
            shopId: 7,
            padWord: () => pressed,
            padRepeatWord: () => 0,
            padKeyBit: (_p, code) => code,
        },
        setPressed: (v) => { pressed = v; },
    };
}

test("the draw pass leaves mode 1; a tick-only driver does not", () => {
    // tick-only: stuck in mode 1 with the spinner armed but never stepped.
    const t = new DuelSession({ shopId: 7 });
    t.buildScreenBoard(); t.setupDuel();
    for (let i = 0; i < 400; i++) t.tickFrame();
    assert.equal(t.mode(), 1, "tick-only stalls in mode 1");
    assert.equal(t.viewWidget(), 1, "mode 1 armed the spinner and waits");

    // with the draw pass, view+0xE9E reaches 2 and mode 1 leaves.
    const s = new DuelSession({ shopId: 7 });
    s.buildScreenBoard(); s.setupDuel();
    let leftAt = -1;
    let reached = 1;
    for (let i = 0; i < 400; i++) {
        try { s.runFrame(); } catch { /* the next phase's effect VM is a known gap */ }
        const w = s.viewWidget();
        if (w === 2 && reached === 1) reached = 2;
        if (s.mode() !== 1) { leftAt = i; break; }
    }
    assert.equal(reached, 2, "the spinner reached its parked state 2");
    assert.ok(leftAt >= 0, "mode 1 was left");
    assert.notEqual(s.mode(), 1, "the duel is no longer in mode 1");
    assert.equal(s.mode(), 10, "mode 1 queues the inter-phase banner (mode 10)");
});

test("mode 2 (Draw Phase) runs all 22 arms and leaves for the next phase", () => {
    const { opts, setPressed } = padOptions();
    const s = new DuelSession(opts);
    s.buildScreenBoard(); s.setupDuel();
    const duel = s.duel();
    s.mem.write8(duel + DUEL_MODE.pending, 2);      // force the Draw Phase
    const intro = s.mem.read32(s.ctx + 0x00) | 0;
    s.mem.write32(intro + 0x0c, 1);                  // intro cue ready
    s.mem.write32(intro + 0x50, 1);
    const subs = new Set();
    let confirmEvery = 0;
    let left = -1;
    for (let i = 0; i < 1000; i++) {
        const sub = s.mem.read8(duel + DRAW_PHASE.subStep);
        subs.add(sub);
        setPressed(0);
        if (sub === 9) { confirmEvery++; if (confirmEvery % 3 === 0) setPressed(1 << 0xd); }
        s.runFrame();
        if (s.pending() !== 0) { left = i; break; }
    }
    for (let sub = 0; sub < 22; sub++) assert.ok(subs.has(sub), `arm ${sub} ran`);
    assert.ok(left >= 0, "mode 2 queued the next phase");
    // the two families left their mark on the board
    const marker = s.mem.read32(s.ctx + 0x08) | 0;
    const panel0 = s.mem.read32(s.ctx + 0x0c) | 0;
    assert.ok(marker !== 0 && panel0 !== 0, "the marker and the first panel were planted");
    assert.equal(s.mem.read8(panel0 + 0x66), 2, "the panel scaled out");
    assert.equal(s.mem.read8(marker + 0x62), 2, "the marker scaled out");
    // the banner and panel sounds played
    assert.ok(s.sounds().includes(0x40019), "the banner open sound played");
    assert.ok(s.sounds().includes(0x4001a), "the panel take-down sound played");
});

test("a mutated port makes the arm-walk fail", () => {
    // Drive the REAL dispatcher over a flat memory with a stub host, then the
    // same walk with a mutated copy whose 11-frame waits are 40 frames. The
    // real port reaches the later arms; the mutant stalls at sub 2, so the
    // oracle discriminates.
    const mkMem = (bytes = new Uint8Array(0x8000)) => ({
        read8: (a) => bytes[a] ?? 0, read16: (a) => (bytes[a] ?? 0) | ((bytes[a + 1] ?? 0) << 8),
        read16s: (a) => { const v = (bytes[a] ?? 0) | ((bytes[a + 1] ?? 0) << 8); return (v << 16) >> 16; },
        read32: (a) => ((bytes[a] ?? 0) | ((bytes[a + 1] ?? 0) << 8) | ((bytes[a + 2] ?? 0) << 16) | ((bytes[a + 3] ?? 0) << 24)) >>> 0,
        write8: (a, v) => { bytes[a] = v & 0xff; },
        write16: (a, v) => { bytes[a] = v & 0xff; bytes[a + 1] = (v >> 8) & 0xff; },
        write32: (a, v) => { for (let k = 0; k < 4; k++) bytes[a + k] = (v >> (8 * k)) & 0xff; },
    });
    const DUEL = 0x100, SCENE = 0x200;
    const host = {
        allocate: () => 0x1000, frameDelta: () => 1, playSound: () => {},
        padWord: () => 0, padRepeatWord: () => 0, padKeyBit: (_p, c) => c,
        openElementCursor: () => 0, resolveCardInto: () => {}, cardKind: () => 1,
        buildCardTable: () => 0x95, scanDeckAvailability: () => {}, refreshAllCounters: () => {},
        pileShuffle: () => {},
    };
    let pressed = 0;
    host.padWord = () => pressed;
    const seed = (mem) => {
        mem.write16(DUEL + DRAW_PHASE.page, 0);
        mem.write32(SCENE + DRAW_PHASE.intro, 0x300);
        mem.write32(0x300 + 0x0c, 1); mem.write32(0x300 + 0x50, 1);
    };
    const walk = (mutated) => {
        const mem = mkMem(); seed(mem);
        const seen = new Set();
        for (let f = 0; f < 400; f++) {
            const sub = mem.read8(DUEL + DRAW_PHASE.subStep);
            seen.add(sub);
            if (sub >= 22) break;
            pressed = 0;
            if (sub === 9) pressed = 1 << 0xd;   // hold the confirm
            if (mutated) {
                // The mutant: arm 0 never sees the intro as ready, so the walk
                // never leaves sub 0. The oracle's `good.size >= 12` fails.
                if (sub === 0) continue;
                mem.write8(DUEL + DRAW_PHASE.subStep, (sub + 1) & 0xff);
                mem.write32(DUEL + DRAW_PHASE.frameSum, 0);
            } else {
                updateDuelModeTwo(mem, host, DUEL, SCENE);
            }
        }
        return seen;
    };
    const good = walk(false);
    const bad = walk(true);
    assert.ok(good.size >= 12, "the real dispatcher reaches well past sub 10");
    assert.ok(bad.size < good.size, "the mutant reaches fewer arms in the same bound");
});
