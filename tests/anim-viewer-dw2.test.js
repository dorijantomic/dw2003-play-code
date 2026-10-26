// K21b — the DW2 source of the animation viewer: the loader and the rig arithmetic.
//
// Two kinds of assertion, both arithmetic:
//   1. a SYNTHETIC glTF built here (embedded buffer + embedded texture, one bone chain, one clip with
//      two keys) proves the decoder, the TRS walk, quaternion nlerp and the bounds/ground maths
//      without any disc data — so this test runs anywhere;
//   2. the REAL files under ~/dw2-models (dev-only, never in the repo) are parsed when they exist: the
//      index's paths must resolve, every clip must sample to a finite pose, and the rigid-rig facts the
//      renderer relies on (non-indexed triangles, no JOINTS_0) must hold for the whole sample.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const ROOT = resolve(import.meta.dirname, "..");
const DW2_DIR = process.env.DW2_MODELS || join(homedir(), "dw2-models");
const {
  buildDw2Index, filterDw2, parseGltf, clipList, samplePose, poseBounds, groundPose,
  modelStats, readAccessor, composeTRS, mat4Mul,
} = await import("../web/anim-viewer-dw2.js");

// ── a synthetic, self-contained glTF 2.0 (the converter's shape: embedded buffers, no indices) ────
const b64 = (typed) => `data:application/octet-stream;base64,${Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64")}`;
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function syntheticGltf() {
  // a unit quad in the XZ plane (two triangles, 6 vertices) hanging off bone_1
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);
  const nrm = new Float32Array(18).fill(0);
  for (let i = 0; i < 6; i++) nrm[i * 3 + 2] = 1;
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
  const times = new Float32Array([0, 1]);
  const rot = new Float32Array([0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2]);   // identity → +90° about Y
  const trans = new Float32Array([0, 0, 0, 2, 0, 0]);
  const buffers = [pos, nrm, uv, times, rot, trans].map((a) => ({ byteLength: a.byteLength, uri: b64(a) }));
  const acc = (bufferView, type, componentType, count, extra = {}) => ({ bufferView, type, componentType, count, ...extra });
  return {
    asset: { generator: "test", version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "bone_0", translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], children: [1] },
      { name: "bone_1", translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, -1, -1], children: [2] },
      { name: "mesh_0", mesh: 0 },
    ],
    skins: [{ joints: [0, 1], skeleton: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0, mode: 4 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 }, alphaMode: "MASK", alphaCutoff: 0.1 }],
    textures: [{ source: 0 }], images: [{ name: "texture", uri: PNG_1PX }],
    buffers,
    bufferViews: buffers.map((b, i) => ({ buffer: i, byteLength: b.byteLength })),
    accessors: [
      acc(0, "VEC3", 5126, 6, { min: [0, 0, 0], max: [1, 1, 0] }),
      acc(1, "VEC3", 5126, 6),
      acc(2, "VEC2", 5126, 6),
      acc(3, "SCALAR", 5126, 2),
      acc(4, "VEC4", 5126, 2),
      acc(5, "VEC3", 5126, 2),
    ],
    animations: [{
      name: "anim_A",
      extras: { loop_mask: 0, termination_mask: 254 },
      samplers: [
        { input: 3, output: 4, interpolation: "LINEAR" },
        { input: 3, output: 5, interpolation: "LINEAR" },
      ],
      channels: [
        { sampler: 0, target: { node: 1, path: "rotation" } },
        { sampler: 1, target: { node: 1, path: "translation" } },
      ],
    }],
  };
}

test("dw2 index: rows are normalised, sorted and filterable by stage and name", () => {
  const idx = buildDw2Index({
    root: "extract",
    models: [
      { path: "Digimon/Champion/Airdramon/007AIRD.gltf", name: "Airdramon", stage: "Digimon", anims: ["anim_A", "anim_B"], durs: [1, 2], joints: 16, meshes: 16, prims: 16, materials: 2, bytes: 10 },
      { path: "Bosses/Black Sword Guardian/249MAKI.gltf", name: "Black Sword Guardian", stage: "Bosses", anims: ["anim_A"], durs: [1], joints: 17, meshes: 17, prims: 17, materials: 2, bytes: 10 },
    ],
  });
  assert.equal(idx.count, 2);
  assert.deepEqual(idx.stages, { Digimon: 1, Bosses: 1 });
  assert.deepEqual(idx.models.map((m) => m.stage), ["Bosses", "Digimon"]);   // sorted by stage then name
  assert.equal(filterDw2(idx.models, { stage: "Digimon" }).length, 1);
  assert.equal(filterDw2(idx.models, { query: "airdra" }).length, 1);
  assert.equal(filterDw2(idx.models, { query: "249maki" }).length, 1, "the file code is searchable");
  assert.equal(filterDw2(idx.models, { query: "nope" }).length, 0);
});

