// OWN CLIPS FIRST — reuse the model's own attack clip for a technique slot it has no script for.
//
// OFF BY DEFAULT. Nothing here changes a build until a scope turns it on: the URL flag `?ownclips=1`
// (the viewer and the battle lab), `setOwnClipsEnabled(true)`, or the Node tools' `OWNCLIPS=1` — the
// same three doors web/fight/dw2-motion.js uses for ?dw2motion=1. With it off every lookup below is a
// no-op and clip-fallback's resolution is byte-identical to before this module existed.
//
// WHY (the operator's rule, 2026-10-26): an own clip is a complete presentation — a body that travels
// the way THIS body travels, a shot from THIS body's emitter at THIS body's tick, and its own strike
// moments. Garbagemon's basic attack SHOOTS (op6 x2) and its spells still played a DW2/borrowed body;
// Vegiemon's basic attack JUMPS to the target and its techniques never used it. So:
//
//   missing slot + the move SHOOTS (a ranged spell)      -> the model's own SHOOTING clip (one with a
//                                                           projectile launch, op6 sub 0);
//   missing slot + the move hits UP CLOSE (physical)      -> the model's own CLOSE attack, travel and
//                                                           all (op2 mode 3 leap / mode 5 kind 4
//                                                           step-in / mode 8 dash / root ch1 keys);
//   nothing own of that kind                              -> today's behaviour (DW2 when ?dw2motion=1,
//                                                           else the existing fallback).
//   an own authored slot is NEVER touched.
//
// Plus the operator's second rule: a body whose attack THROWS something off its own body (Boltmon's
// axe is a second mesh on its own pivot; Garbagemon's throwing hand vanishes as the lid leaves) must
// play its OWN attack clip for every technique, never DW2 motion — a DW2 body has no such part.
//
// NOTHING HERE NAMES A SPECIES. Every decision is a column of a table:
//   * the move's kind: the skills row (attack_category / type) and the disc's clip families, plus the
//     anatomy's measured per-technique shots rule (digimon-anatomy.shotsFor, basis "anatomy" only — its
//     "unknown technique: primary" fallback is NOT a measurement and is not used as evidence);
//   * the own clip's kind: its own ops (op6 sub 0 = a launch, op10 98/99 = a contact, the slot-motion
//     arms, the root's ch1 travel);
//   * "this body throws": a mesh part hidden at every idle frame that comes in on a pivot travelling
//     >= 0.5 body heights inside an own attack, or a part that hides across an own attack while a
//     launch / world spawn fires inside the hide window.
import { skillRowsForName } from "./fight-tables.js";
import { shotsFor } from "./digimon-anatomy.js";

// The disc's clip families (clips.md §5): 9/13 the casts, 15/16 the field/throw casts; 5,6,7,8,14 the
// contact families. A move on a cast clip is a shot whatever the model does.
const CAST_CLIPS = new Set([9, 13, 15, 16]);
const CONTACT_CLIPS = new Set([5, 6, 7, 8, 14]);
const CONTACT_TYPES = new Set([98, 99]);       // op10: an intermediate contact / the damage strike
const HIDDEN = 0.05;                            // ch3 scale under this = the part is not drawn
const TRAVEL_SHARE = 0.10;                      // root ch1 travel that counts as a step (body heights)
const FLY_SHARE = 0.5;                          // a thrown copy's pivot travel (body heights)

// ── the switch ──────────────────────────────────────────────────────────────────────────────────
// THE PLAYER'S SWITCH is F2 -> Battle -> "Own clips for techniques" (web/ambience.js FX_GROUPS, saved
// in localStorage through setFx). It is OFF until the player turns it on. `?ownclips=1` is a
// developer override for a session (it never writes the player's stored choice), and OWNCLIPS=1 does
// the same for the Node tools; setOwnClipsEnabled(v) pins it for a test or a lab.
import { battleSetting } from "./battle-settings.js";
import { isInstalledBuild } from "../ship-list.js";
let override = null;          // null = follow the player's setting
export function setOwnClipsEnabled(v) { override = v == null ? null : !!v; }
export function ownClipsEnabled() { if (isInstalledBuild()) return false; return override == null ? battleSetting("ownclips") : override; }   // installed copy: out, no flag or setter turns it on
/** Read the developer override out of a query string: `?ownclips=1` turns the rule on for the session. */
export function ownClipsFlagFromUrl(search = "") {
  try {
    const q = new URLSearchParams(search || "");
    const v = q.get("ownclips");
    return v === "1" || v === "true" || v === "on";
  } catch { return false; }
}
if (typeof window !== "undefined" && window?.location?.search) {
  if (ownClipsFlagFromUrl(window.location.search)) override = true;
}
if (typeof process !== "undefined" && process?.env?.OWNCLIPS === "1") override = true;

