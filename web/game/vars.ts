import { createExclusiveRegister, createBgmPlayer, createSfxPlayer } from "../audio.js";
import { createItemLog } from "../item-log.js";
import { createSpeciesLog } from "../species-log.js";
import { createRetryLoader } from "../retry-loader.js";
import { loadGlossaryData } from "../glossary-digimon.js";
import { createStage } from "../glossary-stage.js";
import { createBattle3D, resolveModelFolder, setFighterTint } from "../battle3d.js";
import { createFreeCamera } from "../anim-viewer-camera.js";
import { createPartnerFallback } from "../glossary-fallback.js";
import { createBookHost } from "../book-host.js";
import { createGlossaryBook } from "../glossary-book.js";
import { createOptionsBook } from "../options-book.js";
import { createFlyBook } from "../fly-book.js";
import { createGlobeBook } from "../world-globe-book.js";
import { createGlobeStage } from "../world-globe-view.js";
import { effectiveMapScreen, mapScreenRoute } from "../world-globe-map.js";
import { mapGlobeHere } from "../menu/pure.js";
import { MS } from "../menu/state.js";
import { globePlaces, parsePlaceMaps, parsePlaceScenes, parseWalkerMap } from "../world-globe-places.js";
import {
  screenIdForStage,
  carriesFolderBag,
  resetEncounterCounter,
  createCutscene,
  terrainCodeAt,
  ownsItem,
} from "../vendor/engine.js";
import { assetMode, ASSET_MODE_HD } from "../assets.js";
import { createDialogueTranslated } from "../dialogue-translated.js";
import { createEndCardTranslated } from "../endscreen-translated.js";
import { createCanvasResolutionController } from "../canvas-resolution.js";
import { createTextbox } from "../textbox.js";
import { createYesNoTranslated } from "../yesno-translated.js";
import { createHelpMenuTranslated } from "../help-menu-translated.js";
import { createChoice } from "../choice.js";
import { createMenu, pauseMapContext } from "../menu.js";
import { createShopTranslated } from "../shop-translated.js";
import { createPackSelectTranslated } from "../packselect-translated.js";
import { createNameEntryTranslated } from "../nameentry-translated.js";
import { createGymTranslated } from "../gym-translated.js";
import { partyRosterView } from "../party.js";
import { cards, ownedCount } from "../cardstate.js";
import { pauseExtraRows } from "../pause-extra-rows.js";
import { questsPauseRow, questDone, questsPausePage } from "../quests.js";
import { FLY_QUEST, flyCopiesOf, flyPlaces } from "../fly-points.js";
import { createStatusTranslated } from "../status-translated.js";
import { createLabTranslated } from "../lab-translated.js";
import { createCardShopTranslated } from "../cardshop-translated.js";
import { createCardAlbumTranslated } from "../cardalbum-translated.js";
import { createCardDeckTranslated } from "../carddeck-translated.js";
import { createCardDuelNative } from "../cardduel-native.js";
import { openPauseHome, openPauseMap, returnToPauseCardFolders } from "../pause-home.js";
import { mpbVisible, mpbKey } from "../mpbattle.js";
import { isOpenAirMapName } from "../ambience.js";
import { createFightReportTranslated } from "../fightreport-translated.js";
import { createSaveTranslated } from "../save-translated.js";
import { createBattle } from "../battle.js";
import { createFieldMoviePlayer } from "../field-movie.js";
import { createInnTranslated } from "../inn-translated.js";
import { createDebugPanel } from "../debugPanel.js";
import { createPlaceCardTranslated } from "../placecard-translated.js";
import { createStagslctMenu } from "../stagslct.js";
import { createSoundTest } from "../soundtest.js";
import { createCntyselNative } from "../cntysel-native.js";
import { createSceneSkip } from "../sceneSkip.js";
import { createEditor } from "../editor.js";
import { createSceneEditor } from "../sceneEditor.js";
import { createWipeClock } from "../stage-wipe.js";
import { encodeNativeScreenText } from "../native-screen.js";
import { fireStageObject } from "../stage-objects.js";
import { fireNativeEffect } from "../native-stage.js";
import { packedIsMusicStart, packedKey } from "../packed-sound.js";
import { ephemeralActorRecord } from "../cutscene-actors.js";
import { createFishFinds } from "../fishing-extras.js";
import { createFlagStore } from "../flag-store.js";
import { slotStats } from "../dri-native.js";
import { partyCharisma } from "../charisma.js";
import { attachGamepad } from "../input.js";
import { glossaryItems, glossaryPartners, glossarySpecies } from "./followers.js";
import { S } from "./state.js";
import { currentMap } from "./session.js";
import { engineFlagSeen, ensureSpriteAssets, loadAndSetMap } from "./map-load.js";
import { openFly } from "./ui-openers.js";
import { checkStageCutscene, storyDbg } from "./story-events.js";
import { runQuestSceneEvent, sceneCast } from "./quest-scenes.js";
import { dispatchInput } from "./input.js";
import type { Closeable, FadeState, Follower, GameState, ManifestMap, PartyRosterRow, SceneNpc, SpriteRecord, TrailPoint } from "./types.js";
import type { BookFactoryArgs } from "../types/screens.js";
import type { WithAnyKey } from "../types/game-shared2.js";


// D0x80055c34 is ONE register in the original, so both players share one
// instance here: a track or jingle started on either side first ends whatever
// the other side held — the field track's return ends W_JINGLE, EVOLUTIO ends
// the battle track, the battle track ends W_JINGLE.
export const soundRegister = createExclusiveRegister();

export const bgm = createBgmPlayer(soundRegister);

export const sfx = createSfxPlayer(soundRegister);

// GLOSSARY and OPTIONS (web/book-host.js): one host runs whichever book the pause list opens.
export const itemLog = createItemLog();            // owned/seen items: watchBag(state, itemLog) below the state, noteSeen at the shop and the win report

