import { loadTexture, loadTexturePixels } from "../gl.js";
import { assetMode } from "../../assets.js";
import { TEXTURE_PAGE_TEXELS, texturePatchRect } from "../math.js";
import { modelKeyFromFolder } from "../camera-shots.js";
import { TexturePatchAnimator } from "../../fight/texture-patch-animator.js";
import type { ArenaGroupBuf, Battle3DContext } from "../../types/battle3d.js";

import type { ArenaPack } from "../../types/battle3d.js";
import type { Battle3dTexturePage } from "./types.js";
interface TexturePatchSourceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}


interface TexturePatchEntry {
  dst: { x: number; y: number };
  sources: TexturePatchSourceRect[];
  frame?: number;
}

// moved by tools/rewrite/split-closure.mjs
export function makeBackdrop(B$: Battle3DContext) {
function _bdGroupBuf(g): ArenaGroupBuf {   // {page, spinDeg, pos:[x,y,z...], uv:[u,v...]} → {page, spinDeg, vbo, ubo, count}
    const vbo = B$.gl!.createBuffer();
    B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, vbo);
    B$.gl!.bufferData(B$.gl!.ARRAY_BUFFER, new Float32Array(g.pos), B$.gl!.STATIC_DRAW);
    const ubo = B$.gl!.createBuffer();
    B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, ubo);
    B$.gl!.bufferData(B$.gl!.ARRAY_BUFFER, new Float32Array(g.uv), B$.gl!.STATIC_DRAW);
    return { page: g.page, spinDeg: g.spinDeg || 0, vbo, ubo, count: g.pos.length / 3 };
  }
function loadBackdropPack(packName: string | number) {
    if (!packName) return null;
    let pk = B$.backdropPacks![packName];
    if (pk) return pk;
    pk = { floorTex: loadTexture(B$.gl, `assets/battle/backdrops/${packName}/floor.png`),
           wallTex:  loadTexture(B$.gl, `assets/battle/backdrops/${packName}/wall.png`),
           groups: null };
    B$.backdropPacks![packName] = pk;
    fetch(`assets/battle/backdrops/${packName}/geometry.json`)
      .then(r => r.json())
      .then(g => { pk.groups = (g.groups || []).map(_bdGroupBuf); })
      .catch(() => { pk.groups = []; });
    return pk;
  }
// Resolve a casting tech id → its backdrop pack name (via the manifest's byTech→sigEffect→bySig).
  // Returns null for a BASIC attack (not in byTech): basics keep the normal arena, no backdrop swap.
  // techId == null (manual/debug) → the data-field fallback.
  function backdropEntryForTech(techId: number) {
    if (techId == null) return { pack: B$.BD_FALLBACK, sound: -1 };
    const m = B$.backdropManifest;
    if (!m || !m.byTech) return null;
    const sig = m.byTech[String(techId)];
    if (sig == null) return null;                       // basic attack → no backdrop
    const entry = (m.bySig && m.bySig[String(sig)]) || null;
    return { pack: (entry && entry.pack) || B$.BD_FALLBACK, // sig 0 → data-field; else element pack
             sound: entry && entry.sound != null ? entry.sound : -1 };
  }
function backdropPackForTech(techId: number) {
    return backdropEntryForTech(techId)?.pack ?? null;
  }
function armDataField(techId: number) {
    const entry = backdropEntryForTech(techId);
    B$.dataFieldArmed = !!entry;                           // basic attack: keep the normal arena
    B$.dataFieldOn = false;
    if (!entry) return;
    B$.activeBackdrop = loadBackdropPack(entry.pack);
    // sound == -1 on the data-field fallback (SFSTDATA rec 55 carries no sound), so a
    // sig-0 special is silent on this path in the original too — do not invent one.
    B$.specialLoopKey = entry.sound >= 0 ? (B$.specialLoopMap![String(entry.sound)] || null) : null;
  }
// The THROW band's element pack: the item arm's motion id IS the sig (34/37/40/43/46/49/52
  // for the seven field items), so the pack is bySig[motion] — the same MEFT10<motion> pack the
  // tech path shows for that element. Item 84 rolls its motion, so its pack follows the rolled
  // element. Clips 14/17 (items 85-90) carry no op4, so arming is a no-op for them.
  function backdropEntryForSig(sig) {
    const m = B$.backdropManifest;
    if (!m || !m.bySig || sig == null) return null;
    const entry = m.bySig[String(sig)];
    return entry ? { pack: entry.pack, sound: entry.sound != null ? entry.sound : -1 } : null;
  }
