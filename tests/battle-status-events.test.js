/**
 * THE STATUS-EVENT POOL — the census and one behaviour test per ported code.
 *
 * Everything asserted here is read out of the shipped disc image
 * (`web/assets/native/screens/pro_fightstg.bin`, `pro/wfightmn.bin`,
 * `resident.bin`) or out of the assembly the comments quote, so the port cannot drift
 * from the code it claims to be a port of.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STATUS_EVENT_POOL_SIZE, STATUS_EVENT_STRIDE, STATUS_EVENT_CODES,
  STATUS_EVENT_OPCODE_PARAMS, STATUS_EVENT_KEEP_QUEUED_CODES,
  STATUS_EVENT_LOCK_CODES, STATUS_EVENT_STAT_CODES,
  emptyStatusEventPool, findStatusEvent, enqueueStatusEvent, preemptStatusEvent,
  pickNextStatusEvent, removeStatusEvent, statusEventFreesSlot,
  statusEventIsqrt, statusEventDelay, statusEventActionDelay, statusEventClamp,
  statusEventStatDelay, statusEventStatDelayUnrefreshing, statusEventLockDelay,
  stageStatusEventStat, stageStatusEventLock, statusEventLockHeld,
  statusEventLockIndex, statusEventLockBit, statusEventStatIndex,
  advanceStatusEvents,
  STATUS_EVENT_AILMENTS, STATUS_EVENT_DELAY_ARMS, STATUS_EVENT_CONSUMER_ACTION_TYPES,
  STATUS_EVENT_ACTION_HANDLERS, statusEventActionType, statusEventActionHandler,
  statusEventAilmentBit, statusEventAilmentCode, statusEventAilmentDelay,
  statusEventConfusionDelay, statusEventDelayArm, statusEventDivide2710,
  statusEventRecoveryDelay, statusEventTickDelay, cureStatusEvent, cureAllStatusEvents,
  STATUS_EVENT_ALL_CURE_CODES,
  stageStatusEventAilment, stageStatusEventSideTick,
} from "../engine/dw3/battle-status-events.ts";

const FIGHTSTG_BASE = 0x80082cb0;
const WFIGHTMN_BASE = 0x800a5de0;
const RESIDENT_BASE = 0x80010000;

function overlay(path, base) {
  const bytes = readFileSync(path);
  return {
    u16: (addr) => bytes.readUInt16LE(addr - base),
    u32: (addr) => bytes.readUInt32LE(addr - base),
    raw: (addr, n) => bytes.subarray(addr - base, addr - base + n),
  };
}

const fight = overlay("web/assets/native/screens/pro_fightstg.bin", FIGHTSTG_BASE);
const mn = overlay("web/assets/native/screens/pro_wfightmn.bin", WFIGHTMN_BASE);
const exe = overlay("web/assets/native/screens/resident.bin", RESIDENT_BASE);

/** One technique record at `0x80042bca + 18 * id` (`pro/fightstg.s:27024`-`:27040`). */
function techniqueRecord(id) {
  const off = 0x80042bca - RESIDENT_BASE + id * 18;
  return readFileSync("web/assets/native/screens/resident.bin").subarray(off, off + 18);
}

// ---------------------------------------------------------------------------
// The census: the code's member list must EQUAL the decoded list.
// ---------------------------------------------------------------------------

test("CENSUS: the pool is 99 slots of 28 bytes, as the stager's own bound says", () => {
  // `sltiu $v0, $v0, 0x63` :25756 / `:25760` and `addiu $a1, 0x1c` :25764.
  assert.equal(STATUS_EVENT_POOL_SIZE, 0x63);
  assert.equal(STATUS_EVENT_STRIDE, 0x1c);
  assert.equal(emptyStatusEventPool().length, 99);
});

test("CENSUS: every code any stager in fightstg stages is on exactly one decided row", () => {
  // The twenty-four stagers, read out of the assembly by their own literal: each routine
  // in 0x8009c4bc..0x8009d06c writes ONE code word, so the code list is mechanical.
  // `li $v0, <code>` immediately after `addiu $v0, 0x4780` (the shared request struct).
  const staged = [
    [0x8009c4bc, 0x02], // :26537 `li $v1, 0x2`  -- player turn
    [0x8009c4f8, 0x03], // :26577 `li $v1, 0x3`  -- enemy turn
    [0x8009c534, 0x01], // :26598 `li $v0, 0x1`  -- battle outcome
    [0x8009c578, 0x04], // :26616 `li $v0, 0x4`  -- the -1 special command
    [0x8009c5e8, 0x05], // :26651 `li $v0, 0x5`  -- per-side status tick
    [0x8009c6a4, 0x06], // :26700 `li $v0, 0x6`  -- per-fighter timed event
    [0x8009c740, 0x07], // :26744 `li $v0, 0x7`  -- global timed event
    [0x8009c7d4, 0x09], // :26790 `li $v0, 0x9`  -- poison tick
    [0x8009c8b0, 0x0a], // :26760 `li $a0, 0xa`  -- FROZEN recovery (sets record bit 0x02)
    [0x8009c9c0, 0x0b], // :26833 `li $a0, 0xb`  -- CONFUSED recovery (sets record bit 0x04)
    [0x8009cb10, 0x0c], // :26918 `li $a0, 0xc`  -- ASLEEP recovery (sets record bit 0x08)
    [0x8009cc20, 0x0d], // `.L0x800a43e0[0]` -- attack expiry
    [0x8009cd1c, 0x10], // `.L0x800a43ec[0]` -- no-flee expiry
    [0x8009ce84, 0x08], // :27114 `li $v1, 0x8`
    [0x8009ced0, 0x12], // :27182 `li $v0, 0x12`
    [0x8009cf00, 0x13], // :27207 `li $v0, 0x13`
    [0x8009cf54, 0x14], // :27228 `li $v0, 0x14`
    [0x8009cfb0, 0x15], // :27254 `li $v0, 0x15`
    [0x8009cff4, 0x16], // :27277 `li $v0, 0x16`
    [0x8009d038, 0x17], // :27300 `li $v0, 0x17`
    [0x8009d06c, 0x18], // :27325 `li $v0, 0x18`
  ];
  const shippedCodes = [
    ...STATUS_EVENT_CODES.map((r) => r.code),
  ].sort((a, b) => a - b);
  // 0x8009cc20 also stages 0x0e and 0x0f, and 0x8009cd1c also stages 0x11, so the two
  // three-word tables at `.L0x800a43e0` and `.L0x800a43ec` supply the rest.
  const tableCodes = [
    ...STATUS_EVENT_STAT_CODES, ...STATUS_EVENT_LOCK_CODES,
  ].sort((a, b) => a - b);
  const decoded = [...new Set([...staged.map(([, c]) => c), ...tableCodes])]
    .sort((a, b) => a - b);
  assert.deepEqual(shippedCodes, decoded,
    "the module's rows must be exactly the codes the stagers produce");
  // Every stager address named by a row is a real routine in the disc image.
  for (const row of STATUS_EVENT_CODES) {
    if (row.stager === null) continue;
    // A FIGHTSTG_F0x8009* stager's first instruction is `addiu $sp, -N` (0x27bd....).
    const word = fight.u32(row.stager);
    assert.equal(word >>> 16, 0x27bd,
      `stager ${row.stager.toString(16)} (code 0x${row.code.toString(16)}) `
      + "does not begin a routine in the shipped fightstg image");
  }
});

