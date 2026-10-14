import "./extra-roster.js";   // first: it wraps fetch so digimon.json / evolutions.json carry the extra species
import { storyCommand } from './vendor/engine.js';
import { bindCardInventory } from "./cardstate.js";
import { paintScreenDim, subtractLayer, dimFillStyle } from "./screendim.js";
import {
    WIPE_TILE,
    WIPE_H,
    WIPE_CLOSE_FRAMES,
    closeFrame,
    closeWindow,
    openFrame,
    seamRgb,
    coverLevel,
    createWipeClock,
    stepWipeClock,
    wipeProgress,
    WIPE_A28_STEP_UNIT,
    createCheckerboard,
    stepCheckerboard,
    checkerboardQuads,
} from "./stage-wipe.js";
import { createEditor } from "./editor.js";
import { renderGrass, GRASS_VIEW } from "./grass3d.js"; // EXPERIMENT: 3D grass
import { renderWater, WATER_VIEW } from "./water3d.js"; // EXPERIMENT: 3D water
import { applyScene, ambienceFor, groundFxFor, ambienceSilence, installFxPanel, swayFor } from "./ambience.js";
import { installPost2d } from "./post2d.js";
import { installQuests, questsTick, questTalk, questsPauseRow, questsPausePage, questNpcMark, questsDoneCount } from "./quests.js";
import { installMultiplayer, multiplayerTick, multiplayerGhosts, multiplayerSelf, drawGhostLabel, isOnline, sendChat, mpOn, myId, myName, peerOf, sendMpb } from "./multiplayer.js"; // EXPERIMENT: optional multiplayer (F4)
import { questsCreditChallenge } from "./quests.js";
import { installSocial, socialQuestDone, coopTry, coopReady, coopRolling } from "./mpsocial.js";
import { installMpBattle, mpbHost, mpbMessage, mpbPeerGone, mpbVisible } from "./mpbattle.js"; // EXPERIMENT: many-vs-many fights for multiplayer // EXPERIMENT: multiplayer chat, feed, inspect, trade
import { drawQuestMark } from "./questmarks.js"; // extra quests: the red ? and ! over characters // extra quests
import { buildPack, paginate } from "./dialogue-pack.js"; // extra quests: lines in the disc's own text format
import { installChat, buildChatPack } from "./chat.js";
import { installShowcase } from "./showcase.js";
import { drawSwayingForeground, drawTreePatch } from "./treesway.js"; // EXPERIMENT: rain/snow/leaves/fireflies + Effects panel
import { seamPatchFor } from "./seamfix.js"; // EXPERIMENT: fills pin-hole seams in map pictures
import { createSceneEditor } from "./sceneEditor.js";
import { createBgmPlayer, createSfxPlayer, createExclusiveRegister } from "./audio.js";
import { sceneBgmTrack } from "./ordinal-scene-variant.js";
import {
    ASSET_MODE_HD,
    assetMode,
    assignAssetImage,
    hideAssetModeChooser,
    initializeAssetModeUi,
    installAssetCanvasDrawing,
    isLoadedAsset,
    loadAssetImage as loadImage,
    showAssetModeChooser,
} from "./assets.js";
import { createCanvasResolutionController } from "./canvas-resolution.js";
import { createTextbox, autoBalloonMode } from "./textbox.js";
import { createChoice } from "./choice.js";
import { createInn } from "./inn.js";
import { createInnTranslated } from "./inn-translated.js";
// All gameplay-logic helpers come from the bundled TS engine (web/vendor/engine.js) — the
// single source of truth. The former web/{scene,cutscene,screen-routing,dialogue,items}.js
// duplicates were deleted.
import {
    nearestFacingNpc,
    talkCandidates,
    resolveConfirmTarget,
    hitRect,
    faceToward,
    resolveMazeExit,
    pickDialogue,
    pickDialogueState,
    selectNpcDialogue,
    applyNpcPrograms,
    chapterNpcs,
    stageCast,
    removeSceneActor,
    deriveChapter,
    parseEntry,
    createCutscene,
    createScreenRouter,
    screenIdForStage,
    // The s260 Cargo Tower auction's lot cycle (engine/systems/auction.ts).
    selectAuctionLot,
    runAuctionLot,
    partyOrbVisible,
    // The shared item store is the only writer of state.inventory (engine/dw3/item-store.ts,
    // the port of the original's F0x800161D8 / F0x80015F04 / F0x800135E8).
    storeAddItem,
    storeRemoveItem,
    heldCount,
    listItemIds,
    ownsItem,
    wornCount,
    syncWornFromEquipment,
    setHeldCount,
    clearBag,
    useItem,
    ITEM_BY_ID,
    ITEM_BY_NAME,
    createGrid,
    fromJSON,
    rectBlocked,
    moveWithCollision,
    timingForDir,
    walkFrameIndex,
    clipFrame,
    clipDurationSeconds,
    FIELD_TICK_SECONDS,
    FIELD_RUN_MAGNITUDE,
    FIELD_WALK_SPEED,
    FIELD_IDLE_CLIP,
    FIELD_WALK_CLIP,
    FIELD_RUN_CLIP,
    FIELD_STOP_CLIP,
    seedFollowerHistory,
    pushFollowerHistory,
    followerHistorySample,
    followerGatherSample,
    consumeFieldTicks,
    fieldDirectionDelta,
    fieldPureDirectionDelta,
    oppositeDirection,
    beginIceSlide,
    stopIceSlide,
    tickIceSlide,
    nearestPad,
    startFireTrap,
    fireTrapRegionAt,
    ambushTileAt,
    FISHING_POLE_FLAG,
    FISHING_BUDGET,
    METER_BAND,
    startFishing,
    tickFishing,
    fishingSpotAt,
    startFishingPose,
    tickFishingPose,
    startFishingBubble,
    tickFishingBubble,
    closeFishingBubble,
    resultBubbleFrames,
    RESULT_BUBBLE_ROW,
    POSE_SPRITE,
    POSE_CAST_CLIP,
    TREE_BOOTS_FLAG,
    TREE_SPRITE_IDLE,
    KICK_SOUND,
    KICK_YSORT_BIAS,
    RADAR_FRAME,
    RADAR_X,
    RADAR_Y,
    treeActionPoint,
    treeIndexAt,
    fieldProbePushback,
    applyObstaclePush,
    actorFootprintBlocked,
    npcHalfWidth,
    relocateActiveTree,
    radarClutRow,
    tickTreeRadar,
    startTreeKick,
    tickTreeKick,
    treeKickHoldsInput,
    KICK_POSE_SPRITE,
    KICK_POSE_CLIP,
    PLAYER_CLIP_PACKS,
    playerPackForClip,
    fieldDirectionIndex,
    isLadderPlayback,
    ladderMountFacing,
    ladderClimbPlan,
    ladderClimbPosition,
    ladderDismountEnd,
    isStageChangePlayback,
    isDivePlayback,
    routePairCommit,
    // The places system: the copyPlacePoints port and the row-aim helper
    // (engine/systems/place-points.ts). Applied on every stage entry — see
    // applyPlacePoints.
    copyPlacePoints,
    aimPlacePoints,
    startSlope,
    stepSlope,
    LAUNCH_PAD_SOUND,
    startLaunch,
    stepLaunch,
    diveFormForStepOp,
    diveMoveMagnitude,
    computeDiveNetwork,
    diveFormOnScreen,
    diveFormFromSpriteId,
    // The cast rebuild's own two loops (fieldstg F0x8008AE50): loop A picks the
    // player from descriptor+0x4C, loop B spawns every other record. The data is
    // assets/data/stage_cast_lists.json. See engine/systems/cast-list.ts.
    castPlayerRecord,
    castPlayerId,
    castActorRecords,
    // The three special block actors (npc 328/351/352) and the interaction they
    // carry. See engine/systems/block-actor.ts.
    isBlockActorId,
    engageBlock,
    tickBlockEngagement,
    BLOCK_ENGAGER_CLIP,
    BLOCK_TARGET_CLIP,
    BLOCK_CUE,
    // The item boxes (p126itmb): the talk body's family test, its start arm
    // (clip 0x41 + the TRESUREB cue) and its close arm, which removes the box
    // as its textbox closes. See engine/systems/box-actor.ts.
    isBoxActorId,
    BOX_TALK_CLIP,
    BOX_TALK_CUE,
    diveDemoFrame,
    DEMO_START as DIVE_DEMO_START,
    DEMO_CUE_FRAME as DIVE_DEMO_CUE_FRAME,
    createSubmarimonMotion,
    isSubmarimonSprite,
    submarimonCanInteract,
    tickSubmarimonMotion,
    submarimonIsAdvancing,
    submarimonRollsEncounter,
    submarimonLiftPixels,
    fieldDirectionFromIndex,
    terrainCodeAt,
    terrainGateBlocks,
    exitGatePasses,
    resetEncounterCounter,
    encounterStepTick,
    ENCOUNTER_TICK_FRAMES,
    fieldShadowVisible,
    isInnLauncherIndex,
    rosterMaskForParty,
    rosterSlotOfCharId,
    savePointForStage,
    savePointBySlot,
    setPadLanguage,
    // Where the disc sends the player after a movie: the movie's own row
    // (F0x80083cc0 loads the destination word, engine/dw3/screen-routing.ts).
    movieReturnScreen,
    // The disc's movie row a launch code names (F0x80083f48/F0x80083cc0):
    // low byte minus one into the twelve-row table.
    movieRow,
    MOVIE_TITLE_SCREEN,
    // The kind-6 win's launch cue 0xE0B = STTITL mode 11 = movie row 10 =
    // MOVIEE01_STR, the ending movie (wfightmn.s:2165-2174).
    FINALE_WIN_ENDING_MOVIE,
    // The field's battle handoff selector: F0x8008B798 writes 0xE0A (movie row 9,
    // MOVIED08_STR) instead of 0x600 while the master ordinal reads 43.
    battleHandoff,
    // The battle screen's own code (0x600): what the resident launcher records
    // as the previous screen when the loss arm hands it 0xE00 (the title).
    BATTLE_HANDOFF_SELECTOR,
    // The bank-0x90 talk launcher (the shared system): which conversation starts which scene.
    setTalkLaunchBindings,
    talkLaunchEventForBit,
    resolveTalkLaunchRecord,
    // The game's ONE random stream (the disc's own table walk at [0x8004dc0c]).
    // The native overlay interpreter's rand16 reads it too, so a stage that runs
    // original ambience code draws from the same word as the rest of the game.
    RAND_U16,
} from "./vendor/engine.js";
import { createFlagStore } from "./flag-store.js";
import { partyCharisma, loadCharismaDb } from "./charisma.js";
import { createEngineBridge } from "./engine-bridge.js";
import { PACKS } from "./packs.js";
import { fieldPartySize, grantPack, partyRosterView } from "./party.js";
import { createNameEntry, drawNameEntry } from "./nameentry.js";
import { createNameEntryNative } from "./nameentry-native.js";
import { createNameEntryTranslated } from "./nameentry-translated.js";
import { createPackSelect, drawPackSelect } from "./stplnmet.js";
import { createPackSelectNative } from "./packselect-native.js";
import { createPackSelectTranslated } from "./packselect-translated.js";
import { createEndScreen, drawEndScreen } from "./endscreen.js";
import { createEndCardTranslated, loadEndCardTranslated } from "./endscreen-translated.js";
import {
    createTitleScreen, drawTitleScreen, titleOptionRects, titleViewTransform,
    RESULT_START, RESULT_CONTINUE, RESULT_IDLE,
} from "./titlescreen.js";
import { createTitleNative } from "./title-native.js";
import {
    loadFieldcom,
    fieldcomReady,
    drawFieldcomIcon,
    drawFieldShadow,
    drawIndicatorBubble,
    drawStoryBubble,
    drawSparkleActor,
    balloonAnchorY,
    KIND as FC_KIND,
} from "./fieldcom.js";
import {
    loadDiveDemo,
    diveDemoReady,
    drawDiveDemoCells,
    drawDiveParticles,
} from "./dive-demo.js";
import { loadPointSprites, preloadPointSpriteStage, retainPointSpriteStages, drawEffects, drawEffectsUnderMap, drawStageOverlayShapes, drawNativeIntents, drawStageObjectSprites, drawAnnotatorShapes, drawStreetVehicles, drawStreetScreens, drawFireTrapBursts, drawLaunchPads, launchPads, setLaunchPadsEnabled, setPointSprite, launchPadDebug, drawStreetGlows, drawStingerPopup, stingerPopupProbe, streetGlowProbe, setPointRecordActorSound, setPointRecordActorMusic, setPointRecordOrdinal, setPointRecordAnchor, setPointRecordFlag, drawScrollLayers, scrollLayerEntries, pointRecordActors, pointSpriteProbe } from "./effects.js";
import { loadNativeStages, enterNativeStage, tickNativeStage, fireNativeEffect, advanceFieldBlanks, resetFieldBlanks } from "./native-stage.js";
import { beginDrawOrderLog, takeDrawOrderLog, actorDrawsUnderMap, ENTITY_BUCKET, sortDrawables } from "./draw-order.js";
import { loadFallingObjects, fireStageObject, fireNativeStageObject, paceStageObjects, stageObjectDraws, streetScreenQuads, clearStageObjects, annotatorActive, annotatorMarkers, setAnnotatorRandom, setStageObjectSound, setStageObjectOrdinal, stageObjectState, stageAmbienceDiagnostics, STAGE_AMBIENCE_EXECUTION } from "./stage-objects.js";
import { fieldCharPendingPixels, resetFieldChar, fieldCharState } from "./vendor/engine.js";
import { fieldCameraFollow } from "./vendor/engine.js";
import { packedIsMusicStart, packedKey } from "./packed-sound.js";
import { createMenu, pauseMapContext, migrateVisitedMaps } from "./menu.js";
import { openPauseHome, returnToPauseCardFolders } from "./pause-home.js";
import { createShopTranslated } from "./shop-translated.js";
import { createShopNative } from "./shop-native.js";
import { nativeScreenRead, nativeScreenWrite } from "./native-screen.js";
import { nativeScreenObjects } from "./native-screen.js";
import { nativeTextWidgets } from "./native-screen.js";
import { encodeNativeScreenText } from "./native-screen.js";
import { decodeNativeText } from "./native-screen-text.js";
import { createDriMenu } from "./dri.js";
import { createDriNative } from "./dri-native.js";
import { createLabTranslated } from "./lab-translated.js";
import { createDialogueTranslated } from "./dialogue-translated.js";
import { createYesNoTranslated } from "./yesno-translated.js";
import { createHelpMenuTranslated } from "./help-menu-translated.js";
import { gunslingerSwitchCommand, applyGunslingerSwitch } from "./gunslinger-switch.js";
import { ui as engineUi, dungeonSwitchCommand, applyDungeonSwitchCommand, newPadSwitchObject } from "./vendor/engine.js";
import { createGym } from "./gym.js";
import { createGymNative } from "./gym-native.js";
import { createGymTranslated } from "./gym-translated.js";
import { createStatusNative } from "./status-native.js";
import { createStatusTranslated } from "./status-translated.js";
import { createTitleMoviePlayer } from "./title-movie.js";
import { createFieldMoviePlayer } from "./field-movie.js";
import { createCardShop } from "./cardshop.js";
import { createCardShopNative } from "./cardshop-native.js";
import { createCardShopTranslated, bindCardShopInventory } from "./cardshop-translated.js";
import { createCardAlbum } from "./cardalbum.js";
import { createCardAlbumNative } from "./cardalbum-native.js";
import { createCardAlbumTranslated } from "./cardalbum-translated.js";
import { createCardDeck } from "./carddeck.js";
import { createCardDeckNative } from "./carddeck-native.js";
import { createCardDeckTranslated } from "./carddeck-translated.js";
import { createCardDuel } from "./cardduel.js";
import { createCardDuelNative } from "./cardduel-native.js";
import { loadCatalog, loadStarter, ensureStarterFolder, cards, grantCard, loseCard, ownedCount, persistCollection, collectionSnapshot, resetCollection, catalog as cardCatalog } from "./cardstate.js";
import { createSaveScreen } from "./save.js";
import { createSaveNative } from "./save-native.js";
import { createSaveTranslated } from "./save-translated.js";
import { createBattle, paidParticipants } from "./battle.js";
import { createFightReport, buildFightReportPages } from "./fightreport.js";
import { createFightReportNative } from "./fightreport-native.js";
import { createFightReportTranslated } from "./fightreport-translated.js";
import { toggleGameFullscreen } from "./fullscreen.js";
import { ephemeralActorRecord } from "./cutscene-actors.js";
import { createDebugPanel } from "./debugPanel.js";
import { createStagslctMenu } from "./stagslct.js";
import { createCntyselMenu } from "./cntysel.js";
import { createCntyselNative } from "./cntysel-native.js";
import { createSceneSkip } from "./sceneSkip.js";
import { loadPlaceCard, createPlaceCard } from "./placecard.js";
import { loadPlaceCardTranslated, createPlaceCardTranslated } from "./placecard-translated.js";
import { asButton, attachGamepad, isPadButton } from "./input.js";
import {
    FIELD_LOCATION_KEY,
    decodeFieldLocation,
    encodeFieldLocation,
    stageSpriteIds,
    stageWorkingSet,
} from "./stage-locality.js";

// D0x80055c34 is ONE register in the original, so both players share one
// instance here: a track or jingle started on either side first ends whatever
// the other side held — the field track's return ends W_JINGLE, EVOLUTIO ends
// the battle track, the battle track ends W_JINGLE.
const soundRegister = createExclusiveRegister();
const bgm = createBgmPlayer(soundRegister);
window.__bgm = bgm;
const sfx = createSfxPlayer(soundRegister);
window.__sfx = sfx;
const PACKED_JINGLES = {
    "0x010c0000": "digi_en0",
    "0x010c0001": "digi_en1",
    "0x010c0002": "digi_en2",
    "0x00cc0001": "login_dl",
};
// Music START words (bits 30+29 set, bit 31 clear) are SEP SEQUENCES, not
// samples: build_music.py rendered each as the stem build_music.py named it, and
// the sample sink resolves nothing for one. Two ship here:
//   DEMO_BGM 0x60040002 is common SEP seq 2, the Giant Hill-area theme the
//     s310/s311/s545/s620/s680/s805/s820 events ask for (SETANIM 813 873).
//   TITLEBGM 0x611c0000 is archive 71 (ttlbgm), the title screen's own theme:
//     the disc rings it ONCE per title entry from the sequence tick's glow case
//     (`[0x80055C48](0x611C0000)`, stdwtitl file 0x3e14; rig capture
//     docs/research/audio/captures/title-and-gym-sound-rig-2026-10-03.md §1) and
//     STOPS it on commit through the stop-by-id cell (`[0x80055C68]`, owner
//     state 3, file 0x40e8). It is NOT started at title open -- the theme begins
//     on this cue.
// A music-start word with no stem here stays on the sample sink, which is what
// plays the bit-30 jingles that DO have a sample (W_JINGLE).
const PACKED_MUSIC = {
    "0x60040002": "demo_bgm",
    "0x611c0000": "ttlbgm",
};

// The END card the title overlay raises before handing the machine to the first opening movie.
// The card runs the translated title-overlay routines (F0x80082E9C / F0x80082D70 / F0x80084628 /
// F0x8008453C, engine EndCardSession); ?legacyEnd=1 keeps web/endscreen.js. Its first callback
// stops every sound (D0x80055C64), which is sfx.stopAll() here.
const NO_GRASS3D = new URLSearchParams(location.search).has("nograss3d");
const NO_WATER3D = new URLSearchParams(location.search).has("nowater3d");
installFxPanel(document.getElementById("stage"));
installPost2d(document.getElementById("stage"), document.getElementById("game"));
installMultiplayer({ stageEl: document.getElementById("stage"), defaultName: () => state.playerName || "Tamer" });
// EXPERIMENT (multiplayer): the many-vs-many fight screen and what it needs from the game.
installMpBattle({
    stageEl: document.getElementById("stage"),
    getKit: () => battle.mpKit(),
    sfx, bgm, mapId: () => currentMap()?.id ?? null, languageByte: () => state.languageByte,
    openReport: (b, onClose) => openNativeReport(b, onClose),
    myId: () => myId(), myName: () => myName(),
    nameOf: (id) => peerOf(id)?.name ?? myName(),
    send: (ids, d) => sendMpb(ids, d),
    releaseKeys: () => state.keys.clear(),
    snapshot: () => ({ lead: JSON.stringify(state.partnerStats), party: JSON.stringify(state.partyStats ?? null), bits: state.bits | 0 }),
    restore: (sn) => {
        state.partnerStats = JSON.parse(sn.lead); state.partyStats = JSON.parse(sn.party); state.bits = sn.bits;
        localStorage.setItem("partnerStats", sn.lead); localStorage.setItem("partyStats", sn.party); localStorage.setItem("bits", String(sn.bits));
    },
    canJoin: () => mpIdle() && fieldPartySize(state.party) > 0,
    // a friend's quest challenge that I join counts for my own quest too
    joinDone: (setup) => (r) => { if (r.won && !r.fled && setup.ch?.length) questsCreditChallenge(setup.ch); },
});

// EXPERIMENT (multiplayer): the chat / feed / players / inspect / trade box. It reads the game's state and moves items only
// through the game's own item store; it never writes a story flag.
function mpCard() {
    if (!state.started || !state.manifest) return null;
    const roster = partyRosterView(state.party ?? [], state.partnerStats, state.partyStats, menu.digimonDB ?? {}, state.digimonNames);
    const party = roster.slice(0, 4).map((r) => {
        const st = {};
        for (const [k, v] of Object.entries(r.stats ?? {})) {
            if (typeof v === "number" && k.length <= 6 && !/^(hp|mp|maxhp|maxmp)$/i.test(k) && Object.keys(st).length < 8) st[k] = v + (r.bonuses?.[k] ?? 0);
        }
        return {
            n: String(r.name ?? "").slice(0, 14), f: String(r.formName ?? "").slice(0, 14), id: r.digimonId | 0, lv: r.level | 0, xp: r.xp | 0,
            hp: r.hp | 0, mhp: r.maxHp | 0, mp: r.mp | 0, mmp: r.maxMp | 0, st,
        };
    });
    return { v: 1, chapter: state.chapter ?? 1, bits: state.bits | 0, quests: questsDoneCount(), party };
}
const mpIdle = () => state.started && !battle.isActive() && !cutscene.isActive() && !textbox.isOpen() && !choice.isOpen() && !state.menuOpen && fade.dir === 0 && !state.diveDemo && !state.wipe28;
installSocial({
    stageEl: document.getElementById("stage"),
    api: {
        card: mpCard,
        currentMapId: () => state.manifest?.maps?.[state.mapIdx]?.id ?? null,
        mapName: (id) => state.manifest?.maps?.find((m) => m.id === id)?.name ?? null,
        busy: () => !!state.started && (battle.isActive() || cutscene.isActive() || fade.dir !== 0 || mpbVisible()),
        releaseKeys: () => state.keys.clear(),
        warp: (id) => {
            const idx = state.manifest?.maps?.findIndex((m) => m.id === id) ?? -1;
            if (idx < 0 || !mpIdle()) return false;
            loadAndSetMap(idx);
            return true;
        },
        bits: () => state.bits | 0,
        canFight: () => mpIdle() && fieldPartySize(state.party) > 0 && !mpbVisible(),
        // co-op: the same enemy on two screens with one shared HP pool (see web/mpsocial.js)
        coopState: () => battle.coopState(),
        coopSetHp: (i, hp) => battle.coopSetEnemyHp(i, hp),
        coopFight: (foes, done, screens) => startQuestBattle(foes, {
            onWin: (res) => { if (screens?.length && !res?.enemyFled) questsCreditChallenge(screens); done(); },   // the partner's quest challenge counts for me too
            onFlee: done, onLose: done,
        }),
        // A friendly duel: fight a copy of the other player's team (from their card), then put everything back as it was
        // (EXP, level ups, drops, BIT). cb({ won, hp }) where hp is the share of my team's HP left after a win.
        startDuel: (card, cb) => {
            const foes = (card?.party ?? []).filter((d) => menu.digimonDB?.[d.id]).slice(0, 3)
                .map((d) => ({ name: d.f, digimonId: d.id, level: Math.max(1, d.lv | 0), hp: Math.max(1, d.mhp | 0), mp: d.mmp | 0, stat_scale: 16 }));
            if (!foes.length) return false;
            const snap = { inv: JSON.stringify(state.inventory), bits: state.bits, lead: JSON.stringify(state.partnerStats), party: JSON.stringify(state.partyStats ?? null) };
            const share = () => {
                const rows = [state.partnerStats, ...(Array.isArray(state.partyStats) ? state.partyStats.slice(1) : [])].filter(Boolean);
                const max = rows.reduce((n, r) => n + (r.maxHp | 0), 0);
                return max > 0 ? Math.max(0, Math.min(1, rows.reduce((n, r) => n + Math.max(0, r.hp | 0), 0) / max)) : 0;
            };
            let over = false;
            const finish = (won) => {
                if (over) return; over = true;
                const hp = won ? share() : 0;
                state.inventory = JSON.parse(snap.inv); state.bits = snap.bits;
                state.partnerStats = JSON.parse(snap.lead); state.partyStats = JSON.parse(snap.party);
                localStorage.setItem("inventory", snap.inv); localStorage.setItem("bits", String(snap.bits));
                localStorage.setItem("partnerStats", snap.lead); localStorage.setItem("partyStats", snap.party);
                cb({ won, hp });
            };
            return startQuestBattle(foes, { onWin: () => finish(true), onFlee: () => finish(false), onLose: () => finish(false) });
        },
        // what I can hand over: carried (not worn) items of the four ordinary bags, never the Important Items bag
        tradable: () => [1, 2, 3, 4].flatMap((k) => listItemIds(state, k)).map((id) => ({ id, name: ITEM_BY_ID[id]?.name ?? `Item ${id}`, qty: heldCount(state, id) }))
            .filter((b) => b.qty > 0),
        // both players confirmed the same offers: take what I give, add what I get, through the game's own item store
        exchange: (gives, gets) => {
            const problems = [];
            for (const it of gives?.items ?? []) {
                const have = heldCount(state, it.id);
                if (have < it.qty) problems.push(`(you no longer had ${it.qty} ${it.name})`);
                if (have > 0) storeRemoveItem(state, it.id, Math.min(have, it.qty));
            }
            const giveBits = Math.min(gives?.bits | 0, state.bits | 0);
            for (const it of gets?.items ?? []) {
                if (ITEM_BY_ID[it.id] && it.qty >= 1 && it.qty <= 99) storeAddItem(state, it.id, it.qty);
            }
            state.bits = Math.min((state.bits | 0) - giveBits + Math.max(0, Math.min(gets?.bits | 0, 9999999)), 9999999);
            localStorage.setItem("inventory", JSON.stringify(state.inventory));
            localStorage.setItem("bits", String(state.bits));
            return problems.join(" ");
        },
    },
});

installQuests({
    stageEl: document.getElementById("stage"),
    // with a team-up partner a quest fight is offered to them too (same enemies, shared HP); otherwise exactly as before
    startBattle: (party, opts) => (coopTry(party, "Quest fight", (foes, withId) => (withId
        ? mpbLaunch({ foes, withId, label: "Quest fight", screenId: opts?.screenId ?? null, challenge: opts?.challenge, opts })
        : (startQuestBattle(foes, opts) || (opts?.onFlee?.(), false))), opts?.challenge) ? true : startQuestBattle(party, opts)),
    readFlag: (id) => storyFlags.get(id),   // read-only: the quest layer never writes a story flag
    partyLevel: () => Math.max(state.partnerStats?.level ?? 1, ...(Array.isArray(state.partyStats) ? state.partyStats.map((p) => p?.level ?? 1) : [1])),
    npcsHere: () => { const sc = state.scenes[currentMap()?.id]; return sc ? sceneCast(sc).filter((n) => !n.cutsceneOnly).map((n) => n.npc_id) : []; },
    // Speech goes through the game's own conversation box (translated, same balloon and font as a real NPC); the list and
    // the yes/no questions are the game's choice widget. Both resolve when the player is done.
    speak: (npcId, name, text) => questSpeak(npcId, name, text),
    ask: (prompt, options) => new Promise((resolve) => choice.open(prompt, options, resolve)),
    onDone: (title) => socialQuestDone(title),
    idle: () =>
        !battle.isActive() && !cutscene.isActive() && !textbox.isOpen() && !choice.isOpen() && !state.menuOpen && fade.dir === 0 && !state.diveDemo && !state.wipe28,
    partnerIds: () => [state.charId, ...(Array.isArray(state.party) ? state.party : [])].filter(Boolean),
    // rewards go through the game's own item store and money, exactly as a battle drop does
    giveItem: (name, count = 1) => {
        const item = ITEM_BY_NAME?.[name];
        if (!item) return false;
        for (let i = 0; i < count; i++) storeAddItem(state, item.id, 1);
        localStorage.setItem("inventory", JSON.stringify(state.inventory));
        return true;
    },
    giveBits: (n) => {
        state.bits = Math.min((state.bits ?? 0) + n, 9999999);
        localStorage.setItem("bits", String(state.bits));
    },
});
// Type-to-chat: T opens a line box, Enter shows it as a speech bubble over the player.
installChat({
    stage: document.getElementById("stage"),
    canOpen: () => state.started && !state.nameEntry && !textbox.isOpen() && !cutscene.isActive()
        && !battle.isActive() && fade.dir === 0,
    releaseKeys: () => state.keys.clear(),
    onSend: (text) => (isOnline() ? sendChat(text) : chatSay(text)),   // in a room the line goes to everyone and shows over every head
});
// The bubble itself is a second instance of the game's own conversation box, so it has the real
// balloon chrome, tail and font, but the game never sees it open: nothing is blocked while it shows.
const chatBox = createDialogueTranslated(sfx);
const chatActor = { x: 0, y: 0, actorId: 0 };
let chatShownAt = 0;
function chatSay(text) {
    chatBox.close();
    chatShownAt = performance.now() / 1000;
    chatActor.x = Math.round(state.x); chatActor.y = Math.round(state.y);
    chatBox.open({ pack: buildChatPack(text, String(state.playerName || "")), index: 0 }, { kind: "say", plain: false, balloonMode: 0, actor: chatActor }, null,
        (x, y) => ({ sx: (x - lastCam.x) * ZOOM * (320 / VIEW_W), sy: (y - lastCam.y) * ZOOM * (240 / VIEW_H) }));
}
// Multiplayer speech: every speaker gets their own instance of the same game balloon, over their own character.
const mpBalloons = new Map();   // player id -> { box, actor, at }
mpOn((type, d) => { if (type === "chat") mpBalloonSay(d.id, d.name, d.text); });
function mpBalloonSay(id, name, text) {
    let b = mpBalloons.get(id);
    if (!b) { b = { box: createDialogueTranslated(sfx), actor: { x: 0, y: 0, actorId: 0 }, at: 0 }; mpBalloons.set(id, b); }
    b.box.close();
    b.at = performance.now() / 1000;
    b.box.open({ pack: buildChatPack(text, String(name || "")), index: 0 }, { kind: "say", plain: false, balloonMode: 0, actor: b.actor }, null,
        (x, y) => ({ sx: (x - lastCam.x) * ZOOM * (320 / VIEW_W), sy: (y - lastCam.y) * ZOOM * (240 / VIEW_H) }));
}
function mpBalloonTick(dt) {
    if (!mpBalloons.size) return;
    const ghosts = new Map(multiplayerGhosts(currentMap().id).map((g) => [g.id, g]));
    for (const [id, b] of mpBalloons) {
        const at = id === myId() ? state : ghosts.get(id);
        if (!at || !isOnline() || !b.box.isOpen()) { b.box.close(); mpBalloons.delete(id); continue; }   // left the stage, or finished
        b.actor.x = Math.round(at.x); b.actor.y = Math.round(at.y);
        b.box.update(dt, null);
        if (performance.now() / 1000 - b.at > 4.5 && Math.floor(performance.now() / 300) % 2) b.box.pressConfirm();
    }
}
function chatTick(dt) {
    mpBalloonTick(dt);
    if (!chatBox.isOpen()) return;
    chatActor.x = Math.round(state.x); chatActor.y = Math.round(state.y);
    chatBox.update(dt, null);
    // close it by itself a few seconds after the text has shown (the box wants a confirm press)
    if (performance.now() / 1000 - chatShownAt > 4.5 && Math.floor(performance.now() / 300) % 2) chatBox.pressConfirm();
}
const USE_LEGACY_END = new URLSearchParams(location.search).has("legacyEnd");
const endCard = USE_LEGACY_END ? null : createEndCardTranslated({ stopSound: () => sfx.stopAll() });

// The end-of-cast fishing balloon before its pop was decoded: one static cel
// 0x35 with the row-1 glyph, drawn from the opening frame. The decoded balloon
// (the story bubble's own model) puffs up, holds, then deflates — see the block
// in render(). `?legacyFishBubble=1` keeps the old single static balloon.
const LEGACY_FISH_BUBBLE =
    new URLSearchParams(location.search).has("legacyFishBubble");

const fade = { alpha: 0, dir: 0, pending: null }; // dir: 1 fading out, -1 fading in
window.__fade = fade;

// The stage-change wipe runs on the original's own frame counter (web/stage-wipe.js,
// translated from fieldstg F0x8008A5E4); the shared fade's alpha is taken from it so
// the stage swap still lands exactly where it always did, on a full close.
// ?legacyWipe=1 keeps the old fade-clock wipe.
const USE_LEGACY_WIPE = new URLSearchParams(location.search).has("legacyWipe");
// The field->battle handoff plays the A28 checkerboard (web/stage-wipe.js,
// fieldstg F0x80089F7C) before the battle. ?legacyBattleHandoff=1 keeps the old
// immediate cut, so a verifier can capture before and after from one build.
const USE_LEGACY_BATTLE_HANDOFF = new URLSearchParams(location.search).has("legacyBattleHandoff");

const VIEW_W = 640;
const VIEW_H = 480;   // 240 native lines at ZOOM 2 -- the screen the disc sets,
                      // ledger UI-DISPLAY-EXTENT-001. Was 448 (224 lines) from
                      // this repository's first commit, never read off the disc.

// ?noEncounters=1 → no random-encounter rolls (debug/verification walks).
const NO_ENCOUNTERS =
    new URLSearchParams(location.search).get("noEncounters") === "1";
const ZOOM = 2; // render scale: PS1 sprites are tiny on modern screens
// The field-entity constructor F0x8009116c is called with a0=2 for the player
// (docs/research/field/player-party-movement.md); that "kind" is what the drop
// shadow's spawn gate tests.
const PLAYER_ENTITY_KIND = 2;
// The native step-sound routine (fieldstg 0x8008d0c4) picks the sample from the
// field character's SPRITE ID at [char+0x4], so a Digi-Egg traversal form does
// not sound like Junior:
//   default (id 2)      -> PLAYER00, on step tick & 7  == 0  (every 8 ticks)
//   326 Digmon          -> DIG_MOVE, on step tick & 0x1f == 0 (every 32) — the
//                          id-326 branch takes a second gate before playing
//   327 Submarimon      -> NO sample. That branch (0xd14c) calls the indirect
//                          routine at global [0x800ab6a0] and never reaches the
//                          sound pointer [0x80045c48]. What that hook plays is
//                          UNDECODED, so the form is left silent rather than
//                          given an invented swim cue.
// Ledger: digi-egg-traversal-form-step-sound.
const DIGMON_SPRITE_ID = 326;
// Debug-only: how many footstep cues the player's move handler has fired, so a
// verifier can assert that a scripted NPC walk is silent (window.__footstepCount).
let footstepCount = 0;
function tickFootstep(holder, dt) {
    const form = state.diveForm;
    const isDigmon = form?.spriteId === DIGMON_SPRITE_ID;
    const interval = (isDigmon ? 32 : 8) * FIELD_TICK_SECONDS;
    holder._footstepT = (holder._footstepT ?? interval) + dt;
    if (holder._footstepT < interval) return;
    holder._footstepT -= interval;
    if (isDigmon) { sfx.play("dig_move"); footstepCount++; }
    else if (!form) { sfx.play("player00"); footstepCount++; }
    // else: 327 Submarimon plays no sample at all — see above.
}
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
installAssetCanvasDrawing();
ctx.imageSmoothingEnabled = false;
const fieldCanvasResolution = createCanvasResolutionController(canvas, ctx, {
    logicalWidth: VIEW_W,
    logicalHeight: VIEW_H,
});
window.__fieldCanvasResolution = fieldCanvasResolution;

const lastCam = { x: 0, y: 0 };
window.__lastCam = lastCam; // verifiers read the player-on-screen position from here
// Every field billboard cell drawn in the current frame, with the row it was drawn at
// and the registration that put it there. tools/verify_field_billboard_anchor.mjs reads
// this; nothing else does, and it costs one object per drawn actor per frame.
let billboardDraws = [];
window.__billboardDraws = () => billboardDraws;
let fieldFrame = null; // last canvas-resolution snapshot: device pixels per logical px
// Verified field-script camera: FN6A targets an actor and FN6B targets coordinates.
// Mode 1 snaps/follows exactly; mode 0 eases toward the target.
const viewCam = { x: 0, y: 0, active: false };
const labCam = { x: 0, y: 0, active: false }; // web/seam-lab.html only — see __labCam

const legacyTextbox = createTextbox(sfx);
// The translated conversation box (engine/dw3/ui/dialogue-session.ts): the ordinary NPC talk route
// (estalkNN lines) and the cutscene SAY lines (esdmgNNN entries); ?legacyTextbox=1 keeps web/textbox.js for
// both. Defeat messages and hand-built pages still use web/textbox.js.
const dialogueBox = createDialogueTranslated(sfx);
window.__dialogueBox = dialogueBox;
const USE_TRANSLATED_TALK = !new URLSearchParams(location.search).has("legacyTextbox");
// `textbox` is a facade over both boxes: it reports open while EITHER is open (so every gate and the
// verifier fleet that reads window.__textbox.isOpen() keeps working); everything else is the legacy box.
// Readable copy of the line the translated box shows (from the same disc text), so checks that read
// window.__textbox.dialogue see it. The box itself draws from the raw bytes, not from this copy.
let translatedDialogueText = null;
// The field Yes/No question box (8 per-stage launchers, engine/dw3/ui/yesno-session.ts).
// It blocks the field like a talk box only while its window is up: while the event it
// started runs, that event's own boxes must be free to open.
const yesNoBox = createYesNoTranslated(sfx);
window.__yesNoBox = yesNoBox;
let yesNoAwaitingChild = false;
const yesNoWindowUp = () => yesNoBox.isOpen() && !yesNoAwaitingChild;
// The five NPC help counters (s210 event 8; s924 events 1602/1604; s935 events 1616/1618): the
// counter says its line, then eight topics and a cursor take the screen (engine/dw3/ui/help-menu-session.ts,
// translated from wstag210 F0x800A5E74 and its four copies). The menu starts no event, so the talk
// simply continues when it closes. ?legacyHelpMenu=1 leaves today's behaviour (the event plays and
// ends with nothing on screen) for the rollback check.
const USE_TRANSLATED_HELP_MENU = !new URLSearchParams(location.search).has("legacyHelpMenu");
const helpMenuBox = createHelpMenuTranslated(sfx);
window.__helpMenu = helpMenuBox;
const helpMenuWindowUp = () => helpMenuBox.isOpen();
const textbox = new Proxy(legacyTextbox, {
    get(target, prop) {
        if (prop === "dialogue" && dialogueBox.isOpen()) return translatedDialogueText;
        if (prop === "isOpen") return () =>
            target.isOpen() || dialogueBox.isOpen() || yesNoWindowUp() || helpMenuWindowUp();
        if (prop === "advance") return () => {
            if (yesNoWindowUp() || helpMenuWindowUp()) return; // these boxes read the pad themselves
            return dialogueBox.isOpen() ? dialogueBox.pressConfirm() : target.advance();
        };
        if (prop === "close") return () => { if (dialogueBox.isOpen()) dialogueBox.close(); target.close?.(); };
        return target[prop];
    },
    set(target, prop, value) { target[prop] = value; return true; },
});
const choice = createChoice(sfx);
window.__choice = choice;   // checks: whether a list / yes-no question is up
const menu = createMenu(sfx);
// Ordinary merchants use the shipped shop screen; the authored shop remains
// The original-execution merchant remains available to research checks only.
const USE_NATIVE_SHOP = new URLSearchParams(location.search).has("nativeShop");
// The field's own stage ambience (the overlay's per-stage actor registry) is
// OUR translated code on the ordinary route: the ambient point-sprite
// decorations, the stage-owned rock/decor/pad actors, the street broadcast,
// lights and screens, the stingers, the fixed sprites, the display-slot
// players/ensembles and the draw-context annotators all run from
// web/stage-objects.js + web/effects.js over engine/systems/**. The original
// overlay is an explicit research route only (?nativeStages), the way
// ?nativeShop=1 is for the merchant. Nothing boots it with no flag.
const USE_NATIVE_STAGE = new URLSearchParams(location.search).has("nativeStages");
const shopTranslated = createShopTranslated(sfx, { digimonDB: () => menu.digimonDB ?? {} });
const shop = USE_NATIVE_SHOP ? createShopNative(sfx, { digimonDB: () => menu.digimonDB ?? {} }) : shopTranslated;
// The Digimon Lab is the pro/stgdglab screen; the hand-authored desk stays as the
// development rollback (?legacyDri=1).
const driLegacy = createDriMenu();
// The training gym is the pro/stgtrain screen: the real pod select, the drill list with
// its pictures (STTRNG0), the TP/confirm plates, the session with the workout scene (the
// trainee and the props play the disc's TRANIN scripts), the result text and the stat roll.
// It runs translated code (engine/dw3/ui/gym-session.ts, web/gym-translated.js, proof
// tools/verify_translated_gym.mjs). The original-code overlay stays behind ?nativeGym=1 as a
// research reference (web/gym-native.js; its workout is host-drawn) and `?legacyGym=1` rolls
// back to the hand-authored web/gym.js.
const GYM_PARAMS = new URLSearchParams(location.search);
const USE_NATIVE_GYM = !GYM_PARAMS.has("legacyGym");
const USE_REFERENCE_GYM = GYM_PARAMS.has("nativeGym");
const USE_NATIVE_DRI = !GYM_PARAMS.has("legacyDri");
// The Digimon Lab runs translated code (engine/dw3/ui/lab-session.ts, web/lab-translated.js, proof
// tools/verify_translated_lab.mjs). The original-code overlay stays behind ?nativeLab=1 as a
// research reference (web/dri-native.js) and `?legacyDri=1` rolls back to the hand-made web/dri.js.
const USE_REFERENCE_LAB = GYM_PARAMS.has("nativeLab");
// Phase 6.3 pause/status route: the pause page is the default, with the
// hand-authored menu page as the rollback (?legacyStatus=1).
const USE_NATIVE_STATUS = !GYM_PARAMS.has("legacyStatus");
// The pause pages run translated code (engine/dw3/ui/pause-root-session.ts). The
// original-code overlay stays behind ?nativeStatus=1 as a research reference.
const USE_REFERENCE_STATUS = GYM_PARAMS.has("nativeStatus");
// `?legacyPause=1` is GONE (2026-10-04). It used to select web/menu.js's own
// hand-written copy of the pause home, which the UI lab opened too: a second
// list with its own row names for one system of the original. Every route that
// has a translated pause page now opens THAT page — the field's START, the lab's
// Status Menu button and the Digivolve Demo screen's Back all go through
// openPauseHome() below, and ?legacyStatus=1 remains the single hand-authored
// rollback (it leaves `status` null, so there is no translated list to open).
// Proof: tools/verify_pause_home_one_list.mjs.
// The naming screen: the DRI desk's rename (and the opening's standalone
// naming) run the translated pro/stdgname screen by default. The original-code
// overlay stays as an explicit research reference (?nativeName=1) and the
// hand-authored keyboard as the development rollback (?legacyName=1).
// Contract: the screen seeds its grid from the roster record's name field and
// its OK export writes the trimmed name back into that same field.
const USE_NATIVE_NAME = !GYM_PARAMS.has("legacyName");
const USE_REFERENCE_NAME = GYM_PARAMS.has("nativeName");
// The ordinary title uses the translated title controller and extracted art.
// The original-code screen remains an explicit research reference.
const USE_NATIVE_TITLE = GYM_PARAMS.has("nativeTitle");
// The starter-pack wizard is the native pro/stplnmet overlay (Phase 6.3 group 3,
// cut over 2026-09-22): the opening's registration hand-off opens
// web/packselect-native.js, the player types the account name on the screen's own
// keyboard, picks a pack and answers "Register account?", and the adapter reads
// the committed pack index back (0x8004B374) for the walker's grantPack.
// `?legacyPack=1` keeps the hand-authored wizard (web/stplnmet.js).
const USE_NATIVE_PACK = !GYM_PARAMS.has("legacyPack");
// The registration wizard runs translated code; the original-code screen stays
// behind ?nativePack=1 as a research reference.
const USE_REFERENCE_PACK = GYM_PARAMS.has("nativePack");
const packSelectNative = USE_REFERENCE_PACK ? createPackSelectNative(sfx) : createPackSelectTranslated(sfx);
/** Open the starter-pack wizard: native by default, the walker's wizard under
 *  ?legacyPack=1. */
function openPackSelect(opts = {}) {
    if (!USE_NATIVE_PACK) return createPackSelect(opts);
    return packSelectNative.open({ state, ...opts });
}
const nameEntryNative = USE_REFERENCE_NAME
    ? createNameEntryNative(sfx)
    : createNameEntryTranslated(sfx, { digimonDB: () => menu.digimonDB ?? {} });
const gymLegacy = createGym(sfx);
const gym = USE_NATIVE_GYM ? (USE_REFERENCE_GYM ? createGymNative(sfx) : createGymTranslated(sfx)) : gymLegacy;
const statusOptions = {
    // The pages draw the BASE Digimon's name out of the roster record, so the
    // adapter seeds exactly the name the menus show: the player's nickname when
    // there is one, else the species name (web/party.js partyRosterView).
    roster: (state) => partyRosterView(
        state.party, state.partnerStats, state.partyStats,
        menu.digimonDB ?? {}, state.digimonNames,
    ),
    // The card collection the album/folder screens read and write back.
    cards: () => cards(),
    // The native CARD FOLDERS page hands off through the resident launcher:
    // 0x1200 = Card Album, 0x400 = folder editor. Those two overlays are not
    // hosted in production yet (Phase 6.3 group 2), so the walker's own screens
    // answer the request — the same ones the walker's CARD FOLDERS panel opens.
    onTransition: (id) => {
        if (id === 0x1200) menu.onCardAlbum?.();
        else if (id === 0x400) menu.onCardDeck?.();
    },
    // The map page asks the flag store which places you have walked into — the bits the
    // field entry wrote (engine loadStage -> set_flag(0x1E00 + screen id, 1)).
    map: (state) => pauseMapContext(state, undefined, engineFlagSeen),
    cardFoldersUnlocked: () => (cards()?.folders?.length ?? 0) > 0,
    // Extra quests: one more row on the pause list (after CARD FOLDERS) and the page it opens.
    extraRow: () => questsPauseRow(),
    questsPage: () => questsPausePage(),
};
const status = !USE_NATIVE_STATUS ? null
    : USE_REFERENCE_STATUS ? createStatusNative(sfx, statusOptions)
    : createStatusTranslated(sfx, statusOptions);
const driMenu = USE_NATIVE_DRI ? (USE_REFERENCE_LAB ? createDriNative(sfx) : createLabTranslated(sfx)) : driLegacy;
// Ordinary card merchants execute the translated root, stock, booster and reveal.
// The original-code host is an explicit research route (?nativeCardShop=1).
const cardShopLegacy = createCardShop(sfx);
const cardShopNative = createCardShopNative(sfx);
const cardShopTranslated = createCardShopTranslated(sfx, {
    stage: () => screenIdForStage(fieldScreenTable, currentMap().id) ?? 0,
});
const cardShop = GYM_PARAMS.has("legacyCardShop") ? cardShopLegacy
    : GYM_PARAMS.has("nativeCardShop") ? cardShopNative : cardShopTranslated;
// Card Album / Folder editor / duel (stcrdabm, stcrddek, cardgame). The
// catalog they browse is decoded data; see web/cardstate.js for which of the
// surrounding rules are decoded and which are walker rules.
// The Album's ordinary route is now the translated screen
// (web/cardalbum-translated.js over engine/dw3/ui/album-session.ts: the
// already-oracled pro/stcrdabm controllers running as registered tasks). The
// shipped overlay stays as the explicit research reference behind
// ?nativeAlbum=1, and the hand-authored screen as the rollback ?legacyAlbum=1.
const cardAlbumTranslated = createCardAlbumTranslated(sfx);
const cardAlbumLegacy = createCardAlbum(sfx);
const cardAlbumNative = createCardAlbumNative(sfx);
const cardAlbum = GYM_PARAMS.has("legacyAlbum") ? cardAlbumLegacy
    : GYM_PARAMS.has("nativeAlbum") ? cardAlbumNative : cardAlbumTranslated;
// The Folder editor's chooser now runs our translated code: the factory, the
// picker tick, the label builder, the row fill and the colour census are
// engine/dw3/ui ports, composed by engine/dw3/ui/folder-session.ts behind
// web/carddeck-translated.js. The shipped pro/stcrddek overlay stays as the
// explicit research reference (?nativeFolder=1), and the hand-authored editor
// as the development rollback (?legacyDeck=1). The editor's card grid and name
// keyboard are not translated yet and the session names them as such.
const cardDeckLegacy = createCardDeck(sfx);
const cardDeckNative = createCardDeckNative(sfx);
const cardDeckTranslated = createCardDeckTranslated(sfx);
const cardDeck = GYM_PARAMS.has("legacyDeck") ? cardDeckLegacy
    : GYM_PARAMS.has("nativeFolder") ? cardDeckNative : cardDeckTranslated;
// The shop's Edit Folder opens the SAME folder screen as the pause menu's Card
// Folders row. On the disc both routes hand off to launcher code 0x400 =
// pro/stcrddek (stcrdshp's option 3, "Edit Folder" —
// docs/research/ui/stcrdshp-decoded-2026-07-12.md §0; the pause page
// F0x80084A34 launches 0x400 too), so the shop route must not open a second,
// hand-authored editor. This opens the module's one `cardDeck` binding, which
// also keeps the ?legacyDeck=1 rollback applying to both routes together.
// Leaving the screen returns to the field, where the hand-off left the player.
function openCardShopFolder() {
    cardDeck.open();
}
// The card duel runs the shipped pro/cardgame overlay through the native screen
// host: the player talks a tamer into a challenge in the field, the screen's own
// banner -> folder chooser -> coin toss -> Draw Phase chain plays, and the
// result (0x80048AC0 plus the per-opponent win count) commits into the walker's
// state. Proven from ordinary play by tools/verify_native_duel_play.mjs and at
// the screen level by tools/verify_native_duel.mjs /
// tools/verify_native_duel_commit.mjs. The hand-authored duel stays as the
// development rollback: `?legacyDuel=1`.
const USE_NATIVE_DUEL = !GYM_PARAMS.has("legacyDuel");
const cardDuelLegacy = createCardDuel(sfx, bgm);
// `getState` is a getter, not the object: `state` is declared further down this
// module, and the duel adapter seeds its bag synchronously from it the moment a
// duel opens. The accessor is also what keeps a duel opened through the debug
// hook (`window.__cardDuel.open(onClose, name, deck, id)`, used by the card-duel
// verifiers) seeded from the same bag the game uses.
const cardDuelNative = createCardDuelNative(sfx, bgm, { getState: () => state });
const cardDuel = USE_NATIVE_DUEL ? cardDuelNative : cardDuelLegacy;
// CARD FOLDERS on the status menu (esstatus string 11) — the entry that makes
// the Album and the folder editor reachable in normal play. Before this they
// opened only from the debug lab. The entry is gated the way the game gates it:
// it appears once the player actually holds cards, which is what Divermon's
// folder grant on the Yellow Cruiser does.
// The collection is { owned: Map, folders: [], ... } — NOT an array. Gate on
// holding a folder, which is what Divermon's grant on the Yellow Cruiser gives.
// The pause home's STATUS entry hands over to the native pause page when the
// route is on (Phase 6.3); the legacy status-list stays as the rollback. Keys
// are not double-handled: the native page owns the pad while it is open.
menu.nativeOpen = () => !!status?.isOpen();
// THE pause home. The field's START, the UI lab's Status Menu button and the
// Digivolve Demo lab screen's Back all call this one function (web/pause-home.js),
// so there is a single list of pause rows in the walker: the translated page
// (engine/dw3/ui/pause-root-session.ts). The rows, their order, their gate and
// every button on them are one system of the original — the resident list
// F0x8001270c and its builder 0x8001345C — tabulated once in
// docs/research/ui/pause-home-button-table-2026-10-04.md.
const pauseHome = () => openPauseHome({ state, status, menu });
// The Demo Setup screen has no place on the disc's pause list (nothing writes
// the row), so it is a debug-only extra and its Back has no original answer.
// It returns to the same one list every other route returns to.
menu.backToHome = pauseHome;
// MAP is absent from the reference route: row 2 of the overlay's factory table IS the
// map page (ctor 0x80099324, tick F0x8009913c), but it reads the RESIDENT map service
// object (0x8009B6EC) which the original-code runtime does not build — it draws nothing
// there (captures .dw3-research/status-route/map-row2-blank.png). The translated route
// ports that service (engine/dw3/ui/native/pause-misc.ts), so it opens the page. Demo
// Setup is an opt-in developer row the original never reaches from the pause home; the
// walker's own panel serves it.
const PAUSE_PAGE_ENTRIES = new Map(USE_REFERENCE_STATUS ? [
    ["ITEMS", "items"], ["SORT", "sort"], ["TECHNIQUES", "techniques"],
    ["STATUS", "status"], ["CARD FOLDERS", "cardfolders"], ["Demo Setup", "demosetup"],
] : [
    ["ITEMS", "items"], ["SORT", "sort"], ["MAP", "map"], ["TECHNIQUES", "techniques"],
    ["STATUS", "status"], ["CARD FOLDERS", "cardfolders"],
]);
menu.onNativePage = (label) => {
    const entry = PAUSE_PAGE_ENTRIES.get(label);
    if (!status || !entry) return false;
    status.open(state, entry, () => { menu.screen = "home"; });
    return true;
};
// The same flag store answers the legacy MAP pane's markers (?legacyStatus=1 rollback).
menu.mapSeen = engineFlagSeen;
menu.cardFolderUnlocked = () => (cards()?.folders?.length ?? 0) > 0;
// Both are hand-offs, not exits: on the disc the Card Album and the folder
// editor are separate SCREENS the pause page launches through the resident
// screen launcher (0x1200 / 0x400), and the game's screen manager brings the
// STATUS screen back when they close — so the player lands on the pause's OWN
// CARD FOLDERS page, not on a second hand-drawn copy of it. The one return
// route is returnToPauseCardFolders (web/pause-home.js), which reopens the
// translated page; only under ?legacyStatus=1, with no translated page to
// reopen, does web/menu.js's own panel answer.
const backToCardFolders = () => returnToPauseCardFolders({ state, status, menu });
menu.onCardAlbum = () => { state.menuOpen = false; cardAlbum.open(backToCardFolders); };
menu.onCardDeck = () => { state.menuOpen = false; cardDeck.open(backToCardFolders); };
// East Sector - Duel Island, the card-duel venue (docs/research/story-
// progression/GAME_WALKTHROUGH.md).
Promise.all([loadCatalog(), loadStarter()]).then(() => { ensureStarterFolder(); persistCollection(); });
// The post-fight results screen (pro/stfgtrep) runs as translated code in ordinary
// play: engine FightReportSession behind web/fightreport-translated.js, no
// PlayStation instruction and no interpreter. `?nativeReport=1` runs the shipped
// overlay through the MIPS interpreter instead (web/fightreport-native.js), a
// research reference that needs the executable assets. The hand-authored module
// stays as the explicit development rollback (?legacyReport=1) — see
// docs/plans/2026-09-28-translated-game-completion-plan.md.
const USE_NATIVE_REPORT = !GYM_PARAMS.has("legacyReport");
const USE_REFERENCE_REPORT = GYM_PARAMS.get("nativeReport") === "1";
const fightReportLegacy = createFightReport(sfx);
const fightReportNative = USE_REFERENCE_REPORT
    ? createFightReportNative(sfx)
    : createFightReportTranslated(sfx, { getState: () => state });
const fightReport = USE_NATIVE_REPORT ? fightReportNative : fightReportLegacy;
// The memory-card save/load screen (pro/stgmcard) runs as translated code in
// ordinary play: engine MemcardSession behind web/save-translated.js, the walker's
// three localStorage slots served as the card through web/memcard.js, no PlayStation
// instruction and no interpreter. `?nativeSave=1` runs the shipped overlay through
// the MIPS interpreter instead (web/save-native.js), a research reference that
// needs the executable assets. `?legacySave=1` rolls back to web/save.js.
const USE_NATIVE_SAVE = !GYM_PARAMS.has("legacySave");
const USE_REFERENCE_SAVE = GYM_PARAMS.get("nativeSave") === "1";
const saveScreenLegacy = createSaveScreen(sfx);
const saveScreenNative = USE_REFERENCE_SAVE ? createSaveNative(sfx) : createSaveTranslated(sfx);
const saveScreen = USE_NATIVE_SAVE ? saveScreenNative : saveScreenLegacy;

/** Open the post-fight results screen. The walker's report data (rows built by
 *  web/battle.js buildFightReportRows, plus pages) is translated into the
 *  native overlay's RAM contract (the 0x80042b84 workspace + roster records)
 *  when the native route is on; the legacy screen takes the data as-is. */
function openFightReport(opts = {}) {
    if (!USE_NATIVE_REPORT) { fightReportLegacy.open(opts); return; }
    const rows = opts.rows ?? [];
    const party = Array.isArray(state.party) ? state.party : [];
    const partySlots = rows.map((row) => rosterSlotOfCharId(party[row.index ?? 0]));
    const rewardXp = Number(opts.rewardXp ?? 0);
    const participants = rows.map((row) => ({
        pos: row.index ?? 0,
        rosterSlot: (partySlots[row.index ?? 0] ?? 0) >>> 0,
        // The walker's row xp already carries this battle's share; the native
        // screen counts up from the pre-battle total, so subtract it back out.
        preExp: Math.max(0, Number(row.xp ?? 0) - rewardXp),
        level: Number(row.level ?? 1),
        name: row.name,
        forms: state.partyStats?.[row.index ?? 0],
        participated: true,
        formFlags: [0, 0, 0],
    }));
    const dropItemId = opts.dropItemId
        ?? (opts.droppedItem ? (ITEM_BY_NAME?.[opts.droppedItem]?.id ?? 0) : 0);
    fightReportNative.open({
        gameState: state,
        battleId: opts.battleId ?? 0,
        dropItemId,
        activePos: rows[0]?.index ?? 0,
        partySlots,
        participants,
        onClose: opts.onClose ?? null,
    });
}
// Inns are DW3's save points, and the memory-card file record's "place" field
// indexes esshpnam — a bank whose tail is exactly the inn list ("Asuka Inn",
// "Suzaku Inn", "Amaterasu Inn", ...). The original's caller is now DECODED
// (2026-09-22): each save-point map carries a "PREPARE TO SAVE." event whose
// HANDOFF operand is the resident launcher's code `0xC00 | slot`, which loads
// pro/stgmcard with that slot and the save-mode value word. The slot's place is
// `esshpnam[42 + slot]` — engine/dw3/save-points.ts carries the 25 entries, and
// the walker now writes that exact place index instead of name-matching the
// walker map title. The LOAD direction's caller is the title's Continue choice,
// which launches the same code family with value 0
// (docs/research/ui/stdwtitl-title-menu-2026-08-14.md — 0x2D7 = Start,
// 0xC00 = Continue), handled at the title below.
function openMemoryCard(mode, onClose = null, atSavePoint = undefined) {
    const map = currentMap();
    // The caller may name the save point explicitly (the decoded HANDOFF);
    // otherwise the map decides, so the inn-zone save and the lab behave as
    // before.
    const savePoint = atSavePoint !== undefined
        ? (atSavePoint ?? null)
        : savePointForStage(map?.id ?? null);
    saveScreen.open(state, mode, onClose, {
        areaName: map?.name ?? "",
        placeName: savePoint?.place ?? map?.name ?? "",
        // The original's record carries the save point's own esshpnam index.
        placeIndex: savePoint?.placeIndex,
        savePointSlot: savePoint?.slot,
        playSeconds: state.playSeconds,
        roster: statusOptions.roster,
        reserveRoster: (id, stats) => partyRosterView([id], stats, [stats], menu.digimonDB ?? {}, state.digimonNames)[0],
    });
}
const battle = createBattle(canvas, ctx, () => state, sfx, bgm);

// The ordinal-43 field movie (MOVIED08_STR), the pre-battle clip of
// F0x8008B798's post-fight arm. The movie object is ported in
// engine/systems/field-movie-player.ts; web/field-movie.js is the media/draw
// adapter. The host resolves the handoff promise when the movie is over, and
// `startParty` then runs the battle the movie's own return selector (0x600)
// names. Every other ordinal leaves `battleHandoff().movie` null and the
// handler resolves at once, so nothing changes on the ordinary path.
let fieldMovieDone = null;
const fieldMovie = createFieldMoviePlayer(
    () => { const done = fieldMovieDone; fieldMovieDone = null; done?.(); },
    (error) => console.error("[field-movie]", error),
);
battle.setFieldMovieHandoff(async () => {
    const handoff = battleHandoff(state.progressOrdinal);
    if (!handoff.movie) return; // not ordinal 43: straight to the battle
    await new Promise((resolve) => {
        fieldMovieDone = resolve;
        fieldMovie.open(handoff.selector).then((row) => {
            if (!row) { fieldMovieDone = null; resolve(); } // unknown code: never strand the fight
        });
    });
});
window.__fieldMovie = () => fieldMovie.diagnostics();

// The finale's win exit (wfightmn.s:2165-2174, arm 4's phase 2): with the result
// byte 1 — the win — the resident launcher takes 0xE0B when the battle-kind word
// is 6, instead of 0x1400 (STFRPT). 0xE0B is STTITL mode 11 = movie row 10 =
// MOVIEE01_STR (pro/stdwtitl.s:161-167 the mode dispatch, :212-218 the low-byte-
// minus-one row; engine/dw3/movie-destinations.ts), whose own return selector is
// 0xE0C = row 11 = MOVIEE02_STR, whose own return selector is 0x2d7 = screen 727
// = WSTAG780_PRO (stage 780, Kusanagi City Street Corner — the same place the
// title's Start option lands).
//
// The chain plays through the one field movie adapter. A row whose stream is not
// shipped yet (MOVIEE01/MOVIEE02 are not in assets/movie/) ends through the
// adapter's browser-safety abort — logged, not fatal — and the chain still
// resolves the row's return selector, so the win is never stranded; adding the
// mp4s to the manifest makes the same code play them. The ordinary win's cue
// (0x1400) never enters here: the battle only calls this for the 0xE0B cue.
const ENDING_CHAIN_MAX_STEPS = 4;
async function playEndingChain(launchCode) {
    let selector = launchCode | 0;
    for (let step = 0; step < ENDING_CHAIN_MAX_STEPS; step++) {
        if (movieRow(selector) == null) break;
        await new Promise((resolve) => {
            fieldMovieDone = resolve;
            fieldMovie.open(selector).then((row) => {
                if (!row) { fieldMovieDone = null; resolve(); } // unknown code: never strand
            });
        });
        selector = movieReturnScreen(selector, state.progressOrdinal === 0x2d) ?? 0;
    }
    const routed = screenRouter.route(selector, currentMap().id);
    if (routed?.kind === "warp") {
        startTransition({ to: routed.to, spawnX: null, spawnY: null, dir: "down", scripted: true });
    } else {
        console.warn("[battle] the finale's ending chain did not resolve to a field screen:", selector);
    }
}
battle.setEndingHandoff({
    play: (b) => {
        playEndingChain(b._winLaunchCode ?? FINALE_WIN_ENDING_MOVIE)
            .catch((error) => console.error("[battle] ending chain", error))
            .then(() => battle.finishEnding());
        return true;
    },
});

// Ordinary-play hand-off: when a fight is won, the victory report phase opens
// the native pro/stfgtrep screen instead of the inline report. The screen pays
// the BIT and the dropped item, and its close returns to the field.
const REPORT_CORE = ["str", "def", "spt", "wis", "spd", "chr"];
// (shared with the multiplayer fight: `onClose` is what runs when the player leaves the screen)
function openNativeReport(b, onClose) {
        // `?legacyReport=1`: leave the battle's own inline report in charge.
        if (!USE_NATIVE_REPORT) return false;
        const rows = b._winReportRows ?? [];
        const progress = b._winProgress ?? [];
        const party = Array.isArray(state.party) ? state.party : [];
        const partySlots = rows.map((row) => rosterSlotOfCharId(party[row.index ?? 0]));
        const firstDrop = (b._loot?.drops ?? []).find(Boolean) ?? null;
        const dropItemId = firstDrop ? (ITEM_BY_NAME?.[firstDrop]?.id ?? 0) : 0;
        b._reportPaidItemId = dropItemId;
        fightReportNative.open({
            gameState: state,
            battleId: b.screenId ?? 0,
            dropItemId,
            // The BIT payout reads this partner's worn BIT Adapter (workspace +4).
            activePos: b.activePlayerIndex ?? rows[0]?.index ?? 0,
            partySlots,
            participants: rows.map((row) => {
                const pos = row.index ?? 0;
                const pr = progress.find((p) => p.index === row.index);
                // The partner as it stood BEFORE the battle's rewards were applied
                // (web/battle.js applyParticipantProgress applies them once, ahead of
                // this screen); the screen replays the disc's rules from that snapshot
                // on a private record and never writes EXP/level back.
                const ps = pr?.before ?? b.playerRecords?.[pos]?.statsRecord ?? {};
                // The row flag byte at workspace +6 for this position. A position the
                // outcome knocked out had it cleared (pro/wfightmn.s .L0x00002070),
                // so it goes to the screen unflagged even though it still has a row.
                const participated = paidParticipants(b).includes(row.index);
                return {
                    pos,
                    rosterSlot: (partySlots[pos] ?? 0) >>> 0,
                    preExp: Math.max(0, Number(ps.xp ?? pr?.oldXp ?? row.xp ?? 0)),
                    level: Number(ps.level ?? row.level ?? 1),
                    tp: ps.tp, hp: ps.hp, maxHp: ps.maxHp, mp: ps.mp, maxMp: ps.maxMp,
                    core: ps.stats ? REPORT_CORE.map((k) => (Number(ps.stats[k]) || 0) + (Number(ps.bonuses?.[k]) || 0)) : undefined,
                    equipment: state.equipment?.[pos] ?? {},
                    name: row.name,
                    forms: ps.digimonId != null ? ps : (state.partyStats?.[pos] ?? b.playerRoster?.[pos]?.stats),
                    participated,
                    // Which of the three equipped forms fought: the DVEXP goes to that form.
                    formFlags: [0, 1, 2].map((v) => (participated && pr?.formId != null
                        && ps.equippedForms?.[v] === pr.formId ? 1 : 0)),
                };
            }),
            onClose,
        });
        return fightReportNative.isOpen();
}
battle.setReportHandoff({ open: (b) => openNativeReport(b, () => { battle.finishNativeReport(); }) });

// Gym greeters are no longer a hardcoded map: a greeter is any NPC whose
// dialogue state writes flag bank 0x94, the decoded STGTRAIN launcher bank
// (GYM-Q001 — docs/research/battle/gym-entry-and-rank-chain-2026-07-08.md).
// applyStoryFlag() stashes the index it carries in state.pendingGymGroup, and
// the talk handler offers "Do you want to work out?" for it. That also picks up
// the two Pangamon gyms (s331/s940) the old hardcoded list was missing.
// Inn rest service. Reachable from the field since 2026-08-13: talk to the
// innkeeper (NPC 20, sprite p039tail) on any of the 21 decoded inn maps and its
// dialogue state's bank-0x7A write opens this screen. The inn's name and its
// per-Digimon price come from the map, not from the flag — the resident screen
// class scans D0x8003edcc by current screen id. See engine/dw3/inn.ts.
// The inn runs the translated resident screen (F0x80011dac / F0x800119a8 /
// F0x800110e0, engine InnSession); ?legacyInn=1 keeps the hand-made web/inn.js.
const inn = new URLSearchParams(location.search).has("legacyInn") ? createInn(sfx) : createInnTranslated(sfx);
const debugPanel = createDebugPanel();
// The location title card the field plays on every stage entry — the area name
// and the place name, typed out over sliding bars. See web/placecard.js.
// The card runs the translated fieldstg routines (F0x80087d68 / F0x80087974 /
// F0x800875ac / F0x80087704 / F0x80087854, engine PlaceCardSession) with the
// disc's name banks for every language; ?legacyPlaceCard=1 keeps web/placecard.js.
const USE_LEGACY_PLACE_CARD = new URLSearchParams(location.search).has("legacyPlaceCard");
const placeCard = USE_LEGACY_PLACE_CARD ? createPlaceCard() : createPlaceCardTranslated();
// Native stagslct (gate/area-travel) menu — see web/stagslct.js header for the
// decode. The real in-game trigger for this screen is unresolved (open gap in
// docs/research/ui/stagslct-decoded-2026-07-11.md), so it is reachable only
// through this walker-authored debug entry point, not a claimed original one.
const stagslctMenu = createStagslctMenu();
const cntyselMenu = createCntyselMenu(sfx);   // SYSTEM07 cursor / SYSTEM08 confirm
// Fully translated language screen; the adapter retains its historical name.
// `?legacyCntysel=1` keeps the earlier authored screen for comparison.
// Input contract: engine/dw3/ui/native/country-select-tick.ts (Start / `i`).
const USE_NATIVE_CNTYSEL = !GYM_PARAMS.has("legacyCntysel");
const cntyselNative = createCntyselNative(sfx, bgm);
// Story scene-skipper (dev): jump to any master-ordinal beat. All mutation routes through
// the same game functions a real play uses, so jumps reproduce on-screen behaviour faithfully.
const sceneSkip = createSceneSkip({
    setOrdinal: (n) => {
        state.progressOrdinal = n;
    },
    getOrdinal: () => state.progressOrdinal,
    clearFlag: (id) => {
        try {
            if (engine) engine.state.flags.set(id, false);
        } catch {
            /* virtual bank — skip */
        }
    },
    warpToStage: (stageId) => {
        const idx = state.manifest.maps.findIndex((m) => m.id === stageId);
        if (idx >= 0) loadAndSetMap(idx);
    },
    fireStageEnter: (stageId) => checkStageCutscene(stageId),
    talk: (npcId) => !!(engineBridge && engineBridge.onTalk(npcId)),
});
window.__sceneSkip = sceneSkip;
window.__textbox = textbox;
window.__legacyTextbox = legacyTextbox; // checks: which box holds the line
window.__menu = menu;
window.__status = status;
window.__cardAlbum = cardAlbum;
window.__cardAlbumNative = cardAlbumNative; // native album (pro/stcrdabm)
window.__cardAlbumLegacy = cardAlbumLegacy; // development rollback (web/cardalbum.js)
window.__cardDeckNative = cardDeckNative; // native folder editor (pro/stcrddek)
window.__cardDeckLegacy = cardDeckLegacy; // development rollback (web/carddeck.js)
window.__cardShop = cardShop;
window.__cardShopTranslated = cardShopTranslated;
window.__cardShopNative = cardShopNative; // native card shop (pro/stcrdshp)
window.__cardShopLegacy = cardShopLegacy; // development rollback (web/cardshop.js)
window.__cardDuelNative = cardDuelNative; // native card duel (pro/cardgame)
window.__nameEntryNative = nameEntryNative; // native naming screen (pro/stdgname)
window.__cntyselNative = cntyselNative; // native boot country/language screen (pro/cnty_sel)
window.__cntyselMenu = cntyselMenu; // the hand-authored rollback screen (?legacyCntysel=1)
window.__packSelectNative = packSelectNative; // native starter-pack wizard (pro/stplnmet)
window.__cardDuelLegacy = cardDuelLegacy; // development rollback (web/cardduel.js)
window.__nativeScreenRead = nativeScreenRead; // focused-check RAM probe for native screens
window.__nativeScreenWrite = nativeScreenWrite; // focused-check prerequisite seeding (the lab exposes the same pair)
window.__nativeScreenObjects = nativeScreenObjects; // focused-check object list
window.__nativeTextWidgets = nativeTextWidgets; // focused-check drawn-text dump for native screens
window.__nativeScreenTextDump = () => nativeTextWidgets().map((w) => ({
    ...w, decoded: w.lines.map((l) => decodeNativeText(l.bytes ?? [])),
}));
window.__cardDeck = cardDeck;
window.__cards = cards;
// The story-flag WRITE path, for headless verification of grants that normally
// only fire when a dialogue box closes. (The read side is already exposed as
// `window.__storyFlags` further down, next to the store itself.)
window.__applyStoryFlag = (id, expected) => applyStoryFlag(id, expected);
window.__shop = shop;
window.__shopTranslated = shopTranslated; // direct handle for browser-owned shop checks
window.__reportNative = fightReportNative; // native results screen (pro/stfgtrep)
window.__reportLegacy = fightReportLegacy; // development rollback (web/fightreport.js)
window.__saveNative = saveScreenNative; // native save/load screen (pro/stgmcard)
window.__saveLegacy = saveScreenLegacy; // development rollback (web/save.js)
window.__gymLegacy = gymLegacy; // development rollback module (web/gym.js)
window.__dri = driMenu;
window.__driLegacy = driLegacy;
window.__battle = battle;
window.__gym = gym;
window.__inn = inn;
window.__debug = debugPanel; // partner debug editor (toggle with `~`)
// Expose item tables for battle.js (drop system + in-battle item use)
window.__ITEM_BY_ID = ITEM_BY_ID;
window.__ITEM_BY_NAME = ITEM_BY_NAME;

const editor = createEditor(canvas, () => ({
    grid: state.collision[currentMap().id],
    mapId: currentMap().id,
    camX: lastCam.x,
    camY: lastCam.y,
    zoom: ZOOM,
}));

const sceneEd = createSceneEditor(canvas, () => ({
    scene: state.scenes[currentMap().id],
    mapId: currentMap().id,
    camX: lastCam.x,
    camY: lastCam.y,
    zoom: ZOOM,
}));
window.__sceneEd = sceneEd;

const state = {
    manifest: null,
    charImgs: {},
    clipImgs: {},
    mapImgs: {},
    mapFgImgs: {}, // stageId -> Image ("_fg" walk-behind overlay; see map_overlays.json)
    // The map's own tile layers, kept SEPARATE for the ~28 stages that also draw
    // a thing between them (a prop at bucket 8/10, or a party whose step program
    // put its leader behind the ground). The disc emits each map-tile layer into
    // its own ordering-table slot — layer 2 into OT[11] (MAP_LAYER2_BUCKET), the
    // ground into OT[7] (MAP_GROUND_BUCKET) — so a bucket-8 actor lands between
    // them (pro/fieldstg.s L4234-4236; the actor's own word rides the same slot
    // at file 0xC8B4). One flattened map image cannot be both behind and in front
    // of the same prop, so for those stages the renderer emits the two layers
    // itself, split at the stage's layer-2-only pixels (map_layer2_runs.json,
    // TRACKED). mapGroundImgs = the ground layer (OT[7]); mapLayer2Imgs = the
    // layer-2 layer (OT[11]); both are built from the base map at load.
    mapGroundImgs: {}, // stageId -> canvas: the ground layer (base minus layer-2-only runs)
    mapLayer2Imgs: {}, // stageId -> canvas: the layer-2 layer (base kept only on those runs)
    mapOverlays: null, // {stageId: true} index of stages that have a foreground overlay
    mapGroundIndex: null, // {stageId: true} index of stages that ship a layer-2 split
    mapLayer2: null, // {stageId: [[x0,x1,y], …]} the layer-2-only pixels (map_layer2_runs.json)
    npcImgs: {},
    collision: {},
    scenes: {},
    dialogues: {},
    events: {},
    wstag: {},
    flags: JSON.parse(localStorage.getItem("flags") ?? "{}"),
    // Master story-progress ordinal [0x8004b370] (field-script-engine §WS4.6): drives the
    // bank-0x60/0x70 virtual flag predicates. The engine owns it ($story.ordinal); state
    // exposes it via a defineProperty getter/setter below (single source of truth).
    ordinalByStage: {}, // {stageNum: [ordinals...]} from progress_ordinal.json (a stage may
    // be revisited at several beats, so this is the FULL list per stage)
    allOrdinals: [], // sorted set of every ladder ordinal (for the linear-step advance)
    rosterPredTable: {}, // {key: record} from roster_predicate_table.json (bank-0x70)
    // The s260 Cargo Tower auction's lot table + scripts
    // (assets/data/auction_lots.json, tools/extract_s260_auction.py). null until
    // loaded; a missing file leaves the tower exactly as it was (no auction).
    auction: null,
    charIdx: 0, // LEAD partner index; 0 = no partner (until s212 download); restored after manifest loads
    charId: localStorage.getItem("charId") ?? null, // persisted lead character id
    // The full field party (all Starter-Pack members, lead first). charIdx mirrors party[0].
    party: JSON.parse(localStorage.getItem("party") ?? "null"),
    // Pack roster selected in the real-world lobby but not owned/visible until
    // the s212 Tamer Service download cutscene completes.
    pendingParty: JSON.parse(localStorage.getItem("pendingParty") ?? "null"),
    packId: localStorage.getItem("packId") ?? null, // "A"|"B"|"C" — gates the s212 download variant
    // Play clock shown on the memory-card file record (h/m/s at record
    // +0x28/+0x2A/+0x2C); accumulated in update() and persisted with the save.
    playSeconds: Number(localStorage.getItem("playSeconds")) || 0,
    mapIdx: 0,
    // state.chapter is DERIVED from the story-flag store (see defineProperty below).
    // _chapterOverride is a debug-only manual override (HUD selector / __setChapter);
    // null = derive. Persisted separately so it never masquerades as story truth.
    _chapterOverride:
        localStorage.getItem("chapterOverride") != null
            ? Number(localStorage.getItem("chapterOverride"))
            : null,
    chapterTable: null, // loaded from assets/data/chapter_progression.json
    inventory: JSON.parse(localStorage.getItem("inventory") ?? "[]"),
    // The SECOND count array: how many of each item are WORN
    // (D0x80048D34 + 0x20F + id). The two "Equip n" figures read this byte, and
    // only the store's four wear paths move it. A save written before the array
    // existed has no key, so it is rebuilt from the wearer record below — the
    // invariant the original's four writers keep, so this is the same number.
    worn: JSON.parse(localStorage.getItem("worn") ?? "null"),
    // Backing store for the `bits` accessor defined below: once the engine exists the
    // wallet lives in its `$party.bit` var, so a bank-0x70 money grant and a shop purchase
    // move the SAME number. Seeded from localStorage for the pre-engine frames.
    _bits: Number(localStorage.getItem("bits") ?? "500"),
    // Backing store for the `rosterOwned` accessor below (the obtained-partner set).
    _rosterOwned: Number(localStorage.getItem("rosterOwned") ?? "0"),
    // Stats and equipment of the partners you own but have not deployed, keyed by
    // manifest character id, so a Digimon you switch out keeps its level and gear.
    reserveStats: JSON.parse(localStorage.getItem("reserveStats") ?? "{}"),
    reserveEquipment: JSON.parse(localStorage.getItem("reserveEquipment") ?? "{}"),
    partnerStats: JSON.parse(
        localStorage.getItem("partnerStats") ?? "null",
    ) ?? { hp: 500, maxHp: 500, mp: 100, maxMp: 100, level: 1 },
    // Static stat blocks for the non-lead field-party members (index-aligned with
    // state.party; index 0 is unused — the lead's live stats are partnerStats).
    // They don't fight in the current engine, so they stay at their recruited base
    // stats until the status menu (or a future formation-swap) needs them.
    partyStats: JSON.parse(localStorage.getItem("partyStats") ?? "null"),
    // state.equipment[partyIdx] = { head?, body?, right?, left?, acc0?, acc1? } (ItemIds).
    // Real weapon/armor/accessory system — see engine/dw3/equipment.ts.
    equipment: JSON.parse(localStorage.getItem("equipment") ?? "[]"),
    // Player-given partner names, keyed by manifest char id (Baronmon's Change
    // Account desk, launcher bank 0x7c index 1). Species name when absent.
    digimonNames: JSON.parse(localStorage.getItem("digimonNames") ?? "{}"),
    menuOpen: false,
    started: false,
    playerName: localStorage.getItem("playerName") || "Junior",
    x: 0,
    y: 0,
    dir: "down",
    moving: false,
    stopping: false,
    stopTime: 0,
    // Digi-Egg traversal: the section map (screen -> step opcode), built once
    // after the scenes load, and the form for the CURRENT screen (null on the
    // surface). See engine/systems/dive-form.ts.
    diveNetwork: null,
    diveForm: null,
    diveFormMarkers: null,
    // The stage's whole cast list (descriptor+0x4C), decoded by
    // tools/extract_cast_lists.py. This is the ONE list the cast rebuild reads:
    // the player (loop A) and every other actor (loop B) come from it.
    stageCastLists: null,
    stageDefaultSpawn: null,
    // The dive TRANSITION presentation currently playing, or null. Owns the
    // screen from the Digi-Egg cue until the ordinary stage wipe takes over —
    // see engine/systems/dive-demo.ts and web/dive-demo.js.
    diveDemo: null,
    // The ordinary stage-change wipe's frame counter (web/stage-wipe.js). Always
    // stepped; only read when the translated wipe is the one drawing.
    wipe: createWipeClock(),
    // Launch-pad controller state (op-13 step records: the Ice Dungeon s735/s736
    // pads and s800's pair). Non-null while the F0x8008c130 sequence runs — the
    // scene lock is up, so input and followers are suspended.
    // See engine/systems/launch-pad.ts.
    launch: null,
    // The op-14 pad handoff's hold — the type-7 scene object's `+0x68` countdown
    // (0x8008B6D4's sixth argument, spent by the phase-2 handler before it loads
    // the destination). `{ ticks, exit }`; null when no handoff is pending.
    // See startPadHandoff() and engine/systems/scene-step-ops.ts.
    handoffHold: null,
    // The op-4 slope step's controller (the player actor's +0x11c action, mode
    // 0x47). Non-null while the character is walking itself off the tile and
    // sliding down — the climb lock at [0x80099DE0] is up, so input and followers
    // are suspended. See engine/systems/step-actor-actions.ts.
    slope: null,
    // The special block actors' interaction (npc 328/351/352): the live
    // engagement, `{ ix, npc }`, or null. The field lock [0x80099de0] is up
    // while `ix.busy` (the player's 36-blank drill clip). See
    // engine/systems/block-actor.ts.
    blockEngage: null,
    // Submarimon's {heightFixed, velocityFixed} (char+0x64 / char+0xc4), or null
    // for any actor that has the DEFAULT tick handler — Junior and Digmon never
    // run 0x8008e45c, so they are not "height 0", they have no height state at
    // all. Rebuilt from the screen's form on every map load.
    submarimon: null,
    animTime: 0,
    keys: new Set(),
    // Random-encounter step counter, decoded from fieldstg (ENCOUNTER-Q001):
    // `_encTick` mirrors the player actor's free-running tick (+0x18) — the driver
    // runs on every 8th tick OF MOVEMENT — and `_encCounter` is the engine's
    // [0x80048d64] countdown, reset to rand()%0x900 folded into 0..1279.
    _encTick: 0,
    _encCounter: resetEncounterCounter(() => Math.floor(Math.random() * 0x10000)),
};

// The saved worn array is the wearer record's own multiset, so a save that
// predates it (or one whose equipment was edited outside the store) is repaired
// here rather than showing "Equip 0" beside gear somebody is wearing. On any save
// the four wear paths kept in step this recomputes the same bytes.
syncWornFromEquipment(state);
bindCardInventory(state);

// Decoded field assets are intentionally bounded to the current stage and its
// direct exits. Browser HTTP caching still makes revisits cheap, while dropping
// these references lets decoded HD textures and collision grids be reclaimed.
const retainedStageIds = new Set();
const readyStageIds = new Set();
const stageLoadPromises = new Map();
const mapLoadPromises = new Map();
const collisionLoadPromises = new Map();
const spriteLoadPromises = new Map();
const retainedSpriteIds = new Set();
let knownStageIds = [];
let manifestSprites = new Map();
let locationSaveTimer = null;
// Field party Digimon follow the tamer in a conga line via a shared position-history
// ring buffer. followers[0] = the LEAD (= `partner`, the battle-active one);
// followers[1..] = the other pack members. Each
// samples the history at an increasing lag (lead closest).
const partner = { x: 0, y: 0, dir: "down", animTime: 0, stopping: false, stopTime: 0 };
const MAX_FOLLOWERS = 3;
const followers = [
    partner,
    { x: 0, y: 0, dir: "down", animTime: 0, stopping: false, stopTime: 0 },
    { x: 0, y: 0, dir: "down", animTime: 0, stopping: false, stopTime: 0 },
];
const partnerHistory = [];
let fieldTickAccumulator = 0;

// How many downloaded Digimon trail the tamer right now. `charIdx` alone is
// never ownership; only the s212 download populates state.party.
function activeFollowerCount() {
    // No party trail in a Digi-Egg section: the native cast rebuild's follower
    // loop applies the SAME [0x146,0x148) window test as the player scan and
    // SKIPS those ids (fieldstg 0x83fc-0x8408), so no field-party actor is
    // constructed for a screen whose player form is Submarimon or Digmon.
    if (state.diveForm) return 0;
    return fieldPartySize(state.party, MAX_FOLLOWERS);
}
// The manifest character record a follower renders with (party member, else the lead).
function followerChar(i) {
    const id =
        Array.isArray(state.party) && state.party[i] != null
            ? state.party[i]
            : null;
    const idx = id != null ? manifestIndexOf(id) : state.charIdx;
    return idx >= 0 ? state.manifest.characters[idx] : null;
}
// Snap every follower onto the player and clear the trail (map load / cutscene end).
function resetFollowers() {
    for (const f of followers) {
        f.x = state.x;
        f.y = state.y;
        f.parked = false;
        f.gathering = false;
        f.animTime = 0;
        f.stopping = false;
        f.stopTime = 0;
    }
    partnerHistory.splice(
        0,
        partnerHistory.length,
        ...seedFollowerHistory({ x: state.x, y: state.y, dir: state.dir }),
    );
    fieldTickAccumulator = 0;
    state.stopping = false;
    state.stopTime = 0;
}

// After a party gather (story `SETANIM 813 823`) the followers' rings are all zero
// records: at script END, 0x80084ecc state 3 reinstalls the follower hook 0x8008eae8
// through resetHook 0x8008f004, but each follower keeps reading parked records until
// the player has moved its 9/18/27 ticks. Parked records carry `parked`, so the copy
// in the movement tick parks the follower until a real point reaches it.
function parkGatheredFollowers() {
    resetFollowers();
    for (const p of partnerHistory) p.parked = true;
    for (const f of followers) f.parked = true;
}

window.__pos = () => [Math.round(state.x), Math.round(state.y)];
// The live field character's own world-Y word in 16.8, which is what three stage
// objects drive (docs/research/field/stage-object-registry-2026-10-04.md
// section 19).  `y` is the fixed-point displacement, `pixels` the `+0x5c` the
// camera uses and `pending` the whole pixels not yet folded into state.y.
window.__fieldChar = fieldCharState;
// Seam lab (web/seam-lab.html) debug hooks. A seam is a place where the frame's
// clear colour shows THROUGH the picture, so the lab repaints the clear colour
// and diffs two frames to find one exactly, instead of guessing from black art.
// `__hideProps` drops the sprites that fill the stitched map's cut-outs, which
// says whether a hole belongs to the map or to the sprite meant to plug it.
window.__cam = lastCam;
// Park the view anywhere WITHOUT walking the player there: stepping the player
// across a stage to inspect it trips NPC talk and auto events, which then paint
// a dialogue box over the very pixels being measured. Pass null to release.
window.__labCam = (x, y) => {
    labCam.active = x !== null;
    if (labCam.active) { labCam.x = x; labCam.y = y; }
};
window.__mapInfo = () => {
    const m = currentMap();
    return { id: m.id, width: m.width, height: m.height, zoom: ZOOM, viewW: VIEW_W, viewH: VIEW_H };
};
window.__teleport = (x, y) => {
    state.x = x;
    state.y = y;
};
window.__state = state;
bindCardShopInventory(state).catch((error) => console.error("Card pack inventory data failed", error));

// The language index the original keeps at D0x8005CCA8, and the one the pad
// poll reads to decide its face-button layout: with it non-zero a physical Cross
// is the confirm button and a physical Triangle goes back
// (engine/systems/input-map.ts `padWordButton`, claim
// `pad-poll-swaps-face-buttons-when-language-is-not-zero-2026-10-03`). The boot
// screen's choice arrives as a plain write to `state.languageByte` — from the
// language screen, from `?language=N`, and from the lab and the verifiers — so
// the write itself is what pushes the index into the pad map. Reading it still
// yields `undefined` until something picks a language, exactly as before.
let languageByte;
Object.defineProperty(state, "languageByte", {
    get: () => languageByte,
    set: (value) => {
        languageByte = value;
        setPadLanguage(value);
    },
    enumerable: true,
    configurable: true,
});
window.__followers = followers; // party positions, for draw-order checks in the lab
window.__choice = choice;
window.__assetLocality = () => ({
    retainedStages: [...retainedStageIds],
    readyStages: [...readyStageIds],
    retainedSprites: [...retainedSpriteIds],
});
// Debug-only: lets a headless verifier drop the player onto a screen and read
// the follower count, to check the Digi-Egg form swap without walking there.
window.__setMap = (i, spawn = null) => loadAndSetMap(i, spawn);
window.__activeFollowerCount = () => activeFollowerCount();
// Debug-only: what a Space press would talk to from where the player stands.
// Lets a headless verifier (tools/verify_inn.mjs) prove it is addressing the
// intended NPC instead of inferring it from whatever box happened to open.
window.__talkTarget = () => {
    const scene = state.scenes[currentMap()?.id];
    if (!scene) return null;
    const cast = sceneCast(scene);
    const visible = cast.filter((n) => !n.cutsceneOnly);
    const npc = nearestFacingNpc(talkCandidates(visible), state.x, state.y, state.dir, 48);
    // The same target rules the live press applies (F0x8008E2CC): refuse ids and the
    // id-redirect table (over the whole built cast, as the disc's find_entity is), so a
    // verifier sees the NPC the press would actually address.
    const resolved = npc ? resolveConfirmTarget(cast, npc) : null;
    if (!resolved) return { npc: null, visible: visible.length };
    return {
        npc: resolved.npc_id, sprite: resolved.sprite, x: resolved.x, y: resolved.y,
        state: pickDialogueFor(resolved, state.flags),
        visible: visible.length,
    };
};
// Debug-only: the live special-block interaction (engine/systems/block-actor.ts)
// and the last one that finished, so a headless verifier reads the decoded tick
// sequence and its landmarks (action 20 / control 36 / gone 41) instead of
// guessing them from pixels.
let lastBlockIx = null;
window.__blockActors = () => {
    const shape = (ix) => ix && ({
        targetId: ix.targetId, bit: ix.bit, busy: ix.busy, ticks: ix.ticks,
        engagerSub: ix.engagerSub, engagerLeft: ix.engagerLeft,
        targetSub: ix.targetSub, targetTimer: ix.targetTimer, targetLeft: ix.targetLeft,
        actionTick: ix.actionTick, engagerDoneTick: ix.engagerDoneTick, goneTick: ix.goneTick,
    });
    const be = state.blockEngage;
    return {
        live: shape(be?.ix ?? null),
        last: shape(lastBlockIx),
        npcActiveClip: be?.npc?.activeClip ?? null,
    };
};
// Debug-only: A/B the launch-pad layer (tools/verify_launch_pad.mjs).
window.__launchPads = { setEnabled: setLaunchPadsEnabled, list: launchPads, debug: launchPadDebug };
// The stage overlays' own ported actors (the s415 rockfall). The bounce plays
// through the same packed-sound sink every other field cue uses.
setStageObjectSound((word) => sfx.playPacked(word, { overlap: true }));
// The same sink for a stage overlay's own decor actor (engine/systems/point-record-actor.ts).
setPointRecordActorSound((word) => sfx.playPacked(word, { overlap: true }));
// The pad flashes' cues are music stems (env205 digi_en0..2, env011 login_dl),
// not samples: the actor plays them at its own fire and this sink maps the
// packed word through the same PACKED_JINGLES table into the jingle player.
setPointRecordActorMusic((word) => {
    const stem = PACKED_JINGLES[`0x${(word >>> 0).toString(16).padStart(8, "0")}`];
    if (stem) bgm?.playJingle?.(stem);
});
// The master story ordinal. The s780 overlay only builds its traffic-light
// corner in the ordinal-0x1B arm of its street entry, and the walker's flag
// 0x601B (bank 0x60 bit 27) is that same beat, so the port reads the number the
// story engine already holds rather than a second trigger of its own.
setStageObjectOrdinal(() => Number(state.progressOrdinal ?? 0) || 0);
// The same number for the point-record stage objects, which the effects module
// needs because the two `triple` parents are built at stage load only below
// their own ordinal bound. One source, handed over twice.
setPointRecordOrdinal(() => Number(state.progressOrdinal ?? 0) || 0);
// The stage's own story flags for the point-record stage objects: the s415
// Deeper Crevice scenery layer reads flag 0x4018 once, at construction, to pick
// the first-visit (slides) or revisit (still) branch -- the same store every
// other gate in the walker reads.  The closure is lazy, so naming `storyFlags`
// here (declared below) is safe: it is only read when a stage builds the layer.
setPointRecordFlag((id) => Number(storyFlags.get(id) ?? 0) || 0);
// The character anchor of the `picture-steps` stage object (s785's 0x327):
// the overlay's own `find(5, operand, -1)`, where the operand is the script's
// own and the `+0x4` field the find matches is the actor's id -- so the
// operand names an `npc_id`. The live cast is the scene's own npc list, the
// same objects the cutscene moves and the draw loop reads, exactly as the
// original reads the stored object's `+0x50`/`+0x54` at draw time; `>> 8`
// there is a floor of the 16.8 world coordinate, so the pixel handed over is a
// floor too.
setPointRecordAnchor(
    (stageId, type, p1) => {
        if (type !== 5) return null;
        const scene = state.scenes[stageId];
        if (!scene) return null;
        return (
            sceneCast(scene)
                .find((n) => n.npc_id === p1) ?? null
        );
    },
    (npc) => (npc ? { x: Math.floor(npc.x), y: Math.floor(npc.y) } : null),
);
// Debug-only: what the translated stage actors are doing right now, so a
// headless verifier can read the rock's own state and its draw entries.
window.__stageObjects = {
    state: (mapId) => stageObjectState(mapId ?? currentMap().id),
    draws: (mapId) => stageObjectDraws(mapId ?? currentMap().id),
    screens: (mapId) => streetScreenQuads(mapId ?? currentMap().id),
    glows: (mapId) => streetGlowProbe(mapId ?? currentMap().id),
    stinger: (mapId) => stingerPopupProbe(mapId ?? currentMap().id),
    // The two stage users of the resident 2D draw-context service (s805 0x349
    // and s820 0x34d): this blank's SHAPE REQUESTS, in the order the service's
    // flush hands them over. Nothing draws them yet -- the shapes' texels live
    // in a pack member this repository has not extracted
    // (docs/research/field/draw-context-service-2026-10-04.md section 5.5).
    annotator: (mapId) => annotatorMarkers(mapId ?? currentMap().id),
    annotatorActive: (mapId) => annotatorActive(mapId ?? currentMap().id),
    // The s415 Deeper Crevice SCENERY LAYER's live position this blank, so a
    // verifier can read the slide's per-frame geometry without pixels.
    scrollLayers: (mapId) => scrollLayerEntries(mapId ?? currentMap().id),
    fire: (id, sub, mapId) => fireStageObject(mapId ?? currentMap().id, id, sub ?? id),
    // The same route a cutscene SETANIM takes, with the second operand, so a
    // verifier can fire the stage overlays' own point-record actors
    // (engine/systems/point-record-actor.ts) the way their scripts do.
    fireSub: (id, sub, mapId) => fireStageObject(mapId ?? currentMap().id, id, sub),
    // Rockfall oracle only: run the same id through the MIPS interpreter so a
    // verifier can compare the original machine code's frames with the port's.
    nativeFire: (id, mapId) => fireNativeStageObject(mapId ?? currentMap().id, id),
    clear: (mapId) => clearStageObjects(mapId),
};
// Debug-only: the stage overlays' own point-record actors and the point
// records they drive, so tools/verify_point_record_actors.mjs can read the
// frames each one put there without a research flag.
window.__pointRecordActors = {
    state: (mapId) => pointRecordActors(mapId ?? currentMap().id),
    records: (mapId) => pointSpriteProbe(mapId ?? currentMap().id),
};
// Debug-only: how many footstep cues the player's move handler has fired. A
// verifier reads this to prove a scripted NPC walk is silent (only the player
// makes the step sound).
window.__footstepCount = () => footstepCount;
// Debug-only: the field's stage-ambience execution mode. `execution` is
// "translated" on the ordinary route -- the overlay runs only under the
// explicit ?nativeStages research switch -- so tools/verify_translated_field_
// ambience.mjs can refuse any other mark with no flag set.
window.__stageAmbience = {
    execution: STAGE_AMBIENCE_EXECUTION,
    diagnostics: (mapId) => stageAmbienceDiagnostics(mapId ?? currentMap().id),
};
// Debug-only: lets a headless verifier read the encounter selection for a map
// without walking the player there, to check the entry-key wiring end to end.
window.__encounter = {
    ready: () => battle.loadData(),
    rateLevel: (mapId, x, y) => battle.encounterRateLevel(mapId, x, y),
    pick: (mapId, x, y) => battle.pickEnemy(mapId, x, y),
};
// Debug-only: drive the ordinary field->battle handoff (the step counter's own
// function) from a verifier without walking the counter down.
window.__fieldToBattle = () => triggerRandomEncounter(currentMap().id, state.x, state.y);
// Debug-only: read the A28 checkerboard wipe's live state for a capture.
window.__wipe28 = () =>
    state.wipe28
        ? { done: state.wipe28.done, index: state.wipe28.index, calls: state.wipe28.calls, quads: checkerboardQuads(state.wipe28).length }
        : null;
// Debug-only: lets a headless verifier arm the type-0x16 actor's flare on the
// same clock the renderer reads (see tools/verify_party_indicator.mjs).
window.__armSparkle = (program = 3) => {
    state.sparkleActor = { program, start: fieldcomTick() };
};

// ── UI Lab hooks (web/ui-lab.html) ──────────────────────────────────────────
// Open any player-facing screen on demand so the lab can render each one from
// the real game modules. `__labClose` force-dismisses whatever is up.
//
// ORDER 2026-10-04. The conversation box goes FIRST, then the screens. The box's
// close callback is the innkeeper's bank-0x7A launcher (web/game.js:5555), so
// closing the box is what RAISES the rest screen — and the list below did not
// contain the inn at all. `__labOpen("save")` therefore tore the box down, the
// teardown opened a rest screen, and that screen stayed alive under the memory
// card while the card drove its own confirms into it. Dismiss the box first, then
// every screen including the inn, and the lab leaves nothing behind.
//
// The PAUSE list belongs in that list too, and until 2026-10-04 it was not
// there: `__labClose` set `state.menuOpen = false`, which is the rollback
// route's flag, but the pause the field's START raises is the translated
// screen's own `_open` (web/status-translated.js), and `status.close()` is
// what puts that down. So opening any screen after the lab's Status Menu left
// the list standing on top of it — which is how
// tools/verify_scrolling_walls.mjs came to read the memory card's wall as
// frozen: the pause list's opaque party cards and menu box were drawn over the
// card screen for every sample.
window.__labClose = () => {
    hideAssetModeChooser();
    state.nameEntry = null;
    state.packSelect = null;
    state.endScreen?.cancel?.();
    state.endScreen = null;
    state.titleScreen = null;
    state.menuOpen = false;
    if (textbox?.isOpen?.()) textbox.close?.();
    if (dialogueBox.isOpen()) dialogueBox.close();
    if (status?.isOpen?.()) status.close?.();
    for (const ui of [shop, driMenu, gym, cardShop, cardAlbum, cardDeck, cardDuel, saveScreen, fightReport, inn, cntyselMenu, cntyselNative]) {
        if (ui?.isOpen?.()) { if (ui.close) ui.close(); else ui._open = false; }
    }
};
window.__labOpen = (name, arg) => {
    window.__labClose();
    // skipTitle boots a new game, so the field has no downloaded party.
    // Screens that draw partner cards need one or they render empty, and the
    // naming screen refuses to open at all without one ("Naming has no partner
    // with a roster slot", web/nameentry-translated.js:96), which is why its
    // wall had no lab route to be measured from.
    const NEEDS_PARTY = new Set(["menu", "demosetup", "dri", "gym", "shop", "inn", "nameentry"]);
    if (NEEDS_PARTY.has(name) && !state.party?.length) {
        state.party = ["p003pken", "p009rena", "p010pata"];
        state.packId = "A";
        state.charId = "p003pken";
        const block = (digimonId, hp, mp) => ({
            digimonId, level: 1, xp: 0, tp: 0,
            hp, maxHp: hp, mp, maxMp: mp,
            bonuses: {}, elemBonuses: {},
        });
        state.partnerStats = block(1, 86, 38);
        state.partyStats = [state.partnerStats, block(7, 80, 40), block(8, 90, 55)];
    }
    switch (name) {
        case "assetmode":
            showAssetModeChooser({ allowClose: true });
            break;
        case "nameentry":
            state.nameEntry = openNameEntry({ initial: "Jun" });
            state.nameEntryDone = () => { state.nameEntry = null; };
            break;
        case "packselect":
            state.packSelect = openPackSelect();
            state.packSelectDone = () => { state.packSelect = null; };
            break;
        // The END card. Language 2 is the `eng` pack the walker ships, which
        // takes clip 0, "END".
        case "endscreen":
            state.endScreenDone = () => { state.endScreen = null; };
            if (USE_LEGACY_END) {
                state.endScreen = createEndScreen();
            } else {
                // The card's last callback asks for the first opening movie, which the walker
                // does not ship; the lab closes the screen as it always has.
                endCard.open(() => {
                    const onDone = state.endScreenDone;
                    state.endScreen = null;
                    state.endScreenDone = null;
                    onDone?.();
                });
                state.endScreen = endCard;
            }
            window.__labEnd = state.endScreen;
            break;
        // The native title screen. In the game it renders into its own HTML
        // canvas before the world exists; the lab draws the same module onto
        // the game canvas so it can be inspected like every other screen.
        case "titlescreen":
            state.titleScreen = createTitleScreen({ language: state.languageByte ?? 2 });
            state.titleScreenDone = () => { state.titleScreen = null; };
            window.__labTitle = state.titleScreen;
            break;
        // The translated conversation box. The reference line is the esdmg400 entry 4, SAY p1 = 4 cutscene
        // "[player_name]: What the...? Is that a Digimon?!" (raw disc bytes; the name goes in through
        // 0x80048d88). The anchor is the speaker's screen position.
        case "textbox":
            dialogueBox.open({ esdmg: "esdmg400", entry: 4, index: 4 },
                { kind: "say", plain: false, balloonMode: 0, actor: { x: 221, y: 110, actorId: 1 } },
                null, undefined, { playerNameBytes: encodeNativeScreenText(state.playerName || "Junior") });
            break;
        case "textbox_plain":
            dialogueBox.open({ file: "estalk00", index: 11 }, { kind: "say", plain: true, balloonMode: 0, actor: null });
            break;
        case "textbox_legacy":
            textbox.open({ name: "MAGAMI", pages: [[
                "This is a sample dialogue box shown in the UI Lab.",
                "It uses the real textbox renderer and font.",
            ]] }, null);
            break;
        // The lab opens the SAME pause home the field's START does — the one
        // translated list. It used to open web/menu.js's own hand-written copy,
        // which is why the lab and the game could show different rows (2026-10-04).
        case "menu":
            pauseHome();
            break;
        // Deliberately non-authentic: the Digivolve Demo screen exists on the
        // disc but nothing can open it. The lab is a debug surface, so it is
        // always reachable here; in the game it needs the opt-in flag.
        case "demosetup":
            state.menuOpen = true;
            if (menu.openAt) menu.openAt("demosetup"); else menu.reset();
            break;
        case "dri":
            if (USE_NATIVE_DRI) driMenu.open(state, null);
            else driMenu.open(null, null, state);
            break;
        // No greeter on the debug/lab path, so pass the stage and let the decoded
        // gym_ranks.json table pick the rank group it would have launched with.
        case "gym": gym.open(state, null, null, currentMap()?.id); break;
        case "status": status?.open(state, typeof arg === "string" ? arg : "items", null); break;
        case "cardshop": {
            // The lab can ask for any decoded stock set by id (the launcher
            // parameter the merchant's flag carries); 0 stays the fallback.
            const which = arg == null || !Number.isFinite(+arg) ? 0 : +arg;
            cardShop.open(state, null, openCardShopFolder, which);
            break;
        }
        case "cardalbum": cardAlbum.open(state); break;
        // The folder editor's correctness is about STATE (which slot, which
        // folder, what the swap did), so the lab exposes the screen and the
        // collection for headless capture to read.
        case "carddeck":
            window.__labDeck = cardDeck;
            window.__cards = cards;
            window.__labCatalog = cardCatalog;
            ensureStarterFolder();
            cardDeck.open(state);
            break;
        // The duel is also the one lab screen whose correctness is about MOTION
        // rather than layout, so the live sprite pool is exposed for headless
        // capture to read positions/scales/states out of mid-animation.
        case "cardduel": {
            // The lab may name the opponent (the ONE-BASED CARD_NPC.BIN record
            // the launcher would carry). With no arg the screen's own default
            // is used, so the walker duel's existing lab behaviour is unchanged.
            const opponent = arg != null && Number.isFinite(+arg) ? +arg : undefined;
            window.__labDuel = cardDuel;
            cardDuel.open(null, "Duelist", null, opponent, state);
            break;
        }
        // Asuka Inn (s235) — the decoded record: 8 BIT per Digimon.
        case "inn": inn.open(state, { map: "s235" }); break;
        case "save": openMemoryCard("save"); break;
        // The card-access transition quad. It has no state in the walker
        // (there is no memory card to check), so the lab is where it can
        // be seen — see stgmcard_ui.json transition.quad.unwired_note.
        case "savequad":
            openMemoryCard("save");
            if (saveScreen.showTransitionQuad) saveScreen.showTransitionQuad(true);
            break;
        case "load": openMemoryCard("load"); break;
        case "shop": {
            // The lab can ask for any decoded shop by index (shops.json order); index 0
            // stays the default. The pawn shop is the one that stocks accessories, whose
            // effect cards are laid out differently from a weapon's (claim EQUIP-C016).
            const which = arg == null || !Number.isFinite(+arg) ? 0 : +arg;
            fetch("assets/data/shops.json").then((r) => r.json()).then((j) => {
                const s0 = j.shops[which] ?? j.shops[0];
                // shops.json rows are {id,name} objects; the shop takes raw ids
                // (same normalize as the in-game zone path at :920). The native
                // shop selects its own stock by shop id.
                shop.open(s0.items.map((i) => i.id ?? i), null, { name: s0.name, state, shopId: which });
            });
            break;
        }
        // The stage-entry location title card. s780 is the opening screen, so
        // this replays exactly what a new game shows you first. The card lives
        // on the field rather than in a screen of its own, so the lab just
        // restarts it over whatever map is loaded.
        case "placecard":
            (USE_LEGACY_PLACE_CARD ? loadPlaceCard() : loadPlaceCardTranslated()).then(() => {
                placeCard.begin("s780");
                window.__labPlaceCard = placeCard;
            });
            break;
        case "fightreport":
            openFightReport({
                // The lab's battle id (arg) picks the native reward-table record
                // the screen pays from; default 5 = 2xNumemon lv27 -> [27,268,645].
                battleId: arg == null ? 5 : (Number(arg) || 0),
                rows: [
                    { index: 0, rookieId: 1, name: "Kotemon", level: 4, xp: 278, forms: [
                        { id: 30, name: "Dinohumon", level: 3 },
                        { id: 31, name: "Greymon", level: 1 },
                    ] },
                    { index: 1, rookieId: 7, name: "Renamon", level: 2, xp: 70, forms: [] },
                    { index: 2, rookieId: 8, name: "Patamon", level: 1, xp: 0, forms: [] },
                ],
                pages: buildFightReportPages({
                    bits: 645,
                    droppedItem: "Medium MP",
                    // A level, a digivolution level and a new digivolution, so
                    // the lab shows the arrow, the marks and both tunes.
                    events: [{
                        index: 0, xp: 268, oldXp: 10, name: "Kotemon",
                        oldLevel: 4, newLevel: 5,
                        formLevels: [{ name: "Dinohumon", level: 3 }],
                        unlocked: [{ name: "Greymon" }],
                    }],
                }),
                adapterByIndex: { 0: true },
                rewardXp: 268,
            });
            window.__labFightReport = fightReportLegacy;
            window.__reportNative = fightReportNative;
            break;
        case "cntysel":
            if (USE_NATIVE_CNTYSEL) {
                cntyselNative.open((row, language) => {
                    window.__labLanguage = row;
                    window.__labLanguageByte = language;
                });
                window.__labCntyselNative = cntyselNative;
            } else {
                cntyselMenu.show((row) => {
                    window.__labLanguage = row;
                });
                window.__labCntysel = cntyselMenu;
            }
            break;
    }
};

const DIR8_CS = ["down", "down", "left", "left", "up", "up", "right", "right"];

// Populated in-place by init() once findings load; read by the cutscene opts closure.
const EMOTE_KINDS = {};

// The cast of the CURRENT stage, built ONCE at stage entry.
//
// The disc's spawn loop (fieldstg.s file 0x83dc-0x8498, RAM 0x8008b09c-,
// F0x8009116c) runs when the stage's cast is built — stage load — and the actor
// list it constructs IS the live cast until the stage is left. A flag write during
// the stage does NOT add or remove an actor: the disc removes an actor only through
// the scene's own action (`SETPOS <actor> 0 0` parks it off-map — the Wind Prairie
// hide-and-seek setup does exactly this to Veemon, web/assets/events/wstag_events.json
// s395 event 1299) or the actor's own remove call (the block actors, E10). The scene
// resolver 0x80084d8c matches the live class-5 entity by kind, it never re-reads the
// gate (field-script-engine-verified.md §WS4.9).
//
// The walker used to re-evaluate the gate EVERY FRAME in the draw, the resolver and
// the talk probe. So a talk whose own on_close writes its speaker's spawn flag
// removed him the instant the box closed: Veemon's s395 dialogue state (npc 35 id 735,
// web/assets/data/npc_flag_sets.json:12999) sets 6693=0, his variant-A gate, so he
// vanished before the scene it launched had named him — and the resolver then
// conjured a phantom ephemeral at (-100,-100). Snapshot the built cast here; script
// -spawned (ephemeral) actors join it as the scene conjures them, exactly as the
// disc's `spawnActor` pushes onto scene.npcs.
function sceneCast(sc) {
    if (!sc) return [];
    // The shared rule lives in engine/dw3/npc-manager.ts `stageCast`; this adds the
    // script-spawned (ephemeral) actors the scene conjures onto scene.npcs.
    const built = stageCast(sc, sc.npcs, state.chapter, storyFlags.get);
    const eph = sc.npcs.filter((n) => n._ephemeral);
    if (!eph.length) return built;
    const extra = eph.filter((e) => !built.includes(e));
    return extra.length ? built.concat(extra) : built;
}

const getNpcResolver = (actorId) => {
    // Script actor ids are charIds (resolver 0x80084d8c). The player is charId 2
    // (Junior), or 1 on a stage whose cast list builds P001PLAY; the engine
    // resolves that id itself (cutscene.playerActorId). The other of 1/2 names
    // no entity. Party followers are species + 3, so no script id is a partner.
    if (actorId === cutscene.playerActorId) return state;
    if (actorId === 1 || actorId === 2) return null;
    const scene = state.scenes[currentMap().id];
    if (!scene) return null;
    return (
        sceneCast(scene).find(
            (n) => n.npc_id === actorId,
        ) ?? null
    );
};

// Wrap the textbox handed to the cutscene manager so every SAY it opens is
// anchored per the decoded window rules: speakingActor + speakingMode (the
// script's 4th SAY operand = balloon quadrant; 4/none = plain system window).
// The esdmg bank + entry of the cutscene being played (set by playStoryEvent): SAY line p1 is raw line p1 of the entry
// (raw line 0 is an empty placeholder; the walker string is p1 - 1), the text the original reads from the story bank [0x80099DC8]. The translated box draws
// the disc bytes; ?legacyTextbox=1 (or a failed load) keeps web/textbox.js with the parsed pages.
let cutsceneEsdmgRef = null;
const cutsceneTextbox = {
    isOpen: () => textbox.isOpen(),
    open: (parsed, onClose) => {
        const spk = cutscene.speakingActor;
        const mode = cutscene.speakingMode;
        const line = cutscene.speakingLine;
        // The speaker is the actor the script names, looked up the way the script's own
        // opcodes look actors up (the player for this scene's player id, else the scene's
        // NPC record) — the decoded SAY rule is `speaker = lookup(actor)` (F0x80084D8C).
        // The window comes from the script's 4th SAY operand, NOT from whether a speaker
        // was found: mode 4 is the unanchored bottom window and every other mode needs a
        // speaker, so a balloon-mode SAY whose speaker is not in the room is now skipped by
        // the interpreter itself (cutscene-manager.ts) exactly as the original skips it.
        // Falling back to the plain window here instead hung the scene: the plain window
        // cannot render a line that carries the `02 07 02 09` speaker-name prefix (the
        // balloon build splits that prefix off the line), and every such line stalls the
        // draw run on the prefix's `02 09` token, so its confirm never closes the box.
        const e = spk == null || mode == null ? null : cutscene.entity(spk);
        if (spk != null && mode != null && !e) storyDbg("SAY speaker not found", spk, "line", line, "→ no window");
        const legacy = () =>
            legacyTextbox.open(parsed, onClose, () =>
                // textbox draws post-zoom in screen px — scale world coords up.
                e ? { x: (e.x - lastCam.x) * ZOOM, y: (e.y - lastCam.y) * ZOOM, mode } : null);
        if (!USE_TRANSLATED_TALK || !cutsceneEsdmgRef || line == null) return legacy();
        const project = (x, y) => ({
            sx: (x - lastCam.x) * ZOOM * (320 / VIEW_W),
            sy: (y - lastCam.y) * ZOOM * (240 / VIEW_H),
        });
        const plain = mode == null || mode === 4;
        translatedDialogueText = parsed;
        dialogueBox.open(
            { esdmg: cutsceneEsdmgRef.file, entry: cutsceneEsdmgRef.entry, index: line },
            {
                kind: "say", plain, balloonMode: mode ?? 0,
                actor: plain ? null : { x: Math.round(e.x), y: Math.round(e.y), actorId: spk },
            },
            onClose, project,
            { playerNameBytes: encodeNativeScreenText(state.playerName), onFail: legacy },
        );
    },
};

const cutscene = createCutscene(cutsceneTextbox, () => state, getNpcResolver, {
    // Stages whose cast list builds the player as charId 1 (P001PLAY);
    // tools/extract_player_cast_one.py.
    playerCastOne: () => state.playerCharOne,
    emoteKinds: EMOTE_KINDS,
    movementTerrainCode: (entity) => {
        const grid = state.collision[currentMap().id];
        return grid ? terrainCodeAt(grid, entity.x, entity.y) : 0;
    },
    // SETANIM >= 0x320: the stage's own special objects. A translated actor
    // (the s415 rockfall, web/stage-objects.js) consumes the id first, then the
    // native interpreter route, then the generic emote bubbles — the console's
    // registry order, most specific first.
    fireNativeEffect: (id, anim, facing) => {
        const mapId = currentMap().id;
        if (fireStageObject(mapId, id, anim)) return true;
        return fireNativeEffect(id, anim, facing);
    },
    // `SETANIM 813 <C>` emote-sound route (fieldstg F0x800837EC tail,
    // engine/systems/emote-sounds.ts). C 0x365..0x383 is the stage-event sound
    // table: DEMO_BGM (0x369) and PIYOPIYO (0x37E) are the two ids the field
    // events fire (SETANIM 813 873 / 894). PIYOPIYO is a common-bank phrase, so
    // the shared packed-sound sink plays it; DEMO_BGM is a MUSIC START (common
    // SEP seq 2), which no sample manifest answers, so it is routed to the music
    // player -- its start takes the one exclusive-track register the same way a
    // stage track does. The >0x383 branch ids (0x385/0x386) key a voice off by
    // handle; no shipped event starts the sound they stop, so a stop cue is a
    // no-op here.
    emoteSound: (id, stop) => {
        if (stop) return;
        if (packedIsMusicStart(id)) {
            const stem = PACKED_MUSIC[packedKey(id)];
            if (stem) {
                bgm?.play?.(stem);
                return;
            }
        }
        sfx?.playPacked?.(id, { overlap: true });
    },
    spawnActor: (actorId) => {
        const scene = state.scenes[currentMap().id];
        if (!scene) return null;
        const pid = state.npcSprites[actorId];
        if (!pid) return null;
        const spr =
            state.manifest.npcs?.find((n) => n.id === pid) ??
            state.manifest.characters?.find((c) => c.id === pid);
        if (!spr) return null;
        ensureSpriteAssets(spr.id);
        const e = ephemeralActorRecord(actorId, spr.id);
        scene.npcs.push(e);
        return e;
    },
});
window.__cutscene = cutscene;

/**
 * Open an NPC talk line. estalkNN refs go to the translated box (raw pack, line = index, the NPC's
 * world position, native 0..7 facing, actor id, projector to the 320x240 screen); anything else, or a
 * failed load, uses web/textbox.js with `legacyAnchor`.
 */
function openTalkLine(ref, onClose, npc, legacyAnchor) {
    const legacy = () => textbox.open(getDialogue(ref), onClose, legacyAnchor);
    if (!USE_TRANSLATED_TALK || !npc || !/^estalk0\d$/.test(ref?.file ?? "")) return legacy();
    const project = (x, y) => ({
        sx: (x - lastCam.x) * ZOOM * (320 / VIEW_W),
        sy: (y - lastCam.y) * ZOOM * (240 / VIEW_H),
    });
    translatedDialogueText = getDialogue(ref);
    dialogueBox.open(
        { file: ref.file, index: Number(ref.index) },
        { kind: "talk", npc: { x: Math.round(npc.x), y: Math.round(npc.y), facing: fieldDirectionIndex(npc.dir), actorId: npc.npc_id ?? 0 } },
        onClose,
        project,
        {
            playerNameBytes: encodeNativeScreenText(state.playerName),
            onFail: () => legacyTextbox.open(getDialogue(ref), onClose, legacyAnchor),
        },
    );
}

/**
 * Extra-quest speech: the same translated box an NPC's line uses, with the line built in the disc's own text format
 * (web/dialogue-pack.js). With the NPC on this map it is their balloon, otherwise the plain bottom window. Resolves on close.
 */
function questSpeak(npcId, name, text) {
    return new Promise((resolve) => {
        const pages = paginate(text);
        const scene = state.scenes[currentMap()?.id];
        const npc = npcId != null && scene ? sceneCast(scene).find((n) => n.npc_id === npcId && !n.cutsceneOnly) : null;
        const anchor = npc
            ? (() => {
                const mode = autoBalloonMode(npc.dir, (npc.x - lastCam.x) * ZOOM, (npc.y - lastCam.y) * ZOOM, VIEW_W, VIEW_H);
                return () => ({ x: (npc.x - lastCam.x) * ZOOM, y: (npc.y - lastCam.y) * ZOOM, mode });
            })()
            : null;
        const fallback = () => legacyTextbox.open({ name, pages }, resolve, anchor);
        if (!USE_TRANSLATED_TALK) return fallback();
        const project = (x, y) => ({
            sx: (x - lastCam.x) * ZOOM * (320 / VIEW_W),
            sy: (y - lastCam.y) * ZOOM * (240 / VIEW_H),
        });
        translatedDialogueText = { name, pages };
        const opts = { playerNameBytes: encodeNativeScreenText(state.playerName), onFail: fallback };
        const mode = npc
            ? { kind: "talk", npc: { x: Math.round(npc.x), y: Math.round(npc.y), facing: fieldDirectionIndex(npc.dir), actorId: npc.npc_id ?? 0 } }
            : { kind: "say", plain: true, balloonMode: 0, actor: null };
        dialogueBox.open({ pack: buildPack(name, pages), index: 0 }, mode, resolve, project, opts);
    });
}

function getDialogue(ref) {
    return parseEntry(
        state.dialogues[ref.file][String(ref.index)],
        state.playerName,
    );
}

// Built once the screen table loads (init). Resolves HANDOFF screen ids → maps.
const screenRouterOptions = {
    useAlt: () => Number(engine?.state.vars.get("$story.ordinal") ?? 0) === 0x2d,
};
let screenRouter = createScreenRouter(null, screenRouterOptions);
let fieldScreenTable;

async function init() {
    await initializeAssetModeUi();
    const titleBg = document.getElementById("title-bg");
    if (titleBg) assignAssetImage(titleBg, "assets/ui/stdwtitl_bg.png");

    // One-time save reset for the engine cutover: the banked flag store moved from legacy
    // "gf_"-prefixed keys in `flags` to the engine's `engineFlags` blob, so old progress can't
    // carry over cleanly. Wipe the save once (forces a fresh New Game) and stamp the schema.
    if (localStorage.getItem("engineSchema") !== "2") {
        for (const k of [
            "flags",
            "engineFlags",
            "progressOrdinal",
            "charId",
            "playerName",
            "chapter",
            "chapterOverride",
            "party",
            "pendingParty",
            "packId",
            "partnerStats",
            "partyStats",
            "equipment",
            "worn",
            FIELD_LOCATION_KEY,
        ]) {
            localStorage.removeItem(k);
        }
        for (const k in state.flags) delete state.flags[k];
        state.party = null;
        state.pendingParty = null;
        state.rosterOwned = 0;
        state.reserveStats = {};
        state.reserveEquipment = {};
        state.partyStats = null;
        state.partnerStats = { hp: 500, maxHp: 500, mp: 100, maxMp: 100, level: 1 };
        state.equipment = [];
        syncWornFromEquipment(state); // nobody wears anything on a new game
        state.packId = null;
        engine?.state.party.load({ members: [] });
        engine?.state.vars.set("$party.pack", null); // clear s212 download gate selector
        state.charId = null;
        state.charIdx = 0;
        localStorage.setItem("engineSchema", "2");
    }

    state.manifest = await (await fetch("assets/manifest.json")).json();
    knownStageIds = state.manifest.maps.map((m) => m.id);
    manifestSprites = new Map([
        ...state.manifest.characters.map((record) => [record.id, { record, kind: "character" }]),
        ...(state.manifest.npcs ?? []).map((record) => [record.id, { record, kind: "npc" }]),
    ]);
    // Global npc_id→sprite table the engine actually uses (NOT "p"+id). Tolerate 404.
    state.npcSprites = {};
    try {
        const ns = await fetch("assets/npc_sprites.json");
        if (ns.ok) state.npcSprites = await ns.json();
    } catch {
        /* fall back to empty (resolvers degrade gracefully) */
    }
    // Real screen→map table (data/screen_table.json) for HANDOFF routing. Tolerate 404.
    try {
        const st = await fetch("assets/data/screen_table.json");
        if (st.ok) {
            fieldScreenTable = await st.json();
            screenRouter = createScreenRouter(fieldScreenTable, screenRouterOptions);
        }
    } catch {
        /* keep specials-only router */
    }
    // Decoded shop catalog (tools/extract_shops.py — 31 STITSHOP shops). A scene shop
    // zone may carry `shop_id` to draw its real stock; else it falls back to zone.stock.
    try {
        const sj = await fetch("assets/data/shops.json");
        if (sj.ok) {
            const byId = {};
            for (const s of (await sj.json()).shops)
                byId[s.shop_id] = { items: s.items.map((i) => i.id), name: s.name };
            state.shops = byId;
        }
    } catch {
        /* no shop catalog — zones use hand stock */
    }

    // Scene JSON is compact routing metadata and remains resident. Large maps,
    // collision grids and sprite sheets are loaded per-stage below.
    const npcProgramsResponse = await fetch("stage-npc-programs.json");
    if (!npcProgramsResponse.ok) throw new Error("Decoded NPC programs unavailable");
    const npcPrograms = (await npcProgramsResponse.json()).stages;
    const sceneLoads = state.manifest.maps.map(async (m) => {
        try {
            const res = await fetch("assets/scenes/" + m.id + ".json");
            const scene = res.ok
                ? await res.json()
                : { npcs: [], exits: [], zones: [] };
            scene.npcs = applyNpcPrograms(scene.npcs ?? [], npcPrograms[m.id] ?? []);
            scene.exits = scene.exits ?? [];
            scene.zones = scene.zones ?? [];
            // A places stage re-aims its exits on every arrival from these rows
            // (applyPlacePoints), so keep the build-time rows pristine: the aim
            // writes a fresh array, and an unmatched pair falls back to this one.
            if (scene.placePoints) scene._baseExits = scene.exits.map((e) => ({ ...e }));
            // gen_scenes.py already bakes the disasm-verified default ("down-left" — the
            // FIELDSTG constructor's unconditional entity+0x60 init, see npc-decode.md)
            // for NPCs with no SETANIM ground truth. This is just a safety net for any
            // record that somehow has no dir at all.
            for (const npc of scene.npcs) {
                if (!npc.dir) npc.dir = "down-left";
            }
            state.scenes[m.id] = scene;
        } catch {
            state.scenes[m.id] = { npcs: [], exits: [], zones: [] };
        }
    });
    const dlgLoads = Array.from(
        { length: 10 },
        (_, i) => "estalk" + String(i).padStart(2, "0"),
    ).map(async (f) => {
        try {
            state.dialogues[f] = await (
                await fetch("assets/dialogue/" + f + ".json")
            ).json();
        } catch {
            state.dialogues[f] = {};
        }
    });

    const EVENT_STAGES = [
        "200",
        "260",
        "270",
        "300",
        "305",
        "400",
        "500",
        "600",
        "700",
        "800",
        "900",
    ];
    const eventLoads = EVENT_STAGES.map(async (key) => {
        try {
            const res = await fetch("assets/events/esdmg" + key + ".json");
            if (res.ok) state.events[key] = await res.json();
        } catch {
            /* optional asset */
        }
    });

    const wstag_load = (async () => {
        try {
            const res = await fetch("assets/events/wstag_events.json");
            if (res.ok) state.wstag = await res.json();
        } catch {
            /* optional */
        }
    })();

    // WS4 story-step VM data (position-triggered cutscenes): step programs + type-7 grids.
    const story_load = (async () => {
        try {
            const [ss, sg, sz, cp, po, rp, ft, amb, tel, tlb, fish, trees, dfm, scl, sdsp, pc1, cone] = await Promise.all([
                fetch("assets/data/story_steps.json").then((r) => r.json()),
                fetch("assets/data/story_trigger_grids.json").then((r) =>
                    r.json(),
                ),
                // EXACT per-pixel type-7 zones — the disc's own zonecheck, decimised
                // only by horizontal run. The step byte must come from the player's
                // pixel, not a 32 px cell (web/game.js stepSetupBucketTick / the
                // trigger system's zoneByte). Missing file = fall back to the grid.
                fetch("assets/data/story_trigger_zones.json")
                    .then((r) => (r.ok ? r.json() : { stages: {} }))
                    .catch(() => ({ stages: {} })),
                fetch("assets/data/chapter_progression.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                fetch("assets/data/progress_ordinal.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                fetch("assets/data/roster_predicate_table.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Fire Dungeon floor traps: the step regions of s740/s741 whose
                // event is the native party-explosion controller, plus that
                // controller's extracted timing, sounds and sprite programs.
                fetch("assets/data/fire_traps.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Ambush tiles: the patches of floor that drop you straight into
                // a fight with one of the area's own monsters.
                fetch("assets/data/forced_encounters.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Talk-triggered cutscenes: the bank-0x90 launcher's event-id
                // table (fieldstg 0x800978d8). A dialogue state's on_close write
                // into that bank IS a start_event; the bit indexes this array.
                fetch("assets/data/talk_event_launches.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // The same launcher resolved PER STAGE: which NPC dialogue state writes which
                // bit, and which event that bit names here. This is the start site of those
                // scenes — and the authority for what a bit means in the CURRENT stage, since
                // three shipped bindings name an event their own stage does not own and start
                // nothing (tools/extract_talk_launch_bindings.py).
                fetch("assets/data/talk_launch_bindings.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Fishing spots: the op-7 step records that grow at the water's
                // edge once you own the FishingPole, plus the two parties a
                // successful strike can pull out of the stage's own scripted
                // encounter block.
                fetch("assets/data/fishing_spots.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Kickable trees: the stage's FIELDCOM point-sprite records, in
                // the tree manager's own order, plus the two parties its one
                // live tree drops.
                fetch("assets/data/tree_kick.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Post-dive traversal forms: each stage's own cast-list marker
                // (screen -> native sprite id 0x146 Digmon / 0x147 Submarimon).
                // Authoritative over the exit-graph network, which misses the
                // maze-entered screens. See tools/extract_dive_form_markers.py.
                fetch("assets/data/dive_form_markers.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // The whole cast list per stage (descriptor +0x4C), decoded once
                // by tools/extract_cast_lists.py. The player build (loop A) and
                // every other actor (loop B) read from THIS, so a dive form, a
                // charId-1 row and the special block actors all come out of one
                // path. The two files above are its derived fallbacks.
                fetch("assets/data/stage_cast_lists.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Per-stage default spawn (descriptor +0x2C/+0x30, 24.8 fixed ->
                // map pixels by >>8): where you stand when a stage loads with no
                // warp spawn. tools/extract_stage_default_spawn.py.
                fetch("assets/data/stage_default_spawn.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Stages whose cast list builds the player as charId 1 (P001PLAY),
                // so their scripts name the player actor 1, not 2.
                // tools/extract_player_cast_one.py.
                fetch("assets/data/player_cast_one.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // The position step's facing-cone enable gate: FIELDSTG.PRO's 8x8
                // byte table at RAM 0x80097624, which step-load reads as
                // cone[grid byte >> 5][player facing]. tools/extract_step_enable_table.py.
                fetch("assets/data/scene/step_enable_table.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
            ]);
            // Multi-phase rooms: the second type-7 layout a swap event installs,
            // with its own 24-byte step program. Only s810 (Undersea Base) has one.
            const variants = await fetch("assets/data/stage_layout_variants.json")
                .then((r) => (r.ok ? r.json() : { stages: {} }))
                .catch(() => ({ stages: {} }));
            state.storySteps = ss.stages;
            state.storyGrids = sg.stages;
            state.storyZones = sz?.stages ?? {};
            state.stageLayoutVariants = variants.stages ?? {};
            state.stepEnableTable = cone?.rows ?? null;
            state.fireTraps = ft ?? {};
            state.ambushTiles = amb ?? {};
            state.fishingSpots = fish ?? {};
            state.treeStages = trees ?? {};
            state.diveFormMarkers = dfm ?? {};
            state.stageCastLists = scl; // null when missing: fall back to the derived files
            state.stageDefaultSpawn = sdsp ?? {};
            state.playerCastOne = pc1; // null when missing: fall back to the scene's own actor-1 use
            state.talkEventIds = tel?.events ?? [];
            setTalkLaunchBindings(tlb);   // null tolerated: playTalkEvent falls back to tel
            state.chapterTable = cp; // null tolerated → deriveChapter falls back to default 1
            // Populate ordinal/roster tables in place (the flag store captured these references).
            if (po) {
                const all = new Set();
                for (const b of po.ladder) {
                    state.ordinalByStage[b.stage] = b.ordinals; // full list (revisited stages)
                    for (const o of b.ordinals) all.add(o);
                }
                state.allOrdinals = [...all].sort((a, b) => a - b);
            }
            if (rp)
                for (const r of rp.records) state.rosterPredTable[r.key] = r;
        } catch {
            state.storySteps = {};
            state.storyGrids = {};
            state.storyZones = {};
            state.stageLayoutVariants = {};
            state.stepEnableTable = null;
            state.fireTraps = {};
            state.ambushTiles = {};
            state.fishingSpots = {};
            state.treeStages = {};
            state.talkEventIds = [];
        }
    })();

    const findings_load = (async () => {
        try {
            state.findings = await (
                await fetch("assets/events/intro_re_findings.json")
            ).json();
            // Populate EMOTE_KINDS (module-level object read by cutscene opts) from loaded findings.
            Object.assign(
                EMOTE_KINDS,
                Object.fromEntries(
                    Object.entries(state.findings?.emotes ?? {}).map(
                        ([k, v]) => [Number(k), v.kind],
                    ),
                ),
            );
        } catch {
            state.findings = null;
        }
    })();

    // Preload battle data (idempotent) so the story engine can resolve scripted-battle
    // triggers/parties before the first fight (talking to a boss must work immediately).
    const battle_load = battle.loadData().catch(() => {});

    // Real FIELDCOM field-UI icons (talk balloon, ladder bubble, door arrow, sparkles).
    // Non-fatal: draw sites fall back to the hand-drawn bubble when unavailable.
    const fieldcom_load = loadFieldcom(loadImage).catch(() => {});

    // The Digi-Egg dive transition packs (SSUBDEMO / SDIGDEMO). Non-fatal: a
    // dive falls back to the plain fade if these are missing.
    const divedemo_load = loadDiveDemo(loadImage).catch(() => {});

    // The stage-entry location title card's name table and bar templates.
    // Non-fatal: without it an arrival simply goes unannounced.
    const placecard_load = (USE_LEGACY_PLACE_CARD ? loadPlaceCard() : loadPlaceCardTranslated()).catch(() => {});

    // The END card's language table. Non-fatal: the card falls back to its own overlay
    // table only if the shipped one fails to load, and the session rejects a drift.
    const endcard_load = (USE_LEGACY_END ? Promise.resolve() : loadEndCardTranslated()).catch(() => {});

    // Ambient point-sprite decorations (windmills/fans/torches — see
    // web/effects.js). Non-fatal: stages simply show no ambient effects.
    const effects_load = loadPointSprites().catch(() => {});

    // The stage overlays' own actors, ported from their record tables
    // (tools/extract_falling_objects.py). This is the route that plays in the
    // shipped game; see web/stage-objects.js. Non-fatal.
    const falling_objects_load = loadFallingObjects().catch(() => {});

    // Original stage execution is an explicit research route. Other native
    // screens request their reference images when that screen is opened.
    const native_stage_reference_load = new URLSearchParams(location.search).has("nativeStages")
        ? loadNativeStages().catch((e) => console.warn("[native-stage] load failed:", e?.message ?? e))
        : Promise.resolve();

    // Foreground map-overlay index (walk-behind pipes/poles/canopies): map tiles
    // are 3-layered on PS1 and layers >= 1 draw OVER sprites; the flat map PNGs
    // lost that, so sNNN_fg.png recomposites them (tools/extract_map_overlays.py).
    // Non-fatal: without it the player just draws over foreground props again.
    const overlays_load = fetch("assets/data/map_overlays.json")
        .then((r) => (r.ok ? r.json() : {}))
        .then((idx) => (state.mapOverlays = idx))
        .catch(() => {});

    // Ground-cover index: which stages ship a layer-2 split (their ground band is
    // rebuilt at load from the base map + the tracked run data), so the renderer
    // asks only for those (tools/build_map_ground_over_props.py). Non-fatal; an
    // empty index just skips the ground band.
    const ground_load = fetch("assets/data/map_ground_index.json")
        .then((r) => (r.ok ? r.json() : {}))
        .then((idx) => (state.mapGroundIndex = idx))
        .catch(() => {});
    const layer2_load = fetch("assets/data/map_layer2_runs.json")
        .then((r) => (r.ok ? r.json() : { stages: {} }))
        .then((d) => (state.mapLayer2 = d.stages ?? {}))
        .catch(() => {});

    // The s260 Cargo Tower auction (assets/data/auction_lots.json, written by
    // tools/extract_s260_auction.py from the disc): the sixteen lots of
    // FIELDSTG_progressEvents / FIELDSTG_choices / FIELDSTG_events and the 50
    // wstag260 scripts. Non-fatal: without it the tower loads exactly as before.
    const auction_load = fetch("assets/data/auction_lots.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (state.auction = d ?? null))
        .catch(() => { state.auction = null; });

    await Promise.all([
        ...sceneLoads,
        ...dlgLoads,
        ...eventLoads,
        wstag_load,
        story_load,
        auction_load,
        findings_load,
        battle_load,
        fieldcom_load,
        divedemo_load,
        placecard_load,
        endcard_load,
        effects_load,
        falling_objects_load,
        native_stage_reference_load,
        overlays_load,
        ground_load,
        layer2_load,
    ]);

    // Digi-Egg traversal sections. Which screens you wear Submarimon/Digmon on
    // is derived once from the loaded exit graph — see engine/systems/dive-form.ts.
    const dive = computeDiveNetwork(state.scenes);
    state.diveNetwork = dive.network;
    if (dive.conflicts.length)
        console.warn("[dive] screen claimed by both dive forms:", dive.conflicts);

    // Bring up the headless engine (flags + ordinal + story decisions) before the loop runs.
    // Story is non-functional without it, so surface a hard error rather than silently degrade.
    try {
        await initEngine();
    } catch (err) {
        console.error("[engine] init FAILED — story will not run", err);
    }

    const charSelectEl = document.getElementById("charSelect");
    for (const c of state.manifest.characters) {
        charSelectEl.add(new Option(c.name, c.id));
    }
    charSelectEl.onchange = () => {
        setCharacter(charSelectEl.selectedIndex);
        charSelectEl.blur();
    };

    const mapSelect = document.getElementById("mapSelect");
    for (const m of state.manifest.maps) {
        mapSelect.add(new Option(m.name, m.id));
    }
    mapSelect.onchange = () => {
        loadAndSetMap(mapSelect.selectedIndex);
        mapSelect.blur();
    };
    installShowcase({
        select: document.getElementById("showcaseSelect"),
        apply: applyScene,
        goTo: (id) => {
            const i = state.manifest.maps.findIndex((m) => m.id === id);
            if (i < 0) return;
            mapSelect.selectedIndex = i;
            loadAndSetMap(i);
        },
    });

    try {
        const tracks = await (await fetch("assets/music/index.json")).json();
        const musicSelect = document.getElementById("musicSelect");
        for (const t of tracks) musicSelect.add(new Option(t, t));
        musicSelect.onchange = () => {
            bgm.play(musicSelect.value);
            musicSelect.blur();
        };
    } catch {
        const musicSelect = document.getElementById("musicSelect");
        if (musicSelect) musicSelect.parentElement.hidden = true;
    }

    const chapterSelect = document.getElementById("chapterSelect");
    chapterSelect.value = String(state.chapter);
    chapterSelect.onchange = () => {
        state.chapter = Number(chapterSelect.value);
        chapterSelect.blur();
    };

    // Restore persisted charIdx from charId after manifest is loaded.
    if (state.charId) {
        const savedIdx = state.manifest.characters.findIndex(
            (c) => c.id === state.charId,
        );
        if (savedIdx > 0) state.charIdx = savedIdx;
    }
    // Restore the persisted party; keep charIdx in sync with the lead (party[0]).
    if (Array.isArray(state.party) && state.party.length) {
        const leadIdx = manifestIndexOf(state.party[0]);
        if (leadIdx > 0) state.charIdx = leadIdx;
    }
    // Restore an evolved partner form (digimonId persisted in partnerStats) so the partner
    // stays evolved across reloads (getPlayerProfile reads char.digimonId).
    if (fieldPartySize(state.party) > 0 && state.charIdx > 0 && state.partnerStats?.digimonId) {
        state.manifest.characters[state.charIdx].digimonId =
            state.partnerStats.digimonId;
    }
    charSelectEl.selectedIndex = state.charIdx;

    document.getElementById("loading").hidden = true;

    // A memory-card load reloads the page into the loaded slot; go straight to
    // the field instead of the language and title screens (set once by
    // web/save-translated.js / save-native.js before the reload).
    let resumeAfterLoad = false;
    try {
        resumeAfterLoad = sessionStorage.getItem("resumeAfterLoad") === "1";
        sessionStorage.removeItem("resumeAfterLoad");
    } catch { /* storage blocked */ }
    // `?skipTitle=1` is a headless shortcut past the boot, not a game rule, and it
    // must not change what a lost fight does: wfightmn's loss exit launches 0xE00
    // (the title screen) from a game that is ALREADY running
    // (web/game.js gameOverToTitle()). So both routes build the title screen below
    // and only differ in whether they open it; the flag is read here and acted on
    // after the screen exists.
    const debugSkipTitle = new URLSearchParams(location.search).get("skipTitle") === "1";
    const debugMap = new URLSearchParams(location.search).get("map");

    const title = document.getElementById("title-screen");
    // Not shown yet: the PAL boot screen (country / language select) runs first
    // — see the boot-language block below. `?skipLanguage=1` skips straight to
    // the title.

    // Show decoded title logo PNG if available; fall back to text heading.
    const logoImg = document.getElementById("title-logo");
    const titleText = document.getElementById("title-text");
    if (logoImg) {
        logoImg.onload = () => {
            logoImg.hidden = false;
            if (titleText) titleText.hidden = true;
        };
        logoImg.onerror = () => {
            logoImg.hidden = true;
            if (titleText) titleText.hidden = false;
        };
        assignAssetImage(logoImg, "assets/title_logo.png");
    }

    // Continue is never dimmed, disabled or skipped. The original's title menu
    // has no test for "is there a file": the lower choice always launches code
    // 0xC00, the memory-card screen in LOAD mode (docs/research/ui/
    // stdwtitl-title-menu-2026-08-14.md, "What the choices actually do"), and
    // an empty card answers with the original's own esmemcrd 24 "No data here."
    const contEl = document.getElementById("title-continue");
    if (!contEl) return; // defensive: element missing

    const closeTitle = (then) => {
        if (title.classList.contains("fade-out")) return; // already closing
        bgm.unlock(); sfx.unlock();
        title.classList.add("fade-out");
        setTimeout(() => {
            title.hidden = true;
            then();
        }, 650);
    };

    // What the memory card hands the launcher when the player backs out of it.
    // The screen picks the next screen by the selector its own root wrote
    // (pro/stgmcard.s 0x4dc4-0x4e2c: root+0x14 == 0 means a save was loaded and
    // the SAVED GAME's own screen code answers, root+0x50 != 0 means LOAD mode
    // left without loading and the answer is 0xE00 — the TITLE SCREEN — and
    // otherwise the screen returns to the one it came from; see the translated
    // root's state 3 in engine/dw3/ui/memcard-root.ts). The translated screen
    // keeps those words as `transition()`, which web/save-translated.js records
    // in `diagnostics().summary.transition`.
    //
    // Only the LOAD direction is reachable from this button, and a load restores
    // the slot and reloads the page instead of calling back (web/save-translated.js
    // `_finish`), so backing out of Continue answers 0xE00: the title comes back.
    // The hand-made card (`?legacySave=1`) and the interpreter reference
    // (`?nativeSave=1`) record no selector, and in LOAD mode the decoded answer
    // is 0xE00 for them too.
    const MEMCARD_TITLE_SCREEN = 0xe00;
    const memoryCardExitScreen = () => {
        const code = saveScreen.diagnostics?.()?.summary?.transition?.[0];
        return Number.isFinite(code) ? code : MEMCARD_TITLE_SCREEN;
    };
    // A FRESH title, the way the idle reset builds one — not a resumption of the
    // menu the player left, because the launcher builds the screen again. The
    // card is the screen being left, so it is the previous screen the fresh
    // title reads back (a Japanese title times out to 0xE01 from here, not to
    // the movie it happened to watch before).
    const leaveMemoryCardToTitle = () => {
        window.__memcardExitScreen = memoryCardExitScreen();
        previousScreenCode = MEMCARD_SCREEN_CODE;
        startTitle();
    };

    const requestGameFullscreen = () => {
        const stage = document.getElementById("stage");
        if (!document.fullscreenElement && stage?.requestFullscreen) {
            // Fullscreen requires a direct user gesture. New Game/Continue are
            // that gesture; denial is harmless and leaves the responsive canvas.
            toggleGameFullscreen(document, stage);
        }
    };

    document.getElementById("title-newgame").onclick = () => {
        requestGameFullscreen();
        for (const k of [
            "flags",
            "engineFlags",
            "charId",
            "playerName",
            "chapter",
            "chapterOverride",
            "progressOrdinal",
            "party",
            "pendingParty",
            "packId",
            "partnerStats",
            "partyStats",
            "equipment",
            "worn",
            // A new game starts with no partners obtained and nobody waiting at the Lab.
            "rosterOwned",
            "reserveStats",
            "reserveEquipment",
            "residentSaveImage",
            // The wallet/bag and the other per-save progress stores: Start resets
            // game state (stdwtitl), so a new game must not inherit the previous
            // save's money, items, nicknames, play time or discovered maps.
            "bits",
            "inventory",
            "digimonNames",
            "playSeconds",
            "visitedMaps",
            "cardCollection",
            "engineEvents",
            FIELD_LOCATION_KEY,
        ])
            localStorage.removeItem(k);
        engineEventDone.clear(); // the story restarts, so once-only events may fire again
        resetCollection();
        ensureStarterFolder(); // F0x80016E6C grants the 40-card starter deck
        state.bits = 500; // fresh-install default (see the state init: bits ?? 500)
        clearBag(state); // the new-game path zeroes the save block's two count arrays
        state.digimonNames = {};
        state.playSeconds = 0;
        state.visitedMaps = new Set();
        for (const k in state.flags) delete state.flags[k]; // clear string markers (evt_/onceFlag/setFlag)
        if (engine) engine.state.flags.clear(); // wipe the banked store (single source of truth)
        state.charId = null;
        state.progressOrdinal = 0; // fresh story → ordinal back to 0 (drives bank-0x60/0x70 gates)
        state.chapter = null; // clear debug override → chapter derives from (now empty) flags = 1
        state.playerName = "Junior"; // placeholder until in-world registration
        state.charIdx = 0; // no partner until the s212 download scene
        state.party = null;
        state.pendingParty = null;
        state.rosterOwned = 0;
        state.reserveStats = {};
        state.reserveEquipment = {};
        state.partyStats = null;
        state.partnerStats = { hp: 500, maxHp: 500, mp: 100, maxMp: 100, level: 1 };
        state.equipment = [];
        syncWornFromEquipment(state); // nobody wears anything on a new game
        state.packId = null;
        engine?.state.vars.set("$party.pack", null); // clear s212 download gate selector
        closeTitle(() => startGame("s780"));
    };
    contEl.onclick = () => {
        requestGameFullscreen();
        // The original's Continue launches code 0xC00 — the memory card in LOAD
        // mode (stdwtitl's choice dispatcher: 0x2D7 = Start, 0xC00 = Continue).
        // There is no save-exists test on this path: with nothing saved the
        // card screen opens anyway and reports "No data here.", so the player
        // can pick another card or back out.
        // Loading a slot restores the walker's snapshot and reloads the page, so
        // the close callback only runs when nothing was loaded — and then the
        // card's own exit selector sends the player back to the title, not into
        // a game they did not load.
        closeTitle(() => {
            // The load screen runs before the game starts, so the sim loop
            // cannot draw it and the field canvas is still hidden. Like the
            // boot language screen, it paints on the title canvas until it
            // closes (padLoop ticks it).
            title.hidden = false;
            title.classList.remove("fade-out");
            title.classList.add("native");
            openMemoryCard("load", leaveMemoryCardToTitle);
            requestAnimationFrame(continueLoadFrame);
        });
    };
    // ── The title screen ────────────────────────────────────────────────
    // Decoded 2026-08-14; see docs/research/ui/stdwtitl-title-menu-2026-08-14.md.
    // The translated controller lives in engine/dw3/ui/title-session.ts;
    // web/titlescreen.js paints its extracted pictures. If the art is missing,
    // the walker's heading and buttons remain available.
    const titleCanvas = document.getElementById("title-canvas");
    const titleCtx = titleCanvas?.getContext("2d") ?? null;
    // ?nativeTitle=1 runs the original-code screen for reference comparisons.
    // The resident launcher's PREVIOUS screen code — the code of the screen a
    // launch replaces. The launcher records it on every screen change, and the
    // title's Japanese idle timeout reads it back to alternate its two opening
    // movies: stdwtitl's choice dispatcher F0x80086834 calls the getter
    // 0x80016B58 through the game context's slot 0x8004B448 (the word at
    // 0x8004B400) and launches 0xE01 unless that word already reads 0xE01
    // (pro/stdwtitl.s .L0x00003CA0-.L0x00003CEC; ledger
    // UI-TITLE-ATTRACT-LOOP-2026-08-14). Every route into the title must
    // therefore record what it left, exactly as the launcher does — a stale
    // value makes the Japanese build watch the wrong opening movie.
    let previousScreenCode = 0;
    // The memory-card overlay's own screen code: the title's Continue choice
    // launches 0xC00 with argument 0 (the LOAD row), and when the card hands
    // back 0xE00 the title is entered with the card as its previous screen.
    const MEMCARD_SCREEN_CODE = 0xc00;
    const newTitle = () => USE_NATIVE_TITLE
        ? createTitleNative(sfx).open()
        : createTitleScreen({ language: state.languageByte ?? 2, previousScreenCode });
    // Construct the research screen only on that explicit route. Recreate the
    // translated title after language selection to use the chosen text clips.
    let ts = USE_NATIVE_TITLE ? createTitleNative(sfx)
        : createTitleScreen({ language: state.languageByte ?? 2, previousScreenCode });
    // F0x80083cc0 state 1 (stdwtitl.s:1172-1190): once the movie object is
    // gone the movie screen launches its row's destination word with argument
    // 0. Both opening rows carry 0x0e00, the title screen, so the attract loop
    // comes back here -- read from the table, not assumed.
    let movieDestination = 0;
    const movie = createTitleMoviePlayer((code) => {
        // The launcher's previous-screen record: the movie's own code (0xE01 /
        // 0xE02) is what the title it hands back to reads on its next timeout.
        previousScreenCode = code;
        movieDestination = movieReturnScreen(code, false) ?? 0;
        if (movieDestination === MOVIE_TITLE_SCREEN) ts = newTitle();
        // The attract loop's return to the title does NOT start ttlbgm here:
        // the disc rings TITLEBGM only from the title's own reveal cue, which
        // every fresh title entry fires (web/game.js playTitleSounds).
    });
    window.__titleMovie = () => ({
        ...movie.diagnostics(),
        destination: "0x" + movieDestination.toString(16),
    });
    const startMovie = (code) => {
        title.hidden = false;
        titleNative = true;
        title.classList.add("native");
        bgm.play(null);
        movie.open(code);
    };
    // The title publishes packed-sound words; a MUSIC-START word is a SEP
    // sequence the sample sink cannot resolve, so it must go to the music
    // player. The sequence's own cue is TITLEBGM 0x611c0000 (see PACKED_MUSIC):
    // routing it here is what makes the reveal audible -- and because the disc
    // starts the theme ON that cue, it is also the only place the title theme
    // starts (web/game.js no longer starts ttlbgm at title open).
    const playTitleSounds = () => {
        for (const id of ts.takeSounds?.() ?? []) {
            if (packedIsMusicStart(id)) {
                const stem = PACKED_MUSIC[packedKey(id)];
                if (stem) { bgm?.play?.(stem); continue; }
            }
            sfx.playPacked(id);
        }
    };
    // Starts false so the first successful draw flips it: the class toggle only
    // fires on a CHANGE, and pre-setting it left the native canvas display:none
    // (the walker's own HTML title stayed visible over it).
    let titleNative = false;
    // Debug handle: the native title's live state machine (phase/highlight/
    // result), so a headless check can follow the prompt -> menu -> commit
    // sequence without guessing at pixels.
    window.__titleState = () => ts;

    const commitTitle = (result, launchCode = 0) => {
        if (result === RESULT_START) {
            document.getElementById("title-newgame").click();
        } else if (result === RESULT_CONTINUE) {
            // The same choice the button makes, and the same unconditional hand
            // off: no "is there a file" test, on either the pad route or the
            // pointer route into the drawn menu.
            contEl.click();
        } else if (result === RESULT_IDLE) {
            // The translated choice dispatcher selected MOVIEOP2 or MOVIEOPN.
            startMovie(launchCode);
        }
    };

    const bgImg = document.getElementById("title-bg");
    // The title is a PAL screen: it is driven by the real elapsed time of each
    // browser frame, not by the browser's frame rate. web/game.js's own frame
    // loop caps the sim at 60fps, and this loop deliberately does not — the
    // display clock turns the elapsed seconds into 50Hz fields (zero, one or
    // more per browser frame), so the title's beat counter counts 60 sixtieths
    // a second on a 60Hz panel and on a 144Hz one, as the disc does.
    let titleLastT = 0;
    const titleFrame = (t) => {
        if (state.started || title.hidden) return;
        const dt = titleLastT ? Math.min((t - titleLastT) / 1000, 0.1) : 0;
        titleLastT = t;
        if (!movie.isOpen()) ts.tick(dt);
        playTitleSounds();
        if (titleCtx) {
            const w = titleCanvas.clientWidth || 320;
            const h = titleCanvas.clientHeight || 240;
            if (titleCanvas.width !== w || titleCanvas.height !== h) {
                titleCanvas.width = w; titleCanvas.height = h;
            }
            let drew;
            if (movie.isOpen()) {
                drew = movie.draw(titleCtx, w, h, bgm.muted);
            } else if (USE_NATIVE_TITLE) {
                // Fit-and-centre the 320x240 screen in the canvas the way the
                // walker's own title does, so the aspect ratio is preserved.
                const t = titleViewTransform(w, h);
                // The native screen draws its own background, so the letterbox
                // bars must be black rather than the walker's fallback art.
                titleCtx.fillStyle = "#000";
                titleCtx.fillRect(0, 0, w, h);
                titleCtx.save();
                titleCtx.translate(t.offsetX, t.offsetY);
                titleCtx.scale(t.scale, t.scale);
                drew = ts.draw(titleCtx, 320, 240);
                titleCtx.restore();
            } else {
                drew = drawTitleScreen(titleCtx, ts, w, h, bgImg);
            }
            if (drew !== titleNative) {
                titleNative = drew;
                title.classList.toggle("native", drew);
            }
        }
        if (!movie.isOpen() && ts.isDone()) {
            const r = ts.result();
            const code = ts.launchCode?.() ?? 0;
            if (r !== RESULT_IDLE) ts = newTitle();
            commitTitle(r, code);
        }
        // Keep driving the title unless it is actually going away. The idle
        // reset (RESULT_IDLE) installs a FRESH screen inside commitTitle;
        // returning here without a new frame
        // left that screen frozen in its first "slide" frame, so after the
        // ~10-second idle timeout the title never came back and no input
        // advanced it. New Game / Continue close the title synchronously with
        // the fade-out class, so they still stop the loop.
        if (!state.started && !title.hidden && !title.classList.contains("fade-out")) {
            requestAnimationFrame(titleFrame);
        }
    };

    // ── The PAL boot screen: country / language select ────────────────────
    // The original's boot main (`f12`, called from `start.s` L51) calls
    // `F0x80016a94` through the pointer at `D0x8004b430`; that function sets the
    // current screen code to **0x1600**, and `f15` resolves library `0x16`
    // through the LBA table at `D0x80055ccc` — entry 0x16 is `0x165` (357) =
    // `CNTY_SEL.PRO`. The developer stage-select table's row for the same code
    // is labelled くにせんたく (country selection). So the language screen runs
    // BEFORE the title; its confirm writes the language byte 0x8005CCA8 and
    // hands 0xE01/0xE02 (the opening movies) to the launcher.
    const languageOpen = () =>
        USE_NATIVE_CNTYSEL ? cntyselNative.isOpen() : cntyselMenu.open;
    const startTitle = () => {
        if (USE_NATIVE_TITLE) ts.open();
        else ts = newTitle();
        title.hidden = false;
        // A title opening again starts its real-time clock fresh, so the first
        // browser frame spends no time it did not live through.
        titleLastT = 0;
        // The title theme (ttlbgm, archive 71) is NOT started here: the disc
        // starts TITLEBGM on the sequence tick's reveal cue (0x611c0000), which
        // playTitleSounds now routes to the music player. Starting it at title
        // open made that cue a no-op (the exclusive register already held the
        // same id) and left the reveal silent.
        requestAnimationFrame(titleFrame);
    };
    // Launch 0xE00 — the title screen — from a screen the game is already running.
    // wfightmn's loss exit (pro/wfightmn.s .L0x000021cc-.L0x000021dc) hands 0xE00 to
    // the pending selector through `D0x8004b440` (`F0x80016b88`, two stores), and the
    // resident machinery loads that library OVER the black the fade left behind: it
    // is a screen change, not a process restart. So the launch runs in place — a fresh
    // screen object, the title theme, the title's own input reader — and `state.started`
    // goes back to false because that is the state every pre-game screen reads
    // (`titleFrame`, `titleInput`, the pad loop's save-screen tick, the key handler's
    // memory-card branch). The field under the canvas is never rebuilt, exactly as on
    // the disc: the loss arm has no field-restore branch, so Start on this title opens a
    // new game and Continue opens the card in LOAD mode (code 0xC00).
launchTitleScreen = () => {
        // The screen being left is the battle (its own code is 0x600), so that
        // is the previous screen the fresh title reads back — the Japanese
        // timeout launches 0xE01 from here, whatever movie ran earlier.
        previousScreenCode = BATTLE_HANDOFF_SELECTOR;
        ts = newTitle();
        title.hidden = false;
        title.classList.remove("fade-out");
        state.started = false;
        // No early title-theme start here: the fresh title runs its reveal and
        // its own TITLEBGM cue starts the theme, as on the disc.
        attachTitleInput();
        // The fade HELD at black (F0x8008a83c's level is 0xFF00 and stays there) while
        // the resident machinery unloaded the battle library and loaded the title's.
        // The field under this canvas is not rebuilt, so paint the black now rather
        // than next frame: the sim loop draws it again in between, and without this
        // one frame of the field would flash between the fade and the title.
        if (titleCtx) {
            const w = titleCanvas.clientWidth || 320;
            const h = titleCanvas.clientHeight || 240;
            if (titleCanvas.width !== w || titleCanvas.height !== h) {
                titleCanvas.width = w; titleCanvas.height = h;
            }
            titleCtx.fillStyle = "#000";
            titleCtx.fillRect(0, 0, w, h);
        }
        requestAnimationFrame(titleFrame);
    };
    // The title runs before the main dispatcher is live, so it owns its own
    // reader. `titleInput` is what the joystick calls into (see `gamepad` at the
    // bottom of this file) — the pad has to work on the title screen too, or the
    // player cannot start the game without reaching for the keyboard.
    //
    // Installed when a title is actually OPENED, not merely because the screen was
    // built: on the `?skipTitle=1` route the game owns the pad from the first frame,
    // and a reader installed there would swallow that first press (the joystick's
    // `if (titleInput) { titleInput(button); return; }` never reaches the game).
    const attachTitleInput = () => {
        titleInput = (k) => {
            if (state.started || title.hidden) {
                titleInput = null;
                return false;
            }
            // The boot language screen owns the keys while it is up: it is drawn
            // through this same canvas but is NOT the title, and letting the title
            // state machine see the presses would queue a Start/confirm that fires
            // the moment the title opens.
            if (languageOpen()) return false;
            if (movie.isOpen()) {
                if (k === "start") movie.skip();
                else movie.retry();
                return true;
            }
            if (!titleNative) {
                if (k === "circle") document.getElementById("title-newgame").click();
                return true;
            }
            if (k === "start") {
                // The native title's "Press Start Button" wants the pad's START
                // button (logical 3), not Circle: F0x80085594 case 1 substate 2.
                if (ts.start?.()) playTitleSounds();
            } else if (k === "up") {
                if (ts.up()) playTitleSounds();
            } else if (k === "down") {
                if (ts.down()) playTitleSounds();
            } else if (k === "circle") {
                if (ts.confirm()) playTitleSounds();
            } else {
                return false;
            }
            return true;
        };
        window.addEventListener("keydown", function onKey(e) {
            if (!titleInput) {
                window.removeEventListener("keydown", onKey);
                return;
            }
            if (titleInput(asButton(e.key))) e.preventDefault();
        });
    };
    // The boot language screen draws through the title canvas; `#title-screen`
    // stays visible with the `native` class so the walker's own logo/buttons
    // are hidden and the canvas is displayed.
    const continueLoadFrame = () => {
        if (state.started || !saveScreen.isOpen()) return;
        if (titleCtx) {
            const w = titleCanvas.clientWidth || 320;
            const h = titleCanvas.clientHeight || 240;
            if (titleCanvas.width !== w || titleCanvas.height !== h) {
                titleCanvas.width = w; titleCanvas.height = h;
            }
            titleCtx.fillStyle = "#000";
            titleCtx.fillRect(0, 0, w, h);
            const t = titleViewTransform(w, h);
            titleCtx.save();
            titleCtx.translate(t.offsetX, t.offsetY);
            titleCtx.scale(t.scale, t.scale);
            saveScreen.draw(titleCtx, 320, 240, state);
            titleCtx.restore();
        }
        requestAnimationFrame(continueLoadFrame);
    };
    const bootLanguageFrame = () => {
        if (state.started || !languageOpen()) return;
        if (titleCtx) {
            const w = titleCanvas.clientWidth || 320;
            const h = titleCanvas.clientHeight || 240;
            if (titleCanvas.width !== w || titleCanvas.height !== h) {
                titleCanvas.width = w; titleCanvas.height = h;
            }
            titleCtx.fillStyle = "#000";
            titleCtx.fillRect(0, 0, w, h);
            const t = titleViewTransform(w, h);
            titleCtx.save();
            titleCtx.translate(t.offsetX, t.offsetY);
            titleCtx.scale(t.scale, t.scale);
            if (USE_NATIVE_CNTYSEL) cntyselNative.draw(titleCtx, 320, 240);
            else cntyselMenu.draw(titleCtx, 320, 240);
            titleCtx.restore();
        }
        requestAnimationFrame(bootLanguageFrame);
    };
    const skipLanguage =
        new URLSearchParams(location.search).get("skipLanguage") === "1";
    // A memory-card load and the headless shortcut both go straight into the game.
    // The title screen is built either way (see `debugSkipTitle` above): these are
    // the only two routes that never open it. The reader goes on just before the
    // route that does open it.
    if (resumeAfterLoad) {
        startGame();
        return;
    }
    if (debugSkipTitle) {
        startGame(debugMap || null);
        return;
    }
    attachTitleInput();
    if (skipLanguage) {
        // Debug: `&language=N` stands in for the byte the language screen
        // would commit. The PAL screen never opens its side pane, so its pad
        // cannot select JPN (0); this is the only way to reach that title path.
        const debugLanguage = new URLSearchParams(location.search).get("language");
        if (debugLanguage !== null) state.languageByte = Number(debugLanguage) & 0xff;
        startTitle();
    } else {
        title.hidden = false;
        title.classList.add("native");
        const onPick = (row, language, launchCode = 0) => {
            // The screen's own commit: the language byte it wrote to the
            // original's global. The walker ships one language, so this is
            // recorded rather than used to swap assets.
            state.languageByte = (language ?? 0) & 0xff;
            window.__bootLanguage = { row, language: state.languageByte };
            startMovie(launchCode || (state.languageByte === 0 ? 0xe01 : 0xe02));
            requestAnimationFrame(titleFrame);
        };
        if (USE_NATIVE_CNTYSEL) cntyselNative.open(onPick);
        else cntyselMenu.show((row) => onPick(row, 0));
        requestAnimationFrame(bootLanguageFrame);
    }

    if (titleCanvas) {
        titleCanvas.addEventListener("pointerdown", (ev) => {
            if (movie.isOpen()) { movie.retry(); return; }
            if (!titleNative) return;
            const rect = titleCanvas.getBoundingClientRect();
            // Same fit-and-centre transform the draw uses, inverted.
            const t = titleViewTransform(rect.width, rect.height);
            const sx = (ev.clientX - rect.left - t.offsetX) / t.scale;
            const sy = (ev.clientY - rect.top - t.offsetY) / t.scale;
            for (const r of (USE_NATIVE_TITLE ? [] : titleOptionRects(ts))) {
                if (sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h) {
                    if (ts.choose(r.index)) playTitleSounds();
                    return;
                }
            }
            if (ts.confirm()) playTitleSounds();
        });
    }
}

// Set while the title screen is up; the joystick reads it so the pad can start
// the game. Null once the title is gone.
let titleInput = null;

// Launch code 0xE00 (the title screen) from inside a running game — the decoded
// loss route, web/game.js gameOverToTitle(). Installed by init(); null before boot
// finishes, where there is no running game to leave.
let launchTitleScreen = null;

function saveFieldLocation() {
    if (!state.started || !state.manifest) return;
    const entranceReturn = state.scenes[currentMap().id]?.exits?.find(
        (exit) => exit._entranceReturn,
    );
    localStorage.setItem(FIELD_LOCATION_KEY, encodeFieldLocation({
        mapId: currentMap().id,
        x: state.x,
        y: state.y,
        dir: state.dir,
        entranceReturn,
    }));
}

// The card collection can be mutated through the engine directly by several
// screens (folder editor, card shop, booster reveal). Comparing a cheap
// serialization on a throttle catches every path without each caller having to
// remember, and the story-grant path writes immediately.
let lastCollectionSnapshot = null;
let collectionSweepTick = 0;
function sweepCollectionSave() {
    if (++collectionSweepTick % 120 !== 0) return; // ~2 s at 60 Hz
    const snap = collectionSnapshot();
    if (snap === lastCollectionSnapshot) return;
    lastCollectionSnapshot = snap;
    persistCollection();
}

function scheduleFieldLocationSave() {
    if (locationSaveTimer != null) return;
    locationSaveTimer = setTimeout(() => {
        locationSaveTimer = null;
        saveFieldLocation();
    }, 750);
}

window.addEventListener("pagehide", saveFieldLocation);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveFieldLocation();
});

async function startGame(mapId = null) {
    state.playerName ||= "Junior";
    const saved = mapId
        ? null
        : decodeFieldLocation(localStorage.getItem(FIELD_LOCATION_KEY), knownStageIds);
    const targetId = mapId ?? saved?.mapId ?? knownStageIds[0];
    const idx = state.manifest.maps.findIndex((m) => m.id === targetId);
    if (saved?.entranceReturn) {
        const scene = state.scenes[targetId];
        scene.exits = (scene.exits ?? []).filter((exit) => !exit._entranceReturn);
        scene.exits.push(saved.entranceReturn);
    }
    await prepareStageAssets(targetId);
    state.started = true;
    canvas.hidden = false;
    document.getElementById("hud").classList.add("visible");
    setMap(idx >= 0 ? idx : 0, saved);
    checkStageCutscene(currentMap().id);
    requestAnimationFrame(frame);
}

// The player is Junior in one of two sprite sets. The cast rebuild F0x8008aa10
// builds charId 2 (P002PLAY) unless a charId-1 cast record passes its flag
// list (state.playerCharOne, set on stage entry), which builds P001PLAY.
//
// P002PLAY is also the pack the clip rule names for the standing clip: the
// resolver stores 0x01870070 for clip < 8, and the constructor's own `+0x9c` for
// npc_id 2 is that same constant. So the base pack is read from the rule too.
function currentChar() {
    if (state.playerCharOne) return state.manifest.characters[0];
    return playerPackMeta(playerPackForClip(FIELD_IDLE_CLIP)) ?? state.manifest.characters[0];
}
// Stage entry: does a charId-1 record of this stage's cast list pass? Records are
// tried in cast-list order; a list passes iff every get_flag(id) == expected
// (F0x80016924). tools/extract_player_cast_one.py. Missing data: null.
function evaluatePlayerCharOne(stageId) {
    const lists = state.playerCastOne?.[stageId];
    if (state.playerCastOne == null) return null;
    if (!lists) return false;
    return lists.some((list) => list.every((c) => storyFlags.matches(c.id, c.expected)));
}
function manifestIndexOf(charId) {
    return state.manifest.characters.findIndex((c) => c.id === charId);
}
function currentMap() {
    return state.manifest.maps[state.mapIdx];
}

// Ladder climbing — the DECODED player climb state machine (fieldstg modes
// 0x43/0x44, mount methods 0x8008f128/0x8008f1d4, movement handler at file
// 0xd818/0xd878; sprite pack p002plyl):
//   mount: snap to the endpoint, climb offset = 0 (bottom) / height (top),
//          hang anim (clip 32)
//   hold up   -> clip 26, offset += 0x100/frame (1 px per 60fps frame)
//   hold down -> clip 27, offset -= 0x100/frame
//   up branch reaching height -> dismount at top (mode 0x45, clip 28)
//   down branch reaching 0    -> dismount at bottom (mode 0x46, clip 28)
// The player is drawn from the dedicated ladder sprite (p002plyl) while
// mounted — the same swap the PS1 does.
const CLIMB_SPEED = 60; // px/s = +0x100 (1px<<8) per 60fps frame, decoded
// Clip lengths, in ticks at the 60 fps animation clock (build_assets durations):
// clip 28 (0x1c, bottom step-on) 4+4+4+4+3; clip 30 (0x1e, head step-on) 4x5;
// clip 29 (0x1d, top step-off) 3+1x10+6+6; clip 31 (0x1f, bottom step-off) 3+3+3+4.
const MOUNT_SECS_BOTTOM = 19 / 60;
const MOUNT_SECS_TOP = 20 / 60;
const DISMOUNT_SECS_TOP = 25 / 60;
const DISMOUNT_SECS_BOTTOM = 13 / 60;

// The rail the PLAYBACK executor's record names. The op-2/op-3 handler passes
// params[0] (the ladder id) and the endpoint cell params[1]/params[2] straight to
// the player actor (fieldstg.s:5a80/:5ac0), so the record — not a radius test — is
// what says which rail and which end. 213 of the 216 shipped ladder rows carry
// exactly these values (id and both endpoint coordinates); the other three are the
// rows whose bottom cell is armed by an op-8/op-6 tile, which the disc never mounts
// either. Matched by id first, then by the endpoint's own coordinates.
function ladderRowForRecord(scene, effect) {
    const args = effect?.actorCall?.args;
    if (!args) return null;
    const id = effect?.op === 3 ? null : args[3] / 16 + 1; // op 2/3 carry (param0-1)*16
    const x = args[1];
    const y = args[2];
    let byCoord = null;
    for (const L of scene?.ladders ?? []) {
        for (const [pt, isTop] of [[L.bottom, false], [L.top, true]]) {
            if (pt.x !== x || pt.y !== y) continue;
            if (!byCoord) byCoord = { L, pt, isTop };
            if (id !== null && L.id === id) return { L, pt, isTop };
        }
    }
    return byCoord;
}

// PRESS on a step tile. This is the shared reading of "what does this tile do when
// the player presses it": the disc's playback executor `0x800885d4`, with the
// driver's own gates in front of it (fieldstg.s:5bd8-5d84) — the handoff guard
// words, step-load's liveness, and Circle HELD. engine/systems/scene-step-ops.ts
// carries the op table (file 0x1e8) and engine/systems/trigger-system.ts the gates.
// Doors, ladders and the dive all come through here; nothing reads the step program
// on its own any more.
function stepPlayback(x = state.x, y = state.y, circleHeld = true) {
    const ts = engineTriggerSystem;
    if (!ts) return null;
    return ts.playback(currentMap().id, x, y, fieldDirectionIndex(state.dir), circleHeld);
}

// The disc's SETUP arm, one frame — `step-load` then `step-exec`
// (fieldstg.s:5c94-:5cb8) — with no button read anywhere in it. This is what a
// tile that fires on contact asks: a launch pad (setup op 13) is the live case
// today. engine/systems/trigger-system.ts carries the rule and the citations.
function stepSetup(x = state.x, y = state.y) {
    const ts = engineTriggerSystem;
    if (!ts?.setup) return null;
    return ts.setup(currentMap().id, x, y, fieldDirectionIndex(state.dir));
}

// Op 4 — PRESS on a slope tile. The disc's actor slot +0x11c (file 0xc5d0) is not a
// "move here" call: it switches Junior into mode 0x47 and lets the mode block do the
// walking. Which way he steps and how far he drops come out of the record through the
// port, so a stage supplies only its step program — there is no per-place row here.
function startSlopeStep() {
    const pb = stepPlayback();
    const plan = pb?.effect?.actorAction;
    if (!pb || !pb.live || !plan || plan.kind !== "slope") return false;
    if (state.slope) return false;
    state.slope = startSlope(plan, { x: state.x, y: state.y });
    state.moving = false;
    state.stopping = false;
    return true;
}

// Op 14 — PRESS on a launch-pad handoff tile. The disc's op-14 handler
// (fieldstg.s:5a30-5a7c) is TWO calls in the SAME frame:
//
//   :5a30 lw $a0,0x58($s0) / :5a38 lw $v0,0x158($a0) / :5a40 jalr
//        actor->vt[0x158](actor, &record[0xa])   the pad walk — the SAME method
//        setup op 13 calls, so engine/systems/launch-pad.ts is the port
//   :5a48..:5a74 jal 0x8008b6d4(id, -1, x<<8, y<<8, facing, 0x3c)
//        the stage handoff, with ONE extra argument
//
// and that extra argument is the whole difference from an ordinary door.
// 0x8008b6D4 (file 0x8a24) stores it into the type-7 scene object's `+0x68`
// (:8a78/:8a84) and calls setPhase(2); the phase-2 handler then spends it —
// `+0x68 -= GetTick()` at :89ac, and the destination is loaded only on the frame
// the word has reached 0 (:8984 `bgtz` -> :8994 the load). Op 1 reaches the same
// body through the wrapper 0x8008b770, whose `sw $zr,0x14($sp)` at :8acc passes
// ZERO, so a door changes stage immediately and an op-14 tile does not.
//
// So the handoff does NOT wait for the walk: both start together, the walk gets
// the 60 ticks, and 60 is shorter than the pad's own 106-tick charge
// (PAD_ANIM_FRAMES), so the screen normally changes before the flight would have
// begun. Nothing here is per-place — the destination is the record's own five
// fields, and the screen id resolves through the same screenRouter the story
// handoff uses (engine/dw3/screen-routing.ts over web/assets/data/screen_table.json).
function startPadHandoff() {
    const pb = stepPlayback();
    if (!pb || !pb.live || !pb.op || !isStageChangePlayback(pb.op)) return false;
    // Only op 14 walks a pad first. Op 1's actor half is vt[0x110] (a turn) and its
    // handoff goes through the ordinary door row in activeExitAt().
    if (pb.effect?.padSlot === undefined) return false;
    const h = pb.effect.handoff;
    if (!h) return false;
    if (state.handoffHold || state.launch || fade.dir !== 0) return false;
    const routed = screenRouter.route(h.args[0], currentMap().id);
    if (routed?.kind !== "warp") return false;
    const to = routed.to;
    const exit = {
        to,
        // The handoff hands the spawn cells over already shifted (fieldstg.s:5a68/
        // :5a6c `sll 2`), and the arriving actor's spawn reads those words back with
        // `sra 8` (fieldstg.s:0xe76c/:0xe770), so the cell is the argument's high half.
        spawnX: h.args[2] >>> 8,
        spawnY: h.args[3] >>> 8,
        dir: fieldDirectionFromIndex(h.args[4] & 7),
        stepOp: pb.op,
    };
    const pad = nearestPad(launchPads(currentMap()?.id), { x: state.x, y: state.y });
    state.launch = startLaunch(exit, { x: state.x, y: state.y }, pad);
    state.iceSlide = null;
    state.moving = false;
    state.stopping = false;
    // Native: the actor method sets facing 0 before installing the handler.
    state.dir = "down";
    // The hold the disc seeded scene_obj+0x68 with — the op table's own sixth
    // argument, read through the port so this cannot drift from fieldstg.s:5a60.
    state.handoffHold = { ticks: h.holdTicks, exit };
    return true;
}

function startLadderClimb(scene) {
    // Which rail, which end and which side all come from the step record now. The
    // old private reading (a 22px radius over scene.ladders plus its own read of the
    // grid byte's facing group) is gone: it could arm a ladder the tile does not
    // name and could miss one it does.
    const pb = stepPlayback();
    if (!pb || !pb.live || !pb.effect || !isLadderPlayback(pb.op)) return null;
    const hit = ladderRowForRecord(scene, pb.effect);
    if (!hit) return null;
    const { L, pt, isTop } = hit;
    const fromBottom = !isTop;
    // The facing the mount hands the player actor, read out of the port's own
    // actor call — `a1`, which both mount bodies store into `entity+0x60`
    // (pro/fieldstg.s:12601 `sw $s3,0x60($s4)` bottom, :12644 top). Op 2 passes its
    // own group straight through (:5808) and op 3 passes 5 when the group is 1 and
    // 3 otherwise — the `li $a1,0x3` is the `bne`'s DELAY SLOT (:5819/:5820) — so
    // the shipped bottom tiles (group 3/5) mount up-left/up-right and the top
    // tiles (group 1/7) mount up-right/up-left.
    // It is one word doing two jobs: the climb sprite's side (both mounts pick it
    // with `beq $s3,$v0(=5)` at :12605/:12648 into entity+0x8c), and the facing
    // the step gate reads back — so the old two-way guess off the group got 309
    // of the 429 armed rail ends mirrored the wrong way.
    const facing = ladderMountFacing(pb.effect);
    if (facing == null) return null;
    const dirStr = fieldDirectionFromIndex(facing);
    // The climb's own geometry: the rail x (the foot's x from the bottom, the head
    // cell ± 16 by the side word from the top), the rail's foot ground row, the
    // drawn start row, and the climb length = the record's `(params[0]-1)<<4`
    // (actorCall.args[3]) — NOT the endpoint span. The census over all 216 shipped
    // rails has span = height + 24 for 132 of them (+13..+28 for the rest); the
    // last 24 px are the dismount step-off, not climb. engine/systems/
    // scene-step-ops.ts carries the full citations.
    const recordHeight = pb.effect.actorCall?.args?.[3] ?? 0;
    const plan = ladderClimbPlan(L.bottom, L.top, facing, fromBottom, recordHeight);
    state.climb = {
        bottom: L.bottom,
        top: L.top,
        plan,
        x: plan.railX,
        baseY: plan.baseY,
        height: plan.height,
        side: plan.side,
        fromBottom,
        progress: fromBottom ? 0 : plan.height,
        // The mount plays its own step-ONTO-the-rail clip first: the bottom mount
        // hands over mode 0x43 = clip 0x1c (28), the head mount mode 0x44 = clip
        // 0x1e (30). Both then hand over to mode 0x40, the hang (clip 0x20 = 32).
        phase: "mount",
        clip: fromBottom ? 28 : 30,
        animT: 0,
        dirStr,
    };
    // The mount's own drawn row: the bottom mount pins the foot cell; the head
    // mount's step-on moves x onto the rail and its first drawn row is
    // head.y + 24 (mode 0x44's `+0x1800 + +0x94` base, offset seeded to height).
    const at = ladderClimbPosition(plan, state.climb.progress);
    state.x = at.x;
    state.y = at.y;
    // entity+0x60 is that same word, not a generic "up": the disc's mount writes
    // the facing it was handed (pro/fieldstg.s:12601), and the step-load under
    // the player reads it back on the next frame (:5546) to decide whether the
    // tile is still armed.
    state.dir = dirStr;
    return true;
}

// ── Fire Dungeon floor trap helpers (engine/systems/fire-trap.ts) ───────────
//
// The controller walks its party-actor key table and hits ONE walking Digimon
// per step, in order. Party index i is the i'th Digimon trailing the tamer, so
// its field position is followers[i] and its stored stats are the same slot the
// status menu shows: index 0 is the LEAD (state.partnerStats, the block battles
// level), 1.. are the trailing members' own persisted slots.
function fireTrapPositionOf(partyIndex) {
    if (partyIndex >= activeFollowerCount()) return null;  // slot not walking
    const f = followers[partyIndex];
    return f ? { x: f.x, y: f.y } : null;
}

function forcePartyMemberToOneHp(partyIndex) {
    const stats = partyIndex === 0
        ? state.partnerStats
        : state.partyStats?.[partyIndex];
    if (!stats) return;
    // The original stores the literal 1 into cur_hp — it is not damage, and it
    // cannot kill: the party comes out of the room alive on 1 HP each.
    stats.hp = 1;
    if (partyIndex === 0)
        localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
    else if (state.partyStats)
        localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
}

// The shared ambush latch (bank 0, bit 15). Read by all fourteen tiles' step
// records and set by the routine that starts the fight; cleared on stage entry.
const AMBUSH_LATCH_FLAG = 0x0f;

// Fight the ambush tile's encounter. Its screen id comes out of the stage's own
// scripted encounter block, so this is the ordinary field-battle path with the
// roll replaced by a fixed screen — same 1v1 rule as a wild walk-up encounter
// (every one of the fourteen resolves to a single Digimon).
function startAmbush(mapId, tile) {
    startFieldBattle(() => battle.startScreen(
        tile.screenId,
        (res) => presentVictory(res),
        null, // flee: the tile has already latched, so it does not re-fire
        gameOverToTitle,
        { mapId },
    ));
}

async function flushStoryBattle() {
    if (state.pendingStoryBattleIndex == null || engineBridge?.isBusy() || battle.isActive()
        || textbox.isOpen() || cutscene.isActive() || fade.dir !== 0) return;
    const index = state.pendingStoryBattleIndex;
    const npc = state.pendingStoryBattleNpc;
    state.pendingStoryBattleIndex = null;
    state.pendingStoryBattleNpc = null;
    const mapId = currentMap().id;
    const screenId = await battle.scriptedScreen(mapId, index);
    if (!screenId) throw new Error(`scripted encounter ${mapId} index ${index} has no decoded screen`);
    const wonFlag = engine?.battleResultFlag(screenId);
    // The disc's bank-0x74 launcher (F0x800927a0 -> battle setup F0x8008b798) returns the
    // player to the field on any non-loss outcome, and re-entering the field runs the stage's
    // OWN arrival chain again (that is why the win arm below calls `onStageEnter`). The
    // story's next beat therefore plays whether the fight was won OR fled; only the victory
    // screen and the battle-result flag are win-only. The s480 Zanbamon fight is the case
    // that needs the flee arm: it is a scripted, UNWINNABLE battle (WFIGHTMN mode 2 floors
    // the player's damage at maxHP/11, pro/wfightmn.s 0x4e50-0x4ee4) whose own following
    // scene has the player RUN AWAY (web/assets/events/esdmg400.json entry 9, "What, you're
    // running away in the middle of the battle?"). The original's exit presenter returns to
    // the field for a flee and to the title only for a real loss (WFIGHTMN 0x800a7f54).
    const advanceStory = () => {
        if (engineBridge) {
            engineBridge.onStageEnter(mapId);
            if (npc != null && !engineBridge.isBusy()) engineBridge.onTalk(npc);
        }
    };
    startFieldBattle(() => battle.startScreen(screenId, (res) => {
        presentVictory(res);
        if (wonFlag != null) engine.state.flags.set(wonFlag, true);
        advanceStory();
    }, advanceStory, gameOverToTitle, { mapId, lead: false }));
}

// ---------------------------------------------------------------------------
// Fishing (engine/systems/fishing.ts, tools/extract_fishing_spots.py).
//
// A fishing spot is an op-7 step record gated on FishingPole possession, so the
// spots simply are not there until you own the pole — the same read the step VM
// does. Standing on one and pressing the action key casts; pressing again while
// the marker is sweeping strikes.
//
// The original casts and strikes with the SAME pad bit: the cast is the confirm
// press the step VM's driver runs on (bit 0x2000, held), and the strike is that
// same bit read inside the bobber's own tick (file 0xa6f0-0xa700, the only pad
// read in all 306 instructions of it). Claim
// `a-fishing-strike-is-the-confirm-button-s-own-bit-2026-10-05`: what the pad
// calls circle sends 0x1000 and never strikes. The walker's confirm key carries
// that bit here too; the Back key (`x`) is a different bit and must not strike.
//
// While the cast runs the player is NOT Junior's ordinary sprite. Mode 0x48
// swaps him to P002PLYF and plays five clips off it (engine/systems/fishing.ts,
// "The angler"); the rod, the line and the float's flight are drawn into those
// frames, which is why the separate float object stays hidden until the cast has
// settled.

/**
 * The fishing spot under the player, or null.
 *
 * WHETHER a spot exists is the playback executor's answer, not a private reading:
 * an op-7 step is armed by the grid byte, the facing cone (fieldstg.s:5648-5680) and
 * the record's own two flag conditions (fieldstg.s:56d4-5738) — all three reproduced by
 * trigger-system's `playback()`. The rod requirement IS that flag condition: every op-7
 * record in the shipped corpus carries `cond_a = 0x8005 / arg_a = 1`, and 0x8005 is item
 * 5 (the FishingPole) in the bag, so standing on a spot with no rod leaves the tile dark
 * and the press does nothing.
 *
 * `fishing_spots.json` is left holding the float's landing offset and the two catch
 * parties — the encounter-block data, which is a different table from the step record.
 */
function fishingSpotHere() {
    const pb = stepPlayback();
    const plan = pb?.effect?.actorAction;
    if (!pb || !pb.live || !plan || plan.kind !== "castPose") return null;
    return fishingSpotAt(state.fishingSpots?.[currentMap().id], pb.step);
}

/**
 * Start the special block actors' interaction (npc 328/351/352) — the engage
 * branch fieldstg F0x8008E2CC, called from the player's confirm path behind the
 * Submarimon depth gate. It refuses a target already in its 0x4e mode and
 * refuses anything but the three ids; the walker also refuses to start a
 * second scene while one runs, because the field lock is up for the first.
 * Returns true when the press was consumed.
 */
function startBlockInteraction(npc) {
    if (state.blockEngage) return true;
    const ix = engageBlock(npc.npc_id);
    if (!ix) return false;
    state.blockEngage = { ix, npc };
    return true;
}

/**
 * The strike's pad bit by the walker's button name: `circle` IS bit 0x2000
 * (engine/systems/input-map.ts `PAD_BIT`), the confirm bit the bobber reads
 * (`STRIKE_BUTTON`). In English that bit is what the physical Cross sends; the
 * button the pad calls circle sends 0x1000 and never strikes (claim
 * `a-fishing-strike-is-the-confirm-button-s-own-bit-2026-10-05`). The same
 * name is the field's confirm press, so the cast and the strike are one button.
 */
const FISH_STRIKE_BIT = "circle";

/** Cast at `spot`, spending one of this map's sixteen catches. */
function startFishingCast(spot) {
    const r = startFishing(state.fishingBudget ?? FISHING_BUDGET, () =>
        Math.floor(Math.random() * 0x10000),
    );
    state.fishingBudget = r.budget;
    // The float lands at the spot's own offset from where you are standing —
    // params[0..1] of the step record, added to the controller's position by
    // F0x8008f304 (fieldstg file 0xc6c8).
    state.fishing = {
        run: r.state,
        x: state.x + spot.dx,
        y: state.y + spot.dy,
        strike: false,
        // The angler. `dir` is whatever Junior was facing — mode 0x48 never
        // touches the entity's facing field, and SETANIM's two-argument form
        // (the one that would) is not the one this mode calls.
        pose: startFishingPose(),
        poseT: 0,
        dir: state.dir,
        // The cast controller's own mode reaching 0 — what sub-state 3 waits on.
        castOver: false,
        // The result balloon sub-state 3 opens and sub-state 4 closes. It is the
        // same balloon actor the story bubbles use (F0x80088144(0, 1, 6), file
        // 0xdd54), so its lifetime is the only thing the pose has to supply: it
        // pops, holds, and — after the close command — plays its close out
        // before it stops drawing.
        result: null,
        // Band the cast resolved to, held until the angler has stood back up —
        // the original starts the fight after this whole sequence, not during it.
        pending: null,
    };
    state.moving = false;
    state.stopping = false;
}

/** The P002PLYF manifest record, or undefined if the pack did not load. */
function fishingSpriteMeta() {
    return playerPackMeta(playerPackForClip(POSE_CAST_CLIP));
}

/**
 * The manifest record for whichever of the player's five packs a clip id
 * resolves through — the original's own rule (engine/systems/player-clip-packs.ts,
 * read out of FIELDSTG's clip resolver F0x8008F9C0). Every player mode that
 * latches a clip asks here, so the fishing cast, the ladder, the slope step and
 * the tree kick all reach their pack by the same table instead of by name.
 */
function playerPackMeta(packId) {
    return state.manifest.npcs?.find((n) => n.id === packId);
}

/**
 * Land the catch: a battle, never an item.
 *
 * There is no drop table anywhere in the fishing code. The bobber calls
 * F0x800927a0 with the band it stopped on, and that routine reads the stage's
 * scripted (rate-0) encounter block — `[[scene+0x20] + 0x18] + 4 + 4*slot` —
 * and hands the screen id to F0x8008b798, the ordinary battle-setup path. Band 1
 * takes slot 4, which is a Cardmon on every one of the forty-six fishing
 * stages; band 2 takes slot 7, the area's big water Digimon.
 */
function startFishingCatch(mapId, slot) {
    const rec = state.fishingSpots?.[mapId]?.catch?.[String(slot)];
    if (!rec) return;
    startFieldBattle(() => battle.startScreen(
        rec.screenId,
        (res) => presentVictory(res),
        null, // flee: the cast is already spent
        gameOverToTitle,
        { mapId },
    ));
}

// ---------------------------------------------------------------------------
// Tree kicking (engine/systems/tree-kick.ts, tools/extract_tree_kick.py).
//
// With the TreeBoots on, the action button kicks the tree 16 pixels in front of
// you. One tree per stage is live: kick that one and a Digimon drops out and the
// live marker jumps elsewhere; kick any other and a radar card tells you how far
// off the live one is. This is the DEFAULT field handler on PS1 — it only gets
// the button when nothing else (NPC, zone, ladder, door) has claimed it.

const rand16 = () => Math.floor(Math.random() * 0x10000);
// The annotator delay walk spends the resident random every blank and clamps it
// to 4 (wstag820.s:267-275, wstag805.s:44-46). The resident source is the one
// 16-bit word every other field cue draws, not a constant: the walk's own speed
// is the game's, so a marker lights on the frame the disc's script picks, not on
// a fixed one. Registered here, beside the declaration, because reading the
// binding above its own `const` kills the whole module.
setAnnotatorRandom(rand16);

/** This stage's tree table, or null. */
function treeStage(mapId = currentMap().id) {
    return state.treeStages?.[mapId] ?? null;
}

/**
 * The occupancy query at ONE probe point (F0x80092a90): occupied when the point
 * lies inside a standing field actor's footprint diamond `|dx| + 2|dy| <=
 * halfWidth` or within 10 px of a tree (F0x8008ce40, treeIndexAt). Reads the
 * same live NPC list and tree table the draw uses, so what blocks is what you
 * see. The player is never in the list.
 */
function fieldPointOccupied(m, px, py) {
    const scene = state.scenes[m.id];
    const npcs = scene?.npcs
        ? chapterNpcs(scene.npcs, state.chapter, storyFlags.get)
        : [];
    if (actorFootprintBlocked(npcs, (n) => npcHalfWidth(n.npc_id), px, py)) return true;
    const trees = treeStage(m.id)?.trees ?? null;
    return !!(trees && treeIndexAt(trees, { x: px, y: py }) != null);
}

/**
 * The disc's obstacle response at a post-step position: F0x8008dfec's five
 * probes for the actor's CURRENT facing (`fieldProbePushback`), each BLOCKED
 * point pushing the actor back by its own (∓mag/2, ∓mag/4) — never a step
 * revert, and never a point behind the actor, so walking away from an obstacle
 * is always allowed. A point is blocked the way F0x8008de0c blocks it:
 * occupancy (F0x80092a90 actor diamonds + F0x8008ce40's ±10 box) OR the terrain
 * half — the zonemgr+0x44 typed-terrain byte at the point (F0x80092914, called
 * with the current-type word, 0 in every shipped stage) under the form's height
 * band (`terrainGateBlocks`; only Submarimon carries a height, actor+0x64).
 * Returns the vector to SUBTRACT (F0x8008de0c's arg3/arg4).
 */
function fieldStepObstaclePush(m, grid, x, y, magnitudeFixed, heightFixed) {
    return fieldProbePushback(
        fieldDirectionIndex(state.dir),
        magnitudeFixed,
        x,
        y,
        (px, py) => fieldPointOccupied(m, px, py)
            || (grid ? terrainGateBlocks(grid, px, py, heightFixed) : false),
    );
}

/** Whether the player's 12×8 foot box at (x,y) overlaps a blocked walkmesh cell. */
function boxStuck(grid, x, y) {
    return !!grid && rectBlocked(grid, x - 6, y - 8, x + 6, y);
}

/**
 * Re-roll the live tree, which the original does on ARRIVAL at a map whose id
 * differs from the one it last recorded (fieldstg file 0x4878: `[0x26dc]` holds
 * that id, and only a mismatch sets the re-roll flag `[0x26d8]`). Coming back to
 * the same map — walking in from a battle — keeps the marker where it was.
 */
function reseedLiveTree(mapId) {
    const stage = treeStage(mapId);
    if (!stage) {
        state.treeLive = null;
        return;
    }
    if (state.treeLive?.stage === mapId) return;
    state.treeLive = {
        stage: mapId,
        index: relocateActiveTree(stage.trees.length, rand16),
    };
}

/** Kick the tree in front of the player, if there is one. */
function tryTreeKick() {
    if (state.treeKick || storyFlags.get(TREE_BOOTS_FLAG) === 0) return false;
    const stage = treeStage();
    if (!stage) return false;
    // setMap can run before tree_kick.json has landed; seeding here as well
    // keeps the very first map's live tree from staying unset.
    reseedLiveTree(currentMap().id);
    const facing = fieldDirectionIndex(state.dir);
    const index = treeIndexAt(stage.trees, treeActionPoint(state.x, state.y, facing));
    if (index == null) return false;
    state.treeKick = { run: startTreeKick(index, facing), rec: stage.trees[index].rec };
    state.moving = false;
    state.stopping = false;
    sfx.playPacked(KICK_SOUND, { overlap: true });
    return true;
}

/**
 * Advance the kick (and the radar card, which outlives it) by `ticks` frames.
 * Returns true while Junior's own kick ANIMATION is still playing — leader mode
 * 0x49 owns his input for exactly as long as clip 8 runs (31 ticks authored;
 * see the unresolved 31/28/27 note in engine/systems/tree-kick.ts).
 */
function advanceTreeKick(ticks) {
    const mapId = currentMap().id;
    const stage = treeStage(mapId);
    for (let t = 0; t < ticks; t++) {
        if (state.treeRadar && !tickTreeRadar(state.treeRadar)) state.treeRadar = null;
        const k = state.treeKick;
        if (!k || !stage) continue;
        const live = state.treeLive?.index ?? 0;
        const tree = stage.trees[k.run.index];
        const liveTree = stage.trees[live] ?? tree;
        const cue = tickTreeKick(k.run, {
            count: stage.trees.length,
            liveIndex: live,
            liveX: liveTree.x,
            liveY: liveTree.y,
            kickedX: tree.x,
            kickedY: tree.y,
        }, rand16);
        // The manager pokes the kicked tree's point record every frame; every
        // other tree is held on its resting cell, which it already is here.
        setPointSprite(mapId, k.rec, k.run.shake.sprite);
        if (cue.kind === "radar") {
            state.treeRadar = cue.radar;
        } else if (cue.kind === "encounter") {
            // The live marker moves BEFORE the fight loads, so it is already
            // somewhere else when you walk back in.
            state.treeLive = { stage: mapId, index: cue.relocateTo };
            setPointSprite(mapId, k.rec, TREE_SPRITE_IDLE);
            state.treeKick = null;
            // The field (radar card included) tears down as the fight loads.
            state.treeRadar = null;
            startTreeEncounter(mapId, cue.slot);
            return false;
        }
        if (k.run.done) {
            setPointSprite(mapId, k.rec, TREE_SPRITE_IDLE);
            state.treeKick = null;
        }
    }
    return treeKickHoldsInput(state.treeKick?.run);
}

/** The P002PLYK manifest record, or undefined if the pack did not load. */
function treeKickSpriteMeta() {
    return playerPackMeta(playerPackForClip(KICK_POSE_CLIP));
}

/**
 * What fell out of the live tree — a battle out of the stage's own scripted
 * (rate-0) encounter block, the same block the ambush tiles and fishing read.
 * Slot 3 is the near roll (102/128), slot 6 the far one (26/128).
 */
function startTreeEncounter(mapId, slot) {
    const rec = state.treeStages?.[mapId]?.encounters?.[String(slot)];
    if (!rec) return;
    startFieldBattle(() => battle.startScreen(
        rec.screenId,
        (res) => presentVictory(res),
        null, // flee: the tree has already dropped it
        gameOverToTitle,
        { mapId },
    ));
}

// The raw type-7 trigger byte at map position (x,y), or null off the grid. Low 5
// bits = step index, top 3 = required approach-facing group (step-load 0x80088288).
function storyGridCellAt(x, y) {
    const g = state.storyGrids?.[currentMap().id.replace(/^s/, "")];
    if (!g) return null;
    if (g.uniform != null) return g.uniform;
    const cx = Math.floor(x / g.cell);
    const cy = Math.floor(y / g.cell);
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return null;
    return g.grid[cy * g.w + cx] ?? null;
}

// Per-frame climb driver. The disc's own sequence, in order: the mount's
// step-onto-the-rail clip (mode 0x43 bottom = clip 0x1c, mode 0x44 head = clip
// 0x1e), then mode 0x40's hang (clip 0x20) while up/down move the offset along
// the rungs, then the step-off clip (mode 0x45 top = clip 0x1d, mode 0x46
// bottom = clip 0x1f). The step-off's landing shift is applied on ITS
// completion, not at its start — the clip's own art carries the visual move.
// Returns true while mounted.
function tickClimb(dt) {
    const c = state.climb;
    if (!c) return false;
    state.moving = false;
    const k = state.keys;
    if (c.phase === "mount") {
        // The step-on plays out first; up/down are not read yet (the mount modes
        // hand over to mode 0x40 only when their own clip has run out).
        c.animT += dt;
        if (c.animT >= (c.fromBottom ? MOUNT_SECS_BOTTOM : MOUNT_SECS_TOP)) {
            c.phase = "climb";
            c.clip = 32; // mode 0x40, the hang
            c.animT = 0;
        }
        return true;
    }
    if (c.phase === "dismount") {
        c.animT += dt;
        if (c.animT >= (c.atTop ? DISMOUNT_SECS_TOP : DISMOUNT_SECS_BOTTOM)) {
            // The completion applies the step-off: mode 0x45 moves x 16 px
            // against the side word and drops y by 24 + height, landing on the
            // head cell (fieldstg.s:14017-14030); mode 0x46 moves nothing and
            // only stores 0 into entity+0x60 (:13983), so the player comes off
            // the foot facing down.
            const done = c.atTop ? "top" : "bottom";
            const land = ladderDismountEnd(c.plan, c.atTop);
            state.x = land.x;
            state.y = land.y;
            if (done === "bottom") state.dir = fieldDirectionFromIndex(0);
            state.climb = null;
        }
        return true;
    }
    const up = k.has("up");
    const down = k.has("down");
    let clip = 32;
    let done = null;
    if (up && !down) {
        clip = 26;
        c.progress += CLIMB_SPEED * dt;
        if (c.progress >= c.height) {
            c.progress = c.height;
            done = "top";
        }
    } else if (down && !up) {
        clip = 27;
        c.progress -= CLIMB_SPEED * dt;
        if (c.progress <= 0) {
            c.progress = 0;
            done = "bottom";
        }
    }
    // Climb creak SFX, fieldstg 0x8008fe68 (file 0xd1b8): fires every 16
    // ticks (60fps) while the climb offset is actually moving.
    if (clip === 26 || clip === 27) {
        c.creakT = (c.creakT ?? 0) + dt;
        if (c.creakT >= 16 / 60) {
            c.creakT -= 16 / 60;
            sfx.play("player01");
        }
    } else {
        c.creakT = 0;
    }
    if (clip !== c.clip) {
        c.clip = clip;
        c.animT = 0;
    } else {
        c.animT += dt;
    }
    // Straight up the rails: x pinned at the rail (c.x = plan.railX, the mount's
    // own decoded word entity+0x50), y from the offset (entity+0x54 - entity+0x90
    // at draw, file 0xe3d8-0xe3fc).
    const at = ladderClimbPosition(c.plan, c.progress);
    state.x = c.x;
    state.y = at.y;
    if (done) {
        // The step-off clip plays IN PLACE at the end of the climb; the landing
        // shift happens on its completion (above). Climbing down faces you down
        // when the clip finishes; climbing up keeps the mount's facing, so the
        // head tile is not armed until you turn.
        c.phase = "dismount";
        c.atTop = done === "top";
        c.clip = c.atTop ? 29 : 31;
        c.animT = 0;
    }
    return true;
}

// Bug-maze trap pads: returns the reset point {x,y,dir} if (x,y) is on a bugged
// floor cell, else null. `pads` is the scene's trapPads block (cell-grid mask).
function hitTrapPad(pads, x, y) {
    if (!pads) return null;
    const c = Math.floor(x / pads.cell),
        r = Math.floor(y / pads.cell);
    if (r < 0 || r >= pads.rows || c < 0 || c >= pads.cols) return null;
    return pads.mask[r][c] === "1" ? pads.reset : null;
}

// Ice Dungeon slippery floor: classify the tile under (x,y) from the scene's
// `iceSlide` block (gen_scenes.ice_slide_regions -- the type-7 trigger cells whose
// step record is op 11 / op 12). Returns {start:dirIndex} on a glide-entry cell,
// {stop:true} on a stop cell, else null. See engine/systems/ice-slide.ts.
function iceSlideCellAt(slide, x, y) {
    if (!slide) return null;
    const c = Math.floor(x / slide.cell),
        r = Math.floor(y / slide.cell);
    for (const [tx, ty] of slide.stop) if (tx === c && ty === r) return { stop: true };
    for (const [tx, ty, dir] of slide.start) if (tx === c && ty === r) return { start: dir };
    return null;
}

// An NPC's line is the ptrB dialogue STATE machine (talk handler F0x80090afc, §WS5):
// the FIRST `dialogue_state` whose flag `gate` passes against the live banked store, shown
// as estalk00[id]; its `on_close` set_flags are applied when the box closes (advancing the
// NPC's state). Manual/ifFlag NPCs (hand-authored `dialogue`, no states) fall back.
// Returns a state-shaped object { dialogue, on_close? } or null (non-speaking variant).
function pickDialogueFor(npc, flags) {
    return selectNpcDialogue(npc, storyFlags.get, flags);
}

// Encounter rate is now governed by the authentic data: stages with no zone pool
// (city interiors, story maps) return no encounter, and a zone's empty slots are the
// real per-step miss chance (e.g. s200 zone 1 = 3/8 non-empty ≈ 37%). So we always roll
// the selector on a step-counter expiry and let the data decide. See web/encounters.js.
// The fight-report overlay already showed EXP / Level / Tech / Digivolve learned.
// A newly unlocked form is in the ledger (and auto-equipped if a slot was free);
// the player turns it on from STATUS, not from a second field prompt.
function presentVictory(_res, after) {
    after?.();
}

// ── THE SHARED field→battle handoff ─────────────────────────────────────────
// Every field battle in the original enters through ONE battle host, fieldstg
// F0x8008b798: it sets the scene's transition bytes (`scene+0x58/+0x5C = 1`,
// docs/workflow/gameplay-playbook.md:1114-1116), and the field's phase-2
// stage-change dispatch then selects the A28 checkerboard (F0x80089F7C)
// precisely because `descriptor+0x5C != 0` — fieldstg.s file 0x895C:
// `lw $v0,0x5C($v1)` / `beqz` in front of the `jal F0x80089f7c`, else the A27
// iris `jal F0x8008a5e4`. So the wipe IS the shared handoff, not a
// random-encounter special case: the host has exactly three callers in
// fieldstg.s (file 0x92c4, 0xf99c, 0xfb34), reached by the walk-up/ambush
// selector F0x800925a8 and the scripted-encounter launcher F0x800927a0 — and a
// kicked tree and a landed fish both use F0x800927a0 (tree-boots doc:156-160,
// fishing doc:489-495). A walk-up, an ambush patch, a kicked tree, a fishing
// catch and a scripted story fight all play this ONE wipe. `update()` steps the
// shared schedule (web/stage-wipe.js) and runs `pending.run()` when it is spent;
// the old walker cut straight to the battle at every one of these sites.
//
// `?legacyBattleHandoff=1` keeps the old immediate cut, for the before/after
// capture (tools/verify_checkerboard_handoff.mjs).
function startFieldBattle(run) {
    if (USE_LEGACY_BATTLE_HANDOFF) { run(); return; }
    state.wipe28 = { ...createCheckerboard(), pending: { run } };
}

// EXPERIMENT: lets the optional quest layer launch a custom fight (real boss screens, or a stronger copy of one)
// through the same hand-off a random encounter uses, with the same guards. A LOSS returns to the field with the
// party restored (see below) instead of going to the title screen, because the title route belongs to the
// story's own fights.
function startQuestBattle(party, { screenId = null, onWin, onFlee, onLose } = {}) {
    if (
        fieldPartySize(state.party) === 0 ||
        battle.isActive() ||
        cutscene.isActive() ||
        textbox.isOpen() ||
        choice.isOpen() ||
        fade.dir !== 0 ||
        !!state.diveDemo ||
        !!state.wipe28
    )
        return false;
    const mapId = currentMap().id;
    // A lost challenge costs nothing: put the party's vitals back as they were before the fight (an optional
    // fight must not leave your lead at 1 HP for the rest of the session). Wins and runs keep the real outcome.
    const before = { lead: JSON.stringify(state.partnerStats), party: JSON.stringify(state.partyStats ?? null) };
    const restoreParty = () => {
        state.partnerStats = JSON.parse(before.lead);
        state.partyStats = JSON.parse(before.party);
    };
    startFieldBattle(() =>
        battle.startParty(party, (res) => presentVictory(res, () => onWin?.(res)), () => onFlee?.(), () => { restoreParty(); onLose?.(); }, { screenId, mapId }));
    return true;
}

// EXPERIMENT (multiplayer): a many-vs-many fight. I am its host: it runs on the same field hand-off as any other fight.
function mpbLaunch({ foes, withId, label, screenId, challenge, opts }) {
    if (!mpIdle() || fieldPartySize(state.party) === 0) return false;
    const done = (r) => { if (r.fled) opts?.onFlee?.(); else if (r.won) opts?.onWin?.({ ...r }); else opts?.onLose?.(); };
    startFieldBattle(() => {
        mpbHost({ foes, ids: [myId(), withId], label, screenId, challenge, done }).then((ok) => { if (!ok) done({ fled: true }); });
    });
    return true;
}
mpOn((type, d) => {
    if (type === "mpb") {
        if (d.d?.k === "setup" && mpIdle() && fieldPartySize(state.party) > 0) startFieldBattle(() => mpbMessage(d.from, d.d));   // the same hand-off for a friend's fight
        else mpbMessage(d.from, d.d);
    } else if (type === "leave") mpbPeerGone(d.id);
});

// EXPERIMENT (multiplayer co-op): a wild fight while teamed up spawns two Digimon from the same area's pool; the partner is
// invited to the same fight and the enemy's HP is shared. If the roll finds nothing there is no fight, as usual.
async function mpCoopRandom(mapId, x, y) {
    coopRolling(true);
    try {
        const a = await battle.rollEncounter(mapId, x, y);
        if (!a) return;
        const b = await battle.rollEncounter(mapId, x, y);
        const foes = [a.party[0], ...(b ? [b.party[0]] : [])];
        const go = (f, withId) => (withId ? mpbLaunch({ foes: f, withId, label: "Wild Digimon", screenId: a.screen ?? null }) : startQuestBattle(f, {}));
        if (!coopTry(foes, "Wild Digimon", go)) go(foes, null);
    } finally { coopRolling(false); }
}

function triggerRandomEncounter(mapId, x, y) {
    if (
        fieldPartySize(state.party) === 0 ||
        battle.isActive() ||
        cutscene.isActive() ||
        textbox.isOpen() ||
        choice.isOpen() ||
        fade.dir !== 0 ||
        !!state.diveDemo ||
        !!state.wipe28
    )
        return;
    if (coopReady()) { mpCoopRandom(mapId, x, y); return; }   // teamed up: two wild Digimon, and your partner can join
    startFieldBattle(() =>
        battle.startRandom(mapId, x, y, (res) => presentVictory(res), null, gameOverToTitle));
}

// The decoded loss route, once for every battle kind. wfightmn's loss branch
// (`pro/wfightmn.s` .L0x00003450-0x800a9230) plays the sound 0x60040008 — the
// `lui $a0, 0x6004` at .L0x00003458 and the delay slot `ori $a0, 0x8` at
// .L0x0000346c are one constant — and esmfight 0x53 "Annihilated...", runs the
// 0xF0-frame defeat effect, then the mode-2
// exit `F0x800a7c00` builds the fade object `F0x8008aaac` and calls `F0x8008a83c(obj, 0, 10)` —
// a full 320x256 grey quad, draw mode 0xE1000245 (ABR 2, B-F subtractive), level 0 -> 0xFF00 in
// 10 ticks, then held, so the screen is black. `F0x800a7328` releases the battle hold on the
// party's records (record +0x1A at `0x800a4470 + group*0x20`, and the two participating Digimon
// words at `0x800a3868 + i*0x1C`) — it writes no card, no money and no flag. Then, for result
// byte 2 only, `[0x8004b440](0xE00, 0)` — the pointer's value, `F0x80016b88`, is the
// canonical document's reading (exe/fns.s:7367-7371 is the routine itself: two stores
// into `D0x80048d34` + 0x26c8 and + 0x26d0, i.e. `0x8004b3fc` and `0x8004b404`, the
// pending selector and its second word). There is no field-restore branch on this arm, so
// the field is never rebuilt and nothing is saved.
//
// Only the loss arm asks for the title screen. The win arm (.L0x000021b4) loads 0xE0B or
// 0x1400 into the same launch slot, and the flee/none arm (result 0, .L0x000021a0) leaves by a
// different tail — so a win still comes back to the field and a loss never does.
//
// So the launch is the ONLY thing left to do, and it is a screen change over the black the
// fade left behind — not a page restart, which is what the walker used to do and which put
// its own loading panel on screen between the fade and the title.
function gameOverToTitle() {
    if (!launchTitleScreen) {
        // Unreachable from a running game: init() installs the launch before any battle
        // can be lost. Logged rather than papered over with a reload.
        console.warn("[battle] loss with no title launch installed");
        return;
    }
    launchTitleScreen();
}

function updateHud() {
    const hud = document.getElementById("hud");
    if (!hud) return;
    document.getElementById("hud-map").textContent = currentMap().name || "";
    const partnerRow = document.getElementById("hud-partner");
    if (fieldPartySize(state.party) > 0 && state.charIdx > 0) {
        const pc = state.manifest.characters[state.charIdx];
        const sheet = state.charImgs[pc.id];
        partnerRow.style.display = "flex";
        document.getElementById("hud-partner-name").textContent = pc.name;
        const icon = document.getElementById("hud-icon");
        const ictx = icon.getContext("2d");
        ictx.imageSmoothingEnabled = false;
        ictx.clearRect(0, 0, 32, 32);
        if (sheet) {
            ictx.drawImage(
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
        partnerRow.style.display = "none";
    }
}

function setCharacter(i) {
    state.charIdx =
        (i + state.manifest.characters.length) %
        state.manifest.characters.length;
    document.getElementById("charSelect").selectedIndex = state.charIdx;
    const c = state.manifest.characters[state.charIdx];
    if (c) {
        state.charId = c.id;
        localStorage.setItem("charId", c.id);
        ensureSpriteAssets(c.id).then(updateHud);
    }
    resetFollowers();
    updateHud();
}

function findFreeSpot(grid, x, y) {
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

function ensureSpriteAssets(id) {
    if (!id || state.charImgs[id] || state.npcImgs[id]) return Promise.resolve();
    if (spriteLoadPromises.has(id)) return spriteLoadPromises.get(id);
    const entry = manifestSprites.get(id);
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

async function loadCollisionForStage(id) {
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

function ensureMapImg(id) {
    // The fg check sits before the early return: the overlay index can finish
    // loading after the map image did, and render() re-calls ensureMapImg.
    const mapMeta = state.manifest.maps.find((x) => x.id === id);
    const overlayId = state.mapOverlays?.[id]
        ? id
        : (mapMeta?.assetSource && state.mapOverlays?.[mapMeta.assetSource]
            ? mapMeta.assetSource
            : null);
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
        mx.fillStyle = "#fff";
        for (const [x0, x1, y] of runs) mx.fillRect(x0, y, x1 - x0 + 1, 1);
        // The GROUND layer (OT[7]) = base minus the layer-2-only pixels.
        const ground = mk();
        const gx = ground.getContext("2d");
        gx.drawImage(base, 0, 0);
        gx.globalCompositeOperation = "destination-out";
        gx.drawImage(mask, 0, 0);
        // The LAYER-2 layer (OT[11]) = base kept only on those pixels.
        const layer2 = mk();
        const lx = layer2.getContext("2d");
        lx.drawImage(base, 0, 0);
        lx.globalCompositeOperation = "destination-in";
        lx.drawImage(mask, 0, 0);
        if (retainedStageIds.has(id)) {
            state.mapGroundImgs[id] = ground;
            state.mapLayer2Imgs[id] = layer2;
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
        loads.push(loadImage(`assets/maps/${overlayId}_fg.png`).then((img) => {
            if (retainedStageIds.has(id)) state.mapFgImgs[id] = img;
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
        loadImage(mapMeta.image).then((img) => {
            if (retainedStageIds.has(id)) state.mapImgs[id] = img;
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

function prepareStageAssets(id) {
    if (!knownStageIds.includes(id)) return Promise.resolve();
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
    const keep = new Set(stageWorkingSet(id, state.scenes, knownStageIds));
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
            delete state.collision[loadedId];
            readyStageIds.delete(loadedId);
        }
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
            const routed = screenRouter?.route(point.screen, mapId);
            if (routed?.kind === "warp") to = routed.to;
            if (!to) return null;
            return { to, dir: point.dirName ?? "down" };
        },
    );
}

async function loadAndSetMap(i, spawn = null) {
    const idx = (i + state.manifest.maps.length) % state.manifest.maps.length;
    await prepareStageAssets(state.manifest.maps[idx].id);
    setMap(idx, spawn);
    // Levelling and gym work move Charisma, and the tamers who care about it are on the
    // next screen. A screen change is the cheapest place that always precedes meeting one.
    refreshPartyCharisma();
}

function setMap(i, spawn = null) {
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
    document.getElementById("mapSelect").selectedIndex = state.mapIdx;
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
    bgm.play(sceneBgmTrack(currentMap().music, Number(state.progressOrdinal ?? 0) || 0));
    // A stage with no play id (fieldstg.s:8278-8281): the entry block loads the
    // exclusive latch and stops its holder outright rather than starting a track,
    // so a jingle ringing from a previous screen ends on arrival. bgm.play(null)
    // would only clear the register if the bgm player itself held it; this stops
    // whatever holds it, whichever subsystem started it. s260 is the live case.
    if (!currentMap().music) soundRegister.stopHeld();
    // Area SFX resolve through this map's sound archive (map_sound_archives.json)
    sfx.setMap(m.id);
    // Visited-map tracking needs nothing here: the engine's loadStage already set the
    // bit the pause-menu MAP page reads (set_flag(0x1E00 + screen id, 1), fieldstg
    // .L0x00008008-.L0x00008028), and the page reads that same bit back.
    const musicSelect = document.getElementById("musicSelect");
    if (musicSelect && currentMap().music)
        musicSelect.value = currentMap().music;
    updateHud();
    saveFieldLocation();
    // Name the place you just walked into. The native card is built by the
    // field's own entry sequence with a literal "show the names" argument, so
    // it runs on every arrival, including the one that starts a new game.
    // The card's banks are 0xA9 / 0xB7 + the language byte the boot screen committed.
    placeCard.setLanguage?.(state.languageByte ?? 2);
    placeCard.begin(m.id);
    queueMicrotask(() => activateStageNeighborhood(m.id));
}

// Entrance-return warp: the field engine always lets you walk back out the door
// you came in through — "whichever way you entered is the way you exit" — even in
// rooms whose *static* map data has no back-warp to that neighbour. s260 Asuka
// Cargo Tower is the canonical case: verified in a live PS1 save-state (screen
// 0x210), its runtime exit table holds two records — the SCRIPTED Water-Tunnel
// auto-exit (s275, the only one baked into the overlay) plus a second record
// pointing back to whatever map you arrived from (Asuka City s202 in that state,
// travel-context origin field == 513). That second exit is entry-DEPENDENT, so it
// can't be a static scene record; baking one would give a Water-Tunnel-entering
// player a phantom Asuka-City exit. We instead synthesize it from HOW you arrived.
// See docs/research/field/door-warp-decode.md §s260.
const _REV_DIR = { up: "down", down: "up", left: "right", right: "left" };
function addEntranceReturn(destId, arriveX, arriveY, fromId, fromPos) {
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

// ── Engine = SINGLE SOURCE OF TRUTH (no legacy story stack) ───────────────────────────
// The headless TS engine (web/vendor/engine.js) owns the banked flag store + story ordinal
// and DECIDES every story event/battle (talk, stage-enter, OnStep), driven through
// web/engine-bridge.js + the TS trigger-system. cutscene.js / battle.js stay the renderers.
// The old createStoryVM / createStoryEngine JS copies are deleted — this is the cutover.
//
// `engine` is constructed asynchronously in initEngine() (awaited inside init(), before the
// first frame). Until then it's null; nothing reads the flag store before the game starts.
let engine = null;
let engineBridge = null;
let engineTriggerSystem = null;
// Durable home of the engine's per-event `once` bits. The original keeps a once-only
// entry's fired marker in the save context, so a stage-entry or talk cutscene fires
// once and never again across Continue/reload. Seeded in initEngine from
// localStorage and cleared by New Game.
const engineEventDone = new Set();

// The stored-bit backend for storyFlags: delegates to the engine FlagManager so there is ONE
// banked store. set() guards virtual banks (FlagManager throws on those) and persists via the
// engine's onChange (registered in initEngine). Reads clear (0) before the engine exists.
const flagBackend = {
    get: (id) => (engine ? (engine.state.flags.get(id, 1) ? 1 : 0) : 0),
    set: (id, val) => {
        if (engine) {
            try {
                engine.state.flags.set(id, !!val);
            } catch {
                /* virtual bank: not stored */
            }
        }
    },
};
// "Have I walked into this place?", the pause-menu MAP page's marker question. One
// store: the engine's banked flags, which the field entry writes on every arrival
// (0x1E00 + screen id). The page reads it through F0x8009A6B8's own flag id,
// 0x2000 | (ps1 & 0xff) — the same number over the field screen range.
function engineFlagSeen(id) {
    return engine ? engine.state.flags.get(id, 1) === true : false;
}
// Visited walker maps: a save written before the MAP page read the flag store keeps
// its markers in `visitedMaps`. Nothing writes that list any more — initEngine turns
// it into the store's bits once (migrateVisitedMaps) and drops it.
state.visitedMaps = new Set(JSON.parse(localStorage.getItem("visitedMaps") ?? "[]"));

// storyFlags = the TRI-STATE gating adapter (flag-store.js) over the engine store. The
// spawn-gate (chapterNpcs) and the OnStep trigger-system both read it; `null` = unmodelled
// bank stays dormant. getOrdinal reads the engine's $story.ordinal (the single ordinal).
const storyFlags = createFlagStore(flagBackend, {
    getOrdinal: () =>
        engine ? Number(engine.state.vars.get("$story.ordinal") ?? 0) : 0,
    rosterTable: state.rosterPredTable,
    // bank-0x70 op0x10 case-0: the chosen starter-pack selector (DIGIMON_CUR_STATS+0x1ED8 == N).
    // Drives the s212 download gate (flags 0x7000/1/2) so only the chosen pack's download plays.
    // state.packId is "A"|"B"|"C"; the native selector is its 0/1/2 index. null before a pick.
    packIndex: () => { const i = "ABC".indexOf(state.packId); return i < 0 ? null : i; },
    // Collection banks (0x80–0x92) = item possession. Faithful model (npc-decode.md): a
    // collection-bank flag IS "item (bit) in the bag", set by NPC on_close tables. The bag
    // is state.inventory ([{id,qty}]); bit == item id for these banks. The original's
    // predicate is getGameState F0x80015F04(id, 1): 1 while the item is CARRIED or WORN.
    hasItem: (bit) => ownsItem(state, bit),
    // Bank 0x92 is the CARD collection and asks "do you hold a copy of this
    // card", which is the third call of the resident collection API. It is a
    // different id space from the item bag — answering it from `inventory`
    // compared a card id against an item id.
    hasCard: (cardId) => ownedCount(cards(), cardId) > 0,
    // Obtained-partner bitmask (bank-0x70 op-0x10 cases 1/6/9). The engine's GrantPartner
    // command maintains it in $roster.owned; unset = nothing obtained yet.
    ownedSlots: () =>
        engine ? Number(engine.state.vars.get("$roster.owned") ?? 0) : 0,
    // Bank 0x7E = the route pair [0x80048d78]/[0x80048d7a], written on every map
    // transition from the step record's params[5]/[6]. It gates the 161 family-B
    // maze NPCs (Seabed/Circuit/endgame + s635/s636): the same physical screen
    // shows a different cast depending on which entrance you dived through.
    routePair: () => [state.entryKey ?? 0, state.entryCompanion ?? 0],
    // Bank 0x72 = the derived party-Charisma ladder. Nothing stores it; the original sums
    // the three deployed positions on demand and compares against D0x80048CF8. It is the
    // gate every roaming card tamer checks before agreeing to duel, so leaving it
    // unmodelled made the brush-off line win all 286 of those dialogue ladders.
    // null until digimon.json has loaded, which keeps the gates dormant rather than
    // asserting "below every threshold". See web/charisma.js.
    partyCharisma: () => partyCharisma(state),
});
window.__storyFlags = storyFlags; // debug: inspect banked-predicate evaluation

/** Push the party's Charisma total into the engine var the engine's own bank-0x72 handler
 *  reads. The walker's NPC gating goes through storyFlags and does not need this, but the
 *  engine evaluates the same flags for step programs and events, and the two must not
 *  disagree about whether a tamer will duel you. Cheap and idempotent; call it whenever the
 *  party or its stats could have changed. */
function refreshPartyCharisma() {
    if (!engine) return;
    engine.state.vars.set("$party.charisma", partyCharisma(state));
}
window.__partyCharisma = () => partyCharisma(state); // debug/headless read-out
window.__cardDuel = cardDuel; // debug: is a field-launched duel actually running?

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
function activeExitAt(x = state.x, y = state.y) {
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
    const routed = screenRouter.route(screenId, currentMap().id);
    return routed?.kind === "warp" ? routed.to : null;
}

// Apply one decoded {id, expected} set_flag. Collection-bank (0x80–0x92) sets ARE item
// grants in the faithful model (npc-decode.md): "set collection[bit]=1" means the item
// entered the bag. The engine FlagManager can't store those (virtual bank), so we mirror
// the possession into state.inventory — that's what hasItem/gates/the menu read.
const COLLECTION_BANK_IDS = new Set([
    0x80, 0x82, 0x84, 0x86, 0x88, 0x8a, 0x8c, 0x8e,
]);
// Bank 0x92 is the CARD collection, not the item bag — corrected 2026-08-14.
// The resident dispatcher routes it to F0x80016314(cardId, value), which gives
// one copy when the value is non-zero and takes one when it is zero; the item
// banks 0x80..0x8e go somewhere else entirely (F0x800161d8). Writing a card
// grant into the bag was silently adding a phantom ITEM with the card's id and
// never adding the card. 30 dialogue states across 9 stages use this bank.
// — CARD-COLLECTION-ENTRY-POINTS-2026-08-14, CARD-STORY-GRANTS-2026-08-14
const CARD_COLLECTION_BANK = 0x92;
function applyStoryFlag(id, expected) {
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
    const command = storyCommand(id);
    if (command) {
        if (engine) engine.writeStoryFlag(id, expected);
        else applyStoryCommand(command);
        return;
    }
    // Other command indices are inert; stored banks retain the existing backend.
    if (bank < 0x60) storyFlags.set(id, expected);
}

/** Browser presentation of the shared engine command router. */
function applyStoryCommand(command) {
    if (command.kind === "battle") {
        state.pendingStoryBattleIndex = command.index;
        return;
    }
    {
        if (command.kind === "item_shop" || command.kind === "card_shop" || command.kind === "inn") {
            const index = command.index;
            const rec = state.shops?.[index];
            if (command.kind === "item_shop") shop.open(rec?.items ?? [], null, { name: rec?.name, state, shopId: index });
            // CARD SHOP — CORRECTED 2026-08-08. The card shop is 0x31..0x43 and
            // 0x46..0x4A, not 0x1e..0x30: set_flag routes those to
            // launch_ui(0x1300, index), 0x1300 is STCRDSHP, and `index` is the
            // launch parameter the shop keys its STOCK on. Passing it through is
            // what makes each shop sell its own six cards, and what makes a
            // shop's stock advance with the story — the shopkeeper's dialogue
            // state carries a different index per story stage, so the gate the
            // engine already evaluates for dialogue picks the stock list too.
            // The walker used to open the shop for 0x1e..0x30 with no id, which
            // was the wrong range AND lost the stock selection.
            else if (command.kind === "card_shop") {
                cardShop.open(state, null, openCardShopFolder, index);
            }
            // THE INN — DECODED 2026-08-13. Everything that is not `< 0x1e` and
            // not a card-shop index falls through to `jal D0x8008c000`, which
            // builds the rest screen with F0x80011dac(0x1002). That screen class
            // (F0x800119a8) does NOT use the flag index: it calls the screen-id
            // getter D0x8004b438 and scans the resident 8-byte table D0x8003edcc
            // for the current screen, so the MAP picks the inn and its price.
            // That is why s650 and s651 both carry flag index 0x2d and still
            // charge 48 and 80 BIT.
            //
            // Remembered, not opened, so the innkeeper finishes speaking first —
            // the same shape as the gym greeter and the card duel above.
            else if (command.kind === "inn") {
                state.pendingInn = true;
            }

        } else if (command.kind === "gym") {
            // Bank 0x94 = the STGTRAIN launcher: set_flag routes it to
            // launch_ui(0xa00, index), where index is the 0-based rank-menu
            // group (GYM-Q001, decoded 2026-07-26 — gym-entry-and-rank-chain
            // -2026-07-08.md). The greeter's dialogue states pick the index by
            // ID card owned, so nothing here needs to know which gym it is.
            // Remembered until the greeter's dialogue closes.
            state.pendingGymGroup = command.index;
        } else if (command.kind === "talk_event") {
            // Bank 0x90 = the TALK-CUTSCENE launcher, and it is how most of this
            // game's optional content actually starts. F0x800165ac routes the
            // write to fieldstg F0x8008bfa4, which reads the event id out of the
            // u16 array at RAM 0x800978d8 (talk_event_launches.json) indexed by
            // the flag's low 9 bits, then calls the SAME start_event
            // (0x800853f8) the step-VM's op-8 handler calls. So the bit is a
            // table index, not an event id and not a per-stage slot.
            //
            // Deliberately NOT one-shot-guarded, unlike the OnStep trigger path:
            // the original re-enters on every write, and what prevents a replay
            // is the NPC's own dialogue-state machine — the on_close that fires
            // this is the same one that advances the NPC past the state carrying
            // it. Adding a guard here would double-gate it.
            //
            // The VALUE is not consulted either: the dispatcher body for bank
            // 0x90 is `D0x8008bfa4(temps0)` — `arg1` is never read
            // (exe-decomp/c/F0x800165ac.c L100-103). That matters for the save
            // point: the Guardromon's second dialogue state writes 0x9001 = 0
            // (web/assets/scenes/s235.json npc 21), and the value-0 write is
            // what opens the memory-card screen in the original. Guarding on
            // `expected` silently dropped that trigger.
            playTalkEvent(command.index);
        } else if (command.kind === "card_duel") {
            // Banks 0x76/0x78 = the CARD-DUEL launcher. set_flag F0x800165ac
            // routes both to F0x80016378(index, mode) with mode 0 for 0x76 and
            // 1 for 0x78, which calls the screen-pack dispatcher
            // D0x8008b770(0x700, index * 2 + mode + 1, 0, 0, 0). So the packed
            // argument selects WHICH duel, and kind 0x700 is the duel itself.
            //
            // Decoded 2026-08-05 from a controlled runtime capture: talking to
            // the Tamer Mitch NPC at s335 (estalk02 index 113, "All right, I'm
            // going to Card Battle with you!"), whose duel dialogue state has
            // on_close flag 0x7606 = bank 0x76 index 6, loads the pro/cardgame
            // overlay and starts a duel. See
            // docs/research/card/captures/cardduel-full-duel-s482-state5-2026-08-05.md
            //
            // This replaces the old DUEL_ISLAND_STAGES walker rule, which
            // guessed at s385/s386 because the launcher was untraced.
            //
            // Remembered here, opened by the talk handler once the box closes,
            // so the challenger's name is available. Launched with NO
            // confirmation prompt: in the capture the dialogue closes, the
            // screen fades and the duel loads (frames 210 -> 294 -> 296). The
            // original never asks "do you want to".
            //
            // The card screen consumes the shared router's packed duel id.
            state.pendingDuelId = command.parameter;
        } else if (command.kind === "digimon_lab" || command.kind === "name") {
            const index = command.index;
            if (index === 0) {
                // The DRI desk owns the complete native stgdglab flow: root,
                // Switch, Digivolve and the four-page Digivolve Chart. The
                // native route boots the shipped overlay; the legacy desk keeps
                // its pick -> openAction dance for the rollback.
                if (USE_NATIVE_DRI) driMenu.open(state, null);
                else {
                    driMenu.open((pick) => {
                        driMenu.openAction(pick, state, battle);
                    });
                }
            } else if (index === 1 && state.party?.length) {
                state.nameEntry = openNameEntry({});
                state.nameEntryDone = () => {
                    // The translated screen can confirm several partners in one visit.
                    const results = !USE_NATIVE_NAME
                        ? [{ accepted: true, memberId: state.party[0], value: state.nameEntry.value() }]
                        : state.nameEntry.results?.() ?? [state.nameEntry.result?.()];
                    let changed = false;
                    for (const result of results) {
                        if (result?.accepted && result.memberId) {
                            state.digimonNames[result.memberId] = result.value;
                            changed = true;
                        }
                    }
                    if (changed) {
                        localStorage.setItem(
                            "digimonNames",
                            JSON.stringify(state.digimonNames),
                        );
                    }
                    state.nameEntry = null;
                };
            }
        }
        return;
    }
}

/** Open the naming screen: the native pro/stdgname overlay by default, the
 *  hand-authored keyboard under ?legacyName=1. The native screen reads the pad
 *  from `state.keys` each frame, so the returned object needs no per-key calls. */
function openNameEntry(opts = {}) {
    if (!USE_NATIVE_NAME) return createNameEntry(opts);
    nameEntryNative.open({ initial: opts.initial ?? "", state });
    return nameEntryNative;
}

// state.progressOrdinal proxies the engine's $story.ordinal (single source of truth). Before
// the engine exists it falls back to localStorage (read) / writes through to it (write).
Object.defineProperty(state, "progressOrdinal", {
    get() {
        return engine
            ? Number(engine.state.vars.get("$story.ordinal") ?? 0)
            : Number(localStorage.getItem("progressOrdinal") ?? 0);
    },
    set(v) {
        if (engine)
            engine.state.vars.set("$story.ordinal", Number(v)); // onChange persists
        else localStorage.setItem("progressOrdinal", String(Number(v)));
    },
});

// The coarse per-stage story-step ladder is GONE (2026-10-02). It used to move the story on
// when ANY event of a stage completed, from the OnStep and talk routes alike. Every stage on
// the ladder now carries its decoded owner (web/assets/data/ordinal_owner.json: which event's
// on_complete routine writes the master ordinal, and what it writes), so GameEngine
// .completeEvent does both jobs at once — the event's own flag writes AND its step store — and
// both routes call it. A scene that is not the beat's closing scene writes nothing, as in the
// original. See engine/index.ts completeEvent and the `starts` block of ordinal_owner.json.

// state.bits proxies the engine's $party.bit (single source of truth), the same way
// progressOrdinal proxies $story.ordinal. The engine's AddMoney command — the bank-0x70
// CURRENCY ADD reward every "someone hid money here" find and every talk-give money grant
// runs through — wrote only that var, and nothing read it back, so the box said "I got
// 300 BIT!" and the player's wallet never moved. Routing both directions through the var
// means AddMoney also adds to the CURRENT wallet instead of to a stale zero.
Object.defineProperty(state, "bits", {
    get() {
        return engine
            ? Number(engine.state.vars.get("$party.bit") ?? this._bits)
            : this._bits;
    },
    set(v) {
        const n = Number(v) || 0;
        this._bits = n;
        if (engine) engine.state.vars.set("$party.bit", n); // onChange persists
        else localStorage.setItem("bits", String(n));
    },
});

// state.rosterOwned proxies the engine's $roster.owned — the eight-slot OBTAINED set that
// the engine's GrantPartner command (bank-0x70 op-0x10 case 3) writes when an NPC hands a
// partner over. The Digimon Lab reads it to decide who it will offer you, so it has to
// survive a reload like the wallet does.
Object.defineProperty(state, "rosterOwned", {
    get() {
        return engine
            ? Number(engine.state.vars.get("$roster.owned") ?? this._rosterOwned)
            : this._rosterOwned;
    },
    set(v) {
        const n = Number(v) || 0;
        this._rosterOwned = n;
        if (engine) engine.state.vars.set("$roster.owned", n); // onChange persists
        else localStorage.setItem("rosterOwned", String(n));
    },
});

// state.chapter is the SINGLE SOURCE OF TRUTH for story-content selection, DERIVED from the
// banked story-flag store (deriveChapter + chapter_progression.json). All ~12 read sites
// (chapterNpcs, pickPtrbDialogue, …) get the live value for free. A debug override
// (_chapterOverride; HUD selector / __setChapter) wins when non-null.
Object.defineProperty(state, "chapter", {
    get() {
        return this._chapterOverride != null
            ? this._chapterOverride
            : deriveChapter(storyFlags.get, this.chapterTable);
    },
    set(v) {
        this._chapterOverride = v == null ? null : Number(v);
        if (this._chapterOverride == null)
            localStorage.removeItem("chapterOverride");
        else
            localStorage.setItem(
                "chapterOverride",
                String(this._chapterOverride),
            );
    },
});

// Bank-0x70 op-0x18 case 8: set_flag(0x7053,1) dispatches the original's active-party
// full heal (cur_hp=max_hp, cur_mp=max_mp; roster_predicate_table record key 83). HP/MP
// live here, not in the headless engine, so the engine's HealParty command forwards to
// this through its constructor hook. Same fields the battle writes back.
function healActiveParty() {
    const full = (ps) => {
        if (!ps) return;
        if (ps.maxHp != null) ps.hp = ps.maxHp;
        if (ps.maxMp != null) ps.mp = ps.maxMp;
    };
    full(state.partnerStats);
    for (const ps of state.partyStats ?? []) full(ps);
    if (state.partnerStats)
        localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
}

// Construct the headless engine + its presentation bridge + OnStep trigger-system. Called
// once from init() (awaited) before the loop starts. Seeds the banked store + ordinal from
// localStorage and registers write-through persistence.
async function initEngine() {
    const { GameEngine, createTriggerSystem } =
        await import("./vendor/engine.js");
    const content = await (await fetch("assets/engine-content.json")).json();
    try {
        for (const id of JSON.parse(localStorage.getItem("engineEvents") ?? "[]"))
            if (typeof id === "string") engineEventDone.add(id);
    } catch {
        /* corrupt save — start with nothing fired */
    }
    engine = new GameEngine(content, {
        storyCommand: applyStoryCommand,
        driven: true,
        screenTable: fieldScreenTable,
        healParty: healActiveParty,
        // Persist each row's once bit the moment EngineBridge/EventManager fires it,
        // so a reload does not replay an already-seen auto/talk cutscene.
        onceStore: {
            get: (id) => engineEventDone.has(id),
            set: (id) => {
                if (engineEventDone.has(id)) return;
                engineEventDone.add(id);
                localStorage.setItem(
                    "engineEvents",
                    JSON.stringify([...engineEventDone]),
                );
            },
        },
    });
    const engineParty = (state.party ?? []).map((_, i) => i + 1);
    engine.state.party.load({ members: engineParty, lead: engineParty[0] });
    state.sbIndex = buildScriptedBattleIndex(content); // map→[{preKey,postKey,screenId,wonFlag,actor}]

    // UNIFY INVENTORY (single source of truth): replace the engine's private Inventory with an
    // adapter over the browser's state.inventory ([{id,qty}]). Now possession conditions (banks
    // 0x80–0x92, e.g. the Blue Card gate flag 0x818e) and GiveItem grants read/write the SAME bag
    // the menu/shop/save use — no second inventory to keep in sync. evalContext() reads
    // engine.state.inventory fresh each eval, so this takes effect immediately.
    engine.state.inventory = {
        // The scene's possession gate is F0x80015F04's "do we have any" form, which
        // counts a WORN copy as having it; a script's larger `count` is the
        // walker's own shape and still answers from the carried count.
        has: (id, count = 1) =>
            (count <= 1 ? ownsItem(state, id) : heldCount(state, id) >= count),
        add: (id, n = 1) => {
            storeAddItem(state, id, n);
            localStorage.setItem("inventory", JSON.stringify(state.inventory));
        },
        remove: (id, n = 1) => {
            storeRemoveItem(state, id, n);
            localStorage.setItem("inventory", JSON.stringify(state.inventory));
        },
        toJSON: () => state.inventory.map((s) => [s.id, s.qty ?? 1]),
        load: () => {}, // state.inventory is loaded from localStorage during state init
    };

    // Seed the banked store + ordinal from persisted save, THEN register persistence so a seed
    // load doesn't echo back to storage. FlagManager.load only touches known banks; ignore junk.
    try {
        const savedFlags = localStorage.getItem("engineFlags");
        if (savedFlags) engine.state.flags.load(JSON.parse(savedFlags));
    } catch {
        /* corrupt save — start clean */
    }
    // One-time save migration, AFTER persistence is registered below so the bits it
    // writes are stored: a save from the build that kept a parallel `visitedMaps` list
    // has its markers turned into the bits the field entry would have written, so an
    // old player's MAP page keeps its revealed places. Then the list is dropped — the
    // original never had one, and nothing writes it now.
    const migrateVisited = () => {
        if (!state.visitedMaps.size) return;
        migrateVisitedMaps([...state.visitedMaps], fieldScreenTable, {
            get: engineFlagSeen,
            set: (id, value) => engine.state.flags.set(id, value),
        });
        state.visitedMaps = new Set();
        localStorage.removeItem("visitedMaps");
    };
    engine.state.vars.set(
        "$story.ordinal",
        Number(localStorage.getItem("progressOrdinal") ?? 0),
    );
    // Seed the chosen starter-pack selector (0/1/2) from the persisted pack, so the s212 download
    // gate (bank-0x70 op0x10 flags 0x7000/1/2) resolves to the right variant after a reload. null
    // until a pack is picked → gate dormant. Kept in sync at the pack pick + cleared on New Game.
    engine.state.vars.set(
        "$party.pack",
        state.packId != null ? "ABC".indexOf(state.packId) : null,
    );
    // The engine evaluates bank 0x72 from $party.charisma (dw3-config registerVirtualBank),
    // the same ladder web/flag-store.js answers for NPC gating. Seed it once digimon.json is
    // in, and refresh it whenever the party or its stats could have moved, so both sides of
    // the walker agree about which tamers will duel you.
    loadCharismaDb().then(() => refreshPartyCharisma());
    engine.state.flags.onChange(() =>
        localStorage.setItem(
            "engineFlags",
            JSON.stringify(engine.state.flags.toJSON()),
        ),
    );
    migrateVisited();
    // The wallet is the engine's $party.bit from here on (see the state.bits accessor):
    // seed it from the persisted value before persistence is registered, so seeding does
    // not echo back to storage.
    engine.state.vars.set("$party.bit", Number(state._bits) || 0);
    // Same for the obtained-partner set. A save written before the roster was modelled
    // has a deployed party and an empty mask; whoever is deployed is by definition
    // obtained, so the mask is repaired from the party instead of starting wrong.
    engine.state.vars.set(
        "$roster.owned",
        rosterMaskForParty(Number(state._rosterOwned) || 0, state.party ?? []),
    );
    engine.state.vars.onChange((n, _o, v) => {
        if (n === "$story.ordinal")
            localStorage.setItem("progressOrdinal", String(v));
        else if (n === "$party.bit") {
            state._bits = Number(v) || 0;
            localStorage.setItem("bits", String(state._bits));
        } else if (n === "$roster.owned") {
            state._rosterOwned = Number(v) || 0;
            localStorage.setItem("rosterOwned", String(state._rosterOwned));
        }
    });

    engineBridge = createEngineBridge({
        engine,
        // resolve the event's flag_key → wstag bytecode, play it via the existing cutscene path;
        // report the handoff (with its event) so doStoryHandoff can route it.
        playCutscene: (flagKey, onDone) => {
            const ev = (state.wstag[currentMap().id] || []).find(
                (e) => e.flag_key === flagKey,
            );
            if (!ev) {
                console.warn(
                    "[engine] no wstag event for",
                    flagKey,
                    "on",
                    currentMap().id,
                );
                onDone(null);
                return;
            }
            playStoryEvent(ev, (handoff) =>
                onDone(handoff ? { ev, handoff } : null),
            );
        },
        startBattle: (screenId, onWin, onLose) => {
            const index = state.pendingStoryBattleIndex;
            state.pendingStoryBattleIndex = null;
            if (index != null) {
                const mapId = currentMap().id;
                // The queued original command selects the live record. Converted
                // rows consume the result; their fixed screen is not a second selector.
                battle.scriptedScreen(mapId, index).then((requestedScreen) => {
                    if (!requestedScreen) throw new Error(`scripted encounter ${mapId} index ${index} has no decoded screen`);
                    startFieldBattle(() => battle.startScreen(requestedScreen, onWin, onLose, gameOverToTitle, { mapId, lead: false }));
                });
                return;
            }
            const party = battle.partyForScreen(screenId);
            if (!party || !party.length) {
                console.warn("[engine] no party for screen", screenId);
                onLose();
                return;
            }
            startFieldBattle(() => battle.startParty(party, onWin, onLose, gameOverToTitle, { screenId, mapId: currentMap().id })); // flee → replayable; lose → title
        },
        doHandoff: (h) => {
            if (h) doStoryHandoff(h.ev, h.handoff);
        },
        // Non-blocking presentation ops. PlaySparkle(n) = bank-0x70 op-0x50: the original
        // calls setSub1(n) on the player's resident type-0x16 FIELDCOM sparkle actor, which
        // plays packed sound 0x00040009 (ITEM_GET) for programs 1 and 3 and animates the
        // flourish over the player. Only the ARMING lives here; the drawing is in the field
        // render pass off the player's own world position (see drawSparkleActor).
        onPresentation: (op, args) => {
            if (op !== "PlaySparkle") return;
            state.sparkleActor = { program: args[0] ?? 0, start: fieldcomTick() };
            if (args[0] === 1 || args[0] === 3) sfx.play("item_get");
        },
    });

    // OnStep position cutscenes via the TS trigger-system (engine/systems/trigger-system.ts).
    // It applies erec.sets but NOT the ordinal, so the playEvent wrapper advances it (the
    // legacy storyVM relied on playStoryEvent doing this).
    engineTriggerSystem = createTriggerSystem({
        getProgram: (mapId) =>
            state.storySteps?.[mapId.replace(/^s/, "")] || null,
        getGrid: (mapId) => state.storyGrids?.[mapId.replace(/^s/, "")] || null,
        // The EXACT per-pixel zones (the disc's zonecheck(7,x,y), run-decimised).
        // When present the trigger system reads the step byte from the player's
        // PIXEL and never consults the 32 px grid above — that grid fires a step
        // up to a cell early, which put the Protocol Ruins tunnel hide before the
        // passage and its restore past where the original restores.
        getZoneRuns: (mapId) => state.storyZones?.[mapId.replace(/^s/, "")] || null,
        // The engine's StepEnableTable is {rows}; state.stepEnableTable holds the rows
        // themselves (web/game.js:1641). Handing the bare array over left the port's own
        // cone gate inert — it fell back to "live" for every facing and only the
        // renderer's private copy of the same table was enforcing ±1 (2026-10-03).
        getEnableTable: () =>
            state.stepEnableTable ? { rows: state.stepEnableTable } : null,
        // By ID, the way start_event is called: param@+0xa IS the event id. flag_key is
        // not unique inside a stage — the Master Room's records for events 965 and 1450
        // share 012e000a (wstag305.s:3699-3708), so the old flag_key lookup could hand the
        // step path the wrong scene. flag_key stays the fallback.
        getEventById: (mapId, id) =>
            (state.wstag[mapId] || []).find((e) => e.id === id) || null,
        getEventByKey: (mapId, fk) =>
            (state.wstag[mapId] || []).find((e) => e.flag_key === fk) || null,
        flags: storyFlags,
        hostCompletesEvent: true,
        done: (fk) => !!state.flags["evt_" + fk],
        markDone: (fk) => {
            state.flags["evt_" + fk] = true;
            localStorage.setItem("flags", JSON.stringify(state.flags));
        },
        playEvent: (ev, onDone) =>
            playStoryEvent(ev, (handoff) => {
                // The event's OWN on_complete, through the engine: it runs
                // `<stage>.event.<id>.oncomplete` (the flag writes read out of that
                // event's routine) and, when the stage has a decoded owner
                // (ordinal.byStageOwner, tools/extract_ordinal_owner.py), stores the
                // ordinal that event's routine stores — nothing else. The s820 Spy
                // Satellite finale (event 1080, wstag820.s .L0xa8c: ordinal 0x2b +
                // flag 0x7401) reaches the field ONLY through this trigger, so the
                // coarse per-stage ladder (advanceOrdinal) could not move the story
                // for it — and the ladder would move it on the WRONG event anyway.
                engine.completeEvent(ev.id);
                onDone(); // host already ran the completion leaf; no duplicate command writes
                // A position-triggered scene's own HANDOFF warps, exactly like the other two
                // launch routes (the bridge's rows, web/engine-bridge.js:92, and the bank-0x90
                // talk launcher, playTalkEvent). HANDOFF is op 3.4 = `0x8008b770(id,-1,x<<8,
                // y<<8,p)` + the runner's own `vt+0x28(2)` (field-script-engine-verified.md
                // §3.4, file 0x25d0) — a screen transition wherever it sits. Measured 2026-10-05:
                // s410's event 90 ("who's in charge", started by this step) ends
                // `WALKTO 2 526 296 5 / HANDOFF 554 208 764 7`, and without this the scene ran
                // to its end and left the player standing in the station instead of outside it.
                if (handoff) doStoryHandoff(ev, handoff);
                // Position-triggered scripted-battle PRE → chain battle → POST in one flow.
                // Skip when the PRE itself warps us away (handoff).
                else chainScriptedBattleFromPre(ev);
            }),
        handoffPending: () =>
            // scene_struct+0x54 / +0x58 (fieldstg's handoff id and its argument).
            // The walker writes the equivalent facts in `fade`/`state.launch`/
            // `state.diveDemo`: while any of them owns the field, a step tile's press
            // must not also fire — that is the guard at fieldstg.s:5c54/:5c64/:5d10.
            fade.dir !== 0 ||
            !!state.launch ||
            !!state.handoffHold ||
            !!state.slope ||
            !!state.diveDemo ||
            !!state.iceSlide ||
            (engineBridge ? engineBridge.isBusy() : false) ||
            cutscene.isActive(),
        isBusy: () =>
            engineBridge.isBusy() ||
            battle.isActive() ||
            cutscene.isActive() ||
            textbox.isOpen() ||
            choice.isOpen() ||
            fade.dir !== 0 ||
            !!state.diveDemo ||
            !!state.nameEntry ||
            !!state.packSelect ||
            !!state.endScreen ||
            !!state.titleScreen ||
            !!state.menuOpen,
    });
    window.__engine = engine;
    window.__engineBridge = engineBridge;
    window.__engineTriggerSystem = engineTriggerSystem;
    console.log(
        "%c[engine] ready — story driven by GameEngine",
        "color:#0a0;font-weight:bold",
    );
}

// Play one story event's cutscene (esdmg text + opcode stream), restore static NPC
// positions afterward, then report the resulting handoff (or null) to the engine.
// ── Story-flow debug trace (on by default; silence with window.__storyDebug=false) ──
// Prints every map ENTER, EVENT fired (auto vs talk), and WARP so the opening flow can be
// captured from the console. An EVENT line appearing right after ENTER with no TALK in
// between = an event auto-firing on entry (the auto-teleport bug).
function storyDbg(...a) {
    if (window.__storyDebug !== false)
        console.log("%c[STORY]", "color:#0a0;font-weight:bold", ...a);
}

// Console helper: window.__npcsHere() dumps every visible NPC on the current map with its
// id / sprite / position, so the Tamer-Service-renders-as-Andromon kind of identity bug can
// be read off directly (npc_id → sprite is the mapping; sprite → sheet is what renders).
// Console-friendly dump of the exact anim-debug data the "V" overlay draws (position,
// facing, and which render branch fired: clip:<id> / idle:<id> / walk / static + frame)
// for everything actually on screen right now (player, party, NPCs). Populated every
// frame in render() regardless of whether "V" is toggled on, so this works even with the
// overlay off — run `__animReport()` in the devtools console and paste the table.
window.__animReport = () => {
    const rows = (window.__lastAnimDebug ?? []).map((d) => ({
        label: d.label,
        x: Math.round(d.x),
        y: Math.round(d.y),
        dir: d.info.dir,
        mode: d.info.mode,
        clipId: d.info.clipId,
        frame: d.info.frame,
    }));
    console.log(
        `%c[ANIM on ${currentMap().id}] chapter=${state.chapter}`,
        "color:#0a0;font-weight:bold",
    );
    console.table(rows);
    return rows;
};

window.__npcsHere = () => {
    const sc = state.scenes[currentMap().id];
    if (!sc) return console.log("no scene for", currentMap().id);
    const rows = sceneCast(sc)
        .filter((n) => !n.cutsceneOnly)
        .map((n) => ({
            npc_id: n.npc_id,
            sprite: n.sprite,
            x: n.x,
            y: n.y,
            slot: n.slot,
        }));
    console.log(
        `%c[NPCS on ${currentMap().id}] chapter=${state.chapter}  you at ${Math.round(state.x)},${Math.round(state.y)}`,
        "color:#08f;font-weight:bold",
    );
    console.table(rows);
    return rows;
};

// All scene NPC records (every chapter variant) near a position — reveals who else the
// game could place at the same spot at other story points. __variantsAt() uses your pos.
window.__variantsAt = (x = state.x, y = state.y, r = 40) => {
    const sc = state.scenes[currentMap().id];
    const rows = (sc?.npcs || [])
        .filter((n) => Math.hypot(n.x - x, n.y - y) <= r)
        .map((n) => ({
            chapter_n: n.n,
            npc_id: n.npc_id,
            sprite: n.sprite,
            x: n.x,
            y: n.y,
            slot: n.slot,
            shown_now: chapterNpcs(
                sc.npcs,
                state.chapter,
                storyFlags.get,
            ).includes(n),
        }))
        .sort((a, b) => a.slot - b.slot);
    console.log(
        `%c[VARIANTS within ${r}px of ${Math.round(x)},${Math.round(y)} on ${currentMap().id}] chapter=${state.chapter}`,
        "color:#a0a;font-weight:bold",
    );
    console.table(rows);
    return rows;
};

// Flip story chapter live (valid: 1,3,5,6,7) to see how the roster/sprites change.
// Debug: force a chapter (override), or pass null/undefined to clear and return to the
// flag-DERIVED chapter. Updates the HUD selector to match.
window.__setChapter = (n) => {
    state.chapter = n == null ? null : Number(n);
    const sel = document.getElementById("chapterSelect");
    if (sel) sel.value = String(state.chapter);
    console.log(
        "chapter ->",
        state.chapter,
        state._chapterOverride == null ? "(derived)" : "(override)",
    );
    return window.__npcsHere();
};

// Console helper: window.__tp(x, y) snaps the player there (e.g. __tp(384,255) = next to
// the s210 Tamer Service NPC 32). No-arg __tp() teleports onto the nearest NPC.
window.__tp = (x, y) => {
    if (x == null) {
        const sc = state.scenes[currentMap().id];
        const n = sceneCast(sc)
            .filter((z) => !z.cutsceneOnly)
            .sort(
                (a, b) =>
                    Math.hypot(a.x - state.x, a.y - state.y) -
                    Math.hypot(b.x - state.x, b.y - state.y),
            )[0];
        if (!n) return console.log("no NPC on map");
        x = n.x + 14;
        y = n.y;
    }
    state.x = x;
    state.y = y;
    console.log(
        `%c[TP] -> ${x},${y} on ${currentMap().id}`,
        "color:#f80;font-weight:bold",
    );
};

// Index the engine-content scripted battles by their PRE event's flag_key, so a
// POSITION-triggered PRE (the walk-up + chat cutscene) can chain straight into the battle and
// then the POST chat — the authentic "scripted walk → talk → battle → post-talk" as ONE flow.
// (The talk path already chains via engine-bridge re-raise; this covers the position path.)
function buildScriptedBattleIndex(content) {
    const fk = content.flagKeys || {};
    const idx = {};
    for (const st of content.stages || []) {
        const mid = st.mapId;
        const eventOf = (id) => (st.events || []).find((e) => e.id === id);
        const scriptOf = (id) => (st.scripts || []).find((s) => s.id === id);
        for (const be of st.events || []) {
            if (!/\.sb\.battle(\.|$)/.test(be.id)) continue;
            const tag = be.id.slice((mid + ".sb.battle").length); // "" or ".<actor>"
            const sbop = (scriptOf(be.do)?.program || []).find(
                (o) => o.op === "StartBattle",
            );
            if (!sbop) continue;
            const pre = eventOf(`${mid}.sb.pre${tag}`);
            const post = eventOf(`${mid}.sb.post${tag}`);
            const preId = Number(pre?.do.match(/event\.(\d+)\./)?.[1]);
            const postId = Number(post?.do.match(/event\.(\d+)\./)?.[1]);
            const preKey = fk[mid]?.[preId];
            if (!preKey) continue;
            (idx[mid] ||= []).push({
                preKey,
                postKey: fk[mid]?.[postId] ?? null,
                screenId: sbop.args[0].v,
                wonFlag: sbop.args[1].v,
                actor: be.match?.npc,
            });
        }
    }
    return idx;
}

// If `ev` is a stage's scripted-battle PRE (matched by flag_key), drive the fight right after
// the walk-up/chat cutscene ends, then play POST on victory. No-op if already won or no party.
function chainScriptedBattleFromPre(ev) {
    const mid = currentMap().id;
    const sb = (state.sbIndex?.[mid] || []).find((b) => b.preKey === ev.flag_key);
    if (!sb) return false;
    if (engine && engine.state.flags.get(sb.wonFlag, 1)) return false; // already won
    const party = battle.partyForScreen(sb.screenId);
    if (!party || !party.length) return false;
    startFieldBattle(() => battle.startParty(
        party,
        () => {
            // win → mark won (gates the talk-path battle row out) and resume POST chat,
            // then despawn the defeated boss so he leaves and can't be re-talked.
            if (engine) engine.state.flags.set(sb.wonFlag, true);
            const finish = () => despawnDefeatedBoss(sb.actor);
            const postEv =
                sb.postKey &&
                (state.wstag[mid] || []).find((e) => e.flag_key === sb.postKey);
            if (postEv)
                playStoryEvent(postEv, (h) => {
                    if (h) doStoryHandoff(postEv, h);
                    finish();
                });
            else finish();
        },
        () => {}, // flee → replayable (talk to re-engage)
        gameOverToTitle, // lose → title (the loss branch has no battle-kind test)
        { screenId: sb.screenId, mapId: mid },
    ));
    return true;
}

// After a boss is beaten, set its "defeated" spawn-gate flag so it despawns (and is no longer
// talkable). A boss spawn-gate carries a {flag, expected:0} STORED guard meaning "absent once
// this is set" (e.g. Keith s205 = ordinal==6 & 0x4016==0; the overlay sets 0x4016 on defeat).
// Ordinal (bank 0x60) and virtual banks are skipped — only real stored guards are flipped.
function despawnDefeatedBoss(actor) {
    const sc = state.scenes[currentMap().id];
    if (!sc) return;
    for (const npc of sc.npcs || []) {
        if (npc.npc_id !== actor) continue;
        for (const f of npc.spawn_flags || []) {
            if (f.expected === 0 && ((f.id >> 8) & 0xfe) <= 0x40) storyFlags.set(f.id, 1);
        }
    }
}

// Bank-0x90 talk launcher (see applyStoryFlag) — the shared system, ported once in
// engine/systems/talk-launch.ts. `bit` indexes the fieldstg event-id array; the id it names
// is then resolved against the CURRENT stage's event table, exactly like the op-8 step
// handler. start_event has no cross-stage lookup, so a bit whose event belongs to another
// stage simply finds nothing; the three shipped bindings in that state (s550 bit 17,
// s551 bit 18, s537 bit 54) are carried as `in_stage: false` in the bindings data rather
// than redirected to a guessed stage.
//
// Both halves of that resolution live in the shared module, because both were once guessed
// here and got it wrong. ID FIRST: flag_key is not unique inside a stage — the Master Room's
// records at wstag305.s file 0x39ac / 0x39c0, event 965 ("walk down and leave to s310") and
// event 1450 ("walk back to the middle of the room"), share flag_key 012e000a, so a
// flag_key-first lookup hands bit 97 the wrong record and sends the player downstairs.
// flag_key stays the fallback, for a stage whose wstag ids disagree with the step table's.
function playTalkEvent(bit) {
    const mapId = currentMap().id;
    // The shipped binding table is the authority on what this bit means HERE; the resident
    // event-id array (state.talkEventIds) is the fallback for a stage the bindings file does
    // not carry, so a missing file degrades to the old behaviour instead of losing every
    // conversation-started scene.
    const eventId = talkLaunchEventForBit(mapId, bit) ?? state.talkEventIds?.[bit] ?? null;
    const prog = state.storySteps?.[mapId.replace(/^s/, "")];
    const erec = prog?.events?.find((e) => e.event_id === eventId);
    const ev = erec
        ? resolveTalkLaunchRecord({ byId: prog.events, byWstag: state.wstag[mapId] || [] }, eventId)
        : null;
    if (!ev) {
        storyDbg("TALK EVENT", bit, "→ id", eventId, "unresolved on", mapId);
        return;
    }
    storyDbg("TALK EVENT", bit, "→ id", eventId, erec.flag_key, "on", mapId);
    playStoryEvent(ev, (handoff) => {
        // The event's OWN on_complete, through the engine — the same call the OnStep route
        // makes (web/game.js playEvent wrapper above). It runs
        // `<stage>.event.<id>.oncomplete` (the flag writes read out of that event's
        // routine) and, from ordinal.byStageOwner (tools/extract_ordinal_owner.py), stores
        // the story step that event's routine stores — and only that event's. The old
        // advanceOrdinal() here moved the story on ANY completed event of the stage, which
        // is how a walker's mid-scene could jump the step.
        engine.completeEvent(eventId);
        // The event's own completion writes (same list the OnStep path applies).
        for (const [fid, val] of erec.sets || []) storyFlags.set(fid, val ? 1 : 0);
        // HANDOFF IS A SCREEN TRANSITION, wherever in the script it sits: op 3.4 is
        // `0x8008b770(id,-1,x<<8,y<<8,p)` then the runner's own `vt+0x28(2)`
        // (docs/research/scripting/field-script-engine-verified.md §3.4, file 0x25d0).
        // The two other launch routes already hand their HANDOFF to doStoryHandoff
        // through the bridge (web/engine-bridge.js:92 `if (handoff != null) doHandoff`),
        // and the launcher calls the SAME start_event the bridge's rows come from
        // (engine/systems/talk-launch.ts), so this route warps too. Until 2026-10-05 it
        // routed only the save-point family, which is why the East/South Station gondola
        // had to be hand-wired as an OnExit row in tools/engine-convert/decode-table.json:
        // the walk only happened because a person invented an exit trigger the disc does
        // not have. Measured over the 228 shipped bindings, 18 of the 52 that carry a
        // HANDOFF name a screen the field screen table resolves (s410 142/143, s440 144,
        // s305 895, s320 290, s325 560, s380 205, s395 1299, s400 1304, s435 950,
        // s520 695, s685 690, s750 820, s926 1606, s237 300, plus the two same-stage
        // repositions s305 1450 and s385 1431); the other 26 name screens outside
        // 512..750, which doStoryHandoff already leaves alone exactly as before.
        if (handoff?.yesNoChild) {
            // The Yes/No branch the player picked ends in its own HANDOFF
            // (s210 Yes -> event 13 -> s212): follow it as that child's handoff.
            doStoryHandoff(handoff.yesNoChild, handoff);
        } else if (handoff) {
            // The save-point NPC's event ends in `HANDOFF 0xC00|slot` — the decoded
            // memory-card trigger (engine/dw3/save-points.ts), which doStoryHandoff
            // opens as a native screen rather than routing as a stage warp.
            doStoryHandoff(ev, handoff);
        } else {
            chainScriptedBattleFromPre(ev);
        }
    });
}

window.__playStoryEvent = (ev, onDone) => playStoryEvent(ev, onDone); // verifier hook (tools/verify_dialogue_say.mjs)
// A native Yes/No launcher event (event-machine-synthesis-2026-08-03.md "Family B"): its
// controller shows the question, then start_event's the Yes or No child event of the same
// stage and finishes when that child ends. Returns false when `ev` is not one of the 8.
function playYesNoEvent(ev, onDone) {
    const mapId = currentMap().id;
    const row = engineUi?.yesNoLauncherFor?.(Number(mapId.replace(/^s/, "")), ev.id);
    if (!row) return false;
    yesNoAwaitingChild = false;
    let childHandoff = null;
    yesNoBox.open(row, null, {
        onStartEvent: (id) => {
            yesNoAwaitingChild = true;
            const child = (state.wstag[mapId] || []).find((e) => e.id === id);
            if (!child) {
                storyDbg("YESNO child", id, "missing on", mapId);
                yesNoBox.childDone();
                return;
            }
            // The child's own HANDOFF (e.g. s210 Yes -> event 13 -> s212) is the
            // parent's result: the caller handles it as it would the child's.
            playStoryEvent(child, (handoff) => {
                childHandoff = handoff ? { ...handoff, yesNoChild: child } : null;
                yesNoBox.childDone();
            });
        },
        onClose: () => {
            yesNoAwaitingChild = false;
            onDone?.(childHandoff);
        },
    });
    return true;
}
// A native eight-topic help menu event (the "Family A" five of
// event-machine-synthesis-2026-08-03.md): the controller shows eight titles, opens the chosen
// topic's page and closes on "Return" or Cancel, starting nothing. Tried before the Yes/No boxes,
// which are the other native family. Returns false when `ev` is not one of the five.
function playHelpMenuEvent(ev, onDone) {
    if (!USE_TRANSLATED_HELP_MENU) return false;
    const mapId = currentMap().id;
    const row = engineUi?.helpMenuFor?.(Number(mapId.replace(/^s/, "")), ev.id);
    if (!row) return false;
    storyDbg("HELP MENU", row.module, "event", ev.id, "text", "0x" + row.textHandle.toString(16));
    helpMenuBox.open(row, null, { onClose: () => onDone?.() });
    return true;
}
// The Bug-Maze switch tiles (s745/s746, the "darkSwitch" native-event family): three
// step-tile events that throw the stage's pad controller between its two layouts. The
// command body is a faithful port (engine/systems/dungeon-switch.ts) — it plays SWITCH02
// only on a real state change and writes the arm word, exactly as wstag745 0x244/0x2c4/0x344
// do. The pad's second-layout tile GEOMETRY is not decoded, so this arms the maze latch
// rather than drawing a second mask; that gap is named in the module header, not filled.
function playDungeonSwitchEvent(ev, onDone) {
    const mapId = currentMap().id;
    const cmd = dungeonSwitchCommand(mapId, ev.id);
    if (!cmd) return false;
    const object = state.padSwitch ?? (state.padSwitch = newPadSwitchObject());
    const res = applyDungeonSwitchCommand(object, cmd);
    state.padSwitch = res.object;
    // The object's own tick leaves the maze's live-layout latch (obj stays in the state the
    // command set until its pending sub-state flips it; the latch is written by the tick).
    state.padLayoutLatch = cmd.state === 2 ? 1 : 0;
    if (res.playSwitch) sfx.play("switch02");
    storyDbg("DUNGEON SWITCH", mapId, "event", ev.id, "→ state", cmd.state, "arm", cmd.arm);
    onDone?.();
    return true;
}
// The Undersea Base room-phase switch (s810, the "gunslinger" native-event family):
// the two step-tile events that swap the room's active type-7 trigger map and its
// own 24-byte step program. The transaction is a faithful port
// (web/gunslinger-switch.js) of wstag810.s file 0xc4c / 0xcb0, and the data it
// swaps to is web/assets/data/stage_layout_variants.json
// (tools/extract_stage_layout_variants.py). The rooms are reachable because each
// layout's grid carries a cell whose step index is the layout's own op-8
// start_event — layout 0 byte 0x1f -> 9001, layout 1 byte 0xb5 -> 9000.
function playGunslingerEvent(ev, onDone) {
    const mapId = currentMap().id;
    const cmd = gunslingerSwitchCommand(mapId, ev.id);
    if (!cmd) return false;
    const s = mapId.replace(/^s/, "");
    const latch = state.gunslingerLatch?.[s] ?? 0;
    const res = applyGunslingerSwitch(latch, cmd);
    (state.gunslingerLatch ??= {})[s] = res.latch;
    if (res.fires) {
        // Point the room at the new phase: both the type-7 grid the step VM samples
        // and the step program it indexes (scene+0x14). The OnStep rows are keyed by
        // event id and already exist for BOTH layouts (layout 0's program carries
        // start_event(9001) and start_event(9000); layout 1's carries 9000).
        const layout = (state.stageLayoutVariants?.[mapId]?.layouts ?? [])[res.layout];
        if (layout) {
            if (state.storySteps?.[s]) state.storySteps[s].steps = layout.steps;
            if (layout.grid) state.storyGrids[s] = layout.grid;
        }
        storyDbg("GUNSLINGER SWITCH", mapId, "event", ev.id, "→ program",
            layout ? layout.program : "(no data)", "latch", res.latch);
    }
    onDone?.();
    return true;
}
// ── The s260 Cargo Tower AUCTION ────────────────────────────────────────────
//
// WHAT A PLAYER MEETS.  Walk into the Cargo Tower while the story stands on one
// of the sixteen auction beats and the auctioneer Mr. Smith is already calling
// the lot: the crowd shouts its bids, he asks "Bid at N BIT?", and a Yes/No box
// takes the answer.  Yes pays the bid out of your BIT and hands you the lot's
// item; No passes.  Either answer closes the lot for good, and the scene walks
// you out to the Water Tunnel.
//
// THE SYSTEM is decoded and ported once (engine/systems/auction.ts):
//   * the gate is FIELDSTG_runStoryEvents (pro/fieldstg.s RAM 0x80084b40): on a
//     field load it starts the first FIELDSTG_progressEvents record whose
//     `progress` equals the master story ordinal [0x8004b370], whose flag
//     (0x400+N) is clear and whose affordability condition (0x7074+j) holds;
//   * the open script plays, then the lot's question event (start = askChoiceN);
//   * the confirmed answer starts the accepted / pass script; when that ends its
//     FIELDSTG_endChoiceNAnswerM handler applies the writes — pass sets the lot's
//     flag, bid also subtracts the BIT and grants the item;
//   * every accepted and pass script ends HANDOFF 530 766 165, the tower's own
//     scripted force-exit to the Water Tunnel (s275).
//   Claims: fieldstg-progressevents-table-2026-10-09,
//   fieldstg-choices-table-2026-10-09, fieldstg-events-choice-wiring-2026-10-09,
//   fieldstg-askchoice-constructors-2026-10-09,
//   fieldstg-endchoice-flag-handlers-2026-10-09,
//   fieldstg-endchoice-code-consequences-2026-10-09,
//   fieldstg-auction-bid-questions-2026-10-09,
//   fieldstg-auction-lot-items-2026-10-09; doc
//   docs/research/field/s260-cargo-tower-auction-decoded-2026-07-10.md.
//
// THE NAMED GAP.  FIELDSTG_runChoice's own window state machine — its option
// windows, cursor and confirm handoff — is listed under "Not yet decoded here"
// in docs/research/scripting/field-script-engine-verified.md.  The question is
// therefore shown through the walker's existing decoded question box
// (web/choice.js, the pixel-sampled system window), with the question and the
// two answers taken verbatim from the lot's esdmg260 entry; nothing about the
// question's own window is invented.
const AUCTION_STAGE = "s260";

/** A wstag-shaped row for one of the auction's events, so the ordinary cutscene
 *  path plays it: its disasm, its esdmg260 text entry, and the force-exit the
 *  answer scripts carry (HANDOFF 530 → the Water Tunnel). */
function auctionScriptRow(eventId) {
    const au = state.auction;
    const e = au?.events?.[String(eventId)];
    if (!e) return null;
    const handoff = (e.disasm || []).find((l) => l.startsWith("HANDOFF"));
    const entry = e.entry;
    return {
        id: eventId,
        // The region<<16|entry convention: region 0x119 is ESDMG260.
        flag_key: "0119" + String(entry).padStart(4, "0"),
        esdmg_stage: "260",
        esdmg_entry: entry,
        disasm: e.disasm,
        ...(handoff ? { handoff_to: au.force_exit?.stage != null ? "s" + au.force_exit.stage : undefined } : {}),
    };
}

/** One line of an esdmg260 entry as plain text (markup stripped, player name
 *  substituted) — the question box draws text, not pack bytes. */
function auctionPlainLine(raw) {
    if (!raw) return null;
    const parsed = parseEntry(raw, state.playerName || "Junior");
    const line = parsed.pages.flat().join(" ");
    return line.length ? line : null;
}

/** The arrival gate: does a lot fire on this field load, and if so run it.
 *  Returns "fired" (the auction took over), "none" (nothing eligible) or "wait"
 *  (the field is busy right now — the caller retries next frame, exactly as the
 *  disc's own runStoryEvents tick does). */
function runAuctionArrival(mapId) {
    if (mapId !== AUCTION_STAGE) return "none";
    const au = state.auction;
    if (!au?.lots?.length || !engine) return "none";
    // The disc asks once per field load, behind the same field-owned locks the
    // rest of the arrival work respects: no handoff in flight, no fade, no box.
    if (engineBridge?.isBusy() || state.handoffHold || fade.dir !== 0) return "wait";
    if (choice.isOpen() || textbox.isOpen() || cutscene.isActive()) return "wait";
    const ordinal = Number(engine.state.vars.get("$story.ordinal") ?? 0);
    const lot = selectAuctionLot(au.lots, ordinal, engine.state.flags);
    if (!lot) return "none";
    storyDbg("AUCTION", AUCTION_STAGE, "lot", lot.n, "bid", lot.bid, "item", lot.item);
    startAuctionLot(lot);
    return "fired";
}

/** One lot, start to finish, through the engine's own driver. */
function startAuctionLot(lot) {
    let answerRow = null;
    const host = {
        playScript: (eventId, onDone) => {
            const row = auctionScriptRow(eventId);
            if (!row) { onDone(null); return; }
            if (eventId === lot.events.accepted || eventId === lot.events.pass) answerRow = row;
            playStoryEvent(row, (handoff) => onDone(handoff ?? null));
        },
        askQuestion: (l, onAnswer) => {
            // The question and the two answers are the lot's esdmg260 choice entry
            // (FIELDSTG_choices[N].text, entry strings 0/1/2 — claim
            // fieldstg-auction-bid-questions-2026-10-09).  The box is the walker's
            // decoded question window; see the named gap above.
            const strings = state.events?.["260"]?.[String(l.entries.choice)]?.strings ?? [];
            const prompt = auctionPlainLine(strings[0]) ?? ("Bid at " + l.bid + " BIT?");
            const yes = auctionPlainLine(strings[1]) ?? "Yes, bid.";
            const no = auctionPlainLine(strings[2]) ?? "No, I'll pass.";
            storyDbg("AUCTION QUESTION", prompt, "yes:", yes, "no:", no);
            choice.open(prompt, [yes, no], (idx) => onAnswer(idx === 0 ? "accept" : "pass"));
        },
        writeFlag: (id, value) => engine.writeStoryFlag(id, value),
    };
    runAuctionLot(lot, host, (handoff) => {
        // The answer script's own HANDOFF is the tower's force-exit (530 → s275).
        if (handoff) doStoryHandoff(answerRow, handoff);
    });
}
window.__auctionArrival = runAuctionArrival;   // verifier hook (tools/verify_s260_auction.mjs)
window.__auctionScriptRow = auctionScriptRow;
// Verifier hook: the arrival fade's completion calls checkStageCutscene, and a debug
// jump (window.__setMap) skips the fade — this is that same call, for tests.
window.__stageEnter = (mapId) => checkStageCutscene(mapId);

function playStoryEvent(ev, onDone) {
    if (!ev.disasm?.length && playHelpMenuEvent(ev, onDone)) return;
    if (!ev.disasm?.length && playYesNoEvent(ev, onDone)) return;
    if (!ev.disasm?.length && playDungeonSwitchEvent(ev, onDone)) return;
    if (!ev.disasm?.length && playGunslingerEvent(ev, onDone)) return;
    storyDbg(
        "EVENT FIRED",
        ev.flag_key,
        "esdmg" + ev.esdmg_entry,
        "on",
        currentMap().id,
        "→ handoff_to:",
        ev.handoff_to || "(screen-route)",
        "| firstSAY:",
        (ev.disasm || []).find((l) => l.startsWith("SAY")) || "(none)",
    );
    let strings = null;
    if (ev.esdmg_entry !== null && ev.esdmg_stage != null) {
        const esdmgData = state.events[ev.esdmg_stage];
        const entry = esdmgData?.[String(ev.esdmg_entry)];
        strings = entry?.strings ?? null;
    }

    let hooks = null;
    if (ev.flag_key === "014a0001" && state.findings && !USE_NATIVE_PACK) {
        const mi = state.findings.menu_interleave;
        hooks = { afterSay: {} };
        hooks.afterSay[mi.pack_choice_after_say] = (resume) => {
            // Native "Choose a Starter Pack" screen (stplnmet wizard step 2),
            // replacing the old plain choice-list. On confirm it proceeds to
            // the existing partner picker.
            state.packSelect = openPackSelect();
            state.packSelectDone = () => {
                const packIdx = state.packSelect.sel();
                state.packSelect = null;
                // Registration only records the chosen pack. The first listed
                // Digimon is the initial lead; formation can be changed later
                // through Status > Sort. Ownership/field followers begin only
                // after the selected s212 download variant completes.
                const memberIds = PACKS[packIdx].members.map((m) => m.charId);
                state.pendingParty = grantPack(memberIds, 0).party;
                state.packId = "ABC"[packIdx];
                engine?.state.vars.set("$party.pack", packIdx); // s212 download gate selector
                localStorage.setItem("pendingParty", JSON.stringify(state.pendingParty));
                localStorage.setItem("packId", state.packId);
                resume();
            };
        };
    }

    // Save original positions of static NPCs so we can restore them after the cutscene
    // (cutscene SETPOS/WALKTO moves them in-place; they must return to spawn positions).
    const mapId = currentMap().id;
    const preCutsceneScene = state.scenes[mapId];
    if (preCutsceneScene) {
        for (const npc of preCutsceneScene.npcs) {
            if (!npc._ephemeral) {
                npc._origX = npc.x;
                npc._origY = npc.y;
            }
        }
    }

    cutsceneEsdmgRef = strings ? { file: "esdmg" + ev.esdmg_stage, entry: Number(ev.esdmg_entry) } : null;
    cutscene.start(
        ev.disasm,
        strings,
        () => {
            // s212 events 10/11/12 are the pack-specific Tamer Service
            // downloads (flags 01120003/4/5). This is the acquisition boundary:
            // before it there is no active partner or field party.
            if (["01120003", "01120004", "01120005"].includes(ev.flag_key)
                && Array.isArray(state.pendingParty) && state.pendingParty.length) {
                state.party = [...state.pendingParty];
                state.pendingParty = null;
                localStorage.setItem("party", JSON.stringify(state.party));
                localStorage.removeItem("pendingParty");
                setCharacter(manifestIndexOf(state.party[0]));
                battle.initializePartyStats(state);
                const engineParty = state.party.map((_, i) => i + 1);
                engine?.state.party.load({ members: engineParty, lead: engineParty[0] });
                // The download is the ownership boundary for the roster too: the pack's
                // three partners are obtained, which is what the bank-0x70 "do you own
                // slot N" dialogue gates read back and what keeps the Digimon Lab from
                // offering you a partner you are already walking around with.
                state.rosterOwned = rosterMaskForParty(state.rosterOwned, state.party);
                refreshPartyCharisma();   // the party just came into existence
            }
            // Restore static NPC positions, clear cutscene state, remove ephemerals.
            const scene = state.scenes[currentMap().id];
            if (scene) {
                for (const npc of scene.npcs) {
                    if (npc._origX !== undefined) {
                        npc.x = npc._origX;
                        npc.y = npc._origY;
                    }
                    delete npc._origX;
                    delete npc._origY;
                    delete npc._inCutscene;
                    delete npc.activeClip;
                }
                scene.npcs = scene.npcs.filter((n) => !n._ephemeral);
            }
            // Reset the player's cutscene state, then restore the party trail.
            delete state._inCutscene;
            delete state._cutTarget;
            delete state.activeClip;
            state._animTime = 0;
            if (cutscene.partyGatherAt != null) parkGatheredFollowers();
            else resetFollowers();

            // Ordinal advance is owned by the caller: engine.completeEvent for talk/stage-enter
            // events (bridge), and the trigger-system playEvent wrapper for OnStep cutscenes.
            onDone(cutscene.handoff || null);
        },
        hooks,
    );
}

// Route a story event's handoff: screen-id routing (warp / name-entry), falling
// back to the event's explicit handoff_to map.
//
// The HANDOFF op carries a SCREEN id, and a screen can own two overlays — the
// ordinary stage and its s9xx story variant, the variant loading only at master
// progress ordinal 0x2d (docs/research/field/door-warp-decode.md). `screenRouter`
// applies that rule; `ev.handoff_to` is the extractor's precomputed label and is
// always the table's PRIMARY stage, so taking it first silently disabled the alias
// rule for every cutscene handoff. All 106 shipped `handoff_to` values equal the
// router's non-alias result, so routing first changes nothing except at 0x2d,
// where it fixes the 11 handoffs that land on an alias screen. Two of those are
// the Digimon Arena finale: the front desk hands off to the arena floor (screen
// 632 → s927, the room Kurt is in, not the empty s233), and the victory line
// hands back to the finale desk (screen 631 → s926).
/** The 25 save points' launcher codes `0xC00 | slot` (0xC01..0xC19). */
const isSavePointHandoffId = (id) => id >= 0xc01 && id <= 0xc19;

function doStoryHandoff(ev, handoff) {
    // The decoded save-point handoff: every inn/tower/city save event ends in
    // `HANDOFF 0xC00|slot`, which the resident launcher loads as pro/stgmcard in
    // SAVE mode with that save point (engine/dw3/save-points.ts, and the
    // chain in its header). The walker opens the same native screen instead of
    // routing the id as a stage warp — 0xC01..0xC19 are not stage ids.
    const spSlot = isSavePointHandoffId(handoff?.screenId)
        ? handoff.screenId & 0xff
        : null;
    if (spSlot != null) {
        const sp = savePointBySlot(spSlot);
        openMemoryCard("save", null, sp);
        return;
    }
    const routed =
        handoff?.screenId != null
            ? screenRouter.route(handoff.screenId, currentMap().id)
            : null;
    if (ev.handoff_to) {
        // A cutscene handoff to a mapped stage. The DESTINATION now comes from the
        // router when it resolves (so the alias rule applies); the op's own spawn
        // point still governs where the player stands, exactly as before — routing
        // decides which overlay of the screen loads, not the spawn.
        const to = routed?.kind === "warp" ? routed.to : ev.handoff_to;
        const idx = state.manifest.maps.findIndex((mm) => mm.id === to);
        if (idx >= 0) {
            storyDbg(
                "WARP (event handoff_to)",
                currentMap().id,
                "→",
                to,
                to === ev.handoff_to ? "" : `(alias of ${ev.handoff_to})`,
            );
            startTransition({
                to,
                spawnX: handoff.x,
                spawnY: handoff.y,
                dir: DIR8_CS[handoff.dir & 7],
                scripted: true, // cutscene handoff — bypass the OnExit player-exit gate
            });
        }
    } else {
        // No mapped stage on the event: the opening flow's native screens. Behaviour
        // here is unchanged — these warp with the stage's default spawn, not the op's.
        const r = routed;
        if (!r)
            console.warn(
                "[handoff] unresolved screen id",
                handoff.screenId,
                "on",
                currentMap().id,
            );
        if (r?.kind === "warp") {
            storyDbg(
                "WARP (screen",
                handoff.screenId + ")",
                currentMap().id,
                "→",
                r.to,
            );
            startTransition({
                to: r.to,
                spawnX: null,
                spawnY: null,
                dir: "down",
                scripted: true, // cutscene handoff — bypass the OnExit player-exit gate
            });
        } else if (r?.kind === "nameentry") {
            if (USE_NATIVE_PACK) {
                state.packSelect = openPackSelect();
                state.packSelectDone = () => {
                    const packIdx = state.packSelect.sel();
                    state.playerName = state.packSelect.accountName();
                    const memberIds = PACKS[packIdx].members.map((m) => m.charId);
                    state.pendingParty = grantPack(memberIds, 0).party;
                    state.packId = "ABC"[packIdx];
                    engine?.state.vars.set("$party.pack", packIdx);
                    localStorage.setItem("playerName", state.playerName);
                    localStorage.setItem("pendingParty", JSON.stringify(state.pendingParty));
                    localStorage.setItem("packId", state.packId);
                    state.packSelect = null;
                    checkStageCutscene(currentMap().id);
                };
                return;
            }
            state.nameEntry = openNameEntry({});
            state.nameEntryDone = () => {
                state.playerName = state.nameEntry.value();
                localStorage.setItem("playerName", state.playerName);
                state.nameEntry = null;
                checkStageCutscene(currentMap().id); // ev 3 (014a0002) fires next
            };
        }
    }
}

function checkStageCutscene(mapId) {
    storyDbg(
        "ENTER",
        mapId,
        "at",
        Math.round(state.x) + "," + Math.round(state.y),
        "— onStageEnter (any EVENT printed next = AUTO-fired on entry)",
    );
    state.gondolaAutoFired = false; // re-arm the no-card gondola auto-board each visit
    // A returning visit must not inherit last visit's falling rocks: the stage's
    // own actor list is rebuilt from the script's SETANIMs on this entry.
    clearStageObjects(mapId);
    // The original's field character is destroyed with its stage and the next
    // constructor re-reads the map origin into +0x50/+0x54 (fieldstg file
    // 0xe744-0xe760), so the accumulated displacement starts again at zero here.
    resetFieldChar();
    resetFieldBlanks();
    // The stage's ORDINARY ambience is OUR translated code: the point-record
    // actors, the rocks, the street corner and every other stage-object member
    // are built and ticked by web/stage-objects.js over engine/systems/** (the
    // boot happens in web/effects.js prepareEffects and the tick in
    // paceStageObjects). Only the explicit ?nativeStages research route boots
    // the original overlay here; with no flag the interpreter never runs, and
    // it is not asked for (native_stage_reference_load is skipped above).
    if (USE_NATIVE_STAGE) {
        try {
            enterNativeStage(mapId, {
                setFlag: (id, v) => flagBackend.set(id, !!v),
                getFlag: (id) => flagBackend.get(id),
                rand16: () => RAND_U16() & 0xfff,
                ordinal: () => Number(engine?.state.vars.get("$story.ordinal") ?? 0),
                startEvent: (id) => storyDbg("NATIVE start_event", id, "(ambience-initiated; not auto-played)"),
                playPackedSound: (id) => {
                    const stem = PACKED_JINGLES[`0x${(id >>> 0).toString(16).padStart(8, "0")}`];
                    if (stem) bgm?.playJingle?.(stem);
                },
            });
        } catch (e) {
            console.warn("[native]", mapId, e);
        }
        // One native tick BEFORE the OnEnterMap event: on the console the street
        // entry's first update creates the screen-content driver (id 0x321) and
        // THEN starts the opening scene (wstag780 0x800a74cc calls the event
        // launcher itself). Firing the event first made its SETANIM 0x321 hits
        // construct a second driver through the effect registry, so the wall
        // screens ran two animations at once (the announcement stinger's sequence
        // under the default loop). Tick once so the stage owns its actors first.
        try {
            tickNativeStage(mapId);
        } catch (e) {
            console.warn("[native] first tick", mapId, e);
        }
    }
    if (engineBridge) engineBridge.onStageEnter(mapId);
    // The s260 auction's arrival gate: FIELDSTG_runStoryEvents runs on the field
    // load, so arm it here; the per-frame tick below fires the lot once the field
    // is free (it retries, like the disc's own tick, instead of missing the beat).
    state.auctionPending = mapId === AUCTION_STAGE;
}

// Hand the leader to the op-13 launch controller (engine/systems/launch-pad.ts):
// no fade, no screen change — the pad walk, the pad's state-2 animation and the
// quarter-sine flight all happen on the live map.
//
// `pad` is the setup executor's own reading of the record — the destination cell
// and the arrival facing word out of `params[1..3]`, the three words the disc's
// pad controller reads out of the record it was handed (`&record[0xa]`,
// fieldstg.s:0xc7e4 stores that pointer at controller+0x54). Nothing here is
// per-place: a stage supplies its step program and its type-0x17 pad objects.
function beginLaunch(pad) {
    if (state.launch) return;
    // The controller picks the nearest registered type-0x17 pad by the native
    // |dx| + 2*|dy| metric, not the trigger rectangle — so the leader walks to
    // the real pad and the flight starts from its centre.
    const found = nearestPad(launchPads(currentMap()?.id), { x: state.x, y: state.y });
    state.launch = startLaunch({
        // Only the stand point, and only if this stage registered no pad object
        // to stand on: the cell the player is standing on IS the pad cell, which
        // is the whole trigger (fieldstg.s:55f8, the type-7 lookup at the
        // player's own x/y).
        x: state.x, y: state.y, w: 0, h: 0,
        spawnX: pad.spawnX, spawnY: pad.spawnY,
        dir: fieldDirectionFromIndex(pad.dirIndex),
        stepOp: 13, transition: "launch", launchPad: true,
    }, { x: state.x, y: state.y }, found);
    state.iceSlide = null;
    state.moving = false;
    state.stopping = false;
    // Native: the actor method sets facing 0 before installing the handler.
    state.dir = "down";
}

// The disc runs the setup arm EVERY FRAME while the player stands on a live
// step tile, with no button read in it (fieldstg.s:5c94-:5cb8 — see
// engine/systems/trigger-system.ts), so a launch pad fires on contact: walk onto
// one and Junior starts walking to it, exactly as the Spy Satellite pads and the
// ice pads do. The op-13 handler is the disc's only setup opcode that walks the
// leader somewhere by itself (actor->vt[0x158], fieldstg.s:5820); every other
// setup opcode either raises the indicator bubble or hands the tile to the
// button (`playback()`).
//
// Two guards the disc keeps elsewhere: the scene lock its own op 14 raises
// (`[0x80099DD8] = 1` at :0xc7dc, which the driver itself reads at :5c58) and the
// fade, which is the walker's name for a screen handoff in flight.
function stepSetupTick() {
    if (state.launch || state.handoffHold || fade.dir !== 0) return false;
    const pad = stepSetup()?.effect?.pad;
    if (!pad) return false;
    beginLaunch(pad);
    return true;
}

// The disc's SETUP arm ALSO writes the player actor's DRAW-LAYER word (+0x78)
// from a step record's param 0 — setup opcode 5 (pro/fieldstg.s:5605-5615; the
// op the port already carries as StepOpEffect.actor78, scene-step-ops.ts:174).
// +0x78 is the field actor's ordering-table bucket: the renderer F0x8008F52C
// takes it to the 0x1002 draw-context's slot +0x138 (fieldstg.s:12852-12856), so
// the actor's billboard is spliced into OT[n] and its shadow into OT[n+1]. A
// stage's own step program therefore decides which side of the ground its leader
// draws on, and all five stages that author op 5 use exactly 8 (behind the
// ground) and 4 (the entity bucket, fieldstg.s:14771).
//
// The word is NOT cleared when the player leaves the tile — only another op-5
// record writes it — so one entrance cell holds the bucket for a whole corridor
// and the matching exit cell restores it. That is the Protocol Ruins tunnel. The
// resident driver is rebuilt per stage (fieldstg.s:5998) and the actor rebuilt
// at 4, so a map change resets it here; the gates are the setup arm's own
// (state→scene_struct+0x54/+0x58, fieldstg.s:5c54/:5c64), the same ones
// stepSetupTick() honours.
let stepSetupBucketMap = null;
function stepSetupBucketTick() {
    if (state.launch || state.handoffHold || fade.dir !== 0) return;
    const id = currentMap().id;
    if (stepSetupBucketMap !== id) {
        stepSetupBucketMap = id;
        state.playerDrawBucket = ENTITY_BUCKET;
    }
    const eff = stepSetup()?.effect;
    if (eff && eff.actor78 != null) state.playerDrawBucket = eff.actor78 & 0xff;
}

function startTransition(exit) {
    if (fade.dir !== 0 || state.diveDemo) return;
    // A launch pad never arrives here: op 13 is a SETUP opcode, so `activeExitAt`
    // does not arm a pad row and the disc's playback op 13 is its own epilogue.
    // Contact is `stepSetupTick()`.
    // Give the engine first refusal on PLAYER-initiated exits: raise OnExit{to}. A gated exit-event
    // (e.g. the gondola's Blue Card check) plays its cutscene and performs its OWN HANDOFF warp — or
    // refuses and keeps us here. Only when no exit-event matches do we run the plain transition.
    // SCRIPTED handoff warps (doStoryHandoff, exit.scripted) bypass this — they are already executing
    // a warp mid-cutscene (engineBridge is busy, so onExit would otherwise suppress the fade).
    if (!exit?.scripted && engineBridge && exit?.to && engineBridge.onExit({ to: exit.to })) return;
    if (exit?.to) prepareStageAssets(exit.to);
    // A DIVE (step op 9 hole / op 10 water) is not a plain warp. The native
    // launcher F0x8008f3e4 first freezes the field character -- [char+0x2c](char,1),
    // then clears char+0x108 and char+0x60 -- and only then hands the transition
    // to the type-7 cast-rebuild controller. Reproduce the freeze so the player
    // visibly stops on the dock/hole instead of walking into the fade.
    //
    // The Digi-Egg activation cue is packed sound 0x00040004 = DIGIMENT
    // ("Digimental" — the Japanese name for a Digi-Egg). The cast-rebuild body
    // plays it at fieldstg file 0x8774 (RAM 0x8008b424) through the ordinary
    // sound pointer [0x80045c48], immediately after handing the fields the dive
    // launcher seeded — a0 = [obj+0x74] player x, a1 = [obj+0x78] player y,
    // a2 = [obj+0x70] hole/water mode — to the effect spawner F0x80085e0c.
    // Runtime-confirmed: ledger EV-seabed9entry captured
    // `F0x8002006c a0=0x00040004 ra=0x8008b42c` at frame 10 of a Seabed entry,
    // with no other packed sound through frame 360.
    //
    // The presentation those anchors describe is now modelled: the dive hands
    // the screen to the demo controller instead of to the plain fade. The demo
    // owns its own blackout, so the fade is NOT started here — it is started at
    // the far end, because the cyan tile wipe and the location-title card the
    // capture sees at f270-360 belong to the ordinary stage change, not to the
    // demo (decode § 4, "the demo does not own the ~360 frames").
    //
    // (Input is suppressed for the whole presentation by the `state.diveDemo`
    // gate in the movement step; what the freeze adds is the visible stop clip
    // on the dock instead of a mid-stride pose.)
    const diveForm = diveFormForStepOp(exit?.stepOp);
    if (diveForm) {
        state.moving = false;
        state.stopping = true;
        state.stopTime = 0;
        sfx.play("digiment");
        if (diveDemoReady()) {
            state.diveDemo = {
                // op 9 = hole (Digmon), op 10 = water (Submarimon).
                mode: exit.stepOp === 9 ? "hole" : "water",
                frame: 0,
                accumulator: 0,
                cued: false,
                exit,
                // The particle burst is spawned at the player's own position and
                // keeps drawing after the field cast is gone, so its anchor is
                // captured here and held for the whole run.
                anchorX: state.x,
                anchorY: state.y,
            };
            return;
        }
    }
    fade.dir = 1;
    fade.pending = exit;
}

// The ordinary stage change: load the destination's assets and start the decoded
// wipe. This is what 0x8008B6D4's phase-2 handler reaches once its `+0x68`
// countdown is spent (fieldstg.s:8994/:899c) — the shared tail every field stage
// change goes through, whether the handoff came from an op-1 door (which passes 0
// and loads at once) or from an op-14 pad handoff (which passes 0x3c and waits).
function runStageHandoff(exit) {
    if (exit?.to) prepareStageAssets(exit.to);
    fade.dir = 1;
    fade.pending = exit;
}

// The legacy hand-drawn stage wipe, kept for ?legacyWipe=1. The decoded one is
// below it.
const LEGACY_WIPE_TILE = 128; // 64x64 at 320x240, doubled for the 640x480 view
const LEGACY_WIPE_LEVEL = 128;
function drawLegacyTransitionWipe(ctx) {
    const p = Math.max(0, Math.min(fade.alpha, 1));
    if (p <= 0) return;
    if (p >= 1) {
        ctx.save();
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.restore();
        return;
    }
    // The clear window keeps the decoded aspect: width and height fall in the
    // 10 : 7 ratio.
    const winW = VIEW_W * (1 - p);
    const winH = VIEW_H - (VIEW_W - winW) * 0.7;
    const wx = (VIEW_W - winW) / 2;
    const wy = (VIEW_H - winH) / 2;
    subtractLayer(ctx, 0, 0, VIEW_W, VIEW_H, (layer) => {
        layer.fillStyle = dimFillStyle(p * LEGACY_WIPE_LEVEL);
        for (let y = 0; y < VIEW_H; y += LEGACY_WIPE_TILE)
            for (let x = 0; x < VIEW_W; x += LEGACY_WIPE_TILE)
                layer.fillRect(x, y, LEGACY_WIPE_TILE, LEGACY_WIPE_TILE);
        // Black subtracts nothing, so this window stays bright: the field
        // shows through it until it closes.
        layer.fillStyle = "#000";
        layer.fillRect(wx, wy, winW, winH);
    });
}

// The A28 checkerboard loading wipe's draw arm (fieldstg asm 0x76D4-0x78EC):
// one 64x40 quad per cell the schedule has not yet consumed, at the cell's
// current (slid) position. The grid positions are SCREEN pixels (0..320 x
// 0..240, asm 0x73D4-0x742C), so this is a screen overlay, not a world draw.
//
// The quads the original emits are flat grey 0x80 (asm 0x7828-0x7830) with a
// per-row ramp and a texture/blend the capture could NOT resolve -- the captured
// screen is a sparse lattice of pale marks, not a wall of grey tiles
// (docs/research/field/captures/battle-wipe-2026-09-13/README.md, "the visible
// pattern"). So this draws the DECODED mechanism -- the tiles slide inward and
// vanish -- and leaves the exact colour/blend named as open. Do not read the
// grey here as the original's look.
function drawCheckerboardWipe(ctx) {
    const cb = state.wipe28;
    if (!cb) return;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "rgb(128,128,128)"; // the draw arm's 0x80
    for (const q of checkerboardQuads(cb))
        ctx.fillRect(q.x * ZOOM, q.y * ZOOM, q.w * ZOOM, q.h * ZOOM);
    ctx.restore();
}

// The ordinary stage-change wipe, translated from fieldstg F0x8008A5E4
// (~/ddw3/asm/dw2003/pro/fieldstg.s file 0x7934) with the frame numbers in
// web/stage-wipe.js and the evidence in .bunny-scratch/wipe-report.md.
//
// Closing: the field stays visible through a window centred on the player, the
// window falls 10 px wide and 7 px tall every frame, and everything outside it
// is covered by the tile lattice at a level that rides 0x400 up to 0x8000 — so
// the outside is black after 8 frames while the window keeps closing for 24
// more. Opening: the cover is a full-height band that pulls in 8 px at each
// edge per frame for 21 frames, so the new field comes back at the two sides
// while ONE black band narrows toward the middle.
//
// Native coordinates: the state, the geometry and the tile size are all 320x240
// (VIEW_W/VIEW_H are the device buffer), so everything is scaled by ZOOM here.
function drawTransitionWipe(ctx, camX, camY) {
    if (USE_LEGACY_WIPE) return drawLegacyTransitionWipe(ctx);
    const clock = state.wipe;
    if (clock.phase !== 1 && clock.phase !== -1) return;

    // The original centres the window on the player entity's screen position
    // (entity +0x58/+0x5C) and falls back to the screen centre when there is
    // none. state.x/state.y are the player's map position; the camera has
    // already been snapped to the device grid, so the difference is the pixel
    // the player is drawn on.
    const px = Math.round(state.x - camX);
    const py = Math.round(state.y - camY);
    const centred = px >= -VIEW_W && px <= VIEW_W && py >= -VIEW_H && py <= VIEW_H
        ? { x: px, y: py }
        : null;

    if (clock.phase === -1) {
        const f = openFrame(clock.frame);
        if (f.bandW <= 0) return; // the band is gone: the field is fully back
        paintWipeCoverBand(ctx, f.level, f);
        return;
    }

    const f = closeFrame(clock.frame);
    const win = closeWindow(clock.frame, centred?.x, centred?.y);
    if (f.level <= 0) return; // the first frame paints the cover at level 0
    paintWipeCoverAround(ctx, f.level, win);
}

// The two objects this decides between. The field screen builds one 0x1001, four
// 0x1002, a 0x1003 and a 0x1004 bound to the screen rect
// (`exe-decomp/fieldstg_c/F0x8008aa10.c:83-99`), and the tile cover is written
// on the 0x1001 one: `F0x80086CE4(0x1001, unk50)` at fieldstg file 0x7BA8
// (close) and `F0x80086CE4(0x1001, 0x8000)` at 0x7CD8 (open).
//
// Which object the WIPE's own rect goes on is the polarity:
//
//   state 1 (close)  unk110(x, y) and unk114(w, h) on the 0x1002 object
//                   (0x7B44/0x7B4C) -- a DIFFERENT object from the one the cover
//                   is drawn through, so that rect is the window the field is
//                   still visible through and the cover fills everything
//                   AROUND it.
//   state 2 (open)   unk110(w, 0) and unk114((0xA0 - w) * 2, (0x78 - 0) * 2) on
//                   the 0x1001 object (0x7C18-0x7C20, 0x7C48-0x7C50) -- the SAME
//                   object the cover is drawn through, so that rect bounds the
//                   drawn cover: ONE full-height black band that narrows toward
//                   the middle, with the new field back at the two sides.

// One frame of the close: the 64x64 lattice, darkened by the level, clipped to
// the screen AROUND the window the field still shows through.
function paintWipeCoverAround(ctx, level, clear) {
    const cx = clear.x * ZOOM, cy = clear.y * ZOOM;
    const cw = clear.w * ZOOM, ch = clear.h * ZOOM;
    // Four bands around the window, which is what the original's frame draws:
    // the cover is everywhere the field does not show through.
    const outside = [
        [0, 0, VIEW_W, cy],
        [0, cy + ch, VIEW_W, VIEW_H - (cy + ch)],
        [0, cy, cx, ch],
        [cx + cw, cy, VIEW_W - (cx + cw), ch],
    ];
    subtractLayer(ctx, 0, 0, VIEW_W, VIEW_H, (layer) => {
        layer.fillStyle = dimFillStyle(coverLevel(level));
        for (const [x, y, w, h] of outside)
            if (w > 0 && h > 0) layer.fillRect(x, y, w, h);
    });
    paintWipeSeams(ctx, level, outside);
}

// One frame of the open: the same lattice and level, clipped to the INSIDE of
// the band, so the two screen edges show the field that just arrived.
function paintWipeCoverBand(ctx, level, f) {
    const bx = f.bandX * ZOOM, bw = f.bandW * ZOOM, bh = f.bandH * ZOOM;
    // The subtraction is scoped to the band itself: `subtractLayer` subtracts
    // everything the painter leaves non-black, so filling the whole screen and
    // then drawing the band would cover the two edges as well -- the opposite
    // wipe. The painter works in the caller's own coordinates (the region is
    // shifted onto the layer's origin for it), so the rect is stated in screen
    // pixels here, not at the layer's origin.
    subtractLayer(ctx, bx, 0, bw, bh, (layer) => {
        layer.fillStyle = dimFillStyle(coverLevel(level));
        layer.fillRect(bx, 0, bw, bh);
    });
    paintWipeSeams(ctx, level, [[f.bandX, 0, f.bandW, f.bandH]]);
}

// The lattice's 1-px seams: a line on every 64-px cell edge, drawn additively on
// top of the cover at the RGB the rig capture measured for them once the cover is
// at its cap, clipped to the regions the cover owns on this frame.
function paintWipeSeams(ctx, level, regions) {
    const [r, g, b] = seamRgb(level);
    if (r + g + b <= 0) return;
    ctx.save();
    ctx.beginPath();
    for (const [x, y, w, h] of regions)
        if (w > 0 && h > 0) ctx.rect(x * ZOOM, y * ZOOM, w * ZOOM, h * ZOOM);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    const t = ZOOM * WIPE_TILE;
    for (let x = 0; x <= VIEW_W; x += t) ctx.fillRect(x, 0, 1, VIEW_H);
    for (let y = 0; y <= VIEW_H; y += t) ctx.fillRect(0, y, VIEW_W, 1);
    ctx.restore();
}

// One press, from either road.
//
// `k` is a PlayStation button name ("circle", "up", "l1", ...) when the input
// stands for one, and the raw lowercased key otherwise — dev-tool keys and the
// name-entry keyboard have no pad button and travel as themselves. The two
// vocabularies cannot collide (asserted in tests/engine/unit/input-map.test.ts),
// so one string channel carries both and every `handleKey` keeps its signature.
//
// `e` is the KeyboardEvent for a key press, or a stub for a joystick press: the
// pad has no `code`, `shiftKey` or `preventDefault`, so the branches that read
// those are keyboard-only by construction. `raw` is the untranslated lowercased
// key ("" for a pad press) and is what the dev-tool shortcuts read.
function dispatchInput(k, e, raw = "") {
    // F toggles the whole game stage in and out of browser fullscreen. The
    // custom name-entry grid owns letter keys while it is active.
    if (k === "f" && !state.nameEntry) {
        e.preventDefault();
        toggleGameFullscreen(document, document.getElementById("stage"));
        return;
    }
    // Held pad state, for every screen and not only the field. Screens that own
    // the press (the open DRI, language select, shop, ...) return early below,
    // so a trailing add never ran while they held the key and their held-repeat
    // never saw a direction. The field's own poll is skipped whenever one of
    // those screens is open, so the extra entries cannot move the player.
    //
    // Published BEFORE the game-started gate on purpose: the title's Continue
    // opens the memory card in load mode (the original's code 0xC00) while
    // state.started is still false, and that screen samples the held word — with
    // the add behind the gate it received nothing at all (measured: no reads, no
    // text, no cancel).
    if (isPadButton(k)) state.keys.add(k);
    // The country/language select screen runs BEFORE the game starts (the
    // original's boot code 0x1600), so its dispatch sits above the gate too —
    // its confirm is a key EDGE the held word cannot carry.
    if (cntyselNative.isOpen()) {
        e.preventDefault();
        cntyselNative.press(k);
        return;
    }
    if (cntyselMenu.open) {
        e.preventDefault();
        cntyselMenu.handleKey(k);
        return;
    }
    // The memory card also runs BEFORE the game starts: the title's Continue
    // opens it in LOAD mode (web/game.js contEl.onclick) while state.started is
    // still false. The translated card samples the held word, which the publish
    // above already feeds, but the hand-made card (?legacySave=1) reads keys as
    // discrete presses — without this branch its Back never arrives and the
    // player cannot leave it. Scoped to the pre-game case so the running game's
    // own screen order further down is untouched.
    if (!state.started && saveScreen.isOpen()) {
        e.preventDefault();
        saveScreen.handleKey(k, state);
        return;
    }
    if (!state.started) return;

    // Backquote/tilde key: toggle the partner debug editor (dev tool — level/EXP/stats/items).
    // Match the PHYSICAL key via e.code — on many layouts `~` is a dead key so e.key never
    // arrives as "`". Backslash is a no-dead-key fallback.
    if (e.code === "Backquote" || e.code === "Backslash") {
        e.preventDefault();
        debugPanel.toggle();
        return;
    }
    // Debug-only entry point to the native stagslct gate-travel menu (F10 — the
    // real original trigger is unresolved, see web/stagslct.js header).
    if (e.key === "F10" && !stagslctMenu.open) {
        e.preventDefault();
        stagslctMenu.show((mapId) => {
            startTransition({ to: mapId, spawnX: null, spawnY: null, dir: "down", scripted: true });
        });
        return;
    }
    if (stagslctMenu.open) {
        e.preventDefault();
        stagslctMenu.handleKey(raw);
        return;
    }
    if (fightReport.isOpen()) {
        e.preventDefault();
        fightReport.handleKey(k);
        return;
    }

    if (debugPanel.enabled) {
        e.preventDefault();
        debugPanel.handleKey(raw, state);
        return;
    }

    // Ž key (Croatian layout): toggle the story scene-skipper (dev — jump to any ordinal beat).
    if (k === "š") {
        e.preventDefault();
        sceneSkip.toggle();
        return;
    }
    if (sceneSkip.enabled) {
        e.preventDefault();
        sceneSkip.handleKey(raw);
        return;
    }

    // The ordinal-43 field movie owns the pad while it plays: the original's
    // movie object reads one bit — the raw pad's START, which ends the movie
    // early (stdwtitl.s .L0x00000e88-.L0x00000e9c; F0x80083944 case 1). Nothing
    // else reaches the field, which is not stepped while the movie is up.
    if (fieldMovie.isOpen()) {
        e.preventDefault();
        if (k === "start") fieldMovie.skip();
        return;
    }

    // START: toggle main menu (keyboard `i`).
    if (k === "start") {
        if (
            !battle.isActive() &&
            !cutscene.isActive() &&
            !textbox.isOpen() &&
            !dialogueBox.isOpen() &&
            !choice.isOpen() &&
            fade.dir === 0 &&
            !state.nameEntry &&
            !state.packSelect &&
            !shop.isOpen() &&
            !driMenu.isOpen() &&
            !gym.isOpen() &&
            !cardShop.isOpen() &&
            !saveScreen.isOpen() &&
            !fightReport.isOpen() &&
            !cntyselMenu.open &&
            !cntyselNative.isOpen()
        ) {
            // U-27 / home tick: START is not read once the pause menu is open.
            // Cross (walker triangle) closes. START only opens from the field,
            // and it opens on the TOP LIST every time — the menu used to keep
            // whatever screen it was left on, so a hand-off to the Card Album
            // meant the next START landed straight back on CARD FOLDERS.
            // The list itself is opened by openPauseHome(), the ONE pause home:
            // the same call the UI lab's Status Menu button makes.
            if (!state.menuOpen) pauseHome();
            return;
        }
    }

    // CIRCLE mid-cast is the fishing STRIKE. The bobber's tick contains exactly
    // one pad read and it tests only bit 0x2000 = CIRCLE — there is no CROSS
    // branch in it (docs/research/field/fishing-system-decoded-2026-07-11.md:391
    // and :664). The walker used to strike on `x`, which is the Back button, so
    // the strike was on the wrong pad button entirely.
    //
    // Queued rather than applied here so it lands on a field tick. Ahead of the
    // menu-close branch below because a cast locks the field and no menu can be
    // open under it, and ahead of the CIRCLE interact branch further down so the
    // in-flight cast claims the press instead of re-casting.
    if (k === FISH_STRIKE_BIT && state.fishing) {
        state.fishing.strike = true;
        return;
    }

    // The BACK bit, word 0x4000, is the name "cross" (keyboard Escape / `x`).
    // F0x8001270c reads it as logical 0x0E and folds the pause list shut.
    if (k === "cross") {
        // The pause page's own "Back to Menu" action. The page reads the same
        // 0x4000 this branch is on, so it needs no translation: one level back
        // inside the page, and at the page's top level the page folds away and
        // the host's child slot goes NULL — which is what closes the pause
        // (web/status-native.js).
        if (status?.isOpen()) {
            status.handleKey(k, state);
            return;
        }
        if (driMenu.isOpen()) {
            driMenu.handleKey(k, sfx);
            return;
        }
        if (shop.isOpen()) {
            shop.handleKey(k, state);
            return;
        }
        if (gym.isOpen()) {
            gym.handleKey(k, state);
            return;
        }
        if (cardShop.isOpen()) {
            cardShop.handleKey(k, state);
            return;
        }
        for (const ui of [cardAlbum, cardDeck, cardDuel]) {
            if (ui.isOpen()) { ui.handleKey(k, state); return; }
        }
        if (saveScreen.isOpen()) {
            saveScreen.handleKey(k, state);
            return;
        }
        if (state.menuOpen) {
            // Escape/X steps back one screen inside the menu (item list -> sort ->
            // choose-digimon -> digimon detail, etc.); only closes the whole overlay
            // once we're already at the top-level list, matching the real menu's
            // "[triangle] Button: Back to Menu" / "Close Status" footer prompts.
            if (menu.screen === "home") {
                state.menuOpen = false;
                menu.reset();
            } else {
                menu.handleKey(k, state, () => {});
            }
            return;
        }
    }

    // The END card only reads the player's button while it is holding (state 2), and
    // there it runs the timer out rather than cutting away. The translated card samples
    // the held pad itself, every callback, so it needs no keypress of its own.
    if (state.endScreen) {
        e.preventDefault();
        state.endScreen.press?.();
        return;
    }
    // The title screen in the lab: the same three inputs the overlay reads.
    if (state.titleScreen) {
        e.preventDefault();
        if (k === "up") {
            if (state.titleScreen.up()) sfx.play("system02");
        } else if (k === "down") {
            if (state.titleScreen.down()) sfx.play("system02");
        } else if (k === "circle") {
            if (state.titleScreen.confirm()) sfx.play("system00");
        }
        return;
    }

    if (state.packSelect) {
        e.preventDefault();
        const ps = state.packSelect;
        if (k === "up") ps.moveUp();
        else if (k === "down") ps.moveDown();
        else if (k === "circle") {
            ps.confirm();
            if (ps.isDone()) state.packSelectDone();
        }
        return;
    }

    if (state.nameEntry) {
        e.preventDefault();
        const ne = state.nameEntry;
        // The native screen samples the pad's held word once per frame, so it
        // needs no per-key dispatch; the legacy keyboard does.
        if (USE_NATIVE_NAME) {
            ne.handleKey(k, state);
            return;
        }
        // VERIFIED 2026-07-14 (rig save state 5): single 15x7 keyboard, no
        // charset pages. DEL/SPC/arrows/OK are grid cells you navigate to and
        // press — so `press()` dispatches by cell and OK confirms via
        // selectEnd. q/e paging removed (no pages).
        if (k === "up") ne.moveUp();
        else if (k === "down") ne.moveDown();
        else if (k === "left") ne.moveLeft();
        else if (k === "right") ne.moveRight();
        else if (k === "circle") {
            ne.press();
            if (ne.isDone()) state.nameEntryDone();
        }
        else if (k === "backspace") ne.selectDel();
        // Tab kept as a keyboard shortcut for the on-screen OK cell.
        else if (k === "tab") {
            ne.selectEnd();
            if (ne.isDone()) state.nameEntryDone();
        }
        return;
    }

    // THE MEMORY CARD OWNS THE PAD, ABOVE THE FIELD'S OWN SCREENS. 2026-10-04.
    //
    // ONE PRESS, ONE OWNER. In the original the two things that can be up at once
    // here are NOT the same kind of object, and that is what orders the ladder:
    //
    //   * the rest screen is a screen OBJECT of the field. The innkeeper's launcher
    //     is `jal D0x8008c000` (exe/fns.s:7157), which builds it in place with
    //     `F0x80011dac(0x1002)` (pro/fieldstg.s:9445-9452) — the resident class whose
    //     update is F0x800110e0 (exe/fns.s:1538), the 33-state machine the charge
    //     lives in.
    //   * the memory card is an OVERLAY the resident launcher loads by library code:
    //     `f15` takes `D0x8004b3f8 >> 8` as the library index (~/ddw3/asm/dw2003/exe/
    //     f15.s:24-56), and 0xC00|slot >> 8 = 0x0C = STMCRD = pro/stgmcard, whose
    //     constructor reads that code back (engine/dw3/save-points.ts, the producer
    //     chain in its header). It covers the field rather than living in it.
    //
    // So while the card is up the field is not the thing being driven, and the card's
    // branch belongs above the field's screens. The walker runs them as SIBLINGS, so
    // its card branch used to sit below the inn's — and the rest screen also charges
    // the stay while the card samples the held word for itself
    // (web/save-translated.js:218), so one Circle was taken twice: the card advanced
    // AND the inn charged the stay again. Measured on s235: 1000 -> 976 for the stay,
    // then 976 -> 952 under the card (tools/verify_inn_rest.mjs, "the card did not
    // charge the stay a second time").
    //
    // It stays BELOW the branches above it that are not the field: START (whose gate
    // already refuses while the card is open), the fishing strike, the Back ladder,
    // the END card and the title. It is also below the DRI / merchant / gym / card
    // shop / album trio further down, and that is deliberate rather than lazy: those
    // are all reached by their own launcher from the field and none of them can be up
    // at the same time as the card, so no order between them is observable. Only the
    // card-and-inn pair can both be up, so only that pair needed moving. Keep it here.
    if (saveScreen.isOpen()) {
        e.preventDefault();
        saveScreen.handleKey(k, state);
        return;
    }

    // Inn prompt owns the arrows/confirm while open (its own choice widget).
    if (inn.isOpen()) {
        if (k === "up") { e.preventDefault(); inn.moveUp(); return; }
        if (k === "down") { e.preventDefault(); inn.moveDown(); return; }
        if (k === "cross") { e.preventDefault(); inn.cancel(); return; }
        if (k === "circle") { e.preventDefault(); inn.confirm(); return; }
    }

    // Route the d-pad to the choice menu when open
    if (choice.isOpen()) {
        if (k === "up") {
            e.preventDefault();
            choice.moveUp();
            return;
        }
        if (k === "down") {
            e.preventDefault();
            choice.moveDown();
            return;
        }
    }

    // Route all keys to the DRI Select Action screen when open
    if (driMenu.isOpen()) {
        e.preventDefault();
        driMenu.handleKey(k, sfx);
        return;
    }

    // Route all keys to shop when open
    if (shop.isOpen()) {
        e.preventDefault();
        shop.handleKey(k, state);
        return;
    }

    // Route all keys to the gym when open
    if (gym.isOpen()) {
        e.preventDefault();
        gym.handleKey(k, state);
        return;
    }

    // Route all keys to the card shop when open
    if (cardShop.isOpen()) {
        e.preventDefault();
        cardShop.handleKey(k, state);
        return;
    }

    // Route all keys to the album / folder editor / duel when open
    for (const ui of [cardAlbum, cardDeck, cardDuel]) {
        if (ui.isOpen()) {
            e.preventDefault();
            ui.handleKey(k, state);
            return;
        }
    }

    // (the memory card's own branch now sits ABOVE the field's screens, with the
    // rest of that list — see the note above the inn prompt.)

    // Route all keys to menu when open
    if (state.menuOpen) {
        e.preventDefault();
        menu.handleKey(k, state, () => {
            localStorage.setItem("flags", JSON.stringify(state.flags));
            localStorage.setItem("inventory", JSON.stringify(state.inventory));
            localStorage.setItem("bits", String(state.bits));
            localStorage.setItem(
                "partnerStats",
                JSON.stringify(state.partnerStats),
            );
            // chapter is DERIVED from flags (persisted above) — no separate scalar to save.
            // A Charisma Chip eaten or a Charisma Gem/Ring equipped moves the party total
            // that the tamer gates read, and the menu is the only place either happens.
            refreshPartyCharisma();
            if (state.charId) localStorage.setItem("charId", state.charId);
            if (state.playerName)
                localStorage.setItem("playerName", state.playerName);
        });
        return;
    }

    // CIRCLE: confirm choice, advance textbox, or interact with NPC.
    if (k === "circle") {
        e.preventDefault();
        // The native thrust handler's Circle path (.L0x0000b87c) keys the
        // SUB_MOVE loop off and resets its handle the moment the interact
        // button is read while the sub is driving (SUB-Q003).
        if (state.submarimon) syncSubThrustSound(false);
        if (battle.isActive()) {
            battle.handleKey(k);
            return;
        }
        if (choice.isOpen()) {
            choice.confirm();
            return;
        }
        if (textbox.isOpen()) {
            textbox.advance();
            return;
        }
        // A RUNNING SCENE owns the field, exactly as its own textbox owns the press above.
        // The scene runner parks between its ops (WALKTO / WAIT / WAITIDLE) with no box open,
        // and in the disc the field's talk and examine probes belong to the scene runner while
        // it is live (fieldstg's confirm probe F0x8008E210 runs behind the scene state), so a
        // confirm press in that gap reaches the scene and nothing else. Without this the
        // walker's field probes ran in the gap: measured 2026-10-05, pressing confirm while the
        // East Station gondola console's ride scene ran restarted that same scene twenty-two
        // times in a row and the ride never reached its HANDOFF.
        if (cutscene.isActive()) return;
        // The block interaction's field lock ([0x80099de0]): the press cannot
        // reach a talk, a warp or another block while the drill dive runs.
        if (state.blockEngage?.ix.busy) return;
        // Unreachable while a cast runs — the strike branch near the top of this
        // function claims CIRCLE first — but kept as a guard so a future branch
        // inserted above cannot let a mid-cast press re-cast.
        if (state.fishing) return;
        // Standing on a fishing spot, pole in hand: cast. This is checked
        // before zones and NPCs because the spot's step record and the scene
        // controller it retags own the interaction for as long as you stand on
        // it — there is nothing else to talk to on a patch of open water.
        const spot = fishingSpotHere();
        if (spot) {
            startFishingCast(spot);
            return;
        }
        const scene = state.scenes[currentMap().id];
        if (scene) {
            // NPC talk. (The hand-authored zones that used to sit in front of this —
            // an s210 "inn", an s250 shop, two chapter-gate placeholders — were
            // invented and are removed; the real merchants, inns and story events
            // run through NPC talk and the step VM.)
            {
                const cast = sceneCast(scene);
                const visibleNpcs = cast.filter((n) => !n.cutsceneOnly);
                // Field actors occupy a full PS1 tile; allow the front half-tile around
                // obstacles so a player can talk without walking into the NPC/collision edge.
                //
                // Submarimon's own CIRCLE path gates this talk/examine probe on the
                // character's height: at or above 0x2000 the handler branches past
                // the probe (fieldstg.s 0xb834-0xb840), so the sub must have sunk to
                // the thing it is facing. Forms without a height state (Junior,
                // Digmon) are never gated. Deliberately scoped to the talk probe —
                // NOT to exits, ladders or textbox advances, which the native warp
                // trigger owns and which stay usable at any depth.
                const picked = submarimonCanInteract(state.submarimon)
                    ? nearestFacingNpc(talkCandidates(visibleNpcs), state.x, state.y, state.dir, 48)
                    : null;
                // The interact handler's own target rules (F0x8008E2CC, file 0xb61c-0xb7a8):
                // npc ids 0x180-0x182 are refused outright, and an id in the redirect table
                // (RAM 0x80097C68) is replaced by the entity carrying the redirect id — the
                // spriteless counter markers (112/113) resolve to the clerk behind them.
                // The lookup is over the WHOLE built cast, as the disc's find_entity(5, id, -1)
                // is: a redirect target a cutscene parks is still a class-5 entity there.
                const npc = picked ? resolveConfirmTarget(cast, picked) : null;
                if (npc) {
                    // Turn-to-face on talk, the disc's own rule: the talk handler writes
                    // `npc+0x60 = (player+0x60 + 4) & 7` (F0x80090afc, file 0xdf00-0xdf18) —
                    // the NPC faces exactly opposite the player's facing, i.e. at whoever
                    // spoke to it. (Not a geometric point-at-the-player; the disc never
                    // reads the positions here. It also feeds the dialogue box's balloon
                    // quadrant, which reads npc+0x60.)
                    npc.dir = oppositeDirection(state.dir);
                    // The three special block actors (npc 328/351/352): confirm
                    // starts the drill-armed dive, not a conversation. The
                    // dedicated branch fieldstg F0x8008E2CC runs for exactly
                    // these ids, ahead of any talk. See
                    // engine/systems/block-actor.ts.
                    if (isBlockActorId(npc.npc_id)) {
                        if (startBlockInteraction(npc)) return;
                    }
                    // Story engine first: talking to a story NPC (e.g. Genji) fires its event /
                    // scripted battle (interaction-driven + flag-gated). Consumes the interaction.
                    storyDbg(
                        "TALK npc_id",
                        npc.npc_id,
                        "sprite",
                        npc.sprite,
                        "id",
                        npc.id,
                        "at",
                        npc.x + "," + npc.y,
                        "(you at",
                        Math.round(state.x) + "," + Math.round(state.y) + ")",
                        "on",
                        currentMap().id,
                    );
                    // Read the NPC's CURRENT dialogue line BEFORE firing OnTalk — an on_close
                    // flag-set event must not pre-advance the line we're about to show. onTalk
                    // returns true only when it PRESENTS a cutscene/battle (which consumes the
                    // interaction); a pure flag-set / item-give returns false (its side effects
                    // still apply) so we go on to show this NPC's spoken line.
                    const dlgState = pickDialogueFor(npc, state.flags);
                    if (engineBridge && engineBridge.onTalk(npc.npc_id)) return;
                    if (questTalk(npc.npc_id, currentMap().id)) return;   // an extra quest takes this conversation (never a story one)
                    if (!dlgState) return; // no ptrB dialogue — non-speaking variant
                    openTalkLine(
                        dlgState.dialogue,
                        () => {
                            // The item box's own close arm (fieldstg F0x80090afc, the mode-0x4a
                            // talk body, file 0xdfa4-0xdfc0): the tick the talk's dialogue reads
                            // closed, a p126itmb box calls its own remove slot — `+0x28(3)`,
                            // entity+0xC = 3 — and leaves the field, in the same arm that applies
                            // the on-close table below. Every other npc takes the setMode(1) arm
                            // and keeps its actor (Veemon, s395 — see npc-manager.stageCast). The
                            // family is the talk body's own id test; a box is removed whether or
                            // not its table writes its own gate (engine/systems/box-actor.ts).
                            if (isBoxActorId(npc.npc_id)) {
                                delete npc._talking;
                                const boxScene = state.scenes[currentMap().id];
                                if (boxScene) removeSceneActor(boxScene, boxScene.npcs, npc);
                            }
                            // Apply the state's on_close set_flags (F0x80016988) — advances the NPC's
                            // dialogue state so the next talk shows its later line (§WS5).
                            for (const c of dlgState.on_close || [])
                                applyStoryFlag(c.id, c.expected);
                            if (npc.setFlag) {
                                state.flags[npc.setFlag] = true;
                                localStorage.setItem(
                                    "flags",
                                    JSON.stringify(state.flags),
                                );
                            }
                            if (state.pendingStoryBattleIndex != null) {
                                state.pendingStoryBattleNpc = npc.npc_id;
                                if (engineBridge?.onTalk(npc.npc_id)) return;
                                flushStoryBattle();
                            }
                            // Innkeeper (Gatomon, NPC 20): the bank-0x7A write
                            // its dialogue state carries opens the rest screen
                            // once the box closes. The screen resolves its own
                            // name and price from the map — see web/inn.js.
                            if (state.pendingInn) {
                                state.pendingInn = false;
                                inn.open(state, { map: currentMap()?.id });
                            }
                            // Gym greeter: "Do you want to work out?" is a plain
                            // talk line, and the gym screen opens when the box
                            // closes. There is no field Yes/No (runtime drive of
                            // Leomon s330, docs/research/ui/captures/
                            // shop-autonomy-2026-09-10.md L28-L29).
                            else if (state.pendingGymGroup != null) {
                                const group = state.pendingGymGroup;
                                state.pendingGymGroup = null;
                                gym.open(state, null, group, currentMap()?.id);
                            }
                            // Card duel, DECODED 2026-08-05 (was a Duel-Island
                            // stage guess). The NPC's own on_close write into
                            // flag bank 0x76/0x78 is the launcher — set_flag
                            // routes it to D0x8008b770(0x700, idx*2+mode+1).
                            // Confirmed by a controlled runtime capture of the
                            // s335 Tamer Mitch challenge (on_close 0x7606):
                            // docs/research/card/captures/
                            //   cardduel-full-duel-s482-state5-2026-08-05.md
                            // No confirmation prompt — the original goes
                            // straight from the closing box into the duel.
                            else if (state.pendingDuelId != null) {
                                const duelId = state.pendingDuelId;
                                state.pendingDuelId = null;
                                // The opponent now duels a real CARD_NPC.BIN
                                // record — its own 40-entry deck, its per-entry
                                // AI play classes, and its booster set as the
                                // win reward.
                                // DECODED 2026-08-08 — this is no longer a
                                // walker rule, and no rig was needed. The whole
                                // chain is static:
                                //   bank 0x76 -> F0x80016378(index, 0)
                                //   bank 0x78 -> F0x80016378(index, 1)
                                //   F0x80016378 calls
                                //     D0x8008b770(0x700, index*2 + mode + 1, ...)
                                //   the pack launcher (fieldstg 0x08A24) stores
                                //     kind at obj+0x5C and that packed argument
                                //     at obj+0x60
                                //   fieldstg F0x80089F7C then calls the resident
                                //     setter through slot 0x8004B440 with
                                //     (obj+0x5C, obj+0x60) — F0x80016B88, which
                                //     writes ctx+0x26C8 = kind and
                                //     ctx+0x26D0 = the packed argument (the
                                //     second store sits in the jr delay slot and
                                //     still executes)
                                //   pro/cardgame's launcher F0x80095BFC calls
                                //     createCardDuel((*0x8004B43C)()), and that
                                //     slot holds F0x80016B78 = "return
                                //     ctx+0x26D0", so duel+0x2E8 IS the packed
                                //     argument
                                //   loadOpponentDeck indexes
                                //     (duel+0x2E8 - 1) * 0xD0, i.e. the packed
                                //     value is a ONE-BASED CARD_NPC.BIN record.
                                // card_opponents.json is extracted 1-based
                                // (ids 1..170), so passing the packed value
                                // straight through is exactly right.
                                // Record number, 0-based, = index*2 + mode.
                                cardDuel.open(null, npc.sprite ?? "Duelist", null, duelId, state);
                            }
                        },
                        npc,
                        // Speech balloon attached to the spoken-to NPC. Quadrant per
                        // the decoded auto-mode (fieldstg 0x80088d38): the NPC's
                        // post-turn facing + which screen half it's on, picked once
                        // at window creation like the original.
                        (() => {
                            const mode = autoBalloonMode(
                                npc.dir,
                                (npc.x - lastCam.x) * ZOOM,
                                (npc.y - lastCam.y) * ZOOM,
                                VIEW_W,
                                VIEW_H,
                            );
                            return () => ({
                                x: (npc.x - lastCam.x) * ZOOM,
                                y: (npc.y - lastCam.y) * ZOOM,
                                mode,
                            });
                        })(),
                    );
                    // The box's own start arm (fieldstg F0x80090afc, file
                    // 0xdf58-0xdf78), family only, after the line is up
                    // (0xdf48): the box latches clip 0x41 — setClip is the
                    // +0xa0 latch F0x8008f4b4, which also clears the frame
                    // counters +0xcc/+0xd0 — and requests the packed cue
                    // 0x80045DC7 = TRESUREB through the packed-sound entry
                    // [0x80055C48]. The clip's frame list ends in the -1 hold
                    // sentinel (fieldstg file 0xce8c-0xce9c: timer 0xffff,
                    // +0xe8 = 1), so the chest holds its open frame once the
                    // authored ticks are spent. See engine/systems/box-actor.ts.
                    if (isBoxActorId(npc.npc_id)) {
                        const boxMeta = state.manifest.npcs.find((n) => n.id === npc.sprite)
                            ?? state.manifest.characters.find((c) => c.id === npc.sprite);
                        const boxDur = clipDurationSeconds(boxMeta?.clips, BOX_TALK_CLIP, npc.dir ?? "down");
                        npc.activeClip = BOX_TALK_CLIP;
                        npc._animTime = 0;
                        npc._talkClipEnd = boxDur != null ? Math.max(0, boxDur - FIELD_TICK_SECONDS) : null;
                        npc._talking = true;
                        sfx.playPacked(BOX_TALK_CUE, { overlap: true });
                    }
                } else if (startLadderClimb(scene)) {
                    // Ladder press-to-climb (authentic activation: the PS1 fires the
                    // actor climb method on Circle while the act-2/3 trigger is armed).
                } else if (startSlopeStep()) {
                    // Op 4 — the scripted slope step (the actor's +0x11c action, mode
                    // 0x47). See engine/systems/step-actor-actions.ts.
                } else if (activeExitAt()) {
                    // DOOROPEN: positional area sound resolved through the
                    // current map's bank (per-stage door timbre; silent where
                    // the bank lacks the row-4 program -- authentic). Fired
                    // on door-glyph (op 4) trigger activation only; plain
                    // walk-through warps (op 1 arrows) stay silent.
                    if (activeTriggerStep()?.op === 4) sfx.playArea("dooropen");
                    startTransition(activeExitAt());
                } else if (startPadHandoff()) {
                    // Op 14 — the launch-pad handoff tile. The disc's handler calls
                    // actor->vt[0x158] (the pad walk) and 0x8008B6D4 in the SAME frame
                    // (fieldstg.s:5a40 / :5a70); the stage itself changes 0x3c ticks
                    // later, when scene_obj+0x68 runs out (:8984-:89c8). See
                    // startPadHandoff() and engine/systems/scene-step-ops.ts.
                } else {
                    // Nothing else claimed the press: the DEFAULT field handler
                    // gets it, and with the TreeBoots on that is a kick.
                    tryTreeKick();
                }
            }
        } else {
            tryTreeKick();
        }
        return;
    }

    // Route navigation keys to battle menu when active
    if (battle.isActive()) {
        if (battle.handleKey(k)) {
            e.preventDefault();
            return;
        }
    }

    // Dev/editor shortcuts. These sit on keys that stand for NO pad button, so a
    // player holding a real button can never trip one and they never have to be
    // consumed. They used to live on c/e/v/z/x, every one of which is now a pad
    // button: `c` cycled the character AND was the Submarimon throttle, `e`
    // opened the editor AND paged a card list as R1.
    if (raw === "h") setCharacter(state.charIdx + 1);
    else if (raw === "m") loadAndSetMap(state.mapIdx + 1);
    else if (raw === "o") {
        editor.toggle();
        sceneEd.arm(null);
    } else if (raw === "u" && editor.enabled) {
        if (e.shiftKey) sceneEd.download();
        else editor.download();
    } else if (raw === "b") bgm.toggleMute();
    else if (raw === "n" && editor.enabled) sceneEd.arm("npc");
    else if (raw === "g" && editor.enabled) sceneEd.arm("exit");
    else if (raw === "delete" && editor.enabled) sceneEd.removeNearest();
    else if (raw === "j") state.debugAnim = !state.debugAnim;

}

window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    bgm.unlock(); sfx.unlock();
    const raw = e.key.toLowerCase();
    dispatchInput(asButton(raw), e, raw);
    // The arrow keys scroll the page if the game does not claim them.
    if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(raw))
        e.preventDefault();
});
window.addEventListener("mousedown", () => { bgm.unlock(); sfx.unlock(); });
window.addEventListener("keyup", (e) => state.keys.delete(asButton(e.key)));
window.addEventListener("blur", () => state.keys.clear());

// Joystick. The Gamepad API has no press events, so the pad is read once per
// frame in `frame()` and diffed; a press is fed to the SAME dispatcher the
// keyboard uses, and held buttons go into the same `state.keys` the field polls.
// A stub event stands in for the KeyboardEvent — a pad has no `code`, `key` or
// `shiftKey`, which is exactly why the dev-tool branches above cannot fire.
const PAD_EVENT = { preventDefault() {}, repeat: false, code: "", key: "", shiftKey: false };
const gamepad = attachGamepad({
    heldKeys: state.keys,
    onPress: (button) => {
        bgm.unlock(); sfx.unlock();
        if (titleInput) { titleInput(button); return; }
        if (!state.started) return;
        dispatchInput(button, PAD_EVENT, "");
    },
});
window.__gamepadConnected = () => gamepad.isConnected();

// The pad gets its own loop rather than riding `frame()`, for two reasons: the
// sim loop does not start until the title screen is dismissed (so the pad could
// not start the game), and `frame()` sub-steps itself under `__gameSpeed`, which
// would multiply the d-pad auto-repeat rate along with everything else. Polling
// here also makes a pad press land as promptly as a key press, which is
// event-driven.
let padLastT = 0;
function padLoop(t) {
    const dt = padLastT ? Math.min((t - padLastT) / 1000, 0.1) : 0;
    padLastT = t;
    gamepad.tick(dt);
    // Screens that can open BEFORE the sim loop starts still need a tick source.
    // The title's Continue launches the memory card in load mode (the original's
    // code 0xC00), and the sim loop only starts with the game, so without this the
    // screen drew but never advanced (measured: 0 frames, no reads, no input).
    if (!state.started && saveScreen?.isOpen?.()) saveScreen.update?.(dt);
    // The boot country/language screen (code 0x1600) is the same case: it runs
    // before the game starts, so the sim loop cannot tick it.
    if (!state.started) {
        if (USE_NATIVE_CNTYSEL) {
            if (cntyselNative.isOpen()) cntyselNative.update?.(dt, state.keys);
        } else if (cntyselMenu.open) {
            cntyselMenu.update?.(dt, state.keys);
        }
    }
    requestAnimationFrame(padLoop);
}
requestAnimationFrame(padLoop);

let lastT = 0;
function frame(t) {
    // Cap the sim/render at 60fps: on >60Hz displays rAF fires faster; dt-based
    // logic stays real-time either way, but capping keeps frame pacing (and any
    // per-frame effects) identical to the 60Hz baseline the game targets.
    if (t - lastT < 1000 / 61) {
        requestAnimationFrame(frame);
        return;
    }
    const dt = Math.min((t - lastT) / 1000, 0.1);
    lastT = t;
    // Game-speed hack: window.__gameSpeed fast-forwards EVERYTHING (cutscenes, WAITs, auto
    // walks, fades, animations) by sub-stepping the sim that many times. Set __gameSpeed=4
    // in the console to blitz through auto-scenes; 1 (or unset) = normal. Sub-stepping (vs.
    // one big dt) keeps collision + cutscene stepping stable at high multipliers.
    const mult = Math.max(1, Math.floor(window.__gameSpeed || 1));
    for (let i = 0; i < mult; i++) update(dt);
    render();
    requestAnimationFrame(frame);
}

// The Submarimon thrust LOOP (SUB_MOVE, packed id 0xa0045f4a). The native
// handler F0x8008e45c plays it on the first tick the thrust bit goes down with
// its loop handle at [+0xc8] == -1, and stops it when the bit is released or
// the CIRCLE path runs (fieldstg.s .L0x0000b8c8 play, .L0x0000b928 and
// .L0x0000b87c stops), resetting the handle. The sustained-voice player IS that
// handle — one looping voice per name, keyed off by stopSustained — so the
// lifecycle here is: play on the first thrust tick, stop on release, on the
// Circle interact, and on form loss. See
// docs/research/field/submarimon-buoyancy-decoded-2026-07-28.md SUB-Q003.
function syncSubThrustSound(thrusting) {
    if (thrusting === !!state._subThrustSound) return;
    state._subThrustSound = thrusting;
    if (thrusting) sfx.playSustained("sub_move");
    else sfx.stopSustained("sub_move");
}

function update(dt) {
    // Play clock. The memory-card file record carries an h/m/s play time
    // (record +0x28/+0x2A/+0x2C, decoded in stgmcard F0x8008316c), so the
    // walker keeps a real one instead of writing zeros onto the save card.
    state.playSeconds = (state.playSeconds || 0) + dt;
    scheduleFieldLocationSave();
    sweepCollectionSave();
    textbox.update(dt);
    cutscene.step(dt);
    // The s260 auction's arrival gate. Armed by checkStageCutscene; polled here
    // each frame until it fires or finds nothing, so a lot that could not start
    // while the field was busy still fires the moment the field is free (the
    // disc's own runStoryEvents is a per-frame tick, not a one-shot).
    if (state.auctionPending && currentMap()?.id === AUCTION_STAGE) {
        if (runAuctionArrival(AUCTION_STAGE) !== "wait") state.auctionPending = false;
    }
    // The footstep cue fires from the PLAYER's own move handler and nothing
    // else: PLAYER00 (0x8004583c) is called from the player action dispatcher
    // F0x8008FED0 through the helper F0x8008FD74, whose ONLY caller is that
    // dispatcher (`./dw3-research callers F0x8008fd74`), and no NPC handler
    // reaches it. So a WALKTO-puppeted NPC must not make the player's step, and
    // its walk must not set the player's step CADENCE either: `cutscene.walking()`
    // is the max moved-ticks over EVERY WALKTO actor, so a scripted NPC moving
    // further than the player in the same step inflated the tick count the step
    // sound was driven by. `cutscene.playerWalking()` is the player's own
    // moved-ticks, so the cadence is the player's movement alone.
    const cutsceneWalkTicks = cutscene.isActive() ? (cutscene.playerWalking?.() ?? 0) : 0;
    if (cutsceneWalkTicks > 0)
        tickFootstep(state, cutsceneWalkTicks * FIELD_TICK_SECONDS);
    shop.update(dt);
    gym.update?.(dt); // native gym host step (the legacy gym has no update)
    fightReport.update(dt);
    saveScreen.update?.(dt); // native save-screen host step (the legacy screen has none)
    dialogueBox.update(dt, state.keys); // translated conversation box (UI Lab)
    chatTick(dt);
    yesNoBox.update(dt, state.keys);
    helpMenuBox.update(dt, state.keys); // translated eight-topic help menu (5 NPC counters)
    cardAlbum.update?.(dt); // native album host step (the legacy album has no update)
    cardDeck.update?.(dt); // native folder editor host step (the legacy editor has none)
    cardShop.update?.(dt); // native card shop host step (the legacy shop has none)
    cardDuel.update?.(dt); // native duel host step (the legacy duel has none)
    // The native naming screen ticks from the main update, not the draw block:
    // the opening's hand-off can hold the frame before the field draws again,
    // and a screen that is only stepped while drawing never advances there.
    if (USE_NATIVE_NAME && state.nameEntry) state.nameEntry.update?.(dt, state);
    cntyselMenu.update(dt, state.keys);
    cntyselNative.update(dt, state.keys); // native language-select host step
    inn.tick(dt);
    driMenu.update(dt, state.keys);
    status?.update(dt);
    menu.update(dt);
    state.packSelect?.update?.(dt, state);
    // The native wizard closes inside its own tick (the commit store sets the
    // root's lifecycle to 3), so the walker's done handler must run from here;
    // the legacy wizard's own key path still fires it on a press.
    if (USE_NATIVE_PACK && state.packSelect?.isDone?.() && state.packSelectDone) state.packSelectDone();
    if (state.endScreen) {
        if (USE_LEGACY_END) {
            state.endScreen.tick(1);
            if (state.endScreen.isDone()) {
                const onDone = state.endScreenDone;
                state.endScreen = null;
                state.endScreenDone = null;
                onDone?.();
            }
        } else {
            // The card samples the held pad on every callback, so it needs the walker's
            // current keys, and it runs one callback per display tick.
            state.endScreen.setHeld(state.keys ?? []);
            state.endScreen.step(dt);
        }
    }
    if (state.titleScreen) {
        // Real elapsed seconds, exactly as the title's own loop gives it: the
        // display clock turns them into the original's 50Hz fields.
        state.titleScreen.tick(dt);
        if (state.titleScreen.isDone()) {
            const onDone = state.titleScreenDone;
            state.titleScreen = null;
            state.titleScreenDone = null;
            onDone?.();
        }
    }
    // The ordinal-43 field movie (the pre-battle clip of F0x8008B798's
    // post-fight arm): it runs on the same 50 Hz blanks the field runs on
    // (web/field-movie.js consumes them through the shared consumeFieldTicks),
    // and while it is up the field is not stepped — the original has already
    // left the field for the title overlay's movie screen.
    fieldMovie.update(dt);
    if (fieldMovie.isOpen()) return; // the movie takes full control
    battle.update(dt);
    if (battle.isActive()) return; // battle takes full control

    // Idle-breathing clock: always ticks, independent of movement/cutscene state, so a
    // stationary sprite plays its real idle clip (clip "1" — see docs/research/field/
    // field-actor-anim-engine.md) instead of freezing on a single static frame. One clock
    // per entity so they don't all breathe in visible lockstep.
    state._idleTime = (state._idleTime ?? 0) + dt;
    for (const f of followers) f._idleTime = (f._idleTime ?? 0) + dt;
    const idleScene = state.scenes[currentMap().id];
    if (idleScene) {
        for (const npc of sceneCast(idleScene)) {
            npc._idleTime = (npc._idleTime ?? 0) + dt;
            // A talking box ticks its talk clip (0x41) while the textbox is up,
            // as the disc's per-frame loader steps every live entity's anim
            // clock; the clip's -1 hold sentinel stops the clock on the open
            // frame (fieldstg file 0xce8c-0xce9c, _talkClipEnd set at the talk
            // start arm in the confirm handler above).
            if (npc._talking) {
                const t = (npc._animTime ?? 0) + dt;
                npc._animTime = npc._talkClipEnd != null ? Math.min(t, npc._talkClipEnd) : t;
            }
        }
    }

    // Tick animation clock for cutscene-controlled entities that are standing still
    // between opcodes. Walking entities are ticked by _moveToward in cutscene.js —
    // skip them here to avoid double-counting (which would halve frame duration).
    if (cutscene.isActive()) {
        const cscene = state.scenes[currentMap().id];
        if (cscene) {
            for (const npc of sceneCast(
                cscene,
            )) {
                if (npc._inCutscene && !npc._cutTarget)
                    npc._animTime = (npc._animTime ?? 0) + dt;
            }
        }
        if (state._inCutscene && !state._cutTarget)
            state._animTime = (state._animTime ?? 0) + dt;
        // Party gather (`SETANIM 813 823`): followers run the rest of their trail
        // into the leader, two records per tick, then park (followerGatherSample).
        // The ring is not written during a script, so the trail ends where the
        // player was when the scene began.
        if (cutscene.partyGatherAt != null) {
            const tick = Math.floor((cutscene.clock() - cutscene.partyGatherAt) / FIELD_TICK_SECONDS) + 1;
            for (let i = 0; i < activeFollowerCount(); i++) {
                const f = followers[i];
                if (f.parked) continue;
                const sample = followerGatherSample(partnerHistory, i, tick);
                if (!sample) { f.parked = true; f.gathering = false; continue; }
                f.gathering = true;
                f.x = sample.x;
                f.y = sample.y;
                f.dir = sample.dir;
                f.animTime = (f.animTime ?? 0) + dt;
            }
        }
        // The resident scene object's notify arms the player's FIELDCOM sparkle actor
        // (`SETANIM 813 824/825/842` -> setSub1(1/2/3), fieldstg F0x800837EC). The browser
        // has no type-0x16 object, so the arm becomes the same `state.sparkleActor` the
        // bank-0x70 PlaySparkle op drives; the draw pass renders it at the player.
        if (cutscene.sparkleSeq !== (state._sparkleSeq ?? 0)) {
            state._sparkleSeq = cutscene.sparkleSeq;
            state.sparkleActor = { program: cutscene.sparkleProgram, start: fieldcomTick() };
            if (cutscene.sparkleProgram === 1 || cutscene.sparkleProgram === 3) sfx.play("item_get");
        }
    }

    flushStoryBattle();
    // Advance the Digi-Egg dive presentation. Like the fade, this must run
    // before any early-return: the player is frozen for its whole length, and
    // the tables it plays are authored in 60fps frames (the native cursor is
    // advanced by the engine frame delta, 1 per frame).
    if (state.diveDemo) {
        const d = state.diveDemo;
        d.accumulator += dt * 60;
        const whole = Math.floor(d.accumulator);
        d.accumulator -= whole;
        d.frame += whole;
        // The demo's own cue, fired on its first drawn frame — the sound of
        // Digmon biting into the ground / Submarimon breaking the surface.
        // Separate from the DIGIMENT cue at the trigger, ~80 frames earlier.
        if (!d.cued && d.frame >= DIVE_DEMO_CUE_FRAME) {
            d.cued = true;
            if (d.mode === "hole") sfx.play("dig_demo");
            else sfx.play("sub_demo");
        }
        if (diveDemoFrame(d.mode, d.frame).done) {
            // Hand off to the ordinary stage change, which is what draws the
            // tile wipe and the location title in the original.
            state.diveDemo = null;
            fade.dir = 1;
            fade.pending = d.exit;
        }
    }

    // Advance the location title card. Like the dive demo it must run before
    // any early-return: it plays over a screen the player cannot act on yet,
    // and it is what covers the arrival. Its release — the original's "the
    // field has finished arriving" gate — is held while the screen is still
    // fading in, which is the walker's stand-in for that sequence.
    placeCard.hold(fade.dir !== 0 || fade.alpha > 0);
    placeCard.step(dt);

    // Advance the A28 checkerboard loading wipe (fieldstg F0x80089F7C), the
    // field->battle handoff. The original runs it while the battle loads; here it
    // paces the handoff and launches the battle once the 29-record schedule is
    // spent. One walk call per frame at the captured 40 px/step (unk18C() == 1);
    // the hold gate [0x8004DE44] is host pacing and is not modelled.
    if (state.wipe28) {
        const cb = state.wipe28;
        if (!cb.done) {
            // Debug hold (a verifier can freeze the wipe mid-run to capture it):
            // window.__wipe28Hold = true.
            if (!window.__wipe28Hold)
                for (let n = 0; n < 2 && !cb.done; n++) stepCheckerboard(cb, WIPE_A28_STEP_UNIT);
        } else {
            const p = cb.pending;
            state.wipe28 = null;
            p.run();
        }
    }

    // Advance fade (must run before early-return so fade progresses even when frozen)
    if (fade.dir !== 0) {
        // The translated wipe runs the original's frame count (32 to close, 21 to
        // open) and the shared fade's alpha is read off it, so the stage swap
        // still fires on a full close -- just 32 frames in instead of 20.
        // `?legacyWipe=1` keeps the old fade-clock ramp.
        if (USE_LEGACY_WIPE) {
            fade.alpha = Math.min(fade.alpha + fade.dir * dt * 3, 1);
        } else {
            stepWipeClock(state.wipe, fade.dir, dt);
            fade.alpha = Math.min(Math.max(wipeProgress(state.wipe), 0), 1);
        }
        if (fade.alpha >= 1 && fade.pending) {
            let ex = fade.pending;
            // WRAP MAZE. A maze stage's shipped exits come from its arrival-pad
            // records, which all point back at the stage's own screen -- that is
            // why the Circuit Board used to be seven dead rooms. The real exit
            // graph is `mazeSections`: one section per (key, companion) route
            // pair, whose exits carry the DESTINATION's pair. Resolving here both
            // moves the player and re-stamps which section they are in, so bank
            // 0x7E puts the right occupant in the stage's single slot.
            // Ledger: maze-exit-record-table.
            const sections = state.scenes[currentMap().id]?.mazeSections;
            if (sections && ex.selfWarp) {
                const hop = resolveMazeExit(
                    sections, state.entryKey ?? 0, state.entryCompanion ?? 0,
                    ex.nativeDir ?? null);
                // Unresolved (a pair the table does not describe) keeps the shipped
                // exit rather than inventing topology -- see resolveMazeExit.
                if (hop)
                    ex = { ...ex, to: hop.to, spawnX: hop.x, spawnY: hop.y,
                           dir: hop.dirName ?? ex.dir,
                           entryKey: hop.key, entryCompanion: hop.companion,
                           selfWarp: false };
            }
            // The screen is fully black here. Keep it black until the exact
            // (possibly maze-resolved) destination has its map, collision and
            // local sprite sheets; warm exits normally make this a no-op.
            //
            // The exit stays ARMED while we wait: this block is the only thing
            // that consumes `fade.pending`, so clearing it before the stage is
            // ready would drop the transition and strand the game on a black
            // screen for ever (fade.dir stays 1, which also makes
            // startTransition refuse every later warp). Re-arm with the
            // maze-resolved `ex` — resolution clears `selfWarp`, so retrying is
            // idempotent. A destination that is not a real stage can never
            // become ready, so it must not be gated at all; it falls through to
            // the idx < 0 path, which keeps the player where they are.
            if (knownStageIds.includes(ex.to) && !readyStageIds.has(ex.to)) {
                fade.pending = ex;
                prepareStageAssets(ex.to);
                return;
            }
            fade.pending = null;
            const idx = state.manifest.maps.findIndex((mm) => mm.id === ex.to);
            // Capture the door we're leaving through BEFORE setMap overwrites state.
            const fromId = currentMap().id;
            const fromPos = { x: state.x, y: state.y, dir: state.dir };
            // ── THE ROUTE PAIR, published by the STEP and not by the warp ──
            //
            // [D0x80048D34+0x44] and [+0x46] are the disc's "which way did you come
            // in" pair, and they have exactly TWO writer sites, both of which read
            // the type-7 step record's own params[5] and params[6]:
            //
            //   op 1  (fieldstg.s:5773 / :5778, file 0x5A18 / 0x5A2C) — the case's
            //         unconditional convergence point in the playback executor.
            //   op 9  (fieldstg.s:8780 / :8785, file 0x8914 / 0x8928) — reached
            //   op 10 through the dive launcher, which stashes `record + 0xa` at
            //         obj+0x7C, so its rec+0x0A / rec+0x0C ARE record+0x14 / +0x16.
            //
            // `routeWords` is `activeExitAt`'s copy of that pair, read verbatim, and
            // the port that produces it is engine/systems/route-pair.ts. So:
            //
            //   * a transition some op-1/9/10 step produced publishes that record's
            //     own two numbers, zeros included — the stores have no branch and no
            //     zero test, which is exactly how an unkeyed step clears the pair;
            //   * a transition NO publishing step produced (a cutscene handoff, an
            //     op-14 pad handoff, a door on a stage with no step program) leaves
            //     BOTH halves alone, because nothing in the disc writes them there.
            //     The old commit wrote a 0 into each of them there instead; across
            //     the 819 shipped exit rows that was s260's door and s410's gondola.
            //
            // The destination's own init reads the key half to pick which encounter
            // group is live (30 family-B stage inits), and the bank-0x7E spawn gates
            // read both halves as soon as the stage is up.
            // Ledger: encounter-zone-group-key-written-on-map-transition,
            // encounter-zone-group-key-record-is-type7-step-record,
            // encounter-companion-scalar-is-second-route-coordinate.
            //
            // A maze WRAP exit is the one place the step's own record is not the
            // best evidence: the wstag*.s records for the self-warp maze stages are
            // STALE PLACEHOLDERS, and the real exit records are memcpy'd into the exit
            // buffer at overlay load from disc data (F0x8002514c at pc 0x80025168;
            // see maze_exits.json). So for a wrap the resolved hop's pair — read out
            // of that disc table — is the pair, exactly as the ledger requires.
            //
            // The decision itself is ported: routePairCommit() answers "did any writer
            // site run for this transition, and what does it publish", and null means
            // write nothing at all.
            const routeCommit = routePairCommit(ex);
            if (routeCommit) {
                state.entryKey = routeCommit.key;
                state.entryCompanion = routeCommit.companion;
            }
            // Spawn coords may be null (special HANDOFF warps, e.g. the s790
            // dive): fall back to setMap's map-center spawn instead of x=null.
            if (idx >= 0)
                setMap(
                    idx,
                    ex.spawnX != null
                        ? { x: ex.spawnX, y: ex.spawnY, dir: ex.dir }
                        : null,
                );
            // Faithful "leave the way you came in": synthesize the return door in
            // the destination from how we arrived. Skip HANDOFF warps (null spawn),
            // scripted mid-cutscene warps, and self-warps.
            if (idx >= 0 && ex.spawnX != null && !ex.scripted && fromId !== ex.to)
                addEntranceReturn(ex.to, ex.spawnX, ex.spawnY, fromId, fromPos);
            fade.dir = -1;
        }
        if (fade.dir === -1 && fade.alpha <= 0) {
            fade.dir = 0;
            fade.alpha = 0;
            checkStageCutscene(currentMap().id);
        }
    }

    // Update the verified FN6 cutscene camera.
    if (cutscene.isActive() && cutscene.camera) {
        const cx = cutscene.camera.x;
        const cy = cutscene.camera.y;
        if (cutscene.camera.mode === "snap") {
            viewCam.x = cx;
            viewCam.y = cy;
        } else {
            viewCam.x += (cx - viewCam.x) * Math.min(1, dt * 4);
            viewCam.y += (cy - viewCam.y) * Math.min(1, dt * 4);
        }
        viewCam.active = true;
    } else if (viewCam.active) {
        // Ease back to player when cutscene camera disengages
        const cx = state.x,
            cy = state.y;
        viewCam.x += (cx - viewCam.x) * Math.min(1, dt * 4);
        viewCam.y += (cy - viewCam.y) * Math.min(1, dt * 4);
        if (Math.abs(viewCam.x - cx) < 1 && Math.abs(viewCam.y - cy) < 1)
            viewCam.active = false;
    }

    if (
        textbox.isOpen() ||
        choice.isOpen() ||
        cutscene.isActive() ||
        fade.dir !== 0 ||
        state.wipe28 ||
        state.diveDemo ||
        state.nameEntry ||
        state.packSelect ||
        state.endScreen ||
        state.titleScreen ||
        state.menuOpen ||
        shop.isOpen() ||
        driMenu.isOpen() ||
        dialogueBox.isOpen() ||
        gym.isOpen() ||
        cardShop.isOpen() ||
        cardAlbum.isOpen() ||
        cardDeck.isOpen() ||
        cardDuel.isOpen() ||
        inn.isOpen() ||
        saveScreen.isOpen() ||
        fightReport.isOpen() ||
        cntyselMenu.open ||
        cntyselNative.isOpen()
    ) {
        state.moving = false;
        return;
    }

    // Fishing. The op-7 scene controller raises the scene lock for the whole
    // cast (the replay saw leader mode 1 -> 0x48 and scene lock 0 -> 1 on the
    // frame of the press), so the D-pad is dead until the cast resolves — the
    // same shape as the fire trap and the launch pads below.
    if (state.fishing) {
        const fk = consumeFieldTicks(fieldTickAccumulator, dt);
        fieldTickAccumulator = fk.accumulator;
        state.moving = false;
        state.stopping = false;
        const clips = fishingSpriteMeta()?.clips;
        for (let t = 0; t < fk.ticks; t++) {
            const f = state.fishing;
            // The result balloon is a resident actor of its own (F0x80087F84),
            // so it keeps ticking whether or not the angler is still busy — it
            // is what carries the balloon through its close after sub-state 4
            // has told it to shut.
            if (f.result) tickFishingBubble(f.result);
            // The float's own machine. It is spawned by the cast constructor and
            // ticks from the first frame, so its 0x5b settle overlaps the wind-up
            // — that is what puts the meter on screen just as Junior finishes
            // casting. It stops when it has resolved; the angler runs on.
            if (!f.castOver) {
                // The strike is an EDGE, not a held level: `[0x8004bbc4](0)` is
                // the pad decoder's NEWLY-PRESSED word — F0x80018854 returns
                // `new AND (new XOR previous)`, the buttons that went down on
                // this frame (claim CORE-PAD-RECORD-BUTTON-WORDS-001) — and the
                // bobber masks bit 0x2000 of it once per tick of the sweep
                // sub-state (files 0xa6f0-0xa704). A press is therefore consumed
                // by the next tick, and one that began during the settle is NOT
                // carried into the sweep.
                const strike = f.strike;
                f.strike = false;
                // The fourth argument is the display clock: the float's four
                // cells are a 48-unit cycle walked off the free-running tick at
                // 0x8004df98 (the same clock the field's own FIELDCOM programs
                // read), never off the cast's random.
                const cue = tickFishing(f.run, strike, () =>
                    Math.floor(Math.random() * 0x10000),
                    fieldcomTick(),
                );
                if (cue.kind === "sound") sfx.playPacked(cue.id, { overlap: true });
                else if (cue.kind === "catch") f.pending = cue.slot;
                if (f.run.phase === "over") f.castOver = true;
            }

            // The angler. `animDone` is the entity's +0xe8 — the clip having
            // played out — which is what three of the six sub-states advance on.
            const dur = clipDurationSeconds(clips, f.pose.clip, f.dir);
            const animDone = dur != null && f.poseT >= dur;
            const was = f.pose.clip;
            const pc = tickFishingPose(f.pose, animDone, f.castOver);
            // A fresh SETANIM restarts the clip clock (it clears +0xcc/+0xd0).
            f.poseT = f.pose.clip !== was ? 0 : f.poseT + FIELD_TICK_SECONDS;
            if (pc.sound) sfx.playPacked(pc.sound, { overlap: true });
            if (pc.openResult) f.result = startFishingBubble();
            if (pc.closeResult && f.result) closeFishingBubble(f.result);
            if (pc.finished) {
                // Leader mode is back to 1 and the scene lock is down. Only now
                // does the fight the cast earned actually start — the capture saw
                // the result presentation first and the battle menu after it.
                const mapId = currentMap().id;
                const slot = f.pending;
                state.fishing = null;
                if (slot != null) startFishingCatch(mapId, slot);
                return;
            }
        }
        return;
    }

    // Tree kick. Junior's kick puts him in leader mode 0x49, which is an
    // ANIMATION mode (SETANIM clip 8 off P002PLYK, wait for the anim-complete
    // flag, back to field mode 1 + SETANIM 1) and takes the D-pad away for the
    // length of that clip. The tree keeps shaking (64 frames) and the radar card
    // keeps counting (120) after he has control back, which is why this block
    // only holds input while `advanceTreeKick` says so. The rest is ticked with
    // the ordinary field ticks further down.
    if (treeKickHoldsInput(state.treeKick?.run)) {
        const tk = consumeFieldTicks(fieldTickAccumulator, dt);
        fieldTickAccumulator = tk.accumulator;
        advanceTreeKick(tk.ticks);
        state.moving = false;
        state.stopping = false;
        return;
    }

    // Op 4 — the scripted slope step. The disc's actor slot +0x11c switches Junior
    // into mode 0x47, raises the climb lock at [0x80099DE0] and hands the character
    // to a block that steps him SLOPE_STEP_CELLS cells sideways and slides him
    // SLOPE_SLIDE_CELLS cells a tick down to a spot `param0 * 16` cells lower. The
    // D-pad is dead for the whole run and the followers are parked, exactly as the
    // launch pad below. Decode + constants: engine/systems/step-actor-actions.ts.
    if (state.slope) {
        const spt = consumeFieldTicks(fieldTickAccumulator, dt);
        fieldTickAccumulator = spt.accumulator;
        const ss = stepSlope(state.slope, spt.ticks);
        state.x = ss.x;
        state.y = ss.y;
        state.moving = ss.phase !== "landed";
        state.stopping = false;
        if (ss.playSound) sfx.play(ss.playSound);
        state.animTime += spt.ticks * FIELD_TICK_SECONDS;
        if (ss.phase === "landed") {
            state.slope = null;
            // Followers recover at the frame the lock drops, resuming from the
            // leader's new position rather than from the trail they had before it.
            resetFollowers();
        }
        return;
    }

    // Fire Dungeon floor trap. The controller raises the scene lock and swaps the
    // leader's and the followers' handlers for the whole sequence, so the D-pad is
    // dead until it detaches — the same shape as the launch-pad block below.
    // Timeline, sounds, explosion sprites and the HP write: engine/systems/fire-trap.ts.
    if (state.fireTrap) {
        const ft = consumeFieldTicks(fieldTickAccumulator, dt);
        fieldTickAccumulator = ft.accumulator;
        state.moving = false;
        state.stopping = false;
        for (const cue of state.fireTrap.run.tick(ft.ticks, fireTrapPositionOf)) {
            // overlap: the controller fires one explosion per Digimon 30 ticks
            // apart, but COMEX113 runs longer than that. On the PS1 those are
            // separate SPU voices and they pile up; through the common-sound
            // category arbitration each one would instead cut the last, so the
            // first two blasts were being truncated to a short thud.
            if (cue.kind === "sound") sfx.playPacked(cue.id, { overlap: true });
            else if (cue.kind === "hit") forcePartyMemberToOneHp(cue.partyIndex);
            else if (cue.kind === "end") {
                // The event framework runs the event's on_complete when the
                // controller finishes; for these events that is the single
                // `set_flag(gate, 1)` that retires this patch of floor for good.
                storyFlags.set(cue.gateFlag, true);
                state.fireTrap = null;
            }
        }
        return;
    }

    // Scripted ladder climb: drives the player, locks input while active.
    if (tickClimb(dt)) return;

    // The special block actors' interaction (npc 328/351/352). Confirm at one
    // puts the player in the drill-armed dive clip (mode 0x4d, 36 blanks) and
    // the block in its break-apart (mode 0x4e: 20 blanks of wait, then the
    // 21-blank clip and the completion bit). The field lock [0x80099de0] is up
    // for exactly the player's clip, so the D-pad comes back while the block
    // finishes — the same shape as the fire trap and the launch pad, but with
    // its own shorter lock. engine/systems/block-actor.ts.
    if (state.blockEngage) {
        const bt = consumeFieldTicks(fieldTickAccumulator, dt);
        fieldTickAccumulator = bt.accumulator;
        if (state.blockEngage.ix.busy) {
            state.moving = false;
            state.stopping = false;
        }
        for (let t = 0; t < bt.ticks; t++) {
            const be = state.blockEngage;
            if (!be) break;
            const ev = tickBlockEngagement(be.ix, 1);
            if (ev.action) {
                // The target's action arm: the cue, then its bank-0 completion
                // bit, then its clip 0x54 — the order the original runs them.
                sfx.playPacked(BLOCK_CUE, { overlap: true });
                storyFlags.set(be.ix.bit, 1);
                if (be.npc) be.npc.activeClip = BLOCK_TARGET_CLIP;
            }
            if (be.npc && be.ix.targetSub === 1) {
                be.npc._animTime = (be.npc._animTime ?? 0) + FIELD_TICK_SECONDS;
            }
            if (ev.gone) {
                // The target's own +0x28(3): gone from the field. The spawn gate is
                // only read at stage entry now (its completion bit is written but the
                // built cast holds him), so the remove is done here, as the disc does.
                lastBlockIx = be.ix;
                const goneScene = state.scenes[currentMap().id];
                if (goneScene && be.npc) removeSceneActor(goneScene, goneScene.npcs, be.npc);
                state.blockEngage = null;
                break;
            }
        }
        if (state.blockEngage?.ix.busy) return;
    }

    // The disc's SETUP arm, every frame the player is on a live step tile
    // (fieldstg.s:5c94-:5cb8 — no button read in it). Today op 13, the launch
    // pad, is the only setup opcode that moves the leader by itself; it starts
    // here and is advanced by the block below on this same frame. Setup op 5
    // (the actor's draw-layer word) lands on the same arm, so it is read here too.
    stepSetupBucketTick();
    stepSetupTick();

    // The pad walk (setup op 13) and the op-14 hold share one frame, because the
    // disc's op-14 handler builds the pad controller and calls 0x8008B6D4 in the
    // same breath (fieldstg.s:5a40 then :5a70) — there is no frame in which one
    // runs without the other. The hold itself is the type-7 scene object's own
    // `+0x68` word: 0x8008B6D4 seeds it with the handoff's sixth argument
    // (:8a84) and the phase-2 handler spends it one GetTick() at a time (:898c
    // `+0x68 -= tick`), loading the destination only on the frame it reaches 0
    // (:8984 `bgtz` -> :8994). Op 14 seeds 0x3c, op 1's wrapper seeds 0.
    // The pad walk runs during it, which is the point of the 60 ticks: Junior is
    // already walking to the pad when the screen goes.
    if (state.launch || state.handoffHold) {
        const bt = consumeFieldTicks(fieldTickAccumulator, dt);
        fieldTickAccumulator = bt.accumulator;
        // Launch pad (setup op 13): the native actor method F0x8008f44c raises the
        // scene lock and hands the leader to controller F0x8008c130, so the D-pad
        // is dead for the whole sequence and the followers are parked (they leave
        // their normal handler and only recover when the controller detaches).
        // Decode + timings: engine/systems/launch-pad.ts.
        if (state.launch) {
            const st = stepLaunch(state.launch, bt.ticks);
            // fieldstg 0x8008c34c plays packed 0x0004001d = TELEPORT the moment the
            // controller flips the pad into state 2 (the leader has arrived and the
            // pad starts flashing) — the only cue on the whole op-13 path.
            if (st.playSound === LAUNCH_PAD_SOUND) sfx.play("teleport");
            state.x = st.x;
            state.y = st.y;
            state.moving = st.phase === "approach";
            state.stopping = false;
            // The tumble: char+0x60 = ([0x8004de20] >> 1) & 7 for the whole flight —
            // one facing step every two ticks, so the leader spins in the air
            // instead of holding one pose.
            if (st.phase === "flight") state.dir = fieldDirectionFromIndex(st.facing);
            state.animTime += bt.ticks * FIELD_TICK_SECONDS;
            if (st.phase === "done") {
                state.launch = null;
                state.dir = st.dir;
                // Followers recover at the same frame the controller detaches:
                // they resume from the leader's new position, not from the trail
                // they had before the flight.
                resetFollowers();
            }
        }
        if (state.handoffHold) {
            state.handoffHold.ticks -= bt.ticks;
            if (state.handoffHold.ticks <= 0) {
                const held = state.handoffHold;
                state.handoffHold = null;
                // The load detaches the pad controller, so the walker keeps no
                // walk state across it either.
                state.launch = null;
                runStageHandoff(held.exit);
            }
        }
        return;
    }

    const k = state.keys;
    let dx = 0,
        dy = 0;
    if (k.has("left")) dx -= 1;
    if (k.has("right")) dx += 1;
    if (k.has("up")) dy -= 1;
    if (k.has("down")) dy += 1;

    const wasMoving = state.moving;
    state.moving = dx !== 0 || dy !== 0;
    // The native clip loader resets its frame timer whenever the actor changes
    // between idle clip 1 and movement clip 5.
    if (state.moving && !wasMoving) {
        state.stopping = false;
        state.stopTime = 0;
        state.animTime = 0;
        for (const f of followers) {
            f.stopping = false;
            f.stopTime = 0;
            f.animTime = 0;
        }
    } else if (!state.moving && wasMoving) {
        state.stopping = true;
        state.stopTime = 0;
        state._idleTime = 0;
        for (let i = 0; i < activeFollowerCount(); i++) {
            followers[i].stopping = true;
            followers[i].stopTime = 0;
            followers[i]._idleTime = 0;
        }
    }
    const fieldTicks = consumeFieldTicks(fieldTickAccumulator, dt);
    fieldTickAccumulator = fieldTicks.accumulator;

    // The tail of a kick: the shake and the radar run on while you walk.
    if (state.treeKick || state.treeRadar) advanceTreeKick(fieldTicks.ticks);

    // Ice Dungeon forced slide (leader modes 0x4f/0x50). While this runs the
    // native raises scene_struct+0x60, so the D-pad is dead: the read above is
    // discarded rather than steering. Mode 0x4f adds its vector straight to
    // char+0x50/+0x54 with no collision resolve, and the followers are NOT put
    // into 0x4f -- they keep copying the delayed ring, which is why the party
    // bunches up behind a sliding leader. Decode: engine/systems/ice-slide.ts.
    if (state.iceSlide) {
        const m = currentMap();
        const slide = state.scenes[m.id]?.iceSlide;
        const margin = 12;
        const followCount = activeFollowerCount();
        state.dir = state.iceSlide.dir;
        // Clip 1: the glide holds the standing pose, it is not a walk cycle.
        state.moving = false;
        state.stopping = false;
        for (let tick = 0; tick < fieldTicks.ticks && state.iceSlide; tick++) {
            const step = tickIceSlide(state.iceSlide);
            state.iceSlide = step.state;
            state.x = Math.max(margin, Math.min(m.width - margin, state.x + step.delta.x));
            state.y = Math.max(margin, Math.min(m.height - margin, state.y + step.delta.y));
            if (state.iceSlide?.phase === "glide") {
                const cell = iceSlideCellAt(slide, state.x, state.y);
                if (cell?.stop) state.iceSlide = stopIceSlide(state.iceSlide);
            }
            if (followCount > 0 && !cutscene.isActive()) {
                pushFollowerHistory(partnerHistory, {
                    x: state.x,
                    y: state.y,
                    dir: state.dir,
                });
                for (let i = 0; i < followCount; i++) {
                    const sample = followerHistorySample(partnerHistory, i);
                    if (!sample) continue;
                    followers[i].x = sample.x;
                    followers[i].y = sample.y;
                    followers[i].dir = sample.dir;
                    followers[i].parked = !!sample.parked;
                    followers[i].animTime =
                        (followers[i].animTime ?? 0) + FIELD_TICK_SECONDS;
                }
            }
        }
        state.animTime += fieldTicks.ticks * FIELD_TICK_SECONDS;
        return;
    }

    // Submarimon buoyancy. The constructor installs F0x8008e45c at char+0x108
    // for sprite id 327 ONLY (engine/systems/submarimon-motion.ts), and that is
    // the character's per-tick method — so height integrates on every field
    // tick, moving or not, which is why this sits OUTSIDE the `state.moving`
    // block below.
    //
    // Placement is deliberate: the native handler returns without touching
    // anything when scene_struct+0x50/+0x58/+0x5c is set (0xb7fc-0xb828), and
    // the textbox/choice/cutscene/fade/menu early-return above is the walker's
    // equivalent of exactly that. Ticking a frozen frame would make the sub
    // float up under a textbox.
    //
    // The throttle is the pad's CROSS bit 0x4000; CIRCLE (0x2000, interact) is
    // read separately at 0xb808 by this same handler's surface path. Held CROSS
    // is now a real pad read on both roads — keyboard `c` or the pad's bottom
    // face button — where it used to be the `x` key, which is the Back button.
    // Submarimon is TANK STEERED, not D-pad steered (WORLD-Q004). CROSS is one
    // throttle for both axes: held, it accelerates the sub forward along its
    // facing AND drives it down; released, it coasts to a stop while buoyancy
    // floats it up. Left/right rotate the facing one step every 8 ticks. The
    // native reaches this by having the handler pick state 0x4b/0x4c and the
    // shared dispatcher F0x8008fed0 do the moving.
    // The native tests CIRCLE (0x2000) before CROSS (0x4000) at 0xb808/0xb89c:
    // while the interact button is held the handler takes the Circle path and
    // never thrusts. So the thrust condition is Cross held with Circle not held,
    // and the thrust loop sound rides that same condition (SUB-Q003).
    const subThrusting = !!state.submarimon && state.keys.has("cross")
        && !state.keys.has("circle");
    syncSubThrustSound(subThrusting);
    if (state.submarimon) {
        const subTurn = dx < 0 ? -1 : dx > 0 ? 1 : 0;
        state._subTurn = subTurn;
        // Entering the thrust state zeroes the speed ramp (`sw $zero,0x68($s0)`),
        // so a fresh press restarts from a standstill instead of resuming.
        state._subEntering = subThrusting && !state._subThrustHeld;
        state._subThrustHeld = subThrusting;
        // The sub's own facing drives the sprite; the D-pad only turns it.
        state.dir = fieldDirectionFromIndex(state.submarimon.facing);
        // "Moving" for animation/clip purposes is whether the hull is advancing,
        // which is speed-based, not input-based: a coasting sub still glides.
        state.moving = submarimonIsAdvancing(state.submarimon) || subThrusting;
    }

    // The sub runs this block even when standing still, because buoyancy is the
    // character's tick method and keeps integrating with no input at all.
    if (state.moving || state.submarimon) {
        // The original maps the current D-pad nibble directly to one of eight
        // facings — for everything EXCEPT Submarimon, which turns instead (its
        // facing was set from the motion state above).
        if (state.submarimon) {
            // facing already applied; the D-pad does not choose it
        } else if (dx !== 0 && dy !== 0) {
            state.dir =
                dy < 0
                    ? dx < 0
                        ? "up-left"
                        : "up-right"
                    : dx < 0
                      ? "down-left"
                      : "down-right";
        } else if (dx < 0) state.dir = "left";
        else if (dx > 0) state.dir = "right";
        else if (dy !== 0) state.dir = dy < 0 ? "up" : "down";

        const m = currentMap();
        const grid = state.collision[m.id];
        const margin = 12;
        const followCount = activeFollowerCount();
        for (let tick = 0; tick < fieldTicks.ticks; tick++) {
            // Submarimon's height, speed and facing all advance on THIS tick,
            // before it is displaced — the handler runs ahead of the dispatcher.
            if (state.submarimon) {
                state.submarimon = tickSubmarimonMotion(state.submarimon, {
                    thrusting: subThrusting,
                    // Read at the GROUND x/y, like the native (0xb9ec-0xba0c
                    // reads char+0x50/+0x54 >> 8). Height never feeds the query.
                    terrainCode: grid ? terrainCodeAt(grid, state.x, state.y) : 0,
                    turn: state._subTurn ?? 0,
                    entering: tick === 0 && state._subEntering,
                });
                state.dir = fieldDirectionFromIndex(state.submarimon.facing);
            }
            // Digmon's constructor halves the move magnitude it stores at
            // +0x68 (fieldstg 0x8009116c, file 0xe67c-0xe6a0). Submarimon
            // does not use a constant at all: its +0x68 is the throttle the
            // thrust/coast states ramp, so the sub's own speed is passed. The
            // same word feeds the obstacle probe's push sizes below.
            const moveMag = state.submarimon
                ? state.submarimon.speedFixed
                : diveMoveMagnitude(state.diveForm, FIELD_RUN_MAGNITUDE);
            // Submarimon's swim reads zonemgr+0x4c (`F0x80092da0`), the PURE
            // row-0 facing vector: no typed-terrain query, no scale row, no
            // mirror. Only the WALK states read the terrain-scaled wrapper
            // (zonemgr+0x48 = `F0x80092ca0`), so the split is structural — the
            // sub's speed is not scaled by terrain (claims WQ004-ZONE-4C-PURE,
            // ZONE-Q001-CELL-710-FACING-MOVE-STEP).
            const delta = state.submarimon
                ? fieldPureDirectionDelta(state.dir, moveMag)
                : fieldDirectionDelta(
                    state.dir,
                    moveMag,
                    terrainCodeAt(grid, state.x, state.y),
                );
            const moved = boxStuck(grid, state.x, state.y)
                // A foot box already overlapping a blocked cell (a save written
                // while the push trap existed, an editor-placed spawn) must never
                // be permanent: while the box is stuck the destination check is
                // skipped, so the player can always walk back out — the same
                // exemption the pre-push step model carried. With the push
                // clamped below, nothing new can get in.
                ? { x: state.x + delta.x, y: state.y + delta.y }
                : moveWithCollision(
                    grid,
                    state.x,
                    state.y,
                    delta.x,
                    delta.y,
                    { w: 12, h: 8 },
                );
            // The form's height on THIS tick. The buoyancy handler runs ahead of
            // the dispatcher and F0x8008de0c reads actor+0x64 at probe time, so
            // the height is read after the motion step above. Only Submarimon
            // carries one; the walking forms are never gated.
            const heightFixed = state.submarimon ? state.submarimon.heightFixed : 0;
            state.x = Math.max(margin, Math.min(m.width - margin, moved.x));
            state.y = Math.max(margin, Math.min(m.height - margin, moved.y));
            // The disc's standing-actor / tree / terrain obstacle (F0x8008dfec ->
            // F0x8008de0c -> zonemgr+0x58 F0x80092a90 and zonemgr+0x44
            // F0x80092914): five probes in the facing cone; each blocked point
            // pushes the actor back by its own (∓mag/2, ∓mag/4) vector. There is
            // no step revert and no "already inside" exemption IN THE DISC'S
            // RESPONSE — the push only ever moves the actor away, and the points
            // behind it are never probed, so backing away from an obstacle is
            // always allowed. The terrain-height gate lives HERE, at the probe
            // points: the disc has no pre-move destination check, which is why a
            // sub standing on a wrong-depth cell can still move off it.
            const push = fieldStepObstaclePush(m, grid, state.x, state.y, moveMag, heightFixed);
            if (push.x !== 0 || push.y !== 0) {
                // The disc applies the push unchecked; the walker's wall model is
                // the walkmesh, which has no probes — so the push is clamped by
                // the same foot box the walk uses (applyObstaclePush). Without
                // this, walking past s210's counter NPC pushes the box down by
                // mag/4..3*mag/4 a tick (one to three blocked front probes) while
                // the step slides along, and the box sinks into the counter's
                // blocked row, where the destination check then refuses every
                // direction — a permanent trap. Against a wall the push now
                // degrades to a wall slide.
                const pushed = applyObstaclePush(grid, state.x, state.y, push, { w: 12, h: 8 });
                state.x = Math.max(margin, Math.min(m.width - margin, pushed.x));
                state.y = Math.max(margin, Math.min(m.height - margin, pushed.y));
            }

            // Walking onto an op-11 cell hands the leader to mode 0x4f for the
            // rest of the lane. The cell's high 3 bits are the glide facing, so
            // which way you slide is a property of the floor, not of your input.
            //
            // A launch pad does NOT belong here. The disc's setup arm runs every
            // frame whether or not the player moved (`stepSetupTick()`), because
            // op 13 has no button and no "first frame on the tile" — so it fires
            // from there, out of the record's own words.

            const slideCell = iceSlideCellAt(
                state.scenes[m.id]?.iceSlide,
                state.x,
                state.y,
            );
            if (slideCell?.start !== undefined) {
                state.iceSlide = beginIceSlide(slideCell.start);
                state.dir = state.iceSlide.dir;
                state.moving = false;
                state.stopping = false;
                break;
            }

            // Native party actors copy the player's exact 9/18/27-tick-old
            // {x,y,facing} record. They do not steer, interpolate or catch up.
            if (followCount > 0 && !cutscene.isActive()) {
                pushFollowerHistory(partnerHistory, {
                    x: state.x,
                    y: state.y,
                    dir: state.dir,
                });
                for (let i = 0; i < followCount; i++) {
                    const sample = followerHistorySample(partnerHistory, i);
                    if (!sample) continue;
                    followers[i].x = sample.x;
                    followers[i].y = sample.y;
                    followers[i].dir = sample.dir;
                    followers[i].parked = !!sample.parked;
                    followers[i].animTime =
                        (followers[i].animTime ?? 0) + FIELD_TICK_SECONDS;
                }
            }
        }
        state.animTime += fieldTicks.ticks * FIELD_TICK_SECONDS;

        tickFootstep(state, fieldTicks.ticks * FIELD_TICK_SECONDS);

        // Ladders are press-to-climb now (startLadderClimb via the interact key,
        // matching the PS1's Circle-on-armed-trigger activation) — walking onto
        // an endpoint no longer auto-relocates.

        // Bug-maze trap pads: stepping on a bugged floor tile bounces the player
        // back to the maze reset point (decoded TMPK tile-type layer; see
        // tools/gen_trap_pads.py). Faithful to the "Bug Maze Pit" hazard.
        const trapScene = state.scenes[m.id];
        const reset =
            trapScene && hitTrapPad(trapScene.trapPads, state.x, state.y);
        if (reset) {
            // SWITCH03: the Bug-Maze pad state-toggle sound (wstag745/746
            // sites play it exactly when the pad flips state; sfx-triggers.json)
            sfx.play("switch02");
            state.x = reset.x;
            state.y = reset.y;
            state.dir = reset.dir || state.dir;
            fade.dir = 1;
            setTimeout(() => {
                fade.dir = -1;
            }, 150);
        }

        // Fire Dungeon floor traps (s740/s741). Same trigger source as the OnStep
        // story VM — the type-7 grid cell under the player selects a step record —
        // but sampled here, on the movement path, because that is when the native
        // step driver evaluates it (the capture's trigger fired on the move, not on
        // entering the room). The gate flag is clear until the patch has been
        // sprung, which is what makes each of the 16 regions one-shot.
        // Decode: engine/systems/fire-trap.ts, tools/extract_fire_traps.py.
        if (!state.fireTrap) {
            const cfg = state.fireTraps?.[m.id];
            const region = fireTrapRegionAt(cfg, storyGridCellAt(state.x, state.y));
            if (region && storyFlags.get(region.gateFlag) === 0)
                state.fireTrap = { cfg, run: startFireTrap(cfg, region) };
        }

        // Ambush tiles (engine/systems/ambush-tile.ts): a marked patch of floor
        // whose step event is handled by the RESIDENT fieldstg routine rather
        // than the stage overlay. It carries no enemy — it reads slot 5 of the
        // stage's own scripted encounter block, so the party comes from the
        // same table a random encounter would roll. All fourteen share ONE gate
        // flag, which firing sets, so the host reads and writes that flag and
        // inherits whatever lifetime it turns out to have.
        const ambush = ambushTileAt(
            state.ambushTiles?.[m.id],
            storyGridCellAt(state.x, state.y),
        );
        if (ambush && storyFlags.get(ambush.gateFlag) === 0 && !battle.isActive()) {
            storyFlags.set(ambush.gateFlag, true);
            startAmbush(m.id, ambush);
        }

        // Random-encounter step counter — the decoded fieldstg driver, run once per
        // ENCOUNTER_TICK_FRAMES ticks of movement (F0x8008fd74's `actor->+0x18 & 7`),
        // subtracting the standing zone's rate from the countdown and rolling on
        // expiry. See docs/research/field/encounter-step-counter-decoded-2026-07-25.md.
        //
        // A fight can be ALREADY up on arrival WITHOUT this machinery. The ordinary
        // opening reaches s200 at story ordinal 3, whose stage-entry dispatcher
        // auto-starts event 0x32 (pro/wstag200.s 0x38-0x70); its completion fires the
        // bank-0x74 scripted-battle launcher 0x7401 -> the scripted block's record 1,
        // and s200's scripted block is [188, 200, 272] -> screen 200 = Genji's
        // Kuwagamon. That is the OnEnterMap row engine-content ships as
        // `s200.sb.battle`, the disc's own scripted arrival fight — not a roll made
        // here. Every stage on the opening route registers no type-4 zone map (or
        // only level-0 blocks), so this counter never drains and `triggerRandomEncounter`
        // cannot be what starts it. See tests/s200-arrival-battle.test.js.
        // ?noEncounters=1 mirrors the engine's own master switch [0x80042b1c]:
        // the driver still runs and the counter still drains and resets, only the
        // battle launch is suppressed (`if (gate) launch(); reset();`). The single
        // writer of that word in the whole disassembly is a NOT-toggle behind a
        // controller-bit test in the stage-select overlay (stagslct file 0x2880).
        const encEligible =
            fieldPartySize(state.party) > 0 &&
            !m.id.startsWith("s78") &&
            !m.id.startsWith("s79") &&
            // Submarimon rolls only while THRUSTING: the thrust state 0x4b calls
            // F0x8008fd74 (file 0xd5a4) but the coast state 0x4c has no such
            // call, so gliding to a halt with the engine off cannot start a
            // fight. Cutting the engine is a way to stop safely.
            (!state.submarimon ||
                submarimonRollsEncounter(state.submarimon, subThrusting));
        // Note the beat is gated on the movement PATH, not on displacement: the
        // three F0x8008fd74 call sites pass their `moving` argument as a literal 1
        // on the walk path, so walking into a wall still ticks the driver.
        for (let tick = 0; tick < fieldTicks.ticks; tick++) {
            if (encEligible && state._encTick % ENCOUNTER_TICK_FRAMES === 0) {
                const level = battle.encounterRateLevel(m.id, state.x, state.y);
                // 0 covers all three ways the driver (F0x80092664) bails out: the
                // stage registers no type-4 zone map (module gate), the player is
                // on a zone-0 cell, or the block is the level-0 sentinel only the
                // scripted trigger path reaches.
                if (level > 0) {
                    const r = encounterStepTick(state._encCounter, level);
                    state._encCounter = r.counter;
                    if (r.expired) {
                        // Original order: the gated launch, then the reset.
                        if (!NO_ENCOUNTERS)
                            triggerRandomEncounter(m.id, state.x, state.y);
                        state._encCounter = resetEncounterCounter(
                            () => Math.floor(Math.random() * 0x10000),
                        );
                    }
                }
            }
            state._encTick++;
        }
    } else {
        state.animTime = 0;
        for (const f of followers) f.animTime = 0;
        // The actor's tick (+0x18) is free-running: it advances while idle too, so
        // standing still re-phases the next footstep beat exactly as the game does.
        state._encTick += fieldTicks.ticks;

        const stopDt = fieldTicks.ticks * FIELD_TICK_SECONDS;
        const tickStopClip = (actor, meta) => {
            if (!actor.stopping) return;
            actor.stopTime += stopDt;
            const duration = clipDurationSeconds(meta?.clips, FIELD_STOP_CLIP, actor.dir);
            if (duration == null || actor.stopTime >= duration) {
                actor.stopping = false;
                actor.stopTime = 0;
                actor._idleTime = 0;
            }
        };
        tickStopClip(state, currentChar());
        for (let i = 0; i < activeFollowerCount(); i++) {
            tickStopClip(followers[i], followerChar(i));
        }
    }

    // WS4 position-triggered story VM (engine/systems/trigger-system.ts): the player's (x,y)
    // may sit in a step-trigger zone whose gate is open — fire that scripted cutscene
    // (walk-triggered story beats). Runs on ALL stages including the opening (s7xx): the s7xx
    // position cutscenes (s735/736/755/756/800/815) fire here, faithfully by position+flag,
    // never on bare entry. Fully flag-gated + busy-guarded, so it cannot disrupt intro ordering.
    if (engineTriggerSystem)
        engineTriggerSystem.tick(
            currentMap().id, state.x, state.y, fieldDirectionIndex(state.dir),
        );

    // Advance path-following NPCs.
    const NPC_SPEED = FIELD_WALK_SPEED;
    const scene = state.scenes[currentMap().id];
    if (scene) {
        for (const npc of sceneCast(
            scene,
        )) {
            if (npc._inCutscene) continue;
            if (!npc.path || npc.path.length < 2) continue;
            if (npc._pathIdx === undefined) {
                npc._pathIdx = 0;
                npc._pathFrac = 0;
            }

            const path = npc.path;
            const cur = path[npc._pathIdx];
            const next = path[(npc._pathIdx + 1) % path.length];
            const segDx = next[0] - cur[0];
            const segDy = next[1] - cur[1];
            const segLen = Math.hypot(segDx, segDy);

            // Advance fraction; handle zero-length segments instantly.
            if (segLen < 0.001) {
                npc._pathFrac = 1;
            } else {
                npc._pathFrac += (NPC_SPEED * dt) / segLen;
            }

            // Advance to next waypoint(s) as needed.
            while (npc._pathFrac >= 1) {
                npc._pathFrac -= 1;
                npc._pathIdx = (npc._pathIdx + 1) % path.length;
                // Clamp in case of large dt.
                if (npc._pathFrac > 1) npc._pathFrac = 0;
            }

            // Interpolate position.
            const a = path[npc._pathIdx];
            const b = path[(npc._pathIdx + 1) % path.length];
            npc.x = a[0] + (b[0] - a[0]) * npc._pathFrac;
            npc.y = a[1] + (b[1] - a[1]) * npc._pathFrac;

            // Update facing direction from movement delta.
            const movDx = b[0] - a[0];
            const movDy = b[1] - a[1];
            if (Math.abs(movDx) > 0.001 || Math.abs(movDy) > 0.001) {
                npc.dir = faceToward(0, 0, movDx, movDy);
            }

            // Advance animation clock using real dt.
            npc._animTime = (npc._animTime ?? 0) + dt;
        }
    }

    // Standing on an exit shows a "?" prompt; Space/Enter confirms entry.
    const onExitZone = activeExitAt();
    // Gondola console (s410): faithful trigger. With NO card the first approach
    // AUTO-boards (the original auto-walks you to the console) → event 90 "who's in
    // charge" → bounce to s400. Holding a card, it stays a click-to-interact exit
    // (the "?" prompt below), and the gated events decide (fake reject / real ride /
    // normal door). Card possession is read from the engine bag (collection flags
    // 0x818e real, 0x818f fake) — the same predicate the events gate on.
    if (
        onExitZone?.gondola && engine && fade.dir === 0 &&
        !textbox.isOpen() && !battle.isActive() &&
        !(engineBridge && engineBridge.isBusy()) && !state.gondolaAutoFired
    ) {
        const hasCard =
            engine.state.flags.get(0x818e, 1) || engine.state.flags.get(0x818f, 1);
        if (!hasCard) {
            state.gondolaAutoFired = true; // once per visit (reset on stage entry)
            startTransition(onExitZone); // → OnExit{to:s440} → event 90 → s400
        }
    }
    // The gondola is auto-only with no card; the "?" prompt is for card-holding
    // (click-to-board) and every other exit.
    state.onExit = !!onExitZone && !(onExitZone.gondola && state.gondolaAutoFired);
}

// Fallback for sprites (NPCs) whose row list doesn't include diagonal directions
const _DIR_FALLBACK = {
    "down-left": "left",
    "down-right": "right",
    "up-left": "left",
    "up-right": "right",
};

function drawSprite(meta, sheet, x, y, dir, frameIdx) {
    let row = meta.rows.indexOf(dir);
    if (row === -1) {
        const fallback = _DIR_FALLBACK[dir] ?? "down";
        row = meta.rows.indexOf(fallback);
        if (row === -1) row = 0;
    }
    const bottom = spriteBottomShift(meta, dir, row, frameIdx);
    // The row this frame's cell is drawn at, recorded for
    // tools/verify_field_billboard_anchor.mjs.
    const cellRow = Math.round(y - lastCam.y - meta.frameH) + bottom;
    billboardDraws.push({
        row: cellRow,
        shift: bottom,
        groundRow: Math.round(y - lastCam.y),
        screenX: Math.round(x - lastCam.x),
        cellH: meta.frameH,
        path: "sheet",
        frameIdx,
        dir,
    });
    ctx.drawImage(
        sheet,
        frameIdx * meta.frameW,
        row * meta.frameH,
        meta.frameW,
        meta.frameH,
        Math.round(x - lastCam.x - meta.frameW / 2),
        cellRow,
        meta.frameW,
        meta.frameH,
    );
}

// The field actor's own sprite is hung off a per-frame number the disc registers for
// that frame, not off the frame's own bounding box: the original draws the sprite's
// TOP row at the actor's screen row plus the frame's registered Y offset, so its bottom
// sits `yOffset + frameHeight` rows below that row (fieldstg.s:12919-12940,
// docs/research/field/field-actor-sprite-anchor-decoded-2026-08-17.md). The sheets are
// baked bottom-aligned on the actor's ground row, so that is the shift the draw applies.
// X needs nothing: build_assets bakes each frame's registered offset into the sheet
// (content left = cellW/2 + DC), which also makes the mirrored right-hand rows land on
// `screenX - (E4 + DC)` for free.
function spriteBottomShift(meta, dir, row, frameIdx) {
    const byDir = meta.frameBottomShift;
    if (!byDir) return 0;
    const shifts = byDir[dir] ?? byDir[meta.rows[row]];
    return (shifts && shifts[frameIdx]) || 0;
}

// Field character drop shadow (docs/research/field/character-drop-shadow-
// decoded-2026-07-27.md). The native renderer emits it per actor, immediately
// after that actor's own billboard and one OT bucket further back — so call
// this at the top of an actor's draw closure and the actor paints over it.
//
// `kind` is the field-entity constructor's first argument: 2 for the player,
// speciesId+3 for a party follower, npc_id for an NPC. The engine owns both the
// gate and the geometry; this only supplies the projection.
//
// `actorHeightFixed` is the 8.8 vertical lift the billboard was raised by. The
// walker has no airborne field actor today, so every caller is on the ground and
// passes 0; the parameter exists because the ground-pin is part of the decoded
// geometry, and the engine cancels exactly this term (and nothing horizontal) so
// a lifted actor's shadow stays on the ground while still tracking him across it.
function drawActorShadow(x, y, kind, clipId, actorHeightFixed = 0, groundOffsetFixed = 0) {
    if (!fieldShadowVisible(kind, clipId)) return;
    drawFieldShadow(ctx, {
        screenX: x - lastCam.x,
        actorScreenY: y - lastCam.y,
        actorHeightFixed,
        // entity+0x90. SHDW-Q003 asked what writes it outside the scripted move
        // methods and the clip-0x17 ramp; the LADDER is one answer, and the only
        // one with a shadow consequence: the two mount methods write it
        // (bottom 0x8008f128 file 0xc4d4 `sw $zr,0x90`; top 0x8008f1d4 file
        // 0xc588 `sw $s0,0x90`), and the climb blocks add ±0x100 per tick
        // (up file 0xd858, down file 0xd8b8). The per-frame update subtracts it
        // from the actor's world y to place the BILLBOARD (file 0xe3d8-0xe3fc:
        // +0x5c = (+0x54 - +0x90) >> 8) and the renderer adds it back for the
        // shadow (file 0xcbf8, RAM 0x8008f8a8: shadowY += (+0x90) >> 8) — the
        // exact mirror of the +0x64 height undo, so the shadow stays pinned to
        // the ladder's FOOT while the sprite climbs away from it. The caller
        // supplies the climb offset here; 0 elsewhere reproduces the resting case.
        groundOffsetFixed,
    });
}

// Draws a frame from a sprite's baked SETANIM clip strip (build_assets.py's
// `_build_clip_strip` — see docs/research/field/field-actor-anim-engine.md): a flat,
// deduped strip with no direction rows, so `col` alone (from `clipFrame`) picks the frame.
// `mirror` (from `clipFrame`'s result) flips it horizontally: the strip only ever bakes
// left-side frames (build_assets.py never emits a right-side clip frame), so right/
// down-right/up-right always resolve via a left-side mirror source and MUST be flipped at
// draw time — skipping this was the "dir says right, sprite visibly faces left" bug.
// `bottom` is the frame's vertical registration (the same shift `spriteBottomShift` applies
// to the sheet path); the original's Y math has no mirror branch, so it is the same number
// whichever way the sprite faces.
function drawClipFrame(meta, clipImg, x, y, col, mirror, bottom = 0) {
    const sx = col * meta.clipFrameW;
    const drawY = Math.round(y - lastCam.y - meta.clipFrameH) + bottom;
    billboardDraws.push({
        row: drawY, shift: bottom, groundRow: Math.round(y - lastCam.y),
        screenX: Math.round(x - lastCam.x), cellH: meta.clipFrameH, path: "clip", col,
    });
    if (!mirror) {
        ctx.drawImage(
            clipImg, sx, 0, meta.clipFrameW, meta.clipFrameH,
            Math.round(x - lastCam.x - meta.clipFrameW / 2), drawY,
            meta.clipFrameW, meta.clipFrameH,
        );
        return;
    }
    const screenX = Math.round(x - lastCam.x);
    ctx.save();
    ctx.translate(screenX, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
        clipImg, sx, 0, meta.clipFrameW, meta.clipFrameH,
        -meta.clipFrameW / 2, drawY,
        meta.clipFrameW, meta.clipFrameH,
    );
    ctx.restore();
}

// Clip "1" is the idle/breathing clip on every sprite that has clip data (verified
// game-wide, see docs/research/field/field-actor-anim-engine.md's clip-directory decode —
// clip 1 = idle for every checked sprite). Used as the default "just standing there" clip
// when nothing scripted (SETANIM) is overriding this entity.
function _idleClipId(meta) {
    return meta.clips && meta.clips[String(FIELD_IDLE_CLIP)]
        ? String(FIELD_IDLE_CLIP)
        : null;
}

// Renders a sprite's native clip animation when one applies; otherwise falls back to the
// legacy sheet (a clip id this sprite's pack doesn't define — same "no match, no override"
// behavior as the original engine's directory miss).
//
// Two clip sources, in priority order: `activeClip` (a cutscene-latched SETANIM, timed by
// `animTime` — cutscene beat timing) and, when nothing scripted applies, the sprite's own
// idle clip "1" (timed by `idleTime`) and `movementClip` (clip 5 for normal player/party
// movement, clip 4 for scripted walking). Movement wins over a lingering SETANIM latch.
// Returns {mode, clipId, frame, dir} describing what actually got drawn, for the "V" anim
// debug overlay below — computed from the exact same branch that rendered, so the overlay
// can never show a mode that doesn't match the screen.
// EXPERIMENT (ambience): the wet / dusty look and the reflection on water are applied here, so every
// body that goes through this function (leader, partners, NPCs, ambient villagers) gets them.
function drawEntitySprite(meta, sheet, clipImg, x, y, ...rest) {
    const bf = window.__bodyFx;
    if (!bf) return _drawEntitySpriteRaw(meta, sheet, clipImg, x, y, ...rest);
    if (bf.reflect) {
        const a = bf.reflect(x, y);
        if (a > 0.02) {
            ctx.save();
            ctx.globalAlpha = a; ctx.filter = "brightness(0.78) saturate(0.85) blur(0.5px)";
            ctx.translate(0, 2 * (y - lastCam.y + 4)); ctx.scale(1, -1);
            _drawEntitySpriteRaw(meta, sheet, clipImg, x, y, ...rest);
            ctx.restore();
        }
    }
    if (bf.filter) {
        ctx.save(); ctx.filter = bf.filter;
        const r = _drawEntitySpriteRaw(meta, sheet, clipImg, x, y, ...rest);
        ctx.restore();
        return r;
    }
    return _drawEntitySpriteRaw(meta, sheet, clipImg, x, y, ...rest);
}
function _drawEntitySpriteRaw(meta, sheet, clipImg, x, y, dir, activeClip, animTime, fallbackFrameIdx, isMoving, idleTime, movementClip = null) {
    if (clipImg) {
        const clipId = isMoving ? movementClip : (activeClip ?? _idleClipId(meta));
        const clipTime = isMoving || activeClip != null ? animTime : (idleTime ?? 0);
        const resolved = clipId != null ? clipFrame(meta.clips, clipId, dir, clipTime) : null;
        if (resolved != null) {
            drawClipFrame(meta, clipImg, x, y, resolved.col, resolved.mirror, resolved.bottom);
            return {
                mode: isMoving ? (String(clipId) === String(FIELD_RUN_CLIP) ? "run" : "walk")
                    : activeClip != null ? "clip" : "idle",
                clipId,
                frame: resolved.col,
                dir,
            };
        }
    }
    drawSprite(meta, sheet, x, y, dir, fallbackFrameIdx);
    return { mode: isMoving ? "walk" : "static", clipId: null, frame: fallbackFrameIdx, dir };
}

// Unit vectors for the "V" debug overlay's facing arrow.
const _DIR8_VEC = {
    down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0],
    "down-left": [-0.7, 0.7], "down-right": [0.7, 0.7],
    "up-left": [-0.7, -0.7], "up-right": [0.7, -0.7],
};

// "V" toggles this: a facing arrow + mode/clip/frame label over every rendered sprite, so
// orientation and animation-source bugs (idle vs. clip vs. walk; wrong facing) are visible
// in-game without needing a screenshot round-trip to diagnose.
// White oval bubble, black outline, pointed tail — pixel-sampled from a verified PS1
// savestate ("!" over an NPC's head near Genji's tower). World-space, anchored above
// the actor. See docs/research/ui/dialogue-chrome-decoded-2026-07-01.md.
// Shared clock for FIELDCOM icon animation (sparkle/glyph steps are counted in
// emulator frames, so tick at the PS1's 60fps regardless of rAF rate).
function fieldcomTick() {
    return Math.floor(performance.now() / (1000 / 60));
}

// ── Authentic field-trigger indicator (story-step VM, decoded from disasm) ──

// The cone FIELDSTG.PRO's 8x8 byte table at RAM 0x80097624 is read as
// cone[byte >> 5][the player's facing]; tools/extract_step_enable_table.py verified all
// eight rows are the ±1 cone {g-1, g, g+1}. Only ops 0-4, 7 and >= 15 consult it
// (fieldstg.s:5650-5680); ops 5, 6 and 8-14 are live whatever the facing, which is why
// an op-8 cutscene still fires standing on the tile facing away from it.
// The step under the player, iff both flag gates pass AND the facing cone lets it, with
// the icon the disc would draw there.
//
// This is now the ENGINE's read, not a second copy of it: the trigger system
// (engine/systems/trigger-system.ts) owns the grid sample, the cone and the two flag
// gates, and engine/systems/scene-step-ops.ts owns the op -> kind table read out of
// FIELDSTG.PRO's dispatch tables (file 0x198 ops 5-13, file 0x1c0 ops 1-7). The engine
// answers "which icon" exactly as it answers "start the event", so the bubble and the
// op's behaviour cannot drift apart. The old local table was wrong in three ways: it
// read op 1's arrow from the record's param 3 instead of the grid byte's group,
// it drew a "!" for ops 5/6 (which table A intercepts before the bubble tail), and it
// drew nothing for ops 0/9/10/14+ (which all draw kind 0).
//
// Returned shape: {step, group, op, kind}. `kind` is null for ops that draw nothing.
function activeTriggerStep() {
    const ts = engineTriggerSystem;
    if (!ts) return null;
    return ts.indicator(currentMap().id, state.x, state.y, fieldDirectionIndex(state.dir));
}



/**
 * The strike bar — the REAL FIELDCOM art, composed the way the original does.
 *
 * The bobber's tail (fieldstg files 0xa90c-0xaa78) resolves FIELDCOM.BIN
 * sub-entry 1 (`[0x80044f5c](0x01600001)`, the pack id the point-sprite doc
 * already identifies as FIELDCOM) and makes three draw calls through the shared
 * sprite routine `F0x8001ed6c(pack, id, x, y)`:
 *
 *   id 0x3c              at (0x18, 0xc0)                 the 64x24 bar frame
 *   id 0x3e + pattern    at (0x18, 0xc0)                 a 48x8 strip, inset
 *                                                        (dx 8, dy 8) — ONE PER
 *                                                        PATTERN, nine of them
 *   id 0x3d              at ((meter >> 8) + 0x18, 0xc0)  the 16x24 marker
 *
 * The strip is 48 pixels wide and the meter has 48 bands: the bar you are
 * looking at IS this cast's pattern, one pixel per band, and the marker slides
 * across it one pixel at a time. So the game does show you where the live water
 * is — reading the strip is the skill.
 *
 * All three ids are already in the extracted directory (`fieldcom.json` dir1,
 * tools/extract_fieldcom.py); the anchor (0x18, 0xc0) and each layer's own
 * dx/dy are the original's, so the composition matches without new numbers.
 */
const FISH_BAR_X = 0x18;
const FISH_BAR_Y = 0xc0;
const FISH_BAR_FRAME = 0x3c;
const FISH_BAR_MARKER = 0x3d;
const FISH_BAR_TRACK = 0x3e;

function drawFishing(ctx, camX, camY) {
    const f = state.fishing;
    if (!f) return;

    // Nothing is drawn during the settle: the original's draw block sits after
    // the meter update, and the settle phase returns before it ever gets there.
    //
    // And nothing once the cast has resolved: the float object is gone by then,
    // so the bar, the marker and the float all clear BEFORE the angler's result
    // pose and its bubble — which is the order the 2026-07-29 capture saw
    // (presentation clearing around frames 520-625, bubble at 576).
    if (f.run.phase === "settle" || f.castOver || !fieldcomReady()) return;

    // The float, out on the water where the cast put it — one of four 16x16
    // FIELDCOM cells. It is NOT a flicker: the cell is `0x60 + ((tick % 48)/12)`
    // off the display tick (file 0xa95c), so the four run in order, twelve
    // units each — a ripple on the water.
    drawFieldcomIcon(
        ctx, 0, f.run.cell,
        Math.round(f.x - camX), Math.round(f.y - camY),
    );

    drawFieldcomIcon(ctx, 1, FISH_BAR_FRAME, FISH_BAR_X, FISH_BAR_Y);
    drawFieldcomIcon(ctx, 1, FISH_BAR_TRACK + f.run.pattern, FISH_BAR_X, FISH_BAR_Y);
    drawFieldcomIcon(
        ctx, 1, FISH_BAR_MARKER,
        FISH_BAR_X + Math.floor(f.run.meter / METER_BAND), FISH_BAR_Y,
    );
}

/**
 * The tree-kick radar card — the REAL FIELDCOM art, composed the way the
 * original does.
 *
 * F0x8008c6b8 (fieldstg file 0x9b1c-0x9ba8) resolves FIELDCOM sub-entry 1 and
 * makes two draw calls at the SAME anchor (0xf8, 0xa8):
 *
 *   id 0x50/0x51/0x52   the rings, picked by how far off the live tree is
 *   id 0x4f             the card behind them
 *
 * The rings go in FIRST and the card SECOND, and within one OT layer a later
 * draw renders BEHIND an earlier one — so the card is the backdrop and the rings
 * sit on it. Before both it pushes `(timer / rate) % 10` into the draw context's
 * CLUT-cycle row: the rings are concentric bands of one palette, so rotating the
 * palette makes them ripple outward, three frames per row when the tree is very
 * close and twelve when it is far. Those ten rows ship as "id@row" clips
 * (tools/extract_fieldcom.py CLUT_CYCLE).
 */
function drawTreeRadar(ctx) {
    const r = state.treeRadar;
    if (!r || !fieldcomReady()) return;
    drawFieldcomIcon(ctx, 1, RADAR_FRAME, RADAR_X, RADAR_Y);
    drawFieldcomIcon(ctx, 1, r.icon, RADAR_X, RADAR_Y, radarClutRow(r));
}

// The Digi-Egg dive transition. Drawn inside the camera transform, so the
// coordinates here are logical screen pixels (VIEW_W/VIEW_H at ZOOM 1).
//
// Order matters and follows the original's own staging:
//   1. Once the demo begins, the native controller has DESTROYED the whole
//      field cast — so the field behind is blacked out rather than left
//      showing around the edges of the demo artwork.
//   2. The demo cells (backdrop first, animated layers over it).
//   3. The particle burst, which is a separate object with its own clock: it
//      starts while the field is still fully visible and keeps drawing on top
//      of the demo afterwards.
//   4. The blackout, which covers the fade out, the load gap and the fade in.
function drawDiveTransition(ctx, camX, camY) {
    const d = state.diveDemo;
    if (!d) return;
    const f = diveDemoFrame(d.mode, d.frame);
    const viewW = VIEW_W / ZOOM, viewH = VIEW_H / ZOOM;

    if (d.frame >= DIVE_DEMO_START) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, viewW, viewH);
    }
    if (f.demoCells) drawDiveDemoCells(ctx, d.mode, f.demoCells, viewW, viewH);
    if (f.particleCells.length && fieldcomReady()) {
        drawDiveParticles(
            ctx, f.particleCells,
            Math.round(d.anchorX - camX), Math.round(d.anchorY - camY),
        );
    }
    if (f.blackout > 0) {
        // The field's blackout is the same subtractive wash every menu uses
        // (fieldstg F0x80089f7c is a copy of the shared dim quad), so it goes
        // through the shared painter rather than an alpha fill.
        paintScreenDim(ctx, Math.min(f.blackout, 1) * 255, viewW, viewH);
    }
}

function drawAnimDebug(entries) {
    ctx.save();
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    for (const { x, y, label, info } of entries) {
        const sx = Math.round(x - lastCam.x);
        const sy = Math.round(y - lastCam.y);
        const [vx, vy] = _DIR8_VEC[info.dir] ?? [0, 1];
        ctx.strokeStyle = "#0f0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 6);
        ctx.lineTo(sx + vx * 16, sy - 6 + vy * 16);
        ctx.stroke();
        const modeTxt =
            info.mode === "clip" ? `clip:${info.clipId}`
            : info.mode === "idle" ? `idle:${info.clipId}`
            : info.mode;
        const text = `${label} ${info.dir} ${modeTxt} f${info.frame}`;
        ctx.fillStyle = "#000";
        ctx.fillText(text, sx + 1, sy - 33);
        ctx.fillStyle = "#0f0";
        ctx.fillText(text, sx, sy - 34);
    }
    ctx.restore();
}

function render() {
    billboardDraws = [];
    if (battle.isActive()) {
        // Battle owns the shared canvas at device resolution and establishes
        // its own transforms. The field underneath is fully covered.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
        fieldFrame = fieldCanvasResolution.beginFrame(assetMode() === ASSET_MODE_HD);
    }
    const m = currentMap();
    const mapImg = state.mapImgs[m.id];
    const c = currentChar();
    const sheet = state.charImgs[c.id] ?? state.npcImgs[c.id];
    // The one ordering list for the field frame, and the debug overlay list.
    // Declared here (above the map band) so the leader's own drawable can be a
    // hoisted function the under-map band calls before the ground goes down.
    const drawables = [];
    const debugInfos = [];

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
    // Draw on the pixel grid. The player moves in fractions of a pixel (a walk
    // step is 0x4cc/0x100 = 1.195 px), so an unsnapped camera leaves the map at
    // a fractional destination and the canvas then samples it UNEVENLY: measured
    // on s205 at a half-pixel offset, some map columns were drawn one device
    // pixel wide and others two, which makes the artwork's own one-pixel dark
    // lines change thickness as you walk. Snapping the camera to a whole DEVICE
    // pixel keeps every column the same width at every camera position, and
    // costs at most half a pixel of camera lag. Movement itself is unaffected —
    // state.x keeps its fraction, only the drawn viewpoint is quantised.
    const devicePerMapPx = (fieldFrame?.scaleX ?? 1) * ZOOM;
    camX = Math.round(camX * devicePerMapPx) / devicePerMapPx;
    camY = Math.round(camY * devicePerMapPx) / devicePerMapPx;
    lastCam.x = camX;
    lastCam.y = camY;

    ctx.fillStyle = window.__clearColour ?? "#000"; // see __cam/__mapInfo above
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    ctx.scale(ZOOM, ZOOM);
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
    paceStageObjects(m.id, fieldBlanks, camX, camY);
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
    if (layer2Split) {
        ctx.drawImage(
            layer2Img,
            m.fixedViewportBackground ? 0 : -camX,
            m.fixedViewportBackground ? 0 : -camY,
        );
    }
    // No ground split: the leader at an under-map bucket goes down before the
    // flattened map, which is this stage's ground band.
    if (playerUnderMap && !groundCover) {
        drawPlayerActor();
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
        if (!layer2Split) {
            ctx.drawImage(
                mapImg,
                m.fixedViewportBackground ? 0 : -camX,
                m.fixedViewportBackground ? 0 : -camY,
            );
        }
    } else if (mapImg === "failed") {
        // The required map image failed and was latched; say so rather than keep
        // showing "loading map..." for ever, and do not re-request it.
        ctx.fillStyle = "#bbb";
        ctx.font = "16px monospace";
        ctx.fillText("map failed to load", 20, 30);
    } else {
        ensureMapImg(m.id);
        ctx.fillStyle = "#bbb";
        ctx.font = "16px monospace";
        ctx.fillText("loading map…", 20, 30);
    }

    // The stage's own SLIDING SCENERY LAYER (the s415 Deeper Crevice backdrop the
    // platform travels past): the stage's own art, drawn at the object's live
    // offset.  Screen coordinates -- the layer belongs to a fixed-viewport stage
    // -- and drawn here, over the base backdrop and under the props/entities, so
    // the platform and the point sprites stay in front of it.  See
    // engine/systems/point-record-actor.ts `scroll-layer`.
    if (!window.__hideProps) drawScrollLayers(ctx, m.id);

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
    if (!window.__hideProps) drawEffectsUnderMap(ctx, m.id, camX, camY, VIEW_W / ZOOM, VIEW_H / ZOOM);
    // The under-map band (the party, whose leader's step-op 5 bucket is 8) goes
    // down HERE — after layer 2 and the 8/10 props, before the ground — the disc's
    // own OT[11] -> OT[8] -> OT[7] order.
    if (playerUnderMap && groundCover) {
        drawPlayerActor();
        drawPartyFollowers();
    }
    // The ground layer, at OT[7] — in front of everything the under-map band drew.
    if (groundCover) {
        ctx.drawImage(
            groundImg,
            m.fixedViewportBackground ? 0 : -camX,
            m.fixedViewportBackground ? 0 : -camY,
        );
    }
    // EXPERIMENT (seam fixes): filler pixels for pin-holes and hairline cracks in the
    // map picture, drawn over the ground. Off with the Effects panel / __noSeamFix.
    if (!window.__noSeamFix && !window.__hideProps && !m.fixedViewportBackground && mapImg instanceof Image) {
        const sp = seamPatchFor(m.id, mapImg);
        if (sp) ctx.drawImage(sp.canvas, -camX, -camY);
    }
    // EXPERIMENT (swaying trees): hide the painted canopies; the swaying copy is drawn with the foreground layer
    if (!m.fixedViewportBackground && mapImg instanceof Image && swayFor(m, mapImg)) drawTreePatch(ctx, m.id, state.mapFgImgs[m.id], mapImg, camX, camY);
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
    if (!NO_WATER3D && !window.__noWater3d && !m.fixedViewportBackground && !window.__hideProps) {
        const wc = renderWater(m.id, mapImg, camX, camY, performance.now() / 1000);
        if (wc) ctx.drawImage(wc, 0, 0, WATER_VIEW.w, WATER_VIEW.h);
    }
    if (!NO_GRASS3D && !window.__noGrass3d && !m.fixedViewportBackground && !window.__hideProps) {
        const gc = renderGrass(m.id, mapImg, camX, camY, performance.now() / 1000);
        if (gc) {
            const STRIP = 8, PXS = GRASS_VIEW.px;
            for (let sy = 0; sy < GRASS_VIEW.h; sy += STRIP) {
                drawables.push({
                    y: camY + sy + STRIP,
                    draw: () => ctx.drawImage(gc, 0, sy * PXS, GRASS_VIEW.w * PXS, STRIP * PXS,
                                              0, sy, GRASS_VIEW.w, STRIP),
                });
            }
        }
    }
    // EXPERIMENT (ambience ground layer): puddles, footprints, dust and wading ripples,
    // above the ground and under every sprite.
    if (!window.__hideProps && !m.fixedViewportBackground) {
        const gfx = groundFxFor(m, mapImg, camX, camY);
        if (gfx) drawables.push({ y: -1e12, draw: () => gfx(ctx) });
    }
    const fgImg = state.mapFgImgs[m.id];
    if (fgImg instanceof Image) {
        drawables.push({
            y: Infinity,
            draw: () => {
                // EXPERIMENT (swaying trees): the canopies move; everything else in the layer stays put
                const sw = swayFor(m, mapImg);
                if (!(sw && drawSwayingForeground(ctx, m.id, fgImg, mapImg, camX, camY, performance.now(), sw.gust))) ctx.drawImage(fgImg, -camX, -camY);
            },
        });
    }

    // Ambient point-sprite decorations: fixed-layer records paint now (over
    // the map, under all entities); y-sorted props join `drawables` at their
    // decoded baseline so the player walks behind them.
    // (tickNativeStage already ran above, before the under-map effects pass.)
    if (!window.__hideProps) drawEffects(ctx, m.id, camX, camY, drawables, VIEW_W / ZOOM, VIEW_H / ZOOM);
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
            const playerFrameIdx =
                state.moving || state._cutTarget
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
            // The clip this frame's mode has latched, and the facing/direction it
            // plays it in — the two things a mode contributes. Null means the
            // ordinary field path, which keeps the character's own sprite.
            const latched = cl ? { clip: cl.clip, dir: cl.dirStr ?? "up-right" }
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
            const drawY = state.y - subLift;
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
            drawActorShadow(
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
                const poseT = cl ? cl.animT
                    : tkr ? tkr.pose.ticks * FIELD_TICK_SECONDS
                        : fp ? fp.poseT
                            : slp.frame * FIELD_TICK_SECONDS;
                const pack = playerPackForClip(latched.clip);
                const meta = playerPackMeta(pack);
                if (meta && state.npcImgs[pack]) {
                    const info = drawEntitySprite(
                        meta, state.npcImgs[pack], state.clipImgs[pack],
                        state.x, drawY, latched.dir, latched.clip, poseT, 0, false, 0,
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
                const dfRec = state.manifest.npcs?.find((n) => n.id === df.sprite);
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
            const info = drawEntitySprite(
                c, sheet, state.clipImgs[c.id], state.x, drawY,
                state.dir, playerClip,
                playerAnimTime, playerFrameIdx,
                state.moving || !!state._cutTarget, state._idleTime,
                state.moving ? FIELD_RUN_CLIP : FIELD_WALK_CLIP,
            );
            debugInfos.push({ x: state.x, y: state.y, label: "YOU", sprite: c.id, info });
    }
    drawables.push({ y: state.y, player: true, draw: drawPlayerActor });
    // EXPERIMENT (multiplayer): the other players in this stage, drawn as the player character at their own position, in the same depth order.
    if (sheet) {
        for (const g of multiplayerGhosts(m.id)) {
            drawables.push({
                y: g.y,
                draw: () => {
                    const gi = g.moving ? walkFrameIndex(timingForDir(c.frameDurations, g.dir), g.animTime) : 0;
                    drawActorShadow(g.x, g.y, PLAYER_ENTITY_KIND, undefined, 0, 0);
                    drawEntitySprite(c, sheet, state.clipImgs[c.id], g.x, g.y, g.dir, undefined, g.animTime, gi,
                        g.moving, 0, g.moving ? FIELD_RUN_CLIP : FIELD_WALK_CLIP);
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
            y: state.y + KICK_YSORT_BIAS[kick.facing],
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
        const out = [];
        const drawCount = activeFollowerCount();
        for (let i = 0; i < drawCount; i++) {
            const f = followers[i];
            if (f.parked) continue;
            const pc = followerChar(i);
            const ps = pc && state.charImgs[pc.id];
            if (!pc || !ps) continue;
            out.push({ i, f, pc, ps });
        }
        return out;
    }
    function drawPartyFollower({ i, f, pc, ps }) {
        if (window.__hideParty) return; // debug A/B switch, see drawPlayerActor
        const pdir = f.dir;
        const pStopping = !cutscene.isActive() && f.stopping;
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
            f.gathering || (!cutscene.isActive() && state.moving), f._idleTime,
            f.gathering || (!cutscene.isActive() && state.moving) ? FIELD_RUN_CLIP : FIELD_WALK_CLIP,
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
    const feetNow = [{ id: "leader", x: state.x, y: state.y, moving: !!(state.moving || state._cutTarget), dir: state.dir, leader: true }];
    window.__feet = feetNow;
    for (const it of partyFollowerDraws()) {
        feetNow.push({ id: "f" + feetNow.length, x: it.f.x, y: it.f.y, moving: feetNow[0].moving, dir: state.dir });
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
            const npcMeta =
                state.manifest.npcs.find((n) => n.id === npc.sprite) ??
                state.manifest.characters.find((c) => c.id === npc.sprite);
            const npcSheet =
                state.npcImgs[npc.sprite] ?? state.charImgs[npc.sprite];
            if (npcMeta && npcSheet) {
                const npcDir = npc.dir ?? "down";
                const npcAnimTime = npc._animTime ?? 0;
                const npcMoving = !!(npc.path || npc._cutTarget);
                const npcFrameIdx = npcMoving
                    ? walkFrameIndex(timingForDir(npcMeta.frameDurations ?? {}, npcDir), npcAnimTime)
                    : 0;
                feetNow.push({ id: "n" + npc.id, x: npc.x, y: npc.y, moving: npcMoving, dir: npcDir });
                drawables.push({
                    y: npc.y,
                    draw: () => {
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
                    },
                });
            }
        }
    }

    // The disc's own draw order, in one shared place: ascending key, larger key
    // in front, and equal keys with the EARLIER arrival on top (the queue's
    // flush calls the head-most first and each callback prepends into its
    // ordering-table bucket). `sortDrawables` (web/draw-order.js) is that rule.
    sortDrawables(drawables);
    // When the leader's bucket is behind the ground it was already painted in the
    // map band above, *before* the ground image; OT[8] is reached before OT[7]
    // and before every entity bucket, so the leader is behind the ground and
    // behind every other drawable. The list draws everything else. Its shadow
    // rides one bucket further back (OT[n+1]) and both are ONE drawable, so
    // neither is left in the list. The party rides the leader's bucket every
    // frame (F0x8008EAE8), so the follower drawables are painted in that same
    // band and skipped here with the leader.
    for (const d of drawables) if (!(playerUnderMap && (d.player || d.follower))) d.draw();
    for (const g of multiplayerGhosts(m.id)) drawGhostLabel(ctx, g, Math.round(g.x - camX), Math.round(balloonAnchorY(g.y - camY)));
    { const me = multiplayerSelf(); if (me) drawGhostLabel(ctx, me, Math.round(state.x - camX), Math.round(balloonAnchorY(state.y - camY))); }
    multiplayerTick(m.id, state);   // EXPERIMENT: sends where I am and glides the other players
    questsTick(m.id, state.x, state.y);   // EXPERIMENT: lets the optional quest layer notice a new stage and where you are
    // EXPERIMENT (ambience): weather and drifting particles fall over everything else.
    if (!window.__hideProps && !m.fixedViewportBackground) {
        const amb = ambienceFor(m, mapImg, camX, camY);
        if (amb) amb(ctx);
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
            if (!seen.has(key) && b.sound) sfx.play("fukidash");
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
    if (!textbox.isOpen() && !choice.isOpen() && fade.dir === 0 && !cutscene.isActive() && !battle.isActive() && !state.menuOpen && fieldcomReady()) {
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
    if (!textbox.isOpen() && fade.dir === 0 && !cutscene.isActive() && fieldcomReady()
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
        if (indKey != null && indKey !== state._indicatorKey) sfx.play("fukidash");
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
    if (resultBubble && fieldcomReady() && !LEGACY_FISH_BUBBLE) {
        const { openFrames, closeFrames } = resultBubbleFrames(resultBubble);
        // `false` means the actor has finished its close (stage 3): it is not
        // deleted, it just draws nothing, so the walker drops it too.
        if (!drawStoryBubble(
            ctx,
            Math.round(state.x - camX),
            Math.round(balloonAnchorY(state.y - camY, state.submarimon)),
            RESULT_BUBBLE_ROW, openFrames, closeFrames, fieldcomTick(),
        )) state.fishing.result = null;
    } else if (resultBubble && fieldcomReady()) {
        // `?legacyFishBubble=1` — the walker's old single static balloon.
        drawIndicatorBubble(
            ctx,
            Math.round(state.x - camX),
            Math.round(balloonAnchorY(state.y - camY, state.submarimon)),
            FC_KIND.smoke,
            fieldcomTick(),
        );
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
    const orbScreenId = screenIdForStage(fieldScreenTable, currentMap().id);
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
                ctx.fillStyle = "rgba(120,200,255,0.6)";
                ctx.beginPath();
                ctx.arc(lx, ly, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#002";
                ctx.font = "10px monospace";
                ctx.textAlign = "center";
                ctx.fillText(glyph, lx, ly + 3);
                ctx.textAlign = "left";
            }
        }
    }

    drawFishing(ctx, camX, camY);
    drawTreeRadar(ctx);
    drawDiveTransition(ctx, camX, camY);

    editor.drawOverlay(ctx);
    if (editor.enabled) sceneEd.drawOverlay(ctx);
    ctx.restore();

    // Over the field, under everything the player can interact with.
    placeCard.draw(ctx, VIEW_W, VIEW_H);

    textbox.draw(ctx, VIEW_W, VIEW_H);
    choice.draw(ctx, VIEW_W, VIEW_H);
    if (state.nameEntry) {
        // The naming screen holds the name until it has finished going dark
        // (SCREEN-OBJECT-NAME-AUDIT-001, thirty frames). The native adapter
        // ticks the screen here, because its pad comes from state.keys.
        if (!USE_NATIVE_NAME) state.nameEntry.advance?.(1);
        if (USE_NATIVE_NAME) state.nameEntry.draw?.(ctx, VIEW_W, VIEW_H);
        else drawNameEntry(ctx, state.nameEntry, VIEW_W, VIEW_H);
        if (state.nameEntry.isDone() && state.nameEntryDone) state.nameEntryDone();
    }
    if (state.packSelect) {
        if (USE_NATIVE_PACK) state.packSelect.draw?.(ctx, VIEW_W, VIEW_H);
        else drawPackSelect(ctx, state.packSelect, VIEW_W, VIEW_H);
    }
    if (state.endScreen) {
        if (USE_LEGACY_END) drawEndScreen(ctx, state.endScreen, VIEW_W, VIEW_H);
        else state.endScreen.draw(ctx, VIEW_W, VIEW_H);
    }
    if (state.titleScreen) drawTitleScreen(ctx, state.titleScreen, VIEW_W, VIEW_H);

    if (inn.isOpen()) inn.draw(ctx, VIEW_W, VIEW_H);
    if (shop.isOpen()) shop.draw(ctx, VIEW_W, VIEW_H, state);
    if (driMenu.isOpen()) driMenu.draw(ctx, VIEW_W, VIEW_H);
    if (dialogueBox.isOpen()) dialogueBox.draw(ctx, VIEW_W, VIEW_H);
    if (chatBox.isOpen()) chatBox.draw(ctx, VIEW_W, VIEW_H);
    for (const b of mpBalloons.values()) if (b.box.isOpen()) b.box.draw(ctx, VIEW_W, VIEW_H);
    if (yesNoWindowUp()) yesNoBox.draw(ctx, VIEW_W, VIEW_H);
    if (helpMenuWindowUp()) helpMenuBox.draw(ctx, VIEW_W, VIEW_H);
    if (gym.isOpen()) gym.draw(ctx, VIEW_W, VIEW_H, state);
    if (cardShop.isOpen()) cardShop.draw(ctx, VIEW_W, VIEW_H, state);
    if (cardAlbum.isOpen()) cardAlbum.draw(ctx, VIEW_W, VIEW_H, state);
    if (cardDeck.isOpen()) cardDeck.draw(ctx, VIEW_W, VIEW_H, state);
    if (cardDuel.isOpen()) cardDuel.draw(ctx, VIEW_W, VIEW_H, state);
    if (saveScreen.isOpen()) saveScreen.draw(ctx, VIEW_W, VIEW_H, state);
    if (fightReport.isOpen()) {
        // The native results screen is a framebuffer takeover (the original
        // switches the display environment); clear the field behind it.
        if (USE_NATIVE_REPORT) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.restore();
        }
        fightReport.draw(ctx, VIEW_W, VIEW_H);
    }
    if (status?.isOpen()) status.draw(ctx, VIEW_W, VIEW_H);
    else if (state.menuOpen) menu.draw(ctx, VIEW_W, VIEW_H, state);
    if (battle.isActive()) battle.draw();
    // The field movie takes the whole screen (its draw fills black first), the
    // same way the original's movie screen owns the display while it plays.
    if (fieldMovie.isOpen()) fieldMovie.draw(ctx, VIEW_W, VIEW_H);
    // Drawn last so the debug overlay sits on top of everything, including the battle HUD.
    debugPanel.drawOverlay(ctx, VIEW_W, VIEW_H, state);
    stagslctMenu.draw(ctx, VIEW_W, VIEW_H);
    if (USE_NATIVE_CNTYSEL) cntyselNative.draw(ctx, VIEW_W, VIEW_H);
    else cntyselMenu.draw(ctx, VIEW_W, VIEW_H);
    sceneSkip.drawOverlay(ctx, VIEW_W, VIEW_H);

    if (fade.alpha > 0) {
        drawTransitionWipe(ctx, camX, camY);
    }
    // The A28 checkerboard handoff draws over the field while it runs, whatever
    // the A27 fade's alpha is.
    if (state.wipe28) drawCheckerboardWipe(ctx);
    // Debug-only: leave a full-frame copy of this completed render so a verifier
    // can diff two frames WITHOUT a screenshot round-trip or a mid-frame canvas
    // read (window.__frameCopy / __frameCopySeq).
    if (window.__frameCopy) {
        const fc = window.__frameCopy;
        if (fc.width !== ctx.canvas.width || fc.height !== ctx.canvas.height) {
            fc.width = ctx.canvas.width; fc.height = ctx.canvas.height;
        }
        fc.getContext("2d").drawImage(ctx.canvas, 0, 0);
        window.__frameCopySeq = (window.__frameCopySeq || 0) + 1;
    }
}

// ── Dev toolset surface (web/devtools.html, tools/verify_devtools.mjs) ────────
// INTERNAL TOOLING. It composes the SAME functions the ordinary routes use
// (loadAndSetMap, battle.start/startScreen, playStoryEvent, applyStoryFlag) so
// the devtoolset never keeps a second copy of game logic and every jump, scene
// or battle it starts behaves exactly as the ordinary route does. It is NOT a
// player-facing screen and deliberately does NOT reproduce the retail disc's
// leftover debug screens (the stage-select launcher, the sound test, the
// shock/rumble test and the battle scene test): those are research tools we read
// on the rig but do not ship. See docs/workflow/devtools.md.
function devSnapshot() {
    const map = state.manifest?.maps?.[state.mapIdx] ?? null;
    const party = Array.isArray(state.party) ? state.party : [];
    const stats = Array.isArray(state.partyStats) ? state.partyStats : [];
    const members = party.map((charId, i) => {
        const ch = (state.manifest?.characters ?? []).find((c) => c.id === charId);
        const s = stats[i];
        return {
            slot: i, charId, name: ch?.name ?? charId,
            formId: s?.digimonId ?? null, level: s?.level ?? null,
            hp: s?.hp ?? null, maxHp: s?.maxHp ?? null,
            mp: s?.mp ?? null, maxMp: s?.maxMp ?? null,
        };
    });
    return {
        map: map?.id ?? null,
        mapName: map?.name ?? null,
        x: Math.round(state.x), y: Math.round(state.y),
        chapter: state.chapter ?? null,
        ordinal: Number(state.progressOrdinal ?? 0) || 0,
        party: members,
        battle: battle?.isActive?.() ? battle.peek?.() ?? null : null,
        assetMode: document.documentElement.dataset.assetMode ?? null,
    };
}

window.__dev = {
    // Jump to a stage by manifest id ("s200") or index, optionally at a pixel.
    // Runs the game's own loadAndSetMap so the arrival is the ordinary one.
    jump: (mapIdOrIndex, x = null, y = null) => {
        const maps = state.manifest?.maps ?? [];
        const idx = typeof mapIdOrIndex === "number"
            ? mapIdOrIndex
            : maps.findIndex((m) => m.id === String(mapIdOrIndex));
        if (idx < 0 || idx >= maps.length) return false;
        loadAndSetMap(idx, x != null && y != null ? { x, y } : null);
        if (x != null && y != null) { state.x = x; state.y = y; }
        return true;
    },
    // Start a battle with any enemy id from data/enemies.json, through the SAME
    // battle.start the field handoff and the battle lab use.
    startBattle: (opts = {}) => battle.start({
        enemyId: opts.enemyId,
        enemyLevel: opts.enemyLevel ?? 5,
        party: opts.party ?? null,
        screenId: opts.screenId ?? null,
        mapId: opts.mapId ?? currentMap().id,
        onWin: opts.onWin ?? null,
        onFlee: opts.onFlee ?? null,
        onLose: opts.onLose ?? null,
    }),
    // Start a battle from a global scripted screen id (field_encounters.json).
    startScreenBattle: (screenId, opts = {}) => battle.startScreen(
        Number(screenId), opts.onWin ?? null, opts.onFlee ?? null, opts.onLose ?? null,
        { mapId: opts.mapId ?? currentMap().id },
    ),
    // Play one stage event directly through the walker's own cutscene path.
    // Events normally fire from a controller (step VM / talk launcher / flag);
    // this bypasses the gate and plays the script, which is what a tester wants.
    // Loads the event's own stage first when the player is elsewhere.
    playEvent: async (mapId, eventId) => {
        if (mapId && currentMap().id !== mapId) {
            const idx = state.manifest.maps.findIndex((m) => m.id === mapId);
            if (idx < 0) return false;
            await loadAndSetMap(idx);
        }
        const ev = (state.wstag[currentMap().id] || []).find((e) => Number(e.id) === Number(eventId));
        if (!ev) return false;
        playStoryEvent(ev, () => {});
        return true;
    },
    // Set a story flag through the real set_flag path (banked commands included).
    setFlag: (id, val = true) => { applyStoryFlag(Number(id), val ? 1 : 0); return true; },
    snapshot: () => devSnapshot(),
    get battle() { return battle; },
    get renderer() { return window.__battle3d ?? null; },
};

init().catch((err) => {
    document.getElementById("loading").textContent = "Error: " + err.message;
});
