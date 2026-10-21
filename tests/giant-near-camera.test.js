// A5 — the GIANT near-camera fit: a big partner standing on OUR side must be framed whole.
//
// The disc never stages an enemy-only species (or a new partner's form) on the near side, so there
// is no near camera of its own: playerNearCamera lends it the twelve shots of the closest partner
// (fitNearCamera). Those shots are close, and at a 12k-unit body they frame legs and torso only —
// in the real battle the player cannot see the attack the model performs (anim-a4.md "Camera").
// fitGiantNearCamera refits a cropping shot: aim at the body's own centre, lift the eye toward its
// top, pull back along the reference's azimuth and widen the lens only as far as needed, with the
// opposing fighter kept on screen where the reference shot had it.
//
// These tests pin the three things that matter:
//   1. a small model — and any shot the reference already frames — is returned UNTOUCHED;
//   2. for a giant, every shot puts the whole rest-pose body (and a target the reference shot
//      showed) inside the 4:3 view;
//   3. the refit stays inside its caps (no shot flies off, the eye only ever rises).
import test from "node:test";
import assert from "node:assert/strict";

const {
  fitGiantNearCamera, giantShotFor, shotBodyBounds, shotPointNdc,
  GIANT_FRAME_FILL, GIANT_H_MIN, GIANT_PULL_MAX,
} = await import("../web/battle3d.js");

const SLOT = { x: 0, y: 0, z: -6400 };         // our near slot, PS1 units, Y down
const ENEMY = [0, -1200, 7296];                // the opposing fighter's centre (its slot, mid-height)
const GIANT = { h: 12100, w: 5820 };           // Raijinmon-sized body

// Twelve near shots shaped like a partner's own table: five arena/attack shots from behind and
// below our fighter, one very wide one, two close reaction shots from the enemy's side, and the
// four op5 preset shots. Authored numbers, not extracted data.
const CAM = {
  eye: [
    [-5800, -3400, -11400], [-5800, -3400, -11400], [-5800, -3400, -11400],
    [-5400, -2900, -11600], [-5400, -2300, -11600], [-16000, -1600, -20000],
    [-2800, -4300, -2300], [-30, -5800, -500],
    [-4800, -2100, 3200], [1200, -4200, 4900], [0, -800, 3400], [0, -10900, 9000],
  ],
  look: [
    [2000, -2800, 4600], [2000, -2800, 4600], [2000, -2800, 4600],
    [1400, -4100, 4900], [1400, -5000, 4900], [0, -9300, 0],
    [0, -6100, -5400], [250, -5000, -4900],
    [1200, -3800, -5000], [0, -4200, -5400], [0, -3900, -5400], [0, -3500, -5400],
  ],
  view: [226, 226, 226, 200, 200, 280, 226, 226, 226, 280, 226, 280],
};

const shotAt = (cam, i) => ({ eye: cam.eye[i], target: cam.look[i], H: cam.view[i] });
const eps = 1e-6;

test("the giant band is the gate that keeps small partners' framing", async () => {
  // playerNearCamera only reaches fitGiantNearCamera for a model in ANIM_GIANTS; a partner with
  // its own twelve shots (Gallantmon) returns its own record before that, and a small extra never
  // opens the gate, so its shots are the fitted reference's, byte for byte.
  const { isGiant } = await import("../web/fight/anim-donor-map.js");
  assert.equal(isGiant("m032kune"), false);     // Kunemon — small, untouched
  assert.equal(isGiant("m369duke"), false);     // Gallantmon — authored near side, own camera
  assert.equal(isGiant("m441raiz"), true);      // Raijinmon
  assert.equal(isGiant("m115muge"), true);      // Machinedramon
});

test("a giant's every near shot frames the whole body", () => {
  const r = fitGiantNearCamera(CAM, SLOT, GIANT, ENEMY);
  assert.equal(r.changed, true);
  for (let i = 0; i < CAM.eye.length; i++) {
    const b = shotBodyBounds(shotAt(r.cam, i), SLOT, GIANT, null);
    assert.equal(b.behind, 0, `shot ${i}: a body corner is behind the eye`);
    assert.ok(b.fill <= GIANT_FRAME_FILL + eps, `shot ${i}: body fills ${b.fill.toFixed(2)} of the frame`);
  }
});

test("the target the reference shot showed stays on screen", () => {
  const r = fitGiantNearCamera(CAM, SLOT, GIANT, ENEMY);
  for (let i = 0; i < CAM.eye.length; i++) {
    const before = shotPointNdc(shotAt(CAM, i), ENEMY);
    if (!before || Math.abs(before.x) > 1 || Math.abs(before.y) > 1) continue;   // not shown -> no promise
    const after = shotPointNdc(shotAt(r.cam, i), ENEMY);
    assert.ok(after, `shot ${i}: the enemy ended up behind the camera`);
    assert.ok(Math.abs(after.x) <= 1 && Math.abs(after.y) <= 1,
      `shot ${i}: enemy at ${after.x.toFixed(2)},${after.y.toFixed(2)}`);
  }
});

test("every refit stays inside the pull and lens caps, and the eye only rises", () => {
  const r = fitGiantNearCamera(CAM, SLOT, GIANT, ENEMY);
  r.shots.forEach((s, i) => {
    if (!s) return;
    assert.ok(s.pull >= 1 - eps && s.pull <= GIANT_PULL_MAX + eps, `shot ${i}: pull ${s.pull}`);
    assert.ok(s.H >= Math.min(GIANT_H_MIN, CAM.view[i]) - eps, `shot ${i}: H ${s.H}`);
    assert.ok(s.eye[1] <= CAM.eye[i][1] + eps, `shot ${i}: the eye dropped below the reference's`);
    assert.ok(s.lift >= 0 && s.lift <= 1, `shot ${i}: lift ${s.lift}`);
  });
});

test("a shot the reference already frames is left exactly as it was", () => {
  const far = { eye: [[0, -6000, -30000]], look: [[0, -6000, 4000]], view: [280] };
  const fit = giantShotFor(shotAt(far, 0), SLOT, GIANT, null);
  assert.equal(fit.changed, false);
  assert.deepEqual(fit.eye, far.eye[0]);
  assert.equal(fit.H, 280);
});

test("the fit holds on a wider canvas too", () => {
  const r = fitGiantNearCamera(CAM, SLOT, GIANT, ENEMY, { aspect: 4 / 3 });
  for (let i = 0; i < CAM.eye.length; i++) {
    const b = shotBodyBounds(shotAt(r.cam, i), SLOT, GIANT, null, 16 / 9);
    assert.ok(b.fill <= GIANT_FRAME_FILL + eps, `shot ${i}: ${b.fill.toFixed(2)} at 16:9`);
  }
});

test("a taller body never ends up less framed than a shorter one", () => {
  const taller = { h: GIANT.h * 1.3, w: GIANT.w };
  const r = fitGiantNearCamera(CAM, SLOT, taller, ENEMY);
  for (let i = 0; i < CAM.eye.length; i++) {
    const b = shotBodyBounds(shotAt(r.cam, i), SLOT, taller, null);
    assert.ok(b.fill <= GIANT_FRAME_FILL + eps, `shot ${i}: ${b.fill.toFixed(2)}`);
  }
});