test("CENSUS: the code tables the two multi-code stagers index are the shipped ones", () => {
  // `.L0x800a43e0` = 0x0d/0x0e/0x0f and `.L0x800a43ec` = 0x10/0x11
  // (`pro/fightstg.s:34880`-`:34881` / `:34883`-`:34884`).
  const statTable = [0, 1, 2].map((i) => fight.u32(0x800a43e0 + i * 4));
  const lockTable = [0, 1].map((i) => fight.u32(0x800a43ec + i * 4));
  assert.deepEqual(statTable, [0x0d, 0x0e, 0x0f]);
  assert.deepEqual(lockTable, [0x10, 0x11]);
  assert.deepEqual([...STATUS_EVENT_STAT_CODES], statTable);
  assert.deepEqual([...STATUS_EVENT_LOCK_CODES], lockTable);
});

test("CENSUS: every row's port state is decided, and each names a stager", () => {
  for (const row of STATUS_EVENT_CODES) {
    assert.ok(row.portState === "ported" || row.portState === "named-not-ported",
      `code 0x${row.code.toString(16)} has no decided port state`);
    if (row.portState === "named-not-ported") {
      assert.ok(row.reason && row.reason.length > 20,
        `code 0x${row.code.toString(16)} is named-not-ported without a reason`);
    }
    assert.ok(typeof row.name === "string" && row.name.length > 0);
  }
  // The category-5 members are the three stats and the two locks -- exactly what the
  // arms stage (docs/research/battle/battle-formula-leaves.md 3b). Codes 2 and 3 are
  // ported too: they ARE the turn events, and the timeline advance in web/battle.js is
  // their port.
  const ported = STATUS_EVENT_CODES.filter((r) => r.portState === "ported")
    .map((r) => r.code).sort((a, b) => a - b);
  assert.deepEqual(ported,
    [0x02, 0x03, 0x05, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11]);
});

test("CENSUS: the consumer table has one row per code, so nothing is staged unhandled", () => {
  // `sltiu $v0, $v1, 0x18` :4092 with `index = code - 1` (:4090) -- codes 1..0x18.
  const rows = [];
  for (let i = 0; i < 0x18; i++) rows.push(mn.u32(0x800a5e6c + i * 4));
  assert.equal(rows.length, 24);
  for (const row of STATUS_EVENT_CODES) {
    const handler = rows[row.code - 1];
    assert.ok(handler, `code 0x${row.code.toString(16)} has no consumer`);
    // Every consumer but code 3's is the four-instruction setState thunk
    // (`move_ $a0, $s0` / `lw $v0, 0x2c($a0)` / `j 0x800a9fd4` / `li $a1, <state>`).
    // Code 3's is the one real body -- the enemy-action-completion arm that reads
    // `0x800a44d6` and either frees a pending code-6 entry or hands the turn on.
    if (row.code === 0x03) continue;
    const body = mn.raw(handler, 16);
    assert.equal(body.readUInt32LE(0), 0x02002021, // move_ $a0, $s0
      `code 0x${row.code.toString(16)}'s consumer is not the setState thunk`);
  }
});

test("CENSUS: the per-opcode delay triples are the shipped table at 0x800a4384", () => {
  const shipped = [];
  for (let op = 0; op < 13; op++) {
    const base = 0x800a4384 + op * 6;
    shipped.push([fight.u16(base), fight.u16(base + 2), fight.u16(base + 4)]);
  }
  assert.deepEqual(STATUS_EVENT_OPCODE_PARAMS.map((t) => [...t]), shipped);
  // The corrections the leaves document already carry: op 2's base is 2001 and its max
  // is ZERO (no upper bound), and ops 3..7 all have a non-zero base.
  assert.deepEqual(shipped[2], [2001, 1001, 0]);
  assert.deepEqual(shipped.slice(3, 8).map((t) => t[0]), [2000, 2500, 3000, 3500, 4000]);
  assert.deepEqual(shipped[8], [0, 2000, 6000]);
  assert.deepEqual(shipped[12], [2001, 0, 0]);
});

test("CENSUS: the free-on-fire table at 0x800a3800 keeps exactly 4/6/9 queued", () => {
  const keep = [];
  for (let code = 0; code <= 0x18; code++) {
    const word = fight.u32(0x800a3800 + code * 4);
    if (word === 0xffffffff) keep.push(code);
  }
  assert.deepEqual(keep, [...STATUS_EVENT_KEEP_QUEUED_CODES]);
  assert.equal(statusEventFreesSlot(0x10), true);
  assert.equal(statusEventFreesSlot(0x09), false);
});

// ---------------------------------------------------------------------------
// One behaviour test per PORTED code.
// ---------------------------------------------------------------------------

