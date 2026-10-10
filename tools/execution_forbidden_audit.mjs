// The repo-wide execution-forbidden MEASUREMENT.
//
// tests/shop-execution-forbidden.test.js proved ONE screen (the merchant) runs
// our translated code and links no interpreter. This turns that one-off proof
// into a measurement over every player-facing screen and system: for each
// surface it bundles the ORDINARY route's entry point (the code the game
// selects with no query flag and no research switch), inspects the reachable
// `engine/native/**` module set the same way the shop test does, and classifies
// the route as one of:
//
//   ours                  ordinary route reaches only data/device modules; no
//                         interpreter adapter exists for the surface at all;
//   switch-gated-only     ordinary route is clean, but an interpreter adapter
//                         survives behind an explicit query switch (?nativeX=1);
//   interpreter-reachable the ordinary route itself reaches the interpreter —
//                         the original overlay or CPU can execute in normal play.
//
// "interpreter-reachable" is not a guess: the reachable module set is read out
// of the esbuild metafile for the entry point, exactly as the shop test reads
// it for its controllers. The deciding file:line for every surface is located
// in the source (not hand-numbered), so a moved route fails loudly rather than
// silently pointing at a stale line.
//
// WHAT COUNTS AS THE INTERPRETER
// engine/native/memory.ts is the flat RAM buffer (a data store); engine/native/
// vram.ts is the console's LoadImage VRAM-upload record (a device boundary).
// Neither executes instructions, so both are ALLOWED. Every other engine/native
// module is forbidden in an ordinary route: mips.ts (the R3000 CPU), runtime.ts
// (the stepper), stubs.ts (the BIOS/HLE calls the stepped code makes), bridge.ts
// (the host services original code is handed), and the supporting device/prims
// modules the native runtime pulls in.
//
// Usage:
//   node tools/execution_forbidden_audit.mjs            write JSON + markdown
//   node tools/execution_forbidden_audit.mjs --check    exit 1 if a measurement
//                                                       drifted from EXPECTED
import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** engine/native modules that execute no instructions: a data store and a device record. */
export const ALLOWED_NATIVE = new Set([
  "engine/native/memory.ts", // the flat RAM buffer (data)
  "engine/native/vram.ts",   // the LoadImage VRAM-upload record (device boundary)
]);

/** The modules that actually execute / drive / host original machine code. */
export const INTERPRETER_EXECUTION = new Set(["engine/native/mips.ts", "engine/native/runtime.ts", "engine/native/stubs.ts"]);
export const INTERPRETER_HOST = new Set(["engine/native/bridge.ts"]);

export const CLASSES = ["ours", "switch-gated-only", "interpreter-reachable"];

// The interpreter's classes as esbuild emits them into a bundle. A doc comment
// that merely NAMES one of these (several translated modules cite
// `engine/native/runtime.ts` in prose) cannot match `var X = class`, so this
// distinguishes the interpreter CODE in a built artefact from a mention of it.
export const INTERPRETER_MARKERS = [
  /\bvar\s+R3000\s*=\s*class\b/,            // engine/native/mips.ts
  /\bvar\s+NativeStageRuntime\s*=\s*class\b/, // engine/native/runtime.ts
  /\bvar\s+StubWorld\s*=\s*class\b/,          // engine/native/stubs.ts
];

/** Does a built bundle's text contain the interpreter CODE? */
export function containsInterpreterSource(src) {
  return INTERPRETER_MARKERS.some((re) => re.test(src));
}

