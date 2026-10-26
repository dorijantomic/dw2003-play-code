// Guard for the authored anatomy table (K11 output, web/fight/digimon-anatomy.js).
// The deeper audit - including the Python-vs-JS golden comparison - is
// tools/verify_digimon_anatomy.mjs; this keeps the everyday suite honest.
import test from "node:test";
import assert from "node:assert/strict";
import * as A from "../web/fight/digimon-anatomy.js";

const SIZES = new Set(["tiny", "small", "medium", "large", "giant"]);
const MODES = new Set(A.MODES);

test("anatomy table covers every model folder once", () => {
  const folders = Object.keys(A.ANATOMY);
  assert.equal(folders.length, 244, "244 distinct model folders (one folder is rostered twice)");
  assert.deepEqual(A.FOLDERS, [...folders].sort());
  for (const f of folders) assert.ok(A.has(f), `${f} reachable`);
});

test("every record carries legal anatomy fields", () => {
  for (const f of A.FOLDERS) {
    const a = A.ANATOMY[f];
    assert.ok(a.n, `${f}: name`);
    assert.ok(Object.prototype.hasOwnProperty.call(A.BODY_FAMILY, a.plan), `${f}: bodyPlan ${a.plan}`);
    assert.equal(a.fam, A.BODY_FAMILY[a.plan], `${f}: family consistent`);
    assert.ok(SIZES.has(a.size), `${f}: size ${a.size}`);
    assert.ok(Number.isInteger(a.legs) && a.legs >= 0, `${f}: legs`);
    assert.ok(Number.isInteger(a.wings) && a.wings >= 0, `${f}: wings`);
    assert.ok([null, "left", "right", "both"].includes(a.side), `${f}: dominantSide ${a.side}`);
    assert.ok(a.conf >= 0 && a.conf <= 1, `${f}: confidence`);
    for (const [side, kind, builtIn] of a.arm) {
      assert.ok(["left", "right", "center"].includes(side), `${f}: arm side ${side}`);
      assert.ok(typeof kind === "string" && kind, `${f}: arm kind`);
      assert.equal(typeof builtIn, "boolean", `${f}: builtIn flag`);
    }
    for (const [tech, t] of Object.entries(a.tech)) {
      assert.ok(MODES.has(t[0]), `${f}/${tech}: emitter mode ${t[0]}`);
      assert.ok(t[2], `${f}/${tech}: body part annotation present`);
    }
  }
});

test("firingPart prefers the per-technique annotation and names the right limb", () => {
  let annotated = 0;
  for (const f of A.FOLDERS) {
    for (const [tech, t] of Object.entries(A.ANATOMY[f].tech)) {
      annotated++;
      const p = A.firingPart(f, tech);
      assert.equal(p.source, "annotation", `${f}/${tech}: source`);
      assert.equal(p.mode, t[0], `${f}/${tech}: mode`);
    }
  }
  assert.ok(annotated > 1000, `expected >1000 annotations, got ${annotated}`);
});

test("the Minotarumon case from the brief: gun on the LEFT, the DW3 throw from the RIGHT", () => {
  const mino = "m399mta2";
  assert.ok(A.ANATOMY[mino], "Minotarumon is in the table");
  assert.equal(A.dominantSide(mino), "left", "the Demon Arm gun is the LEFT arm");
  const gun = A.ANATOMY[mino].arm.find((x) => x[1] === "gun" || x[1] === "cannon");
  assert.equal(gun[0], "left");
  const fight = A.firingPart(mino, "Fight");
  assert.equal(fight.side, "right", "the in-game throw must leave the RIGHT limb, not the gun arm");
  assert.match(fight.bodyPart, /right/i);
});

test("body-located moves never resolve to an arm side", () => {
  for (const f of A.FOLDERS) {
    for (const [tech, t] of Object.entries(A.ANATOMY[f].tech)) {
      const side = A.firingSide(f, tech);
      if (["mouth", "head", "eyes", "chest", "back", "tail", "wings", "whole-body", "self"].includes(t[0])) {
        assert.equal(side, null, `${f}/${tech}: ${t[0]} must not name an arm side`);
      }
      if (t[0] === "left-arm") assert.equal(side, "left", `${f}/${tech}`);
      if (t[0] === "right-arm") assert.equal(side, "right", `${f}/${tech}`);
    }
  }
});

test("unannotated techniques still resolve, and unknown models are null", () => {
  for (const f of ["m003agum", "m399mta2", "m448bkw9"]) {
    for (const probe of ["not-a-real-technique", "", null]) {
      const p = A.firingPart(f, probe);
      assert.ok(MODES.has(p.mode), `${f}: probe ${String(probe)} -> ${p.mode}`);
    }
  }
  assert.equal(A.anatomy("nope"), null);
  assert.equal(A.firingPart("nope", "Fight").source, "no-model");
});

