// The arena's own depth write must not reject the fighters drawn after it.
//
// REGRESSION (2026-10-07): the arena fix (worker E) turned on depth writes for the arena so its
// (page,CLUT) texture groups would depth-sort like the original's ordering table — the "flat blue
// rectangular patches" fix. But the Digimon are drawn AFTER the arena and depth-test with LEQUAL,
// so they then depth-test against the arena's freshly written depth. The arena is drawn through a
// 60000-far projection and the ordinary fighters through an 8000-far one, so at the SAME world
// point the fighter's window depth is a hair LARGER (farther) than the arena's and LEQUAL throws
// the fighter fragment away: a standing fighter lost its legs and a DOWNED fighter (lying at floor
// level) vanished. MEASURED on the live renderer (Battle Lab, arena 1 loaded, pinned render(0)):
// enemy silhouette 5148 px shipped vs 20770 px with the arena depth write off; DOWNED enemy
// 0 px shipped vs 10986 px with it off. See
// .dw3-research/fighter-depth-regression-2026-10-07/worker-u.md.
//
// The fix keeps BOTH properties: the arena still depth-sorts inside its own pass (its order is
// resolved on the colour buffer), then the depth it wrote is CLEARED so the fighters/effects start
// from a clean buffer — exactly how the sky (depthMask false) and the face box (its own clear)
// already treat a background pass, and how the original's ordering table behaves (no z-buffer:
// background painted, then entities painted over it). This test FAILS on the pre-fix tree (the
// arena branch had no clear) and PASSES after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const B3D = readFileSync(join(ROOT, "web/battle3d.js"), "utf8");

/** The arena's own draw branch (from `} else if (arenaActive) {` to the fallback `} else {`). */
function arenaBranch() {
  const from = B3D.indexOf("} else if (arenaActive) {");
  assert.ok(from >= 0, "the arena draw branch exists");
  const branch = B3D.slice(from);
  const endIdx = branch.indexOf("} else {\n      drawQuad");
  assert.ok(endIdx > 0, "the arena branch ends before the fallback floor");
  return branch.slice(0, endIdx);
}

/** Standard GL perspective window depth (NDC z) for eye distance d, near n, far f. */
const zndc = (f, d, n = 1) => (f + n) / (f - n) - (2 * f * n) / ((f - n) * d);

test("the far-plane gap is why a co-located fighter tests BEHIND the arena", () => {
  // The two projections the frame actually uses: the arena through a 60000 far plane, the
  // ordinary fighters through 8000.
  assert.match(B3D, /mat4Perspective\(fovRad, W \/ H, 1, 60000\)/, "the arena uses a 60000 far plane");
  assert.match(B3D, /farPlane = explicitShot \? 60000 : 8000/, "ordinary fighters use an 8000 far plane");
  // A larger far plane maps the same distance to a SMALLER window depth (nearer). So at any world
  // point the arena fragment is nearer than the fighter fragment and LEQUAL rejects the fighter —
  // this is the rejection the clear must remove.
  for (const d of [200, 1000, 4000]) {
    assert.ok(zndc(60000, d) < zndc(8000, d),
      `arena z_ndc must be nearer than the fighter's at distance ${d}`);
  }
});

test("the arena pass does not leak its depth into the fighters", () => {
  const branch = arenaBranch();
  // It still depth-sorts inside its own pass (the flat-blue-patch fix must not regress)…
  assert.match(branch, /depthMask\(true\)/, "the arena still writes depth for its own sort");
  assert.match(branch, /depthWrite/, "…under the tracked decode switch");
  // …and then clears that depth before the frame moves on, so the fighters start from a clean
  // buffer and cannot be rejected by the arena.
  assert.match(branch, /gl\.clear\(gl\.DEPTH_BUFFER_BIT\)/,
    "the arena clears the depth it wrote, so no later draw is rejected by it");
  // The clear has to come AFTER the arena is drawn, or it would erase the depth the sort needs.
  const drawAt = branch.indexOf("drawProjLayerIndexed(");
  const clearAt = branch.indexOf("gl.clear(gl.DEPTH_BUFFER_BIT)");
  assert.ok(drawAt >= 0, "the arena groups are drawn in the branch");
  assert.ok(clearAt > drawAt, "the depth clear comes after the arena draw, not before it");
});

test("the fighters are drawn after the arena and after the clear", () => {
  const arenaAt = B3D.indexOf("} else if (arenaActive) {");
  const clearAt = B3D.indexOf("gl.clear(gl.DEPTH_BUFFER_BIT)");
  const fightersAt = B3D.indexOf("── Digimon rendering");
  assert.ok(clearAt > arenaAt && fightersAt > clearAt,
    "order is: arena draw → depth clear → fighters (so the clear is what saves them)");
  // The live depth-test state the fighters inherit is exactly what makes this necessary.
  assert.match(B3D, /gl\.depthFunc\(gl\.LEQUAL\)/, "the frame depth-tests with LEQUAL");
});
