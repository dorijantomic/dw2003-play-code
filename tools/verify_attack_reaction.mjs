#!/usr/bin/env node
// verify_attack_reaction.mjs — a landed attack must be OBSERVABLE ON THE VICTIM, not on the attacker.
//
// Why it exists (A7a, brief /home/dorij/scratch-research/BRIEF4.md Phase 4c)
//   The operator's report on the new partner build: (1) with Raijinmon as our Digimon, the "being hit"
//   effect plays on RAIJINMON's own body instead of on the enemy; (2) when the blow KILLS the enemy, the
//   enemy never plays its death animation. Both are properties of a landed attack, so this harness fights a
//   real exchange in the real renderer — attacker on one arena side, a real defender on the other — and
//   measures the two facts the operator can see:
//
//   (a) REACTION. The defender's own animator must start the reaction clip the disc's op1 dispatch selects:
//       clip 1 on every intermediate contact (op10 98), then clip 2 (survive) / 3 (death, on a lethal blow) /
//       4 (evade, on a miss) at the damage strike (op10 99). Measured as the (tick, clip) events off the
//       defender's ActorAnimator plus the ticks each clip actually ran, so "the death animation played" is a
//       number. All three outcomes are played: hit, lethal, miss.
//
//   (b) STRIKE-EFFECT PLACEMENT. The hit-spark / strike effect the script spawns at the damage strike must
//       land on the DEFENDER's body and not the ATTACKER's. Two authored forms exist on the disc and both
//       are judged in their own terms:
//         world-space op3 (z is an arena coordinate) — the effect's PS1 arena z is compared with the two
//             fighters' home slots. The disc authors these AT the victim: near-side packs put them at
//             z=+5120 and far-side packs at z=-5120, the far/near home line (scan of the 249 packs).
//         screen-space op3 (z = 32767 / -1) — the sprite is drawn at the screen centre, so it lands on
//             whichever fighter the camera is built around. The camera ray through the sprite's draw point
//             is tested against both fighters' body boxes; it must hit the DEFENDER and not the ATTACKER.
//             This is the form the compact clip-5 build uses, which is why it read as "the effect plays on
//             Raijinmon".
//       Plus the assertions the A1 harness established for the attacker (tools/verify_clip_animates.mjs):
//       the clip ends, the bones move off the model's own idle manifold, the op10 98/99 contact markers
//       fire, and the attacker returns to idle — so a run that fails here cannot be mistaken for a good one.
//
// Camera: the battle's own rule. The idle director exists while the command menu is up; the confirm edge
//   retires it and holds the plain arena shot; for the rest of the attack nothing re-publishes — so a script
//   is judged through the shot IT installs (op5), or through the arena shot when it installs none. The
//   renderer's own tickSim is used (render(1/60) per step), so camera record, both actors and the effect
//   sprites advance exactly as they do in the game.
//
// NOTE the file name: tools/verify_hit_reaction.mjs already exists in this tree and asks a different
//   question (the old red hit-flash), so this tool is named for what it asserts. Post THIS usage to A7b.
//
// Usage (the repo's Playwright needs the lib bundle, so run it through the wrapper):
//   tools/run-playwright.sh tools/verify_attack_reaction.mjs --model m441raiz,m175krsr,m440sijn,m005grey --clip 5
//   tools/run-playwright.sh tools/verify_attack_reaction.mjs --all --clips 5,9,10 --side both \
//       --outcomes hit,lethal --json /home/dorij/scratch-research/anim-a7a.json \
//       --md /home/dorij/scratch-research/anim-a7a-table.md
//
// Options
//   --model <folder[,folder]>  attacker model folder(s), as in web/assets/battle/models/<folder>
//   --all                      every folder in web/assets/battle/models/index.json
//   --exclude <folder[,folder]> folders to leave out of --all
//   --clip <n[,n]> / --clips   action clip number(s) to play through the technique that selects it (default 5)
//   --side near|far|both       near = the player slot, far = the enemy slot (default near)
//   --outcomes hit,lethal,miss which outcomes to play (default all three for --model, hit+lethal for --all)
//   --defender <folder>        the model standing opposite (default m051kuwa, Kuwagamon: every reaction clip, and
//                              a wild Digimon's staging record, so its canned victim shots resolve — a partner
//                              record carries no shot field and the op5 victim preset falls back to the arena shot)
//   --tech <n>                 override the technique used for every clip (default: lowest tech id per clip)
//   --max-ticks <n>            ticks allowed before the exchange counts as not ending (default 900)
//   --shots / --no-shots       save a PNG of the strike frame per run (default on for --model runs)
//   --out <dir>                strike-frame directory; default /home/dorij/scratch-research/anim-sheets
//   --port <n>                 static server port; default 8107
//   --json <path>              every run's numbers
//   --md <path>                PASS/FAIL markdown table
//   --quiet                    no per-run lines (the files are still written)
//   --techs <id[,id]>          case set from the technique table (digimon.json "skills"): each id is played
//                              through its own clip, and its type (heal/support vs attack) picks the target
//                              class — self/ally => no reaction, effect on the caster; else reaction on the defender
//   --reload-every <n>         fresh page every n model loads (default 40; the renderer dies earlier on some boxes)
//   --canvas <WxH>             resize the lab's drawing buffer (census speed lever; assertions are analytic)
//   --no-draw                  silence the rasterizer: every asserted quantity is computed before the draw calls
//
// Exit code: 0 when every run passed, 1 when any run failed (the table names the failing assertion).
import { createServer } from "node:http";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const MODELS = resolve(ROOT, "web/assets/battle/models");
const TECH_TABLE = resolve(ROOT, "web/assets/data/fight_tech_table.json");
const DEFAULT_OUT = "/home/dorij/scratch-research/anim-sheets";
const STEP = 1 / 60;            // one 60 Hz logic tick, as the battle runs it

