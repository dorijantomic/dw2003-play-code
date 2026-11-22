import { fieldPartySize } from "../party.js";
import {
  rectBlocked,
  fromJSON,
  createGrid,
  PLAYER_CLIP_PACKS,
  aimPlacePoints,
  newPartnerList,
  FISHING_BUDGET,
  castPlayerRecord,
  diveFormFromSpriteId,
  diveFormOnScreen,
  isSubmarimonSprite,
  createSubmarimonMotion,
  hitRect,
  exitGatePasses,
  isStageChangePlayback,
  isDivePlayback,
  storeAddItem,
  storeRemoveItem,
  storyCommand,
} from "../vendor/engine.js";
import { loadAssetImage as loadImage, assetImageScale, isLoadedAsset } from "../assets.js";
import { tiledMap, tileIndexReady, loadTileIndex, retainTiledMaps } from "../map-tiles.js";
import { FIELD_VIEW_PAD, FIELD_VIEW_W } from "../field-view.js";
import { stageSpriteIds, stageWorkingSet } from "../stage-locality.js";
import { preloadPointSpriteStage, retainPointSpriteStages } from "../effects.js";
import { mountForceDismount } from "../mount.js";
import { sceneBgmTrack } from "../ordinal-scene-variant.js";
import { partyCharisma } from "../charisma.js";
import { grantCard, cards, loseCard, persistCollection } from "../cardstate.js";
import { currentMap, evaluatePlayerCharOne, saveFieldLocation } from "./session.js";
import {
  AMBUSH_LATCH_FLAG,
  CARD_COLLECTION_BANK,
  COLLECTION_BANK_IDS,
  HD_MAPS,
  VIEW_H,
  ZOOM,
  _REV_DIR,
  bgm,
  collisionLoadPromises,
  ctx,
  leaderSheetRetryAt,
  mapLoadPromises,
  placeCard,
  readyStageIds,
  retainedSpriteIds,
  retainedStageIds,
  sfx,
  soundRegister,
  spriteLoadPromises,
  stageLoadPromises,
  state,
  storyFlags,
  tilesComplete,
} from "./vars.js";
import { resetFollowers } from "./followers.js";
import { S, screenRouterOptions } from "./state.js";
import { questSceneFxReset } from "./quest-scenes.js";
import { reseedLiveTree } from "./fishing-tree.js";
import { stepPlayback } from "./field-steps.js";
import { fieldcomTick } from "./field-fx.js";
import { applyStoryCommand } from "./story-events.js";
interface ActiveExit {
    to: string | number;
    aimed?: boolean;
    routeWords?: readonly number[];
    gondola?: boolean;
}


function updateHud() {
    const hud = document.getElementById("hud");
    if (!hud) return;
    document.getElementById("hud-map")!.textContent = currentMap().name || "";
    const partnerRow = document.getElementById("hud-partner");
    if (fieldPartySize(state.party) > 0 && state.charIdx > 0) {
        const pc = state.manifest.characters[state.charIdx];
        const sheet = state.charImgs[pc.id];
        partnerRow!.style.display = "flex";
        document.getElementById("hud-partner-name")!.textContent = pc.name;
        const icon = document.getElementById("hud-icon") as HTMLCanvasElement;
        const ictx = icon.getContext("2d");
        ictx!.imageSmoothingEnabled = false;
        ictx!.clearRect(0, 0, 32, 32);
        if (sheet) {
            ictx!.drawImage(
                sheet,
                0,
                0,
                pc.frameW,
                pc.frameH,
                Math.floor((32 - pc.frameW) / 2),
                Math.max(32 - pc.frameH, 0),
                pc.frameW,
                pc.frameH,
            );
        }
    } else {
        partnerRow!.style.display = "none";
    }
}

export function setCharacter(i) {
    state.charIdx =
        (i + state.manifest.characters.length) %
        state.manifest.characters.length;
    (document.getElementById("charSelect") as HTMLSelectElement).selectedIndex = state.charIdx;
    const c = state.manifest.characters[state.charIdx];
    if (c) {
        state.charId = c.id;
        localStorage.setItem("charId", c.id);
        ensureSpriteAssets(c.id).then(updateHud);
    }
    resetFollowers();
    updateHud();
}

function findFreeSpot(grid, x: number, y: number) {
    if (!grid) return { x, y };
    for (let radius = 0; radius < 600; radius += 8) {
        for (let a = 0; a < 16; a++) {
            const nx = x + radius * Math.cos((a * Math.PI) / 8);
            const ny = y + radius * Math.sin((a * Math.PI) / 8);
            if (!rectBlocked(grid, nx - 6, ny - 8, nx + 6, ny))
                return { x: nx, y: ny };
        }
    }
    return { x, y };
}

export function ensureSpriteAssets(id) {
    if (!id || state.charImgs[id] || state.npcImgs[id]) return Promise.resolve();
    if (spriteLoadPromises.has(id)) return spriteLoadPromises.get(id);
    const entry = S.manifestSprites.get(id);
    if (!entry) return Promise.resolve();
    const promise = (async () => {
        const image = await loadImage(entry.record.sheet);
        if (entry.kind === "character") state.charImgs[id] = image;
        else if (retainedSpriteIds.has(id)) state.npcImgs[id] = image;
        if (entry.record.clipSheet) {
            const clip = await loadImage(entry.record.clipSheet);
            if (entry.kind === "character" || retainedSpriteIds.has(id))
                state.clipImgs[id] = clip;
        }
    })().catch((error) => console.warn("[assets] sprite load failed", id, error))
        .finally(() => spriteLoadPromises.delete(id));
    spriteLoadPromises.set(id, promise);
    return promise;
}

