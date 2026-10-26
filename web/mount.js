// web/mount.js — riding a Digimon on the field: the rules, the speed, the followers, the toggle.
//
// A quest unlocks a mount (a data row in MOUNTS) and the player rides it on field maps: climb on with the
// ladder climb's own mount clip (p002plyl clip 28 — web/game.js "Ladder climbing"), stand on its back while
// it walks at MOUNT_SPEED times the walk, and come off next to it. The walk is drawn live by web/mount3d.js.
//
// The PLAYER stays the authority for position while riding: the mount copies the player's x/y/dir each
// frame, so wall collision, exits, step triggers and the camera are exactly the game's own code paths and
// nothing has to be re-tested for them. What this module adds is: the speed factor (with collision
// sub-steps), hiding/restoring the followers, refusing encounters, the ride/dismount animation and the
// per-mount unlock.
//
// Everything is OFF unless F2 -> Extras -> Mount is on AND the mount is unlocked, so normal play is
// unchanged (tests/mount.test.js proves it position by position).
import { MOUNT_VIEW, loadMountAsset, renderMount, mountSplit, mountRenderInfo, probeFramebuffer, renderSelfTest, sceneProbe } from "./mount3d.js";

/**
 * The mount table. One row per rideable Digimon; adding a second mount is a new row plus the quest that
 * sets its `unlock` id — nothing else. Every number is measured or a named tuning constant:
 *
 *   model   a DW2 glTF under web/dw2models/ (git-ignored, local only; if it is missing the row hides itself)
 *   walk    how the legs move: { kind: "gait" } = the procedural four-beat gait web/mount3d.js calibrates
 *           from the model's own leg chains (used when the model has no walk clip — Unimon: measured, none
 *           of its 11 battle clips nor its 2 overworld clips is a walk loop, tools/measure_dw2_clips.mjs),
 *           or { kind: "clip", name: "anim_C1", fps: 30 } when a clip IS a measured walk loop.
 *   forward the unit vector the model faces in its own space, measured by measureRig (head joint vs body root)
 *   speed   x the game's walk magnitude while riding (MOUNT.md: start at 3x, one constant)
 *   back    pixels the rider stands above the ground (the model's body-root height, scaled)
 *   size    pixels tall the rendered model is (a person is ~35 px)
 *   unlock  the quest id whose completion grants this mount (web/quests.js done state — never a story flag)
 */
export const MOUNTS = [
  {
    id: "unimon",
    name: "Unimon",
    model: "dw2models/328QUNI.gltf",
    // DW2 field model: anim_E1 is its gallop (front and hind hoof pairs take turns, measured), anim_E0 its
    // stand. Forward +Z measured: neck/head bones rise toward +Z, tail toward -Z, planted hooves slide to -Z.
    walk: { kind: "clip", name: "anim_E1", idle: "anim_E0", cycle: 0.367 },
    forward: [0, 0, 1],
    speed: 3,
    back: 21,              // the torso top on screen through the 50 deg field camera: 20-22 px (measured, 328QUNI anim_E0)
    // the rider's feet row while riding: the torso spans 9.4..21.2 px above the ground at its centre (measured
    // through the renderer's camera, every facing), so feet at 12 px let the body hide the rider's lower legs
    sit: 12,
    // the saddle, for the depth split (F2 -> Extras -> "Rider sits in the saddle", off by default): a point local to
    // the torso mesh bone (node 15, under the body root 0) on the torso top (local y 400 = the highest torso vertex in
    // that column, anim_E0), at z 62 = the mean z of the four leg tops (332, 332, -208, -208);
    // ~/scratch-research/mount/seat.mjs. The rider's feet go `drop` px below its screen point: back - sit above.
    seat: { node: 15, at: [0, 400, 62], drop: 9 },
    // ground shadow: hoof spread 18.8 px front-back x 16.1 px across (stand pose), plus 8 px each way
    shadow: { length: 27, width: 24 },
    size: 68,
    unlock: "zz_mount",
    // the quest character (web/extra_npcs.json resident 1006, Central Park beside the hole at 608,480): until the quest
    // is done he lies hurt (the last frame of the DW2 battle model's anim_K: body at 0.27 of its standing height, tilted
    // 92 deg onto its side, measured); after it he stands in the field model's anim_E0
    actor: { npc: 1006, hurt: { model: "dw2models/033UNIM.gltf", clip: "anim_K", at: 1 } },
  },
];