test("similarity is a metric-ish score: self 1, symmetric, bounded", () => {
  for (const f of A.FOLDERS) assert.equal(A.similarity(f, f), 1, `${f}: self`);
  const sample = A.FOLDERS.filter((_, i) => i % 11 === 0);
  for (const a of sample) {
    for (const b of sample) {
      const s = A.similarity(a, b);
      assert.ok(s >= 0 && s <= 1, `${a}/${b}: ${s}`);
      assert.equal(s, A.similarity(b, a), `${a}/${b}: symmetric`);
    }
  }
});

test("donor ranking prefers the same body family and never returns the target", () => {
  for (const target of ["m399mta2", "m003agum", "m032kune", "m024hoee"]) {
    const ranked = A.rankDonors(target, null, 5);
    assert.equal(ranked.length, 5);
    assert.ok(ranked.every((r) => r.folder !== target));
    assert.ok(ranked.every((r) => r.reasons.length > 0));
    for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score);
    const fam = A.bodyFamily(target);
    const sameFamily = A.rankDonors(target, null, 500).filter((r) => A.bodyFamily(r.folder) === fam);
    if (sameFamily.length) assert.equal(A.bodyFamily(ranked[0].folder), fam, `${target}: top donor family`);
  }
});

test("armament helpers return the declared weapons", () => {
  const m = A.armament("m197gani"); // Crabmon: scissor blade LEFT, grip RIGHT
  assert.ok(m.some((x) => x.where === "left-arm" && /scissor/i.test(x.what)));
  assert.equal(A.dominantSide("m197gani"), "left");
  const lib = A.armament("m197gani").length;
  assert.ok(lib >= 2);
  assert.deepEqual(A.builtInWeapons("m448bkw9").map((x) => x.side).sort(), ["left", "right"]);
});

// ---------------------------------------------------------------- K14: one shot per head/barrel

test("every model carries a legal emitter list with one primary launch site", () => {
  const parts = new Set(A.EMITTER_PARTS);
  const kinds = new Set(A.EMITTER_KINDS);
  for (const f of A.FOLDERS) {
    const list = A.emitters(f);
    const ids = new Set();
    let launch = 0;
    let primaries = 0;
    for (const e of list) {
      assert.ok(e.id, `${f}: emitter id`);
      assert.ok(!ids.has(e.id), `${f}: duplicate emitter ${e.id}`);
      ids.add(e.id);
      assert.ok(parts.has(e.part), `${f}/${e.id}: part ${e.part}`);
      assert.ok(kinds.has(e.kind), `${f}/${e.id}: kind ${e.kind}`);
      assert.ok(Number.isInteger(e.count) && e.count >= 1, `${f}/${e.id}: count`);
      assert.equal(typeof e.primary, "boolean", `${f}/${e.id}: primary flag`);
      assert.equal(typeof e.mouth, "boolean", `${f}/${e.id}: mouth flag`);
      if (e.primary) primaries++;
      if (e.kind !== "melee") launch += e.count;
    }
    assert.equal(A.launchPoints(f), launch, `${f}: launchPoints()`);
    assert.equal(primaries, launch > 0 ? 1 : 0, `${f}: exactly one primary emitter`);
    assert.equal(A.primaryEmitter(f) ? 1 : 0, launch > 0 ? 1 : 0, `${f}: primaryEmitter()`);
  }
  assert.deepEqual(A.emitters("nope"), []);
});

test("every launching technique resolves to a real launch emitter, never a melee limb", () => {
  for (const f of A.FOLDERS) {
    const byId = new Map(A.emitters(f).map((e) => [e.id, e]));
    const launch = A.launchPoints(f);
    for (const [tech, t] of Object.entries(A.ANATOMY[f].tech)) {
      const s = A.shotsFor(f, tech);
      assert.ok(A.SHOT_MODES.includes(s.mode), `${f}/${tech}: mode ${s.mode}`);
      const isLaunching = t[1] === "fires-projectile" || t[1] === "beam" || t[1] === "breath";
      if (isLaunching) {
        assert.ok(s.mode === "single" || s.mode === "per-emitter",
          `${f}/${tech}: launching move is ${s.mode}`);
        assert.ok(s.emitters.length >= 1, `${f}/${tech}: no emitter`);
        for (const id of s.emitters) {
          const e = byId.get(id);
          assert.ok(e, `${f}/${tech}: unknown emitter ${id}`);
          assert.notEqual(e.kind, "melee", `${f}/${tech}: projectile from melee limb ${id}`);
        }
      }
      if (s.mode === "single") assert.equal(s.shots, 1, `${f}/${tech}: single = 1 shot`);
      if (s.mode === "none") assert.equal(s.shots, 0, `${f}/${tech}: none = 0 shots`);
      if (s.mode === "per-emitter") {
        assert.ok(s.shots >= s.emitters.length, `${f}/${tech}: one shot per emitter`);
        assert.ok(s.shots <= launch, `${f}/${tech}: ${s.shots} shots > ${launch} launch points`);
      }
    }
  }
});

