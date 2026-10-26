// compile.mjs — the motion language of the K26d prototype: plain-words phases -> keyframes -> a playable clip.
// In the repo since 2026-10-26 (from the private research prototype): paths come from ./paths.mjs, the logic is unchanged.
//
//   1. READ a scene file (see scenes/*.motion) — lines of clauses in the vocabulary documented in
//      the research notes (motion-language, section 2).
//   2. Every `phase <name> <N>t` opens a pose phase; the clauses under it build ONE target pose in the
//      body's own frame (role + world direction, never a model-local axis).
//   3. Per tick the compiler mixes the previous phase's pose into this one (smoothstep), solves it
//      (dwr.solvePose) and writes the channels the renderer reads (ch2 Euler, ch1 offset) at
//      `offset + tick`, exactly like web/fight/generic-motion.js bakeGenericMotion does.
//   4. Events (effect / release / hit) become action-script ops placed at the tick they were asked for,
//      the pose phases become frame tables — so the result plays in the game's action VM and in the
//      timeline sampler, and in the model/anim viewer.
//
// usage: node compile.mjs scenes/spirit-bomb.motion [outDir] [--style=a|b] [--slot=11]
import fs from "node:fs";
import path from "node:path";
import * as D from "./dwr.mjs";

const { add, sub, scl, unit, len, lerp3, ss, DEG } = D;

// ── direction words (the body's own frame: +X right, +Y down, +Z forward) ────────────────────
const DIRS = {
  up: [0, -1, 0], down: [0, 1, 0], forward: [0, 0, 1], back: [0, 0, -1],
  right: [1, 0, 0], left: [-1, 0, 0], overhead: [0, -1, 0], front: [0, 0, 1], behind: [0, 0, -1],
  "up-forward": [0, -1, 1], "up-back": [0, -1, -1], "down-forward": [0, 1, 1], "down-back": [0, 1, -1],
  "up-left": [-1, -1, 0], "up-right": [1, -1, 0], "out-left": [-1, -0.2, 0], "out-right": [1, -0.2, 0],
  "in-front": [0, 0.3, 1], "over-head": [0, -1, 0], sky: [0, -1.2, 0.2], ground: [0, 1, 0.6],
};
export const dirOf = (w) => DIRS[w] ?? (w?.startsWith("vec:") ? w.slice(4).split(",").map(Number) : null);

// ── roles → chains, with the fallback ladder ────────────────────────────────────────────────
export function resolveRole(body, word) {
  const ch = body.chains;
  const has = (k) => Array.isArray(ch[k]) && ch[k].length > 0;
  const pick = (...ks) => ks.find(has);
  const arms = [ch.armL, ch.armR].filter(Boolean);
  const legs = [ch.legL, ch.legR].filter(Boolean);
  const wings = [ch.wingL, ch.wingR, ch.wingC].filter(Boolean);
  switch (word) {
    case "both-arm": case "both-arms": case "arms": case "both":
      if (arms.length) return { chains: arms, how: "arm chains" };
      if (wings.length) return { chains: wings, how: "fallback: no arms, using the wings" };
      if (has("trunk")) return { chains: [ch.trunk], how: "fallback: no arms or wings, using the trunk (a whole-body gesture)", kind: "body" };
      return { chains: [], how: "no limb to move (serpent/blob with no arms)" };
    case "arm-right": case "right-arm": case "right-hand":
      if (has("armR")) return { chains: [ch.armR], how: "armR" };
      if (arms.length) return { chains: [arms[0]], how: "fallback: no right arm, using the only arm" };
      return resolveRole(body, "both");
    case "arm-left": case "left-arm": case "left-hand":
      if (has("armL")) return { chains: [ch.armL], how: "armL" };
      if (arms.length) return { chains: [arms[0]], how: "fallback: no left arm, using the only arm" };
      return resolveRole(body, "both");
    case "legs": case "both-legs":
      if (legs.length) return { chains: legs, how: "leg chains" };
      return { chains: [], how: "no legs (a floating/serpent body)" };
    case "leg-right": case "right-leg": return has("legR") ? { chains: [ch.legR], how: "legR" } : resolveRole(body, "legs");
    case "leg-left": case "left-leg": return has("legL") ? { chains: [ch.legL], how: "legL" } : resolveRole(body, "legs");
    case "tail":
      if (has("tail")) return { chains: [ch.tail], how: "tail chain" };
      if (has("extra")) return { chains: [ch.extra], how: "fallback: no tail, using the extra chain" };
      if (has("trunk")) return { chains: [ch.trunk], how: "fallback: no tail, using the trunk/spine" };
      return { chains: [], how: "no tail and no spine" };
    case "wings": case "both-wings":
      if (wings.length) return { chains: wings, how: "wing chains" };
      if (arms.length) return { chains: arms, how: "fallback: no wings, using the arms" };
      return { chains: [], how: "no wings, no arms" };
    case "wing-right": return has("wingR") ? { chains: [ch.wingR], how: "wingR" } : resolveRole(body, "wings");
    case "wing-left": return has("wingL") ? { chains: [ch.wingL], how: "wingL" } : resolveRole(body, "wings");
    case "trunk": case "spine": case "body":
      if (has("trunk")) return { chains: [ch.trunk], how: "trunk chain", kind: "body" };
      return { chains: [], how: "no trunk" };
    case "head":
      if (body.sites?.head?.bone != null) return { chains: [[body.sites.head.bone]], how: "head bone", kind: "head" };
      return { chains: [], how: "no head bone" };
    default:
      if (has(word)) return { chains: [ch[word]], how: `scene chain "${word}"` };
      return { chains: [], how: `unknown role "${word}"` };
  }
}

