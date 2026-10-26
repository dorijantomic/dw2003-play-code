// The A2 donor plan, implemented in web/fight/clip-fallback.js: every gap in clips 5 (basic), 9 (spell) and 10
// (item use) gets a real BODY animation built from the model's own tables, with a donor supplying the script
// shape / the twin's tables. These tests pin the four properties the plan turns on:
//
//   1. a model with NO basic attack plays a body table of its own (not "return to base idle", the old bug);
//   2. a giant plants its feet - its built clip carries no dash / leap arm;
//   3. a spell keeps the model's own basic-attack body and takes the donor's cast (projectile + effect);
//   4. a pose-identical TWIN's clip borrows the twin's tables into the model's timeline IN MEMORY, untouched
//      on disk, and a donor authored for the other arena side is turned around for this one.
//
// They read the model packs (web/assets is a symlink to the disc-derived data) and skip when it is absent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ANIM_DONOR_GAPS, donorRow, isGiant } from "../web/fight/anim-donor-map.js";
import { resolveClipScript, prepareModelDonors, registerDonorAnim, setFallbackDonor,
         scriptTableSeq, victimAnchor } from "../web/fight/clip-fallback.js";
import { authoredSide } from "../web/fight/side-mirror.js";
import { bodyPlan } from "../web/fight/digimon-anatomy.js";
import { modelRestSize } from "../web/battle3d.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const HAVE_PACKS = fs.existsSync(path.join(MODELS, "m005grey/anim.json"));
const read = (folder) => JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
const skip = HAVE_PACKS ? false : "model packs are not installed";
const asOps = (script) => script.ops.map((o) => [o.op, ...(o.words ?? [])]);
/** The measured rest-pose height the donor ranking's size term uses. */
const modelHeight = (folder) => modelRestSize(read(folder))?.h || 0;

/** Register the donor a row names (as the battle's loader does) and prepare the model. */
async function prepared(folder, clip) {
  const model = read(folder);
  const row = donorRow(folder, clip);
  registerDonorAnim(row.d, read(row.d));
  await prepareModelDonors(model);
  return model;
}

if (HAVE_PACKS) setFallbackDonor(read("m005grey").actions);

test("the map names the body table of every clip-5 gap and marks the giants", () => {
  // K15b: the donor is picked from the anatomy table by RULE (same bodyPlan first, then the armament the
  // clip uses, then measured size) - so the row names a body of the same plan with a real size match, not
  // a hand-picked folder. The giant flag is a property of the TARGET's bulk, not of the donor.
  const row = donorRow("m441raiz", 5);
  assert.equal(row.m, "own-table-body");
  assert.deepEqual(row.t, [44]);
  assert.notEqual(row.d, "m441raiz", "a model cannot be its own donor");
  assert.equal(bodyPlan(row.d), bodyPlan("m441raiz"), "the donor shares the target's body plan");
  assert.ok(Math.abs(Math.log(modelHeight(row.d) / modelHeight("m441raiz"))) < 0.3,
    "the donor's measured rest height is within 1.35x of the target's");
  assert.deepEqual(donorRow("m175krsr", 5).t, [12]);
  assert.deepEqual(donorRow("m175krsr", 9).t, [12]);
  assert.deepEqual(donorRow("m175krsr", 10).t, [12]);
  assert.equal(donorRow("m010sead", 9).m, "borrow-tables");
  assert.equal(donorRow("m005grey", 5), null, "a model that has the clip has no row");
  assert.equal(isGiant("m441raiz"), true, "Raijinmon is a giant: it must not lunge");
  assert.equal(isGiant("m281tiro"), true);
  assert.equal(isGiant("m175krsr"), false);
});

test("a model with no basic attack plays its own body table for clip 5, not the idle", { skip }, async () => {
  const model = await prepared("m441raiz", 5);
  const script = resolveClipScript(model, 5, { element: 1 });
  assert.deepEqual(scriptTableSeq(script), [44], "the body is Raijinmon's own t44, not table 1 (the idle)");
  assert.equal(script.ops.filter((o) => o.op === 10 && (o.words[0] | 0) === 99).length, 1, "one strike");
  assert.deepEqual(script.ops.at(-2).words, [0, 0, 1], "the clip returns to the base idle");
  assert.equal(script.ops.at(-1).op, 255);
  assert.equal(script.camAuthored, "own", "the donor is authored on this model's own side, so its camera is not pre-turned");

  // the same recipe for the other two models that have no clip 5 at all
  for (const [folder, table] of [["m175krsr", 12], ["m422krs2", 38]]) {
    const m = await prepared(folder, 5);
    assert.deepEqual(scriptTableSeq(resolveClipScript(m, 5, { element: 1 })), [table], folder);
  }
});

