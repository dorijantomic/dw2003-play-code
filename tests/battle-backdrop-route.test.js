// The 3-D battle backdrop route: the packs we extract are the per-ELEMENT special-attack
// backdrops, NOT the per-army battle STAGE backdrops, and the ordinary arena is generated in
// code. This is a PINNING test for operator item 19 (playtest 2026-10-07) and for the answer
// recorded in .dw3-research/playtest-battle-backdrops-2026-10-07/results.md.
//
// Why pin it: the brief for that item assumed the 17 packs under web/assets/battle/backdrops/
// were the original per-area backdrops, so the "fix" would have been to draw one as the arena.
// That is wrong twice over:
//
//   1. FAMILY. The developers' battle scene test (pro/wfightts.s) labels a 55-pack range
//      MFSTG001-029 then MEFT0030-0055 (docs/research/battle/scene-test-tool-wfightts-2026-08-05.md,
//      ledger 112557). Against SFSTDATA i -> MEFT10<i> that is MEFT1001-1029 = battle STAGE
//      packs (the per-area arenas) and MEFT1030-1055 = battle EFFECT packs (signatures).
//   2. ROUTE. web/battle3d.js loads a pack ONLY for a special attack: a basic attack is absent
//      from the manifest's byTech and resolves to null. The pack's meshes draw under `dfActive`
//      and the generated floor draws only when NOT dfActive -- the two never share a frame, so
//      the generated floor cannot be "overriding" a loaded pack.
//
// If a later pass ships the STAGE packs and a decoded selector, the generated-floor comment and
// the `dfActive` branches in web/battle3d.js are the lines this test watches, and it will fail
// loudly rather than let the old claim stand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const battle3d = readFileSync(resolve("web/battle3d.js"), "utf8");
const manifest = JSON.parse(
  readFileSync(resolve("web/assets/battle/backdrops/manifest.json"), "utf8"));

test("the extracted packs are the per-element EFFECT backdrops, not the per-area arena", () => {
  assert.match(manifest.note, /special-attack backdrop/i,
    "the manifest must name these as special-attack backdrops; if it ever says 'stage' or " +
    "'area', this family was re-identified and the route must be re-read");
  // Every bySig entry carries an ELEMENT label, never an area/place name.
  const ELEMENTS = new Set(["fire", "water", "ice", "wind", "thunder", "machine", "dark", "normal", "data"]);
  const sigs = Object.keys(manifest.bySig);
  assert.ok(sigs.length >= 15, `expected the element packs, found ${sigs.length}`);
  for (const sig of sigs) {
    const e = manifest.bySig[sig].element;
    assert.ok(ELEMENTS.has(e),
      `bySig[${sig}].element = ${JSON.stringify(e)} is not an element label; the 17 packs are ` +
      "keyed by tech.sigEffect, so a place name here would mean the family changed meaning");
  }
});

test("the STAGE/EFFECT split is recorded where the arena floor is built", () => {
  // The claim the brief made -- that there is no authentic floor art -- was falsified; the
  // disc's stage arenas are MEFT1001-1029. The comment that carries the correction is here.
  assert.match(battle3d, /MEFT1001-1029 = battle STAGE packs/,
    "web/battle3d.js no longer records that MEFT1001-1029 are the per-area STAGE packs; the " +
    "generated floor would then be read as the whole truth again");
  assert.match(battle3d, /MEFT1030-1055 = battle EFFECT packs/,
    "web/battle3d.js no longer records that the 17 extracted packs are EFFECT packs");
});

test("a basic attack selects no EFFECT pack, and the three arena branches stay exclusive", () => {
  // The manifest's byTech starts at the element sigs; a basic tech id is absent, so
  // backdropEntryForTech returns null (no EFFECT backdrop swap) -- an ordinary attack.
  const basicIds = ["1", "2", "3"];
  for (const id of basicIds) {
    assert.equal(manifest.byTech[id], undefined,
      `tech ${id} is in byTech; if a basic tech gained an EFFECT pack the 'basic attacks keep ' +
      'the normal arena' invariant would be gone`);
  }
  // UPDATE 2026-10-07 (this test failing loudly is what it was written for): the STAGE family
  // MEFT1001-1029 shipped and the selector was decoded -- a battle's arena is the encounter
  // record's param -- so an ordinary attack now draws its AREA's arena. The three draw branches
  // must stay mutually exclusive: the EFFECT pack (dfActive), the void (dnaVoidActive), the
  // AREA arena (arenaActive), and only then the generated floor.
  assert.match(battle3d, /const arenaActive = !dfActive && !dnaVoidActive/,
    "web/battle3d.js no longer derives arenaActive from !dfActive && !dnaVoidActive; the area " +
    "arena would then compete with the effect pack or the void");
  assert.match(battle3d, /if \(!dfActive && !dnaVoidActive && !arenaActive\)\s*\n\s*drawQuad\(gl, texP, pv, floorBufs, arenaTexture/,
    "the generated arena floor is no longer gated on all three negatives; it would then compete " +
    "with a loaded pack or with the disc's own area arena");
  // And the special backdrop uses its own pack's meshes through the live camera.
  assert.match(battle3d, /drawProjLayer\(gl, texP, mvp, g, g\.page === "floor" \? activeBackdrop\.floorTex/,
    "the per-element backdrop draw changed shape; re-read the route before trusting this test");
  // The area arena draws its own meshes over the disc's sky colour read from the record.
  assert.match(battle3d, /setArenaStage/,
    "the area-arena entry point is gone; item 19's fix would have been reverted");
  assert.match(battle3d, /arenaBg/,
    "the arena's own background colour (the record's +0x0c sky) is no longer painted");
});
