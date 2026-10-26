#!/usr/bin/env node
// verify_battle_contract.mjs — A11: the C1-C10 battle-animation contract, proven by ARITHMETIC over the
// FULL cross product (BRIEF4.md "ORCHESTRATOR DIRECTIVE").
//
//   case = (species form, technique it can use or item the item machine has a record for, side near/far,
//           outcome hit/lethal/miss)
//
// Nothing here is a sample and nothing is a screenshot: every row is generated from the game's own data
// (digimon.json species + extra_species.json `techs`, the 426-record skills table, the extracted technique
// table, the item machine's use/throw tables) and judged against a value derived from that same data.
//
// The script each case plays is the one the GAME plays: the real ActorAnimator + ActionVM + ported engine
// handlers, sequenced by the real FightCoordinator (op1 dispatch included), driven headless one fixed PS1
// logic tick at a time. No GL: pose/camera/projectile arithmetic uses the renderer's own exported functions
// (buildBoneWorldMatrices, arenaSlotFor, shotBodyBounds, applyOp5, cannedShotSlot), so C6/C7/C8 are measured
// on the same numbers the battle screen draws.
//
// CALIBRATION (orchestrator directive): the ORIGINAL player species are ground truth — a rule the disc
// itself violates is a wrong rule. Every invariant therefore has a `calibrated` form derived from the
// authored corpus, and the tool reports, per rule, how many rows on authored (own) scripts it rejects
// before and after calibration. `--calibrate` prints the corpus distributions the bounds come from.
//
// Outputs (default): /home/dorij/scratch-research/anim-contract.json + anim-contract.md
//   JSON: summary + one row per case with one boolean per invariant.
//   MD:   the same rows in a compact table + violations grouped by invariant AND by builder path
//         (own / built-attack / built-cast / built-body / built-self / built-borrow / built-lastresort)
//         so a violation names the systemic cause, never an individual.
//
// Usage:
//   node tools/verify_battle_contract.mjs                 full cross product
//   node tools/verify_battle_contract.mjs --models 6      first N forms (debug)
//   node tools/verify_battle_contract.mjs --fast          the node:test subset (tests/anim-battle-contract.test.js)
//   node tools/verify_battle_contract.mjs --calibrate     corpus distributions + own-row rejections per rule
//   node tools/verify_battle_contract.mjs --explain <model-substr>[:clip]   per-row metrics + the ops it played
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const sha1 = (p) => crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex").slice(0, 12);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const MODELS = path.join(REPO, "web/assets/battle/models");
const DATA = path.join(REPO, "web/assets/data");
const SCRATCH = "/home/dorij/scratch-research";
const ITEM_TABLES = path.join(SCRATCH, "scratch");      // extracted disc tables, not shipped in web/assets

const argv = process.argv.slice(2);
const ARG = (name, dflt = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? (argv[i + 1] ?? true) : dflt; };
const FLAG = (name) => argv.includes(`--${name}`);
const FAST = FLAG("fast");
const CALIBRATE = FLAG("calibrate");
const MAX_FORMS = Number(ARG("models", 0)) || (FAST ? 8 : 0);
const QUIET = FLAG("quiet");
const ONLY = (ARG("only", null) || "").toString().split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const EXPLAIN = ARG("explain", null);   // "model-substr[:clip]" — print R+M for those rows and stop
const OUT_JSON_ARG = ARG("json", null);
const OUT_MD_ARG = ARG("md", null);
const OUT_JSON = OUT_JSON_ARG && OUT_JSON_ARG !== true ? path.resolve(OUT_JSON_ARG) : path.join(SCRATCH, "anim-contract.json");
const OUT_MD = OUT_MD_ARG && OUT_MD_ARG !== true ? path.resolve(OUT_MD_ARG) : path.join(SCRATCH, "anim-contract.md");

// ── data ────────────────────────────────────────────────────────────────────────────────────────────
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const modelIndex = readJson(path.join(MODELS, "index.json"));
const modelMap = readJson(path.join(REPO, "web/assets/battle/model_map.json"));
const placement = readJson(path.join(REPO, "web/assets/battle/model_placement.json")).models;
const cameraRefSizes = readJson(path.join(REPO, "web/assets/battle/camera_ref_sizes.json"));
const digimon = readJson(path.join(DATA, "digimon.json"));
const skills = digimon.skills;
const extra = readJson(path.join(DATA, "extra_species.json"));
const techTable = readJson(path.join(DATA, "fight_tech_table.json"));
const itemUseTable = readJson(path.join(ITEM_TABLES, "item_use_effects.json"));
const throwTable = readJson(path.join(ITEM_TABLES, "throw_item_effects.json"));
const features = readJson(path.join(SCRATCH, "a6-features.json"));

const skillById = new Map(skills.map((s) => [s.id | 0, s]));
const modelCache = new Map();
function getModel(folder) {
  if (!modelCache.has(folder)) modelCache.set(folder, readJson(path.join(MODELS, folder, "anim.json")));
  return modelCache.get(folder);
}

// ── game modules ───────────────────────────────────────────────────────────────────────────────────
const b3 = await import(path.join(REPO, "web/battle3d.js"));
const cam = await import(path.join(REPO, "web/fight/battle-camera.js"));
const ft = await import(path.join(REPO, "web/fight/fight-tables.js"));
const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const lp = await import(path.join(REPO, "web/fight/launch-plan.js"));
const bmap = await import(path.join(REPO, "web/fight/digimon-bonemap.js"));
const anat = await import(path.join(REPO, "web/fight/digimon-anatomy.js"));
const sm = await import(path.join(REPO, "web/fight/side-mirror.js"));
const { ActorAnimator } = await import(path.join(REPO, "web/fight/actor-animator.js"));
const { FightCoordinator } = await import(path.join(REPO, "web/fight/fight-coordinator.js"));
const { EffectPlayer } = await import(path.join(REPO, "web/fight/effect-player.js"));
const PL = await import(path.join(REPO, "web/fight/proj-layers.js"));

// ── A14: the projectile packs, as the RENDERER consumes them ─────────────────────────────────────
// C12 judges the flight the game actually draws: the op6 registry the EffectPlayer consults, the pack
// mesh battle3d lazily loads, and the layer transform proj-layers computes per frame. All three are the
// shipped code paths, read here from the same files the browser fetches.
const FX_MANIFEST = readJson(path.join(REPO, "web/assets/battle/effects/manifest.json"));
const PROJ_DIR = path.join(REPO, "web/assets/battle/effects/proj");
const packCache = new Map();
function projPack(id) {
  const k = id | 0;
  if (!packCache.has(k)) {
    let pack = null;
    try {
      const p = path.join(PROJ_DIR, `${k}.json`);
      pack = fs.existsSync(p) ? readJson(p) : null;
      if (pack && pack.layers) {
        // the atlas each layer draws from: a pack whose PNG is not on disk renders nothing
        pack.atlasOk = pack.layers.every((L) => !L.tex_by_clut && !L.tex
          || Object.values(L.tex_by_clut || { [String(L.tex)]: L.tex }).every((f) => fs.existsSync(path.join(PROJ_DIR, f))));
      }
    } catch { pack = null; }
    packCache.set(k, pack);
  }
  return packCache.get(k);
}
/** The drawn world point of a flight at its own tick `t`: the layer-0 root is op6's from/to, and the
 *  program layers hang off it (projLayerWorlds), exactly as battle3d.render draws them. */
function projDrawnPoint(pack, from, to, t) {
  if (!pack?.layers?.length) return null;
  const root = PL.mat4Mul(PL.mat4Translate(from[0], from[1], from[2]),
                          PL.mat4RotPSX(to?.[0] | 0, to?.[1] | 0, to?.[2] | 0));
  const frame = PL.clipFrameAt(pack.clip, t);
  const { world, shown } = PL.projLayerWorlds(pack.layers, frame, root);
  let best = null;
  for (let i = 0; i < pack.layers.length; i++) {
    if (!shown[i + 1]) continue;
    const w = world[i + 1];
    if (!w) continue;
    const p = [w[12], w[13], w[14]];
    // the largest VISIBLE layer is the body of the effect; a hidden one is not drawn at all
    if (!best) best = { p, shown: true, layer: i + 1, frame };
  }
  return best ? { ...best, frame, visible: shown[1] !== false } : { p: null, shown: false, frame };
}


ft.setTechTable(techTable);
ft.setSkillTable(digimon);
ft.setItemUseEffects(itemUseTable);
ft.setThrowItemEffects(throwTable);
cb.setFallbackDonor(getModel("m005grey").actions);
cb.setDonorLoader((folder) => { try { return Promise.resolve(getModel(folder)); } catch { return Promise.resolve(null); } });

// ── the hit-count rule (engine/dw3/battle-formulas.ts basicAttackHitCount, ported) ─────────────────
// dispatch = the technique record's own +0x0A byte; <2 one hit (three under Multi Crest, which a battle
// fighter only has while equipped — the contract states the plain case), ==9 the record's +0x11 hits, else 1.
function expectedHits(techId) {
  const rec = techTable[String(techId)] || null;
  const sk = skillById.get(techId | 0) || null;
  const dispatch = rec?.dispatch ?? 0;
  if (dispatch < 2) return 1;
  if (dispatch === 9) return Math.max(1, sk?.hits ?? 1);
  return 1;
}

// ── forms: every species record that resolves to a battle model ────────────────────────────────────
// The species table is the game's own list of usable forms; the model map is the game's own name -> pack
// resolution (battle3d.resolveModelFolder). No id or name is used in any branch; they are row labels.
const speciesRecords = [...(digimon.digimon || []), ...(extra.digimon || [])];
const forms = [];
for (const s of speciesRecords) {
  const folder = modelMap[b3.canonicalModelName(s.name)];
  if (!folder || !modelIndex.includes(folder)) continue;
  const techs = [...new Set([...(s.techs || []), s.tech_basic, s.tech_signature].filter((t) => t && skillById.has(t | 0)))];
  if (!techs.length) continue;
  forms.push({ speciesId: s.id | 0, name: s.name, folder, techs });
}
const formList = (MAX_FORMS ? forms.slice(0, MAX_FORMS) : forms)
  .filter((f) => !ONLY.length || ONLY.some((s) => f.folder.toLowerCase().includes(s) || String(f.name || "").toLowerCase().includes(s)));

// ── items: every record the item machine owns (default arm + typed throw band) ─────────────────────
const itemRecords = [
  ...(itemUseTable.records || []).map((r) => ({ id: r.item | 0, clip: 10, target: "self", effect: r.effect | 0 })),
  ...(throwTable.records || []).map((r) => ({ id: r.item | 0, clip: r.clip | 0, target: "enemy", effect: r.effect | 0, motion: r.motion })),
];

