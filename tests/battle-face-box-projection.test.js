// What the battle close-up box does with a record whose OWN projection distance is not one.
//
// tests/battle-face-box-camera.test.js owns the shot itself and tests/battle-face-box-scene.
// test.js owns the ordered draw list. This file owns the third question: the console reads
// three numbers out of the fighter's model record — an eye, the point it looks at, and a
// projection distance H — whatever the record holds, and the old walker put a filter in front
// of that read ("a shot with no projection distance is not a camera") and then invented a
// head camera for everything the filter dropped. Both halves were ours.
//
// The original, read:
//
//   fightstg.s FIGHTSTG_F0x80091c1c (:15355-15409)
//     :153c44-153c5c   group = 6 when the fighter record's +0x18 is zero, else 7
//     :153c5c-153c68   $a0 = record + 2*group, $v1 = record + 6*group
//     :153c6c-153c94   eye     = lh record+0x1A+6g, -(lh +0x1C+6g), -(lh +0x1E+6g)
//     :153c98-153cc0   target  = lh record+0x62+6g, -(lh +0x64+6g), -(lh +0x66+6g)
//     :153cc4          H       = lh record+0xAA+2g
//     :153cc8-153cdc   zeroes the angle triple self+0xCC..0xD0 and the offset triple
//                       self+0xD4..0xDC
//     :153ce0          sw -> self+0x78   (H, sign-extended)
//     There is no branch in that whole body: nothing tests H, and nothing tests the record's
//     length. A 0x48 record is three shots long, so groups 6 and 7 read past its end and the
//     console reads its neighbour's bytes — which is exactly what
//     tools/extract_smdldata.py emits, neighbours and all.
//
//   fightstg.s :153bf0-153bf8  view->+0x15C(view, 1, self+0x78)  — the enable flag is a
//                      literal 1 and H goes over with it; F0x8001e404 (exe/fns.s:15717)
//                      stores a2 at view+0x88 and returns early only when a1 == 0.
//   exe/fns.s F0x8001e470 (:15748) the view's per-frame +0x158: lw view+0x88, then
//                      F0x8002998c -> F0x8002b40c (:29902), whose whole body is
//                      `ctc2 $a0, 26`. One instruction, no branch. The same +0x15C method,
//                      through the same ctc2, is how the main battle camera hands over its
//                      focal distance (FIGHTSTG_F0x80092158, fightstg.s:157bc-157cc), which is
//                      what makes that register the game's projection distance.
//   exe/fns.s F0x800266b4 (:24595-24601) the display-environment builder reads the view's own
//                      background-colour flag at view+0x18 and SKIPS the fill when it is
//                      clear. The box driver (FIGHTSTG_F0x80094064, :17758-17889) never calls
//                      +0x12C and the view constructor F0x8001e5bc (:15843) never writes
//                      view+0x18, so the box's view issues no fill of its own.
//
// The PS1's RotTransPers produces its screen coordinate as
//     n   = ((H*0x20000/SZ3)+1)/2
//     MAC0= ((n*IR)/0x1000)*DQA + DQB          SX = MAC0 >> 16
// so H == 0 gives n == 0 and both SX and SY come out as the drawing offset alone. The vertex
// loop adds the GTE's output to the point's own window centre (FIGHTSTG_F0x80083854,
// fightstg.s:838dc-83920), so every vertex of every polygon submitted into that view lands on
// the SAME point: a triangle with its three vertices together has no area, and the GPU fills
// nothing. Nothing skips the draw — the view stays enabled, its table still runs, its depth
// sort still orders the polygons — so the box contributes no pixel and, having no fill of its
// own, leaves the window showing the battle view's own picture.
//
// Which records can reach that is a question about the disc, answered below: the three 0xC4
// records that read all zeros are the only ones the player can be holding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cam = () => import("../web/fight/battle-camera.js");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const PLACEMENT = JSON.parse(
  readFileSync(new URL("../web/assets/battle/model_placement.json", import.meta.url), "utf8"));
const M = PLACEMENT.models;

// The 0x48 records whose group-6/7 read runs past the end of the SMDLDATA block, so the
// extractor's row is null: model keys 70 and 177 (self_index 192 and 191, the last two of
// section 3). The block is 33,980 bytes and its last word is at file offset 0x84B8; record 70
// starts at 0x8474 and record 177 at 0x842C, so their H reads (0x852A/0x852C and 0x84E2/
// 0x84E4) are 0x6E..0x72 bytes past it.
const OFF_FILE = ["177", "70"];   // .sort() order, which is what the assertion compares