export const MOUNT_SPEED = 3;           // x the walk, the one constant MOUNT.md names
export const MOUNT_KEY = "r";           // ride / dismount
const SUMMON_SECS = 0.35;               // the mount fades in where the player stands before the climb starts
const MOUNT_SECS = 19 / 60;             // the disc's own mount-onto-the-rail clip length (game.js MOUNT_SECS_BOTTOM)
const DISMOUNT_SECS = 13 / 60;          // ... and its step-off (DISMOUNT_SECS_BOTTOM)
const MOUNT_CLIP = 28, DISMOUNT_CLIP = 31;   // p002plyl: mode 0x43 step-on, mode 0x46 step-off

const S = {
  mode: "idle",            // idle | summoning | mounting | riding | dismounting
  def: null,
  animT: 0,
  phase: 0,
  x: 0,
  y: 0,
  dir: "down",
  moving: false,
  granted: new Set(),      // mount ids unlocked by a quest (filled from the quest layer each tick)
  asset: null,
  loading: false,
  rendererFailed: false,
  lastRender: 0,
  renders: 0,
  rider: null,             // the saddle split's seat this frame: { dx, lift, seatX, seatY } (null without it)
};

let host = null;

/** Install the game-side hooks. `host.canStand(x,y)` is the game's own foot-box test. */
export function installMount(hooks) {
  host = hooks;
  loadSeats();             // the saved rider settings (web/mount-seats.json); missing file = the measured defaults
  S.granted = new Set();
  S.mode = "idle";
  S.def = null;
  S.asset = null;
  S.loading = false;
}

export function mountState() {
  return {
    mode: S.mode, mount: S.def?.id ?? null, phase: S.phase, x: S.x, y: S.y, dir: S.dir,
    moving: S.moving, asset: !!S.asset, enabled: enabled(), unlocked: unlockedIds(),
    speed: S.mode === "riding" ? (S.def?.speed ?? MOUNT_SPEED) : 1, renders: S.renders,
  };
}

/** The mount whose quest character is this npc id, or null. */
export function mountActorDef(npcId) {
  return MOUNTS.find((m) => m.actor?.npc === npcId) ?? null;
}

/** A mount's quest character is off the map while the layer is off, and while the player rides it. */
export function mountActorHidden(npc) {
  const def = mountActorDef(npc?.npc_id);
  if (!def) return false;
  if (!enabled()) return true;
  return !!host?.questDone?.(def.unlock) && S.mode !== "idle";
}

const actorAssets = new Map();   // url -> asset | null (loading or missing)
function actorAsset(key, url) {
  if (actorAssets.has(url)) return actorAssets.get(url);
  actorAssets.set(url, null);
  loadMountAsset(key, url).then((a) => actorAssets.set(url, a)).catch(() => {});
  return null;
}

/** Draw a mount's quest character at its post: hurt before its quest is done, standing after. Draws nothing while
 * the model is loading or missing. Renders and paints in one go (the renderer's canvas is shared). */
export function mountActorDraw(ctx, npc, camX, camY, timeSec = 0) {
  const def = mountActorDef(npc?.npc_id);
  if (!def || mountActorHidden(npc)) return false;
  const healed = !!host?.questDone?.(def.unlock);
  const hurt = def.actor.hurt;
  const asset = healed ? actorAsset(def.id, def.model) : actorAsset(def.id + "-hurt", hurt.model);
  if (!asset) return false;
  const canvas = renderMount(asset, {
    x: npc.x, y: npc.y, dir: npc.dir ?? "down", moving: false, size: def.size ?? 68, timeSec,
    walk: healed ? def.walk : null, still: healed ? null : { clip: hurt.clip, at: hurt.at ?? 1 },
  });
  if (!canvas) return false;
  ctx.drawImage(canvas, Math.round(npc.x - MOUNT_VIEW.w / 2 - camX), Math.round(npc.y - MOUNT_VIEW.h + 8 - camY));
  return true;
}

/** Is the mount layer switched on? (F2 -> Extras -> Mount, off by default.) */
export function mountEnabled() { return enabled(); }
function enabled() { return !!host?.enabled?.(); }

