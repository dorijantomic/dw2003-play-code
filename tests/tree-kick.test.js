// TreeBoots tree kicking — engine/systems/tree-kick.ts.
//
// The numbers checked here are the decoded ones from fieldstg's tree manager
// (F0x8008c98c): a ±10 hit box on a point 16 pixels ahead, a phase that reaches
// 0x14 two steps a frame, a 102/128 split between scripted-encounter slots 3 and
// 6, a 64-frame shake, a 28-frame kick, and a 120-frame radar card banded at
// 0x80/0x100. The s485 assertions are the 2026-07-29 runtime capture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TREE_BOOTS_FLAG, TREE_SPRITE_IDLE, TREE_HIT_RADIUS,
  NEAR_ENCOUNTER_SLOT, FAR_ENCOUNTER_SLOT, NEAR_ROLL_MAX,
  RADAR_LIFE, RADAR_ICON_NEAR, RADAR_ICON_MID, RADAR_ICON_FAR,
  TREE_SHAKE_SCRIPT, KICK_SCRIPTS,
  treeActionPoint, treeIndexAt, rollTreeEncounter, relocateActiveTree,
  treeRadarReading, radarClutRow, tickTreeRadar,
  startTreeKick, tickTreeKick, treeKickHoldsInput,
  KICK_POSE_SPRITE, KICK_POSE_CLIP, KICK_POSE_IDLE_CLIP,
  KICK_POSE_FRAME_TICKS, KICK_POSE_TICKS, KICK_POSE_CONTACT_FRAME,
  KICK_POSE_AUTHORED_FRAMES, kickPoseFrameAt, startKickPose, tickKickPose,
} from "../engine/systems/tree-kick.ts";

const STAGES = JSON.parse(readFileSync("web/assets/data/tree_kick.json", "utf8"));
const S485 = STAGES.s485;

/** Kicks tree `index` to completion and returns every cue plus the frame count. */
function runKick({ index, live, trees = S485.trees, rolls = [0] } = {}) {
  let i = 0;
  const rand = () => rolls[Math.min(i++, rolls.length - 1)];
  const s = startTreeKick(index, 4);
  const ctx = {
    count: trees.length,
    liveIndex: live,
    liveX: trees[live].x, liveY: trees[live].y,
    kickedX: trees[index].x, kickedY: trees[index].y,
  };
  const cues = [];
  let frames = 0;
  for (; frames < 500 && !s.done; frames++) {
    const cue = tickTreeKick(s, ctx, rand);
    if (cue.kind !== "nothing") cues.push({ ...cue, frame: frames });
    if (cue.kind === "encounter") break;
  }
  return { state: s, cues, frames };
}

test("the action point is 16 pixels ahead, 11 on a diagonal", () => {
  assert.deepEqual(treeActionPoint(100, 100, 4), { x: 100, y: 84 });
  assert.deepEqual(treeActionPoint(100, 100, 0), { x: 100, y: 116 });
  assert.deepEqual(treeActionPoint(100, 100, 2), { x: 84, y: 100 });
  assert.deepEqual(treeActionPoint(100, 100, 6), { x: 116, y: 100 });
  assert.deepEqual(treeActionPoint(100, 100, 7), { x: 111, y: 111 });
});

test("s485 reproduces the runtime capture's sixteen trees", () => {
  // Live capture: 16 records, kicked record 3 at (544,207), live record 8 at
  // (976,143), relocation target record 6 at (816,159).
  assert.equal(S485.trees.length, 16);
  assert.deepEqual(
    [S485.trees[3], S485.trees[8], S485.trees[6]].map((t) => [t.x, t.y]),
    [[544, 207], [976, 143], [816, 159]],
  );
  assert.equal(S485.gateFlag, TREE_BOOTS_FLAG);
  assert.equal(S485.encounters[NEAR_ENCOUNTER_SLOT].screenId, 329); // Cardmon3
  assert.equal(S485.encounters[FAR_ENCOUNTER_SLOT].screenId, 48);   // Flymon
});

test("standing where the capture stood picks the tree the capture picked", () => {
  // Leader at (977,168) facing up -> action point (977,152), inside record 8.
  const p = treeActionPoint(977, 168, 4);
  assert.deepEqual(p, { x: 977, y: 152 });
  assert.equal(treeIndexAt(S485.trees, p), 8);
});

