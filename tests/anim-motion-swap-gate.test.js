// K22a — the motion-swap acceptance rule. Two layers:
//   1. the verdict arithmetic, on synthetic measurements (no assets needed): every kind's bars decide the
//      right way, a death is never asked to return to idle, a cast is, a frozen retarget is refused;
//   2. the rule against data: the DW3->DW3 control pair K21d called "a plain borrowed cast" MUST pass;
//      the two DW2 pairs K21d measured are refused on the numbers they were refused on. The DW2 half
//      skips when the converted disc data is not present (it is generated locally, never committed).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  SWAP_BARS, SWAP_BARS_SOURCE, SWAP_KINDS, SWAP_SLOTS, SWAP_RETURNS, WORLD_BARS, kindOfSlot, judge, judgeFill,
  judgeNumbers, ownNumbers, measureSwap, swapLadder, fillLadder, playedFrames,
} from "../web/fight/motion-swap-gate.js";
import { bakeRetargetByRole, bakeRetargetWorld, rigOf } from "../web/fight/anim-retarget.js";
import { BONEMAP } from "../web/fight/digimon-bonemap.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const HAVE = fs.existsSync(path.join(MODELS, "m009mera/anim.json")) && fs.existsSync(path.join(MODELS, "m005grey/anim.json"));
const skip = HAVE ? false : "model packs are not installed";
const read = (folder) => {
  const m = JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
  m.folder = folder;
  return m;
};
const DW2 = "/home/dorij/dw2-models/converted";
const HAVE_DW2 = fs.existsSync(path.join(DW2, "dw2_009mera/anim.json")) && fs.existsSync(path.join(DW2, "dw2_050coca/anim.json"));
const skipDw2 = HAVE_DW2 ? false : "the converted DW2 data is not present (local only)";
const K21D = "/home/dorij/scratch-research/k21d";
const HAVE_MAPS = HAVE_DW2 && fs.existsSync(path.join(K21D, "dw2-bonemap.json")) && fs.existsSync(path.join(K21D, "dw2_050coca-bonemap.json"));

/** A measurement that passes every bar for `kind`, so a test can move ONE number at a time. */
function passingNumbers(kind) {
  const B = SWAP_BARS[kind];
  return {
    frames: 60, range: [6000, 6059], table: 62,
    covered: 1, mapped: 20, bones: 20, height: 2000, donorHeight: 1000, sizeRatio: 2, mirror: false, ik: "role+ik", ikClamped: 0,
    step: B.step * 0.5, stepBone: 3, stepAt: 6010,
    ankle: B.ankle * 0.5, ankleLat: 0.2,
    groundBelow: B.groundBelow * 0.5, groundAbove: B.groundAbove * 0.5, groundEnd: 0,
    pen: 0.01, penWorst: -0.1, penFloor: -0.15,
    return: SWAP_RETURNS[kind] ? (B.return ?? 0) * 0.5 : 2.0, endToStart: 1.0,
    speed: B.speed * 0.5, speedAt: 6011, speedBone: 5,
    hand: 1.0, handTravel: 0.4, donorTravel: 0.4, dir: 20,
    energy: 1.0, motion: 1.0, donorEnergy: 0.5, donorMotion: 0.4,
    limbs: { targetArms: 2, targetLegs: 2, props: 0, donorArms: 2, donorLegs: 2 },
  };
}
const own = { clips: 12, ankle: 0.2, step: 1.0, pen: 0, groundBelow: 0.1, groundAbove: 0.1, groundEnd: 0.1, height: 2000, legs: 2, arms: 2 };