// ── thresholds ────────────────────────────────────────────────────────────────
// (0) the attacker's clip must animate — the A1 harness's calibration, reused
const ROT_FLOOR = 0.06;
const OFF_IDLE_MIN = 0.15;
const TRANS_FLOOR = 8;
const RETURN_ROT_MAX = 0.12;
const RETURN_MOVE_MAX = 24;
// (b) the strike effect. World: PS1 arena units along the arena axis (the two homes are ±~5.5k apart, so a
// spark authored at the victim is within ~1.5k of its slot and >9k from the attacker's).
const W_Z_BOUND = 2800;
const W_Z_GAP = 2000;
// Screen: no pixel bound is used — the sprite is drawn at the screen centre, so the test is whether the
// camera ray through that pixel passes through the DEFENDER's body box and not the ATTACKER's.
// (a) the defender must actually RUN its reaction, not merely be assigned the clip
const DEF_MIN_TICKS = 8;

// ── args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opt = { models: [], all: false, clips: [5], sides: ["near"], outcomes: null, defender: "m051kuwa",
                attackClips: [5, 9], tech: null, maxTicks: 900, shots: null, out: DEFAULT_OUT, port: 8107,
                json: null, md: null, quiet: false, exclude: [], progress: null, reloadEvery: 40, canvas: null,
                techs: [], noDraw: false };
  const list = (v) => String(v).split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { const v = argv[++i]; if (v == null) throw new Error(`${a} needs a value`); return v; };
    if (a === "--model") opt.models.push(...list(next()));
    else if (a === "--all") opt.all = true;
    else if (a === "--exclude") opt.exclude.push(...list(next()));
    else if (a === "--clip" || a === "--clips") opt.clips = list(next()).map(Number);
    else if (a === "--side") { const s = next(); opt.sides = s === "both" ? ["near", "far"] : [s]; }
    else if (a === "--outcomes") opt.outcomes = list(next());
    else if (a === "--attack-clips") opt.attackClips = list(next()).map(Number);
    else if (a === "--defender") opt.defender = next();
    else if (a === "--tech") opt.tech = Number(next());
    else if (a === "--max-ticks") opt.maxTicks = Number(next());
    else if (a === "--shots") opt.shots = true;
    else if (a === "--no-shots") opt.shots = false;
    else if (a === "--out") opt.out = resolve(next());
    else if (a === "--port") opt.port = Number(next());
    else if (a === "--json") opt.json = resolve(next());
    else if (a === "--md") opt.md = resolve(next());
    else if (a === "--quiet") opt.quiet = true;
    else if (a === "--progress") opt.progress = resolve(next());
    else if (a === "--reload-every") opt.reloadEvery = Math.max(1, Number(next()));
    else if (a === "--canvas") { const m = /^(\d+)x(\d+)$/.exec(next()); if (!m) throw new Error("--canvas WxH"); opt.canvas = { w: Number(m[1]), h: Number(m[2]) }; }
    else if (a === "--techs") opt.techs = list(next()).map(Number);
    else if (a === "--no-draw") opt.noDraw = true;
    else if (a === "--help" || a === "-h") { console.log("see the header of tools/verify_attack_reaction.mjs"); process.exit(0); }
    else throw new Error(`unknown option ${a}`);
  }
  if (opt.sides.some((s) => s !== "near" && s !== "far")) throw new Error("--side is near, far or both");
  if (!opt.models.length && !opt.all) throw new Error("pass --model <folder> or --all");
  if (!opt.outcomes) opt.outcomes = opt.all ? ["hit", "lethal"] : ["hit", "lethal", "miss"];
  if (opt.outcomes.some((o) => !["hit", "lethal", "miss"].includes(o))) throw new Error("--outcomes is hit, lethal, miss");
  if (opt.shots == null) opt.shots = !opt.all;
  return opt;
}

// ── static server (repo root, so web/assets' symlink works) ───────────────────
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
                ".json": "application/json", ".png": "image/png", ".css": "text/css", ".wasm": "application/wasm",
                ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".bin": "application/octet-stream" };
function serve(port) {
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
      const url = new URL(req.url, "http://local");
      const rel = decodeURIComponent(url.pathname);
      if (rel.includes("..")) throw new Error("traversal");
      const path = resolve(ROOT, "." + rel);
      if (path !== ROOT && !path.startsWith(ROOT + "/")) throw new Error("outside");
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => done(server));
  });
}