test("the hit box is ±10 in both axes, and misses are misses", () => {
  const t = S485.trees[8];
  for (const [dx, dy] of [[TREE_HIT_RADIUS, 0], [0, -TREE_HIT_RADIUS], [-10, 10]])
    assert.equal(treeIndexAt(S485.trees, { x: t.x + dx, y: t.y + dy }), 8);
  for (const [dx, dy] of [[TREE_HIT_RADIUS + 1, 0], [0, TREE_HIT_RADIUS + 1]])
    assert.equal(treeIndexAt(S485.trees, { x: t.x + dx, y: t.y + dy }), null);
});

test("kicking a dead tree puts up a radar card and nothing else", () => {
  const { cues, state } = runKick({ index: 3, live: 8 });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].kind, "radar");
  assert.ok(state.done);
});

test("the shake runs its 64 scripted frames and ends back on the resting cell", () => {
  const { frames, state } = runKick({ index: 3, live: 8 });
  assert.equal(
    TREE_SHAKE_SCRIPT.reduce((n, s) => n + s.d, 0), 64,
    "the script's own durations are what makes it 64",
  );
  // One extra frame is the terminator step: the original only notices 0xff on
  // the frame AFTER the last cell's duration runs out. The 2026-07-29 capture
  // measured 63 frames from kick to idle, one frame either side of this.
  assert.equal(frames, 65);
  assert.equal(state.shake.sprite, TREE_SPRITE_IDLE);
});

test("Junior's kick cells run 28 frames, well inside the shake", () => {
  const s = startTreeKick(0, 4);
  const ctx = { count: 16, liveIndex: 8, liveX: 0, liveY: 0, kickedX: 0, kickedY: 0 };
  let alive = 0;
  for (let f = 0; f < 200 && !s.done; f++) {
    tickTreeKick(s, ctx, () => 0);
    if (s.kick) alive = f + 1;
  }
  assert.equal(alive, 28);
  for (const script of KICK_SCRIPTS)
    assert.equal(script.reduce((n, e) => n + e.d, 0), 28);
});

test("kicking the live tree drops an encounter about ten frames in", () => {
  const { cues } = runKick({ index: 8, live: 8 });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].kind, "encounter");
  assert.ok(cues[0].frame <= 12, `resolved on frame ${cues[0].frame}`);
});

test("the drop is 102/128 the near slot and 26/128 the far one", () => {
  assert.equal(rollTreeEncounter(() => NEAR_ROLL_MAX - 1), NEAR_ENCOUNTER_SLOT);
  assert.equal(rollTreeEncounter(() => NEAR_ROLL_MAX), FAR_ENCOUNTER_SLOT);
  let near = 0;
  for (let r = 0; r < 128; r++) if (rollTreeEncounter(() => r) === NEAR_ENCOUNTER_SLOT) near++;
  assert.equal(near, 102);
});

test("the live marker moves on every drop, anywhere in the table", () => {
  const { cues } = runKick({ index: 8, live: 8, rolls: [0, 6] });
  assert.equal(cues[0].relocateTo, 6); // the capture's observed 8 -> 6
  for (let r = 0; r < 32; r++)
    assert.ok(relocateActiveTree(16, () => r) < 16);
});

test("the radar bands are per-axis, not a real distance", () => {
  assert.equal(treeRadarReading(127, 127).icon, RADAR_ICON_NEAR);
  assert.equal(treeRadarReading(255, 0).icon, RADAR_ICON_MID);
  assert.equal(treeRadarReading(0, -256).icon, RADAR_ICON_FAR);
  // Same rectangular band whether the tree is dead ahead or diagonal.
  assert.equal(treeRadarReading(200, 0).icon, treeRadarReading(200, 200).icon);
  assert.deepEqual(
    [3, 6, 0xc],
    [treeRadarReading(0, 0), treeRadarReading(200, 0), treeRadarReading(300, 0)]
      .map((r) => r.divisor),
  );
});