test("CODE 0x0d / 0x0e / 0x0f: a stat change wears off after its own delay", () => {
  const pool = emptyStatusEventPool();
  const rand = () => 0.5; // 0x8000, so `rand % 2001` is deterministic below.
  const draw = Math.trunc(0.5 * 0x10000) % 2001;
  const spt = 100;
  const expected = 2000 + draw + 10 * spt;
  for (const [stat, code] of [[0, 0x0d], [1, 0x0e], [2, 0x0f]]) {
    const at = stageStatusEventStat(pool, 0x10, 0, stat, spt, rand);
    assert.ok(at >= 0, `stat ${stat} did not stage`);
    assert.equal(pool[at].code, code);
    assert.equal(pool[at].time, expected);
    assert.equal(pool[at].side, 0x10, "the side the arm chose, raw (0 or 0x10)");
    assert.equal(pool[at].payload, stat, "the stat index rides payload 1");
  }
  // Nothing expires before the delay is spent. One action is
  // `statusEventActionDelay(100, 100)` = 1000 units, so three actions are short and
  // the fourth is not.
  const action = statusEventActionDelay(100, 100);
  const fired = [];
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(advanceStatusEvents(pool, action), [],
      `action ${i + 1} is short of the ${expected}-unit delay`);
  }
  let guard = 0;
  while (guard++ < 20) {
    const got = advanceStatusEvents(pool, action);
    for (const e of got) fired.push(e);
    if (got.length) break;
  }
  assert.equal(fired.length, 3, "all three stat codes came due on the same action");
  // Two more actions bring the other two round.
  guard = 0;
  while (guard++ < 20 && fired.length < 3) {
    for (const e of advanceStatusEvents(pool, action)) fired.push(e);
  }
  assert.deepEqual(fired.map((e) => e.code).sort((a, b) => a - b), [0x0d, 0x0e, 0x0f]);
  assert.deepEqual(fired.map((e) => e.stat).sort((a, b) => a - b), [0, 1, 2]);
  assert.ok(fired.every((e) => e.kind === "stat" && e.side === 0x10 && e.slot === 0));
  // Every slot is free again -- the fire freed them (`sh $zr, ($v0)` :25864).
  assert.equal(pool.filter((e) => e.code !== 0).length, 0);
});

test("CODE 0x0d: a second cast REFRESHES the pending expiry instead of stacking one", () => {
  // `FIGHTSTG_F0x8009cc20`'s find-then-refresh: an existing `{code, side, slot}` entry's
  // `+0x02` is REPLACED (`sh $a2, 0x2($v0)` :27016), never duplicated.
  const pool = emptyStatusEventPool();
  const first = stageStatusEventStat(pool, 0, 0, 0, 100, () => 0.0);
  const t0 = pool[first].time;
  const second = stageStatusEventStat(pool, 0, 0, 0, 100, () => 0.999);
  assert.equal(second, first, "the refresh keeps the same slot");
  assert.equal(pool.filter((e) => e.code === 0x0d).length, 1);
  assert.notEqual(pool[first].time, t0, "the new delay replaced the old one");
  // A DIFFERENT stat on the same fighter is its own entry.
  const other = stageStatusEventStat(pool, 0, 0, 2, 100, () => 0.999);
  assert.notEqual(other, first);
  assert.equal(statusEventStatIndex(pool[other].code), 2);
});

test("CODE 0x10: the no-flee lock is queued, expires, and is released", () => {
  const pool = emptyStatusEventPool();
  // 211's own record `+0x0c` is 0x18 = 24 (read from the disc, not hand-fed).
  const magnitude = techniqueRecord(211)[0x0c];
  assert.equal(magnitude, 0x18);
  const index = stageStatusEventLock(pool, 0, 0, magnitude, () => 0.5);
  assert.equal(pool[index].code, 0x10);
  assert.equal(pool[index].side, 0, "`FIGHTSTG_F0x8009cd1c` takes the PLAYER side");
  assert.equal(pool[index].payload, 0, "lock 0");
  const draw = Math.trunc(0.5 * 0x10000) % 101;
  assert.equal(pool[index].time, (draw + 100) * magnitude);
  assert.equal(statusEventLockHeld(pool, 0, 0, 0), true);
  assert.equal(statusEventLockHeld(pool, 1, 0, 0), false);
  assert.deepEqual(advanceStatusEvents(pool, pool[index].time - 1), [],
    "one unit short of the delay, nothing fires");
  const fired = advanceStatusEvents(pool, 1);
  assert.equal(fired.length, 1, "the last unit of the delay fires it");
  assert.equal(pool.filter((e) => e.code !== 0).length, 0,
    "code 0x10 is NOT in the keep-queued table, so its slot was freed");
  assert.equal(fired[0].kind, "lock");
  assert.equal(fired[0].lock, 0);
  assert.equal(fired[0].bit, 0x10, "`ori $v0, 0x10` :27134 -- record +0x1c bit 0x10");
  assert.equal(statusEventLockHeld(pool, 0, 0, 0), false, "the pool released it");
});

test("CODE 0x11: the no-digivolve lock is a DIFFERENT code, slot entry and bit", () => {
  const pool = emptyStatusEventPool();
  const magnitude = techniqueRecord(212)[0x0c];
  assert.equal(magnitude, 0x18);
  const index = stageStatusEventLock(pool, 1, 0, magnitude, () => 0.25);
  assert.equal(pool[index].code, 0x11);
  assert.equal(pool[index].payload, 1);
  const fired = advanceStatusEvents(pool, pool[index].time);
  assert.equal(fired[0].code, 0x11);
  assert.equal(fired[0].bit, 0x20, "`ori $v0, 0x20` :27141 -- record +0x1c bit 0x20");
  assert.equal(statusEventLockIndex(0x11), 1);
  assert.equal(statusEventLockBit(0x11), 0x20);
  // 211's and 212's dispatch bytes are what pick the code (`:27050` `lbu $v1, 0xa($s4)`,
  // `:27064` `xori $v0, $v1, 0xe`).
  assert.equal(techniqueRecord(211)[0x0a], 13);
  assert.equal(techniqueRecord(212)[0x0a], 14);
});

// ---------------------------------------------------------------------------
// The pool's own mechanics.
// ---------------------------------------------------------------------------

