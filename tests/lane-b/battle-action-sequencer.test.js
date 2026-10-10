// tests/lane-b/battle-action-sequencer.test.js
//
// ORACLES FOR THE SECONDARY BATTLE-ACTION SEQUENCER (engine/dw3/battle-action-sequencer.ts).
//
// The strongest check runs the ORIGINAL dispatcher `F0x800a9cb4` out of the
// committed overlay image and compares its decision with the port:
//   - action opcodes (phase 1): the original thunk table + the shared `jalr`
//     tail are executed, and the opcode handed to `ctx->m2c` is recorded;
//   - arm routing (phases 3..26): a recording stub is installed at every arm
//     address and the arm the original jumps to is compared with the table row.
// The remaining checks tie the data tables to the original bytes: the two
// 24-entry tables, the fightstg request stagers, and the `jal` side effects of
// the arms that change player-visible battle state (a Tag launch, a Blast, the
// request stagers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
  WA_ACTION_ARM_TABLE,
  WA_ACTION_OPCODE_TABLE,
  WA_REQUEST_STAGERS,
  WA_SEQUENCER_HELPERS,
  WA_QUEUE_BASE,
  WA_QUEUE_METHODS,
  WA_COMMAND_ROUTES,
  WA_OFF_TABLE_ROUTES,
  WA_STFGTREP_F0,
  WA_PHASE21_BRANCHES,
  WA_ACTION_ARM_TABLE_BASE,
  WA_ACTION_OPCODE_TABLE_BASE,
  waActionArmForPhase,
  waActionOpcodeForSubState,
  waSequencerRoute,
} from "../../engine/dw3/battle-action-sequencer.ts";

const WA_BASE = 0x800a5de0;
const overlay = readFileSync("web/assets/native/screens/pro_wfightmn.bin");
const word = (a) => overlay.readUInt32LE(a - WA_BASE) >>> 0;
const fight = readFileSync("web/assets/native/screens/pro_fightstg.bin");
const fightWord = (a) => fight.readUInt32LE(a - 0x80082cb0) >>> 0;
const stfg = readFileSync("web/assets/native/screens/pro_stfgtrep.bin");
const stfgWord = (a) => stfg.readUInt32LE(a - 0x80082cb0) >>> 0;

function runtime() {
  return new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, WA_BASE,
  );
}

// ── 1. The two 24-entry tables are the disc's own words ─────────────────────

test("the 24-entry action arm table equals wfightmn.s file 0x5010", () => {
  assert.equal(WA_ACTION_ARM_TABLE.length, 24);
  // phase 3 lands on the first real table word at file 0x5010
  assert.equal(WA_ACTION_ARM_TABLE_BASE + 3 * 4, WA_BASE + 0x5010);
  for (let i = 0; i < 24; i++) {
    const phase = i + 3;
    const row = WA_ACTION_ARM_TABLE[i];
    assert.equal(row.index, i);
    assert.equal(row.phase, phase);
    assert.equal(row.address, word(WA_BASE + 0x5010 + i * 4),
      `arm ${i} (phase ${phase}) address must be the table word`);
    assert.equal(waActionArmForPhase(phase).address, row.address);
  }
  // several phases share one handler (13/14/15 all reach 0x800a8770)
  assert.equal(WA_ACTION_ARM_TABLE[10].address, WA_ACTION_ARM_TABLE[11].address);
  assert.equal(WA_ACTION_ARM_TABLE[11].address, WA_ACTION_ARM_TABLE[12].address);
  assert.equal(waActionArmForPhase(2), null);
  assert.equal(waActionArmForPhase(27), null);
});

