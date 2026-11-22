import "./extra-roster.js";   // first: it wraps fetch so digimon.json / evolutions.json carry the extra species
import { bindCardInventory } from "./cardstate.js";
import { WIPE_H, WIPE_CLOSE_FRAMES, checkerboardQuads } from "./stage-wipe.js";
import { installMount } from "./mount.js"; // quest-unlocked mounts (OPTIONS -> Mount, on at the start; R or pad Select rides)
import { openCutContent } from "./cut-content.js"; // EXPERIMENT: F2 -> Extras -> Cut-content gallery (dev; off by default)
import { openBlastLadder } from "./blast-ladder.js"; // EXPERIMENT: F2 -> Extras -> Blast ladder (new; off by default)
import { tickPlanner, openPlanner, plannerPress, plannerOpen, plannerRowsNow, plannerCursor, plannerSelection } from "./evolution-planner.js"; // EXPERIMENT: F2 -> Extras -> Next forms planner (new; off by default)
import { openDamageLab } from "./damage-lab.js"; // EXPERIMENT: F2 -> Extras -> Damage Lab (new; off by default)
import { openReplay, replayPress, replayTake, replayOpen, replayView } from "./replay-theatre.js"; // EXPERIMENT: F2 -> Extras -> Replay theatre (new; off by default)
import { areaOf } from "./fishing-extras.js"; // fishing: rare extra rewards on top of a won catch (data/authored/web/assets/data/fishing_extras.json)
import { underwaterInfo } from "./fishing-underwater.js"; // fishing: a 3D underwater inset while the line is in the water (reads state.fishing only)
import type { Closeable, DevBattleOptions, StoryEvent, TransitionQuadScreen } from "./game/types.js";

import { installFxPanel, ambienceSceneState, isOpenAirMapName } from "./ambience.js";
import { loadTileIndex } from "./map-tiles.js";
import { installPost2d } from "./post2d.js";
import { questFxClear, installQuestFxPlayerDrive, installQuestFxCanvas, questFxState, questFxFadeAlpha, questFxDriveState, questFxShakeOffset, questFxShakeState } from "./quest-fx.js";
// The `ghost` scene step (a character drawn faded and tinted) and the camera rule for `drop`/`rise`.
import { questGhostClear, questGhostState, questGhostMap, installQuestGhostCamera, installQuestGhostGate } from "./quest-ghost.js";
import { installQuests, questDone } from "./quests.js";
import { installMultiplayer, isOnline, sendChat, mpOn, myId, myName, peerOf, sendMpb } from "./multiplayer.js"; // EXPERIMENT: optional multiplayer (F4)
import { questsCreditChallenge } from "./quests.js";
import { installSocial, socialQuestDone, coopTry } from "./mpsocial.js";
import { installMpBattle, mpbMessage, mpbPeerGone, mpbPeerAway, mpbPeerBack, mpbLinkLost, mpbLinkBack, mpbVisible } from "./mpbattle.js"; // EXPERIMENT: many-vs-many fights for multiplayer // EXPERIMENT: multiplayer chat, feed, inspect, trade
import { installChat } from "./chat.js";
import { ASSET_MODE_HD, assetMode, hideAssetModeChooser, installAssetCanvasDrawing, showAssetModeChooser } from "./assets.js";
import { installPixelFilter } from "./gpu-pixel-filter.js";
import { scriptIsStaged } from "./field-view.js";
// All gameplay-logic helpers come from the bundled TS engine (web/vendor/engine.js) — the
// single source of truth. The former web/{scene,cutscene,screen-routing,dialogue,items}.js
// duplicates were deleted.
import { nearestFacingNpc, talkCandidates, resolveConfirmTarget, pickDialogue, pickDialogueState, chapterNpcs, deriveChapter, storeAddItem, storeRemoveItem, heldCount, listItemIds, carriesFolderBag, wornCount, syncWornFromEquipment, setHeldCount, useItem, ITEM_BY_ID, ITEM_BY_NAME, FISHING_POLE_FLAG, POSE_SPRITE, KICK_POSE_SPRITE, copyPlacePoints, castPlayerId, castActorRecords, isInnLauncherIndex, setPadLanguage, FINALE_WIN_ENDING_MOVIE, battleHandoff } from "./vendor/engine.js";
import { partyCharisma } from "./charisma.js";
import { fieldPartySize } from "./party.js";
import { createTitleScreen } from "./titlescreen.js";
import { drawGroundShadow } from "./fieldcom.js";
import { launchPads, setLaunchPadsEnabled, launchPadDebug, stingerPopupProbe, streetGlowProbe, setPointRecordActorSound, setPointRecordActorMusic, setPointRecordOrdinal, setPointRecordAnchor, setPointRecordFlag, scrollLayerEntries, pointRecordActors, pointSpriteProbe } from "./effects.js";
import { fireStageObject, fireNativeStageObject, stageObjectDraws, streetScreenQuads, clearStageObjects, annotatorActive, annotatorMarkers, setAnnotatorRandom, setStageObjectSound, setStageObjectOrdinal, stageObjectState, stageAmbienceDiagnostics, STAGE_AMBIENCE_EXECUTION } from "./stage-objects.js";
import { fieldCharAddY, fieldCharState } from "./vendor/engine.js";
import { nativeScreenRead, nativeScreenWrite } from "./native-screen.js";
import { nativeScreenObjects } from "./native-screen.js";
import { nativeTextWidgets } from "./native-screen.js";
import { encodeNativeScreenText } from "./native-screen.js";
import { decodeNativeText } from "./native-screen-text.js";
import { bindCardShopInventory } from "./cardshop-translated.js";
import { loadCatalog, loadStarter, ensureStarterFolder, cards, persistCollection, catalog as cardCatalog } from "./cardstate.js";
import { buildFightReportPages } from "./battle.js";
import { restoreWindowFill } from "./fullscreen.js";
import type { BattleState } from './types/battle.js';
import type { BlockEngagement } from "../engine/systems/block-actor.js";

