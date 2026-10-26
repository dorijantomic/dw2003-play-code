// A16 step 1: THE DISC'S OWN RULE — the tick gap between an authored op6 launch and the op10 99 strike,
// measured over every authored clip-9/13/11 script, against the projectile pack's own timing.
//
// Emits JSON rows to /home/dorij/scratch-research/a16-disc-rule.json plus a table on stdout.
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const { ActionVM } = await import(path.join(REPO, "web/fight/action-vm.js"));
const { TimelinePlayer } = await import(path.join(REPO, "web/fight/timeline-player.js"));
const PL = await import(path.join(REPO, "web/fight/proj-layers.js"));

const man = readJson(path.join(REPO, "web/assets/battle/effects/manifest.json"));
const packCache = new Map();
function pack(id) {
  const k = id | 0;
  if (!packCache.has(k)) {
    const p = path.join(REPO, "web/assets/battle/effects/proj", `${k}.json`);
    packCache.set(k, fs.existsSync(p) ? readJson(p) : null);
  }
  return packCache.get(k);
}

/** The flight's local travel: root-layer translation sampled at the clip frame for tick t (proj-layers). */
function localTravel(pk, t) {
  if (!pk?.layers?.length) return null;
  const frame = PL.clipFrameAt(pk.clip, t);
  const root = PL.mat4Identity();
  const { world, shown } = PL.projLayerWorlds(pk.layers, frame, root);
  // the largest visible layer (the body of the effect), same choice C12 makes
  let best = null;
  for (let i = 0; i < pk.layers.length; i++) {
    if (!shown[i + 1]) continue;
    const w = world[i + 1];
    if (!w) continue;
    const p = [w[12], w[13], w[14]];
    if (!best) best = p;
  }
  return best;
}

/** Per-pack timing, read off its own tracks: when it starts moving, when it has arrived. */
function packTiming(id) {
  const pk = pack(id);
  if (!pk) return null;
  const ticks = man.projectiles?.[String(id)]?.ticks ?? 0;
  const p0 = localTravel(pk, 0);
  let start = null, end = null, maxD = 0;
  const series = [];
  for (let t = 0; t < ticks; t++) {
    const p = localTravel(pk, t);
    if (!p || !p0) continue;
    const d = Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]);
    series.push([t, Math.round(d)]);
    if (d > 1 && start == null) start = t;
    if (d > maxD) maxD = d;
  }
  for (let i = 0; i < series.length; i++) {
    if (series[i][1] >= maxD - 1) { end = series[i][0]; break; }
  }
  return { id, ticks, park: start ?? ticks, travel: start != null && end != null ? end - start : 0, arrive: end, maxD: Math.round(maxD), series };
}

const index = readJson(path.join(MODELS, "index.json"));
const rows = [];
const packInfo = new Map();
const isLaunch = (o) => o.op === 6 && (o.words?.[0] | 0) === 0;
const isStrike = (o) => o.op === 10 && (o.words?.[0] | 0) === 99;

for (const folder of index) {
  let anim;
  try { anim = readJson(path.join(MODELS, folder, "anim.json")); } catch { continue; }
  for (const clip of [9, 13, 11]) {
    const script = anim.actions?.[String(clip)];
    const ops = script?.ops;
    if (!Array.isArray(ops) || !ops.length) continue;
    const launches = ops.filter(isLaunch);
    if (!launches.length) continue;
    // play it through the real VM: tick of each op6 (sub 0) and the op10 99
    const seen = [];
    let tick = 0;
    const vm = new ActionVM(script, {
      timelineForTable: (i) => {
        const t = anim.timeline?.[i]?.table;
        return t && t.length ? new TimelinePlayer(t) : null;
      },
      hooks: {
        setLunge: (l) => { if (l?.sub === 0 && l.from) seen.push({ tick, kind: "op6", id: l.id, from: l.from, to: l.to, words: l.words?.slice?.() }); },
        onHit: (r) => { if ((r.type | 0) === 99) seen.push({ tick, kind: "99" }); },
      },
    });
    while (!vm.ended && tick < 900) { vm.step(1); tick++; }
    const first = seen.find((s) => s.kind === "op6");
    const strike = seen.find((s) => s.kind === "99");
    const allShots = seen.filter((s) => s.kind === "op6");
    const timing = first ? packTiming(first.id) : null;
    if (timing && !packInfo.has(first.id)) packInfo.set(first.id, timing);
    rows.push({
      model: folder, clip, ops: ops.length, shots: allShots.length,
      launchTick: first?.tick ?? null, strikeTick: strike?.tick ?? null,
      gap: first && strike ? strike.tick - first.tick : null,
      id: first?.id ?? null,
      words: first?.words ?? null,
      pack: timing ? { ticks: timing.ticks, park: timing.park, travel: timing.travel, arrive: timing.arrive } : null,
      vmEnd: tick,
    });
  }
}

const out = { rows, packs: [...packInfo.values()].map(({ series, ...r }) => r) };
fs.writeFileSync("/home/dorij/scratch-research/a16-disc-rule.json", JSON.stringify(out, null, 1));
console.log("rows", rows.length, "with strike", rows.filter((r) => r.strikeTick != null).length);
console.log("model clip shots launch strike gap id | packTicks park travel arrive");
for (const r of rows) {
  const p = r.pack || {};
  console.log([r.model, r.clip, r.shots, r.launchTick, r.strikeTick, r.gap, r.id, p.ticks, p.park, p.travel, p.arrive].join(" "));
}