export const speciesLog = createSpeciesLog();      // installed below (installSpeciesLog), read by GLOSSARY > DIGIMON

export const glossaryLoader = createRetryLoader(() => loadGlossaryData());   // the species, built once from the tables on first open; a failed fetch is tried again after 5 s

export const glossaryStage = createStage({
    makeRenderer: (canvas: HTMLCanvasElement) => createBattle3D(canvas, null, { alpha: true }),
    makeCamera: createFreeCamera,
    resolveFolder: resolveModelFolder,
    setTint: setFighterTint,
    drawFallback: createPartnerFallback(),
});

// OPTIONS > GAME > Map screen: New = the World Globe (web/world-globe-book.js). One WebGL context for the session, made on the first
// MAP press (the MAP row opens the disc's page when it cannot be made); the globe's scene is built per open and freed when it shuts.
export const globeStage = createGlobeStage();
/** The globe failed while its book was open: the book has shut and the disc's MAP page opens instead (openBook). */
let globeFellBack = false;

export const books = createBookHost({
    sfx,
    factories: {
        glossary: (args: BookFactoryArgs) => createGlossaryBook({ sfx: args.sfx, getSpecies: glossarySpecies, getLog: () => speciesLog, getPartners: glossaryPartners, stage: glossaryStage, getItems: glossaryItems }),
        options: (args: BookFactoryArgs) => createOptionsBook(args),
        // FLY (quest zz_fly): the visited fly points; the chosen one is flown to after the pause list has gone (openBook).
        fly: (args: BookFactoryArgs) => createFlyBook({ sfx: args.sfx, data: () => ({ places: currentFlyPlaces() }), choose: (p) => { S.flyChosen = p; } }),
        // OPTIONS > GAME > Map screen: New: the World Globe, turned to where you stand (the same stage, server and place as the disc's page).
        mapscreen: () => createGlobeBook({
            stage: globeStage,
            here: () => mapGlobeHere(state),
            // every place's main screen and yours, from the game's tables (status_ui walker_map, the manifest, the scenes)
            places: (h) => globePlaces(parseWalkerMap(MS.UI), parsePlaceMaps(state.manifest.maps), parsePlaceScenes(state.scenes), h),
            held: () => state.keys,
            onFail: () => { globeFellBack = true; },
        }),
    },
});

