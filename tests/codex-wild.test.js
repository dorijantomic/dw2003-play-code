// The Digimon Codex, part 2: the wild pages (web/codex.js).
//
// One row per real wild record in enemies.json: name, the five core stats the record
// carries, the seven element resistances, the five status resistances, the family
// (digimon_type), the basic attack and the two special move ids with their real
// technique names, the drop item, and the record's four AI rows in plain words.
// The disc's one `Null` placeholder record is skipped, so the book lists 193 enemies,
// not 194.
//
// NOT the Steal-Factor Bestiary: this page never shows the +0x04 steal factor, and
// web/bestiary.js does not exist, so there is nothing to link to.
//
// F2 -> Extras -> "Digimon Codex (new)" (off by default), second tab. With the toggle
// off there is no page, no key handling, no fetch and no store write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  wildRows,
  wildSearch,
  dropText,
  codexReset,
  setCodexData,
  codexLoad,
  codexOpen,
  codexTab,
  codexPageCount,
  codexPageIndex,
  codexPageRows,
  codexRows,
  codexCursor,
  tickCodex, openCodex,
  codexPress,
  codexDraw,
} from "../web/codex.js";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const enemyFile = read("web/assets/data/enemies.json");
const enemies = enemyFile.enemies;
const digimon = read("web/assets/data/digimon.json");
const evolutions = read("web/assets/data/evolutions.json");
const models = read("web/assets/battle/model_map.json");

/** The fake fetchJson a node test hands codexLoad: returns the parsed tables, no network. */
const fakeFetch = async (url) => {
  if (/enemies\.json/.test(url)) return enemyFile;
  if (/model_map\.json/.test(url)) return models;
  if (/evolutions\.json/.test(url)) return evolutions;
  return digimon;
};

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

const rows = wildRows(enemies, digimon.skills, models);

test("the wild table is 193 rows: the disc's one Null placeholder is the only record skipped", () => {
  assert.equal(enemies.length, 194, "the extracted table still holds 194 records");
  assert.equal(rows.length, 193, "193 real wild records");
  const byName = new Map(rows.map((r) => [r.name, r]));
  const skipped = enemies.filter((r) => !byName.has(r.enemy_id)).map((r) => r.enemy_id);
  assert.deepEqual(skipped, ["Null"], "exactly one input row is dropped, and it is the Null placeholder");
  assert.equal(new Set(rows.map((r) => r.name)).size, 193, "no name repeats");
  assert.ok(rows.every((r) => r.number >= 1 && r.number <= 193), "every row is numbered 1..193");
});

test("Kunemon's row carries the battle's own numbers, four AI rows, and its basic attack resolves to a named skill", () => {
  const k = rows.find((r) => r.name === "Kunemon");
  assert.ok(k, "Kunemon is a wild row");
  assert.equal(k.number, 1, "Kunemon is the first record on the disc");
  assert.equal(k.family, 8, "family = digimon_type");
  assert.equal(k.stats.str, 50);
  assert.equal(k.stats.def, 42);
  assert.equal(k.stats.spt, 40);
  assert.equal(k.stats.wis, 50);
  assert.equal(k.stats.spd, 48);
  assert.deepEqual(k.resists, {
    fire: 90, water: 90, ice: 90, wind: 60, thunder: 160, machine: 90, dark: 160,
  });
  assert.deepEqual(k.status, {
    poison: 99, paralyze: 50, confuse: 50, sleep: 50, ko: 0,
  });
  assert.equal(k.drop, "Null", "the Null drop is the disc's no-item placeholder");
  assert.equal(k.model, "m032kune", "the model folder the battle draws it with");
  assert.equal(k.aiRows.length, 4, "the record always carries four AI rows");
  for (const ai of k.aiRows) {
    assert.equal(ai.action, 1);
    assert.equal(ai.comparator, 0);
    assert.equal(ai.value, 0);
  }
  assert.equal(k.attack.id, 220, "the basic attack id the record stores");
  assert.equal(k.attack.name, "Fight", "resolved through digimon.json's skills");
  assert.deepEqual(k.move1, { id: 0, name: null }, "id 0 is no technique, never a guess");
  assert.deepEqual(k.move2, { id: 0, name: null });
});

