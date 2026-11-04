// The Battlefields tab: where each stage fights, and which move changes the world.
//
// One half answers "where does this place fight": every one of the 202 stages that
// carries fights, its own map name, and the arena its battles use — the stage's
// `_default` plus the per-battle-screen overrides — so "this forest fights in arena
// 17" is one line. The other half answers "which move changes the world": the 17
// backdrop packs under web/assets/battle/backdrops (16 element worlds plus the data
// fallback), the 52 techniques that summon one, and the 391 that fight in the
// ordinary arena.
//
// No table is invented here: every number is read from the manifests the battle
// itself loads (web/assets/battle/arenas/manifest.json,
// web/assets/battle/backdrops/manifest.json, web/assets/data/fight_tech_table.json,
// web/assets/manifest.json's map names, web/assets/data/digimon.json's technique
// names). F2 -> Extras -> "Digimon Codex (new)" is off by default; with it off the
// tab does not exist and nothing is fetched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ORDINARY_ARENA_LABEL,
  stageRows,
  noFightRows,
  arenaRows,
  backdropRows,
  techBackdrop,
  ordinaryCount,
  backdropFacts,
  battlefieldRows,
} from "../web/battlefields.js";
import {
  codexReset,
  setCodexData,
  setBattlefieldsData,
  codexLoadBattlefields,
  tickCodex,
  codexOpen,
  codexTab,
  codexPageCount,
  codexPageRows,
  codexRows,
  codexCursor,
  codexPress,
  codexDraw,
} from "../web/codex.js";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const arenas = read("web/assets/battle/arenas/manifest.json");
const backdrops = read("web/assets/battle/backdrops/manifest.json");
const techTable = read("web/assets/data/fight_tech_table.json");
const manifest = read("web/assets/manifest.json");
const digimon = read("web/assets/data/digimon.json");
const skills = digimon.skills;

test("the 202 fighting stages: each one's map name, default arena and per-screen overrides", () => {
  const rows = stageRows({ arenas, maps: manifest });
  assert.equal(rows.length, 202, "every stage the arena manifest lists carries fights");

  const s200 = rows.find((r) => r.stage === "s200");
  assert.ok(s200, "stage 200 is in the table");
  assert.equal(s200.name, "Central Sector — Asuka City", "the manifest's own map name");
  assert.equal(s200.defaultArena, 18, "the stage's _default arena");
  assert.deepEqual(s200.screens, { 188: 18, 200: 18, 272: 20 }, "the three per-screen overrides");

  const mapIds = new Set(manifest.maps.map((m) => m.id));
  const orphans = rows.filter((r) => !mapIds.has(r.stage));
  assert.deepEqual(orphans.map((r) => r.stage), [], "every fighting stage has a map record (no invented names)");

  const arenaIds = new Set(Object.keys(arenas.byArena).map(Number));
  // The arena table covers 1..29; the tournament map is the one fighting stage that
  // names another arena (s927, Amaterasu City — Digimon Arena, arena 47). It is
  // printed as arena 47, never coerced into the 29 or given an invented pack.
  const outside = rows.filter((r) => !arenaIds.has(r.defaultArena));
  assert.deepEqual(outside.map((r) => [r.stage, r.defaultArena]), [["s927", 47]]);
  const arenaIdsInScreens = new Set(Object.values(rows.flatMap((r) => Object.values(r.screens))));
  assert.deepEqual([...arenaIdsInScreens].filter((id) => !arenaIds.has(id)), [47],
    "screen overrides name only the 29 arenas, except the arena map's own 47");

  const noDefault = rows.filter((r) => !Object.prototype.hasOwnProperty.call(arenas.byStage[r.stage.slice(1)], "_default"));
  assert.deepEqual(noDefault.map((r) => r.stage), [], "every fighting stage names a default");
});

test("the 92 maps that never fight are listed as \"no ordinary arena\"", () => {
  const rows = noFightRows({ arenas, maps: manifest });
  assert.equal(manifest.maps.length - 202, 92, "294 map records, 202 with an arena table");
  assert.equal(rows.length, 92);
  assert.equal(ORDINARY_ARENA_LABEL, "no ordinary arena");
  for (const row of rows) {
    assert.equal(row.label, "no ordinary arena");
    assert.equal(row.arena, null, "no arena is invented for a map without one");
  }
  assert.equal(new Set([...stageRows({ arenas, maps: manifest }), ...rows].map((r) => r.stage)).size, 294,
    "the 202 + 92 rows account for every map exactly once");
});