// ── the page-side bridge ──────────────────────────────────────────────────────
// One page task per run: load both fighters, retire the idle camera the way the confirm edge does, then
// play the exchange tick by tick through the renderer's own tick and sample everything the verdict needs.
const BRIDGE = async () => {
  const b3 = await import("/web/battle3d.js");
  const fxMod = await import("/web/fight/effect-player.js");
  const STEP = 1 / 60;                    // the battle's fixed 60 Hz logic step (battle3d STEP_HZ)
  const r = window.__r;
  const st = { loaded: { near: null, far: null } };
  window.__ch = st;

  st.load = async (side, folder) => {
    if (side === "near") {
      await r.setPlayerDigimon(folder);
      for (let i = 0; i < 800 && !r.playerAnimator?.model; i++) await new Promise((x) => setTimeout(x, 25));
      st.loaded.near = r.playerAnimator?.model ? folder : null;
      return !!st.loaded.near;
    }
    const before = r.enemyAnimator;
    r.setEnemyDigimon(folder);
    for (let i = 0; i < 1600; i++) {
      if (r.enemyAnimator && r.enemyAnimator !== before && r.enemyAnimator.model) break;
      await new Promise((x) => setTimeout(x, 25));
    }
    st.loaded.far = r.enemyAnimator?.model ? folder : null;
    return !!st.loaded.far;
  };

  // the 12 numbers per bone the A1 harness measures (9 rotation + 3 translation of the world matrix)
  const pose = (a) => {
    const model = a.model;
    const n = model.num_bones ?? model.bones.length;
    const bw = b3.buildBoneWorldMatrices(model, a.currentFrame(), a.currentBlend ? a.currentBlend() : null);
    const out = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) {
      const m = bw.mats[i];
      out[i * 12 + 0] = m[0]; out[i * 12 + 1] = m[1]; out[i * 12 + 2] = m[2];
      out[i * 12 + 3] = m[4]; out[i * 12 + 4] = m[5]; out[i * 12 + 5] = m[6];
      out[i * 12 + 6] = m[8]; out[i * 12 + 7] = m[9]; out[i * 12 + 8] = m[10];
      out[i * 12 + 9] = m[12]; out[i * 12 + 10] = m[13]; out[i * 12 + 11] = m[14];
    }
    return out;
  };

  st.run = async ({ side, defenderSide, clip, tech, outcome, maxTicks, shot }) => {
    const atk = side === "near" ? r.playerAnimator : r.enemyAnimator;
    const def = defenderSide === "near" ? r.playerAnimator : r.enemyAnimator;
    if (!atk?.model) return { error: `no ${side} animator/model` };
    if (!def?.model) return { error: `no ${defenderSide} animator/model` };
    const lethal = outcome === "lethal", miss = outcome === "miss";
    const n = atk.model.num_bones ?? atk.model.bones.length;
    const own = !!(atk.model.actions?.[clip]?.ops?.length);

    // ── reset both fighters and stand the battle's camera up (menu director, then the confirm's retire)
    atk.setIdle(); def.setIdle(); r.effectPlayer?.clear(); r.setCameraMode("director", { scriptOwnsCamera: false });
    for (let i = 0; i < 20; i++) r.render(STEP);
    r.setCameraMode("behind", { scriptOwnsCamera: false });
    r.render(0);

    // ── the attacker's own idle: what "not animating" looks like, and the pose manifold it must return to
    const rg = { min: null, max: null };
    const idlePoses = [];
    const add = (range, flat) => {
      if (!flat) return;
      if (!range.min) { range.min = Float32Array.from(flat); range.max = Float32Array.from(flat); return; }
      for (let i = 0; i < flat.length; i++) {
        if (flat[i] < range.min[i]) range.min[i] = flat[i];
        if (flat[i] > range.max[i]) range.max[i] = flat[i];
      }
    };
    const summary = (range) => {
      const rot = [], trans = [];
      for (let b = 0; b < n; b++) {
        let mr = 0, mt = 0;
        for (let k = 0; k < 9; k++) mr = Math.max(mr, range.max[b * 12 + k] - range.min[b * 12 + k]);
        for (let k = 9; k < 12; k++) mt = Math.max(mt, range.max[b * 12 + k] - range.min[b * 12 + k]);
        rot.push(+mr.toFixed(3)); trans.push(+mt.toFixed(1));
      }
      let rotMax = 0, rotBone = -1, transMax = 0, transBone = -1;
      for (let b = 0; b < n; b++) {
        if (rot[b] > rotMax) { rotMax = rot[b]; rotBone = b; }
        if (b > 0 && trans[b] > transMax) { transMax = trans[b]; transBone = b; }
      }
      return { rotMax: +rotMax.toFixed(3), rotBone, transMax: +transMax.toFixed(1), transBone, rot, trans };
    };
    for (let i = 0; i < 60; i++) {
      r.render(STEP);
      const p = pose(atk);
      add(rg, p); idlePoses.push(p);
    }
    const idle = summary(rg);

    // ── the exchange
    const rec = { hits: [], fx: [], cams: [], aux: [], defEvents: [], strike: null };
    let clock = 0;
    let last99 = null, last98 = null, lastOp10 = null, strikeTick = null;
    const hooks = {
      onHit: (x) => {
        rec.hits.push({ t: clock, type: x.type });
        lastOp10 = clock;
        if (x.type === 99) last99 = clock; else if (x.type === 98) last98 = clock;
        strikeTick = last99 ?? last98 ?? lastOp10;
      },
      onEffect: (x) => rec.fx.push({ t: clock, type: x.type, x: x.x, y: x.y, z: x.z }),
      onCamera: (x) => rec.cams.push({ t: clock, words: x.words.slice() }),
      onAuxAction: (x) => rec.aux.push({ t: clock, mode: x.mode }),
    };
    const homes = {
      atkHome: atk.homeSlot ? { ...atk.homeSlot } : null,
      defHome: def.homeSlot ? { ...def.homeSlot } : null,
    };
    const ok = side === "near" ? r.playerAttack(tech, { ...hooks, lethal, miss })
                              : r.enemyAttack(tech, { ...hooks, lethal, miss });
    if (!ok) return { error: own ? "the attack VM refused the clip" : "no script for this clip (the fighter idles)" };
    const vmVm = !!atk.vm;

    // defender animator events: every clip change and every VM start/stop, plus ticks spent in each clip
    let dClip = def._clip | 0, dVm = !!def.vm;
    const defTicks = {};
    const defTick = (t) => {
      const c = def._clip | 0, v = !!def.vm;
      if (v && c) defTicks[c] = (defTicks[c] ?? 0) + 1;
      if (c !== dClip || v !== dVm) { rec.defEvents.push({ t, clip: c, vm: v }); dClip = c; dVm = v; }
    };

    const actRange = { min: null, max: null };
    let ended = false, ticks = 0, farFromIdle = 0;
    add(actRange, pose(atk));
    for (ticks = 1; ticks <= maxTicks; ticks++) {
      clock = ticks;
      r.setCameraMode("behind", { scriptOwnsCamera: r.coordinator.active });
      r.render(STEP);
      const p = pose(atk);
      add(actRange, p);
      defTick(ticks);
      // leave the idle manifold? (an attack that is the idle table again is exactly 0 away from it)
      if (ticks % 2 === 0) {
        let nearest = 1e9;
        for (let i = 0; i < idlePoses.length; i += 2) {
          let dr = 0; const q = idlePoses[i];
          for (let k = 0; k < n * 12 && dr < nearest; k += 12) {
            for (let j = 0; j < 9; j++) { const d = Math.abs(p[k + j] - q[k + j]); if (d > dr) dr = d; }
          }
          if (dr < nearest) nearest = dr;
        }
        if (nearest > farFromIdle) farFromIdle = nearest;
      }
      // the strike frame, measured ON the tick a contact fires. Every contact re-measures, so the LAST
      // strike (op10 99) is the one judged, not the first intermediate 98.
      if (strikeTick != null && ticks === strikeTick) rec.strike = strikeFrame(ticks);
      if (!atk.vm && (strikeTick == null || ticks > strikeTick) && !def.vm) { ended = true; break; }
    }
    const act = summary(actRange);
    // the action->idle handoff eases over ~10 ticks; let it finish before judging the return
    for (let i = 0; i < 14; i++) r.render(STEP);
    const finalPose = pose(atk);
    let returnRot = 1e9, returnTrans = 1e9;
    for (const q of idlePoses) {
      let dr = 0, dt = 0;
      for (let b = 0; b < n; b++) {
        for (let k = 0; k < 9; k++) { const d = Math.abs(finalPose[b * 12 + k] - q[b * 12 + k]); if (d > dr) dr = d; }
        for (let k = 9; k < 12; k++) { const d = Math.abs(finalPose[b * 12 + k] - q[b * 12 + k]); if (d > dt) dt = d; }
      }
      if (dr < returnRot) { returnRot = dr; returnTrans = dt; }
    }

    // the strike effect, judged in the form the script authored it
    function strikeFrame(t) {
      const spawned = rec.fx.filter((f) => f.t === t);          // the op3s that fired on the contact tick
      if (!spawned.length) return { t, spawned: 0, anchors: [], nearest: null };
      const dbg = r.__dnaDebug();
      const W = 960, H = 672;
      let proj = null;
      if (dbg?.cam) {
        const fov = 2 * Math.atan(120 / dbg.cam.H);    // H is the projection distance (battle3d lastCamInfo)
        const pv = b3.mat4Mul(b3.mat4Perspective(fov, W / H, 1, 60000), b3.mat4LookAt(dbg.cam.eye, dbg.cam.look, [0, 1, 0]));
        proj = (p) => {
          const cx = pv[0] * p[0] + pv[4] * p[1] + pv[8] * p[2] + pv[12];
          const cy = pv[1] * p[0] + pv[5] * p[1] + pv[9] * p[2] + pv[13];
          const cw = pv[3] * p[0] + pv[7] * p[1] + pv[11] * p[2] + pv[15];
          return cw <= 0 ? null : { x: (cx / cw * 0.5 + 0.5) * W, y: (1 - (cy / cw * 0.5 + 0.5)) * H };
        };
      }
      const centreOf = (b) => b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : null;
      const atkBox = side === "near" ? dbg?.pAABB : dbg?.eAABB;
      const defBox = side === "near" ? dbg?.eAABB : dbg?.pAABB;
      const atkPx = proj && atkBox ? proj(centreOf(atkBox)) : null;
      const defPx = proj && defBox ? proj(centreOf(defBox)) : null;
      // Which body does a screen point sit ON? March the camera ray through that pixel against each
      // fighter's own world AABB (the mesh bounds the renderer just built) and keep the NEAREST entry:
      // a giant can stand behind the fighter the shot frames, so "hits the box" alone is not enough.
      const rayEntry = (px, box) => {
        if (!dbg?.cam || !box || !px) return null;
        const eye = dbg.cam.eye, look = dbg.cam.look, upv = [0, 1, 0];
        const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
        const zAx = norm(sub(eye, look));                 // mat4LookAt's convention (points backwards)
        const xAx = norm(cross(upv, zAx));
        const yAx = cross(zAx, xAx);
        const tan = 120 / dbg.cam.H, aspect = W / H;
        const nx = (2 * px.x) / W - 1, ny = 1 - (2 * px.y) / H;
        const dir = norm([0, 1, 2].map((i) => -zAx[i] + xAx[i] * nx * tan * aspect + yAx[i] * ny * tan));
        const pad = 0.04 * Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
        let t0 = 0, t1 = 1e9;
        for (let i = 0; i < 3; i++) {
          const lo = box.min[i] - pad, hi = box.max[i] + pad;
          if (Math.abs(dir[i]) < 1e-9) { if (eye[i] < lo || eye[i] > hi) return null; continue; }
          let ta = (lo - eye[i]) / dir[i], tb = (hi - eye[i]) / dir[i];
          if (ta > tb) { const s = ta; ta = tb; tb = s; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) return null;
        }
        return t1 > 0 ? t0 : null;
      };
      const pxScale = H / 240;
      const centre = { x: W / 2, y: H / 2 };
      const anchors = spawned.map((f) => {
        const screen = f.z === 32767 || f.z === -1;
        const a = { type: f.type, screen, x: f.x, y: f.y, z: f.z };
        if (screen) {
          // the draw point the effect player uses (fight/effect-player.js screen branch): the screen-centre
          // anchor + the record's own dx/dy channels. The instance carries the type, so the match is exact
          // (renderList entries all look alike for screen-space pos).
          const insts = (r.effectPlayer?.instances ?? []).filter((i) => i.type === f.type && i.screen
            && i.pos.x === f.x && i.pos.y === f.y);
          const chans = insts.length ? insts[insts.length - 1].fx?.chans : null;
          const dx = chans?.[2] | 0, dy = chans?.[3] | 0;
          a.drawPx = { x: +(centre.x + f.x * pxScale + dx * pxScale).toFixed(1), y: +(centre.y + f.y * pxScale + dy * pxScale).toFixed(1) };
          a.defPx = defPx ? { x: +defPx.x.toFixed(1), y: +defPx.y.toFixed(1) } : null;
          a.atkPx = atkPx ? { x: +atkPx.x.toFixed(1), y: +atkPx.y.toFixed(1) } : null;
          const dDef = defPx ? Math.hypot(a.drawPx.x - defPx.x, a.drawPx.y - defPx.y) : null;
          const dAtk = atkPx ? Math.hypot(a.drawPx.x - atkPx.x, a.drawPx.y - atkPx.y) : null;
          a.dDef = dDef == null ? null : +dDef.toFixed(1);
          a.dAtk = dAtk == null ? null : +dAtk.toFixed(1);
          const tDef = rayEntry(a.drawPx, defBox), tAtk = rayEntry(a.drawPx, atkBox);
          a.defHit = tDef != null; a.atkHit = tAtk != null;
          a.nearest = tDef != null && (tAtk == null || tDef <= tAtk) ? "defender"
            : tAtk != null ? "attacker" : null;
          a.depthGap = tDef != null && tAtk != null ? +(tAtk - tDef).toFixed(1) : null;
          a.ray = { def: tDef == null ? null : +tDef.toFixed(1), atk: tAtk == null ? null : +tAtk.toFixed(1) };
        } else {
          a.dDef = Math.abs(f.z - (homes.defHome?.z ?? 0));
          a.dAtk = Math.abs(f.z - (homes.atkHome?.z ?? 0));
          a.sameSideAsDefender = Math.sign(f.z) === Math.sign(homes.defHome?.z ?? 0);
          a.nearest = a.dDef <= a.dAtk ? "defender" : "attacker";
        }
        return a;
      });
      const nearest = anchors.some((a) => a.nearest === "defender") ? "defender"
        : anchors.some((a) => a.nearest === "attacker") ? "attacker" : null;
      return { t, spawned: spawned.length, anchors, nearest };
    }

    const png = shot ? (() => {
      const draw = r.getEffectDraw();
      const cv = document.getElementById("cv");
      const ctx = cv.getContext("2d");
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(window.__off, 0, 0);
      if (draw) fxMod.drawEffects(ctx, draw.list, draw.manifest, draw.images, draw.view);
      return cv.toDataURL("image/png");
    })() : null;

    return {
      side, defenderSide, clip, tech, outcome, kind: own ? "own" : "synth", bones: n, started: vmVm, ended, ticks,
      idle, act: { rot: act.rotMax, bone: act.rotBone, trans: act.transMax, boneT: act.transBone, rotBones: act.rot, transBones: act.trans },
      farFromIdle: +farFromIdle.toFixed(3), returnRot: +returnRot.toFixed(3), returnTrans: +returnTrans.toFixed(1),
      endMove: atk.moveDelta().map((v) => +v.toFixed(1)),
      hits: rec.hits, fx: rec.fx, cams: rec.cams, aux: rec.aux,
      defEvents: rec.defEvents, defTicks,
      defEnd: { vm: !!def.vm, clip: def._clip | 0, held: !!def._heldPose },
      homes, strike: rec.strike, strikeTick,
      camera: r.__dnaDebug()?.camRecord ? { kind: r.__dnaDebug().camRecord.kind, issuer: r.__dnaDebug().camRecord.issuer,
        preset: r.__dnaDebug().camRecord.preset ?? null } : null,
      png,
    };
  };
  window.__chReady = true;
  return true;
};

