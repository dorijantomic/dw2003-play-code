// The audio layer's cue lifetimes, as ONE rule (fns.s:17704-17717, 17771-17923;
// .dw3-research/rig-sweep-2026-10-05/audio-lifetime-model.md §6):
//
//   A cue's lifetime is owned by the sound driver's slot record, keyed
//   (bank, slot) — never by the screen that started it.  A cue with bit 30 set
//   (every music track and jingle) goes through ONE exclusive register: a start
//   first stops whichever id the register holds, through that holder's own stop
//   entry, then takes the register; a start of the id already registered does
//   not retrigger; only an explicit stop-by-id / stop-all clears it.  A cue with
//   bit 30 clear (the pad flashes' digi_en family, ordinary effects) lives in
//   its own slot: it never takes the register, never replaces a sibling, and no
//   screen teardown touches it.
//
// The two players — bgm and sfx — share the ONE register, and that is the fix
// for the player-reported bugs: returning to the field ends W_JINGLE (the field
// track's start replaces it), W_JINGLE ends the battle track, and the download's
// digi_en0..2 are never cut or replaced by anything.
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
    return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect: () => {} };
  }
  createBufferSource() { return new FakeSource(this._log); }
  decodeAudioData() { return Promise.resolve(new FakeBuffer()); }
  resume() { return Promise.resolve(); }
}

// Real ids and real path flags, straight out of web/assets/sfx/manifest.json.
const MANIFEST = {
  w_jingle: { id: "0x6004001e", positional: false, dedup: true, rate: 1, loop: null },
  gameover: { id: "0x60040008", positional: false, dedup: true, rate: 1, loop: null },
  system03: { id: "0x00040019", positional: false, dedup: false, rate: 1, loop: null },
};

