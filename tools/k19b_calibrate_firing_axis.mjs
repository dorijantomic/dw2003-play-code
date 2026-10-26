#!/usr/bin/env node
// k19b_calibrate_firing_axis.mjs — calibrate rule R1 ("at the release tick the emitter's firing axis
// points at the target") against the game's OWN authored casts.
//
// R1 is a rule for the cast generator (K19). A rule the disc itself violates is a wrong rule, so
// before the generator is allowed to obey it, this tool measures how the disc's own cast animations
// aim. Per authored cast shot it finds:
//
//   the RELEASE TICK   the tick the script's op6 sub=0 record fires, run through the runtime's own
//                      classes (ActorAnimator -> ActionVM -> timeline sampler, GLOBAL_SPEED 2)
//   the EMITTER        the K14 shots rule of a technique that plays this clip (the same table the
//                      generator will read), so a volley's record i is the rule's emitter i
//   the AXIS           web/fight/firing-axis.js on that emitter's bone in that pose (prop long axis
//                      by PCA, hand block push/palm, head/chest/back carried facing)
//   the TARGET         the script's own world-space op3 effect on the VICTIM line when it writes one
//                      (89 of the authored cast clips do), else the nominal victim line 2*base_z
//                      (10240 PS1 units) straight ahead at the emitter's own height
//
// and reports the angle between them, per emitter class, plus the aim error as a function of the tick
// offset from the release (-N..+N) — which is how the calibration decides whether R1 must hold "at
// the release tick" or "within a few ticks of it".
//
// Every row also records how far the disc's own launch point (`from`) sits from the emitter's
// business end, in body heights: the independent check that the emitter attribution is real (a mouth
// cast whose launch point is half a body away from every mouth is not a mouth cast). Rows that fail
// that check are counted but kept out of the distributions.
//
// Everything is read from the disc's model packs (web/assets/battle/models, NOT in git) and the
// authored tables; nothing is written back. Output: JSON of every shot + a markdown summary.
//
// Usage:
//   node tools/k19b_calibrate_firing_axis.mjs                     # every model, every authored cast
//   node tools/k19b_calibrate_firing_axis.mjs --models m005grey,m009mera --quiet
//   node tools/k19b_calibrate_firing_axis.mjs --json /tmp/k19b.json --md /tmp/k19b.md
//   node tools/k19b_calibrate_firing_axis.mjs --offsets 8         # tick-window half-width (default 8)
//   node tools/k19b_calibrate_firing_axis.mjs --clips 9,11        # only those action clips
//
// Exit code 0 when the run completed (this is a measurement, not a gate); 2 on a broken input.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ActorAnimator } from "../web/fight/actor-animator.js";
import { authoredSide } from "../web/fight/side-mirror.js";
import { emitters, shotsFor } from "../web/fight/digimon-anatomy.js";
import { setTechTable, setSkillTable, techToClip, techName, techTargetClass } from "../web/fight/fight-tables.js";
import { buildModelIndex } from "../web/anim-viewer-data.js";
import { ANIM_DONOR_GAPS } from "../web/fight/anim-donor-map.js";
import * as FA from "../web/fight/firing-axis.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = resolve(ROOT, "web/assets/battle/models");
const BASE_Z = 5120;                 // the arena's own base distance (smdldata base_z)
const VICTIM_LINE = 2 * BASE_Z;      // the nominal victim line, straight ahead in a fighter's own frame
const TICK_SPEED = 2;                // the per-tick timeline step the battle/viewer run (GLOBAL_SPEED)
const CAP_TICKS = 1600;              // a script that runs longer than this is not a cast
const MAX_RELEASES = 8;              // a volley fires several op6 records; measure them all (bounded)
const MATCH_MAX_HEIGHT = 0.5;        // a launch point further than this share of body height is unexplained

// ── data ───────────────────────────────────────────────────────────────────────────────────────────
const index = JSON.parse(readFileSync(resolve(MODELS, "index.json"), "utf8"));
const placement = JSON.parse(readFileSync(resolve(ROOT, "web/assets/battle/model_placement.json"), "utf8")).models || {};
const techTable = JSON.parse(readFileSync(resolve(ROOT, "web/assets/data/fight_tech_table.json"), "utf8"));
setTechTable(techTable);
setSkillTable(JSON.parse(readFileSync(resolve(ROOT, "web/assets/data/digimon.json"), "utf8")).skills);
const loadModel = (folder) => JSON.parse(readFileSync(resolve(MODELS, folder, "anim.json"), "utf8"));
const modelNumber = (folder) => folder.match(/^m(\d+)/)?.[1] ?? "0";

