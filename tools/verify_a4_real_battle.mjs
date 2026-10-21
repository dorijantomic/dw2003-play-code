#!/usr/bin/env node
// verify_a4_real_battle.mjs — A4 independent review: the new partner forms in the REAL battle page.
//
// A1's harness (tools/verify_clip_animates.mjs) proved the clips animate in the battle LAB by
// driving setAction directly. A3 then rebuilt the fallback (donor plan). This script is the
// in-game pass: it starts an ordinary 3-D battle in web/index.html, puts each reviewed species in
// the PLAYER slot (near side, seeded as the partner's own live form), and reaches the action
// through the game's own command menu — Fight, Tech (a clip-9 spell) and Item (clip 10) — while
// the battle's own phase machine, messages, camera and contact timing run untouched.
//
// For every action it records, from the real battle's own player animator:
//   - the action clip and that its ActionVM ran and ended,
//   - the skeleton's world bone matrices sampled through the action: motion range vs the same
//     model's own idle and how far the pose left the idle manifold (A1's thresholds),
//   - whether the model came back to its idle pose and home slot,
//   - the enemy's HP after a basic/spell (must drop) and the player's HP after an item (must rise),
//   - the battle message the action produced,
//   - 8 canvas frames across the action (individual PNGs + one contact sheet per model),
//   - a cheap frame-content metric so a black/inside-the-model camera cannot pass silently.
//
// Usage:
//   python3 -m http.server 8104 --directory web &
//   tools/run-playwright.sh tools/verify_a4_real_battle.mjs --port 8104
//   tools/run-playwright.sh tools/verify_a4_real_battle.mjs --port 8104 --only m441raiz --action basic
//
// Results: JSON to /home/dorij/scratch-research/anim-a4-real-battle.json and prints a verdict.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const OUT = process.env.A4_SHOT || "/home/dorij/scratch-research/anim-sheets";
// File-name prefix, so a before/after pair of passes can sit in the same folder (A5 uses it).
const PREFIX = process.env.A4_PREFIX || "a4";
const JSON_OUT = process.env.A4_JSON || "/home/dorij/scratch-research/anim-a4-real-battle.json";
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const PORT = Number(arg("port", 8104));
const ROOT = `http://localhost:${PORT}`;
const ONLY = arg("only", null);
const ONLY_ACTION = arg("action", null);

// The four reviewed forms: Raijinmon (giant, no own clip 5), Machinedramon (giant, own 5),
// Kunemon (small, own 5), Kurisarimon (small, no own 5/9/10 at all).
const MODELS = [
  { species: 144, name: "Raijinmon", folder: "m441raiz", kind: "giant / no own clip 5" },
  { species: 131, name: "Machinedramon", folder: "m115muge", kind: "giant / own clip 5" },
  { species: 56, name: "Kunemon", folder: "m032kune", kind: "small / own clip 5" },
  { species: 64, name: "Kurisarimon", folder: "m175krsr", kind: "small / no own clip 5, 9, 10" },
];
// Baseline for the camera judgement: a base-game partner with every own clip (Agumon id 4).
if (argv.includes("--control")) MODELS.push({ species: 4, name: "Agumon", folder: "m003agum", kind: "control / base game" });
// Any single species, for spot checks (e.g. --species 38 --folder m369duke = Gallantmon, the
// largest base-game partner and the camera reference a giant extra borrows its near shots from).
if (arg("species", null) != null) {
  MODELS.push({ species: Number(arg("species")), name: arg("name", arg("folder")),
    folder: arg("folder"), kind: arg("kind", "spot check") });
}
const SPELL_TECH = 156;          // Thunder Bolt — clip 9, MP 20, category 3 (damage)
const ITEM_ID = 43;              // PowerCharge — non-throw item, plays action clip 10

