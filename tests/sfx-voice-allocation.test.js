// The shared voice pool, through the REAL web/audio.js: what voice a new sound
// takes when the 24 SPU voices are all busy.
//
// This is the shared system of the original, not one screen's: F0x80034b9c
// (exe fns.s:40073-40231) is asked by the positional call F0x8003432c
// (fns.s:39631) and by the 2D phrase sequencer F0x8003581c (fns.s:41033), so
// every cue the game plays contends for the same 24 slots — the pool size the
// sound init asks for with `li $a0, 0x18` (fns.s:35460-35461).
//
// Web Audio has no such limit. Before the port every cue stacked on top of the
// last one however many were already playing, so the walker could hold far more
// simultaneous sounds than the hardware ever could and never had to cut one.
import { test } from "node:test";
import assert from "node:assert/strict";

class FakeBuffer {
  /** Long enough that a voice only ends when something keys it off. */
  constructor() { this.duration = 0.5; }
}
class FakeSource {
  constructor(log) { this._log = log; this.playbackRate = { value: 1 }; this.loop = false; }
  connect() {}
  start() { this._log.push({ src: this, ev: "start" }); }
  stop() { this._log.push({ src: this, ev: "stop" }); this.onended?.(); }
}
class FakeCtx {
  constructor(log) { this._log = log; this.state = "running"; this.destination = {}; this.currentTime = 0; }
  createGain() {
    return {
      gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect: () => {},
    };
  }
  createBufferSource() { const s = new FakeSource(this._log); this._log.push({ src: s, ev: "create" }); return s; }
  decodeAudioData() { return Promise.resolve(new FakeBuffer()); }
  resume() { return Promise.resolve(); }
}
globalThis.AudioBuffer = FakeBuffer;

// 25 distinct 2D cues: bit 31 clear, bit 30 clear, one slot each, so nothing
// here can be explained by the per-slot self-cut. Twenty-four of them carry the
// priority the disc gives most tones (byte 0 = 0); cue25 carries the priority-1
// value that 29 of the 375 area sounds have.
const MANIFEST = {};
const NAMES = [];
for (let i = 0; i < 25; i++) {
  const name = `cue${String(i).padStart(2, "0")}`;
  NAMES.push(name);
  MANIFEST[name] = {
    id: `0x0004${(0x40 + i).toString(16).padStart(2, "0")}`,
    positional: false,
    dedup: false,
    priority: i === 24 ? 1 : 0,
    rate: 1,
    loop: null,
  };
}

async function makePlayer(log, manifest = MANIFEST) {
  globalThis.window = { AudioContext: function () { return new FakeCtx(log); } };
  globalThis.fetch = (url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes("area_manifest.json") ? {}
      : String(url).includes("manifest.json") ? manifest : {}),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
  });
  const { createSfxPlayer } = await import("../web/audio.js?pool=" + Math.random());
  const p = createSfxPlayer();
  await new Promise((r) => setTimeout(r, 5));
  return p;
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const starts = (log) => log.filter((e) => e.ev === "start");
const stops = (log) => log.filter((e) => e.ev === "stop");

test("24 cues fill the pool, and the 25th cuts one instead of stacking", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  for (const name of NAMES.slice(0, 24)) sfx.play(name);
  await tick();
  assert.equal(starts(log).length, 24, "the pool is 24 voices and 24 cues fill it");
  assert.equal(stops(log).length, 0, "nothing had to be cut yet");

  sfx.play(NAMES[24]);                       // the 25th
  await tick();
  assert.equal(starts(log).length, 25, "the 25th still sounds");
  assert.equal(stops(log).length, 1, "and it cut exactly one voice to make room");
  // Equal priorities and equal lengths leave only the age to separate them, so
  // the cut is the oldest voice -- the first one taken.
  assert.equal(stops(log)[0].src, starts(log)[0].src);
});

test("a sound with no voice left to take plays nothing at all", async () => {
  // fns.s:40136 `bne $a2, $a1, .L0x80034d00` skips every voice whose priority
  // is above the request, and fns.s:40169-40176 then answers `u8 D0x8008265c`,
  // which both callers read as "drop it" (F0x8003432c returns -1 at
  // fns.s:39637-39642; the sequencer bails at fns.s:41040-41041). So a pool of
  // 24 priority-1 voices leaves no room for a priority-0 one -- and the disc
  // really does give byte 0 = 1 to 29 of the 375 area sounds.
  const loud = {};
  const loudNames = [];
  for (let i = 0; i < 24; i++) {
    const name = `loud${i}`;
    loudNames.push(name);
    loud[name] = { ...MANIFEST[`cue${String(i).padStart(2, "0")}`], priority: 1 };
  }
  // A slot of its own, so the refusal is the pool's answer and not the 2D
  // path's own-slot key-off (F0x8003340c keys off before it allocates).
  loud.quiet0 = { ...MANIFEST.cue00, id: "0x0004ff", priority: 0 };
  const log = [];
  const sfx = await makePlayer(log, loud);
  for (const name of loudNames) sfx.play(name);
  await tick();
  assert.equal(starts(log).length, 24);
  assert.equal(stops(log).length, 0);

  sfx.play("quiet0");                         // outranked by every voice
  await tick();
  assert.equal(starts(log).length, 24, "the refused cue never starts a voice");
  assert.equal(stops(log).length, 0, "and it does not cut anything to try");
});

test("a battle voice and a field voice contend for the same 24 slots", async () => {
  // One allocator, two paths: the field cue and the op10 battle cue both go
  // through F0x80034b9c in the original.
  const log = [];
  const sfx = await makePlayer(log);
  for (const name of NAMES.slice(0, 24)) sfx.play(name);
  await tick();
  sfx.playBattle(NAMES[24], "player");
  await tick();
  assert.equal(starts(log).length, 25);
  assert.equal(stops(log).length, 1, "the battle cue cut a field voice, not nothing");
});

test("stopAll frees the whole pool, so the next cue starts from silence", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  for (const name of NAMES.slice(0, 24)) sfx.play(name);
  await tick();
  sfx.stopAll();
  assert.equal(stops(log).length, 24, "every voice keyed off");
  log.length = 0;
  for (const name of NAMES.slice(0, 24)) sfx.play(name);
  await tick();
  assert.equal(starts(log).length, 24);
  assert.equal(stops(log).length, 0, "a freed voice is a free voice again");
});

test("a positional cue that ends returns its voice to the pool", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  // A looping positional cue (the special-attack pack shape: bit 31 set, a
  // loop in the manifest) is the one walker sound that holds a voice open.
  sfx.playSustained("cue00");
  await tick();
  assert.equal(starts(log).length, 1);
  sfx.stopSustained("cue00");
  assert.equal(stops(log).length, 1, "one key-off, one stop");
  log.length = 0;
  for (const name of NAMES.slice(0, 24)) sfx.play(name);
  await tick();
  assert.equal(stops(log).length, 0, "the pool has a free voice again, so nothing is cut");
});
