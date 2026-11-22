import * as uiC from "../ui-c/index.js";
import type { FollowerDraw, FootPoint, SpriteRecord } from "./types.js";
import { assetMode, ASSET_MODE_HD, isLoadedAsset } from "../assets.js";
import {
  widePadFor,
  setFieldViewPad,
  FIELD_VIEW_PAD,
  wideMenuSides,
  fieldFrameRule,
  easeLevel,
  wideBoxCameraX,
} from "../field-view.js";
import { tickTiles } from "../map-tiles.js";
import {
  fieldCharPendingPixels,
  fieldCameraFollow,
  walkFrameIndex,
  timingForDir,
  treeKickHoldsInput,
  fieldDirectionFromIndex,
  FIELD_STOP_CLIP,
  submarimonLiftPixels,
  FIELD_TICK_SECONDS,
  playerPackForClip,
  BLOCK_ENGAGER_CLIP,
  FIELD_WALK_CLIP,
  FIELD_RUN_CLIP,
  KICK_YSORT_BIAS,
  resultBubbleFrames,
  RESULT_BUBBLE_ROW,
  screenIdForStage,
  partyOrbVisible,
  FISHING_BUDGET,
} from "../vendor/engine.js";
import {
  questFxShakeOffset,
  questFxDrawables,
  questFxDrawOver,
  questFxFading,
  questFxDrawFade,
} from "../quest-fx.js";
import { advanceFieldBlanks, tickNativeStage } from "../native-stage.js";
import {
  paceStageObjects,
  stageObjectDraws,
  streetScreenQuads,
  annotatorActive,
  annotatorMarkers,
} from "../stage-objects.js";
import { actorDrawsUnderMap, beginDrawOrderLog, takeDrawOrderLog, sortDrawables } from "../draw-order.js";
import {
  drawStageOverlayShapes,
  drawScrollLayers,
  drawEffectsUnderMap,
  drawEffects,
  drawLaunchPads,
  drawFireTrapBursts,
  drawNativeIntents,
  drawStageObjectSprites,
  drawStreetVehicles,
  drawStreetGlows,
  drawStingerPopup,
  drawStreetScreens,
  drawAnnotatorShapes,
} from "../effects.js";
import { questGhostActor } from "../quest-ghost.js";
import { seamPatchFor } from "../seamfix.js";
import { swayFor, groundFxFor, ambienceFor, ambienceSilence, fx } from "../ambience.js";
import { drawTreePatch, drawSwayingForeground } from "../treesway.js";
import { renderWater, WATER_VIEW } from "../water3d.js";
import { renderGrass, GRASS_VIEW } from "../grass3d.js";
import {
  mountRiding,
  mountPlayerLatch,
  mountRiderLift,
  mountRiderShiftX,
  mountHidesRiderShadow,
  mountRiderCutRow,
  mountDrawable,
  mountHidesFollowers,
  mountActorDef,
  mountActorDraw,
} from "../mount.js";
import { multiplayerGhosts, drawGhostLabel, multiplayerSelf, multiplayerTick } from "../multiplayer.js";
import {
  fieldcomReady,
  drawFieldcomIcon,
  balloonAnchorY,
  drawStoryBubble,
  drawIndicatorBubble,
  drawSparkleActor,
} from "../fieldcom.js";
import { questsTick, questNpcMark } from "../quests.js";
import { drawQuestMark } from "../questmarks.js";
import { castsLeft } from "../fishing-almanac.js";
import { drawTitleScreen } from "../titlescreen.js";
import { cutContentDraw } from "../cut-content.js";
import { blastDraw } from "../blast-ladder.js";
import { plannerDraw } from "../evolution-planner.js";
import { damageLabDraw } from "../damage-lab.js";
import { replayDraw } from "../replay-theatre.js";
import { S } from "./state.js";
import {
  HD_MAPS,
  NO_GRASS3D,
  NO_WATER3D,
  PLAYER_ENTITY_KIND,
  VIEW_H,
  VIEW_W,
  ZOOM,
  battle,
  books,
  canvas,
  cardAlbum,
  cardDeck,
  cardDuel,
  cardShop,
  chatBox,
  choice,
  cntyselNative,
  ctx,
  cutscene,
  debugPanel,
  dialogueBox,
  driMenu,
  editor,
  fade,
  fieldCanvasResolution,
  fieldMovie,
  fightReport,
  followers,
  getNpcResolver,
  gym,
  helpMenuBox,
  helpMenuWindowUp,
  inn,
  labCam,
  lastCam,
  menu,
  mpBalloons,
  placeCard,
  saveScreen,
  sceneEd,
  sceneSkip,
  sfx,
  shop,
  soundTest,
  stagslctMenu,
  state,
  status,
  textbox,
  viewCam,
  wideField,
  yesNoBox,
  yesNoWindowUp,
} from "./vars.js";
import {
  fieldDrawsOverFieldUiOpen,
  fieldFullScreenUiOpen,
  fieldStageFilled,
  fieldTakesOverUiOpen,
  sceneCast,
} from "./quest-scenes.js";
import { currentChar, currentMap } from "./session.js";
import { drawMapPicture, effectsMapImg, ensureMapImg, requestLeaderSheet } from "./map-load.js";
import { drawActorShadow, drawEntitySprite } from "./draw-sprites.js";
import { fishingSpotHere, playerPackMeta } from "./fishing-tree.js";
import { activeFollowerCount, followerChar } from "./followers.js";
import {
  activeTriggerStep,
  drawAnimDebug,
  drawDiveTransition,
  drawFishing,
  drawTreeRadar,
  fieldcomTick,
} from "./field-fx.js";
import { drawCheckerboardWipe, drawTransitionWipe, drawWideSideCovers } from "./transitions.js";

