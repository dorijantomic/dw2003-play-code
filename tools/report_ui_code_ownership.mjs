// Implementation ownership, not original-game research or authenticity proof.
// Uses the installed browser bundle's real replacement registry, never names
// like "native" or "translated" as a substitute for whether a port is installed.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BRIDGE_ENTRIES, BRIDGE_BLOCKERS } from '../web/vendor/engine-native.js';
import { BRIDGE_ENTRIES as sourceEntries, BRIDGE_BLOCKERS as sourceBlockers } from '../engine/native/bridge.ts';

const ROOT = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8');
const key = e => `${e.module}:0x${e.address.toString(16)}`;
const hash = path => createHash('sha256').update(readFileSync(new URL(path, ROOT))).digest('hex');
const bundled = BRIDGE_ENTRIES.map(key).sort();
if (JSON.stringify(bundled) !== JSON.stringify(sourceEntries.map(key).sort()) ||
    JSON.stringify([...BRIDGE_BLOCKERS].sort()) !== JSON.stringify([...sourceBlockers].sort())) {
    throw new Error('Source and shipped browser replacement registries differ; report would misidentify what ships.');
}
const registry = JSON.parse(read('data/translated_functions.json'));
const manifest = JSON.parse(read('web/assets/native/screens/manifest.json'));
const game = read('web/game.js');
const battle = read('web/battle.js');
const evidence = (file, match) => {
    const lines = read(file).split('\n');
    const n = lines.findIndex(line => line.includes(match));
    if (n < 0) throw new Error(`missing ownership anchor ${file}: ${match}`);
    return `${file}:${n + 1}`;
};
const link = (path, line) => `[${path}${line ? ':' + line : ''}](/home/dorij/ddw3-walker/${path}${line ? ':' + line : ''})`;
const anchor = (file, match) => {
    const ref = evidence(file, match);
    return link(file, Number(ref.slice(ref.lastIndexOf(':') + 1)));
};

// Split player-visible pages: ownership of the surrounding pause home is not
// ownership of the native page it opens. Likewise battle command != battle HUD.
const surfaces = [];
const own = (name, file, match, detail = 'Our browser code; this surface does not boot a PS1 screen.') =>
    surfaces.push({name, ownership:'OURS', module:null, file, match, detail});
