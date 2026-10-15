// The two post-game quests the 2026-10-14 verification pass left undecoded, pinned
// to the disc's own data at BOTH ends, the same way tests/postgame-leaders.test.js
// pins the four Amaterasu Leaders:
//
//   1. the raw flag-list words in the stage overlays (assembly outranks every
//      record), read straight out of ~/ddw3/asm/dw2003/pro/*.s;
//   2. the same lists as encoded from web/stage-npc-programs.json, plus the data
//      tables the runtime resolves: CARD_NPC decks (card_opponents.json), the
//      bank-0x90 talk-event table (talk_event_launches.json), the talk grants
//      (talk_item_grants.json), the bank-0x70 predicate records
//      (roster_predicate_table.json) and the item ids (ddw3 item_id.rs).
//
// The flag-list encoding is the disc's own: each entry is `flag | 0x10000 when
// expected == 1`, a list is closed by 0xffff, and a dialogue state emits its gate
// list first (only when it has one), then (when present) its on_close list.
//
// ── The King of Cards (walkthrough quest b) ────────────────────────────────────
// s951 IS the ordinal-45 alias of s386 (East Sector — Duel Island; screen_table
// row 663: base WSTAG386_PRO -> alt WSTAG951_PRO). Six card duelists stand along
// the island's path; each challenge dialogue state's on_close writes a bank-0x78
// launcher whose packed argument selects a CARD_NPC.BIN record (F0x80016378:
// argument = index*2 + mode + 1, mode 1 for bank 0x78). Each win writes the
// duelist's own clear bit (0x1011..0x1016, which retires them and spawns their
// "you may pass" position), resets the duel-result flags, and — for the five
// gatekeepers — starts a farewell event through bank 0x90. Keith (the Card King)
// hands the KoC Trophy, item 36, on his win line. The last five bits 0x1012..0x1016
// are the five duelists' spawn selectors; 0x1011 is Keith's.
//
//   Keith   npc 102 -> 0x7848 -> record 146 Bombard Folder LV 92
//   Alice   npc 399 -> 0x784F -> record 160 Dark Evil King LV 87
//   Bomujii npc 400 -> 0x784C -> record 154 Fire Guardian Folder LV 87
//   Pierre  npc 401 -> 0x7850 -> record 162 Fairies of the Sea LV 87
//   Poemy   npc 402 -> 0x784A -> record 150 Miserable Folder LV 92
//   Haruka  npc 403 -> 0x784E -> record 158 Shining Empress LV 87
//
// ── The Epic Weapon forgers (walkthrough quest a's gate) ───────────────────────
// The post-game circuit boards carry the same Armor-Digimon forging board as the
// pre-game one (s730/s731/s845/...), moved onto s970 (Sagitarimon, Shadramon,
// Yashamon) and s974 (Nohemon, Kongoumon, Kabukimon, Shurimon, Ponchomon). A
// forger's dialogue state GATES on the second input's collection flag and its
// on_close GRANTS the product's collection flag while CLEARING both input flags —
// the whole forge. Every forger also carries the spawn gate 0x7055 (all eight
// roster slots obtained) + 0x7095 (every obtained slot at level >= 45), which is
// the walkthrough's "all 8 partners at level 45+" condition.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createFlagStore } from "../web/flag-store.js";
import { cardDuelCloseWrites, CARD_DUEL_SCREEN_CODE } from "../engine/systems/scene-completion.ts";

const DDW3_ROOT = process.env.DDW3_DIR || join(homedir(), "ddw3");
const asmPath = (file) => join(DDW3_ROOT, "asm/dw2003/pro", file);
const exePath = (file) => join(DDW3_ROOT, "asm/dw2003/exe", file);
const ASM_AVAILABLE = existsSync(asmPath("wstag951.s"));
const EXE_AVAILABLE = existsSync(exePath("fns.s"));
const SKIP_ASM = {
  skip: !ASM_AVAILABLE && "ddw3 asm corpus not present (set DDW3_DIR or clone ddw3 to ~/ddw3)",
};
const SKIP_EXE = {
  skip: !EXE_AVAILABLE && "ddw3 exe corpus not present (set DDW3_DIR or clone ddw3 to ~/ddw3)",
};

const data = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url)));