test("the 29 arenas: their pack and their own background colour and CLUT count", () => {
  const rows = arenaRows({ arenas });
  assert.equal(rows.length, 29);
  assert.equal(rows[0].id, 1);
  assert.deepEqual(rows[0], { id: 1, pack: "meft1001", bg: [56, 112, 232], clutTextures: 4 });
  assert.deepEqual(rows[3], { id: 4, pack: "meft1004", bg: [80, 104, 184], clutTextures: 6 });
  assert.equal(rows.find((r) => r.id === 18).pack, "meft1018");
  assert.deepEqual(rows.map((r) => r.id), Array.from({ length: 29 }, (_, i) => i + 1), "arena ids run 1..29");
});

test("the 17 backdrop packs: 16 element worlds plus the data fallback", () => {
  const rows = backdropRows({ backdrops, techTable, skills });
  assert.deepEqual(rows.map((r) => r.sig), [0, 33, 34, 36, 37, 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 53, 54],
    "exactly the manifest's 17 sig keys, in order");

  const data = rows.find((r) => r.sig === 0);
  assert.equal(data.pack, "meft1055");
  assert.equal(data.element, "data");
  assert.equal(data.sound, -1, "the data fallback plays no sound cue");
  assert.equal(data.fallback, true);
  assert.deepEqual(data.techs, [], "the fallback is not summoned by a technique");

  const fire = rows.find((r) => r.sig === 33);
  assert.equal(fire.pack, "meft1033");
  assert.equal(fire.element, "fire");
  assert.equal(fire.sound, 0);
  assert.deepEqual(fire.techs.map((t) => t.id), [105, 137, 138, 141, 142], "the five fire moves that summon it");

  const normal = rows.find((r) => r.sig === 54);
  assert.equal(normal.pack, "meft1054");
  assert.equal(normal.element, "normal");

  assert.equal(rows.filter((r) => r.element !== "data").length, 16, "16 element packs");
  assert.equal(rows.filter((r) => r.fallback).length, 1, "one data fallback");
  const packs = new Set(Object.values(backdrops.bySig).map((b) => b.pack));
  for (const row of rows) assert.ok(packs.has(row.pack), `${row.pack} is the manifest's own pack`);
});

test("the 52 summoning techniques: the same 52 in both tables, and one lookup by id", () => {
  const specialTable = Object.entries(techTable).filter(([, row]) => Number(row.sigEffect) !== 0);
  const specialByTech = Object.entries(backdrops.byTech).filter(([, sig]) => Number(sig) !== 0);
  assert.equal(specialTable.length, 52, "52 of the 443 techniques carry a signature effect");
  assert.deepEqual(
    new Set(specialTable.map(([id]) => id)),
    new Set(specialByTech.map(([id]) => id)),
    "the two tables name exactly the same 52 techniques",
  );

  assert.deepEqual(techBackdrop(backdrops, techTable, 105), { pack: "meft1033", element: "fire", sound: 0 });
  assert.deepEqual(techBackdrop(backdrops, techTable, 106), { pack: "meft1034", element: "fire", sound: 0 });
  assert.equal(techBackdrop(backdrops, techTable, 53), null, "Hot Head has no signature effect: the ordinary arena");
  assert.equal(techBackdrop(backdrops, techTable, 9999), null, "an unknown technique never invents a backdrop");
  assert.equal(skills.find((s) => s.id === 105).name, "Heat Cutter", "the ids are the card's own techniques");
  assert.equal(skills.find((s) => s.id === 106).name, "Burn Slash");
  assert.equal(skills.find((s) => s.id === 53).name, "Hot Head");
});

test("391 of the 443 techniques fight in the ordinary arena; 130 of the 182 listed rows are zero", () => {
  assert.equal(ordinaryCount(techTable), 391);
  assert.equal(Object.keys(techTable).length - ordinaryCount(techTable), 52);
  const facts = backdropFacts({ backdrops, techTable });
  assert.equal(facts.packs, 17);
  assert.equal(facts.elementPacks, 16);
  assert.equal(facts.techs, 443, "the technique table's own row count");
  assert.equal(facts.specialTechs, 52);
  assert.equal(facts.ordinaryTechs, 391);
  assert.equal(facts.listedTechs, 182, "the backdrop table lists 182 techniques");
  assert.equal(facts.zeroListed, 130, "130 of them carry sig 0, the ordinary arena");
});

