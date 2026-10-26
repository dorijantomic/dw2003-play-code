// A13 — the animation viewer's two pure modules.
//
// The viewer's camera is the reason this file exists. It must behave like a model viewer's camera,
// arithmetically: N degrees of orbit is exactly N degrees of azimuth, pitch reaches ±89°, pan moves
// the pivot, zoom is monotonic, and the framing puts a model's whole bounding box inside the frame —
// for a 10-unit speck and a 12,000-unit giant alike. None of that may be eyeballed, so it is asserted
// here over synthetic boxes AND over the real 249-model manifest (the gate the page uses per frame).
//
// The data module is asserted against the SHIPPED tables (the same JSON the page loads), so a broken
// picker (missing species, wrong group, wrong ownership) fails `npm test`, not the user.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const read = async (p) => JSON.parse(await readFile(resolve(ROOT, p), "utf8"));

const {
  createFreeCamera, PITCH_LIMIT, PITCH_LIMIT_FULL, PRESETS, DEG,
} = await import("../web/anim-viewer-camera.js");
const V = await import("../web/anim-viewer-data.js");

const ASPECT = 1120 / 840;

test("camera: orbit changes the azimuth by exactly the requested degrees", () => {
  const cam = createFreeCamera();
  cam.orbitBy(37, 0, { immediate: true });
  assert.ok(Math.abs(cam.azimuthDeg() - 37) < 1e-9, `azimuth ${cam.azimuthDeg()}`);
  cam.orbitBy(-10, 0, { immediate: true });
  assert.ok(Math.abs(cam.azimuthDeg() - 27) < 1e-9, `azimuth ${cam.azimuthDeg()}`);
  cam.orbitBy(400, 0, { immediate: true });
  assert.ok(Math.abs(cam.azimuthDeg() - ((27 + 400) % 360)) < 1e-9, `azimuth ${cam.azimuthDeg()}`);
  // one full turn back to the same view
  cam.orbitBy(-417, 0, { immediate: true });
  assert.ok(Math.abs(cam.azimuthDeg() - 10) < 1e-6 || Math.abs(cam.azimuthDeg() - 10 + 360) < 1e-6, `azimuth ${cam.azimuthDeg()}`);
});

test("camera: pitch clamps at ±89° and the full-pitch toggle reaches ±89.95°, both finite at the pole", () => {
  const cam = createFreeCamera();
  cam.orbitBy(0, 200, { immediate: true });
  assert.equal(cam.pitchDeg().toFixed(2), (PITCH_LIMIT / DEG).toFixed(2));
  cam.orbitBy(0, -400, { immediate: true });
  assert.equal(cam.pitchDeg().toFixed(2), (-PITCH_LIMIT / DEG).toFixed(2));
  cam.allowFullPitch = true;
  cam.orbitBy(0, 400, { immediate: true });
  assert.ok(Math.abs(cam.pitchDeg() - PITCH_LIMIT_FULL / DEG) < 1e-9);
  // straight down: the view and the basis must still be finite (no gimbal NaN)
  const v = cam.view();
  assert.ok([...v.eye, ...v.look, ...v.up].every(Number.isFinite), "view finite at the pole");
  const n = cam.project([cam.pivot[0], cam.pivot[1], cam.pivot[2]], ASPECT);
  assert.ok(n && n.every(Number.isFinite), "projection finite at the pole");
  assert.ok(cam.viewMatrix().every(Number.isFinite), "view matrix finite at the pole");
});

test("camera: pan moves the pivot in the camera plane by the pixel-scaled amount", () => {
  const cam = createFreeCamera({ dist: 1000, fovDeg: 45 });
  const before = cam.targetPivot.slice();
  cam.panPixels(100, 0, 800);
  const moved = cam.targetPivot.map((v, i) => v - before[i]);
  const len = Math.hypot(...moved);
  const unitsPerPx = (2 * 1000 * Math.tan(45 * DEG / 2)) / 800;
  assert.ok(Math.abs(len - 100 * unitsPerPx) < 1e-6, `panned ${len}, expected ${100 * unitsPerPx}`);
  // pure horizontal pan has no world-Y component
  assert.ok(Math.abs(moved[1]) < 1e-9, "horizontal pan stays level");
  // and the pan direction is the camera's right vector
  const { right } = cam.basis();
  const dot = moved[0] * right[0] + moved[2] * right[2];
  assert.ok(Math.abs(Math.abs(dot) - len) < 1e-6, "pan follows the camera right axis");
});

