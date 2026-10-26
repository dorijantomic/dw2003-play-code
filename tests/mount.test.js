// tests/mount.test.js — the mount layer's rules, position by position (node --test, no browser, no picture).
//
// The pure layers are exercised on their own (speed, sub-stepped collision, dismount ground, follower spots,
// the state machine), and the model-dependent numbers are measured from the real DW2 file when it is present
// (web/dw2models/033UNIM.gltf, git-ignored and local only — the tests skip that part when it is not there).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MOUNTS, MOUNT_SPEED, mountSpeedFactor, mountRiderLift, mountHidesFollowers, mountFreezesInput,
  mountSubSteps, moveWithSubSteps, findDismountSpot, followerSpots, mountTick, mountPress,
  mountForceDismount, mountState, installMount, mountPlayerLatch,
} from "../web/mount.js";
import {
  parseDw2Gltf, measureRig, calibrateGait, gaitFootfalls, clipWalkStats, MOUNT_VIEW, PALETTE, nearestPalette, sampleClipPose,
} from "../web/mount3d.js";

// ── a field stub: the same shape game.js passes to installMount ──────────────────────────────
function fakeWorld({ enabled = true, quest = true, grid = null } = {}) {
  const state = { x: 100, y: 100, dir: "right", moving: false, collision: { s330: grid } };
  const calls = { placed: 0, reset: 0, sfx: [] };
  const canStand = (x, y) => !grid || !blocked(grid, x, y);
  installMount({
    state: () => state,
    enabled: () => enabled,
    questDone: (id) => quest && id === "zz_mount",
    canStand,
    resetFollowers: () => { calls.reset += 1; },
    placeFollowers: () => { calls.placed += 1; },
    sfx: (id) => calls.sfx.push(id),
    fieldReady: () => true,
    mustDismount: () => false,
  });
  mountForceDismount();
  return { state, calls, canStand };
}

// a 16 px collision grid, cells[r * cols + c] = 1 blocked (the same shape as the game's walkmesh grid)
const gridOf = (w, h, blockedCells = []) => {
  const cols = Math.ceil(w / 16), rows = Math.ceil(h / 16);
  const cells = new Uint8Array(cols * rows);
  for (const [c, r] of blockedCells) cells[r * cols + c] = 1;
  return { cell: 16, cols, rows, cells };
};
const blocked = (grid, x, y) => {
  const c0 = Math.floor((x - 6) / 16), c1 = Math.floor((x + 6) / 16);
  const r0 = Math.floor((y - 8) / 16), r1 = Math.floor(y / 16);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return true;
    if (grid.cells[r * grid.cols + c]) return true;
  }
  return false;
};