export const PACKED_JINGLES: Record<string, string> = {
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
export const PACKED_MUSIC: Record<string, string> = {
    "0x60040002": "demo_bgm",
    "0x611c0000": "ttlbgm",
};

// The END card the title overlay raises before handing the machine to the first opening movie.
// The card runs the translated title-overlay routines (F0x80082E9C / F0x80082D70 / F0x80084628 /
// F0x8008453C, engine EndCardSession). Its first callback
// stops every sound (D0x80055C64), which is sfx.stopAll() here.
export const NO_GRASS3D = new URLSearchParams(location.search).has("nograss3d");

export const NO_WATER3D = new URLSearchParams(location.search).has("nowater3d");

// HD Remaster field maps (always on in HD):
// - a tiled HD map is drawn from assets-hd/map-tiles (map-tiles.js, only the tiles on screen are
//   loaded); the stage itself holds the NATIVE picture (ready at once, used for the layer split, the
//   terrain effects, and shown until the visible tiles are in). Neighbouring stages load only their
//   native picture. A map with no tiles (pack built before tools/tile_hd_maps.py) loads whole.
// - grass / water / seam fix / swaying trees / ground effects read the native picture instead of the
//   4x one (their map coordinates are native pixels; an HD picture is 4x as wide).
export const HD_MAPS = assetMode() === ASSET_MODE_HD;

export const mpIdle = () => state.started && !battle.isActive() && !cutscene.isActive() && !textbox.isOpen!() && !choice.isOpen!() && !state.menuOpen && fade.dir === 0 && !state.diveDemo && !state.wipe28;

// The bubble itself is a second instance of the game's own conversation box, so it has the real
// balloon chrome, tail and font, but the game never sees it open: nothing is blocked while it shows.
export const chatBox = createDialogueTranslated(sfx);

export const chatActor = { x: 0, y: 0, actorId: 0 };

let chatHold = 10;

// Multiplayer speech: every speaker gets their own instance of the same game balloon, over their own character.
export const mpBalloons = new Map();   // player id -> { box, actor, at }

export const endCard = createEndCardTranslated({ stopSound: () => sfx.stopAll!() });

// The end-of-cast fishing balloon before its pop was decoded: one static cel
// 0x35 with the row-1 glyph, drawn from the opening frame. The decoded balloon
// (the story bubble's own model) puffs up, holds, then deflates — see the block
// in render().

export const fade: FadeState = { alpha: 0, dir: 0, pending: null }; // dir: 1 fading out, -1 fading in

// The stage-change wipe runs on the original's own frame counter (web/stage-wipe.js,
// translated from fieldstg F0x8008A5E4); the shared fade's alpha is taken from it so
// the stage swap still lands exactly where it always did, on a full close.
// The field->battle handoff plays the A28 checkerboard (web/stage-wipe.js,
// fieldstg F0x80089F7C) before the battle.

export const VIEW_W = 640;

export const VIEW_H = 480;   // 240 native lines at ZOOM 2 -- the screen the disc sets,

// ledger UI-DISPLAY-EXTENT-001. Was 448 (224 lines) from
                      // this repository's first commit, never read off the disc.

// ?noEncounters=1 → no random-encounter rolls (debug/verification walks).
export const NO_ENCOUNTERS =
    new URLSearchParams(location.search).get("noEncounters") === "1";

export const ZOOM = 2; // render scale: PS1 sprites are tiny on modern screens

// The field-entity constructor F0x8009116c is called with a0=2 for the player
// (docs/research/field/player-party-movement.md); that "kind" is what the drop
// shadow's spawn gate tests.
export const PLAYER_ENTITY_KIND = 2;

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
export const DIGMON_SPRITE_ID = 326;

export const canvas = document.getElementById("game") as HTMLCanvasElement;

// ETS item 9: the game canvas is only ever asked for a 2d context, so it is never null.
export const ctx = canvas.getContext("2d")!;

export const fieldCanvasResolution = createCanvasResolutionController(canvas, ctx, {
    logicalWidth: VIEW_W,
    logicalHeight: VIEW_H,
});

export const lastCam = { x: 0, y: 0 };

// Verified field-script camera: FN6A targets an actor and FN6B targets coordinates.
// Mode 1 snaps/follows exactly; mode 0 eases toward the target.
export const viewCam = { x: 0, y: 0, active: false };

export const labCam = { x: 0, y: 0, active: false }; // web/seam-lab.html only — see __labCam

export const fallbackTextbox = createTextbox(sfx);

// The translated conversation box (engine/dw3/ui/dialogue-session.ts): the ordinary NPC talk route
// (estalkNN lines) and the cutscene SAY lines (esdmgNNN entries). Defeat messages, hand-built pages and a
// failed load still use web/textbox.js.
export const dialogueBox = createDialogueTranslated(sfx);

// The field Yes/No question box (8 per-stage launchers, engine/dw3/ui/yesno-session.ts).
// It blocks the field like a talk box only while its window is up: while the event it
// started runs, that event's own boxes must be free to open.
export const yesNoBox = createYesNoTranslated(sfx);

export const yesNoWindowUp = () => yesNoBox.isOpen!() && !S.yesNoAwaitingChild;

// The five NPC help counters (s210 event 8; s924 events 1602/1604; s935 events 1616/1618): the
// counter says its line, then eight topics and a cursor take the screen (engine/dw3/ui/help-menu-session.ts,
// translated from wstag210 F0x800A5E74 and its four copies). The menu starts no event, so the talk
// simply continues when it closes.
export const helpMenuBox = createHelpMenuTranslated(sfx);

export const helpMenuWindowUp = () => helpMenuBox.isOpen!();

export const textbox = new Proxy(fallbackTextbox, {
    get(target, prop) {
        if (prop === "dialogue" && dialogueBox.isOpen!()) return S.translatedDialogueText;
        if (prop === "isOpen") return () =>
            target.isOpen!() || dialogueBox.isOpen!() || yesNoWindowUp() || helpMenuWindowUp();
        if (prop === "advance") return () => {
            if (yesNoWindowUp() || helpMenuWindowUp()) return; // these boxes read the pad themselves
            return dialogueBox.isOpen!() ? dialogueBox.pressConfirm!() : target.advance!();
        };
        if (prop === "close") return () => { if (dialogueBox.isOpen!()) dialogueBox.close!(); (target as Closeable).close?.(); };
        // ETS item 9: the proxy forwards any property name to the fallback box; TextboxState has no string index signature.
        return (target as WithAnyKey<typeof target>)[prop];
    },
    // ETS item 9: same forwarding for writes.
    set(target, prop, value) { (target as WithAnyKey<typeof target>)[prop] = value; return true; },
});

export const choice = createChoice(sfx);

export const menu = createMenu(sfx);

// The field's own stage ambience (the overlay's per-stage actor registry) is
// OUR translated code: the ambient point-sprite
// decorations, the stage-owned rock/decor/pad actors, the street broadcast,
// lights and screens, the stingers, the fixed sprites, the display-slot
// players/ensembles and the draw-context annotators all run from
// web/stage-objects.js + web/effects.js over engine/systems/**.
export const shopTranslated = createShopTranslated(sfx, { digimonDB: () => menu.digimonDB ?? {} });

export const shop = shopTranslated;

// The training gym is the pro/stgtrain screen: the real pod select, the drill list with
// its pictures (STTRNG0), the TP/confirm plates, the session with the workout scene (the
// trainee and the props play the disc's TRANIN scripts), the result text and the stat roll.
// It runs translated code (engine/dw3/ui/gym-session.ts, web/gym-translated.js, proof
// tools/verify_translated_gym.mjs).
// The Digimon Lab runs translated code (engine/dw3/ui/lab-session.ts, web/lab-translated.js, proof
// tools/verify_translated_lab.mjs).
// The pause pages run translated code (engine/dw3/ui/pause-root-session.ts).
// Every route that has a translated pause page opens THAT page: the field's START, the lab's
// Status Menu button and the Digivolve Demo screen's Back all go through
// openPauseHome() below.
// Proof: tools/verify_pause_home_one_list.mjs.
// The naming screen: the DRI desk's rename (and the opening's standalone
// naming) run the translated pro/stdgname screen.
// Contract: the screen seeds its grid from the roster record's name field and
// its OK export writes the trimmed name back into that same field.
// The registration wizard (pro/stplnmet) runs translated code: the opening's registration
// hand-off opens web/packselect-translated.js, the player types the account name on the
// screen's own keyboard, picks a pack and answers "Register account?", and the adapter reads
// the committed pack index back (0x8004B374) for the walker's grantPack.
export const packSelectNative = createPackSelectTranslated(sfx);

export const nameEntryNative = createNameEntryTranslated(sfx, { digimonDB: () => menu.digimonDB ?? {} });

export const gym = createGymTranslated(sfx);

export const statusOptions = {
    // The pages draw the BASE Digimon's name out of the roster record, so the
    // adapter seeds exactly the name the menus show: the player's nickname when
    // there is one, else the species name (web/party.js partyRosterView).
    roster: (state: GameState): PartyRosterRow[] => partyRosterView(
        state.party, state.partnerStats, state.partyStats,
        menu.digimonDB ?? {}, state.digimonNames,
    ),
    // The card collection the album/folder screens read and write back.
    cards: () => cards(),
    // The native CARD FOLDERS page hands off through the resident launcher:
    // 0x1200 = Card Album, 0x400 = folder editor. Those two overlays are not
    // hosted in production yet (Phase 6.3 group 2), so the walker's own screens
    // answer the request — the same ones the walker's CARD FOLDERS panel opens.
    onTransition: (id: string | number) => {
        if (id === 0x1200) menu.onCardAlbum?.();
        else if (id === 0x400) menu.onCardDeck?.();
    },
    // The map page asks the flag store which places you have walked into — the bits the
    // field entry wrote (engine loadStage -> set_flag(0x1E00 + screen id, 1)).
    map: (state: GameState) => pauseMapContext(state, undefined, engineFlagSeen),
    // OPTIONS > GAME > Map screen: New makes the MAP row open the World Globe (web/world-globe-book.js) instead of the disc's page,
    // when the stage has a map and a GPU WebGL context can be made (else it is the disc's page). No pick = the mode decides (HD = New).
    newMapScreen: () => mapScreenRoute(effectiveMapScreen(window.__fx?.mapScreen, HD_MAPS), mapGlobeHere(state).server, globeStage.ensure) === "globe",
    // Extra rows on the pause list (after CARD FOLDERS): QUESTS, then the GLOSSARY and OPTIONS books while their dev switches are on.
    extraRows: () => pauseExtraRows({ quests: questsPauseRow(), fx: window.__fx, fly: questDone(FLY_QUEST) }),
    questsPage: () => questsPausePage(),
    onBook: (book: string, row: number) => openBook(book, row),
    // The CARD FOLDERS row's gate: the resident home list's own byte, D0x80048f42 =
    // save+0x20E = carried[402] — the Folder Bag key item (claim
    // UI-CARD-FOLDERS-GATE-IS-FOLDER-BAG-ITEM-2026-10-14). It used to read "has
    // folders", which the boot starter grant makes true for everyone.
    cardFoldersUnlocked: () => carriesFolderBag(state),
};

export const status = createStatusTranslated(sfx, statusOptions);

export const driMenu = createLabTranslated(sfx);

// Card merchants execute the translated root, stock, booster and reveal.
export const cardShopTranslated = createCardShopTranslated(sfx, {
    stage: () => screenIdForStage(S.fieldScreenTable, currentMap().id) ?? 0,
});

export const cardShop = cardShopTranslated;

// Card Album / Folder editor / duel (stcrdabm, stcrddek, cardgame). The
// catalog they browse is decoded data; see web/cardstate.js for which of the
// surrounding rules are decoded and which are walker rules.
// The Album is the translated screen
// (web/cardalbum-translated.js over engine/dw3/ui/album-session.ts: the
// already-oracled pro/stcrdabm controllers running as registered tasks).
const cardAlbumTranslated = createCardAlbumTranslated(sfx);

export const cardAlbum = cardAlbumTranslated;

// The Folder editor's chooser runs our translated code: the factory, the
// picker tick, the label builder, the row fill and the colour census are
// engine/dw3/ui ports, composed by engine/dw3/ui/folder-session.ts behind
// web/carddeck-translated.js. The editor's card grid and name
// keyboard are not translated yet and the session names them as such.
const cardDeckTranslated = createCardDeckTranslated(sfx);

export const cardDeck = cardDeckTranslated;

// The card duel runs the shipped pro/cardgame overlay through the native screen
// host: the player talks a tamer into a challenge in the field, the screen's own
// banner -> folder chooser -> coin toss -> Draw Phase chain plays, and the
// result (0x80048AC0 plus the per-opponent win count) commits into the walker's
// state. Proven from ordinary play by tools/verify_native_duel_play.mjs and at
// the screen level by tools/verify_native_duel.mjs /
// tools/verify_native_duel_commit.mjs.
// `getState` is a getter, not the object: `state` is declared further down this
// module, and the duel adapter seeds its bag synchronously from it the moment a
// duel opens. The accessor is also what keeps a duel opened through the debug
// hook (`window.__cardDuel.open(onClose, name, deck, id)`, used by the card-duel
// verifiers) seeded from the same bag the game uses.
export const cardDuelNative = createCardDuelNative(sfx, bgm, { getState: () => state });

export const cardDuel = cardDuelNative;

// THE pause home. The field's START, the UI lab's Status Menu button and the
// Digivolve Demo lab screen's Back all call this one function (web/pause-home.js),
// so there is a single list of pause rows in the walker: the translated page
// (engine/dw3/ui/pause-root-session.ts). The rows, their order, their gate and
// every button on them are one system of the original — the resident list
// F0x8001270c and its builder 0x8001345C — tabulated once in
// docs/research/ui/pause-home-button-table-2026-10-04.md.
export const pauseHome = (row = 0) => openPauseHome({ state, status, menu, row });

// MAP: row 2 of the overlay's factory table IS the map page (ctor 0x80099324, tick
// F0x8009913c); it reads the RESIDENT map service object (0x8009B6EC). The translated route
// ports that service (engine/dw3/ui/native/pause-misc.ts), so it opens the page. Demo
// Setup is an opt-in developer row the original never reaches from the pause home; the
// walker's own panel serves it.
export const PAUSE_PAGE_ENTRIES = new Map([
    ["ITEMS", "items"], ["SORT", "sort"], ["MAP", "map"], ["TECHNIQUES", "techniques"],
    ["STATUS", "status"], ["CARD FOLDERS", "cardfolders"],
]);

// Both are hand-offs, not exits: on the disc the Card Album and the folder
// editor are separate SCREENS the pause page launches through the resident
// screen launcher (0x1200 / 0x400), and the game's screen manager brings the
// STATUS screen back when they close — so the player lands on the pause's OWN
// CARD FOLDERS page, not on a second hand-drawn copy of it. The one return
// route is returnToPauseCardFolders (web/pause-home.js), which reopens the
// translated page.
export const backToCardFolders = () => returnToPauseCardFolders({ state, status, menu });

// GLOSSARY / OPTIONS: the pause list ended on that row (status-translated onBook); the book runs over the frozen field and the list
// comes back on the same row when it shuts. The confirm that chose the row is still down: the host ignores it until it is let go.
// If a button is still down after the host's release cap, the reopened list ignores it until it is let go (blockUntilReleased).
// The World Globe that failed while open (its files did not load) shuts, and the disc's MAP page opens on the same row instead.
const openBook = (book: string, row: number) => {
    if (book === "fly") { openFly(row); return; }
    globeFellBack = false;
    books.open(book, (held) => {
        if (book === "mapscreen" && globeFellBack) openPauseMap({ state, status, menu, row });
        else pauseHome(row);
        status?.blockUntilReleased?.(held);
    }, state.keys);
};

// FLY (web/fly-points.js): the pause row exists only once quest zz_fly is done. Flying needs open air and a free field; the book lists the
// visited fly points; the chosen one is reached by the game's own map change (warpToMap) once the book has shut and the pause is over.
export const flyFree = () => !!state.started && !battle.isActive() && !cutscene.isActive() && !textbox.isOpen!() && !choice.isOpen!()
    && fade.dir === 0 && !state.diveDemo && !state.wipe28 && !state.nameEntry && !mpbVisible() && !state.handoffHold && !state.launch
    && !state.climb && !state.fishing && !state.slope && !state.submarimon && !state.diveForm && !state._questScene;

const flySeen = (id: string) => { const sid = screenIdForStage(S.fieldScreenTable, id); return sid != null && engineFlagSeen(0x1e00 + sid); };

export const flySeenAny = (id: string) => flyCopiesOf(state.manifest?.maps ?? [], state.scenes, id).some(flySeen);   // any copy of the place walked into

export const currentFlyPlaces = () => flyPlaces({ maps: state.manifest?.maps ?? [], seen: flySeen, currentId: currentMap()?.id ?? null, scenes: state.scenes });

export const flyAirNow = () => isOpenAirMapName(currentMap()?.name ?? "");

// The post-fight results screen (pro/stfgtrep) runs as translated code in ordinary
// play: engine FightReportSession behind web/fightreport-translated.js, no
// PlayStation instruction and no interpreter — see
// docs/plans/2026-09-28-translated-game-completion-plan.md.
export const fightReportNative = createFightReportTranslated(sfx, { getState: () => state });

export const fightReport = fightReportNative;

// The memory-card save/load screen (pro/stgmcard) runs as translated code in
// ordinary play: engine MemcardSession behind web/save-translated.js, the walker's
// three localStorage slots served as the card through web/memcard.js, no PlayStation
// instruction and no interpreter.
export const saveScreenNative = createSaveTranslated(sfx);

export const saveScreen = saveScreenNative;

export const battle = createBattle(canvas, ctx, () => state, sfx, bgm);

export const fieldMovie = createFieldMoviePlayer(
    () => { const done = S.fieldMovieDone; S.fieldMovieDone = null; done?.(); },
    (error) => console.error("[field-movie]", error),
    null,
    () => state.languageByte ?? 2,
);

// The finale's win exit (wfightmn.s:2165-2174, arm 4's phase 2): with the result
// byte 1 — the win — the resident launcher takes 0xE0B when the battle-kind word
// is 6, instead of 0x1400 (STFRPT). 0xE0B is STTITL mode 11 = movie row 10 =
// MOVIEE01_STR (pro/stdwtitl.s:161-167 the mode dispatch, :212-218 the low-byte-
// minus-one row; engine/dw3/movie-destinations.ts), whose own return selector is
// 0xE0C = row 11 = MOVIEE02_STR, whose own return selector is 0x2d7 = screen 727
// = WSTAG780_PRO (stage 780, Kusanagi City Street Corner — the same place the
// title's Start option lands).
//
// The chain plays through the one field movie adapter. Both ending streams ship
// (web/assets/movie/moviee01.mp4 and moviee02.mp4, by their disc file indices 2035
// and 2213 in the manifest the title/movie audit verified), so the chain plays them
// on the movie object's own blank cadence and ends each on the row's own picture
// count or the pad's START — both decoded end arms. A row whose stream cannot load
// still ends through the adapter's browser-safety abort — logged, not fatal — and the
// chain resolves the row's return selector either way, so the win is never stranded.
// The ordinary win's cue (0x1400) never enters here: the battle only calls this for
// the 0xE0B cue. Driven end to end by tools/verify_finale_ending_chain.mjs.
export const ENDING_CHAIN_MAX_STEPS = 4;

// Ordinary-play hand-off: when a fight is won, the victory report phase opens
// the native pro/stfgtrep screen instead of the inline report. The screen pays
// the BIT and the dropped item, and its close returns to the field.
export const REPORT_CORE = ["str", "def", "spt", "wis", "spd", "chr"];

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
// F0x800110e0, engine InnSession).
export const inn = createInnTranslated(sfx);

export const debugPanel = createDebugPanel();

// The location title card the field plays on every stage entry — the area name
// and the place name, typed out over sliding bars. See web/placecard.js.
// The card runs the translated fieldstg routines (F0x80087d68 / F0x80087974 /
// F0x800875ac / F0x80087704 / F0x80087854, engine PlaceCardSession) with the
// disc's name banks for every language.
export const placeCard = createPlaceCardTranslated();

// Native stagslct (gate/area-travel) menu — see web/stagslct.js header for the
// decode. The real in-game trigger for this screen is unresolved (open gap in
// docs/research/ui/stagslct-decoded-2026-07-11.md), so it is reachable only
// through this walker-authored debug entry point, not a claimed original one.
export const stagslctMenu = createStagslctMenu();

// The developers' own SOUND TEST screen (overlay soundtst, decode:
// docs/research/audio/soundtst-full-decode-2026-08-05.md). F2 -> Extras ->
// Sound test, off by default; with the switch off it never opens and owns no
// input. Plays its samples through the residents' packed-sound lookup
// (sfx.playBankSound) and the title theme through the music player.
export const soundTest = createSoundTest({
    sfx,
    music: { play: (track: string) => bgm.play!(track), stop: () => bgm.play!(null) },
});

// Fully translated language screen; the adapter retains its historical name.
// Input contract: engine/dw3/ui/native/country-select-tick.ts (Start / `i`).
export const cntyselNative = createCntyselNative(sfx, bgm);

// Story scene-skipper (dev): jump to any master-ordinal beat. All mutation routes through
// the same game functions a real play uses, so jumps reproduce on-screen behaviour faithfully.
export const sceneSkip = createSceneSkip({
    setOrdinal: (n: number) => {
        state.progressOrdinal = n;
    },
    getOrdinal: () => state.progressOrdinal,
    clearFlag: (id: number) => {
        try {
            if (S.engine) S.engine.state.flags.set(id, false);
        } catch {
            /* virtual bank — skip */
        }
    },
    warpToStage: (stageId: string) => {
        const idx = state.manifest.maps.findIndex((m: ManifestMap) => m.id === stageId);
        if (idx >= 0) loadAndSetMap(idx);
    },
    fireStageEnter: (stageId: string) => checkStageCutscene(stageId),
    talk: (npcId: number) => !!(S.engineBridge && S.engineBridge.onTalk(npcId)),
});

export const editor = createEditor(canvas, () => ({
    grid: state.collision[currentMap().id],
    mapId: currentMap().id,
    camX: lastCam.x,
    camY: lastCam.y,
    zoom: ZOOM,
}));

export const sceneEd = createSceneEditor(canvas, () => ({
    scene: state.scenes[currentMap().id],
    mapId: currentMap().id,
    camX: lastCam.x,
    camY: lastCam.y,
    zoom: ZOOM,
}));

export const state = {
    manifest: null,
    charImgs: {},
    clipImgs: {},
    mapImgs: {},
    mapFgImgs: {}, // stageId -> Image ("_fg" walk-behind overlay; see map_overlays.json)
    mapTiles: {},      // stageId -> {base, fg} TiledMap|null (HD Remaster, map-tiles.js)
    mapNativeImgs: {}, // stageId -> {base, fg} native Images for the terrain effects (HD map with no tiles)
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
    progressTable: null, // assets/data/progress_ordinal.json as loaded (the replay theatre's ladder;
    // NOT state.progressOrdinal, which is the accessor over the engine's $story.ordinal)
    replayLadder: null, // {byStage, names} built once for the replay theatre (web/replay-theatre.js)
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
    // EXPERIMENT (omen): the rate tier the driver last used, mirrored for the field's warning
    // (web/omen.js). Read-only: nothing outside the cue reads it, and the counter above is
    // never written except by the driver's own two lines further down.
    _encLevel: 0,
} as GameState;

// Decoded field assets are intentionally bounded to the current stage and its
// direct exits. Browser HTTP caching still makes revisits cheap, while dropping
// these references lets decoded HD textures and collision grids be reclaimed.
export const retainedStageIds = new Set<string>();

export const readyStageIds = new Set<string>();

export const stageLoadPromises = new Map();

export const mapLoadPromises = new Map();

export const collisionLoadPromises = new Map();

export const spriteLoadPromises = new Map();

export const retainedSpriteIds = new Set();

// Field party Digimon follow the tamer in a conga line via a shared position-history
// ring buffer. followers[0] = the LEAD (= `partner`, the battle-active one);
// followers[1..] = the other pack members. Each
// samples the history at an increasing lag (lead closest).
const partner: Follower = { x: 0, y: 0, dir: "down", animTime: 0, stopping: false, stopTime: 0 };

export const MAX_FOLLOWERS = 3;

export const followers: Follower[] = [
    partner,
    { x: 0, y: 0, dir: "down", animTime: 0, stopping: false, stopTime: 0 },
    { x: 0, y: 0, dir: "down", animTime: 0, stopping: false, stopTime: 0 },
];

export const partnerHistory: TrailPoint[] = [];

export const DIR8_CS = ["down", "down", "left", "left", "up", "up", "right", "right"];

// Populated in-place by init() once findings load; read by the cutscene opts closure.
export const EMOTE_KINDS = {};

export const getNpcResolver = (actorId: number) => {
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
            (n: SceneNpc) => n.npc_id === actorId,
        ) ?? null
    );
};

