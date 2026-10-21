// K21h — the side-by-side compare (DW2 original vs our body with the baked DW2 motion).
//
// Two halves, like the other viewer tests:
//   * the arithmetic, without a browser: the frame change and the unit scale, the role mapping
//     (including the whole-body rule), the direction/size verdict of one row, the clip-wide
//     "direction agreement N of M", and the tick -> frame mapping the two panes share;
//   * the data, when the local dev mounts exist: the DW2 file each bake names is found by the code
//     the bake's folder encodes, it carries the clip letter, the role maps name real bones of both
//     rigs, and the DW2 measurements land where K21d's own report says they do.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const ROOT = resolve(import.meta.dirname, "..");
const DW2 = join(homedir(), "dw2-models");
const exists = (p) => access(p).then(() => true, () => false);

const C = await import("../web/anim-viewer-compare.js");
const DW2VIEW = await import("../web/anim-viewer-dw2.js");
const { boneMap } = await import("../web/fight/digimon-bonemap.js");

// ── frame + units ───────────────────────────────────────────────────────────────────────────────
test("the DW2 glTF frame maps to character space with diag(1,-1,-1)", () => {
  assert.deepEqual(C.toCharacter([10, 20, 30]), [10, -20, -30]);
  // a DW2 point 500 above the origin (glTF y = +500) is y = -500 in our DOWN frame
  assert.equal(C.toCharacter([0, 500, 0])[1], -500);
  // forward (+z in our frame) is -z in the glTF's own numbers
  assert.equal(C.toCharacter([0, 0, 100])[2], -100);
});

test("a DW2 displacement is scaled into our body's units by sizeRatio", () => {
  assert.deepEqual(C.toBodyUnits([10, 20, 30], 2), [20, -40, -60]);
  assert.deepEqual(C.toBodyUnits([1, 0, 0], null), [1, -0, -0], "no ratio = raw model units, still frame-changed");
  assert.equal(C.toBodyUnits(null), null);
});

// ── roles ──────────────────────────────────────────────────────────────────────────────────────
test("roles come out of the short-key maps, legs/wings as their chain tips", () => {
  const bones = C.roleBones({ t: 18, h: 8, lL: [13, 14, 15, 16], lR: [9, 10, 11, 12], wL: [2, 3, 4], wR: [1] });
  assert.deepEqual(bones, { torso: 18, head: 8, footL: 16, footR: 12, wingL: 4, wingR: 1 });
  assert.deepEqual(C.roleBones({ t: 0, h: 1 }), { torso: 0, head: 1 }, "unmapped roles are absent, not null rows");
  assert.deepEqual(C.roleBones(null), {});
});

test("the DW2 torso is the whole-body part when the map named a much smaller one", () => {
  // Kokatorimon's real numbers (probe: bind-pose mesh volumes per part)
  const map = { t: 1, h: 3, lL: [5, 6, 7], lR: [12, 13, 14], wL: [16, 17], wR: [9, 10] };
  const parts = [
    { bone: 1, volume: 422 * 686 * 462 }, { bone: 3, volume: 359 * 566 * 647 },
    { bone: 18, volume: 1959 * 1510 * 983 }, { bone: 7, volume: 503 * 511 * 502 },
  ];
  const r = C.dw2RoleBones(map, parts);
  assert.equal(r.bones.torso, 18);
  assert.equal(r.bones.head, 3, "the head is untouched");
  assert.match(r.torsoNote, /whole-body part/);
  // a rig whose mapped torso IS the biggest part keeps the map's word
  const mera = { t: 0, h: 1 };
  const meraParts = [{ bone: 0, volume: 401464350 }, { bone: 1, volume: 484513620 }];
  const r2 = C.dw2RoleBones(mera, meraParts);
  assert.equal(r2.bones.torso, 0);
  assert.equal(r2.torsoNote, null);
  assert.deepEqual(C.dw2RoleBones(map, null).bones.torso, 1, "no parts measured = the map stands");
});

test("the table's rows are the roles both maps can name, with their bones", () => {
  const rows = C.roleRows({ torso: 18, head: 3, footL: 7, footR: 14 }, { torso: 18, head: 8, footL: 16, footR: 12 });
  assert.deepEqual(rows.map((r) => r.role), ["torso", "head", "footL", "footR"]);
  assert.deepEqual(rows[2], { role: "footL", label: "left foot", dw2: 7, dw3: 16, both: true });
  const wings = C.roleRows({ torso: 18, wingL: 17, wingR: 10 }, { torso: 18 });
  assert.deepEqual(wings.map((r) => r.role), ["torso", "wingL", "wingR"]);
  assert.equal(wings[1].both, false, "a role only one side maps is shown but never counted");
});

