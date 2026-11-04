// web/gate-text.js — the plain-words renderer for the banked flag predicates.
//
// Every gate the game asks is an id whose bank picks a different source (get_flag
// F0x800163b0: bank = (id >> 8) & 0xfe, index = id & 0x1ff), so the same "id/expected"
// pair can mean a story bit, a story beat, a beat range, a party Charisma rung, a route
// pair scalar, or one of the seven command banks. The explorer page and the in-game
// gate explainer both need those ids said out loud, and a bank nobody has decoded has
// to stay a raw hex gate: "unknown" is never spelled as a guess.
//
// This file pins the words and the live-state picker. The picker mirrors
// engine/dw3/npc-manager.ts pickDialogueState — first state whose whole gate passes,
// command banks always pass, and an unknown (null) value passes because the engine
// treats it as permissive; the test cross-checks every s200 record against that
// function so the two can never drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as gateText from "../web/gate-text.js";
import { gateWords, gateListWords, liveStateIndex, CHARISMA_THRESHOLDS } from "../web/gate-text.js";
import { pickDialogueState } from "../engine/dw3/npc-manager.ts";
import { CHARISMA_THRESHOLDS as ENGINE_CHARISMA_THRESHOLDS } from "../engine/dw3/dw3-config.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

const S200 = readJson("web/assets/scenes/s200.json");
const ROSTER = readJson("web/assets/data/roster_predicate_table.json");
const npc = (id) => S200.npcs.find((n) => n.id === id);

// ── bank 0x60: the story beat in an equality test ────────────────────────────────────────────
test("bank 0x60 reads as the one story beat it compares", () => {
  assert.equal(gateWords({ id: 0x6004, expected: 1 }), "beat 4");
  assert.equal(gateWords({ id: 0x6004, expected: 0 }), "not beat 4");
  // The index is the low nine bits (id & 0x1ff), so a beat past 255 still reads right.
  assert.equal(gateWords({ id: 0x6102, expected: 1 }), "beat 258");
});

// ── bank 0x70: the table-dispatched predicate ─────────────────────────────────────────────────
test("bank 0x70 op 0x30 reads as the progress-ordinal range the record carries", () => {
  // key 6 = flag_id 28678, ordinal_lo 2, ordinal_hi 18.
  assert.equal(gateWords({ id: 0x7006, expected: 1 }), "beat in 2..18");
  // key 7 = flag_id 28679, ordinal_lo 20, ordinal_hi 23.
  assert.equal(gateWords({ id: 0x7007, expected: 0 }), "not in beat 20..23");
});

test("bank 0x70 with another op keeps the record's own kind text", () => {
  const rec = ROSTER.records.find((r) => r.key === 0); // op 0, no ordinal range
  assert.ok(rec.kind.length > 0);
  assert.equal(gateWords({ id: 0x7000, expected: 1 }), rec.kind);
  assert.equal(gateWords({ id: 0x7000, expected: 0 }), `not ${rec.kind}`);
});

test("bank 0x70 answers an open range as ending at the story's end, and a missing record raw", () => {
  const open = ROSTER.records.find((r) => r.op === 48 && r.ordinal_hi == null);
  assert.ok(open, "the extractor marks open-ended op-0x30 ranges with null");
  assert.equal(gateWords({ id: 0x7000 | open.key, expected: 1 }), `beat in ${open.ordinal_lo}..end`);
  // No table record at this index: never invent one.
  assert.equal(gateWords({ id: 0x7099, expected: 1 }), "gate 0x7099");
});

// ── bank 0x72: the party-Charisma rung ───────────────────────────────────────────────────────
test("bank 0x72 reads as the party Charisma rung it tests", () => {
  assert.equal(gateWords({ id: 0x7202 }), "party Charisma >= 210");
  assert.equal(gateWords({ id: 0x7200, expected: 1 }), "party Charisma >= 60");
  assert.equal(gateWords({ id: 0x720e, expected: 1 }), "party Charisma >= 2472");
  assert.equal(gateWords({ id: 0x7202, expected: 0 }), "party Charisma < 210");
  // Off the 15-word ladder the predicate is never satisfied; say the raw gate, not a guess.
  assert.equal(gateWords({ id: 0x7211, expected: 1 }), "gate 0x7211");
});

test("the Charisma ladder is the engine's own 15 words", () => {
  assert.deepEqual([...CHARISMA_THRESHOLDS], [
    60, 150, 210, 285, 378, 492, 630, 795, 990, 1218, 1482, 1785, 2049, 2277, 2472,
  ]);
  assert.deepEqual([...CHARISMA_THRESHOLDS], [...ENGINE_CHARISMA_THRESHOLDS]);
});