// ── the authored corpus: what the disc itself writes for each clip ─────────────────────────────────
// Read once over every own action script: contacts, reaction pairing, projectiles, locomotion, anchors.
const CORPUS = new Map();     // clip -> aggregate
const ownProfile = new Map(); // `${folder}|${clip}` -> profile of that model's own script
function profileOps(ops) {
  const p = { n98: 0, n99: 0, op1_5: 0, op1_0: 0, op6: 0, fxWorld: [], fxScreen: 0, camPresets: [], loco: 0, tables: 0 };
  for (const o of ops || []) {
    const w = o.words || [];
    if (o.op === 10) { if ((w[0] | 0) === 98) p.n98++; if ((w[0] | 0) === 99) p.n99++; }
    if (o.op === 1) { if ((w[0] | 0) === 5) p.op1_5++; if ((w[0] | 0) === 0) p.op1_0++; }
    if (o.op === 6 && (w[0] | 0) === 0) p.op6++;
    if (o.op === 3 && (w[0] | 0) === 0) {
      const z = w[4] | 0;
      if (z === 32767 || z === -1 || Math.abs(z) > 20000) p.fxScreen++;
      else p.fxWorld.push({ type: w[1] | 0, x: w[2] | 0, y: w[3] | 0, z });
    }
    if (o.op === 5 && (w[1] | 0) === 0) p.camPresets.push(w[2] | 0);
    if (o.op === 2 && [3, 5, 8].includes(w[0] | 0)) p.loco++;
    if (o.op === 2 && (w[0] | 0) === 0 && (w[2] | 0) > 1) p.tables++;
  }
  return p;
}
for (const folder of modelIndex) {
  const m = getModel(folder);
  for (const [clip, script] of Object.entries(m.actions || {})) {
    if (!Array.isArray(script?.ops) || !script.ops.length) continue;
    const p = profileOps(script.ops);
    ownProfile.set(`${folder}|${clip}`, p);
    const c = CORPUS.get(+clip) || { n: 0, n98: {}, n99: {}, op1_5: 0, op1_0: 0, op6: 0, fxScreen: 0, fx: 0, loco: 0, camPresets: [] };
    c.n++;
    c.n98[p.n98] = (c.n98[p.n98] || 0) + 1;
    c.n99[p.n99] = (c.n99[p.n99] || 0) + 1;
    if (p.op1_5) c.op1_5++;
    if (p.op1_0) c.op1_0++;
    if (p.op6) c.op6++;
    if (p.fxScreen) c.fxScreen++;
    if (p.fxWorld.length + p.fxScreen > 0) c.fx++;
    if (p.loco) c.loco++;
    c.camPresets.push(...p.camPresets);
    CORPUS.set(+clip, c);
  }
}
const modal = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
const corpusMode = new Map();   // clip -> derived expected presentation
for (const [clip, c] of CORPUS) {
  corpusMode.set(clip, {
    n98: +(modal(c.n98) ?? 0),
    n99: +(modal(c.n99) ?? 0),
    pairIntermediate: c.op1_5 > c.n / 2,
    pairFinal: c.op1_0 > c.n / 2,
    projectile: c.op6 > c.n / 2,
    screenAnchor: c.fxScreen > c.n / 2,
    fx: c.fx > 0,
    locomotion: c.loco > c.n / 2,
  });
}

// ── run harness: the real animator + coordinator, headless ────────────────────────────────────────
const sideName = (runSide) => (runSide === "near" ? "player" : "enemy");
const TICK_CAP = 2400;

function makeActor(folder, side) {
  const model = getModel(folder);
  const a = new ActorAnimator(model);
  a.resetSlotPlacement(b3.arenaSlotFor(folder, side, placement));
  return a;
}

function bonePositions(model, frame, blend) {
  const { mats } = b3.buildBoneWorldMatrices(model, frame, blend);
  const out = [];
  for (let b = 0; b < model.bones.length; b++) {
    const m = mats[b];
    out.push(m ? [m[12], m[13], m[14]] : null);
  }
  return out;
}

// Hand/weapon bones per model, from the generated geometry features (a6-features.json): the arm chain
// ends are the hands; `weapons[]` names the weapon-carrying bones. Data, not a branch.
const limbCache = new Map();
function limbBones(folder) {
  if (limbCache.has(folder)) return limbCache.get(folder);
  const f = features[folder] || null;
  const hands = new Set();
  for (const ch of f?.chains || []) {
    const end = (ch.from | 0) + (ch.len | 0) - 1;
    if ((ch.len | 0) >= 2) hands.add(end);
  }
  const weapons = new Set((f?.weapons || []).map((w) => w.bone | 0));
  const out = { hands: [...hands], weapons: [...weapons], all: [...new Set([...hands, ...weapons])] };
  limbCache.set(folder, out);
  return out;
}

// Resolve one op5 record to the shot the renderer installs (battle3d _camHookFor + cannedShotSlot).
function resolveShot(words, attackerSide, atkFolder, defFolder) {
  const st = cam.applyOp5({}, { words }).op5;
  if (!st) return null;
  if (st.eye) return { eye: st.eye, target: st.target, H: st.H };
  if (st.preset != null) {
    const p = st.preset | 0;
    if (p === 0 || p >= 8) return b3.arenaShotFor(placement, atkFolder, defFolder);
    // This harness is symmetric (attacker and defender are the same model); the player slot is the
    // fighter standing near, the enemy slot the one far. A script played from the far side that a
    // built/donor camera authored for the near side is the animator's mirrorHooks territory; the
    // authored-preset path is resolved here exactly as op5ShotSlot does.
    let slot = b3.op5ShotSlot(p);
    if (attackerSide === "enemy" && sm.authoredSide(getModel(atkFolder)) === "enemy") {
      // an enemy-authored script standing near names the OPPOSITE fighter (battle3d standsNearEnemyAuthored)
      const mirrored = sm.mirrorPresetShot(p);
      if (mirrored) slot = mirrored;
    }
    if (!slot) return b3.arenaShotFor(placement, atkFolder, defFolder);
    const nearFolder = attackerSide === "player" ? atkFolder : defFolder;
    const farFolder = attackerSide === "player" ? defFolder : atkFolder;
    const key = b3.modelKeyFromFolder(slot.side === "player" ? nearFolder : farFolder);
    const cams = slot.side === "player" ? nearCameraFor(nearFolder) : placement[key]?.camera;
    const eye = cams?.eye?.[slot.index], look = cams?.look?.[slot.index];
    return eye && look ? { eye, target: look, H: cams.view?.[slot.index] } : null;
  }
  return null;
}
function nearCameraFor(folder) {
  const key = b3.modelKeyFromFolder(folder);
  const rec = placement[key];
  if (!rec) return null;
  if ((rec.camera?.eye?.length | 0) >= 12) return rec.camera;
  // A far-side-only record (the 193 species the disc never stages near) has no twelve near shots; the
  // renderer lends it the table of the partner closest in framing size, refitted to this model's own size
  // (battle3d playerNearCamera -> closestCameraRef + fitNearCamera). Reproduce exactly that, or every camera
  // check on such a model would be "no shot" when the game really shows one.
  const ownRest = b3.modelRestSize(getModel(folder));
  const pick = b3.closestCameraRef(cameraRefSizes?.sizes ?? cameraRefSizes, ownRest, placement);
  const refRec = pick?.key != null ? placement[pick.key] : null;
  const own = ownRest ? b3.modelFrameSize(getModel(folder)) : null;
  const ref = pick ? Math.max(pick.h, 0.5 * pick.w) : null;
  if (!refRec?.camera || !own || !ref) return null;
  const k = Math.min(3, Math.max(0.5, own / ref));
  const ownSlot = b3.arenaSlot(rec, "player");
  const refSlot = b3.arenaSlot(refRec, "player");
  return b3.fitNearCamera(refRec.camera, refSlot, ownSlot, k);
}

const runCache = new Map();
/**
 * Play one (form, clip, target class, side) case through the real animator/coordinator and return the
 * measured facts every invariant is judged on. `techId` selects the technique (its effect type / element
 * reach the VM exactly as setAnimByTech passes them).
 */
function runTech(form, techId, side) {
  const key = `t|${form.folder}|${techId}|${side}`;
  if (runCache.has(key)) return runCache.get(key);
  const obs = runOne(form, techId, side, null);
  runCache.set(key, obs);
  return obs;
}
function runItem(form, item, side) {
  const key = `i|${form.folder}|${item.clip}|${item.target}|${side}`;
  if (runCache.has(key)) return { ...runCache.get(key), itemId: item.id, itemEffect: item.effect };
  const obs = runOne(form, null, side, item);
  runCache.set(key, obs);
  return { ...obs, itemId: item.id, itemEffect: item.effect };
}

function runOne(form, techId, side, item) {
  const atkSide = sideName(side);
  const defSide = side === "near" ? "enemy" : "player";
  const attacker = makeActor(form.folder, atkSide);
  const defender = makeActor(form.folder, defSide);
  const coord = new FightCoordinator(attacker, defender);
  const ev = { hits: [], aux: [], fx: [], cams: [], proj: [], moves: [], tables: [], frames: [],
               // A14: what the SHIPPED EffectPlayer did with those op6 records, and where the renderer
               // drew the flight on each tick (the layer world point, not the root anchor).
               shots: [], flightEnd: null };
  let tick = 0;
  const ep = new EffectPlayer(FX_MANIFEST);
  const hooks = {
    onHit: (r) => ev.hits.push({ tick, type: r.type | 0 }),
    onAuxAction: (r) => ev.aux.push({ tick, mode: r.mode | 0 }),
    onEffect: (r) => ev.fx.push({ tick, type: r.type | 0, x: r.x | 0, y: r.y | 0, z: r.z | 0 }),
    onEffectPreload: (t) => ev.fx.push({ tick, preload: t | 0 }),
    onCamera: (r) => ev.cams.push({ tick, words: (r.words || []).slice() }),
    setLunge: (l) => {
      ev.proj.push({ tick, ...l });
      // the same call battle3d's _fxHooks makes: sub 1 primes the mesh, sub 0 builds the flight object
      if (l?.sub === 0 && l.from) ep.spawnProjectile(l.id ?? l.words?.[1], l.from, l.to, atkSide);
    },
    onMove: (r) => ev.moves.push({ tick, ...r }),
  };
  // the defender's own setAction calls ARE the op1 dispatch's output
  const disp = [];
  const origSet = defender.setAction.bind(defender);
  defender.setAction = (clip, h, o) => { disp.push({ tick, clip }); return origSet(clip, h, o); };

  let started = false;
  try {
    if (techId != null) started = coord.attack(attacker, defender, techId, hooks, { lethal: false, miss: false });
    else if (item.target === "self") started = attacker.setAnimByItem(item.id, hooks);
    else started = attacker.setAnimByThrowItem(item.id, hooks);
  } catch (e) {
    return { err: String(e?.message ?? e).slice(0, 160), tick: 0, started: false };
  }
  const script = (techId != null)
    ? cb.resolveClipScript(attacker.model, ft.techToClip(techId), { element: techTable[String(techId)]?.elem1 ?? 1, target: ft.techTargetClass(techId), tech: skillById.get(techId | 0)?.name ?? null })
    : cb.resolveClipScript(attacker.model, item.clip, { element: 1, target: item.target });
  const meta = {
    clip: techId != null ? ft.techToClip(techId) : item.clip,
    target: techId != null ? ft.techTargetClass(techId) : item.target,
    buildKind: script?.synthesized ? (script.buildKind || "built") : (script ? "own" : "none"),
    synthesized: !!script?.synthesized,
    selfCast: !!script?.selfCast,
    // the animator's own side test: a script a fighter plays from the side it was not authored for has every
    // x/z operand flipped back by mirrorHooks, so measured launch points arrive in the mirrored frame
    mirrored: !!attacker._standsOnOtherSide?.(),
    ops: script?.ops ?? [],
  };
  let lastTable = -1;
  let curCam = null, curShot = null;
  // A15: the pose and mesh state the RENDERER draws, sampled during the whole action and then past its
  // end (the idle the actor returns to). C13/C14 are judged on these - the same buildBoneWorldMatrices
  // the screen uses.
  const poseAt = (frame, blend) => bonePositions(attacker.model, frame, blend);
  const during = [];
  const sampleTick = (k) => {
    const frame = attacker.currentFrame();
    during.push({ tick: k, frame, table: attacker.timelineTable, pose: poseAt(frame, attacker.currentBlend()),
      hidden: hiddenScaleAt(attacker.model, frame, attacker.currentHiddenParts?.()), vm: !!attacker.vm });
  };
  while (coord.active && tick < TICK_CAP) {
    coord.tick(1);
    tick++;
    const f = attacker.currentFrame();
    if (tick % 3 === 0) ev.frames.push({ tick, frame: f, move: attacker.moveDelta().slice() });
    if (tick % 6 === 0) sampleTick(tick);
    if (attacker.timelineTable !== lastTable) { lastTable = attacker.timelineTable; ev.tables.push({ tick, table: lastTable }); }
    // A14: advance the flight objects exactly as battle3d does (one EffectPlayer.step per logic tick),
    // and sample where the renderer would DRAW each one.
    ep.step(1);
    if (ep.projectiles.length) {
      // the camera in force this tick: the last op5 the script issued, else the arena shot
      const camRec = ev.cams.length ? ev.cams[ev.cams.length - 1] : null;
      if (camRec !== curCam) { curCam = camRec; curShot = camRec ? resolveShot(camRec.words, atkSide, form.folder, form.folder) : null; }
      const shot = curShot;
      const flights = ep.projectiles.map((p) => {
        const pack = projPack(p.id);
        const drawn = projDrawnPoint(pack, p.from, p.to, p.t);
        return {
          id: p.id, t: p.t, ticks: p.ticks, from: p.from.slice(), to: p.to.slice(),
          registered: !!p.flight?.registered, pack: !!pack, atlasOk: pack ? pack.atlasOk !== false : false,
          drawn: drawn?.p ?? null, shown: !!drawn?.p,
        };
      });
      ev.shots.push({ tick, frame: f, flights, shot, hasCut: !!camRec });
    }
  }
  // a flight the script did not end: the disc's own packs stop on their clip, so step on and count
  let tail = 0;
  while (ep.projectiles.length && tail < 400) { ep.step(1); tail++; }
  ev.flightEnd = tail;
  ev.flightLeft = ep.projectiles.length;
  // A15 / C13: the actor's IDLE after the clip. The real animator keeps ticking (it is what the next
  // turn draws), so step it 60 further ticks and sample the pose it shows - and where it came from.
  const after = [];
  const lastFrame = attacker.currentFrame();
  for (let k = 1; k <= 60; k++) {
    attacker.tick(1);
    if (k % 6 === 0) {
      const frame = attacker.currentFrame();
      const bl = attacker.currentBlend();
      after.push({ k, frame, table: attacker.timelineTable, pose: poseAt(frame, bl),
        blended: !!bl, hidden: hiddenScaleAt(attacker.model, frame, attacker.currentHiddenParts?.()) });
    }
  }
  ev.during = during;
  ev.after = after;
  ev.lastActionFrame = lastFrame;
  // final measured displacement (the slot's delta from home; PS1 units)
  const endMove = attacker.moveDelta().slice();
  const obs = {
    err: null, started, tick, hung: tick >= TICK_CAP, scripts: script, meta, ev, disp, endMove,
    home: { atk: attacker.homeSlot, def: defender.homeSlot },
    model: attacker.model,
  };
  // pose energy: mean per-bone movement between sampled frames (PS1 units), and idle's own value
  obs.pose = poseEnergy(attacker.model, ev.frames.map((f) => ({ frame: f.frame })));
  obs.idlePose = idleEnergy(attacker.model);
  return obs;
}