const member = (digimonId) => ({
  digimonId, level: 40, xp: 0, tp: 30, hp: 1200, maxHp: 1200, mp: 400, maxMp: 400,
  stats: { str: 200, def: 120, spt: 90, wis: 90, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
  equippedForms: [digimonId, 0, 0],
  formLedger: [{ id: digimonId, formLevel: 5, dvexp: 0, techSlots: [SPELL_TECH, 0, 0, 0, 0, 0] }],
});

// ── in-page helpers ───────────────────────────────────────────────────────────
// A recorder that samples the real battle's player animator. It keeps the last second of idle
// poses as the reference manifold, then measures the action exactly like A1's harness.
const INSTALL_RECORDER = async () => {
  const mod = await import("/battle3d.js");
  const bwm = mod.buildBoneWorldMatrices;
  const R = {
    idlePoses: [], idleMax: 40, actMin: null, actMax: null,
    vmSeen: false, ended: false, clip: null, actSamples: 0, far: 0,
    startT: 0, endT: 0, lastT: 0, finalPose: null, returnRot: null, returnTrans: null,
    endMove: null, bones: 0, error: null,
  };
  const anim = () => window.__battle3d?.playerAnimator ?? null;
  const pose = (a) => {
    const m = a.model;
    const n = m.num_bones ?? m.bones.length;
    const bw = bwm(m, a.currentFrame(), a.currentBlend ? a.currentBlend() : null);
    const out = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) {
      const q = bw.mats[i];
      out[i * 12 + 0] = q[0]; out[i * 12 + 1] = q[1]; out[i * 12 + 2] = q[2];
      out[i * 12 + 3] = q[4]; out[i * 12 + 4] = q[5]; out[i * 12 + 5] = q[6];
      out[i * 12 + 6] = q[8]; out[i * 12 + 7] = q[9]; out[i * 12 + 8] = q[10];
      out[i * 12 + 9] = q[12]; out[i * 12 + 10] = q[13]; out[i * 12 + 11] = q[14];
    }
    return out;
  };
  const add = (p) => {
    if (!R.actMin) { R.actMin = Float32Array.from(p); R.actMax = Float32Array.from(p); return; }
    for (let i = 0; i < p.length; i++) {
      if (p[i] < R.actMin[i]) R.actMin[i] = p[i];
      if (p[i] > R.actMax[i]) R.actMax[i] = p[i];
    }
  };
  const dist = (p, q) => {
    let dr = 0, dt = 0;
    for (let b = 0; b < R.bones; b++) {
      if (b > 0) {
        for (let k = 9; k < 12; k++) { const d = Math.abs(p[b * 12 + k] - q[b * 12 + k]); if (d > dt) dt = d; }
      }
      for (let k = 0; k < 9; k++) { const d = Math.abs(p[b * 12 + k] - q[b * 12 + k]); if (d > dr) dr = d; }
    }
    return { rot: dr, trans: dt };
  };
  R.reset = () => {
    R.idlePoses = []; R.actMin = null; R.actMax = null; R.vmSeen = false; R.ended = false;
    R.clip = null; R.actSamples = 0; R.far = 0; R.startT = 0; R.endT = 0;
    R.finalPose = null; R.returnRot = null; R.returnTrans = null; R.endMove = null; R.error = null;
    R.stripN = 0; R.stripFrames = []; R.strip = null; R.stripCtx = null;
  };
  // A cheap in-page strip of the action's RENDERED frames: draw the game canvas into one
  // scaled slot per rendered animator frame (no toDataURL during the action, so the battle's
  // frame rate is not disturbed). The strike of a 42-tick clip lasts a few frames at the
  // software-WebGL rate, so a wall-clock sampler can miss it entirely.
  R.SLOTS = 12;
  R.takeShot = (a) => {
    if (!R.strip) {
      R.strip = document.createElement("canvas");
      R.strip.width = R.SLOTS * 320; R.strip.height = 240;
      R.stripCtx = R.strip.getContext("2d");
    }
    if (R.stripN >= R.SLOTS) return;
    const g = document.querySelector("canvas#game");
    if (!g) return;
    try {
      R.stripCtx.drawImage(g, R.stripN * 320, 0, 320, 240);
      R.stripFrames.push(a.currentFrame ? a.currentFrame() : null);
      // how far this frame's skeleton pose is from the idle manifold, and the bone that moved
      let far = 0, bone = -1;
      if (R.idlePoses.length) {
        const p = pose(a);
        for (let i = 0; i < R.idlePoses.length; i += 2) {
          const q = R.idlePoses[i];
          for (let b = 0; b < R.bones; b++) {
            for (let k = 0; k < 9; k++) {
              const d = Math.abs(p[b * 12 + k] - q[b * 12 + k]);
              if (d > far) { far = d; bone = b; }
            }
          }
        }
      }
      R.stripPose = R.stripPose || [];
      R.stripPose.push({ far: +far.toFixed(3), bone });
      R.stripN++;
    } catch (e) { R.error = String(e?.message ?? e); }
  };
  R.framesOut = () => {
    const out = [];
    if (!R.strip) return out;
    for (let i = 0; i < R.stripN; i++) {
      const c = document.createElement("canvas");
      c.width = 320; c.height = 240;
      c.getContext("2d").drawImage(R.strip, i * 320, 0, 320, 240, 0, 0, 320, 240);
      // coarse content metric, same as the full-size frames
      const t = document.createElement("canvas"); t.width = 24; t.height = 18;
      const x = t.getContext("2d"); x.drawImage(c, 0, 0, 24, 18);
      const d = x.getImageData(0, 0, 24, 18).data;
      let sum = 0, sum2 = 0;
      for (let k = 0; k < d.length; k += 4) {
        const y = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
        sum += y; sum2 += y * y;
      }
      const n = d.length / 4, mean = sum / n;
      const sp = R.stripPose?.[i] ?? {};
      out.push({ url: c.toDataURL("image/png"), frame: R.stripFrames[i], far: sp.far, bone: sp.bone,
        mean: +mean.toFixed(1), spread: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1) });
    }
    return out;
  };
  R.sample = () => {
    const a = anim();
    if (!a || !a.model) return;
    R.bones = a.model.num_bones ?? a.model.bones.length;
    const vm = !!(a.vm && !a.vm.ended);
    const now = performance.now();
    if (vm) {
      if (!R.vmSeen) { R.vmSeen = true; R.clip = a._clip ?? null; R.startT = now; }
      R.lastT = now;
      const p = pose(a);
      add(p);
      R.actSamples++;
      R.takeShot(a);
      if (R.idlePoses.length && R.actSamples % 2 === 0) {
        let nearest = 1e9;
        for (let i = 0; i < R.idlePoses.length; i += 2) {
          const d = dist(p, R.idlePoses[i]);
          if (d.rot < nearest) nearest = d.rot;
        }
        if (nearest > R.far) R.far = nearest;
      }
    } else {
      if (R.vmSeen && !R.ended) { R.ended = true; R.endT = now; }
      // keep the most recent idle poses as the reference manifold
      if (R.idlePoses.length >= R.idleMax) R.idlePoses.shift();
      R.idlePoses.push(pose(a));
    }
  };
  R.snapshot = () => {
    const a = anim();
    return {
      bones: R.bones, vmSeen: R.vmSeen, ended: R.ended, clip: R.clip,
      actSamples: R.actSamples, far: +R.far.toFixed(3),
      idle: R.idlePoses.length, elapsed: R.startT ? Math.round(performance.now() - R.startT) : 0,
      vmActive: !!(a && a.vm && !a.vm.ended), frame: a ? a.currentFrame?.() : null,
    };
  };
  R.finalize = () => {
    const a = anim();
    if (!a || !a.model) return { error: "no animator" };
    const finalPose = pose(a);
    let returnRot = 1e9, returnTrans = 1e9;
    for (const p of R.idlePoses) {
      const d = dist(finalPose, p);
      if (d.rot < returnRot) { returnRot = d.rot; returnTrans = d.trans; }
    }
    // per-bone motion ranges (rot = 9 matrix rotation entries, trans = 9..12; the root's
    // translation is ignored as in A1's harness)
    const rot = [], trans = [];
    if (R.actMin) {
      for (let b = 0; b < R.bones; b++) {
        let mr = 0, mt = 0;
        for (let k = 0; k < 9; k++) mr = Math.max(mr, R.actMax[b * 12 + k] - R.actMin[b * 12 + k]);
        if (b > 0) for (let k = 9; k < 12; k++) mt = Math.max(mt, R.actMax[b * 12 + k] - R.actMin[b * 12 + k]);
        rot.push(+mr.toFixed(3)); trans.push(+mt.toFixed(1));
      }
    }
    let rotMax = 0, rotBone = -1, transMax = 0, transBone = -1;
    for (let b = 0; b < rot.length; b++) {
      if (rot[b] > rotMax) { rotMax = rot[b]; rotBone = b; }
      if (trans[b] > transMax) { transMax = trans[b]; transBone = b; }
    }
    R.finalPose = null; // do not ship the matrices
    return {
      vmSeen: R.vmSeen, ended: R.ended, clip: R.clip, actSamples: R.actSamples,
      farFromIdle: +R.far.toFixed(3), actRot: +rotMax.toFixed(3), actBone: rotBone,
      actTrans: +transMax.toFixed(1), transBone,
      returnRot: +returnRot.toFixed(3), returnTrans: +returnTrans.toFixed(1),
      endMove: a.moveDelta ? a.moveDelta().map((v) => +v.toFixed(1)) : null,
      stillAnimating: !!(a.vm && !a.vm.ended),
      contacts: window.__a4contacts ?? null,
    };
  };
  window.__a4rec = R;
  // Sample once per RENDERED frame (software WebGL here runs well under 60 fps; a timer
  // would either miss frames or oversample idle). rAF also keeps the measurements in the
  // same clock as the frame captures.
  const loop = () => { try { R.sample(); } catch (e) { R.error = String(e?.message ?? e); } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  // Count the action's real strike marker: the battle calls playerAttack/playPlayerItemUse on
  // the renderer, so wrapping those two methods sees the op10 99 contact the clip fired.
  const r = window.__battle3d;
  if (r && !r.__a4wrapped) {
    r.__a4wrapped = true;
    const attack = r.playerAttack.bind(r);
    r.playerAttack = (techId, opts = {}) => {
      window.__a4contacts = 0; window.__a4actionKind = "attack";
      return attack(techId, { ...opts, onHit: (rec) => {
        if ((rec?.type | 0) === 99) window.__a4contacts++;
        opts.onHit?.(rec);
      } });
    };
    const item = r.playPlayerItemUse.bind(r);
    r.playPlayerItemUse = (itemId, hooks = {}) => {
      window.__a4contacts = 0; window.__a4actionKind = "item";
      return item(itemId, { ...hooks, onHit: (rec) => {
        if ((rec?.type | 0) === 99) window.__a4contacts++;
        hooks.onHit?.(rec);
      } });
    };
  }
  return true;
};