test("dw2 parse: a self-contained glTF yields nodes, primitives, materials and clips", () => {
  const model = parseGltf(syntheticGltf());
  assert.equal(model.roots.length, 1);
  assert.equal(model.parent[1], 0);
  assert.equal(model.parent[2], 1);
  assert.equal(model.meshes.length, 1);
  const prim = model.meshes[0].prims[0];
  assert.equal(prim.count, 6);
  assert.deepEqual([...prim.pos.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...prim.uv.slice(0, 2)], [0, 0]);
  assert.equal(model.materials[0].alphaMode, "MASK");
  assert.equal(model.materials[0].image, 0);
  assert.match(model.images[0].uri, /^data:image\/png;base64,/);
  const clips = clipList(model);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].name, "anim_A");
  assert.equal(clips[0].dur, 1);
  const st = modelStats(model);
  assert.equal(st.tris, 2);
  assert.equal(st.verts, 6);
  assert.equal(st.hasIndices, false);
  assert.equal(st.hasSkinAttrs, false, "DW2 rigs are rigid: no JOINTS_0");
  assert.equal(st.textured, 1);
});

test("dw2 pose: the clip moves the bone, the quaternion reaches 90°, and the tree composes", () => {
  const model = parseGltf(syntheticGltf());
  const a = samplePose(model, 0, 0);
  const b = samplePose(model, 0, 1);
  // the mesh node's world matrix is the bone's: at t=1 the bone sits 2 units along +X (animated
  // translation) and is turned 90° about Y, so its local +X axis now points at -Z
  assert.ok(Math.abs(b.world[2 * 16 + 12] - 2) < 1e-6, `mesh world x ${b.world[2 * 16 + 12]}`);
  assert.ok(Math.abs(b.world[2 * 16 + 0]) < 1e-6, `m00 ${b.world[2 * 16 + 0]}`);
  assert.ok(Math.abs(b.world[2 * 16 + 2] - -1) < 1e-6, `m20 ${b.world[2 * 16 + 2]}`);
  // at t=0.5 the rotation is halfway (nlerp = 45°) and the translation is 1
  const mid = samplePose(model, 0, 0.5);
  assert.ok(Math.abs(mid.world[2 * 16 + 12] - 1) < 1e-6);
  assert.ok(Math.abs(Math.atan2(mid.world[2 * 16 + 2], mid.world[2 * 16 + 0]) + Math.PI / 4) < 1e-6, "45° halfway");
  // untouched node: the bind pose
  const bind = samplePose(model, -1, 0);
  assert.equal(bind.world[2 * 16 + 12], 0);
  // channel value sanity: rotation is unit length after interpolation
  const len = Math.hypot(mid.r[4], mid.r[5], mid.r[6], mid.r[7]);
  assert.ok(Math.abs(len - 1) < 1e-6, `quaternion length ${len}`);
  // the T/R/S compose helper agrees with a hand-built rotation
  const m = composeTRS([1, 2, 3], [0, 0, 0, 1], [2, 2, 2]);
  assert.deepEqual([m[0], m[5], m[10], m[12], m[13], m[14]], [2, 2, 2, 1, 2, 3]);
  const id = composeTRS([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
  const twice = mat4Mul(m, id);
  assert.deepEqual([...twice.slice(12, 15)], [1, 2, 3]);
  // a reading of the file's own accessors round-trips (float32 → float32)
  const times = readAccessor(model, 3);
  assert.deepEqual([...times], [0, 1]);
});

test("dw2 bounds: the AABB follows the pose, and grounding puts the feet on y=0 at the origin", () => {
  const model = parseGltf(syntheticGltf());
  const p0 = samplePose(model, 0, 0);
  const b0 = poseBounds(model, p0);
  // bone_1 scale is (1,-1,-1): the quad's +Y becomes -Y in world space
  assert.deepEqual(b0.min.map((v) => +v.toFixed(6)), [0, -1, 0]);
  assert.deepEqual(b0.max.map((v) => +v.toFixed(6)), [1, 0, 0]);
  assert.deepEqual(b0.size.map((v) => +v.toFixed(6)), [1, 1, 0]);
  const p1 = samplePose(model, 0, 1);
  const b1 = poseBounds(model, p1);
  assert.ok(b1.min[0] > 1.5, `moved along +X: min x ${b1.min[0]}`);
  groundPose(model, p1);
  const g = poseBounds(model, p1);
  assert.ok(Math.abs(g.min[1]) < 1e-6, `feet at 0: ${g.min[1]}`);
  assert.ok(Math.abs(g.center[0]) < 1e-6 && Math.abs(g.center[2]) < 1e-6, "centred on the origin in XZ");
  assert.ok([...g.min, ...g.max].every(Number.isFinite));
});

// ── the real files (dev-only; skipped when ~/dw2-models is not there) ─────────────────────────────
const hasDw2 = await access(DW2_DIR).then(() => true, () => false);
const skip = hasDw2 ? false : `no DW2 folder at ${DW2_DIR}`;

test("dw2 real index: every path resolves to a file and every row names its clips", { skip }, async () => {
  const inv = JSON.parse(await readFile(join(DW2_DIR, "index.json"), "utf8"));
  const idx = buildDw2Index(inv);
  assert.ok(idx.count > 300, `${idx.count} models`);
  assert.ok(idx.stages.Digimon > 200, `digimon ${idx.stages.Digimon}`);
  let missing = 0;
  for (const m of idx.models) {
    const file = join(DW2_DIR, idx.root, m.path);
    if (!(await access(file).then(() => true, () => false))) missing++;
    assert.ok(m.anims.length >= 1, `${m.path}: no clips listed`);
  }
  assert.equal(missing, 0, `${missing} index rows point nowhere`);
});

test("dw2 real models: the rig is rigid, every clip samples finite, bounds are non-degenerate", { skip }, async () => {
  const inv = JSON.parse(await readFile(join(DW2_DIR, "index.json"), "utf8"));
  const idx = buildDw2Index(inv);
  // the smallest few Digimon files keep this quick, plus the one model the report names
  const bySize = idx.models.filter((m) => m.stage === "Digimon").sort((a, b) => a.bytes - b.bytes);
  const sample = [...bySize.slice(0, 3), idx.models.find((m) => /007AIRD/.test(m.path))].filter(Boolean);
  assert.ok(sample.length >= 3);
  for (const m of sample) {
    const json = JSON.parse(await readFile(join(DW2_DIR, idx.root, m.path), "utf8"));
    const model = parseGltf(json);
    const st = modelStats(model);
    assert.equal(st.hasSkinAttrs, false, `${m.path} carries JOINTS_0`);
    assert.equal(st.hasIndices, false, `${m.path} carries indices`);
    assert.ok(st.tris > 0 && st.joints > 0, `${m.path}: ${st.tris} tris, ${st.joints} joints`);
    assert.equal(clipList(model).length, m.anims.length, `${m.path} clip count`);
    for (const clip of clipList(model)) {
      const pose = samplePose(model, clip.index, clip.dur * 0.5);
      assert.ok(pose.world.every(Number.isFinite), `${m.path} ${clip.name}: non-finite pose`);
      const b = poseBounds(model, pose);
      const diag = Math.hypot(...b.size);
      assert.ok(diag > 1 && diag < 1e6, `${m.path} ${clip.name}: bbox diagonal ${diag}`);
    }
    // the clips actually MOVE the rig: two keys of one clip must differ
    const a = samplePose(model, 0, 0), z = samplePose(model, 0, model.anims[0].dur);
    const differs = a.world.some((v, i) => Math.abs(v - z.world[i]) > 1e-4);
    assert.ok(differs, `${m.path}: clip 0 does not move the rig`);
  }
});