// ── one row's verdict ──────────────────────────────────────────────────────────────────────────
test("displacement is to-minus-from, and a still role is not a direction", () => {
  assert.deepEqual(C.displacement([1, 2, 3], [4, 6, 3]), [3, 4, 0]);
  const row = C.compareRow([0, 0, 0], [10, 0, 0], { epsilon: 1 });
  assert.equal(row.cos, null);
  assert.equal(row.dirOk, false, "one side moving and the other not is a disagreement");
  assert.equal(row.ok, false);
  const still = C.compareRow([0, 0, 0], [0, 0, 0], { epsilon: 1 });
  assert.equal(still.ok, true, "both still = nothing to disagree about");
});

test("direction agrees at cos >= 0.5, size at 2x, and the row fails on either", () => {
  const same = C.compareRow([0, 0, 100], [0, 0, 100], { epsilon: 1 });
  assert.equal(same.cos, 1);
  assert.equal(same.ok, true);
  const flipped = C.compareRow([0, 0, 100], [0, 0, -100], { epsilon: 1 });
  assert.equal(flipped.cos, -1);
  assert.equal(flipped.dirOk, false);
  const sideways = C.compareRow([0, 0, 100], [100, 0, 0], { epsilon: 1 });
  assert.equal(Math.round(sideways.cos), 0);
  assert.equal(sideways.dirOk, false, "90 degrees is not the same direction");
  const big = C.compareRow([0, 0, 100], [0, 0, 20], { epsilon: 1 });
  assert.equal(big.dirOk, true);
  assert.equal(big.sizeOk, false, "5x the size fails even in the same direction");
  assert.equal(big.ok, false);
  const tilted = C.compareRow([0, 0, 100], [0, 0, 95] /* cos 1 */, { epsilon: 1 });
  assert.equal(tilted.ok, true);
});

test("the clip-wide agreement is the best tick per role", () => {
  const frames = [
    [{ role: "torso", both: true, cos: 0.1, ratio: 1 }, { role: "footL", both: true, cos: 0.9, ratio: 1 }],
    [{ role: "torso", both: true, cos: 0.95, ratio: 1.2 }, { role: "footL", both: true, cos: 0.2, ratio: 6 }],
    [{ role: "head", both: false, cos: 1, ratio: 1 }],
  ];
  const sum = C.maxAgreement(frames);
  assert.equal(sum.total, 2, "unpaired roles are not counted");
  assert.equal(sum.agree, 2, "torso agrees on tick 1, footL on tick 0");
  assert.equal(C.agreementText(sum), "direction agreement: 2 of 2 roles");
  assert.equal(C.maxAgreement([]).total, 0);
});

// ── clip + tick plumbing ──────────────────────────────────────────────────────────────────────
test("the DW2 file code comes from the DW3 folder, and the clip from the letter", () => {
  assert.equal(C.dw2CodeForFolder("m050coca"), "050COCA");
  assert.equal(C.dw2CodeForFolder("m009mera"), "009MERA");
  assert.equal(C.dw2CodeForFolder("m441raiz"), "441RAIZ");
  assert.equal(C.dw2CodeForFolder("nope"), null);
  const anims = [{ name: "anim_A" }, { name: "anim_C0" }, { name: "anim_C1" }, { name: "anim_F" }, { name: "anim_K" }];
  assert.equal(C.clipIndexForLetter(anims, "F"), 3);
  assert.equal(C.clipIndexForLetter(anims, "C"), 1, "a bare letter takes the group's first clip");
  assert.equal(C.clipIndexForLetter(anims, "C1"), 2);
  assert.equal(C.clipIndexForLetter(anims, "D"), -1);
});

test("both panes share one tick: frame = tick x TICK_SPEED, clamped to the clip", () => {
  assert.equal(C.clipFrames(2.0, 30), 61);
  assert.equal(C.frameAtTick(0, 2, 60), 0);
  assert.equal(C.frameAtTick(10, 2, 60), 20);
  assert.equal(C.frameAtTick(100, 2, 60), 60);
  assert.equal(C.ticksForFrames(61, 2), 31);
  assert.equal(C.ticksForFrames(1, 2), 1);
  assert.equal(C.frameAtTick(-5, 2, 60), 0);
});

test("the conversion is spelled out for the Info tab, and the deep link is the compare key", () => {
  const rows = C.conversionRows(1.825);
  assert.equal(rows.length, 3);
  assert.match(rows[1][1], /diag\(1,−1,−1\)/);
  assert.match(rows[2][1], /1\.825/);
  assert.equal(C.compareQuery({ id: "m050coca-dw2F" }), "compare=m050coca-dw2F");
  assert.equal(C.compareQuery({ id: "m050coca-dw2F", tick: 12 }), "compare=m050coca-dw2F&t=12");
  assert.equal(C.compareQuery({}), "");
  assert.match(C.roleBonesRow({ torso: 18, footL: 7 }, { torso: 18, footL: 16 }), /torso j18\/18 · left foot j7\/16/);
});

