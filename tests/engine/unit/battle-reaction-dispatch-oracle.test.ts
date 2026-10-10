// Oracle for the attack script's defender-reaction dispatch
// (engine/dw3/battle-reaction-dispatch.ts).
//
// The strongest check runs the ORIGINAL instruction words out of the committed
// fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base
// 0x80082cb0) through engine/native and compares them to the port:
//   - FIGHTSTG_F0x8008b69c  the op1 handler: the mode word, the child replacement,
//     the side inversion and the mode-0 / mode-5 action-index arithmetic.
//   - D0x80082ee4           the 14-word reaction-kind case table, and each case's own
//     first `li $v0,clip ; sw $v0,0x54($v1)` decoded from the original words.
// A negative control in each case proves the comparison would catch a wrong port.
//
// The handler's two console services are stubbed: FIGHTSTG_F0x8008c910 (the actor
// allocator) returns one fixed scratch pointer, and the owner's existing child's
// +0x4c destructor is a recording stub — both exactly as the original's own runtime
// would supply them. The parent/ctx/child blocks are plain scratch memory the port
// writes with the same addresses the original does.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  dispatchSubordinateActor, SUBORDINATE_MODE_SINGLE, SUBORDINATE_MODE_MULTI_HIT,
  REACTION_KIND_CASE_ADDRESSES, REACTION_KIND_CASE_CLIPS, REACTION_DEFAULT_CLIP,
  reactionKindClip, type ReactionHost, type ReactionMemory,
} from "../../../engine/dw3/battle-reaction-dispatch.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const available = existsSync(BIN);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const OP1 = 0x8008b69c;
const ALLOC = 0x8008c910;
const TABLE = 0x80082ee4;
const DEFAULT_CLIP_LI = 0x8008d8e0; // .L0x0000ac30 `li $v0,0xa`

const PARENT = 0x80100000;
const CTX = 0x80101000;
const CHILD = 0x80102000;
const EXISTING = 0x80103000;
const MODE_CELL = 0x80104000;
const DESTRUCT = 0x801f0000;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const fightWord = (a: number): number => overlay.readUInt32LE((a - BASE) >>> 0) >>> 0;

/** A plain word memory, so the port writes where the original writes. */
class WordMem implements ReactionMemory {
  private w = new Map<number, number>();
  read32(a: number): number { return this.w.get(a >>> 0) ?? 0; }
  read16s(a: number): number { const v = this.w.get(a >>> 0) ?? 0; return (v << 16) >> 16; }
  write32(a: number, v: number): void { this.w.set(a >>> 0, v | 0); }
}

interface Seed {
  mode: number; side: number; outcome: number; counter: number;
  base0: number; base1: number; base2: number; existing: number;
}

/** Seed one dispatch scenario into raw memory (both the interpreter and the port). */
function seed(rt: NativeStageRuntime, s: Seed): void {
  const m = rt.mem;
  m.write32(PARENT + 0x8c, MODE_CELL);
  m.write32(MODE_CELL, s.mode | 0);
  m.write32(PARENT + 0x50, s.side | 0);
  m.write32(PARENT + 0x64, s.outcome | 0);
  m.write32(PARENT + 0x90, s.counter | 0);
  m.write32(PARENT + 0x58, s.base0 | 0);
  m.write32(PARENT + 0x5c, s.base1 | 0);
  m.write32(PARENT + 0x60, s.base2 | 0);
  m.write32(CTX + 0x3c, s.existing | 0);
  if (s.existing !== 0) m.write32(EXISTING + 0x4c, DESTRUCT);
}
function seedPort(mem: WordMem, s: Seed): void {
  mem.write32(PARENT + 0x8c, MODE_CELL);
  mem.write32(MODE_CELL, s.mode | 0);
  mem.write32(PARENT + 0x50, s.side | 0);
  mem.write32(PARENT + 0x64, s.outcome | 0);
  mem.write32(PARENT + 0x90, s.counter | 0);
  mem.write32(PARENT + 0x58, s.base0 | 0);
  mem.write32(PARENT + 0x5c, s.base1 | 0);
  mem.write32(PARENT + 0x60, s.base2 | 0);
  mem.write32(CTX + 0x3c, s.existing | 0);
  if (s.existing !== 0) mem.write32(EXISTING + 0x4c, DESTRUCT);
}

