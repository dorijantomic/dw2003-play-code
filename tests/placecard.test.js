// The stage-entry location title card's shipped data — see
// docs/research/ui/field-location-title-card-2026-08-16.md and
// tools/extract_place_card.py. The card's BEHAVIOUR is covered by
// tests/engine/unit/location-card.test.ts (npm run test:engine).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const card = JSON.parse(readFileSync("web/assets/data/place_card.json", "utf8"));
const manifest = JSON.parse(readFileSync("web/assets/manifest.json", "utf8"));
const composed = JSON.parse(readFileSync("data/stage_names.json", "utf8"));

test("the name table ships one record per scene the field engine knows", () => {
  // 239 records in the table plus the 55 mirrored-server overlays that share a
  // record with their partner screen.
  assert.equal(Object.keys(card.stages).length, 294);
  for (const [id, rec] of Object.entries(card.stages)) {
    assert.match(id, /^s\d+$/);
    assert.equal(typeof rec.area, "string");
    assert.equal(typeof rec.place, "string");
    assert.ok(rec.area.length > 0 && rec.place.length > 0, `${id} is named`);
    assert.ok(rec.scene >= 0x200 && rec.scene <= 0x2ff, `${id} scene in range`);
  }
});

test("every map the walker ships can name itself", () => {
  const missing = manifest.maps.map((m) => m.id).filter((id) => !card.stages[id]);
  assert.deepEqual(missing, []);
});

test("the two names agree with the independently built display names", () => {
  // data/stage_names.json is produced by a different tool from the same table.
  // Disagreement means one of the two readings of the record layout is wrong.
  for (const [id, rec] of Object.entries(card.stages)) {
    if (!(id in composed)) continue;
    const expected = rec.area && rec.place && rec.area !== rec.place
      ? `${rec.area} — ${rec.place}`
      : rec.area || rec.place;
    assert.equal(composed[id], expected, id);
  }
});

test("the opening screen is the Street Corner in Kusanagi City", () => {
  assert.deepEqual(card.stages.s780, {
    scene: 0x2d7,
    area: "Kusanagi City",
    place: "Street Corner",
  });
});

test("ten bar templates, each animated on one axis with a positive step", () => {
  assert.equal(card.bars.length, 10);
  for (const b of card.bars) {
    assert.ok(b.axis === 1 || b.axis === 2, "axis is x/width or y/height");
    assert.ok(b.step > 0, "a bar that never moves would never settle");
    assert.ok(b.near <= b.far, "the near edge is not past the far edge");
    assert.equal(b.color.length, 3);
    for (const c of b.color) assert.ok(c >= 0 && c <= 255);
  }
});

test("the panels behind the two names cover where the names are drawn", () => {
  // Record 8 sits behind the area name at (128, 26), record 9 behind the place
  // name at (40, 68). Both are animated on y, so their settled span is the
  // template's near..far.
  const area = card.bars[8], place = card.bars[9];
  assert.ok(area.x <= 128 && area.x + area.w > 128);
  assert.ok(area.near <= 26 && area.far > 26);
  assert.ok(place.x <= 40 && place.x + place.w > 40);
  assert.ok(place.near <= 68 && place.far > 68);
});