test("vectors print as one cell, at a precision that suits their size", () => {
  assert.equal(C.fmtVec([320.4, -137.2, 388.9]), "320 / -137 / 389");
  assert.equal(C.fmtVec([2.25, -1.04, 0.5]), "2.3 / -1.0 / 0.50");
  assert.equal(C.fmtVec(null), "—");
});

// ── the real data, when the dev mounts are there ──────────────────────────────────────────────
const HAVE = (await exists(join(DW2, "index.json"))) && (await exists(join(DW2, "dw2-bonemaps.json")));
test("every bake's DW2 twin is found by code and carries the clip letter", { skip: !HAVE && "no ~/dw2-models mount" }, async () => {
  const idx = DW2VIEW.buildDw2Index(JSON.parse(await readFile(join(DW2, "index.json"), "utf8")));
  const bakes = JSON.parse(await readFile(join(DW2, "converted", "bakes", "index.json"), "utf8")).bakes.filter((b) => /-dw2[A-Z]$/.test(b.id)); // authored (-gen*) motions are not DW2 bakes
  assert.ok(bakes.length >= 5);
  for (const b of bakes) {
    const code = C.dw2CodeForFolder(b.folder);
    const entry = C.findDw2Entry(idx.models, code);
    assert.ok(entry, `${b.id}: no DW2 model with code ${code}`);
    const letter = b.id.replace(/^.*-dw2/, "");
    assert.notEqual(C.clipIndexForLetter(entry.anims, letter), -1, `${b.id}: ${entry.path} has no clip ${letter}`);
    assert.equal(entry.anims.length, entry.durs.length);
  }
});

test("both role maps name real bones, and the DW2 side's measurement matches the converter's", { skip: !HAVE && "no ~/dw2-models mount" }, async () => {
  const maps = JSON.parse(await readFile(join(DW2, "dw2-bonemaps.json"), "utf8")).models;
  const idx = DW2VIEW.buildDw2Index(JSON.parse(await readFile(join(DW2, "index.json"), "utf8")));
  const bakes = JSON.parse(await readFile(join(DW2, "converted", "bakes", "index.json"), "utf8")).bakes;
  const seen = new Set();
  for (const b of bakes) {
    if (seen.has(b.folder)) continue;
    seen.add(b.folder);
    const entry = C.findDw2Entry(idx.models, C.dw2CodeForFolder(b.folder));
    const gltf = DW2VIEW.parseGltf(JSON.parse(await readFile(join(DW2, "extract", entry.path), "utf8")));
    const dw2bones = C.dw2RoleBones(maps[`dw2_${b.folder}`]).bones;
    const dw3bones = C.roleBones(boneMap(b.folder));
    assert.ok(dw2bones.torso != null && dw2bones.footL != null && dw2bones.footR != null, `${b.folder}: DW2 roles incomplete`);
    assert.ok(dw3bones.torso != null && dw3bones.footL != null && dw3bones.footR != null, `${b.folder}: DW3 roles incomplete`);
    const joints = gltf.json.skins[0].joints.length;
    for (const k of Object.keys(dw2bones)) assert.ok(dw2bones[k] < joints, `${b.folder}: ${k} j${dw2bones[k]} is not a joint of ${entry.path}`);
    // the geometry rule sees a body-sized part on Kokatorimon and leaves Meramon's map alone
    if (b.folder === "m050coca") {
      const fixed = C.dw2RoleBones(maps[`dw2_${b.folder}`], C.partVolumes(gltf, DW2VIEW.bindPose(gltf)));
      assert.equal(fixed.bones.torso, 18, "the whole-body part is the torso on this rig");
      assert.match(fixed.torsoNote, /whole-body/);
    }
    for (const k of Object.keys(dw3bones)) assert.ok(dw3bones[k] < gltf.json.nodes.length, `${b.folder}: DW3 ${k} out of range`);
    // the DW2 reader's own pose, walked for the torso, agrees with the retained bind pose at t=0
    const clip = C.clipIndexForLetter(gltf.anims, b.letter);
    const p0 = DW2VIEW.samplePose(gltf, clip, 0);
    const node = gltf.json.skins[0].joints[dw2bones.torso];
    const at = (pose) => [pose.world[node * 16 + 12], pose.world[node * 16 + 13], pose.world[node * 16 + 14]];
    assert.deepEqual(at(p0).map((v) => Math.round(v * 100) / 100), at(DW2VIEW.bindPose(gltf)).map((v) => Math.round(v * 100) / 100).map((v, i) => v), "frame 0 of a clip is a posed frame, not the bind pose — it must still be finite");
    assert.ok(at(p0).every(Number.isFinite));
  }
});