const cutsceneTextbox = {
    isOpen: () => textbox.isOpen!(),
    open: (parsed: Parameters<NonNullable<typeof fallbackTextbox.open>>[0], onClose: (() => void) | null | undefined) => {
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
            fallbackTextbox.open!(parsed, onClose, () =>
                // textbox draws post-zoom in screen px — scale world coords up.
                e ? { x: (e.x - lastCam.x) * ZOOM, y: (e.y - lastCam.y) * ZOOM, mode } : null);
        if (!S.cutsceneEsdmgRef || line == null) return legacy();
        const project = (x: number, y: number) => ({
            sx: (x - lastCam.x) * ZOOM * (320 / VIEW_W),
            sy: (y - lastCam.y) * ZOOM * (240 / VIEW_H),
        });
        const plain = mode == null || mode === 4;
        S.translatedDialogueText = parsed;
        dialogueBox.open!(
            { esdmg: S.cutsceneEsdmgRef.file, entry: S.cutsceneEsdmgRef.entry, index: line },
            {
                kind: "say", plain, balloonMode: mode ?? 0,
                actor: plain ? null : { x: Math.round(e.x), y: Math.round(e.y), actorId: spk },
            },
            onClose, project,
            { playerNameBytes: encodeNativeScreenText(state.playerName), onFail: legacy },
        );
    },
};