test("a giant plants its feet: no dash, no hop, no leap in the clip it plays", { skip }, async () => {
  const raiz = await prepared("m441raiz", 5);
  const tiro = await prepared("m281tiro", 9);           // its own basic attack does author a leap
  assert.ok(tiro.actions[5].ops.some((o) => o.op === 2 && (o.words[0] | 0) === 5), "Tylomon's own clip 5 leaps");
  for (const [model, clip] of [[raiz, 5], [tiro, 9]]) {
    const script = resolveClipScript(model, clip, { element: 1 });
    assert.equal(script.ops.filter((o) => o.op === 2 && (o.words[0] | 0) === 8).length, 0, `clip ${clip}: no contact dash`);
    assert.equal(script.ops.filter((o) => o.op === 2 && (o.words[0] | 0) === 5 && (o.words[2] | 0) !== 0).length, 0, `clip ${clip}: no hop/leap arm`);
    assert.equal(script.ops.filter((o) => o.op === 2 && (o.words[0] | 0) === 3).length, 0, `clip ${clip}: no absolute leap`);
    assert.ok(script.ops.some((o) => o.op === 10 && (o.words[0] | 0) === 99), `clip ${clip}: still strikes`);
  }
});

test("a spell plays the model's own basic-attack body and takes the donor's cast", { skip }, async () => {
  // the own-body spell path. (A model whose clip-9 donor clears the A10 retarget gate takes the retargeted
  // cast instead - see castFromDonor - so this case uses a body that still builds from its own basic.)
  const model = await prepared("m031pata", 9);
  const script = resolveClipScript(model, 9, { element: 2 });
  assert.deepEqual(scriptTableSeq(script), scriptTableSeq(model.actions[5]),
    "the body is the model's own basic attack, table for table - not one borrowed table held to the end");
  assert.deepEqual(script.ops.slice(0, 4).filter((o) => o.op === 10).length, 0);
  const shot = script.ops.find((o) => o.op === 6 && (o.words[0] | 0) === 0);
  assert.ok(shot, "the spell fires a projectile");
  assert.equal(shot.words[1], 221, "element 2 fires sprite 221");
  const fx = script.ops.filter((o) => o.op === 3 && (o.words[1] | 0) === 9999);
  assert.ok(fx.some((o) => (o.words[0] | 0) === 0), "the technique's own effect spawns (op3 9999)");
  const strike = script.ops.findIndex((o) => o.op === 10 && (o.words[0] | 0) === 99);
  assert.ok(script.ops.indexOf(shot) < strike, "the cast leaves the hand before the strike lands");
  assert.equal(script.ops.filter((o) => o.op === 10 && (o.words[0] | 0) === 99).length, 1);
  assert.equal(script.camAuthored, "own");
});

test("a spell body draws on every table of the model's basic attack", { skip }, async () => {
  // Tylomon's spell used to bind its t14 alone and hold one pose for the whole clip (the A1 "reads as idling"
  // failure): the body must be the whole sequence the model authored for a basic attack - UNLESS the pair's
  // retarget clears the automatic gate, in which case the cast body IS the presentation (K16 role bake: the
  // donor's cast retargeted onto this skeleton, its own table bound once). Either way the body is a real
  // animation and the spell fires.
  const model = await prepared("m281tiro", 9);
  const script = resolveClipScript(model, 9, { element: 1 });
  const bake = model.castBakes?.[9];
  if (bake?.table != null) {
    assert.deepEqual(scriptTableSeq(script), [bake.table], "the retargeted cast body's own table is the body");
    assert.ok(bake.gate?.used, "only a pair the gate accepted can bake a cast body");
    assert.equal(script.ops.filter((o) => o.op === 6 && (o.words?.[0] | 0) === 0).length, 1,
      "the cast still launches its projectile (a donor cast with no op6 of its own gets the plan's)");
  } else {
    assert.deepEqual(scriptTableSeq(script), [14, 15, 16, 17]);
  }
});