// ── bank 0x7e: the route pair, two scalars over one index space ──────────────────────────────
test("bank 0x7e reads as the route key or the route companion", () => {
  assert.equal(gateWords({ id: 0x7e05 }), "route key = 6");
  assert.equal(gateWords({ id: 0x7e1d }), "route key = 30");
  assert.equal(gateWords({ id: 0x7e1e }), "route companion = 1");
  assert.equal(gateWords({ id: 0x7e20 }), "route companion = 3");
  assert.equal(gateWords({ id: 0x7e05, expected: 0 }), "not route key = 6");
});

// ── stored banks: ordinary story bits ───────────────────────────────────────────────────────
test("a stored bank reads as the story flag it is", () => {
  assert.equal(gateWords({ id: 0x400d }), "story flag 0x400d is set");
  assert.equal(gateWords({ id: 0x400d, expected: 0 }), "story flag 0x400d is clear");
  assert.equal(gateWords({ id: 0x0018, expected: 1 }), "story flag 0x0018 is set");
  // A fresh NPC spawn gate omits `expected`; the game's get_flag default is 1.
  assert.equal(gateWords({ id: 0x1a18 }), "story flag 0x1a18 is set");
});

test("bank 0x12 is engine bookkeeping, not a disc story bank", () => {
  // DW3_BANK_SCHEME carries 0x12 as a synthetic engine marker bank; the disc has no
  // such stored bank, so an id in it must not be dressed up as a story flag.
  assert.equal(gateWords({ id: 0x1234, expected: 1 }), "gate 0x1234");
});

// ── the seven command banks ─────────────────────────────────────────────────────────────────
test("the command banks read as what the getter answers", () => {
  assert.equal(gateWords({ id: 0x7401 }), "scripted battle slot 1");
  assert.equal(gateWords({ id: 0x7606 }), "card duel");
  assert.equal(gateWords({ id: 0x7808 }), "card duel");
  assert.equal(gateWords({ id: 0x7a02 }), "shop/inn");
  assert.equal(gateWords({ id: 0x7c01 }), "lab/naming");
  assert.equal(gateWords({ id: 0x9001 }), "talk-launch bit 1");
  assert.equal(gateWords({ id: 0x9403 }), "gym");
  // The getter's command fallthrough returns success for either polarity, so the words
  // cannot be negated — saying "not a battle" would be a lie about the disc.
  assert.equal(gateWords({ id: 0x7401, expected: 0 }), "scripted battle slot 1");
});

test("an undecoded bank stays a raw gate, never a guess", () => {
  assert.equal(gateWords({ id: 0x1234 }), "gate 0x1234");
  assert.equal(gateWords({ id: 0x82ab, expected: 1 }), "gate 0x82ab"); // item possession, not in the words
  assert.equal(gateWords({ id: 0x9201, expected: 0 }), "gate 0x9201"); // card collection
});

// ── a whole gate list, as one sentence ──────────────────────────────────────────────────────
test("gateListWords joins a whole gate into one sentence", () => {
  assert.equal(gateListWords([]), "always");
  assert.equal(gateListWords(undefined), "always");
  assert.equal(
    gateListWords([{ id: 0x6004, expected: 1 }, { id: 0x400d, expected: 0 }]),
    "beat 4 and story flag 0x400d is clear",
  );
  assert.equal(gateListWords([{ id: 0x1a18, expected: 1 }]), "story flag 0x1a18 is set");
});

// ── the live state ──────────────────────────────────────────────────────────────────────────
const flags = (map) => (id) => (id in map ? map[id] : null);

test("liveStateIndex picks the first dialogue state whose gate passes", () => {
  const mika = npc("real_5_5_564_558#10");
  assert.ok(mika, "s200 carries the Mika record the card names");
  assert.equal(liveStateIndex(mika, flags({ 6680: 0 })), 0);
  assert.equal(liveStateIndex(mika, flags({ 6680: 1 })), 1);
  // A value the save cannot answer does not fail a gate: the engine reads null as
  // permissive, so the first state stays live (the page marks the gate unknown).
  assert.equal(liveStateIndex(mika, () => null), 0);
});

test("a record whose gates all fail has no live state", () => {
  const refusing = {
    dialogue_states: [
      { gate: [{ id: 0x1a18, expected: 1 }], dialogue: { file: "estalk00", index: 1 } },
      { gate: [{ id: 0x6004, expected: 1 }], dialogue: { file: "estalk00", index: 2 } },
    ],
  };
  assert.equal(liveStateIndex(refusing, () => 0), null);
  assert.equal(liveStateIndex(refusing, () => 1), 0);
  assert.equal(liveStateIndex({ dialogue_states: [] }, () => 1), null);
  assert.equal(liveStateIndex({}, () => 1), null);
});

