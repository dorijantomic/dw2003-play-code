#!/usr/bin/env node
// verify_clip_animates.mjs — prove that a battle LAB model actually ANIMATES for a given action clip.
//
// Why it exists
//   An enemy-only species played as a partner has no authored clip for the action it is asked to play
//   (web/fight/clip-fallback.js builds one from the Greymon donor). A fallback that binds the model's
//   "return to base idle" table instead of a real attack table plays the effect and moves nothing: the
//   Digimon stands still. This harness loads the model in the real renderer (web/battle-lab.html), plays
//   the clip on either arena side, and measures the SKELETON, so "it animates" is a number, not an opinion.
//
//   It is headless (Playwright Chromium) and deterministic: the whole clip is stepped one fixed PS1 logic
//   tick at a time (same 60 Hz tick and GLOBAL_SPEED the battle uses) inside one page task, so the lab's
//   own rAF loop cannot interleave and no wall-clock timing is involved.
//
// What a run asserts (each one is a line of the verdict)
//   (a) the clip ENDS (its ActionVM stops) inside --max-ticks          -> "ends"
//   (b) the BONES move: the pose must vary over the action window (a world-rotation range above an
//       absolute floor; root translation alone does not count) AND must leave the model's own IDLE
//       pose manifold — a fallback that just re-binds the idle table moves plenty but never leaves
//       it, which is exactly the "stands still" bug                              -> "moves"
//   (d) the contact markers the script carries (op10 type 98/99) fire   -> "contacts"
//   (c) it comes back to its idle pose and home slot                    -> "returns"
//   A clip the model does not own is reported as script "synth" (built by clip-fallback.js); "none"
//   means nothing could be built and the fighter idles.
//
// Usage (the repo's Playwright needs the lib bundle, so run it through the wrapper):
//   tools/run-playwright.sh tools/verify_clip_animates.mjs --model m005grey --clip 5 --side both
//   tools/run-playwright.sh tools/verify_clip_animates.mjs --all --clips 5,9,10 --side both \
//       --json /home/dorij/scratch-research/anim-harness.json --md /home/dorij/scratch-research/anim-harness-results.md
//
// Options
//   --model <folder[,folder]>  model folder(s), as in web/assets/battle/models/<folder>
//   --all                      every folder in web/assets/battle/models/index.json
//   --exclude <folder[,folder]> folders to leave out of --all (DNA/Jogress-only or presentation-only models)
//   --clip <n[,n]> / --clips   action clip number(s) to play (default 5)
//   --side near|far|both       near = the player slot (enemy-authored scripts are mirrored), far = the enemy slot
//   --element <n>              element passed to the fallback (picks the projectile sprite); default 1
//   --max-ticks <n>            logic ticks allowed before a clip counts as not ending; default 900
//   --sheets / --no-sheets     contact sheets to --out (default: on for --model runs, off for --all)
//   --out <dir>                contact-sheet directory; default /home/dorij/scratch-research/anim-sheets
//   --port <n>                 static server port; default 8101
//   --json <path>              write every run's numbers here
//   --md <path>                write a PASS/FAIL markdown table here
//   --quiet                    no per-run lines (the table and files are still written)
//
// Exit code: 0 when every run passed, 1 when any run failed (the table says which assertion).
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const MODELS = resolve(ROOT, "web/assets/battle/models");
const DEFAULT_OUT = "/home/dorij/scratch-research/anim-sheets";

// ── thresholds (calibrated against the 249-model census; see --json for the raw numbers) ──
const ROT_FLOOR = 0.06;        // a real limb swing moves a world-rotation element by >> this (idle breathes ~0.01-0.05)
const IDLE_RATIO = 2.5;        // ... and by this much more than the same model's own idle
const OFF_IDLE_MIN = 0.15;     // the action must leave the model's idle POSE MANIFOLD by this much (~8 degrees)
const TRANS_FLOOR = 8;         // PS1 units; a bone translation that big is a real limb shift, not jitter
const TRANS_RATIO = 3;
const RETURN_ROT_MAX = 0.12;   // final idle pose vs the nearest idle pose seen before the action
const RETURN_MOVE_MAX = 24;    // PS1 units of leftover slot displacement

