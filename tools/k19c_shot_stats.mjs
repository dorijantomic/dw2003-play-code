// K19c - the numbers behind web/fight/anim-collision.js, measured over every model pack.
//
//   node tools/k19c_shot_stats.mjs
//
// Writes /home/dorij/scratch-research/anim-k19c-stats.json and prints:
//   * HAND WIDTH     the bare arm-end collider's diameter / body height (props excluded) -> the spread
//                    separation: two shots closer than one hand block draw on top of each other
//   * CLASP          the closest the two hands come in the model's OWN authored cast, / height -> the
//                    combined gap a shared shot closes to
//   * FLOOR          the per-pair clearance bar each body's own animation defines (fused pairs and
//                    how much room the tested pairs get)
//   * SANITY         the pose test run over the body's OWN animation: every sampled pose must pass its
//                    own bar (by construction, and a miss means the sampler skipped the extreme frame)
//
// Pure arithmetic over the packs; no browser.
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(REPO, "web/assets/battle/models");
const OUT = "/home/dorij/scratch-research/anim-k19c-stats.json";

const { rigColliders, penetration, clearanceTolerance, bodyHeight, sharedShotTargets, allowedPairs } =
  await import(path.join(REPO, "web/fight/anim-collision.js"));
const { restPose } = await import(path.join(REPO, "web/fight/anim-retarget.js"));
const { BONEMAP, armChains } = await import(path.join(REPO, "web/fight/digimon-bonemap.js"));
const { tipOf } = await import(path.join(REPO, "web/fight/launch-plan.js"));
const { emitters, SHOTS } = await import(path.join(REPO, "web/fight/digimon-anatomy.js"));

const index = JSON.parse(fs.readFileSync(path.join(MODELS, "index.json"), "utf8"));
const folders = (Array.isArray(index) ? index : index.models).sort();
const read = (f) => JSON.parse(fs.readFileSync(path.join(MODELS, f, "anim.json"), "utf8"));

const stat = (a) => {
  if (!a.length) return { n: 0 };
  const s = a.slice().sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
  return { n: s.length, min: q(0), p10: q(0.1), p25: q(0.25), med: q(0.5), p75: q(0.75), p90: q(0.9), max: q(1) };
};

const spawn = (a) => (a?.ops || []).some((o) => o.op === 6 && ((o.words?.[0] | 0) === 0));
const castWindows = (model) => {
  const out = [];
  for (let i = 0; i < (model.actions || []).length; i++) {
    const a = model.actions[i];
    if (!spawn(a)) continue;
    const tables = [...new Set((a.ops || []).filter((o) => o.op === 2 && (o.words?.[2] | 0) > 0).map((o) => o.words[2] | 0))];
    let lo = Infinity, hi = -1;
    for (const t of tables) {
      for (const e of model.timeline?.[t]?.table || []) {
        const v = e?.value | 0;
        if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
    }
    if (hi >= 0) out.push({ clip: i, lo, hi });
  }
  return out;
};

const handW = [], clasp = [], floors = [], fusedFrac = [], ownViol = [], restClear = [];
const multiD = [];
const rows = [];

for (const folder of folders) {
  const file = path.join(MODELS, folder, "anim.json");
  if (!fs.existsSync(file)) continue;
  const model = read(folder);
  const m = BONEMAP[folder];
  if (!m) continue;
  const rig = rigColliders(model, folder);
  const H = bodyHeight(model);

  // hand width: the arm chain's END bone collider, only when that end is a BARE hand (no held prop)
  const widths = [];
  for (const side of ["left", "right"]) {
    const ch = armChains(folder, side)[0];
    if (!ch || !ch.length) continue;
    const col = rig.colliders.find((c) => c.bone === ch[ch.length - 1]);
    if (col && !col.prop) widths.push((2 * col.radius) / H);
  }
  if (widths.length) handW.push(Math.max(...widths));

  // clasp: the closest the two hand tips come during the model's own authored cast
  let close = Infinity;
  for (const w of castWindows(model)) {
    for (let k = 0; k < 14; k++) {
      const f = Math.round(w.lo + ((w.hi - w.lo) * k) / 13);
      const rp = restPose(model, f);
      const L = armChains(folder, "left")[0], R = armChains(folder, "right")[0];
      if (!L?.length || !R?.length) continue;
      const pl = tipOf(rp.pos, model, L[L.length - 1], L.length > 1 ? L[L.length - 2] : null);
      const pr = tipOf(rp.pos, model, R[R.length - 1], R.length > 1 ? R[R.length - 2] : null);
      if (!pl || !pr) continue;
      close = Math.min(close, Math.hypot(pl[0] - pr[0], pl[1] - pr[1], pl[2] - pr[2]) / H);
    }
  }
  if (Number.isFinite(close)) clasp.push(close);

  // tolerance + sanity
  const tol = clearanceTolerance(model, folder);
  floors.push(tol.floor / H);
  const totalPairs = allowedPairs(rig).length;
  let fused = 0;
  for (const [, v] of tol.byPair) if (v === null) fused++;
  fusedFrac.push(totalPairs ? fused / totalPairs : 0);
  const rest = penetration(model, restPose(model, 0), { folder, tolerance: 0 });
  restClear.push(rest.clearance / H);
  // every sampled pose of the body's own animation must pass its own bar (a cross-check on a grid
  // coarser AND offset from the one the bar was measured on, so it is not a tautology)
  let bad = 0;
  for (let k = 0; k < 37; k++) {
    const f = Math.round(((model.total_frames || 990) - 1) * k / 36) + (k % 3);
    const p = penetration(model, restPose(model, Math.min(f, (model.total_frames || 990) - 1)), { folder });
    if (!p.ok) bad++;
  }
  ownViol.push(bad);

  // multi-emitter volley spread: the separation of the emitter SITES in the model's own cast
  const parts = [...new Set(emitters(folder).filter((e) => e.kind !== "melee").map((e) => e.part))];
  const rules = Object.values(SHOTS[folder] || {});
  if (parts.length >= 2 && rules.some((r) => r[0] === "per-emitter")) {
    for (const w of castWindows(model)) {
      for (let k = 0; k < 14; k++) {
        const f = Math.round(w.lo + ((w.hi - w.lo) * k) / 13);
        const rp = restPose(model, f);
        const point = (part) => {
          if (part === "left-arm" || part === "right-arm" || part === "both-arms") {
            const ch = armChains(folder, part === "left-arm" ? "left" : "right")[0];
            return ch?.length ? tipOf(rp.pos, model, ch[ch.length - 1], ch.length > 1 ? ch[ch.length - 2] : null) : null;
          }
          if (part === "head" || part === "mouth" || part === "eyes") return tipOf(rp.pos, model, m.f?.[part] ?? m.h, null);
          if (part === "chest" || part === "back" || part === "whole-body") return rp.pos[m.t ?? m.r];
          if (part === "tail") { const tl = m.tl || []; return tl.length ? tipOf(rp.pos, model, tl[tl.length - 1], tl.length > 1 ? tl[tl.length - 2] : null) : null; }
          if (part === "wings") { const wb = m.wb || []; return wb.length ? tipOf(rp.pos, model, wb[0], null) : null; }
          return null;
        };
        const pts = parts.map(point).filter(Boolean);
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]) / H;
          if (d > 1e-6) multiD.push(d);
        }
      }
    }
  }

  rows.push({ folder, height: H, handW: widths.length ? Math.max(...widths) : null, clasp: Number.isFinite(close) ? close : null, floor: tol.floor / H, floorSource: tol.source, fused, totalPairs, ownBad: bad, rest: rest.clearance / H });
}