function armThrowBackdrop(sig: string | number | null | undefined) {
    const entry = backdropEntryForSig(sig);
    B$.dataFieldArmed = !!entry;
    B$.dataFieldOn = false;
    if (!entry) return;
    B$.activeBackdrop = loadBackdropPack(entry.pack);
    B$.specialLoopKey = entry.sound >= 0 ? (B$.specialLoopMap![String(entry.sound)] || null) : null;
  }
/** The acting clip's op4 motion, straight from the VM: 0 = return to the arena, else the pack. */
  function dataFieldMotion(motion: number) {
    if (!B$.dataFieldArmed) return;
    const m = motion | 0;
    if (m === 0) { B$.dataFieldOn = false; syncSpecialLoop(false); }
    else if (m > 0) { B$.dataFieldOn = true; syncSpecialLoop(true); }
  }
// Debug / lab entry: pin the backdrop open on a wall clock (never the attack path).
  function triggerDataField(techId: number, now: number = performance.now()) {
    const entry = backdropEntryForTech(techId);
    if (!entry) return;                                 // basic attack: keep the normal arena
    B$.activeBackdrop = loadBackdropPack(entry.pack);
    B$.dataFieldOnAt  = now + B$.BD_DELAY_MS!;
    B$.dataFieldOffAt = now + B$.BD_DELAY_MS! + B$.BD_HOLD_MS!;
    // sound == -1 on the data-field fallback (SFSTDATA rec 55 carries no sound), so a
    // sig-0 special is silent on this path in the original too — do not invent one.
    B$.specialLoopKey = entry.sound >= 0 ? (B$.specialLoopMap![String(entry.sound)] || null) : null;
  }
// Hold the element loop for exactly as long as the backdrop is up.
  function syncSpecialLoop(active: boolean) {
    if (active && B$.specialLoopKey && !B$.specialLoopOn) {
      B$.specialLoopOn = true;
      B$.sfx?.playEffectLoop?.(B$.specialLoopKey);
    } else if (!active && B$.specialLoopOn) {
      B$.specialLoopOn = false;
      B$.sfx?.stopEffectLoop?.();
    }
  }
function dataFieldIsActive(now: number = performance.now()) {
    return B$.activeBackdrop && B$.activeBackdrop.groups && B$.activeBackdrop.groups.length
      && (B$.dataFieldPinned || B$.dataFieldOn || (now >= B$.dataFieldOnAt! && now < B$.dataFieldOffAt!));
  }
function setArenaLegacy(on: boolean) { B$.arenaLegacy = !!on; B$.arenaDebug!.legacy = !!on; return B$.arenaLegacy; }
function setArenaDebug(d: { legacy?: boolean; cull?: boolean; opaque?: boolean; voidRaw?: boolean; depthWrite?: boolean; depthClear?: boolean; }) {
    if (d && typeof d === "object") {
      if ("legacy" in d) B$.arenaLegacy = !!d.legacy;
      B$.arenaDebug = { legacy: B$.arenaLegacy, cull: d.cull !== false, opaque: d.opaque !== false,
                     voidRaw: !!d.voidRaw,
                     depthWrite: "depthWrite" in d ? !!d.depthWrite : B$.arenaDebug!.depthWrite,
                     depthClear: "depthClear" in d ? !!d.depthClear : B$.arenaDebug!.depthClear };
    }
    return B$.arenaDebug;
  }
