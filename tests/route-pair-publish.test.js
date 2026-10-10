// The route pair: the disc's two "which way did you come in" scalars, the one
// predicate that reads them, and the three step opcodes that publish them.
//
// ── What this settles ──
//
// Item-store gap 6 claimed the two halfwords at D0x80048D34+0x44 / +0x46 were a
// "once per newly obtained item" marker the field played a sparkle against. They are
// not. They are the ROUTE PAIR: the wrap-maze section you entered by, read by the
// bank-0x7E spawn gates and by 30 stage inits' encounter selector, and written by
// exactly two sites which both read a type-7 step record's params[5] / params[6].
// `F0x800161D8` — the one routine that adds or removes an item — never touches
// either half, so there is nothing in the item store for a marker to hang on, and
// nothing in this file adds one.
//
// Everything below that says "the original" is the DISC's own bytes, executed through
// engine/native over web/assets/native/screens/resident.bin. F0x800163B0's dispatch
// chain loads each bank constant in the delay slot of the previous compare
// (exe/fns.s:6934-6958: `li $v0,0x7e` at 0x80016534 is compared at 0x8001654C, which
// calls F0x800160A8); pairing a constant with the call beside it shifts every bank
// from 0x70 up by one and makes the marker look like bank 0x80. The bank map below
// is also read out of the running image.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
  ROUTE_KEY_OFFSET, ROUTE_COMPANION_OFFSET, ROUTE_PAIR_BANK, ROUTE_PAIR_KEY_BAND,
  ROUTE_PAIR_PUBLISH_OPS, publishesRoutePair, routePairFromParams, routePairPredicate,
  routePairTarget, routePairTest,
} from "../engine/systems/route-pair.ts";
import { execPlaybackOp, launcherRouteWords } from "../engine/systems/scene-step-ops.ts";

const resident = new Uint8Array(
  readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url)),
);
const overlay = new Uint8Array(
  readFileSync(new URL("../web/assets/native/screens/pro_stitshop.bin", import.meta.url)),
);
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const services = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };

const SAVE = 0x80048d34;        // the resident save/party/collection block
const KEY = SAVE + ROUTE_KEY_OFFSET;      // 0x80048D78
const COMPANION = SAVE + ROUTE_COMPANION_OFFSET; // 0x80048D7A
const GET_FLAG = 0x800163b0;   // [0x80048ACC] — the scene VM's flag getter
const SET_FLAG = 0x800165ac;   // [0x80048AC8] — the scene VM's flag setter
const ROUTE_READER = 0x800160a8;
const BAG_ADD = 0x800161d8;
const BAG_READ = 0x80015f04;
const HELD = 0x7c;             // SAVE + 0x7c + id  = carried count

/** The disc's own flag getter/setter, with the runtime's host stubs removed. */
function boot() {
  const rt = new NativeStageRuntime(overlay, entry, services, undefined, undefined, 0x80082cb0, {
    image: resident, base: 0x80010000,
  });
  rt.cpu.gp = 0x8005cb50;
  rt.cpu.clearStub(GET_FLAG);
  rt.cpu.clearStub(SET_FLAG);
  return rt;
}

function publish(rt, key, companion) {
  rt.mem.write16(KEY, key);
  rt.mem.write16(COMPANION, companion);
}

/** The low-bit form a `jal` field carries for an absolute target. */
const jalField = (addr) => ((((addr >>> 2) & 0x03ffffff) << 2) >>> 0) & 0x0fffffff;

/** Every routine `addr` reaches through a `jal`, in order, de-duplicated. */
function callees(rt, addr, args, budget = 4000) {
  rt.cpu.traceRing = new Int32Array(6000);
  const before = rt.cpu.traceWritten();
  rt.cpu.call(addr, args, budget);
  const total = rt.cpu.traceWritten();
  const out = [];
  for (let i = before + 1; i < total; i++) {
    const pc = rt.cpu.traceRing[i % 6000] >>> 0;
    const word = rt.mem.read32(pc) >>> 0;
    if ((word & 0xfc000000) === 0x0c000000) {
      // A `jal` field is the absolute target >> 2, and this image loads the exe at
      // 0x80010000, so the field carries the low bits only. Compare on those.
      const to = (((word & 0x03ffffff) << 2) >>> 0) & 0x0fffffff;
      if (!out.includes(to)) out.push(to);
    }
  }
  return out;
}