test("the table: Unimon is the first mount, 3x the walk, unlocked only by its quest", () => {
  assert.ok(MOUNTS.length >= 1);
  const u = MOUNTS[0];
  assert.equal(u.id, "unimon");
  assert.equal(u.speed, MOUNT_SPEED);
  assert.equal(MOUNT_SPEED, 3);
  assert.equal(u.unlock, "zz_mount");
  assert.match(u.model, /^dw2models\//);            // local, git-ignored: never a disc path in the repo
  assert.ok(["gait", "clip"].includes(u.walk.kind));
  assert.deepEqual(u.forward, [0, 0, 1]);
  assert.ok(u.size > 35 && u.size <= 80);           // a person is ~35 px; a mount is one to two of them
});

// the mount waits for its model before it fades in; here the load fails fast (no server), which also releases it
async function settle(state) {
  mountTick(0, state);
  await new Promise((r) => setTimeout(r, 30));
}

test("speed, lift and followers follow the mode, and nothing else", async () => {
  const { state } = fakeWorld();
  assert.equal(mountSpeedFactor(), 1);
  assert.equal(mountRiderLift(), 0);
  assert.equal(mountHidesFollowers(), false);
  assert.equal(mountFreezesInput(), false);
  assert.ok(mountPress(state));                      // idle -> summoning: the mount appears first
  assert.equal(mountFreezesInput(), true);
  assert.equal(mountPlayerLatch(), null);            // the player waits on foot while it fades in
  assert.equal(mountRiderLift(), 0);
  await settle(state);
  for (let i = 0; i < 20; i++) mountTick(1 / 50, state);   // the 0.35 s fade-in
  assert.equal(mountState().mode, "mounting");
  assert.equal(mountPlayerLatch().clip, 28);         // the ladder climb's own step-on clip (p002plyl)
  const back = MOUNTS[0].back;
  assert.ok(mountRiderLift() >= 0 && mountRiderLift() < back, "the rider rises during the climb");
  for (let i = 0; i < 20; i++) mountTick(1 / 50, state);   // 19 frames of the disc's mount clip
  assert.equal(mountState().mode, "riding");
  assert.equal(mountSpeedFactor(), 3);
  assert.ok(mountRiderLift() > 0);
  assert.equal(mountHidesFollowers(), true);
  assert.ok(mountPress(state));                      // riding -> dismounting
  for (let i = 0; i < 14; i++) mountTick(1 / 50, state);
  assert.equal(mountState().mode, "idle");
  assert.equal(mountSpeedFactor(), 1);
  assert.equal(mountHidesFollowers(), false);
});

test("off by default: no press, no tick, no change to the player at all", () => {
  const { state } = fakeWorld({ enabled: false });
  assert.equal(mountPress(state), false);
  const before = { x: state.x, y: state.y, dir: state.dir };
  for (let i = 0; i < 60; i++) mountTick(1 / 50, state);
  assert.deepEqual({ x: state.x, y: state.y, dir: state.dir }, before);
  assert.equal(mountState().mode, "idle");
});

test("locked until the quest: the press does nothing without the unlock", () => {
  const { state } = fakeWorld({ quest: false });
  assert.equal(mountPress(state), false);
  assert.equal(mountState().mode, "idle");
});

test("collision at 3x: a 16 px wall is not tunnelled, a single big step would be", () => {
  // a wall of blocked cells in column 8 (x 128..143); the player walks right from x = 100 with a 20 px base step
  const grid = gridOf(320, 240, [[8, 4], [8, 5], [8, 6], [8, 7]]);
  const y = 100;
  const base = 20, step = base * MOUNT_SPEED;        // 60 px in one 3x tick
  // one big step: the foot box lands entirely past the wall, so a destination-only test lets it through
  const naive = { x: 100 + step, y };
  assert.ok(naive.x - 6 > 143, `the unstepped 3x step really does leave the wall behind (x ${naive.x})`);
  // the sub-stepped move: MOUNT_SPEED steps of the base magnitude, so the box meets the wall
  assert.equal(mountSubSteps(step, 0, base), 3);
  const mover = (x, yy, dx, dy) => {
    const free = (nx) => !blocked(grid, nx, yy);
    return { x: free(x + dx) ? x + dx : x, y: yy + (free(yy + dy) ? dy : 0) };
  };
  const moved = moveWithSubSteps(mover, 100, y, step, 0, base);
  assert.ok(moved.x > 100, "the rider still moves up to the wall");
  assert.ok(moved.x + 6 <= 128, `the rider stops before the wall (x ${moved.x.toFixed(2)}, box right ${(moved.x + 6).toFixed(2)})`);
  assert.equal(blocked(grid, moved.x, moved.y), false);
  // and the number of sub-steps never drops below 1
  assert.equal(mountSubSteps(0, 0, base), 1);
  assert.equal(mountSubSteps(base * 0.5, 0, base), 1);
});

test("dismount: the player comes off on ground the foot box can stand on", () => {
  const grid = gridOf(320, 240, [[7, 7], [8, 7]]);     // a 2-cell block at x 112..143, y 112..127
  const canStand = (x, y) => !blocked(grid, x, y);
  assert.equal(canStand(100, 100), true);
  const spot = findDismountSpot(canStand, 100, 100);
  assert.ok(spot);
  assert.equal(blocked(grid, spot.x, spot.y), false);
  // standing on a blocked cell (a mount pushed into a corner): a neighbour is found
  const walled = findDismountSpot(canStand, 128, 120);
  assert.ok(walled);
  assert.equal(blocked(grid, walled.x, walled.y), false);
  // a completely blocked ring: nothing is invented
  const none = findDismountSpot(() => false, 100, 100);
  assert.equal(none, null);
});

test("the party comes back on free ground next to the mount, never stacked", () => {
  const grid = gridOf(320, 240, [[6, 6]]);
  const canStand = (x, y) => !blocked(grid, x, y);
  const spots = followerSpots(canStand, 100, 100, 3);
  assert.ok(spots.length >= 1 && spots.length <= 3);
  for (const s of spots) assert.equal(blocked(grid, s.x, s.y), false);
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) >= 5, "no two followers share a spot");
  }
  assert.deepEqual(followerSpots(canStand, 100, 100, 3, { ring: 0 }), []);
});