// ── args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opt = { models: [], all: false, clips: [5], sides: ["near"], element: 1, maxTicks: 900,
                sheets: null, out: DEFAULT_OUT, port: 8101, json: null, md: null, quiet: false, exclude: [] };
  const list = (v) => String(v).split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { const v = argv[++i]; if (v == null) throw new Error(`${a} needs a value`); return v; };
    if (a === "--model") opt.models.push(...list(next()));
    else if (a === "--all") opt.all = true;
    else if (a === "--exclude") opt.exclude.push(...list(next()));
    else if (a === "--clip" || a === "--clips") opt.clips = list(next()).map(Number);
    else if (a === "--side") { const s = next(); opt.sides = s === "both" ? ["near", "far"] : [s]; }
    else if (a === "--element") opt.element = Number(next());
    else if (a === "--max-ticks") opt.maxTicks = Number(next());
    else if (a === "--sheets") opt.sheets = true;
    else if (a === "--no-sheets") opt.sheets = false;
    else if (a === "--out") opt.out = resolve(next());
    else if (a === "--port") opt.port = Number(next());
    else if (a === "--json") opt.json = resolve(next());
    else if (a === "--md") opt.md = resolve(next());
    else if (a === "--quiet") opt.quiet = true;
    else if (a === "--help" || a === "-h") { console.log("see the header of tools/verify_clip_animates.mjs"); process.exit(0); }
    else throw new Error(`unknown option ${a}`);
  }
  if (opt.sides.some((s) => s !== "near" && s !== "far")) throw new Error("--side is near, far or both");
  if (!opt.models.length && !opt.all) throw new Error("pass --model <folder> or --all");
  if (opt.sheets == null) opt.sheets = !opt.all;
  return opt;
}

// ── static server (the repo root, so web/assets' symlink works) ──────────────
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

