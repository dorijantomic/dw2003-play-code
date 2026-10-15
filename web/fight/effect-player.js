// Battle visual-effect player — a faithful port of the fightstg effect object chain
// (decode: docs/research/fight-3d/tech-effects-decode.md, 2026-07-05):
//   op3 spawn (F0x8008bc80) → registry lookup (F0x80089be4: type → program bin + texture archive)
//   → one renderer per program sub-record (F0x8008966c → update F0x800893dc)
//   → screen-space sprite draw (F0x8008921c).
//
// A program sub-record drives 9 channels of a 2D sprite:
//   0 frame index (into the archive's FIELDCOM sprite directory)
//   1 CLUT row shift (palette cycling — approximated as-is for now, tracked but not recolored)
//   2 dx, 3 dy (screen-pixel offsets added after projection)
//   4 scaleX, 5 scaleY (0x1000 = 1.0; BOTH must be nonzero for the sprite to draw)
//   6,7,8 the three ROTATION ANGLES — tip (about X), turn (about Y), spin (about Z)
// ⚠️ CORRECTED 2026-08-16: channels 6 and 7 were called "color terms" and DROPPED, so every
// effect that tips or turns its sprite rendered flat. They are angles. The draw routine
// F0x8008921c (fightstg.s L6401-6423) passes instance +0x88/+0x8a/+0x8c to the interface's
// `+0x90` method = F0x8001f5ec (fns.s L16928), which stores them at the sprite object's
// +0x48/+0x4a/+0x4c — the argument RotMatrix F0x8002b65c (fns.s L30061) reads. Colour is a
// SEPARATE path entirely: `+0x9c` = F0x8001f628 copies four BYTES to +0x28..+0x2b.
// Record header {chanMask, stride(halfwords/frame), duration, 9×u16 defaults}; each frame
// overwrites only the masked channels, in channel order. The frame counter advances by the
// per-tick vsync delta (D0x800a4464 — the same `delta` the action VM steps by) and the
// instance dies at `duration`.
//
// Spawn position (copied verbatim from op3): z == 32767 or -1 → SCREEN-space (x,y are screen
// pixels, PSX 320×240, origin handled by the renderer); otherwise a world-space point that the
// renderer projects through the live battle camera (original: [0x800A454C]).
//
// This module is DOM-free (testable in node): step() advances instances, renderList() emits
// plain sprite descriptors; the host (battle3d/battle.js or the Effects Lab) owns images/canvas.

import { loadAssetImage } from "../assets.js";
// The effect system's channel-record stepper (F0x800893dc) and screen/world draw
// (F0x8008921c), ported once in engine/dw3/battle-effects.ts and proven against the
// original words by tests/engine/unit/battle-effects-oracle.test.ts. The browser
// consumes the port below; it no longer hand-writes the masked-channel playback or
// the screen/world/scale/rotation resolution.
import {
  newEffectSprite, stepEffectSprite, effectStreamFromRecord, effectDrawPlan,
  EFFECT_SCALE_ONE,
  newProjectileFlight, projectileRegistryFromIds,
} from "../vendor/engine.js";

const SCREEN_Z = new Set([32767, -1]);
const TURN = 4096;                              // PS1 angle units in one full turn

/**
 * The upper-left 2x2 of the PS1 rotation matrix — the part that transforms a screen sprite's
 * quad. RotMatrix (F0x8002b65c) composes **R = Ry · Rx · Rz**, pinned from the matrix it emits
 * rather than assumed: it writes m[0][2] = (cos_x · sin_y) >> 12 (fns.s L30147 `mult` + L30176
 * `sra 12`) and m[1][2] = -sin_x (L30162 `neg $a3`, $a3 = sin_x). Only Ry·Rx·Rz satisfies both.
 *   [ cy·cz + sy·sx·sz   -cy·sz + sy·sx·cz ]
 *   [ cx·sz               cx·cz            ]
 * With rx = ry = 0 this reduces to the plain spin the renderer already applied, so an
 * untipped/unturned sprite draws exactly as before.
 */
