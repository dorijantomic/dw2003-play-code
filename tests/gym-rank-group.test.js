// GYM-Q001 (decoded 2026-07-26): the gym greeter's on_close flag-bank-0x94 write
// carries the 0-based rank-menu group that STGTRAIN opens with, and which group
// it writes is picked by the ID cards owned (SilverID 40 / GoldID 41 /
// PlatinumID 42). See docs/research/battle/gym-entry-and-rank-chain-2026-07-08.md.
// Before this, the walker used one global ID-card heuristic for every gym, so
// every gym offered the same drills.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB = path.join(ROOT, "web");
global.fetch = async (url) => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(path.join(WEB, String(url)), "utf8")),
});

const { gymGroupFor } = await import("../web/gym.js");
const { gymDrillsForRank } = await import("../web/battle.js");

const RANKS = JSON.parse(readFileSync(path.join(WEB, "assets/data/gym_ranks.json"), "utf8"));
const PROG = JSON.parse(readFileSync(path.join(WEB, "assets/data/progression.json"), "utf8"));
const inv = (...ids) => ids.map((id) => ({ id, qty: 1 }));

test("every decoded greeter resolves to a real rank_menus group", () => {
  // 9 = 8 gym stages (four gyms, each with an entrance hall and a training floor:
  // s330/s331, s495/s496, s570/s571, s720/s721) + the s940 ordinal-45 alias. s720's
  // greeter (npc 136, groups 5/6/13) only appeared once the scene generator stopped
  // dropping the ordered dialogue line carrying its bank-0x94 write.
  assert.equal(RANKS.gyms.length, 9);
  for (const gym of RANKS.gyms)
    for (const opt of gym.options) {
      assert.ok(opt.group >= 0 && opt.group < PROG.gym.rank_menus.length);
      assert.ok(opt.requires.length > 0);
    }
});

test("ID cards select the per-gym group, and gyms differ from each other", () => {
  // s330 Leomon is the only greeter with a no-licence option (group 0).
  assert.equal(gymGroupFor("s330", inv(), RANKS), 0);
  assert.equal(gymGroupFor("s330", inv(40), RANKS), 1);
  assert.equal(gymGroupFor("s330", inv(40, 41), RANKS), 6);
  assert.equal(gymGroupFor("s330", inv(40, 41, 42), RANKS), 13);

  // Same licence, different gym -> different group (the whole point of the fix).
  assert.equal(gymGroupFor("s495", inv(40), RANKS), 2);
  assert.equal(gymGroupFor("s570", inv(40), RANKS), 3);
  assert.equal(gymGroupFor("s496", inv(40), RANKS), 4);
  assert.equal(gymGroupFor("s331", inv(40), RANKS), 7);
  assert.equal(gymGroupFor("s571", inv(40), RANKS), 9);
  assert.equal(gymGroupFor("s720", inv(40), RANKS), 5);
  assert.equal(gymGroupFor("s721", inv(40), RANKS), 11);

  // PlatinumID replaces the greeter record outright: every gym goes to group 13.
  for (const gym of RANKS.gyms)
    assert.equal(gymGroupFor(gym.stage, inv(40, 41, 42), RANKS), 13);
});

test("gyms other than s330 offer nothing without SilverID; unknown stages are null", () => {
  for (const gym of RANKS.gyms)
    if (gym.stage !== "s330" && gym.stage !== "s940")
      assert.equal(gymGroupFor(gym.stage, inv(), RANKS), null);
  assert.equal(gymGroupFor("s200", inv(40, 41, 42), RANKS), null);
});

test("the group indexes the drill menu the gym actually shows", () => {
  // group N is rank N+1 for gymDrillsForRank (1-based).
  const basic = gymDrillsForRank(gymGroupFor("s330", inv(), RANKS) + 1, PROG.gym);
  assert.deepEqual(basic.map((d) => d.drill), [1, 2, 3, 4, 5]); // 5 core drills only
  const full = gymDrillsForRank(gymGroupFor("s721", inv(40, 41, 42), RANKS) + 1, PROG.gym);
  assert.equal(full.length, 12);
  assert.ok(full.every((d) => d.drill >= 13)); // all super core + super elemental
});
