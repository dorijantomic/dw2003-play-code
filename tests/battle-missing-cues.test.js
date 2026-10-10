// The battle cues the 2026-10-05 rig sweep found the original plays and the walker did
// not (.dw3-research/rig-sweep-2026-10-05/lab-audio-worker.md §3). Each test pins one cue
// to the call site and id the sweep established, in the style of the sibling battle-audio
// tests: a runtime case for whatever decision the code keeps pure, and a wiring pin for
// the call site in the (browser-only) battle files.
//
//   COMEX102 0x8004413e  fightstg F0x8008c454, .L0x8008c4a0 / .L0x8008c4d4: an op10
//       contact marker (98/99) whose damage result is 3 — an evade — swaps the sound
//       type to 0x38 (56). The weapon's own contact id must NOT play on that contact.
//   COMCD103 0x800429bf  fightstg F0x800880f0, .L0x80088268-.L0x80088290: the
//       fight-opening actor's cue, played in the same arm that applies the arena shot
//       ([+0x100]/[+0xf8]) and creates the effect-0x33 owner.
//   W_JINGLE 0x6004001e  wfightmn win arm: result 1 written at .L0x00003498, the jingle
//       at .L0x000034c0; the loss arm's GAMEOVER 0x60040008 (.L0x0000345c) was already
//       wired and stays.
//   0x60980000 boss04   fightstg F0x80086a00, .L0x80086e84-.L0x80086ea0: the final
//       boss's phase transition, spawned as battle effect 0x1d3 by F0x8009d06c
//       (.L0x8009d0a0) after WFIGHTMN's third counted player damage application
//       (.L0x00004d30-.L0x00004da8), and saved to the current-track register
//       [0x80042b30] — the register the digivolution path re-plays.
//   (5) the saved-track replay: fightstg F0x80089cd8 .L0x8008a764-.L0x8008a778 loads
//       [0x80042b30] and re-plays it when the transformation ends. The walker replays
//       its current battle track through the bgm player, which needs the
//       stop-then-play pair to actually restart the same track.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SFX = "web/assets/sfx";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const battleJs = () => fs.readFileSync("web/battle.js", "utf8");
const battle3dJs = () => fs.readFileSync("web/battle3d.js", "utf8");

// ── 1. COMEX102 — the evade substitute ──────────────────────────────────────

test("the evade substitute is COMEX102 and the ids line up end to end", () => {
  const map = readJson(`${SFX}/op10_map.json`);
  const manifest = readJson(`${SFX}/manifest.json`);
  assert.equal(map["56"], "comex102", "contact substitute type 0x38 -> comex102");
  assert.equal(manifest.comex102.id, "0x8004413e", "COMEX102's packed id");
  assert.ok(fs.existsSync(`${SFX}/comex102.wav`), "no WAV for comex102");
});

test("a contact marker resolves to the substitute only when it evaded", async () => {
  const { resolveContactSoundType, CONTACT_EVADE_TYPE } = await import("../web/battle3d.js");
  assert.equal(CONTACT_EVADE_TYPE, 56, "fightstg loads 0x38 for result 3");
  // Both contact markers substitute on an evade, whatever the weapon's own type was.
  assert.equal(resolveContactSoundType(98, 30, true), 56);
  assert.equal(resolveContactSoundType(99, 30, true), 56);
  assert.equal(resolveContactSoundType(99, 8, true), 56);
  // A landed contact keeps the resolved type: plain basic 30, a technique's motion.
  assert.equal(resolveContactSoundType(98, 30, false), 30);
  assert.equal(resolveContactSoundType(99, 8, false), 8);
  // Non-contact op10s are untouched by the substitution.
  assert.equal(resolveContactSoundType(14, 30, true), 14);
  assert.equal(resolveContactSoundType(20, null, true), 20);
});