function runtime(onDestroy: (child: number) => void): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, BASE,
  );
  rt.cpu.setStub(ALLOC, () => CHILD);
  rt.cpu.setStub(DESTRUCT, (c) => { onDestroy(c.reg(4) | 0); return 0; });
  return rt;
}

interface Obs {
  ip: number; child: number; side: number; index: number; counter: number; destroyed: number[];
}

/** Run one scenario on the ORIGINAL words and on the port; return both observables. */
function run(s: Seed): { key: string; orig: Obs; port: Obs } {
  const destroyed: number[] = [];
  const rt = runtime((c) => destroyed.push(c));
  seed(rt, s);
  rt.cpu.call(OP1, [PARENT, CTX], 300000);
  const orig: Obs = {
    ip: rt.mem.read32(PARENT + 0x8c) >>> 0,
    child: rt.mem.read32(CTX + 0x3c) >>> 0,
    side: rt.mem.read32(CHILD + 0x50) | 0,
    index: rt.mem.read32(CHILD + 0x54) | 0,
    counter: rt.mem.read32(PARENT + 0x90) | 0,
    destroyed: destroyed.slice(),
  };

  const mem = new WordMem();
  seedPort(mem, s);
  const portDestroyed: number[] = [];
  const host: ReactionHost = {
    allocateActionActor: () => CHILD,
    destroyActionActor: (method: number, child: number) => { assert.equal(method >>> 0, DESTRUCT >>> 0); portDestroyed.push(child); },
  };
  dispatchSubordinateActor(PARENT, CTX, host, mem);
  const port: Obs = {
    ip: mem.read32(PARENT + 0x8c) >>> 0,
    child: mem.read32(CTX + 0x3c) >>> 0,
    side: mem.read32(CHILD + 0x50) | 0,
    index: mem.read32(CHILD + 0x54) | 0,
    counter: mem.read32(PARENT + 0x90) | 0,
    destroyed: portDestroyed.slice(),
  };
  return { key: JSON.stringify(s), orig, port };
}

// ── 1. the op1 handler over a scenario grid ─────────────────────────────────

function scenario(s: Seed): void {
  const { key, orig, port } = run(s);
  assert.deepEqual(port, orig, `op1 divergence for ${key}`);
}

test("F0x8008b69c mode 0 selects parent+0x64+1 and inverts the side", SKIP, () => {
  for (const outcome of [1, 2, 3, 7]) {
    for (const side of [0, 1]) {
      scenario({ mode: SUBORDINATE_MODE_SINGLE, side, outcome, counter: 0, base0: 0, base1: 0, base2: 0, existing: 0 });
    }
  }
  // mode 0 ignores the contact counter and the base slots.
  scenario({ mode: SUBORDINATE_MODE_SINGLE, side: 0, outcome: 2, counter: 3, base0: 9, base1: 9, base2: 9, existing: 0 });
});

test("F0x8008b69c mode 5 selects +0x58/+0x5c/+0x60 by the counter and increments it", SKIP, () => {
  for (const counter of [0, 1, 2, 3]) {
    scenario({ mode: SUBORDINATE_MODE_MULTI_HIT, side: 1, outcome: 2, counter, base0: 4, base1: 5, base2: 6, existing: 0 });
  }
  // Fresh zero slots (the shipped data) select action 1.
  scenario({ mode: SUBORDINATE_MODE_MULTI_HIT, side: 0, outcome: 2, counter: 0, base0: 0, base1: 0, base2: 0, existing: 0 });
});

test("F0x8008b69c destroys an existing child before allocating", SKIP, () => {
  scenario({ mode: SUBORDINATE_MODE_SINGLE, side: 0, outcome: 1, counter: 0, base0: 0, base1: 0, base2: 0, existing: EXISTING });
  scenario({ mode: SUBORDINATE_MODE_MULTI_HIT, side: 1, outcome: 2, counter: 1, base0: 0, base1: 3, base2: 0, existing: EXISTING });
});

