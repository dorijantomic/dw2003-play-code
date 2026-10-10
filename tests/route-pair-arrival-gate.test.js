// What the player gets when the two writer sites run: the disc's own answer, on the
// disc's own memory, for the NPC gates the shipped data actually asks.
//
// The route pair at [D0x80048D34+0x44] / [+0x46] is written by exactly two sites, and
// both read a type-7 step record's params[5] / params[6] (engine/systems/route-pair.ts
// carries the decode, with the asm). This file closes the loop:
//
//   step record -> the walker's playback executor (which op publishes?) -> the pair
//   -> the disc's two scalar stores -> F0x800160A8, the bank-0x7E getter
//   -> the two predicates the shipped npc_flag_sets gate that route's cast on.
//
// The last three hops are the DISC's, executed through engine/native over
// web/assets/native/screens/resident.bin. The dispatcher loads each bank constant in the
// delay slot of the previous compare (exe/fns.s:6934-6958); pairing a constant with the
// call beside it would make the pair look like a bank-0x80 read.
//
// It fails on the pre-2026-10-03 engine port, which published the pair from op 1 only
// (the page then read the numbers off the converted exit row instead), and on the old
// commit rule, which wrote a zero of its own on every transition no step had published —
// so after an op-9/op-10 dive through the engine, or a plain door on a stage with no
// step program, the disc's getter answers 0 for both gates of the route's cast and the
// character that hole belongs to never appears.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
  ROUTE_KEY_OFFSET, ROUTE_COMPANION_OFFSET, ROUTE_PAIR_BANK,
  routePairFromParams, publishesRoutePair,
} from "../engine/systems/route-pair.ts";
import { execPlaybackOp, launcherRouteWords } from "../engine/systems/scene-step-ops.ts";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const STEPS = read("web/assets/data/story_steps.json").stages;
const NPC_FLAGS = read("web/assets/data/npc_flag_sets.json").flag_sets;

const resident = new Uint8Array(
  readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url)),
);
const overlay = new Uint8Array(
  readFileSync(new URL("../web/assets/native/screens/pro_stitshop.bin", import.meta.url)),
);
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const services = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };

const SAVE = 0x80048d34;
const KEY = SAVE + ROUTE_KEY_OFFSET;
const COMPANION = SAVE + ROUTE_COMPANION_OFFSET;
const GET_FLAG = 0x800163b0;

/** The disc's own bank getter, with the runtime's host stub removed. */
function boot() {
  const rt = new NativeStageRuntime(overlay, entry, services, undefined, undefined, 0x80082cb0, {
    image: resident, base: 0x80010000,
  });
  rt.cpu.gp = 0x8005cb50;
  rt.cpu.clearStub(GET_FLAG);
  return rt;
}

/** What the walker's executor publishes for a record, through either writer site. */
function publishedPair(op, params) {
  const effect = execPlaybackOp(op, 0, params);
  return effect.routeWords ?? launcherRouteWords(op, params) ?? null;
}

/** Every shipped record whose opcode reaches one of the two writer sites. */
function publishingRecords() {
  const out = [];
  for (const [stage, program] of Object.entries(STEPS)) {
    for (const record of program.steps ?? []) {
      if (!publishesRoutePair(record.op)) continue;
      out.push({ stage, op: record.op, params: record.params ?? [] });
    }
  }
  return out;
}

/**
 * The bank-0x7E predicates a route-gated NPC carries, as the (key, companion) its
 * two `expected=1` gates name. `null` for an NPC that is not route-gated.
 */
function gateIdsFor(key, companion) {
  const ids = [];
  for (const row of NPC_FLAGS) {
    for (const [id, expected] of row.gate ?? []) {
      if (((id >> 8) & 0xfe) !== ROUTE_PAIR_BANK || expected !== 1) continue;
      const index = id & 0x1ff;
      const wants = index < 0x1e ? index + 1 : index - 0x1d;
      const holds = index < 0x1e ? key : companion;
      if (wants === holds) ids.push(id);
    }
  }
  return ids;
}

/** Pairs the shipped gates demand of some NPC, with a real record that publishes each. */
function demandedPairs() {
  const shipped = new Set(
    publishingRecords().map((r) => {
      const pair = routePairFromParams(r.params);
      return `${pair.key}:${pair.companion}`;
    }),
  );
  const out = [];
  for (const row of NPC_FLAGS) {
    let key = null;
    let companion = null;
    for (const [id, expected] of row.gate ?? []) {
      if (expected !== 1) continue;
      const index = id & 0x1ff;
      if (index < 0x1e) key = index + 1;
      else companion = index - 0x1d;
    }
    if (key === null || companion === null) continue;
    const name = `${key}:${companion}`;
    if (out.some((o) => o.name === name)) continue;
    const record = publishingRecords().find((r) => {
      const pair = routePairFromParams(r.params);
      return `${pair.key}:${pair.companion}` === name;
    });
    if (!record || !shipped.has(name)) continue;
    out.push({ name, key, companion, ...record });
  }
  return out;
}