// Frame content metric + a contact sheet composer, both on the page's own 2D game canvas.
const INSTALL_FRAMES = () => {
  const canvas = () => document.querySelector("canvas#game");
  window.__a4frame = () => {
    const c = canvas();
    if (!c) return null;
    const url = c.toDataURL("image/png");
    // coarse content metric: sample a 24x18 grid, report mean luma and spread
    const t = document.createElement("canvas"); t.width = 24; t.height = 18;
    const x = t.getContext("2d");
    x.drawImage(c, 0, 0, 24, 18);
    const d = x.getImageData(0, 0, 24, 18).data;
    let sum = 0, sum2 = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += y; sum2 += y * y;
    }
    const n = d.length / 4, mean = sum / n;
    return { url, mean: +mean.toFixed(1), spread: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1) };
  };
  // rows: [{label, frames: [url...]}] -> one PNG data URL (images decode async)
  window.__a4sheet = async (rows) => {
    const COLS = 8, CW = 300, CH = 225, LH = 22;
    const S = document.createElement("canvas");
    S.width = COLS * CW; S.height = rows.length * (CH + LH);
    const g = S.getContext("2d");
    g.fillStyle = "#101018"; g.fillRect(0, 0, S.width, S.height);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const y = r * (CH + LH);
      g.fillStyle = "#8cf"; g.font = "bold 15px monospace";
      g.fillText(row.label, 6, y + 16);
      for (let i = 0; i < row.frames.length && i < COLS; i++) {
        const img = new Image();
        img.src = row.frames[i].url;
        await img.decode().catch(() => {});
        g.drawImage(img, i * CW, y + LH, CW, CH);
        g.fillStyle = "#fff"; g.font = "bold 12px monospace";
        g.fillText(`f${i + 1}`, i * CW + 6, y + LH + 16);
      }
    }
    return S.toDataURL("image/png");
  };
  return true;
};