// ── the page-side bridge: load a model on a side, run a clip, make a sheet ──
const BRIDGE = async () => {
  const mod = await import("/web/battle3d.js");
  const fb = await import("/web/fight/clip-fallback.js");
  const ch = {
    bwm: mod.buildBoneWorldMatrices,
    fb,
    loaded: { near: null, far: null },
    // The bone world matrices as 12 numbers per bone: 9 rotation entries, 3 translation.
    pose(a) {
      const model = a.model;
      const n = model.num_bones ?? model.bones.length;
      const bw = ch.bwm(model, a.currentFrame(), a.currentBlend ? a.currentBlend() : null);
      const out = new Float32Array(n * 12);
      for (let i = 0; i < n; i++) {
        const m = bw.mats[i];
        out[i * 12 + 0] = m[0]; out[i * 12 + 1] = m[1]; out[i * 12 + 2] = m[2];
        out[i * 12 + 3] = m[4]; out[i * 12 + 4] = m[5]; out[i * 12 + 5] = m[6];
        out[i * 12 + 6] = m[8]; out[i * 12 + 7] = m[9]; out[i * 12 + 8] = m[10];
        out[i * 12 + 9] = m[12]; out[i * 12 + 10] = m[13]; out[i * 12 + 11] = m[14];
      }
      return out;
    },
    async load(side, folder) {
      const r = window.__r;
      if (!r) return { ok: false, error: "no renderer" };
      if (side === "near") {
        const ok = await r.setPlayerDigimon(folder);
        ch.loaded.near = ok ? folder : null;
        return { ok, ready: !!r.playerAnimator && ch.loaded.near === folder };
      }
      const before = r.enemyAnimator;
      r.setEnemyDigimon(folder);
      ch.loaded.far = null;
      return { ok: true, pending: true, before };
    },
    farReady(before) {
      const r = window.__r;
      const a = r && r.enemyAnimator;
      return !!(a && a !== before && a.model);
    },
    farLoaded(folder) { ch.loaded.far = folder; return true; },
    // Play `clip` once and measure it. Everything happens in one page task: no rAF interference.
    run(side, clip, opts) {
      const r = window.__r;
      const a = side === "near" ? r.playerAnimator : r.enemyAnimator;
      if (!a || !a.model) return { error: `no ${side} animator` };
      const model = a.model;
      const n = model.num_bones ?? model.bones.length;
      const ownScript = model.actions?.[clip];
      const own = !!(ownScript && Array.isArray(ownScript.ops) && ownScript.ops.length);
      const script = ch.fb.resolveClipScript(model, clip, { element: opts.element });
      const kind = own ? "own" : (script && Array.isArray(script.ops) && script.ops.length ? "synth" : "none");
      const expected = { h98: 0, h99: 0 };
      for (const o of script?.ops ?? []) {
        if (o.op !== 10 || !o.words) continue;
        const t = o.words[0] | 0;
        if (t === 98) expected.h98++; else if (t === 99) expected.h99++;
      }
      const speed = 2;                      // GLOBAL_SPEED, the tick rate every action runs at
      const add = (rg, flat) => {
        if (!flat) return;
        if (!rg.min) { rg.min = Float32Array.from(flat); rg.max = Float32Array.from(flat); return; }
        for (let i = 0; i < flat.length; i++) {
          if (flat[i] < rg.min[i]) rg.min[i] = flat[i];
          if (flat[i] > rg.max[i]) rg.max[i] = flat[i];
        }
      };
      const summary = (rg) => {
        const rot = [], trans = [];
        for (let b = 0; b < n; b++) {
          let mr = 0, mt = 0;
          for (let k = 0; k < 9; k++) mr = Math.max(mr, rg.max[b * 12 + k] - rg.min[b * 12 + k]);
          for (let k = 9; k < 12; k++) mt = Math.max(mt, rg.max[b * 12 + k] - rg.min[b * 12 + k]);
          rot.push(mr); trans.push(mt);
        }
        let rotMax = 0, rotBone = -1, transMax = 0, transBone = -1;
        for (let b = 0; b < n; b++) {
          if (rot[b] > rotMax) { rotMax = rot[b]; rotBone = b; }
          if (b > 0 && trans[b] > transMax) { transMax = trans[b]; transBone = b; }   // bone 0 is the whole-body root
        }
        return { rotMax, rotBone, transMax, transBone, rot: rot.map((v) => +v.toFixed(3)), trans: trans.map((v) => +v.toFixed(1)) };
      };
      const dist = (p, q) => {
        let dr = 0, dt = 0;
        for (let b = 0; b < n; b++) {
          for (let k = 0; k < 9; k++) { const d = Math.abs(p[b * 12 + k] - q[b * 12 + k]); if (d > dr) dr = d; }
          for (let k = 9; k < 12; k++) { const d = Math.abs(p[b * 12 + k] - q[b * 12 + k]); if (d > dt) dt = d; }
        }
        return { rot: dr, trans: dt };
      };

      // 1. the model's own idle: what "not animating" looks like, and the pose manifold it must return to
      a.setIdle();
      const idleRange = { min: null, max: null };
      const idlePoses = [];
      for (let i = 0; i < 100; i++) {
        r.coordinator.tick(speed);
        const p = ch.pose(a);
        add(idleRange, p);
        idlePoses.push(p);
      }
      const idle = summary(idleRange);

      // 2. the clip
      const hits = [], effects = [];
      let ended = false, ticks = 0, farFromIdle = 0;
      const actRange = { min: null, max: null };
      const started = a.setAction(clip, {
        onHit: (rec) => hits.push(rec.type | 0),
        onEffect: (e) => effects.push(e.type | 0),
      }, { element: opts.element });
      if (started) {
        add(actRange, ch.pose(a));
        for (ticks = 1; ticks <= opts.maxTicks; ticks++) {
          r.coordinator.tick(speed);
          const p = ch.pose(a);
          add(actRange, p);
          // How far the pose leaves the model's own idle MANIFOLD (not merely "is it big"): for a
          // model with an energetic idle, the biggest idle swing must not be mistaken for an attack,
          // and an attack that is only the idle table back again is exactly 0 away from it.
          if (ticks % 2 === 0) {
            let nearest = 1e9;
            for (let i = 0; i < idlePoses.length; i += 2) {
              let dr = 0;
              const q = idlePoses[i];
              for (let k = 0; k < n * 12 && dr < nearest; k += 12) {
                for (let j = 0; j < 9; j++) { const d = Math.abs(p[k + j] - q[k + j]); if (d > dr) dr = d; }
              }
              if (dr < nearest) nearest = dr;
            }
            if (nearest > farFromIdle) farFromIdle = nearest;
          }
          if (!a.vm || a.vm.ended) { ended = true; break; }
        }
      }
      const act = started ? summary(actRange) : null;

      // 3. back to idle: the action->idle handoff eases over ~10 ticks
      const endMove = a.moveDelta().map((v) => +v.toFixed(1));
      for (let i = 0; i < 14; i++) r.coordinator.tick(speed);
      const finalPose = ch.pose(a);
      let returnRot = 1e9;
      for (const p of idlePoses) { const d = dist(p, finalPose); if (d.rot < returnRot) returnRot = d.rot; }
      // the translation gap of the pose that matched nearest by rotation
      let bestTrans = 1e9;
      for (const p of idlePoses) { const d = dist(p, finalPose); if (Math.abs(d.rot - returnRot) < 1e-9) bestTrans = Math.min(bestTrans, d.trans); }

      return {
        model: opts.folder, clip: clip | 0, side, kind, bones: n,
        started: !!started, ended, ticks,
        idle: { rot: +idle.rotMax.toFixed(3), trans: +idle.transMax.toFixed(1), bone: idle.rotBone, rotBones: idle.rot, transBones: idle.trans },
        act: act && { rot: +act.rotMax.toFixed(3), bone: act.rotBone, trans: +act.transMax.toFixed(1), boneT: act.transBone, rotBones: act.rot, transBones: act.trans },
        hits: { h98: hits.filter((t) => t === 98).length, h99: hits.filter((t) => t === 99).length, all: hits },
        expected, effects: effects.length, farFromIdle: +farFromIdle.toFixed(3),
        returnRot: +returnRot.toFixed(3), returnTrans: +bestTrans.toFixed(1), endMove,
      };
    },
    // 8 evenly spaced rendered frames of the same clip, tiled into one PNG (the human eyeball sheet)
    sheet(side, clip, totalTicks, opts) {
      const r = window.__r, off = window.__off;
      const a = side === "near" ? r.playerAnimator : r.enemyAnimator;
      if (!a || !a.model || !off) return null;
      a.setIdle();
      for (let i = 0; i < 30; i++) r.coordinator.tick(2);
      a.setAction(clip, {}, { element: opts.element });
      const S = document.createElement("canvas");
      S.width = 4 * 480; S.height = 2 * 336;
      const ctx = S.getContext("2d");
      ctx.fillStyle = "#0d0d16"; ctx.fillRect(0, 0, S.width, S.height);
      let t = 0;
      const marks = [];
      for (let k = 1; k <= 8; k++) {
        const target = Math.max(1, Math.round(((totalTicks || 1) * k) / 8));
        while (t < target) { r.coordinator.tick(2); t++; }
        r.render(0);                         // draw the current pose; dt 0 = no logic tick
        const x = ((k - 1) % 4) * 480, y = Math.floor((k - 1) / 4) * 336;
        ctx.drawImage(off, x, y, 480, 336);
        ctx.fillStyle = "#8cf"; ctx.font = "bold 15px monospace";
        ctx.fillText(`${opts.folder} clip ${clip} ${side}  tick ${t}  frame ${a.currentFrame()}`, x + 6, y + 18);
        marks.push({ t, frame: a.currentFrame() });
      }
      return { png: S.toDataURL("image/png"), marks };
    },
  };
  window.__ch = ch;
  window.__chReady = true;
  return true;
};