// ── one clause → a pose mutation (the vocabulary) ────────────────────────────────────────────
// Each clause returns {pose, event?} and may record a fallback note.
function applyClause(body, pose, words, notes) {
  const [v, ...rest] = words;
  const num = (i) => Number(rest[i] ?? 0);
  const P = pose;
  switch (v) {
    case "rest": { const f = { ...P.flip }; const np = D.blankPose(body); np.flip = f; return { pose: np }; }
    case "hold": return { pose: P };
    case "lean": {
      const dir = rest[0], deg = num(1);
      if (dir === "back") P.lean.p = -deg; else if (dir === "forward") P.lean.p = deg;
      else if (dir === "right") P.lean.r = deg; else if (dir === "left") P.lean.r = -deg;
      else if (dir === "turn-right") P.lean.y = deg; else if (dir === "turn-left") P.lean.y = -deg;
      return { pose: P };
    }
    case "head": {
      const dir = rest[0], deg = num(1);
      if (dir === "up") P.head.p = -deg; else if (dir === "down") P.head.p = deg;
      else if (dir === "right") P.head.y = deg; else if (dir === "left") P.head.y = -deg;
      return { pose: P };
    }
    case "turn": { P.turn = (rest[0] === "left" ? -1 : 1) * num(1); return { pose: P }; }
    case "shift": {
      const d = dirOf(rest[0]) ?? [0, 0, 1];
      P.shift = scl(unit(d), num(1));
      return { pose: P };
    }
    case "carry": {                                    // carry <bone> with <left-hand|right-hand> <x> <y> <z> [<pct>]: a part follows a hand
      const bone = +rest[0], handWord = rest[2] ?? "left-hand";                 // rest[1] === "with"
      const hb = handWord.startsWith("right") ? body.sites?.hands?.right?.bone : body.sites?.hands?.left?.bone;
      if (!Number.isFinite(bone) || hb == null) { notes.push(`carry ${rest.join(" ")}: needs a bone number and a hand (ignored)`); return { pose: P }; }
      const off = [num(3), num(4), num(5)];
      const pct = rest[6] != null ? Number(String(rest[6]).replace("%", "")) : 100;
      const si = rest.indexOf("spin");
      const spin = si >= 0 ? Number(rest[si + 1]) : 0;                          // a turn of the part about the vertical axis, degrees
      P.follow[bone] = { hand: hb, off, amt: pct / 100, spin };
      notes.push(`carry bone ${bone} with ${handWord} (bone ${hb}) ${pct}%`);
      return { pose: P };
    }
    case "knee": {                                     // knee <legs|left-leg|right-leg> <deg>: flex the real knee (shin back)
      const role = rest[0], deg = num(1);
      const r = resolveRole(body, role);
      notes.push(`knee ${role} ${deg}deg (${r.how})`);
      for (const chain of r.chains) {
        const key = chainIdOf(body, chain) ?? `b${chain[0]}`;
        P.knee[key] = deg;
      }
      return { pose: P };
    }
    case "joint": {                                    // joint <bone> <pitch> <yaw> <roll>: an extra turn of ONE bone about its own pivot (degrees, world axes); how the DW2 converter writes full 3-axis rotations
      P.joint[+rest[0]] = { p: num(1), y: num(2), r: num(3) };
      return { pose: P };
    }
    case "plant": { P.plant = rest[0] === "off" ? 0 : 1; return { pose: P }; }     // plant feet: keep the feet flat on the floor
    case "blade": {                                    // blade <arm role> <dir> [<pct>]: point the HELD WEAPON along a world direction
      const role = rest[0], dir = dirOf(rest[1]), pct = rest[2] != null ? Number(String(rest[2]).replace("%", "")) : 100;
      if (!body.weapon) { notes.push(`blade ${role}: this body holds no weapon (ignored)`); return { pose: P }; }
      P.blade[body.weapon.chain] = { dir, amt: pct / 100 };
      notes.push(`blade ${rest[1]} ${pct}% (weapon bone ${body.weapon.bone}, ${body.weapon.chain})`);
      return { pose: P };
    }
    case "aim": case "raise": {                       // aim <role> <dir> [<pct>]
      const role = rest[0], dir = dirOf(rest[1]), pct = rest[2] != null ? Number(String(rest[2]).replace("%", "")) : 100;
      const r = resolveRole(body, role);
      notes.push(`aim ${role} -> ${rest[1]} ${pct}% (${r.how})`);
      for (const chain of r.chains) {
        const key = chainIdOf(body, chain) ?? `b${chain[0]}`;
        P.aim[key] = { dir, amt: pct / 100 };
      }
      return { pose: P };
    }
    case "bend": {                                     // bend <role> <dir> <deg>
      const role = rest[0], toward = dirOf(rest[1]) ?? [0, 0, 1], deg = num(2);
      const r = resolveRole(body, role);
      notes.push(`bend ${role} toward ${rest[1]} ${deg}deg (${r.how})`);
      for (const chain of r.chains) {
        const key = chainIdOf(body, chain) ?? `b${chain[0]}`;
        P.bend[key] = { deg, toward };
      }
      return { pose: P };
    }
    case "crouch": {
      const f = num(0);
      P.shift = [P.shift[0], f, P.shift[2]];
      return { pose: P };
    }
    case "jump": { const f = num(0); P.shift = [P.shift[0], -Math.abs(f), P.shift[2]]; P.ground = 0; return { pose: P }; }
    case "flip": {
      const dir = rest[0] === "forward" ? -1 : 1, deg = num(1);
      P.flip = { axis: [1, 0, 0], deg: dir * deg };
      return { pose: P };
    }
    case "contact": {                                  // contact <role> <dir>: aim it just far enough to touch the floor
      const role = rest[0], dir = dirOf(rest[1] ?? "down-forward") ?? [0, 1, 0];
      const r = resolveRole(body, role);
      notes.push(`contact ${role} -> ${rest[1] ?? "down"} (${r.how})`);
      for (const chain of r.chains) {
        const key = chainIdOf(body, chain) ?? `b${chain[0]}`;
        P.aim[key] = { dir, amt: 0.5, contact: true };
      }
      return { pose: P };
    }
    case "ground": { P.ground = rest[0] === "off" ? 0 : 1; P.lift = rest[0] === "lift" ? 1 : 0; const ai = rest.indexOf("anchor"); const si = rest.indexOf("sink"); P.sink = si >= 0 ? +rest[si + 1] || 0 : 0; P.anchor = ai >= 0 ? rest.slice(ai + 1, si > ai ? si : undefined).map(Number).filter(Number.isFinite) : []; P.anchorW = P.anchor.length ? 1 : 0; return { pose: P }; }
    case "air": { P.ground = 0; return { pose: P }; }
    default:
      notes.push(`ignored clause "${words.join(" ")}"`);
      return { pose: P };
  }
}
function chainIdOf(body, chain) {
  for (const [k, c] of Object.entries(body.chains)) if (c && c.length === chain.length && c[0] === chain[0]) return k;
  return null;
}

