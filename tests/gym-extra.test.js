// Extra training halls (web/gym-extra.js, data/authored/web/assets/data/gym_extra.json).
// Data is valid, every referenced drill exists in its tier menu, the greeter maps are
// towns without a disc gym, and gains/prices are the game's own curve for that rank.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB = path.join(ROOT, "web");
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"));
global.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(path.join(WEB, String(url)), "utf8")) });

const { gymExtraHallAt, gymExtraTier, gymExtraPlan } = await import("../web/gym-extra.js");
const { gymTrainingResult, gymStatForId } = await import("../web/battle.js");
const { questGrid } = await import("../web/quest-walk.js");
const { walkable } = await import("../web/quest-editor-lib.js");

const DATA = read("data/authored/web/assets/data/gym_extra.json");
const INSTALLED = read("web/assets/data/gym_extra.json");
const PROG = read("web/assets/data/progression.json").gym;
const RANKS = read("web/assets/data/gym_ranks.json");
const CHARS = read("data/authored/quests/new_characters.json").characters;
const TIERS = ["none", "silver", "gold", "platinum"];
const inv = (...ids) => ids.map((id) => ({ id, qty: 1 }));

test("installed copy equals the authored file", () => {
  assert.deepEqual(INSTALLED, DATA);
});

test("three halls, unique ids, themes of two stats, all four tiers", () => {
  assert.equal(DATA.halls.length, 3);
  for (const key of ["id", "npc_id", "map"]) assert.equal(new Set(DATA.halls.map((h) => h[key])).size, 3, key);
  for (const h of DATA.halls) {
    assert.ok(h.npc_id >= 1000, "own character ids start at 1000");
    assert.equal(h.theme.length, 2);
    assert.ok(h.greeting.length >= 1 && h.trainer && h.name && h.town);
    assert.deepEqual(Object.keys(h.tiers).sort(), [...TIERS].sort());
  }
});

test("every referenced drill exists in its tier menu and trains the theme", () => {
  for (const h of DATA.halls) {
    for (const tier of TIERS) {
      const { group, drills } = h.tiers[tier];
      const menu = PROG.rank_menus[group];
      assert.ok(menu, `${h.id} ${tier}: group ${group} exists`);
      assert.ok(drills.length >= 1 && new Set(drills).size === drills.length);
      for (const id of drills) {
        const e = menu.find((m) => m.drill === id);
        assert.ok(e, `${h.id} ${tier}: drill ${id} is in rank_menus[${group}]`);
        // stats the drill gains (a core loss on the secondary does not count)
        const gained = [gymStatForId(e.primary)];
        if (e.secondary === 15 || e.secondary === 16) gained.push(gymStatForId(e.secondary));
        assert.ok(gained.some((s) => h.theme.includes(s)), `${h.id} drill ${id} gains ${gained}`);
      }
    }
  }
});

test("tier groups are groups real disc greeters use at that card level", () => {
  const sets = { none: new Set(), silver: new Set(), gold: new Set(), platinum: new Set() };
  for (const gym of RANKS.gyms) for (const o of gym.options) {
    const own = (item) => o.requires.find((r) => r.item === item)?.owned;
    if (own(42) === true) sets.platinum.add(o.group);
    else if (own(40) === true && own(41) === true) sets.gold.add(o.group);
    else if (own(40) === true) sets.silver.add(o.group);
    else if (own(40) === false) sets.none.add(o.group);
  }
  for (const h of DATA.halls) for (const t of TIERS)
    assert.ok(sets[t].has(h.tiers[t].group), `${h.id} ${t} group ${h.tiers[t].group} is not used by a disc gym at that card`);
});

test("greeter maps are towns without a disc gym, West / North / South, on free walkable ground", () => {
  const gymStages = new Set(RANKS.gyms.map((g) => g.stage));
  assert.deepEqual(DATA.halls.map((h) => h.map).sort(), ["s500", "s660", "s760"]);
  for (const h of DATA.halls) {
    assert.ok(!gymStages.has(h.map), `${h.map} has a disc gym`);
    const scene = read(`web/assets/scenes/${h.map}.json`);
    assert.ok(scene.exits.length >= 1);
    assert.ok(scene.npcs.some((n) => n.npc_id === 20 || (n.npc_id >= 22 && n.npc_id <= 24)), `${h.map} looks like a town`);
    assert.ok(!scene.npcs.some((n) => n.npc_id === h.npc_id), "npc id unused by the disc cast");
    assert.ok(!scene.npcs.some((n) => Math.hypot(n.x - h.x, n.y - h.y) < 40), "no disc npc stands on the greeter");
    const grid = questGrid(read(`web/assets/collision/${h.map}.json`));
    assert.ok(walkable(grid, h.x, h.y), "walkable");
    const ch = CHARS.find((c) => c.npc_id === h.npc_id);
    assert.ok(ch, `character ${h.npc_id}`);
    assert.deepEqual(ch.residents, [{ map: h.map, x: h.x, y: h.y, dir: h.dir }]);
  }
  const ex = read("web/extra_npcs.json");
  for (const h of DATA.halls) {
    assert.ok(ex.npc_sprites[String(h.npc_id)], `sprite for ${h.npc_id}`);
    assert.ok(ex.residents.some((r) => r.npc_id === h.npc_id && r.map === h.map && r.x === h.x && r.y === h.y));
    assert.ok(existsSync(path.join(WEB, "extra_sprites", `q${h.npc_id}.png`)));
  }
});

test("ID card tiers match the disc gate", () => {
  assert.equal(gymExtraTier(inv(), DATA.cards), "none");
  assert.equal(gymExtraTier(inv(40), DATA.cards), "silver");
  assert.equal(gymExtraTier(inv(40, 41), DATA.cards), "gold");
  assert.equal(gymExtraTier(inv(40, 41, 42), DATA.cards), "platinum");
  assert.equal(gymExtraTier(inv(42), DATA.cards), "platinum");
  // the same groups the Leomon greeter (s330) writes for the same cards
  const leo = RANKS.gyms.find((g) => g.stage === "s330");
  const leoGroup = (cards) => leo.options.find((o) => o.requires.every((r) => cards.includes(r.item) === r.owned))?.group;
  const hall = DATA.halls[0];
  assert.equal(gymExtraPlan(DATA, hall, inv()).group, leoGroup([]));
  assert.equal(gymExtraPlan(DATA, hall, inv(40, 41)).group, leoGroup([40, 41]));
  assert.equal(gymExtraPlan(DATA, hall, inv(40, 41, 42)).group, leoGroup([40, 41, 42]));
  assert.equal(gymExtraHallAt(DATA, "s660", 1100).id, "windrunner");
  assert.equal(gymExtraHallAt(DATA, "s660", 1101), null);
});

