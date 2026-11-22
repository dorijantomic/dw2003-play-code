import { techRecord } from "../../fight/fight-tables.js";
import { meshPrimitiveStates } from "../../fight/display-list.js";
import { meshAbrMode } from "../../fight/proj-layers.js";
import { loadTexture } from "../gl.js";
import { ps1ToRender, MODEL_SCALE } from "../math.js";
import { actorTeardown, ACTOR_TEARDOWN_STATE, ACTOR_RES_OFFSETS } from "../../vendor/engine.js";
import { loadAssetImage } from "../../assets.js";
import { loadSkeletalModel, buildSkeletalGLBuffers } from "../skeleton.js";
import { ActorAnimator } from "../../fight/actor-animator.js";
import { arenaSlotFor } from "../camera-shots.js";
import { resolveContactSoundType } from "../../battle3d.js";
import type { Battle3DContext } from "../../types/battle3d.js";

import type { BattleSide } from "../../types/audio.js";
import type { SkelBufs } from "../../types/battle3d.js";
interface EffectSpawnRecord {
  type: number | string;
  x: number;
  y: number;
  z: number;
}

// moved by tools/rewrite/split-closure.mjs
export function makeModel(B$: Battle3DContext) {
function contactSoundTypeFor(techId: number) {
    const rec = techRecord(techId);
    if (!rec) return (techId >= 1 && techId <= 52) ? 30 : null;
    return (rec.effect === 0 && rec.clip === 5) ? 30 : rec.motion;
  }
function loadProjMesh(id: number) {
    if (B$.projCache!.has(id)) return;
    B$.projCache!.set(id, "loading");
    fetch(`${B$.PROJ_BASE}/${id}.json`).then(r => (r.ok ? r.json() : null)).then(def => {
      if (!def) { B$.projCache!.set(id, null); return; }
      const [tw, th] = def.tex_size || [256, 256];      // 4bpp indexed VRAM page
      const layers = [];
      for (const L of def.layers) {
        // A layer's primitives do NOT all share one palette or one blend: the tex-op sets the
        // CLUT per primitive (183 of the 572 shipped layers name more than one), and the
        // `0xEn` state can change between primitives too. So the layer is split into draw
        // groups keyed by (palette, blend) and each group gets its own atlas and blend state.
        const groups = new Map();
        // When the layer carries its raw display list (layer.dl), the ported loop
        // F0x80085110 (engine/dw3/battle-displaylist.ts, via web/fight/display-list.js)
        // is the authority for each primitive's draw state — its s48 ABR nibble and
        // its s3c/s30/s40 flags. Without raw bytes the loader falls back to the
        // extractor's flattened per-primitive `abr`.
        const dlStates = Array.isArray(L.dl) ? meshPrimitiveStates(Uint8Array.from(L.dl)) : null;
        for (let pi = 0; pi < L.prims.length; pi++) {
          const pr = L.prims[pi];
          if (!pr.textured || !pr.uv) continue;          // color-only GTE prims: not drawn yet
          const clut = pr.clut ? `${pr.clut[0]}_${pr.clut[1]}` : "";
          // The extracted `abr` is the RAW `0xEn` nibble, a ONE-BASED selector; meshAbrMode
          // turns it into the hardware mode, or null when the primitive is opaque.
          const abr = meshAbrMode(dlStates && dlStates[pi] ? dlStates[pi]!.abr : (pr.abr ?? 2));
          const key = `${clut}|${abr}`;
          let g = groups.get(key);
          if (!g) {
            g = { pos: [], uv: [], abr, tex: L.tex_by_clut?.[clut] ?? L.tex ?? null };
            groups.set(key, g);
          }
          const tri = pr.idx.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
          for (const c of tri) {
            const v = L.verts[pr.idx[c]] || [0, 0, 0];
            g.pos.push(v[0], v[1], v[2]);
            g.uv.push(pr.uv[c][0] / tw, pr.uv[c][1] / th);
          }
        }
        const drawn = [];
        let total = 0;
        for (const g of groups.values()) {
          if (!g.pos.length) continue;
          const vbo = B$.gl!.createBuffer();
          B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, vbo);
          B$.gl!.bufferData(B$.gl!.ARRAY_BUFFER, new Float32Array(g.pos), B$.gl!.STATIC_DRAW);
          const ubo = B$.gl!.createBuffer();
          B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, ubo);
          B$.gl!.bufferData(B$.gl!.ARRAY_BUFFER, new Float32Array(g.uv), B$.gl!.STATIC_DRAW);
          const rec = { vbo, ubo, count: g.pos.length / 3, abr: g.abr,
                        texReady: !g.tex, tex: null };
          // `texReady` exists only so a headless capture can wait for the atlas: loadTexture
          // returns a 1x1 placeholder immediately and swaps the real image in later, so the
          // texture handle being non-null is not evidence that anything is drawable yet.
          if (g.tex) rec.tex = loadTexture(B$.gl, `${B$.PROJ_BASE}/${g.tex}`, () => { rec.texReady = true; });
          drawn.push(rec);
          total += rec.count;
        }
        // A geometry-less layer is still kept: it can be the PARENT of one that draws, and
        // the transform chain below indexes by position. `count === 0` means "transform
        // node only", which is also what the game's implicit root layer 0 is.
        //
        // `parent` is the program row's first u32 (FIGHTSTG_F0x80084560 copies it to
        // layer+0x00; F0x80083e0c turns it into the parent's matrix pointer). 0 = the
        // implicit root node, which is where op6's from/to are written each frame. Packs
        // extracted before the field was decoded have no `parent` — treat those as flat.
        layers.push({ groups: drawn, count: total, tracks: L.tracks || null,
                      parent: L.parent ?? 0 });
      }
      // The pack's playback clip decides which authored frame each tick samples, and how
      // long the flight lives. Null for a pack whose clip did not decode; clipFrameAt then
      // falls back to using the tick directly.
      B$.projCache!.set(id, { layers, clip: def.clip || null });
    }).catch(() => B$.projCache!.set(id, null));
  }