test("every kind has a full bar row and a slot list", () => {
  for (const kind of SWAP_KINDS) {
    assert.ok(SWAP_SLOTS[kind]?.length, `${kind} has slots`);
    const B = SWAP_BARS[kind];
    for (const key of ["ankle", "step", "pen", "groundBelow", "groundAbove", "speed", "hand", "energy", "motion"]) {
      assert.equal(typeof B[key], "number", `${kind}.${key} is a number`);
      assert.ok(B[key] > 0, `${kind}.${key} is positive`);
    }
    assert.ok(B.n > 0, `${kind} states how many clips it was measured on`);
  }
  assert.equal(SWAP_RETURNS.death, false, "a death clip does not return to idle");
  assert.equal(SWAP_RETURNS.cast, true, "a cast does");
  assert.equal(SWAP_RETURNS.hit, true, "a hit reaction does");
  // the slots the engine actually uses
  assert.equal(kindOfSlot(0), "idle");
  assert.equal(kindOfSlot(3), "death");
  assert.equal(kindOfSlot(5), "attack");
  assert.equal(kindOfSlot(9), "cast");
  assert.equal(kindOfSlot(11), "attack");
  assert.equal(kindOfSlot(10), "item");
  assert.equal(kindOfSlot(12), null);
  assert.ok(SWAP_BARS_SOURCE.shape.quantile && SWAP_BARS_SOURCE.fidelity.quantile, "the quantiles are stated");
});

test("a measurement inside every bar passes, for every kind", () => {
  for (const kind of SWAP_KINDS) {
    const v = judgeNumbers(passingNumbers(kind), kind, { own });
    assert.deepEqual(v.keys, [], `${kind}: ${v.keys.join(",")}`);
    assert.equal(v.pass, true);
  }
});

test("each shape bar refuses on its own, and names itself", () => {
  const cases = [
    ["ankle", (B) => B.ankle * 1.2],
    ["step", (B) => B.step * 1.2],
    ["groundBelow", (B) => (B.groundBelow + own.groundBelow) * 1.2],
    ["groundAbove", (B) => (B.groundAbove + own.groundAbove) * 1.2],
  ];
  for (const [key, over] of cases) {
    const n = passingNumbers("attack");
    n[key] = over(SWAP_BARS.attack);
    const v = judgeNumbers(n, "attack", { own });
    assert.ok(v.keys.includes(key), `attack ${key} -> ${v.keys.join(",")}`);
    assert.equal(v.pass, false);
  }
});

test("a death is not judged on return, a cast and a hit reaction are", () => {
  const d = passingNumbers("death");
  d.return = 3.1;                       // a corpse does not stand up
  assert.equal(judgeNumbers(d, "death", { own }).pass, true);
  for (const kind of ["cast", "hit", "idle"]) {
    const n = passingNumbers(kind);
    n.return = (SWAP_BARS[kind].return ?? 0) + 0.5;
    const v = judgeNumbers(n, kind, { own });
    assert.ok(v.keys.includes("return"), `${kind}: ${v.keys.join(",")}`);
  }
});

test("a frozen or exploded retarget is refused on fidelity, a static donor is not judged", () => {
  const frozen = passingNumbers("cast");
  frozen.motion = 0.1;                  // 0.25 floor
  assert.ok(judgeNumbers(frozen, "cast", { own }).keys.includes("motion(frozen)"));
  const staticDonor = passingNumbers("cast");
  staticDonor.donorEnergy = 0.001;      // the donor itself barely moves: 0/0 is not a defect
  staticDonor.energy = 99;
  const v = judgeNumbers(staticDonor, "cast", { own });
  assert.equal(v.keys.includes("energy"), false);
  assert.ok(v.notes.some((n) => /energy/.test(n)));
  const fast = passingNumbers("attack");
  fast.speed = SWAP_BARS.attack.speed * 1.5;   // a one-frame snap the donor never did
  assert.ok(judgeNumbers(fast, "attack", { own }).keys.includes("speed"));
});

test("per-model allowance: the body's own repertoire raises a bar, never lowers it", () => {
  const n = passingNumbers("hit");
  n.ankle = SWAP_BARS.hit.ankle * 1.1;         // over the corpus p95 ...
  assert.equal(judgeNumbers(n, "hit", { own }).pass, false);
  const loose = { ...own, ankle: n.ankle * 1.1 };  // ... but this body's own clips go further
  assert.equal(judgeNumbers(n, "hit", { own: loose }).pass, true);
});

