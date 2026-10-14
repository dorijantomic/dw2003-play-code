import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Golden pins for the point-sprite extraction (decode ground truth:
// docs/research/field/point-sprite-ambient-system.md -- the s420 Seiryu City
// table was byte-verified by hand before the extractor existed).
const data = JSON.parse(readFileSync("web/assets/data/point_sprites.json", "utf8"));

test("s420 Seiryu City: 34 records with the three windmills", () => {
  const s = data.s420;
  assert.ok(s, "s420 missing");
  assert.equal(s.records.length, 34);
  const windmills = s.records.filter(
    (r) => r.mode === 1 && r.min === 0 && r.max === 3 && r.period === 6,
  );
  assert.deepEqual(
    windmills.map((r) => [r.x, r.y]).sort((a, b) => a[0] - b[0]),
    [[441, 290], [817, 114], [949, 528]],
  );
  // the windmill blade frames are 60x74 sprites, ids 0..3, single-layer
  for (const id of ["0", "1", "2", "3"]) {
    assert.equal(s.sprites[id].length, 1, `sprite ${id} layers`);
    assert.equal(s.sprites[id][0].w, 60);
    assert.equal(s.sprites[id][0].h, 74);
  }
});

test("scenery sprites share the map camera phase", () => {
  // Chain posts and railings are a second image set into map cut-outs.
  // Independent dest rounding made the join visible and crawl while walking.
  const src = readFileSync("web/effects.js", "utf8");
  const start = src.indexOf("function drawSprite(");
  const end = src.indexOf("\n// The ordering-table bucket", start);
  assert.ok(start >= 0 && end > start, "drawSprite not found");
  const fn = src.slice(start, end);
  assert.equal(
    fn.includes("Math.round"),
    false,
    "drawSprite dest must match map (-camX,-camY); rounding desyncs cut-out props",
  );
  const fieldcom = readFileSync("web/fieldcom.js", "utf8");
  const fcStart = fieldcom.indexOf("export function drawFieldcomIcon(");
  const fcEnd = fieldcom.indexOf("\n// Composed indicator bubble", fcStart);
  assert.ok(fcStart >= 0 && fcEnd > fcStart, "drawFieldcomIcon not found");
  assert.equal(
    fieldcom.slice(fcStart, fcEnd).includes("Math.round"),
    false,
    "FIELDCOM scenery dest must also share the map camera phase",
  );
});

test("global invariants: every kept record resolves; rects sane", () => {
  assert.ok(Object.keys(data).length >= 200, "expected ~228 stages");
  for (const [stage, s] of Object.entries(data)) {
    for (const r of s.records) {
      assert.ok(r.size > 0, `${stage}: terminator leaked into records`);
      if (r.atlas === "fieldcom") continue;
      const ids = r.mode === 1 && r.max
        ? Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i)
        : [];
      ids.push(r.spriteId);
      for (const id of ids) {
        const spr = s.sprites[String(id)];
        assert.ok(spr, `${stage}: record needs sprite ${id} but it's not cut`);
        for (const lay of spr) {
          assert.ok(lay.w > 0 && lay.h > 0 && lay.x >= 0 && lay.y >= 0,
            `${stage} sprite ${id}: bad rect`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Which pass each ordering-table bucket lands in.
//
// The field submits the three map-tile layers on the same ordering-table ladder
// the point-sprite records use: ground 7, foreground 3, layer 2 at 11 (the
// three words at 0x8009702c, each handed to the same draw-context slot 0x138
// the records reach). Lower bucket = nearer the camera, so a record at 8 or 10
// draws BEHIND the ground and must be painted before the base map.
// docs/research/field/map-tile-draw-semitransparency-2026-08-20.md section 8.

const { bucketPass, UNDER_MAP_BUCKET } = await import("../web/effects.js");

test("every shipped bucket routes to the pass its depth demands", () => {
  assert.equal(UNDER_MAP_BUCKET, 8, "ground draws at 7; 8 is the first behind it");
  assert.equal(bucketPass(0), "over-entities");
  assert.equal(bucketPass(2), "over-entities");
  assert.equal(bucketPass(3), "over-entities");
  assert.equal(bucketPass(4), "sorted");
  assert.equal(bucketPass(5), "over-map");
  assert.equal(bucketPass(6), "over-map"); // over the ground, under entities
  assert.equal(bucketPass(7), "over-map"); // the ground's own bucket
  assert.equal(bucketPass(8), "under-map");
  assert.equal(bucketPass(10), "under-map");
  assert.equal(bucketPass(11), "under-map"); // map layer 2's bucket
});

test("the shipped records only ever use buckets we have decoded", () => {
  const buckets = new Set();
  for (const s of Object.values(data)) for (const r of s.records) buckets.add(r.layer);
  assert.deepEqual([...buckets].sort((a, b) => a - b), [2, 4, 6, 8, 10]);
  // 8 and 10 lie strictly between the ground's 7 and map layer 2's 11.
  for (const b of [8, 10]) assert.ok(b > 7 && b < 11);
});

test("the map's layers are emitted into their own buckets around the under-map band", () => {
  // The console order is map layer 2 (bucket 11), these props (8/10), then the
  // ground (7). A split stage draws its two map-tile layers itself — layer 2 at
  // OT[11] before the props, the ground at OT[7] after them — so a bucket-8/10
  // prop is sandwiched between the two layers, exactly as on the console.
  const src = readFileSync("web/game.js", "utf8");
  const layer2 = src.indexOf("ctx.drawImage(\n            layer2Img,");
  const under = src.indexOf("drawEffectsUnderMap(ctx, m.id");
  const ground = src.indexOf("ctx.drawImage(\n            groundImg,");
  const over = src.indexOf("drawEffects(ctx, m.id, camX, camY, drawables");
  for (const [name, i] of [["layer-2 layer draw", layer2], ["under-map pass", under],
                           ["ground layer draw", ground], ["over-map pass", over]]) {
    assert.ok(i > 0, `${name} draw not found`);
  }
  assert.ok(layer2 < under, "layer 2 (OT[11]) must go down before the props");
  assert.ok(under < ground, "the ground layer (OT[7]) must go down after the props");
  assert.ok(ground < over, "the rest of the props come after the ground layer");
  // The flattened map is only drawn when the stage ships no layer split; a split
  // stage is drawn as its two layers above, not the flattened base map.
  assert.match(src, /if \(!layer2Split\) \{\n\s*ctx\.drawImage\(\n\s*mapImg,/,
    "the flattened base map is skipped for a split stage");
  // The native objects both passes read must be ticked before the first of them.
  const tickNative = src.indexOf("tickNativeStage(m.id, fieldBlanks)");
  assert.ok(tickNative > 0 && tickNative < under, "native tick must precede both passes");
  assert.equal(
    src.indexOf("tickNativeStage(m.id, fieldBlanks)", tickNative + 1),
    -1,
    "the native stage must be ticked exactly once per frame",
  );
});

test("a layer-2 split ships exactly where the ground hides a prop or an op-5 actor", () => {
  // Without the split the renderer cannot rebuild the ground band, so a prop at
  // bucket 8/10 (or the party at the under-map bucket) draws over ground art the
  // console hides it behind. The build stage is map_ground_over_props; it indexes
  // every stage that ships a split and writes the LAYER-2-ONLY pixels as runs.
  const withProps = new Set(
    Object.entries(data)
      .filter(([, s]) => s.records.some((r) => r.active && r.layer >= UNDER_MAP_BUCKET))
      .map(([id]) => id),
  );
  // A stage whose step program authors op 5 also needs the split — for the
  // PLAYER actor, which draws at that bucket and must be hidden under the ground
  // but still SHOWN over layer-2 art (the tunnel opening). Derived, not listed.
  const steps = JSON.parse(readFileSync("web/assets/data/story_steps.json", "utf8")).stages;
  const withOp5 = new Set(
    Object.entries(steps)
      .filter(([, p]) => (p.steps ?? []).some((s) => s.op === 5))
      .map(([id]) => `s${id}`),
  );
  const index = JSON.parse(readFileSync("web/assets/data/map_ground_index.json", "utf8"));
  const covers = Object.keys(index);
  assert.ok(covers.length >= 25, `expected ~28 splits, got ${covers.length}`);
  for (const id of covers) {
    assert.ok(
      withProps.has(id) || withOp5.has(id),
      `${id} ships a split but has neither a prop that draws behind the ground nor an op-5 actor`,
    );
  }
  // Every indexed stage must actually carry runs, and they must be well formed.
  const runs = JSON.parse(readFileSync("web/assets/data/map_layer2_runs.json", "utf8")).stages;
  for (const id of covers) {
    assert.ok(Array.isArray(runs[id]) && runs[id].length > 0,
      `${id} is indexed but ships no layer-2 runs`);
    const [x0, x1, y] = runs[id][0];
    assert.ok(Number.isInteger(x0) && Number.isInteger(x1) && Number.isInteger(y) && x1 >= x0,
      `${id} has a malformed run ${JSON.stringify(runs[id][0])}`);
  }
  // A tunnel opening is a layer-2 cut-out, so the stages that show one must carry
  // its pixels — directly or through the alias they render from (s949 -> s376,
  // s934 -> s261; manifest `assetSource`).
  const manifest = JSON.parse(readFileSync("web/assets/manifest.json", "utf8"));
  const source = new Map(manifest.maps.map((m) => [m.id, m.assetSource ?? m.id]));
  for (const id of ["s375", "s376", "s949", "s261", "s934"]) {
    const splitId = source.get(id) ?? id;
    assert.ok(runs[splitId]?.length,
      `${id} (split source ${splitId}) shows a tunnel opening but ships no layer-2 split`);
  }
});

test("both passes route through bucketPass, so they cannot disagree", () => {
  const src = readFileSync("web/effects.js", "utf8");
  const underStart = src.indexOf("export function drawEffectsUnderMap(");
  const overStart = src.indexOf("export function drawEffects(");
  assert.ok(underStart >= 0 && overStart > underStart);
  assert.match(src.slice(underStart, overStart), /bucketPass\(r\.layer\)/);
  assert.match(src.slice(overStart), /bucketPass\(r\.layer\)/);
});