restoreWindowFill(document);
import { loadPlaceCardTranslated } from "./placecard-translated.js";
import { asButton } from "./input.js";
import { watchBag } from "./item-log.js";   // owned / seen ITEMS for GLOSSARY, same store as the species log
import { installSpeciesLog } from "./species-log.js";   // Met / Defeated counter for GLOSSARY, records always (no switch)
import { on as onGameEvent } from "./gameEvents.js";
import { FLY_QUEST, flyCopyFor } from "./fly-points.js";
import {
  HD_MAPS,
  PACKED_JINGLES,
  PAUSE_PAGE_ENTRIES,
  VIEW_H,
  VIEW_W,
  ZOOM,
  backToCardFolders,
  battle,
  bgm,
  books,
  cardAlbum,
  cardDeck,
  cardDuel,
  cardDuelNative,
  cardShop,
  cardShopTranslated,
  chatBox,
  choice,
  cntyselNative,
  ctx,
  currentFlyPlaces,
  cutscene,
  debugPanel,
  dialogueBox,
  driMenu,
  endCard,
  fade,
  fallbackTextbox,
  fieldCanvasResolution,
  fieldMovie,
  fightReport,
  fightReportNative,
  flyFree,
  followers,
  gamepad,
  glossaryStage,
  gym,
  helpMenuBox,
  inn,
  itemLog,
  labCam,
  lastCam,
  menu,
  mpIdle,
  nameEntryNative,
  packSelectNative,
  pauseHome,
  placeCard,
  rand16,
  readyStageIds,
  retainedSpriteIds,
  retainedStageIds,
  saveScreen,
  saveScreenNative,
  sceneEd,
  sceneSkip,
  sfx,
  shop,
  shopTranslated,
  soundTest,
  speciesLog,
  state,
  status,
  storyFlags,
  textbox,
  viewCam,
  wideField,
  yesNoBox,
} from "./game/vars.js";
import { currentMap, saveFieldLocation } from "./game/session.js";
import {
  flyTo,
  openCardShopFolder,
  openFightReport,
  openMemoryCard,
  openNativeReport,
  openPackSelect,
  playEndingChain,
} from "./game/ui-openers.js";
import {
  mpbLaunch,
  mpbPractice,
  startFieldBattle,
  startQuestBattle,
  triggerRandomEncounter,
} from "./game/battle-launch.js";
import { chatSay, mpBalloonSay, mpCard, warpToMap } from "./game/mp-chat.js";
import { playQuestScene, questSpeak, sceneCast } from "./game/quest-scenes.js";
import { boxStuck, fishingSpotHere, startFishingCast } from "./game/fishing-tree.js";
import {
  activeFollowerCount,
  noteOwnedSpecies,
  placeFollowersAt,
  plannerPartyMembers,
  resetFollowers,
} from "./game/followers.js";
import { S } from "./game/state.js";
import { applyStoryFlag, engineFlagSeen, grantNewPartners, loadAndSetMap } from "./game/map-load.js";
import { pickDialogueFor } from "./game/field-steps.js";
import { fieldcomTick } from "./game/field-fx.js";
import { checkStageCutscene, openNameEntry, playStoryEvent } from "./game/story-events.js";
import {
  auctionScriptRow,
  replayFieldFree,
  replayRowsNow,
  replayScene,
  runAuctionArrival,
} from "./game/auction-replay.js";
import { dispatchInput } from "./game/input.js";
import { padLoop } from "./game/update.js";
import { devSnapshot } from "./game/draw-sprites.js";
import { init } from "./game/init.js";   // FLY row: quest zz_fly, visited towns only
// The shapes this file reads off the untyped stores (state.manifest, scene casts, saved party stats, the shop file).
interface ManifestMap { id: string; name?: string; }
interface CastNpc { npc_id: number; sprite: string; x: number; y: number; slot: number; n: number; cutsceneOnly?: boolean; }
interface FormLedgerEntry { id: number | string; }
interface ShopRow { id?: number; }
interface FishingSpot { dx: number; dy: number; }
interface MpbSnapshot { lead: string; party: string; bits: number; }
interface MpbJoinSetup { ch?: number[]; }
interface MpbJoinResult { won?: boolean; fled?: boolean; }
interface Point { x: number; y: number; }
window.__bgm = bgm;
window.__sfx = sfx;
bgm.setVolume!(window.__fx?.musicVolume);       // OPTIONS volumes (web/volume-levels.js): 1 = the game's own gain
sfx.setVolume!(window.__fx?.soundVolume);
window.__glossaryStage = glossaryStage;      // dev hook for the screenshot tools (like window.__books)
window.__books = books;
installFxPanel(document.getElementById("stage"));
if (HD_MAPS) loadTileIndex();
// F2 Pixel filter (default off): EPX / MMPX / xBR. Authentic: the whole finished frame; HD Remaster:
// each native image (sprites, effects, menus) before it is drawn (gpu-pixel-filter.js)
installPixelFilter(document.getElementById("stage"), document.getElementById("game"), () => assetMode() === ASSET_MODE_HD);
installPost2d(document.getElementById("stage"), document.getElementById("game"));
installMultiplayer({ stageEl: document.getElementById("stage"), defaultName: () => state.playerName || "Tamer" });
// EXPERIMENT (multiplayer): the many-vs-many fight screen and what it needs from the game.
installMpBattle({
    stageEl: document.getElementById("stage"),
    getKit: () => battle.mpKit(),
    sfx, bgm, mapId: () => currentMap()?.id ?? null, languageByte: () => state.languageByte,
    openReport: (b: BattleState, onClose: () => void) => openNativeReport(b, onClose),
    myId: () => myId() ?? 1, myName: () => myName() || state.playerName || "Tamer",
    practice: (o: Parameters<typeof mpbPractice>[0]) => mpbPractice(o),
    nameOf: (id: number) => peerOf(id)?.name ?? myName(),
    send: (ids: number[], d: unknown) => sendMpb(ids, d),
    releaseKeys: () => state.keys.clear(),
    snapshot: () => ({ lead: JSON.stringify(state.partnerStats), party: JSON.stringify(state.partyStats ?? null), bits: state.bits! | 0 }),
    restore: (sn: MpbSnapshot) => {
        state.partnerStats = JSON.parse(sn.lead); state.partyStats = JSON.parse(sn.party); state.bits = sn.bits;
        localStorage.setItem("partnerStats", sn.lead); localStorage.setItem("partyStats", sn.party); localStorage.setItem("bits", String(sn.bits));
    },
    canJoin: () => mpIdle() && fieldPartySize(state.party) > 0,
    // a friend's quest challenge that I join counts for my own quest too
    joinDone: (setup: MpbJoinSetup) => (r: MpbJoinResult) => { if (r.won && !r.fled && setup.ch?.length) questsCreditChallenge(setup.ch); },
});

