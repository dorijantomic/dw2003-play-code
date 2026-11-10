// Enemy drop_item names are compact ("ArmorChip"); the engine item table is keyed by display
// name ("Armor Chip"). itemForDropName (web/drop-item.js) bridges them so no drop is discarded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ITEM_BY_ID, ITEM_BY_NAME } from "../web/vendor/engine.js";
import { itemForDropName } from "../web/drop-item.js";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const enemies = read("web/assets/data/enemies.json").enemies;
const catalog = read("web/assets/data/items.json").catalog;
const names = [...new Set((Array.isArray(enemies) ? enemies : Object.values(enemies))
  .map((e) => e.drop_item).filter((n) => n && n !== "Null"))];

test("all 78 distinct drop names resolve to the catalog id", () => {
  assert.equal(names.length, 78);
  const idOf = new Map(catalog.map((c) => [c.name, c.id]));
  for (const n of names) {
    const item = itemForDropName(n, ITEM_BY_NAME, ITEM_BY_ID);
    assert.ok(item, n);
    assert.equal(item.id, idOf.get(n), n);
  }
});

test("Null, empty and unknown names give null", () => {
  for (const n of ["Null", "", null, undefined, "NoSuchItemXyz"])
    assert.equal(itemForDropName(n, ITEM_BY_NAME, ITEM_BY_ID), null);
});

test("an exact display name still wins", () => {
  assert.equal(itemForDropName("Armor Chip", ITEM_BY_NAME, ITEM_BY_ID), ITEM_BY_NAME["Armor Chip"]);
});

test("every drop site uses the resolver, none index ITEM_BY_NAME by a drop name", () => {
  for (const f of ["web/battle.js", "web/game.js"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /itemForDropName/, f);
    assert.doesNotMatch(src, /ITEM_BY_NAME\??\.?\[(dropName|firstDrop|opts\.droppedItem)\]/, f);
    assert.doesNotMatch(src, /itemTable\??\.?\[(firstDrop|name)\]/, f);
  }
});