// ── verdict ──────────────────────────────────────────────────────────────────
function verdict(res, opt) {
  const reasons = [];
  if (res.error) return { pass: false, reasons: [res.error] };
  if (res.kind === "none") return { pass: false, reasons: ["no script (idles)"] };
  if (!res.started) return { pass: false, reasons: ["setAction refused the clip"] };
  if (!res.ended) reasons.push(`does not end (${opt.maxTicks} ticks)`);
  // (b) the BONES must (i) actually vary over the action window and (ii) not merely be the model's
  // own idle table played again — Raijinmon's fallback is the idle loop, which moves a lot yet never
  // leaves the idle pose manifold. Per-bone ratios are still recorded for the report.
  const idleRot = res.idle?.rotBones ?? [], idleTrans = res.idle?.transBones ?? [];
  const actRot = res.act?.rotBones ?? [], actTrans = res.act?.transBones ?? [];
  let bestRot = { ratio: 0, bone: -1, act: 0 }, bestTrans = { ratio: 0, bone: -1, act: 0 };
  for (let b = 0; b < actRot.length; b++) {
    const r = actRot[b] / Math.max(idleRot[b] ?? 0, 0.02);
    if (r > bestRot.ratio) bestRot = { ratio: r, bone: b, act: actRot[b] };
    if (b > 0) {
      const t = actTrans[b] / Math.max(idleTrans[b] ?? 0, 1);
      if (t > bestTrans.ratio) bestTrans = { ratio: t, bone: b, act: actTrans[b] };
    }
  }
  const varies = (res.act?.rot ?? 0) >= ROT_FLOOR || (res.act?.trans ?? 0) >= TRANS_FLOOR;
  const offOK = (res.farFromIdle ?? 0) >= OFF_IDLE_MIN;
  if (!offOK || !varies) {
    const why = !offOK
      ? `the pose never leaves the idle manifold (off-idle ${res.farFromIdle}); the clip is the model's idle again`
      : `the pose does not vary over the clip (max bone rotation range ${res.act?.rot})`;
    reasons.push(`bones barely move: ${why} [best bone ${bestRot.bone} ${bestRot.act.toFixed(3)} = ${bestRot.ratio.toFixed(1)}x idle]`);
  }
  res.motion = { offIdle: res.farFromIdle, rotBone: bestRot.bone, rotAct: +bestRot.act.toFixed(3), rotRatio: +bestRot.ratio.toFixed(1),
                 transBone: bestTrans.bone, transAct: +bestTrans.act.toFixed(1), transRatio: +bestTrans.ratio.toFixed(1) };
  if (res.expected.h98 && res.hits.h98 < 1) reasons.push(`no op10 98 contact (wanted ${res.expected.h98})`);
  if (res.expected.h99 && res.hits.h99 < 1) reasons.push(`no op10 99 strike (wanted ${res.expected.h99})`);
  if (res.returnRot > RETURN_ROT_MAX) reasons.push(`does not return to its idle pose (rot ${res.returnRot})`);
  if (Array.isArray(res.endMove) && Math.hypot(...res.endMove) > RETURN_MOVE_MAX) reasons.push(`left displaced (${res.endMove.join(",")})`);
  return { pass: reasons.length === 0, reasons };
}