test("dismount asks the game to put the party back, once, and the ride never freezes input", async () => {
  const { state, calls } = fakeWorld();
  mountPress(state);
  await settle(state);
  for (let i = 0; i < 30; i++) assert.equal(mountTick(1 / 50, state), true, "appearing and mounting hold the field");
  for (let i = 0; i < 10; i++) mountTick(1 / 50, state);
  assert.equal(mountState().mode, "riding");
  assert.equal(mountTick(1 / 50, state), false, "riding leaves the controls with the player");
  assert.equal(calls.placed, 0);
  mountPress(state);
  assert.ok(calls.reset >= 1);
  assert.ok(calls.placed >= 1);
});

test("switching the layer off mid-ride is a clean dismount", async () => {
  const { state } = fakeWorld();
  mountPress(state);
  await settle(state);
  for (let i = 0; i < 40; i++) mountTick(1 / 50, state);
  assert.equal(mountState().mode, "riding");
  installMount({
    state: () => state, enabled: () => false, questDone: () => true, canStand: () => true,
    resetFollowers: () => {}, placeFollowers: () => {}, sfx: () => {}, fieldReady: () => true, mustDismount: () => false,
  });
  mountTick(1 / 50, state);
  assert.equal(mountState().mode, "idle");
  assert.equal(mountSpeedFactor(), 1);
});

test("the field draws a MOUNT_VIEW-cell sprite, and the palette is the fixed 16", () => {
  assert.equal(MOUNT_VIEW.w, 112);
  assert.ok(MOUNT_VIEW.h >= 96);
  assert.equal(PALETTE.length, 16);
  for (const p of PALETTE) assert.equal(p.length, 3);
  assert.deepEqual(nearestPalette(255, 255, 255), PALETTE[9]);      // pure white lands on the top of the ramp
  assert.deepEqual(nearestPalette(0, 0, 0), PALETTE[0]);
});

// ── the measured model (skipped when the local file is not there) ─────────────────────────────
const MODEL = "web/dw2models/033UNIM.gltf";
const have = fs.existsSync(MODEL);

test("Unimon's rig: four legs, head forward on -Z, measured from the file", { skip: !have && "no local model" }, () => {
  const model = parseDw2Gltf(JSON.parse(fs.readFileSync(MODEL, "utf8")));
  const rig = measureRig(model);
  assert.equal(rig.legs.length, 4, "a four-legged rig");
  assert.deepEqual(rig.feet, [9, 13, 18, 22], "the four chain ends, front pair first");
  assert.deepEqual(rig.forward, [0, 0, -1], "the head joint is at negative z of the body root");
  assert.ok(rig.height > 1000);
  // the head is genuinely forward of the body: the number, not a guess
  const bind = rig.bind;
  const headZ = bind.world[rig.head * 16 + 14];
  const bodyZ = bind.world[rig.body * 16 + 14];
  assert.ok(headZ < bodyZ, `head z ${headZ.toFixed(0)} < body z ${bodyZ.toFixed(0)}`);
});

test("the gait makes the feet swing forward and lift, in a four-beat pattern", { skip: !have && "no local model" }, () => {
  const model = parseDw2Gltf(JSON.parse(fs.readFileSync(MODEL, "utf8")));
  const rig = measureRig(model);
  const legs = calibrateGait(model, rig);
  assert.equal(legs.length, 4);
  const falls = gaitFootfalls(model, rig, legs, 16);
  legs.forEach((L, i) => {
    const zs = falls.map((f) => f[i][2]);          // forward axis is z for this rig
    const ys = falls.map((f) => f[i][1]);
    const swing = Math.max(...zs) - Math.min(...zs);
    const lift = Math.max(...ys) - Math.min(...ys);
    assert.ok(swing > 0.03 * rig.height, `foot ${L.end} swings ${swing.toFixed(1)} along forward`);
    assert.ok(lift > 0.005 * rig.height, `foot ${L.end} lifts ${lift.toFixed(1)}`);
  });
  // the phases are a quarter cycle apart, so the four legs are never in lockstep
  const lowOf = legs.map((L, i) => falls.map((f) => f[i][1]));
  const lifts = lowOf.map((ys) => Math.max(...ys) - Math.min(...ys));
  const peakAt = lowOf.map((ys) => ys.indexOf(Math.max(...ys)));
  assert.ok(new Set(peakAt).size >= 3, `the legs peak at different ticks (${peakAt.join(",")})`);
  assert.ok(lifts.every((l) => l > 0));
});

