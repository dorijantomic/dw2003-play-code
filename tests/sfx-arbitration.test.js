// Packed-sound arbitration, as the resident driver actually does it.
//
// This module used to cut sounds by "category" = packed-id bits 18-24. That
// reading was retracted in docs/research/audio/sound-system.md on 2026-07-03b:
// those bits are an ARCHIVE id, and F0x80020030 uses them only to find which of
// the three channel records currently holds that archive. Nothing in the driver
// stops a sound because another sound shares them — and since nearly every
// common-bank cue carries archive 1, the old model made every UI blip, footstep
// and jingle cut every other one.
//
// The two mechanisms that really arbitrate (EXE, authority 2):
//
//   1. Per-slot self-cut, 2D path only. Bit 31 clear -> F0x800335b4 ->
//      F0x8003340c, whose first act is F0x800375ec(bank | slot<<8): key off
//      every hardware voice owned by that (bank, slot) and no other. Bit 31 set
//      takes F0x8003432c, which allocates a fresh voice via F0x80034b9c and
//      keys nothing off.
//   2. The exclusive-track register D0x80055c34 (= D0x800519ec+0x4248), a
//      single global guarded by bit 30: same id -> do not retrigger; different
//      id -> stop the old one first. Only an explicit stop clears it.
import { test } from "node:test";
import assert from "node:assert/strict";

class FakeBuffer {}
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

// Real ids and real path flags, straight out of web/assets/sfx/manifest.json.
const MANIFEST = {
  // 2D path (bit 31 clear): archive 1, distinct slots 0x19 / 0x1a / 0x1b.
  system03: { id: "0x00040019", positional: false, rate: 1, loop: null },
  system04: { id: "0x0004001a", positional: false, rate: 1, loop: null },
  system06: { id: "0x0004001b", positional: false, rate: 1, loop: null },
  // positional path (bit 31 set): archive 1, allocates a fresh voice
  player00: { id: "0x8004583c", positional: true, rate: 0.126, loop: null },
  // bit 30 set -> takes the exclusive-track register
  excl_a: { id: "0x40040030", positional: false, dedup: true, rate: 1, loop: null },
  excl_b: { id: "0x40040031", positional: false, dedup: true, rate: 1, loop: null },
};

async function makePlayer(log) {
  globalThis.window = { AudioContext: function () { return new FakeCtx(log); } };
  globalThis.fetch = (url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes("area_manifest.json") ? {}
      : String(url).includes("manifest.json") ? MANIFEST : {}),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
  });
  const { createSfxPlayer } = await import("../web/audio.js?arb=" + Math.random());
  const p = createSfxPlayer();
  await new Promise((r) => setTimeout(r, 5));
  return p;
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const starts = (log) => log.filter((e) => e.ev === "start");
const stopsOf = (log, src) => log.filter((e) => e.ev === "stop" && e.src === src);

test("different sounds sharing an archive do NOT cut each other", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.play("system03");                       // slot 0x19
  await tick();
  const first = starts(log)[0].src;
  sfx.play("system04");                       // slot 0x1a — different slot
  sfx.play("system06");                       // slot 0x1b — different slot
  await tick();
  assert.equal(starts(log).length, 3, "all three cues start");
  assert.equal(stopsOf(log, first).length, 0,
    "a cue is not stopped by another cue from the same archive");
});

test("the same 2D sound cuts its own previous voice (F0x800375ec self key-off)", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.play("system03");
  await tick();
  const first = starts(log)[0].src;
  sfx.play("system03");                       // same (bank, slot) -> keyed off
  await tick();
  assert.equal(starts(log).length, 2);
  assert.equal(stopsOf(log, first).length, 1, "its own previous voice is keyed off");
});

test("a positional sound never keys anything off, not even itself", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.play("player00");                       // the walk footstep, refired
  await tick();
  const first = starts(log)[0].src;
  sfx.play("player00");
  await tick();
  assert.equal(starts(log).length, 2);
  assert.equal(stopsOf(log, first).length, 0,
    "F0x8003432c allocates a fresh voice; the earlier one rings out");
});

test("bit 30: the same exclusive id does not retrigger", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.play("excl_a");
  await tick();
  sfx.play("excl_a");                         // register already holds it
  await tick();
  assert.equal(starts(log).length, 1);
});

test("bit 30: a different exclusive id stops the one holding the register", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.play("excl_a");
  await tick();
  const a = starts(log)[0].src;
  sfx.play("excl_b");                         // takes the single global register
  await tick();
  assert.equal(starts(log).length, 2);
  assert.equal(stopsOf(log, a).length, 1, "the previous exclusive track is stopped");
});

test("only an explicit stop clears the exclusive register", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.play("excl_a");
  await tick();
  sfx.stop("excl_a");                         // F0x800202d4 stores zero at 0x80055c34
  sfx.play("excl_a");                         // register free -> plays again
  await tick();
  assert.equal(starts(log).length, 2);
});

test("stopAll clears every voice and the exclusive register (F0x80020204)", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.play("system03");
  sfx.play("excl_a");
  await tick();
  sfx.stopAll();
  assert.equal(log.filter((e) => e.ev === "stop").length, 2, "both voices stop");
  sfx.play("excl_a");                         // register was cleared
  await tick();
  assert.equal(starts(log).length, 3);
});

test("the fading stop exists and releases the sound (F0x8002037c)", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.play("excl_a");
  await tick();
  sfx.stopFade("excl_a", 0.01);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(log.filter((e) => e.ev === "stop").length, 1, "the voice is released after the ramp");
  sfx.play("excl_a");
  await tick();
  assert.equal(starts(log).length, 2, "and the exclusive register was cleared");
});