export const cutscene = createCutscene(cutsceneTextbox, () => state, getNpcResolver, {
    // Stages whose cast list builds the player as charId 1 (P001PLAY);
    // tools/extract_player_cast_one.py.
    playerCastOne: () => state.playerCharOne,
    emoteKinds: EMOTE_KINDS,
    movementTerrainCode: (entity: { x: number; y: number; }) => {
        const grid = state.collision[currentMap().id];
        return grid ? terrainCodeAt(grid, entity.x, entity.y) : 0;
    },
    // SETANIM >= 0x320: the stage's own special objects. A translated actor
    // (the s415 rockfall, web/stage-objects.js) consumes the id first, then the
    // native interpreter route, then the generic emote bubbles — the console's
    // registry order, most specific first.
    fireNativeEffect: (id: number, anim: number, facing: number): boolean => {
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
    emoteSound: (id: number, stop: boolean) => {
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
    // The extra quests' own scene events (web/quest-scenes.js `SCENEEVENT <n>`): our effect art, the screen fade, a
    // mid-scene fight, the player's Y drive and a warp. The table is the current quest scene's; the host performs the
    // event and resumes the scene when it is really done (see runQuestSceneEvent).
    sceneEvent: (index: number, resume: () => void) => runQuestSceneEvent(S.questSceneEvents[index], resume),
    spawnActor: (actorId: number) => {
        const scene = state.scenes[currentMap().id];
        if (!scene) return null;
        const pid = state.npcSprites![actorId];
        if (!pid) return null;
        const spr =
            state.manifest.npcs?.find((n: SpriteRecord) => n.id === pid) ??
            state.manifest.characters?.find((c: SpriteRecord) => c.id === pid);
        if (!spr) return null;
        ensureSpriteAssets(spr.id);
        const e = ephemeralActorRecord(actorId, spr.id);
        scene.npcs.push(e);
        return e;
    },
});

// HD Remaster wide overworld (web/field-view.js, F2 -> Screen -> Wide overworld, off by default).
// camK: 1 = the wide camera clamp, 0 = the disc's own; sides: 1 = the extra map at the sides shows,
// 0 = covered. staged: the running scene moves an actor or the camera, so it plays in the original framing.
export const wideField = { camK: 0, sides: 0, dim: 0, staged: false, t: 0, padL: 0 };   // dim: how dark the visible sides are

// screenRouterOptions lives in state.ts (S.screenRouter is built from it at load).

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
export const CLIMB_SPEED = 60; // px/s = +0x100 (1px<<8) per 60fps frame, decoded

// Clip lengths, in ticks at the 60 fps animation clock (build_assets durations):
// clip 28 (0x1c, bottom step-on) 4+4+4+4+3; clip 30 (0x1e, head step-on) 4x5;
// clip 29 (0x1d, top step-off) 3+1x10+6+6; clip 31 (0x1f, bottom step-off) 3+3+3+4.
export const MOUNT_SECS_BOTTOM = 19 / 60;

export const MOUNT_SECS_TOP = 20 / 60;

export const DISMOUNT_SECS_TOP = 25 / 60;

export const DISMOUNT_SECS_BOTTOM = 13 / 60;

// The shared ambush latch (bank 0, bit 15). Read by all fourteen tiles' step
// records and set by the routine that starts the fight; cleared on stage entry.
export const AMBUSH_LATCH_FLAG = 0x0f;

/**
 * The strike's pad bit by the walker's button name: `circle` IS bit 0x2000
 * (engine/systems/input-map.ts `PAD_BIT`), the confirm bit the bobber reads
 * (`STRIKE_BUTTON`). In English that bit is what the physical Cross sends; the
 * button the pad calls circle sends 0x1000 and never strikes (claim
 * `a-fishing-strike-is-the-confirm-button-s-own-bit-2026-10-05`). The same
 * name is the field's confirm press, so the cast and the strike are one button.
 */
export const FISH_STRIKE_BIT = "circle";

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
export const fishFinds = createFishFinds();

// ---------------------------------------------------------------------------
// Tree kicking (engine/systems/tree-kick.ts, tools/extract_tree_kick.py).
//
// With the TreeBoots on, the action button kicks the tree 16 pixels in front of
// you. One tree per stage is live: kick that one and a Digimon drops out and the
// live marker jumps elsewhere; kick any other and a radar card tells you how far
// off the live one is. This is the DEFAULT field handler on PS1 — it only gets
// the button when nothing else (NPC, zone, ladder, door) has claimed it.

export const rand16 = () => Math.floor(Math.random() * 0x10000);

// PRACTICE (F2 -> Extras -> "Practice 2 vs 2", a test, off by default): the many-vs-many fight on one computer, me and a
// computer-played partner against two wild Digimon. The partner is a copy of my own party in another order (my second Digimon
// leads it when I have one); it is not saved and gets nothing. Everything else is the real co-op fight (web/mpbattle.js).
export const PRACTICE_BOT_ID = -1;

// The leader's own sheet, asked for again when render finds it missing. Retained first, because ensureSpriteAssets drops
// an npc-kind image that is not retained (the leader's pack is one); retried at most every 2 s so a failing fetch is not hammered.
export const leaderSheetRetryAt = new Map();

// Draw a map picture at (ox, oy). With its HD tiles only the tiles in view are drawn;
// the native picture goes down underneath until a frame has had every visible tile in.
export const tilesComplete = new Map();   // "<tiled map>:<kind>" -> last frame drew every visible tile

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
export const _REV_DIR: Record<string, string> = { up: "down", down: "up", left: "right", right: "left" };

// Durable home of the engine's per-event `once` bits. The original keeps a once-only
// entry's fired marker in the save context, so a stage-entry or talk cutscene fires
// once and never again across Continue/reload. Seeded in initEngine from
// localStorage and cleared by New Game.
export const engineEventDone = new Set();

// The stored-bit backend for storyFlags: delegates to the engine FlagManager so there is ONE
// banked store. set() guards virtual banks (FlagManager throws on those) and persists via the
// engine's onChange (registered in initEngine). Reads clear (0) before the engine exists.
const flagBackend = {
    get: (id: number) => (S.engine ? (S.engine.state.flags.get(id, 1) ? 1 : 0) : 0),
    set: (id: number, val: number | boolean) => {
        if (S.engine) {
            try {
                S.engine.state.flags.set(id, !!val);
            } catch {
                /* virtual bank: not stored */
            }
        }
    },
};

// storyFlags = the TRI-STATE gating adapter (flag-store.js) over the engine store. The
// spawn-gate (chapterNpcs) and the OnStep trigger-system both read it; `null` = unmodelled
// bank stays dormant. getOrdinal reads the engine's $story.ordinal (the single ordinal).
export const storyFlags = createFlagStore(flagBackend, {
    getOrdinal: () =>
        S.engine ? Number(S.engine.state.vars.get("$story.ordinal") ?? 0) : 0,
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
        S.engine ? Number(S.engine.state.vars.get("$roster.owned") ?? 0) : 0,
    // Per-slot partner LEVELS for the bank-0x70 op-0x10 case-7 predicate (0x7095:
    // every OBTAINED slot at level 45+ — the walkthrough's "all 8 partners at
    // level 45+" gate on the post-game circuit-board cast). A slot's record is
    // resolved exactly as the DRI resolves it (web/dri-native.js slotStats): the
    // deployed party's live blocks or the reserve store. An obtained slot with no
    // record stays out of the map, which keeps the predicate dormant (null)
    // rather than inventing a level — the walker's never-a-false-spawn rule.
    partnerLevels: () => {
        const levels = new Map();
        const mask = Number(state.rosterOwned) || 0;
        for (let slot = 0; slot < 8; slot++) {
            if (!((mask >> slot) & 1)) continue;
            const rec = slotStats(state, slot);
            if (rec && Number.isFinite(Number(rec.level))) levels.set(slot, Number(rec.level));
        }
        return levels;
    },
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

// Apply one decoded {id, expected} set_flag. Collection-bank (0x80–0x92) sets ARE item
// grants in the faithful model (npc-decode.md): "set collection[bit]=1" means the item
// entered the bag. The engine FlagManager can't store those (virtual bank), so we mirror
// the possession into state.inventory — that's what hasItem/gates/the menu read.
export const COLLECTION_BANK_IDS = new Set([
    0x80, 0x82, 0x84, 0x86, 0x88, 0x8a, 0x8c, 0x8e,
]);

// Bank 0x92 is the CARD collection, not the item bag — corrected 2026-08-14.
// The resident dispatcher routes it to F0x80016314(cardId, value), which gives
// one copy when the value is non-zero and takes one when it is zero; the item
// banks 0x80..0x8e go somewhere else entirely (F0x800161d8). Writing a card
// grant into the bag was silently adding a phantom ITEM with the card's id and
// never adding the card. 30 dialogue states across 9 stages use this bank.
// — CARD-COLLECTION-ENTRY-POINTS-2026-08-14, CARD-STORY-GRANTS-2026-08-14
export const CARD_COLLECTION_BANK = 0x92;

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
export const AUCTION_STAGE = "s260";

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
export const isSavePointHandoffId = (id: number) => id >= 0xc01 && id <= 0xc19;

// Joystick. The Gamepad API has no press events, so the pad is read once per
// frame in `frame()` and diffed; a press is fed to the SAME dispatcher the
// keyboard uses, and held buttons go into the same `state.keys` the field polls.
// A stub event stands in for the KeyboardEvent — a pad has no `code`, `key` or
// `shiftKey`, which is exactly why the dev-tool branches above cannot fire.
const PAD_EVENT = { preventDefault() {}, repeat: false, code: "", key: "", shiftKey: false };

export const gamepad = attachGamepad({
    heldKeys: state.keys,
    onPress: (button) => {
        bgm.unlock!(); sfx.unlock!();
        if (S.titleInput) { S.titleInput(button); return; }
        if (!state.started) return;
        if (mpbVisible()) { mpbKey(button); return; }   // the 2 vs 2 fight owns the pad: it drives the battle cursor, not the overworld
        dispatchInput(button, PAD_EVENT, "");
    },
});

export let fpsGaps: number[] = [];

// Fallback for sprites (NPCs) whose row list doesn't include diagonal directions
export const _DIR_FALLBACK: Record<string, string> = {
    "down-left": "left",
    "down-right": "right",
    "up-left": "left",
    "up-right": "right",
};

// Unit vectors for the "V" debug overlay's facing arrow.
export const _DIR8_VEC: Record<string, [number, number]> = {
    down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0],
    "down-left": [-0.7, 0.7], "down-right": [0.7, 0.7],
    "up-left": [-0.7, -0.7], "up-right": [0.7, -0.7],
};

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
export const FISH_BAR_X = 0x18;

export const FISH_BAR_Y = 0xc0;

export const FISH_BAR_FRAME = 0x3c;

export const FISH_BAR_MARKER = 0x3d;

export const FISH_BAR_TRACK = 0x3e;
