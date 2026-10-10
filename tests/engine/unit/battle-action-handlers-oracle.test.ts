// Oracle for the action VM's opcode handlers (engine/dw3/battle-action-handlers.ts).
//
// It runs the ORIGINAL handler instruction words out of the committed fightstg
// overlay (web/assets/native/screens/pro_fightstg.bin, base 0x80082cb0) through
// engine/native with each handler's DEEP LEAVES stubbed (the manager fetches, the
// effect/mesh/overlay spawns and the anim-object methods belong to other systems),
// and checks two things:
//   * `operandWords()` equals the instruction-pointer advance the handler itself
//     performs — the arity the decoder tools/decode_action_scripts.py encodes;
//   * `op11Wait()` reproduces FIGHTSTG_F0x8008c220's wait state machine exactly.
// Negative controls prove a wrong arity or a wrong wait would be caught.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import { operandWords, op11Wait } from "../../../engine/dw3/battle-action-handlers.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const H = {
  op1: 0x8008b69c, op2: 0x8008b7f4, op3: 0x8008bc80, op4: 0x8008c2cc,
  op5: 0x8008c004, op6: 0x8008bea8, op7: 0x8008c514, op10: 0x8008c454, op11: 0x8008c220,
};
// leaf addresses the handlers call, all outside this module's scope
const L = {
  manager: 0x8004b7bc, // lu[i 0x8005]-0x4844: the graphics-manager fetch cell
  actorAlloc: 0x8008c910,
  spawnOverlay: 0x800930c0,
  freeOverlay: 0x80093088,
  spawnEffect: 0x8009b774,
  spawnProjectile: 0x80089844,
  projectileReady: 0x800897f8,
  effectReady: 0x80089978,
  effectBuild: 0x80089be4,
  mgrGet: 0x80105000, // the manager object the fetch returns
};
const MEW = 0x80105000; // manager object
const STUB = 0x80106000; // one shared stub target for the manager's methods
const FETCH = 0x80106004; // the manager-fetch stub (returns MEW)
const ANIM = 0x8010c000; // the anim object (actor +0x88)
const SLOT = 0x8010d000; // the slot object method_0x188/F0x8008b630 resolve to
const SLOT_RESOLVE = 0x8008b630; // FIGHTSTG_F0x8008b630 slot resolver
const SLOT_METHOD = 0x8010600c; // the anim object's +0x188 method stub
const ACTOR = 0x80100000;
const CTX = 0x80101000;
const P = 0x80102000;
const CAM = 0x800a46d8; // the live camera struct (writable RAM)

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

function runtime(): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  // stub every leaf the handlers reach
  rt.cpu.setStub(L.actorAlloc, () => 0x80107000);
  rt.cpu.setStub(L.spawnOverlay, () => 0x80108000);
  rt.cpu.setStub(L.freeOverlay, () => 0);
  rt.cpu.setStub(L.spawnEffect, () => 0x80109000);
  rt.cpu.setStub(L.spawnProjectile, () => 0x8010a000);
  rt.cpu.setStub(L.projectileReady, () => 0x8010b000);
  rt.cpu.setStub(L.effectReady, () => 0);
  rt.cpu.setStub(L.effectBuild, () => 0);
  rt.cpu.setStub(STUB, () => 0);
  rt.cpu.setStub(FETCH, () => MEW);
  // The graphics-manager fetch is a DATA load of the cell lu[i 0x8005]-0x4844, then
  // jalr — so the CELL must hold the stub address (a stub intercepts fetch, not load).
  rt.mem.write32(L.manager, FETCH);
  rt.mem.write32(0x80044f3c, STUB); // lu[i 0x8004]+0x4f3c: an object-is-ready test cell
  for (const off of [0xe8, 0xf8, 0xfc, 0x100, 0x104, 0x180, 0x184]) rt.mem.write32(MEW + off, STUB);
  // op2's slot resolver / anim-object method: the handler reads actor+0x88 (the
  // anim object) and calls its +0x188 (method_0x188), which returns a slot object.
  rt.cpu.setStub(SLOT_RESOLVE, () => SLOT);          // F0x8008b630
  rt.cpu.setStub(SLOT_METHOD, () => SLOT);           // the anim object's +0x188
  rt.mem.write32(ANIM + 0x188, SLOT_METHOD);
  rt.mem.write32(SLOT + 0x10, 1);                    // the slot's done-flag (against a mode-0 block)
  rt.mem.write32(SLOT + 0x04, 0);
  // actor defaults: a fresh actor; ctx cleared
  for (let i = 0; i < 0xc0; i += 4) rt.mem.write32(ACTOR + i, 0);
  rt.mem.write32(ACTOR + 0x88, ANIM); // anim object
  rt.mem.write32(ACTOR + 0x8c, P);
  return rt;
}