// Warm the projectile-mesh cache for one model's actions so the bullet is ready at the
  // muzzle-exit frame (no async-load gap). Called when a model's anim.json actions load.
  function preloadModelProjectiles(actions: unknown) {
    if (!Array.isArray(actions)) return;
    for (const a of actions) {
      for (const o of a?.ops || []) {
        if (o.op === 6) { const id = o.words?.[1]; if (id != null) loadProjMesh(id); }
      }
    }
  }
// Flight-space -> render world. op6's operands are y/z-negated by the VM, which reconciles
  // them to the SAME rendered frame op3 effects use — so this is exactly op3's worldToScreen
  // world computation, which is ps1ToRender. `from` coincides with the op3 muzzle
  // flash (verified on Armormon), so the bullet launches from the gun barrel. Enemy-issued
  // flights are NOT mirrored for the far side, as op3 is not: the op6 handler stores its
  // two triples with no side test, and the shipped root yaw is 2048 (180°) in 223 of the 224
  // player-side records and 0 in all 121 enemy-side ones — the data is authored per side.
  function projWorld(pos: number[], side: BattleSide) {
    return ps1ToRender(pos, MODEL_SCALE);
  }
// Effect-spawn hook for one side's action VM (op3 sub=0 → spawn at actor-relative pos).
  function _fxHooks(side: BattleSide, extra?: any) {
    const e = extra || {};
    return {
      ...e,
      onEffect: (rec: EffectSpawnRecord) => { B$.effectPlayer?.spawn(rec.type, rec, side); e.onEffect?.(rec); },
      onHit: (rec: { type: number; words?: number[] }) => {
        // Mapped op10s play common-bank sound table[type] (0x800a368c). Contact
        // markers 98/99 first resolve through the attack context's +0x70 value —
        // or through COMEX102 when the contact evaded (F0x8008c454, result 3).
        const t = resolveContactSoundType(rec.type, B$.contactSoundType![side], B$.contactEvade![side]);
        const key = (t != null) ? B$.op10Map[String(t)] : null;
        // ExVeemon/Stingmon Jogress clip 12 emits op10 type 66.  The original
        // table entry is packed 0x41180000: area bank jog_00, JOGRESSE sample.
        if (t === 66 && B$.sfx) B$.sfx.playBank?.("jog_00", "jogresse");
        // Types 90 and 91 never reach the 0x800a368c table: F0x8009b774 tests
        // them first. 91 stops EX_AT_LP through the immediate-stop entry, which
        // is what closes the whirl every signature clip 11 opens with type 89.
        // 90 replays whatever id is saved at [0x80042b30] and is emitted once,
        // by the DNA Jogress clip 12 — but the only writer of that register
        // inside fightstg is one stage-specific case (F0x80086a00, 0x80086ea0),
        // so what it holds during a Jogress is not established and nothing is
        // wired for it. Do not guess a track here.
        else if (t === 91 && B$.sfx) B$.sfx.stopSustained?.(B$.SUSTAINED_LOOP_KEY!);
        else if (t === B$.SUSTAINED_LOOP_TYPE && B$.sfx) B$.sfx.playSustained?.(B$.SUSTAINED_LOOP_KEY!);
        else if (key && B$.sfx) B$.sfx.playBattle!(key, side, rec.words?.[1] ?? 0);
        e.onHit?.(rec);
      },
      // op6 = projectile flight (registry @0x800a2550 -> MEFT00xx mesh packs). sub=1 is
      // the readiness poll (F0x8008bea8 rewinds until the pack loads) — kick the async mesh
      // fetch there so the mesh is ready by the sub=0 spawn. sub=0 launches the flight.
      setLunge: (l) => {
        if (l && B$.effectPlayer) {
          const id = l.id ?? l.words?.[1];
          if (l.sub === 1 && id != null) loadProjMesh(id);
          else if (l.sub === 0 && l.from) B$.effectPlayer.spawnProjectile(id, l.from, l.to, side);
        }
        e.setLunge?.(l);
      },
    };
  }