test("the radar card lives 120 frames and its rings ripple through ten rows", () => {
  const r = { ...treeRadarReading(0, 0), timer: 0 };
  const rows = new Set();
  let frames = 0;
  while (tickTreeRadar(r)) {
    rows.add(radarClutRow(r));
    frames++;
  }
  assert.equal(frames + 1, RADAR_LIFE);
  assert.deepEqual([...rows].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("every extracted stage has trees, and they are point records in order", () => {
  const points = JSON.parse(readFileSync("web/assets/data/point_sprites.json", "utf8"));
  for (const [stage, s] of Object.entries(STAGES)) {
    assert.ok(s.trees.length > 0, `${stage} has no trees`);
    let last = -1;
    for (const t of s.trees) {
      const rec = points[stage].records[t.rec];
      assert.equal(rec.atlasFlag, 0xff, `${stage} tree ${t.rec} is not a FIELDCOM record`);
      assert.deepEqual([rec.x, rec.y], [t.x, t.y]);
      assert.ok(t.rec > last, `${stage} trees are out of table order`);
      last = t.rec;
    }
  }
});

// ── Junior's body: leader mode 0x49, clip 8 off P002PLYK ───────────────────
// p002plyk/30.bin defines ONLY clip 8, five authored directions of five frames,
// durations 4/3/4/15/5 in every one of them. NOTE the unresolved discrepancy
// documented in engine/systems/tree-kick.ts: the body is 31 ticks, the burst
// script 28 frames and a runtime capture held mode 0x49 for 27. The authored
// data wins here; nothing is fudged to make the three agree.

test("the kick pose is 31 ticks with a 15-tick contact hold", () => {
  assert.equal(KICK_POSE_TICKS, 31);
  assert.deepEqual([...KICK_POSE_FRAME_TICKS], [4, 3, 4, 15, 5]);
  assert.equal(KICK_POSE_FRAME_TICKS[KICK_POSE_CONTACT_FRAME], 15);
});

test("the pose's frame at tick N follows the authored durations", () => {
  // 0-3 | 4-6 | 7-10 | 11-25 (contact hold) | 26-30 | done
  const spans = [[0, 3, 0], [4, 6, 1], [7, 10, 2], [11, 25, 3], [26, 30, 4]];
  for (const [from, to, frame] of spans)
    for (let t = from; t <= to; t++)
      assert.equal(kickPoseFrameAt(t), frame, `tick ${t}`);
  assert.equal(kickPoseFrameAt(KICK_POSE_TICKS), null);
  assert.equal(kickPoseFrameAt(-1), null);
});

test("every authored direction is five frames, five directions in all", () => {
  const dirs = Object.keys(KICK_POSE_AUTHORED_FRAMES);
  assert.deepEqual(dirs, ["down", "down-left", "left", "up-left", "up"]);
  for (const d of dirs) assert.equal(KICK_POSE_AUTHORED_FRAMES[d].length, 5);
  // The 25 frames of the pack, used exactly once each.
  const all = dirs.flatMap((d) => [...KICK_POSE_AUTHORED_FRAMES[d]]).sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 25 }, (_, i) => i));
});

test("the built P002PLYK manifest record matches the authored clip 8", () => {
  const manifest = JSON.parse(readFileSync("web/assets/manifest.json", "utf8"));
  const rec = manifest.npcs.find((n) => n.id === KICK_POSE_SPRITE);
  assert.ok(rec, "p002plyk missing from the manifest");
  const clip = rec.clips[String(KICK_POSE_CLIP)];
  assert.ok(clip, "clip 8 missing from p002plyk");
  assert.deepEqual(Object.keys(clip).sort(),
    Object.keys(KICK_POSE_AUTHORED_FRAMES).sort());
  for (const d of Object.keys(clip)) {
    assert.deepEqual(clip[d].durations, [...KICK_POSE_FRAME_TICKS], d);
    assert.equal(clip[d].cols.length, 5, d);
  }
});

test("mode 0x49 runs the full clip, then returns to the standing clip", () => {
  const p = startKickPose();
  assert.equal(p.clip, KICK_POSE_CLIP);
  for (let t = 1; t < KICK_POSE_TICKS; t++) {
    assert.equal(tickKickPose(p), false, `tick ${t}`);
    assert.equal(p.clip, KICK_POSE_CLIP);
    assert.equal(p.finished, false);
  }
  assert.equal(tickKickPose(p), true);
  assert.equal(p.clip, KICK_POSE_IDLE_CLIP);
  assert.equal(p.finished, true);
  // Idempotent afterwards — the mode is gone.
  assert.equal(tickKickPose(p), false);
});

test("input is held for the body's 31 ticks, not the burst's 28", () => {
  const s = startTreeKick(0, 4);
  const ctx = { count: 16, liveIndex: 8, liveX: 0, liveY: 0, kickedX: 0, kickedY: 0 };
  assert.equal(treeKickHoldsInput(s), true);
  let held = 0;
  for (let f = 0; f < 200 && !s.done; f++) {
    tickTreeKick(s, ctx, () => 0);
    if (treeKickHoldsInput(s)) held = f + 1;
  }
  assert.equal(held, KICK_POSE_TICKS - 1); // the entry tick is the 31st
  assert.equal(treeKickHoldsInput(null), false);
});
