import { arenaSlot, arenaSlotFor, modelKeyFromFolder, attackReachZ } from "../camera-shots.js";
import { MODEL_SCALE, ps1ToRender } from "../math.js";
import { loadTexture, loadTexturePixels, drawSkeletalMesh, fighterTint } from "../gl.js";
import { loadSkeletalModel, buildSkeletalGLBuffers, _updateSkeletalVBOGL } from "../skeleton.js";
import { ActorAnimator } from "../../fight/actor-animator.js";
import { TexturePatchAnimator } from "../../fight/texture-patch-animator.js";
import { REACTION_DEATH_CLIP, REACTION_EVADE_CLIP, REACTION_HIT_CLIP } from "../../fight/fight-tables.js";
import { buildBoneWorldMatrices } from "../rotation.js";
import type { Battle3dFighter } from "./types.js";
import type { AttackOptions, Battle3DContext } from "../../types/battle3d.js";

import type { ArenaGroupBuf, ArenaPack } from "../../types/battle3d.js";
import type { BattleSide } from "../../types/audio.js";
import type { AnimHooks } from "../../types/battle3d.js";
// moved by tools/rewrite/split-closure.mjs
export function makeFighters(B$: Battle3DContext) {
function _layoutExtras() {
    if (!B$.multiCam) { B$.arenaScale = 1; for (const f of B$.extras.values()) { f.dxT = f.dx0; f.dz = 0; } return; }
    let scale = 1;
    for (const side of ["player", "enemy"]) {                  // each side by its own widths, gap and slant
      const list = [...B$.extras.values()].filter((f) => f.side === side).sort((a, b) => a.dx0 - b.dx0);
      const maxW = Math.max(0, ...list.map((f) => f.restW || 0));
      if (!list.length || !(maxW > 0)) continue;               // nothing measured yet: keep the caller's lanes
      const gap = Math.max(B$.MULTI_GAP_MIN, maxW * B$.MULTI_GAP_FRAC);
      const w = list.map((f) => f.restW || maxW);
      // centre to centre: half of each width + the gap, never less than the old fixed lane (1900)
      const step = (i: number) => Math.max(B$.MULTI_LANE_MIN, w[i] / 2 + w[i + 1] / 2 + gap);
      let c = 0; const cx = [0];
      for (let i = 0; i + 1 < list.length; i++) cx.push(c += step(i));
      const span = c + w[0] / 2 + w[list.length - 1] / 2;
      scale = Math.max(scale, span / (maxW + gap));
      const away = Math.sign(arenaSlot(null, side).z) || 1;  // PS1 z: further from the opponent
      list.forEach((f, i) => {
        f.dxT = cx[i] - c / 2;
        f.dz = away * (i - (list.length - 1) / 2) * B$.MULTI_ECHELON * Math.max(B$.MULTI_LANE_MIN, maxW + gap);
      });
    }
    // the smart camera (F2 -> Screen) turns away from the rock itself, and does better with the arena at full size
    // (tools/verify_smart_cam.mjs: meft1009 near rock on the fighters 5% at the lowered scale, 0% at full)
    B$.arenaScale = window.__fx?.smartcam ? Math.min(B$.MULTI_ARENA_MAX, scale) : _arenaScaleClear(Math.min(B$.MULTI_ARENA_MAX, scale));
  }
function _rockCover(groups: ArenaGroupBuf[], s: number, cam, fs: Pick<Battle3dFighter, "aabb">[], aspect: number) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const nrm = (a: number[] | (number | undefined)[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const fwd = nrm(sub(cam.look, cam.eye)), right = nrm([-fwd[2], 0, fwd[0]]);
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    const t = Math.tan(cam.fovDeg * Math.PI / 360);
    let near = Infinity, feet = Infinity;
    for (const f of fs) {
      const c = [(f.aabb.min[0] + f.aabb.max[0]) / 2, (f.aabb.min[1] + f.aabb.max[1]) / 2, (f.aabb.min[2] + f.aabb.max[2]) / 2];
      near = Math.min(near, dot(sub(c, cam.eye), fwd)); feet = Math.min(feet, f.aabb.min[1]);
    }
    const GW = 100, GH = 36, hit = new Uint8Array(GW * GH), k = MODEL_SCALE * s;
    const xs = [0, 0, 0], ys = [0, 0, 0];
    for (const g of groups) {
      const pos = g.pos; if (!pos) continue;
      tri: for (let i = 0; i + 8 < pos.length; i += 9) {
        let top = -Infinity, anyNear = false;
        for (let v = 0; v < 3; v++) {
          const p = [pos[i + v * 3] * k, -pos[i + v * 3 + 1] * k, -pos[i + v * 3 + 2] * k];
          top = Math.max(top, p[1]);
          const d = sub(p, cam.eye), z = dot(d, fwd);
          if (z <= 1) continue tri;
          if (z < near * 0.9) anyNear = true;
          xs[v] = (dot(d, right) / (z * t * aspect) * 0.5 + 0.5) * GW; ys[v] = (0.5 - dot(d, up) / (z * t) * 0.5) * GH;
        }
        if (!anyNear || top < feet + 40) continue;
        const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
        if (!area) continue;
        const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(GW - 1, Math.ceil(Math.max(...xs)));
        const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(GH - 1, Math.ceil(Math.max(...ys)));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const a = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / area;
          const b = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / area;
          if (a >= 0 && b >= 0 && a + b <= 1) hit[y * GW + x] = 1;
        }
      }
    }
    let n = 0; for (const h of hit) n += h;
    return n / (GW * GH);
  }
function _arenaScaleClear(want: number, pk: ArenaPack | null = B$.activeArena) {
    if (!(want > 1)) return 1;
    const groups = pk?.groups, fs = [...B$.extras.values()].filter((f) => f.aabb);
    if (!groups?.length || !B$.lastCamInfo || !fs.length) return B$.arenaScale;   // not ready: keep what is drawn now
    const key = `${pk.name}|${want.toFixed(2)}`;
    if (B$.rockCoverCache.has(key)) return B$.rockCoverCache.get(key);
    const aspect = B$.canvas.width / Math.max(1, B$.canvas.height);
    const base = _rockCover(groups, 1, B$.lastCamInfo, fs, aspect);
    let s = want;
    for (let i = 0; i < 10 && s > 1; i++, s = Math.max(1, want - (want - 1) * i / 9)) {
      if (_rockCover(groups, s, B$.lastCamInfo, fs, aspect) <= base + 0.01) break;
    }
    B$.rockCoverCache.set(key, s);
    return s;
  }
/** (checks) the scale this arena pack would get for the current line-up and camera; null while it loads. */
  function probeArenaScale(name: string, want: number) { const pk = B$.loadArenaPack(name); return pk?.groups ? _arenaScaleClear(want, pk) : null; }
function getMultiLayout() {
    return { arenaScale: B$.arenaScale, arena: B$.activeArena?.name ?? null, fighters: [...B$.extras.values()].map((f) => ({ id: f.id, side: f.side, dx: f.dx, dxT: f.dxT, dz: f.dz, restW: f.restW, aabb: f.aabb ? { min: [...f.aabb.min], max: [...f.aabb.max] } : null })) };
  }
function addFighter(id: string, side: BattleSide, folder: string, dx: number = 0) {
    const old = B$.extras.get(id);
    removeFighter(id);
    const f = { id, side, folder, dx: old ? old.dx : dx, dx0: dx, dxT: old ? old.dxT : dx, dz: old ? old.dz : 0, latz: 0, latzT: 0, restW: 0, born: null,
      lat: 0, latT: 0, follow: null, model: null, bufs: null, tex: null, anim8r: null, frame: 0,
      visible: true, phase: Math.random() * 6.28, pos: [0, 0, 0], aabb: null } as Battle3dFighter;
    B$.extras.set(id, f);
    f.tex = loadTexture(B$.gl, `assets/battle/textures/${folder}.png`);
    return loadSkeletalModel(folder).then((m) => {
      if (!m || B$.extras.get(id) !== f) return false;
      f.model = m;
      f.bufs = buildSkeletalGLBuffers(B$.gl, m);
      f.frame = m.clips?.[0]?.start_frame ?? 0;
      f.anim8r = new ActorAnimator(m);
      f.anim8r.resetSlotPlacement(arenaSlotFor(folder, side, B$.placementTable));
      B$.preloadModelProjectiles(m.actions);
      _setupExtraPatches(f);
      return true;
    });
  }
// the eyes and looping body textures of an extra fighter, the same animator the two main ones use
  function _setupExtraPatches(f: Battle3dFighter) {
    const entries = B$.placementTable[modelKeyFromFolder(f.folder)]?.texture_anim;
    f.patches = entries && entries.length ? new TexturePatchAnimator(entries) : null;
    if (f.patches) loadTexturePixels(`assets/battle/textures/${f.folder}.png`).then((page) => { if (B$.extras.get(f.id) === f) f.page = page; });
  }
function removeFighter(id: string) {
    const f = B$.extras.get(id);
    if (!f) return;
    B$.extras.delete(id); B$.fighterScreen.delete(id);
    B$.releaseActorResources([f.tex, f.bufs, f.model]);
  }
function clearFighters(side: BattleSide | null = null) { for (const f of [...B$.extras.values()]) if (!side || f.side === side) removeFighter(f.id); }
function setFighterLane(id: string, dx: number) { const f = B$.extras.get(id); if (f) { f.dx0 = dx; if (!B$.multiCam) f.dx = f.dxT = dx; } }
function setFighterVisible(id: string, v: boolean) { const f = B$.extras.get(id); if (f) f.visible = !!v; }
function setMultiCamera(on: boolean) { B$.multiCam = !!on; }
function fightersReady() { for (const f of B$.extras.values()) if (!f.anim8r) return false; return true; }
function fightersBusy() { return B$.coordinator.active; }
function getFighterScreen(id: string) { return B$.fighterScreen.get(id) ?? null; }
// A hurt Digimon stands in its low-HP stance (the same base idle table the main fighters use).
  function setFighterHurt(id: string, low: boolean) { const f = B$.extras.get(id); if (f?.anim8r) f.anim8r.baseTable = low ? 1 : 0; }
function fighterVictory(id: string) {
    const f = B$.extras.get(id);
    const table = B$.victoryTable(f?.model);
    if (!f?.anim8r || !table || !table.length) return false;
    f.anim8r.playTimelineTable(table);
    return true;
  }
/** A fighter plays one technique's own motion with nobody on the receiving end (a heal, a buff). */
  function fighterTech(id: string, techId: number) {
    const f = B$.extras.get(id);
    if (!f?.anim8r) return false;
    if (B$.sfx) { B$.sfx.stopBattle("player"); B$.sfx.stopBattle("enemy"); }
    B$.contactSoundType[f.side] = B$.contactSoundTypeFor(techId);
    return f.anim8r.setAnimByTech(techId, B$._fxHooks(f.side, { onMotion: B$.dataFieldMotion }));
  }
/** A fighter plays a raw action clip (10 = the item-use motion). */
  function fighterAction(id: string, clip: number) {
    const f = B$.extras.get(id);
    return f?.anim8r ? f.anim8r.setAction(clip, B$._fxHooks(f.side)) : false;
  }
/** A bystander's reaction (a spread attack hits several): the same op1 reaction clips the coordinator picks. */
  function fighterReact(id: string, { lethal = false, miss = false } = {}) {
    const f = B$.extras.get(id);
    if (!f?.anim8r) return false;
    const clip = lethal ? REACTION_DEATH_CLIP : miss ? REACTION_EVADE_CLIP : REACTION_HIT_CLIP;
    return f.anim8r.setAction(clip, B$._fxHooks(f.side), { holdFinalPose: clip === REACTION_DEATH_CLIP });
  }
// The attacker plays techId's clip; at its strike the defender plays its reaction (survive / die / dodge), exactly as in the
  // two-fighter attack. Positions in the action records are absolute arena coordinates authored for ONE fighter per side, so
  // the ones that land in a lane other than the middle one are shifted sideways into the right lane here.
  function fighterAttack(attId: string, defId: string, techId: number, opts: AttackOptions = {}) {
    const A = B$.extras.get(attId), D = B$.extras.get(defId);
    if (!A?.anim8r || !D?.anim8r) return false;
    const { lethal = false, miss = false, ...hooks } = opts as AttackOptions;
    if (B$.sfx) { B$.sfx.stopBattle("player"); B$.sfx.stopBattle("enemy"); }
    B$.contactSoundType[A.side] = B$.contactSoundTypeFor(techId);
    B$.contactEvade[A.side] = miss;
    B$.armDataField(techId);                      // a special's element backdrop, same as in a one-on-one fight
    const aLane = D.dx, dLane = D.dx, aDz = D.dz, dDz = D.dz;   // the lane (and slant step) that leads to the target
    // a clip that carries the attacker in (a dash or a leap) closes the sideways gap together with its own forward travel, so
    // the way in is the straight line from its own place to the target's; a clip that stays put (a cast) slides over first
    const nearX = () => (A.follow ? A.dx + A.lat : aLane), nearZ = () => (A.follow ? A.dz + A.latz : aDz);
    // an effect whose z is on the defender's side of the arena is at the defender; otherwise it is at the attacker
    const atDefender = (z: number, defSide: string) => (defSide === "enemy" ? z > 0 : z < 0);
    const val = (v: number | (() => number) | (() => number)) => (typeof v === "function" ? v() : v);
    const shiftFx = (h: AnimHooks, laneNear: number | (() => number), laneFar: number, defSide: string, zNear: number | (() => number), zFar: number) => ({
      ...h,
      onEffect: (rec) => h.onEffect?.({ ...rec, x: (rec.x | 0) + val(atDefender(rec.z | 0, defSide) ? laneFar : laneNear), z: (rec.z | 0) + val(atDefender(rec.z | 0, defSide) ? zFar : zNear) }),
      setLunge: (l) => h.setLunge?.(l && l.sub === 0 && l.from ? { ...l, from: [l.from[0] + val(laneNear), ...l.from.slice(1)] } : l),
    });
    const attHooks = shiftFx(B$._fxHooks(A.side, B$._impactContact({ ...hooks, onMotion: B$.dataFieldMotion })), nearX, dLane, D.side, nearZ, dDz);
    const defHooks = shiftFx(B$._fxHooks(D.side), dLane, dLane, D.side, dDz, dDz);
    A.follow = null;
    const started = B$.coordinator.attack(A.anim8r, D.anim8r, techId, attHooks, { lethal, miss, defenderHooks: defHooks });
    const reach = attackReachZ(A.anim8r.vm?.ops, (A.anim8r.homeSlot || arenaSlot(null, A.side)).z, !!A.anim8r._standsOnOtherSide?.());
    if (reach > 0) { A.follow = { dx: D.dx - A.dx, dz: D.dz - A.dz, reach }; A.latT = 0; A.latzT = 0; }
    else { A.latT = D.dx - A.dx; A.latzT = D.dz - A.dz; }   // run along the lane that leads to the target, and come back afterwards
    return started;
  }
// Per frame: pose every extra fighter into its own skeleton buffer (before the camera, so it can frame them).
  function _updateExtras(alpha: number, ARENA: number) {
    for (const f of B$.extras.values()) {
      if (!f.model || !f.bufs || !f.anim8r) { f.aabb = null; continue; }
      const a = f.anim8r;
      const home = a.homeSlot || arenaSlot(null, f.side);
      const mv = a.moveDelta();
      const pos = ps1ToRender([home.x + mv[0] + f.dx + f.lat, home.y + mv[1], home.z + mv[2] + (f.dz || 0) + f.latz], ARENA);
      pos[1] += Math.sin(B$.animTime * 3 + f.phase) * 2;
      const yaw = f.side === "player" ? -(((a.rotation?.()[1] || 0) - (a.rotationBase || 0)) * Math.PI * 2 / 4096) : Math.PI;
      const sample = a.isActive ? a.renderSample(alpha) : null;
      if (sample) f.frame = sample.frame;
      const bwm = buildBoneWorldMatrices(f.model, f.frame, sample ? sample.blend : null, a.currentHiddenParts?.());
      f.pos = pos;
      f.aabb = _updateSkeletalVBOGL(B$.gl, f.model, f.bufs, bwm, pos, MODEL_SCALE, false, yaw);
      if (f.born == null) f.born = B$.animTime;
      if (f.aabb && B$.animTime - f.born < B$.MULTI_MEASURE_S && !B$.coordinator.active)       // its own width, while it idles
      { f.restW = Math.max(f.restW, (f.aabb.max[0] - f.aabb.min[0]) / ARENA); f.restH = Math.max(f.restH || 0, f.aabb.max[1] - f.aabb.min[1]); }
    }
  }
function _drawExtras(pv: Float32Array) {
    for (const f of B$.extras.values()) {
      if (!f.visible || !f.model || !f.bufs) continue;
      drawSkeletalMesh(B$.gl, B$.texP, pv, f.bufs, f.tex || B$.whiteTex, fighterTint(f.side === "enemy" ? "enemy" : "player"));
      B$.drawShadow(B$.gl, B$.texP, pv, f.pos, 20, 8);
    }
  }
  return { _layoutExtras, _rockCover, _arenaScaleClear, probeArenaScale, getMultiLayout, addFighter, _setupExtraPatches, removeFighter, clearFighters, setFighterLane, setFighterVisible, setMultiCamera, fightersReady, fightersBusy, getFighterScreen, setFighterHurt, fighterVictory, fighterTech, fighterAction, fighterReact, fighterAttack, _updateExtras, _drawExtras };
}
