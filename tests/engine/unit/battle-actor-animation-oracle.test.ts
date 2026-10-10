// Oracle for the battle actor's animation-slot system
// (engine/dw3/battle-actor-animation.ts).
//
// The original instruction words of the fightstg routines run out of the committed overlay image
// (web/assets/native/screens/pro_fightstg.bin, base 0x80082cb0) through engine/native and are
// compared to the port:
//   - FIGHTSTG_F0x80087bf8  the four-slot key scan
//   - FIGHTSTG_F0x80087e28  the slot resolver (the anim object's +0x188 method)
//   - FIGHTSTG_F0x80088024  the table bind into slot+0x18
//   - FIGHTSTG_F0x80087f38  the home placement (on the shared arenaPlacement)
//   - FIGHTSTG_F0x8008b7f4  the op2 movement arms 3 (arena-absolute), 7 (home) and 8 (contact)
// A negative control in each case proves the comparison would catch a wrong port.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  ANIM_SLOT_COUNT, ANIM_SLOT_STRIDE, CONTACT_HALF,
  findAnimSlotIndex, resolveAnimSlot, setAnimSlotTable, animSlotHome, placeAnimSlot,
  op2SlotTarget, animSlotMoveDelta, type AnimSlotEntry,
} from "../../../engine/dw3/battle-actor-animation.ts";
import { ARENA_BASE_Z, ARENA_NEAR_ROT_Y } from "../../../engine/dw3/battle-presentation.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

// Routines under test.
const FIND = 0x80087bf8;
const RESOLVE = 0x80087e28;
const SETTABLE = 0x80088024;
const PLACE = 0x80087f38;
const OP2 = 0x8008b7f4;

// Scratch objects.
const ANIM = 0x80200100;
const SLOT = 0x80200200;         // the slot the resolve stub hands back for the op2 handler
const AO = 0x80200000;           // the op2 handler's actor object
const SCRIPT = 0x80200300;
const S5 = 0x80200400;           // the op2 handler's arg1 (slot-state object)
const MODEL = 0x80200500;        // the model record 87f38 reads hover/stand-off from
const A_RESOLVE = 0x80210000;    // the anim object's +0x188 method stub for the op2 handler
const LOOKUP = 0x80210040;       // [0x800a4570] — slot model handle -> model record

const slotAt = (i: number): number => ANIM + 0x50 + i * ANIM_SLOT_STRIDE;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

/** A runtime with the animation object's slots seeded and the two lookup stubs installed. */
function runtime(slotKeys: (number | null)[]): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  const m = rt.mem;
  // occupancy (slot+0x00) and key (slot+0x04) for each of the four slots; null = empty.
  for (let i = 0; i < ANIM_SLOT_COUNT; i++) {
    const k = slotKeys[i];
    m.write32(slotAt(i) + 0x00, k == null ? 0 : 1);
    m.write32(slotAt(i) + 0x04, k == null ? 0 : k | 0);
  }
  // For 87f38: each slot's +0x14 is the model handle, and [0x800a4570] resolves it.
  m.write32(0x800a4570, LOOKUP);
  rt.cpu.setStub(LOOKUP, () => MODEL);
  // For the op2 handler: the anim object's +0x188 method resolves to SLOT.
  m.write32(ANIM + 0x188, A_RESOLVE);
  rt.cpu.setStub(A_RESOLVE, () => SLOT);
  return rt;
}

/** The port's four-slot view built from the same keys. */
function portSlots(slotKeys: (number | null)[]): AnimSlotEntry[] {
  return slotKeys.map((k) => ({ occupied: k != null, key: k == null ? 0 : k | 0, table: 0 }));
}

