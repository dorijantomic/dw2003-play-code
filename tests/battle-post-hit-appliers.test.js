// The two POST-HIT STATUS APPLIER bodies — dispatches 2 (poison) and 5 (sleep).
//
// The shared post-hit dispatcher FIGHTSTG_F0x8009df78 routes a technique's `+0x0a`
// effect byte to one of its 15 arms (tests/battle-post-hit-dispatch.test.js pins that
// table). The three penalty arms (32/33/34) were ported as `applyDamageTermPenalty`.
// The poison and sleep arms existed only as addresses in `DAMAGE_TERM_POST_HIT_ARMS`
// until this file: their roll (F0x800a0a18 / 0x800a0e68) was ported as
// `statusInflictionRoll` and their stager (F0x8009c7d4) as `stageStatusEventAilment`, but
// the body between the two — resolve the target, run the arm's own roll, store the
// magnitude at `ctx + 0x38 + dispatch` with the target's `+0x1b` doubling — was not.
//
// Every test here runs the ORIGINAL arm out of the committed overlay image
// (web/assets/native/screens/pro_fightstg.bin) through engine/native, with the roll
// stubbed at the address the arm's OWN method-table slot names, and compares the byte the
// original writes and the value it leaves in $v0 against the port.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
  DAMAGE_TERM_POST_HIT_ARMS,
  applyDamageTermPoison,
  applyDamageTermSleep,
  damageTermPostHitApplier,
} from "../engine/dw3/battle-damage-terms.ts";

const FIGHTSTG_BASE = 0x80082cb0;
const overlay = readFileSync("web/assets/native/screens/pro_fightstg.bin");

const CTX = 0x800a43f4;            // the action context the arm reads through
const WORKSPACE = 0x800a4460;      // active-index globals live at +0x08 / +0x0c
const PARTY = 0x800a4470;          // the combatant record block (stride 0x20)
const TECH = 0x80042bca;           // the 18-byte technique record table (in the resident EXE)
const POISON_ROLL_SLOT = 0x800a4624;  // object +0xa4 -> the poison/plain landing roll
const SLEEP_ROLL_SLOT = 0x800a4630;   // object +0xb0 -> the sleep landing roll

const POISON_ARM = 0x8009d140;
const SLEEP_ARM = 0x8009d3ac;

function runtime() {
  return new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, FIGHTSTG_BASE,
  );
}

/**
 * Run one original applier arm with fully seeded memory. The roll is stubbed at the
 * address the arm's own method-table slot resolves to, so the arm's target resolution and
 * bookkeeping run as shipped but the landing is controlled.
 */
function runOriginal(arm, slot, opts) {
  const rt = runtime();
  const rollAddress = rt.mem.read32(slot) >>> 0;
  const { side, techniqueId, dispatch, magnitude, tailByte, rollValue } = opts;

  rt.mem.write8(CTX + 0x20, side);
  rt.mem.write32(CTX + 0x24, techniqueId);
  rt.mem.write32(WORKSPACE + 0x08, opts.activeIndex);
  rt.mem.write32(WORKSPACE + 0x0c, opts.activeIndex);

  const rec = TECH + techniqueId * 0x12;
  rt.mem.write8(rec + 0x0a, dispatch);
  rt.mem.write8(rec + 0x0c, magnitude);

  // The target the arm reads is `PARTY + activeIndex*0x20 + side*0x60`.
  rt.mem.write8(PARTY + opts.activeIndex * 0x20 + side * 0x60 + 0x1b, tailByte);

  const resultOffset = 0x38 + dispatch;
  for (let i = 0; i < 8; i++) rt.mem.write8(CTX + 0x38 + i, 0xaa);

  let seenArgs = null;
  rt.cpu.setStub(rollAddress, (c) => {
    seenArgs = [c.reg(4) | 0, c.reg(5) | 0, (c.reg(6) >>> 0), c.reg(7) | 0];
    return rollValue | 0;
  });

  const ret = rt.cpu.call(arm, [], 4000);
  return {
    rollAddress,
    seenArgs,
    ret: ret | 0,
    byte: rt.mem.read8(CTX + resultOffset) >>> 0,
    untouched: rt.mem.read8(CTX + 0x38 + 7) >>> 0,
  };
}

// ── 1. The two arms carry a body, and their own roll slots name the disc's leaves ──────

test("CENSUS: dispatch 2 and 5 are the arms with a ported body", () => {
  // Only the two appliers read off the disc carry a body; the penalty family uses
  // applyDamageTermPenalty, which takes a different input.
  const withBody = DAMAGE_TERM_POST_HIT_ARMS.filter((a) => a.applier).map((a) => a.dispatch);
  assert.deepEqual(withBody, [2, 5]);
  assert.equal(damageTermPostHitApplier(2), applyDamageTermPoison);
  assert.equal(damageTermPostHitApplier(5), applyDamageTermSleep);
  assert.equal(damageTermPostHitApplier(3), null);

  // The arms' own method-table slots are the disc's static pointers: poison obj+0xa4
  // (0x800a4624) -> 0x800a0a18, sleep obj+0xb0 (0x800a4630) -> 0x800a0e68.
  const rt = runtime();
  assert.equal(rt.mem.read32(POISON_ROLL_SLOT) >>> 0, 0x800a0a18);
  assert.equal(rt.mem.read32(SLEEP_ROLL_SLOT) >>> 0, 0x800a0e68);
});