function _arenaGroupBuf(g): ArenaGroupBuf {   // same shape as _bdGroupBuf (static spinDeg == 0)
    const b = _bdGroupBuf(g);
    // HD sheets are LINEAR-sampled. The pack's UVs are whole texel numbers (all 166002 of them, every pack): the
    // original's NEAREST read at u = 128.0 is texel 128, but a LINEAR read there is half texel 127, the NEXT picture
    // on the sheet, so every piece got a border (meft1015 lamps, user 2026-10-29). Half a texel in = texel centres,
    // what NEAREST reads. Authentic keeps the pack's UVs.
    if (assetMode() === "hd" && Array.isArray(g.uv)) {
      const half = 0.5 / TEXTURE_PAGE_TEXELS;
      B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, b.ubo);
      B$.gl!.bufferData(B$.gl!.ARRAY_BUFFER, new Float32Array(g.uv.map((t: number) => t + half)), B$.gl!.STATIC_DRAW);
    }
    b.clut = Array.isArray(g.clut) ? g.clut : null;   // the layer's palette group (col,row)
    b.degenerate = !!g.degenerate;     // blank CLUT slot: the original only culls these away
    b.pos = g.pos;                     // kept for the per-frame back-face cull (arenaCullIndices)
    b.uv = g.uv;                       // kept for the battle atmosphere moon pick (_atmosMoonPick)
    b.cullRef = g.cullRef || null;     // triangle -> the triangle whose projected sign governs it
    b.rotKeys = g.rotKeys || null;     // the change stages' mesh rotation track (tools/extract_arenas.py ROT_KEY_PACKS)
    return b;
  }
// Lazy per-(page, CLUT) texture: one PNG per palette group the pack's meshes reference,
  // `{page}_c{col}_r{row}.png` (tools/extract_arenas.py). The group's page+clut name the file.
  function arenaTextureFor(pk: ArenaPack, g: ArenaGroupBuf) {
    if (B$.arenaLegacy) {   // debug/before-after: one palette per page, the pre-decode render
      const leg = `${g.page || "wall"}.png`;
      if (!pk.tex) pk.tex = {};
      if (!pk.tex[leg]) pk.tex[leg] = loadTexture(B$.gl, `assets/battle/arenas/${pk.name}/${leg}`);
      return pk.tex[leg];
    }
    const col = g.clut ? g.clut[0] : 0, row = g.clut ? g.clut[1] : 255;
    const key = `${g.page || "wall"}_c${col}_r${row}`;
    const file = B$.arenaDebug!.voidRaw ? `${key}_void.png` : `${key}.png`;
    if (!pk.tex) pk.tex = {};
    if (!pk.tex[file]) pk.tex[file] = loadTexture(B$.gl, `assets/battle/arenas/${pk.name}/${file}`);
    return pk.tex[file];
  }
function loadArenaPack(packName: string) {
    if (!packName) return null;
    let pk = B$.arenaPacks![packName];
    if (pk) return pk;
    pk = { name: packName, tex: {}, groups: null, blend: "opaque" };
    B$.arenaPacks![packName] = pk;
    fetch(`assets/battle/arenas/${packName}/geometry.json`)
      .then(r => r.json())
      .then(g => { pk.blend = g.blend || "opaque"; pk.groups = (g.groups || []).map(_arenaGroupBuf); })
      .catch(() => { pk.groups = []; });
    return pk;
  }
// The arena id for a battle started on `mapId` with encounter `screenId`: the record's own
  // param, else the stage's default, else the fallback. null when the stage is unknown.
  function arenaIdFor(mapId: number | string | null | undefined, screenId: number | null | undefined) {
    if (!B$.arenaManifest || mapId == null) return null;
    const stage = String(mapId).replace(/^s/, "");
    const e = B$.arenaManifest.byStage?.[stage];
    if (!e) return null;
    if (screenId != null && e[String(screenId)] != null) return e[String(screenId)];
    return e._default ?? null;
  }
function resolveArenaStage() {
    const id = arenaIdFor(B$.arenaStageReq?.mapId, B$.arenaStageReq?.screenId);
    // No field screen at all -> no disc arena (the debug entry clears it, so a before/after
    // capture can show the pre-change generated grid). An unknown-but-present screen keeps the
    // fallback pack so an ordinary battle always has the disc's environment.
    const use = B$.arenaStageReq?.mapId == null ? null
      : (id == null ? B$.ARENA_FALLBACK_ID : id);
    B$.activeArena = use == null ? null : loadArenaPack(`meft10${String(use).padStart(2, "0")}`);
    const bg = use == null ? null : B$.arenaManifest?.byArena?.[String(use)]?.bg ?? null;
    B$.arenaBg = Array.isArray(bg)
      ? [Math.max(0, Math.min(255, bg[0] | 0)) / 255,
         Math.max(0, Math.min(255, bg[1] | 0)) / 255,
         Math.max(0, Math.min(255, bg[2] | 0)) / 255, 1]
      : null;
  }