test("the 24-entry action opcode table equals wfightmn.s file 0x008c and its delay slots", () => {
  assert.equal(WA_ACTION_OPCODE_TABLE.length, 24);
  for (let i = 0; i < 24; i++) {
    const sub = i + 1;
    const row = WA_ACTION_OPCODE_TABLE[i];
    assert.equal(row.subState, sub);
    assert.equal(row.thunk, word(WA_BASE + 0x8c + i * 4), `thunk ${sub}`);
  }
  // the opcode is the li $a1,N in the delay slot of the j 0x800a9fd4 that ends
  // each 4-instruction thunk (the non-thunk subState 3 is the documented
  // exception and reads the workspace mode instead).
  const common = 0x800a9fd4;
  for (const row of WA_ACTION_OPCODE_TABLE) {
    // subState 3 is the one non-thunk (it reads the workspace mode and calls
    // 0x80088c00/0x80090e58/0x800914ec, then m2c(2)); its opcode is fixed at 2
    // and its body is asserted by the execution oracle below.
    if (row.subState === 3) {
      assert.equal(row.opcode, 2);
      assert.equal(word(row.thunk) >>> 26, 0x0f, "subState 3 opens lui");
      continue;
    }
    assert.equal(word(row.thunk), 0x02002021, `thunk ${row.subState} opens move $a0,$s0`);
    assert.equal(word(row.thunk + 4), 0x8c82002c, `thunk ${row.subState} loads ctx->m2c`);
    assert.equal(word(row.thunk + 8),
      ((2 << 26) | ((common >>> 2) & 0x3ffffff)) >>> 0, `thunk ${row.subState} j ${common}`);
    const d = word(row.thunk + 0x0c);
    assert.equal(d >>> 26, 9, `thunk ${row.subState} delay slot is addiu`);
    assert.equal((d >>> 16) & 31, 5, `thunk ${row.subState} delay slot targets $a1`);
    assert.equal(d & 0xffff, row.opcode, `thunk ${row.subState} opcode`);
  }
  assert.equal(word(common), 0x0040f809, "the shared tail is jalr $v0");
});

// ── 2. The original dispatcher's opcode branch agrees with the port ─────────

test("phase 1: the original F0x800a9cb4 hands the port's opcode to ctx->m2c", () => {
  const rt = runtime();
  const ctx = 0x80140000;
  const target = 0x80140080;
  const trap = 0x800aae90; // a scratch cell inside the loaded overlay image
  const seen = [];
  rt.cpu.setStub(trap, (c) => { seen.push([c.reg(4) >>> 0, c.reg(5) | 0]); });
  // subState 3's thunk is the one non-thunk: it reads the workspace mode at
  // 0x800A4460+0xD6 and calls 0x80090e58 / 0x800914ec / 0x80088c00, then m2c(2).
  for (const diag of [0x80088c00, 0x80090e58, 0x800914ec]) rt.cpu.setStub(diag, () => 0);
  rt.mem.write32(ctx + 0x10, 1);
  rt.mem.write32(ctx + 0x24, target);
  rt.mem.write32(ctx + 0x2c, trap);
  for (const sub of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
                     19, 20, 21, 22, 23, 24, 0, 25, 0xffff]) {
    seen.length = 0;
    rt.mem.write32(ctx + 0x14, sub | 0);
    rt.cpu.call(0x800a9cb4, [ctx], 4000);
    const route = waSequencerRoute(1, sub);
    assert.equal(seen.length, 1, `opcode ${sub}: exactly one ctx->m2c call`);
    assert.equal(seen[0][0], ctx, `opcode ${sub}: called on ctx`);
    assert.equal(seen[0][1], route.opcode, `opcode ${sub}: original hands ${route.opcode}`);
    assert.equal(route.opcode, route.defaulted ? 3 : waActionOpcodeForSubState(sub).opcode);
  }
});

// ── 3. The original dispatcher's arm branch agrees with the port ────────────

