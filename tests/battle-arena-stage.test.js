// The ordinary 3-D battle paints its AREA's own arena (MEFT1001-1029), not our generated grid.
//
// The selector, decoded 2026-10-07: the field's battle-trigger record carries the arena id in
// its `param` (u16 @record+0x4); fieldstg fn 0x800925a8 (random) and fn 0x800927a0 (scripted)
// copy it into the battle descriptor at 0x80042b1c+0xc = 0x80042b28; wfightmn (:1010) builds the
// backdrop object from it; fightstg F0x80086304 indexes SFSTDATA with it, and SFSTDATA record i
// -> MEFT10<i>. So the arena pack = MEFT10<param>, ids 1..29.
//
// This test pins the shipped data, the two binding frames on the render path, and the decoded
// sky colour. It fails on the pre-change tree (no arenas family, no setArenaStage).
//
// Above:  .dw3-research/playtest-battle-arena-selector-2026-10-07/results.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARENAS = join(ROOT, "web/assets/battle/arenas");

test("the per-area arena family is extracted (MEFT1001-1029)", () => {
  const man = JSON.parse(readFileSync(join(ARENAS, "manifest.json"), "utf8"));
  assert.equal(Object.keys(man.byArena).length, 29, "29 stage packs");
  for (let i = 1; i <= 29; i++) {
    const a = man.byArena[String(i)];
    assert.ok(a && a.pack === `meft10${String(i).padStart(2, "0")}`, `arena ${i} pack`);
    for (const f of ["floor.png", "wall.png", "geometry.json"]) {
      const p = join(ARENAS, a.pack, f);
      assert.ok(existsSync(p) && statSync(p).size > 0, `${a.pack}/${f} present`);
    }
    const g = JSON.parse(readFileSync(join(ARENAS, a.pack, "geometry.json"), "utf8"));
    assert.ok((g.groups || []).length > 0, `${a.pack} has geometry groups`);
  }
});

test("the trigger `param` is the arena id: stage -> arena from each wstag's own records", () => {
  const man = JSON.parse(readFileSync(join(ARENAS, "manifest.json"), "utf8"));
  // Central Park (s330) is grassland -> arena 1 (MEFT1001); West Wire Forest (s350) -> 13.
  assert.equal(man.byStage["330"]._default, 1, "s330 default arena 1");
  assert.equal(man.byStage["350"]._default, 13, "s350 default arena 13");
  // A screen that is itself a trigger record resolves to that record's param.
  assert.equal(man.byStage["200"]["200"], 18, "s200 Genji record param 18");
  assert.ok(man.byStage["355"]["34"] === 13, "s355 Wire Forest record param 13");
});

test("the arena view's sky is the SFSTDATA colour (record 1 = the captured grassland sky)", () => {
  const man = JSON.parse(readFileSync(join(ARENAS, "manifest.json"), "utf8"));
  // The rig frame's sky is the SFSTDATA param's bytes with the low THREE bits dropped — the GPU
  // shows 5 bits per channel — so it is exactly (56,112,232). MEASURED 2026-10-07: the captured
  // grassland frame holds 20436 pixels of (56,112,232) and 0 of the full param byte (59,115,233),
  // and arena 13's likewise (96,88,200) 19220 px vs (101,88,206) 0 px.
  assert.deepEqual(man.byArena["1"].bg, [56, 112, 232], "MEFT1001 sky colour");
  // Element-effect records are the near-black void, not a sky.
  assert.deepEqual(man.byArena["28"].bg, [0, 0, 0]);
});

test("the render path wires the arena: setArenaStage, the draw branch, and the battle.js join", () => {
  const b3d = readFileSync(join(ROOT, "web/battle3d.js"), "utf8");
  assert.match(b3d, /function setArenaStage\(/, "battle3d exposes setArenaStage");
  assert.match(b3d, /assets\/battle\/arenas\/manifest\.json/, "battle3d loads the arena manifest");
  assert.match(b3d, /arenaActive/, "battle3d draws the arena branch");
  const battle = readFileSync(join(ROOT, "web/battle.js"), "utf8");
  assert.match(battle, /renderer3d\.setArenaStage\?\.\(b\.mapId, b\.screenId\)/,
    "battle.js hands the arena its area + encounter");
});

test("extract_backdrops.pack_meshes hands decode_mesh a Path, not raw bytes", () => {
  // The 2026-10-06 switch of decode_mesh to the Node port made a bytes argument fail loudly
  // (subprocess argv of a bytes repr); the fix is required for ANY pack extraction.
  const src = readFileSync(join(ROOT, "tools/extract_backdrops.py"), "utf8");
  assert.match(src, /decode_mesh\(pdir \/ f"\{mi\}\.bin"\)/);
  assert.doesNotMatch(src, /decode_mesh\(\(pdir \/ f"\{mi\}\.bin"\)\.read_bytes\(\)\)/);
});