test("after either writer site runs, the disc's own getter answers its own cast's gates", () => {
  const cases = demandedPairs();
  assert.ok(cases.length >= 20, `the shipped route-gated casts (${cases.length} pairs)`);
  const rt = boot();
  for (const { name, key, companion, stage, op, params } of cases) {
    // 1. The walker's executor: which of the two writer sites does this opcode reach,
    //    and what does it read out of the record?
    const pair = publishedPair(op, params);
    assert.ok(pair, `${stage} op ${op} reaches neither writer site for ${name}`);
    // 2. The disc's two halfword stores, verbatim: no branch, no zero test between them.
    assert.deepEqual(
      { d78: pair.d78 & 0xffff, d7a: pair.d7a & 0xffff },
      { d78: key, d7a: companion },
      `${stage} op ${op} stores ${pair.d78},${pair.d7a} for the ${name} route`,
    );
    rt.mem.write16(KEY, key);
    rt.mem.write16(COMPANION, companion);
    // 3. The disc's getter, asked through its own dispatcher, on the gates the shipped
    //    npc data really gates that route's cast on.
    const gates = gateIdsFor(key, companion);
    assert.ok(gates.length > 0, `${name} gates no shipped NPC`);
    for (const id of gates) {
      assert.equal(rt.cpu.call(GET_FLAG, [id, 1]) & 1, 1,
        `${stage} op ${op}: gate 0x${id.toString(16)} answered false after the store`);
    }
    // 4. And the pair answers no gate that belongs only to a different route. A gate id
    //    is shared by every route with that key (or that companion), so only the
    //    exclusive ones can carry the statement.
    for (const other of cases.filter((c) => c.name !== name).slice(0, 4)) {
      const otherGates = new Set(gateIdsFor(other.key, other.companion));
      const exclusive = gates.filter((id) => !otherGates.has(id));
      if (!exclusive.length) continue;                   // the two routes share every gate
      rt.mem.write16(KEY, other.key);
      rt.mem.write16(COMPANION, other.companion);
      for (const id of exclusive) {
        assert.equal(rt.cpu.call(GET_FLAG, [id, 1]) & 1, 0,
          `${name}'s own gate 0x${id.toString(16)} still answered after ${other.name} was published`);
      }
    }
  }
});

test("a transition that reaches no writer site leaves both halves as they were", () => {
  // The disc has no other writer, so a cutscene handoff, an op-14 pad or a door on a
  // stage with no step program cannot clear the pair — the old commit rule wrote a zero
  // of its own there. Two of the 819 shipped exit rows are that shape (s260's door,
  // s410's gondola); tools/verify_route_pair_commit.mjs drives the first on the page.
  const rt = boot();
  rt.mem.write16(KEY, 7);
  rt.mem.write16(COMPANION, 3);
  for (const op of [0, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15]) {
    assert.equal(publishedPair(op, [0x111, 2, 3, 4, 5, 6, 7]), null,
      `op ${op} reaches no writer site`);
  }
  // Nothing was called, so the disc's memory still holds what the last writer left.
  assert.equal(rt.mem.read16(KEY), 7);
  assert.equal(rt.mem.read16(COMPANION), 3);
  assert.equal(rt.cpu.call(GET_FLAG, [0x7e00 | 6, 1]) & 1, 1, "key 7 still answers its gate");
  assert.equal(rt.cpu.call(GET_FLAG, [0x7e00 | 0x1e + 2, 1]) & 1, 1, "companion 3 still answers its gate");
  // A publishing record that names zeros IS a clear, because its stores are unconditional.
  const cleared = publishedPair(1, [0, 0, 0, 0, 0, 0, 0]);
  rt.mem.write16(KEY, cleared.d78);
  rt.mem.write16(COMPANION, cleared.d7a);
  assert.equal(rt.cpu.call(GET_FLAG, [0x7e00 | 6, 1]) & 1, 0, "an unkeyed step clears the key half");
  assert.equal(rt.cpu.call(GET_FLAG, [0x7e00 | 0x1e + 2, 1]) & 1, 0, "and the companion half");
});

