import { cycleGameScreen } from "../fullscreen.js";
import { mountPress } from "../mount.js";
import { isPadButton } from "../input.js";
import { cutContentPress } from "../cut-content.js";
import { blastPress } from "../blast-ladder.js";
import { plannerPress } from "../evolution-planner.js";
import { damageLabPress } from "../damage-lab.js";
import { replayPress, replayTake } from "../replay-theatre.js";
import {
  submarimonCanInteract,
  nearestFacingNpc,
  talkCandidates,
  resolveConfirmTarget,
  oppositeDirection,
  isBlockActorId,
  isBoxActorId,
  removeSceneActor,
  clipDurationSeconds,
  BOX_TALK_CLIP,
  FIELD_TICK_SECONDS,
  BOX_TALK_CUE,
} from "../vendor/engine.js";
import { questTalk } from "../quests.js";
import { gymExtraHallAt, gymExtraPlan } from "../gym-extra.js";
import { autoBalloonMode } from "../textbox.js";
import {
  FISH_STRIKE_BIT,
  VIEW_H,
  VIEW_W,
  ZOOM,
  battle,
  bgm,
  books,
  cardAlbum,
  cardDeck,
  cardDuel,
  cardShop,
  choice,
  cntyselNative,
  cutscene,
  debugPanel,
  dialogueBox,
  driMenu,
  editor,
  fade,
  fieldMovie,
  fightReport,
  gym,
  inn,
  lastCam,
  menu,
  pauseHome,
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
} from "./vars.js";
import { playReplayRow } from "./auction-replay.js";
import { startTransition } from "./transitions.js";
import {
  activeExitAt,
  applyStoryFlag,
  loadAndSetMap,
  refreshPartyCharisma,
  setCharacter,
} from "./map-load.js";
import { syncSubThrustSound } from "./update.js";
import { fishingSpotHere, startBlockInteraction, startFishingCast, tryTreeKick } from "./fishing-tree.js";
import { currentMap } from "./session.js";
import { openTalkLine, questSpeak, sceneCast } from "./quest-scenes.js";
import { applyCardDuelCloseHousekeeping, storyDbg } from "./story-events.js";
import {
  flushStoryBattle,
  pickDialogueFor,
  startLadderClimb,
  startPadHandoff,
  startSlopeStep,
} from "./field-steps.js";
import { S } from "./state.js";
import { activeTriggerStep } from "./field-fx.js";

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
export function dispatchInput(k, e, raw = "") {
    // F cycles the game stage: normal -> fill the window -> browser fullscreen.
    // The custom name-entry grid owns letter keys while it is active.
    if (k === "f" && !state.nameEntry) {
        e.preventDefault?.();
        cycleGameScreen(document, document.getElementById("stage"));
        return;
    }
    // Mounts: "r" (the keyboard's Select) or the pad's Select button rides / steps off, and only when the Mount switch is on,
    // a quest unlocked a mount and the DW2 models are installed (mountPress answers false otherwise, so the press falls
    // through to everything else).
    if ((raw === "r" || k === "select") && !state.nameEntry && !e.ctrlKey && !e.metaKey && !e.altKey && mountPress(state)) {
        e.preventDefault?.();
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
    // The memory card also runs BEFORE the game starts: the title's Continue
    // opens it in LOAD mode (web/game.js contEl.onclick) while state.started is
    // still false. The translated card samples the held word, which the publish
    // above already feeds. Scoped to the pre-game case so the running game's
    // own screen order further down is untouched.
    if (!state.started && saveScreen.isOpen()) {
        e.preventDefault();
        saveScreen.handleKey(k, state);
        return;
    }
    // The Sound Test dev screen owns every press while it is open (F2 ->
    // Extras -> Sound test). It is only ever open when that switch is on, so
    // with the switch off this branch never runs.
    if (soundTest.open) {
        e.preventDefault();
        soundTest.handleKey(k);
        return;
    }
    if (!state.started) return;

    // GLOSSARY / OPTIONS: the open book reads the held pad itself (update -> books.update); a press only has to stay off the field.
    if (books.isOpen()) {
        e.preventDefault?.();
        return;
    }

    // EXPERIMENT (cut-content gallery): while the page is up it owns the pad — Left/Right turn a page, Cross/Start
    // close it, every other press is swallowed — so nothing reaches the field underneath. Closed, it answers false
    // and every press falls through exactly as before.
    if (cutContentPress(k)) {
        state.keys.delete(k);   // the press was the page's, so a held Cross/Start cannot act on the field the moment it closes
        e.preventDefault();
        return;
    }

    // EXPERIMENT (Blast ladder): the same rule for the ladder page — Left/Right walk the eight starters, Cross/Start
    // close, every other press swallowed. Closed, it answers false and the press falls through exactly as before.
    if (blastPress(k)) {
        state.keys.delete(k);
        e.preventDefault();
        return;
    }
    // EXPERIMENT (Next forms planner): while the page is up it owns the pad exactly like the book above — Up/Down
    // the form, Left/Right the partner, Cross/Start close, every other press swallowed. Closed, it answers false
    // and nothing changes.
    if (plannerPress(k)) {
        state.keys.delete(k);
        e.preventDefault();
        return;
    }
    // EXPERIMENT (Damage Lab): while the page is up it owns the pad exactly like the planner above — Up/Down the picker,
    // Left/Right its value, Cross/Start close, every other press swallowed. Closed, it answers false and nothing changes.
    if (damageLabPress(k)) {
        state.keys.delete(k);
        e.preventDefault();
        return;
    }

    // EXPERIMENT (Replay theatre): while the page is up it owns the pad exactly like the pages above — Up/Down the
    // room's own scenes, Cross play (the page closes and the scene starts in the field's own cutscene VM), Start
    // close, every other press swallowed. Closed, it answers false and nothing changes.
    if (replayPress(k)) {
        state.keys.delete(k);
        e.preventDefault();
        const row = replayTake();
        if (row) playReplayRow(row);
        return;
    }

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
        // (web/status-translated.js).
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
                // The list's own back word folds it shut: 0x800450BD
                // (exe/fns.s:3420 plays it on the back arm of F0x8001270c).
                // The host owns the fold — the list's port is what plays the
                // word, and this branch IS that fold for web/menu.js's own list.
                // The translated page plays its own.
                sfx.play("system01");
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
        // The screen samples the pad's held word once per frame, so it
        // needs no per-key dispatch.
        ne.handleKey(k, state);
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
                    if (S.engineBridge && S.engineBridge.onTalk(npc.npc_id)) return;
                    if (questTalk(npc.npc_id, currentMap().id, !!dlgState)) return;   // an extra quest takes this conversation (never a story one)
                    // An extra training hall greeter (web/gym-extra.js): speaks, then opens the gym screen on the themed drills.
                    const gymHall = gymExtraHallAt(state.gymExtra, currentMap().id, npc.npc_id);
                    if (gymHall) {
                        const plan = gymExtraPlan(state.gymExtra, gymHall, state.inventory);
                        const hallMap = currentMap().id;
                        questSpeak(npc.npc_id, gymHall.trainer, gymHall.greeting.join("\n\n")).then(() => gym.open(state, null, plan.group, hallMap, plan.drills));
                        return;
                    }
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
                                if (S.engineBridge?.onTalk(npc.npc_id)) return;
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
                                //
                                // The close callback is the field's screen-close
                                // housekeeping (F0x800169e0): the duel's result
                                // lands in story flags 17/18/16 as the field
                                // resumes, which is what every tamer's post-duel
                                // dialogue states gate on.
                                cardDuel.open(
                                    () => applyCardDuelCloseHousekeeping(cardDuel.resultWon?.() === true),
                                    npc.sprite ?? "Duelist", null, duelId, state,
                                );
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
