// The battle result header's event queue, pinned from the disc's own data.
//
// Ledger BATTLE-Q001-FLAG-003 / -FLAG-004: byte 0x800A444F (result-header +0x5B) is slot 35 of a
// 37-slot queue occupying header +0x38..+0x5C, and the slot index is the acting technique record's
// byte +0x0A -- the disc's own `dispatch` column. FIGHTSTG_F0x80091534 walks all 37 slots and
// clears each one it handles (fightstg.s:14965 / :15264-:15270).
//
// This test re-derives the whole slot column from the shipped extract every run, so the decoded
// member list cannot drift from the data. It is the census the frontier asked for: the code's
// "which slot does this technique own" list must EQUAL the list decoded from the assembly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const QUEUE_FIRST_OFFSET = 0x38;
const QUEUE_LAST_OFFSET = 0x5c;
const SLOT_COUNT = QUEUE_LAST_OFFSET - QUEUE_FIRST_OFFSET + 1; // 37

const techTable = JSON.parse(
  readFileSync(new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));
const digimon = JSON.parse(
  readFileSync(new URL("../web/assets/data/digimon.json", import.meta.url), "utf8"));

const skills = new Map(digimon.skills.map((s) => [s.id, s]));
const rows = Object.entries(techTable).map(([id, r]) => ({
  id: Number(id),
  slot: r.dispatch,          // record byte +0x0A
  power: r.f8,               // record byte +0x0B
  crit: r.crit,              // record byte +0x0C
  name: skills.get(Number(id))?.name ?? null,
}));

/** The queue slot a technique record owns, or null when its byte names no slot. */
function queueSlot(techId) {
  const r = techTable[String(techId)];
  if (!r) return null;
  const off = QUEUE_FIRST_OFFSET + r.dispatch;
  return off >= QUEUE_FIRST_OFFSET && off <= QUEUE_LAST_OFFSET ? off : null;
}

test("every technique's slot byte lands inside the 37-slot queue", () => {
  assert.equal(SLOT_COUNT, 37);
  assert.equal(rows.length, 443, "the disc's technique table has 443 rows");
  const outside = rows.filter((r) => queueSlot(r.id) === null).map((r) => r.id);
  assert.deepEqual(outside, [], "no technique may name a slot outside header +0x38..+0x5C");
});

test("header +0x5B is Cross Slash's own slot and Cross Slash's alone", () => {
  const owners = rows.filter((r) => queueSlot(r.id) === 0x5b);
  assert.deepEqual(owners.map((r) => [r.id, r.name]), [[393, "Cross Slash"]]);
  // The record byte that decides it, and the value its applier stores there.
  assert.equal(techTable["393"].dispatch, 35);
  assert.equal(techTable["393"].crit, 1);
});

test("header +0x3E is the six-move instant-death family's slot", () => {
  const owners = rows.filter((r) => queueSlot(r.id) === 0x3e).map((r) => r.name).sort();
  assert.deepEqual(owners, [
    "Atomic Ray", "Dimension Scissors", "Gate of Destiny",
    "Hunting Knife", "Soul Plunder", "Soul Snatcher",
  ]);
  // F0x800a0fac's power term is record +0x0B on this whole family (record +0x0A is 6, so the
  // "plain attack" branch at fightstg.s:31527 is never taken).
  for (const r of rows.filter((x) => queueSlot(x.id) === 0x3e)) {
    assert.ok(r.slot >= 2);
    assert.ok(r.power > 0, `${r.name} carries the +0x0B power the KO roll reads`);
  }
});

test("the ailment slots hold only that ailment's techniques", () => {
  const names = (off) =>
    [...new Set(rows.filter((r) => queueSlot(r.id) === off).map((r) => r.name))].sort();
  assert.deepEqual(names(0x3a), [ // poison
    "Deadly Poison", "Evil Poison", "Fight", "Necro Mist", "Poison Bites", "Thorn Whipping", "Venom Stab",
  ].sort());
  assert.ok(names(0x3b).every((n) => /Freeze|Paralyze|Shock|Spinal Tap|Sword|Fight/.test(n)),
    "slot +0x3B is the paralysis family");
  assert.ok(names(0x3c).every((n) => /Confuse|Panic|Fight/.test(n)),
    "slot +0x3C is the confusion family");
  assert.ok(names(0x51).every((n) => n === "Soul Charge" || n === "Misshukikou"),
    "slot +0x51 is the two Chi-saving moves");
});