// ── driver ───────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const results = [];
const problems = [];
const meta = {};

const tap = async (page, key, ms = 90) => {
  await page.keyboard.down(key); await page.waitForTimeout(ms);
  await page.keyboard.up(key); await page.waitForTimeout(80);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function saveFrame(page, path) {
  const f = await page.evaluate(() => window.__a4frame());
  if (f) writeFileSync(path, Buffer.from(f.url.split(",")[1], "base64"));
  return f;
}

async function gotoCommandMenu(page) {
  await page.waitForFunction(() => {
    const p = window.__battle?.peek?.();
    return p?.state === 2 && !!p?.commandList?.active && p?.loaderOpen === false;
  }, null, { timeout: 40_000, polling: 100 });
}

async function commandRow(page, row) {
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true,
    null, { timeout: 30_000 });
  for (let i = 0; i < 10; i++) {
    const sel = await page.evaluate(() => window.__battleCmdNative.diagnostics().selection);
    if (sel === row) break;
    await tap(page, "ArrowDown");
  }
  await tap(page, "Enter");
}

/** Read every line the battle holds, pressing Circle, until cmd menu or timeout. */
async function settleTurn(page, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => {
      const p = window.__battle?.peek?.();
      const m = p?.messageLine;
      const b = window.__battleB?.();
      return {
        state: p?.state ?? null,
        holds: !!(m && m.active && !m.finished && (m.holdsTurn || p?.waitsForLine)),
        pages: !!(b && b._resultPages?.length && b.state === 7),
        menu: p?.state === 2 && !!p?.commandList?.active && p?.loaderOpen === false,
      };
    });
    if (s.menu) return true;
    if (s.holds || s.pages) await tap(page, "Enter");
    else await page.waitForTimeout(150);
  }
  return false;
}