// ── verdict ───────────────────────────────────────────────────────────────────
const FINAL_CLIP = { hit: 2, lethal: 3, miss: 4 };   // REACTION_HIT_CLIP / DEATH / EVADE (web/fight/fight-tables.js:75-78)

function verdict(res, opt, expect) {
  const reasons = [];
  const notes = [];
  if (res.error) return { pass: false, reasons: [res.error] };
  // (0) the attacker's clip must animate at all (the A1 harness's assertions)
  const varies = (res.act?.rot ?? 0) >= ROT_FLOOR || (res.act?.trans ?? 0) >= TRANS_FLOOR;
  if (!res.ended) reasons.push(`attack does not end (${opt.maxTicks} ticks)`);
  if ((res.farFromIdle ?? 0) < OFF_IDLE_MIN || !varies)
    reasons.push(`attacker barely moves (off-idle ${res.farFromIdle}, max bone rotation ${res.act?.rot})`);
  if (expect.h98 && !res.hits.some((h) => h.type === 98)) reasons.push(`no op10 98 contact (script has ${expect.h98})`);
  if (expect.h99 && !res.hits.some((h) => h.type === 99)) reasons.push("no op10 99 strike");
  if (res.returnRot > RETURN_ROT_MAX) reasons.push(`attacker does not return to its idle pose (rot ${res.returnRot})`);
  if (Math.hypot(...(res.endMove ?? [0, 0, 0])) > RETURN_MOVE_MAX) reasons.push(`attacker left displaced (${(res.endMove ?? []).join(",")})`);

  // (a) the defender's reaction — asserted only for an ATTACK clip: clip 10 is the item-use clip, and item use
  //     has no victim on the disc (1 of the 69 shipped clip-10 scripts carries an op1 record).
  const want = FINAL_CLIP[res.outcome];
  const clips = [];
  for (const e of res.defEvents ?? []) if (e.vm && e.clip && clips[clips.length - 1] !== e.clip) clips.push(e.clip);
  const finalSeen = clips.includes(want);
  const intermediates = clips.filter((c) => c === 1).length;
  const reaction = { want, clips, intermediates, wantIntermediate: expect.h98, finalSeen,
                     ranTicks: res.defTicks?.[want] ?? 0, ended: !res.defEnd?.vm, applicable: !expect.selfTarget };
  if (expect.selfTarget) {
    // C3: a self/ally cast has NO victim, so any reaction the defender plays means the script carried op1
    // records it must not carry.
    if (clips.length) reasons.push(`self/ally technique makes the defender react (${clips.join(",")}) — C3 says no op1`);
  } else if (!expect.defenderHasFinal) reasons.push(`the defender model has no clip ${want} (cannot react; not the attacker's fault)`);
  else if (!finalSeen) reasons.push(`defender never plays its ${res.outcome} reaction (clip ${want}); clips it played: ${clips.join(",") || "none"}`);
  else {
    if (reaction.ranTicks < DEF_MIN_TICKS) reasons.push(`defender's clip ${want} did not run (${reaction.ranTicks} ticks)`);
    if (!reaction.ended) reasons.push(`defender's clip ${want} never ends`);
    if (expect.h98 && intermediates < 1) reasons.push("defender plays no clip 1 on the intermediate contacts (op10 98)");
  }

  // (b) the strike effect lands on the defender (only when the script fires a damage strike)
  const s = res.strike ?? {};
  const anchors = s.anchors ?? [];
  const onDefender = (a) => (a.screen
    ? a.nearest === "defender"
    : !!(a.sameSideAsDefender && a.dDef <= W_Z_BOUND && a.dAtk >= a.dDef + W_Z_GAP));
  let strikeOK = null;
  if (expect.selfTarget) {
    // C4 (self/ally): an effect that spawns must be anchored on the CASTER, never on the other fighter.
    if (anchors.length) {
      strikeOK = anchors.some((a) => a.nearest === "attacker");
      if (!strikeOK) reasons.push(`self/ally effect is not on the caster (${anchors.map((a) => `${a.screen ? "screen" : "world"} nearest ${a.nearest}`).join("; ")})`);
    }
  } else {
    strikeOK = anchors.some(onDefender);
    if (!anchors.length) reasons.push(s.t == null ? "the script fires no contact (no op10) — nothing to place" : "no strike effect spawned at the damage strike");
    else if (!strikeOK) {
      const kinds = [...new Set(anchors.map((a) => a.screen ? "screen" : "world"))].join("+");
      const detail = anchors.map((a) => `${a.screen ? "screen" : "world"} type ${a.type}: ${a.screen
        ? `drawn ${a.nearest ? "over the " + a.nearest : "over neither body"} (${a.drawPx?.x},${a.drawPx?.y}; ${a.dDef == null ? "defender off-screen" : a.dDef + "px to the defender's centre"}, ${a.dAtk == null ? "attacker off-screen" : a.dAtk + "px to the attacker's"})`
        : `z ${a.z}, ${a.dDef} from the defender's slot, ${a.dAtk} from the attacker's`}`).join("; ");
      reasons.push(`strike effect not on the defender (${kinds}): ${detail}`);
    }
  }
  return {
    pass: reasons.length === 0, reasons, notes, reaction, strikeOK,
    strike: { t: s.t ?? null, nearest: s.nearest ?? null, anchors: anchors.map((a) => ({
      type: a.type, kind: a.screen ? "screen" : "world", z: a.z, dDef: a.dDef, dAtk: a.dAtk,
      nearest: a.nearest, onDefender: onDefender(a), drawPx: a.drawPx ?? null,
      defPx: a.defPx ?? null, atkPx: a.atkPx ?? null, defHit: a.defHit ?? null, atkHit: a.atkHit ?? null,
      sameSideAsDefender: a.sameSideAsDefender ?? null, ray: a.ray ?? null, depthGap: a.depthGap ?? null,
    })) },
  };
}