test("coverage: a missing limb the kind needs refuses the swap", () => {
  const n = passingNumbers("cast");
  n.limbs = { ...n.limbs, donorArms: 0 };
  assert.ok(judgeNumbers(n, "cast", { own }).keys.includes("coverage(arms)"));
  const death = passingNumbers("death");
  death.limbs = { ...death.limbs, donorArms: 0 };  // a death may leave the arms alone
  assert.equal(judgeNumbers(death, "death", { own }).pass, true);
  const low = passingNumbers("attack");
  low.covered = 0.4;
  assert.ok(judgeNumbers(low, "attack", { own }).keys.includes("coverage"));
});

test("the DW3->DW3 control pair passes the swap rule (the pair castGate refuses)", { skip }, () => {
  const target = read("m009mera"), donor = read("m005grey");
  const bake = bakeRetargetByRole(target, donor, 9, { offset: 6000 });
  assert.ok(bake, "the bake exists");
  bake.source = donor;
  bake.method = "role+ik";
  const v = judge(bake, "cast", target);
  assert.equal(v.pass, true, `control refused: ${v.keys.join(",")}`);
  // the numbers the report quotes, so a retune cannot silently move them
  assert.ok(v.numbers.speed < SWAP_BARS.cast.speed, "speed inside the same-engine p95");
  assert.ok(v.numbers.return <= SWAP_BARS.cast.return, "hands back to idle");
  assert.ok(v.numbers.step > 1.4, "and it really is the snappy control (step ~1.6 rad/frame)");
});

test("the same control passes as a K23 world FILL of the empty cast slot", { skip }, () => {
  const target = read("m009mera"), donor = read("m005grey");
  const bake = bakeRetargetWorld(target, donor, 9, { offset: 6000 });
  assert.ok(bake, "the world bake exists");
  bake.source = donor; bake.method = "world";
  const v = judgeFill(bake, 9, target);
  assert.equal(v.owned, false, "clip 9 is not a clip this body plays");
  assert.equal(v.pass, true, `control fill refused: ${v.keys.join(",")} ${JSON.stringify(v.numbers)}`);
  assert.equal(v.numbers.startRest, 0, "starts at the bake's rest");
  assert.equal(v.numbers.endRest, 0, "and ends there");
});

test("the model's own numbers are measurable and the baked table is what gets measured", { skip }, () => {
  const target = read("m009mera");
  const o = ownNumbers(target);
  assert.ok(o.clips >= 5, `own clips ${o.clips}`);
  assert.ok(o.step > 0.5 && o.step < 3, `own step ${o.step}`);
  assert.ok(o.height > 1000, "body height in model units");
  const donor = read("m005grey");
  const bake = bakeRetargetByRole(target, donor, 9, { offset: 6000 });
  bake.source = donor;
  const n = measureSwap(bake);
  const frames = playedFrames(bake.model, bake.table);
  assert.equal(n.frames, frames.length, "every played frame of the baked table is measured");
  assert.ok(n.range[0] >= 6000, "the bake lives past the model's own keys");
});

test("the refusal ladder falls through to the next candidate, then to the current clip", { skip }, () => {
  const target = read("m009mera"), donor = read("m005grey");
  const bake = bakeRetargetByRole(target, donor, 9, { offset: 6000 });
  bake.source = donor;
  bake.method = "role+ik";
  const build = () => [() => null, () => bake];
  const ok = swapLadder(target, donor, 9, "cast", { build });
  assert.equal(ok.pass, true);
  assert.equal(ok.method, "role+ik");
  assert.equal(ok.steps.length, 2);
  assert.deepEqual(ok.steps[0].keys, ["no-bake"]);
  // nothing acceptable: the ladder names the current clip as the fallback
  const bad = swapLadder(target, donor, 9, "cast", { build: () => [() => bake] , bars: { ...SWAP_BARS.cast, speed: 0.01 } });
  assert.equal(bad.pass, false);
  assert.equal(bad.fallback, "keep-own");
  assert.equal(bad.chosen, null);
});