export function requestLeaderSheet(id, now = performance.now()) {
    if (!id) return;
    retainedSpriteIds.add(id);
    if (now < (leaderSheetRetryAt.get(id) ?? 0)) return;
    leaderSheetRetryAt.set(id, now + 2000);
    ensureSpriteAssets(id);
}

export async function loadCollisionForStage(id) {
    if (state.collision[id]) return state.collision[id];
    if (collisionLoadPromises.has(id)) return collisionLoadPromises.get(id);
    const m = state.manifest.maps.find((map) => map.id === id);
    if (!m) return null;
    const promise = (async () => {
        let grid = null;
        const local = localStorage.getItem("collision/" + id);
        if (local) {
            try {
                grid = fromJSON(JSON.parse(local));
                if (!grid.terrain) {
                    const source = await fetch(m.collision ?? `assets/collision/${id}.json`);
                    if (source.ok) grid.terrain = fromJSON(await source.json()).terrain;
                }
            } catch {
                grid = null;
            }
        }
        if (!grid) {
            try {
                const response = await fetch(m.collision ?? `assets/collision/${id}.json`);
                grid = response.ok ? fromJSON(await response.json()) : createGrid(m.width, m.height);
            } catch {
                grid = createGrid(m.width, m.height);
            }
        }
        if (retainedStageIds.has(id)) state.collision[id] = grid;
        return grid;
    })().finally(() => collisionLoadPromises.delete(id));
    collisionLoadPromises.set(id, promise);
    return promise;
}

// HD maps (see HD_MAPS): "assets/maps/s540.png" -> "s540".
function mapPictureName(url) {
    const m = String(url).match(/assets\/maps\/([^/?#]+)\.png/);
    return m ? m[1] : null;
}

function loadNativeImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`failed to load ${url}`));
        img.src = url;
    });
}

// The picture a stage holds: the native one when its HD copy is drawn from tiles, else the asset mode's.
function loadMapPicture(url) {
    return HD_MAPS && tiledMap(mapPictureName(url)) ? loadNativeImage(url) : loadImage(url);
}

// HD full picture (no tiles): the terrain effects get a native copy (state.mapNativeImgs).
function keepNativeCopy(id, part: string, url, img) {
    if (!HD_MAPS || assetImageScale(img) <= 1) return;
    loadNativeImage(url).then((n) => {
        if (retainedStageIds.has(id)) (state.mapNativeImgs[id] ??= {})[part] = n;
    }).catch(() => {});
}

// The picture the terrain effects read: native in HD (null while its copy loads).
export function effectsMapImg(id, part = "base") {
    const img = part === "fg" ? state.mapFgImgs[id] : state.mapImgs[id];
    if (!HD_MAPS || !(img instanceof Image) || assetImageScale(img) <= 1) return img;
    return state.mapNativeImgs[id]?.[part] ?? null;
}

export function drawMapPicture(img, tm, kind: string | null, ox: number, oy: number) {
    if (!tm) { ctx!.drawImage(img, ox, oy); return; }
    const key = `${tm.name}:${kind}`;
    if (!tilesComplete.get(key)) ctx!.drawImage(img, ox, oy);
    const M = 16;                   // map pixels of slack for the quest shake translate
    // The view is the 320 box plus FIELD_VIEW_PAD each side with the wide overworld (web/field-view.js).
    tilesComplete.set(key, tm.draw(ctx, ox, oy, -ox - M - FIELD_VIEW_PAD, -oy - M, FIELD_VIEW_W + 2 * M, VIEW_H / ZOOM + 2 * M, kind));
}

