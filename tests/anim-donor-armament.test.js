// K18: WHY GALLANTMON LOST FOR KNIGHTMON. The K15b armament term compared two different things - a
// target that misses a clip was described by its BODY (every launch site the research gives it), a
// donor that owns the clip by that CLIP's move. A knight whose researched spell leaves its shield hand
// was therefore scored as a "left-arm shield body" although it leads with a hafted weapon on the right
// (Gallantmon for Knightmon), and lost the class, the side and part of the armament weight.
//
// These tests pin the K18 properties on the shipped map, without the disc-derived census the ranker
// itself reads:
//
//   1. the donor the ranking picks leads with the SAME weapon class as the target (K17's measured arm
//      equipment first, the research arm kind second) - the body half of the armament term;
//   2. a target whose main hand measurably ends in a prop never gets a donor with no prop at all
//      ("a sword knight does not borrow a bare-handed body");
//   3. the named case: Knightmon clip 9 takes an upright humanoid body that leads with a hafted
//      weapon, and Gallantmon - the body the user pointed at - is such a body (lance right, shield
//      left, dominant right), so the pair is a same-class match rather than a shield-vs-sword clash.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ANIM_DONOR_GAPS, donorRow } from "../web/fight/anim-donor-map.js";
import { anatomy, armEquip, dominantSide, bodyPlan, speciesType } from "../web/fight/digimon-anatomy.js";

const rows = [];
for (const [folder, clips] of Object.entries(ANIM_DONOR_GAPS)) {
  for (const [clip, row] of Object.entries(clips)) rows.push({ folder, clip: Number(clip), row });
}

// The K18 body vocabulary, ported from the generator (k15_donors.py arm_class/body_arms): the measured
// shape (K17) decides whether an arm ends in a prop and its geometry, the research kind decides what
// that prop IS when it names one, and a bare measured arm is a hand.
const ARM_CLASS = {
  sword: "hafted", lance: "hafted", axe: "hafted", hammer: "hafted", blade: "hafted",
  staff: "hafted", club: "hafted", gun: "gun", cannon: "gun", claw: "melee", fist: "melee",
  hand: "melee", shield: "shield", tentacle: "grapple", pincer: "grapple", wing: "wing",
};
const SHAPE = { elongated: "hafted", flat: "shield", bulky: "bulky", bare: "melee" };
const PRIORITY = { hafted: 5, gun: 4, bulky: 3, melee: 2, grapple: 1, shield: 0 };

/** The functional class of one arm: measured shape + the research's naming of the weapon. */
function armClass(folder, side) {
  const a = anatomy(folder);
  const rows = ((a && a.arm) || []).filter((x) => x[0] === side);
  const kinds = rows.map((x) => ARM_CLASS[x[1]]).filter(Boolean);
  const res = kinds.length ? kinds.sort((x, y) => PRIORITY[y] - PRIORITY[x])[0] : null;
  const shape = SHAPE[armEquip(folder, side).class] || null;
  if (shape === "melee") return "melee";
  if (shape === "hafted") return ["gun", "shield"].includes(res) ? res : "hafted";
  if (shape === "shield") return res === "hafted" ? "hafted" : "shield";
  if (shape === "bulky") return ["gun", "hafted", "shield"].includes(res) ? res : "bulky";
  return res;
}

/** The class of the weapon a body leads with: the arm on its dominant side. */
function mainHand(folder) {
  const a = anatomy(folder);
  const arms = (a && a.arm) || [];
  const dom = dominantSide(folder);
  if (dom === "left" || dom === "right") {
    const c = armClass(folder, dom);
    if (c) return c;
  }
  const all = arms.map((x) => ARM_CLASS[x[1]]).filter(Boolean);
  return all.length ? all.sort((x, y) => PRIORITY[y] - PRIORITY[x])[0] : null;
}

/** Does this body carry a weapon-like extension on either arm? K17's measured equipment first, then
 *  the research's built-in weapon limbs (a canon blade arm the mesh measurement reads as a bare claw). */
const carriesProp = (folder) => {
  if (["left", "right"].some((s) => ["elongated", "flat", "bulky"].includes(armEquip(folder, s).class))) {
    return true;
  }
  const arms = (anatomy(folder) && anatomy(folder).arm) || [];
  return arms.some(([, kind, builtIn]) => builtIn && ARM_CLASS[kind]);
};

test("the donor leads with the same weapon class as the target", () => {
  let n = 0, same = 0, same9 = 0, n9 = 0;
  for (const { folder, clip, row } of rows) {
    const t = mainHand(folder), d = mainHand(row.d);
    if (!t || !d) continue;
    n++;
    if (t === d) same++;
    if (clip === 9) { n9++; if (t === d) same9++; }
  }
  // K15b shipped 44.8% on this same class definition (k18-sweep.md); K18 ships ~65% of what the
  // candidate pool makes reachable at all, because the pool is also gated on the body family and the
  // measured size.
  assert.ok(same / n >= 0.62, `same main-hand class on ${same}/${n} rows`);
  assert.ok(same9 / n9 >= 0.65, `same main-hand class on ${same9}/${n9} clip-9 rows`);
});

test("a target whose main hand ends in a prop never borrows a bare-handed body", () => {
  let n = 0;
  for (const { folder, row } of rows) {
    const dom = dominantSide(folder);
    if (dom !== "left" && dom !== "right") continue;
    const e = armEquip(folder, dom);
    if (!["elongated", "flat", "bulky"].includes(e.class)) continue;
    n++;
    assert.ok(carriesProp(row.d),
      `${folder} leads with a measured ${e.class} prop; donor ${row.d} carries none`);
  }
  assert.ok(n > 30, `the measure covers the weapon bodies (${n})`);
});

test("Knightmon clip 9 takes a hafted humanoid body - and Gallantmon is one", () => {
  const row = donorRow("m178kngt", 9);
  // Knightmon: upright humanoid, greatsword in the right hand (the shield was removed by the user; the
  // DW3 model has none), dominant right.
  assert.equal(bodyPlan("m178kngt"), "biped-upright");
  assert.equal(speciesType("m178kngt"), "humanoid");
  assert.equal(mainHand("m178kngt"), "hafted");
  const donor = row.d;
  assert.equal(bodyPlan(donor), "biped-upright", `donor ${donor} is upright`);
  assert.equal(speciesType(donor), "humanoid", `donor ${donor} is humanoid`);
  assert.equal(mainHand(donor), "hafted", `donor ${donor} leads with a hafted weapon`);

  // The body the user pointed at: Gallantmon's right arm measurably ends in a long prop (the lance
  // Gram) and its left in a flat one (the shield Aegis); the research calls its spell a shield-hand
  // beam, which is exactly what the old term scored as its "armament". It is a same-class body for
  // Knightmon on the measure K18 uses, and the row above is picked from that class.
  assert.equal(armEquip("m369duke", "right").class, "elongated");
  assert.equal(armEquip("m369duke", "left").class, "flat");
  assert.equal(dominantSide("m369duke"), "right");
  assert.equal(mainHand("m369duke"), mainHand("m178kngt"));
  assert.ok(carriesProp("m369duke"));
});