/** The mount ids the player has unlocked (their quest is done), in table order. */
export function unlockedIds() {
  const out = [];
  for (const m of MOUNTS) if (m.unlock && host?.questDone?.(m.unlock)) out.push(m.id);
  return out;
}
function unlockedDef() {
  for (const m of MOUNTS) if (m.unlock && host?.questDone?.(m.unlock)) return m;
  return null;
}

export const mountRiding = () => S.mode === "riding";
export const mountHidesFollowers = () => S.mode === "riding";
/** The rider's own shadow is off the ground (the mount's shadow lies under both). */
export const mountHidesRiderShadow = () => S.mode === "mounting" || S.mode === "riding";
export const mountFreezesInput = () => S.mode === "summoning" || S.mode === "mounting" || S.mode === "dismounting";

/** The walk-speed multiplier the movement block applies (1 when not riding). */
export function mountSpeedFactor() { return S.mode === "riding" ? (S.def?.speed ?? MOUNT_SPEED) : 1; }

// verifier-only switches (tools/verify_mount_seat.mjs): hold the idle clock, leave the mount or the rider out of a frame
const PROBE = { timeSec: null, hideMount: false, hideRider: false, hideNodes: null };

/** The saddle split is on (its own switch, off by default) and this mount has a measured seat. */
const seatOn = () => typeof window !== "undefined" && window.__fx?.mountseat === true && !!S.def?.seat;

// ── seat settings: what web/mount-editor.html saves, per mount and facing ─────────────────────────────
// { [mountId]: { [dir]: { dx, dy, cut, layer } } }
//   dx, dy  px the rider moves from the measured place (feet `seat.drop` below the saddle point)
//   cut     the rider is hidden below the saddle row + cut px (0 = everything below the saddle is hidden; null = no cut)
//   layer   "auto" (depth split at the saddle) | "front" (rider over the whole mount) | "behind" (mount over the rider)
// web/mount-seats.json is the saved file; the editor's unsaved work sits in localStorage and wins while it is there.
export const SEAT_DIRS = ["down", "down-right", "right", "up-right", "up", "up-left", "left", "down-left"];
export const SEAT_STORE = "dw.mountSeats.v1";
export const seatDefault = () => ({ dx: 0, dy: 0, cut: 0, layer: "auto" });
let seatFile = {};
export function loadSeats(url = "mount-seats.json") {
  return fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    .then((j) => { seatFile = j && typeof j === "object" ? j.seats ?? j : {}; return seatFile; });
}
export function seatSettings(id, dir) {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(SEAT_STORE) || "null"); } catch { local = null; }
  return { ...seatDefault(), ...(seatFile[id]?.[dir] ?? {}), ...(local?.[id]?.[dir] ?? {}) };
}

/**
 * Where the rider goes in the mount's cell (cell px; the ground point is (w/2, h-8)), from the saddle point the split
 * measured this frame and the facing's settings. The game and the editor both place the rider with this.
 */
export function seatLayout(def, split, cfg) {
  const dx = Math.round(split.seatX - MOUNT_VIEW.w / 2 + cfg.dx);
  const feetY = Math.round(split.seatY + (def.seat?.drop ?? 0) + cfg.dy);
  return {
    dx, lift: MOUNT_VIEW.h - 8 - feetY,
    riderX: MOUNT_VIEW.w / 2 + dx, feetY,
    cutY: cfg.cut == null ? null : Math.round(split.seatY + cfg.cut),
    layer: cfg.layer || "auto",
  };
}

/** The field row below which the rider is hidden this frame (riding with a cut), else null. */
export function mountRiderCutRow() {
  if (S.mode !== "riding" || !S.rider || S.rider.cutY == null) return null;
  return S.y - MOUNT_VIEW.h + 8 + S.rider.cutY;
}
const climbEase = () => { const t = Math.min(1, S.animT / MOUNT_SECS); return t * t * (3 - 2 * t); };

/** Pixels the rider is lifted: standing on the mount's back (with the split: feet `drop` below the saddle point). */
export function mountRiderLift() {
  const back = S.def?.back ?? 0;
  const sit = S.rider ? S.rider.lift : S.def?.sit ?? back;
  if (S.mode === "riding") return Math.round(sit);
  if (S.mode === "mounting") return Math.round(sit * climbEase());
  return 0;
}

/** Pixels the rider moves across to sit on the saddle point (0 without the split). */
export function mountRiderShiftX() {
  if (PROBE.hideRider) return 1e5;
  if (!S.rider) return 0;
  if (S.mode === "riding") return Math.round(S.rider.dx);
  if (S.mode === "mounting") return Math.round(S.rider.dx * climbEase());
  return 0;
}

