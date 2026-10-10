// Full fight-animation census: every model × every scripted clip, driven through the REAL
// ActorAnimator/ActionVM (the modules battle3d ships). Per clip it checks:
//   - the action VM terminates within the tick budget (no stuck script)
//   - every op2 mode-0 bind resolved to a NON-EMPTY timeline table (no frozen sub-motion)
//   - no forward hard-snap while a table plays (the snap audit generalized: a forward frame
//     jump > SNAP_GAP inside one bound table = a dropped pose)
//   - every op3 effect type it spawns exists in the extracted effect registry
// Output: JSON census (per-model clip results) to stdout or --out. `--baseline` compares
// against tools/fight_anim_census.baseline.json and exits 1 on NEW failures (regression pin).
import fs from "fs";
import path from "path";
import url from "url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..", "web");
const { ActorAnimator } = await import(url.pathToFileURL(path.join(WEB, "fight/actor-animator.js")));

const MODELS_DIR = path.join(WEB, "assets/battle/models");
const manifest = JSON.parse(fs.readFileSync(path.join(WEB, "assets/battle/effects/manifest.json"), "utf8"));
const KNOWN_TYPES = new Set(Object.keys(manifest.types).map(Number));

const TICK_BUDGET = 4000;      // ticks @speed 1 (66s) — generous; stuck scripts blow way past
const SNAP_GAP = 24;           // forward frame jump inside one continuous run = dropped pose

const args = process.argv.slice(2);
const opt = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}`));
  return a ? (a.includes("=") ? a.split("=")[1] : true) : null;
};

const folders = fs.readdirSync(MODELS_DIR)
  .filter((f) => fs.existsSync(path.join(MODELS_DIR, f, "anim.json")))
  .sort();

const census = {};
let clipsRun = 0, failures = 0;

for (const folder of folders) {
  const model = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, folder, "anim.json"), "utf8"));
  const res = {};
  for (let clip = 0; clip < (model.actions?.length ?? 0); clip++) {
    const script = model.actions[clip];
    if (!script || !Array.isArray(script.ops) || !script.ops.length) continue;
    // skip pure-terminator scripts (nothing to play)
    if (script.ops.every((o) => o.op === 0 || o.op === 255)) continue;
    clipsRun++;

    const anim = new ActorAnimator(model);
    const emptyBinds = [];
    const badEffects = [];
    // instrument the table resolver: record op2 binds to empty tables
    const origResolver = anim._playerForTable.bind(anim);
    anim._playerForTable = (i) => {
      const t = model.timeline?.[i]?.table;
      if (i > 0 && (!t || !t.length)) emptyBinds.push(i);
      return origResolver(i);
    };
    anim.setAction(clip, {
      onEffect: (e) => { if (!KNOWN_TYPES.has(e.type)) badEffects.push(e.type); },
    }, { currentEffect: 2 });   // basic-attack effect as the 9999 stand-in (always registered)

    let ticks = 0, snaps = 0, prev = null, prevPlayer = null, prevBlend = null;
    while (anim.vm && !anim.vm.ended && ticks < TICK_BUDGET) {
      anim.tick(1);
      ticks++;
      const f = anim.frame;
      // snap audit: only inside one continuously-bound player (rebinds/loop-backs are authored),
      // and only when NO pose blend covers the transition — a frame jump bracketed by a blend
      // segment (value&0x8000 records) is an authored eased transition, not a dropped pose.
      if (prev != null && anim.vm && anim.vm.player === prevPlayer && !anim.blend && !prevBlend) {
        const d = f - prev;
        if (d > SNAP_GAP) snaps++;
      }
      prevPlayer = anim.vm ? anim.vm.player : null;
      prevBlend = anim.blend;
      prev = f;
    }
    const terminated = !anim.vm || anim.vm.ended;
    const problems = [];
    if (!terminated) problems.push(`stuck(${ticks})`);
    if (emptyBinds.length) problems.push(`emptyTables[${[...new Set(emptyBinds)]}]`);
    if (snaps) problems.push(`snaps(${snaps})`);
    if (badEffects.length) problems.push(`unknownFx[${[...new Set(badEffects)]}]`);
    if (problems.length) {
      failures++;
      res[clip] = problems.join(" ");
    }
  }
  if (Object.keys(res).length) census[folder] = res;
}

const summary = {
  models: folders.length,
  clipsRun,
  failingClips: failures,
  failures: census,
};

if (opt("baseline")) {
  const basePath = path.join(HERE, "fight_anim_census.baseline.json");
  if (!fs.existsSync(basePath)) {
    fs.writeFileSync(basePath, JSON.stringify(summary, null, 1));
    console.log(`baseline written: ${basePath} (${failures} known failing clips)`);
  } else {
    const base = JSON.parse(fs.readFileSync(basePath, "utf8"));
    const newFails = [];
    for (const [m, clips] of Object.entries(census)) {
      for (const c of Object.keys(clips)) {
        if (!base.failures?.[m]?.[c]) newFails.push(`${m} clip ${c}: ${clips[c]}`);
      }
    }
    if (newFails.length) {
      console.error(`NEW failures vs baseline:\n  ${newFails.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`census OK: ${folders.length} models, ${clipsRun} clips, ` +
      `${failures} failing (all known in baseline)`);
  }
} else {
  const out = opt("out");
  const text = JSON.stringify(summary, null, 1);
  if (out && out !== true) fs.writeFileSync(out, text);
  else console.log(text);
}
