// The ambient point-sprite tick (fieldstg F0x80089038) and its gates, plus the
// stage-entry MODE writer the ordinary route was missing (wstag421's actor).
//
// Every number and clause asserted here comes from the original assembly in
// ~/ddw3/asm/dw2003/pro/fieldstg.s (file 0x6388-0x67dc) and wstag421.s
// (file 0x38-0x98), cross-checked against the canonical decode
// docs/research/field/point-sprite-ambient-system.md.  The point of the file is
// that a future edit cannot quietly drop a gate the disc applies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  pointRecordInView,
  pointRecordLive,
  tickPointSpriteRecords,
  applyPointModeGates,
  pointModeGatesFor,
  loadPointRecordActors,
} from "../web/vendor/engine.js";

const ROOT = resolve(import.meta.dirname, "..");
const read = (rel) => JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
const points = read("web/assets/data/point_sprites.json");
const actorTable = read("web/assets/data/point_record_actors.json");

// A record as point_sprites.json carries it, with the fields the tick reads.
const rec = (over = {}) => ({
  size: 74, atlasFlag: 0, atlas: "stage", active: 1, mode: 1,
  min: 0, max: 3, period: 6, x: 441, y: 290, ysort: 0, ...over,
});
const rt = () => ({ sprite: 0, ctr: 0, dir: 1, timer: 0 });

// ── the camera cull (fieldstg file 0x64f4-0x6550) ───────────────────────────
test("the cull is the disc's four comparisons against the layer's screen rect", () => {
  const view = { x: 400, y: 200, w: 320, h: 240 }; // x0=400 y0=200 w=320 h=240
  const r = rec({ x: 500, y: 300, size: 74 });
  assert.equal(pointRecordInView(r, 500, 300, view), true, "inside");
  // low side widened by the record's size: X >= x0 - size, Y >= y0 - size
  assert.equal(pointRecordInView(r, 400 - 74, 300, view), true, "at the low edge");
  assert.equal(pointRecordInView(r, 400 - 75, 300, view), false, "one px past it");
  assert.equal(pointRecordInView(r, 500, 200 - 74, view), true, "top edge");
  assert.equal(pointRecordInView(r, 500, 200 - 75, view), false);
  // high side is NOT widened: X <= x0 + w, Y <= y0 + h
  assert.equal(pointRecordInView(r, 400 + 320, 300, view), true, "at the high edge");
  assert.equal(pointRecordInView(r, 400 + 321, 300, view), false, "one px past it");
  assert.equal(pointRecordInView(r, 500, 200 + 240, view), true);
  assert.equal(pointRecordInView(r, 500, 200 + 241, view), false);
  // no view (a caller with no camera) passes everything
  assert.equal(pointRecordInView(r, -9999, -9999, null), true);
});

test("a FIELDCOM record is tested at (X-0x32, Y-0x64), and only for the cull", () => {
  const view = { x: 400, y: 200, w: 320, h: 240 };
  const size = 74;
  // At the raw low edge the plain record passes and the FIELDCOM one is culled,
  // because its test point sits 0x32 left of its anchor.
  const plain = rec({ atlas: "stage", x: 400 - size, y: 300 });
  assert.equal(pointRecordInView(plain, plain.x, plain.y, view), true);
  const fc = rec({ atlas: "fieldcom", atlasFlag: 0xff, x: 400 - size, y: 300 });
  assert.equal(pointRecordInView(fc, fc.x, fc.y, view), false);
  // one 0x32 further right and the FIELDCOM record passes again
  const fc2 = rec({ atlas: "fieldcom", atlasFlag: 0xff, x: 400 - size + 0x32, y: 300 });
  assert.equal(pointRecordInView(fc2, fc2.x, fc2.y, view), true);
  // Y's adjustment is 0x64: at the raw top edge the FIELDCOM record is culled
  const fcy = rec({ atlas: "fieldcom", atlasFlag: 0xff, x: 500, y: 200 - size });
  assert.equal(pointRecordInView(fcy, fcy.x, fcy.y, view), false);
  const fcy2 = rec({ atlas: "fieldcom", atlasFlag: 0xff, x: 500, y: 200 - size + 0x64 });
  assert.equal(pointRecordInView(fcy2, fcy2.x, fcy2.y, view), true);
});