test("the delta queue: one advance subtracts from EVERY entry, not just the fired one", () => {
  const pool = emptyStatusEventPool();
  enqueueStatusEvent(pool, { code: 0x0d, time: 500, side: 0, slot: 0, payload: 0, payload2: 0 });
  enqueueStatusEvent(pool, { code: 0x0e, time: 900, side: 0, slot: 1, payload: 1, payload2: 1 });
  const pick = pickNextStatusEvent(pool);
  assert.equal(pick.code, 0x0d);
  assert.equal(pick.time, 500);
  // `subu $v0, $a2` / `sh $v0, 0x2($v1)` :25830-:25834 -- EVERY queued entry loses 500.
  assert.equal(pool.find((e) => e.code === 0x0e).time, 400);
  assert.equal(pool.find((e) => e.code === 0x0d).time, 0);
});

test("the preempt enqueue pushes everything back and fires its own request next", () => {
  // `FIGHTSTG_F0x8009b9d0`: add max(2, time) to every entry, insert with time 1.
  const pool = emptyStatusEventPool();
  enqueueStatusEvent(pool, { code: 0x03, time: 1000, side: -1, slot: -1, payload: 0, payload2: 0 });
  const index = preemptStatusEvent(pool, { code: 0x01, time: 0, side: -1, slot: -1, payload: 0, payload2: 0 });
  assert.equal(pool[index].time, 1);
  assert.equal(pool.find((e) => e.code === 0x03).time, 1002, "max(2, 0) pushed it back 2");
  const pick = pickNextStatusEvent(pool);
  assert.equal(pick.code, 0x01, "the preempted entry fires first");
});

test("find and remove match on code AND side AND slot", () => {
  const pool = emptyStatusEventPool();
  enqueueStatusEvent(pool, { code: 0x0d, time: 100, side: 0x10, slot: 2, payload: 0, payload2: 0 });
  assert.equal(findStatusEvent(pool, 0x0d, 0x10, 2), 0);
  assert.equal(findStatusEvent(pool, 0x0d, 0, 2), -1, "the side must match");
  assert.equal(findStatusEvent(pool, 0x0e, 0x10, 2), -1, "the code must match");
  assert.equal(findStatusEvent(pool, 0x0d, 0x10, 1), -1, "the slot must match");
  assert.equal(removeStatusEvent(pool, 0x0d, 0x10, 2), true);
  assert.equal(findStatusEvent(pool, 0x0d, 0x10, 2), -1);
  assert.equal(removeStatusEvent(pool, 0x0d, 0x10, 2), false);
});

/** One pool slot, written the way `F0x8009b930` fills it. */
function entry(code, time, side, slot, payload) {
  return { code, time, side, slot, payload, payload2: payload };
}

test("the pick: a code 2/3 incumbent yields, any other code keeps the earlier slot", () => {
  // The scan reads the INCUMBENT's code, not the newcomer's: `lhu $v0, ($v1)` /
  // `addiu $v0, -0x2` / `sltiu $v0, 0x2` / `beqz $v0, keep` (pro/fightstg.s:25804-:25812).
  // So a newcomer that is NOT strictly earlier only displaces an incumbent whose code is
  // 2 or 3. Everything else keeps the earliest slot it found.
  const pool = emptyStatusEventPool();
  pool[0] = entry(0x0d, 500, 0, 0, 0);
  pool[3] = entry(0x02, 500, 0, 0, 0);
  const pick = pickNextStatusEvent(pool);
  assert.equal(pick.index, 0, "an ordinary incumbent keeps a tie against code 2");
  assert.equal(pick.code, 0x0d);

  // Now the incumbent IS code 2, and the newcomer's time is not strictly earlier, so the
  // priority test lets the newcomer take over.
  const pool2 = emptyStatusEventPool();
  pool2[0] = entry(0x02, 500, 0, 0, 0);
  pool2[9] = entry(0x0d, 900, 0, 0, 0);
  assert.equal(pickNextStatusEvent(pool2).index, 9, "a code 2 incumbent yields");

  // Two ordinary codes tie: the earlier slot keeps it, because the incumbent's code is
  // not 2 or 3 so the priority test fails.
  const pool3 = emptyStatusEventPool();
  pool3[2] = entry(0x0d, 700, 0, 0, 0);
  pool3[6] = entry(0x0e, 700, 0, 0, 0);
  assert.equal(pickNextStatusEvent(pool3).index, 2);

  // And a strictly earlier newcomer always wins, whatever the incumbent's code.
  const pool4 = emptyStatusEventPool();
  pool4[1] = entry(0x03, 800, 0, 0, 0);
  pool4[8] = entry(0x0e, 400, 0, 0, 0);
  assert.equal(pickNextStatusEvent(pool4).index, 8);
});

test("the delay: the isqrt and the speed ratio are the routine's own arithmetic", () => {
  // The ten-step Babylonian loop seeded at 999 (`li $a0, 0x3e7` / `li $a1, 0x9`).
  assert.equal(statusEventIsqrt(10000), 100);
  assert.equal(statusEventIsqrt(10201), 101);
  assert.equal(statusEventIsqrt(1), 1);
  // `trunc(1000 * opp / isqrt(own * opp))` clamped to [707, 1414] -- the numerator is the
  // OTHER side: `$a3` holds the second getter call's result (the `move_ $s0, $v0` in that
  // jalr's delay slot keeps the first, handed-side result in `$s0`), and the multiply
  // reads `lh $v0, 0xa($a3)` at 0x8009c284.
  assert.equal(statusEventActionDelay(100, 100), 1000);
  assert.equal(statusEventActionDelay(200, 50), 707, "a faster own side waits LESS (500 -> floor 707)");
  assert.equal(statusEventActionDelay(50, 200), 1414, "a slower own side waits MORE (2000 -> ceiling 1414)");
  assert.equal(statusEventActionDelay(100, 81), Math.trunc((1000 * 81) / statusEventIsqrt(8100)));
  assert.equal(statusEventDelay(3, { own: 400, opp: 100 }), 1000, "opcode 3: 2000 * sqrt(100/400)");
  // Opcode 1 is a quarter of a turn; opcode 3..7 scale the base.
  assert.equal(statusEventDelay(1, { own: 100, opp: 100 }), 250);
  assert.equal(statusEventDelay(3, { own: 100, opp: 100 }), 2000);
  assert.equal(statusEventDelay(7, { own: 100, opp: 100 }), 4000);
});