test("a pose-identical twin's skipped clip borrows the twin's tables in memory", { skip }, async () => {
  const model = read("m010sead");
  assert.equal(model.timeline?.[38]?.table?.length ?? 0, 0, "the model has no table 38 of its own");
  registerDonorAnim("m408sea2", read("m408sea2"));
  await prepareModelDonors(model);
  assert.ok(model.timeline[38]?.table?.length, "the twin's table playlist is attached at load");
  const script = resolveClipScript(model, 9, { element: 1 });
  assert.deepEqual(scriptTableSeq(script), [38]);
  // A12: the borrowed clip keeps the TWIN's table binds and its timing (the tables are copied into this
  // model's timeline at load), but the presentation is re-anchored like every built enemy script: the twin's
  // screen-space spawn and its camera cut are dropped, and the technique's effect lands on THIS model's
  // victim line (a cut names a slot, so it frames the wrong fighter once the script is mirrored).
  const donor = read("m408sea2").actions[9];
  const binds = (ops) => ops.filter((o) => o.op === 2 && (o.words?.[0] | 0) === 0 && (o.words?.[2] | 0) > 1).map((o) => o.words.join(","));
  assert.deepEqual(binds(script.ops), binds(donor.ops), "the same tables are bound, in the same order");
  assert.equal(script.ops.filter((o) => o.op === 5).length, 0, "a built script installs no camera cut");
  assert.equal(script.ops.filter((o) => o.op === 3 && (o.words?.[0] | 0) === 0 && (o.words?.[4] | 0) === 32767).length, 0,
    "no screen-space spawn survives the build");
  assert.ok(script.ops.some((o) => o.op === 3 && (o.words?.[1] | 0) === 9999 && (o.words?.[4] | 0) === victimAnchor(model).z),
    "the technique's effect is on this model's victim line");
  assert.equal(script.camAuthored, "own", "the borrowed script installs no authored camera");
});

test("a donor authored for the other arena side is turned around for this model", { skip }, async () => {
  // An enemy-authored model whose donor is player-authored: the cast must aim down THIS model's side -
  // the effect lands on its victim line and the projectile leaves from its own hand. The pair is found
  // by scanning the map (K18 changed which donor Frigimon takes), so the test never pins one row.
  let pair = null;
  for (const [folder, clips] of Object.entries(ANIM_DONOR_GAPS)) {
    for (const [clip, row] of Object.entries(clips)) {
      if (!fs.existsSync(path.join(MODELS, folder, "anim.json"))) continue;
      if (!fs.existsSync(path.join(MODELS, row.d, "anim.json"))) continue;
      if (authoredSide(read(folder)) !== "enemy" || authoredSide(read(row.d)) !== "player") continue;
      if (Number(clip) !== 9 || row.m === "borrow-tables") continue;
      pair = [folder, Number(clip)];
      break;
    }
    if (pair) break;
  }
  assert.ok(pair, "the map still pairs an enemy-authored model with a player-authored donor");
  const [folder, clip] = pair;
  const row = donorRow(folder, clip);
  const model = await prepared(folder, clip);
  const donor = read(row.d);
  assert.equal(authoredSide(model), "enemy");
  assert.equal(authoredSide(donor), "player");
  const script = resolveClipScript(model, clip, { element: 1 });
  const shot = script.ops.find((o) => o.op === 6 && (o.words[0] | 0) === 0);
  assert.ok(shot, "the cast fires a projectile");
  // A10: the launch point is the CASTER's weapon, so its z sits on the caster's own home line (the mirror
  // of the victim line), not on the donor's.
  assert.equal(Math.sign(shot.words[4]), Math.sign(victimAnchor(model).z), "the shot leaves down this model's side");
  const fx = script.ops.filter((o) => o.op === 3 && (o.words[1] | 0) === 9999 && (o.words[0] | 0) === 0);
  assert.ok(fx.some((o) => (o.words[4] | 0) === victimAnchor(model).z), "the technique's effect is on this model's victim line");
  assert.equal(shot.words[1], 220, "the sprite is this model's element-1 projectile");
});

test("the Greymon last resort still covers clips and models outside the map", { skip }, () => {
  const model = { folder: "m000none", actions: [], timeline: [] };
  const script = resolveClipScript(model, 9, { element: 1 });
  assert.ok(script && script.ops.length, "a script is still built");
  // A10 routed the last resort through the same builders as any map donor: it never inherits the donor's
  // camera (a player-authored cut framed that donor), so the build owns its shot (the arena camera) and A12's
  // presentation rules keep the effect in world space on the victim.
  assert.equal(script.camAuthored, "own", "the last resort installs no donor camera");
  assert.equal(script.ops.filter((o) => o.op === 5).length, 0);
  assert.ok(script.ops.some((o) => o.op === 3 && (o.words?.[1] | 0) === 9999), "the technique's effect is spawned");
});