// ── 2. The poison arm (F0x8009d140), original vs port ─────────────────────────────────

test("poison: the original F0x8009d140 and the port agree on the byte and $v0", () => {
  const dir = [
    // side, techId, dispatch, magnitude, tailByte, rollValue
    { side: 0, techniqueId: 5, dispatch: 2, magnitude: 0x41, tailByte: 0, rollValue: 0x41 },
    { side: 0, techniqueId: 5, dispatch: 2, magnitude: 0x41, tailByte: 9, rollValue: 0x41 },
    { side: 1, techniqueId: 7, dispatch: 2, magnitude: 0x7f, tailByte: 0, rollValue: 0x7f },
    { side: 1, techniqueId: 7, dispatch: 2, magnitude: 0x7f, tailByte: 3, rollValue: 0x7f },
    // A miss writes nothing.
    { side: 0, techniqueId: 5, dispatch: 2, magnitude: 0x41, tailByte: 9, rollValue: 0 },
    // A roll byte whose doubling overflows the stored byte.
    { side: 0, techniqueId: 6, dispatch: 2, magnitude: 0x90, tailByte: 1, rollValue: 0x90 },
  ];
  for (const opts of dir) {
    const original = runOriginal(POISON_ARM, POISON_ROLL_SLOT, { ...opts, activeIndex: 1 });
    const ported = applyDamageTermPoison(opts);
    // The original calls its roll with (side, techniqueId, record, side*0x60).
    assert.equal(original.seenArgs[0], opts.side);
    assert.equal(original.seenArgs[1], opts.techniqueId);
    assert.equal(original.seenArgs[2], PARTY + 1 * 0x20);
    assert.equal(original.seenArgs[3], opts.side * 0x60);
    if (opts.rollValue === 0) {
      assert.equal(ported.landed, false);
      assert.equal(ported.value, null);
      assert.equal(original.byte, 0xaa, "a miss must not write the result byte");
      assert.equal(original.ret, 0);
    } else {
      assert.equal(original.byte, ported.value, `poison byte for ${JSON.stringify(opts)}`);
      assert.equal(original.ret & 0xff, ported.returns, "poison returns the target's +0x1b");
      assert.equal(ported.writeOffset, 0x3a);
    }
  }
});

// ── 3. The sleep arm (F0x8009d3ac), original vs port ─────────────────────────────────

test("sleep: the original F0x8009d3ac and the port agree on the byte", () => {
  const dir = [
    { side: 0, techniqueId: 5, dispatch: 5, magnitude: 0x6e, tailByte: 0, rollValue: 1 },
    { side: 0, techniqueId: 5, dispatch: 5, magnitude: 0x6e, tailByte: 4, rollValue: 1 },
    { side: 1, techniqueId: 9, dispatch: 5, magnitude: 0x21, tailByte: 0, rollValue: 1 },
    { side: 1, techniqueId: 9, dispatch: 5, magnitude: 0x21, tailByte: 8, rollValue: 1 },
    // A miss writes nothing.
    { side: 0, techniqueId: 5, dispatch: 5, magnitude: 0x6e, tailByte: 8, rollValue: 0 },
  ];
  for (const opts of dir) {
    const original = runOriginal(SLEEP_ARM, SLEEP_ROLL_SLOT, { ...opts, activeIndex: 2 });
    const ported = applyDamageTermSleep(opts);
    assert.equal(original.seenArgs[0], opts.side);
    assert.equal(original.seenArgs[1], opts.techniqueId);
    assert.equal(original.seenArgs[2], PARTY + 2 * 0x20);
    assert.equal(original.seenArgs[3], opts.side * 0x60);
    if (opts.rollValue === 0) {
      assert.equal(ported.landed, false);
      assert.equal(original.byte, 0xaa, "a miss must not write the result byte");
    } else {
      assert.equal(ported.writeOffset, 0x38 + opts.dispatch);
      assert.equal(original.byte, ported.value, `sleep byte for ${JSON.stringify(opts)}`);
      // Sleep stores record+0x0c doubled; it leaves no meaningful value in $v0 (the
      // original's $v0 is a leftover `ctx + dispatch` address, not a contract).
    }
  }
});

// ── 4. The store is `ctx + 0x38 + dispatch` for both arms, as the assembly shows ───────

test("both arms write ctx + 0x38 + dispatch", () => {
  // poison dispatch 2 -> ctx+0x3a; sleep dispatch 5 -> ctx+0x3d. The destination byte
  // then sits consecutive to frozen (0x442f) and confusion (0x4430), read from the
  // neighbouring arms' own `sb`.
  const rt = runtime();
  assert.equal(rt.mem.read32(SLEEP_ROLL_SLOT - 0x10) >>> 0, 0x800a08c8,
    "the slot two down is the magical-accuracy leaf, confirming the block layout");

  const poison = runOriginal(POISON_ARM, POISON_ROLL_SLOT,
    { side: 0, techniqueId: 5, dispatch: 2, magnitude: 0x20, tailByte: 0, rollValue: 0x20, activeIndex: 0 });
  assert.equal(poison.byte, 0x20);
  const sleep = runOriginal(SLEEP_ARM, SLEEP_ROLL_SLOT,
    { side: 0, techniqueId: 5, dispatch: 5, magnitude: 0x20, tailByte: 0, rollValue: 1, activeIndex: 0 });
  assert.equal(sleep.byte, 0x20);
});