test("phases 3..26: the original F0x800a9cb4 jumps to the port's arm", () => {
  const rt = runtime();
  const ctx = 0x80140000;
  const target = 0x80140080;
  const arms = [...new Set(WA_ACTION_ARM_TABLE.map((a) => a.address))];
  let fired = null;
  for (const a of arms) rt.cpu.setStub(a, (c) => { fired = a; });
  rt.mem.write32(ctx + 0x24, target);
  for (const phase of WA_ACTION_ARM_TABLE.map((a) => a.phase)) {
    fired = null;
    rt.mem.write32(ctx + 0x10, phase);
    rt.cpu.call(0x800a9cb4, [ctx], 400);
    const route = waSequencerRoute(phase, 0);
    assert.equal(route.action, "arm");
    assert.equal(fired, route.arm.address, `phase ${phase} arm`);
  }
  // phase 2 hands off opcode 0 to ctx->m2c with an idle child
  const trap = 0x800aae90;
  const seen = [];
  rt.cpu.setStub(trap, (c) => { seen.push(c.reg(5) | 0); });
  rt.mem.write32(ctx + 0x10, 2);
  rt.mem.write32(ctx + 0x24, target);
  rt.mem.write32(ctx + 0x2c, trap);
  rt.mem.write32(target + 0x1c, 0);
  rt.cpu.call(0x800a9cb4, [ctx], 400);
  assert.deepEqual(seen, [0], "phase 2 hands off opcode 0");
  assert.equal(waSequencerRoute(2, 0).action, "awaitChild");
});

// ── 4. Out-of-range phases take the documented hand-off paths ───────────────

test("phase 0 refreshes the queue index and an out-of-range phase overruns", () => {
  assert.deepEqual(waSequencerRoute(0, 0), { action: "refreshIndex", opcode: 1 });
  assert.deepEqual(waSequencerRoute(27, 0), { action: "overrun", opcode: 1 });
  assert.deepEqual(waSequencerRoute(0xffff, 0), { action: "overrun", opcode: 1 });
  // The phase-0 path calls ctx->m2c(ctx, 1) (wfightmn.s 0x3fb8-0x3fc4); the
  // overrun path calls ctx->m2c(ctx, 1) at 0x3f50-0x3f5c.
  assert.equal(word(WA_BASE + 0x3f5c), 0x24050001, "overrun hands opcode 1");
  assert.equal(word(WA_BASE + 0x3fc4), 0x24050001, "phase 0 hands opcode 1");
});

// ── 5. The fightstg request stagers, as the arms reach them ─────────────────

test("the request stagers stage the port's code and call the port's queue method", () => {
  const methodAddr = { enqueue: 0x8009b930, preempt: 0x8009b9d0 };
  // bound each stager at the next stager's start so a scan cannot pick up a
  // neighbour's `li`/`jal` (the bodies are 0x3c..0x150 bytes and sit back to back)
  const starts = WA_REQUEST_STAGERS.map((s) => s.address).sort((a, b) => a - b);
  const spanEnd = (a) => starts.find((x) => x > a) ?? a + 0x100;
  for (const s of WA_REQUEST_STAGERS) {
    const codes = [];
    const targets = [];
    for (let p = s.address; p < spanEnd(s.address); p += 4) {
      const w = fightWord(p);
      if ((w >>> 26) === 9 && ((w >>> 21) & 31) === 0) codes.push(w & 0xffff);
      if ((w >>> 26) === 3) targets.push((((p & 0xf0000000) + ((w & 0x3ffffff) << 2))) >>> 0);
    }
    assert.ok(codes.includes(s.code),
      `stager 0x${s.address.toString(16)} must li its code 0x${s.code.toString(16)}`);
    assert.ok(targets.includes(methodAddr[s.method]),
      `stager 0x${s.address.toString(16)} calls the ${s.method} method`);
    const other = s.method === "enqueue" ? "preempt" : "enqueue";
    assert.ok(!targets.includes(methodAddr[other]),
      `stager 0x${s.address.toString(16)} must not call the ${other} method`);
  }
  // every stager kind is unique and forms the disc's 1..0x18 set with gaps
  const kinds = WA_REQUEST_STAGERS.map((s) => s.code);
  assert.equal(new Set(kinds).size, kinds.length, "stager kinds are unique");
});

// ── 6. Arms that change player-visible state reach their side-effect calls ──

