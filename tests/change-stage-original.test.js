// The change stages' mesh motion is the original's (stage.c setStage 0x1C / 0x1F -> model_mesh.c):
//   FIGHTSTG_poseBone   : key blend t = ((frame - prev) << 12) / (cur - prev), step = (t * diff) >> 12 (gte_gpf12), integer
//   FIGHTSTG_updateModel: RotMatrixZYX_gte (F0x8002b45c) -> R = Rz * Ry * Rx, then ScaleMatrix (scale 0x1000 here)
// battle3d.js draws the meshes through the ONE engine function changeStageMeshMatrix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { changeStageRotAt, changeStageMeshMatrix, CHANGE_STAGE_MOTION_FRAMES } from "../engine/systems/blast-presentation.ts";
import { rotMatrixZYX } from "../engine/dw3/gte-math.ts";

// MEFT1028 / MEFT1031 ctrl rotation tracks (extractor: tools/extract_arenas.py ROT_KEY_PACKS), keys 0, 1, 1501.
const MESH0 = [[0, 0, 0, 0], [1, 0, 0, 0], [1501, 8192, 0, -4096]];
const MESH1 = [[0, 0, 0, 0], [1, 0, 0, 0], [1501, -4096, 0, 8192]];
const MESH2 = [[0, 0, 0, 0], [1, 0, 0, 0], [1501, 0, -4096, 0]];
const MESH3 = [[0, 0, 0, 0], [1, 0, 0, 0], [1501, 0, 4096, 0]];

test("rotation at a key frame is the key; between keys it is poseBone's integer blend", () => {
  assert.deepEqual(changeStageRotAt(MESH0, 0), [0, 0, 0]);
  assert.deepEqual(changeStageRotAt(MESH0, 1), [0, 0, 0]);
  assert.deepEqual(changeStageRotAt(MESH0, 1501), [8192, 0, -4096]);
  // frame 2: t = (1 << 12) / 1500 = 2 (C division), x = (2 * 8192) >> 12 = 4, z = (2 * -4096) >> 12 = -2
  assert.deepEqual(changeStageRotAt(MESH0, 2), [4, 0, -2]);
  // frame 3: t = (2 << 12) / 1500 = 5, x = 10, z = -5
  assert.deepEqual(changeStageRotAt(MESH0, 3), [10, 0, -5]);
  // frame 751: t = (750 << 12) / 1500 = 2048, x = 4096, z = -2048
  assert.deepEqual(changeStageRotAt(MESH0, 751), [4096, 0, -2048]);
  // the last frame of the loop: t = (1499 << 12) / 1500 = 4093, x = (4093 * 8192) >> 12 = 8186, z = -4093
  assert.deepEqual(changeStageRotAt(MESH0, CHANGE_STAGE_MOTION_FRAMES), [8186, 0, -4093]);
  assert.deepEqual(changeStageRotAt(MESH3, 751), [0, 2048, 0]);
  assert.deepEqual(changeStageRotAt(MESH2, 751), [0, -2048, 0]);
});

test("the blend shifts arithmetically (floor), as gte_gpf12 does", () => {
  // keys 0 and 10, z 0 -> -5, frame 5: t = 2048, (2048 * -5) >> 12 = -10240 >> 12 = -3 (floor of -2.5), not -2
  assert.deepEqual(changeStageRotAt([[0, 0, 0, 0], [10, 0, 0, -5]], 5), [0, 0, -3]);
  // a 16-bit result wraps like the SVECTOR it is stored in
  assert.deepEqual(changeStageRotAt([[0, 32767, 0, 0], [2, -32768, 0, 0]], 1), [(32767 + ((2048 * ((-32768 - 32767) << 16 >> 16)) >> 12)) << 16 >> 16, 0, 0]);
});

// Independent reference: Rz * Ry * Rx multiplied out in floating point (the order RotMatrixZYX_gte builds).
function mul(a, b) {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
const RX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const RY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const RZ = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const K = (u) => (u * Math.PI * 2) / 4096;

test("the mesh matrix is Rz * Ry * Rx (not Rx * Ry * Rz) on non-trivial angles", () => {
  for (const [x, y, z] of [[700, 1100, -300], [4096 + 512, -900, 200], [250, 3000, 1500], [1024, 1024, 1024]]) {
    const keys = [[0, 0, 0, 0], [1, x, y, z]];
    const m = changeStageMeshMatrix(keys, 1);
    assert.deepEqual(m, rotMatrixZYX(x, y, z));
    const zyx = mul(RZ(K(z)), mul(RY(K(y)), RX(K(x))));
    const xyz = mul(RX(K(x)), mul(RY(K(y)), RZ(K(z))));
    let dZYX = 0, dXYZ = 0;
    for (let i = 0; i < 9; i++) {
      dZYX = Math.max(dZYX, Math.abs(m[i] / 4096 - zyx[i]));
      dXYZ = Math.max(dXYZ, Math.abs(m[i] / 4096 - xyz[i]));
    }
    assert.ok(dZYX < 0.002, `Rz*Ry*Rx within fixed-point rounding (${dZYX}) at ${x},${y},${z}`);
    assert.ok(dXYZ > 0.05, `Rx*Ry*Rz is a different matrix (${dXYZ}) at ${x},${y},${z}`);
  }
});

test("known angles: mesh0 end key (8192, 0, -4096) is two turns about X and a turn about Z = identity", () => {
  assert.deepEqual(changeStageMeshMatrix(MESH0, 1501), [4096, 0, 0, 0, 4096, 0, 0, 0, 4096]);
  assert.deepEqual(changeStageMeshMatrix(MESH1, 1501), [4096, 0, 0, 0, 4096, 0, 0, 0, 4096]);
  // a quarter of the way (frame 376: t = (375 << 12) / 1500 = 1024): mesh2 y = -1024 -> a quarter turn about -Y
  const q = changeStageMeshMatrix(MESH2, 376);
  assert.deepEqual(q, rotMatrixZYX(0, -1024, 0));
  assert.deepEqual(q, [0, 0, -4096, 0, 4096, 0, 4096, 0, 0]);
  // mesh3 mirrors it
  assert.deepEqual(changeStageMeshMatrix(MESH3, 376), [0, 0, 4096, 0, 4096, 0, -4096, 0, 0]);
});

test("battle3d draws the change-stage meshes through changeStageMeshMatrix only", () => {
  const src = readFileSync(new URL("../web/battle3d.js", import.meta.url), "utf8");
  assert.match(src, /changeStageMeshMatrix\(keys, frame\)/);
  assert.doesNotMatch(src, /psxRotMat4|rotKeysAt/);
  const vendor = readFileSync(new URL("../web/vendor/engine.js", import.meta.url), "utf8");
  assert.match(vendor, /^  changeStageMeshMatrix,$/m);
});

const ARENAS = new URL("../web/assets/battle/arenas/", import.meta.url);
test("the shipped MEFT1028 / MEFT1031 packs carry exactly these rotation tracks", { skip: !existsSync(new URL("meft1031/geometry.json", ARENAS)) }, () => {
  for (const pack of ["meft1028", "meft1031"]) {
    const g = JSON.parse(readFileSync(new URL(`${pack}/geometry.json`, ARENAS), "utf8"));
    const tracks = new Set(g.groups.map((x) => JSON.stringify(x.rotKeys)));
    for (const t of tracks) assert.ok([MESH0, MESH1, MESH2, MESH3].map((k) => JSON.stringify(k)).includes(t), `${pack}: ${t}`);
    assert.ok(g.groups.every((x) => x.rotKeys), `${pack}: every group has a track`);
  }
});