/** One action through the real command menu, with the recorder sampling the whole time. */
async function runAction(page, model, action) {
  const t0 = Date.now();
  const before = await page.evaluate(() => {
    const b = window.__battleB();
    const inv = window.__state?.inventory;
    let qty = null;
    if (Array.isArray(inv)) qty = inv.find((x) => Number(x.id) === 43)?.qty ?? null;
    else if (inv && typeof inv === "object") qty = inv["43"] ?? inv[43] ?? null;
    return {
      enemyHp: b.enemy.hp, playerHp: b.player.hp, playerName: b.player.profile?.name,
      itemQty: qty, form: b.player.profile?.id,
    };
  });

  await page.evaluate(() => window.__a4rec.reset());
  await page.waitForTimeout(900);          // let idle poses accumulate as the reference

  if (action === "basic") {
    await commandRow(page, 0);
  } else if (action === "spell") {
    await commandRow(page, 1);
    await page.waitForFunction(() => window.__battleTechNative?.diagnostics?.().ready === true,
      null, { timeout: 20_000 });
    await tap(page, "Enter");
  } else {
    await commandRow(page, 4);
    await page.waitForFunction(() => window.__battleItemNative?.diagnostics?.().ready === true,
      null, { timeout: 20_000 });
    await tap(page, "Enter");
  }

  // The confirmation puts up the action's announcement line; reading it starts the action.
  await page.waitForFunction(() => {
    const p = window.__battle?.peek?.();
    const m = p?.messageLine;
    return !!(m && m.active && !m.finished && (m.holdsTurn || p?.waitsForLine));
  }, null, { timeout: 15_000 }).catch(() => {});
  await tap(page, "Enter");

  // Wait for the action VM.
  const started = await page.waitForFunction(() => {
    const a = window.__battle3d?.playerAnimator;
    return !!(a && a.vm && !a.vm.ended);
  }, null, { timeout: 12_000 }).then(() => true, () => false);

  // One full-size frame at the start (evidence); the action's own frames come from the
  // in-page strip, one per rendered animator frame.
  const startShot = started ? await saveFrame(page, `${OUT}/${PREFIX}-${model.folder}-${action}-start.png`) : null;
  let snap = await page.evaluate(() => window.__a4rec.snapshot());
  const capStart = Date.now();
  while (started && !snap.ended && Date.now() - capStart < 25_000) {
    await page.waitForTimeout(100);
    snap = await page.evaluate(() => window.__a4rec.snapshot());
  }
  const shots = await page.evaluate(() => window.__a4rec.framesOut());
  const captured = [];
  for (let i = 0; i < shots.length; i++) {
    const file = `${OUT}/${PREFIX}-${model.folder}-${action}-a${i + 1}.png`;
    writeFileSync(file, Buffer.from(shots[i].url.split(",")[1], "base64"));
    captured.push({ ...shots[i], file });
  }
  // 8 evenly spaced frames across the captured action (or everything captured)
  const frames = [];
  const nPick = Math.min(8, captured.length);
  for (let k = 0; k < nPick; k++) {
    const at = Math.round((k * (captured.length - 1)) / Math.max(1, nPick - 1));
    frames.push(captured[at]);
  }
  await page.waitForTimeout(650);           // the action->idle ease
  const fin = await page.evaluate(() => window.__a4rec.finalize());
  await saveFrame(page, `${OUT}/${PREFIX}-${model.folder}-${action}-idle.png`);

  const after = await page.evaluate(() => {
    const b = window.__battleB();
    const inv = window.__state?.inventory;
    let qty = null;
    if (Array.isArray(inv)) qty = inv.find((x) => Number(x.id) === 43)?.qty ?? null;
    else if (inv && typeof inv === "object") qty = inv["43"] ?? inv[43] ?? null;
    const dbg = window.__battle3d?.__dnaDebug?.() ?? null;
    return { enemyHp: b.enemy.hp, playerHp: b.player.hp, msg: b.message ?? "", itemQty: qty,
             state: b.state, vmActive: !!(window.__battle3d?.playerAnimator?.vm &&
               !window.__battle3d.playerAnimator.vm.ended),
             camera: dbg?.cam ?? null, nearCamera: dbg?.nearCamera ?? null,
             camRecord: dbg?.camRecord ? { kind: dbg.camRecord.kind, preset: dbg.camRecord.preset ?? null } : null };
  });

  const back = await settleTurn(page);
  const idle2 = await saveFrame(page, `${OUT}/${PREFIX}-${model.folder}-${action}-done.png`);

  const enemyDrop = before.enemyHp - after.enemyHp;
  const playerGain = after.playerHp - before.playerHp;
  const itemSpent = before.itemQty != null && after.itemQty != null ? before.itemQty - after.itemQty : null;

  const checks = {
    sameForm: before.playerName === model.name && before.form === model.species,
    vmStarted: !!fin.vmSeen,
    vmEnded: !!fin.ended,
    bodyMoves: (fin.farFromIdle ?? 0) >= 0.15 && ((fin.actRot ?? 0) >= 0.06 || (fin.actTrans ?? 0) >= 8),
    returnsToIdle: (fin.returnRot ?? 99) <= 0.12 && Math.hypot(...(fin.endMove ?? [99])) <= 24,
    cameraDrawn: frames.length > 0 && frames.every((f) => f.spread > 3 && f.mean > 2),
    hitLands: action === "item"
      ? (enemyDrop === 0 && playerGain > 0)
      : enemyDrop > 0,
    backToMenu: back,
    idleAgain: !!idle2 && idle2.spread > 3,
    noPageErrors: true,      // filled by caller
  };
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  const row = {
    model: model.folder, species: model.species, name: model.name, kind: model.kind, action,
    checks, pass: failures.length === 0, failures,
    clip: fin.clip, actSamples: fin.actSamples, farFromIdle: fin.farFromIdle,
    actRot: fin.actRot, actTrans: fin.actTrans, returnRot: fin.returnRot,
    returnTrans: fin.returnTrans, endMove: fin.endMove, stillAnimating: fin.stillAnimating,
    contacts: fin.contacts,
    enemyHpBefore: before.enemyHp, enemyHpAfter: after.enemyHp, enemyDrop,
    playerHpBefore: before.playerHp, playerHpAfter: after.playerHp, playerGain,
    itemQtyBefore: before.itemQty, itemQtyAfter: after.itemQty, itemSpent,
    message: after.msg?.slice?.(0, 160) ?? after.msg, ms: Date.now() - t0,
    camera: after.camera, nearCamera: after.nearCamera, camRecord: after.camRecord,
    frames: frames.map((f, i) => ({ file: f.file, frame: f.frame, mean: f.mean, spread: f.spread })),
  };
  results.push(row);
  console.log(`${row.pass ? "PASS" : "FAIL"} ${model.folder} ${action}: clip ${row.clip} ` +
    `move offidle ${row.farFromIdle} rot ${row.actRot} ret ${row.returnRot} ` +
    `enemy -${enemyDrop} player +${playerGain} item ${row.itemSpent} ` +
    `${row.pass ? "" : " <- " + failures.join(", ")}`);
  return { row, frames, label: `${model.folder} ${action} (clip ${row.clip})` };
}

