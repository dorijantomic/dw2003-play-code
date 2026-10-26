#!/usr/bin/env node
// build_dw2_bonemaps.mjs — derive a DW2 donor's bone map (role -> bone indices) from its OWN rig, so a
// DW2 clip can be retargeted onto a DW3 model without a hand-written table per species (K22b rule 3).
//
// The inputs are the model's own rest pose, hierarchy and mesh boxes, run through the SAME geometry code
// the DW3 map was derived with (web/fight/anim-retarget.js rolesOf / normaliseRoots), with the DW2 model's
// DW3 TWIN as the prior for which role KINDS exist (a creature has the same limbs in both games; only the
// bone indices differ). "Limb roots" is on: a rig may hang a whole limb off its own root (K21d measured 27
// of 108 DW2 rigs of that class, and Kokatorimon's legs were unclaimable without the rule).
//
//   node tools/build_dw2_bonemaps.mjs --root ~/dw2-models/converted2 \
//        --out web/assets/dw2-motion/bonemaps.json [--species m009mera,m050coca] [--report]
//
// `--root` holds one converted model per species in a `dw2_<DW3 folder>` directory (the output of the DW2
// converter; see the K21d report). The OUTPUT IS DISC-DERIVED: it holds bone indices computed from the
// user's own DW2 files, so it is written under web/assets/ (git-ignored) or wherever --out points, and the
// game runs unchanged when it is absent. Nothing here names a species: species appear only on the command
// line and in the generated file's own folder keys.
import fs from "node:fs";
import path from "node:path";
import { BONEMAP } from "../web/fight/digimon-bonemap.js";
import { rolesOf, normaliseRoots } from "../web/fight/anim-retarget.js";

const A = process.argv.slice(2);
const arg = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const ROOT = arg("--root", path.join(process.env.HOME, "dw2-models/converted2"));
const OUT = arg("--out", "web/assets/dw2-motion/bonemaps.json");
const ONLY = arg("--species", "") ? arg("--species").split(",").filter(Boolean) : null;
const REPORT = A.includes("--report");

/** The converted-model directories present under --root, matched to a DW3 twin folder by name. */
function discovered() {
  const out = [];
  for (const d of fs.readdirSync(ROOT)) {
    if (!d.startsWith("dw2_")) continue;
    const twin = d.slice(4);
    const file = path.join(ROOT, d, "anim.json");
    if (!BONEMAP[twin] || !fs.existsSync(file)) continue;
    if (ONLY && !ONLY.includes(twin)) continue;
    out.push({ folder: d, twin, file });
  }
  return out.sort((a, b) => a.twin.localeCompare(b.twin));
}

const posOf = (pose, i) => pose.pos[i];

/** Chains a two-limbed wing/tail pair out of the chains no other role claimed, by geometry. */
function spareChains(geo, used) {
  return geo.chains.filter((ch) => !ch.seq.some((b) => used.has(b)));
}

/**
 * Derive one species' map. Role KINDS from the twin (prior), indices from this rig's own geometry.
 * Returns { map, info } — info carries what the decision was made of, so the report can show it.
 */