test("the tab's own list: 202 stages, 92 no-fight maps, 29 arenas, 17 worlds, each typed", () => {
  const rows = battlefieldRows({ arenas, backdrops, techTable, skills, maps: manifest });
  assert.equal(rows.length, 202 + 92 + 29 + 17);
  assert.deepEqual(rows.slice(0, 202).map((r) => r.kind).filter((k, i, a) => k !== a[i - 1]), ["stage"]);
  assert.equal(rows[202].kind, "map");
  assert.equal(rows[202].label, "no ordinary arena");
  assert.equal(rows[294].kind, "arena");
  assert.equal(rows[294].id, 1);
  assert.equal(rows[323].kind, "world");
  assert.equal(rows[323].sig, 0);
  const stage = rows.find((r) => r.stage === "s200");
  assert.equal(stage.defaultArena, 18);
  assert.deepEqual(stage.screens, { 188: 18, 200: 18, 272: 20 });
});

// ---------------------------------------------------------------- the Codex tab

/** A recording 2D context: enough of the canvas API for codexDraw, and a text log. */
function fakeCtx() {
  const calls = [];
  return {
    calls,
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect() { calls.push(["fillRect"]); },
    strokeRect() { calls.push(["strokeRect"]); },
    fillText(text) { calls.push(["fillText", String(text)]); },
    set font(v) {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    set textBaseline(v) {}, set textAlign(v) {},
  };
}
const drawnText = (ctx) => ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1]).join("\n");

/** The fake fetch: the real extracted tables, recorded by URL, no network. */
function fakeFetch(log = []) {
  const tables = {
    "assets/battle/arenas/manifest.json": arenas,
    "assets/battle/backdrops/manifest.json": backdrops,
    "assets/data/fight_tech_table.json": techTable,
    "assets/manifest.json": manifest,
  };
  return async (url) => {
    log.push(url);
    if (!(url in tables)) throw new Error(`unexpected fetch ${url}`);
    return tables[url];
  };
}

test("with the codex switch off there is no Battlefields page and nothing is fetched", () => {
  codexReset();
  const fetched = [];
  setBattlefieldsData({ fetchJson: fakeFetch(fetched) });
  const ctx = fakeCtx();
  assert.equal(tickCodex(false), false);
  assert.equal(codexOpen(), false);
  assert.equal(codexDraw(ctx), false);
  assert.equal(ctx.calls.length, 0, "no canvas call at all");
  assert.deepEqual(fetched, [], "the tab fetched nothing while the switch was off");
});

test("first landing on the tab fetches the two battle manifests, the technique table and the maps", async () => {
  codexReset();
  const fetched = [];
  const fetchJson = fakeFetch(fetched);
  setBattlefieldsData({ fetchJson });
  setCodexData(digimon, read("web/assets/data/evolutions.json"));   // partner rows only: no book-wide load
  tickCodex(true);
  assert.equal(codexTab(), "partners");

  codexPress("r1");                       // LOADOUT (always reachable)
  codexPress("r1");                       // CLIPS
  codexPress("r1");                       // the new sixth tab
  assert.equal(codexTab(), "battlefields", "the Battlefields tab is reachable from the pad");
  assert.equal(await codexLoadBattlefields(), true, "the tab's own load lands");
  assert.deepEqual(fetched, [
    "assets/battle/arenas/manifest.json",
    "assets/battle/backdrops/manifest.json",
    "assets/data/fight_tech_table.json",
    "assets/manifest.json",
  ], "the two battle manifests, the technique table and the manifest's map names");

  assert.equal(codexRows().length, 202 + 92 + 29 + 17);
  assert.equal(codexPageCount(), 15, "340 rows over pages of 24");
  assert.equal(codexPageRows()[0].stage, "s200");
  assert.equal(codexPageRows()[0].name, "Central Sector — Asuka City");
  assert.equal(codexPageRows()[0].defaultArena, 18);
  assert.deepEqual(codexPageRows()[0].screens, { 188: 18, 200: 18, 272: 20 });
  const stages = codexRows().filter((r) => r.kind === "stage");
  assert.equal(stages.length, 202);
  assert.ok(stages.every((r) => Number.isFinite(r.defaultArena)), "every fighting stage names its arena");

  const ctx = fakeCtx();
  assert.equal(codexDraw(ctx), true);
  const text = drawnText(ctx);
  assert.match(text, /BATTLEFIELDS/, "the page says which tab it is");
  assert.match(text, /s200/);
  assert.match(text, /Central Sector — Asuka City/);
  assert.match(text, /arena 18/);
  assert.match(text, /meft1018/);
  assert.match(text, /188→18/, "the per-screen overrides are one line");
  assert.match(text, /272→20/);
  assert.match(text, /202/, "the fighting-stage count");
  assert.match(text, /92/, "the maps with no arena");
  assert.match(text, /ordinary arena/, "the plain fact the card asks for");
  assert.match(text, /391/);
  assert.match(text, /130/);
  assert.match(text, /182/);
  assert.ok(!text.includes("PARTNERS — every form"), "the partner page is not drawn underneath");
  codexPress("cross");
  assert.equal(codexOpen(), false);
});