test("the op10 hook resolves contacts through that substitution, per side", () => {
  const src = battle3dJs();
  assert.ok(src.includes("resolveContactSoundType(rec.type, contactSoundType[side], contactEvade[side])"),
    "the contact resolution must pass the live evade state");
  assert.ok(src.includes("contactEvade.player = miss;"),
    "the player attack must carry the miss flag into the contact sound");
  assert.ok(src.includes("contactEvade.enemy = miss;"),
    "the enemy attack must carry the miss flag into the contact sound");
  // ...and a contact marker still plays through the ordinary op10 branch when it lands.
  assert.ok(src.includes('sfx.playBattle(key, side, rec.words?.[1] ?? 0)'));
});

// ── 2. COMCD103 — the fight-opening cue ─────────────────────────────────────

test("COMCD103 is built and is the battle-effect table's own type-26 entry", () => {
  const manifest = readJson(`${SFX}/manifest.json`);
  const map = readJson(`${SFX}/op10_map.json`);
  assert.equal(manifest.comcd103.id, "0x800429bf");
  assert.ok(fs.existsSync(`${SFX}/comcd103.wav`), "no WAV for comcd103");
  assert.equal(map["26"], "comcd103", "the 0x800a368c table names type 26 COMCD103");
});

test("the fight-open arm plays it where the arena shot is applied", () => {
  const src = battleJs();
  const open = src.indexOf("renderer3d.applyIntroCamera?.();");
  assert.ok(open > 0, "the intro camera call site should exist");
  const cue = src.indexOf('sfx?.play("comcd103")', open);
  assert.ok(cue > open, "COMCD103 should play right after the intro camera is applied");
  const between = src.slice(open, cue);
  assert.ok(!between.includes("function "), "the cue belongs to the same arm, not a later one");
  assert.ok(src.includes("0x800429bf"), "the call site should cite the packed id");
  assert.ok(src.includes("FIGHTSTG_F0x800880f0"), "the call site should cite the actor");
});

// ── 3. W_JINGLE — the victory arm ───────────────────────────────────────────

test("W_JINGLE is built with its manifest id", () => {
  const manifest = readJson(`${SFX}/manifest.json`);
  assert.equal(manifest.w_jingle.id, "0x6004001e");
  assert.ok(fs.existsSync(`${SFX}/w_jingle.wav`), "no WAV for w_jingle");
});

test("the win transition plays W_JINGLE, and the loss side still plays GAMEOVER", () => {
  const src = battleJs();
  const at = src.indexOf("function defeatCurrentEnemy");
  assert.ok(at > 0);
  const end = src.indexOf("\n  function ", at + 10);
  const winArm = src.slice(at, end > 0 ? end : undefined);
  assert.ok(winArm.includes('b.message = "Battle Won!"'), "the win arm is the one checked");
  assert.ok(winArm.includes('sfx?.play("w_jingle")'), "the win arm must celebrate");
  // The loss side already carried its jingle and must keep it (0x60040008 GAMEOVER).
  assert.ok(src.includes('bgm?.play("gameover")') || src.includes('bgm.play("gameover")'),
    "the loss jingle path must stay");
  assert.ok(src.includes("0x60040008"), "the loss id should stay cited at its site");
});

// ── 4. 0x60980000 boss04 — the final boss's phase transition ────────────────

test("the phase switch fires on the third landed commit, only in battle 0x144", async () => {
  const { finalBossPhaseSwitchesTrack } = await import("../web/battle.js");
  assert.equal(finalBossPhaseSwitchesTrack(4, 1), false, "first commit: no switch");
  assert.equal(finalBossPhaseSwitchesTrack(4, 2), false, "second commit: no switch");
  assert.equal(finalBossPhaseSwitchesTrack(4, 3), true, "third commit: LASTB_02");
  assert.equal(finalBossPhaseSwitchesTrack(4, 9), true, "stays on after the third");
  // The counters are armed by the battle-0x144 init alone, so no other mode switches.
  for (const mode of [0, 1, 2, 3, 5, 6]) {
    assert.equal(finalBossPhaseSwitchesTrack(mode, 3), false, `mode ${mode} must not switch`);
  }
});