/** The clip latch drawPlayerActor plays during the climb on / step off (null when not in a transition). */
export function mountPlayerLatch() {
  if (S.mode === "mounting") return { clip: MOUNT_CLIP, dir: S.dir, animT: S.animT };
  if (S.mode === "dismounting") return { clip: DISMOUNT_CLIP, dir: S.dir, animT: S.animT };
  return null;
}

// ── collision-safe fast movement (pure, unit-tested) ────────────────────────────────────────────
/**
 * How many sub-steps a move of (dx,dy) needs so no wall thinner than one cell can be crossed: one step of
 * the BASE magnitude at a time, the speed factor comes from repeating the step, never from a longer step.
 */
export function mountSubSteps(dx, dy, baseStep) {
  const len = Math.hypot(dx, dy);
  if (!(baseStep > 0) || !(len > baseStep)) return 1;
  return Math.ceil(len / baseStep);
}

/** Move through `n` sub-steps of a collision mover, so a 3x step cannot tunnel a 16 px wall. */
export function moveWithSubSteps(moveFn, x, y, dx, dy, baseStep) {
  if (typeof moveFn !== "function") return { x, y };
  const n = mountSubSteps(dx, dy, baseStep);
  let px = x, py = y;
  for (let i = 0; i < n; i++) {
    const r = moveFn(px, py, dx / n, dy / n);
    px = r.x; py = r.y;
  }
  return { x: px, y: py };
}

// ── dismount: where the player and the followers come off (pure) ────────────────────────────────
/**
 * The first spot around (x,y) a 12x8 foot box can stand on, searching a ring of 4-24 px. Returns null when
 * the mount is standing somewhere with no free cell at all (then the player stays where they are).
 */
export function findDismountSpot(canStand, x, y, { ring = 24, step = 4 } = {}) {
  if (typeof canStand !== "function") return null;
  if (canStand(x, y)) return { x, y };
  for (let r = step; r <= ring; r += step) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const px = x + Math.cos(ang) * r;
      const py = y + Math.sin(ang) * r * 0.6;      // the field is a 3/4 view: vertical offsets are shorter
      if (canStand(px, py)) return { x: px, y: py };
    }
  }
  return null;
}

/** Up to `n` free spots behind the player for the party, nearest first (they are placed, never snapped). */
export function followerSpots(canStand, x, y, n = 3, { ring = 28, step = 5 } = {}) {
  const out = [];
  if (typeof canStand !== "function") return out;
  for (let r = step; r <= ring && out.length < n; r += step) {
    for (let a = 0; a < 8 && out.length < n; a++) {
      const ang = Math.PI * 0.5 + (a / 8) * Math.PI * 2;     // start behind the player (below them)
      const px = x + Math.cos(ang) * r;
      const py = y + Math.sin(ang) * r * 0.6;
      if (!canStand(px, py)) continue;
      if (out.some((p) => Math.hypot(p.x - px, p.y - py) < step)) continue;
      out.push({ x: px, y: py });
    }
  }
  return out;
}

// ── the ride itself ────────────────────────────────────────────────────────────────────────────
async function ensureAsset() {
  if (S.asset || S.loading || S.rendererFailed) return;
  const def = unlockedDef();
  if (!def) return;
  S.loading = true;
  try {
    const asset = await loadMountAsset(def.id, def.model);
    if (asset) { S.asset = asset; S.def = def; } else S.rendererFailed = true;
  } finally {
    S.loading = false;
  }
}

function startMount(state) {
  const def = unlockedDef();
  if (!def) return false;
  S.def = def;
  S.mode = "summoning";
  S.animT = 0;
  S.dir = state.dir;
  S.x = state.x;
  S.y = state.y;
  host?.sfx?.("dooropen");
  ensureAsset();
  return true;
}

function startDismount(state) {
  if (S.mode !== "riding") return false;
  const spot = findDismountSpot(host?.canStand, state.x, state.y);
  if (spot) { state.x = spot.x; state.y = spot.y; }
  S.mode = "dismounting";
  S.animT = 0;
  S.dir = state.dir;
  host?.resetFollowers?.();
  const spots = followerSpots(host?.canStand, state.x, state.y, 3);
  host?.placeFollowers?.(spots);
  return true;
}