test("a record the console reads out of its NEIGHBOUR keeps that read", async () => {
  const { faceBoxShot, faceBoxDraws } = await cam();
  // Model key 4 (Betamon) is a 0x48 record: three shots long, so its group-6 and group-7
  // addresses fall past its own end. F0x80091c1c has no branch on that, so what it builds is
  // the neighbouring bytes — and those give a real projection distance on group 7. The old
  // filter called this "no usable framing" and the renderer then drew a head camera of its
  // own; here the console's own shot is what comes back.
  const row = M["4"].face_box.find((r) => r && r.group === 7);
  assert.ok(row && row.H > 0, "the extractor's group-7 row for model key 4 carries a distance");
  const shot = faceBoxShot(M["4"], "enemy");
  assert.deepEqual(shot, { eye: [...row.eye], target: [...row.target], H: row.H, group: 7 });
  assert.ok(faceBoxDraws(shot), "a projection distance the console read is one it projects with");
  // The player side of the same record reads H = 0, and that is reported as the zero it is
  // rather than hidden: the console's own read, which happens to be no camera.
  const near = faceBoxShot(M["4"], "player");
  assert.equal(near.H, 0);
  assert.equal(faceBoxDraws(near), false);
});

test("the old filter is gone: a read with no projection distance is still a read", async () => {
  const { faceBoxShot } = await cam();
  // On the pre-port tree faceBoxShot answered null for anything without a positive H, so
  // 196 of the 248 records reported "unframed" — including 189 that carry a real
  // neighbouring shot on the enemy side. These assertions use faceBoxShot alone, so they are
  // about the read and not about the predicate that used to swallow it.
  const shot = faceBoxShot(M["4"], "player");        // H = 0, eye/look are neighbour bytes
  assert.ok(shot, "a record the console reads is not 'unframed'");
  assert.deepEqual(shot.eye, [280, -280, -280]);
  assert.deepEqual(shot.target, [280, -280, -280]);
  assert.equal(shot.H, 0);
  assert.equal(shot.group, 6);
  // And the 0x48 record whose H read is zeros rather than a neighbour's bytes.
  const allZero = faceBoxShot(M["468"], "enemy");
  assert.ok(allZero, "an all-zero read is still the read the console made");
  assert.deepEqual(allZero, { eye: [0, 0, 0], target: [0, 0, 0], H: 0, group: 7 });
});

test("every record the console can read comes back, unfiltered", async () => {
  const { faceBoxShot } = await cam();
  // 248 records; only the two whose H read leaves the SMDLDATA block have no row at all.
  const player = Object.entries(M).map(([k, r]) => [k, faceBoxShot(r, "player")]);
  const enemy = Object.entries(M).map(([k, r]) => [k, faceBoxShot(r, "enemy")]);
  for (const side of [player, enemy]) {
    assert.deepEqual(side.filter(([, s]) => s === null).map(([k]) => k).sort(), OFF_FILE,
      "only the two off-file records may have no read");
    assert.equal(side.filter(([, s]) => s !== null).length, 246);
  }
  // And every read is the extractor's own row, byte for byte.
  for (const [key, record] of Object.entries(M)) {
    for (const side of ["player", "enemy"]) {
      const group = side === "enemy" ? 7 : 6;
      const row = record.face_box.find((r) => r && r.group === group);
      const shot = faceBoxShot(record, side);
      if (!row) { assert.equal(shot, null, `model key ${key} ${side}`); continue; }
      assert.deepEqual(shot, { eye: [...row.eye], target: [...row.target], H: row.H, group },
        `model key ${key} ${side}`);
    }
  }
});