// ── 1. the slot resolver F0x80087bf8 / F0x80087e28 ──────────────────────────
test("F0x80087bf8/F0x80087e28 slot resolve: the original words equal the port", SKIP, () => {
  const keys = [7, null, 0, 0x10];
  const rt = runtime(keys);
  const slots = portSlots(keys);
  for (const key of [7, 5, 0, 0x10, 9, -1]) {
    const got = rt.cpu.call(RESOLVE, [ANIM, key], 100000) >>> 0;
    const want = resolveAnimSlot(slots, key);
    const wantAddr = want ? slotAt(findAnimSlotIndex(slots, key)) : 0;
    assert.equal(got, wantAddr >>> 0, `resolve key ${key}`);
    assert.equal(findAnimSlotIndex(slots, key), got === 0 ? -1 : (got - ANIM - 0x50) / ANIM_SLOT_STRIDE, `index key ${key}`);
  }
  // The empty slot 1 (key 5) must NOT resolve, and a key nobody carries must not either.
  assert.equal(rt.cpu.call(RESOLVE, [ANIM, 5], 100000) >>> 0, 0);
  assert.notEqual(findAnimSlotIndex(slots, 5), 1);
});

// ── 2. the table bind F0x80088024 ───────────────────────────────────────────
test("F0x80088024 table bind: the original writes slot+0x18, the port matches", SKIP, () => {
  const keys = [7, null, 0, 0x10];
  const rt = runtime(keys);
  const slots = portSlots(keys);
  rt.cpu.call(SETTABLE, [ANIM, 0x10, 0x2a], 100000);
  setAnimSlotTable(slots, 0x10, 0x2a);
  assert.equal(rt.mem.read32(slotAt(3) + 0x18) | 0, 0x2a);
  assert.equal(slots[3]!.table, 0x2a);
  // A key no slot carries writes nothing.
  rt.cpu.call(SETTABLE, [ANIM, 9, 0x99], 100000);
  assert.equal(rt.mem.read32(slotAt(3) + 0x18) | 0, 0x2a, "an unmatched key must not overwrite another slot");
});

// ── 3. the home placement F0x80087f38 (on the shared arenaPlacement) ─────────
test("F0x80087f38 placement: the original words equal arenaPlacement", SKIP, () => {
  for (const [hover, standoff, slotId] of [[100, 500, 0], [0, 0, 0x10], [250, 0x340, 0x10], [77, 1234, 0]] as const) {
    const keys = [slotId, null, null, null];
    const rt = runtime(keys);
    const m = rt.mem;
    m.write32(MODEL + 0x10, standoff);
    m.write32(MODEL + 0x18, hover);
    rt.cpu.call(PLACE, [ANIM, slotId], 100000);
    const base = slotAt(0);
    const live = {
      x: m.read16s(base + 0x1c), y: m.read16s(base + 0x1e), z: m.read16s(base + 0x20),
      rotY: m.read16s(base + 0x24),
    };
    const homeTriple = [m.read16s(base + 0x28), m.read16s(base + 0x2a), m.read16s(base + 0x2c)];
    const p = animSlotHome(hover, standoff, slotId);
    assert.equal(live.x, p.x, `slotId ${slotId} x`);
    assert.equal(live.y, p.y, `slotId ${slotId} y`);
    assert.equal(live.z, p.z, `slotId ${slotId} z`);
    assert.equal(live.rotY, p.rotY, `slotId ${slotId} rotY`);
    assert.deepEqual(homeTriple, [p.x, p.y, p.z], `slotId ${slotId} home copy`);
  }
  // The port's placement is the shared one: near side faces +z-negated with rotY 0x800.
  const near = animSlotHome(100, 500, 0);
  assert.equal(near.z, -(ARENA_BASE_Z + 500));
  assert.equal(near.rotY, ARENA_NEAR_ROT_Y);
  const far = animSlotHome(100, 500, 0x10);
  assert.equal(far.z, ARENA_BASE_Z + 500);
  assert.equal(far.rotY, 0);
  // Negative control: the near and far sides differ.
  assert.notEqual(near.z, far.z);
});