// ── main ────────────────────────────────────────────────────────────────────
const opt = parseArgs(process.argv.slice(2));
if (opt.all) {
  const index = JSON.parse(await readFile(resolve(MODELS, "index.json"), "utf8"));
  const folders = Array.isArray(index) ? index : index.models;
  opt.models = folders.filter((f) => !opt.exclude.includes(f));
}
// a technique per clip: the lowest tech id the shipped table gives that clip (fallbacks: the verified
// 52/52 partition rule for the basic, then a clip-9 spell and a clip-10 item technique)
let techByClip = { 5: 1, 9: 137, 10: 184 };
try {
  const table = JSON.parse(await readFile(TECH_TABLE, "utf8"));
  const best = {};
  for (const [id, rec] of Object.entries(table)) {
    const c = rec?.clip;
    if (c == null) continue;
    if (best[c] == null || Number(id) < best[c]) best[c] = Number(id);
  }
  techByClip = { ...techByClip, ...best };
} catch { /* the fallbacks above */ }
const techFor = (clip) => (opt.tech != null ? opt.tech : techByClip[clip]);
// The technique table (digimon.json "skills", 426 records). The checker keys on the RECORD, never on the clip
// number: type heal/support is a self/ally cast (no defender reaction, effect on the caster), every other type is
// enemy-targeted (reaction + effect on the defender) — /home/dorij/scratch-research/tech-groups.md.
let skillById = new Map();
try {
  const d = JSON.parse(await readFile(resolve(ROOT, "web/assets/data/digimon.json"), "utf8"));
  skillById = new Map((d.skills ?? []).map((s) => [s.id, s]));
} catch { /* the --clips path still works without the table */ }
const selfTargetOf = (tech) => { const s = skillById.get(Number(tech)); return !!s && (s.type === "heal" || s.type === "support"); };
const CASES = opt.techs.length
  ? opt.techs.map((id) => {
      const s = skillById.get(id);
      return { tech: id, clip: s?.clip ?? opt.clips[0], selfTarget: !!s && (s.type === "heal" || s.type === "support"),
               group: s ? `${s.type} clip ${s.clip} ${(s.hits ?? 1) > 1 ? "multi" : "single"}` : `tech ${id}` };
    })
  : opt.clips.map((c) => ({ tech: techFor(c), clip: c, selfTarget: selfTargetOf(techFor(c)), group: `clip ${c}` }));