test("liveStateIndex agrees with the engine's pickDialogueState on every s200 record", () => {
  const scenarios = [
    () => 0,
    () => 1,
    () => null,
    flags({ 6680: 1 }),
    flags({ 0: 1 }),
    flags({ 0: 1, 6680: 1, 29184: 1, 29186: 1, 3584: 1, 32786: 1, 29188: 1 }),
  ];
  for (const getCond of scenarios) {
    for (const record of S200.npcs) {
      const engine = pickDialogueState(record, getCond);
      const engineIndex = engine == null ? null : record.dialogue_states.indexOf(engine);
      assert.equal(
        liveStateIndex(record, getCond),
        engineIndex,
        `${record.id} disagrees with pickDialogueState`,
      );
    }
  }
});

// ── a text renderer, not a writer ───────────────────────────────────────────────────────────
test("the module has no write path", () => {
  assert.equal(gateText.setFlag, undefined);
  assert.equal(gateText.writeFlag, undefined);
  const writers = Object.keys(gateText).filter((k) => /^(set|write|clear|toggle)/i.test(k));
  assert.deepEqual(writers, [], "a renderer must never be able to change a flag");
});

test("the module is DOM-free and storage-free", () => {
  const src = readFileSync(join(ROOT, "web/gate-text.js"), "utf8");
  for (const word of ["document.", "window.", "localStorage", "sessionStorage"])
    assert.ok(!src.includes(word), `gate-text.js must not reach for ${word}`);
});

// ── the explorer page's save side ───────────────────────────────────────────────────────────
// The page itself is a lab UI, but the parts that decide what it says are pure: the save
// decoder, the tri-state reader and the person grouping. Driving them here proves the
// "live" mark against a save shaped exactly like the one the game writes.
const { decodeSave, makeReader, groupRecords } = await import("../web/story-explorer.js");

/** The base64 bank blob FlagManager.toJSON writes: 64 bytes, bank 0x1a = bit for ids 0x1a00+. */
function engineFlagsBlob(banks) {
  const out = {};
  for (const [bank, bytes] of Object.entries(banks)) {
    out[bank] = btoa(String.fromCharCode(...bytes));
  }
  return JSON.stringify(out);
}

test("the page reads a real save's banked flag and marks the live state", () => {
  const mika = npc("real_5_5_564_558#10");
  // id 6680 = 0x1a18: bank 0x1a, bit 24 -> byte 3, bit 0.
  const bank = new Uint8Array(64);
  bank[3] = 0x01;
  const withTalked = decodeSave(engineFlagsBlob({ 26: bank }), JSON.stringify({ evt_intro: true }));
  assert.equal(withTalked.hasEngineFlags, true);
  assert.equal(withTalked.bitsSet, 1);
  assert.deepEqual(withTalked.markers, [["evt_intro", true]]);
  const read = makeReader(withTalked);
  assert.equal(read(6680), 1);
  assert.equal(read(6681), 0, "the neighbouring bit is untouched");
  assert.equal(liveStateIndex(mika, read), 1, "0x1a18 set picks the second state");

  const fresh = decodeSave(engineFlagsBlob({ 26: new Uint8Array(64) }), null);
  assert.equal(makeReader(fresh)(6680), 0);
  assert.equal(liveStateIndex(mika, makeReader(fresh)), 0, "a new game gets the first state");
});

test("the page applies numeric ids from localStorage.flags and keeps the text markers", () => {
  const decoded = decodeSave(null, JSON.stringify({ 6680: 1, evt_intro: true }));
  assert.equal(decoded.hasEngineFlags, false);
  assert.equal(decoded.numeric.get(6680), 1);
  assert.deepEqual(decoded.markers, [["evt_intro", true]]);
  assert.equal(makeReader(decoded)(6680), 1);
  assert.equal(liveStateIndex(npc("real_5_5_564_558#10"), makeReader(decoded)), 1);
});

test("the version list groups every record the disc authors for one person", () => {
  const groups = groupRecords(S200.npcs);
  const mika = groups.find((g) => g.key === "46");
  assert.ok(mika, "npc 46 is a person in s200");
  assert.ok(mika.records.length > 1, "Mika has more than one authored version");
  assert.ok(mika.records.every((r) => r.npc_id === 46));
  assert.ok(mika.records.some((r) => r.id === "real_5_5_564_558#10"), "the card's record is one of them");
  // Every NPC record of the stage lands in exactly one group.
  assert.equal(groups.reduce((n, g) => n + g.records.length, 0), S200.npcs.length);
});

test("the page is the module's own page and keeps a manual beat box", () => {
  const html = readFileSync(join(ROOT, "web/story-explorer.html"), "utf8");
  assert.ok(html.includes('src="story-explorer.js"'), "the page loads the explorer module");
  assert.ok(html.includes('id="beat"'), "a manual story-beat box for the bank-0x60/0x70 words");
  assert.ok(html.includes('id="states"') && html.includes('id="versions"'),
    "the page has the versions list and the states list");
});