test("the player-visible arms carry the jal targets the table declares", () => {
  const arms = [...new Set([...WA_ACTION_ARM_TABLE.map((a) => a.address),
    0x800a66b0, 0x800a684c, 0x800a6920, 0x800a69b8, 0x800a69f0, 0x800a6b18,
    0x800a7328, 0x800a9cb4, 0x800aaea0])].sort((x, y) => x - y);
  const spanEnd = (a) => arms[arms.indexOf(a) + 1] ?? (a + 0x400);
  const jals = (a) => {
    const out = [];
    for (let p = a; p < spanEnd(a); p += 4) {
      const w = word(p);
      if ((w >>> 26) === 3) out.push((((p & 0xf0000000) + ((w & 0x3ffffff) << 2))) >>> 0);
    }
    return out;
  };
  const want = {
    0x800a7418: [0x8008d37c],                    // phase 3 launches the Fight task
    0x800a77b4: [0x8008a7f4],                    // phase 4 plays the chosen move
    0x800a78d8: [0x80087000],                    // phase 5 Tag commit spawns the partner
    0x800a7fe4: [0x8009c534],                    // phase 8 stages request 1
    0x800a84d0: [0x8009cf54],                    // phase 12 KO handler
    0x800a89f0: [0x8008d37c, 0x8009c4bc],        // battleActionArm: Fight task + re-enqueue
    0x800a8bf4: [0x8009cf00],                    // phase 19 Blast
    0x800a8e90: [0x80087000],                    // phase 20 Blast revert spawns
    0x800a8f88: [0x8009c534, 0x80087000],        // phase 21 spawns the tagged fighter
    0x800a9640: [0x80087000],                    // phase 23 restores the actor
    0x800a988c: [0x80087000],                    // phase 25 spawns enemy-block record 2
  };
  for (const [addr, targets] of Object.entries(want)) {
    const j = jals(Number(addr));
    for (const t of targets) assert.ok(j.includes(t),
      `arm 0x${Number(addr).toString(16)} must jal 0x${t.toString(16)}`);
  }
  // and the table flags exactly those arms that spawn/restore state
  for (const a of WA_ACTION_ARM_TABLE) {
    const visible = [3, 4, 5, 7, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25]
      .includes(a.phase);
    assert.equal(a.changesBattleState, visible, `phase ${a.phase} visibility flag`);
  }
});

// ── 7. The supporting routines sit inside the overlay ───────────────────────

test("every sequencer helper address is a routine start inside the overlay image", () => {
  for (const h of WA_SEQUENCER_HELPERS) {
    assert.ok(h.address >= WA_BASE && h.address < WA_BASE + overlay.length,
      `helper 0x${h.address.toString(16)} inside the overlay`);
    // a routine start carries a stack-frame addiu ($sp, negative) as its first word
    const first = word(h.address);
    assert.equal(first >>> 26, 9, `helper 0x${h.address.toString(16)} opens addiu`);
    assert.equal((first >>> 21) & 31, 29, `helper 0x${h.address.toString(16)} adjusts $sp`);
    assert.ok((first & 0xffff) >= 0x8000, `helper 0x${h.address.toString(16)} frames down`);
  }
});

// ── 8. The queue's own producer-side method table ───────────────────────────

test("the queue object's method table is the disc's static pointer block", () => {
  // the block is 0x800A4360..0x800A4380 = queue+0xAF8..+0xB18, in pro_fightstg.bin
  assert.equal(WA_QUEUE_METHODS.length, 9);
  for (const m of WA_QUEUE_METHODS) {
    assert.equal(fightWord(WA_QUEUE_BASE + m.slot), m.address,
      `queue+0x${m.slot.toString(16)} must hold 0x${m.address.toString(16)}`);
  }
  // the slots are the documented offsets and every target sits in fightstg
  assert.deepEqual(WA_QUEUE_METHODS.map((m) => m.slot),
    [0xaf8, 0xafc, 0xb00, 0xb04, 0xb08, 0xb0c, 0xb10, 0xb14, 0xb18]);
  for (const m of WA_QUEUE_METHODS) {
    assert.ok(m.address >= 0x80082cb0 && m.address < 0x800a5de0,
      `queue method 0x${m.address.toString(16)} is inside fightstg`);
  }
});