/** Write operand words at P, run the handler, return its IP advance in words. */
function runHandler(name: keyof typeof H, words: number[], setup?: (rt: NativeStageRuntime) => void): number {
  const rt = runtime();
  for (let i = 0; i < words.length; i++) rt.mem.write16(P + i * 2, words[i]! & 0xffff);
  for (let i = 0; i < 0x40; i += 4) rt.mem.write32(CTX + i, 0);
  setup?.(rt);
  rt.cpu.call(H[name], [ACTOR, CTX], 300000);
  const ip = rt.mem.read32(ACTOR + 0x8c) >>> 0;
  return ((ip >>> 0) - (P >>> 0)) >> 1;
}

// ── arity: the handler's own IP advance equals operandWords ─────────────────

test("op1 F0x8008b69c: 1 operand word, all modes", SKIP, () => {
  for (const mode of [0, 1, 2, 5, 7]) {
    const n = runHandler("op1", [mode]);
    assert.equal(n, operandWords(1, [mode]), `op1 mode ${mode}`);
  }
});

test("op7 F0x8008c514: 2 operand words (spawn and free paths)", SKIP, () => {
  assert.equal(runHandler("op7", [0, 7]), operandWords(7, [0, 7]));
  assert.equal(runHandler("op7", [1, 7]), operandWords(7, [1, 7]));
});

test("op10 F0x8008c454: 2 operand words", SKIP, () => {
  for (const type of [10, 0x62, 0x63]) {
    const words = [type, 0];
    assert.equal(runHandler("op10", words), operandWords(10, words), `op10 type ${type}`);
  }
});

test("op4 F0x8008c2cc: sub 1 → 2 words, sub 0 → 4 words", SKIP, () => {
  for (const sub of [0, 1]) {
    const words = [sub, 5, 0, 0];
    assert.equal(runHandler("op4", words), operandWords(4, words), `op4 sub ${sub}`);
  }
});

test("op6 F0x8008bea8: sub 1 → 2 words, sub 0 → 8 words", SKIP, () => {
  for (const sub of [0, 1]) {
    const words = [sub, 2, 0, 0, 0, 0, 0, 0];
    assert.equal(runHandler("op6", words), operandWords(6, words), `op6 sub ${sub}`);
  }
});

test("op3 F0x8008bc80: sub 1 → 2 words, sub 0 → 5 words", SKIP, () => {
  // sub 1: with actor+0xa0 == 0 the readiness poll returns without rewinding.
  for (const sub of [0, 1]) {
    const words = [sub, 5, 0, 0, 0];
    const n = runHandler("op3", words, (rt) => {
      // make the spawn-slot search fail so the handler returns on the forward path
      for (let i = 0; i < 8; i++) rt.mem.write32(CTX + 0x10 + i * 4, 1);
    });
    assert.equal(n, operandWords(3, words), `op3 sub ${sub}`);
  }
});

test("op5 F0x8008c004: sub 0 → 3 words, sub 1 → 16 words", SKIP, () => {
  for (const sub of [0, 1]) {
    const words = [0, sub, 9, ...Array(13).fill(0)];
    const n = runHandler("op5", words);
    assert.equal(n, operandWords(5, words), `op5 sub ${sub}`);
  }
});

test("op2 F0x8008b7f4: the mode-dependent operand count equals operandWords", SKIP, () => {
  // mode → expected operands (base 3 if {<=0,5,6,>=10} else 2, plus the mode's extras).
  const cases: [number, number[]][] = [
    [1, [1, 0]],                          // 2 words
    [2, [2, 0]],                          // 2 words
    [3, [3, 0, 0, 0, 0]],                 // 2 + 4 = 6
    [4, [4, 0, 0, 0, 0, 0]],              // 2 + 4 = 6 (the IP advance the handler makes)
    [7, [7, 0, 0]],                       // 2 + 1 = 3
    [8, [8, 0, 0]],                       // 2 + 1 = 3
    [9, [9, 0]],                          // 2 words (skips the resolver)
    [10, [10, 0, 0]],                     // 3 words
    [12, [12, 0, 0]],                     // >=10 → 3 words
    [0, [0, 0, 1]],                       // 3 words (3rd word = the bound table)
    [6, [6, 0, 0]],                       // 3 words
  ];
  for (const [mode, words] of cases) {
    const n = runHandler("op2", words);
    assert.equal(n, operandWords(2, words), `op2 mode ${mode} (${JSON.stringify(words)})`);
  }
  // mode 5 sub 4 carries the extra distance-trim word.
  assert.equal(operandWords(2, [5, 0, 4, 99]), 4, "mode 5 sub 4 reads a 4th word");
  assert.equal(operandWords(2, [5, 0, 1]), 3, "mode 5 sub 1 is a 3-word record");
});

// ── op11 WAIT — full state machine vs the original ──────────────────────────