// ── main ─────────────────────────────────────────────────────────────────────
const opt = parseArgs(process.argv.slice(2));
if (opt.all) {
  const index = JSON.parse(await readFile(resolve(MODELS, "index.json"), "utf8"));
  const folders = Array.isArray(index) ? index : index.models;
  opt.models = folders.filter((f) => !opt.exclude.includes(f));
}
const skipped = opt.exclude.filter((f) => !opt.models.includes(f));
const server = await serve(opt.port);
const browser = await chromium.launch();
const results = [];
let page;
const pageErrors = [];
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|404/.test(m.text())) pageErrors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${opt.port}/web/battle-lab.html`, { waitUntil: "load" });
  // the lab builds the renderer synchronously; the animator appears once the default model loads
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const ready = await page.evaluate(() => !!window.__r && !!window.__r.playerAnimator);
    if (ready) break;
    if (Date.now() - t0 > 59000) throw new Error("battle-lab never became ready");
    await new Promise((r) => setTimeout(r, 50));
  }
  await page.evaluate(BRIDGE);

  const sheets = [];
  const loaded = { near: null, far: null };
  const ensureLoaded = async (folder, side) => {
    if (loaded[side] === folder) return;
    loaded[side] = null;
    if (side === "far") {
      const before = await page.evaluate((f) => window.__ch.load("far", f), folder);
      if (before.error) throw new Error(before.error);
      const t = Date.now();
      let ready = false;
      while (Date.now() - t < 30000) {
        ready = await page.evaluate((b) => window.__ch.farReady(b), before.before);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      if (!ready) throw new Error(`model ${folder} never loaded on the far side`);
      await page.evaluate((f) => window.__ch.farLoaded(f), folder);
    } else {
      const near = await page.evaluate((f) => window.__ch.load("near", f), folder);
      if (!near.ok) throw new Error(`model ${folder} failed to load on the near side`);
    }
    loaded[side] = folder;
  };
  const runOne = async (folder, clip, side) => {
    const row = { model: folder, clip, side };
    try {
      await ensureLoaded(folder, side);
      const res = await page.evaluate(({ folder, clip, side, o }) => window.__ch.run(side, clip, { ...o, folder }), {
        folder, clip, side, o: { element: opt.element, maxTicks: opt.maxTicks },
      });
      Object.assign(row, res);
      const v = verdict(res, opt);
      row.motion = res.motion;
      row.pass = v.pass; row.reasons = v.reasons;
      if (opt.sheets && res.ended) {
        const sheet = await page.evaluate(({ side, clip, total, o }) => window.__ch.sheet(side, clip, total, o), {
          side, clip, total: res.ticks, o: { element: opt.element, folder },
        });
        if (sheet) {
          await mkdir(opt.out, { recursive: true });
          const path = resolve(opt.out, `${folder}-c${clip}-${side}.png`);
          await writeFile(path, Buffer.from(sheet.png.replace(/^data:image\/png;base64,/, ""), "base64"));
          row.sheet = path;
          sheets.push(path);
        }
      }
    } catch (e) {
      row.error = e.message;
      row.pass = false; row.reasons = [e.message];
    }
    results.push(row);
    if (!opt.quiet) {
      const tag = row.pass ? "PASS" : "FAIL";
      const detail = row.error ? row.error
        : `${row.kind} ${row.ticks}t rot ${row.motion?.rotAct} = ${row.motion?.rotRatio}x idle (bone ${row.motion?.rotBone}) offidle ${row.farFromIdle} hits ${row.hits?.h98}/${row.hits?.h99} ret ${row.returnRot}`;
      console.log(`${tag} ${row.model} clip ${row.clip} ${row.side}: ${detail}${row.pass ? "" : "  <- " + row.reasons.join("; ")}`);
    }
  };

  for (const folder of opt.models) {
    for (const side of opt.sides) {
      for (const clip of opt.clips) {
        // load once per (model, side); re-loading is a no-op when the folder is unchanged
        await runOne(folder, clip, side);
      }
    }
  }

  // ── outputs ──
  const summary = {
    generated: new Date().toISOString(), port: opt.port, clips: opt.clips, sides: opt.sides,
    models: opt.models.length, runs: results.length,
    passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length,
    thresholds: { ROT_FLOOR, IDLE_RATIO, TRANS_FLOOR, TRANS_RATIO, RETURN_ROT_MAX, RETURN_MOVE_MAX },
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
    const cellFor = (r) => {
      if (!r) return "—";
      const tag = r.pass ? "PASS" : "FAIL";
      const motion = r.act ? `${(r.motion?.rotRatio ?? 0).toFixed(1)}x` : "";
      return `${tag} ${r.kind ?? "?"}${r.pass ? ` (${motion})` : ` <br>${(r.reasons ?? [r.error]).join("; ")}`}`;
    };
    const lines = [];
    lines.push("# Clip animation harness — PASS/FAIL census");
    lines.push("");
    lines.push(`Generated ${summary.generated} · ${summary.runs} runs over ${summary.models} models · ` +
               `**${summary.passed} pass / ${summary.failed} fail** · clips ${opt.clips.join(", ")} · sides ${opt.sides.join("+")}`);
    lines.push("");
    lines.push("How a run is measured: the clip is played in the real renderer (`web/battle-lab.html`) one fixed PS1 logic tick at a");
    lines.push("time, on the near (player) or far (enemy) side, and the skeleton's world bone matrices are sampled every tick.");
    lines.push("**PASS** = the clip's ActionVM ends inside the tick budget; the pose VARIES over the clip (some bone's world");
    lines.push(`rotation spans at least ${ROT_FLOOR}, or a bone translates ${TRANS_FLOOR}+ units; the root bone's translation does not count) and LEAVES the`);
    lines.push(`model's own idle pose manifold by at least ${OFF_IDLE_MIN} (a fallback that re-binds the idle table moves plenty but never leaves it); the`);
    lines.push("script's op10 98/99 contact markers fire; and the model ends back on its idle pose and home slot. `own` = the model");
    lines.push("has that clip; `synth` = built by `web/fight/clip-fallback.js`; `(Nx)` is the best per-bone rotation range vs the");
    lines.push("same bone's idle range, for information.");
    lines.push("");
    if (skipped.length) {
      lines.push(`Excluded (DNA/Jogress-only or presentation-only models, per operator direction): ${skipped.map((s) => `\`${s}\``).join(", ")}.`);
      lines.push("");
    }
    const header = ["model", "bones", ...opt.sides.flatMap((s) => opt.clips.map((c) => `${s === "near" ? "N" : "F"}${c}`))];
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`|${header.map(() => "---").join("|")}|`);
    for (const [model, rows] of byModel) {
      const bones = rows.find((r) => r.bones)?.bones ?? "?";
      const cells = opt.sides.flatMap((side) => opt.clips.map((clip) => cellFor(rows.find((r) => r.side === side && r.clip === clip))));
      lines.push(`| \`${model}\` | ${bones} | ${cells.join(" | ")} |`);
    }
    lines.push("");
    // the failures, grouped so they can be read as a work list
    const fails = results.filter((r) => !r.pass);
    lines.push(`## Failures (${fails.length})`);
    lines.push("");
    for (const r of fails) {
      lines.push(`- \`${r.model}\` clip ${r.clip} ${r.side} (${r.kind ?? "?"}): ${(r.reasons ?? [r.error]).join("; ")}`);
    }
    lines.push("");
    await mkdir(resolve(opt.md, ".."), { recursive: true });
    await writeFile(opt.md, lines.join("\n"));
  }
  console.log(`\n${summary.passed}/${summary.runs} pass, ${summary.failed} fail` +
    (opt.json ? `\njson: ${opt.json}` : "") + (opt.md ? `\nmd:   ${opt.md}` : "") +
    (sheets.length ? `\nsheets: ${opt.out} (${sheets.length})` : "") +
    (summary.pageErrors.length ? `\npage errors: ${summary.pageErrors.join(" | ")}` : ""));
  process.exitCode = summary.failed ? 1 : 0;
} finally {
  await browser.close().catch(() => {});
  await new Promise((r) => server.close(r));
}
