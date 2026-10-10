// The phrase-callers pass, 2026-10-05. The census (docs/research/audio/phrase-notes.json)
// named five common-bank phrases no decoded call site reached, so the walker built and
// played none of them. Each was searched for across the disc corpus -- the disassembly of
// every overlay and the executable (~/ddw3/asm/dw2003/{pro,exe}, every `lui`/`ori`/`addiu`
// constant and any literal 32-bit id), the extracted data trees (web/assets/data,
// ~/ddw3/rust/dw2003_exe_data), and the Sound Test's own category table. Result:
//
//   ENCOUNTS  0x00040005  found, wired: pro/fieldstg F0x80089F7C state 0 -- the checkerboard
//       handoff transition -- plays it through the canonical play cell [0x80055c48] on the
//       transition's first frame (file 0x7448-0x7458). web/battle.js start() cues it as the
//       field hands off to a battle.
//   GAMEOVER  0x60040008  found, already wired: wfightmn's loss arm (.L0x0000345c) plays it,
//       and the walker's loss sequence plays the same piece through the bgm player (a
//       0x60... id is a music-start; the loss port keeps that route, so its phrase row is
//       deliberately not built in the second player).
//   COM_CNFS  0x60040000  the only block that plays it is pro/wfightmn F0x800A7220's
//       confusion swap (a party member confused -> swap the track, then restore and replay
//       the saved one when confusion ends), and that block has no static entry: no overlay
//       or executable in the corpus forms its address (0x800a7248), and F0x800A7220 does
//       not fall through into it. Not wired; a live capture must watch the current-track
//       cell [0x80042b30] across a battle turn with a Confused party member.
//   DEMO_BGM  0x60040002  GIANT_HILL's event theme: fieldstg's dispatch table index 4 (event
//       0x369), the case-4 arm of F0x800837EC. It is a MUSIC START (common SEP seq 2), not a
//       sample, so the walker routes it to the music player (web/game.js emoteSound ->
//       bgm.play("demo_bgm"), whose stem ships); because it is not a phrased 2D cue it stays
//       out of the phrase table, which is why it remains in the unwalked census list below.
//   PIYOPIYO  0x00040013  WIRED 2026-10-06: the same dispatcher, event 0x37E (SETANIM 813 894
//       on s615/s685). It is a common-bank 2D phrase, so a decoded call-site row
//       (data/sfx-call-sites.json) now puts it in build_sfx.py's set and the walker plays it
//       by packed id through the shared sink (web/game.js emoteSound -> sfx.playPacked).
//
// What a capture would still have to watch for the remaining three: a field theme start on
// 0x60040002, and a confused party member's turn for COM_CNFS. Nothing else in the corpus
// forms those ids as samples.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

test("ENCOUNTS is a built phrase, one runtime note per census voice", () => {
  const table = readJson("web/sfx-voice/phrases.json");
  const census = readJson("docs/research/audio/phrase-notes.json");
  const row = table.phrases.encounts;
  const cens = census.phrases.find((p) => p.name === "ENCOUNTS");
  assert.ok(row, "encounts must be in the runtime note table");
  assert.equal(row.id, "0x00040005");
  assert.equal(row.slot, cens.slot, "the row sits on the census slot");
  assert.equal(row.notes.length, cens.voices, "one runtime note per census voice");
  assert.ok(cens.walker, "the census must mark ENCOUNTS in the walker");
  assert.ok(fs.existsSync("web/assets/sfx/encounts.wav"), "no phrase-mix WAV for encounts");
});

test("the field's handoff to a battle cues it, with its citations", () => {
  const src = fs.readFileSync("web/battle.js", "utf8");
  const at = src.indexOf("async function start({");
  assert.ok(at > 0, "battle start() should exist");
  const cue = src.indexOf('sfx?.play("encounts")', at);
  assert.ok(cue > at, "ENCOUNTS must play from the battle handoff (start())");
  const between = src.slice(at, cue);
  assert.ok(between.includes("F0x80089F7C"), "the call site cites the transition routine");
  assert.ok(between.includes("0x00040005"), "the call site cites the packed id");
  assert.ok(between.includes("0x80055c48"), "the call site cites the play cell");
});

test("the folded call-site row carries the id, the trigger and its evidence", () => {
  const rows = readJson("docs/research/audio/sfx-triggers.json");
  const enc = rows.find((r) => r.name === "ENCOUNTS");
  assert.ok(enc, "the ENCOUNTS row should be staged for the lead's trigger table");
  assert.equal(enc.id, "0x00040005");
  assert.equal(enc.status, "decoded");
  assert.ok(enc.walker_hook, "a build row must name its walker hook");
  assert.ok(enc.evidence.includes("0x80055c48"), "the evidence must name the play cell");
});

test("the three phrases still outside the phrase table are named", () => {
  // PIYOPIYO left this set on 2026-10-06 (built as a 2D phrase and played through
  // the shared packed sink). The three that remain are not samples at all:
  // DEMO_BGM and GAMEOVER are music starts the walker plays through the music
  // player, and COM_CNFS's only block has no static entry. Never delete the
  // assertion -- the next built phrase must move this list.
  const census = readJson("docs/research/audio/phrase-notes.json");
  const out = census.phrases.filter((p) => !p.walker).map((p) => p.name).sort();
  assert.deepEqual(out, ["COM_CNFS", "DEMO_BGM", "GAMEOVER"],
    "the unwalked set changed: update this list and the story at the top of the file "
    + "when one of them gets built");
});