const hasOps = (s) => !!s && Array.isArray(s.ops) && s.ops.length > 0;

// ── the model's own clips, by the numbers ───────────────────────────────────────────────────────
function ch1At(model, bone, frame) {
  const ch = model?.bones?.[bone]?.anim?.ch1;
  if (!Array.isArray(ch) || !ch.length) return null;
  let prev = null;
  for (const k of ch) {
    const f = k[3] | 0;
    if (f === 30000) break;
    if (f <= frame) { prev = k; continue; }
    if (!prev) return [k[0], k[1], k[2]];
    const span = (f - (prev[3] | 0)) || 1;
    const t = (frame - (prev[3] | 0)) / span;
    return [prev[0] + (k[0] - prev[0]) * t, prev[1] + (k[1] - prev[1]) * t, prev[2] + (k[2] - prev[2]) * t];
  }
  return prev ? [prev[0], prev[1], prev[2]] : null;
}
/** ch3 scale of one bone at a frame (4096 = 1.0); 1.0 when the bone has no ch3 channel. */
export function boneScale(model, bone, frame) {
  const ch = model?.bones?.[bone]?.anim?.ch3;
  if (!Array.isArray(ch) || !ch.length) return 4096;
  let prev = null;
  for (const k of ch) {
    const f = k[3] | 0;
    if (f === 30000) break;
    if (f <= frame) prev = k; else break;
  }
  return prev ? Math.max(Math.abs(prev[0]), Math.abs(prev[1]), Math.abs(prev[2])) : 4096;
}
function tableFrames(model, t) {
  const tab = model?.timeline?.[t]?.table;
  if (!Array.isArray(tab) || !tab.length) return [];
  return tab.map((e) => e.value | 0).filter((v) => v >= 0 && v < 0x8000);
}
/** The mesh's own height in model units (the y extent of every vertex). */
export function bodyHeight(model) {
  let lo = Infinity, hi = -Infinity;
  for (const b of model?.bones ?? []) for (const v of b.verts ?? []) { if (v[1] < lo) lo = v[1]; if (v[1] > hi) hi = v[1]; }
  return Number.isFinite(lo) && hi > lo ? hi - lo : 0;
}

/**
 * How one own action script is built, from its own ops:
 *   launches      op6 sub-0 records - a projectile leaves this body
 *   contacts      op10 98/99 - a real contact
 *   markers       every op10 record, in script order (the body's own strike beats)
 *   tables        the timeline tables it binds
 *   travel        which of the disc's travel arms it uses, and how far the root's ch1 keys walk
 *   returnsHome   op2 mode 5 kind 5 / mode 7 - it comes back on its own
 */
export function classifyOwnScript(model, script) {
  const ops = script?.ops ?? [];
  const rec = { slot: null, launches: [], contacts: [], markers: [], tables: [], ramp4: 0, ramp5: 0, leap3: 0, dash8: 0, home7: 0, waits: 0, rootTravel: 0, returnsHome: false };
  ops.forEach((o, i) => {
    const w = o.words || [];
    if (o.op === 6 && (w[0] | 0) === 0) rec.launches.push(i);
    else if (o.op === 10) { rec.markers.push({ at: i, type: w[0] | 0 }); if (CONTACT_TYPES.has(w[0] | 0)) rec.contacts.push(i); }
    else if (o.op === 11) rec.waits += (w[0] | 0);
    else if (o.op === 2) {
      const mode = w[0] | 0, sub = w[2] | 0;
      if (mode === 0 && sub > 1) rec.tables.push(sub);
      else if (mode === 3) rec.leap3++;
      else if (mode === 5 && sub === 4) rec.ramp4++;
      else if (mode === 5 && sub === 5) rec.ramp5++;
      else if (mode === 8) rec.dash8++;
      else if (mode === 7) rec.home7++;
    }
  });
  let lo = Infinity, hi = -1;
  for (const t of rec.tables) for (const f of tableFrames(model, t)) { if (f < lo) lo = f; if (f > hi) hi = f; }
  if (hi >= 0) {
    const a = ch1At(model, 0, lo), b = ch1At(model, 0, hi);
    if (a && b) rec.rootTravel = b[2] - a[2];
  }
  rec.returnsHome = rec.ramp5 > 0 || rec.home7 > 0;
  return rec;
}

const INV = new WeakMap();     // model -> inventory (rebuilt only when the model object is new)