// One shipped screen (or the field, or a system) and how its ORDINARY route is
// selected. `decision` is a unique substring of the line that chooses the
// default; the harness resolves its file:line. `entry` is the module the shop
// test would bundle: the translated controller for an ours/switch-gated screen,
// or engine/native/runtime.ts for a route that executes the original overlay.
export const SURFACES = [
  // ---- screens whose ordinary route is a translated controller ------------
  {
    id: "stitshop", kind: "screen", title: "Item / armory / pawn shop",
    entry: "engine/dw3/ui/shop-root-session.ts",
    decision: { file: "web/game.js", contains: "USE_NATIVE_SHOP ? createShopNative" },
    reference: { adapter: "web/shop-native.js", flag: "nativeShop" },
    verifier: "tools/verify_translated_shop.mjs",
    expected: "ours",
  },
  {
    id: "stcrdshp", kind: "screen", title: "Card shop",
    entry: "engine/dw3/ui/card-shop-session.ts",
    decision: { file: "web/game.js", contains: "? cardShopNative : cardShopTranslated" },
    reference: { adapter: "web/cardshop-native.js", flag: "nativeCardShop" },
    verifier: "tools/verify_translated_cardshop.mjs",
    expected: "ours",
  },
  {
    id: "stgtrain", kind: "screen", title: "Training gym",
    entry: "engine/dw3/ui/gym-session.ts",
    decision: { file: "web/game.js", contains: "USE_NATIVE_GYM ? (USE_REFERENCE_GYM" },
    reference: { adapter: "web/gym-native.js", flag: "nativeGym" },
    verifier: "tools/verify_translated_gym.mjs",
    expected: "ours",
  },
  {
    id: "stgdglab", kind: "screen", title: "Digimon Lab",
    entry: "engine/dw3/ui/lab-session.ts",
    decision: { file: "web/game.js", contains: "USE_REFERENCE_LAB ? createDriNative(sfx) : createLabTranslated(sfx)" },
    reference: { adapter: "web/dri-native.js", flag: "nativeLab" },
    verifier: "tools/verify_translated_lab.mjs",
    expected: "ours",
  },
  {
    id: "ststatus", kind: "screen", title: "Pause / STATUS pages",
    entry: "engine/dw3/ui/pause-root-session.ts",
    decision: { file: "web/game.js", contains: "USE_REFERENCE_STATUS ? createStatusNative" },
    reference: { adapter: "web/status-native.js", flag: "nativeStatus" },
    verifier: "tools/verify_translated_pause.mjs",
    expected: "ours",
  },
  {
    id: "stdgname", kind: "screen", title: "Partner naming",
    entry: "engine/dw3/ui/name-root-session.ts",
    decision: { file: "web/game.js", contains: "const nameEntryNative = USE_REFERENCE_NAME" },
    reference: { adapter: "web/nameentry-native.js", flag: "nativeName" },
    verifier: "tools/verify_translated_naming.mjs",
    expected: "ours",
  },
  {
    id: "stplnmet", kind: "screen", title: "Registration wizard",
    entry: "engine/dw3/ui/wizard-root-session.ts",
    decision: { file: "web/game.js", contains: "USE_REFERENCE_PACK ? createPackSelectNative(sfx) : createPackSelectTranslated(sfx)" },
    reference: { adapter: "web/packselect-native.js", flag: "nativePack" },
    verifier: "tools/verify_translated_packselect.mjs",
    expected: "ours",
  },
  {
    id: "stdwtitl", kind: "screen", title: "Title screen",
    entry: "engine/dw3/ui/title-session.ts",
    decision: { file: "web/game.js", contains: "const newTitle = () => USE_NATIVE_TITLE" },
    reference: { adapter: "web/title-native.js", flag: "nativeTitle" },
    verifier: "tools/verify_translated_title.mjs",
    expected: "ours",
  },
  {
    id: "stgmcard", kind: "screen", title: "Save / Load memory card",
    entry: "engine/dw3/ui/memcard-session.ts",
    decision: { file: "web/game.js", contains: "saveScreenNative = USE_REFERENCE_SAVE ? createSaveNative" },
    reference: { adapter: "web/save-native.js", flag: "nativeSave" },
    verifier: "tools/verify_translated_save.mjs",
    expected: "ours",
  },
  {
    id: "stfgtrep", kind: "screen", title: "Victory report",
    entry: "engine/dw3/ui/fight-report-session.ts",
    decision: { file: "web/game.js", contains: "fightReportNative = USE_REFERENCE_REPORT" },
    reference: { adapter: "web/fightreport-native.js", flag: "nativeReport" },
    verifier: "tools/verify_translated_report.mjs",
    expected: "ours",
  },
  {
    id: "cnty_sel", kind: "screen", title: "Language selection",
    entry: "engine/dw3/ui/country-screen.ts",
    decision: { file: "web/game.js", contains: "const USE_NATIVE_CNTYSEL = !GYM_PARAMS.has(\"legacyCntysel\")" },
    reference: null,
    verifier: "tools/verify_translated_language.mjs",
    expected: "ours",
  },
  {
    id: "fightstg", kind: "screen", title: "Battle command list",
    entry: "engine/dw3/ui/fight-command-session.ts",
    decision: { file: "web/battle.js", contains: "const commandNative = USE_REFERENCE_COMMAND" },
    reference: { adapter: "web/battlecmd-native.js", flag: "nativeBattleCmd" },
    verifier: "tools/verify_translated_battlecmd.mjs",
    expected: "ours",
  },
  {
    id: "wfightmn", kind: "screen", title: "Battle scene loader",
    entry: "engine/dw3/ui/wfight-loader-session.ts",
    decision: { file: "web/battle.js", contains: "const wfightNative = USE_REFERENCE_WFIGHT" },
    reference: { adapter: "web/wfightmn-native.js", flag: "nativeWfight" },
    verifier: "tools/verify_translated_wfight.mjs",
    expected: "ours",
  },
  {
    id: "battle-tech", kind: "screen", title: "Battle TECH list",
    entry: "engine/dw3/ui/fight-tech-session.ts",
    decision: { file: "web/battle.js", contains: "const techNative = createBattleTechTranslated" },
    reference: null, verifier: null, expected: "ours",
  },
  {
    id: "battle-item", kind: "screen", title: "Battle ITEM list",
    entry: "engine/dw3/ui/fight-item-session.ts",
    decision: { file: "web/battle.js", contains: "const itemNative = createBattleItemTranslated" },
    reference: null, verifier: null, expected: "ours",
  },
  {
    id: "battle-tag", kind: "screen", title: "Battle TAG partner list",
    entry: "engine/dw3/ui/fight-tag-session.ts",
    decision: { file: "web/battle.js", contains: "const tagNative = createBattleTagTranslated" },
    reference: null, verifier: null, expected: "ours",
  },
  {
    id: "battle-form", kind: "screen", title: "Battle Digivolve form list",
    entry: "engine/dw3/ui/fight-form-session.ts",
    decision: { file: "web/battle.js", contains: "const formNative = createBattleFormTranslated" },
    reference: null, verifier: null, expected: "ours",
  },
  {
    id: "battle-dna", kind: "screen", title: "Battle DNA / Tag follow-up",
    entry: "engine/dw3/ui/fight-dna-session.ts",
    decision: { file: "web/battle.js", contains: "const dnaNative = createBattleDnaTranslated" },
    reference: null, verifier: null, expected: "ours",
  },
  {
    id: "battle-msg", kind: "screen", title: "Battle message line",
    entry: "engine/dw3/ui/battle-message-session.ts",
    decision: { file: "web/battle.js", contains: "const msgSession = USE_TRANSLATED_MSG" },
    reference: null, verifier: null, expected: "ours",
  },
  {
    id: "battle-hud", kind: "screen", title: "Battle HP plate",
    entry: "engine/dw3/ui/native/battle-hud.ts",
    decision: { file: "web/battle.js", contains: "translatedBattleHudEnabled(location.search)" },
    reference: null, verifier: null, expected: "ours",
  },
  {
    id: "dialogue", kind: "screen", title: "Field conversation box",
    entry: "engine/dw3/ui/dialogue-session.ts",
    decision: { file: "web/game.js", contains: "const dialogueBox = createDialogueTranslated(sfx)" },
    reference: null, verifier: "tools/verify_dialogue_talk.mjs", expected: "ours",
  },
  {
    id: "yesno", kind: "screen", title: "Field Yes / No box",
    entry: "engine/dw3/ui/yesno-session.ts",
    decision: { file: "web/game.js", contains: "const yesNoBox = createYesNoTranslated(sfx)" },
    reference: null, verifier: null, expected: "ours",
  },
  {
    id: "help-menu", kind: "screen", title: "Help menu (eight topics)",
    entry: "engine/dw3/ui/help-menu-session.ts",
    decision: { file: "web/game.js", contains: "const helpMenuBox = createHelpMenuTranslated(sfx)" },
    reference: null, verifier: null, expected: "ours",
  },
  {
    id: "endcard", kind: "screen", title: "END card",
    entry: "engine/dw3/ui/end-card-session.ts",
    decision: { file: "web/game.js", contains: "const endCard = USE_LEGACY_END" },
    reference: null, verifier: "tools/verify_endscreen.mjs", expected: "ours",
  },
  {
    id: "placecard", kind: "screen", title: "Place title card",
    entry: "engine/dw3/ui/place-card-session.ts",
    decision: { file: "web/game.js", contains: "const placeCard = USE_LEGACY_PLACE_CARD" },
    reference: null, verifier: null, expected: "ours",
  },
  {
    id: "inn", kind: "screen", title: "Inn rest screen",
    entry: "engine/dw3/ui/inn-session.ts",
    decision: { file: "web/game.js", contains: "const inn = new URLSearchParams(location.search).has(\"legacyInn\")" },
    reference: null, verifier: null, expected: "ours",
  },
  // ---- screens whose ordinary route executes the original overlay ---------
  {
    id: "stcrdabm", kind: "screen", title: "Card Album",
    // The album's ordinary route is the translated AlbumSession
    // (engine/dw3/ui/album-session.ts over the pro/stcrdabm controllers); the
    // shipped overlay is the ?nativeAlbum=1 research reference.
    entry: "engine/dw3/ui/album-session.ts",
    decision: { file: "web/game.js", contains: "GYM_PARAMS.has(\"nativeAlbum\") ? cardAlbumNative : cardAlbumTranslated" },
    reference: { adapter: "web/cardalbum-native.js", flag: "nativeAlbum" },
    expected: "ours",
  },
  {
    id: "stcrddek", kind: "screen", title: "Card folder editor",
    // The folder chooser's ordinary route is the translated FolderSession
    // (engine/dw3/ui/folder-session.ts over the pro/stcrddek folder-list
    // controllers); the shipped overlay is the ?nativeFolder=1 research
    // reference. The editor's card grid and name keyboard are not translated
    // yet and the session names them as such.
    entry: "engine/dw3/ui/folder-session.ts",
    decision: { file: "web/game.js", contains: "GYM_PARAMS.has(\"nativeFolder\") ? cardDeckNative : cardDeckTranslated" },
    reference: { adapter: "web/carddeck-native.js", flag: "nativeFolder" },
    expected: "ours",
  },
  {
    id: "cardgame", kind: "screen", title: "Card duel",
    entry: "engine/native/runtime.ts", nativeDriver: true,
    decision: { file: "web/game.js", contains: "USE_NATIVE_DUEL ? cardDuelNative : cardDuelLegacy" },
    reference: null, verifier: null, expected: "interpreter-reachable",
  },
  {
    id: "field", kind: "screen", title: "Field / stage ambience",
    // The field is not one screen controller: its ORDINARY ambience is the
    // union of the translated stage-object actor modules. Bundling all of them
    // proves no stray import reaches the interpreter -- the same measurement the
    // shop test makes of its controllers, generalised to a module set.
    entries: [
      "engine/systems/point-record-actor.ts",
      "engine/systems/falling-object.ts",
      "engine/systems/street-vehicles.ts",
      "engine/systems/street-screens.ts",
      "engine/systems/street-lights.ts",
      "engine/systems/stinger-popup.ts",
      "engine/systems/stage-fixed-sprite.ts",
      "engine/systems/stage-slot-player.ts",
      "engine/systems/stage-slot-ensemble.ts",
      "engine/systems/shape-annotator.ts",
      "engine/systems/draw-context.ts",
      "engine/systems/field-character.ts",
      // The field camera (leader centred at native (160,140)) and the sixteen-
      // ordinal scene variant (the story beats that boot the background a second
      // way) also run on the ordinary field route: web/game.js calls
      // fieldCameraFollow (web/game.js:7913) and sceneBgmTrack (web/game.js:3936)
      // with no flag at all. They are engine/systems modules, so the field
      // surface's interpreter-free proof must bundle them too.
      "engine/systems/field-camera.ts",
      "engine/systems/ordinal-scene-variant.ts",
    ],
    decision: { file: "web/game.js", contains: "enterNativeStage(mapId, {" },
    reference: { adapter: "web/native-stage.js", flag: "nativeStages" },
    verifier: "tools/verify_translated_field_ambience.mjs",
    expected: "ours",
  },
  // ---- systems, classified by the same measurement ------------------------
  {
    id: "system:shops", kind: "system", title: "shops",
    entry: "engine/dw3/ui/shop-root-session.ts",
    decision: { file: "web/game.js", contains: "USE_NATIVE_SHOP ? createShopNative" },
    reference: { adapter: "web/shop-native.js", flag: "nativeShop" },
    expected: "ours",
  },
  {
    id: "system:card-battle", kind: "system", title: "card-battle",
    // The card battle's ORDINARY route is our translated card code: the Album
    // and folder sessions over the pro/stcrdabm and pro/stcrddek controllers and
    // the card-effect VM / ceremony / view / inspect services. The three card
    // SCREENS are separate surfaces, measured as components below, because one
    // of them (the card duel) still runs the shipped overlay with no flag.
    entry: [
      "engine/dw3/ui/album-session.ts",
      "engine/dw3/ui/folder-session.ts",
      "engine/systems/card-battle.ts",
      "engine/systems/card-effect-vm.ts",
      "engine/systems/card-ceremony.ts",
      "engine/systems/card-view.ts",
      "engine/systems/card-inspect.ts",
    ],
    decision: { file: "web/game.js", contains: "GYM_PARAMS.has(\"nativeAlbum\") ? cardAlbumNative : cardAlbumTranslated" },
    expected: "ours",
    components: [
      {
        id: "card-battle:album", kind: "component", title: "Card Album screen",
        entry: "engine/dw3/ui/album-session.ts",
        decision: { file: "web/game.js", contains: "GYM_PARAMS.has(\"nativeAlbum\") ? cardAlbumNative : cardAlbumTranslated" },
        expected: "ours",
      },
      {
        id: "card-battle:folder", kind: "component", title: "Card folder editor screen",
        entry: "engine/dw3/ui/folder-session.ts",
        decision: { file: "web/game.js", contains: "GYM_PARAMS.has(\"nativeFolder\") ? cardDeckNative : cardDeckTranslated" },
        expected: "ours",
      },
      {
        id: "card-battle:duel", kind: "component", title: "Card duel screen",
        entry: "web/cardduel-native.js",
        decision: { file: "web/game.js", contains: "const cardDuel = USE_NATIVE_DUEL ? cardDuelNative : cardDuelLegacy" },
        expected: "interpreter-reachable",
      },
    ],
  },
  {
    id: "system:digivolution", kind: "system", title: "digivolution",
    entry: "engine/dw3/ui/lab-session.ts",
    decision: { file: "web/game.js", contains: "USE_REFERENCE_LAB ? createDriNative(sfx) : createLabTranslated(sfx)" },
    reference: { adapter: "web/dri-native.js", flag: "nativeLab" },
    expected: "ours",
  },
  {
    id: "system:gym-training", kind: "system", title: "gym-training",
    entry: "engine/dw3/ui/gym-session.ts",
    decision: { file: "web/game.js", contains: "USE_NATIVE_GYM ? (USE_REFERENCE_GYM" },
    reference: { adapter: "web/gym-native.js", flag: "nativeGym" },
    expected: "ours",
  },
  {
    id: "system:inn", kind: "system", title: "inn",
    entry: "engine/dw3/ui/inn-session.ts",
    decision: { file: "web/game.js", contains: "const inn = new URLSearchParams(location.search).has(\"legacyInn\")" },
    expected: "ours",
  },
  {
    id: "system:battle", kind: "system", title: "battle",
    entry: "engine/dw3/ui/fight-command-session.ts",
    decision: { file: "web/battle.js", contains: "const commandNative = USE_REFERENCE_COMMAND" },
    reference: { adapter: "web/battlecmd-native.js", flag: "nativeBattleCmd" },
    expected: "ours",
  },
  {
    id: "system:save-load", kind: "system", title: "save-load",
    entry: "engine/dw3/ui/memcard-session.ts",
    decision: { file: "web/game.js", contains: "saveScreenNative = USE_REFERENCE_SAVE ? createSaveNative" },
    reference: { adapter: "web/save-native.js", flag: "nativeSave" },
    expected: "ours",
  },
  {
    id: "system:ui-chrome", kind: "system", title: "ui-chrome",
    // The chrome's own ORDINARY routes are our translated menus, dialogue,
    // yes/no, help, name entry, status, title and country screens (and the
    // Album and folder sessions). The card SCREENS are measured as components:
    // the Album and folder editor are ours, the card duel still runs the
    // shipped overlay on the ordinary route.
    entry: [
      "engine/dw3/ui/album-session.ts",
      "engine/dw3/ui/folder-session.ts",
      "engine/dw3/ui/pause-root-session.ts",
      "engine/dw3/ui/name-root-session.ts",
      "engine/dw3/ui/title-session.ts",
      "engine/dw3/ui/country-screen.ts",
      "engine/dw3/ui/help-menu-session.ts",
      "engine/dw3/ui/dialogue-session.ts",
      "engine/dw3/ui/yesno-session.ts",
      "engine/dw3/ui/end-card-session.ts",
      "engine/dw3/ui/place-card-session.ts",
      "engine/dw3/ui/inn-session.ts",
    ],
    decision: { file: "web/game.js", contains: "GYM_PARAMS.has(\"nativeFolder\") ? cardDeckNative : cardDeckTranslated" },
    expected: "ours",
    components: [
      {
        id: "ui-chrome:album", kind: "component", title: "Card Album screen",
        entry: "engine/dw3/ui/album-session.ts",
        decision: { file: "web/game.js", contains: "GYM_PARAMS.has(\"nativeAlbum\") ? cardAlbumNative : cardAlbumTranslated" },
        expected: "ours",
      },
      {
        id: "ui-chrome:folder", kind: "component", title: "Card folder editor screen",
        entry: "engine/dw3/ui/folder-session.ts",
        decision: { file: "web/game.js", contains: "GYM_PARAMS.has(\"nativeFolder\") ? cardDeckNative : cardDeckTranslated" },
        expected: "ours",
      },
      {
        id: "ui-chrome:duel", kind: "component", title: "Card duel screen",
        entry: "web/cardduel-native.js",
        decision: { file: "web/game.js", contains: "const cardDuel = USE_NATIVE_DUEL ? cardDuelNative : cardDuelLegacy" },
        expected: "interpreter-reachable",
      },
    ],
  },
  {
    id: "system:quest-events", kind: "system", title: "quest-events",
    // The field's ordinary route is our translated event handlers
    // (engine/systems/native-event-families.ts dispositions 67 of the 69 native
    // events to translated handlers; the other 2 are s810's, whose type-7
    // layout is open). The stage overlay is entered only on the ?nativeStages
    // research route: the flag line below is the decision.
    entry: [
      "engine/systems/native-event-families.ts",
      "engine/systems/dungeon-switch.ts",
      "engine/systems/trigger-system.ts",
    ],
    decision: { file: "web/game.js", contains: "const USE_NATIVE_STAGE = new URLSearchParams(location.search).has(\"nativeStages\")" },
    reference: { adapter: "web/native-stage.js", flag: "nativeStages" },
    expected: "ours",
  },
  {
    id: "system:world-exploration", kind: "system", title: "world-exploration",
    // The field's ordinary route runs our translated maps, actors and ambience
    // (the same module set the field surface bundles); the stage overlay is a
    // ?nativeStages research route only.
    entry: [
      "engine/systems/point-record-actor.ts",
      "engine/systems/falling-object.ts",
      "engine/systems/street-vehicles.ts",
      "engine/systems/street-screens.ts",
      "engine/systems/street-lights.ts",
      "engine/systems/stinger-popup.ts",
      "engine/systems/stage-fixed-sprite.ts",
      "engine/systems/stage-slot-player.ts",
      "engine/systems/stage-slot-ensemble.ts",
      "engine/systems/shape-annotator.ts",
      "engine/systems/draw-context.ts",
      "engine/systems/field-character.ts",
      "engine/systems/cast-list.ts",
      "engine/systems/block-actor.ts",
      // The field's own camera and sixteen-ordinal scene variant joined the
      // ordinary route tonight (web/game.js:7913,3936); bundling them here keeps
      // the world-exploration proof over the modules the route now runs.
      "engine/systems/field-camera.ts",
      "engine/systems/ordinal-scene-variant.ts",
    ],
    decision: { file: "web/game.js", contains: "const USE_NATIVE_STAGE = new URLSearchParams(location.search).has(\"nativeStages\")" },
    reference: { adapter: "web/native-stage.js", flag: "nativeStages" },
    expected: "ours",
  },
  {
    id: "system:story-gating", kind: "system", title: "story-gating",
    // The gate logic ships translated (engine/systems/story-command-banks.ts);
    // its ordinary-route host is the field, which runs our code with the
    // overlay behind the ?nativeStages research switch.
    entry: [
      "engine/systems/story-command-banks.ts",
      "engine/systems/trigger-system.ts",
    ],
    decision: { file: "web/game.js", contains: "const USE_NATIVE_STAGE = new URLSearchParams(location.search).has(\"nativeStages\")" },
    reference: { adapter: "web/native-stage.js", flag: "nativeStages" },
    expected: "ours",
  },
  {
    // ---- tonight's new ordinary route: the fight you watch ----
    // The battle's 3-D presentation, action and effect layer used to be hand-
    // written browser code; tonight its bodies were ported (engine/dw3/
    // battle-mesh.ts, battle-camera.ts, battle-idle-director.ts, the action VM's
    // opcodes/handlers/dispatcher, the reaction machine and the effect/projectile
    // drivers). The ordinary battle route now consumes those ports through the
    // production bundle web/vendor/engine.js -- web/battle3d.js and web/fight/*.js
    // import them with no flag (web/battle3d.js:25 is where the ported
    // presentation is pulled in). The catalog carries this as its own system,
    // `battle-3d` ("the fight's 3D presentation layer"), which this audit had
    // listed as a logic system with no player-facing screen route. That reading is
    // now wrong: the 3-D fight is exactly what a player watches, and it is on the
    // ordinary route, so it is measured here. The action/effect modules sit with
    // the `battle` catalog system rather than `battle-3d`, but they are one
    // ordinary-route layer and are bundled together so a single stray
    // engine/native import anywhere in the layer is caught.
    id: "battle-3d", kind: "system", title: "battle-3d",
    // `entry` is the list of PORT modules this surface claims (the mechanisms the
    // night ported). Bundling them proves they are interpreter-free -- and says
    // NOTHING about whether the page imports them. `routeEntry` is the ORDINARY
    // route's own entry (web/battle3d.js, which statically pulls in web/fight/*.js);
    // the audit walks its static import graph and reports, per port module, whether
    // the route actually consumes it (see measureSurface's `consumption`). A port
    // the page does not import is UNCONSUMED and is never credited to the surface.
    entry: [
      "engine/dw3/battle-presentation.ts",
      "engine/dw3/battle-mesh.ts",
      "engine/dw3/battle-camera.ts",
      "engine/dw3/battle-idle-director.ts",
      "engine/dw3/battle-slot-motion.ts",
      "engine/dw3/battle-timeline-sampler.ts",
      "engine/dw3/battle-actor-animation.ts",
      "engine/dw3/battle-actor-lifecycle.ts",
      "engine/dw3/battle-actor-pool.ts",
      "engine/dw3/battle-task-spawn.ts",
      "engine/dw3/battle-action-dispatcher.ts",
      "engine/dw3/battle-action-handlers.ts",
      "engine/dw3/battle-action-opcodes.ts",
      "engine/dw3/battle-reaction-dispatch.ts",
      "engine/dw3/battle-effects.ts",
      "engine/dw3/battle-effect-driver.ts",
      "engine/dw3/battle-effect-driver-host.ts",
      "engine/dw3/battle-effect-spawn.ts",
      "engine/dw3/battle-effect-tint.ts",
      "engine/dw3/battle-projectile.ts",
      // The four fight mechanisms wired onto the ordinary route on 2026-10-06: the
      // slow-motion stepper (web/battle3d.js), and the HUD bezel cel draw, the
      // enemy-id resolver and the steal roll (web/battle.js, and battlehud-translated.js
      // for the resolver). All four are listed as ports so the consumed column reports
      // whether the ordinary route runs them -- see the routeEntry below.
      "engine/dw3/battle-slow-motion.ts",
      "engine/dw3/battle-cel-draw.ts",
      "engine/dw3/battle-enemy-id.ts",
      "engine/dw3/battle-steal-roll.ts",
      "engine/dw3/gte-math.ts",
    ],
    // The ordinary fight route is TWO entries: web/battle3d.js (the 3-D presentation,
    // which statically pulls in web/fight/*.js and the slow-motion port) and
    // web/battle.js (the ordinary battle menu/HUD layer, which imports the cel draw,
    // enemy-id resolver and steal roll ports and statically pulls in
    // web/battlehud-translated.js). Walking only battle3d.js left three of the four
    // newly wired ports invisible to the consumed column.
    routeEntry: ["web/battle3d.js", "web/battle.js", "web/battlehud-translated.js"],
    decision: { file: "web/battle3d.js", contains: "arenaPlacement, patchCopyRect, ARENA_BASE_Z" },
    expected: "ours",
  },
  {
    id: "system:resident-core", kind: "system", title: "resident-core",
    // This system IS the interpreter: it is entered only through the single
    // dynamic door, so its reach is real, not a route placeholder.
    entry: "engine/native/runtime.ts",
    decision: { file: "web/native-runtime.js", contains: "promise = import(\"./vendor/engine-native.js\")" },
    expected: "interpreter-reachable",
  },
];

