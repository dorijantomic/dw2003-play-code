// The Digimon Codex, part 4: the drop finder (web/codex.js).
//
// Pick an item and the page lists every enemy that really drops it, the disc's own
// odds and every stage pool where each of those enemies can be met. The odds are the
// disc's, not a percentage: a rate byte of 128 means (128 + 1) in 1024 per win, so
// the page prints "129 in 1024", never "12.8%". The browser's own roll
// (web/battle.js) is not touched by this tab at all.
//
// The enemies are the 194 records of enemies.json minus the one `Null` placeholder;
// the 92 real ones that name an item name 78 distinct items. The stage pools are the
// same stage_encounters.json + field_encounters.json join part 3 reads (a row there is
// a real roll), and items.json (`catalog` 402 key items + `items` 83 consumables) is
// the name source, so all 78 drop names resolve.
//
// F2 -> Extras -> "Digimon Codex (new)" (off by default), seventh tab. With the toggle
// off there is no tab, no index and no fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dropIndex,
  dropOdds,
  dropItems,
  dropEntry,
  dropSearch,
  itemByName,
  enemyStages,
  encounterIndex,
  codexReset,
  setCodexData,
  setBattlefieldsData,
  codexLoad,
  tickCodex, openCodex,
  codexOpen,
  codexTab,
  codexRows,
  codexPageCount,
  codexPageRows,
  codexCursor,
  codexPress,
  codexDraw,
} from "../web/codex.js";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const enemyFile = read("web/assets/data/enemies.json");
const itemsFile = read("web/assets/data/items.json");
const stageFile = read("web/assets/data/stage_encounters.json");
const fieldFile = read("web/assets/data/field_encounters.json");
const manifest = read("web/assets/manifest.json");
const digimon = read("web/assets/data/digimon.json");
const evolutions = read("web/assets/data/evolutions.json");

const index = encounterIndex(stageFile, fieldFile, manifest);
const drops = dropIndex(enemyFile, index);

/** A recording 2D context: enough of the canvas API for codexDraw, and a text log. */
function fakeCtx() {
  const calls = [];
  const ctx = {
    calls,
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect() { calls.push(["fillRect"]); },
    strokeRect() { calls.push(["strokeRect"]); },
    fillText(text) { calls.push(["fillText", String(text)]); },
    set font(v) {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    set textBaseline(v) {}, set textAlign(v) {},
  };
  return ctx;
}
const drawnText = (ctx) => ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1]).join("\n");

test("92 real enemies carry a drop and name 78 items; the Null placeholder and every Cardmon row are not droppers", () => {
  const droppers = [...drops.byItem.values()].flatMap((entry) => entry.droppers);
  assert.equal(droppers.length, 92, "one dropper row per real enemy that names an item");
  assert.equal(drops.byItem.size, 78, "78 distinct items");
  assert.equal(dropItems(drops).length, 78);
  assert.equal(new Set(droppers.map((d) => d.enemy)).size, 92, "no enemy is listed twice");

  // The table really carries the rows the index must skip.
  assert.equal(enemyFile.enemies.filter((e) => e.enemy_id === "Null").length, 1);
  assert.equal(enemyFile.enemies.filter((e) => /^Cardmon\d*$/.test(e.enemy_id)).length, 8);
  assert.ok(!drops.byItem.has("Null"), "the Null placeholder is never an item");
  assert.ok(!droppers.some((d) => d.enemy === "Null"));
  assert.ok(!droppers.some((d) => /^Cardmon/.test(d.enemy)), "no Cardmon row drops anything");

  // A bare array is the same table.
  const fromArray = dropIndex(enemyFile.enemies, index);
  assert.equal(fromArray.byItem.size, 78);
});