/** Every own action script of a model, classified, plus the flag this rule needs. */
export function ownClipInventory(model) {
  if (!model) return { slots: {}, height: 0, throws: false, throwsWhy: [] };
  if (INV.has(model)) return INV.get(model);
  const slots = {};
  for (const k of Object.keys(model.actions || {})) {
    const s = model.actions[k];
    if (!hasOps(s)) continue;
    const rec = classifyOwnScript(model, s);
    rec.slot = k | 0;
    slots[k | 0] = rec;
  }
  const inv = { slots, height: bodyHeight(model), throws: false, throwsWhy: [] };
  const t = detectThrow(model, slots, inv.height);
  inv.throws = t.throws;
  inv.throwsWhy = t.why;
  INV.set(model, inv);
  return inv;
}

/**
 * Does this body hand a part of its own mesh to the attack? Two measured patterns, both from ch3:
 *   copy-in-flight  a part hidden at EVERY idle frame comes in on a pivot that travels >= 0.5 body
 *                   heights inside an own attack (Boltmon: the held axe hides at frame 500, its twin
 *                   bone 19 comes out on pivot 18 and that pivot's ch1 runs 9276 units = 3.86 H);
 *   hand-over       a part visible in idle hides for a run of the attack while a projectile launch or
 *                   a world-space spawn fires inside that run (Garbagemon: the throwing hand hides
 *                   ticks 36..224, the lid's op6 launch is at tick 55).
 * A whole-body vanish (a bone whose sub-tree holds >= half the model) is NOT a throw and is skipped.
 */
function detectThrow(model, slots, H) {
  const why = [];
  if (!(H > 0) || !model?.bones?.length) return { throws: false, why };
  const idleFrames = tableFrames(model, 0);
  const idle = idleFrames.length ? idleFrames : [0];
  const mesh = [];
  const parentOf = (i) => (model.bones[i]?.parent_slot | 0) - 1;
  for (let i = 0; i < model.bones.length; i++) if ((model.bones[i].faces ?? []).length) mesh.push(i);
  if (!mesh.length) return { throws: false, why };
  const sub = new Map();
  for (const i of mesh) {
    let n = 1;
    for (let j = 0; j < model.bones.length; j++) {
      let p = parentOf(j), depth = 0;
      while (p >= 0 && depth++ < 64) { if (p === i) { n++; break; } p = parentOf(p); }
    }
    sub.set(i, n);
  }
  const bodyLike = (b) => (sub.get(b) ?? 1) >= Math.max(2, Math.floor(model.bones.length / 2));
  const visIdle = new Map(mesh.map((b) => [b, idle.every((f) => boneScale(model, b, f) >= HIDDEN * 4096)]));
  const hidIdle = new Map(mesh.map((b) => [b, idle.every((f) => boneScale(model, b, f) < HIDDEN * 4096)]));

  for (const rec of Object.values(slots)) {
    const frames = rec.tables.flatMap((t) => tableFrames(model, t));
    if (frames.length < 10) continue;
    const script = model.actions?.[rec.slot];
    const hasWorldSpawn = (script?.ops ?? []).some((o) => o.op === 3 && (o.words?.[0] | 0) === 0
      && (o.words?.[4] | 0) !== 32767 && Math.abs(o.words?.[4] | 0) <= 20000);
    const hasLaunch = rec.launches.length > 0;
    for (const b of mesh) {
      if (bodyLike(b)) continue;                       // the whole body vanishing is not a throw
      const runs = [];
      let run = 0;
      for (const f of frames) { if (boneScale(model, b, f) < HIDDEN * 4096) run++; else { if (run) runs.push(run); run = 0; } }
      if (run) runs.push(run);
      const longest = runs.length ? Math.max(...runs) : 0;
      if (longest < 10) continue;
      if (hidIdle.get(b)) {
        const pivot = parentOf(b) >= 0 ? parentOf(b) : b;
        const base = ch1At(model, pivot, frames[0]);
        let far = 0;
        for (const f of frames) {
          const p = ch1At(model, pivot, f);
          if (!base || !p) continue;
          far = Math.max(far, Math.hypot(p[0] - base[0], p[1] - base[1], p[2] - base[2]));
        }
        if (far >= FLY_SHARE * H) {
          why.push(`slot ${rec.slot}: hidden-at-idle part ${b} comes in on pivot ${pivot} travelling ${Math.round(far)} (${(far / H).toFixed(2)} H)`);
        }
      } else if (visIdle.get(b) && (hasLaunch || hasWorldSpawn)) {
        why.push(`slot ${rec.slot}: part ${b} hides for ${longest} frames of the attack with a ${hasLaunch ? "launch" : "world spawn"} in the same clip`);
      }
    }
  }
  return { throws: why.length > 0, why };
}