// Called by web/battle.js when a battle opens, with the field screen it started on and the
  // encounter id it rolled — the two values the original's battle descriptor carries.
  function setArenaStage(mapId: number | string | null | undefined, screenId: number | null | undefined) {
    B$.arenaStageReq = { mapId: mapId ?? null, screenId: screenId ?? null };
    resolveArenaStage();
    return B$.activeArena ? B$.activeArena : null;
  }
function _faceBoxBuffers(gl: WebGLRenderingContext) {
    const src = B$.playerSkelBufs;
    let box = B$.playerBoxBufs;
    if (!src) return null;
    if (!box) {
      // Same UBO/IBO, a private VBO: _updateSkeletalVBOGL re-uploads positions into it.
      box = { ...src, vbo: gl.createBuffer() };
      B$.playerBoxBufs = box;
    } else {
      box.ubo = src.ubo; box.ibo = src.ibo; box.indexCount = src.indexCount;
      box.totalVerts = src.totalVerts; box.boneOffsets = src.boneOffsets;
    }
    return box;
  }
function _freeFaceBoxBuffers(gl: WebGLRenderingContext) {
    if (B$.playerBoxBufs?.vbo) gl.deleteBuffer(B$.playerBoxBufs.vbo);
    B$.playerBoxBufs = null;
  }
function patchState(side: string) {
    const hold = side === "enemy" ? B$.enemyPatchHold : B$.playerPatchHold;
    if (hold !== null) return hold;
    const a = side === "enemy" ? B$.enemyAnim8r : B$.playerAnim8r;
    return a ? a.animationId : 1;
  }
// Start (or clear) a fighter's patch animation. Both halves land asynchronously and
  // either may arrive first, so this is called again when the placement table lands.
  function setupTexturePatches(side: string, folder: string | null | undefined) {
    const entries = B$.placementTable![modelKeyFromFolder(folder)]?.texture_anim;
    const animator = entries && entries.length ? new TexturePatchAnimator(entries) : null;
    if (side === "player") B$.playerPatches = animator; else B$.enemyPatches = animator;
    if (!animator) return;
    loadTexturePixels(`assets/battle/textures/${folder}.png`).then((page) => {
      if (side === "player" && folder === B$.playerFolder) B$.playerPage = page;
      else if (side === "enemy" && folder === B$.enemyFolder) B$.enemyPage = page;
    });
  }
// One animated texture patch, copied from one of its three source rectangles over
  // its destination — the walker's stand-in for the original's per-frame VRAM copy.
  // Nothing is uploaded unless the chosen picture actually changed, which is also how
  // the original behaves: it caches the last variant per entry.
  function blitTexturePatch(tex: WebGLTexture | null, page: Battle3dTexturePage | null, entry: TexturePatchEntry) {
    if (!tex || !page) return false;
    const r = texturePatchRect(entry, page.scale);
    if (r.w <= 0 || r.h <= 0 || r.x0 + r.w > page.width || r.y0 + r.h > page.height) return false;
    const rect = new Uint8Array(r.w * r.h * 4);
    for (let row = 0; row < r.h; row++) {
      const from = ((r.y0 + row) * page.width + r.x0) * 4;
      rect.set(page.data.subarray(from, from + r.w * 4), row * r.w * 4);
    }
    B$.gl!.bindTexture(B$.gl!.TEXTURE_2D, tex);
    B$.gl!.texSubImage2D(B$.gl!.TEXTURE_2D, 0, r.dx, r.dy, r.w, r.h, B$.gl!.RGBA, B$.gl!.UNSIGNED_BYTE, rect);
    return true;
  }
  return { _bdGroupBuf, loadBackdropPack, backdropEntryForTech, backdropPackForTech, armDataField, backdropEntryForSig, armThrowBackdrop, dataFieldMotion, triggerDataField, syncSpecialLoop, dataFieldIsActive, setArenaLegacy, setArenaDebug, _arenaGroupBuf, arenaTextureFor, loadArenaPack, arenaIdFor, resolveArenaStage, setArenaStage, _faceBoxBuffers, _freeFaceBoxBuffers, patchState, setupTexturePatches, blitTexturePatch };
}