test("the two stat delays: opcode 12 (refresh path) and opcode 8 (fresh path)", () => {
  // Opcode 12 -- `2000 + rand % 2001 + 10 * own[+0x06]` (`:26087`-`:26110`).
  // `2000 + rand % 2001 + 10 * own[+0x06]` -- the spirit term is the last addend, so a
  // spirit of 100 already makes it 3000.
  assert.equal(statusEventStatDelay(100, () => 0), 2000 + 0 + 1000);
  assert.equal(statusEventStatDelay(100, () => 0.5), 2000 + (0x8000 % 2001) + 1000);
  // 0.99999 * 0x10000 rounds to 0x10000, so the draw is taken modulo 0x10000 first.
  assert.equal(statusEventStatDelay(0, () => 0.9999), 2000 + (0xfff9 % 2001));
  // Opcode 8 -- `clamp(rand % 8001, 2000, 6000)` (`:26090`-`:26100`, triple `[0,2000,6000]`).
  assert.equal(statusEventStatDelayUnrefreshing(() => 0), 2000);
  assert.equal(statusEventStatDelayUnrefreshing(() => 0.5), statusEventClamp(0x8000 % 8001, 8));
  // `div` is on the raw 16-bit draw, so a draw past 8001 wraps back into the window and
  // the 6000 upper bound is reachable but not automatic.
  assert.equal(statusEventStatDelayUnrefreshing(() => 0.99999),
    statusEventClamp(0xfffe % 8001, 8));
  assert.equal(statusEventClamp(9000, 8), 6000, "the upper bound is 6000");
});

test("the lock delay divides by 101 and multiplies the technique's own +0x0c", () => {
  // `lui $v1, 0x288d` / `ori $v1, 0xf0cb` -> the magic 0x288df0cb for /101, and the
  // 101*q rebuild at `:27096`-`:27100`. 211 and 212 both carry `+0x0c` = 0x18 = 24.
  for (const mag of [24]) {
    for (const draw of [0, 1, 100, 101, 5000, 32767, 65535]) {
      const want = (draw % 101 + 100) * mag;
      const got = statusEventLockDelay(mag, () => draw / 0x10000);
      assert.equal(got, want, `draw ${draw}`);
    }
  }
  assert.equal(statusEventLockDelay(24, () => 0), 100 * 24);
  assert.equal(statusEventLockDelay(24, () => 101 / 0x10000), 100 * 24,
    "draw 101 is 101 % 101 = 0 -- the ladder's own wrap");
  assert.equal(statusEventLockDelay(24, () => 102 / 0x10000), 101 * 24);
  assert.equal(statusEventLockDelay(24, () => 200 / 0x10000), 199 * 24);
});

test("a full 99-slot pool refuses the hundredth entry", () => {
  const pool = emptyStatusEventPool();
  for (let i = 0; i < 99; i++) {
    assert.ok(enqueueStatusEvent(pool, { code: 2, time: i + 1, side: -1, slot: -1, payload: 0, payload2: 0 }) >= 0);
  }
  assert.equal(enqueueStatusEvent(pool, { code: 2, time: 1, side: -1, slot: -1, payload: 0, payload2: 0 }), -1);
});
// ---------------------------------------------------------------------------
// The consumer chain, read out of the shipped images.
// ---------------------------------------------------------------------------

test("CENSUS: every code's consumer thunk is the one the table names, with its own opcode", () => {
  // Row `code - 1` of the 24-row table at 0x800a5e6c is a thunk whose FOURTH instruction
  // is `li $a1, <action type>` — except code 3's, which is the one real body.
  const got = [];
  for (let code = 1; code <= 0x18; code++) {
    const handler = mn.u32(0x800a5e6c + (code - 1) * 4);
    if (code === 3) {
      // Code 3's entry is the one REAL body (the mode-gated arm). Its three sub-arms all
      // end at the same common tail with `li $a1, 0x2` (`pro/wfightmn.s:4129`).
      const body = mn.raw(handler, 0x40);
      let tail = null;
      for (let o = 0; o + 4 <= body.length; o += 4) {
        if (body.readUInt32LE(o) === 0x24050002) tail = 2;
      }
      got.push(tail);
      continue;
    }
    assert.equal(mn.u32(handler), 0x02002021, `code ${code}'s thunk does not start`);
    assert.equal(mn.u32(handler + 4), 0x8c82002c, `code ${code}'s thunk does not read +0x2c`);
    assert.equal(mn.u32(handler + 8), 0x0802a7f5, `code ${code}'s thunk does not tail-call`);
    got.push(mn.u32(handler + 12) & 0xffff);
  }
  assert.deepEqual(got, [...STATUS_EVENT_CONSUMER_ACTION_TYPES],
    "each code's action type must be the `li $a1, N` its own thunk carries");
  for (const code of [0x05, 0x09, 0x0a, 0x0b, 0x0c]) {
    assert.equal(statusEventActionType(code), STATUS_EVENT_CONSUMER_ACTION_TYPES[code - 1]);
  }
  assert.equal(statusEventActionType(0x19), null, "a code outside 1..0x18 has no consumer");
});

test("CENSUS: the action-type table at 0x800aade4 is the shipped one, three slots empty", () => {
  // `lui $v0, 0x800b` + `addiu $v0, -0x521c` = 0x800aade4, indexed `actionType - 3`.
  const shipped = [];
  for (let type = 3; type <= 0x1a; type++) {
    const word = mn.u32(0x800aade4 + (type - 3) * 4);
    shipped.push(word === 0 ? null : word);
  }
  assert.deepEqual([...STATUS_EVENT_ACTION_HANDLERS], shipped);
  assert.deepEqual(shipped.slice(0, 3), [null, null, null],
    "action types 3/4/5 are zero in the disc image -- run-time populated, not readable");
  // Every named handler is a real routine in the shipped overlay (`addiu $sp, -N`).
  for (const [i, handler] of shipped.entries()) {
    if (handler === null) continue;
    assert.equal(mn.u32(handler) >>> 16, 0x27bd,
      `action type ${(i + 3).toString(16)}'s handler ${handler.toString(16)} is not a routine`);
  }
  // The five codes this job is about, each with the machine its own chain reaches.
  assert.deepEqual(
    [0x05, 0x09, 0x0a, 0x0b, 0x0c].map((c) => statusEventActionHandler(c)),
    [0x800a7b08, 0x800a8118, 0x800a8260, 0x800a8458, 0x800a84d0]);
});

