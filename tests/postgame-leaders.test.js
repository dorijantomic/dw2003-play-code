// The four Amaterasu Leaders: the disc's own dialogue tables, against the walker's
// shipped data. The post-game quest's gate chain is four NPC dialogue-state machines
// in the ordinal-45 alias stages, and this test pins BOTH ends of it mechanically:
//
//   1. the raw flag-list words in the stage overlays (assembly outranks everything),
//      as contiguous runs read straight out of ~/ddw3/asm/dw2003/pro/*.s;
//   2. the same lists as encoded from web/stage-npc-programs.json (the walker's
//      per-NPC dialogue states), plus the three data tables the runtime resolves:
//      the challenge fight screens (stage_encounters.json scripted blocks), the
//      virtual gates (roster_predicate_table.json) and the arena reception's
//      close-launch binding (talk_launch_bindings.json).
//
// The flag-list encoding is the disc's own: each entry is
// `flag | 0x10000 when expected == 1`, a list is closed by 0xffff, and a dialogue
// state emits its gate list first, then (when present) its on_close list
// (docs/research/systems/arena-finale-gate-2026-10-06.md §1a reads the same shape
// off wstag926.s 0x37c-0x3a0). The expected literals below were hand-read from the
// overlays first; the derivation is what keeps them from drifting.
//
// Player-facing map of the runs (all four stages are the s9xx endgame aliases):
//   s956 npc 143 Chinron/Qing Long Leader at (352,234) -> 0x100d + 0x7400 -> 305
//   s949 npc 144 Zhu Que Leader at (1073,145)          -> 0x100e + 0x7400 -> 306
//   s949 npc 145 Bai Hu Leader at (520,220)            -> 0x100f + 0x7401 -> 307
//   s954 npc 146 Xuan Wu Leader at (924,323)           -> 0x1010 + 0x7400 -> 308
//   s926 npc 32  Arena Reception                       -> event 1606 -> s927 -> 262
// The 0x7096 gate is collection_all over item ids 105/119/131/144/156 = Muramasa,
// SuperNova, Punishment, Eternally, Invincible (the walkthrough's five Epic Items);
// 0x7054 is stored-bits-all-set over 0x100d..0x1010.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DDW3_ROOT = process.env.DDW3_DIR || join(homedir(), "ddw3");
const asmPath = (file) => join(DDW3_ROOT, "asm/dw2003/pro", file);
const ASM_AVAILABLE = existsSync(asmPath("wstag956.s"));
const SKIP_ASM = {
  skip: !ASM_AVAILABLE && "ddw3 asm corpus not present (set DDW3_DIR or clone ddw3 to ~/ddw3)",
};

const data = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url)));