test("op11 F0x8008c220: the wait countdown and IP rewind equal the port", SKIP, () => {
  const rt = runtime();
  const deltaCell = 0x800a4464;
  const deltaProvider = 0x8004df9c; // lu[i 0x8005]-0x2064: the per-frame step cell
  rt.cpu.setStub(FETCH + 4, () => rt.mem.read32(deltaCell) | 0);
  rt.mem.write32(deltaProvider, FETCH + 4);
  const count = 5, step = 2;
  rt.mem.write16(P - step, 11);  // the op11 opcode word precedes its operand
  rt.mem.write16(P, count);
  const port = { ip: P, waitFlag: 0, waitCount: 0 };

  let origReleases = -1, portReleases = -1;
  for (let tick = 1; tick <= 8; tick++) {
    // Mimic the dispatcher: IP points at the opcode, it reads it and advances by
    // step, then calls the handler with IP at the operand.
    rt.mem.write32(ACTOR + 0x8c, P);
    rt.mem.write32(deltaCell, 1);
    rt.cpu.call(H.op11, [ACTOR, CTX], 300000);
    const origIp = rt.mem.read32(ACTOR + 0x8c) >>> 0;
    const origFlag = rt.mem.read32(ACTOR + 0x98) | 0;
    const origCount = rt.mem.read32(ACTOR + 0x9c) | 0;
    const released = op11Wait(port, count, 1, step);
    // The original released this tick when it did NOT rewind and cleared its flag.
    const origReleased = origFlag === 0 && origIp === P + step;
    if (origReleased && origReleases < 0) origReleases = tick;
    if (released && portReleases < 0) portReleases = tick;
    assert.equal(origIp, port.ip >>> 0, `tick ${tick}: IP`);
    assert.equal(origFlag, port.waitFlag, `tick ${tick}: flag`);
    assert.equal(origCount, port.waitCount, `tick ${tick}: count`);
    // re-seed the port's IP to the operand position for the next tick
    port.ip = P;
  }
  assert.equal(portReleases, origReleases, "both release on the same tick");
  assert.ok(origReleases > 0, "the wait really held for several ticks");
});

test("op11 F0x8008c220: wait(0) still yields one tick — the first entry rewinds unconditionally", SKIP, () => {
  // The first-entry arm (asm L9528-9540) sets the flag, latches the count, rewinds IP and
  // returns 0 REGARDLESS of the count. So op11 [0] costs one tick, not zero. A port that
  // special-cased count 0 to "continue" would fail the `op11Wait(...) === false` below.
  const rt = runtime();
  rt.cpu.setStub(FETCH + 4, () => 1);
  rt.mem.write32(0x8004df9c, FETCH + 4);
  rt.mem.write16(P - 2, 11);   // the op11 opcode word precedes its operand
  rt.mem.write16(P, 0);        // count 0
  rt.mem.write32(ACTOR + 0x8c, P);
  const v0 = rt.cpu.call(H.op11, [ACTOR, CTX], 300000) | 0;
  assert.equal(v0, 0, "the original yields on the first entry even with count 0");
  assert.equal(rt.mem.read32(ACTOR + 0x8c) >>> 0, (P - 2) >>> 0, "and rewinds one opcode");
  assert.equal(rt.mem.read32(ACTOR + 0x98) | 0, 1, "the counting flag is set");

  const port = { ip: P, waitFlag: 0, waitCount: 0 };
  assert.equal(op11Wait(port, 0, 1, 2), false, "the port yields too");
  assert.equal(port.ip >>> 0, (P - 2) >>> 0, "and rewinds");
  assert.equal(port.waitFlag, 1);

  // The dispatcher re-enters with IP at the operand; the count 0 - 1 < 0 releases.
  rt.mem.write32(ACTOR + 0x8c, P);
  const v0b = rt.cpu.call(H.op11, [ACTOR, CTX], 300000) | 0;
  assert.equal(v0b, 1, "the original releases on the second entry");
  assert.equal(rt.mem.read32(ACTOR + 0x8c) >>> 0, (P + 2) >>> 0, "past the operand");
  port.ip = P;
  assert.equal(op11Wait(port, 0, 1, 2), true, "and the port releases on the second entry");
  assert.equal(port.ip >>> 0, (P - 2 + 4) >>> 0);
});

// ── negative controls ───────────────────────────────────────────────────────

test("negative control: a wrong arity must disagree with the handler", SKIP, () => {
  // op4 sub 0 really consumes 4 words; the decoder's old 2-word reading disagrees.
  const words = [0, 5, 0, 0];
  const n = runHandler("op4", words);
  assert.equal(n, 4, "the original op4 sub 0 advances 4 words");
  assert.notEqual(n, 2, "a 2-word reading must be wrong");
  // op11's first entry rewinds, so a "consume 1 word and continue" reading is wrong.
  assert.equal(operandWords(11, [5]), 1);
  const port = { ip: P, waitFlag: 0, waitCount: 0 };
  assert.equal(op11Wait(port, 5, 1), false, "the first op11 entry yields");
  assert.equal(port.ip >>> 0, (P - 2) >>> 0, "and rewinds IP by one opcode");
});