export function ensureMapImg(id) {
    // HD: which maps are tiled decides what to load, so wait for the tile index once.
    if (HD_MAPS && !tileIndexReady()) return loadTileIndex().then(() => ensureMapImg(id));
    // The fg check sits before the early return: the overlay index can finish
    // loading after the map image did, and render() re-calls ensureMapImg.
    const mapMeta = state.manifest.maps.find((x) => x.id === id);
    const overlayId = state.mapOverlays?.[id]
        ? id
        : (mapMeta?.assetSource && state.mapOverlays?.[mapMeta.assetSource]
            ? mapMeta.assetSource
            : null);
    if (HD_MAPS) {
        state.mapTiles[id] = {
            base: tiledMap(mapPictureName(mapMeta.image)),
            fg: overlayId ? tiledMap(`${overlayId}_fg`) : null,
        };
    }
    const loads = [];
    // Request the ground-cover image only for a stage the build actually gave
    // one. tools/build_map_ground_over_props.py emits every stage with a prop
    // behind its ground OR whose step program authors op 5 (the actor's
    // draw-layer word, the Protocol Ruins tunnel), and records them in
    // map_ground_index.json; asking for <stage>_l0.png unconditionally logged a
    // 404 for the other ~267 on every map load. An ALIAS stage (s949 -> s376,
    // s934 -> s261) reuses its source's cover, exactly as it reuses its base
    // map image. See docs/research/field/map-tile-draw-semitransparency-2026-08-20.md
    // and docs/research/field/field-actor-draw-bucket-2026-10-07.md §7.
    // Which stage's LAYER-2-ONLY split this stage uses (an alias stage reuses
    // its source's, exactly as it reuses the base map image). The renderer no
    // longer loads a per-stage `_l0` ground-band PNG: it REBUILDS the ground band
    // from the base map by erasing the stage's layer-2-only pixels, so the
    // bucket>=8 band lands between map layer 2 (OT[11]) and the ground (OT[7])
    // the way the disc does (fieldstg.s L4230-4236 -> slot 0x138; the actor's own
    // word rides the same slot, file 0xC8B4). See draw-order.js and
    // docs/research/field/map-tile-draw-semitransparency-2026-08-20.md §8.
    const groundSplitId = state.mapGroundIndex?.[id] === true
        ? id
        : (mapMeta?.assetSource && state.mapGroundIndex?.[mapMeta.assetSource] === true
            ? mapMeta.assetSource
            : null);
    const hasGroundCover = groundSplitId !== null;
    // Build the two map-tile layers the disc emits into their own buckets:
    //   layer 2 (OT[11]) — the base map KEPT only on the stage's layer-2-only pixels;
    //   the ground (OT[7]) — the base map with those pixels erased.
    // The split is exact (runs from layer2 & ~layer0) and travels with the code.
    const buildGroundCover = () => {
        if (!hasGroundCover) return;
        const base = state.mapImgs[id];
        if (!(base instanceof Image) || !base.naturalWidth) return;
        const runs = state.mapLayer2?.[groundSplitId];
        if (!runs) return; // the split has not loaded yet; retry next ensureMapImg
        const W = base.naturalWidth, H = base.naturalHeight;
        const mk = () => {
            const c = document.createElement("canvas");
            c.width = W; c.height = H;
            return c;
        };
        const mask = mk();
        const mx = mask.getContext("2d");
        mx!.fillStyle = "#fff";
        for (const [x0, x1, y] of runs) mx!.fillRect(x0, y, x1 - x0 + 1, 1);
        // The GROUND layer (OT[7]) = base minus the layer-2-only pixels.
        const ground = mk();
        const gx = ground.getContext("2d");
        gx!.drawImage(base, 0, 0);
        gx!.globalCompositeOperation = "destination-out";
        gx!.drawImage(mask, 0, 0);
        // The LAYER-2 layer (OT[11]) = base kept only on those pixels.
        const layer2 = mk();
        const lx = layer2.getContext("2d");
        lx!.drawImage(base, 0, 0);
        lx!.globalCompositeOperation = "destination-in";
        lx!.drawImage(mask, 0, 0);
        if (retainedStageIds.has(id)) {
            state.mapGroundImgs[id] = ground;
            state.mapLayer2Imgs[id] = layer2;
            // HD: the tiles split at the same native mask, scaled up per tile.
            state.mapTiles[id]?.base?.setSplitMask(mask);
        }
    };
    if (!state.mapGroundImgs[id]) {
        state.mapGroundImgs[id] = hasGroundCover ? "loading" : null;
    }
    if (!state.mapLayer2Imgs[id]) {
        state.mapLayer2Imgs[id] = hasGroundCover ? "loading" : null;
    }
    if (overlayId && !state.mapFgImgs[id]) {
        state.mapFgImgs[id] = "loading";
        const fgUrl = `assets/maps/${overlayId}_fg.png`;
        loads.push(loadMapPicture(fgUrl).then((img) => {
            if (retainedStageIds.has(id)) state.mapFgImgs[id] = img;
            keepNativeCopy(id, "fg", fgUrl, img);
        }).catch((error) => {
            if (retainedStageIds.has(id)) state.mapFgImgs[id] = "failed";
            console.warn("[assets] foreground overlay load failed", id, error);
        }));
    }
    if (state.mapImgs[id] && state.mapImgs[id] !== "loading") {
        // The base map is up: build its ground band now if it is still pending
        // (a later ensureMapImg retries while the layer split is in flight).
        if (hasGroundCover && state.mapGroundImgs[id] === "loading") buildGroundCover();
        return Promise.all(loads);
    }
    if (mapLoadPromises.has(id)) return mapLoadPromises.get(id);
    state.mapImgs[id] = "loading";
    const promise = Promise.all([
        loadMapPicture(mapMeta.image).then((img) => {
            if (retainedStageIds.has(id)) state.mapImgs[id] = img;
            keepNativeCopy(id, "base", mapMeta.image, img);
            buildGroundCover();
            return img;
        }),
        ...loads,
    ]).catch((error) => {
        // A required map image that fails is LATCHED, not retried every frame:
        // "failed" makes ensureMapImg return early and render() reports the
        // failure instead of showing "loading map..." for ever. Eviction clears
        // the marker, so re-entering the stage's neighbourhood tries once more.
        if (retainedStageIds.has(id)) state.mapImgs[id] = "failed";
        console.warn("[assets] map load failed", id, error);
    }).finally(() => mapLoadPromises.delete(id));
    mapLoadPromises.set(id, promise);
    return promise;
}