const W = 0xffff;
/** The disc's flag-list encoding: id | 0x10000 when expected == 1, 0xffff closes. */
const entry = (c) => c.id | (c.expected === 1 ? 0x10000 : 0);
/** One dialogue state's words: gate list, then (when present) its on_close list. */
function encodeState(st) {
  const out = [];
  for (const c of st.gate ?? []) out.push(entry(c));
  out.push(W);
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

const npcOf = (stage, npcId) =>
  (data("web/stage-npc-programs.json").stages[stage] ?? []).find((n) => n.npc_id === npcId);

// The leaders' own lists, hand-read from the overlays (see the header map).
const LEADERS = [
  { stage: "s956", npc: 143, file: "wstag956.s", screen: 305, bit: 4109, position: "352,234",
    words: [0x7096, W, 0x17096, 0x100d, W, 0x1100d, 0x17400, W, 0x17096, 0x1100d, W] },
  { stage: "s949", npc: 144, file: "wstag949.s", screen: 306, bit: 4110, position: "1073,145",
    words: [0x7096, W, 0x17096, 0x100e, W, 0x17400, 0x1100e, W, 0x17096, 0x1100e, W] },
  { stage: "s949", npc: 145, file: "wstag949.s", screen: 307, bit: 4111, position: "520,220",
    words: [0x7096, W, 0x17096, 0x100f, W, 0x1100f, 0x17401, W, 0x17096, 0x1100f, W] },
  { stage: "s954", npc: 146, file: "wstag954.s", screen: 308, bit: 4112, position: "924,323",
    words: [0x7096, W, 0x17096, 0x1010, W, 0x11010, 0x17400, W, 0x17096, 0x11010, W] },
];

test("each leader's dialogue-state lists are the overlay's own words", SKIP_ASM, () => {
  for (const L of LEADERS) {
    const words = overlayWords(L.file);
    assert.notEqual(findRun(words, L.words), -1,
      `${L.file}: the ${L.stage}/npc ${L.npc} flag-list run must appear verbatim in the overlay`);
  }
  // s949 stores 144's block immediately before 145's: the two runs are contiguous.
  const both = [...LEADERS[1].words, ...LEADERS[2].words];
  assert.notEqual(findRun(overlayWords("wstag949.s"), both), -1,
    "wstag949.s stores Zhu Que's lists immediately before Bai Hu's");
});

test("the shipped NPC programs encode to the overlay's lists", SKIP_ASM, () => {
  for (const L of LEADERS) {
    const npc = npcOf(L.stage, L.npc);
    assert.ok(npc, `${L.stage}: npc ${L.npc} must be in the shipped programs`);
    assert.equal(`${npc.x},${npc.y}`, L.position,
      `${L.stage}/npc ${L.npc}: the decoded position (bank70 table, and the raw cast record)`);
    assert.deepEqual(encodeNpc(npc), L.words,
      `${L.stage}/npc ${L.npc}: the shipped dialogue states must encode to the disc's lists`);
    // The challenge state (gate 0x7096 && own bit clear) carries the write list.
    const challenge = npc.dialogue_states.find((st) =>
      st.on_close?.some((c) => c.id === L.bit));
    assert.ok(challenge, `${L.stage}: a state must write the challenge bit ${L.bit}`);
    assert.deepEqual(challenge.gate,
      [{ id: 28822, expected: 1 }, { id: L.bit, expected: 0 }], "the challenge gate");
  }
});

test("the four challenge battles are the stages' scripted record slots", () => {
  const enc = data("web/assets/data/stage_encounters.json").stages;
  assert.equal(enc["956"].zones[3].slots[0], 305, "s956 record 0");
  assert.deepEqual(enc["949"].zones[3].slots.slice(0, 2), [306, 307], "s949 records 0/1");
  assert.equal(enc["954"].zones[3].slots[0], 308, "s954 record 0");
  assert.equal(enc["927"].zones[3].slots[0], 262, "s927 record 0 (the World Champion)");
});

test("the two gates are the disc's own predicate records", () => {
  const table = data("web/assets/data/roster_predicate_table.json");
  const recs = table.records ?? table;
  const byId = (id) => recs.find((r) => r.flag_id === id);
  assert.deepEqual(byId(28822).semantics, {
    kind: "collection_all", effect: "read", collection_indices: [105, 119, 131, 144, 156],
  }, "0x7096 = all five Epic Items owned");
  assert.deepEqual(byId(28756).semantics, {
    kind: "stored_bits_all_set", effect: "read", bank: 16, flag_ids: [4109, 4110, 4111, 4112],
  }, "0x7054 = all four challenges taken");
  // Those five ids ARE the walkthrough's Epic Items, by name.
  const catalog = data("web/assets/data/items.json").catalog;
  const names = [105, 119, 131, 144, 156].map((id) => catalog.find((c) => c.id === id)?.name);
  assert.deepEqual(names, ["Muramasa", "SuperNova", "Punishment", "Eternally", "Invincible"]);
});

test("the arena reception's close launches event 1606, and its lists are the overlay's", SKIP_ASM, () => {
  const npc = npcOf("s926", 32);
  assert.ok(npc, "s926: the receptionist (npc 32) must ship");
  const words = [0x7054, W, 0x17054, 0x100c, W, 0x1906f, W, 0x17054, 0x1100c, W];
  assert.notEqual(findRun(overlayWords("wstag926.s"), words), -1,
    "wstag926.s 0x37c-0x3a0 must hold the receptionist's three states verbatim");
  assert.deepEqual(encodeNpc(npc), words, "the shipped states must encode to those words");
  const bindings = data("web/assets/data/talk_launch_bindings.json").stages.s926;
  const bind = bindings.find((b) => b.npc === 32 && b.state === 1);
  assert.equal(bind.event, 1606, "state 1's bank-0x90 bit names event 1606");
  assert.equal(bind.bit, 111, "the bit the state writes");
  assert.deepEqual(bind.gate, [{ id: 28756, expected: 1 }, { id: 4108, expected: 0 }],
    "the launch sits behind 0x7054 and 0x100c == 0");
});

test("the endgame inns and save points keep their alias records and handoffs", async () => {
  const { INN_ALIAS_STAGES } = await import("../engine/dw3/inn.ts");
  assert.deepEqual(INN_ALIAS_STAGES, { 928: 633, 946: 658, 957: 669 },
    "the three alias inns open their base screens' records");
  const wstag = data("web/assets/events/wstag_events.json");
  const last = (stage, id) => wstag[stage].find((e) => e.id === id).disasm.at(-1);
  assert.equal(last("s928", 1612), "HANDOFF 3082 0 0 0", "s928 Guardromon -> save-point slot 10");
  assert.equal(last("s946", 1648), "HANDOFF 3083 0 0 0", "s946 Guardromon -> save-point slot 11");
  const bindings = data("web/assets/data/talk_launch_bindings.json").stages;
  assert.deepEqual([bindings.s928[0].npc, bindings.s928[0].bit, bindings.s928[0].event],
    [21, 112, 1612], "s928's save launch site");
  assert.deepEqual([bindings.s946[0].npc, bindings.s946[0].bit, bindings.s946[0].event],
    [21, 122, 1648], "s946's save launch site");
});