// ── the move's kind, and which own clip answers it ──────────────────────────────────────────────
/**
 * What this move DOES, from data: "shoot" (it fires), "close" (it strikes up close), "self" (a
 * heal/support cast), or null — I do not know yet, and then nothing is built.
 *
 * `tech` is the technique's NAME, the key the animator has (techName) and the anatomy's tables use; the
 * skills row is found by that name and narrowed by the clip when one name covers several rows.
 */
export function moveKind(model, clip, tech) {
  const rows = (tech ? skillRowsForName(tech) : []).filter((r) => clip == null || (r.clip | 0) === (clip | 0));
  const cats = new Set(rows.map((r) => String(r.attack_category || "")));
  const cat = cats.size === 1 ? [...cats][0] : null;
  const types = new Set(rows.map((r) => String(r.type || "")));
  if (types.has("heal") || types.has("support") || cat === "support") return { kind: "self", why: "heal/support row" };
  if (cat === "magical") return { kind: "shoot", why: "skills row: magical" };
  if (CAST_CLIPS.has(clip | 0)) return { kind: "shoot", why: `cast clip ${clip}` };
  const anat = shotsFor(model?.folder, tech ?? "", { volley: (clip | 0) === 13 });
  const rule = anat.basis === "anatomy" ? anat.mode : null;
  if (rule === "single" || rule === "per-emitter") return { kind: "shoot", why: `anatomy rule ${rule}` };
  if (rule === "per-limb-contact") return { kind: "close", why: "anatomy rule per-limb-contact" };
  if (cat === "physical" && CONTACT_CLIPS.has(clip | 0)) return { kind: "close", why: `skills row: physical on contact clip ${clip}` };
  return { kind: null, why: "no measured move kind (the anatomy has no launcher rule and the row/clip do not settle it)" };
}

/** The model's own clip of `kind`: its own casting clip first for a shot, its own attack for a blow. */
export function pickOwnClip(model, kind) {
  const inv = ownClipInventory(model);
  const list = Object.values(inv.slots).filter((r) => (kind === "shoot" ? r.launches.length > 0 : r.contacts.length > 0));
  if (!list.length) return null;
  const travels = (r) => r.ramp4 > 0 || r.leap3 > 0 || r.dash8 > 0 || Math.abs(r.rootTravel) > TRAVEL_SHARE * inv.height;
  const rank = (r) => {
    const fit = kind === "shoot" ? (CAST_CLIPS.has(r.slot) ? 0 : r.slot === 5 ? 1 : 2) : (r.slot === 5 ? 0 : 1);
    return fit * 1000 + (travels(r) ? 0 : 100) + r.slot;
  };
  list.sort((a, b) => rank(a) - rank(b));
  return list[0];
}

/**
 * The plan for a missing slot: which own clip to replay and why, or null (nothing changes).
 * A slot the model OWNS is never planned (the own script is returned untouched by the caller), a
 * heal/support move is never planned (its calm self cast is the right shape), an item is not a
 * technique (the animator passes no tech for it) and an unknown move kind is not guessed.
 */
export function ownClipPlan(model, clip, { tech = null, target = "enemy" } = {}) {
  if (!ownClipsEnabled() || !model || clip == null || !tech) return null;
  if (target === "self") return null;
  if (hasOps(model.actions?.[clip])) return null;
  const inv = ownClipInventory(model);
  if (inv.throws) {
    // the operator's rule: a body that throws its own part plays its OWN attack for every technique
    const pick = pickOwnClip(model, "shoot") ?? pickOwnClip(model, "close");
    if (!pick) return null;
    return { slot: pick.slot, kind: "own", moveKind: null, tech, why: `body throws a part of itself: ${inv.throwsWhy[0]}`, throws: true };
  }
  const mv = moveKind(model, clip, tech);
  if (!mv.kind || mv.kind === "self") return null;
  const pick = pickOwnClip(model, mv.kind);
  if (!pick) return null;
  return { slot: pick.slot, kind: mv.kind, moveKind: mv.kind, tech, why: `${mv.kind}: ${mv.why}; own clip ${pick.slot}`, throws: false };
}

/**
 * Should DW2 motion be kept off this slot? Only a body that throws its own part, for a technique slot
 * it has no script for — the DW2 body cannot carry the thrown mesh, and the operator's rule is that
 * such a body plays its own attack for every technique.
 */
export function ownClipsBlockDw2(model, clip, { tech = null, target = "enemy" } = {}) {
  if (!ownClipsEnabled() || !model || clip == null || !tech || target === "self") return false;
  if (hasOps(model.actions?.[clip])) return false;
  return ownClipInventory(model).throws;
}