/** Hard stop: used by a map change, a battle, a scene, a save load or the layer being switched off. */
export function mountForceDismount() {
  if (S.mode === "idle") return false;
  S.mode = "idle";
  S.animT = 0;
  S.phase = 0;
  return true;
}

/** The ride/dismount button. Returns true when the press was used. */
export function mountPress(state) {
  if (!enabled()) return false;
  if (!host?.fieldReady?.()) return false;
  if (S.mode === "riding") return startDismount(state);
  if (S.mode !== "idle") return false;
  return startMount(state);
}

/**
 * Per-frame step. Returns true when the field's own input must be frozen for this frame (the climb on /
 * step off animation); false while riding, because the player keeps walking (faster) and the mount follows.
 */
export function mountTick(dt, state, { mapId = null } = {}) {
  if (!enabled()) {
    if (S.mode !== "idle") mountForceDismount();
    return false;
  }
  ensureAsset();
  if (S.mode === "summoning") {
    // wait for the model (a first ride may still be loading it), then let it fade in before the climb
    if (S.asset || S.rendererFailed) S.animT += dt;
    if (S.animT >= SUMMON_SECS) { S.mode = "mounting"; S.animT = 0; }
    return true;
  }
  if (S.mode === "mounting") {
    S.animT += dt;
    if (S.animT >= MOUNT_SECS) { S.mode = "riding"; S.animT = 0; S.phase = 0; }
    return true;
  }
  if (S.mode === "dismounting") {
    S.animT += dt;
    if (S.animT >= DISMOUNT_SECS) { S.mode = "idle"; S.animT = 0; }
    return true;
  }
  if (S.mode === "riding") {
    // anything that takes the field away sends the player off first
    if (host?.mustDismount?.()) { mountForceDismount(); return false; }
    const moved = Math.hypot(state.x - S.x, state.y - S.y) > 0.01 || state.dir !== S.dir;
    S.moving = moved;
    if (moved) S.phase = (S.phase + dt / (S.def?.walk?.cycle ?? 0.9)) % 1;
    S.x = state.x;
    S.y = state.y;
    S.dir = state.dir;
    if (state.moving) state.moving = true;      // the player keeps the game's own moving flag
    return false;
  }
  S.x = state.x;
  S.y = state.y;
  S.dir = state.dir;
  return false;
}

/** Push the mount into the field's y-sorted draw list (before the player, so the rider lands on top). */
export function mountDrawable(ctx, drawables, camX, camY, timeSec = 0) {
  if (S.mode !== "summoning" && S.mode !== "riding" && S.mode !== "mounting" && S.mode !== "dismounting") return false;
  if (!S.asset) return false;
  if (PROBE.timeSec != null) timeSec = PROBE.timeSec;
  const useSeat = seatOn() && (S.mode === "riding" || S.mode === "mounting");
  const canvas = renderMount(S.asset, {
    x: S.x, y: S.y, dir: S.dir, phase: S.phase, moving: S.mode === "riding" && S.moving,
    size: S.def?.size ?? 68, timeSec, walk: S.def?.walk ?? null, seat: useSeat ? S.def.seat : null, hide: PROBE.hideNodes,
  });
  if (!canvas) return false;
  const split = useSeat ? mountSplit() : null;
  // the rider's place from the saddle point measured this frame and this facing's saved settings (seatLayout)
  S.rider = split ? { ...seatLayout(S.def, split, seatSettings(S.def.id, S.dir)), seatX: split.seatX, seatY: split.seatY } : null;
  S.renders += 1;
  const dx = Math.round(S.x - MOUNT_VIEW.w / 2 - camX);
  const dy = Math.round(S.y - MOUNT_VIEW.h + 8 - camY);
  // fades in while it appears, out while the player steps off
  const alpha = S.mode === "summoning" ? Math.min(1, S.animT / SUMMON_SECS)
    : S.mode === "dismounting" ? Math.max(0, 1 - S.animT / DISMOUNT_SECS) : 1;
  // the ground shadow under the mount: its own drawable, always behind the rider (sortDrawables: larger y on top)
  const sh = S.def?.shadow;
  if (sh && host?.groundShadow) {
    const SIN = Math.sin((50 * Math.PI) / 180);       // the renderer's camera pitch: ground depth shrinks by it
    const side = S.dir === "left" || S.dir === "right", ahead = S.dir === "up" || S.dir === "down";
    const across = side ? sh.length : ahead ? sh.width : (sh.length + sh.width) / 2;
    const deep = (side ? sh.width : ahead ? sh.length : (sh.length + sh.width) / 2) * SIN;
    const gx = S.x - camX, gy = S.y - camY;
    drawables.push({ y: S.y - 1, mountShadow: true, draw: () => host.groundShadow(ctx, gx, gy, across, deep, alpha) });
  }
  if (PROBE.hideMount) return true;
  if (split && S.mode === "riding") {
    // "auto": the part behind the saddle plane draws before the rider, the part in front of it after;
    // "front": the whole mount before the rider; "behind": the whole mount after him
    const layer = S.rider.layer;
    const blit = (c) => () => ctx.drawImage(c, dx, dy);
    if (layer === "front") drawables.push({ y: S.y - 0.5, mount: true, draw: blit(canvas) });
    else if (layer === "behind") drawables.push({ y: S.y + 0.5, mount: true, draw: blit(canvas) });
    else {
      drawables.push({ y: S.y - 0.5, mount: true, mountBack: true, draw: blit(split.back) });
      drawables.push({ y: S.y + 0.5, mount: true, mountFront: true, draw: blit(split.front) });
    }
    return true;
  }
  drawables.push({
    // while riding the mount draws AFTER the rider (larger y draws on top in sortDrawables), so its body hides the
    // rider's lower legs; while it appears, the climb and the step-off it stays behind the player
    y: S.mode === "riding" ? S.y + 0.5 : S.y - 0.5,
    mount: true,
    draw: () => {
      if (alpha >= 1) { ctx.drawImage(canvas, dx, dy); return; }
      const was = ctx.globalAlpha;
      ctx.globalAlpha = was * alpha;
      ctx.drawImage(canvas, dx, dy);
      ctx.globalAlpha = was;
    },
  });
  return true;
}