function freeSkelBufs(bufs: SkelBufs) {
    if (!bufs) return;
    if (bufs.ibo) B$.gl!.deleteBuffer(bufs.ibo);
    if (bufs.ubo) B$.gl!.deleteBuffer(bufs.ubo);
    if (bufs.vbo) B$.gl!.deleteBuffer(bufs.vbo);
  }
// FIGHTSTG_F0x8008606c, the actor teardown, ported (engine/dw3/battle-actor-lifecycle.ts).
  // A fightstg fighter actor holds three resource words at +0x78/+0x7c/+0x80; the original's
  // teardown runs only at state 3 and frees each pointer only when it is non-zero. The
  // browser's three resources are the texture (+0x78), the skeleton GL buffers (+0x7c) and
  // the model data (+0x80); the release now runs THROUGH the port rather than a hand-written
  // `if (tex) deleteTexture; freeSkelBufs; null`, so the guard and the zero test are the
  // original's. `free` does the browser-side release — that half is genuinely browser-side.
  function releaseActorResources(resources: unknown[]) {
    const slots = resources.slice();
    actorTeardown({
      // The browser tears its actor down when it is replaced, which is the original's state 3.
      getState: () => ACTOR_TEARDOWN_STATE,
      getResource: (off: number) => slots[ACTOR_RES_OFFSETS.indexOf(off)] ?? 0,
    }, (ptr) => {
      const i = slots.indexOf(ptr);
      if (i < 0) return;
      slots[i] = 0;
      if (i === 0) B$.gl!.deleteTexture(ptr);   // actor +0x78: the texture
      else if (i === 1) freeSkelBufs(ptr);   // actor +0x7c: the skeleton GL buffers
      // i === 2: actor +0x80 is plain JS model data — dropping the reference frees it.
    });
  }
// Warm the model + texture caches ahead of a presentation model swap (the DNA
  // flow swaps actors at every segment boundary; fetching there stalls the show).
  function preloadDigimon(folder: string) {
    if (!folder) return Promise.resolve(false);
    loadAssetImage(`assets/battle/textures/${folder}.png`).catch(() => null);
    return loadSkeletalModel(folder).then((m) => !!m);
  }
function setPlayerDigimon(folder: string | null | undefined) {
    if (folder === B$.playerFolder) return Promise.resolve(!!B$.playerModel);
    B$.playerFolder = folder;
    B$.playerPatches = null; B$.playerPage = null;
    // The actor teardown, ported: free the three resource words through FIGHTSTG_F0x8008606c.
    releaseActorResources([B$.playerTex, B$.playerSkelBufs, B$.playerModel]);
    B$.playerTex = null; B$.playerSkelBufs = null; B$.playerModel = null;
    B$._freeFaceBoxBuffers(B$.gl!);
    B$.playerAnim8r = null; B$.coordinator!.player = null;
    if (!folder) return Promise.resolve(true);
    B$.playerTex = loadTexture(B$.gl, `assets/battle/textures/${folder}.png`);
    B$.setupTexturePatches("player", folder);
    return loadSkeletalModel(folder).then(m => {
      if (m && folder === B$.playerFolder) {
        B$.playerModel = m;
        B$.playerSkelBufs = buildSkeletalGLBuffers(B$.gl, m);
        B$.playerFrame = m.clips?.[0]?.start_frame ?? 0;
        // ActorAnimator owns idle (TimelinePlayer over the idle position table) and actions
        // (ActionVM over model.actions[clip]). Models without a timeline fall back to advanceFrame.
        B$.playerAnim8r = new ActorAnimator(m);
        B$.playerAnim8r.resetSlotPlacement(arenaSlotFor(folder, "player", B$.placementTable));
        B$.coordinator!.player = B$.playerAnim8r;
        preloadModelProjectiles(m.actions);
        return true;
      }
      return false;
    });
  }