test("camera: zoom is monotonic, clamped, and keeps the point under the cursor fixed", () => {
  const cam = createFreeCamera({ dist: 2000 });
  cam.update(0);
  let d = cam.dist;
  for (let i = 0; i < 5; i++) { cam.zoomBy(1.2); assert.ok(cam.dist > d, "wheel out increases the distance"); d = cam.dist; }
  for (let i = 0; i < 5; i++) { cam.zoomBy(0.8); assert.ok(cam.dist < d, "wheel in decreases the distance"); d = cam.dist; }
  cam.zoomBy(1e-6);
  let guard = 0;
  while (cam.dist > cam.minDist && guard++ < 60) cam.zoomBy(1e-6);
  assert.equal(cam.dist, cam.minDist);
  cam.zoomBy(1e6);
  guard = 0;
  while (cam.dist < cam.maxDist && guard++ < 60) cam.zoomBy(1e6);
  assert.equal(cam.dist, cam.maxDist);

  // zoom to cursor: pick a point under an off-centre cursor, then zoom and check it projects back
  // to the same NDC (after the pivot damping has settled).
  const c2 = createFreeCamera({ dist: 3000 });
  c2.update(0);
  const ndc = [0.45, -0.3];
  const origin = c2.eye();
  const dir = c2.rayAt(ndc, ASPECT);
  const { forward } = c2.basis();
  const t = c2.dist / (dir[0] * forward[0] + dir[1] * forward[1] + dir[2] * forward[2]);
  const hit = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
  const before = c2.project(hit, ASPECT);
  assert.ok(before, "the cursor point projects before zooming");
  c2.zoomBy(0.55, ndc, ASPECT);
  c2.update(1);                       // settle the damped pivot
  const after = c2.project(hit, ASPECT);
  assert.ok(after, "the cursor point projects after zooming");
  assert.ok(Math.abs(after[0] - before[0]) < 0.02 && Math.abs(after[1] - before[1]) < 0.02,
    `cursor point moved in NDC: ${before} -> ${after}`);
});

test("camera: framing puts the whole bounding box inside the viewport for every size", () => {
  const sizes = [
    { half: [5, 5, 5], centre: [0, 0, 0] },          // a speck
    { half: [60, 90, 40], centre: [100, -50, 300] },  // a small Digimon
    { half: [1500, 3000, 1200], centre: [0, 0, 0] },  // a giant
    { half: [6000, 6000, 6000], centre: [-200, 40, 10] },
  ];
  for (const s of sizes) {
    for (const preset of ["front", "threeQuarter", "top", "bottom", "left"]) {
      const cam = createFreeCamera();
      cam.setPreset(preset, { immediate: true });
      const bounds = { min: s.centre.map((v, i) => v - s.half[i]), max: s.centre.map((v, i) => v + s.half[i]) };
      cam.frameBounds(bounds, ASPECT, { immediate: true });
      cam.update(0);
      const corners = [];
      for (let i = 0; i < 8; i++) corners.push([i & 1 ? bounds.max[0] : bounds.min[0], i & 2 ? bounds.max[1] : bounds.min[1], i & 4 ? bounds.max[2] : bounds.min[2]]);
      for (const c of corners) {
        const n = cam.project(c, ASPECT);
        assert.ok(n, `corner ${c} of ${sizes.indexOf(s)} behind the camera on ${preset}`);
        assert.ok(Math.abs(n[0]) <= 1.0001 && Math.abs(n[1]) <= 1.0001,
          `corner ${n} outside the frame on ${preset} (size ${sizes.indexOf(s)})`);
        assert.ok(n.every(Number.isFinite), "no NaN in the projected corner");
      }
    }
  }
});

