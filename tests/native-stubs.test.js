// Production stub boundary tests (engine/native/stubs.ts): allocator layout,
// state-machine method semantics, flag/rand routing — all against the decoded
// EXE behavior (docs/research/field/s780-street-life-native-system.md §allocator).

import { test } from "node:test";
import assert from "node:assert/strict";
import { NativeMemory } from "../engine/native/memory.ts";
import { R3000 } from "../engine/native/mips.ts";
import { A, destroyTrackedObject, installCoreStubs } from "../engine/native/stubs.ts";

function makeHost(overrides = {}) {
  const calls = { set: [], get: [] };
  return {
    calls,
    host: {
      setFlag: (id, v) => calls.set.push([id, v]),
      getFlag: (id) => (calls.get.push(id), 1),
      rand16: () => 0x123,
      ...overrides,
    },
  };
}

function rig() {
  const mem = new NativeMemory();
  const cpu = new R3000(mem);
  const { host, calls } = makeHost();
  const world = installCoreStubs(cpu, host);
  return { mem, cpu, world, calls };
}

// hand-assembled caller: jal <addr> with args, then jr $ra — used via cpu.call on
// a stubbed address directly (call() links $ra to the exit sentinel, and stubs
// return through $ra, so calling a stub address works without any native code).

test("alloc stub reproduces the decoded object layout", () => {
  const { mem, cpu, world } = rig();
  const obj = cpu.call(A.ALLOC_ID, [0x800a67a4, 0x60, 0x1c, 0x321]) >>> 0;
  assert.equal(world.objects.length, 1);
  assert.equal(mem.read32(obj + 0x48) >>> 0, 0x800a67a4); // tick cb
  assert.equal(mem.read32(obj + 0x38) >>> 0, A.ADV_STATE); // inline methods
  assert.equal(mem.read32(obj + 0x4c) >>> 0, A.DESTROY);
  assert.equal(mem.read32(obj + 0x20), 0x1c >> 2); // extra word count
  assert.notEqual(mem.read32(obj + 0x24), 0); // extra buffer allocated
  assert.equal(mem.read32(obj + 0x0), 0x321); // registered id
  assert.equal(world.objects[0].id, 0x321);
});

test("ALLOC (0x80014504) forces id 0 and skips registration fields", () => {
  const { mem, cpu, world } = rig();
  const obj = cpu.call(A.ALLOC, [0x800a5ec0, 0x70, 0]) >>> 0;
  assert.equal(mem.read32(obj + 0x0), 0);
  assert.equal(mem.read32(obj + 0x24), 0); // no extra buffer
  assert.equal(world.objects[0].id, 0);
});

test("state-machine methods: setState zeroes subs, advanceState increments and zeroes subs", () => {
  const { mem, cpu } = rig();
  const obj = cpu.call(A.ALLOC, [0x1000, 0x60, 0]) >>> 0;
  cpu.call(A.SET_STATE, [obj, 7]);
  mem.write32(obj + 0x10, 99); // dirty a sub-counter
  assert.equal(mem.read32(obj + 0xc), 7);
  const v = cpu.call(A.ADV_STATE, [obj]);
  assert.equal(v, 8); // real code returns the incremented value in v0
  assert.equal(mem.read32(obj + 0xc), 8);
  assert.equal(mem.read32(obj + 0x10), 0); // subs zeroed
  cpu.call(A.SET_SUB3, [obj, 5]);
  assert.equal(mem.read32(obj + 0x18), 5);
  cpu.call(A.ADV_SUB3, [obj]);
  assert.equal(mem.read32(obj + 0x18), 6);
});

test("destroy marks the object dead", () => {
  const { cpu, world } = rig();
  const obj = cpu.call(A.ALLOC, [0x1000, 0x60, 0]) >>> 0;
  assert.equal(world.objects[0].alive, true);
  cpu.call(A.DESTROY, [obj]);
  assert.equal(world.objects[0].alive, false);
});