/** The attack techniques that play each action clip, so a clip can be asked which shots it can be. */
const TECH_BY_CLIP = (() => {
  const out = {};
  for (const id of Object.keys(techTable)) {
    if (techTargetClass(id) !== "enemy") continue;      // a heal/support cast is not aimed at an opponent
    const name = techName(id), clip = techToClip(id);
    if (!name || clip == null) continue;
    (out[clip] ||= []).push({ id: id | 0, name });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.id - b.id);
  return out;
})();

/**
 * The techniques each model can actually use, from the species index the viewer builds (its own
 * skills row per species, mapped to the model folder by model_map). Without this, a model would be
 * "measured" casting a move it cannot learn - e.g. every body in the game playing Cross Slash - and
 * the distributions would be about the generic clip, not about a cast that model performs.
 */
const TECHS_BY_FOLDER = (() => {
  const asset = (p) => JSON.parse(readFileSync(resolve(ROOT, "web/assets", p), "utf8"));
  const entries = buildModelIndex({
    digimon: asset("data/digimon.json"),
    extraSpecies: asset("data/extra_species.json"),
    extraCanon: asset("data/extra_species_canon.json"),
    modelMap: asset("battle/model_map.json"),
    folders: index,
    gaps: ANIM_DONOR_GAPS,
  });
  const out = new Map();
  for (const e of entries) {
    if (!e.folder) continue;
    const set = out.get(e.folder) || new Set();
    for (const t of e.techs || []) set.add(t | 0);
    out.set(e.folder, set);
  }
  return out;
})();

// ── arena frames ───────────────────────────────────────────────────────────────────────────────────
/** A fighter's slot from its own placement record (FIGHTSTG_F0x80087f38): x=0, y=-hover, z=±(base+standoff). */
function slotOf(folder, side) {
  const rec = placement[modelNumber(folder)] || {};
  const standoff = rec.standoff | 0, hover = rec.hover | 0;
  return { side, x: 0, y: -hover, z: side === "enemy" ? BASE_Z + standoff : -(BASE_Z + standoff), standoff, hover };
}
/** Authored arena point -> the model's own pose frame (subtract the slot, then turn with the side). */
function worldToLocal(side, p, slot) {
  const d = [p[0] - slot.x, p[1] - slot.y, p[2] - slot.z];
  return side === "enemy" ? [-d[0], d[1], -d[2]] : d;
}

// ── one clip, tick by tick, through the runtime's own animator ─────────────────────────────────────
/**
 * Play one authored clip and record what a measurement needs:
 *   frames[tick] = { frame, blend, move }   the pose the renderer would draw on that tick
 *   releases[]   = { tick, id, from, to }   every op6 sub=0 (a launched projectile)
 *   fx[]         = { tick, type, x, y, z }  every op3 sub=0 spawn
 */
function playClip(model, slot, clip) {
  const anim = new ActorAnimator(model);
  anim.homeSlot = slot;
  anim.baseTable = 0;
  const out = { frames: [], releases: [], fx: [], ok: false };
  let tick = 0;
  out.ok = anim.setAction(clip, {
    setLunge: (l) => {
      if (l && l.sub === 0 && Array.isArray(l.from)) out.releases.push({ tick, id: l.id, from: l.from.slice(), to: (l.to || []).slice() });
    },
    onEffect: (r) => out.fx.push({ tick, type: r.type, x: r.x | 0, y: r.y | 0, z: r.z | 0 }),
  });
  if (!out.ok) return out;
  while (anim.vm && tick < CAP_TICKS) {
    anim.tick(TICK_SPEED);
    out.frames.push({ frame: anim.currentFrame(), blend: anim.currentBlend(), move: anim.moveDelta().slice() });
    tick++;
    if (out.releases.length >= MAX_RELEASES) break;
  }
  return out;
}

// ── geometry helpers ──────────────────────────────────────────────────────────────────────────────
const poseAt = (model, f) => FA.poseFromChannels(model, f.frame ?? 0, { blend: f.blend });

/** The tallest-to-lowest extent of the posed mesh, in PS1 units: the unit every threshold is stated in. */
function bodyHeight(model, pose) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < model.bones.length; i++) {
    for (const v of model.bones[i].verts || []) {
      const y = FA.vertexWorld(model, i, v, pose)[1];
      if (y < mn) mn = y;
      if (y > mx) mx = y;
    }
  }
  return Number.isFinite(mn) ? mx - mn : 0;
}