// ── scene parsing ────────────────────────────────────────────────────────────────────────────
export function parseScene(text) {
  const scene = { body: null, slot: 11, facing: "auto", sprite: null, effect: null, phases: [], notes: [] };
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const w = line.split(/\s+/);
    if (w[0] === "body") { scene.body = w[1]; continue; }
    if (w[0] === "slot") { scene.slot = +w[1]; continue; }
    if (w[0] === "facing") { scene.facing = w[1]; continue; }
    if (w[0] === "spring") { (scene.springs ??= []).push({ role: w[1], period: Number(w[2]), zeta: Number(w[3] ?? 0.8) }); continue; }   // spring <role> <period in ticks> <damping 0..1+>: the part CHASES its target like a weighted spring (lag, overshoot, settle)
    if (w[0] === "contact-bones") { scene.contactBones = w.slice(1).map(Number); continue; }   // contact-bones <bone>...: which bones count as standing on the floor (the atlas set can include a dangling trunk tip)
    if (w[0] === "chain") { (scene.chains ??= {})[w[1]] = w.slice(2).map(Number); continue; }   // chain <name> <bone> <bone> ...: name a limb/part the atlas has no role for (an elephant trunk)
    if (w[0] === "arms" && w[1] === "sagittal") { scene.sagittal = true; continue; }
    if (w[0] === "sprite") { scene.sprite = +w[1]; continue; }
    if (w[0] === "effect" && w[2] !== "at") { scene.effect = +w[1]; continue; }   // "effect <id> at <site>" is a phase event (below)
    if (w[0] === "phase") {
      cur = { name: w[1], ticks: parseInt(String(w[2] ?? "20t").replace("t", ""), 10), clauses: [], events: [], ease: w[w.indexOf("ease") + 1] ?? null };   // `ease linear` = no slow-in/slow-out inside the phase (for a chain of short steps that should flow)
      scene.phases.push(cur);
      continue;
    }
    if (!cur) { scene.notes.push(`outside a phase: ${line}`); continue; }
    if (w[0] === "effect" && w[2] === "at") { cur.events.push({ kind: "effect", id: +w[1], site: w[3], after: parseAfter(w) }); continue; }
    if (w[0] === "release") {
      const at = w.indexOf("at");
      cur.events.push({ kind: "release", site: at >= 0 ? (w[at + 1] ?? "hands") : "hands", after: parseAfter(w), sprite: scene.sprite });
      continue;
    }
    if (w[0] === "hit") { cur.events.push({ kind: "hit", after: parseAfter(w) }); continue; }
    if (w[0] === "spark") { cur.events.push({ kind: "spark", id: +w[1], after: parseAfter(w) }); continue; }
    if (w[0] === "sound") { cur.events.push({ kind: "sound", id: +w[1], after: parseAfter(w) }); continue; }
    if (w[0] === "reaction") { cur.events.push({ kind: "reaction", after: parseAfter(w) }); continue; }
    if (w[0] === "wait") { continue; }
    // a pose clause: normalise role words ("both arms" -> "both-arms", "right hand" -> "right-hand")
    cur.clauses.push(normalise(w));
  }
  return scene;
}
function parseAfter(w) {
  const i = w.indexOf("after");
  if (i >= 0) return parseInt(String(w[i + 1]).replace("t", ""), 10);
  const pct = w.find((x) => x.endsWith("%"));
  if (pct) return { pct: parseFloat(pct) / 100 };
  return "end";
}
const ROLE2 = new Set(["arm", "arms", "leg", "legs", "wing", "wings", "hand", "tail", "head", "trunk", "spine", "body"]);
function normalise(w) {
  const out = [];
  for (let i = 0; i < w.length; i++) {
    const t = w[i].toLowerCase();
    const nxt = w[i + 1]?.toLowerCase();
    if (["both", "right", "left"].includes(t) && nxt && ROLE2.has(nxt)) {
      const side = t === "both" ? "both" : t;
      const role = nxt === "arms" ? "arms" : nxt === "legs" ? "legs" : nxt === "wings" ? "wings" : nxt === "hand" ? "arm" : nxt === "arm" ? "arm" : nxt;
      out.push(`${role}-${side}`.replace(/-(both)$/, "s"));
      i++;
      continue;
    }
    out.push(t);
  }
  return out;
}

