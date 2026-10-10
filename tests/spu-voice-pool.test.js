// The SPU voice pool — a port of the original's one voice allocator,
// F0x80034b9c (exe fns.s:40073-40231). Every case below names the instruction
// lines it comes from, because this is the only place in the walker that
// decides WHICH of the 24 hardware voices a new sound takes and what happens
// when there is none left.
//
// The shared system, not one screen: the positional call F0x8003432c
// (fns.s:39631) and the 2D phrase sequencer F0x8003581c (fns.s:41033) both ask
// this allocator, so UI blips, footsteps, jingles, techniques and effect loops
// all contend for the same slots.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createSpuVoicePool,
  SPU_VOICE_ALLOCATOR, SPU_VOICE_COUNT, SPU_VOICE_COUNT_LIMIT, SPU_NO_VOICE,
  SPU_VOICE_AGE, SPU_VOICE_SAMPLE_LEFT, SPU_VOICE_PRIORITY, SPU_VOICE_KEYED,
  SPU_VOICE_AGE_AT_BOOT, SPU_PRIORITY_REQUEST, SPU_VOICE_TABLE, SPU_VOICE_STRIDE,
} from "../engine/systems/spu-voice-pool.ts";

/** A voice the pool can hand out, with an occupant whose release is countable. */
function claim(pool, priority, lengthMs = 1000) {
  const got = pool.allocate(priority);
  assert.ok(got, "the pool refused an allocation the original would have made");
  const released = [];
  pool.setLength(got.index, lengthMs);
  pool.keyOn(got.index, { release: () => released.push(got.index) });
  return { index: got.index, evicted: got.evicted, released };
}

test("the pool is the size the sound init asks for", () => {
  // fns.s:35460-35461: `jal F0x800354cc` with `li $a0, 0x18` in the delay slot.
  assert.equal(SPU_VOICE_ALLOCATOR, 0x80034b9c);
  assert.equal(SPU_VOICE_COUNT, 0x18);
  assert.equal(createSpuVoicePool().count, 24);
  // fns.s:40723-40732: the init clamps to at most 24 before storing it.
  assert.equal(SPU_VOICE_COUNT_LIMIT, 0x18);
  assert.equal(createSpuVoicePool({ count: 99 }).count, 24);
  // The refusal value IS the pool size: `u8 D0x8008265c` (fns.s:40175-40176).
  assert.equal(SPU_NO_VOICE, SPU_VOICE_COUNT);
  // The record fields the allocator reads, at their own offsets.
  assert.deepEqual(
    [SPU_VOICE_AGE, SPU_VOICE_SAMPLE_LEFT, SPU_VOICE_PRIORITY, SPU_VOICE_KEYED],
    [0x00, 0x04, 0x18, 0x1b],
  );
  assert.equal(SPU_VOICE_TABLE, 0x80081e3a);
  assert.equal(SPU_VOICE_STRIDE, 0x38);
  assert.equal(SPU_PRIORITY_REQUEST, 0x80082677);
});

test("every voice is free at boot, with the age the init seeds it with", () => {
  // fns.s:40762-40774 zeroes +0x04 and +0x1b on every voice; fns.s:40749/40762
  // writes 0x18 into +0x00.
  const pool = createSpuVoicePool();
  assert.equal(pool.active(), 0);
  assert.equal(pool.records.length, 24);
  for (const r of pool.records) {
    assert.equal(r.keyed, false);
    assert.equal(r.sampleLeft, 0);
    assert.equal(r.age, SPU_VOICE_AGE_AT_BOOT);
  }
  // So the first 24 sounds each take the lowest free index, in order.
  const taken = [];
  for (let i = 0; i < 24; i++) taken.push(claim(pool, 0).index);
  assert.deepEqual(taken, Array.from({ length: 24 }, (_, i) => i));
});

test("a free voice is taken at once and no OTHER age is counted", () => {
  // fns.s:40099-40112: not keyed on AND no sample left -> `j .L0x80034d14`,
  // straight past the age bookkeeping at fns.s:40184-40207. The winner's own
  // age is still reset, because fns.s:40213-40215 runs for any taken index.
  const pool = createSpuVoicePool();
  claim(pool, 0);                       // voice 0, aged 24
  const before = pool.records.map((r) => r.age);
  const got = claim(pool, 0);           // voice 1 is free
  assert.equal(got.index, 1);
  assert.equal(got.evicted, null, "a free voice evicts nobody");
  assert.equal(pool.records[1].age, 0, "the taken voice's own age is reset");
  pool.records.forEach((r, i) => {
    if (i === 1) return;
    assert.equal(r.age, before[i], `voice ${i} age untouched on a free take`);
  });
});