// ── 9. Each named command's queue kind, producer and arm is the disc's ──────

test("each pinned command route is the disc's: kind, arm word and link", () => {
  assert.ok(WA_COMMAND_ROUTES.length > 0);
  // arm body spans: bound each arm at the next arm/helper routine start
  const armStarts = [...new Set([...WA_ACTION_ARM_TABLE.map((a) => a.address),
    0x800a66b0, 0x800a684c, 0x800a6920, 0x800a69b8, 0x800a69f0, 0x800a6b18,
    0x800a7328, 0x800a9cb4, 0x800aaea0])].sort((x, y) => x - y);
  const armEnd = (a) => armStarts.find((x) => x > a) ?? a + 0x400;
  const words = (a) => {
    const out = [];
    for (let p = a; p < armEnd(a); p += 4) out.push(word(p));
    return out;
  };
  for (const r of WA_COMMAND_ROUTES) {
    // the producer is one of the disc stagers and stages the same kind
    const stager = WA_REQUEST_STAGERS.find((s) => s.address === r.producer);
    assert.ok(stager, `route "${r.command}" producer 0x${r.producer.toString(16)} is a stager`);
    assert.equal(stager.code, r.queueKind,
      `route "${r.command}" stager stages kind 0x${r.queueKind.toString(16)}`);
    // the arm's address is the disc's table word for its phase
    assert.equal(waActionArmForPhase(r.armPhase)?.address, r.armAddress,
      `route "${r.command}" phase ${r.armPhase} selects 0x${r.armAddress.toString(16)}`);
    assert.equal(word(WA_BASE + 0x5010 + (r.armPhase - 3) * 4), r.armAddress,
      `route "${r.command}" arm table word at phase ${r.armPhase}`);
    // and the arm's body carries the link to the kind
    const body = words(r.armAddress);
    if (r.link === "armCallsProducer") {
      const targets = body.filter((w) => (w >>> 26) === 3)
        .map((w) => (0x80000000 | ((w & 0x3ffffff) << 2)) >>> 0);
      assert.ok(targets.includes(r.producer),
        `arm 0x${r.armAddress.toString(16)} must jal producer 0x${r.producer.toString(16)}`);
    } else {
      // armReadsKind: a `lw $v0,0xb0c(...)` and a `li $a0,kind` in the body
      assert.ok(body.some((w) => (w >>> 26) === 0x23 && (w & 0xffff) === 0xb0c),
        `arm 0x${r.armAddress.toString(16)} must read the +0xB0C findKind slot`);
      assert.ok(body.some((w) => (w >>> 26) === 9 && ((w >>> 21) & 31) === 0
        && ((w >>> 16) & 31) === 4 && (w & 0xffff) === r.queueKind),
        `arm 0x${r.armAddress.toString(16)} must li $a0,0x${r.queueKind.toString(16)}`);
    }
  }
});

// ── 10. Arm phase 21 is a 6-state sub-machine; its branches are the disc's ──

test("arm phase 21's branches are the disc's bytes", () => {
  // phase 21 = F0x800a8f88, a 6-entry jump table at 0x800a5e3c
  assert.equal(WA_ACTION_ARM_TABLE[18].address, 0x800a8f88);
  assert.equal(word(0x800a5e3c), 0x800a8fd8, "phase 21 state 0 handler");
  // the 0x800A4536 == 4 branch: lh $v1,0x4536($v0); li $v0,4; li $v0,0x8b
  assert.equal(word(WA_BASE + 0x3230), 0x84434536, "lh $v1,0x4536($v0)");
  assert.equal(word(WA_BASE + 0x3234), 0x24020004, "li $v0,4 (the ==4 test)");
  assert.equal(word(WA_BASE + 0x3240), 0x2402008b, "li $v0,0x8b (the loss/exit kind)");
  // the no-living-slot path stages request kind 1 and spawns 0x8008CB44
  assert.equal(word(WA_BASE + 0x3450), 0x0c02714d, "jal 0x8009c534 (request kind 1)");
  assert.equal(word(WA_BASE + 0x3488), 0x0c0232d1, "jal 0x8008cb44 (the class-4 task)");
  // the recorded branch table names what these bytes do
  assert.equal(WA_PHASE21_BRANCHES.length, 4);
  assert.ok(WA_PHASE21_BRANCHES.every((b) => b.evidence.includes("pro/wfightmn.s")));
});

