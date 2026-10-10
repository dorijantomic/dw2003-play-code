// One SPU voice per note-on, through the REAL web/audio.js.
//
// The shared system here is the phrase sequencer `F0x8003581c` (exe,
// `fns.s:40884-41301`) and the voice pool it draws from. For every note entry it
// calls `F0x80034b9c` at `fns.s:41033` with byte 0 of THAT NOTE'S tone record,
// and a refusal (`fns.s:41039-41040`) silences that one note and lets the phrase
// carry on. The note-off frees the voice's slot at once — both branches of the
// key-off clear the record (F0x8003670c / F0x8003674c, `fns.s:41875-41900`) —
// while the SPU's envelope rings the release out, and so does the end of a
// one-shot sample.
//
// What the walker did before: render the whole phrase into one WAV and play it on
// a single voice at the first note's priority, so a 12-note cue held one of the
// hardware's 24 voices, a later note could never be cut or dropped on its own,
// and 12 notes played at 12 different priorities played at one.
//
// The table these read (`web/sfx-voice/phrases.json`) is generated from the disc's
// own scores by build_sfx.py, and `tests/sfx-phrase-voices.test.js` checks that
// every note in it is that disc phrase, rendered exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const TABLE = JSON.parse(fs.readFileSync("web/sfx-voice/phrases.json", "utf8"));
const MANIFEST = JSON.parse(fs.readFileSync("web/assets/sfx/manifest.json", "utf8"));

/** One sample file, 16-bit mono PCM, as the real page would fetch it. */
function sampleWav(vag) {
  // A copy: a node Buffer can sit in a pooled ArrayBuffer, and handing that
  // pool to the decoder would decode the wrong bytes.
  const b = fs.readFileSync(`web/sfx-voice/${TABLE.samples[vag].file}`);
  return Uint8Array.from(b).buffer;
}

class FakeAudioBuffer {
  constructor(channels, length, rate) {
    // The real API refuses a 0-frame buffer (NotSupportedError). Keep that:
    // a sample that failed to decode is 0 frames long, and without this the
    // whole phrase would pass as "silent but started".
    if (!(length > 0)) throw new Error("createBuffer: the number of frames must be > 0");
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = rate;
    this._data = [new Float32Array(length)];
  }
  // Web Audio scales 16-bit input to -1..1; so does this, or a note's volume
  // would look wrong in every number below.
  copyToChannel(src, i) {
    for (let k = 0; k < src.length; k++) this._data[i][k] = src[k] / 32768;
  }
  getChannelData(i) { return this._data[i]; }
}
class FakeBuffer extends FakeAudioBuffer {
  constructor() { super(1, 44100, 44100); }
}
class FakeSource {
  constructor(log) {
    this._log = log;
    this.playbackRate = { value: 1 };
    this.loop = false;
    this.buffer = null;
  }
  connect() {}
  start(when = 0) { this._log.push({ src: this, ev: "start", when }); }
  stop() {
    // Every call is logged, even a repeat: the original's key-off count is
    // audible in the stop log, and a source stopped twice is a double key-off.
    this._log.push({ src: this, ev: "stop" });
    if (this._stopped) return;
    this._stopped = true;
    this.onended?.();
  }
  get ended() { return !!this._stopped; }
}
class FakeCtx {
  constructor(log) {
    this._log = log;
    this.state = "running";
    this.destination = {};
    // A real AudioContext's clock runs with the page, and the scheduler leans on
    // that: a note's note-off is placed at (its start + its note-off) on this
    // clock. A frozen clock would fire the note-offs in the wrong order.
    this._born = Date.now();
  }
  get currentTime() { return (Date.now() - this._born) / 1000; }
  createGain() {
    return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
  }
  createBuffer(ch, len, rate) { return new FakeAudioBuffer(ch, len, rate); }
  createBufferSource() { const s = new FakeSource(this._log); this._log.push({ src: s, ev: "create" }); return s; }
  decodeAudioData() { return Promise.resolve(new FakeBuffer()); }
  resume() { return Promise.resolve(); }
}
globalThis.AudioBuffer = FakeBuffer;

