// The ~90 MEFT03xx packs are the battle's technique-effect family, not the arena's scenery.
//
// This is the negative that retires the only asset lead the 3D battle backdrop had
// (docs/research/battle/battle-stage-backdrop-decode-2026-10-04.md §7 lead 1, closed by §11.2).
// It is a PINNING test, not a port test: nothing in web/ changed, because the decode closed the
// question negatively and the gate in the work order ("if 1-3 establish the art and the selector,
// port it; if they do not, stop and report") therefore does not open.
//
// Two independent facts, both reproduced by `python3 tools/census_battle_arena_meft.py`:
//
//   1. BINDING. FIGHTSTG's op6 3D-effect registry at RAM 0x800A2550 is a flat array of 12-byte
//      records {u32 id, u32 (lba<<16)|descBin, u32 (lba<<16)|metaBin}, walked until the id is zero
//      (tools/extract_fight_effects.py). 73 of the 75 MEFT03xx packs on the disc are in it and
//      every one is keyed by its OWN pack number, so the pack is named by the effect id the
//      technique's action data carries -- a table lookup, never a `0x83C + k`. There is no
//      0x83c literal anywhere in the 321 pro/ or 17 exe .s files.
//
//   2. ART. All 75 packs were opened with the repo's own MEFT container reader. Each has exactly
//      ONE 256x256 4bpp atlas page, and on every one of those 75 pages a single index holds at
//      least 33.8% of the texels (median ~88%) -- the transparent index of a sprite sheet. A
//      painted sky, a grass ground or a rock face is a FILLED sheet, and no one flat index can
//      dominate it. Renders confirm the content: MEFT0301 is rain/smoke/shockwave, MEFT0375 is
//      cloud sheets, MEFT0378 is monster faces and teeth.
//
// So the arena's sky, cliff band and ground are NOT in this family. A future pass that wants to
// know whether that has changed must re-run the census, and these assertions fail if it has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const census = JSON.parse(
  readFileSync(resolve("docs/research/battle/data/battle-arena-meft03-census.json"), "utf8"));

test("the op6 effect registry is a 12-byte table walked to a zero id, not a base-plus-index", () => {
  assert.equal(census.registry.ram_base, 0x800a2550);
  assert.equal(census.registry.stride, 12);
  assert.equal(census.registry.terminator, "id == 0");
  assert.ok(census.registry.records > 100,
    `the registry should hold the whole effect family, found ${census.registry.records}`);
  // Every row is a complete record, and every one ends at or before the terminator.
  for (const row of census.registry.rows) {
    assert.equal(row.ram, 0x800a2550 + 12 * row.index,
      `row ${row.index} is not on the 12-byte stride`);
    assert.ok(row.id > 0 && row.lba > 0 && row.desc_bin <= 0xffff);
  }
});

test("every MEFT03xx pack the battle can name is keyed by its own pack number", () => {
  const m = census.meft03;
  assert.ok(m.packs >= 70, `expected the whole family, found ${m.packs} packs`);
  assert.equal(m.bound_by_registry, m.keyed_by_own_number,
    "a bound pack that is NOT keyed by its own number would mean the registry means something else");
  assert.equal(m.keyed_by_own_number, 73);
  // Spot-check the ends of the range, which is where a base-plus-index reading would break:
  // MEFT0301 is registry id 301 and MEFT0376 is 376, not 0x83C-offset arithmetic.
  assert.equal(census.meft03.rows.meft0301.registry_id, 301);
  assert.equal(census.meft03.rows.meft0376.registry_id, 376);
});

test("the two packs no op6 effect can name are recorded rather than quietly dropped", () => {
  const unbound = Object.entries(census.meft03.rows)
    .filter(([, v]) => v.registry_id === null)
    .map(([k]) => k)
    .sort();
  assert.deepEqual(unbound, ["meft0377", "meft0378"],
    "the family on disc and the family the registry can name must be compared, not assumed equal");
  // And the one duplicated id in the shipped data is recorded, so it is not read as two packs.
  assert.deepEqual(census.meft03.duplicate_registry_ids, [310]);
});

test("no MEFT03xx atlas page is a filled sheet, so none of them is sky, ground or rock art", () => {
  const m = census.meft03;
  assert.ok(m.min_flat_index_share_over_all_pages >= 0.30,
    `every page should leave a third of itself at one flat index; the flattest is ` +
    `${(100 * m.min_flat_index_share_over_all_pages).toFixed(1)}%`);
  for (const [name, row] of Object.entries(m.rows)) {
    assert.equal(row.atlas_pages.length, 1,
      `${name} has ${row.atlas_pages.length} atlas pages; a backdrop would carry a sky AND a ground`);
    assert.ok(row.min_flat_index_share >= 0.30,
      `${name}'s page is ${(100 * row.min_flat_index_share).toFixed(1)}% one flat index -- ` +
      "that is a sprite sheet, and if it ever stops being one this decode is stale");
  }
});

test("the arena's clear colour stays the fight screen's own black, not a painted sky", () => {
  // pro/wfightmn.s:2120-2139 -- with the setup state word at 2 it takes the arena view (key 0x1000)
  // and calls the view's own colour slot (+0x12C) with a1 = a2 = a3 = 0. The backdrop's base is
  // black; the sky the captures show is geometry on top of it, not the clear colour.
  const battle3d = readFileSync(resolve("web/battle3d.js"), "utf8");
  assert.match(battle3d, /gl\.clearColor\(0\.04, 0\.04, 0\.08, 1\)/,
    "web/battle3d.js still names its own #0a0a14 clear as the sky gradient's bottom stop; if the " +
    "arena ever gets a decoded backdrop this line is the place its base colour is read from");
});