test("CENSUS: the delay routine's eleven-row jump table is the shipped one", () => {
  // 0x800831e4 indexed `opcode - 2`; the DEFAULT arm 0x8009c1bc is the shared entry for
  // opcodes 3..7 and for every opcode outside 2..12.
  const shipped = [];
  for (let op = 2; op <= 12; op++) {
    const arm = fight.u32(0x800831e4 + (op - 2) * 4);
    shipped.push(arm === 0x8009c1bc ? null : arm);
  }
  assert.deepEqual([...STATUS_EVENT_DELAY_ARMS], shipped);
  assert.deepEqual(shipped, [0x8009bdf4, null, null, null, null, null,
    0x8009be7c, 0x8009bec8, 0x8009bf90, 0x8009c058, 0x8009c130]);
  for (let op = 2; op <= 12; op++) assert.equal(statusEventDelayArm(op), shipped[op - 2]);
  assert.equal(statusEventDelayArm(0), null, "opcode 0 is outside the table");
  assert.equal(statusEventDelayArm(13), null, "opcode 13 is outside the table");
});

test("CENSUS: each ailment's code and record bit are the shipped stager's own two writes", () => {
  // The four-byte bit table at 0x800a43dc (`0x3f040201`) and the four-byte code table at
  // 0x800a43d4 (`0x0c0b0a09`) are the disc's own `FIGHTSTG_F0x8009c330` pair.
  const bits = [0, 1, 2, 3].map((i) => fight.raw(0x800a43dc + i, 1)[0]);
  const codes = [0, 1, 2, 3].map((i) => fight.raw(0x800a43d4 + i, 1)[0]);
  assert.deepEqual(bits, [0x01, 0x02, 0x04, 0x3f]);
  assert.deepEqual(codes, [0x09, 0x0a, 0x0b, 0x0c]);
  // Row `which` 3 is the "every ailment" cure, not a fifth ailment, so the three single
  // ailment rows are the first three and row 3 clears all of them at once.
  assert.deepEqual([...codes, ...bits], [0x09, 0x0a, 0x0b, 0x0c, 0x01, 0x02, 0x04, 0x3f]);
  const rows = STATUS_EVENT_AILMENTS.map((r) => [r.code, r.bit]);
  const expected = codes.map((c, i) => [c, bits[i] === 0x3f ? 0 : bits[i]]);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i][0], expected[i][0], `ailment row ${i} code`);
    if (expected[i][1] !== 0) assert.equal(rows[i][1], expected[i][1], `ailment row ${i} bit`);
  }
  assert.equal(statusEventAilmentCode("poison"), 0x09);
  assert.equal(statusEventAilmentBit("poison"), 0x01);
  assert.equal(statusEventAilmentCode("frozen"), 0x0a);
  assert.equal(statusEventAilmentBit("frozen"), 0x02);
  assert.equal(statusEventAilmentCode("confuse"), 0x0b);
  assert.equal(statusEventAilmentBit("confuse"), 0x04);
  assert.equal(statusEventAilmentCode("sleep"), 0x0c);
  assert.equal(statusEventAilmentBit("sleep"), 0x08);
  assert.equal(statusEventAilmentCode("nonexistent"), null);
  // And each code's row carries the same bit.
  for (const r of STATUS_EVENT_AILMENTS) {
    const row = STATUS_EVENT_CODES.find((c) => c.code === r.code);
    assert.equal(row.recordBit, r.bit, `code 0x${r.code.toString(16)}'s row bit`);
  }
  // The three names the shipped table had the wrong way round.
  assert.equal(STATUS_EVENT_CODES.find((r) => r.code === 0x0b).name, "ailment recovery (confused)");
  assert.equal(STATUS_EVENT_CODES.find((r) => r.code === 0x0c).name, "ailment recovery (asleep)");
});

// ---------------------------------------------------------------------------
// One behaviour test per code this job added.
// ---------------------------------------------------------------------------

/**
 * A stage input with every field named, so each assertion below can say which one.
 *
 * `magnitude` is the stager's THIRD ARGUMENT — the apply machine's effect byte,
 * `effects[slot]` (`lbu $a2, 0x38($s4)`, `pro/fightstg.s:15196`) — and the same value the
 * delay arm reads back out of `0x800a435d`. 0x1e here is just a magnitude-shaped input;
 * the disc's own appliers fill it with the technique's f9/effect_p2.
 */
function stage(ailment, over = {}) {
  return {
    side: 0x10, slot: 0, ailment, magnitude: 0x1e,
    delay: { draw: 0, ownSpt: 100, magnitude: 0x1e, otherA: 0, otherB: 0 },
    techniqueId: 0,
    ...over,
  };
}

test("CODE 0x05: the per-side tick is staged with opcode 2's arm and refreshed in place", () => {
  const pool = emptyStatusEventPool();
  const at = stageStatusEventSideTick(pool, 0x10, 100, () => 0);
  const e = pool[at];
  assert.equal(e.code, 0x05);
  assert.equal(e.side, 0x10, "the side byte the stager is handed");
  assert.equal(e.slot, 1, "`sltu $v0, $zr, $s1` :26570 -- the slot argument is the side INDEX");
  assert.equal(e.payload, 0xbd, "the fixed payload `li $v0, 0xbd` :26602");
  // Opcode 2's arm: `rand % 2001 + 10 * own SPT`, floor 1001, no ceiling -- NOT the
  // speed-ratio default, which is what the port used to compute for this opcode.
  assert.equal(e.time, 0 + 10 * 100 + 1, "1000 is one under opcode 2's 1001 floor");
  const firstTime = e.time;
  assert.equal(stageStatusEventSideTick(pool, 0x10, 100, () => 0.5), at, "refreshed, not stacked");
  assert.equal(pool.filter((x) => x.code === 0x05).length, 1);
  assert.notEqual(pool[at].time, firstTime, "the new delay replaced the old one");
  assert.equal(statusEventDelayArm(2), 0x8009bdf4);
  assert.equal(statusEventTickDelay(0, () => 0), 1001, "the floor is opcode 2's 1001");
  assert.equal(statusEventTickDelay(100, () => 0), 1001, "1000 is one under the floor");
  assert.equal(statusEventTickDelay(100, () => 0.5), (0x8000 % 2001) + 1000);
  // The other side's stats are never read: one getter call, flag 1, for the handed side.
  // `statusEventDelay` is the DEFAULT arm only. Handed opcode 2 it computes the speed
  // ratio off opcode 2's base (2001) and floors at 1001 -- a number the original never
  // produces for this opcode, which is exactly why the arm table has to be dispatched.
  assert.equal(statusEventDelay(2, { own: 100, opp: 100 }), 2001,
    "the default arm is NOT this opcode's arm");
});