test("camera: random orbit/pan/zoom/fly fuzz never produces a NaN and the eye stays at `dist` from the pivot", () => {
  const cam = createFreeCamera({ dist: 2500 });
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 400; i++) {
    cam.orbitPixels((rnd() - 0.5) * 400, (rnd() - 0.5) * 400);
    cam.panPixels((rnd() - 0.5) * 200, (rnd() - 0.5) * 200, 800);
    cam.zoomBy(0.6 + rnd() * 1.2, [rnd() * 2 - 1, rnd() * 2 - 1], ASPECT);
    cam.fly({ w: rnd() > 0.5, a: rnd() > 0.7, s: rnd() > 0.7, d: rnd() > 0.7, q: rnd() > 0.8, e: rnd() > 0.8 }, 0.016);
    cam.update(0.016);
    assert.ok(cam.isFinite(), `NaN at iteration ${i}`);
    const e = cam.eye();
    const d = Math.hypot(e[0] - cam.pivot[0], e[1] - cam.pivot[1], e[2] - cam.pivot[2]);
    assert.ok(Math.abs(d - cam.dist) < 1e-6, `eye-pivot ${d} != dist ${cam.dist} at ${i}`);
    assert.ok(cam.viewMatrix().every(Number.isFinite) && cam.projection(ASPECT).every(Number.isFinite));
  }
});

test("camera: URL state round-trips and pivotAt re-pivots on the ground", () => {
  const cam = createFreeCamera({ dist: 2000 });
  cam.setPreset("threeQuarter", { immediate: true });
  cam.frameBounds({ min: [-10, -20, -30], max: [10, 20, 30] }, ASPECT, { immediate: true });
  const s = cam.state();
  const cam2 = createFreeCamera();
  cam2.setState(s);
  // state() rounds for the URL: 0.01° of yaw, 0.1 unit of distance/pivot
  assert.ok(Math.abs(cam2.yaw - cam.yaw) < 0.01 * DEG, "yaw round-trip");
  assert.ok(Math.abs(cam2.dist - cam.dist) < 0.06, "dist round-trip");
  assert.ok(cam2.pivot.every((v, i) => Math.abs(v - cam.pivot[i]) < 0.06), "pivot round-trip");

  const c3 = createFreeCamera({ dist: 1200 });
  c3.update(0);
  c3.pivotAt([0, -0.2], ASPECT, null, -500);
  assert.ok(Math.abs(c3.targetPivot[1] + 500) < 1e-6, "the re-pivot point lies on the ground plane");
});

test("data: the picker covers every shipped model folder and every species name", async () => {
  const [digimon, extra, canon, modelMap, folders] = await Promise.all([
    read("web/assets/data/digimon.json"), read("web/assets/data/extra_species.json"),
    read("web/assets/data/extra_species_canon.json"), read("web/assets/battle/model_map.json"),
    read("web/assets/battle/models/index.json"),
  ]);
  const { ANIM_DONOR_GAPS } = await import("../web/fight/anim-donor-map.js");
  const index = V.buildModelIndex({ digimon, extraSpecies: extra, extraCanon: canon, modelMap, folders, gaps: ANIM_DONOR_GAPS });
  const indexed = new Set(index.map((e) => e.folder));
  for (const f of folders) assert.ok(indexed.has(f), `folder ${f} is not in the picker`);
  // every species name has a folder and a row
  for (const name of digimon.digimon.map((d) => d.name)) assert.ok(index.some((e) => e.name === name && e.folder), `missing ${name}`);
  // ownership split follows the id ranges the data uses
  assert.equal(V.ownershipOf(1), "original");
  assert.equal(V.ownershipOf(56), "enemy");
  assert.equal(V.ownershipOf(191), "new");
  const raijin = index.find((e) => e.folder === "m441raiz");
  assert.ok(raijin, "Raijinmon is in the picker");
  assert.equal(raijin.name, "Raijinmon");
  assert.ok(raijin.gaps.includes(5), "Raijinmon's clip 5 is a donor gap (the user's own example)");
  assert.deepEqual(V.filterModels(index, { query: "raijinmon" }).map((e) => e.folder), ["m441raiz"]);
  assert.equal(V.filterModels(index, { query: "raijinmon", gaps: "no" }).length, 0);
  assert.ok(V.filterModels(index, { query: "raijinmon", gaps: "yes" }).length === 1);
});

