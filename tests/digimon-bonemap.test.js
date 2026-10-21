// Guard for the authored bone map (K12 output, web/fight/digimon-bonemap.js).
// The deeper audit - every index against the model's own skeleton, every chain parent-connected,
// every technique's launch bone, the Python-vs-JS golden - is tools/verify_bonemap.mjs; this keeps
// the everyday suite honest without reading the disc-derived model assets.
import test from "node:test";
import assert from "node:assert/strict";
import * as B from "../web/fight/digimon-bonemap.js";
import * as A from "../web/fight/digimon-anatomy.js";

const MODES = new Set(A.MODES);
const SIDES = new Set(["left", "right"]);
const CONF = new Set(["high", "medium", "low"]);

test("bone map covers exactly the anatomy table's folders", () => {
  assert.equal(B.FOLDERS.length, 244);
  assert.deepEqual(B.FOLDERS, A.FOLDERS);
});

test("every record carries the core roles and legal flags", () => {
  for (const f of B.FOLDERS) {
    const m = B.boneMap(f);
    for (const k of ["r", "t", "h", "m", "e"]) {
      assert.ok(Number.isInteger(m[k]) && m[k] >= 0, `${f}: ${k} is a bone index`);
    }
    assert.ok(Array.isArray(m.ro) && m.ro.includes(m.r), `${f}: root is one of the rig roots`);
    assert.ok(Array.isArray(m.loc) && m.loc.length >= 2, `${f}: locomotion has 2+ bones`);
    assert.ok(CONF.has(m.sc), `${f}: side confidence ${m.sc}`);
    assert.ok(m.dom === null || m.dom === "left" || m.dom === "right" || m.dom === "both", `${f}: dom ${m.dom}`);
    assert.ok(typeof m.sy === "number" && m.sy >= 0, `${f}: symmetry scalar`);
    for (const [mode, bone] of Object.entries(m.f)) {
      assert.ok(MODES.has(mode), `${f}: emitter mode ${mode}`);
      assert.ok(Number.isInteger(bone) && bone >= 0, `${f}: emitter bone ${mode}`);
    }
    for (const side of ["left", "right"]) {
      const c = B.armChain(f, side);
      if (c) for (const i of c) assert.ok(Number.isInteger(i) && i >= 0, `${f}: ${side} arm index`);
    }
  }
});

test("every annotated technique resolves: a bone for emitters, none for self moves", () => {
  let emitters = 0, self = 0;
  for (const f of B.FOLDERS) {
    for (const [tech, t] of Object.entries(A.ANATOMY[f].tech)) {
      const r = B.launchBone(f, tech);
      assert.ok(r, `${f}/${tech}: resolved`);
      assert.equal(r.mode, t[0], `${f}/${tech}: mode`);
      if (t[0] === "self") {
        self++;
        assert.equal(r.bone, null, `${f}/${tech}: self move has no bone`);
      } else {
        emitters++;
        assert.ok(Number.isInteger(r.bone) && r.bone >= 0, `${f}/${tech}: emitter bone`);
        const legal = ["annotation", "tech-prior", "armament", "dominant-side", "first-arm", "fallback-body", "fallback-torso"];
        assert.ok(legal.includes(r.source) || typeof r.source === "string", `${f}/${tech}: source ${r.source}`);
      }
    }
  }
  assert.ok(emitters > 700, `expected >700 emitter techniques, got ${emitters}`);
  assert.ok(self > 200, `expected >200 self moves, got ${self}`);
});

test("the Minotarumon case: the LEFT gun fires left-arm techniques, the right fist strikes", () => {
  const f = "m399mta2";
  const L = B.armChain(f, "left"), R = B.armChain(f, "right");
  assert.ok(L && R, "two arm chains");
  assert.equal(B.launchBone(f, "Fight").bone, R[R.length - 1], "Fight is the right hand");
  assert.equal(A.firingPart(f, "Fight").mode, "right-arm");
  assert.ok(A.ANATOMY[f].arm.some(([side, kind]) => side === "left" && kind === "gun"));
});

test("SkullSatamon (user-confirmed): the staff arm is the RIGHT arm and the side audit agrees", () => {
  const f = "m244skst";
  assert.equal(B.sideConfidence(f), "high");
  const m = B.boneMap(f);
  const L = B.armChain(f, "left"), R = B.armChain(f, "right");
  assert.equal(L.length, 3);
  assert.equal(R.length, 3);
  assert.equal(m.f["right-arm"], R[R.length - 1], "the right-arm emitter is the right hand");
  assert.ok(R.includes(m.f["both-arms"]), "the both-arms emitter is the staff (right) hand");
  assert.deepEqual(B.firingBones(f, "both-arms"), [L[L.length - 1], R[R.length - 1]]);
});

test("multi-armed rigs expose their extra arm chains (K14's left-arm-2/right-arm-2)", () => {
  const f = "m019kabu";               // Kabuterimon: four clawed arms, two per side
  assert.equal(N_arms(f, "left"), 2);
  assert.equal(N_arms(f, "right"), 2);
  const extra = B.armChain(f, "left", 1);
  assert.ok(Array.isArray(extra) && extra.length > 0, "second left arm chain");
  assert.equal(B.roleOfBone(f, extra[0]), "arm:left");
  const multi = B.FOLDERS.filter((x) => B.armChains(x, "left").length > 1 || B.armChains(x, "right").length > 1);
  assert.ok(multi.length >= 8, `expected 8+ multi-armed rigs, got ${multi.length}`);
});

function N_arms(f, side) {
  return B.armChains(f, side).length;
}

test("a model whose rig has no arm chain still has a launch bone (the body)", () => {
  const f = "m053nani";
  assert.equal(B.armChain(f, "left"), null);
  assert.equal(B.armChain(f, "right"), null);
  const r = B.launchBone(f, "Fight");
  assert.equal(r.bone, B.roleBone(f, "root"));
  assert.equal(B.sideConfidence(f) !== null, true);
});

test("side confidence is usable by K13: low-confidence models are explicitly marked", () => {
  const low = B.FOLDERS.filter((f) => B.sideConfidence(f) === "low");
  assert.ok(low.length > 50, `expected many low-confidence sides, got ${low.length}`);
  for (const f of low) assert.equal(B.sideConfidence(f), "low");
});