function persistentSpriteIds() {
    const ids = new Set([state.manifest?.characters?.[0]?.id]);
    for (const id of state.party ?? []) ids.add(id);
    if (state.charId) ids.add(state.charId);
    // Every pack the player's clip-range rule can name, so a pack swap never has
    // to wait on a load mid-mode. PLAYER_CLIP_PACKS is that list, read from the
    // decoded table rather than spelled out again here.
    for (const id of [...PLAYER_CLIP_PACKS, "p123digm", "p122sbmm"])
        ids.add(id);
    return ids;
}

export function prepareStageAssets(id) {
    if (!S.knownStageIds.includes(id)) return Promise.resolve();
    retainedStageIds.add(id);
    const sprites = stageSpriteIds([id], state.scenes);
    for (const spriteId of [...sprites, ...persistentSpriteIds()])
        retainedSpriteIds.add(spriteId);
    if (readyStageIds.has(id) && isLoadedAsset(state.mapImgs[id]) && state.collision[id])
        return Promise.resolve();
    readyStageIds.delete(id);
    if (stageLoadPromises.has(id)) return stageLoadPromises.get(id);
    const promise = Promise.all([
        ensureMapImg(id),
        loadCollisionForStage(id),
        preloadPointSpriteStage(id),
        ...[...sprites, ...persistentSpriteIds()].map(ensureSpriteAssets),
    ]).then(() => {
        // A latched "failed" marker is truthy but is NOT a ready map: only a
        // loaded Image may mark the stage ready (engine-resource acceptance).
        if (retainedStageIds.has(id) && isLoadedAsset(state.mapImgs[id]) && state.collision[id])
            readyStageIds.add(id);
    }).finally(() => stageLoadPromises.delete(id));
    stageLoadPromises.set(id, promise);
    return promise;
}

function activateStageNeighborhood(id) {
    const keep = new Set(stageWorkingSet(id, state.scenes, S.knownStageIds));
    retainedStageIds.clear();
    for (const stageId of keep) retainedStageIds.add(stageId);
    retainPointSpriteStages(keep);

    for (const loadedId of [...readyStageIds]) {
        if (!keep.has(loadedId)) readyStageIds.delete(loadedId);
    }
    for (const loadedId of Object.keys(state.mapImgs)) {
        if (!keep.has(loadedId)) {
            delete state.mapImgs[loadedId];
            delete state.mapFgImgs[loadedId];
            delete state.mapGroundImgs[loadedId];
            delete state.mapLayer2Imgs[loadedId];
            delete state.mapTiles[loadedId];
            delete state.mapNativeImgs[loadedId];
            delete state.collision[loadedId];
            readyStageIds.delete(loadedId);
        }
    }
    if (HD_MAPS) {
        retainTiledMaps([...keep].flatMap((k) =>
            [state.mapTiles[k]?.base?.name, state.mapTiles[k]?.fg?.name].filter(Boolean)));
    }
    const keepSprites = stageSpriteIds(keep, state.scenes);
    for (const id of persistentSpriteIds()) keepSprites.add(id);
    retainedSpriteIds.clear();
    for (const id of keepSprites) retainedSpriteIds.add(id);
    for (const id of Object.keys(state.npcImgs)) {
        if (!keepSprites.has(id)) {
            delete state.npcImgs[id];
            delete state.clipImgs[id];
            spriteLoadPromises.delete(id);
        }
    }

    const warm = () => {
        for (const stageId of keep) prepareStageAssets(stageId);
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 1500 });
    else setTimeout(warm, 0);
}

// ── THE PLACES SYSTEM, on arrival ────────────────────────────────────────────
//
// The disc's stages that carry a `placePoints` table (34 overlays) re-aim their
// exits on the first tick after a stage load: updateStage calls copyPlacePoints,
// which copies the entry matching GAME.place/GAME.placeArg — the route pair the
// transition just published — into the stage's first StageSlots, and the slot IS
// one of the stage's type-7 step records, i.e. one of the scene's exit rows (the
// rows gen_scenes builds carry `slot` = the step index). The port is
// engine/systems/place-points.ts; this is the host half.
//
// Every arrival re-aims from the scene's own BASE rows (`_baseExits`, snapshotted
// when the scene loads), so:
//   * a pair the table matches gets that chain's destination, arrival position,
//     facing and published pair, point i on slot i;
//   * a pair the table does not describe leaves the rows exactly as built — the
//     static records, which is what the disc's un-copied slots hold (the disc
//     returns without copying; it does not fall back to another entry).
//
// The destination is resolved through the ported screen router at the moment of
// arrival — the same ordinal-aware walk (post-game ordinal 0x2d starts at the
// s9xx shadow records) the op-1 handoff itself uses — with the baked base stage as
// the fallback for a screen the table does not carry. Ledger:
// places-copy-place-points-family-2026-10-10, places-game-place-producers-2026-10-10.
function applyPlacePoints(mapId) {
    const scene = state.scenes[mapId];
    const table = scene?.placePoints;
    if (!table || !scene._baseExits) return;
    scene.exits = aimPlacePoints(
        scene._baseExits,
        table,
        state.entryKey ?? 0,
        state.entryCompanion ?? 0,
        (point) => {
            let to = point.to ?? null;
            const routed = S.screenRouter?.route(point.screen, mapId);
            if (routed?.kind === "warp") to = routed.to;
            if (!to) return null;
            return { to, dir: point.dirName ?? "down" };
        },
    );
}