test("F0x8008b69c consumes a word and does nothing for every other mode", SKIP, () => {
  for (const mode of [1, 2, 3, 4, 6, 7, -1, 0x7fff]) {
    const { key, orig, port } = run({ mode, side: 0, outcome: 2, counter: 0, base0: 0, base1: 0, base2: 0, existing: EXISTING });
    assert.deepEqual(port, orig, `no-op mode divergence for ${key}`);
    assert.equal(orig.child >>> 0, EXISTING, `mode ${mode} must not replace the child`);
    assert.equal(orig.ip, (MODE_CELL + 2) >>> 0, `mode ${mode} must consume one word`);
  }
});

// ── 2. negative controls: a wrong port must diverge ─────────────────────────

test("negative control: a non-inverted side and a wrong mode-5 base diverge", SKIP, () => {
  const s: Seed = { mode: SUBORDINATE_MODE_MULTI_HIT, side: 0, outcome: 2, counter: 1, base0: 4, base1: 5, base2: 6, existing: 0 };
  const { orig } = run(s);
  assert.equal(orig.side, 1, "child side is the inverse of the parent (parent 0 -> child 1)");
  assert.equal(orig.index, 6, "counter 1 selects +0x5c (=5) + 1");
  // A port that kept the parent's side, or read +0x58 for counter 1, is wrong.
  assert.notEqual(orig.side, 0);
  assert.notEqual(orig.index, 5, "counter 1 must not use the +0x58 base (4+1)");
});

// ── 3. the reaction-kind table equals the disc words ────────────────────────

test("D0x80082ee4 holds the 14 case addresses the port names", SKIP, () => {
  assert.equal(REACTION_KIND_CASE_ADDRESSES.length, 14);
  for (let i = 0; i < 14; i++) {
    assert.equal(fightWord(TABLE + i * 4), REACTION_KIND_CASE_ADDRESSES[i]! >>> 0, `table word ${i}`);
  }
  // The table really moved: the case set is not one repeated address.
  assert.notEqual(REACTION_KIND_CASE_ADDRESSES[0], REACTION_KIND_CASE_ADDRESSES[13]);
});

/** Decode the clip a case selects: the last `li $v0,imm` before its `sw $v0,0x54($v1)`. */
function scanClip(start: number): number | null {
  let lastLi: number | null = null;
  for (let a = start; a < start + 0x400; a += 4) {
    const w = fightWord(a);
    const op = w >>> 26;
    if (op === 0x09 && ((w >>> 21) & 31) === 0 && ((w >>> 16) & 31) === 2) {
      lastLi = ((w & 0xffff) << 16) >> 16;         // addiu $v0, $zero, imm
    } else if (op === 0x2b && ((w >>> 21) & 31) === 3 && ((w >>> 16) & 31) === 2 && (w & 0xffff) === 0x54) {
      return lastLi;                                // sw $v0, 0x54($v1)
    }
  }
  return null;
}

test("each reaction case selects the clip the port names, decoded from the disc", SKIP, () => {
  for (let i = 0; i < 14; i++) {
    const addr = REACTION_KIND_CASE_ADDRESSES[i]!;
    assert.equal(scanClip(addr), REACTION_KIND_CASE_CLIPS[i]!, `case ${addr.toString(16)} clip`);
    assert.equal(reactionKindClip(0x4d + i), REACTION_KIND_CASE_CLIPS[i]!);
  }
  assert.equal(scanClip(DEFAULT_CLIP_LI), REACTION_DEFAULT_CLIP, "default case clip");
  // Out-of-range kinds take the default, and the kind list is not uniform.
  assert.equal(reactionKindClip(0x4c), REACTION_DEFAULT_CLIP);
  assert.equal(reactionKindClip(0x5b), REACTION_DEFAULT_CLIP);
  assert.notEqual(REACTION_KIND_CASE_CLIPS[0], REACTION_KIND_CASE_CLIPS[8]);
});