const animCache = new Map();
async function packActions(folder) {
  if (!animCache.has(folder)) {
    const anim = JSON.parse(await readFile(resolve(MODELS, folder, "anim.json"), "utf8"));
    animCache.set(folder, anim?.actions ?? []);
  }
  return animCache.get(folder);
}
/** What the script this model will play carries: own or built, and how many op10 98 / 99 records. */
async function scriptCounts(folder, clip) {
  const own = (await packActions(folder))[clip];
  const ops = own?.ops?.length ? own.ops : [];
  const count = (t) => ops.filter((o) => o.op === 10 && (o.words?.[0] | 0) === t).length;
  return { own: !!ops.length, h98: count(98), h99: count(99) };
}
const defenderHas = async (folder, clip) => !!(await packActions(folder))[clip]?.ops?.length;

const server = await serve(opt.port);
const results = [];
const shots = [];
const pageErrors = [];
const loaded = { near: null, far: null };
let browser = null;
let page = null;
let modelsOnThisPage = 0;

// A renderer that dies takes the whole page with it (the sweep sees
// "Target page, context or browser has been closed"); a crash on one run must not end the census.
const DEAD_PAGE = /Target page, context or browser has been closed|Target closed|has been closed|renderer crashed|crash|detached/i;
const progress = async (line) => { if (opt.progress) await appendFile(opt.progress, line + "\n"); };