export async function loadAndSetMap(i, spawn = null) {
    const idx = (i + state.manifest.maps.length) % state.manifest.maps.length;
    await prepareStageAssets(state.manifest.maps[idx].id);
    setMap(idx, spawn);
    // Levelling and gym work move Charisma, and the tamers who care about it are on the
    // next screen. A screen change is the cheapest place that always precedes meeting one.
    refreshPartyCharisma();
    grantNewPartners();
}

// EXTRA: the new partners (data/authored/web/assets/data/new_starters.json, registered by
// web/extra-roster.js) are an option, not a story reward: once you have a party they wait
// in the Digimon Lab, and you switch one in there like any partner you have obtained. Their
// bits sit above the disc's eight in the obtained set, so no story test of slots 0..7 sees them.
export function grantNewPartners() {
    const partners = newPartnerList();
    if (!partners.length || !fieldPartySize(state.party)) return false;
    const before = Number(state.rosterOwned) || 0;
    let mask = before;
    for (const p of partners) mask |= 1 << p.slot;
    if (mask === before) return false;
    state.rosterOwned = mask;
    return true;
}

export function setMap(i, spawn = null) {
    // EXPERIMENT (mounts): a map change always puts the player back on their own feet (no riding across a
    // doorway, no mount left standing on the old map).
    mountForceDismount();
    // Every map change lands here (the stage transition, a debug jump, a story HANDOFF): nothing a quest scene placed on the
    // map it is leaving may be drawn on the next one, and a scene's own sky goes back to the new map's (or none). The same
    // clear runs on stage entry (checkStageCutscene) -- this one also covers the paths that set the map directly.
    questSceneFxReset();
    state.mapIdx =
        (i + state.manifest.maps.length) % state.manifest.maps.length;
    // The ambush-tile latch is PER VISIT. Its only mechanical job is to stop the
    // step VM re-launching the fight every tick while you stand on the patch;
    // once you have left the area and come back, the ambush is armed again.
    //
    // This clear is the one part of the mechanic taken from PLAY rather than
    // from the disassembly: the trigger's gate and the latch write are both read
    // straight out of the original, but nothing in the corpus was found that
    // clears the flag, which read literally would make the whole set a single
    // global one-shot. It is not — Minotarumon meets you every time you drop
    // into Protocol Ruins (user, 2026-07-28), and two of these patches sit in
    // one room of the Jungle Shrine, which a one-shot would make pointless.
    // The original's clearing site is an open question, not a settled absence:
    // neither `li $a0, 0xf` nor a store to the bank-0 bitfield finds one, and
    // neither query can see a clear made through a computed register.
    storyFlags.set(AMBUSH_LATCH_FLAG, false);
    // Sixteen catches per map visit, re-seeded on arrival exactly like the
    // original (`li $v0, 0x10` / `sw $v0, 0x26f8($s0)`, fieldstg file 0x488c,
    // in the same branch that writes the arriving map id). Walk out and back to
    // fish a spot dry all over again.
    state.fishingBudget = FISHING_BUDGET;
    state.fishing = null;
    state.slope = null;
    // An op-14 hold belongs to the stage you are leaving: the disc's load happens
    // with the countdown already spent, so nothing can carry across the change.
    state.handoffHold = null;
    (document.getElementById("mapSelect") as HTMLSelectElement).selectedIndex = state.mapIdx;
    const m = currentMap();
    // The stage's spawn loop runs on arrival: rebuild the cast from the flags as
    // they stand NOW (sceneCast snapshots it lazily on first read). A flag written
    // during the visit does not change the cast until the next arrival.
    {
        const entered = state.scenes[m.id];
        if (entered) entered._cast = null;
    }
    // One tree per stage is live, re-rolled only when the arriving map is a
    // different one (fieldstg file 0x4878).
    state.treeKick = null;
    state.treeRadar = null;
    // The places system, on arrival: a stage with a placePoints table copies the
    // chain matching the pair the transition just published into its slots (its
    // exit rows) — see applyPlacePoints. This is the disc's updateStage first-tick
    // copy, so it must run with the ARRIVING pair, which is why it sits here and
    // not in the transition code.
    applyPlacePoints(m.id);
    // The dive presentation ends before the stage actually changes, but clear it
    // here too so a debug/scripted map jump can never strand it on screen.
    state.diveDemo = null;
    reseedLiveTree(m.id);
    ensureMapImg(m.id);
    if (spawn) {
        state.x = spawn.x;
        state.y = spawn.y;
        if (spawn.dir) state.dir = spawn.dir;
    } else {
        // A stage entered without a warp spawn uses its own descriptor default
        // (fieldstg F0x8009116c: +0x2C/+0x30 are 24.8 fixed, the leader's map
        // pixel is raw >> 8). Fall back to centring only when the stage has no
        // default or it lands outside the map.
        const def = state.stageDefaultSpawn?.[m.id];
        if (def && def.x >= 0 && def.y >= 0 && def.x < m.width && def.y < m.height) {
            state.x = def.x;
            state.y = def.y;
        } else {
            state.x = m.width / 2;
            state.y = m.height / 2;
            if (state.collision[m.id]) {
                const p = findFreeSpot(state.collision[m.id], state.x, state.y);
                state.x = p.x;
                state.y = p.y;
            }
        }
    }
    // The Digi-Egg form is a property of the SCREEN, not of the dive that got
    // you here: the native cast rebuild picks the player's sprite id from the
    // arriving stage's own actor list every time it runs, so walking from one
    // seabed screen to the next re-selects Submarimon and stepping out to the
    // surface re-selects Junior (id 2). Recomputing here reproduces that and
    // needs no explicit "leave the section" event.
    //
    // 2026-10-06: both decisions below now come from the ONE cast list
    // (descriptor+0x4C) through the ported reader (engine/systems/cast-list.ts):
    // loop A scans for a player-id record {1, 0x6a, 0x146, 0x147} whose gate
    // passes, first pass wins, and its id IS the sprite the player is drawn
    // with. dive_form_markers.json / player_cast_one.json remain only as the
    // fallback for a missing data file.
    const castRecords = state.stageCastLists?.[m.id];
    const castPlayer = castRecords
        ? castPlayerRecord(castRecords, (id, expected) => storyFlags.matches(id, expected))
        : undefined;
    if (castRecords) {
        // The stage's own list decides, including "no candidate -> Junior (2)".
        state.diveForm = diveFormFromSpriteId(castPlayer?.id ?? null);
        state.playerCharOne = castPlayer?.id === 1;
    } else {
        state.diveForm = state.diveNetwork
            ? diveFormOnScreen(state.diveNetwork, m.id, state.diveFormMarkers)
            : null;
        // Same cast rebuild: the player's charId (1 = P001PLAY, 2 = P002PLAY).
        state.playerCharOne = evaluatePlayerCharOne(m.id);
    }
    // Buoyancy state follows the same per-screen reconstruction: the cast
    // rebuild runs makeFieldChar afresh on arrival, so a Submarimon screen
    // re-seeds char+0x64 = 0x3000 with a zero velocity, and any screen that
    // builds Junior or Digmon instead drops the state entirely. This is the one
    // place that both initialises and resets it.
    // The constructor's height seed is CONDITIONAL (file 0xe6cc-0xe6ec): with
    // [0x8004b40c] set it restores the height saved at [0x8004b428] instead of
    // 0x3000, so swimming between seabed screens keeps your depth rather than
    // snapping you back to mid-water. Carry it while the form persists, and drop
    // it the moment the player is no longer Submarimon.
    const keptSubHeight = state.submarimon?.heightFixed ?? null;
    state.submarimon = isSubmarimonSprite(state.diveForm?.spriteId)
        ? createSubmarimonMotion(keptSubHeight, state.submarimon?.facing ?? 0)
        : null;
    state._subThrustHeld = false;
    resetFollowers();
    // The stage's own background track, except on the field's sixteen variant
    // story beats: the scene init (fieldstg F0x80091E60) writes BGM play id
    // 0x61080002 (env204 track 2) and, for ordinals 5/8/12/14/16/22/24/26/28/
    // 30/31/34/36/37/38/39, 0x61080000 (env204 track 0) instead. One shared
    // rule (engine/systems/ordinal-scene-variant.ts) answers it.
    // `state.progressOrdinal` is the file's proxy to the engine's $story.ordinal
    // (single source of truth), declared below; the flag store's own `getOrdinal`
    // option is internal to it and is NOT a method on the returned store, so calling
    // storyFlags.getOrdinal() here threw and took startGame down with it.
    bgm.play!(sceneBgmTrack(currentMap().music, Number(state.progressOrdinal ?? 0) || 0));
    // A stage with no play id (fieldstg.s:8278-8281): the entry block loads the
    // exclusive latch and stops its holder outright rather than starting a track,
    // so a jingle ringing from a previous screen ends on arrival. bgm.play(null)
    // would only clear the register if the bgm player itself held it; this stops
    // whatever holds it, whichever subsystem started it. s260 is the live case.
    if (!currentMap().music) soundRegister.stopHeld();
    // Area SFX resolve through this map's sound archive (map_sound_archives.json)
    sfx.setMap!(m.id);
    // Visited-map tracking needs nothing here: the engine's loadStage already set the
    // bit the pause-menu MAP page reads (set_flag(0x1E00 + screen id, 1), fieldstg
    // .L0x00008008-.L0x00008028), and the page reads that same bit back.
    const musicSelect = document.getElementById("musicSelect") as HTMLSelectElement;
    if (musicSelect && currentMap().music)
        musicSelect.value = currentMap().music;
    updateHud();
    saveFieldLocation();
    // Name the place you just walked into. The native card is built by the
    // field's own entry sequence with a literal "show the names" argument, so
    // it runs on every arrival, including the one that starts a new game.
    // The card's banks are 0xA9 / 0xB7 + the language byte the boot screen committed.
    placeCard.setLanguage?.(state.languageByte ?? 2);
    placeCard.begin!(m.id);
    queueMicrotask(() => activateStageNeighborhood(m.id));
}