/** The site's own axis at a pose, with the slot movement folded into its positions. */
function axisOf(model, folder, site, pose, move, rest) {
  const ax = FA.firingAxis(model, folder, site, pose, { rest });
  if (!ax) return null;
  return { ...ax, origin: FA.add(ax.origin, move), joint: FA.add(ax.joint, move) };
}

/** What the research says that site IS (K14): a launcher (projectile/beam/breath) or a striking limb. */
function siteKind(folder, site) {
  const id = String(site).replace(/-\d+$/, "");
  const row = emitters(folder).find((e) => e.id === site || e.part === id);
  return row ? row.kind : null;
}

// ── statistics ────────────────────────────────────────────────────────────────────────────────────
const abs = (x) => Math.abs(x);
const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** The three arm-axis candidates, scored on the same shots (rows with an armYaw). */
function summarizeArmAxes(rows) {
  const withArm = rows.filter((r) => r.armYaw);
  if (!withArm.length) return { n: 0 };
  const out = { n: withArm.length };
  for (const k of ["push", "long", "thin"]) {
    const v = withArm.map((r) => r.armYaw[k]).filter((x) => typeof x === "number");
    const a = v.map(abs);
    out[k] = { medianAbs: r1(median(a)), p90Abs: r1(quantile(a, 0.9)), within30: v.filter((x) => abs(x) <= 30).length };
  }
  return out;
}