test("Numemon's row carries its real dark resist and drop, and the Numemon search finds the seven rows", () => {
  const n = rows.find((r) => r.name === "Numemon");
  assert.ok(n, "Numemon is a wild row");
  assert.equal(n.resists.dark, 280);
  // The card text said Numemon's drop is Null. The extracted record says BinderCrest at
  // rate 64; the Null drops among the Numemon family are Numemon4 and BKKingNumemon.
  assert.equal(n.drop, "BinderCrest");
  assert.equal(n.dropRate, 64);
  const found = wildSearch(rows, "Numemon");
  assert.equal(found.length, 7);
  assert.deepEqual(
    found.map((r) => r.name),
    ["Numemon", "Numemon2", "Numemon3", "Numemon4", "Numemon5", "Numemon6", "BKKingNumemon"],
  );
  assert.equal(wildSearch(rows, "numemon").length, 7, "the search ignores case");
  assert.equal(wildSearch(rows, "  numemon  ").length, 7, "and surrounding spaces");
  assert.equal(wildSearch(rows, "zzz").length, 0);
});

test("every drop is the disc's Null placeholder or one of the 78 real drop names, and no Cardmon row drops anything", () => {
  const named = new Set(rows.map((r) => r.drop).filter((d) => d !== "Null"));
  assert.equal(named.size, 78, "78 real drop items across the 193 records");
  for (const r of rows) {
    assert.ok(r.drop === "Null" || named.has(r.drop), `${r.name} drop ${r.drop} is a real item`);
    assert.equal(dropText(r), r.drop === "Null" ? "none" : r.drop);
  }
  const cardmon = rows.filter((r) => /^Cardmon\d*$/.test(r.name));
  assert.equal(cardmon.length, 8, "the eight Cardmon records are in the table");
  for (const r of cardmon) {
    assert.equal(r.drop, "Null");
    assert.equal(dropText(r), "none", "no Cardmon row shows a drop");
    assert.equal(r.dropRate, 0);
  }
});

test("all 193 real rows resolve a model folder, and the skipped Null placeholder is the only name without one", () => {
  assert.equal(Object.keys(models).length, 250, "the model map keeps 250 species");
  for (const r of rows) {
    assert.equal(typeof r.model, "string", `${r.name} resolves a model folder`);
    assert.equal(r.model, models[r.name], `${r.name}'s folder is the map's own`);
  }
  const realNames = new Set(rows.map((r) => r.name));
  const withoutModel = enemies.map((r) => r.enemy_id).filter((n) => !(n in models));
  assert.deepEqual(withoutModel, ["Null"], "the Null placeholder is the only record the map does not name");
  assert.equal(realNames.size, 193);
});

test("the wild pages ride the part-1 switch: no new key, EXPERIMENTAL, and no store write", () => {
  const ambience = readFileSync("web/ambience.js", "utf8");
  assert.ok(ambience.includes('["codex", "Digimon Codex (new)"]'), "the one Extras pair is still there");
  assert.equal((ambience.match(/\["codex",/g) ?? []).length, 1, "part 2 adds no second switch");
  const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\]/);
  assert.ok(/"codex"/.test(experimental[1]), "the book starts off until switched on");
  const codex = readFileSync("web/codex.js", "utf8");
  assert.ok(!/localStorage/.test(codex), "the book stores nothing");
});

test("with the toggle off there is no page and the pad falls through untouched", () => {
  codexReset();
  const ctx = fakeCtx();
  assert.equal(tickCodex(false), false);
  assert.equal(codexOpen(), false);
  assert.equal(codexTab(), "partners");
  assert.equal(codexPress("r1"), false, "a closed book swallows no press");
  assert.equal(codexDraw(ctx), false);
  assert.equal(ctx.calls.length, 0, "no canvas call at all");
});

test("R1 turns to the wild tab and L1 back, each tab keeping its own rows and pages", async () => {
  codexReset();
  await codexLoad(fakeFetch);
  openCodex();
  assert.equal(codexTab(), "partners", "the book opens on the partner pages");
  assert.equal(codexRows().length, 55, "the disc's partner profiles");
  assert.equal(codexPageCount(), 3, "55 partner rows over pages of 24");

  codexPress("down");
  assert.equal(codexCursor(), 1);
  assert.equal(codexPress("r1"), true);
  assert.equal(codexTab(), "wild");
  assert.equal(codexPageIndex(), 0, "the wild tab starts at its first page");
  assert.equal(codexCursor(), 0);
  assert.equal(codexRows().length, 193);
  assert.equal(codexPageCount(), 9, "193 wild rows over pages of 24");
  assert.equal(codexPageRows().length, 24);
  assert.equal(codexPageRows()[0].name, "Kunemon");
  assert.equal(codexPageRows()[23].name, "Kokatorimon", "page one is the first 24 real records");

  codexPress("right");
  assert.equal(codexPageIndex(), 1);
  codexPress("l1");
  assert.equal(codexTab(), "partners");
  assert.equal(codexPageIndex(), 0, "coming back to a tab starts at its first page");
  assert.equal(codexPageRows()[0].name, "Kotemon");
  // L1 on the first tab wraps to the last one — since both tabs were added, that is DROPS
  // (BATTLEFIELDS sits just before it, then Clips and Loadout, and the encounter finder
  // before them has no rows in this book).
  codexPress("l1");
  assert.equal(codexTab(), "drops");
  assert.equal(codexPageRows()[0].item, "ArmorChip", "the drop finder is the last tab");
  assert.equal(codexPageIndex(), 0);
  // and R1 on the last tab wraps back to PARTNERS
  codexPress("r1");
  assert.equal(codexTab(), "partners");
  codexPress("cross");
  assert.equal(codexOpen(), false);
});

