// DW2 MOTION ON A DW3 BODY (K22c) — the runtime side of tools/build_dw2_motion.py.
//
// The batch build writes ONE generated file per matched species under
// web/assets/battle/dw2motion/<folder>.json (git-ignored: it is derived from the user's own DW2
// disc, and the repo is public). This module merges such a file into a loaded DW3 model and answers
// "which timeline table plays this clip slot's DW2 motion?".
//
// It is OFF BY DEFAULT. Nothing is fetched, and every lookup returns null, until a scope turns it
// on: the URL flag `?dw2motion=1` (the viewer and the battle lab use it) or setDw2MotionEnabled().
// With it off, resolveClipScript's behaviour is byte-identical to before this module existed —
// the hook in clip-fallback.js is a single guarded call.
//
// WHAT A GENERATED FILE HOLDS (per motion letter A..K):
//   keys     { bone index -> [[x,y,z,frame], ...] }  rotation keys baked from the donor by
//            bakeRetargetByRole, written at frames 6000+ so they can never collide with the
//            model's own track (total_frames ~1100)
//   ch1      the root's translation keys at the same frames
//   playlist the donor clip's frame playlist, shifted to the appended range (the table the clip's
//            script binds with op2 [0,0,table])
//   gate     the swap gate's numbers and verdict (`used`)
// Merging appends those keys to the model's own channels exactly the way the in-memory cast bake
// does (strip the 30000 terminator, append, re-terminate), so nothing of the model's own motion is
// lost and no geometry is duplicated: only joint ANGLES travel.
import { DW2_CLIP_MAP, dw2LetterForSlot, DW2_MOTION_LETTERS } from "./dw2-clip-map.js";

let enabled = false;
let castTypes = null;                 // skillId -> 0|1|2, from the generated cast-types.json
let castTypesPromise = null;

export function setDw2MotionEnabled(v) { enabled = !!v; }
export function dw2MotionEnabled() { return enabled; }
/** Read the scope out of a query string: `?dw2motion=1` turns the swap on. */
export function dw2MotionFlagFromUrl(search = "") {
  try {
    const q = new URLSearchParams(search || "");
    const v = q.get("dw2motion");
    return v === "1" || v === "true" || v === "on";
  } catch { return false; }
}
if (typeof window !== "undefined" && window?.location?.search) {
  if (dw2MotionFlagFromUrl(window.location.search)) enabled = true;
}
// ...and the Node tools (contract/identity harnesses) turn it on with DW2MOTION=1, the same way
// K16_MODE switches the retarget's A/B path.
if (typeof process !== "undefined" && process?.env?.DW2MOTION === "1") enabled = true;

// ── loading (browser fetch; Node tools read the same file from disk; tests register JSON directly) ─
const dataCache = new Map();          // folder -> generated file | null
let loader = async (folder) => {
  const rel = `assets/battle/dw2motion/${folder}.json`;
  if (typeof fetch === "function" && typeof window !== "undefined") {
    return fetch(rel).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../../web");
    return JSON.parse(await fs.readFile(path.join(root, rel), "utf8"));
  } catch { return null; }
};

export function setDw2MotionLoader(fn) { loader = typeof fn === "function" ? fn : null; }
/** Prime a species' generated file synchronously (the tests and the Node harnesses do this). */
export function registerDw2Motion(folder, data) { if (folder) dataCache.set(folder, data || null); }
export function dw2MotionData(folder) { return dataCache.get(folder) ?? null; }

/** The technique -> DW2 cast type table (generated next to the motion files). Loaded once. */
export async function ensureCastTypes() {
  if (castTypes) return castTypes;
  if (!castTypesPromise) {
    castTypesPromise = (async () => {
      try {
        if (typeof fetch === "function" && typeof window !== "undefined") {
          const r = await fetch("assets/battle/dw2motion/cast-types.json");
          const json = r && r.ok ? await r.json() : null;
          castTypes = json?.bySkill ? json : null;
        } else {
          const fs = await import("node:fs/promises");
          const path = await import("node:path");
          const url = await import("node:url");
          const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../../web");
          const json = JSON.parse(await fs.readFile(path.join(root, "assets/battle/dw2motion/cast-types.json"), "utf8"));
          castTypes = json?.bySkill ? json : null;
        }
      } catch { castTypes = null; }
      return castTypes;
    })();
  }
  return castTypesPromise;
}
export function setCastTypes(json) { castTypes = json?.bySkill ? json : null; }
/** The DW2 cast type (0/1/2) of a DW3 technique, or null when the table is not loaded. */
export function castTypeFor(techId) {
  if (!castTypes || techId == null) return null;
  const v = castTypes.bySkill?.[String(techId | 0)];
  return v == null ? null : (v | 0);
}

// ── the merge ──────────────────────────────────────────────────────────────────────────────────
const TERM = 30000;

/**
 * Append one motion's baked keys to a model IN PLACE and register its playlist table.
 * Returns { table, letter, kind } on success, null when the motion is unusable for this model
 * (no keys, or the table index is already taken by the model's own data).
 */