// ── 11. DNA does NOT route through the 24-arm table; its route is the disc's ──────────

test("DNA's action code, controller step and start-call are the disc's bytes", () => {
  assert.equal(WA_OFF_TABLE_ROUTES.length, 1);
  const r = WA_OFF_TABLE_ROUTES[0];
  assert.equal(r.command.includes("DNA"), true);
  // FIGHTSTG command phase writes the DNA result/action code 6.
  assert.equal(r.actionCode, 0x6);
  assert.equal(fightWord(r.actionCodeSite), 0x24020006,
    "fightstg.s:16357 .L0x80092b54 must be `li $v0, 0x6`");
  assert.equal(r.actionCodeSite - 0x80082cb0, 0xfea4);
  // wfightmn reads it and enters its DNA step 6.
  assert.equal(r.controllerStep, 0x6);
  assert.equal(word(r.controllerStepSite), 0x24050006,
    "wfightmn.s:1626 .L0x0000194c must be `li $a1, 0x6`");
  assert.equal(r.controllerStepSite - WA_BASE, 0x194c);
  // the DNA step calls a FIGHTSTG routine (not an arm) with the result id.
  assert.equal(word(r.actionCallSite), 0x0c024311,
    "wfightmn.s:1888 .L0x00001d64 must be `jal 0x80090c44`");
  assert.equal(r.actionCallSite - WA_BASE, 0x1d64);
  // jal target from the encoding: (word & 0x3ffffff) << 2 | 0x80000000.
  const jal = word(r.actionCallSite);
  assert.equal((0x80000000 | ((jal & 0x3ffffff) << 2)) >>> 0, r.actionAddress);
  assert.equal(r.actionAddress, 0x80090c44);
  // The jumped-to routine is in pro/fightstg, ABOVE the wfightmn image, and is NOT any arm.
  assert.ok(r.actionAddress >= 0x80082cb0 && r.actionAddress < 0x800a5de0,
    "the DNA action must live in pro/fightstg");
  const armAddresses = new Set(WA_ACTION_ARM_TABLE.map((a) => a.address));
  assert.equal(armAddresses.has(r.actionAddress), false,
    "0x80090c44 must not be one of the 24 arm entry points");
  // every arm is in the wfightmn image; the DNA call is not.
  for (const a of armAddresses) {
    assert.ok(a >= WA_BASE && a < WA_BASE + overlay.length, `arm 0x${a.toString(16)} in wfightmn`);
  }
  assert.equal(r.actionTick, 0x8008f714);
});

test("STFGTREP_f0 and its +0x38 call are the disc's, and 0x80082e70 collides with fightstg", () => {
  const s = WA_STFGTREP_F0;
  // STFGTREP_f0 at 0x80082e70 opens `addiu $sp, -0x28`.
  assert.equal(s.address, 0x80082e70);
  assert.equal(s.overlayBase, 0x80082cb0);
  assert.equal(stfgWord(s.address), s.firstWord);
  assert.equal(s.firstWord, 0x27bdffd8);
  // It does call src->+0x38: `lw $v0, 0x38($s1)` at 0x80082f44, then `jalr $v0`.
  assert.equal(s.methodSlot, 0x38);
  assert.equal(stfgWord(s.methodCallSite), 0x8e220038,
    "0x80082f44 must be `lw $v0, 0x38($s1)`");
  assert.equal(s.methodCallSite, s.address + 0xd4);
  assert.equal(stfgWord(s.methodCallSite + 8), 0x40f809, "then `jalr $v0`");
  // The SAME address in pro/fightstg is a data word, not code (base collision).
  assert.equal(fightWord(s.address), s.fightstgCollisionWord);
  assert.equal(s.fightstgCollisionWord, 0x8008bac0);
});