// ── debug hooks (the verifier reads state, never pixels) ───────────────────────────────────────
/** Render one frame off-screen and describe it in numbers (no picture is ever looked at). */
function spriteStats(opts = {}) {
  if (!S.asset) return null;
  const draw = (phase) => renderMount(S.asset, {
    x: MOUNT_VIEW.w / 2, y: MOUNT_VIEW.h - 10, dir: opts.dir ?? "down", phase,
    moving: opts.moving ?? true, size: S.def?.size ?? 68, timeSec: 0, walk: S.def?.walk ?? null,
  });
  const px = (c) => c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  // renderMount returns ONE shared scratch canvas, so each frame's pixels are copied out before the next draw
  const a = draw(opts.phaseA ?? 0.1);
  if (!a) return null;
  const da = px(a).slice();
  const b = draw(opts.phaseB ?? 0.6);
  const db = b ? px(b).slice() : null;
  let solid = 0, changed = 0;
  const colors = new Set();
  for (let i = 0; i < da.length; i += 4) {
    if (da[i + 3] > 0) { solid++; colors.add(`${da[i]},${da[i + 1]},${da[i + 2]}`); }
    if (db && (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2] || da[i + 3] !== db[i + 3])) changed++;
  }
  return { w: a.width, h: a.height, solid, changed, colors: colors.size,
    info: mountRenderInfo(), tex: !!(S.asset.material?.uniforms?.uTex?.value), meshes: S.asset.meshes?.length ?? 0 };
}

if (typeof window !== "undefined") {
  window.__mount = {
    state: () => ({ ...mountState(), hidesFollowers: mountHidesFollowers(), freezesInput: mountFreezesInput() }),
    table: () => MOUNTS.map((m) => ({ ...m })),
    press: () => { const used = mountPress(host?.state?.()); return used; },
    force: () => mountForceDismount(),
    canStand: (x, y) => !!host?.canStand?.(x, y),
    assetLoaded: () => !!S.asset,
    sprite: (opts) => spriteStats(opts),
    selfTest: () => renderSelfTest(),
    sceneProbe: () => sceneProbe(),
    framebuffer: () => probeFramebuffer(),
    probe: (o = {}) => Object.assign(PROBE, o),
    rider: () => (S.rider ? { ...S.rider } : null),
    loadedModel: () => (S.asset ? { legs: S.asset.rig.legs.length, forward: S.asset.rig.forward, height: S.asset.rig.height } : null),
  };
}