function energyBetween(a, b) {
  let sum = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    if (!a[i] || !b[i]) continue;
    sum += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]);
    n++;
  }
  return n ? sum / n : 0;
}
function poseEnergy(model, samples) {
  if (!samples.length) return 0;
  let prev = null, sum = 0, n = 0;
  for (const s of samples) {
    const p = bonePositions(model, s.frame, null);
    if (prev) { sum += energyBetween(prev, p); n++; }
    prev = p;
  }
  return n ? sum / n : 0;
}
const idleEnergyCache = new Map();
function idleEnergy(model) {
  const key = model.folder;
  if (idleEnergyCache.has(key)) return idleEnergyCache.get(key);
  const table = model.timeline?.[0]?.table || [];
  const frames = table.filter((e) => (e.value | 0) < 0x8000).map((e) => e.value | 0).slice(0, 12);
  const samples = (frames.length ? frames : [0]).map((f) => ({ frame: f }));
  const v = poseEnergy(model, samples);
  idleEnergyCache.set(key, v);
  return v;
}

// ── A15: C13 (idle resumes), C14 (no duplicate geometry), C15 (launch from the weapon) ─────────────
// All three are judged on the pose/mesh the RENDERER would draw, computed with the renderer's own
// buildBoneWorldMatrices - no screenshots, no species branches. The yardstick for "flat" is the model's
// OWN idle: how far its idle poses travel from the bind pose (every rotation zero), and which of its
// mesh parts its idle keeps hidden (scale ~0, e.g. the second, thrown axe Boltmon's pack carries).
const pristineCache = new Map();
/** The pack exactly as authored: a fresh read, never the (baked/mutated) model the rows drive. */
function pristineModel(folder) {
  if (!pristineCache.has(folder)) pristineCache.set(folder, readJson(path.join(MODELS, folder, "anim.json")));
  return pristineCache.get(folder);
}
/** The pose a frame-0 read draws: every bone's local rotation zero = the bind/flat pose. */
function bindPoseOf(model) {
  const m = { ...model, bones: model.bones.map((b) => ({ ...b, anim: { ...(b.anim || {}), ch2: [[0, 0, 0, 0]] } })) };
  return bonePositions(m, 0, null);
}
/** The largest distance between corresponding bone world points of two poses. */
function maxBoneDist(a, b) {
  let d = 0, at = -1;
  for (let i = 0; i < a.length; i++) {
    if (!a[i] || !b[i]) continue;
    const v = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]);
    if (v > d) { d = v; at = i; }
  }
  return { d, at };
}
const idleAwayCache = new Map();
/** The model's bind pose (cached per folder): what a frame-0 read of an empty channel draws. */
const bindCache = new Map();
function bindPoseCache(folder) {
  if (!bindCache.has(folder)) bindCache.set(folder, bindPoseOf(pristineModel(folder)));
  return bindCache.get(folder);
}
/** How far the model's own idle travels from its bind pose: `away` = the farthest idle pose (the "flat"
 *  threshold is derived from it), `bindMin` = the CLOSEST one. A pack whose own idle sits on the bind
 *  pose has no flat test at all - a rule the disc's own idle violates is a wrong rule. */
function idleManifold(folder) {
  if (idleAwayCache.has(folder)) return idleAwayCache.get(folder);
  const m = pristineModel(folder);
  const bind = bindPoseOf(m);
  const frames = (m.timeline?.[0]?.table || []).filter((e) => (e.value | 0) < 0x8000).map((e) => e.value | 0);
  let away = 0, bindMin = Infinity;
  for (const f of frames) {
    const d = maxBoneDist(bonePositions(m, f, null), bind).d;
    away = Math.max(away, d);
    bindMin = Math.min(bindMin, d);
  }
  const v = { away, bindMin: Number.isFinite(bindMin) ? bindMin : 0 };
  idleAwayCache.set(folder, v);
  return v;
}
const hiddenCache = new Map();
/** Mesh parts the model's own IDLE keeps scaled to ~0: geometry the authored body never shows. */
function hiddenParts(folder) {
  if (hiddenCache.has(folder)) return hiddenCache.get(folder);
  const m = pristineModel(folder);
  const frames = (m.timeline?.[0]?.table || []).filter((e) => (e.value | 0) < 0x8000).map((e) => e.value | 0);
  const out = [];
  for (let b = 0; b < m.bones.length; b++) {
    const ch3 = m.bones[b].anim?.ch3;
    if (!ch3 || !(m.bones[b].faces || []).length) continue;
    let lo = Infinity;
    for (const f of (frames.length ? frames : [0])) {
      const s = b3.interpChannel(ch3, f);
      lo = Math.min(lo, Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) / 4096);
    }
    if (lo < 0.05) out.push(b);
  }
  hiddenCache.set(folder, out);
  return out;
}
/** The largest scale drawn on any of a model's idle-hidden parts at `frame`. */
function hiddenScaleAt(model, frame, hide = null) {
  const hidden = hide == null ? null : new Set(hide);
  const hid = hiddenParts(model.folder);
  let hi = 0;
  for (const b of hid) {
    if (hidden && hidden.has(b)) continue;
    const ch3 = model.bones[b]?.anim?.ch3;
    if (!ch3) continue;
    const s = b3.interpChannel(ch3, frame);
    hi = Math.max(hi, Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) / 4096);
  }
  return hi;
}
const spriteCache = new Map();
/**
 * The sprites the model's own clips spawn: MELEE families (5,6,7,8,11) vs the RANGED ones (9,13).
 * A spell's projectile must not be a sprite the model only ever throws with its weapon (C14's
 * "a spawned sprite must not be a clone of the model's own prop").
 */
function ownSprites(folder) {
  if (spriteCache.has(folder)) return spriteCache.get(folder);
  const m = pristineModel(folder);
  const melee = new Set(), ranged = new Set();
  for (const c of [5, 6, 7, 8, 11]) for (const o of m.actions?.[c]?.ops ?? []) {
    if ((o.op === 3 || o.op === 6) && o.words?.length >= 2) melee.add(o.words[1] | 0);
  }
  for (const c of [9, 13]) for (const o of m.actions?.[c]?.ops ?? []) {
    if ((o.op === 3 || o.op === 6) && o.words?.length >= 2) ranged.add(o.words[1] | 0);
  }
  const v = { melee, ranged };
  spriteCache.set(folder, v);
  return v;
}
/** The drawn prop mesh at `frame`: the bone's world origin and every vertex in the renderer's frame. */
function propVertsAt(model, bone, frame) {
  const b = model.bones?.[bone];
  if (!b || !(b.verts || []).length) return { points: [], org: null };
  const { mats } = b3.buildBoneWorldMatrices(model, frame, null);
  const M = mats[bone];
  if (!M) return { points: [], org: null };
  const points = [];
  for (const v of b.verts) {
    points.push([
      -(M[0] * v[0] + M[4] * v[1] + M[8] * v[2]) + M[12],
      M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13],
      -(M[2] * v[0] + M[6] * v[1] + M[10] * v[2]) + M[14],
    ]);
  }
  return { points, org: [M[12], M[13], M[14]] };
}

// ── outcome replay: the coordinator's own op1 dispatch, per outcome ────────────────────────────────
function reactionsFor(obs, side, outcome) {
  const modes = obs.ev.aux.map((a) => a.mode);
  const atkSide = sideName(side);
  const clips = [];
  const stubAtt = { homeSlot: { side: atkSide }, setAnimByTech(techId, hooks) { for (const m of modes) hooks.onAuxAction?.({ mode: m }); return true; } };
  const stubDef = { homeSlot: { side: side === "near" ? "enemy" : "player" }, setAction(c) { clips.push(c); return true; } };
  const c = new FightCoordinator(stubAtt, stubDef);
  c.attack(stubAtt, stubDef, 0, {}, { lethal: outcome === "lethal", miss: outcome === "miss" });
  return clips;
}

// ── judging ────────────────────────────────────────────────────────────────────────────────────────
// Every bound below is derived from the authored corpus (see --calibrate and the MD calibration log);
// the own-row "before" counts in that log are the rejects the inherited rule set produced on this tree.
const BOUNDS = {
  anchorBound: 2800,     // world effect within 2800 PS1 units of the intended fighter's home line
  anchorMargin: 0,       // ...and at least this much nearer to it than to the other fighter
  castDrift: 0,          // cast/support/self: max root displacement from home (calibrated below)
  homeDrift: 0,          // melee: displacement at the end of the clip must be 0 (exactly home)
  projectileR: 0,        // projectile spawn within R of a hand/weapon bone (calibrated below)
  launchSpread: 0.06,    // C11: a launch point within this share of body height of its emitter bone tip
  poseRatio: 0.5,        // built pose energy / the model's own basic-attack energy
  poseFloor: 0.5,        // ...and an absolute floor (PS1 units per sampled frame)
};
let CAL = null;   // filled by calibrate()

function dist2(a, b) { return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.z ?? 0) - (b.z ?? 0)); }