const pageErrors = [];
for (const model of MODELS) {
  if (ONLY && model.folder !== ONLY) continue;
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await context.addInitScript((seed) => {
    localStorage.clear();
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("progressOrdinal", "3");
    localStorage.setItem("playerName", "Review");
    localStorage.setItem("charId", "p005koet");
    localStorage.setItem("party", JSON.stringify(["p005koet"]));
    localStorage.setItem("packId", "B");
    localStorage.setItem("bits", "1000");
    localStorage.setItem("inventory", JSON.stringify([{ id: 43, qty: 5 }]));
    localStorage.setItem("partnerStats", JSON.stringify(seed));
    localStorage.setItem("partyStats", JSON.stringify([seed]));
    localStorage.setItem("equipment", JSON.stringify([{}]));
  }, member(model.species));
  const page = await context.newPage();
  page.on("pageerror", (e) => { pageErrors.push(`${model.folder}: ${e.message}`); console.error("PAGEERROR", model.folder, e.message); });
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|404|favicon/.test(m.text()))
      pageErrors.push(`${model.folder}: console ${m.text().slice(0, 160)}`);
  });
  try {
    await page.goto(`${ROOT}/?skipTitle=1&map=s320&noEncounters=1`, { waitUntil: "load", timeout: 90_000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60_000 });
    // clear any opening textbox
    for (let i = 0; i < 20; i++) {
      const open = await page.evaluate(() => window.__textbox?.isOpen?.() ?? false);
      if (!open) break;
      await tap(page, "Enter");
    }
    const learned = await page.evaluate(() => window.__extraRoster?.learnAll?.() ?? -1);
    console.log(`[${model.folder}] extra roster learned: ${learned}`);
    // A REAL field encounter (mapId + screenId), so the arena, the placement table and the
    // battle camera director have the data a played fight has. Fall back to the direct battle
    // entry point (no field context) only if the map offers no encounter.
    await page.evaluate(() => window.__fieldToBattle?.());
    const fieldStarted = await page.waitForFunction(() => !!window.__battle?.isActive?.(), null, { timeout: 10_000 })
      .then(() => true, () => false);
    const startedVia = fieldStarted ? "field" : "start";
    if (!fieldStarted) {
      await page.evaluate(async () => {
        await window.__battle.start({ enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
      });
    }
    await waitForCommandMenu(page, { timeout: 60_000 });
    await gotoCommandMenu(page);
    // the enemy must survive three actions; the player must survive the replies and be hurt
    await page.evaluate(() => {
      const b = window.__battleB();
      b.enemy.hp = 99999; b.enemy.maxHp = 99999;
      b.player.maxHp = 9999; b.player.hp = 9499;
      b.player.maxMp = 999; b.player.mp = 999;
      b.player.str = 800; b.player.def = 800; b.player.spd = 400; b.player.spt = 400;
    });
    await page.evaluate(INSTALL_RECORDER);
    await page.evaluate(INSTALL_FRAMES);
    // A5: the giant near-camera fit can be turned off from here, so the same page produces the
    // "before" (pre-A5) framing for a before/after pair. On by default.
    const giantCam = !argv.includes("--no-giant-cam");
    await page.evaluate((on) => window.__battle3d?.setGiantCameraFit?.(on), giantCam);
    console.log(`[${model.folder}] giant near-camera fit: ${giantCam ? "on" : "OFF (before)"}`);
    const fps = await page.evaluate(() => new Promise((resolve) => {
      let n = 0; const t0 = performance.now();
      const step = () => {
        n++;
        if (performance.now() - t0 < 1500) requestAnimationFrame(step);
        else resolve(Math.round((n * 1000) / (performance.now() - t0)));
      };
      requestAnimationFrame(step);
    }));
    console.log(`[${model.folder}] render rate ~${fps} fps`);
    const who = await page.evaluate(() => {
      const b = window.__battleB();
      return { name: b.player.profile?.name, id: b.player.profile?.id,
               folderLoaded: !!window.__battle3d?.playerAnimator?.model,
               enemy: b.enemy.profile?.name ?? b.enemy.eStats?.digimon_id };
    });
    console.log(`[${model.folder}] battle (${startedVia}): player ${who.name} (${who.id}) model=${who.folderLoaded} enemy=${who.enemy}`);
    meta[model.folder] = { startedVia, fps, who };

    const sheets = [];
    const rowsForSheet = [];
    const acts = ONLY_ACTION ? [ONLY_ACTION] : ["basic", "spell", "item"];
    for (const action of acts) {
      try {
        const r = await runAction(page, model, action);
        rowsForSheet.push(r);
      } catch (e) {
        const row = { model: model.folder, name: model.name, action, pass: false,
          failures: ["exception"], error: e.message };
        results.push(row);
        problems.push(`${model.folder} ${action}: ${e.message}`);
        console.log(`FAIL ${model.folder} ${action}: ${e.message}`);
        try { await saveFrame(page, `${OUT}/${PREFIX}-${model.folder}-${action}-failure.png`); } catch {}
      }
    }
    // one contact sheet per model: rows = actions, 8 frames each
    if (rowsForSheet.length) {
      const sheet = await page.evaluate((rows) => window.__a4sheet(rows.map((r) => ({
        label: r.label, frames: r.frames,
      }))), rowsForSheet);
      const path = `${OUT}/${PREFIX}-${model.folder}-sheet.png`;
      writeFileSync(path, Buffer.from(sheet.split(",")[1], "base64"));
      console.log(`sheet ${path}`);
    }
  } catch (e) {
    problems.push(`${model.folder}: ${e.message}`);
    console.log(`FAIL ${model.folder}: ${e.message}`);
    try { await page.screenshot({ path: `${OUT}/${PREFIX}-${model.folder}-run-failure.png` }); } catch {}
  } finally {
    await context.close();
  }
}

await browser.close();
for (const r of results) if (r && r.checks) r.checks.noPageErrors = pageErrors.length === 0;
const failures = results.filter((r) => !r.pass).map((r) => `${r.model} ${r.action}: ${(r.failures ?? []).join(",")}`);
writeFileSync(JSON_OUT, JSON.stringify({ generated: new Date().toISOString(), port: PORT,
  models: MODELS, spellTech: SPELL_TECH, itemId: ITEM_ID, pageErrors, meta, results }, null, 1));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} actions pass`);
if (pageErrors.length) console.log("page errors:", pageErrors.slice(0, 10).join(" | "));
console.log("json:", JSON_OUT);
process.exitCode = failures.length || pageErrors.length ? 1 : 0;