function installFakes(log) {
  const els = [];
  class FakeAudio {
    constructor() { this.src = ""; this.paused = true; this.plays = []; els.push(this); }
    play() { this.paused = false; this.plays.push(this.src); return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  globalThis.Audio = FakeAudio;
  globalThis.AudioBuffer = FakeBuffer;
  globalThis.window = { AudioContext: function () { return new FakeCtx(log); } };
  globalThis.fetch = (url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes("area_manifest.json") ? {}
      : String(url).includes("manifest.json") ? MANIFEST : {}),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
  });
  return els;
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test("the register stops the previous holder through its own stop entry", async () => {
  const { createExclusiveRegister } = await import("../web/audio.js?register=" + Math.random());
  const register = createExclusiveRegister();
  const stopped = [];
  assert.equal(register.begin("a", "a", () => stopped.push("a")), true);
  assert.equal(register.begin("a", "a", () => stopped.push("again")), false,
    "the same id already registered is not retriggered");
  assert.deepEqual(stopped, [], "and nothing was stopped");
  assert.equal(register.begin("b", "b", () => stopped.push("b")), true);
  assert.deepEqual(stopped, ["a"], "the replaced holder's own stop entry ran once");
  register.releaseName("a");
  assert.equal(register.id(), "b", "a stop of a non-holder does not clear the register");
  register.releaseName("b");
  assert.equal(register.id(), null, "an explicit stop-by-name clears it");
  register.begin("c", "c", () => {});
  register.clear();
  assert.equal(register.id(), null, "stop-all clears it outright");
});

test("the field track's start ends W_JINGLE: one register, both players", async () => {
  const log = [];
  const els = installFakes(log);
  const mod = await import("../web/audio.js?lifetimes=" + Math.random());
  const register = mod.createExclusiveRegister();
  const bgm = mod.createBgmPlayer(register);
  const sfx = mod.createSfxPlayer(register);
  await tick();

  // The battle track is playing and holds the register.
  bgm.play("batl00");
  assert.equal(register.id(), "batl00");

  // The win arm plays W_JINGLE (bit 30): its start stops the held track.
  sfx.play("w_jingle");
  await tick();
  const battleEl = els.find((e) => e.src.endsWith("batl00.ogg"));
  assert.equal(battleEl.paused, true, "W_JINGLE's start stops the battle track");
  assert.equal(bgm.current, null, "and the stopped track lets go of `current`");
  assert.equal(register.id(), "0x6004001e", "W_JINGLE now holds the register");

  // Leaving the results screen starts the field track: THAT start ends the
  // jingle through its own stop entry — the reported bug was this side never
  // going through the register at all.
  bgm.play("field_env");
  await tick();
  const jingleStopped = log.some((e) => e.ev === "stop");
  assert.ok(jingleStopped, "returning to the field keys W_JINGLE's voice off");
  assert.equal(register.id(), "field_env", "the field track holds the register now");

  // The same track does not retrigger while it is the registered id.
  const fieldEl = els.find((e) => e.src.endsWith("field_env.ogg"));
  assert.equal(fieldEl, battleEl, "tracks share the one music element");
  assert.deepEqual(fieldEl.plays,
    ["assets/music/batl00.ogg", "assets/music/field_env.ogg"]);
  bgm.play("field_env");
  assert.equal(fieldEl.plays.length, 2, "a plain replay of the same track is a no-op");

  // Only an explicit stop clears it.
  bgm.play(null);
  assert.equal(register.id(), null, "a stop-by-id clears the register");
  bgm.play("field_env");
  assert.equal(fieldEl.plays.length, 3, "and the same track can start again after it");
});

test("an exclusive jingle's start ends the battle track; the replay restarts it", async () => {
  const log = [];
  const els = installFakes(log);
  const mod = await import("../web/audio.js?replay=" + Math.random());
  const register = mod.createExclusiveRegister();
  const bgm = mod.createBgmPlayer(register);
  const sfx = mod.createSfxPlayer(register);
  await tick();

  bgm.play("batl00");
  const battleEl = els.find((e) => e.src.endsWith("batl00.ogg"));
  assert.equal(battleEl.plays.length, 1);
  // A bit-30 jingle takes the register (W_JINGLE, GAMEOVER and EVOLUTIO all
  // do this); the battle track stops through the register, no stop call.
  sfx.play("gameover");
  await tick();
  assert.equal(battleEl.paused, true, "the exclusive start stopped the track");
  assert.equal(register.id(), "0x60040008");
  // The transformation ends: the saved track is re-played (fightstg .L0x8008a768).
  bgm.play("batl00");
  assert.equal(battleEl.paused, false, "the replay starts the track again");
  assert.equal(battleEl.plays.length, 2, "and it starts from the top");
});

test("the same exclusive id does not retrigger", async () => {
  const log = [];
  installFakes(log);
  const mod = await import("../web/audio.js?dedup=" + Math.random());
  const register = mod.createExclusiveRegister();
  const sfx = mod.createSfxPlayer(register);
  await tick();
  sfx.play("w_jingle");
  await tick();
  sfx.play("w_jingle");
  await tick();
  const starts = log.filter((e) => e.ev === "start");
  assert.equal(starts.length, 1, "bit 30, same id: no retrigger");
});

test("the pad cues are non-exclusive: siblings never replace each other", async () => {
  const log = [];
  const els = installFakes(log);
  const mod = await import("../web/audio.js?pads=" + Math.random());
  const register = mod.createExclusiveRegister();
  const bgm = mod.createBgmPlayer(register);

  bgm.play("field_env");
  const fieldEl = els.find((e) => e.src.endsWith("field_env.ogg"));
  assert.equal(register.id(), "field_env");

  // The download's cues: digi_en0..2 are bit 30 CLEAR (slots 0/1/2), so each
  // must keep its own element and ring out beside the others and the track.
  bgm.playJingle("digi_en0");
  bgm.playJingle("digi_en1");
  bgm.playJingle("digi_en2");
  const e0 = els.find((e) => e.src.endsWith("digi_en0.ogg"));
  const e1 = els.find((e) => e.src.endsWith("digi_en1.ogg"));
  const e2 = els.find((e) => e.src.endsWith("digi_en2.ogg"));
  assert.ok(e0 && e1 && e2 && e0 !== e1 && e1 !== e2,
    "each cue owns its own element");
  assert.ok(!e0.paused && !e1.paused && !e2.paused, "all three are sounding");
  assert.equal(register.id(), "field_env", "a non-exclusive cue never takes the register");
  assert.equal(fieldEl.paused, false, "and never cuts the running track");
});

test("entering a stage with no play id stops the current exclusive (fieldstg 8278-8281)", async () => {
  const log = [];
  installFakes(log);
  const mod = await import("../web/audio.js?noMusic=" + Math.random());
  const register = mod.createExclusiveRegister();
  const bgm = mod.createBgmPlayer(register);
  const sfx = mod.createSfxPlayer(register);
  await tick();

  // A jingle from a previous screen holds the register via the sfx side.
  sfx.play("w_jingle");
  await tick();
  assert.equal(register.id(), "0x6004001e");

  // A stage with no play id does not start a track; the field entry stops the
  // register's holder outright (not by name, and not by the bgm's own id).
  register.stopHeld();
  assert.equal(register.id(), null, "the register is empty after the entry stop");
  assert.ok(log.some((e) => e.ev === "stop"), "the held jingle's voice was keyed off");
});