async function launchPage() {
  if (browser) await browser.close().catch(() => {});
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|404/.test(m.text())) pageErrors.push(m.text()); });
  page.on("crash", () => pageErrors.push("renderer crashed"));
  await page.goto(`http://127.0.0.1:${opt.port}/web/battle-lab.html`, { waitUntil: "load" });
  if (opt.canvas) {
    // Census speed lever: battle3d reads canvas.width/height every frame, so a smaller drawing buffer
    // cuts the swiftshader fragment cost (the strike-frame test is computed analytically at 960x672
    // from the camera + the record's own channels, so the verdict does not depend on this size).
    await page.evaluate(({ w, h }) => {
      const cv = document.getElementById("cv");
      cv.width = w; cv.height = h;
    }, opt.canvas);
  }
  if (opt.noDraw) {
    // Every asserted quantity (bone world matrices, the camera record, the op10/op1/op3 hooks, the mesh
    // AABBs, the effect record's channels) is computed in JS before the draw calls, so the rasterizer can
    // be silenced: the run measures the same numbers in a fraction of the time. The default mode draws.
    await page.evaluate(() => {
      const cv = document.getElementById("cv");
      const gl = cv.getContext("webgl") || cv.getContext("webgl2");
      if (!gl) return false;
      for (const m of ["clear", "drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "clearColor"]) gl[m] = () => {};
      return true;
    });
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    if (await page.evaluate(() => !!window.__r?.playerAnimator)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await page.evaluate(BRIDGE);
  loaded.near = null; loaded.far = null; modelsOnThisPage = 0;
}

const ensureLoaded = async (side, folder) => {
  if (loaded[side] === folder) return;
  loaded[side] = null;
  const ok = await page.evaluate(({ s, f }) => window.__ch.load(s, f), { s: side, f: folder });
  if (!ok) throw new Error(`model ${folder} failed to load on the ${side} side`);
  loaded[side] = folder;
};

try {
  await launchPage();

  for (const folder of opt.models) {
    // the renderer leaks across model (re)loads; start each batch of models on a fresh page
    if (modelsOnThisPage >= opt.reloadEvery) await launchPage();
    modelsOnThisPage++;
    for (const side of opt.sides) {
      const defenderSide = side === "near" ? "far" : "near";
      let loadError = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await ensureLoaded(side, folder);
          await ensureLoaded(defenderSide, opt.defender);
          loadError = null;
          break;
        } catch (e) {
          loadError = e;
          if (DEAD_PAGE.test(e.message) && attempt === 0) {
            pageErrors.push(`page died loading ${folder} (${side}): ${e.message}`);
            await launchPage();
            continue;
          }
          break;
        }
      }
      if (loadError) {
        for (const clip of opt.clips) for (const outcome of opt.outcomes) {
          results.push({ model: folder, clip, side, outcome, error: loadError.message, pass: false, reasons: [loadError.message] });
          if (!opt.quiet) console.log(`FAIL ${folder} c${clip} ${side} ${outcome}: ${loadError.message}`);
          await progress(`LOAD ${folder} c${clip} ${side} ${outcome}: ${loadError.message}`);
        }
        continue;
      }
      for (const cse of CASES) {
        const { clip, tech } = cse;
        const counts = await scriptCounts(folder, clip);
        for (const outcome of opt.outcomes) {
          const row = { model: folder, clip, side, outcome, tech, group: cse.group };
          let pageDied = false;
          try {
            const res = await page.evaluate(({ side, defenderSide, clip, tech, outcome, maxTicks, shot }) =>
              window.__ch.run({ side, defenderSide, clip, tech, outcome, maxTicks, shot }),
              { side, defenderSide, clip, tech, outcome, maxTicks: opt.maxTicks, shot: !!opt.shots });
            Object.assign(row, res);
            const expect = { h98: counts.h98, h99: counts.h99, selfTarget: !!cse.selfTarget,
                             attack: !cse.selfTarget,
                             defenderHasFinal: await defenderHas(opt.defender, FINAL_CLIP[outcome]) };
            const v = verdict(res, opt, expect);
            row.pass = v.pass; row.reasons = v.reasons; row.notes = v.notes; row.reaction = v.reaction; row.strikeOK = v.strikeOK;
            row.applicable = expect.attack ? "attack" : "item";
            row.strikeSummary = v.strike;
            if (opt.shots && res.png) {
              await mkdir(opt.out, { recursive: true });
              const path = resolve(opt.out, `a7a-${folder}-c${clip}-${side}-${outcome}.png`);
              await writeFile(path, Buffer.from(res.png.replace(/^data:image\/png;base64,/, ""), "base64"));
              row.shot = path; shots.push(path);
            }
            delete row.png;
          } catch (e) {
            row.error = e.message; row.pass = false; row.reasons = [e.message];
            pageDied = DEAD_PAGE.test(e.message);
            if (pageDied) pageErrors.push(`page died in ${folder} c${clip} ${side} ${outcome}: ${e.message}`);
          }
          results.push(row);
          if (!opt.quiet) {
            const tag = row.pass ? "PASS" : row.error ? "DEAD" : "FAIL";
            const detail = row.error ? row.error
              : `${row.kind} ${row.ticks}t reaction [${(row.reaction?.clips ?? []).join(",") || "none"}] want ${row.reaction?.want} ` +
                `fx ${row.strikeSummary?.nearest ?? "none"} (${(row.strikeSummary?.anchors ?? []).map((a) => `${a.kind} ${a.dDef}/${a.dAtk}`).join("; ") || "-"})`;
            console.log(`${tag} ${row.model} c${row.clip} ${row.side} ${row.outcome} vs ${opt.defender}: ${detail}` +
              (row.notes?.length ? `  (${row.notes.join("; ")})` : "") +
              (row.pass ? "" : `  <- ${row.reasons.join("; ")}`));
          }
          await progress(`${row.pass ? "PASS" : "FAIL"} ${folder} c${clip} ${side} ${outcome}` +
            (pageDied ? " PAGE_DIED" : "") + ` ${row.pass ? "" : (row.reasons ?? []).join("; ")}`);
          if (pageDied) {
            // this run is recorded as failed; carry on with the rest of the batch on a new page
            await launchPage();
            try {
              await ensureLoaded(side, folder);
              await ensureLoaded(defenderSide, opt.defender);
            } catch (e2) {
              pageErrors.push(`reload after a crash failed for ${folder} (${side}): ${e2.message}`);
            }
          }
        }
      }
    }
  }

  // ── outputs ──
  const summary = {
    generated: new Date().toISOString(), port: opt.port, clips: opt.clips, sides: opt.sides, outcomes: opt.outcomes,
    defender: opt.defender, models: opt.models.length, runs: results.length,
    passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length,
    thresholds: { ROT_FLOOR, OFF_IDLE_MIN, TRANS_FLOOR, RETURN_ROT_MAX, RETURN_MOVE_MAX, W_Z_BOUND, W_Z_GAP, DEF_MIN_TICKS },
    pageErrors: [...new Set(pageErrors)].slice(0, 20),
  };
  if (opt.json) {
    await mkdir(resolve(opt.json, ".."), { recursive: true });
    await writeFile(opt.json, JSON.stringify({ summary, results }, null, 1));
  }
  if (opt.md) {
    const byModel = new Map();
    for (const r of results) {
      if (!byModel.has(r.model)) byModel.set(r.model, []);
      byModel.get(r.model).push(r);
    }
    const cell = (r) => {
      if (!r) return "—";
      const tag = r.pass ? "PASS" : "FAIL";
      const f = r.strikeSummary?.nearest ?? "no fx";
      return `${tag} r[${(r.reaction?.clips ?? []).join(",") || "-"}] fx:${f}${r.pass ? "" : ` <br>${(r.reasons ?? [r.error]).join("; ")}`}`;
    };
    const cols = [];
    for (const side of opt.sides) for (const outcome of opt.outcomes) for (const clip of opt.clips)
      cols.push({ side, outcome, clip, label: `${side === "near" ? "N" : "F"}${clip}${outcome === "hit" ? "" : outcome === "lethal" ? "†" : "°"}` });
    const lines = [];
    lines.push("# A7a — defender reaction + strike-effect placement");
    lines.push("");
    lines.push(`Generated ${summary.generated} · ${summary.runs} runs over ${summary.models} attacker models · ` +
      `**${summary.passed} pass / ${summary.failed} fail** · defender \`${opt.defender}\` · clips ${opt.clips.join(", ")} · ` +
      `sides ${opt.sides.join("+")} · outcomes ${opt.outcomes.join(",")}`);
    lines.push("");
    lines.push("Each run plays a real exchange through `playerAttack`/`enemyAttack` in `web/battle-lab.html`, one renderer tick");
    lines.push("at a time (camera record + both actors + effect sprites), with the idle director retired exactly as the confirm edge");
    lines.push("does. **PASS** = the attacker's clip animates (ends, leaves its idle pose manifold, fires its op10 98/99, returns to");
    lines.push(`idle); the DEFENDER's animator plays the reaction clip the op1 dispatch selects (1 on intermediate contacts, then 2`);
    lines.push(`survive / 3 death on a lethal blow / 4 evade on a miss) for at least ${DEF_MIN_TICKS} ticks; and the strike effect lands on the`);
    lines.push(`defender — a world-space op3 within ${W_Z_BOUND} PS1 units of its home slot on the arena axis, or a screen-space sprite`);
    lines.push("whose draw point, seen from the live camera, lands on the defender's body box and not the attacker's.");
    lines.push("");
    lines.push("Cells: `r[...]` = the clips the defender played in order; `†` lethal outcome, `°` miss (evade).");
    lines.push("");
    lines.push(`| model | bones | ${cols.map((c) => c.label).join(" | ")} |`);
    lines.push(`|${["---", "---", ...cols.map(() => "---")].join("|")}|`);
    for (const [model, rows] of byModel) {
      const bones = rows.find((r) => r.bones)?.bones ?? "?";
      const cells = cols.map((c) => cell(rows.find((r) => r.side === c.side && r.clip === c.clip && r.outcome === c.outcome)));
      lines.push(`| \`${model}\` | ${bones} | ${cells.join(" | ")} |`);
    }
    lines.push("");
    const fails = results.filter((r) => !r.pass);
    lines.push(`## Failures (${fails.length})`);
    lines.push("");
    for (const r of fails) lines.push(`- \`${r.model}\` clip ${r.clip} ${r.side} ${r.outcome}: ${(r.reasons ?? [r.error]).join("; ")}`);
    lines.push("");
    await mkdir(resolve(opt.md, ".."), { recursive: true });
    await writeFile(opt.md, lines.join("\n"));
  }
  console.log(`\n${summary.passed}/${summary.runs} pass, ${summary.failed} fail` +
    (opt.json ? `\njson: ${opt.json}` : "") + (opt.md ? `\nmd:   ${opt.md}` : "") +
    (shots.length ? `\nshots: ${opt.out} (${shots.length})` : "") +
    (summary.pageErrors.length ? `\npage errors: ${summary.pageErrors.join(" | ")}` : ""));
  process.exitCode = summary.failed ? 1 : 0;
} finally {
  await browser.close().catch(() => {});
  await new Promise((r) => server.close(r));
}