export function addEntranceReturn(destId, arriveX, arriveY, fromId, fromPos: { x: number; y: number; dir: string; }) {
    const scene = state.scenes[destId];
    if (!scene) return;
    scene.exits = scene.exits ?? [];
    // Position depends on THIS arrival — drop any prior synthesized return first.
    scene.exits = scene.exits.filter((e) => !e._entranceReturn);
    // A real static exit back to the origin already covers the return (normal
    // two-way doors, and the Water-Tunnel side of the tower) — don't duplicate it.
    if (scene.exits.some((e) => e.to === fromId)) return;
    scene.exits.push({
        x: Math.round(arriveX) - 16,
        y: Math.round(arriveY) - 16,
        w: 32,
        h: 32,
        to: fromId,
        spawnX: Math.round(fromPos.x),
        spawnY: Math.round(fromPos.y),
        dir: _REV_DIR[fromPos.dir] ?? "down",
        _entranceReturn: true,
    });
}

// "Have I walked into this place?", the pause-menu MAP page's marker question. One
// store: the engine's banked flags, which the field entry writes on every arrival
// (0x1E00 + screen id). The page reads it through F0x8009A6B8's own flag id,
// 0x2000 | (ps1 & 0xff) — the same number over the field screen range.
export function engineFlagSeen(id) {
    return S.engine ? S.engine.state.flags.get(id, 1) === true : false;
}