test("when the book already read the map names the tab reuses them (no second 928 KB read)", async () => {
  codexReset();
  const fetched = [];
  setBattlefieldsData({ fetchJson: fakeFetch(fetched) });
  setCodexData(digimon, read("web/assets/data/evolutions.json"), null, null, { maps: manifest });
  assert.equal(await codexLoadBattlefields(), true);
  assert.deepEqual(fetched, [
    "assets/battle/arenas/manifest.json",
    "assets/battle/backdrops/manifest.json",
    "assets/data/fight_tech_table.json",
  ], "only the two battle manifests and the technique table: the map list was already in memory");
  tickCodex(true);
  codexPress("r1");
  codexPress("r1");
  codexPress("r1");
  assert.equal(codexTab(), "battlefields");
  assert.equal(codexRows().length, 340);
});

test("Square walks the tab's four sections; the element world names the moves that summon it", async () => {
  codexReset();
  const fetchJson = fakeFetch([]);
  setBattlefieldsData({ fetchJson });
  setCodexData(digimon, read("web/assets/data/evolutions.json"));
  tickCodex(true);
  codexPress("r1");
  codexPress("r1");
  codexPress("r1");
  await codexLoadBattlefields();

  // the tab opens on the 202 fighting stages
  assert.equal(codexPageRows()[codexCursor()].kind, "stage");
  codexPress("square");
  assert.equal(codexPageRows()[codexCursor()].kind, "map", "then the 92 maps with no ordinary arena");
  codexPress("square");
  assert.equal(codexPageRows()[codexCursor()].kind, "arena");
  assert.equal(codexPageRows()[codexCursor()].id, 1);
  codexPress("square");
  assert.equal(codexPageRows()[codexCursor()].kind, "world");
  assert.equal(codexPageRows()[codexCursor()].sig, 0, "the data fallback comes first");
  codexPress("square");
  assert.equal(codexPageRows()[codexCursor()].kind, "stage", "the ring wraps back to the stages");

  // walk to the first element world: fire pack 33, the five fire moves
  codexPress("square");
  codexPress("square");
  codexPress("square");                   // world section, sig 0
  codexPress("down");                     // sig 33, fire
  assert.equal(codexPageRows()[codexCursor()].sig, 33);
  assert.equal(codexPageRows()[codexCursor()].pack, "meft1033");
  const ctx = fakeCtx();
  codexDraw(ctx);
  const text = drawnText(ctx);
  assert.match(text, /FIRE|fire/, "the world's own element");
  assert.match(text, /meft1033/);
  assert.match(text, /Heat Cutter/);
  assert.match(text, /Flame Ball/);
  assert.match(text, /sound 0/, "the pack's own sound cue");
  assert.match(text, /ordinary arena/);
  codexPress("cross");
});

test("without the technique table the page says so instead of inventing move counts", () => {
  codexReset();
  // The two battle manifests and the map names are here; the technique table and the
  // skill names are not.
  setBattlefieldsData({ arenas, backdrops, maps: manifest });
  tickCodex(true);
  codexPress("r1");
  codexPress("r1");
  codexPress("r1");
  assert.equal(codexTab(), "battlefields");
  assert.equal(codexRows().length, 202 + 92 + 29 + 17, "the arenas and the worlds still list");

  const ctx = fakeCtx();
  codexDraw(ctx);
  const stageText = drawnText(ctx);
  assert.doesNotMatch(stageText, /0 of the 443/, "no move count is printed when the table did not load");
  assert.doesNotMatch(stageText, /the other 0 fight/, "no 443 - 0 arithmetic either");
  assert.match(stageText, /technique\s+table\s+did\s+not\s+load/, "the page says what is missing (the text may wrap)");

  codexPress("square");
  codexPress("square");
  codexPress("square");                   // the world section, sig 0 (the data fallback)
  const worldCtx = fakeCtx();
  codexDraw(worldCtx);
  const worldText = drawnText(worldCtx);
  assert.doesNotMatch(worldText, /0 of the 443/);
  assert.match(worldText, /technique\s+table\s+did\s+not\s+load/);
  assert.match(worldText, /meft1055/, "the fallback pack is still named");
  codexPress("cross");
});