test("the wild page draws real numbers and the four AI rows in plain words, the fourth named as the fallback", async () => {
  codexReset();
  await codexLoad(fakeFetch);
  openCodex();
  codexPress("r1");
  const ctx = fakeCtx();
  assert.equal(codexDraw(ctx, 0), true);
  const text = drawnText(ctx);
  assert.match(text, /WILD/, "the page says which half of the book it is");
  assert.match(text, /Kunemon/);
  assert.match(text, /Family 8/);
  assert.match(text, /STR 50/);
  assert.match(text, /SPD 48/);
  assert.match(text, /Thunder 160/);
  assert.match(text, /Dark 160/);
  assert.match(text, /Poison 99/);
  assert.match(text, /Fight \(#220\)/, "the basic attack with its real technique name");
  assert.match(text, /none \(#0\)/, "an unset special move says so instead of naming a skill");
  assert.match(text, /Drop: none/);
  assert.match(text, /FALLBACK/, "the fourth row is named as the fallback");
  assert.match(text, /no condition checked/, "and the page says its condition is never tested");
  assert.match(text, /1 \/ 9/, "the wild tab's own page counter");
  assert.ok(!text.includes("Hot Head"), "the partner page is not drawn underneath");
  tickCodex(false);
});

test("Cardmon's own page shows no drop, and the plain-words AI line names the technique the row fires", async () => {
  codexReset();
  setCodexData(digimon, evolutions, enemyFile, models);
  openCodex();
  codexPress("r1");
  const cardmonRow = codexRows().findIndex((r) => r.name === "Cardmon");
  assert.equal(cardmonRow, 182, "the eight Cardmon records sit late in the table");
  // walk the cursor to that row (Down crosses a page edge, one row per press)
  for (let i = 0; i < cardmonRow; i++) codexPress("down");
  const ctx = fakeCtx();
  codexDraw(ctx);
  const text = drawnText(ctx);
  assert.match(text, /Cardmon/);
  assert.match(text, /Drop: none/);
  assert.ok(!/Drop: Null/.test(text), "the placeholder is never printed as an item name");

  // A record whose second row fires a real technique names it in words.
  const airdramon = codexRows().find((r) => r.name === "Airdramon");
  assert.equal(airdramon.move1.id, 153);
  assert.equal(airdramon.aiRows[1].action, 2);
  assert.match(airdramon.aiRows[1].line, /special 1: Air Blast/, "action 2 is the record's own move_1");
  assert.match(airdramon.aiRows[1].condition, /every 3/, "comparator 18 is 'every Nth turn'");
  tickCodex(false);
});

test("Airdramon's page names its own special technique next to its id", async () => {
  codexReset();
  setCodexData(digimon, evolutions, enemyFile, models);
  openCodex();
  codexPress("r1");
  const at = codexRows().findIndex((r) => r.name === "Airdramon");
  assert.equal(at, 18, "Airdramon is the 19th wild record");
  for (let i = 0; i < at; i++) codexPress("down");
  const ctx = fakeCtx();
  codexDraw(ctx);
  const text = drawnText(ctx);
  assert.match(text, /Airdramon/);
  assert.match(text, /Basic: Fight \(#238\)/);
  assert.match(text, /Special 1: Air Blast \(#153\)/, "the record's move_1 with its real technique name");
  assert.match(text, /Special 2: none \(#0\)/);
  tickCodex(false);
});

test("the debug hook publishes the tab and the wild search, and game.js still gates on window.__fx?.codex", async () => {
  const src = readFileSync("web/codex.js", "utf8");
  assert.match(src, /window\.__codex/);
  assert.match(src, /tab: \(\) =>/);
  assert.match(src, /wildSearch/);
  const game = readFileSync("web/game.js", "utf8");
  assert.match(game, /tickCodex\(window\.__fx\?\.codex === true\)/, "one switch, the part-1 gate");
  assert.match(game, /codexDraw\(ctx/);
  assert.ok(!/__fx\?\.wild|__fx\?\.codexWild/.test(game), "part 2 adds no second key");
  codexReset();
  await codexLoad(fakeFetch);
  assert.equal(codexRows().length, 55, "the wild rows are not what the partner getters return");
});