const W = 0xffff;
/** The disc's flag-list encoding: id | 0x10000 when expected == 1, 0xffff closes. */
const entry = (c) => c.id | (c.expected === 1 ? 0x10000 : 0);
/** One dialogue state's words: gate list (only when the state has one), then
 *  (when present) its on_close list — a state with no gate has no gate terminator. */
function encodeState(st) {
  const out = [];
  if (st.gate?.length) {
    for (const c of st.gate) out.push(entry(c));
    out.push(W);
  }
  if (st.on_close?.length) {
    for (const c of st.on_close) out.push(entry(c));
    out.push(W);
  }
  return out;
}
const encodeNpc = (npc) => (npc.dialogue_states ?? []).flatMap(encodeState);

/** Every 8-digit `.word` in an overlay's disassembly text, in file order. */
function overlayWords(file) {
  const words = [];
  for (const line of readFileSync(asmPath(file), "utf8").split("\n")) {
    const m = /^\.L0x[0-9a-f]+: \.word 0x([0-9a-f]{8})/.exec(line.trim());
    if (m) words.push(parseInt(m[1], 16));
  }
  return words;
}
function findRun(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
/** The disc's item ids, read from the same table tools/extract_talk_grants.py uses.
 *  The name token is everything up to the comma — the table carries eight
 *  non-ASCII tag names that a `\w+` matcher silently drops (which shifts every
 *  later id). */
function itemNames() {
  const src = readFileSync(join(DDW3_ROOT, "rust/types/src/item_id.rs"), "utf8");
  return [...src.matchAll(/^\t([^,\n]+),/gm)].map((m) => m[1]);
}
const ITEMS_AVAILABLE = existsSync(join(DDW3_ROOT, "rust/types/src/item_id.rs"));
const SKIP_ITEMS = { skip: !ITEMS_AVAILABLE && "ddw3 item_id.rs not present" };

const npcOf = (stage, npcId) =>
  (data("web/stage-npc-programs.json").stages[stage] ?? []).find((n) => n.npc_id === npcId);
const npcsOf = (stage, npcId) =>
  (data("web/stage-npc-programs.json").stages[stage] ?? []).filter((n) => n.npc_id === npcId);
/** The dialogue state with a given dialogue index, across an npc_id's entries
 *  (a board can ship the same npc_id twice — e.g. Nohemon's two recipes). */
function stateOf(stage, npcId, index) {
  for (const npc of npcsOf(stage, npcId)) {
    const st = (npc.dialogue_states ?? []).find((s) => s.dialogue.index === index);
    if (st) return st;
  }
  return null;
}
const sceneOf = (stage) => data(`web/assets/scenes/${stage}.json`);
const sceneNpc = (stage, npcId) => sceneOf(stage).npcs.find((n) => n.npc_id === npcId);

/** The bank-0x76/0x78 launcher write inside a dialogue state, and the CARD_NPC
 *  record it selects (F0x80016378: argument = index*2 + mode + 1, mode 1 = 0x78). */
function duelLauncher(states) {
  for (const st of states ?? []) {
    for (const c of st.on_close ?? []) {
      const bank = (c.id >> 8) & 0xfe;
      if (bank !== 0x76 && bank !== 0x78) continue;
      const index = c.id & 0x1ff;
      return { flag: c.id, index, mode: bank === 0x78 ? 1 : 0, record: index * 2 + (bank === 0x78 ? 1 : 0) + 1 };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The King of Cards
// ─────────────────────────────────────────────────────────────────────────────

// Hand-read anchor runs (the raw words, read out of wstag951.s first).
const KEITH_ANCHORS = [
  [0x1011, 0x11, 0x0, W, 0x10000, W], // state 81: greet, gate own bit 0/17:0/0:0, close 0:1
  [0x1011, 0x11, 0x10000, W, 0x17848, W], // state 82: the challenge, close = launcher 0x7848
  [0x1011, 0x10011, 0x10, W, 0x11, 0x0, W], // state 83: lost
  [0x1011, 0x10011, 0x10010, W, 0x11, 0x10, 0x0, 0x11011, 0x18024, 0x17013, W], // state 84: won -> trophy
];
const HARUKA_ANCHORS = [
  [0x1016, 0x11, 0x5, W, 0x10005, W], // state 106
  [0x1016, 0x11, 0x10005, W, 0x1784e, W], // state 107: launcher 0x784E
  [0x1016, 0x10011, 0x10010, W, 0x11, 0x10, 0x5, 0x11016, 0x19074, W], // state 109: won -> farewell 0x9074
];

const DUELISTS = [
  { name: "Keith", npc: 102, sprite: "p152keit", flag: 0x7848, record: 146, folder: "Bombard Folder", level: 92, bit: 0x1011, seq: 0, farewell: null },
  { name: "Alice", npc: 399, sprite: "p063frdf", flag: 0x784F, record: 160, folder: "Dark Evil King", level: 87, bit: 0x1012, seq: 1, farewell: 0x9078 },
  { name: "Bomujii", npc: 400, sprite: "p074jiji", flag: 0x784C, record: 154, folder: "Fire Guardian Folder", level: 87, bit: 0x1013, seq: 2, farewell: 0x9077 },
  { name: "Pierre", npc: 401, sprite: "p068sarm", flag: 0x7850, record: 162, folder: "Fairies of the Sea", level: 87, bit: 0x1014, seq: 3, farewell: 0x9076 },
  { name: "Poemy", npc: 402, sprite: "p069otkf", flag: 0x784A, record: 150, folder: "Miserable Folder", level: 92, bit: 0x1015, seq: 4, farewell: 0x9075 },
  { name: "Haruka", npc: 403, sprite: "p070frtf", flag: 0x784E, record: 158, folder: "Shining Empress", level: 87, bit: 0x1016, seq: 5, farewell: 0x9074 },
];

test("the Duel Island duelists' dialogue-state lists are the overlay's own words", SKIP_ASM, () => {
  const words = overlayWords("wstag951.s");
  for (const run of [...KEITH_ANCHORS, ...HARUKA_ANCHORS]) {
    assert.notEqual(findRun(words, run), -1,
      `wstag951.s must store the hand-read run [${run.map((w) => w.toString(16)).join(", ")}]`);
  }
  // The two hand-read Keith runs sit at the head of his block, contiguously.
  assert.notEqual(findRun(words, [...KEITH_ANCHORS[0], ...KEITH_ANCHORS[1]]), -1,
    "Keith's greet and challenge runs are contiguous");
});

test("every s951 cast member's shipped dialogue states encode to the overlay's words", SKIP_ASM, () => {
  const words = overlayWords("wstag951.s");
  const ids = [102, 399, 400, 401, 402, 403, 46, 50, 52, 53, 57];
  for (const npcId of ids) {
    for (const npc of npcsOf("s951", npcId)) {
      const encoded = encodeNpc(npc);
      if (encoded.length === 0) {
        // The after-positions speak one unconditional line: no gate list, no
        // on_close list, so they own no flag words at all (their presence is
        // the spawn gate's business).
        const states = npc.dialogue_states ?? [];
        assert.equal(states.length, 1, `s951/${npcId}: one unconditional after-line`);
        assert.equal(states[0].gate, undefined, `s951/${npcId}: the after-line has no gate`);
        assert.equal(states[0].on_close, undefined, `s951/${npcId}: the after-line writes nothing`);
        continue;
      }
      assert.notEqual(findRun(words, encoded), -1,
        `s951/npc ${npcId}: the shipped dialogue states must encode to the disc's lists`);
    }
  }
});

test("each duelist's challenge writes a bank-0x78 launcher whose CARD_NPC record is the walkthrough's", () => {
  const opponents = Object.fromEntries(data("web/assets/data/card_opponents.json").opponents.map((o) => [o.id, o]));
  for (const d of DUELISTS) {
    const npc = npcOf("s951", d.npc);
    assert.ok(npc, `s951 npc ${d.npc} (${d.name})`);
    const launch = duelLauncher(npc.dialogue_states);
    assert.ok(launch, `${d.name}: a dialogue state carries the duel launcher`);
    assert.equal(launch.flag, d.flag, `${d.name}: the launcher flag`);
    assert.equal(launch.mode, 1, `${d.name}: bank 0x78 (mode 1, the challenge deck)`);
    assert.equal(launch.record, d.record, `${d.name}: packed argument -> CARD_NPC record`);
    const rec = opponents[d.record];
    assert.ok(rec, `${d.name}: record ${d.record} exists`);
    assert.equal(rec.folderName, d.folder, `${d.name}: the folder the walkthrough lists`);
    assert.equal(rec.level, d.level, `${d.name}: the level the walkthrough lists`);
    // The challenge state gates on the duelist's own clear bit and 17 == 0.
    const challenge = npc.dialogue_states.find((st) =>
      (st.on_close ?? []).some((c) => c.id === d.flag));
    assert.deepEqual(challenge.gate, [
      { id: d.bit, expected: 0 },
      { id: 17, expected: 0 },
      { id: d.seq, expected: 1 },
    ], `${d.name}: the challenge gate`);
  }
});

test("the win line retires the duelist and starts the farewell event the bank-0x90 table names", () => {
  const launches = data("web/assets/data/talk_event_launches.json").events;
  const events = data("web/assets/events/wstag_events.json").s951 ?? [];
  const eventIds = new Set(events.map((e) => e.id));
  for (const d of DUELISTS) {
    const npc = npcOf("s951", d.npc);
    const win = npc.dialogue_states.find((st) => (st.on_close ?? []).some((c) => c.id === d.bit && c.expected === 1));
    assert.ok(win, `${d.name}: a win state writes the clear bit 0x${d.bit.toString(16)}`);
    assert.deepEqual(win.gate, [
      { id: d.bit, expected: 0 },
      { id: 17, expected: 1 },
      { id: 16, expected: 1 },
    ], `${d.name}: the win gate is "a duel was played and it was won"`);
    // The win clears the result pair so the challenge cannot replay.
    for (const id of [17, 16]) {
      assert.ok(win.on_close.some((c) => c.id === id && c.expected === 0),
        `${d.name}: the win line clears flag ${id}`);
    }
    if (d.farewell == null) continue;
    const write = win.on_close.find((c) => ((c.id >> 8) & 0xfe) === 0x90);
    assert.ok(write, `${d.name}: the win line starts a talk event (bank 0x90)`);
    assert.equal(write.id, d.farewell, `${d.name}: the farewell write`);
    const event = launches[write.id & 0x1ff];
    assert.ok(eventIds.has(event), `${d.name}: event ${event} must exist in s951's event table`);
  }
  // Keith is the one who pays: the KoC Trophy (item 36) on his win line, not a farewell.
  const keith = npcOf("s951", 102);
  const win = keith.dialogue_states.find((st) => (st.on_close ?? []).some((c) => c.id === 0x1011 && c.expected === 1));
  assert.ok(win.on_close.some((c) => c.id === 32804 && c.expected === 1), "Keith's win grants flag 0x8024");
  const grant = data("web/assets/data/talk_item_grants.json").grants
    .find((g) => g.stage === "s951" && g.npc_id === 102 && g.item_id === 36);
  assert.ok(grant, "the KoC Trophy grant is in the shipped talk grants");
  assert.equal(grant.item_name, "KocTrophy");
  assert.deepEqual(grant.gate, [
    { id: 4113, expected: 0 },
    { id: 17, expected: 1 },
    { id: 16, expected: 1 },
  ], "the trophy is paid by the won-duel line");
});

test("the duelists and their after-positions are one clear-bit pair each", () => {
  const AFTER = { 399: 46, 400: 57, 401: 53, 402: 52, 403: 50 };
  for (const d of DUELISTS) {
    const before = sceneNpc("s951", d.npc);
    if (d.npc === 102) {
      // Keith owns no spawn pair: he is the one who stays, and his own after
      // line is his last dialogue state (gated 0x1011 == 1).
      assert.equal(before.spawn_flags, undefined, "Keith stands unconditionally");
      continue;
    }
    assert.deepEqual(before.spawn_flags, [{ id: d.bit, expected: 0 }],
      `${d.name}: stands while their bit is clear`);
    const afterId = AFTER[d.npc];
    const after = sceneNpc("s951", afterId);
    assert.equal(after.sprite, d.sprite, `${d.name}: the after-position is the same tamer`);
    assert.deepEqual(after.spawn_flags, [{ id: d.bit, expected: 1 }],
      `${d.name}: the after-position appears once their bit is set`);
    // The after-position's line is the walkthrough's "you may pass" beat.
    const afterLine = after.dialogue_states?.[0]?.dialogue?.index;
    assert.equal(afterLine, { 399: 90, 400: 95, 401: 100, 402: 105, 403: 110 }[d.npc],
      `${d.name}: the after line`);
  }
});

test("Keith's gauntlet state machine advances greet -> challenge -> (win|loss) -> after", () => {
  const keith = npcOf("s951", 102);
  const byIndex = Object.fromEntries(keith.dialogue_states.map((st) => [st.dialogue.index, st]));
  assert.ok(byIndex[81] && byIndex[82] && byIndex[83] && byIndex[84] && byIndex[85],
    "states 81..85 all ship");
  assert.deepEqual(byIndex[81].gate, [{ id: 0x1011, expected: 0 }, { id: 17, expected: 0 }, { id: 0, expected: 0 }]);
  assert.deepEqual(byIndex[85].gate, [{ id: 0x1011, expected: 1 }]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The Epic Weapon forgers
// ─────────────────────────────────────────────────────────────────────────────

// state = the dialogue index whose on_close performs the forge. product / inputs
// are item ids; the recipe names are the walkthrough's (§IV).
const RECIPES = [
  { stage: "s974", npc: 173, state: 160, product: 117, name: "Zodiac", inputs: [116, 113] },
  { stage: "s974", npc: 173, state: 200, product: 119, name: "SuperNova", inputs: [118, 115] },
  { stage: "s974", npc: 28, state: 168, product: 142, name: "Twinkle", inputs: [141, 138] },
  { stage: "s974", npc: 31, state: 188, product: 143, name: "Immaculate", inputs: [142, 139] },
  { stage: "s974", npc: 31, state: 208, product: 144, name: "Eternally", inputs: [143, 140] },
  { stage: "s974", npc: 166, state: 152, product: 103, name: "Kotetsu", inputs: [102, 99] },
  { stage: "s974", npc: 171, state: 156, product: 129, name: "Justice", inputs: [128, 125] },
  { stage: "s970", npc: 167, state: 176, product: 130, name: "Judgment", inputs: [129, 126] },
  { stage: "s970", npc: 167, state: 196, product: 131, name: "Punishment", inputs: [130, 127] },
  { stage: "s970", npc: 169, state: 164, product: 154, name: "Vanquish", inputs: [153, 150] },
  { stage: "s970", npc: 169, state: 204, product: 156, name: "Invincible", inputs: [155, 152] },
  { stage: "s970", npc: 172, state: 172, product: 104, name: "Masamune", inputs: [103, 100] },
  { stage: "s970", npc: 172, state: 192, product: 105, name: "Muramasa", inputs: [104, 101] },
];

test("the forger boards' dialogue-state lists are the overlays' own words", SKIP_ASM, () => {
  const byFile = { s970: "wstag970.s", s974: "wstag974.s" };
  const ids = { s970: [167, 169, 172], s974: [28, 31, 166, 171, 173] };
  for (const stage of Object.keys(byFile)) {
    const words = overlayWords(byFile[stage]);
    for (const npcId of ids[stage]) {
      const npc = npcOf(stage, npcId);
      assert.ok(npc, `${stage}: npc ${npcId} must be in the shipped programs`);
      assert.notEqual(findRun(words, encodeNpc(npc)), -1,
        `${stage}/npc ${npcId}: the shipped dialogue states must encode to the disc's lists`);
    }
  }
  // Hand-read anchor: Nohemon's Zodiac close (grant 0x8675, consume 0x8471 + 0x8674).
  assert.notEqual(findRun(overlayWords("wstag974.s"), [0x8471, 0x18675, 0x8674, W]), -1,
    "wstag974.s stores Nohemon's Zodiac close verbatim");
});

test("each forger state gates on the second input and its close grants the product, consuming both inputs", () => {
  const bankOf = (id) => (id >> 8) & 0xfe;
  const isCollection = (id) => bankOf(id) >= 0x80 && bankOf(id) <= 0x8e;
  for (const r of RECIPES) {
    const st = stateOf(r.stage, r.npc, r.state);
    assert.ok(st, `${r.name}: state ${r.state} ships on ${r.stage}/${r.npc}`);
    // Gate: the second input is held, the product is not.
    const held = st.gate.filter((c) => isCollection(c.id) && c.expected === 1);
    const notHeld = st.gate.filter((c) => isCollection(c.id) && c.expected === 0);
    assert.deepEqual(held.map((c) => c.id & 0x1ff), [r.inputs[1]],
      `${r.name}: the gate holds exactly the second input (item ${r.inputs[1]})`);
    assert.deepEqual(notHeld.map((c) => c.id & 0x1ff), [r.product],
      `${r.name}: the gate requires the product not yet owned`);
    // Close: grant the product, clear both inputs.
    const grants = st.on_close.filter((c) => isCollection(c.id) && c.expected === 1);
    const takes = st.on_close.filter((c) => isCollection(c.id) && c.expected === 0);
    assert.deepEqual(grants.map((c) => c.id & 0x1ff), [r.product], `${r.name}: the close grants the product`);
    assert.deepEqual(takes.map((c) => c.id & 0x1ff).sort((a, b) => a - b), [...r.inputs].sort((a, b) => a - b),
      `${r.name}: the close consumes both inputs`);
  }
});

test("the recipe item ids are the walkthrough's names", SKIP_ITEMS, () => {
  const names = itemNames();
  for (const r of RECIPES) assert.equal(names[r.product], r.name, `item ${r.product}`);
  assert.equal(names[36], "KocTrophy");
  // The five Epic Weapons the four Amaterasu Leaders' gate collects (0x7096).
  for (const [id, name] of [[105, "Muramasa"], [119, "SuperNova"], [131, "Punishment"], [144, "Eternally"], [156, "Invincible"]]) {
    assert.equal(names[id], name, `Epic Weapon item ${id}`);
  }
});

test("the five Epic Weapon grants are the s970/s974 forgers' win states", () => {
  const grants = data("web/assets/data/talk_item_grants.json").grants;
  const EXPECT = [
    [105, "s970", 172], [119, "s974", 173], [131, "s970", 167], [144, "s974", 31], [156, "s970", 169],
  ];
  for (const [item, stage, npc] of EXPECT) {
    const rows = grants.filter((g) => g.item_id === item);
    assert.ok(rows.length > 0, `item ${item}: has a talk grant`);
    assert.ok(rows.some((g) => g.stage === stage && g.npc_id === npc),
      `item ${item}: granted by ${stage} npc ${npc}`);
  }
});

test("every forger's spawn gate is the walkthrough's all-8-partners-at-45 condition", () => {
  const roster = data("web/assets/data/roster_predicate_table.json").records;
  const rec = (id) => roster.find((r) => r.flag_id === id);
  assert.deepEqual(rec(28757).semantics,
    { kind: "every_slot_owned", effect: "read", slots: 8 },
    "0x7055 = all eight roster slots obtained");
  assert.deepEqual(rec(28821).semantics,
    { kind: "every_owned_at_level", effect: "read", min_level: 45, slots: 8 },
    "0x7095 = every obtained slot at level >= 45");
  for (const [stage, npcId] of [["s970", 167], ["s970", 169], ["s970", 172], ["s974", 28], ["s974", 31], ["s974", 166], ["s974", 171], ["s974", 173]]) {
    const flags = sceneNpc(stage, npcId).spawn_flags.map((f) => f.id);
    assert.ok(flags.includes(28757) && flags.includes(28821),
      `${stage}/${npcId}: the forger spawns only with all 8 partners at level 45+`);
  }
  // The DDNA givers carry the level condition alone (the walkthrough: "all your
  // currently owned partners have to be level 45+").
  for (const [stage, npcId] of [["s970", 124], ["s970", 127], ["s971", 123], ["s971", 125]]) {
    const flags = sceneNpc(stage, npcId).spawn_flags.map((f) => f.id);
    assert.ok(flags.includes(28821), `${stage}/${npcId}: the DDNA giver's level-45 gate`);
  }
});

test("the post-game material sources for the forge chain ship on the endgame boards", () => {
  const grants = data("web/assets/data/talk_item_grants.json").grants;
  const has = (stage, npc, item) => grants.some((g) => g.stage === stage && g.npc_id === npc && g.item_id === item);
  // The four pre-game ingredient boxes, in full (s586 npcs 70..73).
  const BOXES = {
    70: [116, 141, 102, 128, 153],
    71: [113, 138, 99, 125, 150],
    72: [100, 114, 126, 139, 151],
    73: [115, 101, 127, 140, 152],
  };
  for (const [npc, items] of Object.entries(BOXES)) {
    for (const item of items) assert.ok(has("s586", Number(npc), item), `s586/${npc}: grants item ${item}`);
  }
  // The post-game copies the walkthrough's §2 item list names.
  assert.ok(has("s972", 33, 114), "Tempest Arm (s972 box)");
  assert.ok(has("s972", 78, 141), "Old Wand (s972 box)");
  assert.ok(has("s972", 77, 102), "Rusty Katana (s972 box)");
  assert.ok(has("s973", 33, 126), "Laser Cannon (s973 box)");
  assert.ok(has("s973", 33, 139), "Crystal Rod (s973 box)");
  assert.ok(has("s973", 33, 151), "Venom Fang (s973 box)");
  assert.ok(has("s970", 33, 100), "Tenjinmaru (s970 box)");
  assert.ok(has("s964", 33, 138), "Khakkhara (seabed box)");
  assert.ok(has("s964", 33, 125), "Cluster Cannon (seabed box)");
  assert.ok(has("s967", 33, 113), "Kaiser Fist (seabed box)");
  assert.ok(has("s967", 33, 99), "Onimaru (seabed box)");
  assert.ok(has("s967", 33, 150), "Saber Fang (seabed box)");
  // The two mid-level forges that live on the seabed (Seehomon / Depthmon).
  assert.ok(has("s964", 168, 118), "Prominence (Seehomon, post-game seabed)");
  assert.ok(has("s964", 170, 155), "Destruction (Depthmon, post-game seabed)");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The duel-result mechanism (flags 17/18/16) — the walker's missing write
// ─────────────────────────────────────────────────────────────────────────────

test("cardDuelCloseWrites is F0x800169e0's own write list", () => {
  assert.equal(CARD_DUEL_SCREEN_CODE, 0x700);
  assert.deepEqual(cardDuelCloseWrites(true), [
    { id: 0x11, value: 1 }, { id: 0x12, value: 1 }, { id: 0x10, value: 1 },
  ]);
  assert.deepEqual(cardDuelCloseWrites(false), [
    { id: 0x11, value: 1 }, { id: 0x12, value: 1 }, { id: 0x10, value: 0 },
  ]);
});

test("the housekeeping routine and its field call site are the assembly's own", SKIP_EXE, () => {
  const fns = readFileSync(exePath("fns.s"), "utf8").split("\n");
  const start = fns.findIndex((l) => l.startsWith(".L0x80016a20:"));
  assert.notEqual(start, -1, "fns.s stores the routine at .L0x80016a20");
  const block = fns.slice(start, start + 32).join("\n");
  for (const needle of [
    "%hi(D0x8004b448)", // the previous-screen-code getter
    "li $v1, 0x700",            // ... compared against the card-duel screen code
    "li $a0, 0x11",             // set_flag(0x11, 1)
    "li $a0, 0x12",             // set_flag(0x12, 1)
    "li $a0, 0x10",             // set_flag(0x10, won)
    "lw $v0, %lo(D0x80048ac0)($v0)", // the duel's result latch
    "sw $zr, %lo(D0x80048ac0)($v0)", // cleared after the conversion
  ]) {
    assert.ok(block.includes(needle), `the routine must contain: ${needle}`);
  }
  const field = readFileSync(asmPath("fieldstg.s"), "utf8");
  assert.ok(field.includes("lw $v0, 0x18($s0)"),
    "fieldstg loads export slot +0x18 (0x80048ad4 = F0x800169e0)");
});

// The walker's own gate evaluation, so the state picker behaves like the field's:
// the FIRST dialogue state whose gate list passes.
function pickState(npc, flags) {
  for (const st of npc.dialogue_states ?? []) {
    const ok = (st.gate ?? []).every((c) => flags.matches(c.id, c.expected));
    if (ok) return st;
  }
  return null;
}

test("a won duel advances the King of Cards chain; a loss does not (the walker's pre-fix stuck state)", () => {
  const backend = new Map();
  const flags = createFlagStore({
    get: (id) => (backend.get(id) ? 1 : 0),
    set: (id, val) => backend.set(id, val),
  });
  const keith = npcOf("s951", 102);
  const apply = (writes) => { for (const w of writes) flags.set(w.id, w.value); };

  // First meeting: the greet state.
  assert.equal(pickState(keith, flags).dialogue.index, 81, "fresh: the greet");
  apply([{ id: 0, value: 1 }]); // its close writes 0:1
  // The challenge is now the live state, and it carries the launcher.
  const challenge = pickState(keith, flags);
  assert.equal(challenge.dialogue.index, 82, "after the greet: the challenge");
  assert.ok(duelLauncher([challenge]), "the challenge carries the duel launcher");

  // WITHOUT the housekeeping (the pre-fix walker) the challenge is still live.
  assert.equal(pickState(keith, flags).dialogue.index, 82, "pre-fix: still the challenge");

  // The duel closes as a LOSS: flags 17/18/16 per F0x800169e0.
  apply(cardDuelCloseWrites(false));
  assert.equal(flags.get(17), 1, "a duel was played");
  assert.equal(flags.get(18), 1, "the companion latch");
  assert.equal(flags.get(16), 0, "and it was lost");
  assert.equal(pickState(keith, flags).dialogue.index, 83, "the loss line");
  // Its close resets the result pair AND the talked bit, so the duelist greets
  // you again before re-offering the challenge (the disc's own close list).
  for (const c of keith.dialogue_states.find((s) => s.dialogue.index === 83).on_close) {
    flags.set(c.id, c.expected);
  }
  assert.equal(pickState(keith, flags).dialogue.index, 81, "the loss sends you back to the greet");
  apply([{ id: 0, value: 1 }]); // the greet's close writes 0:1
  assert.equal(pickState(keith, flags).dialogue.index, 82, "the challenge is live again after a loss");

  // The duel closes as a WIN.
  apply(cardDuelCloseWrites(true));
  assert.equal(flags.get(16), 1, "won");
  const win = pickState(keith, flags);
  assert.equal(win.dialogue.index, 84, "the win line");
  // Its close: the trophy, the clear bit, the pair reset.
  for (const c of win.on_close) flags.set(c.id, c.expected);
  assert.equal(flags.get(0x1011), 1, "Keith's clear bit retires him");
  assert.equal(flags.get(17), 0, "and resets the pair");
  assert.equal(pickState(keith, flags).dialogue.index, 85, "the after line");
});

test("0x7095 resolves against per-slot levels: the forger spawn gate", () => {
  const rosterTable = Object.fromEntries(
    data("web/assets/data/roster_predicate_table.json").records.map((r) => [r.key, r]),
  );
  const F_7095 = 28821;
  const make = (owned, levels) => createFlagStore(
    { get: () => 0, set: () => {} },
    { rosterTable, ownedSlots: () => owned, partnerLevels: () => new Map(levels) },
  );
  // All eight obtained, all at 45+: the forgers appear.
  assert.equal(make(0xff, Array.from({ length: 8 }, (_, s) => [s, 45])).get(F_7095), 1);
  // One below the floor: no.
  assert.equal(make(0xff, Array.from({ length: 8 }, (_, s) => [s, s === 3 ? 44 : 99])).get(F_7095), 0);
  // An owned slot the walker has no record for keeps the gate dormant.
  assert.equal(make(0x0f, [[0, 99], [1, 99]]).get(F_7095), null);
  // Unowned slots are skipped with no level test — vacuously true (F0x80015944).
  assert.equal(make(0, []).get(F_7095), 1);
  // The all-owned gate (0x7055) still reads the mask alone.
  assert.equal(make(0xff, []).get(28757), 1);
  assert.equal(make(0x7f, []).get(28757), 0);
});

test("the walker wires both halves: the close housekeeping and the level source", () => {
  const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
  assert.match(game, /function applyCardDuelCloseHousekeeping\(won\) \{/,
    "the field's housekeeping helper");
  assert.match(game, /applyCardDuelCloseHousekeeping\(cardDuel\.resultWon\?\.\(\) === true\)/,
    "the duel launch passes the close callback that runs it");
  assert.match(game, /partnerLevels: \(\) => \{/, "the per-slot level source is wired");
  const store = readFileSync(new URL("../web/flag-store.js", import.meta.url), "utf8");
  assert.match(store, /case "every_owned_at_level": \{/, "the case-7 predicate is handled");
});