export function deriveBoneMap(model, twinMap, { limbRoots = true } = {}) {
  const geo = rolesOf(model, { limbRoots });
  const pose = geo.pose;
  const H = geo.box.h || 1, W = geo.box.w || 1, D = geo.box.d || 1;
  const topY = Math.min(...pose.pos.map((p) => p[1]));
  const mk = { r: 0, ro: geo.roots.slice(), t: null, h: null, m: null, e: null,
               aL: [], aR: [], lL: [], lR: [], wL: [], wR: [], tl: [], loc: null,
               dom: null, sc: "low", f: {}, fb: [] };
  const used = new Set();
  const take = (chain) => { for (const b of chain) used.add(b); return chain.slice(); };
  const tipX = (ch) => posOf(pose, ch.tip)[0];
  const tipY = (ch) => posOf(pose, ch.tip)[1];
  const sideOf = (ch) => (tipX(ch) < 0 ? "left" : "right");
  const twinHas = (k) => !!twinMap[k]?.length;

  // HEAD first: it must not be stolen by a lateral chain (a horn/ear chain reaches the top too)
  const headVol = (i) => {
    const vs = model.bones[i]?.verts ?? [];
    if (!vs.length) return null;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const v of vs) for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; }
    return { d: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], vol: (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2]) };
  };
  if (geo.head >= 0) { mk.h = geo.head; used.add(geo.head); }
  else if (twinHas("h")) {
    // the geometry's compact-head rule refused every bone (a flame/mane mesh is neither small nor
    // compact): take the top-most near-centre bone that carries a mesh
    let best = null;
    for (let i = 0; i < geo.n; i++) {
      if (Math.abs(posOf(pose, i)[0]) > 0.20 * W) continue;
      const bb = headVol(i);
      if (!bb) continue;
      if (!best || pose.pos[i][1] < pose.pos[best][1]) best = i;
    }
    if (best != null) { mk.h = best; used.add(best); }
  }

  // LEGS: the chains whose tips reach the floor, one per side. The twin's map GATES the role (a floating
  // or plant-rooted creature has no legs in either game). When the floor rule finds none (a quadruped
  // whose tail or wing tip is the lowest point), fall back to a PAIR of equal-length lateral chains in the
  // lower half — a pair, because one limb alone is more often a trunk chain than a leg.
  const legs = [];
  if (twinHas("lL") || twinHas("lR")) {
    for (const leg of geo.legs) if (!legs.some((l) => l.side === leg.side)) legs.push(leg);
    if (!legs.length) {
      const cand = geo.chains
        .filter((ch) => ch.seq.length >= 2 && ch.seq.length <= 6 && !ch.seq.includes(geo.head)
          && Math.abs(tipX(ch)) > 0.03 * W && tipY(ch) > topY + 0.55 * H)
        .sort((a, b) => tipY(b) - tipY(a));
      let best = null;
      for (const a of cand.filter((ch) => sideOf(ch) === "left")) {
        for (const b of cand.filter((ch) => sideOf(ch) === "right")) {
          if (Math.abs(a.seq.length - b.seq.length) > 1) continue;
          if (Math.abs(tipY(a) - tipY(b)) > 0.15 * H) continue;
          const score = tipY(a) + tipY(b);
          if (!best || score > best.score) best = { a, b, score };
        }
      }
      if (best) legs.push({ side: "left", chain: best.a.seq }, { side: "right", chain: best.b.seq });
    }
  }
  for (const leg of legs) {
    const key = leg.side === "left" ? "lL" : "lR";
    if (mk[key].length) continue;         // one leg per side (a second pair stays unmapped)
    mk[key] = take(leg.chain);
  }

  // ARMS / WINGS: a creature's lateral limbs, in the KINDS its twin has. Geometry says which chains
  // reach out and up; the twin's map says whether those are arms, wings, or an arm pair UND a wing pair
  // (then the topmost pair is the wings, the next one the arms).
  const lateral = spareChains(geo, used)
    .filter((ch) => ch.seq.length >= 2 && Math.abs(tipX(ch)) > 0.10 * W && tipY(ch) < topY + 0.55 * H)
    .sort((a, b) => tipY(a) - tipY(b));    // topmost first
  const pickPair = (pool) => {
    const out = { left: null, right: null };
    for (const ch of pool) {
      const s = sideOf(ch);
      if (!out[s]) out[s] = ch;
    }
    return out;
  };
  if (twinHas("wL") || twinHas("wR")) {
    const wings = pickPair(lateral);
    for (const s of ["left", "right"]) { const ch = wings[s]; if (ch) mk[s === "left" ? "wL" : "wR"] = take(ch.seq); }
    if (twinHas("aL") || twinHas("aR")) {
      const arms = pickPair(spareChains(geo, used)
        .filter((ch) => ch.seq.length >= 2 && Math.abs(tipX(ch)) > 0.10 * W && tipY(ch) < topY + 0.60 * H)
        .sort((a, b) => b.seq.length - a.seq.length));
      for (const s of ["left", "right"]) { const ch = arms[s]; if (ch) mk[s === "left" ? "aL" : "aR"] = take(ch.seq); }
    }
  } else if (twinHas("aL") || twinHas("aR")) {
    const arms = pickPair(lateral.slice().sort((a, b) => b.seq.length - a.seq.length));
    for (const s of ["left", "right"]) { const ch = arms[s]; if (ch) mk[s === "left" ? "aL" : "aR"] = take(ch.seq); }
  }

  // TAIL: a spare chain whose tip sits BEHIND the body (-Z is the back) and below the head
  if (twinHas("tl")) {
    const cand = spareChains(geo, used)
      .filter((ch) => ch.seq.length >= 2 && posOf(pose, ch.tip)[2] < geo.box.mn[2] + 0.30 * D
        && tipY(ch) > topY + 0.25 * H)
      .sort((a, b) => b.seq.length - a.seq.length)[0];
    if (cand) mk.tl = take(cand.seq);
  }

  // TORSO: the trunk bone with the largest own mesh box (the K12 rule), then the root normalisation says
  // which root is which (root = the one carrying the legs, a second upper root = the torso).
  let torso = null, bestVol = 0;
  const limbBones = new Set([...mk.aL, ...mk.aR, ...mk.wL, ...mk.wR, ...mk.lL, ...mk.lR, ...mk.tl]);
  for (let i = 0; i < geo.n; i++) {
    if (limbBones.has(i) || i === mk.h || geo.roots.includes(i)) continue;
    const vs = model.bones[i]?.verts ?? [];
    if (!vs.length) continue;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const v of vs) for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; }
    const vol = (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2]);
    if (vol > bestVol) { bestVol = vol; torso = i; }
  }
  // roots: r = the root that carries the legs (locomotion), t = a second upper-body root (K22b rule 1)
  const rig = { n: geo.n, roots: geo.roots, legs: [{ side: "left", chain: mk.lL.length ? mk.lL : [], ordinal: 0 },
                                                  { side: "right", chain: mk.lR.length ? mk.lR : [], ordinal: 0 }],
                arms: [{ side: "left", chain: mk.aL.length ? mk.aL : [], ordinal: 0 },
                       { side: "right", chain: mk.aR.length ? mk.aR : [], ordinal: 0 }],
                wings: [], tail: [], head: geo.head, root: torso ?? geo.roots[0], torso };
  const nr = normaliseRoots(rig, model);
  mk.r = nr.root;
  mk.t = nr.torso ?? (torso != null && torso !== nr.root ? torso : null);
  return { map: mk, info: { geo, rootFix: nr } };
}