// ── compile: scene → per-tick keys + events ──────────────────────────────────────────────────
export function compileScene(scene, { style = "a", offset = null } = {}) {
  D.setSagittal(!!scene.sagittal);
  const body = D.loadBody(scene.body, { facing: scene.facing });
  if (scene.chains) body.chains = { ...body.chains, ...scene.chains };
  if (scene.contactBones) body.contact = scene.contactBones;
  const notes = [...scene.notes];
  // 1. each phase = one absolute target pose
  let prev = D.blankPose(body);
  const plan = [];
  let tick = 0;
  for (const ph of scene.phases) {
    let pose = structuredClone(prev);
    pose.aim = {}; pose.bend = {}; pose.joint = {};     // per-phase absolutes (a limb not named returns to rest)
    pose.lean = { ...prev.lean }; pose.head = { ...prev.head };
    pose.turn = prev.turn; pose.flip = { ...prev.flip };
    for (const c of ph.clauses) { const r = applyClause(body, pose, c, notes); pose = r.pose; }
    // a `contact` clause: solve its aim amount so the chain TIP just touches the floor (feet stay planted)
    for (const [key, spec] of Object.entries(pose.aim)) {
      if (!spec.contact) continue;
      const chain = body.chains[key] ?? (key.startsWith("b") ? [Number(key.slice(1))] : null);
      if (!chain || chain.length < 2) continue;
      const tip = chain[chain.length - 1];
      let best = 0.05;
      for (let i = 1; i <= 50; i++) {
        const amt = i / 50;
        const p2 = structuredClone(pose); p2.aim[key] = { ...spec, amt, contact: false };
        const { P } = D.solvePose(body, p2);
        if (P[tip][1] <= body.floorY + 0.002 * body.H) best = amt; else break;
      }
      pose.aim[key] = { dir: spec.dir, amt: best };
      notes.push(`contact ${key}: aim ${(best * 100).toFixed(0)}% puts the tip on the floor`);
    }
    const events = ph.events.map((e) => ({ ...e, tick: tick + (e.after === "end" ? ph.ticks - 1 : typeof e.after === "object" ? Math.round(e.after.pct * (ph.ticks - 1)) : e.after) }));
    plan.push({ phase: ph.name, ticks: ph.ticks, from: prev, to: pose, start: tick, events, ease: ph.ease });
    tick += ph.ticks;
    prev = pose;
  }
  const ticks = tick;
  const off = offset ?? Math.max(body.model.total_frames | 0, 64) + 16;

  // physics layer: every `spring` role chases its phase target through a damped spring (semi-implicit Euler, 1 step = 1 tick).
  // omega = 2pi/period; underdamped (zeta < 1) overshoots and rings, zeta >= 1 only smooths. Opt-in per scene (no `spring` line = unchanged output).
  const springKeys = [];
  for (const sp of scene.springs || []) {
    const om = (2 * Math.PI) / Math.max(2, sp.period), c = 2 * sp.zeta * om;
    if (sp.role === "lean" || sp.role === "head" || sp.role === "joints") springKeys.push({ kind: sp.role, om, c });
    else for (const chain of resolveRole(body, sp.role).chains) { const key = chainIdOf(body, chain); if (key) springKeys.push({ kind: "chain", key, om, c }); }
  }
  const sst = new Map();                                   // state per scalar: x, v
  const chase = (id, target, om, c) => {
    let st = sst.get(id); if (!st) { st = { x: target, v: 0 }; sst.set(id, st); return target; }
    for (let k = 0; k < 8; k++) { st.v += (om * om * (target - st.x) - c * st.v) / 8; st.x += st.v / 8; }   // 8 sub-steps per tick: stable for fast springs too
    return st.x;
  };
  const applySprings = (pose) => {
    for (const sk of springKeys) {
      if (sk.kind === "joints") {                       // joints are quaternions: align the sign with the spring's state (short way), chase each component, normalise
        for (const [b, e] of Object.entries(pose.joint)) {
          let q = e.q; const st = sst.get(`j${b}.q0`);
          if (st && st.x * q[0] + (sst.get(`j${b}.q1`)?.x ?? 0) * q[1] + (sst.get(`j${b}.q2`)?.x ?? 0) * q[2] + (sst.get(`j${b}.q3`)?.x ?? 0) * q[3] < 0) q = q.map((v) => -v);
          const r = q.map((v, i) => chase(`j${b}.q${i}`, v, sk.om, sk.c)), n = Math.hypot(...r) || 1;
          pose.joint[b] = { q: r.map((v) => v / n) };
        }
      }
      else if (sk.kind === "lean" || sk.kind === "head") for (const k of ["p", "y", "r"]) pose[sk.kind][k] = chase(`${sk.kind}.${k}`, pose[sk.kind][k], sk.om, sk.c);
      else {
        const a = pose.aim[sk.key];
        if (a) { const d = [0, 1, 2].map((i) => chase(`${sk.key}.d${i}`, a.dir[i], sk.om, sk.c)); const m = Math.hypot(...d) || 1; pose.aim[sk.key] = { ...a, dir: d.map((x) => x / m), amt: chase(`${sk.key}.amt`, a.amt, sk.om, sk.c) }; }
        const bd = pose.bend[sk.key]; if (bd) pose.bend[sk.key] = { ...bd, deg: chase(`${sk.key}.bend`, bd.deg, sk.om, sk.c) };
        if (pose.knee && pose.knee[sk.key] != null) pose.knee[sk.key] = chase(`${sk.key}.knee`, pose.knee[sk.key], sk.om, sk.c);
      }
    }
  };
  // 2. solve every tick and collect the channels
  const keys2 = Array.from({ length: body.n }, () => []);
  const keys1 = Array.from({ length: body.n }, () => []);
  const prevCh2 = body.model.bones.map((b) => D.K.sample(b?.anim?.ch2, body.neutral));
  const err = { maxIk: 0 };
  const frames = [];
  for (const ph of plan) {
    for (let t = 0; t < ph.ticks; t++) {
      const u = ph.ticks <= 1 ? 1 : (t + 1) / ph.ticks;
      const pose = D.mixPose(ph.from, ph.to, ph.ease === "linear" ? u : ss(u), body);
      if (springKeys.length) applySprings(pose);
      const { W, P } = D.solvePose(body, pose);
      frames.push({ tick: ph.start + t, frame: off + ph.start + t, pose, W, P });
    }
  }
  for (const f of frames) {
    for (let i = 0; i < body.n; i++) {
      const p = body.par[i];
      const L = p >= 0 ? D.mul(D.tr(f.W[p]), f.W[i]) : f.W[i];
      const o2 = D.K.k16ToCh2(L, prevCh2[i]); prevCh2[i] = o2;
      let c1;
      // the exact inverse of the sampler (battle3d.js buildBoneWorldMatrices / k16Pose):
      //   P[i] = [Pp0 - o0, Pp1 + o1, Pp2 - o2],  o = W[p]·c1
      // so o = [Pp0-Pi0, Pi1-Pp1, Pp2-Pi2] and c1 = W[p]^T·o.  NOTE the Y term: generic-motion.js
      // writes (Pp1-Pi1) there, which does NOT round-trip (measured: 4717 units off on Meramon).
      if (p < 0) c1 = [-f.P[i][0], f.P[i][1], -f.P[i][2]];
      else c1 = D.mv(D.tr(f.W[p]), [f.P[p][0] - f.P[i][0], f.P[i][1] - f.P[p][1], f.P[p][2] - f.P[i][2]]);
      keys2[i].push([Math.round(o2[0]), Math.round(o2[1]), Math.round(o2[2]), f.frame]);
      keys1[i].push([Math.round(c1[0]), Math.round(c1[1]), Math.round(c1[2]), f.frame]);
    }
  }
  return { body, scene, plan, ticks, offset: off, keys1, keys2, frames, notes, style };
}