// The systems catalog has 35 rows; a logic system with no player-facing screen
// route is not a screen measurement. They are listed so the denominator is
// explicit, and marked n/a rather than falsely "ours".
export const LOGIC_SYSTEMS = [
  "arena-tournaments", "audio", "battle-model-data", "battle-scene-test",
  "blast-digivolution", "charisma", "dna-digivolution", "elemental", "engine-resource",
  "equipment", "exp-leveling", "field-character-shadow", "fishing", "input", "items",
  "party-management", "post-game", "random-encounters", "rendering-2d", "stat-growth",
  "status-effects", "technique-loading",
];

/** Locate the deciding line in a source file, as {file, line, text}. */
export function locateDecision({ file, contains }) {
  const path = join(ROOT, file);
  const lines = readFileSync(path, "utf8").split("\n");
  const idx = lines.findIndex((line) => line.includes(contains));
  if (idx < 0) throw new Error(`decision line not found: ${file} does not contain ${JSON.stringify(contains)}`);
  return { file, line: idx + 1, text: lines[idx].trim() };
}

/** The esbuild metafile inputs for a bundle of `entry` (metafile, as the shop test). */
export async function bundleInputs(entry) {
  // A surface is one system, and a system can be several modules: `entry` is a
  // single path, `entries` a list (the field's translated ambience is the union
  // of the actor modules, so no single module hides a stray import).
  const entryPoints = (Array.isArray(entry) ? entry : [entry]).map((p) => join(ROOT, p));
  const result = await build({
    entryPoints,
    outdir: "/tmp/execution-forbidden-audit",
    bundle: true, write: false, metafile: true, format: "esm", logLevel: "silent",
  });
  return result.metafile.inputs;
}

