// playBattle voice independence — regression test for the "sustained tech sounds
// never heard" bug (user report 2026-07-08: the Sylph-Storm-class whirl was silent).
// Root cause: playBattle routed through the category arbitration (stopCategory) —
// all common sounds share category 1, so every new op10 sound stopped the previous
// one, including sustained loop voices. The SPU plays op10 sounds on separate
// voices; only the timed-object (context+0xc) gate and dedup may arbitrate.
import { test } from "node:test";
import assert from "node:assert/strict";

// ── minimal WebAudio + fetch fakes ──────────────────────────────────────────
class FakeBuffer {}
class FakeSource {
  constructor(log) { this._log = log; this.playbackRate = { value: 1 }; this.loop = false; }
  connect() {}
  start() { this._log.push({ src: this, ev: "start" }); }
  stop() { this._log.push({ src: this, ev: "stop" }); this.onended?.(); }
}
class FakeCtx {
  constructor(log) { this._log = log; this.state = "running"; this.destination = {}; }
  createGain() { return { gain: {}, connect: () => {} }; }
  createBufferSource() { const s = new FakeSource(this._log); this._log.push({ src: s, ev: "create" }); return s; }
  decodeAudioData() { return Promise.resolve(new FakeBuffer()); }
  resume() { return Promise.resolve(); }
}
// AudioBuffer instanceof check in playBattle:
globalThis.AudioBuffer = FakeBuffer;

const MANIFEST = {
  whirl:  { category: 1, rate: 0.0625, loop: { start: 0.01, end: 0.2 } },
  thud:   { category: 1, rate: 0.25, loop: null },
  jingle: { category: 1, rate: 1, loop: null, dedup: true },
};
const AREA_MANIFEST = {
  evo_00: { evolutio: { category: 68, rate: 1, loop: null } },
};

async function makePlayer(log) {
  globalThis.window = { AudioContext: function () { return new FakeCtx(log); } };
  globalThis.fetch = (url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes("area_manifest.json") ? AREA_MANIFEST
      : String(url).includes("manifest.json") ? MANIFEST : {}),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
  });
  const { createSfxPlayer } = await import("../web/audio.js");
  const p = createSfxPlayer();
  await new Promise((r) => setTimeout(r, 5));   // let manifest fetch settle
  return p;
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test("a new battle sound does NOT stop a sustained voice (separate SPU voices)", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.playBattle("whirl", "player", 49);        // timed loop voice
  await tick();
  const whirlSrc = log.find((e) => e.ev === "start").src;
  assert.equal(whirlSrc.loop, true, "timed loop-pointed voice sustains");
  sfx.playBattle("thud", "enemy", 0);           // one-shot on the other side
  sfx.playBattle("thud", "player", 0);          // and a one-shot on the SAME side
  await tick();
  const stops = log.filter((e) => e.ev === "stop" && e.src === whirlSrc);
  assert.equal(stops.length, 0, "the sustained whirl must keep playing");
  const starts = log.filter((e) => e.ev === "start");
  assert.equal(starts.length, 3, "all three voices actually start");
  sfx.stopBattle("player");                     // key-off works
  assert.ok(log.some((e) => e.ev === "stop" && e.src === whirlSrc));
});

test("timed-object gate still drops a second timed sound on the same side", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.playBattle("whirl", "player", 49);
  await tick();
  sfx.playBattle("whirl", "player", 30);        // slot busy -> authentic drop
  await tick();
  assert.equal(log.filter((e) => e.ev === "start").length, 1);
  sfx.stopBattle("player");
});

test("dedup flag skips retrigger while the same sound plays", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.playBattle("jingle", "player", 20);
  await tick();
  sfx.playBattle("jingle", "enemy", 20);        // same dedup id still live -> skip
  await tick();
  assert.equal(log.filter((e) => e.ev === "start").length, 1);
  sfx.stopBattle("player");
});

test("decoded overlay sounds can play from an explicit archive", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.playBank("evo_00", "evolutio");
  await tick();
  assert.equal(log.filter((e) => e.ev === "start").length, 1);
});