export function spriteMatrix2x2(rx, ry, rz) {
  const rad = (v) => ((v | 0) / TURN) * Math.PI * 2;
  const sx = Math.sin(rad(rx)), cx = Math.cos(rad(rx));
  const sy = Math.sin(rad(ry)), cy = Math.cos(rad(ry));
  const sz = Math.sin(rad(rz)), cz = Math.cos(rad(rz));
  return {
    a: cy * cz + sy * sx * sz,   // m[0][0]
    b: cx * sz,                  // m[1][0]
    c: -cy * sz + sy * sx * cz,  // m[0][1]
    d: cx * cz,                  // m[1][1]
  };
}
const BURST_TICKS = 40;     // safety-ceiling lifetime; landProjectiles() clears it at the strike

export class EffectPlayer {
  constructor(manifest) {
    this.manifest = manifest || { types: {}, archives: {}, op10_sounds: {} };
    this.instances = [];
    this.projectiles = [];
  }

  /** The op10 sound table (@0x800a368c): op10 effect type → packed sound id (sound-system.md). */
  op10Sound(type) { return this.manifest.op10_sounds?.[String(type)] ?? 0; }

  hasType(type) { return !!this.manifest.types?.[String(type)]; }

  /**
   * op3 sub=0: spawn every sub-record of the type's program bin.
   * pos = {x,y,z} verbatim op3 operands; side = "player" | "enemy" (whose action spawned it —
   * the renderer mirrors world offsets for the enemy, who faces the other way down the arena).
   */
  spawn(type, pos, side = "player") {
    const t = this.manifest.types?.[String(type)];
    if (!t) return 0;
    let n = 0;
    for (const rec of t.records) {
      this.instances.push({
        type, side, arch: t.arch, rec,
        pos: { x: pos.x | 0, y: pos.y | 0, z: pos.z | 0 },
        screen: SCREEN_Z.has(pos.z | 0),
        t: 0,
        chans: rec.defaults.slice(),
        // The live sprite the ported stepper drives (state 0 = unparsed). Its chans
        // and frame are the authority for renderList below.
        fx: newEffectSprite(effectStreamFromRecord(rec)),
      });
      n++;
    }
    return n;
  }

  /**
   * op6 mesh effect (decoded 2026-07-06, corrects the 07-05 "in-place burst" reading): the
   * flight object anchors the effect at `from` (the muzzle — matches the op3 muzzle-flash
   * coords) and never steps its own position, but THE MOTION IS AUTHORED DATA: each mesh
   * layer carries a ctrl bin (fightstg F0x800835f4) with keyframed translation / rotation /
   * scale tracks — a bullet's travel is a translation track ramping local z across the arena.
   * `to` = the ROOT ROTATION ANGLES (PS1 4096 = 360°; e.g. (0,2048,0) = 180° yaw so the
   * authored flight direction faces the enemy) — F0x80083e0c feeds it into the layer-0
   * rotation slot, `from` into the layer-0 translation slot, every frame. (The "speed
   * 0x280/0x100 constants" were the VRAM texture-slot coords, not a speed.)
   * Lifetime = the projectile's last authored keyframe (manifest `dur`; 30000 = hold).
   */
  spawnProjectile(id, from, to, side = "player") {
    const pr = this.manifest.projectiles?.[String(id)];
    // The flight object is built by the ported constructor FIGHTSTG_F0x80089844
    // (engine/dw3/battle-projectile.ts): it scans the op6 registry at 0x800a2550 for
    // the id and, when it is NOT registered, ends the object at once (end entry arg 3)
    // so nothing renders. `registered` replaces the walker's ad-hoc `!!pr` test with
    // the original's own decision. The browser manifest keeps only the resolved MEFT
    // pack per id (the extractor replaces the packed file/desc/meta words), so the
    // registry carries just the ids; the pack is still looked up by id at render time.
    const flight = newProjectileFlight(this._projectileRegistry(), id | 0, from, to);
    this.lastProjectile = { id, from, to, side, known: flight.registered };
    if (!flight.registered) return 0;                 // unknown id: nothing to render
    // Lifetime = the pack's compiled CLIP stream, which is what actually ends the flight in
    // the original: the animator walks one stream entry per tick and its 0xffff terminator
    // raises the end flag that FIGHTSTG_F0x8008970c frees the object on. `dur` - the last
    // authored track keyframe - is only the fallback for a pack whose clip did not decode,
    // and it disagrees with the clip for 17 of the 129 packs (see proj-layers.js).
    const ticks = pr.ticks > 0 ? pr.ticks : (pr.dur > 0 ? pr.dur : BURST_TICKS);
    this.projectiles.push({ id, side, from: from.slice(), to: to.slice(), t: 0, ticks, flight });
    return 1;
  }