/** The engine/native modules a bundle of `entry` can reach (metafile, as the shop test). */
export async function reachableNative(entry) {
  return Object.keys(await bundleInputs(entry))
    .filter((path) => path.startsWith("engine/native/"))
    .sort();
}

/**
 * The interpreter files a bundle of `entry` reaches through ANY import kind -
 * static AND the single dynamic door (web/native-runtime.js -> the research
 * bundle). This is the honest per-route measurement after the bundle split:
 * `reachableNative` sees only engine/native/** SOURCE modules, so a route that
 * enters the original overlay through the built research bundle
 * (web/vendor/engine-native.js) would look clean to it. A route that reaches
 * that file boots the PlayStation interpreter when its default branch runs.
 */
export async function reachableInterpreter(entry) {
  const inputs = await bundleInputs(entry);
  return Object.keys(inputs)
    .filter((path) => /engine-native\.js$/.test(path)
      || /engine\/native\/(mips|runtime|stubs|bridge|raw-prims|device-ports|screen-heap)\.ts$/.test(path))
    .sort();
}

/** The page file that statically imports a reference adapter, or null. */
export function referenceLinkedIn(adapter) {
  const base = adapter.split("/").pop();
  for (const file of ["web/game.js", "web/battle.js"]) {
    if (readFileSync(join(ROOT, file), "utf8").includes(`from "./${base}"`)) return file;
  }
  return null;
}

