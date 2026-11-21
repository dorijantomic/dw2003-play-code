import { ANATOMY, FOLDERS, SIZE_ORDER, TECH_MODE_PRIOR, W } from "./digimon-anatomy/anatomy-data.js";
import { EMITTERS, SHOTS } from "./digimon-anatomy/emitter-data.js";
import { ARM_ATTACH, ARM_EQUIP } from "./digimon-anatomy/arm-data.js";
// moved by tools/rewrite/split.mjs: still exported from here
export { ANATOMY, BODY_FAMILY, FOLDERS, MODES, TECH_MODE_PRIOR } from "./digimon-anatomy/anatomy-data.js";
export { EMITTERS, EMITTER_KINDS, EMITTER_PARTS, SHOTS, SHOT_MODES } from "./digimon-anatomy/emitter-data.js";
export { ARM_EQUIP, ARM_EQUIP_CLASSES } from "./digimon-anatomy/arm-data.js";

// ---------------------------------------------------------------- lookups
export function anatomy(folder) {
  return (folder && ANATOMY[folder]) || null;
}

export function has(folder) {
  return !!(folder && ANATOMY[folder]);
}

export function modelName(folder) {
  const a = anatomy(folder);
  return a ? a.n : null;
}

export function bodyPlan(folder) {
  const a = anatomy(folder);
  return a ? a.plan : null;
}

export function bodyFamily(folder) {
  const a = anatomy(folder);
  return a ? a.fam : null;
}

export function speciesType(folder) {
  const a = anatomy(folder);
  return a ? a.t : null;
}

export function sizeClass(folder) {
  const a = anatomy(folder);
  return a ? a.size : null;
}

// The declared weapons, body-located ones included (a mouth cannon is armament too).
export function armament(folder) {
  const a = anatomy(folder);
  if (!a) return [];
  return a.armament.map((m) => ({ where: m[0], kind: m[1], what: m[2] }));
}

// Weapons that ARE a limb (built-in): arm chains that must animate as weapons, not hands.
export function builtInWeapons(folder) {
  const a = anatomy(folder);
  if (!a) return [];
  return a.arm.filter((x) => x[2] && x[1] !== "hand").map((x) => ({ side: x[0], kind: x[1] }));
}

export function dominantSide(folder) {
  const a = anatomy(folder);
  return a ? a.side : null;
}

