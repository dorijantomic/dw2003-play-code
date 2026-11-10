// A partner set to a form from the pause menu or the lab (ps.digimonId = the form) fights with the
// form ADDED on top of its starter's own numbers, as the original does. F0x8009EC94 compares the
// live form id with the roster slot's own DIGIMON_PROFILES row (the starter, which a form change never
// alters; fightstg.s .L0x8009ed84-.L0x8009ed90) and, when they differ, adds the form's species record
// to the five stats, the seven elements and the five status resistances. The pause menu and the lab
// write only the current-form word, so buildPlayerRecord must name the STARTER as the roster species.
//
// The real buildPlayerRecord runs here (through the online kit's `party()`), over the shipped tables;
// the numbers are then read through the shared combat reads (engine/dw3/battle-combat.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effStats, combatantElements } from "../engine/dw3/battle-combat.ts";

// web/battle.js reads localStorage, window and location, and fetches its tables by relative path.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { search: "" } };
globalThis.location = { search: "" };
globalThis.fetch = async (path) => {
  const buf = readFileSync(resolve("web", path));
  return { ok: true, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
};
const { createBattle, commitBattleFormChange } = await import("../web/battle.js");
const { ROSTER_SLOT_CHARIDS } = await import("../engine/dw3/roster.ts");

const dj = JSON.parse(readFileSync(resolve("web/assets/data/digimon.json"), "utf8")).digimon;
const byName = (name) => dj.find((d) => d.name === name);
const CORE = ["str", "def", "spt", "wis", "spd"];
const ELEMS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];

/** Agumon's table row at Lv 1: its stored numbers, no trained points. */
const stored = (row) => ({ str: row.str, def: row.def, spt: row.spt, wis: row.wis, spd: row.spd, chr: row.chr });

async function kitFor(charIds, leadDigimonId) {
  const lead = byName("Agumon");
  const partnerStats = { digimonId: leadDigimonId, level: 1, hp: 100, mp: 50, maxHp: 100, maxMp: 50, stats: stored(lead), bonuses: {} };
  const state = {
    manifest: { characters: [{ id: "none" }, { id: charIds[0] }] }, charIdx: 1,
    party: charIds, partnerStats, partyStats: null, equipment: {},
  };
  const battle = createBattle({ getContext: () => ({}) }, {}, () => state);
  return (await battle.mpKit()).party();
}

test("Agumon set to Greymon beforehand fights with Greymon's record added on its own", async () => {
  const agumon = byName("Agumon"), greymon = byName("Greymon");
  const [{ rec }] = await kitFor(["p006agum"], greymon.id);
  assert.equal(rec.profile.name, "Greymon", "the partner begins the fight in the form it was set to");
  assert.equal(rec.savedSpeciesId, agumon.id, "the roster row's own species is the starter");
  assert.equal(rec.savedProfile.name, "Agumon");
  assert.deepEqual(ELEMS.map((e) => combatantElements(rec)[e]), [190, 130, 60, 130, 125, 125, 130]);
  const s = effStats(rec);
  assert.deepEqual(CORE.map((k) => s[k]), CORE.map((k) => agumon[k] + greymon[k]), "stored + the form's 20/30/30/10/0");
  assert.deepEqual(CORE.map((k) => s[k]), [68, 80, 82, 40, 19]);
});

test("going back to the starter mid-battle adds nothing; another form adds only itself", async () => {
  const agumon = byName("Agumon"), greymon = byName("Greymon"), growlmon = byName("Growlmon");
  const [{ rec }] = await kitFor(["p006agum"], greymon.id);
  const battle = { activePlayerIndex: 0, playerRecords: [rec], formFlags: [], blast: null };
  commitBattleFormChange(battle, growlmon);
  assert.deepEqual(CORE.map((k) => effStats(rec)[k]), CORE.map((k) => agumon[k] + growlmon[k]), "Growlmon's own, not Greymon's on top");
  commitBattleFormChange(battle, agumon);
  assert.deepEqual(CORE.map((k) => effStats(rec)[k]), CORE.map((k) => agumon[k]), "back on the starter: only its stored numbers");
  assert.deepEqual(ELEMS.map((e) => combatantElements(rec)[e]), ELEMS.map((e) => agumon.resistances[e]));
});

test("a partner on its starter form is unchanged", async () => {
  const agumon = byName("Agumon");
  const [{ rec }] = await kitFor(["p006agum"], agumon.id);
  assert.deepEqual(CORE.map((k) => effStats(rec)[k]), CORE.map((k) => agumon[k]));
  assert.deepEqual(ELEMS.map((e) => combatantElements(rec)[e]), ELEMS.map((e) => agumon.resistances[e]));
});

test("member.rookieId is the roster slot's own starter row for all eight starters", async () => {
  const party = await kitFor(ROSTER_SLOT_CHARIDS.slice(0, 8), byName("Greymon").id);
  assert.equal(party.length, 8);
  party.forEach(({ member, rec }, slot) => {
    assert.equal(member.slot, slot);
    assert.equal(member.rookieId, slot + 1, "digimon.json id = roster slot + 1 (engine/dw3/roster.ts rosterSlotDigimonId)");
    assert.equal(rec.savedSpeciesId, slot + 1);
    assert.equal(rec.savedProfile.id, slot + 1);
    assert.equal(rec.savedProfile.is_starter, true);
  });
});

test("applyEvolution only sets the worn form: stats, max HP/MP and HP/MP stay, and the next battle counts the form once", async () => {
  const agumon = byName("Agumon"), greymon = byName("Greymon");
  const partnerStats = { digimonId: agumon.id, level: 5, hp: 40, mp: 9, maxHp: 77, maxMp: 33, stats: { ...stored(agumon), str: agumon.str + 4 }, bonuses: {} };
  const before = { stats: { ...partnerStats.stats }, maxHp: 77, maxMp: 33, hp: 40, mp: 9 };
  const state = {
    manifest: { characters: [{ id: "none" }, { id: "p006agum" }] }, charIdx: 1,
    party: ["p006agum"], partnerStats, partyStats: null, equipment: {},
  };
  const battle = createBattle({ getContext: () => ({}) }, {}, () => state);
  const kit = await battle.mpKit();   // loads the tables applyEvolution reads
  const r = battle.applyEvolution("Greymon");
  assert.equal(r.ok, true);
  assert.deepEqual(partnerStats.stats, before.stats, "stored stats untouched");
  assert.equal(partnerStats.maxHp, before.maxHp);
  assert.equal(partnerStats.maxMp, before.maxMp);
  assert.equal(partnerStats.hp, before.hp);
  assert.equal(partnerStats.mp, before.mp);
  assert.equal(partnerStats.digimonId, greymon.id);
  assert.equal(state.manifest.characters[1].digimonId, greymon.id);
  const [{ rec }] = kit.party();
  const s = effStats(rec);
  assert.deepEqual(CORE.map((k) => s[k]), CORE.map((k) => before.stats[k] + greymon[k]), "stored + the form once");
});