/** The shared browser engine bundle, and whether it carries the interpreter. */
export function pageBundle() {
  const file = "web/vendor/engine.js";
  const src = readFileSync(join(ROOT, file), "utf8");
  const markers = INTERPRETER_MARKERS.filter((re) => re.test(src)).map((re) => re.source);
  return { file, markers, containsInterpreter: markers.length > 0 };
}

/** The research-only interpreter bundle, built from engine/native-entry.ts. */
export function nativeBundle() {
  const file = "web/vendor/engine-native.js";
  if (!existsSync(join(ROOT, file))) return { file, present: false, containsInterpreter: false };
  const src = readFileSync(join(ROOT, file), "utf8");
  return { file, present: true, containsInterpreter: containsInterpreterSource(src) };
}

/**
 * The ordinary page's STATIC module graph: web/game.js and web/battle.js and
 * everything they reach by a static `import`, but NOT through a dynamic
 * `import()`. The interpreter must not be reachable here — web/native-runtime.js
 * is the only importer of web/vendor/engine-native.js and it uses a dynamic
 * import, so the interpreter stays out of the page's static graph.
 */
export async function pageStaticGraph() {
  const entries = ["web/game.js", "web/battle.js"];
  const result = await build({
    entryPoints: entries.map((p) => join(ROOT, p)),
    outdir: "/tmp/execution-forbidden-audit-page",
    bundle: true, write: false, metafile: true, format: "esm", logLevel: "silent",
  });
  const inputs = result.metafile.inputs;
  const staticallyReached = new Set();
  const queue = Object.keys(inputs).filter((p) => /(^|\/)(game|battle)\.js$/.test(p));
  while (queue.length) {
    const p = queue.pop();
    if (staticallyReached.has(p)) continue;
    staticallyReached.add(p);
    for (const edge of inputs[p]?.imports ?? []) {
      if (edge.kind !== "import-statement") continue; // dynamic-import/require: not static
      if (inputs[edge.path] && !staticallyReached.has(edge.path)) queue.push(edge.path);
    }
  }
  const interpreter = [...staticallyReached].filter((p) =>
    /engine-native\.js$/.test(p) || /engine\/native\/(mips|runtime|stubs|bridge|raw-prims|device-ports|screen-heap)\.ts$/.test(p));
  return { entries, reachesInterpreter: interpreter.length > 0, interpreter };
}

// ---------------------------------------------------------------------------
// Consumption: does the ordinary route actually import a listed port?
// ---------------------------------------------------------------------------
// The defect this fixes is in the `battle-3d` surface. It named the PORT MODULES
// themselves as the surface's entry, so its bundle proved only that the ports are
// interpreter-free; it never checked the page imports them. Every mechanism
// ported under those modules could be imported by nothing in web/** and still
// read as covering the fight. Consumption is the missing axis, and it is DERIVED
// here, never hand-listed, so drift is impossible and a newly-dead port shows up
// by itself:
//
//   1. Walk the ORDINARY route's static import graph from the route entry the
//      surface names (e.g. web/battle3d.js) -- every web/*.js file it reaches by
//      a static `import`, not a dynamic one.
//   2. Read the engine symbols those files import out of the built production
//      bundle (`../vendor/engine.js`). This is the SAME derivation the battle-3d
//      faithfulness checker uses; the audit is its authority (see
//      tools/check_battle3d_faithfulness.mjs).
//   3. Map each imported symbol to the engine module that DEFINES it, via the
//      production barrel engine/index.ts (`export { X } from "./dw3/y.ts"`).
//   4. Close that seed set over the engine SOURCE import graph, so a module a
//      consumed port itself imports (gte-math.ts under battle-camera.ts) counts
//      as consumed too.
//
// A listed port reached this way is CONSUMED; one that is not is UNCONSUMED,
// reported in its own column and its own report section, never silently credited
// to the surface. This changes NO surface's class: the class answers "does the
// ordinary route reach the interpreter?", which is a different question from
// "does the ordinary route run this port?" -- see the research document.

let barrelMapCache = null;
/** symbol -> the engine module that defines it, from the production barrel. */
export function engineBarrelSymbolMap() {
  if (barrelMapCache) return barrelMapCache;
  const src = readFileSync(join(ROOT, "engine/index.ts"), "utf8");
  const map = new Map();
  const re = /export\s*(?:type\s*)?\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const mod = "engine/" + m[2].replace(/^\.\//, "");
    for (let part of m[1].split(",")) {
      part = part.trim().replace(/^type\s+/, "");
      if (!part) continue;
      const name = part.split(/\s+as\s+/)[0].trim();
      if (name) map.set(name, mod);
    }
  }
  barrelMapCache = map;
  return map;
}

let engineGraphCache = null;
/** The engine SOURCE import graph as module -> [imported engine modules]. */
export async function engineModuleGraph() {
  if (engineGraphCache) return engineGraphCache;
  const result = await build({
    entryPoints: [join(ROOT, "engine/index.ts")],
    outdir: "/tmp/execution-forbidden-audit-engine-graph",
    bundle: true, write: false, metafile: true, format: "esm", logLevel: "silent",
  });
  const inputs = result.metafile.inputs;
  const edges = new Map();
  for (const [p, meta] of Object.entries(inputs)) {
    edges.set(p, (meta.imports ?? [])
      .filter((e) => e.kind === "import-statement" && e.path.startsWith("engine/"))
      .map((e) => e.path));
  }
  engineGraphCache = edges;
  return edges;
}

/**
 * The engine symbols the ORDINARY route imports out of the production bundle.
 * `routeEntry` is the route's own entry point (repo-relative paths); the static
 * import graph is walked from it, so web/** files it statically reaches are all
 * folded in. This is the single authority for route-engine imports.
 */