test("the disc's six drop rates, and dropOdds keeps the '+1 in 1024' the page prints", () => {
  const rates = [...new Set([...drops.byItem.values()].flatMap((e) => e.droppers.map((d) => d.rate)))].sort((a, b) => a - b);
  assert.deepEqual(rates, [16, 32, 64, 128, 192, 256], "the only rate bytes a real drop uses");
  assert.deepEqual(dropOdds(128), { n: 129, of: 1024 }, "128 means 129 rolls in 1024, not 12.8%");
  assert.deepEqual(dropOdds(0), { n: 1, of: 1024 }, "the disc adds one to the rate byte");
  assert.deepEqual(dropOdds(256), { n: 257, of: 1024 });
  for (const d of [...drops.byItem.values()].flatMap((e) => e.droppers)) {
    assert.deepEqual(d.odds, { n: d.rate + 1, of: 1024 }, `${d.enemy}'s odds are its own rate + 1`);
  }
});

test("CrimsonCable has exactly five droppers, all at 129 in 1024", () => {
  const entry = dropEntry(drops, "CrimsonCable");
  assert.ok(entry, "CrimsonCable is a real dropped item");
  assert.deepEqual(
    entry.droppers.map((d) => d.enemy),
    ["Whamon", "Pukumon", "MetalSeadramon", "Tylomon", "Scorpiomon"],
    "the five enemies enemies.json names",
  );
  assert.ok(entry.droppers.every((d) => d.rate === 128 && d.odds.n === 129 && d.odds.of === 1024));
  // The item's stage list is the union of its droppers' real pools.
  assert.deepEqual(
    entry.stages,
    [351, 396, 401, 446, 521, 646, 691, 706, 756, 795, 800, 805, 954, 963, 964, 967],
  );
  assert.equal(dropEntry(drops, "crimsoncable").droppers.length, 5, "item lookup ignores case");
});

test("Whamon's pool rows land on six stages: 446, 756, 800, 805, 954, 967", () => {
  const rows = index.bySpecies.get("Whamon");
  assert.ok(rows, "Whamon is in the encounter pools");
  assert.equal(rows.length, 9, "nine real slots can roll it");
  const stages = [...new Set(rows.map((r) => r.stage))].sort((a, b) => a - b);
  assert.deepEqual(stages, [446, 756, 800, 805, 954, 967]);
  assert.deepEqual(enemyStages(index, "Whamon"), [446, 756, 800, 805, 954, 967]);
  assert.deepEqual(enemyStages(index, "NoSuchmon"), [], "an enemy with no pool has no stages");
  // Whamon drops exactly one item, and that item's dropper row points back at those stages.
  const whamonItem = dropEntry(drops, "CrimsonCable").droppers.find((d) => d.enemy === "Whamon");
  assert.equal(whamonItem.rate, 128);
});

test("all 78 drop names resolve in items.json; an invented item is nothing at all", () => {
  const names = dropItems(drops);
  assert.equal(names.length, 78);
  assert.equal(names.filter((name) => itemByName(itemsFile, name)).length, 78, "78/78 names resolve");
  const crimson = itemByName(itemsFile, "CrimsonCable");
  assert.equal(crimson.id, 85);
  assert.equal(crimson.category, "consumable");
  assert.equal(itemByName(itemsFile, "NoSuchItem"), null, "an invented item is null");
  assert.deepEqual(dropSearch(drops, "NoSuchItem"), [], "and the finder returns nothing");
  assert.equal(dropSearch(drops, "crimsoncable").length, 1, "an exact name (any case)");
  assert.ok(dropSearch(drops, "Power").length > 1, "a partial name lists the family");
  assert.ok(!/localStorage/.test(readFileSync("web/codex.js", "utf8")), "the tab stores nothing");
});

test("with the codex switch off there is no drop tab, no index and the pad falls through untouched", () => {
  codexReset();
  const ctx = fakeCtx();
  assert.equal(tickCodex(false), false);
  assert.equal(codexOpen(), false);
  assert.equal(codexRows().length, 0, "no index before the book opens");
  assert.equal(codexPress("r1"), false, "a closed book swallows no press");
  assert.equal(codexDraw(ctx), false);
  assert.equal(ctx.calls.length, 0, "no canvas call at all");
});