  /** The op6 registry (0x800a2550) as the ids the manifest resolved, built once. */
  _projectileRegistry() {
    if (!this._projRegistry) {
      this._projRegistry = projectileRegistryFromIds(
        Object.keys(this.manifest.projectiles || {}).map(Number).filter((n) => Number.isFinite(n)));
    }
    return this._projRegistry;
  }

  /** Clear the flight meshes NOW — called on the attacker's op10 type-99 strike so the
   *  projectile ends with the impact + camera cut (the original clears the flight object on
   *  its ctrl-clip end flag; the strike is the authored sync point for the hit). */
  landProjectiles() { const n = this.projectiles.length; this.projectiles.length = 0; return n; }

  clear() { this.instances.length = 0; this.projectiles.length = 0; }
  get active() { return this.instances.length > 0 || this.projectiles.length > 0; }

  /** Active flight meshes this tick: id + side + root anchor (muzzle) + root rotation angles
   *  + elapsed ticks `t` (the ctrl-track sample time). The GL host (battle3d) resolves
   *  id -> mesh/atlas/tracks and animates each layer's TRS from its ctrl tracks. */
  projectileList() {
    return this.projectiles.map((p) => {
      return {
        id: p.id, side: p.side, t: p.t, u: Math.min(1, p.t / p.ticks),
        pos: { x: p.from[0], y: p.from[1], z: p.from[2] },
        rot: { x: p.to[0], y: p.to[1], z: p.to[2] },
      };
    });
  }

  /** One PS1 logic tick; delta = the vsync step (same delta as ActionVM.step). */
  step(delta = 1) {
    const keep = [];
    for (const ins of this.instances) {
      // The ported stepper FIGHTSTG_F0x800893dc (engine/dw3/battle-effects.ts): its
      // first call parses the record header and the nine defaults and falls through
      // into the first frame; every later call overwrites only the mask-selected
      // channels at the current frame, adds `delta` to `frame`, and ends once that
      // reaches `duration`. One row per call — a delta above 1 skips rows.
      //
      // The DRAW lives inside that body, BEFORE the frame increment and the end test
      // (fightstg.s .L0x800895bc-.L0x80089640: the scale gate and the registry/draw call,
      // then `frame += delta` and `frame < duration`). So the tick on which `frame`
      // reaches `duration` still DRAWS the row it just applied, and only the next call
      // (state 2 -> 3) is drawless. Dropping the instance the moment the stepper reports
      // the end loses the final authored frame of every op3 effect.
      const preState = ins.fx.state | 0;
      const alive = stepEffectSprite(ins.fx, delta);
      ins.chans = ins.fx.chans;
      ins.t = ins.fx.frame;
      if (alive || preState <= 1) keep.push(ins);   // state 0/1 on entry = it drew this tick
    }
    this.instances = keep;

    const bursts = [];
    for (const p of this.projectiles) {
      p.t += delta;
      if (p.t < p.ticks) bursts.push(p);
    }
    this.projectiles = bursts;
  }