/** Push the party's Charisma total into the engine var the engine's own bank-0x72 handler
 *  reads. The walker's NPC gating goes through storyFlags and does not need this, but the
 *  engine evaluates the same flags for step programs and events, and the two must not
 *  disagree about whether a tamer will duel you. Cheap and idempotent; call it whenever the
 *  party or its stats could have changed. */
export function refreshPartyCharisma() {
    if (!S.engine) return;
    S.engine.state.vars.set("$party.charisma", partyCharisma(state));
}

// One exit lookup for interaction, prompts, and automatic triggers. Scene gates
// are original step-table predicates; unresolved virtual predicates remain
// dormant instead of accidentally opening a route.
//
// Whether the exit is ARMED is not decided here. It is the disc's own question, and
// the disc asks its playback executor: press on a step tile, and the executor at
// `0x800885d4` runs whatever op that tile names. A stage WITH a step program is
// therefore gated on it — op 1 (the door), 9/10 (the two dives) or 14 (the pad-style
// handoff). One family is deliberately NOT gated, because the disc does not run it
// through this executor at all: a stage with no step program has no step tiles, so
// `stepPlayback` returns null and the row stands on its own. s210 and s220 were the
// visible casualties of this rule: both DO have a program on the disc, but the
// extractor missed it, so their six and two doors never armed. The extractor now
// reads them (s210's store sits at file 0x17f8 and s220's at 0x1344, both past the
// old 0x1200 scan window). Only s780 still ships an empty program, and it ships no
// step grid either — see the note on `playback()` in engine/systems/trigger-system.ts.
//
// The launch pad is NOT an exception any more. It is SETUP op 13, which the disc
// runs from its SETUP arm with no button in it (fieldstg.s:5c94-:5cb8) and whose
// PLAYBACK entry is the executor's own epilogue — op 13 does nothing on a press
// (fieldstg.s:0x5bc8 -> 0x80088878). So a pad cell arms no row here, shows no "?"
// and does nothing on a press; `stepSetupTick()` fires it on contact, out of the
// record's own words.
// Measured over the 790 shipped exits: every exit that carries a warp tag from a
// step program is named by a grid cell inside its own rectangle (781 of the 789 that
// have both a program and a grid), so this gate removes no working door.
export function activeExitAt(x = state.x, y = state.y): ActiveExit | null {
    const exits = state.scenes[currentMap().id]?.exits ?? [];
    const hit = hitRect(
        exits.filter((exit) => exitGatePasses(exit, storyFlags.get)),
        x,
        y,
    );
    if (!hit) return null;
    const pb = stepPlayback(x, y);
    if (!pb) return hit;                                          // no step program here
    if (!pb.live || !pb.op) return null;                          // the tile is not armed
    if (isStageChangePlayback(pb.op) || isDivePlayback(pb.op)) {
        // THE ROUTE PAIR. Ops 1, 9 and 10 are the only two writer sites of the
        // pair at [D0x80048D34+0x44] / [+0x46] (engine/systems/route-pair.ts), and
        // both read this step record's own params[5] / params[6]. `routeWords` is
        // present only on those three ops and is read verbatim off the record, so
        // carrying it here is what puts the disc's two scalars into the warp the
        // player just triggered. Copied, never assigned onto the scene's own row.
        if (!pb.routeWords) return hit;
        // THE DESTINATION, resolved where the disc resolves it. A door's own scene
        // row was named at BUILD time from the base screen table, so a door whose
        // screen is one of the 55 shadowed ones kept leading to the pre-game map for
        // ever. On the disc nothing about the door decides this: op 1 hands the
        // record's params[0] — a SCREEN ID — straight to the handoff
        // (`0x8008B770(param0, -1, param1<<8, param2<<8, param3)`, pro/fieldstg.s:5970),
        // the handoff stores it on the new scene object (file 0x8a24:8a68-8a70), and the
        // phase-2 load walks the field screen table for the first record carrying that
        // id (file 0xf460). That walk starts at the s9xx alias records when the story
        // ordinal is 45 and at the 239 base records otherwise — the one test at
        // :f468/:f46c/:f478, bases :f488/:f4ac, first match wins (:f4ec). So one number
        // swaps the whole world's doors, and the router is already that rule
        // (engine/dw3/screen-routing.ts over data/screen_table.json); this is the
        // op-1/op-14 sibling of the pad handoff's own `screenRouter.route`
        // (startPadHandoff), and ops 9/10 read the same field one call deeper, through
        // the dive launcher's `record + 0xa`.
        //
        // Only the SWAPPED answer is new here. Below 0x2d the scene row's own `to` is
        // already that screen's base record — gen_scenes.stage_for_screen resolved it
        // from the same table — so asking again could only disagree where the two data
        // sources already do, and would silently re-decide doors the disc's own tile
        // and the shipped row disagree about (s850's return tile: its op-1 record is an
        // arrival pad for s741, its row is the door back to s330). The flip is the part
        // that was missing, and it is the part the ordinal decides.
        // An AIMED row — a places stage's copied slot — carries the copy's own
        // destination and pair, so the post-game screen swap is not re-decided
        // over it here: the swap reads the STATIC step record, and the places
        // copy has already replaced that record's destination (and resolved the
        // screen through the same ordinal-aware router, at aim time). The row's
        // own pair is preferred for the same reason — it IS the copied slot's
        // params[5]/params[6], which the SLOT_EXIT arm publishes verbatim,
        // zeros included. An un-aimed row keeps the step record's pair and the
        // swap exactly as before.
        const dest = hit.aimed ? null : swappedStepDestination(pb);
        return { ...hit, ...(dest ? { to: dest } : {}),
                 routeWords: hit.routeWords ?? pb.routeWords };
    }
    return null;                                                  // op 8 cutscene owns this tile
}