const mixed = (names, module, file, detail = 'Original screen instructions plus installed replacements; our adapter supplies state and our renderer paints the output.') => {
    if (!manifest.screens[module]) throw new Error(`screen absent from manifest: ${module}`);
    for (const name of names) surfaces.push({name, ownership:'MIPS + OURS', module, file, match:'openNativeScreen', detail});
};
// The named player surfaces, from the route code below. Exported so the flow-map test
// reads the rows this generator emits, not only the committed copy of them.
export function collectSurfaces() {
surfaces.length = 0;
own('Visual-style chooser and Authentic / HD selection','web/assets.js','export function');
own('Webpage toolbar: map / character / music selectors, hints and fullscreen','web/index.html','<header');
own('Boot language selection','web/cntysel-native.js','new CountryScreen(',
    'The ordinary boot screen uses translated tasks and data-only resources.');
own('Title artwork and Press Start','web/titlescreen.js','export function drawTitleScreen',
    'The ordinary title paints extracted art and runs the translated title tasks. ?nativeTitle=1 opens the original-code reference.');
own('Title New Game / Continue choices and title fades','engine/dw3/ui/title-session.ts','export class TitleSession',
    'The ordinary title runs translated menu, sequence, choice and fade tasks. ?nativeTitle=1 opens the original-code reference.');
mixed(['Title opt-in reference (?nativeTitle=1)'], 'pro/stdwtitl', 'web/title-native.js',
    'The explicit research route runs original screen instructions.');
if (!game.includes('const USE_REFERENCE_PACK = GYM_PARAMS.has("nativePack");') ||
    !game.includes('createPackSelectTranslated(sfx)') ||
    !game.includes('createNameEntryTranslated(sfx,')) {
    throw new Error('Opening or naming ownership changed; update the route classification.');
}
for (const surface of ['Account registration welcome / name keyboard','Starter-pack A / B / C chooser and partner pictures','Register account? Yes / No']) {
    own(surface, 'web/packselect-translated.js', 'new ui.WizardRootSession',
        'The ordinary registration route uses the translated wizard. ?nativePack=1 opens the original-code reference.');
}
own('Partner naming / rename keyboard and its confirmation', 'web/nameentry-translated.js', 'new ui.NameRootSession',
    'The ordinary naming route uses the translated keyboard. ?nativeName=1 opens the original-code reference.');
mixed(['Registration original-code research reference (?nativePack=1)'], 'pro/stplnmet', 'web/packselect-native.js');
mixed(['Naming original-code research reference (?nativeName=1)'], 'pro/stdgname', 'web/nameentry-native.js');
own('END card and its fade sequence','web/endscreen-translated.js','export function','Translated pro/stdwtitl END card (engine EndCardSession, checked against the original routines in tests/lane-b/end-card.test.js); ?legacyEnd=1 keeps web/endscreen.js. Background colour and the movie hand-off after the card are still open.');
own('NPC conversation box, text reveal and advance marker','web/dialogue-translated.js','export function createDialogueTranslated','Translated field conversation box (engine dialogue controller, plain window, balloon, band) for estalk talk lines and cutscene SAY; ?legacyTextbox=1, a failed load, or a non-estalk line falls back to web/textbox.js.');
own('Field Yes / No question box','web/yesno-translated.js','export function createYesNoTranslated','Translated Family B launchers (engine YesNoSession: the 8 per-stage launchers, text widgets, cursor glyphs, window fold); the chosen child event runs and its handoff is followed.');
own('Inn rest price, confirmation and result','web/inn-translated.js','export function createInnTranslated','Translated resident inn screen (engine InnSession: F0x80011dac / F0x800119a8 / F0x800110e0, the resident fade, eshtlnam text banks); ?legacyInn=1 keeps the hand-made web/inn.js.');
own('Field location-name card','web/placecard-translated.js','export function createPlaceCardTranslated','Translated fieldstg title card (engine PlaceCardSession: F0x80087d68 / F0x80087974 / F0x800875ac / F0x80087704 / F0x80087854) with the disc name banks for all languages; ?legacyPlaceCard=1 keeps web/placecard.js.');
own('Field talk / examine icons and reaction bubbles','web/fieldcom.js','export','Our browser code drawing the disc\'s own FIELDCOM cells; height, frames and open / close pace match the original (checked 2026-10-02). Not a translated session.');
own('Fishing interaction indicators, line, bobber and result bubble','web/game.js','function drawFishing','Our browser code drawing the disc\'s own FIELDCOM cells with the original\'s positions and timings (research 2026-10-02). The result balloon pops, holds and deflates through the story balloon\'s model (web/fieldcom.js storyBubbleFrame).');
own('Dive / burrow presentation and transition wipes','web/game.js','drawTransitionWipe','Dive and burrow scenes draw the disc\'s SSUBDEMO / SDIGDEMO packs (engine/systems/dive-demo.ts). The stage-change wipe is our browser code built from the decoded fieldstg states 1 and 2 (web/stage-wipe.js): player-centred close window, tile lattice and seams, one-band open. The close hold before the load and the cover blend are not decoded.');
own('Help counter eight-topic menus (s210 Guide, s924 Digimon Lab x2, s935 Yellow Cruiser x2)','web/help-menu-translated.js','export function createHelpMenuTranslated','Translated wstag210 F0x800A5E74 and its four copies (engine HelpMenuSession; tests/lane-b/help-menu-launcher.test.js runs each original against the translation). ?legacyHelpMenu=1 skips the menu.');
own('Pause HOME menu: ITEMS / SORT / MAP / TECHNIQUES / STATUS / CARD FOLDERS','web/status-translated.js','st.openHome =',
    'One pause home, one call: the field START, the UI lab Status Menu button and the Digivolve Demo screen Back all go through openPauseHome (web/pause-home.js), which opens this translated resident list; ?legacyPause=1 is gone and ?legacyStatus=1 is the whole hand-authored rollback.');
if (!game.includes('const pauseHome = () => openPauseHome({ state, status, menu });') ||
    !game.includes('const USE_REFERENCE_STATUS = GYM_PARAMS.has("nativeStatus");') ||
    !game.includes(': createStatusTranslated(sfx, statusOptions);')) {
    throw new Error('Pause-page ownership changed; update the route classification.');
}
for (const surface of ['Pause world map','Pause ITEMS category and inventory lists','Pause item-use target and outcome messages','Pause SORT / formation chooser','Pause field TECHNIQUES: partner / technique / target choices','Pause STATUS partner picker','Pause STATUS statistics, resistances and equipment details','Pause See Equipment: slot / item selection and equip / remove','Pause See Digivolve: learned forms and Battle Digivolve On / Off','Pause form / technique explanations','Pause CARD FOLDERS parent page']) {
    own(surface, 'web/status-translated.js', 'new ui.PauseRootSession',
        'The ordinary pause route uses the translated pause session and data-only resources. ?nativeStatus=1 opens the original-code reference.');
}
mixed(['Optional Digivolve Demo setup page (debug-enabled extra)'], 'pro/ststatus','web/status-native.js');
const shopSurfaces = ['Item / armory / pawn shop header and BUY / SELL','Shop BUY stock list and paging','Shop item details and effects cards','Shop purchase quantity and Buy / No confirmation','Shop Equip? and Equip who? choices','Shop equipped message and return to stock','Shop SELL category / item / quantity / Sell confirmation','Shop refusal messages and exit folds'];
if (!game.includes('const USE_NATIVE_SHOP = new URLSearchParams(location.search).has("nativeShop");') ||
    !game.includes('const shop = USE_NATIVE_SHOP ? createShopNative')) {
    throw new Error('Item-shop ownership changed; update the route classification.');
}
for (const surface of shopSurfaces) own(surface, 'web/shop-translated.js', 'export function createShopTranslated',
    'The ordinary merchant route runs the translated item shop (engine shop session, pro/stitshop tasks); ?nativeShop=1 opens the original-code reference.');
mixed(['Optional original-execution item-shop reference (?nativeShop=1)'], 'pro/stitshop', 'web/shop-native.js');
// The gym is one translated session (web/gym-translated.js builds engine GymSession), but the
// player meets it as three screens, so each row points at the pane that draws that screen.
const gymPanes = [
  ['Gym partner chooser and LV / HP / MP / TP panels', 'name: "gym screen"', 'partner pods and the LV / HP / MP / TP panels on the screen root'],
  ['Gym drill and TP choices / confirmations', 'name: "gym picker"', 'the drill picker and the confirm panel'],
  ['Gym workout scene and result panels', 'name: "gym training"', 'the training window with the trainee and props TRANIN scripts, its rep actor and sprite actors, and the stat rolls'],
];
for (const [name, match, pane] of gymPanes) own(name, 'engine/dw3/ui/gym-session.ts', match,
  `The gym: ${pane}. Translated from pro/stgtrain (adapter web/gym-translated.js builds engine GymSession from the pro/stgtrain boot chain, root, flow machine, HUD, picker, confirm panel, training session, rep actor, sprite actors, stat rolls, TRANIN pack services and fade); ?nativeGym=1 runs the original screen as a reference and ?legacyGym=1 the walker hand-made screen.`);
mixed(['Gym screen, original-code research reference (?nativeGym=1)'], 'pro/stgtrain','web/gym-native.js');
// The lab is one translated session (web/lab-translated.js builds engine LabSession), but the
// player meets it as five screens, so each row points at the pane that draws that screen.
const labPanes = [
  ['Digimon Lab service choices and partner chooser', 'name: "lab select action"', 'Select Action, its three choice rows and the partner chooser it opens'],
  ['Digimon Lab Switch: deployed / reserve partner choices', 'name: "lab switch"', 'Switch, the deployed and reserve partner choices'],
  ['Digimon Lab digivolution type choices', 'name: "lab detail"', 'Digivolve, the type choices, with the form grid and the roster picker beneath them'],
  ['Digimon Lab technique load / unload choices and result messages', 'name: "lab chooser"', 'the technique chooser and the messages that report a load or unload'],
  ['Digimon Lab Digivolve Chart', 'name: "lab chart"', 'the Digivolve Chart'],
];
for (const [name, match, pane] of labPanes) own(name, 'engine/dw3/ui/lab-session.ts', match,
  `The lab: ${pane}. Translated from pro/stgdglab (adapter web/lab-translated.js builds engine LabSession from the pro/stgdglab boot chain, root, Select Action, Switch, Digivolve, form grid, technique chooser, roster picker, scroll bar, Digivolve Chart and fade); ?nativeLab=1 runs the original screen as a reference and ?legacyDri=1 the walker hand-made screen.`);
mixed(['Digimon Lab, original-code research reference (?nativeLab=1)'], 'pro/stgdglab','web/dri-native.js');
// The album's ordinary route is the translated screen (web/cardalbum-translated.js
// over engine/dw3/ui/album-session.ts, the already-oracled pro/stcrdabm controllers
// running as registered tasks). The shipped overlay stays as the explicit reference.
if (!game.includes('const cardAlbumTranslated = createCardAlbumTranslated(sfx);') ||
    !game.includes(': GYM_PARAMS.has("nativeAlbum") ? cardAlbumNative : cardAlbumTranslated;')) {
    throw new Error('Card-album ownership changed; update the route classification.');
}
for (const name of ['Card album grid / page navigation','Card album card details']) own(name, 'web/cardalbum-translated.js', 'export function createCardAlbumTranslated',
    'The ordinary album route runs the translated AlbumSession (engine/dw3/ui/album-session.ts) over the already-oracled pro/stcrdabm controllers; ?nativeAlbum=1 runs the original screen as a reference and ?legacyAlbum=1 the walker hand-made screen.');
mixed(['Card album, original-code research reference (?nativeAlbum=1)'], 'pro/stcrdabm','web/cardalbum-native.js');
for (const name of ['Card folder chooser and colour totals','Card folder Edit Folder / Change Name submenu']) own(name, 'engine/dw3/ui/folder-session.ts', 'export class FolderSession', 'The ordinary folder chooser runs the translated FolderSession (engine/dw3/ui/folder-session.ts) over the pro/stcrddek folder-list controllers (folder-screen, folder-lifecycle, folder-picker-tick, folder-banks, folder-list-create, folder-list-row, folder-list-colours); ?nativeFolder=1 runs the original screen as a reference and ?legacyDeck=1 the walker hand-made editor.');
own('Card folder slots and replacement-card list', 'engine/dw3/ui/native/folder-card-grid.ts', 'export function folderCardGridTick', 'The 40-slot card grid runs the translated folder-card-grid bodies (F0x80086574 / F0x8008397C / F0x80085210 / F0x80084890 / F0x800835D8 / F0x800837B4 / F0x800838C4 / F0x80083934 / F0x80083D28 / F0x80084278 / F0x80084440 / F0x800847C0 / F0x80088AC8 / F0x800888B0) over the shared shop services; the folder picker hands off to it on the ordinary route and ?nativeFolder=1 is the reference.');
own('Card folder rename keyboard', 'engine/dw3/ui/native/folder-name-keyboard.ts', 'export const FOLDER_KEYBOARD_LAYOUT', 'The NAMEDT rename keyboard runs the shared name-entry keyboard port with the folder layout (F0x800884E8 / F0x80086AD8 / F0x80086E04 / F0x80087788 / F0x800868E8 and the pair F0x800886C8 / F0x800887C8).');
mixed(['Card folder, original-code research reference (?nativeFolder=1)'], 'pro/stcrddek','web/carddeck-native.js');
for (const name of ['Card shop Buy One Card / Open Booster / Edit Folder','Card shop stock, details and purchase choices','Card shop booster reveal / result and messages']) own(name, 'engine/dw3/ui/card-shop-session.ts', 'export class CardShopSession', 'The ordinary card shop runs translated root, stock, booster and reveal tasks; the folder hand-off opens the browser editor.');
mixed(['Card shop opt-in reference (?nativeCardShop=1)'], 'pro/stcrdshp', 'web/cardshop-native.js', 'The explicit research route executes the original screen.');
mixed(['Card-duel folder selection and opening ceremony','Card-duel board, hand, HP / energy panels and cursors','Card-duel card inspection and action choices','Card-duel card / program effects and phase banners','Card-duel round / duel result presentation and exit'], 'pro/cardgame','web/cardduel-native.js');
// The save screen is one translated session (web/save-translated.js builds engine
// MemcardSession), but the player meets it as four surfaces, so each row points at the pane.
const memcardPanes = [
  ['Save / Load card check and slot chooser', 'name: "memory card block grid"', 'the block grid that checks the card and holds the slot chooser'],
  ['Save / Load file cards', 'name: "memory card file card"', 'the file card drawn in each slot'],
  ['Save / Load confirmation, overwrite and error messages', 'name: "memory card window"', 'the message window, with its confirmations, the overwrite prompt and the errors'],
  ['Save / Load writing / reading and progress-bar presentation', 'name: "memory card slot transition"', 'the slot transition that writes or reads the card and its progress bar'],
];
for (const [name, match, pane] of memcardPanes) own(name, 'engine/dw3/ui/memcard-session.ts', match,
  `The save screen: ${pane}. Translated from pro/stgmcard (adapter web/save-translated.js builds engine MemcardSession from the pro/stgmcard entry actor, root, window, state machine, block grid, file card, progress bar and fade); ?nativeSave=1 runs the original screen as a reference and ?legacySave=1 the walker hand-made screen.`);
mixed(['Save / Load screen, original-code research reference (?nativeSave=1)'], 'pro/stgmcard','web/save-native.js');
own('Battle main Fight / Tech / DV / Tag / Item / Run command list','web/battlecmd-translated.js','FightCommandSession','Translated command list (engine FightCommandSession, pro/fightstg); ?nativeBattleCmd=1 runs the original list as a reference and ?legacyBattleCmd=1 the walker list.');
mixed(['Battle command list, original-code research reference (?nativeBattleCmd=1)'], 'pro/fightstg','web/battlecmd-native.js');
own('Battle HP plate: party markers, names, HP numbers and slash, HP bar and DV gauge','web/battlehud-translated.js','export function battleHudBarColors','Translated from pro/fightstg (engine battle-hud, checked in tests/lane-b/battle-hud.test.js, which now compares every sprite and quad of the plate draw, the DV gauge included); web/battle.js still paints it from those values. The DV gauge draws its two frame cels, the black backing below a full gauge and the fill (battleHudDvPaint). The two names and the slash between the HP numbers come from the ported build (battleHudPlateLabels); the enemy name is the original\'s name line from the extracted enemy stat table (web/assets/data/battlecmd/enemy_stats.json), with the walker\'s species name kept only for an enemy that is not in that table. ?legacyBattleHud=1 keeps the old plate.');
own('Battle close-up face box: the camera inside it and when it shows (its place, its frame and its camera are the original\'s; the plate has no MP bar, see docs/research/battle/battle-hud-ownership-check-2026-10-03.md)','web/battle3d.js','Layer key 0x1009 shows a close-up','Our browser code, but every rule in it is read out of pro/fightstg: the box is a second view of the same 3D scene (rectangle 208,76,100,60, window centre 258,106, ordering table of 50), the camera is the PLAYER\'S OWN model record\'s stored group 6/7 shot at that record\'s own projection distance, and when that record\'s distance is not a distance the original\'s box projects nothing and so does this one (2026-10-04, section 6.4; tests/battle-face-box-projection.test.js). Nothing in the box is a camera of ours any more.');
own('Battle TECH list and its MP display','web/battletech-translated.js','export function createBattleTechTranslated','Translated pro/fightstg TECH list (engine FightTechSession and native/battle-tech-menu.ts: F0x80096E88, F0x800967A0, F0x80096048, F0x80096314, F0x80095E40, on the command list widget F0x8009B0C8; tests/lane-b/fight-tech-menu.test.js runs the original routines). Six rows at pitch 14, clamp not wrap, short-MP rows grey and moved last, L1/R1 pages, the MP plate and the description pane. ?legacyTechList=1 keeps the walker list.');
own('Battle ITEM list, quantity and description','web/battleitem-translated.js','export function createBattleItemTranslated','Translated pro/fightstg ITEM list (engine FightItemSession and native/battle-item-menu.ts on the command list widget; tests/lane-b/fight-item-menu.test.js runs the original routines). Seven rows a page, the cursor and the pages stop at the ends, the carried quantity, page arrows, the description pane and the sliding marker. ?legacyItemList=1 keeps the walker list.');
own('Battle TAG partner chooser, including forced knockout replacement','web/battletag-translated.js','export function createBattleTagTranslated','Translated pro/fightstg TAG list (engine FightTagSession and native/battle-tag-menu.ts on the command list widget; tests/lane-b/fight-tag-menu.test.js runs the original routines). Two rows, a knocked-out partner listed with a grey name that Circle cannot pick, the cursor stops at the ends, the HP and MP plate on rows whose Digivolve check passes, and Cross cancels only when the Tag is not forced. With nobody left to tag, the original\'s own "No reserve" pane shows, with its blinking hand, and Circle closes it. After a partner is chosen, the row list always follows, with Switch alone when there is no DNA pairing, and Cross abandons the whole Tag. The species strip and the row list are still drawn by the walker (the DNA pane port). ?legacyTagList=1 keeps the walker list and ?legacyTagSwap=1 the old swap chain.');
own('Battle Digivolve form chooser and its side panel','web/battleform-translated.js','export function createBattleFormTranslated','Translated pro/fightstg form list (engine FightFormSession and native/digivolve-form-menu.ts on the command list widget; tests/lane-b/fight-form-menu.test.js runs the original routines). Up to three names, the current form grey and refused by Circle, the cursor stops at the ends, and L1/R1 turn the side panel\'s three pages with a wrap. Page one prints its thirteen numbers from the extracted position table, with the form level as its headline number. Page two lists the form\'s own techniques and page three the techniques of every equipped form, gathered by ports of the original\'s shared routines (tests/lane-b/form-tech-blocks.test.js). The three grey numbers come from the original\'s own stat penalty counters, which are zero in ordinary play. ?legacyFormList=1 keeps the walker list.');
own('Battle DNA / Tag follow-up pane: species column, Switch and DNA DV','web/battledna-translated.js','export function createBattleDnaTranslated','Translated pro/fightstg pane that both the DNA command and a chosen Tag partner open (engine FightDnaSession and native/battle-dna-menu.ts; tests/lane-b/fight-dna-menu.test.js runs the original routines). A header with the species under the cursor, up to three result species moved with Up and Down, then Switch and DNA DV with the price; Switch is free, DNA DV takes the price from both Digimon, and a member who is short is refused with no message. Still the walker\'s: the result species come from the walker\'s own DNA table, and the stat preview pages that L1 and R1 turn are the form list\'s own panel, shared through engine/dw3/ui/form-panel-host.ts (tests/lane-b/dna-carryover-preview.test.js). ?legacyDnaList=1 keeps the walker pane.');
own('Battle action / damage / defeat messages and menu notices','web/battlemsg-translated.js','export function battleMsgPaint','Translated pro/fightstg message line (engine BattleMessageSession: the line object F0x8009a298, its tick F0x80098c9c, draw F0x80098924 and reveal F0x80098a84; tests/lane-b/battle-message-line.test.js runs the original VM). Each line holds the turn until Circle, as the original does. Fifteen lines use the original esmfight words, put up by the original call (name on line one, outcome on line two; tests/lane-b/battle-message-words.test.js). Lines with no single original counterpart (a player item, a missed technique, a multi-part result, a timeline prefix) keep the walker\'s own sentence. ?legacyBattleMsg=1 keeps the old painted box.');
own('Battle loss: "Annihilated...", fade and return to the title','web/battle.js','function startLossSession','Translated loss sequence (engine BattleLossSession and native/battle-loss.ts: pro/wfightmn F0x800A8F88 loss branch 0x800A9230, the exit F0x800A7C00 in modes 0/1/2, and pro/fightstg F0x8009C534, F0x8008CB44/F0x8008C93C, F0x8008AAAC/F0x8008A83C/F0x8008AA08; tests/lane-b/battle-loss.test.js runs the originals and the port side by side, frame by frame). The line itself is the already-ported message panel, opened on the branch\'s own window call with esmfight 0x53. Still the renderer\'s: the camera preset 0xb, the orbit, motion 0x17 and the quarter-speed animation. ?legacyLoss=1 keeps the old hand-written beat.');
own('Battle joke menu while the partner is confused','web/battlecmd-translated.js','FightCommandSession','Translated pro/fightstg joke menu on the same shared list as the command list (engine FightCommandSession joke actor; tests/lane-b/fight-command-menu.test.js runs the original row build). Six shuffled joke commands where the command rows sit, no grey row, and the original\'s roll picks a normal attack or the joke line. Which turns show it is still the walker\'s rule. ?legacyJokeMenu=1 keeps the walker list.');
own('Battle command-loader failure fallback','web/battle.js','function drawCommandMenu','Our command renderer is used only for explicit rollback or loader failure.');
own('Battle 3D scene, attack effects, Blast / DNA presentation and cameras','web/battle3d.js','export');
own('Battle victory report: EXP / levels / forms / BIT / item pages','web/fightreport-translated.js','FightReportSession','Translated results screen (engine FightReportSession, pro/stfgtrep boot chain, root, rows, fade and reward services); ?nativeReport=1 runs the original screen as a reference and ?legacyReport=1 the walker inline report.');
mixed(['Battle victory report, original-code research reference (?nativeReport=1)'], 'pro/stfgtrep','web/fightreport-native.js');
own('Battle loading pipeline (no drawn screen)','web/wfight-translated.js','WfightLoaderSession','Translated boot loader task (engine WfightLoaderSession, pro/wfightmn F0x800A6414/F0x800A5ECC); ?nativeWfight=1 runs the original loader as a reference. Battle turn resolution and the visible battlefield remain our code.');
mixed(['Battle loading pipeline, original-code research reference (?nativeWfight=1)'], 'pro/wfightmn','web/wfightmn-native.js');
own('Developer stage-select menu used from the game','web/stagslct.js','export');
own('Developer field box: place name and partner picture (our debugging aid, not an original screen)','web/game.js','function updateHud()','Our own debugging aid. It is not a screen of the original game and is not a port target.');
own('Developer chapter / flags / state overlay','web/debugPanel.js','export function createDebugPanel');
own('Developer collision painting and scene editor overlays','web/editor.js','export function createEditor');
own('Developer scene-skip choices','web/sceneSkip.js','export');
for (const [name,module] of [
    ['Original developer stage-selection screen (native lab only)','pro/stagslct'],
    ['Original sound-test screen (native lab only)','pro/soundtst'],
    ['Original controller vibration test (native lab only)','pro/shocktst'],
    ['Original battle scene-test screen (native lab only)','pro/wfightts'],
]) surfaces.push({name,ownership:'MIPS + OURS',module,file:'web/native-screen-lab.js',match:'bootNativeScreen',detail:'Our lab controls boot this original test screen with optional installed replacements; it is not a normal game UI route. The browser stage-select menu listed above is a different implementation.'});
surfaces.push({name:'Field ambient / scripted point-sprite visuals',ownership:'MIPS + OURS',module:'wstag*',file:'web/effects.js',match:'export function drawNativeIntents',detail:'Our drawing code consumes some stage-controller results from original instructions; other animation modes are ours. These are not phase 6 menu screens.'});
return surfaces;
}
collectSurfaces();