const result = {
  handWidth: stat(handW),
  clasp: stat(clasp),
  claspBins: (() => { const b = new Array(12).fill(0); for (const v of clasp) b[Math.min(11, Math.floor(v / 0.02))]++; return b.map((n, i) => ({ from: i * 0.02, n })); })(),
  multiEmitterSeparation: stat(multiD),
  floor: stat(floors),
  fusedFraction: stat(fusedFrac),
  restClearance: stat(restClear),
  ownAnimationViolations: { models: ownViol.length, modelsWithAny: ownViol.filter((n) => n > 0).length, total: ownViol.reduce((a, b) => a + b, 0) },
  models: folders.length,
  rows,
};
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log("hand width (bare hand) / h  ", JSON.stringify(result.handWidth));
console.log("clasp (own cast) / h        ", JSON.stringify(result.clasp));
console.log("clasp bins 0.02h            ", result.claspBins.map((b) => `${b.from.toFixed(2)}:${b.n}`).join(" "));
console.log("multi-emitter site sep / h  ", JSON.stringify(result.multiEmitterSeparation));
console.log("authored per-pair floor / h ", JSON.stringify(result.floor));
console.log("fused pair fraction         ", JSON.stringify(result.fusedFraction));
console.log("rest-pose clearance / h     ", JSON.stringify(result.restClearance));
console.log("own animation violations    ", JSON.stringify(result.ownAnimationViolations));
console.log("wrote", OUT);

const H = 3000;
const demo = sharedShotTargets({
  points: [{ id: "left-arm", site: "left-arm", x: -0.21 * H, y: 0, z: 1200 }, { id: "right-arm", site: "right-arm", x: 0.21 * H, y: 0, z: 1200 }],
  mode: "combined", height: H,
});
console.log("combined demo:", JSON.stringify(demo.points.map((p) => [p.x / H, p.y / H, p.z / H])), demo.basis);
const demo2 = sharedShotTargets({
  points: [{ id: "left-arm", site: "left-arm", x: -0.30 * H, y: 0, z: 1200 }, { id: "right-arm", site: "right-arm", x: 0.18 * H, y: 0, z: 900 }, { id: "mouth", site: "mouth", x: 0.01 * H, y: 0, z: 1500 }],
  mode: "spread", height: H, origin: { x: 0, y: 0, z: 0 },
});
console.log("spread demo:", JSON.stringify(demo2.points.map((p) => [p.x / H, p.y / H, p.z / H])), demo2.basis);