test("F0x800160A8 is two bands over two scalars, and the port answers it exactly", () => {
  const rt = boot();
  // Every index either side of the 0x1e boundary, against a spread of pairs that
  // includes both halves matching, only the key matching, only the companion, and
  // neither. Both polarities, because the routine takes the expectation in $a1.
  const pairs = [
    [0, 0], [1, 1], [5, 3], [30, 1], [1, 30], [30, 30], [31, 31], [2, 0x1e2],
    [0x1e, 0x1e2], [7, 9], [0xffff, 0xffff],
  ];
  const indices = [
    0, 1, 4, 5, 28, 29, 0x1d, 0x1e, 0x1f, 0x20, 32, 37, 0xff, 0x100, 0x1e1, 0x1e2, 0x1ff,
  ];
  let checked = 0;
  for (const [key, companion] of pairs) {
    publish(rt, key, companion);
    for (const index of indices) {
      for (const expected of [0, 1, 0xffff]) {
        const original = rt.cpu.call(ROUTE_READER, [index, expected]) & 1;
        assert.equal(
          routePairTest(index, expected, { key, companion }), original,
          `index ${index} expected ${expected} against key ${key} companion ${companion}`,
        );
        checked++;
      }
    }
  }
  assert.ok(checked > 300, "the sweep really ran");
});

test("the getter reads each half from the offset its own band names", () => {
  const rt = boot();
  // A key-only match must not be able to satisfy a companion index, and the reverse.
  publish(rt, 5, 0);
  assert.equal(rt.cpu.call(ROUTE_READER, [4, 1]) & 1, 1, "index 4 asks the key half for 5");
  assert.equal(rt.cpu.call(ROUTE_READER, [32, 1]) & 1, 0, "index 32 asks the companion half for 3");
  publish(rt, 0, 3);
  assert.equal(rt.cpu.call(ROUTE_READER, [4, 1]) & 1, 0);
  assert.equal(rt.cpu.call(ROUTE_READER, [32, 1]) & 1, 1);
  // The zero pair is addressable by no index at all — which is what makes the
  // unconditional store of a (0,0) record a real clear.
  publish(rt, 0, 0);
  for (const index of [0, 1, 29, 30, 37, 255, 511]) {
    assert.equal(rt.cpu.call(ROUTE_READER, [index, 1]) & 1, 0, `index ${index} on a cleared pair`);
  }
  // The port's own band split, read off the same numbers.
  assert.equal(routePairTarget(4).offset, ROUTE_KEY_OFFSET);
  assert.equal(routePairTarget(4).value, 5);
  assert.equal(routePairTarget(32).offset, ROUTE_COMPANION_OFFSET);
  assert.equal(routePairTarget(32).value, 3);
  assert.equal(ROUTE_PAIR_KEY_BAND, 30);
});

test("the bank is 0x7E — read out of the running dispatcher, not off the .s text", () => {
  const rt = boot();
  publish(rt, 5, 3);
  rt.mem.write8(SAVE + HELD + 4, 1);
  const wanted = ROUTE_READER;
  const banks = [];
  for (let bank = 0; bank <= 0xfe; bank += 2) {
    let reached = [];
    try {
      reached = callees(rt, GET_FLAG, [(bank << 8) | 4, 1]);
    } catch {
      reached = [];   // a bank whose handler lives in an overlay we did not load
    }
    if (reached.includes(jalField(wanted))) banks.push(bank);
  }
  assert.deepEqual(banks, [ROUTE_PAIR_BANK], `only bank 0x7E reaches F0x800160A8 (saw ${banks})`);
  // And it answers through the dispatcher, not only when called directly.
  assert.equal(rt.cpu.call(GET_FLAG, [(ROUTE_PAIR_BANK << 8) | 4, 1]) & 1, 1);
  assert.equal(rt.cpu.call(GET_FLAG, [(ROUTE_PAIR_BANK << 8) | 32, 1]) & 1, 1);
  // Bank 0x80 is an ITEM bank: its setter adds to the bag, its getter reads the counts.
  rt.mem.write8(SAVE + HELD + 7, 0);
  rt.cpu.call(SET_FLAG, [(0x80 << 8) | 7, 1]);
  assert.equal(rt.mem.read8(SAVE + HELD + 7), 1, "set_flag(0x8007, 1) put one item 7 in the bag");
  assert.equal(rt.cpu.call(GET_FLAG, [(0x80 << 8) | 7, 1]) & 1, 1);
  assert.ok(callees(rt, GET_FLAG, [(0x80 << 8) | 7, 1], 200).includes(jalField(BAG_READ)));
});