export async function routeEngineSymbols(routeEntry) {
  const entries = (Array.isArray(routeEntry) ? routeEntry : [routeEntry]);
  const result = await build({
    entryPoints: entries.map((p) => join(ROOT, p)),
    outdir: "/tmp/execution-forbidden-audit-route",
    bundle: true, write: false, metafile: true, format: "esm", logLevel: "silent",
  });
  const inputs = result.metafile.inputs;
  const reached = new Set();
  const queue = [...entries];
  while (queue.length) {
    const p = queue.pop();
    if (reached.has(p) || !inputs[p]) continue;
    reached.add(p);
    for (const edge of inputs[p].imports ?? []) {
      if (edge.kind !== "import-statement") continue; // dynamic import is not the ordinary route
      if (inputs[edge.path] && !reached.has(edge.path)) queue.push(edge.path);
    }
  }
  const syms = new Set();
  const files = [...reached].filter((p) => p.startsWith("web/") && p.endsWith(".js")).sort();
  const importingFiles = [];
  for (const rel of files) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    const re = /import\s*\{([^}]*)\}\s*from\s*(["'][^"']+["'])/g;
    let m;
    let importsEngine = false;
    while ((m = re.exec(src))) {
      if (!/vendor\/engine\.js["']$/.test(m[2])) continue;
      importsEngine = true;
      for (let part of m[1].split(",")) {
        part = part.trim().replace(/^type\s+/, "");
        if (!part) continue;
        const name = part.split(/\s+as\s+/)[0].trim();
        if (name) syms.add(name);
      }
    }
    if (importsEngine) importingFiles.push(rel);
  }
  return { syms, files, importingFiles, entries };
}

/** Per-port consumedness, derived from an import set. A listed port is consumed
 *  when a symbol it defines is imported by the route, or when a consumed module
 *  imports it (one hop at a time). */
export function classifyPortConsumption(ports, { routeSymbols, symToMod, moduleEdges }) {
  const consumed = new Map();
  for (const symbol of routeSymbols) {
    const mod = symToMod.get(symbol);
    if (mod) consumed.set(mod, "direct");
  }
  const queue = [...consumed.keys()];
  while (queue.length) {
    const p = queue.pop();
    for (const next of moduleEdges.get(p) ?? []) {
      if (!consumed.has(next)) { consumed.set(next, "transitive"); queue.push(next); }
    }
  }
  return ports.map((module) => ({ module, consumed: consumed.has(module), via: consumed.get(module) ?? null }));
}

export async function measureSurface(surface, { interpreterShipped = true } = {}) {
  const reachable = await reachableNative(surface.entries ?? surface.entry);
  const forbidden = reachable.filter((m) => !ALLOWED_NATIVE.has(m));
  // The interpreter files the route reaches through ANY import kind, including
  // the single dynamic door into the research bundle. A route that reaches
  // web/vendor/engine-native.js boots the interpreter when its default branch
  // runs, so it is interpreter-reachable even though `reachableNative` (which
  // sees only engine/native/** SOURCE modules) would call it clean.
  const interpreterVia = await reachableInterpreter(surface.entries ?? surface.entry);
  const decision = locateDecision(surface.decision);
  // A surface is ours when its ORDINARY route executes only our code AND the
  // interpreter is not in the shipped artefact at all. While the interpreter is
  // still statically shipped (old baseline) a clean-route-but-gated surface is
  // only switch-gated-only; once the split lands, it becomes ours. A native
  // driver (ordinary route runs the original overlay) stays interpreter-reachable
  // whatever the bundle split did.
  const cls = surface.nativeDriver || forbidden.length || interpreterVia.length
    ? "interpreter-reachable"
    : surface.reference ? (interpreterShipped ? "switch-gated-only" : "ours") : "ours";
  let browser = null;
  if (surface.verifier) {
    const src = readFileSync(join(ROOT, surface.verifier), "utf8");
    browser = { verifier: surface.verifier, deniesNativeAssets: src.includes("assets/native/**") };
  }
  const referenceLinkedIn_ = surface.reference ? referenceLinkedIn(surface.reference.adapter) : null;
  // A system with more than one player-facing surface is measured surface by
  // surface, never collapsed to its worst or its best: each component carries
  // its own decision line and class.
  let components = null;
  if (surface.components) {
    components = [];
    for (const component of surface.components) {
      components.push(await measureSurface(component, { interpreterShipped }));
    }
  }
  // A surface that declares its own ORDINARY route entry (`routeEntry`) and a
  // list of port modules (`entry`) is measured for CONSUMPTION too: which of the
  // ports the route's static import graph actually reaches. Derived, never
  // hand-listed (see classifyPortConsumption).
  let consumption = null;
  if (surface.routeEntry) {
    const ports = Array.isArray(surface.entry) ? surface.entry : [surface.entry];
    const { syms, files } = await routeEngineSymbols(surface.routeEntry);
    const classified = classifyPortConsumption(ports, {
      routeSymbols: syms, symToMod: engineBarrelSymbolMap(), moduleEdges: await engineModuleGraph(),
    });
    consumption = {
      routeEntry: surface.routeEntry,
      routeFiles: files,
      routeSymbolCount: syms.size,
      ports: classified,
      consumedCount: classified.filter((p) => p.consumed).length,
      unconsumed: classified.filter((p) => !p.consumed).map((p) => p.module),
    };
  }
  return { ...surface, decision, reachable, forbidden, interpreterVia, class: cls, browser, referenceLinkedIn: referenceLinkedIn_, components, consumption };
}

