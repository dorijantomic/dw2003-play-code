// Ladder climb geometry — the climb's rail, length, and the step-off landing.
//
// The operator's report: "climbing ladder positions me not on ladder". The
// climb's own numbers are decoded from the two mount bodies and the four
// step-on/step-off mode blocks of pro/fieldstg.s (file offsets; the port cites
// line numbers in engine/systems/scene-step-ops.ts):
//
//   * bottom mount F0x8008f128 (file 0xc478): x = params[1], y = params[2],
//     offset 0, height = (params[0]-1)<<4 -> entity+0x94.
//   * head mount F0x8008f1d4 (file 0xc524): x/y = the head cell, then mode 0x44
//     (file 0xd950) moves x = head.x ± 16 by the side word entity+0x8c and
//     y = head.y + 24 + height with entity+0x90 seeded to height.
//   * climb blocks mode 0x41/0x42 (files 0xd818/0xd878) only touch the offset.
//   * top step-off mode 0x45 (file 0xda6c): x -= / += 16 against the side word
//     and y -= 24 + height on completion; bottom step-off mode 0x46 (file
//     0xd9f8) moves nothing and only zeroes entity+0x60.
//
// The old port used the ENDPOINT SPAN as the climb height and pinned the rail
// to the foot's x from both ends; the span is height + 24 (the step-off) for
// 132 of the 216 shipped rails, +13..+28 for the rest, so the sprite stopped
// short of the head and (mounted from the top) the drawn row was wrong by the
// whole step-off. This pins the decoded arithmetic over every shipped rail.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ladderClimbPlan,
  ladderClimbPosition,
  ladderDismountEnd,
} from "../engine/systems/scene-step-ops.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const gameSrc = readFileSync(join(ROOT, "web/game.js"), "utf8");

/** Every rail of every shipped stage, with the record's own climb height. */
function rails() {
  const out = [];
  for (const file of readdirSync(join(ROOT, "web/assets/scenes")).filter((f) => f.endsWith(".json"))) {
    const stage = file.replace(/\.json$/, "");
    const scene = JSON.parse(readFileSync(join(ROOT, "web/assets/scenes", file), "utf8"));
    for (const L of scene.ladders ?? []) {
      out.push({ stage, id: L.id, bottom: L.bottom, top: L.top, height: (L.id - 1) * 16 });
    }
  }
  return out;
}
const RAILS = rails();

test("the census: 216 rails, ids 3..18, so every climb height is (id-1)*16 = 32..272", () => {
  assert.equal(RAILS.length, 216);
  assert.ok(RAILS.every((r) => r.id >= 3 && r.id <= 18));
  assert.ok(RAILS.every((r) => r.height >= 32 && r.height <= 272));
});

test("s381 ladder 3: the climb runs on the foot's rail x for its whole (id-1)*16 length", () => {
  const L = RAILS.find((r) => r.stage === "s381" && r.id === 3);
  assert.deepEqual(L.bottom, { x: 432, y: 374 });
  assert.deepEqual(L.top, { x: 417, y: 320 });
  const plan = ladderClimbPlan(L.bottom, L.top, 3, true, L.height);
  assert.equal(plan.railX, 432, "the rail x is the foot cell's own x");
  assert.equal(plan.height, 32, "the climb is the record's (id-1)*16, NOT the 54px span");
  assert.equal(plan.baseY, 374, "the shadow stays on the foot row");
  // The climb's own drawn rows: x pinned at the rail, y = foot - progress.
  assert.deepEqual(ladderClimbPosition(plan, 0), { x: 432, y: 374 });
  assert.deepEqual(ladderClimbPosition(plan, 16), { x: 432, y: 358 });
  assert.deepEqual(ladderClimbPosition(plan, 32), { x: 432, y: 342 });
  // The last 22px to the head cell are the step-off, not climb.
  const land = ladderDismountEnd(plan, true);
  assert.deepEqual(land, { x: 416, y: 318 }, "16px sideways against the side word, 24+height down");
  assert.ok(Math.abs(land.x - L.top.x) <= 3 && Math.abs(land.y - L.top.y) <= 2,
    "and that lands on the head cell (the record's own top endpoint)");
});

test("s381 ladder 3 mounted from the head: the same rail, start = head.y + 24", () => {
  const L = RAILS.find((r) => r.stage === "s381" && r.id === 3);
  const plan = ladderClimbPlan(L.bottom, L.top, 3, false, L.height);
  // facing 3 (up-left) -> side 1 -> the head cell is left of the rail: x + 16.
  assert.equal(plan.side, 1);
  assert.equal(plan.railX, 417 + 16, "head.x + 16, mode 0x44's own arithmetic");
  assert.equal(plan.startY, 320 + 24, "the first drawn row is head.y + 24");
  assert.equal(plan.baseY, 320 + 24 + 32, "entity+0x54 = head.y + 24 + height");
  // At the mount the offset is seeded to height, so the drawn row is startY...
  assert.deepEqual(ladderClimbPosition(plan, plan.height), { x: 433, y: 344 });
  // ...and climbing all the way down leaves the actor on the foot row.
  assert.deepEqual(ladderClimbPosition(plan, 0), { x: 433, y: 376 });
  const land = ladderDismountEnd(plan, false);
  assert.deepEqual(land, { x: 433, y: 376 }, "the bottom step-off moves nothing");
  assert.ok(Math.abs(land.y - L.bottom.y) <= 3, "which is the foot row, ±the record's jitter");
});