// ── the tick's two gates (fieldstg file 0x64bc, 0x64f4) ─────────────────────
test("an off-screen record does NOT advance (the disc freezes its phase)", () => {
  const records = [rec({ x: 441, y: 290 })];
  const state = [rt()];
  const view = { x: 1000, y: 1000, w: 320, h: 240 };
  tickPointSpriteRecords(records, state, { view });
  assert.equal(state[0].sprite, 0, "culled: sprite unchanged");
  assert.equal(state[0].timer, 0, "culled: timer untouched");
  // and it comes back alive the moment it is in view
  tickPointSpriteRecords(records, state, { view: { x: 400, y: 200, w: 320, h: 240 } });
  assert.equal(state[0].sprite, 1, "in view: the mode-1 advance happens");
  assert.equal(state[0].timer, 6 << 8, "and the timer reloads period<<8");
});

test("an inactive record does not advance either", () => {
  const records = [rec({ active: 0 })];
  const state = [rt()];
  tickPointSpriteRecords(records, state, { view: null });
  assert.equal(state[0].sprite, 0, "record+0 == 0: the disc's first skip");
});

test("the tick reads the LIVE active/mode bytes, not only the ROM table", () => {
  const records = [rec({ mode: 1 })];
  const state = [rt()];
  // The interpreter's own table on a native stage: the overlay switched the
  // record off (or re-moded it) -- F0x80089038 dispatches on these bytes.
  tickPointSpriteRecords(records, state, { activeOverride: [0], liveMode: [1] });
  assert.equal(state[0].sprite, 0, "live active 0 freezes it");
  tickPointSpriteRecords(records, state, { activeOverride: [1], liveMode: [0] });
  assert.equal(state[0].sprite, 0, "live mode 0 draws without animating");
  tickPointSpriteRecords(records, state, { activeOverride: [1], liveMode: [1] });
  assert.equal(state[0].sprite, 1, "live mode 1 animates");
});

test("the mode dispatch and timer are the disc's (period<<8, -0x100 per frame)", () => {
  // mode 2 advances ctr: one advance per period+1 frames (the timer is loaded
  // period<<8 and 0x100 is taken per frame before the expiry test)
  const m2 = [rec({ mode: 2, min: 0, max: 3, period: 1 })];
  const s2 = [rt()];
  for (let f = 0; f < 4; f++) tickPointSpriteRecords(m2, s2, {});
  assert.equal(s2[0].ctr, 2, "two advances in four frames at period 1");
  const m3 = [rec({ mode: 3, min: 0, max: 2, period: 0 })];
  const s3 = [rt()];
  const seen = [];
  for (let f = 0; f < 9; f++) { tickPointSpriteRecords(m3, s3, {}); seen.push(s3[0].ctr); }
  assert.deepEqual(seen, [1, 2, 1, 0, 1, 2, 1, 0, 1], "the ping-pong triangle");
});

// ── the stage-entry mode writer (wstag421.s file 0x38-0x98) ─────────────────
test("the s421 mode-gate row is in the mined table", () => {
  const rows = actorTable.modeGates;
  assert.ok(Array.isArray(rows) && rows.length === 1, "one mode-gate row");
  assert.deepEqual(
    { stage: rows[0].stage, tag: rows[0].tag, flag: rows[0].flag },
    { stage: "s421", tag: 1, flag: 0x1a0a },
    "Qing Long City's actor: tag 1 follows flag 0x1a0a",
  );
  // The shipped table's tag-1 records are the 19 windmills/fans the decode
  // counted, and every one ships mode 1 -- which is why the walker spun them
  // whatever the flag said.
  const tag1 = points.s421.records.filter((r) => r.atlasFlag === 1);
  assert.equal(tag1.length, 19);
  assert.deepEqual([...new Set(tag1.map((r) => r.mode))], [1]);
});

test("the gate writes mode = get_flag(flag) on every tagged record", () => {
  loadPointRecordActors(actorTable);
  const records = points.s421.records;
  const state = records.map(() => ({ ...rt(), mode: undefined }));
  const gates = pointModeGatesFor("s421");
  assert.equal(gates.length, 1);
  const tag1 = records.map((r, i) => (r.atlasFlag === 1 ? i : -1)).filter((i) => i >= 0);
  const others = records.map((r, i) => (r.atlasFlag !== 1 ? i : -1)).filter((i) => i >= 0);
  assert.equal(tag1.length, 19);
  applyPointModeGates(records, state, gates, () => 0);
  assert.deepEqual([...new Set(tag1.map((i) => state[i].mode))], [0],
    "flag clear: every tagged record freezes");
  assert.deepEqual([...new Set(others.map((i) => state[i].mode))], [undefined],
    "untagged records untouched");
  applyPointModeGates(records, state, gates, () => 1);
  assert.deepEqual([...new Set(tag1.map((i) => state[i].mode))], [1],
    "flag set: every tagged record spins");
});