test("the 25th sound cuts the voice with the least audio left, and says so", () => {
  const pool = createSpuVoicePool();
  // Fill all 24 with equal priority and equal remaining length, so the only
  // thing that can separate them is the age counter.
  for (let i = 0; i < 24; i++) claim(pool, 0, 500);
  assert.equal(pool.active(), 24);
  const oldest = pool.records.findIndex((r) => r.age === 0);
  const oldestSrc = pool.records[oldest].occupant;
  const got = pool.allocate(0);
  assert.ok(got, "the 25th sound still gets a voice");
  assert.equal(got.evicted, oldestSrc, "the voice it takes is the one to release");
  assert.equal(got.idle, false, "it was a steal, not a free voice");
});

test("stealing bumps every other voice's age and resets the winner's", () => {
  // fns.s:40184-40203 then fns.s:40213-40215.
  const pool = createSpuVoicePool();
  for (let i = 0; i < 24; i++) claim(pool, 0, 500);
  const before = pool.records.map((r) => r.age);
  const got = claim(pool, 0, 500);
  assert.equal(pool.records[got.index].age, 0);
  pool.records.forEach((r, i) => {
    if (i === got.index) return;
    assert.equal(r.age, before[i] + 1, `voice ${i} aged`);
  });
});

test("a voice is never stolen when every sounding voice outranks the request", () => {
  // fns.s:40136 `bne $a2, $a1, .L0x80034d00` skips a voice whose priority is
  // above the running best; with nothing left to take, fns.s:40169-40176
  // returns `u8 D0x8008265c` and the caller DROPS the sound
  // (fns.s:39637-39642, 41040-41041).
  const pool = createSpuVoicePool();
  for (let i = 0; i < 24; i++) claim(pool, 1, 500);
  assert.equal(pool.allocate(0), null, "a lower-priority sound is refused");
  assert.equal(pool.active(), 24, "and nothing was cut to make room");
  // The disc gives byte 0 = 1 to a handful of common tones; one of those may
  // take a priority-0 voice, because lower IS stealable.
  assert.ok(pool.allocate(1), "an equal or higher request may steal");
});

test("priority decides before age: a louder sound outranks an older quiet one", () => {
  const pool = createSpuVoicePool();
  for (let i = 0; i < 24; i++) claim(pool, i < 23 ? 0 : 1, 500);
  // Voice 23 carries priority 1 and is the OLDEST of the priority-0 voices'
  // rivals; a priority-0 request may not touch it, so the steal must land on a
  // priority-0 voice even though the 1 is older.
  const loud = pool.records[23].occupant;
  const got = pool.allocate(0);
  assert.ok(got);
  assert.notEqual(got.evicted, loud, "a priority-1 voice is untouchable at priority 0");
  assert.equal(pool.records[got.index].priority, 0);
});

test("a refused request is refused, and a later free voice is still free", () => {
  const pool = createSpuVoicePool();
  for (let i = 0; i < 24; i++) claim(pool, 1, 500);
  assert.equal(pool.allocate(0), null);
  pool.keyOff(3);
  const got = claim(pool, 0);
  assert.equal(got.index, 3, "the voice that was keyed off is the one reused");
});

test("the sample-left field falls as the voice plays, and that is what breaks ties", () => {
  // fns.s:40143 `sltu $v0, $a1, $a0`: among equal priorities the voice with the
  // LEAST sample left is cut, so the steal is the one you hear least. Fill the
  // pool first, because a free voice always wins over any steal.
  let clock = 0;
  const pool = createSpuVoicePool({ now: () => clock });
  claim(pool, 0, 900);                  // voice 0: 900 ms of audio
  claim(pool, 0, 100);                  // voice 1: 100 ms of audio
  for (let i = 2; i < 24; i++) claim(pool, 0, 5000);
  clock = 50;
  assert.equal(pool.sampleLeft(0), 850);
  assert.equal(pool.sampleLeft(1), 50);
  const got = pool.allocate(0);
  assert.equal(got.index, 1, "voice 1 has the least audio left, so it goes first");
});

test("voices the mask covers are invisible to the allocator", () => {
  // fns.s:40089-40094: a voice whose bit is set in D0x8005c070 is skipped
  // outright — never taken, never stolen, never aged.
  const pool = createSpuVoicePool({ masked: 0b11 });
  assert.equal(claim(pool, 0, 500).index, 2);
  assert.equal(claim(pool, 0, 500).index, 3);
  assert.equal(pool.allocate(0).index, 4, "the scan starts past the masked voices");
  for (const i of [0, 1]) {
    assert.equal(pool.records[i].age, SPU_VOICE_AGE_AT_BOOT, `masked voice ${i} never aged`);
    assert.equal(pool.records[i].occupant, null);
    assert.equal(pool.records[i].keyed, false);
  }
});

test("stopAll keys every voice off", () => {
  const pool = createSpuVoicePool();
  const held = [];
  for (let i = 0; i < 5; i++) held.push(claim(pool, 0).released);
  pool.stopAll();
  assert.equal(pool.active(), 0);
  assert.deepEqual(held.flat(), [0, 1, 2, 3, 4]);
});