export function applyMotion(model, letter, motion) {
  if (!model || !motion || !motion.keys || !Object.keys(motion.keys).length) return null;
  if (!Array.isArray(motion.playlist) || !motion.playlist.length) return null;
  if (!model.timeline) model.timeline = [];
  const table = motion.table | 0;
  if (model.timeline[table]?.table?.length) return null;      // never overwrite the model's own table
  for (const [idx, rows] of Object.entries(motion.keys)) {
    const i = idx | 0;
    const bone = model.bones?.[i];
    if (!bone) continue;
    const anim = { ...(bone.anim || {}) };
    const own = (anim.ch2 ?? []).filter((r) => r[3] !== TERM).map((r) => r.slice());
    anim.ch2 = [...own, ...rows.map((r) => r.slice()), [rows[rows.length - 1][0], rows[rows.length - 1][1], rows[rows.length - 1][2], TERM]];
    model.bones[i] = { ...bone, anim };
  }
  if (motion.ch1 && (Array.isArray(motion.ch1) ? motion.ch1.length : Object.keys(motion.ch1).length)) {
    // the root's translation keys belong to the bone the bake appended them to. v2 files carry ch1 per
    // bone (the K23 world bake writes positions for every bone: a limb's direction is its start + aim),
    // v1 files carried one array for the root named by `rootBone`.
    const byBone = Array.isArray(motion.ch1)
      ? { [motion.rootBone ?? rootIndexOf(model, motion)]: motion.ch1 }
      : motion.ch1;
    for (const [idx, rows] of Object.entries(byBone)) {
      const i = idx | 0;
      if (!rows?.length || !model.bones[i]) continue;
      const bone = model.bones[i];
      const anim = { ...(bone.anim || {}) };
      const own = (anim.ch1 ?? []).filter((r) => r[3] !== TERM).map((r) => r.slice());
      anim.ch1 = [...own, ...rows.map((r) => r.slice()), [rows[rows.length - 1][0], rows[rows.length - 1][1], rows[rows.length - 1][2], TERM]];
      model.bones[i] = { ...bone, anim };
    }
  }
  model.timeline[table] = { table: motion.playlist.map((e) => ({ ...e })) };
  if (!model.dw2Motion) model.dw2Motion = {};
  model.dw2Motion[letter] = { table, kind: motion.kind, lo: motion.lo, hi: motion.hi, letter, hit: Number.isInteger(motion.hit) ? motion.hit : null };   // hit: playlist entry of the strike pose (v2 files from export_game.mjs)
  return { table, letter, kind: motion.kind };
}

/** The bone the ch1 keys belong to: the one whose appended ch2 keys span the same frames (the bake
 *  writes both for the root only), else bone 0. */
function rootIndexOf(model, motion) {
  for (const [idx, rows] of Object.entries(motion.keys)) {
    if (rows.length && motion.ch1?.length && rows[0][3] === motion.ch1[0][3]) return idx | 0;
  }
  return 0;
}

/** Merge every motion the generated file marks `used` into the model. Idempotent per model. */
export function applyDw2Motion(model, data) {
  if (!model || !data || model.__dw2Applied) return model?.dw2Motion ?? null;
  const motions = data.motions || {};
  for (const letter of DW2_MOTION_LETTERS) {
    const m = motions[letter];
    if (!m || !m.used) continue;
    applyMotion(model, letter, m);
  }
  model.__dw2Applied = true;
  return model.dw2Motion ?? null;
}

/**
 * Load this model's generated file and merge it. Called once per model load (battle3d
 * loadSkeletalModel, through clip-fallback's prepareModelDonors). Never throws; a missing file just
 * leaves the model exactly as it was.
 */
export async function prepareDw2Motion(model) {
  if (!enabled || !model?.folder || model.__dw2Applied) return model;
  await ensureCastTypes();
  let data = dataCache.get(model.folder);
  if (data === undefined) {
    data = await Promise.resolve(loader ? loader(model.folder) : null).catch(() => null);
    dataCache.set(model.folder, data || null);
  }
  if (data) applyDw2Motion(model, data);
  return model;
}

/**
 * The generated DW2 motion for a clip slot, or null. `tech` is the technique id (only cast slots
 * and the signature slot need it: they pick F/G/H by the technique's DW2 cast type, and the
 * signature slot takes the melee clip for a physical technique).
 */
export function dw2MotionFor(model, clip, { tech = null, magical = false } = {}) {
  if (!enabled || !model?.dw2Motion || clip == null) return null;
  const row = DW2_CLIP_MAP[clip];
  if (!row) return null;
  const castType = castTypeFor(tech) ?? 0;
  const letter = dw2LetterForSlot(clip, { castType, magical });
  const hit = letter ? model.dw2Motion[letter] : null;
  return hit ? { ...hit, slot: clip | 0, castType } : null;
}

/** How many clip slots this model can play from DW2 motion (a report/test helper). */
export function dw2SlotCount(model) {
  if (!model?.dw2Motion) return 0;
  let n = 0;
  for (const slot of Object.keys(DW2_CLIP_MAP)) {
    const row = DW2_CLIP_MAP[slot];
    if (row.letters.some((L) => model.dw2Motion[L])) n++;
  }
  return n;
}

/** Drop everything a model gained (a re-load or a test needs a pristine object). */
export function clearDw2Motion(model) {
  if (!model) return;
  if (model.dw2Motion) {
    for (const m of Object.values(model.dw2Motion)) {
      if (model.timeline?.[m.table]) delete model.timeline[m.table];
    }
  }
  delete model.dw2Motion;
  delete model.__dw2Applied;
}