function setEnemyDigimon(folder: string | null | undefined) {
    if (folder === B$.enemyFolder) return;
    B$.enemyFolder = folder;
    B$.enemyPatches = null; B$.enemyPage = null;
    // The actor teardown, ported: free the three resource words through FIGHTSTG_F0x8008606c.
    releaseActorResources([B$.enemyTex, B$.enemySkelBufs, B$.enemyModel]);
    B$.enemyTex = null; B$.enemySkelBufs = null; B$.enemyModel = null;
    B$._freeFaceBoxBuffers(B$.gl!);
    B$.enemyAnim8r = null; B$.coordinator!.enemy = null;
    if (!folder) return;
    B$.enemyTex = loadTexture(B$.gl, `assets/battle/textures/${folder}.png`);
    B$.setupTexturePatches("enemy", folder);
    loadSkeletalModel(folder).then(m => {
      if (m && folder === B$.enemyFolder) {
        B$.enemyModel = m;
        B$.enemySkelBufs = buildSkeletalGLBuffers(B$.gl, m);
        B$.enemyFrame = m.clips?.[0]?.start_frame ?? 0;
        B$.enemyAnim8r = new ActorAnimator(m);
        B$.enemyAnim8r.resetSlotPlacement(arenaSlotFor(folder, "enemy", B$.placementTable));
        B$.coordinator!.enemy = B$.enemyAnim8r;
        preloadModelProjectiles(m.actions);
      }
    });
  }
// The fighter's BASE idle table (anim object +0x18): 0 = the normal idle, 1 = the low-HP stance
  // the original plays for a badly hurt Digimon. Every action script's trailing "return to base"
  // record and every action->idle return play this table, so setting it here is what makes the
  // hurt stance appear ONLY while the Digimon is actually hurt.
  function setFighterBaseIdle(side: string, low: boolean) {
    const a = side === "enemy" ? B$.enemyAnim8r : B$.playerAnim8r;
    if (a) a.baseTable = low ? 1 : 0;
  }
function entranceMotionTry() {
    const e = B$.entranceMotion;
    if (!e) return;
    const live = e.side ? B$.enemyFolder : B$.playerFolder;
    if ((e.folder && e.folder !== live) || !(e.side ? B$.enemyAnim8r : B$.playerAnim8r)) return;
    if ((e.side ? B$.playEnemyMotion : B$.playPlayerMotion)(e.motion)) B$.entranceMotion = null;
  }
function entranceMotionSet(side: number, folder: string, motion: string) { B$.entranceMotion = { side, folder, motion }; entranceMotionTry(); }
function setPlayerVisible(visible: boolean) { B$.playerVisible = !!visible; }
function setEnemyVisible(visible: boolean) { B$.enemyVisible = !!visible; }
// NEW content (F2 -> Extras -> "Fusion bosses"): the fusion's white-out. It is the
  // original's own full-screen monochrome primitive (op7, FIGHTSTG_F0x80092e18/0x800930c0
  // -- the DNA clip's white-out), started at full white on type 1 so it ramps back down and
  // clears itself; a type-0 overlay would hold the screen white forever.
  function whiteOut(frames: number = 20) {
    B$.screenOverlay = { type: 1, duration: Math.max(1, frames | 0), t: 0 };
  }
  return { contactSoundTypeFor, loadProjMesh, preloadModelProjectiles, projWorld, _fxHooks, freeSkelBufs, releaseActorResources, preloadDigimon, setPlayerDigimon, setEnemyDigimon, setFighterBaseIdle, entranceMotionTry, entranceMotionSet, setPlayerVisible, setEnemyVisible, whiteOut };
}