test("H = 0 gives the box an empty view, and the sky and floor go with it", async () => {
  const { faceBoxShot, faceBoxDraws, faceBoxScene } = await cam();
  // The three 0xC4 records that read all zeros on both sides: Agunimon, BladeGarurumon and
  // AncientGreymon (model keys 468, 469, 470 — web/assets/battle/model_map.json names them).
  for (const key of ["468", "469", "470"]) {
    for (const side of ["player", "enemy"]) {
      const shot = faceBoxShot(M[key], side);
      assert.deepEqual(shot.eye, [0, 0, 0]);
      assert.deepEqual(shot.target, [0, 0, 0]);
      assert.equal(shot.H, 0);
      assert.equal(faceBoxDraws(shot), false, `model key ${key} ${side} has no projection`);
    }
  }
  // So the whole ordered list is empty — not a head on a background: with the distance at 0
  // every vertex of the stage and of the fighter lands on the same screen point, so the stage
  // is in the same view and collapses too (docs/research/battle/
  // battle-stage-backdrop-decode-2026-10-04.md section 1 rules out a clip-space card).
  assert.deepEqual(faceBoxScene({ draws: faceBoxDraws(faceBoxShot(M["468"], "player")) }), []);
  assert.deepEqual(faceBoxScene({ backdropOnly: true, draws: false }), []);
  // A record with a distance still gets the whole list, in the order the box draws it.
  assert.deepEqual(
    faceBoxScene({ draws: faceBoxDraws(faceBoxShot(M["383"], "player")) }).map((i) => i.what),
    ["sky", "floor", "subject"]);
  // A negative distance is the same read with the register's high bit set: the divide
  // saturates and the coordinate leaves the range the GPU renders.
  assert.equal(faceBoxDraws({ eye: [1, 2, 3], target: [4, 5, 6], H: -1280, group: 7 }), false);
  assert.equal(faceBoxDraws(null), false);
});

test("only the player's own roster can reach the empty box; no other record can", async () => {
  const { faceBoxShot, faceBoxDraws } = await cam();
  // The 55 records the game gives a profile row are exactly its 55 section-2 (0xC4) records
  // — ~/ddw3/data/digimon_profiles.toml's 55 value0 values are the 55 section-2 keys and none
  // of them is a section-3 key — and the box's subject is the player's fighter
  // (battle-hud-ownership-check-2026-10-03.md section 6.2, capture-confirmed). So the whole
  // short-record population is unreachable in the box, and the whole roster but three authors
  // its own framing on both sides.
  const sec2 = Object.entries(M).filter(([, r]) => r.section === 2);
  const sec3 = Object.entries(M).filter(([, r]) => r.section === 3);
  assert.equal(sec2.length, 55);
  assert.equal(sec3.length, 193);
  const drawable = (r, side) => faceBoxDraws(faceBoxShot(r, side));
  assert.deepEqual(sec2.filter(([, r]) => !(drawable(r, "player") && drawable(r, "enemy")))
                       .map(([k]) => k), ["468", "469", "470"],
    "the only roster records with no framing are the three that read all zeros");
  // Every one of the 193 short records is unprojectable on the player side, which is why the
  // 196 the old filter rejected never changed a picture the player could see.
  assert.equal(sec3.filter(([, r]) => drawable(r, "player")).length, 0);
  assert.equal(sec3.filter(([, r]) => drawable(r, "enemy")).length, 189);
});

test("the renderer draws nothing in the window when the distance is not one", () => {
  const src = read("web/battle3d.js");
  // The old invented camera is gone: no head-height fraction, no 85%-of-body distance, no
  // fixed 40-degree box angle, and nothing marked "FALLBACK, OURS".
  assert.doesNotMatch(src, /FALLBACK, OURS/,
    "the head camera that stood in for the record's own shot is gone");
  assert.doesNotMatch(src, /tH\*0\.20/, "no head-height fraction of ours in the box");
  assert.doesNotMatch(src, /tH \* 0\.85/, "no 85%-of-body-height box distance of ours");
  assert.doesNotMatch(src, /mat4Perspective\(Math\.PI\/4\.5, fw \/ fh/,
    "no fixed 40-degree box angle of ours");
  // It asks the record instead, and gates the whole pass on the answer.
  assert.match(src, /const boxDraws = faceBoxDraws\(faceShot\)/,
    "the box's own projection distance decides whether it draws");
  assert.match(src, /const scene = faceBoxScene\(\{\s*\n?\s*backdropOnly: dfActive \|\| dnaVoidActive, draws: boxDraws,/,
    "the draw list is the record's to empty");
  // And the window is not cleared on that path, because the original's box view has no
  // background colour of its own and so leaves the battle view's picture showing through.
  const listAt = src.indexOf("const scene = faceBoxScene(");
  const clearAt = src.indexOf("gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);", listAt);
  assert.ok(listAt > 0 && clearAt > listAt, "the list is decided before the window is cleared");
  const guardAt = src.indexOf("if (scene.length) {", listAt);
  assert.ok(guardAt > listAt && guardAt < clearAt, "the clear is inside the list's guard");
});