// Keep every top-level web JS file in the inventory, including old unused
// renderers and helpers. A JavaScript file being ours does not mean its UI is
// the default route or that it never dispatches original instructions.
const old = new Map([
 ['menu.js','Hand-authored pause rollback only (?legacyStatus=1), plus the debug-only Digivolve Demo screen and the card-folder return path. It is NOT a second pause home: the lab and START open the translated list through web/pause-home.js.'],
 ['gym.js','Old gym via legacyGym'],['dri.js','Old Lab via legacyDri'],
 ['cardalbum.js','Old album via legacyAlbum'],['carddeck.js','Old folder editor via legacyDeck'],
 ['cardshop.js','Old card shop via legacyCardShop'],['cardduel.js','Old duel via legacyDuel'],
 ['save.js','Old Save / Load via legacySave'],['fightreport.js','Old report via legacyReport'],
 ['cntysel.js','Old language screen via legacyCntysel'],
 ['nameentry.js','Old naming via legacyName'],['stplnmet.js','Old account wizard via legacyPack'],
 ['textbox.js','Legacy conversation box via legacyTextbox; fallback for lines the translated box cannot load.'],
 ['shop.js','Old item shop; not on the ordinary route.'],
 ['choice.js','Old plain choice list; only the legacy inn (legacyInn) uses it.'],
 ['inn.js','Old inn via legacyInn'],
 ['placecard.js','Old location card via legacyPlaceCard'],
 ['cardduel-lab.js','Separate from-scratch duel lab; not the normal card duel.'],
]);
const files = readdirSync(new URL('web/',ROOT)).filter(f=>f.endsWith('.js')).sort().map(file=>({
 file:`web/${file}`, role:old.get(file) ?? (file.endsWith('-native.js') ? 'Our adapter; calls original screen runtime plus replacements.' :
 ['native-screen.js','native-screen-host.js','native-screen-lab.js','native-stage.js'].includes(file) ? 'Our loader / host; dispatches original instructions.' :
 ['native-screen-render.js','native-screen-text.js'].includes(file) ? 'Our pixel / text renderer; screen decisions come from mixed execution.' :
 file==='game.js' ? 'Our orchestration; selects both our surfaces and mixed screens.' :
 file==='pause-home.js' ? 'Our route helper: the one call that opens the pause home (field START, UI lab, Demo Setup Back).' :
 file==='battle.js' ? 'Our battle host / submenus / HUD; main commands and report dispatch mixed screens.' :
 file==='effects.js' ? 'Our effect renderer; some stage animation control comes from original instructions.' :
 'Our JavaScript helper / renderer / data handling. Its callers are listed in source.'),
 imports:[...read(`web/${file}`).matchAll(/from\s+["']([^"']+)["']/g)].map(m=>m[1])
}));
const adapters = files.filter(f=>f.file.endsWith('-native.js'));
for (const adapter of adapters) {
    const module=read(adapter.file).match(/const MODULE_ID = ["']([^"']+)/)?.[1];
    if (module && !surfaces.some(s=>s.module===module&&s.file===adapter.file)) throw new Error(`Native adapter omitted from surface inventory: ${adapter.file}`);
}
const labs = readdirSync(new URL('web/',ROOT)).filter(f=>f.endsWith('.html')).sort().map(file=>({file:`web/${file}`,
 role:file==='index.html'?'Normal game wrapper: ours; hosted game surfaces listed above.':
 file==='native-screen-lab.html'?'Our lab controls hosting original screen execution plus optional replacements.':
 ['ui-lab.html','cardduel-real.html','asuka-hook-lab.html'].includes(file)?'Our harness hosting real game routes; child screen ownership follows its route.':
 'Our HTML / diagnostic or lab controls; embedded screens may use the real mixed game path.'}));

const modules = [...new Set([...Object.keys(manifest.screens),...registry.map(e=>e.module ?? 'unspecified'),...BRIDGE_ENTRIES.map(e=>e.module)])].sort();
const routines = registry.map(e=>{
    const k=`${e.module}:0x${parseInt(e.address,16).toString(16)}`;
    const entry=BRIDGE_ENTRIES.find(b=>key(b)===k);
    return {...e, ownership:entry?'OUR REPLACEMENT INSTALLED':'ORIGINAL BODY STILL SELECTED',
        replacementInstalled:!!entry, requiresServices:entry?.requiresServices===true,
        blocker:BRIDGE_BLOCKERS.get(k) ?? null};
});
for(const entry of BRIDGE_ENTRIES)if(!routines.some(e=>`${e.module}:0x${parseInt(e.address,16).toString(16)}`===key(entry))) {
    routines.push({address:`0x${entry.address.toString(16)}`,module:entry.module,name:entry.name,
        port:null,oracle:null,ownership:'OUR REPLACEMENT INSTALLED',replacementInstalled:true,requiresServices:entry.requiresServices===true,blocker:null});
}
if (routines.filter(r=>r.replacementInstalled).length!==BRIDGE_ENTRIES.length) throw new Error('Replacement count mismatch: registry alias / duplicate requires inspection.');
const runtimePath='.dw3-research/ui-ownership-2026-09-27/runtime-coverage.json';
let runtime=null;
try{runtime=JSON.parse(read(runtimePath));}catch{}
const summary=modules.map(module=>({module,
 installed:routines.filter(r=>r.module===module&&r.replacementInstalled).length,
 writtenButNotInstalled:routines.filter(r=>r.module===module&&!r.replacementInstalled).length,
 blockers:[...BRIDGE_BLOCKERS].filter(([k])=>k.startsWith(`${module}:`)).length,
 observed:runtime?.roots?.filter(r=>r.module===module).map(r=>({
    actor:r.actor,booted:r.booted,traps:r.traps.reduce((n,t)=>n+t.count,0),unmapped:r.unmapped.length,
    our:r.bridged.filter(b=>b.invocations>0).length,
    original:[...r.executed,...r.residentExecuted].filter(f=>f.hits>0&&['native','translated'].includes(f.status)).length,
 })) ?? []
}));
const sources=['web/game.js','web/battle.js','web/native-screen-host.js','web/native-screen.js','web/vendor/engine.js','engine/native/bridge.ts','data/translated_functions.json','web/assets/native/screens/manifest.json'];
const out={generatedBy:'tools/report_ui_code_ownership.mjs',generatedAt:new Date().toISOString(),
 scope:'Normal default browser routes, named subpanels, top-level web JS/HTML files, every translation registry row and every shipped bridge entry. Original binary instruction coverage is bounded by the optional runtime probe; not all gameplay paths have been executed.',
 sourceHashes:Object.fromEntries(sources.map(p=>[p,hash(p)])),surfaces,files,labs,summary,routines,
 rule:'For a loaded original screen: only installed bridge entries and host-service intercepts run our implementations. Original instructions outside these intercepts still execute. A written translation without an installed entry is NOT counted as ours running.',
 runtimeProof:runtime?{path:runtimePath,frames:runtime.frames,interactionFrames:runtime.interaction_frames,summary:runtime.summary}:null};
const esc=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
// The work log: hand-maintained in data/screen_progress.json, printed first so this one file
// is both the screen map and the record of what was done and what is next.
const progress=JSON.parse(read('data/screen_progress.json'));
const progressSection=()=>[
 '## Progress (from `data/screen_progress.json`; update it with every screen or fix)','',
 '### Done','','| Screen or fix | State | Commit |','|---|---|---|',
 ...progress.done.map(d=>`| ${esc(d.what)} | ${esc(d.state)} | ${esc(d.commit)} |`),'',
 '### In progress','',...progress.inProgress.map(d=>`- **${esc(d.what)}.** ${esc(d.detail)}`),'',
 '### Next, in order','',...progress.next.map((n,i)=>`${i+1}. ${esc(n)}`),'',
 '### Open questions','','<!-- no-frontier: these rows mirror data/screen_progress.json open items, the port work list; each port job carries its own decode. -->','',...progress.open.map(o=>`- ${esc(o)}`),''];
const lines=['---','reach: Checking exactly which current browser UI screens and subpanels use our code, original PS1 instructions, or a mixture; auditing phase 6 replacement ownership.','status: generated','---','',
 '# Which UI runs our code — current ownership inventory','',
 'Generated from the current shipped browser replacement list and current route source. Regenerate with `node tools/report_ui_code_ownership.mjs`. This reports implementation ownership; it makes no new original-game behavior claim.','',
 '**OURS** means the named surface is implemented by our browser code. **MIPS + OURS** means original PS1 instructions still participate, alongside our replacements, state connection and pixel renderer. Extracted artwork / text / geometry are data: using those does not itself mean original code executes.','',
 'A replacement existing in a file is not evidence the game uses it. The lists below distinguish **installed** from **written but not installed**. Installed means selected when that entry is called in the loaded screen; it does not mean every possible player action has been exercised.','',
 ...progressSection(),
 '## Every named player surface and submenu','',
 '| What the player sees | What runs by default | Source | Detail |','|---|---|---|---|'];
for(const s of surfaces)lines.push(`| ${esc(s.name)} | **${s.ownership}** | ${anchor(s.file,s.match)} | ${esc(s.detail)} |`);
lines.push('','## Exact replacement inventory by screen library','',
 'Shared helpers apply to multiple screens; adding the counts is not a percentage of a screen. Every original routine not intercepted by an installed replacement or a host service remains original execution. The table is not a claim that these are all functions in the original binaries.','',
 '| Library | Our replacements installed | Our translations written but NOT installed | Explicit blockers |','|---|---:|---:|---:|');
for(const s of summary)lines.push(`| ${s.module} | ${s.installed} | ${s.writtenButNotInstalled} | ${s.blockers} |`);
lines.push('','## Fresh execution check','');
if(runtime){lines.push(`The existing screen probe ran ${runtime.frames} idle frames plus ${runtime.interaction_frames} scripted input frames per root. This is a bounded laboratory check, not every real gameplay path. Full trace: ${link(runtimePath)}.`, '',
 '| Root | Our replacements actually called | Original routines actually called | Traps | Unmapped ranges |','|---|---:|---:|---:|---:|');
 for(const s of summary)for(const r of s.observed)lines.push(`| ${s.module}${r.actor?' / '+r.actor:''} | ${r.our} | ${r.original} | ${r.traps} | ${r.unmapped} |`);
}else lines.push('Runtime report not yet present. This version is a static installation audit; it does not claim execution coverage.');
lines.push('','## Old versions that exist but are not the normal screen','',
 '| Our old renderer | When it is used |','|---|---|');
for(const [file,role]of old)lines.push(`| ${link('web/'+file)} | ${role} |`);
lines.push('','## Every top-level browser JavaScript file','',
 'These source files are ours. Some load or invoke original instructions; their role states that distinction. Normal surface ownership is in the first table, not inferred from a filename.','',
 '| File | Role |','|---|---|');
for(const f of files)lines.push(`| ${link(f.file)} | ${esc(f.role)} |`);
lines.push('','## Every browser HTML entry / lab','',
 'The wrapper and controls are ours. A lab wrapper does not turn its embedded screen into our implementation.','',
 '| Entry | Role |','|---|---|');
for(const l of labs)lines.push(`| ${link(l.file)} | ${esc(l.role)} |`);
lines.push('','## Every written replacement — precise technical appendix','',
 'This appendix is for code inspection. The screen table above is the player-facing answer. `ORIGINAL BODY STILL SELECTED` includes a written translation that has no installed entry; it must not be reported as our code running. A registered replacement needing allocator services is installed only when those services exist; the production screen host supplies them. A blocker is a recorded reason, not proof that the port is ready.','');
for(const module of modules){
 const rows=routines.filter(r=>r.module===module).sort((a,b)=>parseInt(a.address,16)-parseInt(b.address,16));
 if(!rows.length)continue;
 lines.push(`### ${module}`,'','| Routine | Entry | What runs | Our source | Recorded blocker |','|---|---|---|---|---|');
 for(const r of rows)lines.push(`| ${esc(r.name)} | ${r.address} | ${r.ownership} | ${r.port?link(r.port.split('#')[0]):'No registry source attached'}${r.port?.includes('#')?' — '+r.port.split('#')[1]:''} | ${esc(r.blocker ?? (r.replacementInstalled?'—':'No installed replacement; no explicit blocker attached'))} |`);
}
lines.push('','## What this audit did not do','',
 'It did not rewrite UI, enable inactive ports, change default routes, or claim that native execution is gone. It did not run every submenu, save state, language, battle condition or card effect. It does enumerate the shipped replacement list, its unwired translations, every current top-level browser JS/HTML file, and the named default surfaces. Unnamed original instructions outside the intercepted entries remain original by the runtime dispatch rule.','',
 'The first capped source-probe attempts failed in Node TypeScript/Wasm startup and memory reservation. The successful attempt bundles the existing probe and runs it with JIT disabled under the same one-core / 4 GiB limits. Failed output and the final probe log are retained under `.dw3-research/ui-ownership-2026-09-27/`.','');
const RUN = process.argv[1] === fileURLToPath(import.meta.url);
if (RUN) writeFileSync(new URL('docs/research/ui/current-ui-code-ownership.md',ROOT),lines.join('\n'));
if (RUN) writeFileSync(new URL('docs/research/ui/current-ui-code-ownership.json',ROOT),JSON.stringify(out,null,2)+'\n');
if (RUN) console.log(JSON.stringify({surfaces:surfaces.length,webJS:files.length,html:labs.length,translations:registry.length,
  installed:BRIDGE_ENTRIES.length,writtenNotInstalled:routines.filter(r=>!r.replacementInstalled).length,
  blockers:BRIDGE_BLOCKERS.size,runtime:!!runtime}));