test("opening the book reads items.json; the DROPS tab lists 78 items and CrimsonCable's real droppers, odds and stages", async () => {
  codexReset();
  const fetched = [];
  const fakeFetch = async (url) => {
    fetched.push(url);
    if (/data\/items\.json/.test(url)) return itemsFile;
    if (/data\/enemies\.json/.test(url)) return enemyFile;
    if (/data\/stage_encounters\.json/.test(url)) return stageFile;
    if (/data\/field_encounters\.json/.test(url)) return fieldFile;
    if (/data\/evolutions\.json/.test(url)) return evolutions;
    if (/battle\/model_map\.json/.test(url)) return {};
    if (/^assets\/manifest\.json$/.test(url)) return manifest;
    return {};   // the battle manifests: the tab that asks for them is not this one
  };
  setBattlefieldsData({ fetchJson: fakeFetch });
  assert.equal(await codexLoad(fakeFetch), true);
  assert.ok(fetched.includes("assets/data/items.json"), "items.json rides the book's own load");
  assert.equal(fetched.length, 8, "one read each, no second switch");

  openCodex();
  assert.equal(codexTab(), "partners", "the book still opens on the partner pages");
  for (let i = 0; i < 8 && codexTab() !== "drops"; i++) codexPress("r1");
  assert.equal(codexTab(), "drops", "the seventh tab of the same book");
  assert.equal(codexRows().length, 78, "one entry per really dropped item");
  assert.equal(codexPageCount(), 4, "78 items over pages of 24");
  assert.equal(codexPageRows()[0].item, "ArmorChip", "items are listed by name");
  assert.equal(codexCursor(), 0);

  const at = codexRows().findIndex((entry) => entry.item === "CrimsonCable");
  assert.ok(at >= 0);
  for (let i = 0; i < at; i++) codexPress("down");
  assert.equal(codexCursor(), at);
  assert.equal(codexPageRows()[codexCursor()].item, "CrimsonCable");

  const ctx = fakeCtx();
  assert.equal(codexDraw(ctx), true);
  const text = drawnText(ctx);
  assert.match(text, /DROPS/, "the page says which tab it is");
  assert.match(text, /CrimsonCable/);
  assert.match(text, /consumable #85/, "the item's own record from items.json");
  assert.match(text, /5 droppers/);
  for (const enemy of ["Whamon", "Pukumon", "MetalSeadramon", "Tylomon", "Scorpiomon"]) {
    assert.match(text, new RegExp(enemy), `the page names ${enemy}`);
  }
  assert.match(text, /129 in 1024 per win/, "the disc's own odds, not a percentage");
  assert.match(text, /not 12\.8%/, "the sentence the card asks for");
  assert.match(text, /met on 446, 756, 800, 805, 954, 967/, "Whamon's six stages");
  assert.match(text, /EVERY STAGE POOL \(16 stages\)/, "the union of the five droppers' pools");
  assert.match(text, /78 items the disc really drops/);
  assert.match(text, /1 \/ 4/);
  assert.ok(!text.includes("PARTNERS — every form"), "the partner page is not drawn underneath");
  assert.doesNotMatch(text, /Kunemon|Airdramon/, "no other tab's rows leak in");

  codexPress("cross");
  assert.equal(codexOpen(), false);
});

test("the drop finder rides the part-1 switch and leaves battle.js's own roll alone", () => {
  const ambience = readFileSync("web/ambience.js", "utf8");
  assert.equal((ambience.match(/\["codex",/g) ?? []).length, 1, "part 4 adds no second F2 key");
  const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\]/);
  assert.ok(/\"codex\"/.test(experimental[1]), "the book starts off until switched on");

  const codex = readFileSync("web/codex.js", "utf8");
  assert.match(codex, /window\.__codex/);
  assert.match(codex, /dropIndex/);
  assert.ok(!/window\.__fx/.test(codex), "the book never reads the switch itself");

  const game = readFileSync("web/game.js", "utf8");
  assert.match(game, /tickCodex\(window\.__fx\?\.codex === true\)/, "one switch, the part-1 gate");
  assert.match(game, /codexDraw\(ctx/);
  assert.ok(!/__fx\?\.drops|__fx\?\.codexDrops/.test(game), "part 4 adds no second key");

  const battle = readFileSync("web/battle.js", "utf8");
  assert.ok(!/codex\.js|dropIndex/.test(battle), "the browser's own drop roll is not touched");
});