test("the item store and the pair are disjoint: adding an item touches neither half", () => {
  const rt = boot();
  for (const [key, companion] of [[5, 3], [0, 0], [30, 1]]) {
    publish(rt, key, companion);
    for (let id = 1; id <= 40; id++) {
      rt.mem.write8(SAVE + HELD + id, 7);
      rt.mem.write8(SAVE + 0x20f + id, 0);
    }
    // Add, then take, across a spread of ids and start counts.
    for (const [id, before] of [[1, 7], [7, 0], [23, 98], [40, 1]]) {
      rt.mem.write8(SAVE + HELD + id, before);
      rt.cpu.call(BAG_ADD, [id, 1]);
      assert.equal(rt.mem.read16(KEY), key, `add(${id}) left the key half alone`);
      assert.equal(rt.mem.read16(COMPANION), companion, `add(${id}) left the companion half alone`);
      rt.cpu.call(BAG_ADD, [id, 0]);
      assert.equal(rt.mem.read16(KEY), key, `remove(${id}) left the key half alone`);
      assert.equal(rt.mem.read16(COMPANION), companion, `remove(${id}) left the companion half alone`);
    }
  }
});

test("the pair a step publishes, from each of the two writer sites", () => {
  // The record the disc reads: params[5] at +0x14 and params[6] at +0x16, verbatim.
  const params = [0x111, 2, 3, 4, 5, 11, 22];
  assert.deepEqual(routePairFromParams(params), { key: 11, companion: 22 });
  // SITE A — op 1, in the executor's own convergence point (fieldstg.s:5773/:5778).
  assert.deepEqual(execPlaybackOp(1, 0, params).routeWords, { d78: 11, d7a: 22 });
  // SITE B — ops 9/10, whose executor arm writes nothing and whose LAUNCHER chain
  // writes the identical two fields (the launcher stashes `record + 0xa` at obj+0x7C
  // and the type-7 handler reads rec+0x0A / rec+0x0C = record+0x14 / +0x16).
  for (const op of [9, 10]) {
    assert.equal(execPlaybackOp(op, 0, params).routeWords, undefined,
      `the op-${op} executor body writes neither half`);
    assert.deepEqual(launcherRouteWords(op, params), { d78: 11, d7a: 22 },
      `the op-${op} launcher publishes what the op-1 door publishes`);
  }
  // Both sites produce the SAME pair from the SAME record, so the two writers cannot
  // disagree — which is definitional, not corroboration: site B reads op 1's fields.
  const door = execPlaybackOp(1, 0, params).routeWords;
  for (const op of [9, 10]) assert.deepEqual(launcherRouteWords(op, params), door);
  // An unkeyed record really does publish (0,0): neither store has a zero test.
  assert.deepEqual(execPlaybackOp(1, 0, [0, 0, 0, 0, 0, 0, 0]).routeWords, { d78: 0, d7a: 0 });
  assert.deepEqual(launcherRouteWords(10, [0, 0, 0, 0, 0, 0, 0]), { d78: 0, d7a: 0 });
});

test("ops 1, 9 and 10 are the only opcodes that reach a writer; every other reaches none", () => {
  const params = [0x111, 2, 3, 4, 5, 11, 22];
  for (const op of ROUTE_PAIR_PUBLISH_OPS) assert.ok(publishesRoutePair(op), `op ${op}`);
  // Op 14 is also a stage change and reaches NEITHER site — the handler at :5a30 calls
  // the pad walk and the handoff and returns.
  for (const op of [0, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15]) {
    assert.ok(!publishesRoutePair(op), `op ${op} does not publish`);
    assert.equal(execPlaybackOp(op, 0, params).routeWords, undefined,
      `op ${op} carries no route pair`);
    assert.equal(launcherRouteWords(op, params), undefined,
      `op ${op} reaches no launcher chain`);
  }
});

test("the published pair is what the bank-0x7E gates then read", () => {
  // A real shape: the s865-style NPC gated on route pair (4, 1) — one predicate from
  // each side of the 0x1e boundary. Publishing the record's params[5]/params[6] is what
  // makes those two predicates true on arrival, and unpublishing makes them false.
  const params = [0, 0, 0, 0, 0, 4, 1];
  const published = routePairFromParams(params);
  assert.equal(routePairPredicate(3, published), 1, "index 3 asks the key half for 4");
  assert.equal(routePairPredicate(0x1e, published), 1, "index 0x1e asks the companion half for 1");
  assert.equal(routePairPredicate(4, published), 0, "index 4 would need key 5");
  const cleared = routePairFromParams([0, 0, 0, 0, 0, 0, 0]);
  assert.equal(routePairPredicate(3, cleared), 0, "an unkeyed step clears the pair");
  assert.equal(routePairPredicate(0x1e, cleared), 0);
  // The disc agrees on the last one.
  const rt = boot();
  publish(rt, cleared.key, cleared.companion);
  assert.equal(rt.cpu.call(ROUTE_READER, [3, 1]) & 1, 0);
  publish(rt, published.key, published.companion);
  assert.equal(rt.cpu.call(ROUTE_READER, [3, 1]) & 1, 1);
  assert.equal(rt.cpu.call(ROUTE_READER, [0x1e, 1]) & 1, 1);
});