// ── write the clip into a copy of the pack ───────────────────────────────────────────────────
export function writePack(comp, { outDir, slot = 11 } = {}) {
  const { body, plan, ticks, offset } = comp;
  const model = structuredClone(body.model);
  const n = body.n;
  // channels: drop the 30000 sentinel, append one key per tick, re-terminate
  for (let i = 0; i < n; i++) {
    const anim = model.bones[i].anim || (model.bones[i].anim = {});
    for (const [k, keys] of [["ch2", comp.keys2[i]], ["ch1", comp.keys1[i]]]) {
      const own = (anim[k] || []).filter((r) => (r[3] | 0) !== 30000);
      const last = keys[keys.length - 1];
      anim[k] = [...own, ...keys, [last[0], last[1], last[2], 30000]];
    }
  }
  model.total_frames = offset + ticks + 4;
  // tables: style a = one table per phase, style b = one table for the whole clip
  const tables = [];
  const tl = model.timeline.slice();
  let nextTable = 62;
  while (tl[nextTable] && (tl[nextTable].table?.length ?? 0)) nextTable++;
  const emitTable = (firstTick, len) => {
    const entries = [];
    for (let t = 0; t < len; t++) entries.push({ value: offset + firstTick + t, loop_target: 0, aux: null });
    entries.push({ value: 0xffff, loop_target: 0, aux: null });
    const idx = nextTable++;
    tl[idx] = { table: entries };
    return idx;
  };
  if (comp.style === "b") tables.push({ idx: emitTable(0, ticks), start: 0, len: ticks });
  else for (const ph of plan) tables.push({ idx: emitTable(ph.start, ph.ticks), start: ph.start, len: ph.ticks, phase: ph.phase });
  model.timeline = tl;

  // the action script
  const ops = [];
  const pre = new Set();
  for (const ph of plan) for (const e of ph.events) if (e.kind === "effect" && e.id) pre.add(e.id);
  if (comp.scene.effect) pre.add(comp.scene.effect);
  for (const id of pre) ops.push({ op: 3, words: [1, id] });
  if (plan.some((ph) => ph.events.some((e) => e.kind === "release"))) ops.push({ op: 6, words: [1, comp.scene.sprite ?? 371] });
  ops.push({ op: 4, words: [1, 33] });
  let now = 0;
  const evOut = [];
  for (const ph of plan) {
    const t = tables.find((x) => x.start === ph.start);
    // a bind costs no time: without a done-wait the NEXT bind replaces this table at once and only the last
    // phase ever plays (K28 found this on the Meramon magic clip). Block until the previous table has frozen.
    if (t && ph !== plan[0]) { ops.push({ op: 2, words: [0, slot, 0] }); now = Math.max(now, ph.start); }
    if (t) { ops.push({ op: 2, words: [0, slot, t.idx] }); }
    const evs = [...ph.events].sort((a, b) => a.tick - b.tick);
    for (const e of evs) {
      const dt = e.tick - now;
      if (dt > 0) { ops.push({ op: 11, words: [dt] }); now += dt; }
      const site = siteOf(comp, e.site, e.tick);
      if (e.kind === "effect" && site) {
        // the disc's EFFECT spawn (op3) for a point p is words = [-x, +y, homeZ - z]; the PROJECTILE launch (op6) is
        // [-x, -y, z - homeZ] (the decoder negates y and z). Checked against Meramon's own clip 9 (K28): op3
        // [0,1013,0,-2816,2688] and op6 [0,371,0,2816,-2944] are the same chest-height point.
        ops.push({ op: 3, words: [0, e.id ?? comp.scene.effect ?? 9999,
          Math.round(-site.p[0]), Math.round(site.p[1]), Math.round(comp.body.homeZ - site.p[2])] });
      } else if (e.kind === "release") {
        const sprite = e.sprite ?? comp.scene.sprite ?? 371;
        const yaw = comp.body.side === "enemy" ? 0 : 2048;
        ops.push({ op: 6, words: [0, sprite, Math.round(-site.p[0]), Math.round(-site.p[1]), Math.round(site.p[2] - comp.body.homeZ), 0, yaw, 0] });
      } else if (e.kind === "hit") {
        ops.push({ op: 10, words: [99, 0] });
        ops.push({ op: 3, words: [0, 2, 0, -Math.round(0.25 * comp.body.H), Math.round(-comp.body.homeZ)] });
        ops.push({ op: 1, words: [0] });
      } else if (e.kind === "spark") {
        ops.push({ op: 10, words: [e.id ?? 11, 0] });
      } else if (e.kind === "sound") {
        ops.push({ op: 4, words: [0, e.id ?? 33] });
      } else if (e.kind === "reaction") {
        ops.push({ op: 1, words: [0] });
      }
      evOut.push({ ...e, tick: e.tick, site });
    }
  }
  const tail = ticks - now;
  if (tail > 0) ops.push({ op: 11, words: [tail] });
  ops.push({ op: 2, words: [0, 0, 1] });
  ops.push({ op: 4, words: [0, 0, 15, 15] });
  ops.push({ op: 255, words: [] });
  model.actions = model.actions.slice();
  model.actions[slot] = { ops, synthesized: true, camAuthored: "own", buildKind: "motion-language", overrun: 0 };
  model.clips = model.clips.map((c, i) => (i === slot
    ? { ...c, present: true, start_frame: offset, end_frame: offset + ticks, loop_count: 0 }
    : c));

  if (outDir) {
    fs.mkdirSync(path.join(outDir, comp.body.folder), { recursive: true });
    fs.writeFileSync(path.join(outDir, comp.body.folder, "anim.json"), JSON.stringify(model));
  }
  return { model, ops, tables, events: evOut, clip: { ticks, offset, slot } };
}