// ── 4. the op2 movement arms F0x8008b7f4 modes 3/7/8 ────────────────────────
test("F0x8008b7f4 movement arms: the original slot writes equal op2SlotTarget", SKIP, () => {
  const rt = runtime([0, null, null, null]);
  const m = rt.mem;
  m.write32(AO + 0x88, ANIM);
  m.write32(SLOT + 0x28, 0x11); m.write32(SLOT + 0x2a, 0x22); m.write32(SLOT + 0x2c, 0x100);
  const home: [number, number, number] = [0x11, 0x22, 0x100];

  const run = (words: number[]): { x: number; y: number; z: number } => {
    words.forEach((w, i) => m.write16(SCRIPT + 2 * i, w));
    m.write32(AO + 0x8c, SCRIPT);
    rt.cpu.call(OP2, [AO, S5], 200000);
    return { x: m.read16s(SLOT + 0x1c), y: m.read16s(SLOT + 0x1e), z: m.read16s(SLOT + 0x20) };
  };

  // mode 3 [mode, slotKey, x, y, z, flag=0] — arena-absolute, y/z negated, no side test.
  const words3 = [3, 1, 0x123, 0x456, 0x789, 0];
  const got3 = run(words3);
  const want3 = op2SlotTarget(3, [0x123, 0x456, 0x789, 0], home, 0).target;
  assert.deepEqual([got3.x, got3.y, got3.z], want3, "mode 3 arena-absolute");

  // mode 7 [mode, slotKey, flag=0] — live = home.
  const got7 = run([7, 1, 0]);
  const want7 = op2SlotTarget(7, [0], home, 0).target;
  assert.deepEqual([got7.x, got7.y, got7.z], want7, "mode 7 home");

  // mode 8 [mode, slotKey, flag=0] — home with z +/- 0x2800; the sign is b630's result, and
  // b630 is called with the ACTOR (so key 0 falls to the actor's +0x50, which is empty here).
  // slotKey 1 -> b630(1)=0 -> near (+); slotKey 4 -> b630(4)=0x10 -> far (-).
  const gotNear = run([8, 1, 0]);
  const gotFar = run([8, 4, 0]);
  assert.equal(gotNear.z, 0x100 + CONTACT_HALF, "mode 8 near side dashes away");
  assert.equal(gotFar.z, 0x100 - CONTACT_HALF, "mode 8 far side dashes the other way");
  // Negative control: the two sides must differ.
  assert.notEqual(gotNear.z, gotFar.z);
});

// ── 5. the browser's delta form of the same arms ────────────────────────────
test("animSlotMoveDelta: the actor's delta equals the ported arm targets minus home", SKIP, () => {
  const home: [number, number, number] = [100, -200, 3000];
  assert.deepEqual(animSlotMoveDelta({ kind: "home" }, home, "player"), [0, 0, 0]);
  assert.deepEqual(animSlotMoveDelta({ kind: "contact" }, home, "player"), [0, 0, CONTACT_HALF]);
  assert.deepEqual(animSlotMoveDelta({ kind: "contact" }, home, "enemy"), [0, 0, -CONTACT_HALF]);
  // "to" carries the already-negated arena-absolute target; the delta is target - home.
  assert.deepEqual(animSlotMoveDelta({ kind: "to", x: 500, y: -700, z: 9000 }, home, "player"), [400, -500, 6000]);
  // The port composes with op2SlotTarget: mode 8's target minus home is the contact delta.
  const t = op2SlotTarget(8, [0], home, 0).target;
  assert.deepEqual([t[0] - home[0], t[1] - home[1], t[2] - home[2]], [0, 0, CONTACT_HALF]);
});

// ── 6. placeAnimSlot writes the same numbers into live and home ─────────────
test("placeAnimSlot: the port's live and home triples equal the placement", SKIP, () => {
  const slot = {
    live: { x: 9, y: 9, z: 9, rotX: 9, rotY: 9, rotZ: 9 },
    home: { x: 9, y: 9, z: 9, rotX: 9, rotY: 9, rotZ: 9 },
  };
  placeAnimSlot(slot, 100, 500, 0);
  assert.deepEqual([slot.live.x, slot.live.y, slot.live.z], [0, -100, -(ARENA_BASE_Z + 500)]);
  assert.equal(slot.live.rotY, ARENA_NEAR_ROT_Y);
  assert.deepEqual(slot.home, slot.live, "the home copy equals live");
});