test("Deltamon: three mouths fire three fireballs, one per head", () => {
  const e = A.emitters("m138delt");
  assert.equal(e.filter((x) => x.mouth && x.kind !== "melee").length, 3);
  for (const tech of ["Triple Fire", "Flame Ball", "Flame Breath", "Flame Lance"]) {
    const s = A.shotsFor("m138delt", tech);
    assert.equal(s.mode, "per-emitter", `${tech}: mode`);
    assert.equal(s.shots, 3, `${tech}: three shots`);
    assert.equal(new Set(s.emitters).size, 3, `${tech}: three distinct emitters`);
  }
});

test("Minotarumon: the LEFT gun arm is the launcher, the RIGHT limb does the throw", () => {
  const left = A.emitters("m399mta2").find((e) => e.part === "left-arm");
  assert.ok(left, "left arm emitter");
  assert.notEqual(left.kind, "melee", "the Demon Arm is a launch site");
  assert.deepEqual(A.shotsFor("m399mta2", "Fight").emitters, ["right-arm"]);
});

test("single-shot bodies keep one projectile; a volley clip can escalate to per-emitter", () => {
  const agumon = A.shotsFor("m003agum", "Pepper Breath");
  assert.equal(agumon.mode, "single");
  assert.equal(agumon.shots, 1);
  assert.equal(agumon.emitters[0], "mouth");
  // Megadramon: both arm cannons -> two shots; the caller's volley flag cannot exceed them
  const mega = A.shotsFor("m054mgdr", "Twin Missile");
  assert.equal(mega.mode, "per-emitter");
  assert.equal(mega.shots, 2);
  const volley = A.shotsFor("m054mgdr", "Twin Missile", { volley: true });
  assert.equal(volley.shots, 2);
});

test("unknown techniques fall back to the primary emitter or to no launch at all", () => {
  for (const f of A.FOLDERS) {
    const s = A.shotsFor(f, "zzz-not-a-technique");
    if (A.primaryEmitter(f)) {
      assert.equal(s.mode, "single", `${f}: fallback mode`);
      assert.equal(s.shots, 1, `${f}: fallback shots`);
      assert.equal(s.emitters[0], A.primaryEmitter(f).id, `${f}: fallback emitter`);
    } else {
      assert.equal(s.mode, "none", `${f}: no launcher -> none`);
      assert.equal(s.shots, 0);
    }
  }
});

// ---------------------------------------------------------------- K17: arm equipment from the data

test("every arm carries a measured equip verdict with legal values", () => {
  const classes = new Set(A.ARM_EQUIP_CLASSES);
  let rows = 0;
  let high = 0;
  for (const f of A.FOLDERS) {
    const sides = new Set((A.ANATOMY[f].arm || []).map((x) => x[0]));
    const table = A.ARM_EQUIP[f];
    assert.ok(table && typeof table === "object", `${f}: ARM_EQUIP entry`);
    for (const side of Object.keys(table)) {
      assert.ok(side === "left" || side === "right", `${f}: side ${side}`);
      const eq = A.armEquip(f, side);
      rows++;
      assert.ok(classes.has(eq.class), `${f}/${side}: class ${eq.class}`);
      assert.ok(["hand-mesh", "prop-bone"].includes(eq.source), `${f}/${side}: source ${eq.source}`);
      assert.ok(["high", "low"].includes(eq.confidence), `${f}/${side}: confidence`);
      assert.ok(Number.isInteger(eq.bone), `${f}/${side}: bone ${eq.bone}`);
      assert.ok(eq.features && Number.isFinite(eq.features.ln), `${f}/${side}: features`);
      if (eq.confidence === "high") high++;
    }
  }
  assert.ok(rows >= 350, `expected >350 measured arms, got ${rows}`);
  assert.ok(high >= 100, `expected a solid high-confidence core, got ${high}`);
  // unknown models answer legally instead of throwing
  assert.equal(A.armEquip("nope", "left").class, "none");
  assert.equal(A.armArmed("nope", "left"), false);
});

test("K17 controls: weapon, shield, bare hand and gun housing read from the mesh", () => {
  // SkullSatamon: staff in the RIGHT hand (elongated), left is a bare claw.
  assert.equal(A.armEquip("m244skst", "right").class, "elongated");
  assert.equal(A.armEquip("m244skst", "left").class, "bare");
  assert.ok(A.armArmed("m244skst", "right"));
  // Minotarumon: the left Demon Arm gun housing is bulky; the right fist is not a prop.
  assert.equal(A.armEquip("m399mta2", "left").class, "bulky");
  assert.equal(A.armArmed("m399mta2", "right"), false);
  // Gallantmon: lance in the right hand, flat shield on the left.
  assert.equal(A.armEquip("m369duke", "right").class, "elongated");
  assert.equal(A.armEquip("m369duke", "left").class, "flat");
  // Knightmon: greatsword right, NO shield left (the user's correction is what the mesh says).
  assert.equal(A.armEquip("m178kngt", "right").class, "elongated");
  assert.equal(A.armEquip("m178kngt", "left").class, "bare");
  const kn = A.ANATOMY["m178kngt"].arm;
  assert.equal(kn.find((x) => x[0] === "left")[1], "hand");
});