test("with the gate applied the tick freezes Qing Long City's windmills", () => {
  loadPointRecordActors(actorTable);
  const records = points.s421.records;
  const windmill = records.findIndex((r) => r.atlasFlag === 1 && r.mode === 1);
  assert.ok(windmill >= 0);
  const make = (flag) => {
    const state = records.map((r) => ({ ...rt(), sprite: r.spriteId, mode: undefined }));
    applyPointModeGates(records, state, pointModeGatesFor("s421"), () => flag);
    // one in-view frame: the windmills sit inside a camera rect around them
    const view = { x: 400, y: 100, w: 700, h: 500 };
    tickPointSpriteRecords(records, state, { view });
    return state[windmill];
  };
  const off = make(0);
  assert.equal(off.sprite, 0, "flag clear: the blade does not advance");
  assert.equal(off.timer, 0, "and its timer never runs");
  const on = make(1);
  assert.equal(on.sprite, 1, "flag set: the blade advances");
  assert.equal(on.timer, records[windmill].period << 8);
});

test("pointRecordLive resolves interpreter > actor runtime > ROM", () => {
  const r = rec({ x: 10, y: 20, active: 1, mode: 2 });
  assert.deepEqual(
    pointRecordLive(r, { ...rt(), active: 0, x: 99, mode: 0 }, {}, 0),
    { active: 0, x: 99, y: 20, ysort: 0, mode: 0 },
    "the runtime's own writes win over the ROM",
  );
  assert.equal(
    pointRecordLive(r, { ...rt(), active: 0 }, { activeOverride: [1], liveMode: [1] }, 0).active,
    1,
    "the interpreter's bytes win over everything (a native stage)",
  );
  assert.equal(
    pointRecordLive(r, { ...rt(), x: 99 }, { actorPos: [{ x: 7, y: 8, ysort: 9 }] }, 0).x,
    7,
    "an actor position patch wins over the runtime's x",
  );
});

test("the gates' edge cases stay dormant in the shipped data", () => {
  // The disc's mode dispatch has no max==0 guard and wraps sprite/ctr values
  // through 0xff; no shipped record exercises either, so the walker's guards
  // (and the 255-wrap corner) are inert rather than live divergences.
  let animated = 0;
  for (const [stage, s] of Object.entries(points)) {
    for (const r of s.records) {
      if (!(r.mode >= 1 && r.mode <= 3)) continue;
      animated++;
      assert.ok(r.max > 0, `${stage}: animated record with max 0`);
      assert.ok(r.max < 255 && r.min < 255, `${stage}: the 255 wrap is reachable`);
    }
  }
  assert.ok(animated > 6000, `the census covers the animated records (${animated})`);
});

// ── the wiring ──────────────────────────────────────────────────────────────
test("web/effects.js routes the tick and the draw through the engine's gates", () => {
  const src = readFileSync(resolve(ROOT, "web/effects.js"), "utf8");
  assert.ok(src.includes("tickPointSpriteRecords(records, rt, f)"),
    "the frame tick is the engine's gated step");
  assert.ok(src.includes("pointRecordInView(r, live.x, live.y, f.view)"),
    "the draw applies the same cull");
  assert.ok(src.includes("pointRecordLive(r, rt[i], f, i)"),
    "the draw resolves the same live state");
  assert.ok(src.includes("applyPointModeGates(s.records, rt, gates, readFlag)"),
    "the stage-entry mode gates run on the ordinary route");
  assert.ok(src.includes("const gates = pointModeGatesFor(stageId);"),
    "the gate rows are looked up per prepared frame, so a retained runtime "
    + "still follows a flag set while the player was away");
  // and the game hands the camera window to both passes
  const game = readFileSync(resolve(ROOT, "web/game.js"), "utf8");
  assert.ok(game.includes("drawEffectsUnderMap(ctx, m.id, camX, camY, VIEW_W / ZOOM, VIEW_H / ZOOM)"));
  assert.ok(game.includes("drawEffects(ctx, m.id, camX, camY, drawables, VIEW_W / ZOOM, VIEW_H / ZOOM)"));
});