installSocial({
    // ETS item 9: the page always has the #stage element
    stageEl: document.getElementById("stage")!,
    api: {
        card: mpCard,
        currentMapId: () => state.manifest?.maps?.[state.mapIdx]?.id ?? null,
        mapName: (id) => state.manifest?.maps?.find((m: ManifestMap) => m.id === id)?.name ?? null,
        busy: () => !!state.started && (battle.isActive() || cutscene.isActive() || fade.dir !== 0 || mpbVisible()),
        releaseKeys: () => state.keys.clear(),
        // "Go to the other player" (web/mpsocial.js, web/mp-goto.js): where I stand, whether I may be moved now, and the move itself.
        where: () => ({ map: state.manifest?.maps?.[state.mapIdx]?.id ?? null, x: Math.round(state.x), y: Math.round(state.y), dir: state.dir }),
        canGo: () => mpIdle() && !mpbVisible(),
        // Warp me next to (x, y) on `mapId` through the ordinary stage change (runStageHandoff: the same wipe and load as an exit;
        // setMap then gathers my followers on me). The spot comes from pickSpotNear on that map's own collision grid, so never a wall.
        // Resolves "ok", "busy", "nomap" or "noroom".
        warpNear: (mapId, x, y) => warpToMap(mapId, x, y, () => mpIdle() && !mpbVisible()),
        bits: () => state.bits! | 0,
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
        startDuel: (card, cb: (a0: { won: boolean; hp: number; }) => void) => {
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
            const finish = (won: boolean) => {
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
            const giveBits = Math.min(gives?.bits | 0, state.bits! | 0);
            for (const it of gets?.items ?? []) {
                if (ITEM_BY_ID[it.id] && it.qty >= 1 && it.qty <= 99) storeAddItem(state, it.id, it.qty);
            }
            state.bits = Math.min((state.bits! | 0) - giveBits + Math.max(0, Math.min(gets?.bits | 0, 9999999)), 9999999);
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
    npcsHere: () => { const sc = state.scenes[currentMap()?.id]; return sc ? sceneCast(sc).filter((n: CastNpc) => !n.cutsceneOnly).map((n: CastNpc) => n.npc_id) : []; },
    // Speech goes through the game's own conversation box (translated, same balloon and font as a real NPC); the list and
    // the yes/no questions are the game's choice widget. Both resolve when the player is done.
    speak: (npcId: number | null, name: string, text: string) => questSpeak(npcId, name, text),
    scene: (steps: Parameters<typeof playQuestScene>[0]) => playQuestScene(steps),
    countItem: (name) => { const it = ITEM_BY_NAME?.[name]; return it ? heldCount(state, it.id) : 0; },
    takeItem: (name, n) => {
        const it = ITEM_BY_NAME?.[name];
        if (!it) return false;
        storeRemoveItem(state, it.id, Math.min(n, heldCount(state, it.id)));
        localStorage.setItem("inventory", JSON.stringify(state.inventory));
        return true;
    },
    ownsForm: (id) => [state.partnerStats, ...(Array.isArray(state.partyStats) ? state.partyStats : [])].some((p) => p?.formLedger?.some((f: FormLedgerEntry) => Number(f.id) === id)),
    ask: (prompt, options) => new Promise((resolve) => choice.open!(prompt, options, resolve)),
    onDone: (title) => socialQuestDone(title),
    idle: () =>
        !battle.isActive() && !cutscene.isActive() && !textbox.isOpen!() && !choice.isOpen!() && !state.menuOpen && fade.dir === 0 && !state.diveDemo && !state.wipe28,
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
installSpeciesLog({ on: onGameEvent, log: speciesLog });   // listens to battleStarted / battleWon, same event bus as the quests
if (!window.__dwInstalled && /[?&]questlab=1\b/.test(location.search)) import("./quest-lab.js");   // test panel for the extra quests

// Mounts: the game-side hooks the ride needs. The mount layer itself is web/mount.js; it rides once the "Mount" switch is
// on (it is at the start), a quest unlocked a mount (the quest layer's own done state, never a story flag) and the
// player's own DW2 models are installed (`hasModel`). `canStand` is this file's own foot-box test, so a dismount spot is the game's walkable ground.
installMount({
    groundShadow: (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number) => drawGroundShadow(c, x, y, w, h, alpha),
    state: () => state,
    enabled: () => window.__fx?.mount === true,
    hasModel: (url: string) => fetch(url, { method: "HEAD", cache: "no-store" }).then((r) => r.ok).catch(() => false),
    questDone: (id: string) => questDone(id),
    canStand: (x: number, y: number) => {
        const grid = state.collision[currentMap()?.id];
        return !!grid && !boxStuck(grid, x, y)
            && x >= 12 && y >= 8 && x <= currentMap().width - 12 && y <= currentMap().height - 8;
    },
    resetFollowers: () => resetFollowers(),
    placeFollowers: (spots: Point[]) => placeFollowersAt(spots),
    sfx: (id: string) => sfx.play!(id),
    // no riding indoors: the same open-air / indoor split the ambience layer uses (web/ambience.js isOpenAirMapName)
    indoor: () => { const n = currentMap()?.name; return !!n && !isOpenAirMapName(n); },
    say: (text: string) => { questSpeak(null, "", text); },
    fieldReady: () => !battle.isActive() && !cutscene.isActive() && !textbox.isOpen!() && !choice.isOpen!()
        && !state.menuOpen && fade.dir === 0 && !state.diveDemo && !state.wipe28 && !state.nameEntry
        && !state.climb && !state.fishing && !state.slope && !state.submarimon && !state.diveForm
        && !state._questScene,
    // anything that takes the field away sends the player off first (the map change and the ladder call
    // mountForceDismount themselves; this catches the rest: a fight, a scene, a menu, a fade, a save load)
    mustDismount: () => battle.isActive() || cutscene.isActive() || state.menuOpen || fade.dir !== 0
        || state.wipe28 || state.diveDemo || textbox.isOpen!() || choice.isOpen!() || !!state.climb
        || !!state.fishing || !!state.slope || !!state.submarimon || !!state.diveForm,
});

// Type-to-chat: T opens a line box, Enter shows it as a speech bubble over the player.
installChat({
    stage: document.getElementById("stage"),
    canOpen: () => state.started && !state.nameEntry && !textbox.isOpen!() && !cutscene.isActive()
        && !battle.isActive() && fade.dir === 0,
    releaseKeys: () => state.keys.clear(),
    onSend: (text: string): void => (isOnline() ? sendChat(text) : chatSay(text)),   // in a room the line goes to everyone and shows over every head
    bubbleOpen: () => chatBox.isOpen!(),
    dismiss: () => { chatBox.pressConfirm!(); S.chatShownAt = performance.now() / 1000; S.chatPresses++; },
});
 mpOn((type, d) => { if (type === "chat") mpBalloonSay(d.id, d.name, d.text); });
window.__fade = fade;

                      installAssetCanvasDrawing();
ctx!.imageSmoothingEnabled = false;
// Extra quests: the scene effects draw through this context (web/quest-fx.js), and a `drop` drives the field character
// through the engine's own +0x54 writer, so the room scrolls exactly as it does in s680's floor collapse.
installQuestFxCanvas(ctx);
installQuestFxPlayerDrive(fieldCharAddY);
// Extra quests: a `drop`/`rise` is watched from the player. The host action is the field camera's own "follow the
// player" state -- release any fixed FN6B pan point and clear the eased cutscene camera (web/quest-ghost.js).
installQuestGhostCamera(() => {
    cutscene.camera = null;
    viewCam.x = state.x;
    viewCam.y = state.y;
    viewCam.active = false;
});
// ... and with F2 -> Extras -> Quests off, no actor is drawn as a ghost (a step running at that moment comes off the next
// frame drawn), exactly as the effect art and the scene sky are the quest layer's to clear.
installQuestGhostGate(() => window.__fx?.quests !== false);
window.__fieldCanvasResolution = fieldCanvasResolution;

window.__lastCam = lastCam; // verifiers read the player-on-screen position from here
window.__billboardDraws = () => S.billboardDraws;
window.__dialogueBox = dialogueBox;
window.__yesNoBox = yesNoBox;
window.__helpMenu = helpMenuBox;
window.__choice = choice;   // checks: whether a list / yes-no question is up
// CARD FOLDERS on the status menu (esstatus string 11) — the entry that makes
// the Album and the folder editor reachable in normal play. Before this they
// opened only from the debug lab. The entry is gated the way the game gates it:
// it appears once the player actually holds cards, which is what Divermon's
// folder grant on the Yellow Cruiser does.
// The collection is { owned: Map, folders: [], ... } — NOT an array. Gate on
// holding a folder, which is what Divermon's grant on the Yellow Cruiser gives.
// The pause home's STATUS entry hands over to the translated pause page. Keys
// are not double-handled: the page owns the pad while it is open.
menu.nativeOpen = () => !!status?.isOpen!();
// The Demo Setup screen has no place on the disc's pause list (nothing writes
// the row), so it is a debug-only extra and its Back has no original answer.
// It returns to the same one list every other route returns to.
menu.backToHome = pauseHome;
menu.onNativePage = (label) => {
    const entry = PAUSE_PAGE_ENTRIES.get(label);
    if (!status || !entry) return false;
    status.open!(state, entry, () => { menu.screen = "home"; });
    return true;
};
// The same flag store answers web/menu.js's MAP pane markers.
menu.mapSeen = engineFlagSeen;
// The same gate as the translated page's seed: the resident byte D0x80048f42 is
// carried[402], the Folder Bag (UI-CARD-FOLDERS-GATE-IS-FOLDER-BAG-ITEM-2026-10-14).
menu.cardFolderUnlocked = () => carriesFolderBag(state);
menu.onCardAlbum = () => { state.menuOpen = false; cardAlbum.open!(backToCardFolders); };
menu.onCardDeck = () => { state.menuOpen = false; cardDeck.open!(backToCardFolders); };
// Dev / test hooks (nothing in the game reads these): window.__fly.places() lists what the book shows, .go(id) flies there.
window.__fly = { places: () => currentFlyPlaces(), copy: (id: string) => flyCopyFor({ maps: state.manifest?.maps ?? [], scenes: state.scenes, currentId: currentMap()?.id, id }), go: (id: string) => flyTo(id), free: () => flyFree(), unlocked: () => questDone(FLY_QUEST) };
// Dev hook for the screenshot tools: open a book straight from the field, only while its dev switch is on.
window.__openMapScreen = () => !!(state.started && !state.menuOpen && !books.isOpen() && books.open("mapscreen", null, state.keys));
window.__openBook = (name) => !!(window.__fx?.[name] === true && state.started && !state.menuOpen && !books.isOpen() && books.open(name, null, state.keys));
// East Sector - Duel Island, the card-duel venue (docs/research/story-
// progression/GAME_WALKTHROUGH.md).
Promise.all([loadCatalog(), loadStarter()]).then(() => { ensureStarterFolder(); persistCollection(); });
battle.setFieldMovieHandoff(async () => {
    const handoff = battleHandoff(state.progressOrdinal);
    if (!handoff.movie) return; // not ordinal 43: straight to the battle
    await new Promise<void>((resolve) => {
        S.fieldMovieDone = resolve;
        fieldMovie.open(handoff.selector).then((row) => {
            if (!row) { S.fieldMovieDone = null; resolve(); } // unknown code: never strand the fight
        });
    });
});
window.__fieldMovie = () => fieldMovie.diagnostics();

battle.setEndingHandoff({
    play: (b: BattleState) => {
        playEndingChain(b._winLaunchCode ?? FINALE_WIN_ENDING_MOVIE)
            .catch((error) => console.error("[battle] ending chain", error))
            .then(() => battle.finishEnding());
        return true;
    },
});

battle.setReportHandoff({ open: (b: BattleState) => openNativeReport(b, () => { battle.finishNativeReport(); }) });

window.__sceneSkip = sceneSkip;
window.__textbox = textbox;
window.__fallbackTextbox = fallbackTextbox; // checks: which box holds the line
window.__menu = menu;
window.__status = status;
window.__cardAlbum = cardAlbum;
window.__cardShop = cardShop;
window.__cardShopTranslated = cardShopTranslated;
window.__cardDuelNative = cardDuelNative; // native card duel (pro/cardgame)
window.__nameEntryNative = nameEntryNative; // native naming screen (pro/stdgname)
window.__cntyselNative = cntyselNative; // native boot country/language screen (pro/cnty_sel)
window.__packSelectNative = packSelectNative; // native starter-pack wizard (pro/stplnmet)
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
window.__saveNative = saveScreenNative; // native save/load screen (pro/stgmcard)
window.__dri = driMenu;
window.__battle = battle;
window.__gym = gym;
window.__inn = inn;
window.__debug = debugPanel; // partner debug editor (toggle with `~`)
// Expose item tables for battle.js (drop system + in-battle item use)
window.__ITEM_BY_ID = ITEM_BY_ID;
window.__ITEM_BY_NAME = ITEM_BY_NAME;

window.__sceneEd = sceneEd;

// The saved worn array is the wearer record's own multiset, so a save that
// predates it (or one whose equipment was edited outside the store) is repaired
// here rather than showing "Equip 0" beside gear somebody is wearing. On any save
// the four wear paths kept in step this recomputes the same bytes.
syncWornFromEquipment(state);
bindCardInventory(state);

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
setInterval(noteOwnedSpecies, 3000);
// Console aid: __planner.rows() is the selected partner's list; __planner.press("down") drives the page.
window.__planner = {
    open: () => plannerOpen(),
    rows: () => plannerRowsNow(),
    cursor: () => plannerCursor(),
    selection: () => plannerSelection(),
    members: () => plannerPartyMembers(),
    press: (button: unknown) => plannerPress(String(button)),
};
// The `ghost` step's live actors, on the state itself: `_questGhosts` is a Map of actor -> { alpha, tint } (empty when
// nothing is ghosted). A verifier reads its keys; web/quest-ghost.js empties it in place on every scene exit.
state._questGhosts = questGhostMap();
bindCardShopInventory(state).catch((error) => console.error("Card pack inventory data failed", error));

watchBag(state, itemLog);   // every slot that enters state.inventory (storeAddItem, drops, steal, shop, gifts, quests) is logged as owned; the bag now counts too
Object.defineProperty(state, "languageByte", {
    get: () => S.languageByte,
    set: (value) => {
        S.languageByte = value;
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
    const visible = cast.filter((n: CastNpc) => !n.cutsceneOnly);
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
window.__blockActors = () => {
    const shape = (ix: BlockEngagement | null) => ix && ({
        targetId: ix.targetId, bit: ix.bit, busy: ix.busy, ticks: ix.ticks,
        engagerSub: ix.engagerSub, engagerLeft: ix.engagerLeft,
        targetSub: ix.targetSub, targetTimer: ix.targetTimer, targetLeft: ix.targetLeft,
        actionTick: ix.actionTick, engagerDoneTick: ix.engagerDoneTick, goneTick: ix.goneTick,
    });
    const be = state.blockEngage;
    return {
        live: shape(be?.ix ?? null),
        last: shape(S.lastBlockIx),
        npcActiveClip: be?.npc?.activeClip ?? null,
    };
};
// Debug-only: A/B the launch-pad layer (tools/verify_launch_pad.mjs).
window.__launchPads = { setEnabled: setLaunchPadsEnabled, list: launchPads, debug: launchPadDebug };
// The stage overlays' own ported actors (the s415 rockfall). The bounce plays
// through the same packed-sound sink every other field cue uses.
setStageObjectSound((word: number) => sfx.playPacked!(word, { overlap: true }));
// The same sink for a stage overlay's own decor actor (engine/systems/point-record-actor.ts).
setPointRecordActorSound((word: number) => sfx.playPacked!(word, { overlap: true }));
// The pad flashes' cues are music stems (env205 digi_en0..2, env011 login_dl),
// not samples: the actor plays them at its own fire and this sink maps the
// packed word through the same PACKED_JINGLES table into the jingle player.
setPointRecordActorMusic((word: number) => {
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
setPointRecordFlag((id: number) => Number(storyFlags.get(id) ?? 0) || 0);
// The character anchor of the `picture-steps` stage object (s785's 0x327):
// the overlay's own `find(5, operand, -1)`, where the operand is the script's
// own and the `+0x4` field the find matches is the actor's id -- so the
// operand names an `npc_id`. The live cast is the scene's own npc list, the
// same objects the cutscene moves and the draw loop reads, exactly as the
// original reads the stored object's `+0x50`/`+0x54` at draw time; `>> 8`
// there is a floor of the 16.8 world coordinate, so the pixel handed over is a
// floor too.
setPointRecordAnchor(
    (stageId: string, type: number, p1: number) => {
        if (type !== 5) return null;
        const scene = state.scenes[stageId];
        if (!scene) return null;
        return (
            sceneCast(scene)
                .find((n: CastNpc) => n.npc_id === p1) ?? null
        );
    },
    (npc: CastNpc | null) => (npc ? { x: Math.floor(npc.x), y: Math.floor(npc.y) } : null),
);
// Debug-only: what the translated stage actors are doing right now, so a
// headless verifier can read the rock's own state and its draw entries.
window.__stageObjects = {
    state: (mapId: string | undefined) => stageObjectState(mapId ?? currentMap().id),
    draws: (mapId: string | undefined) => stageObjectDraws(mapId ?? currentMap().id),
    screens: (mapId: string | undefined): TransitionQuadScreen[] => streetScreenQuads(mapId ?? currentMap().id),
    glows: (mapId: string | undefined) => streetGlowProbe(mapId ?? currentMap().id),
    stinger: (mapId: string | undefined) => stingerPopupProbe(mapId ?? currentMap().id),
    // The two stage users of the resident 2D draw-context service (s805 0x349
    // and s820 0x34d): this blank's SHAPE REQUESTS, in the order the service's
    // flush hands them over. Nothing draws them yet -- the shapes' texels live
    // in a pack member this repository has not extracted
    // (docs/research/field/draw-context-service-2026-10-04.md section 5.5).
    annotator: (mapId: string | undefined) => annotatorMarkers(mapId ?? currentMap().id),
    annotatorActive: (mapId: string | undefined) => annotatorActive(mapId ?? currentMap().id),
    // The s415 Deeper Crevice SCENERY LAYER's live position this blank, so a
    // verifier can read the slide's per-frame geometry without pixels.
    scrollLayers: (mapId: string | undefined) => scrollLayerEntries(mapId ?? currentMap().id),
    fire: (id: number, sub: number | undefined, mapId: string | undefined) => fireStageObject(mapId ?? currentMap().id, id, sub ?? id),
    // The same route a cutscene SETANIM takes, with the second operand, so a
    // verifier can fire the stage overlays' own point-record actors
    // (engine/systems/point-record-actor.ts) the way their scripts do.
    fireSub: (id: string, sub: string, mapId: string | undefined) => fireStageObject(mapId ?? currentMap().id, id, sub),
    // Rockfall oracle only: run the same id through the MIPS interpreter so a
    // verifier can compare the original machine code's frames with the port's.
    nativeFire: (id: string, mapId: string | undefined): void => fireNativeStageObject(mapId ?? currentMap().id, id),
    clear: (mapId: string | undefined) => clearStageObjects(mapId),
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
window.__footstepCount = () => S.footstepCount;
// Debug-only: the field's stage-ambience execution mode. `execution` is
// "translated" -- so tools/verify_translated_field_
// ambience.mjs can refuse any other mark.
window.__stageAmbience = {
    execution: STAGE_AMBIENCE_EXECUTION,
    diagnostics: (mapId: string | undefined) => stageAmbienceDiagnostics(mapId ?? currentMap().id),
};
// Debug-only: lets a headless verifier read the encounter selection for a map
// without walking the player there, to check the entry-key wiring end to end.
window.__encounter = {
    ready: () => battle.loadData(),
    rateLevel: (mapId: string, x: number, y: number) => battle.encounterRateLevel(mapId, x, y),
    pick: (mapId: string, x: number, y: number) => battle.pickEnemy(mapId, x, y),
};
// Debug-only: drive the ordinary field->battle handoff (the step counter's own
// function) from a verifier without walking the counter down.
window.__fieldToBattle = () => triggerRandomEncounter(currentMap().id, state.x, state.y);
// Testing aid: the "Force encounter" button (or F9) fires the game's own random encounter from the field.
// The installed copy (window.__dwInstalled, web/installed-build.js) has no button and no F9; the owner PC keeps both.
{
    const fire = () => window.__fieldToBattle();
    const btn = document.getElementById("force-enc");
    if (window.__dwInstalled) btn?.remove();
    else {
        btn?.addEventListener("click", () => { btn.blur(); fire(); });
        addEventListener("keydown", (e) => { if (e.code === "F9") { e.preventDefault(); fire(); } });
    }
}
// Installed copy: the top-bar Partner, Map, Showcase and Chapter selects are hidden (they stay in the page, so the code that fills them still runs).
if (window.__dwInstalled) {
    for (const id of ["charSelect", "mapSelect", "showcaseSelect", "chapterSelect"]) {
        const label = document.getElementById(id)?.closest("label");
        if (label) label.style.setProperty("display", "none", "important");
    }
}
// ?encounter=1 (Playtest Lab, "force an encounter"): once the field is up, fire the game's own random
// encounter, retrying until its guards (cutscene, fade, textbox) let it through and a battle is running.
if (new URLSearchParams(location.search).get("encounter") === "1") {
    let tries = 0;
    const force = setInterval(() => {
        if (battle.isActive() || ++tries > 120) { clearInterval(force); return; }
        if (state.manifest) window.__fieldToBattle();
    }, 500);
}
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
    if (textbox?.isOpen?.()) (textbox as Closeable).close?.();
    if (dialogueBox.isOpen!()) dialogueBox.close!();
    if (status?.isOpen?.()) status.close?.();
    for (const ui of [shop, driMenu, gym, cardShop, cardAlbum, cardDeck, cardDuel, saveScreen, fightReport, inn, cntyselNative]) {
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
        const block = (digimonId: number, hp: number, mp: number) => ({
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
            // The card's last callback asks for the first opening movie, which the walker
            // does not ship; the lab closes the screen as it always has.
            endCard.open!(() => {
                const onDone = state.endScreenDone;
                state.endScreen = null;
                state.endScreenDone = null;
                onDone?.();
            });
            state.endScreen = endCard;
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
            dialogueBox.open!({ esdmg: "esdmg400", entry: 4, index: 4 },
                { kind: "say", plain: false, balloonMode: 0, actor: { x: 221, y: 110, actorId: 1 } },
                null, undefined, { playerNameBytes: encodeNativeScreenText(state.playerName || "Junior") });
            break;
        case "textbox_plain":
            dialogueBox.open!({ file: "estalk00", index: 11 }, { kind: "say", plain: true, balloonMode: 0, actor: null });
            break;
        case "textbox_legacy":
            textbox.open!({ name: "MAGAMI", pages: [[
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
            if (menu.openAt) menu.openAt("demosetup"); else menu.reset!();
            break;
        case "dri":
            driMenu.open!(state, null);
            break;
        // No greeter on the debug/lab path, so pass the stage and let the decoded
        // gym_ranks.json table pick the rank group it would have launched with.
        case "gym": gym.open!(state, null, null, currentMap()?.id); break;
        case "status": status?.open!(state, typeof arg === "string" ? arg : "items", null); break;
        case "cardshop": {
            // The lab can ask for any decoded stock set by id (the launcher
            // parameter the merchant's flag carries); 0 stays the fallback.
            const which = arg == null || !Number.isFinite(+arg) ? 0 : +arg;
            cardShop.open!(state, null, openCardShopFolder, which);
            break;
        }
        case "cardalbum": cardAlbum.open!(state); break;
        // The folder editor's correctness is about STATE (which slot, which
        // folder, what the swap did), so the lab exposes the screen and the
        // collection for headless capture to read.
        case "carddeck":
            window.__labDeck = cardDeck;
            window.__cards = cards;
            window.__labCatalog = cardCatalog;
            ensureStarterFolder();
            cardDeck.open!(state);
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
        case "inn": inn.open!(state, { map: "s235" }); break;
        case "save": openMemoryCard("save"); break;
        // The card-access transition quad. It has no state in the walker
        // (there is no memory card to check), so the lab is where it can
        // be seen — see stgmcard_ui.json transition.quad.unwired_note.
        case "savequad":
            openMemoryCard("save");
            if ((saveScreen as TransitionQuadScreen).showTransitionQuad) (saveScreen as TransitionQuadScreen).showTransitionQuad!(true);
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
                itemLog.noteSeen(s0.items.map((i: ShopRow) => i.id ?? i));   // GLOSSARY > ITEMS: the shop rows were shown
                shop.open!(s0.items.map((i: ShopRow) => i.id ?? i), null, { name: s0.name, state, shopId: which });
            });
            break;
        }
        // The stage-entry location title card. s780 is the opening screen, so
        // this replays exactly what a new game shows you first. The card lives
        // on the field rather than in a screen of its own, so the lab just
        // restarts it over whatever map is loaded.
        case "placecard":
            loadPlaceCardTranslated().then(() => {
                placeCard.begin!("s780");
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
            window.__reportNative = fightReportNative;
            break;
        case "cntysel":
            cntyselNative.open((row: string, language: number) => {
                window.__labLanguage = row;
                window.__labLanguageByte = language;
            });
            window.__labCntyselNative = cntyselNative;
            break;
    }
};

window.__cutscene = cutscene;
window.__wideField = wideField;
{
    const startScene = cutscene.start;
    cutscene.start = (opcodes, ...rest) => {
        wideField.staged = scriptIsStaged(opcodes);
        return startScene(opcodes, ...rest);
    };
}
window.__playQuestScene = playQuestScene;   // testing aid (tools/verify_quest_scene.mjs)
window.__questFx = {
    state: questFxState, clear: questFxClear, fade: questFxFadeAlpha, drive: questFxDriveState,
    shake: () => ({ offset: questFxShakeOffset(), batch: questFxShakeState() }),
    ghost: questGhostState,
    sky: ambienceSceneState,
};   // testing aid (tools/verify_quest_fx.mjs, tools/verify_quest_fx2.mjs)
// The running `chase` step's own numbers (web/quest-chase.js), or null when none is running: the target's position, the
// gap to the player, whether it is about to be lost, and the answer it will settle on. Testing aid only.
window.__questChase = () => (S.questChase ? { target: state._questChaseTarget, ...S.questChase.machine.state } : null);

window.addEventListener("pagehide", saveFieldLocation);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveFieldLocation();
});

// Script hook for the underwater view: drive one cast live. cast() uses the real spot under the
// player (or an explicit {dx,dy}); strike() is the same edge the circle button sends.
window.__fishingUw = {
    cast(spot: FishingSpot | null | undefined) { if (state.fishing) return false; const sp = spot ?? fishingSpotHere(); if (!sp) return false; startFishingCast(sp); return true; },
    strike() { if (!state.fishing) return false; state.fishing.strike = true; return true; },
    info() { return { ...underwaterInfo(), run: state.fishing ? { ...state.fishing.run } : null }; },
};

// The annotator delay walk spends the resident random every blank and clamps it
// to 4 (wstag820.s:267-275, wstag805.s:44-46). The resident source is the one
// 16-bit word every other field cue draws, not a constant: the walk's own speed
// is the game's, so a marker lights on the frame the disc's script picks, not on
// a fixed one. Registered here, beside the declaration, because reading the
// binding above its own `const` kills the whole module.
setAnnotatorRandom(rand16);

mpOn((type, d) => {
    if (type === "mpb") {
        if (d.d?.k === "setup" && mpIdle() && fieldPartySize(state.party) > 0) startFieldBattle(() => mpbMessage(d.from, d.d));   // the same hand-off for a friend's fight
        else mpbMessage(d.from, d.d);
    } else if (type === "leave") mpbPeerGone(d.id);
    else if (type === "away") mpbPeerAway(d.id);
    else if (type === "back") mpbPeerBack(d.id);
    else if (type === "linklost") mpbLinkLost();
    else if (type === "linkback") mpbLinkBack(d.resumed);
});

window.__grantNewPartners = grantNewPartners;

// Visited walker maps: a save written before the MAP page read the flag store keeps
// its markers in `visitedMaps`. Nothing writes that list any more — initEngine turns
// it into the store's bits once (migrateVisitedMaps) and drops it.
state.visitedMaps = new Set(JSON.parse(localStorage.getItem("visitedMaps") ?? "[]"));

window.__storyFlags = storyFlags; // debug: inspect banked-predicate evaluation

window.__partyCharisma = () => partyCharisma(state); // debug/headless read-out
window.__cardDuel = cardDuel; // debug: is a field-launched duel actually running?

// state.progressOrdinal proxies the engine's $story.ordinal (single source of truth). Before
// the engine exists it falls back to localStorage (read) / writes through to it (write).
Object.defineProperty(state, "progressOrdinal", {
    get() {
        return S.engine
            ? Number(S.engine.state.vars.get("$story.ordinal") ?? 0)
            : Number(localStorage.getItem("progressOrdinal") ?? 0);
    },
    set(v) {
        if (S.engine)
            S.engine.state.vars.set("$story.ordinal", Number(v)); // onChange persists
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
        return S.engine
            ? Number(S.engine.state.vars.get("$party.bit") ?? this._bits)
            : this._bits;
    },
    set(v) {
        const n = Number(v) || 0;
        this._bits = n;
        if (S.engine) S.engine.state.vars.set("$party.bit", n); // onChange persists
        else localStorage.setItem("bits", String(n));
    },
});

// state.rosterOwned proxies the engine's $roster.owned — the eight-slot OBTAINED set that
// the engine's GrantPartner command (bank-0x70 op-0x10 case 3) writes when an NPC hands a
// partner over. The Digimon Lab reads it to decide who it will offer you, so it has to
// survive a reload like the wallet does.
Object.defineProperty(state, "rosterOwned", {
    get() {
        return S.engine
            ? Number(S.engine.state.vars.get("$roster.owned") ?? this._rosterOwned)
            : this._rosterOwned;
    },
    set(v) {
        const n = Number(v) || 0;
        this._rosterOwned = n;
        if (S.engine) S.engine.state.vars.set("$roster.owned", n); // onChange persists
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
        .filter((n: CastNpc) => !n.cutsceneOnly)
        .map((n: CastNpc) => ({
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
        .filter((n: CastNpc) => Math.hypot(n.x - x, n.y - y) <= r)
        .map((n: CastNpc) => ({
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
        .sort((a: { slot: number }, b: { slot: number }) => a.slot - b.slot);
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
    const sel = document.getElementById("chapterSelect") as HTMLSelectElement;
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
            .filter((z: CastNpc) => !z.cutsceneOnly)
            .sort(
                (a: CastNpc, b: CastNpc) =>
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

window.__playStoryEvent = (ev, onDone) => playStoryEvent(ev, onDone); // verifier hook (tools/verify_dialogue_say.mjs)
window.__auctionArrival = runAuctionArrival;   // verifier hook (tools/verify_s260_auction.mjs)
window.__auctionScriptRow = auctionScriptRow;
// Verifier hook: the arrival fade's completion calls checkStageCutscene, and a debug
// jump (window.__setMap) skips the fade — this is that same call, for tests.
window.__stageEnter = (mapId) => checkStageCutscene(mapId);

// Console aid: __replay.rows() is what the page would list, __replay.press("down") drives the page.
window.__replay = {
    open: () => replayOpen(),
    view: () => replayView(),
    rows: () => replayRowsNow(),
    press: (button: unknown) => replayPress(String(button)),
    take: () => replayTake(),
    scene: (ev: StoryEvent) => replayScene(ev),
};

window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    bgm.unlock!(); sfx.unlock!();
    const raw = e.key.toLowerCase();
    dispatchInput(asButton(raw), e, raw);
    // The arrow keys scroll the page if the game does not claim them.
    if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(raw))
        e.preventDefault();
});
window.addEventListener("mousedown", () => { bgm.unlock!(); sfx.unlock!(); });
window.addEventListener("keyup", (e) => state.keys.delete(asButton(e.key)));
window.addEventListener("blur", () => state.keys.clear());

window.__gamepadConnected = () => gamepad.isConnected();

requestAnimationFrame(padLoop);

 /**
 * The F2 panel's "Open ..." buttons call this. The F2 switches only ENABLE these screens; none opens
 * by itself on page load or when the switch is ticked. Returns true when the screen is now open;
 * false when its switch is off, the game has not started, or the field is busy (a fight, a scene).
 * Escape (the "cross" press) closes every one of them.
 */
window.__openExtra = (name: string) => {
    const fx = window.__fx || {};
    if (!state.started || state.titleScreen || state.endScreen) return false;
    if (!replayFieldFree()) return false;
    switch (name) {
        case "cutcontent": if (fx.cutcontent !== true) return false; openCutContent(); return true;
        case "blastladder": if (fx.blastladder !== true) return false; openBlastLadder(); return true;
        case "planner": if (fx.planner !== true) return false; openPlanner(); return tickPlanner(true, plannerPartyMembers);
        case "damagelab": if (fx.damagelab !== true) return false; openDamageLab(); return true;
        case "replay": if (fx.replay !== true) return false; openReplay(replayRowsNow() ?? {}); return true;
        case "soundtest": if (!fx.soundtest) return false; soundTest.show!(); return true;
        default: return false;
    }
};

window.__dev = {
    // Jump to a stage by manifest id ("s200") or index, optionally at a pixel.
    // Runs the game's own loadAndSetMap so the arrival is the ordinary one.
    jump: (mapIdOrIndex: number | string, x: number | null = null, y: number | null = null) => {
        const maps = state.manifest?.maps ?? [];
        const idx = typeof mapIdOrIndex === "number"
            ? mapIdOrIndex
            : maps.findIndex((m: ManifestMap) => m.id === String(mapIdOrIndex));
        if (idx < 0 || idx >= maps.length) return false;
        loadAndSetMap(idx, x != null && y != null ? { x, y } : null);
        if (x != null && y != null) { state.x = x; state.y = y; }
        return true;
    },
    // Start a battle with any enemy id from data/enemies.json, through the SAME
    // battle.start the field handoff and the battle lab use.
    startBattle: (opts: DevBattleOptions = {}) => battle.start({
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
    startScreenBattle: (screenId: number | string, opts: DevBattleOptions = {}) => battle.startScreen(
        Number(screenId), opts.onWin ?? null, opts.onFlee ?? null, opts.onLose ?? null,
        { mapId: opts.mapId ?? currentMap().id, lead: opts.lead ?? true },
    ),
    // Start a battle from a resolved party (the same startParty the field uses): entries are
    // {name, level, hp, mp, stat_scale, fuseInto?}. Used by the dev toolset's Fusion Lab boss list.
    startPartyBattle: (party: Parameters<typeof battle.startParty>[0], opts: DevBattleOptions = {}) => battle.startParty(
        party, opts.onWin ?? null, opts.onFlee ?? null, opts.onLose ?? null,
        { mapId: opts.mapId ?? currentMap().id },
    ),
    // Play one stage event directly through the walker's own cutscene path.
    // Events normally fire from a controller (step VM / talk launcher / flag);
    // this bypasses the gate and plays the script, which is what a tester wants.
    // Loads the event's own stage first when the player is elsewhere.
    playEvent: async (mapId: string, eventId: number | string) => {
        if (mapId && currentMap().id !== mapId) {
            const idx = state.manifest.maps.findIndex((m: ManifestMap) => m.id === mapId);
            if (idx < 0) return false;
            await loadAndSetMap(idx);
        }
        const ev = (state.wstag[currentMap().id] || []).find((e) => Number(e.id) === Number(eventId));
        if (!ev) return false;
        playStoryEvent(ev, () => {});
        return true;
    },
    // Set a story flag through the real set_flag path (banked commands included).
    setFlag: (id: number | string, val = true) => { applyStoryFlag(Number(id), val ? 1 : 0); return true; },
    snapshot: () => devSnapshot(),
    get battle() { return battle; },
    get renderer() { return window.__battle3d ?? null; },
};

init().catch((err) => {
    document.getElementById("loading")!.textContent = "Error: " + err.message;
});