export function render() {
    S.billboardDraws = [];
    // A battle frame whose battle.draw() paints or clears every pixel: the field underneath is never seen, so only its pure
    // pixel work (3D water, 3D grass, the y-sorted draw list, front quest fx) is skipped; every tick and state update still runs.
    const skipField = battle.isActive() && !!battle.coversField?.();
    // Look C (web/ui-c): the field's own screens (place card, balloons...) keep their old pixels under the battle this frame, as in
    // the pixel game; their DOM layers would otherwise sit on top of the battle.
    uiC.cover(skipField);
    if (battle.isActive()) {
        // Battle owns the shared canvas at device resolution and establishes
        // its own transforms. The field underneath is fully covered.
        ctx!.setTransform(1, 0, 0, 1, 0, 0);
        wideField.padL = 0;
    } else {
        const hd = assetMode() === ASSET_MODE_HD;
        const stageEl = canvas.parentElement;
        const pad = hd && window.__fx?.widefield && fieldStageFilled() && stageEl
            ? widePadFor(stageEl.clientWidth, stageEl.clientHeight) : 0;
        setFieldViewPad(pad);
        wideField.padL = FIELD_VIEW_PAD * ZOOM;
        S.fieldFrame = fieldCanvasResolution.beginFrame(hd, pad ? { padX: wideField.padL, stageHeight: stageEl!.clientHeight } : null);
    }
    const m = currentMap();
    const mapImg = state.mapImgs[m.id];
    // HD maps: the picture the terrain effects read, and the HD tiles drawn over the native picture.
    const fxMapImg = effectsMapImg(m.id);
    const tiles = HD_MAPS ? state.mapTiles[m.id] : null;
    if (HD_MAPS) tickTiles();
    const c = currentChar();
    const sheet = state.charImgs[c.id] ?? state.npcImgs[c.id];
    // The one ordering list for the field frame, and the debug overlay list.
    // Declared here (above the map band) so the leader's own drawable can be a
    // hoisted function the under-map band calls before the ground goes down.
    const drawables = [];
    const debugInfos: AnimDebugRow[] = [];

    // THE LIVE FIELD CHARACTER, before anything reads the camera.  Three stage
    // objects move it -- s926's rising row, s680's sub-891 drive and s261's two
    // rows -- because fieldstg's resident object named 5 is the character you are
    // leading and its +0x54 is its world Y in 16.8 fixed point.  The engine keeps
    // the fixed point; this is where the whole-pixel part it has gained since
    // the last frame is folded into the player's map position, which is the
    // walker's own copy of the same word.  It lands here because the original's
    // own split (+0x5c = +0x54 >> 8) happens between the blank and the draw, and
    // because the camera below must already see it: applied after the camera the
    // player would bob a pixel every frame instead of the room scrolling.
    const charStep = fieldCharPendingPixels();
    if (charStep) state.y += charStep;

    // camera in map space, centered on player (or cutscene target), clamped to map
    // Use lerped cutscene camera when active; fall back to exact player-follow otherwise.
    const camCenterX = labCam.active ? labCam.x : viewCam.active ? viewCam.x : state.x;
    const camCenterY = labCam.active ? labCam.y : viewCam.active ? viewCam.y : state.y;
    // Capture-backed vignette stages are viewport images, not world maps.
    // Their native actors/effects still use field coordinates, so project
    // those through the verified FN6 origin (target - 160,140) without
    // clamping against the capture's pixel dimensions.
    const nativeCenter = !labCam.active && viewCam.active && m.cutsceneCameraCenter;
    // Free roam: the disc's own follow rule — centre the leader at native
    // (160,140), NOT VIEW/2 at 120, and clamp inside the map. The 20-pixel
    // vertical bias is the original's; see engine/systems/field-camera.ts and
    // fieldstg F0x8008D788 (.L0x0000ab28 `addiu $s3,$a0,-0x8c`). Capture-backed
    // stages keep their own FN6 origin.
    const follow = fieldCameraFollow(camCenterX, camCenterY, m.width, m.height);
    let camX = nativeCenter ? camCenterX - nativeCenter[0] : follow.x;
    let camY = nativeCenter ? camCenterY - nativeCenter[1] : follow.y;
    // Wide overworld: the wide view is centred on the target the way the original centres its 320
    // view, clamped inside the map, and the 320 box is its middle (web/field-view.js). Where the wider
    // view could show what the original never showed, the camera eases back to the disc's own clamp
    // and the sides are covered (fieldFrameRule). Toward the original the ease is fast (6 frames).
    if (!battle.isActive()) {
        const now = performance.now();
        const dtw = wideField.t ? Math.min(0.1, (now - wideField.t) / 1000) : 0;
        wideField.t = now;
        const overUi = fieldDrawsOverFieldUiOpen(), takeUi = fieldTakesOverUiOpen();
        const menuSides = wideMenuSides({ fullScreenUi: fieldFullScreenUiOpen(), dimmableUi: overUi && !takeUi });
        const rule = fieldFrameRule({
            pad: FIELD_VIEW_PAD, mapW: m.width,
            fixedViewport: !!m.fixedViewportBackground,
            stagedScene: (cutscene.isActive() && wideField.staged) || !!state.diveDemo,
            nativeCentre: !!nativeCenter, labCamera: labCam.active,
            fullScreenUi: menuSides.coverSides,
        });
        const camTarget = rule.wideCamera ? 1 : 0, sideTarget = rule.showSides ? 1 : 0;
        wideField.dim = easeLevel(wideField.dim, menuSides.dim, dtw, 10);
        wideField.camK = easeLevel(wideField.camK, camTarget, dtw, camTarget < wideField.camK ? 10 : 4);
        wideField.sides = easeLevel(wideField.sides, sideTarget, dtw, sideTarget < wideField.sides ? 10 : 4);
        const wideX = wideField.camK > 0 ? wideBoxCameraX(camCenterX, m.width, FIELD_VIEW_PAD) : null;
        if (wideX != null) camX += (wideX - camX) * wideField.camK;
    }
    // Draw on the pixel grid. The player moves in fractions of a pixel (a walk
    // step is 0x4cc/0x100 = 1.195 px), so an unsnapped camera leaves the map at
    // a fractional destination and the canvas then samples it UNEVENLY: measured
    // on s205 at a half-pixel offset, some map columns were drawn one device
    // pixel wide and others two, which makes the artwork's own one-pixel dark
    // lines change thickness as you walk. Snapping the camera to a whole DEVICE
    // pixel keeps every column the same width at every camera position, and
    // costs at most half a pixel of camera lag. Movement itself is unaffected —
    // state.x keeps its fraction, only the drawn viewpoint is quantised.
    const devicePerMapPx = (S.fieldFrame?.scaleX ?? 1) * ZOOM;
    camX = Math.round(camX * devicePerMapPx) / devicePerMapPx;
    camY = Math.round(camY * devicePerMapPx) / devicePerMapPx;
    lastCam.x = camX;
    lastCam.y = camY;

    ctx!.fillStyle = window.__clearColour ?? "#000"; // see __cam/__mapInfo above
    ctx!.fillRect(-wideField.padL, 0, VIEW_W + 2 * wideField.padL, VIEW_H);
    if (window.__perfCut === 1) {  return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 1: after camera, ticks set-up and the clear (no save open yet)
    ctx!.save();
    ctx!.scale(ZOOM, ZOOM);
    // Extra quests: a scene's `shake` step moves the FIELD only -- the text box, the menus and the quest mark are drawn
    // after this transform is restored, so they stay put while the map, the people and the weather rumble.
    { const sh = questFxShakeOffset(); if (sh.x || sh.y) ctx!.translate(sh.x, sh.y); }
    // Point-sprite props that draw BEHIND the ground map-tile layer go down
    // first, so the map art covers them — ordering-table buckets 8 and above
    // against the ground's 7 (see effects.js and docs/research/field/map-tile-
    // draw-semitransparency-2026-08-20.md section 8). This pass also ticks the
    // frame, so drawEffects below must run after it, and the native objects it
    // reads must be ticked before it.
    // One list of PAL blanks for this frame, shared by the original stage code
    // and its ported actors, so both step the same blanks.
    const fieldBlanks = advanceFieldBlanks();
    tickNativeStage(m.id, fieldBlanks);
    paceStageObjects(m.id, fieldBlanks, camX, camY, FIELD_VIEW_PAD);
    if (window.__perfCut === 2) { ctx!.restore(); return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 2: after the stage ticks (inside the zoom save)
    // The leader's own ordering bucket decides which side of the ground it lands
    // on. A type-5 field actor draws into the bucket named by its draw-layer word
    // (+0x78 -> the 0x1002 slot +0x138, F0x8008F52C), and a stage's own step
    // program can set that word (setup op 5 -> `state.playerDrawBucket`). At or
    // above the under-map bucket the leader belongs in the SAME band the 8/10
    // point props use, so the map's own opaque art covers it. The Protocol Ruins
    // tunnel authors exactly that (bucket 8) — the leader walks behind the block's
    // stone there. Its shadow rides one bucket further back (OT[n+1]) and both are
    // ONE drawable, so neither is ever split off.
    //
    // The disc emits the map's layers into their OWN ordering-table slots — layer
    // 2 at OT[11] (MAP_LAYER2_BUCKET), the ground at OT[7] (MAP_GROUND_BUCKET) —
    // and a thing between them (a bucket-8/10 prop, a bucket-8 party) lands in
    // between (pro/fieldstg.s L4234-4236 -> slot 0x138). One flattened map image
    // cannot be both behind and in front of the same prop, so a stage that draws
    // such a thing ships its two layers split at the layer-2-only pixels
    // (map_layer2_runs.json, TRACKED) and the renderer emits them separately:
    // layer 2 here, the ground after the under-map band. Every other stage draws
    // one flattened map.
    const groundImg = state.mapGroundImgs[m.id];
    const layer2Img = state.mapLayer2Imgs[m.id];
    // Both layers are rebuilt at load as offscreen CANVASES (the base map split
    // at the stage's layer-2-only pixels), so they are canvases, not Images —
    // both are drawable.
    const groundCover = !window.__hideProps
        && (groundImg instanceof Image || (groundImg && typeof groundImg.getContext === "function"));
    const layer2Split = !window.__hideProps
        && (layer2Img instanceof Image || (layer2Img && typeof layer2Img.getContext === "function"));
    const playerUnderMap = actorDrawsUnderMap(state.playerDrawBucket);
    // The stage overlay's own per-frame SHAPE TABLE paints here, UNDER the base
    // map: its ordering-table bucket is >= 8 (Protocol Ruins' 36 stamps sit on
    // bucket 12), so the map-tile ground (bucket 7) and every entity draw over
    // it exactly as on the console. ONE shared table-driven draw for every stage
    // that has one (tools/extract_stage_overlay_shapes.py).
    if (!window.__hideProps) drawStageOverlayShapes(ctx, m.id, camX, camY);
    // Map layer 2, at OT[11] — the farthest layer.
    if (layer2Split && !skipField) {   // skipField: a covering battle draws every pixel; the tile cache is left as is
        drawMapPicture(
            layer2Img, tiles?.base, "layer2",
            m.fixedViewportBackground ? 0 : -camX,
            m.fixedViewportBackground ? 0 : -camY,
        );
    }
    // No ground split: the leader at an under-map bucket goes down before the
    // flattened map, which is this stage's ground band.
    if (playerUnderMap && !groundCover) {
        questGhostActor(ctx, "player", drawPlayerActor);
        // The party copies the LEADER's draw-layer value every field tick
        // (follower hook F0x8008EAE8: `arg0->unk78 = leader->unk78`), so when
        // the leader goes behind the ground the whole party goes with him in
        // the same frame — see drawPartyFollowers below.
        drawPartyFollowers();
    }
    if (mapImg instanceof Image) {
        // A split stage is drawn as its two layers (layer 2 above, the ground
        // after the under-map band); the flattened map would put its baked ground
        // in front of layer 2, which the layer split has already replaced.
        if (!layer2Split && !skipField) {
            drawMapPicture(
                mapImg, tiles?.base, null,
                m.fixedViewportBackground ? 0 : -camX,
                m.fixedViewportBackground ? 0 : -camY,
            );
        }
    } else if (mapImg === "failed") {
        // The required map image failed and was latched; say so rather than keep
        // showing "loading map..." for ever, and do not re-request it.
        ctx!.fillStyle = "#bbb";
        ctx!.font = "16px monospace";
        ctx!.fillText("map failed to load", 20, 30);
    } else {
        ensureMapImg(m.id);
        ctx!.fillStyle = "#bbb";
        ctx!.font = "16px monospace";
        ctx!.fillText("loading map…", 20, 30);
    }

    // The stage's own SLIDING SCENERY LAYER (the s415 Deeper Crevice backdrop the
    // platform travels past): the stage's own art, drawn at the object's live
    // offset.  Screen coordinates -- the layer belongs to a fixed-viewport stage
    // -- and drawn here, over the base backdrop and under the props/entities, so
    // the platform and the point sprites stay in front of it.  See
    // engine/systems/point-record-actor.ts `scroll-layer`.
    if (!window.__hideProps) drawScrollLayers(ctx, m.id);
    if (window.__perfCut === 3) { ctx!.restore(); return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 3: after the map pictures (layer 2 / base map, scroll layers)

    // Props that draw BEHIND the ground go down next, then the ground itself is
    // put back in front of them. On a split stage layer 2 is already down and the
    // ground layer goes down after them; on a flattened stage the map above
    // established layer 2 behind the ground, so these props land in front of it
    // and the ground layer hides the parts the ground covers. That is the
    // console's order (map layer 2 at depth 11, these props at 8/10, the ground
    // at 7): docs/research/field/map-tile-draw-semitransparency-2026-08-20.md.
    // This pass also ticks the frame, so drawEffects below must follow it.
    // The view size is the cull window the disc's F0x80089038 tests records
    // against (the 0x1002 layer's screen rect, 320x240 at ZOOM 1).
    if (!window.__hideProps) drawEffectsUnderMap(ctx, m.id, camX, camY, VIEW_W / ZOOM, VIEW_H / ZOOM, FIELD_VIEW_PAD);
    // The under-map band (the party, whose leader's step-op 5 bucket is 8) goes
    // down HERE — after layer 2 and the 8/10 props, before the ground — the disc's
    // own OT[11] -> OT[8] -> OT[7] order.
    if (playerUnderMap && groundCover) {
        questGhostActor(ctx, "player", drawPlayerActor);
        drawPartyFollowers();
    }
    // The ground layer, at OT[7] — in front of everything the under-map band drew.
    if (groundCover && !skipField) {
        drawMapPicture(
            groundImg, tiles?.base, "ground",
            m.fixedViewportBackground ? 0 : -camX,
            m.fixedViewportBackground ? 0 : -camY,
        );
    }
    // EXPERIMENT (seam fixes): filler pixels for pin-holes and hairline cracks in the
    // map picture, drawn over the ground. Off with the Effects panel / __noSeamFix.
    if (!window.__noSeamFix && !window.__hideProps && !m.fixedViewportBackground && fxMapImg instanceof Image) {
        const sp = seamPatchFor(m.id, fxMapImg);
        if (sp) ctx!.drawImage(sp.canvas, -camX, -camY);
    }
    // EXPERIMENT (swaying trees): hide the painted canopies; the swaying copy is drawn with the foreground layer
    if (!m.fixedViewportBackground && fxMapImg instanceof Image && swayFor(m, fxMapImg)) drawTreePatch(ctx, m.id, effectsMapImg(m.id, "fg"), fxMapImg, camX, camY);
    if (window.__perfCut === 4) { ctx!.restore(); return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 4: after under-map effects, ground picture, seam patch, tree patch
    // Build y-sorted drawable list
    //
    // `playerAnimTime` feeds gesture-clip timing (drawEntitySprite's `animTime` for
    // `activeClip`), so it must track `state._inCutscene`, not just `state._cutTarget`.
    // `state._animTime` is the clock the cutscene system actually keeps ticking (via
    // cutscene-manager's `_moveToward` while walking, AND via update()'s explicit
    // `if (state._inCutscene && !state._cutTarget) state._animTime += dt` while stationary).
    // `state.animTime` is a SEPARATE, WASD-movement-only clock that's frozen (never
    // incremented or reset) for the entire duration of any cutscene — using it here for a
    // stationary cutscene gesture (e.g. a nod) meant the clip was correctly SELECTED but
    // never actually advanced past its first frame, since elapsedSeconds never changed.
    // Foreground map-overlay (walk-behind pipes/poles/canopies): map-tile
    // layers >= 1 draw OVER all sprites on PS1 (docs/todo/2026-07-04-map-
    // foreground-overlay-layer.md — s350 walkmesh runs UNDER the pipe art, so
    // always-over-entities is the faithful order). y=Infinity sorts it after
    // every entity; pushed before drawEffects so the stable sort keeps
    // point-sprite foreground records (also Infinity) ON TOP of the map art.
    // EXPERIMENT (3D grass): three.js blades planted on the map's grass pixels,
    // pasted into the y-sorted list as thin strips so the party walks behind
    // blades nearer the camera and in front of farther ones. ?nograss3d turns it off.
    // EXPERIMENT (3D water): shaded water surface over the map's water pixels,
    // drawn straight onto the ground (before every entity). ?nowater3d turns it off.
    if (!skipField && !NO_WATER3D && !window.__noWater3d && !m.fixedViewportBackground && !window.__hideProps) {
        const wc = renderWater(m.id, fxMapImg, camX - FIELD_VIEW_PAD, camY, performance.now() / 1000);
        if (wc) ctx!.drawImage(wc, -FIELD_VIEW_PAD, 0, WATER_VIEW.w, WATER_VIEW.h);
    }
    if (window.__perfCut === 5) { ctx!.restore(); return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 5: after 3D water
    if (!skipField && !NO_GRASS3D && !window.__noGrass3d && !m.fixedViewportBackground && !window.__hideProps) {
        const gc = renderGrass(m.id, fxMapImg, camX - FIELD_VIEW_PAD, camY, performance.now() / 1000);
        if (gc) {
            const STRIP = 8, PXS = GRASS_VIEW.px;
            // Firefox: each drawImage from a WebGL canvas holds frames back; one copy + 2D strips is as fast as no grass (measured 12.3 -> 127.5 fps).
            if (!S._grassScratch) S._grassScratch = document.createElement("canvas");
            if (S._grassScratch!.width !== gc.width || S._grassScratch!.height !== gc.height) { S._grassScratch!.width = gc.width; S._grassScratch!.height = gc.height; }
            const sctx = S._grassScratch!.getContext("2d");
            sctx.clearRect(0, 0, S._grassScratch!.width, S._grassScratch!.height);
            sctx.drawImage(gc, 0, 0);
            const gsrc = S._grassScratch;
            for (let sy = 0; sy < GRASS_VIEW.h; sy += STRIP) {
                drawables.push({
                    y: camY + sy + STRIP,
                    draw: () => ctx!.drawImage(gsrc!, 0, sy * PXS, GRASS_VIEW.w * PXS, STRIP * PXS,
                                              -FIELD_VIEW_PAD, sy, GRASS_VIEW.w, STRIP),
                });
            }
        }
    }
    if (window.__perfCut === 6) { ctx!.restore(); return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 6: after 3D grass
    // EXPERIMENT (ambience ground layer): puddles, footprints, dust and wading ripples,
    // above the ground and under every sprite.
    if (!window.__hideProps && !m.fixedViewportBackground) {
        const gfx = groundFxFor(m, fxMapImg, camX - FIELD_VIEW_PAD, camY);
        const gpad = FIELD_VIEW_PAD;
        if (gfx) drawables.push({ y: -1e12, draw: () => { ctx!.save(); ctx!.translate(-gpad, 0); gfx(ctx); ctx!.restore(); } });
    }
    const fgImg = state.mapFgImgs[m.id];
    if (fgImg instanceof Image) {
        drawables.push({
            y: Infinity,
            draw: () => {
                // EXPERIMENT (swaying trees): the canopies move; everything else in the layer stays put
                const sw = swayFor(m, fxMapImg);
                if (!(sw && drawSwayingForeground(ctx, m.id, effectsMapImg(m.id, "fg"), fxMapImg, camX, camY, performance.now(), sw.gust))) drawMapPicture(fgImg, tiles?.fg, null, -camX, -camY);
            },
        });
    }

    // Ambient point-sprite decorations: fixed-layer records paint now (over
    // the map, under all entities); y-sorted props join `drawables` at their
    // decoded baseline so the player walks behind them.
    // (tickNativeStage already ran above, before the under-map effects pass.)
    if (!window.__hideProps) drawEffects(ctx, m.id, camX, camY, drawables, VIEW_W / ZOOM, VIEW_H / ZOOM, FIELD_VIEW_PAD);
    // Debug-only: record what each producer submits to the one ordering list, so
    // a verifier can read the band chosen (window.__drawComposites).
    if (window.__logDrawOrder) beginDrawOrderLog();
    drawLaunchPads(ctx, m.id, camX, camY, drawables, state.launch);
    drawFireTrapBursts(ctx, m.id, camX, camY, drawables, state.fireTrap);
    drawNativeIntents(ctx, m.id, camX, camY, drawables);
    drawStageObjectSprites(ctx, m.id, camX, camY, drawables, stageObjectDraws(m.id));
    drawStreetVehicles(ctx, m.id, camX, camY, drawables);
    drawStreetGlows(ctx, m.id, camX, camY, drawables);
    drawStingerPopup(ctx, m.id, camX, camY, drawables);
    drawStreetScreens(ctx, m.id, camX, camY, drawables, streetScreenQuads(m.id));
    // The two stage users of the resident 2D draw-context service: their markers
    // this blank, drawn from the stage's own sprite directory through the same
    // per-stage sheet the scenery and the launch pads use.
    if (annotatorActive(m.id)) {
        drawAnnotatorShapes(ctx, m.id, camX, camY, drawables, annotatorMarkers(m.id));
    }
    if (window.__logDrawOrder) window.__drawComposites = takeDrawOrderLog();
    // The leader's own drawable. A hoisted function declaration (not an arrow
    // stored on the list) so the under-map band above can call it before the
    // ground; the list entry below draws it at the ordinary entity bucket. Its
    // clip→pack rule, its shadow and its country follow the comment inside.
    function drawPlayerActor() {
            // Debug-only A/B switch (window.__hideParty): the verifier captures a
            // frame with the party drawn and one with it suppressed at the SAME
            // position and camera, then measures the DIFFERENCE. If the ground
            // covers the party the two frames are identical where it stands; if
            // the party is drawn over the ground they differ by its silhouette.
            // This is the only sound hidden test: it never compares a crop against
            // stage art that may itself be wrong.
            if (window.__hideParty) return;
            const playerStopping = !state._inCutscene && state.stopping;
            const playerAnimTime = playerStopping
                ? state.stopTime
                : state._inCutscene
                  ? (state._animTime ?? 0)
                  : state.animTime;
            // EXPERIMENT (mounts): the rider stands still on the mount's back; the mount does the walking
            const riderStill = mountRiding();
            const playerFrameIdx =
                (state.moving || state._cutTarget) && !riderStill
                    ? walkFrameIndex(timingForDir(c.frameDurations, state.dir), playerAnimTime)
                    : 0;
            // THE PLAYER'S CLIP → PACK RULE, once.
            //
            // The original gives Junior five sprite packs and picks one from the
            // CLIP ID alone, in the per-frame clip resolver F0x8008F9C0
            // (fieldstg.s:13131-13176): 0..7 → p002play, 8 → p002plyk, 9..0x15 →
            // p002plyf, 0x16..0x19 → p002plyd, 0x1a..0x24 → p002plyl, 37+ →
            // p002plyf. Each mode below only says WHICH clip it latched; the pack
            // comes from `playerPackForClip`, so no mode names a pack. This is
            // what makes the fishing rod, the ladder, the slope step and the tree
            // kick one mechanism rather than four.
            //
            // The resolver re-runs only when the clip CHANGES
            // (`beq $a0,$s0` at :13143 skips an unchanged clip), which is why the
            // ordinary path below keeps the character's own sprite and only the
            // latched-clip modes take a different one.
            const cl = state.climb;
            const fp = state.fishing;
            const tkr = treeKickHoldsInput(state.treeKick?.run) ? state.treeKick.run : null;
            const slp = state.slope;
            // EXPERIMENT (mounts): the climb-on / step-off clip (p002plyl 28 / 31), the same pack the ladder uses.
            const mnt = mountPlayerLatch();
            // The clip this frame's mode has latched, and the facing/direction it
            // plays it in — the two things a mode contributes. Null means the
            // ordinary field path, which keeps the character's own sprite.
            const latched = mnt ? { clip: mnt.clip, dir: mnt.dir }
                : cl ? { clip: cl.clip, dir: cl.dirStr ?? "up-right" }
                : fp ? { clip: fp.pose.clip, dir: fp.dir }
                    : tkr ? { clip: tkr.pose.clip, dir: fieldDirectionFromIndex(tkr.facing) }
                        : slp ? { clip: slp.clip, dir: fieldDirectionFromIndex(slp.facing) }
                            : null;
            const playerClip = playerStopping ? FIELD_STOP_CLIP : state.activeClip;
            // Player = constructor kind 2, never on the six-value denylist.
            //
            // While climbing a ladder the gate STAYS ON and the shadow stays on
            // the ladder's foot (settled 2026-10-08, SHDW-Q003): the climb clips
            // (0x1a/0x1b/0x1c/0x20) are none of the three suppression clips, and
            // the climb offset lives in `entity+0x90` — SUBTRACTED from the world
            // y for the billboard and ADDED BACK for the shadow (see
            // drawActorShadow). Passing it here is what pins the shadow to the
            // foot instead of letting it ride up the sprite.
            // Submarimon's buoyancy raises the BILLBOARD only: the native
            // renderer subtracts (char+0x64 >> 8) from the sprite's screen row
            // at 0x8008f5d0 and the shadow adds the identical term back at
            // 0x8008f834. So the lifted row goes in and the same 8.8 height
            // comes with it, leaving the shadow pinned to the ground while the
            // sub floats above it. state.x/state.y are untouched — collision,
            // exits and triggers all keep reading the ground position.
            const subLift = submarimonLiftPixels(state.submarimon);
            // EXPERIMENT (mounts): riding lifts the rider onto the mount's back; the SHADOW keeps using the same
            // lifted row (it is the mount's shadow that lies under him now, drawn by web/mount3d.js).
            const drawY = state.y - subLift - mountRiderLift();
            // EXPERIMENT (mounts, saddle split): the rider's billboard moves across onto the measured saddle point
            const drawX = state.x + mountRiderShiftX();
            // The climb offset `entity+0x90`, fed to the shadow so it stays on
            // the ladder's FOOT while the billboard (drawn at `drawY`, already
            // offset-subtracted) climbs away from it. The modules hold +0x90 in
            // every phase: the bottom mount seeds 0, the head mount seeds
            // `height` (mode 0x44, file 0xd950), the climb steps it, and the
            // step-off keeps it until F0x8008fd60 clears it on completion —
            // which is exactly `progress` in all four phases.
            const climbGroundOffsetFixed = cl
                && (cl.phase === "mount" || cl.phase === "dismount" || cl.phase === "climb")
                && !window.__noClimbShadowOffset
                ? Math.round(cl.progress * 256) : 0;
            // EXPERIMENT (mounts): on the mount the rider casts no shadow of its own; the mount's lies on the ground
            if (!mountHidesRiderShadow()) drawActorShadow(
                state.x, drawY, PLAYER_ENTITY_KIND, latched ? latched.clip : playerClip,
                state.submarimon?.heightFixed ?? 0,
                climbGroundOffsetFixed,
            );
            if (latched) {
                // The pose clock. Climb and kick count their own seconds (the
                // kick's whole body is 31 ticks and one clip); fishing counts its
                // own pose clock; the slope step counts the ticks of the phase it
                // is in, which restarts with each clip — the disc latches the
                // next SETANIM the frame the phase turns over, so the frame clock
                // restarts with it.
                const poseT = mnt ? mnt.animT
                    : cl ? cl.animT
                    : tkr ? tkr.pose.ticks * FIELD_TICK_SECONDS
                        : fp ? fp.poseT
                            : slp.frame * FIELD_TICK_SECONDS;
                const pack = playerPackForClip(latched.clip);
                const meta = playerPackMeta(pack);
                if (meta && state.npcImgs[pack]) {
                    const info = drawEntitySprite(
                        meta, state.npcImgs[pack], state.clipImgs[pack],
                        drawX, drawY, latched.dir, latched.clip, poseT, 0, false, 0,
                    );
                    debugInfos.push({ x: state.x, y: state.y, label: "YOU", sprite: meta.id, info });
                    return;
                }
            }
            // Digi-Egg traversal form. On a seabed/underground screen the
            // native cast rebuild constructs the PLAYER from the stage's own
            // sprite id (326 Digmon / 327 Submarimon) instead of Junior's 2 —
            // the same kind of swap as the ladder pack above, but for a whole
            // section rather than one mount. Neither pack defines a run clip,
            // so the walk clip is requested for both moving and idle-moving;
            // drawEntitySprite falls back on its own when a clip is absent.
            const df = state.diveForm;
            const dfSheet = df && state.npcImgs[df.sprite];
            if (df && dfSheet) {
                const dfRec = state.manifest.npcs?.find((n: SpriteRecord) => n.id === df.sprite);
                // The block interaction's engager clip: mode 0x4d latched clip
                // 0x45 (p123digm's drill dive) for 36 blanks, and it ends when
                // the machine's engager arm sees the clip complete. While it
                // plays, the player's own clip and clock are the interaction's.
                const bi = state.blockEngage;
                const engageT = bi && bi.ix.engagerDoneTick === null
                    ? Math.max(0, bi.ix.ticks - 1) * FIELD_TICK_SECONDS
                    : null;
                const info = drawEntitySprite(
                    dfRec, dfSheet, state.clipImgs[df.sprite], state.x, drawY,
                    state.dir, engageT !== null ? BLOCK_ENGAGER_CLIP : playerClip,
                    engageT !== null ? engageT : playerAnimTime, playerFrameIdx,
                    engageT !== null ? false : state.moving || !!state._cutTarget,
                    state._idleTime,
                    FIELD_WALK_CLIP,
                );
                debugInfos.push({ x: state.x, y: state.y, label: df.name, sprite: df.sprite, info });
                return;
            }
            // EXPERIMENT (mounts, saddle split): the rider is hidden below the saddle row the mount editor set
            const cutRow = mountRiderCutRow();
            if (cutRow != null) {
                ctx!.save();
                ctx!.beginPath();
                ctx!.rect(-1e4, -1e4, 3e4, Math.round(cutRow - lastCam.y) + 1e4);
                ctx!.clip();
            }
            // The leader sheet is not ready (still loading, evicted, or its load failed): draw nothing this frame, like
            // every other actor, and make sure it is requested. drawSprite would throw on an undefined sheet, and an
            // exception out of render() ends the frame loop for good (frame() reschedules after render).
            if (!isLoadedAsset(sheet)) {
                if (cutRow != null) ctx!.restore();
                requestLeaderSheet(c.id);
                return;
            }
            const info = drawEntitySprite(
                c, sheet, state.clipImgs[c.id], drawX, drawY,
                state.dir, playerClip,
                playerAnimTime, playerFrameIdx,
                (state.moving || !!state._cutTarget) && !riderStill, state._idleTime,
                state.moving ? FIELD_RUN_CLIP : FIELD_WALK_CLIP,
                (state._inCutscene || playerStopping) ? 0 : S.fieldTickAccumulator,
            );
            if (cutRow != null) ctx!.restore();
            debugInfos.push({ x: state.x, y: state.y, label: "YOU", sprite: c.id, info });
    }
    // A `ghost`ed player (a memory replay) is drawn faint: web/quest-ghost.js sets the alpha around the whole draw.
    // EXPERIMENT (mounts): the mount is submitted FIRST, so on equal keys the player (submitted next) draws on top.
    mountDrawable(ctx, drawables, camX, camY, performance.now() / 1000);
    drawables.push({ y: state.y, player: true, draw: () => questGhostActor(ctx, "player", drawPlayerActor) });
    // EXPERIMENT (multiplayer): the other players in this stage, drawn as the player character at their own position, in the same depth order.
    if (sheet) {
        for (const g of multiplayerGhosts(m.id)) {
            drawables.push({
                y: g.y,
                draw: () => {
                    const gi = g.moving ? walkFrameIndex(timingForDir(c.frameDurations, g.dir), g.animTime) : 0;
                    drawActorShadow(g.x, g.y, PLAYER_ENTITY_KIND, undefined, 0, 0);
                    drawEntitySprite(c, sheet, state.clipImgs[c.id], g.x, g.y, g.dir, undefined, g.animTime, gi,
                        g.moving, 0, g.moving ? FIELD_RUN_CLIP : FIELD_WALK_CLIP, 0);
                },
            });
        }
    }

    // Junior's kick cells, drawn at his own ground anchor. The per-facing y-sort
    // bias (table 0x80097a88) is ±1 pixel: kicking upward puts the cell BEHIND
    // him, every other facing in front.
    const kick = state.treeKick?.run;
    if (kick?.kick?.sprite && fieldcomReady()) {
        drawables.push({
            y: state.y + KICK_YSORT_BIAS[kick.facing]!,
            draw: () => drawFieldcomIcon(
                ctx, 0, kick.kick.sprite,
                Math.round(state.x - camX), Math.round(state.y - camY),
            ),
        });
    }

    // Party Digimon drawables (y-sorted with player and NPCs). No script id names a
    // follower (they are charId species + 3; ids 1/2 are the player). At script start
    // the VM swaps every follower's hook for the walk driver 0x8008eef0 (file
    // 0x22a0..0x2338), so a follower stands where it is during a scene; it leaves the
    // screen only when a party gather parks it (`f.parked`).
    //
    // EACH FOLLOWER TAKES THE LEADER'S DRAW-LAYER VALUE, EVERY FRAME. The
    // original's follower tick hook F0x8008EAE8 — installed at the follower's
    // +0x108 by the follower constructor (pro/fieldstg.s:14840-14841; decomp
    // F0x8009116c.c:78) and run every field tick — copies the leader's bucket
    // onto the follower: `lw $v0,0x78($s1)` / `sw $v0,0x78($s0)`
    // (pro/fieldstg.s:12318-12320) = decomp F0x8008eae8.c:68
    // `arg0->unk78 = temp_s1->unk78` (temp_s1 = find leader). So the value the
    // step program writes for the player (setup op 5 -> `state.playerDrawBucket`,
    // via stepSetupBucketTick) is EVERY party member's bucket within a frame.
    // The followers never keep a bucket of their own, no step opcode authors
    // one, and this must not be special-cased to any stage: when the leader's
    // bucket reaches the under-map band the whole party is routed behind the
    // ground with him — the Protocol Ruins tunnel (s375).
    function partyFollowerDraws() {
        const out: FollowerDraw[] = [];
        if (state._questScene) return out;   // a quest scene: your partners step out of sight, so nothing walks through them
        if (mountHidesFollowers()) return out;   // EXPERIMENT (mounts): nobody trails you on a mount
        const drawCount = activeFollowerCount();
        for (let i = 0; i < drawCount; i++) {
            const f = followers[i];
            if (f!.parked) continue;
            const pc = followerChar(i);
            const ps = pc && state.charImgs[pc.id];
            if (!pc || !ps) continue;
            out.push({ i, f: f!, pc, ps });
        }
        return out;
    }
    function drawPartyFollower({ i, f, pc, ps }: FollowerDraw) {
        if (window.__hideParty) return; // debug A/B switch, see drawPlayerActor
        const pdir = f.dir;
        // A chase hands the field to the player: the party runs with them there, exactly as in ordinary walking.
        const fieldBusy = cutscene.isActive() && !state._questChase;
        const pStopping = !fieldBusy && f.stopping;
        const pAnimTime = pStopping ? f.stopTime : f.animTime;
        const pfidx =
            pAnimTime > 0
                ? walkFrameIndex(timingForDir(pc.frameDurations ?? {}, pdir), pAnimTime)
                : 0;
        const pClip = pStopping ? FIELD_STOP_CLIP : undefined;
        // Party follower = constructor kind speciesId+3. The walker has no
        // native species id here, and whether any species can land on the
        // six-value denylist is not established (decode doc §11.1), so this
        // passes null = the constructor's unconditional default (shadow ON)
        // rather than inventing a mapping.
        drawActorShadow(f.x, f.y, null, pClip);
        const info = drawEntitySprite(
            pc, ps, state.clipImgs[pc.id], f.x, f.y,
            pdir, pClip,
            pAnimTime, pfidx,
            f.gathering || (!fieldBusy && state.moving), f._idleTime,
            f.gathering || (!fieldBusy && state.moving) ? FIELD_RUN_CLIP : FIELD_WALK_CLIP,
            f.gathering ? 0 : S.fieldTickAccumulator,
        );
        debugInfos.push({ x: f.x, y: f.y, label: pc.name ?? `party${i}`, sprite: pc.id, info });
    }
    // Route the whole party behind the ground when the leader's bucket is at or
    // beyond the under-map band — the same frame, the same rule, called from
    // both under-map bands above (with and without a ground cover).
    function drawPartyFollowers() {
        for (const it of partyFollowerDraws()) drawPartyFollower(it);
    }
    // every body in view, for the ambience layer (breath, footprints, grass parting, footsteps)
    const feetNow = [{ id: "leader", x: state.x, y: state.y, moving: !!(state.moving || state._cutTarget), dir: state.dir, leader: true }] as FootPoint[];
    window.__feet = feetNow;
    for (const it of partyFollowerDraws()) {
        feetNow.push({ id: "f" + feetNow.length, x: it.f.x, y: it.f.y, moving: feetNow[0]!.moving, dir: state.dir });
        drawables.push({
            y: it.f.y,
            follower: true,
            draw: () => drawPartyFollower(it),
        });
    }

    const scene = state.scenes[m.id];
    if (scene) {
        // The stage's built cast (sceneCast): an actor built at stage load stays on
        // screen for the whole visit — a flag write does not remove it. The old
        // union kept one such target (a live block interaction) drawn by hand
        // because this list re-read the gate every frame; the cast is the same
        // rule for every actor, so the block actor is simply in it.
        const sceneNpcs = sceneCast(scene);
        for (const npc of sceneNpcs) {
            if (npc.cutsceneOnly && !cutscene.isActive()) continue;
            // The original builds a cutscene actor only when the script names it
            // (SETPOS/WALKTO/SETANIM), so an unplaced cutsceneOnly NPC is not on
            // screen yet. The walker drew EVERY one of them at its spawn record
            // (0,0) for the whole scene -- which put a stray actor where the
            // scripted arrivals belong. `_inCutscene` is set by the first opcode
            // that names the actor and cleared when the scene ends.
            if (npc.cutsceneOnly && !npc._inCutscene) continue;
            // EXPERIMENT (mounts): a mount's quest character is drawn from its 3D model, not its (blank) sheet
            if (mountActorDef(npc.npc_id)) {
                drawables.push({ y: npc.y, draw: () => mountActorDraw(ctx, npc, camX, camY, performance.now() / 1000) });
                continue;
            }
            const npcMeta =
                state.manifest.npcs.find((n: SpriteRecord) => n.id === npc.sprite) ??
                state.manifest.characters.find((c: SpriteRecord) => c.id === npc.sprite);
            const npcSheet =
                state.npcImgs[npc.sprite] ?? state.charImgs[npc.sprite];
            if (npcMeta && npcSheet) {
                const npcDir = npc.dir ?? "down";
                const npcAnimTime = npc._animTime ?? 0;
                // A chase target walks its own path (`_chasing`), so it plays the walk clip like any moving actor.
                const npcMoving = !!(npc.path || npc._cutTarget || npc._chasing);
                // About to lose a chase: the target blinks, so a chase going wrong looks different from one being kept.
                const npcBlink = !!(npc._chaseWarn && Math.floor((npcAnimTime + npc._idleTime) * 8) % 2 === 0);
                const npcFrameIdx = npcMoving
                    ? walkFrameIndex(timingForDir(npcMeta.frameDurations ?? {}, npcDir), npcAnimTime)
                    : 0;
                feetNow.push({ id: "n" + npc.id, x: npc.x, y: npc.y, moving: npcMoving, dir: npcDir });
                drawables.push({
                    y: npc.y,
                    // A `ghost`ed NPC (a memory replay) draws faint and tinted: web/quest-ghost.js is asked per actor,
                    // around the character's own draw (shadow and sprite alike).
                    draw: () => questGhostActor(ctx, npc.npc_id, () => {
                        if (npcBlink) return;            // the chase warning: a blink, never a different sprite
                        // NPC = constructor kind npc_id (spawn record +0x8).
                        drawActorShadow(npc.x, npc.y, npc.npc_id, npc.activeClip);
                        const info = drawEntitySprite(
                            npcMeta,
                            npcSheet,
                            state.clipImgs[npc.sprite],
                            npc.x,
                            npc.y,
                            npcDir,
                            npc.activeClip,
                            npcAnimTime,
                            npcFrameIdx,
                            npcMoving,
                            npc._idleTime,
                            FIELD_WALK_CLIP,
                        );
                        debugInfos.push({
                            x: npc.x, y: npc.y,
                            label: `${npc.sprite}#${npc.npc_id}`,
                            sprite: npc.sprite,
                            info,
                            npc_id: npc.npc_id,
                        });
                    }),
                });
            }
        }
    }

    // Extra quests: the effect art a scene placed (web/quest-fx.js). It joins the SAME list, so the disc's one ordering
    // rule sorts it against the people rather than after them -- an effect can stand behind a character or in front.
    for (const d of questFxDrawables(camX, camY)) drawables.push(d);

    // The disc's own draw order, in one shared place: ascending key, larger key
    // in front, and equal keys with the EARLIER arrival on top (the queue's
    // flush calls the head-most first and each callback prepends into its
    // ordering-table bucket). `sortDrawables` (web/draw-order.js) is that rule.
    sortDrawables(drawables);
    if (window.__perfCut === 7) { ctx!.restore(); return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 7: after every drawable is collected and sorted, before any is drawn
    // When the leader's bucket is behind the ground it was already painted in the
    // map band above, *before* the ground image; OT[8] is reached before OT[7]
    // and before every entity bucket, so the leader is behind the ground and
    // behind every other drawable. The list draws everything else. Its shadow
    // rides one bucket further back (OT[n+1]) and both are ONE drawable, so
    // neither is left in the list. The party rides the leader's bucket every
    // frame (F0x8008EAE8), so the follower drawables are painted in that same
    // band and skipped here with the leader.
    for (const d of drawables) if (!(playerUnderMap && (d.player || d.follower)) && !skipField) d.draw();
    // Extra quests: effects told to sit over every person (the `fx` step's "layer": "front").
    if (!skipField) questFxDrawOver(ctx, camX, camY);
    if (window.__perfCut === 8) { ctx!.restore(); return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 8: after the y-sorted drawables loop and front quest fx
    for (const g of multiplayerGhosts(m.id)) drawGhostLabel(ctx, g, Math.round(g.x - camX), Math.round(balloonAnchorY(g.y - camY)));
    { const me = multiplayerSelf(); if (me) drawGhostLabel(ctx, me, Math.round(state.x - camX), Math.round(balloonAnchorY(state.y - camY))); }
    multiplayerTick(m.id, state);   // EXPERIMENT: sends where I am and glides the other players
    questsTick(m.id, state.x, state.y);   // EXPERIMENT: lets the optional quest layer notice a new stage and where you are
    // EXPERIMENT (ambience): weather and drifting particles fall over everything else.
    if (!window.__hideProps && !m.fixedViewportBackground) {
        const amb = ambienceFor(m, fxMapImg, camX - FIELD_VIEW_PAD, camY);
        if (amb) { ctx!.save(); ctx!.translate(-FIELD_VIEW_PAD, 0); amb(ctx); ctx!.restore(); }
    } else ambienceSilence();
    if (state.debugAnim) drawAnimDebug(debugInfos);
    window.__lastAnimDebug = debugInfos;
    // Debug hook, alongside __lastAnimDebug: the camera this frame was drawn
    // with, so headless verification can project a world position to the same
    // screen pixels the renderer used (tools/verify_field_shadow.mjs).
    window.__lastCam = { x: camX, y: camY, zoom: ZOOM };
    window.__lastFrame = {
        groundCover, layer2Split, playerUnderMap,
        bucket: state.playerDrawBucket,
        groundImgType: groundImg ? groundImg.constructor.name : null,
        groundImgSize: groundImg ? [groundImg.width, groundImg.height] : null,
        layer2ImgType: layer2Img ? layer2Img.constructor.name : null,
    };
    if (window.__perfCut === 9) { ctx!.restore(); return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 9: after ambience/weather particles and the debug records

    // (SAY speaker indication is the anchored speech balloon itself — the
    // textbox draws attached to the speaker with a tail; see textbox.js.)

    // Story effects. SETANIM 803..806 are the bubble actors (engine
    // cutscene.bubbles; fieldstg configure 0x800881B8, tick 0x80087f84): the
    // FIELDCOM balloon pops in, holds the glyph program row (805 -> row 0,
    // 807 -> row 1), and 806 plays the close. An 805 open plays FUKIDASH
    // (0x00040007) on its init tick; 807 is silent.
    // Other effect commands draw no glyph.  The pad flashes' own cues are not
    // read here any more: the actor plays its pad's cue at its own fire
    // (wstag212.s file 0x3e8-0x408 plays the slot's table word on every
    // configure) down the music sink web/game.js wires with
    // `setPointRecordActorMusic`.  The old emote watcher could only catch a cue
    // when some unrelated SETANIM happened to land mid-flash, so the download
    // was silent in ordinary play.
    if (cutscene.isActive()) {
        const seen = (state._seenEmotes ??= new Set());
        const now = cutscene.clock();
        for (const [slot, b] of cutscene.bubbles) {
            const key = "bubble:" + slot + ":" + b.openedAt;
            if (!seen.has(key) && b.sound) sfx.play!("fukidash");
            seen.add(key);
            const e = getNpcResolver(b.actor);
            if (!e || !fieldcomReady()) continue;
            const openFrames = Math.floor((now - b.openedAt) * 60);
            const closeFrames = b.closedAt == null ? null : Math.floor((now - b.closedAt) * 60);
            // The bubble is the SAME balloon actor the proximity indicator below
            // is (0x80088144 -> tick 0x80087f84 -> draw 0x80087e7c), so it hangs
            // at `owner.y - (owner.height >> 8) - 0x1b` (fieldstg file
            // 0x51fc-0x5208 and `addiu $a3,-0x1b` at 0x5288/0x52bc) — not at a
            // hand-picked -31. The owner is whatever the SETANIM's second operand
            // resolves to, so only the player carries a hover (an NPC bubble gets
            // the plain ground anchor).
            drawStoryBubble(
                ctx,
                Math.round(e.x - camX),
                Math.round(balloonAnchorY(e.y - camY, e.submarimon)),
                b.row, openFrames, closeFrames, fieldcomTick(),
            );
        }
    } else {
        state._seenEmotes?.clear();
    }

    // Extra quests: a red "?" over a character with a job for you, a red "!" over one you can hand a finished job to.
    if (!textbox.isOpen!() && !choice.isOpen!() && fade.dir === 0 && !cutscene.isActive() && !battle.isActive() && !state.menuOpen && fieldcomReady()) {
        const here = state.scenes[currentMap()?.id];
        if (here) {
            for (const npc of sceneCast(here)) {
                if (npc.cutsceneOnly || npc.invisible) continue;
                const mark = questNpcMark(npc.npc_id, currentMap().id);
                if (mark) drawQuestMark(ctx, mark, Math.round(npc.x - camX), Math.round(balloonAnchorY(npc.y - camY)), fieldcomTick());
            }
        }
    }

// Field trigger indicator — the authentic step-VM rule (disasm: step-load
    // 0x80088288 + exec 0x8008836c + roam tick 0x80088bd8):
    //   byte = type-7 grid cell under the player (0 = no trigger)
    //   idx = byte & 0x1f -> step record; group = byte >> 5 -> the player must
    // FACE within ±1 of the group direction (8x8 table @0x80097624)
    //   the step's two flag gates must pass (0xffff = disabled)
    // The kind comes from the ENGINE now (engine/systems/scene-step-ops.ts, the port
// of the dispatch tables at file 0x198/0x1c0): op 2/3 -> 2, op 4 -> 4, op 7 -> 5,
//   op 0/9/10/14+ -> 0, op 1 -> (group>>1)+6 (10 when the group is 4), and ops
//   5/6/8/11/12/13 draw nothing because they never reach the bubble tail.
    // Drawn over the player's head, like the slot-1/slot-4 PS1 captures.
    // `state.fishing` joins the climb here: the cast raises the same scene lock
    // (0x80099dd8) the climb does, and the op-7 spot's own tool icon must not go
    // on advertising a press you are already in the middle of.
    if (!textbox.isOpen!() && fade.dir === 0 && !cutscene.isActive() && fieldcomReady()
        && !state.climb && !state.fishing) {
        const step = activeTriggerStep();
        // The kind comes from the ENGINE now (engine/systems/scene-step-ops.ts, the port
        // of the dispatch tables at file 0x198/0x1c0), so a ladder shows its icon exactly
        // when the tile it stands on is one the disc would mount — the old
        // "nearbyLadderMount(...) || ladder icon" fallback drew an icon the disc never
        // draws and armed a rail the tile does not name.
        const kind = step ? step.kind : null;
        // The indicator icon actor (fieldstg 0x80087f84) plays FUKIDASH
        // (0x00040007) once on its init tick unless spawned with the silent
        // subtype 1; the step-VM spawner (file 0x5900) passes subtype
        // (kind>>1)+6, so a proximity indicator sounds when it appears.
        // Keyed on the armed STEP identity (grid step + kind), not on draw
        // visibility, so dialogue/fade flicker doesn't machine-gun the cue.
        const indKey = kind == null ? null : `${currentMap().id}:${step ? step.op + ":" + (step.params ?? []) : "ladder"}:${kind}`;
        if (indKey != null && indKey !== state._indicatorKey) sfx.play!("fukidash");
        state._indicatorKey = indKey;
        if (kind != null) {
            drawIndicatorBubble(
                ctx,
                Math.round(state.x - camX),
                Math.round(balloonAnchorY(state.y - camY, state.submarimon)),
                kind,
                fieldcomTick(),
            );
        }
    }

    // The end-of-cast bubble. Mode 0x48 sub-state 3 opens it with
    // F0x80088144(0, 1, 6) — the SAME balloon actor class (tick 0x80087f84) the
    // proximity indicators above and the story bubbles are spawned from,
    // attached to the player via [0x8004b7bc](5, -1, 0) — and sub-state 4 closes
    // it 0x3c ticks later. Its subtype 1 is the silent variant, so unlike a
    // proximity indicator it does NOT re-play FUKIDASH.
    //
    // It is therefore drawn by the story bubble's own model, and that is the
    // whole difference from before: the actor's counter +0x60 starts at 0xc8 and
    // climbs by the frame delta, and the draw blits `(u8)(+0x60 >> 2)` as the cel
    // (F0x80087E7C, file 0x52a4). So the balloon POPS rather than appearing made
    // — cels 0x32, 0x33, 0x34 with no glyph, then it holds 0x35 with the glyph
    // for the 0x3c ticks, and after the close command it deflates 0x35, 0x36,
    // 0x37 and stops drawing (stage 3 returns before the draw, file 0x5304).
    // The glyph row is the actor's subtype (+0x8): the hold-phase draw
    // (F0x80087E7C) blits glyph_table[subtype*9 + cursor], and the fishing
    // bubble is spawned subtype 1 — row 1 (cells 1/2), NOT the rod-and-splash the
    // spot shows. The spot's op-7 proximity indicator selects row 5 (cells
    // 10/11); the result bubble does not. The frame-576 capture's
    // "creature/fish-like glyph" is these cells. Claims
    // fishing-q008-balloon-draw-cel-and-owner-anchor-2026-09-13 (which
    // contradicts FISH-010's "same rod-and-splash" clause) and
    // fieldcom-balloon-draws-last-cel-before-state-3-2026-10-02.
    const resultBubble = state.fishing?.result ?? null;
    if (resultBubble && fieldcomReady()) {
        const { openFrames, closeFrames } = resultBubbleFrames(resultBubble);
        // `false` means the actor has finished its close (stage 3): it is not
        // deleted, it just draws nothing, so the walker drops it too.
        if (!drawStoryBubble(
            ctx,
            Math.round(state.x - camX),
            Math.round(balloonAnchorY(state.y - camY, state.submarimon)),
            RESULT_BUBBLE_ROW, openFrames, closeFrames, fieldcomTick(),
        )) state.fishing.result = null;
    }

    // Party-indicator actor (FIELDSTG object type 0x16). It is owned by field
    // character 0, so it draws at the PLAYER's own world position, and it runs
    // PERMANENTLY: its resting program is the four-frame orb loop, and the
    // engine's PlaySparkle op (bank-0x70 op 0x50) only swaps in program 3's
    // starburst flare, which falls back into that same loop. Unlike the trigger
    // indicator it is NOT suppressed while the textbox is open, because the
    // acquisition it announces happens on the dialogue state's on_close.
    //
    // Only program 3's one-shot flare ends on its own; programs 1 and 2 hold forever
    // (their scripts loop via `ff` jumps). All three are now reachable: program 3 via the
    // bank-0x70 PlaySparkle(3) op, and 1/2 via the resident scene object's own notify
    // (`SETANIM 813 824/825`, fieldstg F0x800837EC), which the update loop folds into
    // state.sparkleActor above.
    //
    // THE GATE is the SCREEN, not the party. The ctor F0x80089f24 (fieldstg.s:7332-7353)
    // builds the actor iff the current screen id < 0x2d7, for the player's character
    // index 0 only (engine/systems/party-orb.ts, PORTED). There is no roster test:
    // the real-world prologue screens are exactly s780..s895 (ids 0x2d7..0x2ee), so
    // "the orb appears once a partner is downloaded" is the same event as leaving the
    // prologue. The field party being non-empty was an unverified walker assumption.
    const orbScreenId = screenIdForStage(S.fieldScreenTable, currentMap().id);
    if (fieldcomReady() && partyOrbVisible(orbScreenId)) {
        const sa = state.sparkleActor;
        const program = sa?.program ?? 3;
        const flareFrames = sa ? Math.max(0, fieldcomTick() - sa.start) : null;
        const flaring = drawSparkleActor(
            ctx,
            Math.round(state.x - camX),
            Math.round(state.y - camY),
            fieldcomTick(),
            flareFrames,
            program,
        );
        if (sa && !flaring) state.sparkleActor = null;
    } else if (state.sparkleActor) {
        state.sparkleActor = null;
    }

    // Ladder / drop endpoint markers (debug-visible; window.__showLadders = false to hide).
    // ▲ = bottom (walk up onto it to climb), ▼ = top (walk down onto it to descend).
    if (window.__showLadders !== false) {
        const ladders = state.scenes[currentMap().id]?.ladders;
        for (const L of ladders ?? []) {
            for (const [p, glyph] of [
                [L.bottom, "▲"],
                [L.top, "▼"],
            ]) {
                const lx = Math.round(p.x - camX),
                    ly = Math.round(p.y - camY);
                ctx!.fillStyle = "rgba(120,200,255,0.6)";
                ctx!.beginPath();
                ctx!.arc(lx, ly, 8, 0, Math.PI * 2);
                ctx!.fill();
                ctx!.fillStyle = "#002";
                ctx!.font = "10px monospace";
                ctx!.textAlign = "center";
                ctx!.fillText(glyph, lx, ly + 3);
                ctx!.textAlign = "left";
            }
        }
    }

    drawFishing(ctx, camX, camY);
    drawTreeRadar(ctx);
    drawDiveTransition(ctx, camX, camY);

    editor.drawOverlay!(ctx!);
    if (editor.enabled) sceneEd.drawOverlay!(ctx!);
    if (window.__perfCut === 10) { ctx!.restore(); return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 10: after cutscene effects, bubbles, ladders, fishing, overlays (the whole zoomed field), restore done here
    ctx!.restore();
    drawWideSideCovers(ctx);
    if (window.__perfCut === 11) {  return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 11: after the zoom restore and the wide side covers

    // EXPERIMENT (Angler's almanac): with the switch on, standing on a fishing spot draws
    // one line — how many casts this visit has left. It reads the live state.fishingBudget
    // (the cast itself is the game's own) and writes nothing.
    if (fx.anglermap && fishingSpotHere()) {
        const line = `Casts left this visit: ${castsLeft(state.fishingBudget ?? FISHING_BUDGET)}`;
        ctx!.save();
        ctx!.font = "10px monospace";
        ctx!.textAlign = "left";
        ctx!.textBaseline = "alphabetic";
        ctx!.fillStyle = "#000";
        ctx!.fillText(line, 9, VIEW_H - 9);
        ctx!.fillStyle = "#ffd34d";
        ctx!.fillText(line, 8, VIEW_H - 10);
        ctx!.restore();
    }

    // Over the field, under everything the player can interact with.
    // update() returns at an open book before placeCard.step, so it would freeze on screen behind the book.
    if (!books.isOpen()) placeCard.draw!(ctx!, VIEW_W, VIEW_H);

    textbox.draw!(ctx!, VIEW_W, VIEW_H);
    choice.draw!(ctx!, VIEW_W, VIEW_H);
    if (state.nameEntry) {
        // The naming screen holds the name until it has finished going dark
        // (SCREEN-OBJECT-NAME-AUDIT-001, thirty frames). The native adapter
        // ticks the screen here, because its pad comes from state.keys.
        state.nameEntry.draw?.(ctx, VIEW_W, VIEW_H);
        if (state.nameEntry.isDone() && state.nameEntryDone) state.nameEntryDone();
    }
    if (state.packSelect) state.packSelect.draw?.(ctx, VIEW_W, VIEW_H);
    if (state.endScreen) state.endScreen.draw(ctx, VIEW_W, VIEW_H);
    if (state.titleScreen) drawTitleScreen(ctx, state.titleScreen, VIEW_W, VIEW_H);

    if (inn.isOpen!()) inn.draw!(ctx!, VIEW_W, VIEW_H);
    if (shop.isOpen!()) shop.draw!(ctx!, VIEW_W, VIEW_H, state);
    if (driMenu.isOpen!()) driMenu.draw!(ctx!, VIEW_W, VIEW_H);
    if (dialogueBox.isOpen!()) dialogueBox.draw!(ctx!, VIEW_W, VIEW_H);
    if (chatBox.isOpen!()) chatBox.draw!(ctx!, VIEW_W, VIEW_H);
    for (const b of mpBalloons.values()) if (b.box.isOpen()) b.box.draw(ctx, VIEW_W, VIEW_H);
    if (yesNoWindowUp()) yesNoBox.draw!(ctx!, VIEW_W, VIEW_H);
    if (helpMenuWindowUp()) helpMenuBox.draw!(ctx!, VIEW_W, VIEW_H);
    if (gym.isOpen!()) gym.draw!(ctx!, VIEW_W, VIEW_H, state);
    if (cardShop.isOpen!()) cardShop.draw!(ctx!, VIEW_W, VIEW_H, state);
    if (cardAlbum.isOpen!()) cardAlbum.draw!(ctx!, VIEW_W, VIEW_H, state);
    if (cardDeck.isOpen!()) cardDeck.draw!(ctx!, VIEW_W, VIEW_H, state);
    if (cardDuel.isOpen()) cardDuel.draw(ctx, VIEW_W, VIEW_H, state);
    if (saveScreen.isOpen!()) saveScreen.draw!(ctx!, VIEW_W, VIEW_H, state);
    if (fightReport.isOpen!()) {
        // The results screen is a framebuffer takeover (the original
        // switches the display environment); clear the field behind it.
        ctx!.save();
        ctx!.setTransform(1, 0, 0, 1, 0, 0);
        ctx!.fillStyle = "#000";
        ctx!.fillRect(0, 0, ctx!.canvas.width, ctx!.canvas.height);
        ctx!.restore();
        fightReport.draw!(ctx!, VIEW_W, VIEW_H);
    }
    if (status?.isOpen!()) status.draw!(ctx!, VIEW_W, VIEW_H);
    else if (state.menuOpen) menu.draw!(ctx!, VIEW_W, VIEW_H, state);
    if (battle.isActive()) battle.draw();
    uiC.cover(false);
    // The field movie takes the whole screen (its draw fills black first), the
    // same way the original's movie screen owns the display while it plays.
    if (fieldMovie.isOpen()) fieldMovie.draw(ctx, VIEW_W, VIEW_H);
    // Drawn last so the debug overlay sits on top of everything, including the battle HUD.
    debugPanel.drawOverlay!(ctx!, VIEW_W, VIEW_H, state);
    stagslctMenu.draw!(ctx!, VIEW_W, VIEW_H);
    soundTest.draw!(ctx!, VIEW_W, VIEW_H);
    cntyselNative.draw(ctx, VIEW_W, VIEW_H);
    sceneSkip.drawOverlay!(ctx!, VIEW_W, VIEW_H);
    // EXPERIMENT (cut-content gallery): the read-only page sits over everything, including the battle HUD.
    cutContentDraw(ctx, VIEW_W, VIEW_H);
    // EXPERIMENT (Blast ladder): the starter card, over everything, drawn only while its page is open.
    blastDraw(ctx, null, VIEW_W, VIEW_H);
    // EXPERIMENT (Next forms planner): the read-only page sits over everything too; it draws only while open.
    plannerDraw(ctx, VIEW_W, VIEW_H);
    // EXPERIMENT (Damage Lab): the stage-by-stage page sits over everything too; it draws only while the page is open.
    damageLabDraw(ctx, VIEW_W, VIEW_H);
    // EXPERIMENT (Replay theatre): the scene list sits over everything too; it draws only while the page is open.
    replayDraw(ctx, VIEW_W, VIEW_H);
    // GLOSSARY / OPTIONS: over everything, drawn only while a book is open.
    books.draw(ctx, VIEW_W, VIEW_H, wideField.padL, wideField.padL > 0);

    if (window.__perfCut === 12) {  return; }   // dev-only, set by web/perf-test.js; unset = unchanged. cut 12: after all field UI / menus / HUD, before fades
    if (fade.alpha > 0) {
        drawTransitionWipe(ctx, camX, camY);
    }
    // Extra quests: a scene's own screen fade (the `fade` step). It is a plain black cover, not the game's stage-change
    // wipe, so it cannot make the map the quest is still standing on think the player arrived.
    if (questFxFading()) {
        ctx!.save(); ctx!.translate(-wideField.padL, 0);
        questFxDrawFade(ctx, VIEW_W + 2 * wideField.padL, VIEW_H);
        ctx!.restore();
    }
    // The A28 checkerboard handoff draws over the field while it runs, whatever
    // the A27 fade's alpha is.
    if (state.wipe28) drawCheckerboardWipe(ctx);
    // Debug-only: leave a full-frame copy of this completed render so a verifier
    // can diff two frames WITHOUT a screenshot round-trip or a mid-frame canvas
    // read (window.__frameCopy / __frameCopySeq).
    if (window.__frameCopy) {
        const fc = window.__frameCopy;
        if (fc.width !== ctx!.canvas.width || fc.height !== ctx!.canvas.height) {
            fc.width = ctx!.canvas.width; fc.height = ctx!.canvas.height;
        }
        fc.getContext("2d")!.drawImage(ctx!.canvas, 0, 0);
        window.__frameCopySeq = (window.__frameCopySeq || 0) + 1;
    }
}