function summarize(rows, key) {
  const v = rows.map((r) => r[key]).filter((x) => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return { n: 0 };
  const a = v.map(abs);
  return {
    n: v.length,
    median: r1(median(v)),
    medianAbs: r1(median(a)),
    meanAbs: r1(a.reduce((s, x) => s + x, 0) / a.length),
    p10Abs: r1(quantile(a, 0.1)),
    p90Abs: r1(quantile(a, 0.9)),
    within15: v.filter((x) => abs(x) <= 15).length,
    within30: v.filter((x) => abs(x) <= 30).length,
    within45: v.filter((x) => abs(x) <= 45).length,
  };
}

// ── the measurement of one shot ───────────────────────────────────────────────────────────────────
function measureShot(model, folder, side, slot, clip, play, release, site, poseCache, rest, offsets) {
  const f = play.frames[release.tick];
  if (!f) return null;
  const key = `${release.tick}:${f.frame}:${f.blend ? `${f.blend.from}/${f.blend.t}` : "-"}`;
  let pose = poseCache.get(key);
  if (!pose) { pose = poseAt(model, f); poseCache.set(key, pose); }
  const move = f.move || [0, 0, 0];
  const height = bodyHeight(model, pose);
  const ax = axisOf(model, folder, site, pose, move, rest);
  if (!ax) return null;
  const fromIsZero = Math.abs(release.from[0]) + Math.abs(release.from[1]) + Math.abs(release.from[2]) < 1;
  const fromL = fromIsZero ? ax.origin : worldToLocal(side, release.from, slot);
  const dist = fromIsZero ? null : FA.dist(ax.origin, fromL);
  const lineTarget = [0, fromL[1], VICTIM_LINE];
  const line = FA.aimError(ax.axis, fromL, lineTarget);
  const victimSign = side === "enemy" ? -1 : 1;
  const anchorFx = play.fx.find((x) => {
    const z = x.z | 0;
    return x.tick >= release.tick - 24 && Math.sign(z) === victimSign && Math.abs(abs(z) - BASE_Z) <= 700;
  });
  const anchor = anchorFx ? worldToLocal(side, [anchorFx.x, anchorFx.y, anchorFx.z], slot) : null;
  const aim = anchor ? FA.aimError(ax.axis, fromL, anchor) : null;
  // tick sensitivity: the same emitter's aim a few ticks either side of the release
  const curve = [];
  for (let d = -offsets; d <= offsets; d++) {
    const fr = play.frames[release.tick + d];
    if (!fr) { curve.push(null); continue; }
    const p = poseAt(model, fr);
    const a = FA.firingAxis(model, folder, site, p, { rest });
    curve.push(a ? r1(FA.aimError(a.axis, fromL, lineTarget).yaw) : null);
  }
  // the hand class has two candidate axes; the calibration compares them on the same shots
  let palmYaw = null;
  if (ax.cls === "hand") {
    const alt = FA.firingAxis(model, folder, site, pose, { rest, variant: "palm" });
    if (alt) palmYaw = FA.aimError(alt.axis, fromL, lineTarget).yaw;
  }
  // An ARM site has three defensible axes (see firing-axis.js armAxisCandidates). Measuring all
  // three on the same shot is what decides, from the disc's own animations, which one an arm fires
  // along - the choice is data, not taste.
  let armYaw = null;
  if (ax.cls === "prop" || ax.cls === "hand") {
    const c = FA.armAxisCandidates(model, folder, site, pose);
    if (c) armYaw = {
      push: r1(FA.aimError(c.push, fromL, lineTarget).yaw),
      long: r1(FA.aimError(c.long, fromL, lineTarget).yaw),
      thin: r1(FA.aimError(c.thin, fromL, lineTarget).yaw),
    };
  }
  return {
    folder, clip, side, site,
    siteKind: siteKind(folder, site),
    siteVisible: pose.visible?.[ax.bone] !== false,
    tick: release.tick,
    frame: f.frame,
    blend: !!f.blend,
    move: move.map(r1),
    op6Id: release.id,
    cls: ax.cls,
    method: ax.method,
    confidence: ax.confidence,
    axisQuality: ax.axisQuality,
    bone: ax.bone,
    fromIsZero,
    launchOffset: fromIsZero || !height ? null : Math.round((dist / height) * 100) / 100,
    launchOffsetUnits: fromIsZero ? null : Math.round(dist),
    unexplained: !fromIsZero && dist > MATCH_MAX_HEIGHT * height,
    bodyHeight: Math.round(height),
    yaw: r1(line.yaw),
    pitch: r1(line.pitch),
    lineFull: r1(line.full),
    anchorYaw: aim ? r1(aim.yaw) : null,
    anchorPitch: aim ? r1(aim.pitch) : null,
    anchorFull: aim ? r1(aim.full) : null,
    anchorDistance: anchor ? Math.round(FA.dist(fromL, anchor)) : null,
    palmYaw: palmYaw == null ? null : r1(palmYaw),
    armYaw,
    curve,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const opt = { models: [], json: "/home/dorij/scratch-research/anim-k19b-calibration.json", md: null, quiet: false, offsets: 8, limit: 0, clips: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { const v = argv[++i]; if (v == null) throw new Error(`${a} needs a value`); return v; };
    if (a === "--models") opt.models.push(...String(next()).split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--clips") opt.clips = String(next()).split(",").map(Number);
    else if (a === "--json") opt.json = resolve(next());
    else if (a === "--md") opt.md = resolve(next());
    else if (a === "--offsets") opt.offsets = Math.max(0, Number(next()) | 0);
    else if (a === "--limit") opt.limit = Number(next()) | 0;
    else if (a === "--quiet") opt.quiet = true;
    else if (a === "--help" || a === "-h") { console.log("see the header of tools/k19b_calibrate_firing_axis.mjs"); process.exit(0); }
    else throw new Error(`unknown option ${a}`);
  }
  const folders = (opt.models.length ? opt.models : index).slice(0, opt.limit || undefined);
  const rows = [];
  const skipped = { noTech: 0, noRelease: 0, noAxis: 0 };
  for (const folder of folders) {
    let model;
    try { model = loadModel(folder); } catch { continue; }              // a pack that is not extracted here
    const side = authoredSide(model);
    const slot = slotOf(folder, side);
    const rest = FA.restPoseOf(model);
    const clips = [];
    for (let c = 0; c < (model.actions?.length || 0); c++) {
      const ops = model.actions[c]?.ops;
      if (!ops) continue;
      if (!ops.some((o) => o.op === 6 && (o.words?.[0] | 0) === 0)) continue;
      if (opt.clips.length && !opt.clips.includes(c)) continue;
      clips.push(c);
    }
    const mine = [];
    const ownTechs = TECHS_BY_FOLDER.get(folder) || new Set();
    for (const clip of clips) {
      const techs = (TECH_BY_CLIP[clip] || []).filter((t) => ownTechs.has(t.id));
      if (!techs.length) { skipped.noTech++; continue; }
      const play = playClip(model, slot, clip);
      if (!play.ok || !play.releases.length) { skipped.noRelease++; continue; }
      const poseCache = new Map();
      const seen = new Set();
      for (const tech of techs) {
        const rule = shotsFor(folder, tech.name);
        if (rule.mode === "none" || rule.mode === "per-limb-contact" || !rule.emitters.length) continue;
        for (let i = 0; i < play.releases.length; i++) {
          const site = rule.emitters[i % rule.emitters.length];
          const rel = play.releases[i];
          const key = `${site}|${rel.tick}|${rel.id}`;          // one shot per emitter/tick, however many techs use it
          if (seen.has(key)) continue;
          seen.add(key);
          const row = measureShot(model, folder, side, slot, clip, play, rel, site, poseCache, rest, opt.offsets);
          if (!row) { skipped.noAxis++; continue; }
          row.tech = tech.name;
          row.ruleBasis = rule.basis;
          row.ruleMode = rule.mode;
          rows.push(row); mine.push(row);
        }
      }
    }
    if (!opt.quiet && mine.length) {
      console.log(`${folder.padEnd(8)} ${side.padEnd(6)} ${String(mine.length).padStart(3)} shot(s)  ` +
        mine.slice(0, 5).map((r) => `${r.tech}/${r.cls}/${r.site} yaw ${r.yaw}`).join(" | "));
    }
  }

  // ── aggregate ──
  // R1 is a rule about a part that FIRES. A site the research calls a striking limb (a melee arm) is
  // swung across the target, so its "axis" is not an aim; those rows are measured and reported apart,
  // never folded into the firing distributions.
  const live = rows.filter((r) => !r.unexplained);
  const used = live.filter((r) => r.siteKind !== "melee" && r.siteVisible !== false);
  const striking = live.filter((r) => r.siteKind === "melee");
  const hidden = rows.filter((r) => r.siteVisible === false);
  const classes = [...new Set(used.map((r) => r.cls))].sort();
  const perClass = {};
  for (const cls of classes) {
    const rs = used.filter((r) => r.cls === cls);
    const high = rs.filter((r) => r.confidence === "high");
    const offs = rs.filter((r) => r.launchOffset != null).map((r) => r.launchOffset);
    perClass[cls] = {
      shots: rs.length,
      models: new Set(rs.map((r) => r.folder)).size,
      highShots: high.length,
      high: { yaw: summarize(high, "yaw"), pitch: summarize(high, "pitch"), lineFull: summarize(high, "lineFull") },
      sites: [...new Set(rs.map((r) => r.site))].sort(),
      kinds: [...new Set(rs.map((r) => r.siteKind))].sort(),
      unexplained: rows.filter((r) => r.cls === cls && r.unexplained).length,
      zeroFrom: rs.filter((r) => r.fromIsZero).length,
      yaw: summarize(rs, "yaw"),
      pitch: summarize(rs, "pitch"),
      lineFull: summarize(rs, "lineFull"),
      anchorFull: summarize(rs.filter((r) => r.anchorFull != null), "anchorFull"),
      anchorN: rs.filter((r) => r.anchorFull != null).length,
      palmYaw: summarize(rs.filter((r) => r.palmYaw != null), "palmYaw"),
      handN: rs.filter((r) => r.palmYaw != null).length,
      launchOffset: { median: r1(median(offs)), p90: r1(quantile(offs, 0.9)), n: offs.length },
      armAxes: summarizeArmAxes(rs),
      offsetCurve: Array.from({ length: 2 * opt.offsets + 1 }, (_, i) => {
        const ys = rs.map((r) => r.curve?.[i]).filter((x) => typeof x === "number");
        return { offset: i - opt.offsets, n: ys.length, medianAbsYaw: ys.length ? r1(median(ys.map(abs))) : null };
      }),
    };
  }
  const strikeClass = {};
  for (const cls of [...new Set(striking.map((r) => r.cls))].sort()) {
    const rs = striking.filter((r) => r.cls === cls);
    strikeClass[cls] = { shots: rs.length, sites: [...new Set(rs.map((r) => r.site))].sort(), yaw: summarize(rs, "yaw"), pitch: summarize(rs, "pitch") };
  }
  const matched = rows.filter((r) => !r.fromIsZero);
  const summary = {
    generatedAt: new Date().toISOString(),
    models: new Set(rows.map((r) => r.folder)).size,
    clips: new Set(rows.map((r) => `${r.folder}:${r.clip}`)).size,
    shots: rows.length,
    zeroFrom: rows.filter((r) => r.fromIsZero).length,
    unexplained: rows.filter((r) => r.unexplained).length,
    used: used.length,
    striking: striking.length,
    hiddenAtRelease: hidden.length,
    launchPointAgrees: matched.length ? r1(100 * (matched.filter((r) => !r.unexplained).length / matched.length)) : null,
    skipped,
    byClass: perClass,
    strikingByClass: strikeClass,
  };
  mkdirSync(dirname(opt.json), { recursive: true });
  writeFileSync(opt.json, JSON.stringify({ summary, rows }, null, 1));

  const lines = [];
  lines.push(`# R1 calibration on the disc's authored casts (K19b)`, "");
  lines.push(`${summary.shots} shots from ${summary.clips} authored cast clips of ${summary.models} models. ` +
    `${used.length} are attributed to a site the research calls a launcher; ${striking.length} to a striking limb (R1 does ` +
    `not apply: the disc swings those across the target). ${summary.zeroFrom} records write no launch point; ` +
    `${summary.unexplained} have a launch point the attributed part does not reach; ${summary.hiddenAtRelease} are attributed ` +
    `to a part the pack HIDES at that tick (ch3 = 0), so they cannot show an aim.`, "");
  lines.push(`| class | shots | models | sites (K14 kind) | median abs yaw | p90 yaw | <=15 | <=30 | median pitch | median 3D to anchor | anchors |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const cls of classes) {
    const c = perClass[cls];
    const pct = (n) => `${n} (${Math.round((100 * n) / c.shots)}%)`;
    lines.push(`| ${cls} | ${c.shots} | ${c.models} | ${c.sites.join(" ")} (${c.kinds.join("/")}) | ${c.yaw.medianAbs} | ${c.yaw.p90Abs} | ${pct(c.yaw.within15)} | ` +
      `${pct(c.yaw.within30)} | ${c.pitch.median} | ${c.anchorFull.medianAbs ?? "-"} | ${c.anchorN} |`);
  }
  lines.push("");
  for (const cls of classes) {
    const c = perClass[cls];
    const best = c.offsetCurve.slice().sort((a, b) => (a.medianAbsYaw ?? 999) - (b.medianAbsYaw ?? 999))[0];
    lines.push(`- **${cls}** — yaw bias ${c.yaw.median} deg (median signed; + = right of the target), pitch ${c.pitch.median} deg, ` +
      `launch point ${c.launchOffset.median} body-heights from the emitter (p90 ${c.launchOffset.p90}, n ${c.launchOffset.n}), ` +
      `best tick offset ${best?.offset} of ±${opt.offsets} (release-relative median |yaw| ${c.offsetCurve.map((o) => `${o.offset}:${o.medianAbsYaw}`).join(" ")}), ` +
      `unexplained rows ${c.unexplained}.`);
    if (c.handN) lines.push(`  - hand axis on ${c.handN} shots: push median |yaw| ${c.yaw.medianAbs}, palm normal median |yaw| ${c.palmYaw.medianAbs}`);
    if (c.highShots !== c.shots) {
      lines.push(`  - geometry well conditioned on ${c.highShots}/${c.shots} shots: median |yaw| ${c.high.yaw.medianAbs}, median |pitch| ${c.high.pitch.medianAbs}, median 3D ${c.high.lineFull.medianAbs}, ` +
        `<=15 deg ${c.high.yaw.within15}/${c.highShots}, <=30 deg ${c.high.yaw.within30}/${c.highShots}`);
    }
    if (c.armAxes.n) {
      const a = c.armAxes;
      lines.push(`  - arm axis candidates on the same ${a.n} shots: push ${a.push.medianAbs} (p90 ${a.push.p90Abs}, <=30 deg ${a.push.within30}), ` +
        `long ${a.long.medianAbs} (p90 ${a.long.p90Abs}, <=30 deg ${a.long.within30}), thin ${a.thin.medianAbs} (p90 ${a.thin.p90Abs}, <=30 deg ${a.thin.within30})`);
    }
  }
  if (striking.length) {
    lines.push("", `Striking sites (a swung limb, so an axis-vs-target angle is expected to be large):`);
    for (const cls of Object.keys(strikeClass)) {
      const c = strikeClass[cls];
      lines.push(`- ${cls} on ${c.sites.join(" ")}: ${c.shots} shots, median |yaw| ${c.yaw.medianAbs} (p10 ${c.yaw.p10Abs}, p90 ${c.yaw.p90Abs})`);
    }
  }
  const md = lines.join("\n") + "\n";
  if (opt.md) { mkdirSync(dirname(opt.md), { recursive: true }); writeFileSync(opt.md, md); }
  if (!opt.quiet) console.log(`\n${md}`);
  console.log(`wrote ${opt.json}${opt.md ? ` and ${opt.md}` : ""}`);
}

main();