export async function audit() {
  const bundle = pageBundle();
  const native = nativeBundle();
  const graph = await pageStaticGraph();
  const interpreterShipped = bundle.containsInterpreter || graph.reachesInterpreter;
  const surfaces = [];
  for (const surface of SURFACES) surfaces.push(await measureSurface(surface, { interpreterShipped }));
  // The negative control must still SEE an interpreter when a graph links one, so
  // it now points at the research entry (which owns the interpreter) rather than
  // engine/index.ts (which the split deliberately emptied of it).
  const control = await reachableNative("engine/native-entry.ts");
  const productionBarrel = await reachableNative("engine/index.ts");
  // Two independent ways a linked interpreter must be caught: as a SOURCE module
  // in the metafile (`reachableNative`), and as CODE in a built bundle
  // (`containsInterpreterSource`). A control that only checks one cannot catch a
  // route that enters the interpreter through the prebuilt research bundle.
  const controlResult = await build({
    entryPoints: [join(ROOT, "engine/native-entry.ts")],
    outdir: "/tmp/execution-forbidden-audit-control",
    bundle: true, write: false, metafile: true, format: "esm", logLevel: "silent",
  });
  const controlSource = containsInterpreterSource(controlResult.outputFiles?.[0]?.text ?? "");
  // The CONSUMPTION column's own control. It must prove the column tracks the
  // route's imports, not today's answer, so it drives the derivation with
  // synthetic import sets: an empty set must credit NO port, and removing the
  // symbols that map to one consumed port must flip that port to unconsumed.
  const b3 = SURFACES.find((s) => s.id === "battle-3d");
  const barrel = engineBarrelSymbolMap();
  const engineEdges = await engineModuleGraph();
  const b3route = await routeEngineSymbols(b3.routeEntry);
  const realConsumption = classifyPortConsumption(b3.entry, { routeSymbols: b3route.syms, symToMod: barrel, moduleEdges: engineEdges });
  const emptyConsumption = classifyPortConsumption(b3.entry, { routeSymbols: new Set(), symToMod: barrel, moduleEdges: engineEdges });
  // A directly-consumed port with no OTHER consumed module importing it: strip
  // its symbols and it must read unconsumed on its own.
  const directModules = new Set([...b3route.syms].map((s) => barrel.get(s)).filter(Boolean));
  const flipTarget = [...directModules].find((m) =>
    ![...directModules].some((other) => other !== m && (engineEdges.get(other) ?? []).includes(m)));
  const stripSymbols = new Set([...b3route.syms].filter((s) => barrel.get(s) !== flipTarget));
  const strippedConsumption = classifyPortConsumption(b3.entry, { routeSymbols: stripSymbols, symToMod: barrel, moduleEdges: engineEdges });
  const importedReadsConsumed = realConsumption.some((p) => p.consumed);
  const emptyCreditsNothing = emptyConsumption.every((p) => !p.consumed);
  const stripFlipsTarget = flipTarget ? !strippedConsumption.find((p) => p.module === flipTarget)?.consumed : false;
  // The ALL-CONSUMED case: an import set that covers every listed port must read
  // every port consumed and report NO unconsumed port. This is the case the
  // 2026-10-06 wiring campaign drove the real battle-3d surface to (25/25
  // consumed), and it must be distinguished from an empty reading rather than
  // mistaken for one: `emptyImportsCreditsNothing` and this control are opposite
  // ends of the same derivation, so the column is proved to track the import set
  // across its whole range, not just to hold one side of it.
  const allPortSymbols = new Set(
    [...barrel.entries()].filter(([, mod]) => b3.entry.includes(mod)).map(([sym]) => sym));
  const allConsumption = classifyPortConsumption(b3.entry, {
    routeSymbols: allPortSymbols, symToMod: barrel, moduleEdges: engineEdges,
  });
  const fullImportSetCreditsAll = allConsumption.length > 0 && allConsumption.every((p) => p.consumed);
  const fullImportSetLeavesNoneUnconsumed = allConsumption.filter((p) => !p.consumed).length === 0;
  return {
    surfaces,
    logicSystems: LOGIC_SYSTEMS,
    pageBundle: bundle,
    nativeBundle: native,
    pageGraph: graph,
    interpreterShipped,
    negativeControl: {
      entry: "engine/native-entry.ts",
      reachable: control,
      catchesInterpreter: control.includes("engine/native/runtime.ts"),
      catchesInterpreterSource: controlSource,
      consumedPorts: {
        portsChecked: b3.entry.length,
        importedPortReadsConsumed: importedReadsConsumed,
        emptyImportsCreditsNothing: emptyCreditsNothing,
        strippedImportFlipsPort: stripFlipsTarget,
        fullImportSetCreditsAll,
        fullImportSetLeavesNoneUnconsumed,
        example: { consumed: realConsumption.find((p) => p.consumed)?.module ?? null, flipped: flipTarget ?? null },
      },
    },
    productionBarrel: {
      entry: "engine/index.ts",
      reachable: productionBarrel,
      reachesInterpreter: productionBarrel.some((m) => !ALLOWED_NATIVE.has(m)),
    },
  };
}

export function summarize(result) {
  const counts = { ours: 0, "switch-gated-only": 0, "interpreter-reachable": 0 };
  for (const s of result.surfaces) if (counts[s.class] !== undefined) counts[s.class]++;
  return counts;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/\|/g, "\\|");

