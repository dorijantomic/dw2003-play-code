// tests/card-story-grants.test.js — the cards characters hand you.
//
// A dialogue state's on_close write into game-state bank 0x92 is a card grant:
// the resident dispatcher routes that bank to F0x80016314(cardId, value), which
// gives one copy when the value is non-zero and takes one when it is zero. The
// walker used to treat 0x92 as an ITEM bank, so every one of these silently
// added a phantom item and no card.
//   — CARD-COLLECTION-ENTRY-POINTS-2026-08-14, CARD-STORY-GRANTS-2026-08-14
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const SCENES = new URL("../web/assets/scenes/", import.meta.url);
const catalog = JSON.parse(readFileSync(new URL("../web/assets/data/card_catalog.json", import.meta.url)));
const byId = new Map(catalog.cards.map((c) => [c.id, c]));

const CARD_BANK = 0x92;
const grants = [];
for (const name of readdirSync(SCENES).filter((f) => f.endsWith(".json"))) {
  const scene = JSON.parse(readFileSync(new URL(name, SCENES)));
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (k === "on_close") {
        for (const e of Array.isArray(v) ? v : [v]) {
          if (e && typeof e.id === "number" && ((e.id >> 8) & 0xfe) === CARD_BANK) {
            grants.push({ stage: name.replace(".json", ""), id: e.id & 0x1ff, value: e.expected });
          }
        }
      }
      walk(v);
    }
  };
  walk(scene);
}

test("the shipped scenes carry story card grants", () => {
  // 31, not 30: the world-3 stage s972 hands out one more card from an ordered
  // dialogue line the scene generator used to drop when it could not resolve the
  // line's text (tools/gen_scenes.py apply_npc_spawns, no _talk_valid filter).
  assert.equal(grants.length, 31, "31 dialogue states write into bank 0x92");
  assert.equal(new Set(grants.map((g) => g.stage)).size, 9, "across 9 stages");
  assert.equal(new Set(grants.map((g) => g.id)).size, 16, "16 distinct cards");
});

test("every grant names a real card and every one is a give, not a take", () => {
  for (const g of grants) {
    assert.ok(byId.has(g.id), `${g.stage}: card ${g.id} is not in the catalog`);
    assert.equal(g.value, 1, `${g.stage}: card ${g.id} should be a give`);
  }
});

test("the five Digimon cards with a rule are story grants, not shop stock", () => {
  // RosemonII, MarineAngemon, SaberLeomon, Gryphonmon, Creepymon — the five the
  // album and the shop both special-case by id. They are handed out in the
  // Circuit Board stages; nothing sells them, which is why the shop shows them
  // an R1 hint where every other card shows a price.
  const special = [0x45, 0x70, 0x9b, 0xc6, 0xf1];
  const granted = new Set(grants.map((g) => g.id));
  for (const id of special) {
    assert.ok(granted.has(id), `${byId.get(id)?.name} (${id}) should be a story grant`);
  }
  const stages = new Set(grants.filter((g) => special.includes(g.id)).map((g) => g.stage));
  assert.ok(stages.has("s875") && stages.has("s885"), "handed out on the Circuit Board");
});

test("one Digimon card is given early, and it matches the captured save", () => {
  // Gabumon at the Asuka Inn. RAM capture walk_ram1.bin holds exactly one copy
  // of card 183 beyond the starter deck, which is this grant.
  const gabumon = grants.filter((g) => g.id === 183);
  assert.equal(gabumon.length, 1);
  assert.equal(gabumon[0].stage, "s235");
  assert.equal(byId.get(183).name, "Gabumon");
});

test("the rest are Program cards, one per sector", () => {
  const perSector = grants.filter((g) => ["s335", "s400", "s465", "s650", "s725"].includes(g.stage));
  assert.equal(perSector.length, 5);
  for (const g of perSector) assert.equal(byId.get(g.id).kind, "program");
  assert.equal(new Set(perSector.map((g) => g.id)).size, 5, "five different cards");
});