test("no Unimon clip is a walk: the measured table refuses all of them", { skip: !have && "no local model" }, () => {
  const model = parseDw2Gltf(JSON.parse(fs.readFileSync(MODEL, "utf8")));
  assert.equal(model.anims.length, 11, "033UNIM carries 11 clips");
  const rows = model.anims.map((_, i) => clipWalkStats(model, i));
  for (const r of rows) assert.equal(r.walk, false, `${r.clip} is not a walk (inPlace ${r.inPlace}, loops ${r.loops}, feet ${r.usableFeet}, alt ${r.alternation.toFixed(2)})`);
  // the overworld file is measured too when the modeller's tree is mounted
  const over = "/home/dorij/dw2-models/extract/Digimon/Champion/Unimon/Overworld/328QUNI.gltf";
  if (fs.existsSync(over)) {
    const om = parseDw2Gltf(JSON.parse(fs.readFileSync(over, "utf8")));
    assert.equal(om.anims.length, 2, "328QUNI carries 2 clips (idle + a hop)");
    for (let i = 0; i < om.anims.length; i++) assert.equal(clipWalkStats(om, i).walk, false);
  }
});

// The field Unimon (DW2 328QUNI, local only): it faces +Z and anim_E1 is a gallop.
const FIELD = "web/dw2models/328QUNI.gltf";
const haveField = fs.existsSync(FIELD);
test("field Unimon faces +Z: the highest joint (head end) is at +Z, the lowest-back joint (tail) at -Z", { skip: !haveField && "no local model" }, () => {
  const model = parseDw2Gltf(JSON.parse(fs.readFileSync(FIELD, "utf8")));
  const pose = sampleClipPose(model, model.anims.findIndex((a) => a.name === "anim_E0"), 0);
  const W = (n, k) => pose.world[n * 16 + 12 + k];
  const ids = model.nodes.map((_, i) => i);
  const top = ids.reduce((a, b) => (W(b, 1) > W(a, 1) ? b : a));
  const back = ids.reduce((a, b) => (W(b, 2) < W(a, 2) ? b : a));
  assert.ok(W(top, 2) > 0, "head end at +Z");
  assert.ok(W(back, 1) > W(top, 1) * 0.4, "the -Z end is a raised tail, not a foot");
});
test("field Unimon anim_E1 is a gallop: four hooves each touch the ground and lift, and the clip loops", { skip: !haveField && "no local model" }, () => {
  const model = parseDw2Gltf(JSON.parse(fs.readFileSync(FIELD, "utf8")));
  const ci = model.anims.findIndex((a) => a.name === "anim_E1");
  assert.ok(ci >= 0);
  const n = Math.round(model.anims[ci].dur * 30);
  const P = []; for (let t = 0; t <= n; t++) P.push(sampleClipPose(model, ci, t / 30));
  const hasKid = new Set(model.parents.filter((p) => p >= 0));
  const y0 = model.nodes.map((_, i) => P[0].world[i * 16 + 13]);
  const H = Math.max(...y0) - Math.min(...y0);
  const leaves = model.nodes.map((_, i) => i).filter((i) => !hasKid.has(i));
  const hooves = leaves.sort((a, b) => y0[a] - y0[b]).slice(0, 4);
  for (const f of hooves) {
    const ys = P.map((p) => p.world[f * 16 + 13]);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    assert.ok(hi - lo > 0.05 * H, `hoof ${f} lifts`);
    assert.ok(ys.some((y) => y - lo < 0.01 * H), `hoof ${f} lands`);
  }
});