  /**
   * Sprite descriptors for this tick. The host resolves each against
   * manifest.archives[arch] (sheet png + frames[] rects) and its own projection:
   *   screen=true  → (x,y) are PSX screen px (origin = screen centre), draw at that point
   *   screen=false → (x,y,z) is a PS1-world point relative to the attacker's arena slot
   * dx/dy are post-projection pixel offsets; sx/sy are ×4096 scale factors.
   */
  renderList() {
    const out = [];
    for (const ins of this.instances) {
      // The draw resolution F0x8008921c, ported: which space the point is in (the
      // two z sentinels), the frame, the CLUT shift, the scale (identity only when
      // BOTH halves are exactly 0x1000) and whether the rotation call fires. The
      // host still owns the projection and the pixel mapping, so the raw pos/dx/dy
      // travel through as before.
      const ch = ins.fx.chans;
      const plan = effectDrawPlan({
        pos: ins.pos, chans: ch,
        clipRefA: ins.rec.clipA | 0, clipRefB: ins.rec.clipB | 0, clipId: ins.rec.clipId | 0,
      });
      const scale = plan.scale ?? { x: EFFECT_SCALE_ONE, y: EFFECT_SCALE_ONE };
      const sx = scale.x / 0x1000, sy = scale.y / 0x1000;
      if (!sx || !sy) continue;                      // F0x800893dc: draw only when scaled
      const rot = plan.rotation ?? { x: 0, y: 0, z: 0 };
      out.push({
        arch: ins.arch, frame: plan.frame, clutShift: plan.clut,
        side: ins.side, screen: plan.screen, pos: ins.pos,
        dx: ch[2] | 0, dy: ch[3] | 0, sx, sy,
        // The three RotMatrix angles about the draw point (PS1 units: 4096 = 360 deg).
        // The spin (channel 8) was decoded from type 1009's 4-petal bloom (angles
        // 512/1536/2560/3584) and the 9-way radial burst (steps of ~170 = 4096/24);
        // the tip and turn come from the same F0x8001f5ec call — see the header.
        rotX: rot.x, rotY: rot.y, rotZ: rot.z,
        // Retained so an older consumer reading `rot` still gets the spin it expects.
        rot: rot.z * Math.PI * 2 / TURN,
      });
    }
    return out;
  }
}

/** Load the manifest + sheet images in a browser (helper for battle3d / the lab). */
export async function loadEffectAssets(base = "assets/battle/effects") {
  const manifest = await (await fetch(`${base}/manifest.json`)).json();
  const images = {};
  await Promise.all(Object.entries(manifest.archives).map(async ([a, rec]) => {
    try { images[a] = await loadAssetImage(`${base}/${rec.sheet}`); }
    catch { /* Missing optional effect sheets remain non-fatal. */ }
  }));
  return { manifest, images };
}

/**
 * Draw one tick's sprites onto a 2D context. `view`:
 *   worldToScreen(psxOffset, side) → {x,y} canvas px (project an attacker-relative PS1 point)
 *   centerX, centerY (canvas px of the PSX screen centre), pxScale (canvas px per PSX px)
 */