test("data: actions are the species' own techniques, grouped like the technique table", async () => {
  const [digimon, extra] = await Promise.all([read("web/assets/data/digimon.json"), read("web/assets/data/extra_species.json")]);
  const skills = new Map(digimon.skills.map((s) => [s.id, s]));
  const raijinRow = [...digimon.digimon, ...extra.digimon].find((d) => d.name === "Raijinmon");
  assert.ok(raijinRow, "Raijinmon has a species row");
  const entry = { name: "Raijinmon", folder: "m441raiz", id: raijinRow.id, techs: raijinRow.techs };
  const actions = V.actionsFor(entry, skills);
  assert.ok(actions.filter((a) => a.kind === "tech").length >= 3, "at least its own techniques");
  // every technique row belongs to the species' own tech list
  for (const a of actions.filter((x) => x.kind === "tech")) assert.ok(raijinRow.techs.includes(a.techId));
  // the plain-language groups are the table's own cells
  const normal = actions.find((a) => a.kind === "tech" && a.clip === 5);
  assert.ok(normal, "a clip-5 normal attack is offered when the species owns one");
  assert.equal(normal.group.label, "Normal attack");
  assert.equal(V.techGroup({ type: "heal", clip: 10, hits: 1 }).label, "Heal");
  assert.equal(V.techGroup({ type: "support", clip: 10, hits: 1 }).label, "Support");
  assert.equal(V.techGroup({ type: "attack", clip: 13, hits: 3 }).label, "Volley");
  // reactions + item + idle are always offered
  const kinds = new Set(actions.map((a) => a.kind));
  for (const k of ["tech", "item", "reaction", "idle"]) assert.ok(kinds.has(k), `missing action kind ${k}`);
  const grouped = V.groupActions(actions);
  assert.equal(grouped[0].label, "Normal attack", "the normal attack heads the list");
  assert.equal(grouped.at(-1).label, "Idle", "the idle closes the list");
});

test("data: the info panel's gate/contract lookups resolve the user's case", async () => {
  const [gate, contract] = await Promise.all([read("web/anim-gate.json"), read("web/anim-contract-index.json")]);
  assert.ok(Array.isArray(gate) && gate.length > 0, "gate rows exist");
  // the gate is the A10 retarget table (clips 9 and 13 only): a row where one exists, null elsewhere
  const row = V.gateFor(gate, "m008tyra", 9);
  assert.ok(row && row.donor, `Tyranomon clip 9 has a gate row: ${JSON.stringify(row)}`);
  assert.equal(V.gateFor(gate, "m441raiz", 5), null, "no gate row for a non-retarget clip");
  const c = V.contractFor(contract, "m441raiz", 5, "near") || V.contractFor(contract, "m441raiz", 5, "far");
  assert.ok(c && c.cases > 0, "the contract folded a row for Raijinmon clip 5");
  assert.ok(contract.invariantNames && contract.invariantNames.C8, "invariant names for the tooltip");
  // the deep link carries the case
  const q = V.caseQuery({ folder: "m441raiz", clip: 5, side: "near", techId: 59 });
  const p = new URLSearchParams(q);
  assert.equal(p.get("model"), "m441raiz");
  assert.equal(p.get("clip"), "5");
  assert.equal(p.get("tech"), "59");
  assert.equal(p.get("side"), "near");
});

test("data: describeScript names every builder path the fallback produces", () => {
  assert.equal(V.describeScript(null).kind, "none");
  assert.match(V.describeScript({ ops: [{ op: 255 }] }).text, /authored/);
  assert.match(V.describeScript({ synthesized: true, buildKind: "body" }, { donorRow: { m: "own-table-body", d: "m005grey" } }).text, /own body, planted/);
  assert.match(V.describeScript({ synthesized: true, buildKind: "self", selfCast: true }).text, /SELF cast/);
  assert.match(V.describeScript({ synthesized: true, buildKind: "cast" }, { castBake: { donor: "m369duke" } }).text, /RETARGETED.*m369duke/);
});