export function techKey(techName) {
  return String(techName == null ? "" : techName).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Which arm side fires this move, reduced to 'left' | 'right' | 'both' | null.
export function firingSide(folder, techName) {
  const p = firingPart(folder, techName);
  if (p.mode === "left-arm") return "left";
  if (p.mode === "right-arm") return "right";
  if (p.mode === "both-arms") return "both";
  if (p.mode === "arms-unspecified") {
    const d = dominantSide(folder);
    return d === "left" || d === "right" || d === "both" ? d : null;
  }
  return null;
}

// THE annotation the animation system needs: where this model's move leaves the body.
// Resolution chain: per-technique annotation -> roster majority for that technique -> the
// model's arm weapons -> dominantSide -> 'unknown'. `source` says which step answered, so the
// caller can report it and K13 can audit a launch point against a real annotation.
export function firingPart(folder, techName) {
  const a = anatomy(folder);
  const k = techKey(techName);
  if (!a) return { mode: "unknown", side: null, style: null, bodyPart: null, source: "no-model" };
  const t = a.tech[k];
  if (t) {
    return {
      mode: t[0],
      side: t[0] === "left-arm" ? "left" : t[0] === "right-arm" ? "right" : null,
      style: t[1],
      bodyPart: t[2],
      source: "annotation",
    };
  }
  const prior = TECH_MODE_PRIOR[k];
  if (prior && prior !== "unknown" && prior !== "self") {
    return {
      mode: prior,
      side: prior === "left-arm" ? "left" : prior === "right-arm" ? "right" : null,
      style: null,
      bodyPart: null,
      source: "tech-prior",
    };
  }
  const armWeapon = a.armament.find((m) => m[0] === "left-arm" || m[0] === "right-arm" || m[0] === "both-arms");
  if (armWeapon) {
    const mode = armWeapon[0] === "both-arms" ? "both-arms"
      : armWeapon[0] === "left-arm" ? "left-arm" : "right-arm";
    return {
      mode,
      side: mode === "both-arms" ? null : mode === "left-arm" ? "left" : "right",
      style: null,
      bodyPart: armWeapon[2],
      source: "armament",
    };
  }
  if (a.side === "left" || a.side === "right") {
    return { mode: a.side + "-arm", side: a.side, style: null, bodyPart: null, source: "dominant-side" };
  }
  return { mode: "unknown", side: null, style: null, bodyPart: null, source: "unknown" };
}

// ---------------------------------------------------------------- similarity
// Anatomy-only resemblance, 0..1, deterministic. K13 ranks donors with this: same body family
// first, then the firing side, then armament, size, species.
// similarity(a, b) accepts model folders OR raw records.
export function similarity(a, b) {
  return similarityDetail(a, b).score;
}

export function similarityDetail(a, b) {
  const A = resolve(a);
  const B = resolve(b);
  if (!A || !B) return { score: 0, reasons: ["unknown model"] };
  const reasons = [];
  let score = 0;
  const add = (pts, why) => {
    score += pts;
    reasons.push((pts < 0 ? "-" : "+") + Math.abs(pts).toFixed(2) + " " + why);
  };
  if (A.plan === B.plan) add(W.bodyPlan + W.bodyFamily, "same bodyPlan (" + A.plan + ")");
  else if (A.fam === B.fam) add(W.bodyFamily, "same body family (" + A.fam + ")");
  else reasons.push("+0.00 body family differs (" + A.fam + " vs " + B.fam + ")");
  const sa = A.side, sb = B.side;
  if (sa === sb) add(W.firingSide, "same dominant side (" + (sa || "unstated") + ")");
  else if (sa && sb) {
    if (sa === "both" || sb === "both") add(W.firingSide * 0.6, "one side fires from both arms");
    else add(W.firingSide * 0.15, "opposite dominant side (" + sa + " vs " + sb + ") - mirror the motion");
  } else add(W.firingSide * 0.35, "one side unstated (" + sa + " vs " + sb + ")");
  const ta = armTokens(A), tb = armTokens(B);
  let shared = 0;
  for (const k of ta) if (tb.has(k)) shared++;
  const union = ta.size + tb.size - shared;
  const jac = union ? shared / union : 1;
  add(W.armament * jac, "armament Jaccard " + jac.toFixed(2) + " (" + shared + " shared tokens)");
  const ia = Math.max(0, SIZE_ORDER.indexOf(A.size));
  const ib = Math.max(0, SIZE_ORDER.indexOf(B.size));
  const gap = Math.abs(ia - ib);
  add(W.size * (gap === 0 ? 1 : gap === 1 ? 0.6 : 0), "size " + A.size + " vs " + B.size + " (gap " + gap + ")");
  if (A.t === B.t) add(W.speciesType, "same speciesType (" + A.t + ")");
  else if ((A.tags || []).some((x) => (B.tags || []).includes(x))) add(W.speciesType * 0.5, "shared species tag");
  return { score: Math.round(score * 10000) / 10000, reasons };
}

// Rank candidate donors for a target folder. `candidates` defaults to every model.
export function rankDonors(target, candidates, limit) {
  const out = [];
  const pool = candidates && candidates.length ? candidates : FOLDERS;
  for (const f of pool) {
    if (f === target) continue;
    const d = similarityDetail(target, f);
    out.push({ folder: f, name: modelName(f), score: d.score, reasons: d.reasons });
  }
  out.sort((x, y) => y.score - x.score || (x.folder < y.folder ? -1 : 1));
  return limit ? out.slice(0, limit) : out;
}

function resolve(x) {
  if (!x) return null;
  return typeof x === "string" ? anatomy(x) : x;
}

function armTokens(a) {
  const t = new Set();
  for (const arm of a.arm) {
    if (arm[1] && arm[1] !== "none") {
      t.add(arm[0] + ":" + arm[1]);
      t.add("kind:" + arm[1]);
    }
  }
  for (const m of a.armament) {
    t.add("where:" + m[0]);
    t.add("what:" + m[1]);
  }
  return t;
}

export function emitters(folder) {
  const rows = EMITTERS[folder];
  if (!rows) return [];
  return rows.map((r) => ({
    id: r[0], part: r[1], count: r[2], kind: r[3], primary: !!r[4], mouth: !!r[5],
  }));
}

export function primaryEmitter(folder) {
  return emitters(folder).find((e) => e.primary) || null;
}

// Total number of projectile launch points the body carries.
export function launchPoints(folder) {
  return emitters(folder).filter((e) => e.kind !== "melee")
    .reduce((n, e) => n + e.count, 0);
}

// How many projectiles this move fires and WHERE each one leaves from.
//   none            self/summon move - no projectile at all
//   single          one projectile from emitters[0] (the primary or the annotated site)
//   per-emitter     one projectile per listed emitter, each from its own bone tip
//   per-limb-contact multi-hit contact: the striking limbs, used in turn (not shots)
// opts.volley = true lets a caller that knows the disc's volley clip force the one-per-emitter
// reading even where the research text stayed silent (BRIEF5 K14: clip 13 is a volley).
export function shotsFor(folder, techName, opts?: any) {
  const k = techKey(techName);
  const rule = (SHOTS[folder] || {})[k];
  const all = emitters(folder);
  const launch = all.filter((e) => e.kind !== "melee");
  if (!rule) {
    const p = all.find((e) => e.primary);
    if (!p) return { mode: "none", emitters: [], shots: 0, basis: "unknown technique, no emitter" };
    return { mode: "single", emitters: [p.id], shots: 1, basis: "unknown technique: primary" };
  }
  let mode = rule[0];
  let ids = rule[1].slice();
  let shots = rule[2];
  if (opts && opts.volley && mode === "single") {
    const base = all.find((e) => e.id === ids[0]);
    if (base && base.kind !== "melee") {
      const group = launch.filter((e) => e.part === base.part);
      if (base.part === "mouth" || base.part === "head") {
        for (const e of launch) {
          if (e.mouth && e.part.slice(-4) === "-arm" && !group.includes(e)) group.push(e);
        }
      }
      if (group.length > 1) {
        mode = "per-emitter";
        ids = group.map((e) => e.id);
        shots = group.reduce((n, e) => n + e.count, 0);
      }
    }
  }
  return { mode, emitters: ids, shots, basis: "anatomy" };
}

// The data verdict for one arm. Always returns an object (unknown model -> class "none").
export function armEquip(folder, side) {
  const row = ((ARM_EQUIP[folder] || {})[side]) || null;
  if (!row) {
    return { side, class: "none", confidence: "low", source: "none", bone: null,
      attachment: null, features: null };
  }
  return {
    side,
    class: row[0],
    confidence: row[1] ? "high" : "low",
    source: row[2] === "m" ? "hand-mesh" : "prop-bone",
    bone: row[3],
    attachment: ARM_ATTACH[row[4]] || row[4],
    features: { ln: row[5][0], wn: row[5][1], twRatio: row[5][2], lw: row[5][3],
      cube: row[5][4], area: row[5][5] },
  };
}

// Both arms at once, for a caller that compares the two sides.
export function armEquipSides(folder) {
  return { left: armEquip(folder, "left"), right: armEquip(folder, "right") };
}

// Does this arm carry a weapon-like extension (or is it a weapon limb)? `bare` is false.
export function armArmed(folder, side) {
  const c = armEquip(folder, side).class;
  return c === "elongated" || c === "flat" || c === "bulky";
}