const rows = [];
for (const sp of discovered()) {
  const model = JSON.parse(fs.readFileSync(sp.file, "utf8"));
  model.folder = sp.folder;
  const twinMap = BONEMAP[sp.twin];
  const { map, info } = deriveBoneMap(model, twinMap);
  // agreement: role PRESENCE against the twin (the twin is a different skeleton, so indices never match)
  const agree = {};
  for (const [k, label] of [["aL", "arm:left"], ["aR", "arm:right"], ["lL", "leg:left"], ["lR", "leg:right"],
                            ["wL", "wing:left"], ["wR", "wing:right"], ["tl", "tail"]]) {
    agree[label] = !!map[k]?.length === !!twinMap[k]?.length;
  }
  agree.head = (map.h != null) === (twinMap.h != null);
  agree["root:legs"] = map.r != null;
  agree.torso = (map.t != null) === (twinMap.t != null);
  const plan = Object.keys(agree);
  const ok = plan.filter((k) => agree[k]).length;
  rows.push({
    twin: sp.twin, folder: sp.folder, bones: model.num_bones ?? model.bones.length,
    roots: info.geo.roots.length, twinRoots: twinMap.ro?.length ?? null,
    map, agree, agreed: ok, of: plan.length,
    chainLens: { aL: map.aL.length, aR: map.aR.length, lL: map.lL.length, lR: map.lR.length,
                 wL: map.wL.length, wR: map.wR.length, tl: map.tl.length },
    twinLens: { aL: twinMap.aL?.length ?? 0, aR: twinMap.aR?.length ?? 0, lL: twinMap.lL?.length ?? 0,
                lR: twinMap.lR?.length ?? 0, wL: twinMap.wL?.length ?? 0, wR: twinMap.wR?.length ?? 0,
                tl: twinMap.tl?.length ?? 0 },
  });
}

const out = {};
for (const r of rows) out[r.folder] = mergeShort(r.map);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: "tools/build_dw2_bonemaps.mjs — geometry + twin prior, DISC-DERIVED, not for the repo", models: out }, null, 0));

function mergeShort(m) {
  const o = { r: m.r, ro: m.ro, t: m.t, h: m.h, m: m.m, e: m.e, dom: m.dom, sc: m.sc, f: m.f, fb: m.fb };
  for (const k of ["aL", "aR", "lL", "lR", "wL", "wR", "tl"]) if (m[k]?.length) o[k] = m[k];
  return o;
}

if (REPORT) {
  for (const r of rows) {
    console.log(`${r.twin.padEnd(9)} dw2 ${r.folder.padEnd(12)} bones ${String(r.bones).padStart(2)} roots ${r.roots}/${r.twinRoots}` +
      `  r=${r.map.r} t=${r.map.t} h=${r.map.h}` +
      `  aL ${r.map.aL.join("-") || "-"} aR ${r.map.aR.join("-") || "-"}` +
      `  lL ${r.map.lL.join("-") || "-"} lR ${r.map.lR.join("-") || "-"}` +
      `  wL ${r.map.wL.join("-") || "-"} wR ${r.map.wR.join("-") || "-"} tl ${r.map.tl.join("-") || "-"}` +
      `  agree ${r.agreed}/${r.of}${r.agreed < r.of ? "  MISS " + Object.keys(r.agree).filter((k) => !r.agree[k]).join(",") : ""}`);
  }
}
const tot = rows.length;
const full = rows.filter((r) => r.agreed === r.of).length;
const perRole = {};
for (const r of rows) for (const [k, v] of Object.entries(r.agree)) perRole[k] = (perRole[k] || 0) + (v ? 1 : 0);
console.log(`\n${tot} maps written to ${OUT}; role presence agrees with the twin on ${full}/${tot} maps`);
console.log("per role: " + Object.entries(perRole).map(([k, v]) => `${k} ${v}/${tot}`).join("  "));