// a site = a point in the model's own frame, taken from the POSED bone at that tick
export function siteOf(comp, site, tick) {
  const b = comp.body;
  if (!site) return null;
  const f = comp.frames.find((x) => x.tick === tick) ?? comp.frames[comp.frames.length - 1];
  const P = (i) => f.P[i];
  const mid = (a, c) => scl(add(P(a), P(c)), 0.5);
  const handL = b.sites?.hands?.left?.bone, handR = b.sites?.hands?.right?.bone;
  const head = b.sites?.head?.bone, mouth = b.sites?.mouth?.bone;
  const tail = b.chains.tail;
  switch (site) {
    case "hands": case "both-hands":
      if (handL != null && handR != null) return { p: mid(handL, handR), bone: handR, what: "midpoint of both hands" };
      if (handR != null) return { p: P(handR), bone: handR, what: "right hand" };
      break;
    case "weapon-tip": case "sword-tip": case "blade-tip":
      if (b.weapon) { const T = D.mv(D.FLIP, D.mv(f.W[b.weapon.bone], b.weapon.tip)); return { p: add(P(b.weapon.bone), T), bone: b.weapon.bone, what: "tip of the held weapon" }; }
      break;
    case "right-hand": if (handR != null) return { p: P(handR), bone: handR, what: "right hand" }; break;
    case "left-hand": if (handL != null) return { p: P(handL), bone: handL, what: "left hand" }; break;
    case "mouth": if (mouth != null) return { p: P(mouth), bone: mouth, what: "mouth (head bone)" }; break;
    case "head": if (head != null) return { p: P(head), bone: head, what: "head" }; break;
    case "chest": { const t = b.chains.trunk?.[0] ?? 0; return { p: P(t), bone: t, what: "chest" }; }
    case "tail": case "tail-tip": if (tail?.length) { const t = tail[tail.length - 1]; return { p: P(t), bone: t, what: "tail tip" }; } break;
    case "overhead": if (head != null) return { p: add(P(head), [0, -0.35 * b.H, 0]), bone: head, what: "above the head" }; break;
    case "sky": if (head != null) return { p: add(P(head), [0, -1.2 * b.H, 0.2 * b.H]), bone: head, what: "sky above" }; break;
    case "ground": return { p: [0, b.floorY, 0.5 * b.H], bone: null, what: "floor in front" };
    default: { const c = b.chains[String(site).replace(/-tip$/, "")]; if (Array.isArray(c) && c.length) { const t = c[c.length - 1]; return { p: P(t), bone: t, what: `tip of chain "${site}"` }; } }
  }
  // fallback: the end of the primary arm chain, else the head, else the root
  const arm = b.chains.armR ?? b.chains.armL;
  if (arm?.length) return { p: P(arm[arm.length - 1]), bone: arm[arm.length - 1], what: `fallback for "${site}": the arm tip` };
  if (head != null) return { p: P(head), bone: head, what: `fallback for "${site}": the head` };
  return { p: P(0), bone: 0, what: `fallback for "${site}": the root` };
}

// ── verify: replay the written pack the way the game's sampler reads it ─────────────────────
/** Simulate the action script: returns the tick-to-frame map and the events the game would fire. */
export function replayScript(model, slot) {
  const script = model.actions?.[slot]?.ops ?? [];
  const out = { ticks: 0, events: [], tables: [] };
  let tick = 0;
  for (const o of script) {
    if (o.op === 11) { tick += o.words[0] | 0; continue; }
    if (o.op === 2) {
      const [mode, s, t] = o.words;
      if (mode === 0 && s === slot && t > 1) out.tables.push({ table: t, at: tick, len: (model.timeline[t]?.table ?? []).filter((e) => (e.value | 0) !== 0xffff).length });
      continue;
    }
    if (o.op === 0 || o.op === 255) break;
    out.events.push({ op: o.op, words: o.words, tick });
  }
  out.ticks = tick;
  return out;
}

/** Sample the written pack at a tick (via the channel data, i.e. exactly what the renderer does). */
export function poseAtTick(model, frame) {
  const rest = D.K.k16Pose(model, frame);
  return rest;
}