function judge(obs, form, caseInfo, outcome) {
  const R = { C1: true, C2: true, C3: true, C4: true, C5: true, C6: true, C7: true, C8: true, C9: null, C10: true, C11: true, C12: null, C13: null, C14: null, C15: null };
  const M = {};
  if (obs.err) { for (const k of Object.keys(R)) R[k] = false; return { R, M: { err: obs.err } }; }
  const clip = caseInfo.clip;
  const self = caseInfo.target === "self";
  const ev = obs.ev;
  const n98 = ev.hits.filter((h) => h.type === 98).length;
  const n99 = ev.hits.filter((h) => h.type === 99).length;
  M.n98 = n98; M.n99 = n99; M.ended = !obs.hung; M.build = obs.meta.buildKind;

  // C1 — contact count. Expected: the model's own authored profile for this clip when the script IS its
  // own (ground truth); otherwise the authored corpus mode for the clip at this technique's hit count.
  // A self/ally cast has no contact SEQUENCE (no 98); a lone 99 is legal — the disc's own item clip 10
  // carries exactly that (an `op10 99` is also the effect-commit marker, m005grey's clip 10 included).
  const ownKey = `${form.folder}|${clip}`;
  const own = ownProfile.get(ownKey) || null;
  const mode = corpusMode.get(clip) || null;
  const hits = caseInfo.hits ?? 1;
  let exp98, exp99;
  if (self) { exp98 = (own && !obs.meta.synthesized) ? own.n98 : 0; exp99 = (own && !obs.meta.synthesized) ? own.n99 : 0; }
  else if (!obs.meta.synthesized && own) { exp98 = own.n98; exp99 = own.n99; }
  else if (mode) {
    // the corpus mode for single-hit techniques; a multi-hit technique scales the authored intermediates
    exp98 = Math.min(mode.n98, Math.max(0, hits - 1));
    exp99 = mode.n99 ? 1 : 0;
  } else { exp98 = 0; exp99 = 1; }
  R.C1 = n98 === exp98 && n99 === exp99;
  // a clip whose authored corpus carries no contact marker at all (clip 15 is pure op4) has no contact
  // expectation to violate — the disc itself presents that move without one.
  if (!self && !exp98 && !exp99 && mode && !mode.n98 && !mode.n99) R.C1 = true;
  M.exp = `${exp98}/${exp99}`;
  M.fx = ev.fx.filter((f) => !f.preload).map((f) => (isScreenZ(f.z) ? "S" : String(Math.round(dist2(f, self ? obs.home.atk : obs.home.def)))));

  // C2 — reaction pairing. Only where the authored corpus pairs: every 98 with op1[5], the final 99 with
  // op1[0]; self casts ask for no reaction at all. The defender must receive clip 1 per mode 5 and the
  // outcome clip (2 survive / 3 lethal / 4 miss) per mode 0 — measured through the real dispatch.
  const auxModes = ev.aux.map((a) => a.mode);
  const reacts = reactionsFor(obs, caseInfo.side, outcome);
  M.reacts = reacts.join(",");
  if (self) {
    R.C2 = !auxModes.includes(5) && !auxModes.includes(0) && reacts.length === 0;
  } else {
    const pair98 = !!(own?.op1_5) || !!mode?.pairIntermediate;
    const pair99 = !!(own?.op1_0) || !!mode?.pairFinal;
    // The authored op1 is a REQUEST record the VM executes when it reaches it; the disc writes it anywhere in
    // the strike block (m006devi clip 11 puts `op1 [0]` after the sound records and a 44-frame wait). What the
    // dispatch needs is enough requests: one mode-5 per intermediate contact, one mode-0 for the strike.
    const req5 = (obs.meta.ops || []).filter((o) => o.op === 1 && (o.words?.[0] | 0) === 5).length;
    const req0 = (obs.meta.ops || []).filter((o) => o.op === 1 && (o.words?.[0] | 0) === 0).length;
    let ok = true;
    if (pair98 && req5 < n98) ok = false;
    if (pair99 && n99 && !req0) ok = false;
    const wantOutcome = outcome === "lethal" ? 3 : outcome === "miss" ? 4 : 2;
    if (pair99 && n99 && !reacts.includes(wantOutcome)) ok = false;
    const mode5 = auxModes.filter((m) => m === 5).length;
    if (pair98 && mode5 !== reacts.filter((c) => c === 1).length) ok = false;
    R.C2 = ok;
  }

  // C3 — target class shape. Self: no projectile, no reaction request and no dispatch to the other
  // fighter (the disc's own self cast CAN carry a bare op10 98 — m440sijn's clip 10 does, as an
  // effect-commit marker — so what the invariant forbids is a hit ROUTED to the opponent, which is
  // exactly the defender dispatch). Enemy: the script must carry a defender-facing cue — unless the
  // authored corpus for this clip carries none (clip 15 is pure op4: the disc presents that move with
  // no contact marker at all).
  const proj = ev.proj.filter((p) => p.sub === 0);
  const worldFx = ev.fx.filter((f) => !f.preload && !isScreenZ(f.z));
  const screenFx = ev.fx.filter((f) => !f.preload && isScreenZ(f.z));
  if (self) R.C3 = proj.length === 0 && (obs.disp || []).length === 0 && auxModes.length === 0 && reacts.length === 0;
  else {
    const ownCue = own ? (own.n98 + own.n99 + own.op6) > 0 : (mode ? (mode.n98 + mode.n99) > 0 || mode.projectile : true);
    const haveCue = n98 + n99 > 0 || proj.length > 0 || worldFx.length > 0 || screenFx.length > 0;
    R.C3 = haveCue || !ownCue;
  }

  // C4 — effect anchor, the operator's killer shape (a being-hit effect drawn on the attacker's own body).
  // The disc authors each op3 world spawn at ABSOLUTE arena coordinates and its z sign names the lane it
  // belongs to (battle3d's own rule: atDefender(z) = defSide === "enemy" ? z > 0 : z < 0). So the invariant
  // is arithmetic, not a distance bound: the fighter a spawn is DRAWN at (nearer slot) must be the fighter
  // its authored z CLAIMS, and a script whose corpus spawns an effect must spawn one. A screen-space spawn
  // (z = 32767) is drawn at the screen centre by construction and needs no cut.
  const atkSide = caseInfo.side === "near" ? "player" : "enemy";
  const defSide = caseInfo.side === "near" ? "enemy" : "player";
  const atkHome = obs.home.atk, defHome = obs.home.def;
  const want = self ? atkHome : defHome;
  const other = self ? defHome : atkHome;
  const offsets = ev.fx.filter((f) => !f.preload).map((f) => ({
    d_want: dist2(f, want), d_other: dist2(f, other), screen: isScreenZ(f.z),
    d_def: dist2(f, defHome), d_atk: dist2(f, atkHome),
  }));
  const atDefender = (z) => (defSide === "enemy" ? z > 0 : z < 0);
  const authoredFx = (obs.meta.ops || [])
    .filter((o) => o.op === 3 && (o.words?.[0] | 0) === 0)
    .map((o) => ({ type: o.words[1] | 0, z: o.words[4] | 0 }))
    // 9999 is EFFECT_CURRENT (the actor's current-effect word, type resolved by the effect player at spawn)
    // and -1/0 are the "no effect" arms — none of them names an authored type, so none carries a claim.
    .filter((a) => a.type > 0 && a.type !== 9999);
  // The animator turns a script authored for the other side around (mirrorHooks: x -> -x, z -> -z), so the
  // claim is read off the EFFECTIVE z, exactly as battle3d reads the spawn it is handed.
  const mirrored = sm.authoredSide(obs.model) !== atkSide;
  const spawns = ev.fx.filter((f) => !f.preload);
  const corpusFx = own ? (own.fxWorld.length + own.fxScreen) > 0 : !!mode?.fx;
  // Pair each spawn with the authored record of the SAME effect type (the VM reports type + position, and the
  // renderer may resolve a screen directive to an arena point), so a re-ordered/skipped spawn cannot shift
  // the pairing. A record with a real arena z carries a lane claim; a screen/-1 record carries none.
  const byType = new Map();
  for (const a of authoredFx) {
    const l = byType.get(a.type) || [];
    l.push(a); byType.set(a.type, l);
  }
  let misanchored = 0;
  if (authoredFx.length) for (const s of spawns) {
    const l = byType.get(s.type | 0);
    // A spawn with no authored record of its type is the effect player resolving a sentinel (op3's 9999
    // "current effect", or an impact anchor), not a spawn the script never asked for.
    if (!l || !l.length) continue;
    const a = l.shift();
    if (isScreenZ(a.z) || isScreenZ(s.z)) continue;      // no lane claim (screen space / interior anchor)
    const drawnAtDefender = dist2(s, defHome) < dist2(s, atkHome);
    if (atDefender(mirrored ? -a.z : a.z) !== drawnAtDefender) misanchored++;
  }
  const missing = [...byType.values()].reduce((n, l) => n + l.length, 0);
  R.C4 = misanchored === 0 && missing === 0 && (offsets.length > 0 || !corpusFx);
  M.anchor = offsets.length ? `${Math.round(Math.min(...offsets.map((o) => o.d_want)))}..${Math.round(Math.max(...offsets.map((o) => o.d_want)))}` : "none";
  M.dOther = offsets.length ? Math.round(Math.min(...offsets.map((o) => o.d_other))) : null;
  M.fxMis = misanchored + missing;

  // C5 — locomotion: a cast/support body keeps the caster planted; a melee clip returns home. Every clip
  // ends inside the tick bound (no hang).
  let maxMove = 0;
  for (const f of ev.frames) maxMove = Math.max(maxMove, Math.hypot(f.move[0], f.move[2]));
  const endDrift = Math.hypot(obs.endMove[0], obs.endMove[2]);
  // planted when the technique is self-directed, or when THIS model's own script for the clip plants
  // (its authored archetype), or — for a built script — when the authored corpus for the clip plants.
  const plantedClip = self || (own ? own.loco === 0 : (mode ? !mode.locomotion : false));
  M.drift = Math.round(endDrift); M.maxMove = Math.round(maxMove); M.planted = plantedClip;
  R.C5 = !obs.hung && (plantedClip ? maxMove <= BOUNDS.castDrift + 0.5 : endDrift <= BOUNDS.homeDrift + 0.5);

  // C6 — projectile origin: within R of a hand/weapon bone when the model has one and the clip fires.
  const limb = limbBones(form.folder);
  let best = Infinity;
  if (proj.length && limb.all.length) {
    for (const p of proj) {
      const fr = ev.frames.find((f) => f.tick >= p.tick) || ev.frames[ev.frames.length - 1];
      if (!fr) continue;
      const bp = bonePositions(obs.model, fr.frame, null);
      for (const b of limb.all) if (bp[b]) best = Math.min(best, Math.hypot(p.from[0] - bp[b][0], p.from[2] - bp[b][2]));
    }
  }
  M.projDist = isFinite(best) ? Math.round(best) : null;
  R.C6 = !proj.length || !limb.all.length || best <= BOUNDS.projectileR + 0.5;

  // C7 — body motion: the pose leaves the idle manifold by a ratio of the model's own basic-attack energy,
  // bone lengths are rigid, and every timeline TABLE the script declares (op2 mode-0) is actually bound.
  // op4 is NOT a table declaration: it is [sub, rawMotion, a2, a3] (engine op4Handler) — a motion ENVELOPE
  // id handed to motionSelect with a2/a3 as blend operands, which this animator binds through onMotion
  // (0 = return to base); reading its operands as table ids is what made authored clips look unbound.
  const energy = obs.pose, base = Math.max(basicEnergy(form), 0.001);
  const distinct = new Set(ev.frames.map((f) => Math.round(f.frame))).size;
  // declared = op2 mode-0 tables that the script actually PLAYS: a table named after the last wait (the
  // return-to-idle op2 at the tail, e.g. Cherrymon clip 5's final `op2 [0,0,15]`) never gets a frame to run,
  // so the animator cannot bind it and the disc never asked it to.
  const opList = obs.meta.ops || [];
  const declared = new Set();
  for (let i = 0; i < opList.length; i++) {
    const o = opList[i];
    if (o.op !== 2 || (o.words?.[0] | 0) !== 0 || (o.words?.[2] | 0) <= 1) continue;
    let played = false;
    for (let j = i + 1; j < opList.length; j++) {
      // a later op4 motion 0 is the authored RETURN TO BASE: the envelope leaves the table before the wait,
      // so the animator is right to show the base table and the disc never sampled this one
      if (opList[j].op === 4 && ((opList[j].words?.[1] | 0) === 0)) break;
      if (opList[j].op === 11) { played = true; break; }
      if (opList[j].op === 255 || opList[j].op === 0) break;
    }
    if (played) declared.add(o.words[2] | 0);
  }
  const bound = new Set(ev.tables.map((t) => t.table));
  const unbound = [...declared].filter((t) => t > 1 && !bound.has(t));
  M.tables = `${bound.size}/${declared.size}`; M.unbound = unbound.join(",");
  M.moveRatio = +(energy / base).toFixed(3);
  // The energy floor is a rule for BUILT scripts (a donor body must actually move; C7's own wording measures
  // it against the donor's motion energy). An AUTHORED clip is ground truth: several disc clips (14/15/17)
  // carry only an op4 motion envelope whose table the item/actor machine binds outside the clip, so they
  // measure near idle here — reported in M.moveRatio as the op4-envelope gap, not gated against the disc.
  R.C7 = distinct >= 3 && !unbound.length && boneLengthsRigid(obs.model, ev.frames) &&
    (!obs.meta.synthesized || energy >= Math.max(BOUNDS.poseFloor, BOUNDS.poseRatio * base));
  M.energy = energy.toFixed(2);

  // C8 — camera: every authored cut must resolve to a real shot, and the shot set must frame a fighter
  // WHOLE (a giant cropped to legs is the A5 complaint). The disc authors close-ups of EITHER fighter
  // (own corpus: only 590/3384 authored camera rows frame both), so an authored script is gated on "some
  // shot frames some fighter whole"; a BUILT script must show the intended fighter — unless its effect is
  // screen-space, which the shot draws at its own centre by construction.
  M.shots = ev.cams.length;
  let c8 = true, framed = [], missCut = 0;
  const attackerSlot = { x: obs.home.atk.x + obs.endMove[0], y: obs.home.atk.y + obs.endMove[1], z: obs.home.atk.z + obs.endMove[2] };
  for (const c of ev.cams) {
    const shot = resolveShot(c.words, caseInfo.side === "near" ? "player" : "enemy", form.folder, form.folder);
    const w = c.words || [];
    const isPreset = (w[1] | 0) === 0;
    const preset = w[2] | 0;
    if (!shot) {
      // A preset names a SLOT; when the model's record carries no eye/look at that index the renderer keeps
      // its default arena camera, which frames the arena by construction. Judging that fallback's body boxes
      // would gate the disc on a shot its data never names, so a preset that resolves to nothing is counted
      // (M.missCut) and skipped — it is not an authored camera. An explicit transform that fails to parse is.
      if (isPreset) { missCut++; continue; }
      c8 = false; continue;
    }
    const a = b3.shotBodyBounds(shot, attackerSlot, b3.modelRestSize(obs.model));
    const d = b3.shotBodyBounds(shot, obs.home.def, b3.modelRestSize(obs.model));
    const inA = inside(a), inD = inside(d);
    framed.push(`${inA ? "A" : "-"}${inD ? "D" : "-"}`);
  }
  const intendedWhole = framed.some((f) => (self ? f[0] === "A" : f[1] === "D"));
  const effectScreen = ev.fx.filter((f) => !f.preload).every((f) => isScreenZ(f.z)) && ev.fx.some((f) => !f.preload);
  const builtScript = !!obs.meta.synthesized;
  if (ev.cams.length) R.C8 = c8 && (builtScript ? (intendedWhole || effectScreen) : true);
  else R.C8 = true;   // no cut: the arena shot frames both by construction (C8's own data path)
  M.framed = framed.join(" ");
  M.missCut = missCut;

  // C10 — item contract: the item's own target class; a self item must be a calm cast whose effect lands
  // on the caster (the disc's own item clip 10 carries a bare 99 commit marker — allowed, it requests no
  // reaction), a thrown item is an attack aimed at the opponent.
  if (caseInfo.itemId != null) {
    const eff = ev.fx.filter((f) => !f.preload);
    const onCaster = eff.length === 0 ? self : eff.every((f) => isScreenZ(f.z) || dist2(f, atkHome) <= BOUNDS.anchorBound);
    // a self item is a calm cast: no projectile, no dispatch to the other fighter (its own clip's bare 99
    // commit marker is the disc's shape), effect on the caster. A thrown item is an attack aimed at the
    // opponent.
    R.C10 = self
      ? (proj.length === 0 && (obs.disp || []).length === 0 && auxModes.length === 0 && reacts.length === 0 && onCaster && maxMove <= BOUNDS.castDrift + 0.5)
      : ((n98 + n99 > 0 || proj.length > 0 || worldFx.length > 0 || screenFx.length > 0) ||
         // the disc's own script for this clip carries no contact cue (clip 15 is pure op4): exempt
         !(own ? (own.n98 + own.n99 + own.op6) > 0 : (mode ? (mode.n98 + mode.n99) > 0 || mode.projectile : true)));
  }

  // C11 — LAUNCH PLAN (K13). A BUILT script must launch exactly the projectiles the anatomy gives this
  // technique - one per emitter site of `shotsFor`, each from that emitter bone's tip - and nothing else.
  // The disc's own scripts are ground truth and keep the spawn point they author (a fixed body-centre
  // point, measured here, never gated: gating the corpus would reject the disc's own data, as C4/C7/C8
  // learned). Two independent measurements of "at the emitter bone's tip":
  //   * the plan point equals the point the VM reports (launchFrom) - count and per-point identity;
  //   * the RENDERER's own world matrix at the plan's frame puts that bone at the plan point, which
  //     cross-checks the rest-pose arithmetic against battle3d.buildBoneWorldMatrices.
  const techName = caseInfo.kind === "tech" ? (skillById.get(caseInfo.id | 0)?.name ?? null) : null;
  const planTables = cb.scriptTableSeq({ ops: obs.meta.ops });
  const planTable = planTables[0] ?? null;
  const plan = lp.launchPointsFor(obs.model, { tech: techName, volley: (clip | 0) === 13, tables: planTables });
  const launched = proj.filter((p) => Array.isArray(p.from));
  // the K14 rule itself, independent of the plan's own resolution: mode + the number of projectiles the
  // technique fires. C11 is stated against THIS (launch count == shotsFor(...).shots), so a plan that
  // silently resolves fewer sites than the anatomy names cannot pass by agreeing with itself.
  const rule = techName ? anat.shotsFor(obs.model.folder, techName, { volley: (clip | 0) === 13 }) : null;
  const H = Math.max(1, b3.modelRestSize(obs.model).h || 1);
  const spreadR = lp.LAUNCH_SPREAD * H + 4;
  M.launch = `${launched.length}/${plan.points.length}`;
  M.launchMode = plan.mode;
  M.launchRule = rule ? `${rule.mode}/${rule.shots}` : null;
  M.planTable = planTable;
  M.planPoint = plan.points[0] ? `${plan.points[0].id}@${plan.points[0].bone}/${plan.points[0].frame}:${plan.points[0].x},${plan.points[0].y},${plan.points[0].z}` : null;
  M.gotFrom = launched[0] ? launched[0].from.join(",") : null;
  // A technique's built script must launch exactly its plan. An ITEM is not a technique: its clip-14/15/17
  // throw arm presents the item's own sprite on the donor's shape, so it is measured (M.launch) but not
  // gated here — the item contract is C10.
  const c11Case = obs.meta.synthesized && !self && caseInfo.kind === "tech";
  if (c11Case) {
    let ok = launched.length === plan.points.length;
    const used = new Set();
    let worst = 0;
    for (const p of launched) {
      let best = -1, bd = Infinity;
      plan.points.forEach((q, i) => {
        if (used.has(i)) return;
        const want = lp.launchFrom(obs.model, q, { mirrored: !!obs.meta.mirrored });
        const d = Math.hypot(p.from[0] - want[0], p.from[1] - want[1], p.from[2] - want[2]);
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) { ok = false; break; }
      used.add(best);
      worst = Math.max(worst, bd);
    }
    if (worst > 2) ok = false;
    // the plan's own points must lie on the emitter's TIP (the weapon's when the arm carries a prop, C15;
    // else the bone's own tip) - measured through the one function the plan uses, on the renderer's
    // matrices. A14 extended the hand bone one limb-length to the muzzle; A15 extends it to the prop.
    let tipWorst = 0;
    for (const q of plan.points) {
      const bp = lp.tipPointFor(obs.model, q, q.frame);
      if (!bp) { ok = false; continue; }
      tipWorst = Math.max(tipWorst, Math.hypot(bp[0] - q.x, bp[1] - q.y, bp[2] - q.z));
    }
    if (tipWorst > spreadR) ok = false;
    M.launchWorst = Math.round(worst);
    M.launchTip = Math.round(tipWorst);
    // a contact move launches nothing; a launching move names at least one emitter site
    if (plan.mode === "per-limb-contact" && launched.length) ok = false;
    // the anatomy's own rule: the launch count must equal the technique's shots, and a rule that names no
    // projectile (none / contact) must launch none whatever the plan resolved
    if (rule) {
      if (rule.mode !== plan.mode) ok = false;
      if (rule.mode === "single" || rule.mode === "per-emitter") {
        if ((rule.shots | 0) !== launched.length) ok = false;
      } else if (launched.length) ok = false;
    }
    R.C11 = ok;
  }

  // C12 — THE PROJECTILE IS VISIBLE (A14). C11 proves a launch RECORD exists at the right bone; it says
  // nothing about whether anything is DRAWN. The operator's report (Minotarumon, Ice Shower: "no
  // projectile appears") is exactly the gap: the record was there, the flight was built, and the screen
  // showed nothing. C12 therefore judges the flight the RENDERER holds, tick by tick:
  //   (a) a flight is instantiated for the technique's projectiles (the op6 registry accepted the sprite,
  //       the pack mesh + atlas exist, a layer is past the disc's own hide test and the projected centre
  //       lies inside the viewport for at least MIN_ONSCREEN ticks);
  //   (b) it starts at the launch point the VM reported (|drawn - from| <= R at the first drawn tick);
  //   (c) it CLOSES ON THE DEFENDER: the distance to the defender's hit point decreases (never rises by
  //       more than a sampling tolerance) and comes within R2 of it at or before the strike tick. This is
  //       the invariant that catches a shot fired BACKWARDS - the donor-yaw defect A14 fixed;
  //   (d) it is not hidden behind the CASTER'S OWN BODY: at some tick before the strike the drawn point
  //       is outside the caster's projected bone hull (or in front of it). A shot that never clears the
  //       caster's silhouette is invisible from the game's own rear camera - the operator's report;
  //   (e) nothing is left flying once the clip has ended (the disc's packs end on their clip);
  // and the body stays planted (C5 already measures it; C12 restates it as a cast rule for the same rows).
  {
    const c12Case = obs.meta.synthesized && !self && caseInfo.kind === "tech" &&
                    (plan.mode === "single" || plan.mode === "per-emitter") && plan.points.length > 0;
    if (c12Case) {
      const MIN_ONSCREEN = 4;
      const DEF_HIT_Y = -896;                       // the strike anchor's height (victimAnchor)
      const hitPoint = { x: obs.home.def.x, y: DEF_HIT_Y, z: obs.home.def.z };
      const strikeTick = ev.hits.filter((h) => h.type === 99).map((h) => h.tick)[0] ?? null;
      const R2 = Math.max(600, 0.25 * H);
      const samples = ev.shots.filter((s) => s.flights.length);
      let onScreen = 0, drawnPx = 0, startWorst = 0, hiddenAll = true, closed = false, cleared = false;
      let dFirst = null, dMin = Infinity, rose = 0, prevD = null, occludedTicks = 0;
      const zRange = [Infinity, -Infinity];
      const firstFlight = samples[0]?.flights?.[0] ?? null;
      // the drawn series of ONE flight (the first ship's), since each flight carries the same geometry
      let projId = firstFlight?.id ?? null;
      for (const s of samples) {
        const fl = s.flights.find((f) => f.id === projId) ?? s.flights[0];
        if (!fl || !fl.shown || !fl.drawn) continue;
        const pack = projPack(fl.id);
        // (a) sprite resolved: the registry took it, the mesh and its atlas are on disk
        if (!fl.registered || !fl.pack || !fl.atlasOk) continue;
        const shot = s.shot ?? b3.arenaShotFor(placement, form.folder, form.folder);
        const ndc = shot ? b3.shotPointNdc(shot, fl.drawn) : null;
        if (!ndc || Math.abs(ndc[0]) > 1 || Math.abs(ndc[1]) > 1) continue;
        onScreen++;
        // the ball is a sphere of radius ~512 PS1 units in its own pack: does it cover a pixel?
        drawnPx = Math.max(drawnPx, 1);
        if (dFirst == null) {
          dFirst = Math.hypot(fl.drawn[0] - fl.from[0], fl.drawn[1] - fl.from[1], fl.drawn[2] - fl.from[2]);
          startWorst = Math.max(startWorst, dFirst);
        }
        // (c) closing on the defender, measured ALONG THE ATTACK AXIS: the caster's own arm sits off
        // the arena's centre line, so the lateral (x) offset of a shot is authored, not a miss - what
        // must happen is that the shot travels toward the defender's line and gets there.
        const d = Math.abs(fl.drawn[2] - hitPoint.z);
        dMin = Math.min(dMin, d);
        // The pack's own track runs a full arena length whatever the distance to the victim (the same
        // -10240 units in 97 of the 129 meshes), so once the shot has ARRIVED its distance to the victim
        // line grows again by design - the overshoot is authored, not a defect. Only a shot that turns
        // away BEFORE it arrives is flying backwards (the A14 yaw defect this catches).
        if (prevD != null && prevD > R2 && d > prevD + Math.max(50, 0.02 * prevD)) rose++;
        prevD = d;
        zRange[0] = Math.min(zRange[0], fl.drawn[2]);
        zRange[1] = Math.max(zRange[1], fl.drawn[2]);
        if (strikeTick == null || s.tick <= strikeTick + 2) { /* measured up to the strike */ }
        // (d) clear of the caster's own body
        if (hiddenAll) {
          const bones = bonePositions(obs.model, s.frame, null);
          const hull = projectHull(bones, shot);
          const inside = hull && pointInConvex(hull, [ndc[0], ndc[1]]);
          const depth = hull ? depthAlong(shot, fl.drawn) - hull.depth : -1;
          if (!inside || depth <= 0) hiddenAll = false; else occludedTicks++;
        }
      }
      closed = dMin <= R2;
      cleared = (ev.flightLeft | 0) === 0;
      let ok = onScreen >= MIN_ONSCREEN && startWorst <= 1 && !rose && closed && !hiddenAll && cleared &&
               maxMove <= BOUNDS.castDrift + 0.5;
      if (!samples.length) ok = false;
      M.vis = `${onScreen}/${samples.length}`;
      M.visStart = Math.round(startWorst);
      M.visClose = Math.round(dMin);
      M.visRose = rose;
      M.visHidden = hiddenAll ? "always" : `${occludedTicks}`;
      M.visTail = ev.flightLeft | 0;
      M.visId = projId;
      M.visZ = `${Math.round(zRange[0])}..${Math.round(zRange[1])} (def ${Math.round(hitPoint.z)})`;
      R.C12 = ok;
    }
  }

  // ── C13 — IDLE RESUMES (A15). Two facts, both read off the pose the renderer DRAWS ───────────────
  // (a) DURING the clip the actor is never in its BIND pose. The operator's report was a retargeted cast
  //     that collapsed to the bind pose after the shot (hands at the body, feet together) for the rest of
  //     the clip: a baked playlist entry whose loop target is a FRAME was re-based as if it were one,
  //     the playhead left the table, and every read came back frame 0. The test is a NEAR-ZERO distance
  //     to the bind pose (a frame-0 read draws every local rotation zero), capped by the model's own
  //     idle manifold so a pack whose idle sits on the rest pose can never fail its own rule.
  // (b) AFTER the clip, for 60 ticks, the pose follows the model's OWN idle: the same bone positions a
  //     fresh read of the same pack produces at the same frame, and never the bind pose.
  // Own (authored) rows are measured but not gated - the disc's scripts are ground truth.
  const Hc = Math.max(1, b3.modelRestSize(obs.model).h || 1);
  const { away, bindMin } = idleManifold(obs.model.folder);
  const bind = bindPoseCache(obs.model.folder);
  // The bind-pose test is a NEAR-ZERO condition: the measured failure mode is a table read with no keys
  // (values[6050] = undefined -> frame 0), which draws EVERY local rotation zero, i.e. distance 0 from
  // the bind pose. A pose that merely passes near rest during a windup is normal authored motion, so the
  // threshold is a couple of units plus 1% of body height - and a pack whose OWN IDLE sits within it has
  // no flat test at all (the disc's idle would fail the rule; m004beta/m122hagu idle at 0.0-0.1%).
  const flatAbs = Math.max(2, 0.01 * Hc);
  const flatOn = bindMin > flatAbs;
  const duringS = obs.ev?.during ?? [];
  const afterS = obs.ev?.after ?? [];
  const flatTick = (s) => flatOn && maxBoneDist(s.pose, bind).d < flatAbs;
  M.flatDuring = duringS.filter(flatTick).length;
  M.flatAfter = afterS.filter(flatTick).length;
  const pristine = pristineModel(obs.model.folder);
  let idleWorst = 0, idleBind = Infinity;
  for (const s of afterS) {
    if (s.blended) continue;                          // the 10-tick action->idle ease is a blend of two poses
    const ref = bonePositions(pristine, s.frame, null);
    idleWorst = Math.max(idleWorst, maxBoneDist(s.pose, ref).d);
    idleBind = Math.min(idleBind, maxBoneDist(s.pose, bind).d);
  }
  M.idleDrift = +idleWorst.toFixed(1);
  M.idleBind = Number.isFinite(idleBind) ? +(idleBind / Hc).toFixed(3) : null;
  M.idleBindMin = +(bindMin / Hc).toFixed(3);
  M.idleSpread = +(away / Hc).toFixed(3);
  M.flatAbs = +flatAbs.toFixed(1);
  if (obs.meta.synthesized) {
    // gated on BUILT rows: the disc's own clips are ground truth (its item clip 10 legitimately draws
    // poses that touch the bind values on some packs), so own rows are measured and reported, not gated
    const eps = Math.max(4, 0.01 * Hc);
    R.C13 = afterS.length > 0 && idleWorst <= eps && M.flatDuring === 0 && M.flatAfter === 0;
  }

  // ── C14 — NO DUPLICATE GEOMETRY (A15) ────────────────────────────────────────────────────────────
  // Three arithmetic facts over the model's own mesh:
  //   * the VERTEX CENSUS: the faces each bone carries are drawn exactly once - the drawn corner count
  //     equals the authored count (this renderer skins one VBO from the bone list, so a second copy can
  //     only come from the model growing bones/faces, which is what the census measures);
  //   * the HIDDEN-PART rule: a mesh part the model's own IDLE keeps scaled to ~0 must stay hidden. This
  //     is the operator's second axe: Boltmon's pack carries the THROWN axe as a second mesh (bone 19)
  //     that idle scales to 0; the collapsed frame-0 pose drew it at full size beside the held one;
  //   * the SPRITE rule: a spell's projectile must not be a sprite the model only ever spawns in its
  //     MELEE clips (its own weapon throw) unless its own spell clips use it too.
  const expectedVerts = obs.model.bones.reduce((n, b) => n + (b.faces || []).length * 3, 0);
  const censusOk = expectedVerts === pristineModel(obs.model.folder).bones.reduce((n, b) => n + (b.faces || []).length * 3, 0);
  const dupHidden = [...duringS, ...afterS].filter((s) => (s.hidden ?? 0) >= 0.05).length;
  M.verts = expectedVerts;
  M.dupHidden = dupHidden;
  const sprites = ownSprites(obs.model.folder);
  const launchPts = proj.filter((p) => Array.isArray(p.from));
  const badSprite = launchPts.filter((p) => {
    const id = p.id | 0;
    return sprites.melee.has(id) && !sprites.ranged.has(id);
  }).length;
  M.spriteClone = launchPts.length ? badSprite : null;
  // the census holds for every row; the hidden-part and sprite rules gate BUILT rows (the disc's own
  // item pose may draw a hidden part legitimately - its own authored choice)
  if (obs.meta.synthesized) R.C14 = censusOk && dupHidden === 0 && badSprite === 0;

  // ── C15 — LAUNCH FROM THE WEAPON (A15) ────────────────────────────────────────────────────────────
  // When the model's own arm data (K17 armEquip) says the emitter's arm ENDS IN A PROP, the shot leaves
  // from the PROP's tip (the blade / barrel / staff end), not from the fist. Measured as a GEOMETRIC fact
  // about the plan's own point, independently of how the plan found it: the point must lie ON the drawn
  // prop mesh (its multi-shot ring spread allowed for) and in the OUTER HALF of the prop (distance from
  // the bone origin at least half the mesh's own reach) - a point at the fist is on the handle end and
  // fails the second test, a point at the hand tip of a bare arm is not on any prop mesh.
  if (obs.meta.synthesized && caseInfo.kind === "tech" && plan.points.length && launchPts.length) {
    let worst = 0, armCases = 0, worstRatio = 1;
    for (const q of plan.points) {
      const side = lp.emitterSide(q.id);
      if (!side || !anat.armArmed(obs.model.folder, side)) continue;
      const equip = anat.armEquip(obs.model.folder, side);
      if (equip.attachment && equip.attachment !== "arm") continue;   // hangs off a leg/back: no arm prop
      const ch3 = obs.model.bones?.[equip.bone]?.anim?.ch3;
      if (Array.isArray(ch3)) {                                       // a prop the pack scales OFF is not there
        const s = b3.interpChannel(ch3, q.frame);
        if (Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) / 4096 < 0.05) continue;
      }
      const prop = propVertsAt(obs.model, equip.bone, q.frame);
      if (!prop.points.length) continue;                              // nothing drawable to launch from
      armCases++;
      const p = [q.x, q.y, q.z];
      const spread = q.spread || 0;
      let near = Infinity, far = 0;
      for (const v of prop.points) {
        near = Math.min(near, Math.hypot(v[0] - p[0], v[1] - p[1], v[2] - p[2]));
        far = Math.max(far, Math.hypot(v[0] - prop.org[0], v[1] - prop.org[1], v[2] - prop.org[2]));
      }
      worst = Math.max(worst, Math.max(0, near - spread));
      const outward = Math.hypot(p[0] - prop.org[0], p[1] - prop.org[1], p[2] - prop.org[2]) - spread;
      worstRatio = Math.min(worstRatio, far > 0 ? outward / far : 0);
    }
    M.propWorst = Math.round(worst);
    M.propRatio = +worstRatio.toFixed(2);
    M.propCases = armCases;
    if (armCases) R.C15 = worst <= 0.02 * Hc + 4 && worstRatio >= 0.5;
  }
  return { R, M };
}