export function renderMarkdown(result, { includeMethod = true } = {}) {
  const screens = result.surfaces.filter((s) => s.kind === "screen");
  const systems = result.surfaces.filter((s) => s.kind === "system");
  const counts = summarize(result);
  const screenCounts = { ours: 0, "switch-gated-only": 0, "interpreter-reachable": 0 };
  for (const s of screens) screenCounts[s.class]++;

  const lines = [];
  lines.push("# Execution-forbidden audit — every player-facing screen and system");
  lines.push("");
  lines.push("Measured by `tools/execution_forbidden_audit.mjs`: for each surface the ORDINARY");
  lines.push("route (no query flag, no research switch) is bundled and its reachable");
  lines.push("`engine/native/**` modules inspected, the way the shop proof does.");
  lines.push("");
  lines.push("## Reach and status");
  lines.push("");
  lines.push(`- **${screens.length} screens measured**: ${screenCounts.ours} ours · ${screenCounts["switch-gated-only"]} switch-gated-only · ${screenCounts["interpreter-reachable"]} interpreter-reachable.`);
  lines.push(`- **${systems.length} systems measured** plus ${result.logicSystems.length} logic systems with no player-facing screen route.`);
  lines.push("- A route is **interpreter-reachable** when the ordinary entry's bundle pulls in any `engine/native/**` module other than the RAM buffer (`memory.ts`) and the VRAM-upload record (`vram.ts`).");
  lines.push(`- Production bundle \`${result.pageBundle.file}\`: **${result.pageBundle.containsInterpreter ? "carries the interpreter" : "interpreter-free"}**. Research bundle \`${result.nativeBundle.file}\`: **${result.nativeBundle.containsInterpreter ? "carries the interpreter (by design)" : "missing or empty"}**.`);
  lines.push(`- Ordinary page static graph (\`${result.pageGraph.entries.join("`, `")}\`): **${result.pageGraph.reachesInterpreter ? "reaches the interpreter" : "no interpreter"}**${result.pageGraph.interpreter.length ? ` (${result.pageGraph.interpreter.join(", ")})` : ""}.`);
  lines.push(`- Negative control: the research entry \`${result.negativeControl.entry}\` still reaches \`engine/native/runtime.ts\` (as a source module) and a bundle built from it still contains the interpreter's CODE (\`catchesInterpreterSource=${result.negativeControl.catchesInterpreterSource}\`); the production barrel \`${result.productionBarrel.entry}\` does ${result.productionBarrel.reachesInterpreter ? "**reach**" : "**not**"} reach the interpreter.`);
  lines.push(`- **Consumption is a separate axis from class.** A surface's class answers "does the ordinary route reach the interpreter?"; the per-port \`consumed\` column answers "does the ordinary route run this port?". An unconsumed port is reported in its own section below, never credited to the surface. Its control (${result.negativeControl.consumedPorts.portsChecked} ports): an import of \`${result.negativeControl.consumedPorts.example.consumed}\` reads **consumed**; an empty import set credits **nothing**; stripping the import of \`${result.negativeControl.consumedPorts.example.flipped}\` flips it to **unconsumed**; and an import set covering every listed port reads them ALL **consumed** with **no** unconsumed port reported.`);
  lines.push("");
  lines.push("### What the classes mean after the bundle split");
  lines.push("");
  if (result.interpreterShipped) {
    lines.push(`The interpreter is still statically shipped (page bundle or page static graph), so a clean-route-but-gated surface is only **switch-gated-only**: it cannot *execute* in ordinary play, but its code is one URL flag away.`);
  } else {
    lines.push(`The interpreter is **not in the shipped artefact at all**: \`${result.pageBundle.file}\` is interpreter-free and the ordinary page's static graph never reaches it. It lives only in the research bundle \`${result.nativeBundle.file}\`, fetched through a dynamic import (\`web/native-runtime.js\`) when a route actually asks for the original overlay. A surface whose ordinary route is ours is therefore **ours**, not merely switch-gated. The card duel's ordinary route still *runs* the shipped overlay with no flag, so it stays **interpreter-reachable** and fetches that bundle when it opens.`);
  }
  lines.push("");
  const clean = screens.filter((s) => s.class === "ours").map((s) => s.title);
  const looksClean = screens.filter((s) => s.class === "switch-gated-only");
  lines.push("### Actually clean today vs only looks clean");
  lines.push("");
  lines.push(`- **Actually clean (no interpreter adapter): ${clean.join(", ")}.**`);
  if (looksClean.length) {
    lines.push(`- **Only look clean (ordinary route is ours, but an interpreter adapter survives behind a flag): ${looksClean.map((s) => `${s.title} [?${s.reference?.flag}=1]`).join(", ")}.**`);
  }
  lines.push(`- **Not clean at all (interpreter on the ordinary route): ${screens.filter((s) => s.class === "interpreter-reachable").map((s) => s.title).join(", ")}.**`);
  lines.push("");
  lines.push("## Screens");
  lines.push("");
  lines.push("| Screen | Ordinary route | Class | Deciding file:line | Reachable native modules | Browser check |");
  lines.push("|---|---|---|---|---|---|");
  for (const s of screens) {
    const route = s.nativeDriver ? "original overlay (interpreter)"
      : s.reference ? `ours by default; ${s.reference.adapter} behind ?${s.reference.flag}=1`
      : "ours";
    const reach = s.forbidden.length ? s.forbidden.join(", ") : (s.reachable.length ? `${s.reachable.join(", ")} (data/device)` : "none");
    const browser = s.browser ? (s.browser.deniesNativeAssets ? `${s.browser.verifier} (denies assets/native/**)` : s.browser.verifier) : "none";
    lines.push(`| ${esc(s.title)} | ${esc(route)} | **${s.class}** | \`${s.decision.file}:${s.decision.line}\` | ${esc(reach)} | ${esc(browser)} |`);
  }
  lines.push("");
  lines.push("## Systems");
  lines.push("");
  lines.push("A system with more than one player-facing route is not collapsed to its worst or its");
  lines.push("best: each of its surfaces is measured on its own line and its own deciding line.");
  lines.push("");
  lines.push("| System | Class | Basis | Surfaces |");
  lines.push("|---|---|---|---|");
  for (const s of systems) {
    const surfaces = (s.components ?? []).map((c) => `${esc(c.title)} **${c.class}** (\`${c.decision.file}:${c.decision.line}\`)`).join("; ");
    lines.push(`| ${esc(s.title)} | **${s.class}** | \`${s.decision.file}:${s.decision.line}\` | ${surfaces} |`);
  }
  for (const name of result.logicSystems) lines.push(`| ${esc(name)} | n/a | logic system, no player-facing screen route measured here |  |`);
  lines.push("");
  const consumedSurfaces = result.surfaces.filter((s) => s.consumption);
  if (consumedSurfaces.length) {
    lines.push("## Exported but unconsumed ports");
    lines.push("");
    lines.push("A listed port the ORDINARY route's static import graph does not reach is **unconsumed**: it");
    lines.push("does not run in ordinary play, however interpreter-free the module is, and it is **not**");
    lines.push("credited to its surface. Consumedness is derived from the route's own imports (never");
    lines.push("hand-listed), so a newly-dead port appears here by itself. This does not change any");
    lines.push("surface's class, which answers a different question (whether the route reaches the");
    lines.push("interpreter).");
    lines.push("");
    lines.push("| Surface | Route entry | Ports consumed | Unconsumed ports |");
    lines.push("|---|---|---|---|");
    for (const s of consumedSurfaces) {
      const unc = s.consumption.unconsumed.length
        ? s.consumption.unconsumed.join(", ") : "none";
      lines.push(`| ${esc(s.title)} | ${s.consumption.routeEntry.join(", ")} | ${s.consumption.consumedCount}/${s.consumption.ports.length} | ${esc(unc)} |`);
    }
    lines.push("");
    lines.push("Per port (`consumed via` is `direct` when the route imports a symbol the module defines, `transitive` when a consumed module imports it):");
    lines.push("");
    for (const s of consumedSurfaces) {
      for (const p of s.consumption.ports) {
        const via = p.consumed ? ` (via ${p.via})` : "";
        lines.push(`- ${p.consumed ? "consumed" : "**UNCONSUMED**"} ${p.module}${via}`);
      }
    }
    lines.push("");
  }
  if (includeMethod) {
    lines.push("## Method");
    lines.push("");
    lines.push("```sh");
    lines.push("node tools/execution_forbidden_audit.mjs --check");
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const result = await audit();
  const json = JSON.stringify(result, null, 2);
  const md = renderMarkdown(result);
  const rawDir = join(ROOT, ".dw3-research/rig-sweep-2026-10-05");
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, "execution-forbidden-audit.md"), md);
  writeFileSync(join(ROOT, "tools/execution-forbidden-audit.json"), JSON.stringify({
    generated: new Date().toISOString(),
    summary: summarize(result),
    pageBundle: result.pageBundle,
    nativeBundle: result.nativeBundle,
    pageGraph: result.pageGraph,
    interpreterShipped: result.interpreterShipped,
    negativeControl: result.negativeControl,
    productionBarrel: result.productionBarrel,
    surfaces: result.surfaces.map((s) => ({
      id: s.id, kind: s.kind, title: s.title, class: s.class, entry: s.entry ?? s.entries,
      decision: s.decision, reachable: s.reachable, forbidden: s.forbidden, interpreterVia: s.interpreterVia,
      reference: s.reference, browser: s.browser, consumption: s.consumption ?? undefined,
      components: s.components ? s.components.map((c) => ({
        id: c.id, title: c.title, class: c.class, entry: c.entry,
        decision: c.decision, reachable: c.reachable, forbidden: c.forbidden, interpreterVia: c.interpreterVia,
      })) : undefined,
    })),
    logicSystems: result.logicSystems,
  }, null, 2) + "\n");
  const check = process.argv.includes("--check");
  if (check) {
    const all = result.surfaces.flatMap((s) => [s, ...(s.components ?? [])]);
    const drift = all.filter((s) => s.expected && s.class !== s.expected);
    const leak = all.filter((s) => s.expected === "ours" && s.forbidden.length);
    if (!result.negativeControl.catchesInterpreter) throw new Error(`negative control failed: ${result.negativeControl.entry} did not reach the interpreter`);
    if (!result.negativeControl.catchesInterpreterSource) throw new Error(`negative control failed: a bundle built from ${result.negativeControl.entry} did not contain interpreter CODE; containsInterpreterSource is blind`);
    const cp = result.negativeControl.consumedPorts;
    if (!cp.importedPortReadsConsumed) throw new Error("consumption control failed: no port read consumed even with the route's real imports; the consumed column is blind");
    if (!cp.emptyImportsCreditsNothing) throw new Error("consumption control failed: with no imports at all a port still read consumed; the consumed column does not track imports");
    if (!cp.strippedImportFlipsPort) throw new Error(`consumption control failed: removing the import of ${cp.example.flipped} did not flip it to unconsumed`);
    if (!cp.fullImportSetCreditsAll) throw new Error("consumption control failed: an import set covering every listed port did not read them all consumed");
    if (!cp.fullImportSetLeavesNoneUnconsumed) throw new Error("consumption control failed: an all-consumed import set was reported as having an unconsumed port");
    if (result.productionBarrel.reachesInterpreter) throw new Error(`the production barrel ${result.productionBarrel.entry} still reaches the interpreter (${result.productionBarrel.reachable.join(", ")})`);
    if (result.pageBundle.containsInterpreter) throw new Error(`the production bundle ${result.pageBundle.file} carries the interpreter (${result.pageBundle.markers.join(", ")})`);
    if (result.pageGraph.reachesInterpreter) throw new Error(`the ordinary page static graph reaches the interpreter (${result.pageGraph.interpreter.join(", ")})`);
    if (!result.nativeBundle.containsInterpreter) throw new Error(`the research bundle ${result.nativeBundle.file} does not carry the interpreter; research routes would break`);
    if (drift.length || leak.length) {
      for (const s of drift) console.error(`DRIFT ${s.id}: expected ${s.expected}, measured ${s.class} (${s.forbidden.join(", ") || s.interpreterVia.join(", ") || s.reachable.join(", ") || "none"})`);
      for (const s of leak) console.error(`LEAK ${s.id}: ordinary route reaches ${s.forbidden.join(", ")}`);
      process.exit(1);
    }
    console.log(`execution-forbidden audit: ${all.length} surfaces (${result.surfaces.length} top-level + ${all.length - result.surfaces.length} per-system components) match their recorded class; production bundle and page static graph are interpreter-free`);
  } else {
    console.log(`wrote .dw3-research/rig-sweep-2026-10-05/execution-forbidden-audit.md and tools/execution-forbidden-audit.json`);
    console.log(JSON.stringify(summarize(result)));
  }
}