test("every op-9 and op-10 dive the disc ships publishes a pair a shipped cast is gated on", () => {
  // The visible failure this closes: the Submarimon water entrances and the Circuit
  // Board holes are op 10 / op 9 records, and every route-gated cast hangs off one.
  const dives = publishingRecords().filter((r) => r.op === 9 || r.op === 10);
  assert.ok(dives.length > 30, `the shipped dives (${dives.length})`);
  for (const { stage, op, params } of dives) {
    const pair = publishedPair(op, params);
    assert.ok(pair, `${stage} op ${op} published nothing`);
    const { key, companion } = routePairFromParams(params);
    assert.deepEqual(pair, { d78: key, d7a: companion });
    if (key === 0 && companion === 0) continue;          // the climb-out holes
    assert.ok(gateIdsFor(key, companion).length > 0,
      `${stage} op ${op} publishes ${key},${companion}, which gates no shipped cast`);
  }
});

// ── Item-store gap 6 said these two halfwords were a "once per newly obtained item"
// marker the acquisition sparkle was played against. On the disc's own bytes: the only
// caller of the getter in the whole resident executable is the bank dispatcher, and the
// sparkle handler's own instructions materialise neither address. So the pair is not an
// item marker, and the sparkle is not gated on it. See
// docs/research/items/item-store-shared-system-2026-10-03.md § 5 (corrected 2026-10-03).

const SPARKLE_HANDLER = 0x80015d4c;      // bank-0x70 op 0x50, F0x80015d4c
const SPARKLE_END = 0x80015d90;
const GET_FLAG_END = 0x800165ac;

const wordAt = (addr) => {
  const off = addr - 0x80010000;
  return ((resident[off] | (resident[off + 1] << 8) | (resident[off + 2] << 16)
    | (resident[off + 3] << 24)) >>> 0);
};

test("only the bank dispatcher ever reads the pair, and the sparkle handler names neither half", () => {
  // Every `jal` in the resident image, and which one reaches F0x800160A8.
  const callers = [];
  for (let addr = 0x80010000; addr + 4 <= 0x80010000 + resident.length; addr += 4) {
    const w = wordAt(addr);
    if ((w & 0xfc000000) !== 0x0c000000) continue;
    if ((0x80000000 | ((w & 0x03ffffff) << 2)) >>> 0 !== 0x800160a8) continue;
    callers.push(addr);
  }
  assert.deepEqual(callers, [0x80016558],
    `the getter's only caller in the whole exe (saw ${callers.map((c) => c.toString(16))})`);
  assert.ok(callers[0] >= GET_FLAG && callers[0] < GET_FLAG_END,
    "and it sits inside the bank getter F0x800163B0");
  // The acquisition sparkle handler (op 0x50) materialises neither half: walk its own
  // instructions, resolving every lui/addiu/ori pair, and look for the two addresses.
  const high = new Map();
  const seen = new Set();
  for (let addr = SPARKLE_HANDLER; addr < SPARKLE_END; addr += 4) {
    const w = wordAt(addr);
    const op = w >>> 26;
    const rs = (w >>> 21) & 0x1f;
    const rt = (w >>> 16) & 0x1f;
    const imm = w & 0xffff;
    const immS = imm & 0x8000 ? imm - 0x10000 : imm;
    if (op === 0x0f) high.set(rt, (imm << 16) >>> 0);                       // lui
    if ((op === 0x09 || op === 0x0d) && high.has(rs)) {                     // addiu / ori
      const value = (high.get(rs) + (op === 0x0d ? immS : imm)) >>> 0;
      seen.add(value);
      high.set(rt, value);
    }
  }
  for (const half of [KEY, COMPANION]) {
    assert.ok(!seen.has(half >>> 0),
      `the sparkle handler materialises 0x${half.toString(16)}`);
  }
});

test("the sparkle rides the authored record, not a per-item latch", () => {
  // op 0x50 is an unconditional action (`li $v0,1` then `jr $ra`, no branch and no
  // load of either half), so the disc plays it once per authored 0x7013 and never
  // suppresses it. The walker emits it from those same records, beside the grant.
  const w = wordAt(SPARKLE_HANDLER + 0x38);
  assert.equal(w >>> 0, 0x24020001, "op 0x50 ends in `li $v0, 1`");
  const content = read("web/assets/engine-content.json");
  let sparkles = 0;
  let besideGrant = 0;
  for (const stage of content.stages) {
    for (const script of stage.scripts ?? []) {
      const ops = (script.program ?? []).map((i) => i.op);
      if (!ops.includes("PlaySparkle")) continue;
      sparkles++;
      if (ops.includes("GiveItem") || ops.includes("AddMoney") || ops.includes("SetFlag")) {
        besideGrant++;
      }
    }
  }
  assert.ok(sparkles > 100, `the shipped sparkle records (${sparkles})`);
  assert.ok(besideGrant / sparkles > 0.9,
    `almost every sparkle rides a grant record (${besideGrant}/${sparkles})`);
});