test("CODE 0x09: the poison tick is a 1000-unit entry that keeps its slot and re-arms", () => {
  const pool = emptyStatusEventPool();
  const at = stageStatusEventAilment(pool, stage("poison", { side: 0x10, slot: 2 }));
  assert.equal(pool[at].code, 0x09);
  assert.equal(pool[at].time, 1000, "`li $v0, 0x3e8` :26742 -- no delay call at all");
  assert.equal(pool[at].side, 0x10);
  assert.equal(pool[at].slot, 2);
  // The refresh rewrites the PAYLOAD, not the time: `sw $s3, 0xc($v0)` in the `j`'s delay
  // slot :26720 stores the register it names, which is the caller's third argument — the
  // magnitude the apply machine handed over.
  const again = stageStatusEventAilment(pool, stage("poison", { side: 0x10, slot: 2, magnitude: 0x1e }));
  assert.equal(again, at);
  assert.equal(pool.filter((x) => x.code === 0x09).length, 1);
  assert.equal(pool[at].payload, 0x1e, "the refresh writes the magnitude into payload 1");
  // `0x800a3800`'s word for code 9 is -1, so the entry SURVIVES its own fire.
  assert.equal(statusEventFreesSlot(0x09), false);
  const fired = advanceStatusEvents(pool, 1000);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].kind, "poison");
  assert.equal(fired[0].ailment, "poison");
  assert.equal(fired[0].bit, 0x01, "`ori $v0, 0x1` :26743 -- record +0x1c bit 0x01");
  assert.equal(pool.filter((x) => x.code !== 0).length, 1, "the slot was kept");
  assert.equal(pool[at].time, 0, "its time is spent; the consumer re-arms it");
});

test("CODE 0x0a: the frozen recovery is opcode 9, and its expiry IS the cure", () => {
  const pool = emptyStatusEventPool();
  const at = stageStatusEventAilment(pool, stage("frozen", {
    side: 0x10, slot: 1, magnitude: 0x1f,
    delay: { draw: 0, ownSpt: 100, magnitude: 0x1f, otherA: 0, otherB: 0 },
  }));
  const e = pool[at];
  assert.equal(e.code, 0x0a);
  assert.equal(e.side, 0x10);
  assert.equal(e.slot, 1, "the SIDE'S ACTIVE SLOT, which the caller supplies");
  assert.equal(e.payload, 0x1f, "the magnitude the stager's third argument carried");
  // `li $a1, 0x9` :26700 -- opcode 9, whose arm adds 3000 and floors at 1000.
  assert.equal(statusEventDelayArm(9), 0x8009bec8);
  assert.equal(e.time, 0 + 8 * (100 + 0x1f) + 3000);
  // The floor bites when the OTHER side's pair outweighs the 3000 term.
  assert.equal(statusEventRecoveryDelay(9,
    { draw: 0, ownSpt: 0, magnitude: 0, otherA: 500, otherB: 0 }), 1000, "opcode 9's floor");
  // Consumer + effect.
  assert.equal(statusEventActionType(0x0a), 0x0d);
  assert.equal(STATUS_EVENT_CODES.find((r) => r.code === 0x0a).recordBit, 0x02);
  assert.deepEqual(advanceStatusEvents(pool, e.time - 1), []);
  const fired = advanceStatusEvents(pool, 1);
  assert.equal(fired[0].kind, "ailment");
  assert.equal(fired[0].ailment, "frozen");
  assert.equal(fired[0].bit, 0x02);
  assert.equal(pool.filter((x) => x.code !== 0).length, 0, "the slot was freed on the fire");
  // Re-staging refreshes in place (`sh $a1, 0x2($v0)` :26690), it never stacks.
  const again = stageStatusEventAilment(pool, stage("frozen", {
    side: 0x10, slot: 1, magnitude: 0x1f,
    delay: { draw: 0x8000, ownSpt: 100, magnitude: 0x1f, otherA: 0, otherB: 0 },
  }));
  assert.equal(again, at);
  assert.equal(pool.filter((x) => x.code === 0x0a).length, 1);
});