export function drawEffects(ctx, list, manifest, images, view) {
  for (const s of list) {
    const arch = manifest.archives[String(s.arch)];
    const img = images[String(s.arch)];
    if (!arch || !img) continue;
    // Channel 0 is a CLIP ID in the archive's sprite directory (drawn by EXE F0x8001ed6c —
    // the same directory-draw as field point-sprites/screen packs), pre-composed by the
    // extractor into one sheet rect with its authored anchor offset (ox,oy).
    // clutShift (channel 1) selects a palette-cycled variant, pre-cut as "id@shift"
    const clip = (s.clutShift ? arch.clips?.[`${s.frame}@${s.clutShift & 0xFF}`] : null)
      ?? arch.clips?.[String(s.frame)];
    if (!clip || !clip.w || !clip.h) continue;
    let x, y;
    if (s.screen) {
      // BOTH sentinels are CENTRE-relative. The draw routine F0x8008921c (fightstg.s
      // L6334-6376) tests z against 0x7fff and against -1 and sends both to the same block at
      // .L0x8008926c, which stores x and y into the draw point unchanged; the sentinels differ
      // only in the OT depth stored next (0 vs 0xfff), i.e. how far forward the sprite sits,
      // never where it sits. The shipped data agrees: of 1,450 screen-space op3 spawns across
      // the 245 model packs, 1,300 are (0,0) - on the Digimon the camera centres - and the
      // negative ones (-101,39), (-30,-15) only mean anything against a centre. The 18 at
      // (-160,-120) are full-screen clips pinned to the top-left corner, and type 2041's own
      // record adds dx/dy = (160,120) to bring its clip back to the middle.
      // Treating 0x7fff as absolute 320x240 threw all 1,300 into the top-left corner: Diamond
      // Storm's shard burst and four-petal bloom drew there instead of around Renamon.
      x = view.centerX + s.pos.x * view.pxScale;
      y = view.centerY + s.pos.y * view.pxScale;
    } else {
      const p = view.worldToScreen(s.pos, s.side);
      if (!p) continue;
      x = p.x; y = p.y;
    }
    x += s.dx * view.pxScale;
    y += s.dy * view.pxScale;
    // Negative scale = MIRROR about the draw point (PS1 sprite scaling is signed — the DNA
    // fusion burst 1004 and orb 1006 are the mirrored halves/pair; they were silently
    // dropped when the negative width fell through the < 1 cull).
    const fx = s.sx < 0 ? -1 : 1, fy = s.sy < 0 ? -1 : 1;
    const w = clip.w * Math.abs(s.sx) * view.pxScale;
    const h = clip.h * Math.abs(s.sy) * view.pxScale;
    if (w < 1 || h < 1) continue;
    ctx.save();
    // PS1 semi-transparency mode from the clip record: 1 = B+F (additive), 3 = B+F/4,
    // 0 = B/2+F/2 (half-mix), 2 = B-F (approximated), else opaque. (Same mapping as the
    // shipped field-effect renderer web/effects.js.)
    const semi = clip.semi;
    if (semi === 1) ctx.globalCompositeOperation = "lighter";
    else if (semi === 3) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.25; }
    else if (semi === 0) ctx.globalAlpha = 0.5;
    else if (semi === 2) {
      // PS1 subtract (B - F): canvas has no subtract op; multiply by the inverted
      // sprite gives B*(1-F) ~ B - B*F — darkens like the original ('difference'
      // INVERTS bright areas: that was the blue-Digimon bug).
      ctx.globalCompositeOperation = "multiply";
      ctx.filter = "invert(1)";
    }
    // Rotate about the draw point, mirror if scale is negative, then place the authored
    // anchor (ox,oy) — the flip moves the anchor to the other side by itself. All THREE
    // angles apply: tip and turn foreshorten the sprite's quad (its plane turns away from
    // the camera), spin turns it in the screen plane. Sprites with no angles skip the
    // transform entirely, so the common case is untouched.
    ctx.translate(x, y);
    const rx = s.rotX | 0, ry = s.rotY | 0;
    const rz = s.rotZ != null ? (s.rotZ | 0) : Math.round((s.rot || 0) * TURN / (Math.PI * 2));
    if (rx || ry) {
      const m = spriteMatrix2x2(rx, ry, rz);
      ctx.transform(m.a, m.b, m.c, m.d, 0, 0);
    } else if (rz) {
      ctx.rotate((rz / TURN) * Math.PI * 2);
    }
    if (fx < 0 || fy < 0) ctx.scale(fx, fy);
    const dx = clip.ox * Math.abs(s.sx) * view.pxScale;
    const dy = clip.oy * Math.abs(s.sy) * view.pxScale;
    ctx.drawImage(img, clip.x, clip.y, clip.w, clip.h, dx, dy, w, h);
    // The PS1 blends a semi-transparent sprite only where the palette entry's STP bit is
    // set; a texel with the bit clear is drawn SOLID inside the same sprite. The extractor
    // packs those texels as a second, pixel-disjoint region, so drawing it here under the
    // default compositing reproduces the split exactly. 62 of the 1,757 shipped clips carry
    // one, and within them 60.6% of the drawn pixels are solid — E144ROSE's petal and the
    // arch-1 rings are 86% to 99% solid and were being drawn wholly additive.
    if (clip.solid) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      ctx.drawImage(img, clip.solid.x, clip.solid.y, clip.solid.w, clip.solid.h, dx, dy, w, h);
    }
    ctx.restore();
  }
}