test("destroyTrackedObject: lifecycle-3 parent releases children and nulls the parent slot", () => {
  // F0x80018140 + F0x80014308 semantics: destroy is recursive over the +0x24
  // child array, and every parent slot naming the dead object reads back NULL.
  const { mem, world } = rig();
  const parent = cpuAlloc(mem, world, 0x80010000, 8); // extra = 2 words
  const child = cpuAlloc(mem, world, 0x80010004, 4);
  const grandchild = cpuAlloc(mem, world, 0x80010008, 0);
  const array = mem.read32(parent + 0x24) >>> 0;
  mem.write32(array + 0, child);
  mem.write32(array + 4, grandchild);
  const childArray = mem.read32(child + 0x24) >>> 0;
  mem.write32(childArray + 0, grandchild);
  assert.equal(destroyTrackedObject(mem, world, child >>> 0), true);
  assert.equal(world.objects.find((o) => o.addr === child).alive, false);
  assert.equal(world.objects.find((o) => o.addr === grandchild).alive, false);
  assert.equal(mem.read32(array + 0), 0); // parent slot cleared
  assert.equal(mem.read32(array + 4), 0); // grandchild was in the same array
  assert.equal(world.objects.find((o) => o.addr === parent).alive, true);
});

test("destroyTrackedObject: unknown address is not a tracked object", () => {
  const { mem, world } = rig();
  assert.equal(destroyTrackedObject(mem, world, 0x80123450), false);
  assert.equal(destroyTrackedObject(mem, world, 0x80010000), false);
});

function cpuAlloc(mem, world, cb, extraSize) {
  // Through the ALLOC stub would need a cpu; call the world allocator directly
  // so the test can build a parent/child tree without executing MIPS.
  return world.alloc(cb, 0x60, extraSize, 0) >>> 0;
}

test("flag + rand stubs route to the host; global fn pointers are seeded", () => {
  const { mem, cpu, calls } = rig();
  assert.equal(mem.read32(A.GLOBAL_SET_FLAG_PTR) >>> 0, A.SET_FLAG);
  assert.equal(mem.read32(A.GLOBAL_RAND_PTR) >>> 0, A.RAND_U16);
  cpu.call(A.SET_FLAG, [0x1c45, 1]);
  assert.deepEqual(calls.set, [[0x1c45, 1]]);
  assert.equal(cpu.call(A.GET_FLAG, [0x1c45]), 1);
  assert.deepEqual(calls.get, [0x1c45]);
  assert.equal(cpu.call(A.RAND_U16, []), 0x123);
});

test("frame-delta stub returns the [0x8004de28] global", () => {
  const { mem, cpu } = rig();
  mem.write32(A.GLOBAL_FRAME_DELTA_VALUE, 2);
  assert.equal(cpu.call(A.FRAME_DELTA, []), 2);
});

test("overlay-style call through a global fn pointer reaches the stub", () => {
  // lw v0, lo(ptr)(v0hi); jalr v0 — the exact pattern wstag code uses
  const { mem, cpu, calls } = rig();
  const BASE = 0x800a5de0;
  const words = [
    0x27bdffe8, // addiu sp, sp, -0x18
    0xafbf0010, // sw ra, 0x10(sp)
    0x3c028005, // lui v0, 0x8005 → 0x80050000
    0x8c42ac8c + (0x8ac8 - 0x8ac8), // placeholder, replaced below
    0x00000000, // nop
    0x0040f809, // jalr v0
    0x24040042, // addiu a0, zero, 0x42 (delay slot: flag id)
    0x8fbf0010, // lw ra, 0x10(sp)
    0x00000000, // nop
    0x03e00008, // jr ra
    0x27bd0018, // addiu sp, sp, 0x18
  ];
  // lw v0, -0x7538(v0) → [0x80048ac8] (set_flag ptr): 0x8c42 8ac8 with base 0x80050000
  words[3] = (0x23 << 26) | (2 << 21) | (2 << 16) | ((A.GLOBAL_SET_FLAG_PTR - 0x80050000) & 0xffff);
  const bytes = new Uint8Array(words.length * 4);
  words.forEach((w, i) => new DataView(bytes.buffer).setUint32(i * 4, w >>> 0, true));
  mem.load(bytes, BASE);
  cpu.call(BASE, []);
  assert.equal(calls.set.length, 1);
  assert.equal(calls.set[0][0], 0x42);
});