test("CODE 0x0b: the confused recovery runs opcode 8, whose own arithmetic floors at 2000", () => {
  const pool = emptyStatusEventPool();
  const at = stageStatusEventAilment(pool, stage("confuse", {
    side: 0, slot: 0, magnitude: 0x20, techniqueId: 0,
    delay: { draw: 0x8000, ownSpt: 100, magnitude: 0x20, otherA: 0, otherB: 0 },
  }));
  assert.equal(pool[at].code, 0x0b);
  assert.equal(pool[at].side, 0);
  assert.equal(pool[at].payload, 0x20);
  // `bnez $s0, .L0x8009ca30` :26849 tests the CALLER's `$a1`, not the find result, and
  // every caller passes the action's technique id. Zero -> opcode 8.
  assert.equal(statusEventDelayArm(8), 0x8009be7c);
  assert.equal(statusEventAilmentDelay("confuse",
    { draw: 0x8000, ownSpt: 100, magnitude: 0x20, otherA: 0, otherB: 0 }, 0),
    statusEventConfusionDelay(() => 0x8000 / 0x10000));
  // The disc's magic divides by 2710 while the rebuild multiplies by 8001, so the arm's
  // own answer is 2000 for every draw from 2710 up.
  assert.equal(statusEventDivide2710(2709), 0);
  assert.equal(statusEventDivide2710(2710), 1, "the magic-and-shift pair divides by 2710");
  assert.equal(statusEventConfusionDelay(() => 2709 / 0x10000), 2709);
  assert.equal(statusEventConfusionDelay(() => 2710 / 0x10000), 2000);
  assert.equal(statusEventConfusionDelay(() => 1), 2000);
  assert.equal(statusEventConfusionDelay(() => 0.99999), 2000);
  assert.equal(pool[at].time, 2000);
  // A non-zero technique id takes opcode 10 instead, whose arm has the 3000 term.
  assert.equal(statusEventDelayArm(10), 0x8009bf90);
  const other = stageStatusEventAilment(pool, stage("confuse", {
    side: 0x10, slot: 0, magnitude: 0x20, techniqueId: 7,
    delay: { draw: 0, ownSpt: 100, magnitude: 0x20, otherA: 0, otherB: 0 },
  }));
  assert.equal(pool[other].time, 8 * (100 + 0x20) + 3000, "opcode 10's shape");
  assert.equal(STATUS_EVENT_CODES.find((r) => r.code === 0x0b).recordBit, 0x04);
  assert.equal(statusEventActionType(0x0b), 0x0e);
  const fired = advanceStatusEvents(pool, 2000);
  assert.equal(fired.filter((f) => f.code === 0x0b).length, 1);
  assert.equal(fired.find((f) => f.code === 0x0b).ailment, "confuse");
});

test("CODE 0x0c: the asleep recovery is opcode 11, the one arm that floors at 500", () => {
  const pool = emptyStatusEventPool();
  const at = stageStatusEventAilment(pool, stage("sleep", {
    side: 0, slot: 0, magnitude: 0x21,
    delay: { draw: 0, ownSpt: 100, magnitude: 0x21, otherA: 0, otherB: 0 },
  }));
  assert.equal(pool[at].code, 0x0c);
  assert.equal(pool[at].time, 8 * (100 + 0x21) + 1000, "opcode 11 adds 1000");
  assert.equal(statusEventDelayArm(11), 0x8009c058);
  assert.equal(statusEventRecoveryDelay(11,
    { draw: 0, ownSpt: 0, magnitude: 0, otherA: 100, otherB: 0 }), 500, "opcode 11's floor");
  assert.equal(statusEventRecoveryDelay(11,
    { draw: 7, ownSpt: 100, magnitude: 0x21, otherA: 40, otherB: 20 }),
    7 % 500 + 1000 + 8 * (100 + 0x21 - 40 - 20));
  assert.equal(STATUS_EVENT_CODES.find((r) => r.code === 0x0c).recordBit, 0x08);
  assert.equal(statusEventActionType(0x0c), 0x0f);
  const fired = advanceStatusEvents(pool, pool[at].time);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].kind, "ailment");
  assert.equal(fired[0].ailment, "sleep");
  assert.equal(fired[0].bit, 0x08);
  assert.equal(pool.filter((x) => x.code !== 0).length, 0);
});

test("a cure frees the entry as well as the flag, through the one shared routine", () => {
  // `FIGHTSTG_F0x8009c330`: clear the bit out of 0x800a43dc[which], then free the entry
  // whose code 0x800a43d4[which] names. One call, both halves.
  const pool = emptyStatusEventPool();
  for (const [ail, code] of [["poison", 0x09], ["frozen", 0x0a], ["confuse", 0x0b], ["sleep", 0x0c]]) {
    stageStatusEventAilment(pool, stage(ail, { side: 0, slot: 0 }));
    assert.equal(pool.filter((x) => x.code === code).length, 1, `${ail} staged`);
    assert.equal(cureStatusEvent(pool, ail, 0, 0), true, `${ail} cured`);
    assert.equal(pool.filter((x) => x.code === code).length, 0, `${ail}'s entry freed`);
    assert.equal(cureStatusEvent(pool, ail, 0, 0), false, `${ail} is already gone`);
  }
  assert.equal(cureStatusEvent(pool, "nonsense", 0, 0), false);
  assert.equal(cureStatusEvent(undefined, "poison", 0, 0), false);
});

test("the ALL-status cure cancels six codes, read off the disc's own table", () => {
  // `FIGHTSTG_F0x8009c330`'s `which` 3 arm walks SIX bytes from `.L0x800a43d4`
  // (`slti $v0, $s0, 0x6` :26464) — `0x0c0b0a09` (:34881) plus the low half of
  // `.L0x800a43d8` (`0x00001110`, :34882). Read them out of the shipped overlay, not out
  // of the port's own list, so the two cannot agree by accident.
  const six = [...fight.raw(0x800a43d4, 6)];
  assert.deepEqual(six, [9, 10, 11, 12, 16, 17], "the disc's six codes");
  assert.deepEqual([...STATUS_EVENT_ALL_CURE_CODES], six,
    "and the port's list, in the disc's own order");
  // Technique 375's helper reads the same six out of `.L0x800a3438`, a word at a time.
  assert.deepEqual([...fight.raw(0x800a3438, 24)].filter((_, i) => i % 4 === 0), six);

  const pool = emptyStatusEventPool();
  stageStatusEventAilment(pool, stage("poison", { side: 0, slot: 0 }));
  stageStatusEventAilment(pool, stage("frozen", { side: 0, slot: 0, magnitude: 0x1f }));
  stageStatusEventAilment(pool, stage("sleep", { side: 0, slot: 0, magnitude: 0x21 }));
  stageStatusEventLock(pool, 0, 0, 24, () => 0);
  stageStatusEventLock(pool, 1, 0, 24, () => 0);
  // A different record's entries are NOT this record's to cure.
  stageStatusEventLock(pool, 0, 1, 24, () => 0);
  assert.equal(cureAllStatusEvents(pool, 0, 0), 5, "all five of this slot's entries go");
  assert.equal(pool.filter((x) => x.code !== 0).length, 1, "the other slot keeps its lock");
  assert.equal(statusEventLockHeld(pool, 0, 0, 1), true);
  assert.equal(cureAllStatusEvents(pool, 0, 0), 0, "nothing left to free");
  assert.equal(cureAllStatusEvents(undefined, 0, 0), 0);
});
