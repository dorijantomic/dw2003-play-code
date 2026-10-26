// run.mjs — compile a scene, write the clip into a copy of the pack, verify it, and export frames.
// In the repo since 2026-10-26 (from the private research prototype): paths come from ./paths.mjs, the logic is unchanged.
//   node run.mjs scenes/spirit-bomb.motion [out/<demo>] [--frames=0,18,30,48,60,74,82,90] [--style=a] [--slot=11]
import fs from "node:fs";
import path from "node:path";
import * as C from "./compile.mjs";
import * as D from "./dwr.mjs";

const args = process.argv.slice(2);
const scenePath = args[0];
const outDir = args[1] && !args[1].startsWith("--") ? args[1] : path.join("out", path.basename(scenePath).replace(/\.motion$/, ""));
const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));

const scene = C.parseScene(fs.readFileSync(scenePath, "utf8"));
if (opt.body) scene.body = String(opt.body);
// (the research prototype's authoring gate is not part of the installer build: the clips here are converted, not authored)
const style = opt.style ?? "a";
const slot = +(opt.slot ?? scene.slot ?? 11);
const comp = C.compileScene(scene, { style });
const written = C.writePack(comp, { outDir, slot });

// ── verify ───────────────────────────────────────────────────────────────────────────────────
const modelPath = path.join(outDir, comp.body.folder, "anim.json");
const model = JSON.parse(fs.readFileSync(modelPath, "utf8"));
const rep = { scene: path.basename(scenePath), body: comp.body.folder, name: comp.body.a.name, plan: comp.body.plan,
  facing: comp.body.az, side: comp.body.side, H: Math.round(comp.body.H), bones: comp.body.n,
  ticks: comp.ticks, offset: comp.offset, slot, style, tables: written.tables.map((t) => ({ table: t.idx, start: t.start, len: t.len, phase: t.phase })),
  notes: comp.notes };

// 1. channel round-trip: sample the WRITTEN pack and compare against the intended pose per tick
let maxPos = 0, maxRot = 0, worstTick = -1;
for (const f of comp.frames) {
  const got = D.K.k16Pose(model, f.frame);
  for (let i = 0; i < comp.body.n; i++) {
    const d = Math.hypot(got.P[i][0] - f.P[i][0], got.P[i][1] - f.P[i][1], got.P[i][2] - f.P[i][2]);
    if (d > maxPos) { maxPos = d; worstTick = f.tick; }
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) maxRot = Math.max(maxRot, Math.abs(got.W[i][k][j] - f.W[i][k][j]));
  }
}
rep.roundTrip = { maxPosUnits: +maxPos.toFixed(2), maxRotElem: +maxRot.toFixed(4), worstTick };
// 2. feet: the lowest vertex on every grounded tick, in body heights from the rest floor
let footErr = 0, air = [], deepest = 0;
for (const f of comp.frames) {
  const low = D.lowestY(comp.body, f.W, f.P, { only: comp.body.contact });
  const e = (low - comp.body.floorY) / comp.body.H;
  if (f.pose.ground > 0.999) footErr = Math.max(footErr, Math.abs(e));
  else if (f.pose.ground < 0.5) air.push(f.tick);
  const all = D.lowestY(comp.body, f.W, f.P);
  deepest = Math.max(deepest, (all - comp.body.floorY) / comp.body.H);
}
rep.feet = { maxPlantedErrorH: +footErr.toFixed(4), airborneTicks: air.length,
  deepestBelowFloorH: +deepest.toFixed(3) };   // >0 = some part is below the floor (a tail slam self-check)
// 3. the script the game would run
const sim = C.replayScript(model, slot);
rep.script = { ticks: sim.ticks, ops: written.ops.length,
  events: sim.events.map((e) => ({ op: e.op, words: e.words, tick: e.tick, pct: +(100 * e.tick / Math.max(1, sim.ticks)).toFixed(0) })) };
rep.release = written.events.filter((e) => e.kind === "release" || e.kind === "effect" || e.kind === "hit")
  .map((e) => ({ kind: e.kind, tick: e.tick, pct: +(100 * e.tick / Math.max(1, comp.ticks)).toFixed(0), site: e.site?.what,
    at: e.site?.p?.map(Math.round), bone: e.site?.bone }));
// 4. is the emitter where the words "forward from the hands" say it should be?
const rel = written.events.find((e) => e.kind === "release");
if (rel) {
  const f = comp.frames.find((x) => x.tick === rel.tick);
  const handR = comp.body.sites?.hands?.right?.bone, head = comp.body.sites?.head?.bone;
  // report in the FACING frame: +z = the way the model looks, so a "throw forward" must read positive
  const toFacing = (p) => D.mv(D.rot([0, 1, 0], -comp.body.az * D.DEG), p);
  const trunk = comp.body.chains.trunk?.[0] ?? 0;
  const q = handR != null ? toFacing(D.sub(f.P[handR], f.P[trunk])) : null;
  const reach = handR != null ? Math.hypot(...[0, 1, 2].map((k) => f.P[handR][k] - f.P[trunk][k])) / comp.body.H : null;
  rep.aim = {
    handForwardOfChest_over_H: q ? +(q[2] / comp.body.H).toFixed(3) : null,
    handAboveFloor_over_H: handR != null ? +((comp.body.floorY - f.P[handR][1]) / comp.body.H).toFixed(3) : null,
    handFromChest_over_H: reach != null ? +reach.toFixed(3) : null,
    headAboveFloor_over_H: head != null ? +((comp.body.floorY - f.P[head][1]) / comp.body.H).toFixed(3) : null,
  };
}

// 5. TOWARD THE OPPONENT (facing law: +Z of the pose frame = toward the enemy for every model, both sides).
// At every hit/release tick, the bone that moved furthest from the rest pose must not move backward (-Z) more
// than sideways or forward. Pure numbers from the written frames; no picture.
rep.toward = [];
for (const e of written.events.filter((x) => x.kind === "release" || x.kind === "hit")) {
  const f = comp.frames.find((x) => x.tick === e.tick); if (!f) continue;
  let best = -1, bd = 0;
  for (let i = 0; i < comp.body.n; i++) { const d = Math.hypot(f.P[i][0] - comp.body.rest.P[i][0], f.P[i][2] - comp.body.rest.P[i][2]); if (d > bd) { bd = d; best = i; } }
  if (best < 0) continue;
  const dx = (f.P[best][0] - comp.body.rest.P[best][0]) / comp.body.H, dz = (f.P[best][2] - comp.body.rest.P[best][2]) / comp.body.H;
  const verdict = bd / comp.body.H < 0.03 ? "still" : dz >= -Math.abs(dx) ? "ok" : "BACKWARD";
  rep.toward.push({ kind: e.kind, tick: e.tick, bone: best, dx_over_H: +dx.toFixed(3), dz_over_H: +dz.toFixed(3), verdict });
  if (verdict === "BACKWARD") console.error(`WARNING: at ${e.kind} tick ${e.tick} bone ${best} moves AWAY from the opponent (dz ${dz.toFixed(3)} H). Forward is +Z for every model.`);
}
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(rep, null, 1));
console.log(JSON.stringify(rep, null, 1));