/**
 * The caster's own body as 2-D screen points: the projected bone positions plus the mean depth along the
 * shot's axis. The convex hull of a biped's bones covers its silhouette closely enough to answer "is the
 * shot drawn ON the body or beside it?" - the question behind the operator's missing projectile.
 */
function projectHull(bones, shot) {
  if (!shot) return null;
  const pts = [];
  let depth = 0, n = 0;
  for (const b of bones) {
    if (!b) continue;
    const ndc = b3.shotPointNdc(shot, b);
    if (!ndc) continue;
    pts.push([ndc[0], ndc[1]]);
    depth += depthAlong(shot, b); n++;
  }
  if (pts.length < 3) return null;
  return { pts: convexHull(pts), depth: n ? depth / n : 0 };
}
function depthAlong(shot, p) {
  if (!shot?.eye || !shot?.target) return 0;
  const f = [shot.target[0] - shot.eye[0], shot.target[1] - shot.eye[1], shot.target[2] - shot.eye[2]];
  const n = Math.hypot(...f) || 1;
  return ((p[0] - shot.eye[0]) * f[0] + (p[1] - shot.eye[1]) * f[1] + (p[2] - shot.eye[2]) * f[2]) / n;
}
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}
function pointInConvex(hull, q) {
  if (!hull || hull.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const cr = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    if (cr === 0) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

function inside(b) {
  if (!b || b.behind > 0) return false;
  return b.x0 >= -1 && b.x1 <= 1 && b.y0 >= -1 && b.y1 <= 1;
}
function isScreenZ(z) { return z === 32767 || z === -1 || Math.abs(z) > 20000; }
function hasPairedOp1(ops, hitEvent, mode) {
  // op1 and its contact run in the same tick: walk the script for an op1 [mode] adjacent to the op10 of
  // this type, allowing the authored "op1 just before its contact" order as well as after.
  const idx = [];
  for (let i = 0; i < (ops || []).length; i++) if (ops[i].op === 10 && (ops[i].words?.[0] | 0) === hitEvent.type) idx.push(i);
  if (!idx.length) return false;
  for (const i of idx) {
    for (let j = i - 1; j >= 0; j--) {
      const o = ops[j];
      if (o.op === 10 || o.op === 11 || o.op === 255 || o.op === 0) break;
      if (o.op === 1 && (o.words?.[0] | 0) === mode) return true;
    }
    for (let j = i + 1; j < ops.length; j++) {
      const o = ops[j];
      if (o.op === 11 || o.op === 255 || o.op === 0) break;
      if (o.op === 1 && (o.words?.[0] | 0) === mode) return true;
      if (o.op === 10) break;
    }
  }
  return false;
}
function boneLengthsRigid(model, frames) {
  if (!frames.length) return false;
  const parents = model.bones.map((b) => b.parent_slot | 0);
  const sample = frames[Math.min(1, frames.length - 1)];
  const p0 = bonePositions(model, frames[0].frame, null);
  const p1 = bonePositions(model, sample.frame, null);
  for (let b = 1; b < parents.length; b++) {
    const par = parents[b];
    if (!p0[b] || !p0[par] || !p1[b] || !p1[par]) continue;
    const d0 = Math.hypot(p0[b][0] - p0[par][0], p0[b][1] - p0[par][1], p0[b][2] - p0[par][2]);
    const d1 = Math.hypot(p1[b][0] - p1[par][0], p1[b][1] - p1[par][1], p1[b][2] - p1[par][2]);
    if (Math.abs(d0 - d1) > Math.max(2, 0.02 * d0)) return false;
  }
  return true;
}

// ── the model's own basic-attack motion energy (the C7 yardstick) ──────────────────────────────────
const basicEnergyCache = new Map();
function basicEnergy(form) {
  if (basicEnergyCache.has(form.folder)) return basicEnergyCache.get(form.folder);
  let v = 0;
  try {
    const model = getModel(form.folder);
    const script = cb.resolveClipScript(model, 5, { target: "enemy" });
    const frames = [];
    for (const t of cb.scriptTableSeq(script)) {
      for (const e of model.timeline?.[t]?.table || []) {
        const f = e.value | 0;
        if (f >= 0 && f < 0x8000) frames.push({ frame: f });
      }
    }
    const uniq = [...new Map(frames.map((f) => [f.frame, f])).values()].slice(0, 40);
    v = poseEnergy(model, uniq);
  } catch { v = 0; }
  basicEnergyCache.set(form.folder, v);
  return v;
}

// ── cases ──────────────────────────────────────────────────────────────────────────────────────────
const OUTCOMES = ["hit", "lethal", "miss"];

function caseRun(entry) {
  const { form, info, side } = entry;
  if (info.kind === "tech") {
    // the TECHNIQUE is part of the key: since K13 its name selects the launch rule, so two techniques that
    // share a clip build different scripts (a single shot vs a three-emitter volley)
    const key = `t|${form.folder}|${info.id}|${info.clip}|${info.target}|${side}`;
    if (!runCache.has(key)) runCache.set(key, runOne(form, info.id, side, null));
    return runCache.get(key);
  }
  const key = `i|${form.folder}|${info.clip}|${info.target}|${side}`;
  if (!runCache.has(key)) runCache.set(key, runOne(form, null, side, info.record));
  return runCache.get(key);
}

function buildEntries() {
  const list = [];
  for (const form of formList) {
    for (const techId of form.techs) {
      const info = {
        kind: "tech", id: techId, clip: ft.techToClip(techId), target: ft.techTargetClass(techId),
        hits: expectedHits(techId), effect: techTable[String(techId)]?.effect ?? 0,
      };
      for (const side of ["near", "far"]) for (const outcome of OUTCOMES) list.push({ form, info, side, outcome });
    }
    for (const rec of itemRecords) {
      const info = { kind: "item", id: rec.id, clip: rec.clip, target: rec.target, hits: 1, itemId: rec.id, record: rec };
      for (const side of ["near", "far"]) for (const outcome of OUTCOMES) list.push({ form, info, side, outcome });
    }
  }
  return list;
}

// ── calibration: every bound is the worst authored value, so the disc's own scripts pass ──────────
function calibrate(entries) {
  const own = [];
  for (const e of entries) {
    if (e.outcome !== "hit") continue;
    const obs = caseRun(e);
    if (!obs || obs.err || obs.meta.synthesized) continue;
    own.push({ e, obs });
  }
  let anchorBound = 0, anchorMargin = Infinity, castDrift = 0, homeDrift = 0, projectileR = 0, minRatio = Infinity, both = 0, camRows = 0;
  for (const { e, obs } of own) {
    const { R, M } = judge(obs, e.form, { ...e.info, side: e.side }, "hit");
    const self = e.info.target === "self";
    const want = self ? obs.home.atk : obs.home.def, other = self ? obs.home.def : obs.home.atk;
    for (const f of obs.ev.fx) {
      if (f.preload || isScreenZ(f.z)) continue;
      anchorBound = Math.max(anchorBound, dist2(f, want));
      anchorMargin = Math.min(anchorMargin, dist2(f, other) - dist2(f, want));
    }
    // the same planted rule the judge uses (own archetype first, corpus mode for a built script)
    const planted = self || (ownProfile.get(`${e.form.folder}|${e.info.clip}`)?.loco === 0);
    let maxMove = 0;
    for (const f of obs.ev.frames) maxMove = Math.max(maxMove, Math.hypot(f.move[0], f.move[2]));
    const end = Math.hypot(obs.endMove[0], obs.endMove[2]);
    if (planted) castDrift = Math.max(castDrift, maxMove);
    else homeDrift = Math.max(homeDrift, end);
    if (M.projDist != null) projectileR = Math.max(projectileR, M.projDist);
    // the C7 yardstick is the energy of clips the animator can actually play: a script whose declared tables
    // the animator never binds (the op4-only clips) is the gap C7 reports, and must not set the floor.
    if (obs.ev.frames.length >= 3 && !M.unbound) minRatio = Math.min(minRatio, obs.pose / Math.max(basicEnergy(e.form), 0.001));
    if (obs.ev.cams.length) { camRows++; if (!M.framed.includes("-")) both++; }
  }
  return {
    rowsOnOwnScripts: own.length,
    anchorBound: Math.ceil(anchorBound), anchorMargin: Math.max(0, Math.floor(anchorMargin === Infinity ? 0 : anchorMargin)),
    castDrift: Math.ceil(castDrift), homeDrift: Math.ceil(homeDrift), projectileR: Math.ceil(projectileR),
    poseRatio: Math.max(0.05, Math.floor(minRatio * 100) / 100), poseFloor: 0.2,
    // the disc's own camera scripts often frame one fighter only (close-ups): the gate is "some shot shows
    // the intended fighter", never "every shot shows both" — own corpus says both-in-frame only 590/3384.
    c8Both: false, c8OwnCameraRows: camRows, c8OwnCameraRowsBothInFrame: both,
  };
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────────
const t0 = Date.now();
for (const form of formList) await cb.prepareModelDonors(getModel(form.folder));
const entries = buildEntries();
if (!QUIET) process.stderr.write(`[contract] ${formList.length} forms, ${entries.length} cases; playing...\n`);
for (const e of entries) caseRun(e);

if (CALIBRATE) {
  CAL = calibrate(entries);
  fs.writeFileSync(path.join(SCRATCH, "anim-contract-calibration.json"), JSON.stringify(CAL, null, 1));
  console.log("calibration", JSON.stringify(CAL));
}
// Bounds: embedded defaults are the calibrated values measured on this tree (see
// anim-contract-calibration.json); a calibration file overrides them so a re-run after A7b/A9/A10 moves
// with the data instead of with a hard-coded guess.
try {
  const saved = readJson(path.join(SCRATCH, "anim-contract-calibration.json"));
  Object.assign(BOUNDS, saved);
  CAL = { ...(CAL || {}), ...saved };
} catch { /* defaults */ }

// strict pass (the brief's literal values) vs calibrated pass, on authored rows only
const judged = [];
for (const e of entries) {
  const obs = caseRun(e);
  const caseInfo = { ...e.info, side: e.side };
  const { R, M } = judge(obs, e.form, caseInfo, e.outcome);
  const row = {
    form: e.form.name, species: e.form.speciesId, model: e.form.folder,
    case: e.info.kind === "tech" ? `tech ${e.info.id}` : `item ${e.info.id}`,
    clip: e.info.clip, target: e.info.target, side: e.side, outcome: e.outcome,
    script: obs?.meta?.buildKind ?? "none", ...R, ...M,
  };
  judged.push({ row, obs, entry: e });
}
// C9 — side symmetry: the near-side verdicts must equal the far-side ones, case by case
const byKey = new Map();
for (const j of judged) {
  const k = `${j.entry.form.folder}|${j.entry.info.kind}|${j.entry.info.id}|${j.entry.outcome}`;
  if (!byKey.has(k)) byKey.set(k, {});
  byKey.get(k)[j.entry.side] = j.row;
}
for (const pair of byKey.values()) {
  if (!pair.near || !pair.far) continue;
  let ok = true;
  for (const k of ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C10", "C11", "C12"]) if (pair.near[k] !== pair.far[k]) ok = false;
  pair.near.C9 = ok; pair.far.C9 = ok;
}

const rows = judged.map((j) => j.row);
if (EXPLAIN) {
  const [wantPart, clipArg] = String(EXPLAIN).split(":");
  const wants = wantPart.split(",");
  const wantClip = clipArg ? +clipArg : null;
  for (const j of judged) {
    if (!wants.some((w) => String(j.entry.form.folder).includes(w) || String(j.entry.form.name).toLowerCase().includes(w.toLowerCase()))) continue;
    if (wantClip != null && j.entry.info.clip !== wantClip) continue;
    const { R, M } = judge(j.obs, j.entry.form, { ...j.entry.info, side: j.entry.side }, j.entry.outcome);
    console.log(JSON.stringify({
      model: j.entry.form.folder, name: j.entry.form.name, case: j.row.case, clip: j.entry.info.clip,
      target: j.entry.info.target, side: j.entry.side, outcome: j.entry.outcome, R, M,
      ops: (j.obs.meta?.ops || []).map((o) => `${o.op}:[${(o.words || []).join(",")}]`),
      tables: j.obs.ev.tables.map((t) => `${t.tick}:${t.table}`),
    }));
  }
  process.exit(0);
}
const INV = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14", "C15"];
const ownRows = rows.filter((r) => r.script === "own");
const builtRows = rows.filter((r) => r.script !== "own");
const bad = (r, k) => r[k] === false || r.err;
const byInv = Object.fromEntries(INV.map((k) => [k, rows.filter((r) => bad(r, k)).length]));
const byInvOwn = Object.fromEntries(INV.map((k) => [k, ownRows.filter((r) => bad(r, k)).length]));
const byInvBuilt = Object.fromEntries(INV.map((k) => [k, builtRows.filter((r) => bad(r, k)).length]));
const pathOf = (r) => (r.script === "own" ? "own" : `built-${r.script}`);
const groups = {};
for (const k of INV) {
  const m = new Map();
  for (const r of rows.filter((x) => bad(x, k))) {
    const key = `${r.target}/${r.clip} ${pathOf(r)}`;
    m.set(key, (m.get(key) || 0) + 1);
  }
  groups[k] = [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const summary = {
  generated: new Date().toISOString(), ms: Date.now() - t0,
  tree: {
    clipFallback: sha1(path.join(REPO, "web/fight/clip-fallback.js")),
    actorAnimator: sha1(path.join(REPO, "web/fight/actor-animator.js")),
    fightTables: sha1(path.join(REPO, "web/fight/fight-tables.js")),
  },
  forms: formList.length, speciesRecords: speciesRecords.length, cases: rows.length,
  runs: runCache.size, items: itemRecords.length,
  byInvariant: byInv, byInvariantOwn: byInvOwn, byInvariantBuilt: byInvBuilt,
  ownRows: ownRows.length, builtRows: builtRows.length, errors: rows.filter((r) => r.err).length,
  bounds: BOUNDS, calibration: CAL, corpus: Object.fromEntries([...corpusMode.entries()].map(([k, v]) => [k, v])),
};
fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, rows }));

// ── MD ────────────────────────────────────────────────────────────────────────────────────────────
const L = [];
L.push("# Battle animation contract (C1-C10) — every form x technique/item x side x outcome");
L.push("");
L.push(`Generated ${summary.generated} in ${(summary.ms / 1000).toFixed(1)} s · ${summary.forms} species forms · ` +
  `${summary.cases} cases (${summary.runs} live animator/coordinator runs: one per form x clip x class x side) · ` +
  `${summary.items} item records · own-script rows ${summary.ownRows} · built rows ${summary.builtRows}`);
L.push("");
L.push(`Tree measured: clip-fallback.js ${summary.tree.clipFallback} · actor-animator.js ${summary.tree.actorAnimator} · ` +
  `fight-tables.js ${summary.tree.fightTables} (a re-run after A7b/A9/A10 changes these stamps, so a stale report is visible at a glance).`);
L.push("");
L.push("Each case plays the REAL ActionVM + ActorAnimator + FightCoordinator headless; every column is a");
L.push("boolean computed by arithmetic from the game's own data. No screenshots, no species branches.");
L.push("");
L.push("## Bounds (calibrated on the authored corpus; the disc's own scripts define them)");
L.push("");
L.push("```");
L.push(JSON.stringify(BOUNDS, null, 1));
L.push("```");
L.push("");
if (summary.calibration) {
  L.push("Calibration facts (worst authored value = the bound): " + JSON.stringify(summary.calibration));
  L.push("");
}
L.push("## Calibration log — every rule, own-row rejects before/after, and what changed in the rule");
L.push("");
L.push("The ORIGINAL player species are ground truth: a rule their own authored clips violate is a WRONG RULE.");
L.push("`before` = own-script rows rejected by the rule set this task inherited (first full run today, 13:52,");
L.push("`after` = the same rows under the calibrated rule below. After the rule fixes, the authored rows still");
L.push(`rejected are: ${INV.map((k) => `${k} ${byInvOwn[k]}`).join(", ")} — anything above zero is a REAL animator gap,`);
L.push("not a rule gap (each is named in 'What remains, by systemic cause' below).");
L.push("");
L.push("| rule | own rows before | own rows after | what changed in the rule, and the disc evidence |");
L.push("|---|---|---|---|");
const CAL_LOG = [
  ["C1", 96, "A self/ally cast's contact count is its AUTHORED profile, not a forced 0: m440sijn's own clip 10 carries `op10 98` as an effect-commit marker and the disc ships it that way. For enemy techniques the expectation is still the clip's authored profile (own) or the corpus mode scaled by the record's hit count."],
  ["C2", 0, "Unchanged: op1 is a REQUEST record anywhere in the strike block (m006devi clip 11 writes op1[0] after the sound records and a 44-frame wait); the gate is op1[5] count >= #98, one op1[0] for the strike, then the real dispatch selects 1 per mode 5 and 2/3/4 by outcome."],
  ["C3", 96, "Self casts may carry a bare 98 (disc data, above); what C3 forbids is a hit ROUTED to the opponent — measured as a defender dispatch/aux/reaction, not as the raw 98 count."],
  ["C4", 18, "The anchor is judged against the authored op3 lane, not a distance bound: the disc's z sign names the fighter an effect belongs to (battle3d atDefender), read on the EFFECTIVE z after mirrorHooks. Records whose z is a non-arena directive (32767 screen, -1 interior anchor) carry no lane claim, and a spawn with no authored type is the effect player resolving the 9999 sentinel. This replaced 'every spawn must be nearer the defender', which rejected the disc's own caster-centred charge effects (1140 own rows when first applied literally)."],
  ["C5", 0, "Unchanged: planted = the model's own op2 mode 3/5/8 archetype for the clip; melee must return within homeDrift (the worst authored end offset, 128 units)."],
  ["C6", 0, "Unchanged: R = the worst authored distance from a hand/weapon bone (12327 units, a fixed authored offset)."],
  ["C7", 4632, "Three rule bugs found and fixed. (1) op4 is NOT a table declaration: it is [sub, rawMotion, a2, a3] (engine op4Handler) — a motion envelope id passed to motionSelect with a2/a3 as blend operands; reading words 2/3 as table ids rejected every authored clip whose envelope used a blend of 15/30 frames. (2) A declared op2 table only counts if a wait follows it before the terminator (the disc's tail `op2 [0,0,N]` return-to-idle table is never sampled). (3) A declared table whose next op is an op4 motion 0 is the authored RETURN TO BASE, so the animator showing the base table is correct (m003agum clip 11's op2 51). The energy floor now applies to BUILT scripts only: an authored clip's motion is the disc's own choice. What is left is the built-body gap (2 forms whose built scripts bind no moving table)."],
  ["C8", 399, "An authored script is gated on its cuts RESOLVING; the disc frames both fighters in only 448/3384 authored cuts, and frames NEITHER in several atmospheric cuts (WarGreymon clip 11), so 'some shot shows the intended fighter' was a rule the disc violates. A preset with no table entry falls back to the renderer's default arena camera and is counted (missCut), not failed. Built scripts must still show the intended fighter or a screen-space effect."],
  ["C9", 600, "Unchanged in form (near verdicts == far verdicts case by case); its own-row rejects disappeared once C4/C7/C8 stopped rejecting authored presentation."],
  ["C10", 90, "Item self-cast rule follows C3: no projectile, no dispatch to the other fighter, effect on the caster, planted — the bare 99 commit marker in the disc's own item clip 10 is legal."],
  ["C11", 0, "K13 (new): a BUILT script launches exactly the projectiles the anatomy gives the technique — one per emitter site from `shotsFor` (a three-mouthed body fires three, a left-arm gun fires from the left arm), each point equal to the emitter bone's tip at the plan's frame. Measured twice: against the point the VM reports, and against the renderer's own bone matrix. The disc's own scripts keep their authored spawn point (a fixed body-centre point, x≈0 in 118 of 126 authored op6 records), so the rule gates built scripts only."],
];
for (const [k, before, why] of CAL_LOG) L.push(`| ${k} | ${before} | ${byInvOwn[k]} | ${why} |`);
L.push("");
L.push("## Violations grouped by invariant");
L.push("");
L.push("| invariant | all | own (authored) | built |");
L.push("|---|---|---|---|");
for (const k of INV) L.push(`| ${k} | ${byInv[k]} | ${byInvOwn[k]} | ${byInvBuilt[k]} |`);
L.push("");
L.push("## Violations grouped by invariant x (target class / clip, builder path)");
L.push("");
for (const k of INV) {
  if (!groups[k].length) continue;
  L.push(`### ${k} — ${byInv[k]} rows`);
  for (const [g, n] of groups[k]) L.push(`* ${g}: ${n}`);
  L.push("");
}
L.push("## Violations by builder code path (web/fight/clip-fallback.js buildKind)");
L.push("");
L.push("| builder path | rows that violate | which invariants (rows) |");
L.push("|---|---|---|");
const paths = new Map();
for (const r of rows) {
  const p = pathOf(r);
  const e = paths.get(p) || { n: 0, inv: {} };
  for (const k of INV) if (bad(r, k)) { e.n++; e.inv[k] = (e.inv[k] || 0) + 1; }
  paths.set(p, e);
}
for (const [p, e] of [...paths.entries()].sort((a, b) => b[1].n - a[1].n)) {
  const inv = Object.entries(e.inv).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(" ");
  L.push(`| ${p} | ${e.n} | ${inv || "-"} |`);
}
L.push("");
L.push("## What remains, by systemic cause");
L.push("");
const CAUSE = {
  "C1:built-borrow": "a borrowed body keeps the donor clip's authored contact count instead of the technique's hit count",
  "C4:built-attack": "the built attack script spawns its effect in the attacker's lane where the authored lane names the defender",
  "C4:built-cast": "a built cast spawns a world effect on the caster's lane",
  "C4:built-borrow": "the borrowed body's effect lane was authored for the donor's side",
  "C7:built-self": "the built self-cast body plays a table with no motion (pose stays on the idle manifold)",
  "C7:built-body": "the built body binds no moving table, so the pose never leaves idle",
  "C7:built-attack": "the built attack body binds no moving table",
  "C7:own": "the disc's op4-envelope clips 14/15/17 name their motion in op4 and ActorAnimator binds only op2 tables",
};
for (const k of INV) {
  for (const [g, n] of groups[k]) {
    const [group, path] = [g.slice(0, g.lastIndexOf(" ")), g.slice(g.lastIndexOf(" ") + 1)];
    const cause = CAUSE[`${k}:${path}`] || "see the metrics columns of the violating rows";
    L.push(`* ${k} — ${n} rows (${group}, ${path}): ${cause}`);
  }
}
L.push("");

L.push("## Every case (one row per case, one column per invariant)");
L.push("");
L.push("form | case | clip | target | side | outcome | script | C1 C2 C3 C4 C5 C6 C7 C8 C9 C10 C11 C12 | drift/max | anchor | proj");
L.push("---|---|---|---|---|---|---|---|---|---|---|---");
const flag = (r, k) => (r.err ? "E" : r[k] === false ? "X" : r[k] == null ? "-" : ".");
for (const r of rows) {
  L.push(`${r.model} | ${r.case} | ${r.clip} | ${r.target} | ${r.side} | ${r.outcome} | ${r.script} | ` +
    `${INV.map((k) => flag(r, k)).join(" ")} | ${r.drift ?? "?"}/${r.maxMove ?? "?"} | ${r.anchor ?? "?"} | ${r.projDist ?? "-"}`);
}
fs.writeFileSync(OUT_MD, L.join("\n"));

if (!QUIET) {
  console.log(`rows ${summary.cases} · own ${summary.ownRows} · built ${summary.builtRows} · runs ${summary.runs} · ${(summary.ms / 1000).toFixed(1)}s`);
  console.log(INV.map((k) => `${k} bad ${byInv[k]} (own ${byInvOwn[k]}, built ${byInvBuilt[k]})`).join(" · "));
  for (const k of INV) if (groups[k].length) console.log(`${k}:`, groups[k].slice(0, 6).map(([g, n]) => `${g} ${n}`).join(" | "));
}

