// Oracle for the battle overlay's task spawners (engine/dw3/battle-task-spawn.ts).
//
// The strongest check runs the ORIGINAL instruction words out of the committed
// fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base
// 0x80082cb0) through engine/native, stubbing the resident allocator F0x80014504,
// and compares what each spawner passes and writes to the port:
//   - FIGHTSTG_F0x80090c44  the fight task spawner (F0x80014504(0x8008f714,0x84,4))
//   - FIGHTSTG_F0x80093cc8  the plate-HUD spawner (F0x80014504(0x80093a74,0x88,0x14))
// A negative control proves the comparison would catch a wrong set of constants.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  FIGHT_TASK_METHOD, FIGHT_TASK_SIZE, FIGHT_TASK_FLAGS, FIGHT_TASK_ARG_BYTE_OFF, FIGHT_TASK_ARG_WORD_OFF,
  PLATE_HUD_METHOD, PLATE_HUD_SIZE, PLATE_HUD_FLAGS,
  spawnFightTask, spawnPlateHud, type SpawnedObject, type TaskSpawn,
} from "../../../engine/dw3/battle-task-spawn.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const available = existsSync(BIN);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const FIGHT_SPAWN = 0x80090c44;
const PLATE_SPAWN = 0x80093cc8;
const ALLOC = 0x80014504; // resident allocator, stubbed
const NEW_OBJ = 0x80100000;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);

function runtime(): NativeStageRuntime {
  return new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, BASE,
  );
}

interface AllocCall { method: number; size: number; flags: number }

function recordAlloc(rt: NativeStageRuntime): AllocCall[] {
  const calls: AllocCall[] = [];
  rt.cpu.setStub(ALLOC, (c) => {
    calls.push({
      method: ((c.reg(4) | 0) >>> 0),
      size: (c.reg(5) | 0) >>> 0,
      flags: (c.reg(6) | 0) >>> 0,
    });
    return NEW_OBJ; // the new object's address
  });
  return calls;
}

// ── 1. the fight task spawner F0x80090c44 ───────────────────────────────────

test("F0x80090c44 fight spawner: constants and stores match the port", SKIP, () => {
  const rt = runtime();
  const calls = recordAlloc(rt);
  const argByte = 0x7;
  const argWord = 0x1234abcd | 0;
  rt.cpu.call(FIGHT_SPAWN, [argByte, argWord], 100000);

  assert.deepEqual(calls, [{ method: FIGHT_TASK_METHOD, size: FIGHT_TASK_SIZE, flags: FIGHT_TASK_FLAGS }]);
  assert.equal(rt.mem.read8(NEW_OBJ + FIGHT_TASK_ARG_BYTE_OFF), argByte & 0xff, "byte arg at +0x50");
  assert.equal(rt.mem.read16(NEW_OBJ + FIGHT_TASK_ARG_WORD_OFF), argWord & 0xffff, "word arg at +0x54");
  assert.equal(rt.mem.read32(NEW_OBJ + FIGHT_TASK_ARG_WORD_OFF), argWord, "full word arg at +0x54");

  // The port, over a matching adapter that writes into fresh records.
  const portCalls: AllocCall[] = [];
  const writes: { off: number; v: number }[] = [];
  const obj: SpawnedObject = { write8: (off, v) => writes.push({ off, v }), write32: (off, v) => writes.push({ off, v }) };
  const spawn: TaskSpawn = (method, size, flags) => { portCalls.push({ method, size, flags }); return obj; };
  spawnFightTask(spawn, argByte, argWord);
  assert.deepEqual(portCalls, calls);
  assert.deepEqual(writes, [
    { off: FIGHT_TASK_ARG_BYTE_OFF, v: argByte & 0xff },
    { off: FIGHT_TASK_ARG_WORD_OFF, v: argWord },
  ]);
});

test("F0x80090c44 fight spawner: the method is 0x8008f714, not the plate method", SKIP, () => {
  const rt = runtime();
  const calls = recordAlloc(rt);
  rt.cpu.call(FIGHT_SPAWN, [0, 0], 100000);
  // Negative control: the fight spawner's constants differ from the plate HUD's.
  assert.equal(calls[0]!.method, FIGHT_TASK_METHOD);
  assert.notEqual(calls[0]!.method, PLATE_HUD_METHOD);
  assert.notEqual(calls[0]!.size, PLATE_HUD_SIZE);
  assert.notEqual(calls[0]!.flags, PLATE_HUD_FLAGS);
});

// ── 2. the plate-HUD spawner F0x80093cc8 ────────────────────────────────────

test("F0x80093cc8 plate spawner: constants match the port and nothing is stored", SKIP, () => {
  const rt = runtime();
  const calls = recordAlloc(rt);
  rt.cpu.call(PLATE_SPAWN, [], 100000);
  assert.deepEqual(calls, [{ method: PLATE_HUD_METHOD, size: PLATE_HUD_SIZE, flags: PLATE_HUD_FLAGS }]);
  // The body stores nothing beyond the allocator's own object.
  for (const off of [0x50, 0x54]) assert.equal(rt.mem.read32(NEW_OBJ + off), 0, `nothing at +${off.toString(16)}`);

  const portCalls: AllocCall[] = [];
  const spawn: TaskSpawn = (method, size, flags) => { portCalls.push({ method, size, flags }); return { write8() {}, write32() {} }; };
  spawnPlateHud(spawn);
  assert.deepEqual(portCalls, calls);
});
