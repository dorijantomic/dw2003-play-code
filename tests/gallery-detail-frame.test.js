// Gallery detail view framing (web/biome/detailframe.js): the whole bounding sphere must project inside the screen, centred, for any size/aspect.
import test from "node:test";
import assert from "node:assert/strict";
import { frameSphere } from "../web/biome/detailframe.js";

// angular radius of the sphere seen from the camera must be smaller than the narrower half field of view
test("sphere fits the view and is centred for many sizes, fovs and aspects", () => {
  for (const radius of [0.01, 0.3, 1.5, 40]) for (const fov of [30, 50, 70]) for (const aspect of [0.5, 4 / 3, 2.4]) {
    const c = [3, -2, 7], f = frameSphere(c, radius, fov, aspect), d = Math.hypot(f.position[0] - c[0], f.position[1] - c[1], f.position[2] - c[2]);
    assert.ok(Math.abs(d - f.dist) < 1e-9 * Math.max(1, d));
    const ang = Math.asin(radius / d), vHalf = (fov * Math.PI) / 360, hHalf = Math.atan(Math.tan(vHalf) * aspect);
    assert.ok(ang < vHalf && ang < hHalf, `r ${radius} fov ${fov} aspect ${aspect}: angular radius ${ang} vs ${vHalf}/${hHalf}`);
    assert.ok(ang > 0.8 * Math.min(vHalf, hHalf), "fills at least 80% of the narrower half field");
    assert.ok(f.near < d - radius, "near plane in front of the object");
    assert.ok(f.minDistance < radius && f.maxDistance > d, "zoom range reaches close up and out past the framing distance");
  }
});
test("tiny sphere does not divide by zero", () => { const f = frameSphere([0, 0, 0], 0, 50, 4 / 3); assert.ok(Number.isFinite(f.dist) && f.dist > 0); });