test("the battle counts landed damaging commits and plays boss04 through bgm", () => {
  const src = battleJs();
  const calls = src.match(/noteFinalBossPhaseDamage\(b\)/g) || [];
  assert.equal(calls.length, 4, "one definition + the three damage commits (basic, tech, DNA)");
  assert.ok(src.includes('b._battleTrack = "boss04";'), "the switch updates the saved track");
  assert.ok(src.includes("bgm?.play(b._battleTrack);"), "and plays it through the bgm player");
  assert.ok(src.includes("0x60980000") && src.includes("0x80086e84") && src.includes("0x8009d06c"),
    "the transition's original chain must stay cited");
  // The switch is reachable only where the original arms it: the battle-0x144 special mode.
  assert.ok(src.includes("specialMode") && src.includes("finalBossPhaseSwitchesTrack"),
    "the gate must be the special mode");
  // The track the fight begins on and the one it switches TO both exist as built music.
  const bm = readJson("web/assets/data/battle_music.json");
  const s820 = bm.s820.find((r) => r.screen_id === 324);
  assert.equal(s820.bank, "boss02", "screen 324 (battle 0x144) starts on LASTBOSS");
  assert.equal(bm.s820.find((r) => r.screen_id === 325).bank, "boss04");
  for (const bank of ["boss02", "boss04"]) {
    assert.ok(fs.existsSync(`web/assets/music/${bank}.ogg`), `no music file for ${bank}`);
  }
});

// ── 5. the saved-track replay after digivolution ────────────────────────────

test("the bgm player restarts the same track after the register is replaced", async () => {
  // FakeAudio: enough of the HTMLAudioElement surface createBgmPlayer uses.
  const plays = [];
  class FakeAudio {
    constructor() { this.src = ""; this.paused = true; }
    play() { this.paused = false; plays.push(this.src); return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  globalThis.Audio = FakeAudio;
  const { createBgmPlayer, createExclusiveRegister } = await import("../web/audio.js");
  const register = createExclusiveRegister();
  const bgm = createBgmPlayer(register);
  bgm.play("boss02");
  assert.deepEqual(plays, ["assets/music/boss02.ogg"], "first start");
  // Playing the SAME track again is a no-op while it is `current`.
  bgm.play("boss02");
  assert.equal(plays.length, 1, "same track is not restarted by plain play()");
  // The register's replacement is what stops it — a different exclusive start
  // (EVOLUTIO's, in the digivolution flow).  Its stop entry clears `current`,
  // so the re-play below is a genuine restart from the top.
  register.begin("0x41140000", "evolutio", () => {});
  assert.equal(bgm.current, null, "the replaced track's stop entry lets go of current");
  bgm.play("boss02");                   // .L0x8008a768 re-plays [0x80042b30]
  assert.deepEqual(plays, ["assets/music/boss02.ogg", "assets/music/boss02.ogg"],
    "the saved track starts again from the top");
});

test("both EVOLUTIO programs start through the register, and the replay restores the track", () => {
  const src = battleJs();
  const starts = src.match(/sfx\?\.playBank\?\.\("evo_00", "evolutio"\)/g) || [];
  assert.equal(starts.length, 2, "Blast-on's trigger and manual DV's sound frame both start EVOLUTIO");
  // NO explicit stop call: the disc's rule is two exclusive starts — EVOLUTIO
  // (bit 30) takes the register, and the register stops the battle track it
  // replaces (fns.s:17704-17717).  The old bgm.play(null) pair stopped a track
  // the shared register now ends for it.
  assert.ok(!src.includes("bgm?.play(null)") && !src.includes("bgm.play(null)"),
    "no per-case stop calls: the register ends the track EVOLUTIO replaces");
  const done = src.indexOf("if (s.done) {");
  assert.ok(done > 0, "the presentation's end arm should exist");
  const replay = src.slice(done, done + 1200);
  assert.ok(replay.includes("bgm.play(b._battleTrack);"),
    "the end of the transformation must re-play the saved track");
  assert.ok(replay.includes("FormChangeProgram.MANUAL_DV")
    && replay.includes("FormChangeProgram.BLAST_ON"),
    "both EVOLUTIO programs replay; the revert's PLAYER11 does not");
  // The register exists and is seeded at battle start.
  assert.ok(src.includes("battle._battleTrack = musicForScreen(screenId, mapId);"),
    "the battle must save its current track like [0x80042b30]");
});