const fetchFor = (manifest) => (url) => {
  const u = String(url);
  if (u.includes("sfx-voice/phrases.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(TABLE) });
  if (u.includes("/samples/")) {
    const m = /samples\/(\d+)\.wav$/.exec(u);
    return Promise.resolve({ ok: !!m, arrayBuffer: () => Promise.resolve(sampleWav(Number(m[1]))) });
  }
  if (u.includes("manifest.json") && !u.includes("area")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}), arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
};

async function makePlayer(log, manifest = MANIFEST, tag = "p") {
  globalThis.window = { AudioContext: function () { return new FakeCtx(log); } };
  globalThis.fetch = fetchFor(manifest);
  const { createSfxPlayer } = await import("../web/audio.js?" + tag + "=" + Math.random());
  const p = createSfxPlayer();
  await new Promise((r) => setTimeout(r, 10));
  return p;
}
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const starts = (log) => log.filter((e) => e.ev === "start");
const stops = (log) => log.filter((e) => e.ev === "stop");

test("a phrase takes one voice per note-on, not one for the whole cue", async () => {
  const log = [];
  const sfx = await makePlayer(log);
  sfx.play("system06");                       // 1 note, the battle command blip
  await tick(30);
  assert.equal(starts(log).length, 1, "one note-on, one voice");

  log.length = 0;
  sfx.play("recovery");                       // 8 note-ons over 0.64 s
  await tick(900);
  assert.equal(starts(log).length, 8, "eight note-ons, eight voices (not one source)");
  // Each voice is scheduled at its own note-on, not all at the trigger.
  const whens = starts(log).map((e) => e.when);
  assert.ok(new Set(whens).size > 1, "the notes are spread over the phrase, not stacked on one tick");
  assert.ok(Math.max(...whens) > Math.min(...whens) + 0.1, "and the spread is the phrase's own length");
  sfx.stopAll();
});

test("a note's slot is free at its own note-off, while its release still rings", async () => {
  // F0x80035d38's key-off clears the voice record at once (F0x8003670c /
  // F0x8003674c) and the SPU finishes the note with its own envelope. So the
  // pool must not still be holding a voice whose note-off has passed — a
  // releasing tail is not a voice the allocator can steal or refuse.
  const log = [];
  const sfx = await makePlayer(log);
  const row = TABLE.phrases.recovery;
  const lastOffMs = Math.max(...row.notes.map((n) => (n.start + n.relStart) / 44.1));
  assert.ok(row.notes.every((n) => n.voice.samples > n.relStart),
    "every recovery note rings on past its own note-off");
  sfx.play("recovery");
  await tick(60);
  const early = sfx.debugVoices();
  assert.ok(early >= 1, `the phrase holds ${early} voices while its notes sound`);
  await tick(Math.ceil(lastOffMs) + 60);        // every note-off has passed
  assert.equal(sfx.debugVoices(), 0,
    "every note-off freed its slot, even though the releases are still ringing");
  assert.equal(stops(log).length, 0, "and nothing was cut to do it");
  assert.equal(starts(log).length, 8, "all eight notes played");
  assert.ok(starts(log).some((e) => !e.src.ended), "the releases really are still audible");
  sfx.stopAll();
  await tick(20);
  assert.equal(stops(log).length, 8, "stopping the cue cuts the eight still ringing");
});

test("one note-off frees every voice of that note", async () => {
  // SUB_DEMO strikes the same note three times and then turns it off once per
  // strike. The key-off matches on the note and the channel, not on which
  // repeat it is, so the FIRST note-off frees all three voices at once.
  const log = [];
  const sfx = await makePlayer(log);
  const row = TABLE.phrases.sub_demo;
  assert.equal(row.notes.length, 3, "three voices of one note");
  assert.equal(new Set(row.notes.map((n) => n.offTick)).size, 1,
    "and the score's three note-offs are all the first voice's release");
  // A phrase renders all of its notes before it starts any, so wait past the
  // LAST note-on with room for that.
  const lastNoteMs = Math.max(...row.notes.map((n) => n.start / 44.1));
  sfx.play("sub_demo");
  await tick(Math.ceil(lastNoteMs) + 200);
  assert.equal(starts(log).length, 3, "three note-ons, three voices");
  assert.ok(sfx.debugVoices() >= 1, "the note is sounding");
  sfx.stopAll();
  await tick(20);
  assert.equal(stops(log).length, 3, "and the cue owns all three");
});

test("a phrase with no voice left for its notes plays nothing at all", async () => {
  // The refusal rule (fns.s:41039-41040): the pool says no, that note is silent,
  // the sequencer continues with the next one. 24 voices are held by 24 sounds
  // that outrank the phrase's notes, so nothing of the phrase can be taken.
  const log = [];
  const loud = {};
  for (let i = 0; i < 24; i++) {
    // Priority 1 outranks every phrase note (the common bank gives 679 of its
    // 971 note voices priority 0 and the rest priority 1, so a pool full of
    // priority-1 voices refuses both).
    loud[`hold${i}`] = { id: `0x0004${(0x60 + i).toString(16)}`, positional: false, dedup: false, priority: 1, rate: 1, loop: null };
  }
  const manifest = JSON.parse(JSON.stringify(MANIFEST));
  for (const k of Object.keys(loud)) manifest[k] = loud[k];
  const sfx = await makePlayer(log, manifest, "drop");
  for (const k of Object.keys(loud)) sfx.play(k);
  await tick(30);
  assert.equal(starts(log).length, 24, "the 24 priority-1 voices are holding the pool");

  log.length = 0;
  sfx.play("sht_down");                       // 2 note-ons at once, both priority 0
  await tick(60);
  assert.equal(starts(log).length, 0, "every note of the phrase is dropped");
  assert.equal(stops(log).length, 0, "and dropping one cuts nothing");
  sfx.stopAll();
  await tick(10);
  assert.equal(stops(log).length, 24, "stop-all still frees the pool it was holding");
});

test("a refused note is silent and the phrase carries on", async () => {
  // One refusal is not the end of the cue: fns.s:41039-41040 stores -1 into the
  // return value and falls into the NEXT note entry, so the rest of the phrase
  // still plays. A request may only take a voice at or below its own priority,
  // so a pool full of priority-1 voices refuses JINGLE01's priority-0 notes and
  // serves its priority-1 one: the opening chord is six notes, five of them
  // priority 0, so part of it is refused while the phrase goes on.
  const log = [];
  const manifest = JSON.parse(JSON.stringify(MANIFEST));
  for (let i = 0; i < 24; i++) {
    manifest[`hold${i}`] = { id: `0x0004${(0x60 + i).toString(16)}`, positional: false, dedup: false, priority: 1, rate: 1, loop: null };
  }
  const sfx = await makePlayer(log, manifest, "mixed");
  for (let i = 0; i < 24; i++) sfx.play(`hold${i}`);
  await tick(40);
  assert.equal(starts(log).length, 24, "the pool is full at priority 1");
  const holds = new Set(starts(log).map((e) => e.src));   // the 24 voices it holds

  const row = TABLE.phrases.jingle01;
  const chord = row.notes[0].start;
  const inChord = row.notes.filter((n) => n.start === chord);
  assert.ok(inChord.length > inChord.filter((n) => n.priority === 0).length,
    "the opening chord mixes priorities, so a full pool refuses part of it");

  log.length = 0;
  sfx.play("jingle01");
  await tick(400);
  const whens = starts(log).map((e) => e.when).sort((a, b) => a - b);
  assert.ok(whens.length > 0, "the phrase played something");
  const first = whens[0];
  const atChord = whens.filter((w) => w - first < 1 / 44100).length;
  assert.ok(atChord > 0 && atChord < inChord.length,
    `only ${atChord} of the chord's ${inChord.length} notes got a voice — the `
    + "priority-0 ones were refused and the priority-1 one was not");
  assert.ok(whens.length > atChord, "and the phrase carried on past the chord");
  // Taking a voice at or below the request IS a cut, so the stop list here is
  // the notes that STOLE one — a refused note is the silent part of the chord
  // counted above, and it starts nothing to be cut.
  assert.ok(stops(log).every((e) => holds.has(e.src) || e.src.ended),
    "every cut was a voice the phrase took from another sound");
  sfx.stopAll();
  await tick(20);
});

test("a long phrase holds one hardware voice per sounding note", async () => {
  // The point of one voice per note: EX_AT_LP is a 20-note phrase over 15 s, so
  // while it plays the pool holds several of the 24 voices -- and each note is
  // its own voice, which is what the allocator arbitrates over.
  const log = [];
  const sfx = await makePlayer(log);
  assert.equal(TABLE.phrases.ex_at_lp.notes.length, 20);
  sfx.playSustained("ex_at_lp");                // the whirl is held open by a stop marker
  await tick(1200);
  const sounding = sfx.debugVoices();
  assert.ok(sounding >= 2, `the running phrase holds ${sounding} voices, not one`);
  assert.ok(starts(log).length >= 2, "its notes are playing as separate sources");
  sfx.stopSustained("ex_at_lp");                // the stop marker releases them all
  await tick(30);
  assert.equal(sfx.debugVoices(), 0, "the stop marker freed every voice of the phrase");
  assert.equal(stops(log).length, sounding, "one cut per voice the phrase still held");
});

test("a battle cue that is a phrase (the *_DOWN thud) plays its notes too", async () => {
  // op10 types 14-17 are *_DOWN, which are 2D phrases: the fall thud is a
  // two-note sequence and the battle path has to schedule it like any other cue.
  const log = [];
  const sfx = await makePlayer(log);
  sfx.playBattle("sht_down", "player");
  await tick(60);
  assert.equal(starts(log).length, TABLE.phrases.sht_down.notes.length);
  assert.equal(TABLE.phrases.sht_down.notes.length, 2, "sht_down layers two tones on one note");
  // A layered note is two voices on the SAME tick -- F0x8003769c returns one
  // entry per covering tone and the sequencer takes a voice for each.
  assert.equal(TABLE.phrases.sht_down.notes[0].start, TABLE.phrases.sht_down.notes[1].start);
  assert.equal(starts(log)[0].when, starts(log)[1].when, "and both start together");
  sfx.stopBattle("player");
  await tick(20);
  assert.equal(stops(log).length, 2, "stopping the side releases both notes");
});

test("the same cue twice cuts its own voices and nothing else", async () => {
  // The 2D path's own-slot key-off (F0x8003340c -> F0x800375ec): one cue, its
  // own previous voices, and no other sound.
  const log = [];
  const sfx = await makePlayer(log);
  sfx.play("system06");                          // a different cue, one note
  await tick(40);
  assert.equal(starts(log).length, 1);
  log.length = 0;
  sfx.play("recovery");
  await tick(350);
  const first = starts(log).length;
  assert.ok(first >= 3, `the first recovery has ${first} of its notes up`);
  sfx.play("recovery");                         // the same cue again
  await tick(60);
  assert.equal(stops(log).length, first, "the second trigger cut the first run's voices");
  sfx.stopAll();
});