test("over every shipped rail: the rail is the foot column, ±3px, from either end", () => {
  let worstRail = 0;
  let worstLand = 0;
  for (const r of RAILS) {
    // The mount facing's sign is proven against the head cell's side by
    // tests/ladder-arming-census.test.js; here the side comes from the same
    // sign directly so the geometry can be checked standalone.
    const facing = r.top.x < r.bottom.x ? 3 : 5; // head left -> up-left, right -> up-right
    for (const fromBottom of [true, false]) {
      const plan = ladderClimbPlan(r.bottom, r.top, facing, fromBottom, r.height);
      const drift = Math.abs(plan.railX - r.bottom.x);
      if (drift > worstRail) worstRail = drift;
      assert.ok(drift <= 3, `${r.stage} rail ${r.id}: rail ${plan.railX} vs foot ${r.bottom.x}`);
      // The step-off is the disc's own arithmetic: railX ∓ 16, baseY - 24 - height.
      // The records' head cells jitter (span - height runs 13..28, 132 of 216 at
      // exactly 24), so the landing sits within 11 px of the record's top cell.
      const topLand = ladderDismountEnd(plan, true);
      const bottomLand = ladderDismountEnd(plan, false);
      worstLand = Math.max(worstLand,
        Math.abs(topLand.x - r.top.x), Math.abs(topLand.y - r.top.y),
        Math.abs(bottomLand.x - r.bottom.x), Math.abs(bottomLand.y - r.bottom.y));
      assert.ok(Math.abs(topLand.x - r.top.x) <= 3 && Math.abs(topLand.y - r.top.y) <= 11,
        `${r.stage} rail ${r.id}: top landing ${JSON.stringify(topLand)} vs ${JSON.stringify(r.top)}`);
      assert.ok(Math.abs(bottomLand.y - r.bottom.y) <= 11,
        `${r.stage} rail ${r.id}: bottom landing ${bottomLand.y} vs ${r.bottom.y}`);
    }
  }
  assert.ok(worstRail <= 3 && worstLand <= 11, `worst rail ${worstRail}, worst landing ${worstLand}`);
});

test("web/game.js plays the disc's four-step ladder sequence with the decoded clips", () => {
  const from = gameSrc.indexOf("function startLadderClimb(");
  assert.ok(from > 0);
  const mount = gameSrc.slice(from, gameSrc.indexOf("\n}\n", from) + 3);
  // The height is the record's own argument (actorCall.args[3] = (params[0]-1)<<4),
  // not the endpoint span.
  assert.match(mount, /const recordHeight = pb\.effect\.actorCall\?\.args\?\.\[3\] \?\? 0/,
    "the climb height comes from the record");
  assert.match(mount, /ladderClimbPlan\(L\.bottom, L\.top, facing, fromBottom, recordHeight\)/);
  assert.doesNotMatch(mount, /Math\.abs\(L\.bottom\.y - L\.top\.y\)/,
    "the old span-as-height is gone");
  // The mount hands over its step-on clip: 0x1c (28) bottom, 0x1e (30) head.
  assert.match(mount, /clip: fromBottom \? 28 : 30/);

  const tfrom = gameSrc.indexOf("function tickClimb(");
  const tick = gameSrc.slice(tfrom, gameSrc.indexOf("\n}\n", tfrom) + 3);
  assert.match(tick, /c\.clip = 32; \/\/ mode 0x40, the hang/);
  assert.match(tick, /clip = 26;/, "climbing up uses clip 0x1a");
  assert.match(tick, /clip = 27;/, "climbing down uses clip 0x1b");
  assert.match(tick, /c\.clip = c\.atTop \? 29 : 31;/, "the step-off clips 0x1d / 0x1f");
  assert.match(tick, /const land = ladderDismountEnd\(c\.plan, c\.atTop\);/);
  assert.match(tick, /MOUNT_SECS_BOTTOM : MOUNT_SECS_TOP/);
  assert.match(tick, /DISMOUNT_SECS_TOP : DISMOUNT_SECS_BOTTOM/);
});

test("the four clip lengths are the strips' own tick counts at 60fps", () => {
  // The ladder pack is the manifest's p002plyl entry (the one whose clip sheet
  // is p002plyl.png — Junior's ladder/digivice pack). Its clip durations must
  // match the port's constants: 28 = 4+4+4+4+3, 30 = 4x5, 29 = 3+1x10+6+6,
  // 31 = 3+3+3+4.
  const manifest = JSON.parse(readFileSync(join(ROOT, "web/assets/manifest.json"), "utf8"));
  const pack = (manifest.npcs ?? []).find((n) => (n.clipSheet ?? "").includes("p002plyl"));
  assert.ok(pack, "the manifest still carries the p002plyl ladder pack");
  const sum = (clip) => {
    const d = pack.clips?.[String(clip)] ?? pack.clips?.[clip];
    assert.ok(d, `clip ${clip} in the ladder pack`);
    const dir = d["up-left"] ?? d.up ?? d.down;
    return (dir.durations ?? []).reduce((a, b) => a + b, 0);
  };
  assert.equal(sum(28), 19, "clip 0x1c, the bottom step-on");
  assert.equal(sum(30), 20, "clip 0x1e, the head step-on");
  assert.equal(sum(29), 25, "clip 0x1d, the top step-off");
  assert.equal(sum(31), 13, "clip 0x1f, the bottom step-off");
  assert.match(gameSrc, /const MOUNT_SECS_BOTTOM = 19 \/ 60;/);
  assert.match(gameSrc, /const MOUNT_SECS_TOP = 20 \/ 60;/);
  assert.match(gameSrc, /const DISMOUNT_SECS_TOP = 25 \/ 60;/);
  assert.match(gameSrc, /const DISMOUNT_SECS_BOTTOM = 13 \/ 60;/);
});