// The stage a step tile's record sends the player to INSTEAD of the one its scene row
// names, which is only ever the 45-only shadow record. The screen id is read off the
// very effect the op table built: ops 1 and 14 carry it as the handoff's own first
// argument and ops 9/10 as the dive launcher's `record + 0xa` pointer word
// (engine/systems/scene-step-ops.ts `execPlaybackOp`); no other opcode reaches
// `activeExitAt`'s stage-change/dive branch. Null whenever the ordinal is not the
// post-game marker, or the record names a screen this table has no shadow for, and the
// caller then keeps the scene row's own `to`.
function swappedStepDestination(pb) {
    if (!screenRouterOptions.useAlt()) return null;
    const handoff = pb.effect?.handoff?.args?.[0];
    const screenId = handoff != null ? handoff : pb.effect?.actorCall?.args?.[0];
    if (screenId == null) return null;
    const routed = S.screenRouter.route(screenId, currentMap().id);
    return routed?.kind === "warp" ? routed.to : null;
}

export function applyStoryFlag(id, expected) {
    const bank = (id >> 8) & 0xfe;
    if (bank === CARD_COLLECTION_BANK) {
        const cardId = id & 0x1ff;
        if (expected) grantCard(cards(), cardId, 1);
        else loseCard(cards(), cardId, 1);
        persistCollection(); // the card reward must survive a reload
        return;
    }
    if (COLLECTION_BANK_IDS.has(bank)) {
        // The original's give/take arm: setGameState F0x800165AC routes the eight
        // item banks 0x80..0x8E to F0x800161D8(index, value), and that routine's
        // second argument IS the branch — any non-zero value gives one copy
        // (clamped at 99), zero takes one away (floored at 0, and it takes the item
        // off whoever wears it). So a story that TAKES something now really takes
        // it, instead of being ignored while the item stayed in every list.
        const itemId = id & 0x1ff;
        if (expected) storeAddItem(state, itemId, 1);
        else {
            storeRemoveItem(state, itemId, 1);
            // The remove arm can take the item off a Digimon wearing it, so the worn
            // gear is part of what this write commits — otherwise a reload would put
            // the sword back on the hand the story just emptied.
            localStorage.setItem("equipment", JSON.stringify(state.equipment ?? []));
        }
        localStorage.setItem("inventory", JSON.stringify(state.inventory));
        return;
    }
    // Bank-0x70 op 0x50 (F0x80015d4c): the ACQUISITION FLOURISH — the one table entry
    // that is a resident-object action rather than a flag. The handler resolves the
    // player's type-0x16 FIELDCOM actor and calls setSub1(3) (obj+0x10 = 3), which runs
    // sparkle program 3 and plays packed sound 0x00040009 (ITEM_GET); it is
    // unconditional, so the written value is discarded (`li $v0,1` / `jr $ra`). The
    // disc ships it only inside dialogue-state on_close tables, beside the grant — the
    // talk-close arm is where it fires, so a talk grant's flourish lands with its item
    // instead of being dropped. The engine's PlaySparkle op drives the same actor.
    if (id === 0x7013) {
        state.sparkleActor = { program: 3, start: fieldcomTick() };
        sfx.play!("item_get");
        return;
    }
    const command = storyCommand(id);
    if (command) {
        if (S.engine) S.engine.writeStoryFlag(id, expected);
        else applyStoryCommand(command);
        return;
    }
    // Other command indices are inert; stored banks retain the existing backend.
    if (bank < 0x60) storyFlags.set(id, expected);
}