test("DW2 Meramon attack is refused as the IK bake (speed) and the death is refused (feet)", { skip: skipDw2 || !HAVE_MAPS }, () => {
  const src = JSON.parse(fs.readFileSync(path.join(DW2, "dw2_009mera/anim.json"), "utf8"));
  BONEMAP[src.folder] = JSON.parse(fs.readFileSync(path.join(K21D, "dw2-bonemap.json"), "utf8")).map;
  const target = read("m009mera");
  const clipOf = (letter) => src.clips.find((c) => c.letter === letter).index;
  const ik = bakeRetargetByRole(target, src, clipOf("I"), { offset: 6000, ik: true });
  ik.source = src; ik.method = "role+ik";
  const attack = judge(ik, "attack", target);
  assert.equal(attack.pass, false);
  assert.ok(attack.keys.includes("speed"), `attack refused on ${attack.keys.join(",")}`);
  const death = bakeRetargetByRole(target, src, clipOf("K"), { offset: 6000, ik: true });
  death.source = src; death.method = "role+ik";
  const dead = judge(death, "death", target);
  assert.equal(dead.pass, false);
  assert.ok(dead.keys.includes("ankle"), `death refused on ${dead.keys.join(",")}`);
  assert.ok(dead.numbers.ankle > 0.6, "the death lifts the feet most of a body height");
});

// ── K23 fills: a slot the model does NOT own, judged on the world bake ──────────────────────────────
test("a fill of an empty cast slot passes on the world bake (Kokatorimon F -> clip 9)", { skip: skipDw2 || !HAVE_MAPS }, () => {
  const src = JSON.parse(fs.readFileSync(path.join(DW2, "dw2_050coca/anim.json"), "utf8"));
  BONEMAP[src.folder] = JSON.parse(fs.readFileSync(path.join(K21D, "dw2_050coca-bonemap.json"), "utf8")).map;
  const target = read("m050coca");
  const clip = src.clips.find((c) => c.letter === "F").index;
  const bake = bakeRetargetWorld(target, src, clip, { offset: 6000 });
  assert.ok(bake, "the world bake exists");
  bake.source = src; bake.method = "world";
  const v = judgeFill(bake, 9, target);
  assert.equal(v.owned, false, "clip 9 is a slot this body does not own");
  assert.equal(v.pass, true, `fill refused: ${v.keys.join(",")} ${JSON.stringify(v.numbers)}`);
  assert.ok(v.numbers.startRest <= WORLD_BARS.cast.start, `starts at its rest (${v.numbers.startRest})`);
  assert.ok(v.numbers.endRest <= WORLD_BARS.cast.end, `ends at its rest (${v.numbers.endRest})`);
  assert.ok(v.numbers.frames >= 50, "the whole donor clip is baked");
});

test("the default fill ladder really builds the world bake (the import K23 needs)", { skip: skipDw2 || !HAVE_MAPS }, () => {
  const src = JSON.parse(fs.readFileSync(path.join(DW2, "dw2_050coca/anim.json"), "utf8"));
  BONEMAP[src.folder] = JSON.parse(fs.readFileSync(path.join(K21D, "dw2_050coca-bonemap.json"), "utf8")).map;
  const target = read("m050coca");
  const clip = src.clips.find((c) => c.letter === "F").index;
  const r = fillLadder(target, src, clip, 9);
  assert.equal(r.steps[0].method, "world", `first candidate is the world bake, not ${JSON.stringify(r.steps[0])}`);
  assert.equal(r.pass, true, `ladder refused: ${JSON.stringify(r.steps)}`);
  assert.equal(r.chosen.method, "world");
});

test("a fill into a slot the model OWNS is refused before any number is read", { skip }, () => {
  const target = read("m009mera");
  assert.ok(playedFrames(target, 5).length > 1, "clip 5 is owned");
  const v = judgeFill(null, 5, target);
  assert.equal(v.owned, true);
  assert.ok(v.keys.includes("owned"));
  assert.equal(v.pass, false);
});

test("the fill ladder tries the world bake first and keeps the current clip when it refuses", { skip }, () => {
  const target = read("m009mera"), donor = read("m005grey");
  const stub = { model: target, table: 62, offset: 6000, map: [], covered: 0, metrics: { neutralFrame: 0 } };
  const ok = fillLadder(target, donor, 9, 9, { build: () => [() => stub] , judgeOpts: {} });
  assert.equal(ok.kind, "cast");
  assert.equal(ok.slot, 9);
  assert.equal(ok.pass, false, "a stub with an empty map cannot pass");
  assert.equal(ok.fallback, "keep-own", "nothing acceptable -> today's behaviour");
});
