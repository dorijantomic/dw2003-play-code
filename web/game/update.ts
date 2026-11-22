import { mpbVisible } from "../mpbattle.js";
import { tickCutContent, cutContentOpen } from "../cut-content.js";
import { tickBlastLadder, blastOpen } from "../blast-ladder.js";
import { tickPlanner, plannerOpen } from "../evolution-planner.js";
import { tickDamageLab, damageLabOpen } from "../damage-lab.js";
import { tickReplay, replayOpen } from "../replay-theatre.js";
import { questFxTick } from "../quest-fx.js";
import { questPropsTick } from "../quest-props.js";
import { questPropsOn, questsEnabled } from "../quests.js";
import { tickAmbienceScene } from "../ambience.js";
import {
  FIELD_TICK_SECONDS,
  followerGatherSample,
  DEMO_CUE_FRAME as DIVE_DEMO_CUE_FRAME,
  diveDemoFrame,
  resolveMazeExit,
  routePairCommit,
  consumeFieldTicks,
  tickFishingBubble,
  tickFishing,
  clipDurationSeconds,
  tickFishingPose,
  startFishingBubble,
  closeFishingBubble,
  treeKickHoldsInput,
  stepSlope,
  tickBlockEngagement,
  BLOCK_CUE,
  BLOCK_TARGET_CLIP,
  removeSceneActor,
  stepLaunch,
  LAUNCH_PAD_SOUND,
  fieldDirectionFromIndex,
  tickIceSlide,
  stopIceSlide,
  pushFollowerHistory,
  followerHistorySample,
  submarimonIsAdvancing,
  tickSubmarimonMotion,
  terrainCodeAt,
  diveMoveMagnitude,
  FIELD_RUN_MAGNITUDE,
  fieldPureDirectionDelta,
  fieldDirectionDelta,
  moveWithCollision,
  applyObstaclePush,
  beginIceSlide,
  fireTrapRegionAt,
  startFireTrap,
  ambushTileAt,
  submarimonRollsEncounter,
  ENCOUNTER_TICK_FRAMES,
  encounterStepTick,
  resetEncounterCounter,
  FIELD_STOP_CLIP,
  fieldDirectionIndex,
  FIELD_WALK_SPEED,
  faceToward,
} from "../vendor/engine.js";
import { stepCheckerboard, WIPE_A28_STEP_UNIT, stepWipeClock, wipeProgress } from "../stage-wipe.js";
import { mountTick, mountSpeedFactor, moveWithSubSteps, mountRiding } from "../mount.js";
import { fieldPartySize } from "../party.js";
import { dialModeFromFx, dialAllowsFight, dialReset } from "../encounter-dial.js";
import { omenLevel, omenCues } from "../omen.js";
import { S } from "./state.js";
import {
  AUCTION_STAGE,
  NO_ENCOUNTERS,
  battle,
  books,
  cardAlbum,
  cardDeck,
  cardDuel,
  cardShop,
  choice,
  cntyselNative,
  cutscene,
  dialogueBox,
  driMenu,
  fade,
  fieldMovie,
  fightReport,
  followers,
  fpsGaps,
  gamepad,
  gym,
  helpMenuBox,
  inn,
  menu,
  partnerHistory,
  placeCard,
  readyStageIds,
  saveScreen,
  sfx,
  shop,
  soundTest,
  state,
  status,
  storyFlags,
  textbox,
  viewCam,
  yesNoBox,
} from "./vars.js";
import { render } from "./render.js";
import { activeFollowerCount, followerChar, plannerPartyMembers, resetFollowers } from "./followers.js";
import { replayFieldFree, replayRowsNow, runAuctionArrival } from "./auction-replay.js";
import { currentChar, currentMap, scheduleFieldLocationSave, sweepCollectionSave } from "./session.js";
import { clearQuestChase, questSceneFxReset, sceneCast, tickQuestChase } from "./quest-scenes.js";
import { chatTick, tickFootstep } from "./mp-chat.js";
import { fieldcomTick } from "./field-fx.js";
import {
  fireTrapPositionOf,
  flushStoryBattle,
  forcePartyMemberToOneHp,
  hitTrapPad,
  iceSlideCellAt,
  startAmbush,
  storyGridCellAt,
  tickClimb,
} from "./field-steps.js";
import { activeExitAt, addEntranceReturn, prepareStageAssets, setMap } from "./map-load.js";
import { checkStageCutscene } from "./story-events.js";
import {
  advanceTreeKick,
  boxStuck,
  fieldStepObstaclePush,
  fishingSpriteMeta,
  startFishingCatch,
} from "./fishing-tree.js";
import { runStageHandoff, startTransition, stepSetupBucketTick, stepSetupTick } from "./transitions.js";
import { triggerRandomEncounter } from "./battle-launch.js";

export function padLoop(t) {
    const dt = S.padLastT ? Math.min((t - S.padLastT) / 1000, 0.1) : 0;
    S.padLastT = t;
    gamepad.tick(dt);
    if (mpbVisible()) state.keys.clear();   // held pad buttons must not walk the character during a 2 vs 2 fight
    // Screens that can open BEFORE the sim loop starts still need a tick source.
    // The title's Continue launches the memory card in load mode (the original's
    // code 0xC00), and the sim loop only starts with the game, so without this the
    // screen drew but never advanced (measured: 0 frames, no reads, no input).
    if (!state.started && saveScreen?.isOpen?.()) saveScreen.update?.(dt);
    // The boot country/language screen (code 0x1600) is the same case: it runs
    // before the game starts, so the sim loop cannot tick it.
    if (!state.started) {
        if (cntyselNative.isOpen()) cntyselNative.update?.(dt, state.keys);
    }
    requestAnimationFrame(padLoop);
}

export function frame(t: number) {
    // Cap the sim/render at 60fps: on >60Hz displays rAF fires faster; dt-based
    // logic stays real-time either way, but capping keeps frame pacing (and any
    // per-frame effects) identical to the 60Hz baseline the game targets.
    if (t - S.lastT < 1000 / 61) {
        requestAnimationFrame(frame);
        return;
    }
    const dt = Math.min((t - S.lastT) / 1000, 0.1);
    S.lastT = t;
    // F2 -> Extras -> Sound test (dev): the switch only ENABLES the screen; it opens from the F2
    // button "Open the sound test" (window.__openExtra("soundtest")). Cross/Start closes it, and
    // switching the switch off closes it. With the switch off it can never be open, so the game
    // below behaves exactly as before.
    const soundTestOn = !!window.__fx?.soundtest;
    if (!soundTestOn && soundTest.open) soundTest.hide!();
    if (soundTest.open) soundTest.tick!(state.keys);
    // Game-speed hack: window.__gameSpeed fast-forwards EVERYTHING (cutscenes, WAITs, auto
    // walks, fades, animations) by sub-stepping the sim that many times. Set __gameSpeed=4
    // in the console to blitz through auto-scenes; 1 (or unset) = normal. Sub-stepping (vs.
    // one big dt) keeps collision + cutscene stepping stable at high multipliers.
    const mult = Math.max(1, Math.floor(window.__gameSpeed || 1));
    const perfHook = window.__perfHook;   // dev-only timing hook (web/perf-test.js); unset = exactly the lines below
    const perfT0 = perfHook ? performance.now() : 0;
    for (let i = 0; i < mult; i++) update(dt);
    const perfT1 = perfHook ? performance.now() : 0;
    render();
    if (perfHook) perfHook(perfT1 - perfT0, performance.now() - perfT1);
    if (window.__fx?.showfps || S.fpsBox) fpsTick(t);   // F2 -> Show FPS (dev); off = this one check
    requestAnimationFrame(frame);
}

function fpsTick(t: number) {
    if (!window.__fx?.showfps) {
        if (S.fpsBox) { S.fpsBox.remove(); S.fpsBox = null; }
        fpsGaps.length = 0; S.fpsLast = 0;
        return;
    }
    if (!S.fpsBox) {
        S.fpsBox = document.createElement("div");
        S.fpsBox!.id = "fps-box";
        S.fpsBox!.style.cssText = "position:absolute;top:4px;right:4px;z-index:60;padding:2px 6px;background:#000c;color:#fff;" +
            "font:12px/1.3 monospace;pointer-events:none;white-space:nowrap";
        (document.getElementById("stage") || document.body).appendChild(S.fpsBox!);
        S.fpsShown = t;
    }
    if (S.fpsLast) fpsGaps.push(t - S.fpsLast);
    S.fpsLast = t;
    if (t - S.fpsShown >= 500 && fpsGaps.length) {
        const n = fpsGaps.length, sorted = fpsGaps.slice().sort((a, b) => a - b);
        const med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
        S.fpsBox!.textContent = `${Math.round(n * 1000 / (t - S.fpsShown))} fps  ${med!.toFixed(1)} ms`;
        fpsGaps.length = 0; S.fpsShown = t;
    }
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
export function syncSubThrustSound(thrusting: boolean) {
    if (thrusting === !!state._subThrustSound) return;
    state._subThrustSound = thrusting;
    if (thrusting) sfx.playSustained!("sub_move");
    else sfx.stopSustained!("sub_move");
}

function update(dt: number) {
    // GLOSSARY / OPTIONS (web/book-host.js): while a book is up the field is frozen and the book reads the held pad.
    books.update(dt, state.keys);
    if (books.isOpen()) return;
    // EXPERIMENT (cut-content gallery): F2 -> Extras -> Cut-content gallery opens a read-only text page on the
    // setting's rising edge. While it is up the field is frozen (nothing moves under a page the player is reading)
    // and dispatchInput gives it every press; with the setting off the page never exists and this costs one call.
    tickCutContent(window.__fx?.cutcontent === true);
    if (cutContentOpen()) return;
    // EXPERIMENT (Blast ladder): F2 -> Extras -> "Blast ladder (new)" opens the five-form card on the setting's rising
    // edge. While it is up the field is frozen and dispatchInput gives it every press; with the setting off the page
    // never exists and this costs one comparison.
    tickBlastLadder(window.__fx?.blastladder === true);
    if (blastOpen()) return;
    // EXPERIMENT (Next forms planner): F2 -> Extras -> "Next forms planner (new)" opens on the setting's rising
    // edge. The page is read-only and lists the selected partner's line with its live gates. While it is up the
    // field is frozen and dispatchInput gives it every press; with the setting off this costs one comparison.
    tickPlanner(window.__fx?.planner === true, plannerPartyMembers);
    if (plannerOpen()) return;
    // EXPERIMENT (Damage Lab): F2 -> Extras -> "Damage Lab (new)" opens the stage-by-stage damage page on the setting's
    // rising edge. While it is up the field is frozen and dispatchInput gives it every press; with the setting off the
    // page never exists and this costs one comparison.
    tickDamageLab(window.__fx?.damagelab === true);
    if (damageLabOpen()) return;
    // EXPERIMENT (Replay theatre): F2 -> Extras -> "Replay theatre (new)" opens on the setting's rising edge, but only
    // with the field free — a story cutscene or a fight is never replaced by a replay. While the page is up the field is
    // frozen and dispatchInput gives it every press; with the setting off no list is built (rowsNow is not called) and
    // this costs one comparison.
    tickReplay(window.__fx?.replay === true, replayRowsNow, replayFieldFree());
    if (replayOpen()) return;
    // Play clock. The memory-card file record carries an h/m/s play time
    // (record +0x28/+0x2A/+0x2C, decoded in stgmcard F0x8008316c), so the
    // walker keeps a real one instead of writing zeros onto the save card.
    // The title is up (boot, or after a lost fight) while the field is still loaded underneath: no play time then.
    if (state.started) state.playSeconds = (state.playSeconds || 0) + dt;
    scheduleFieldLocationSave();
    sweepCollectionSave();
    textbox.update!(dt);
    cutscene.step(dt);
    questFxTick(dt);            // extra quests: the scene effects' own clock (web/quest-fx.js)
    // A running chase (the `chase` step, web/quest-chase.js): the target walks its path while the player is in control.
    // A frozen field (a box, a menu, a fight, a fade) freezes the chase too, so nothing can lose it while it is not visible.
    // A chase whose scene has gone (a warp, a stage entry, the title screen) is not a chase any more: it may not keep the
    // field's controls or a target's walk pose after the scene that started it has ended, whatever path ended it.
    if (S.questChase && !cutscene.isActive()) clearQuestChase();
    if (S.questChase && fade.dir === 0 && !textbox.isOpen!() && !dialogueBox.isOpen!() && !choice.isOpen!() && !battle.isActive() && !state.menuOpen)
        tickQuestChase(dt);
    questPropsTick(currentMap()?.id, questPropsOn(currentMap()?.id));   // props: art a quest's state leaves on the map (web/quest-props.js)
    tickAmbienceScene(dt);      // extra quests: a scene's weather/time-of-day fades (web/ambience.js)
    // F2 -> Extras -> Quests switched OFF while a scene is playing: the quest layer's own art, sky and chase go at once
    // (they are its feature; with the layer off the game must look like it did before quests). The conversation already on
    // screen finishes -- its lines are the quest's own -- and nothing in the save changes.
    if (S.questsWereOn && !questsEnabled()) questSceneFxReset();
    S.questsWereOn = questsEnabled();
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
    shop.update!(dt);
    gym.update?.(dt); // native gym host step (the legacy gym has no update)
    fightReport.update!(dt);
    saveScreen.update?.(dt); // native save-screen host step (the legacy screen has none)
    dialogueBox.update!(dt, state.keys); // translated conversation box (UI Lab)
    chatTick(dt);
    yesNoBox.update!(dt, state.keys);
    helpMenuBox.update!(dt, state.keys); // translated eight-topic help menu (5 NPC counters)
    cardAlbum.update?.(dt); // native album host step (the legacy album has no update)
    cardDeck.update?.(dt); // native folder editor host step (the legacy editor has none)
    cardShop.update?.(dt); // native card shop host step (the legacy shop has none)
    cardDuel.update?.(dt); // native duel host step (the legacy duel has none)
    // The native naming screen ticks from the main update, not the draw block:
    // the opening's hand-off can hold the frame before the field draws again,
    // and a screen that is only stepped while drawing never advances there.
    if (state.nameEntry) state.nameEntry.update?.(dt, state);
    cntyselNative.update(dt, state.keys); // native language-select host step
    inn.tick!(dt);
    driMenu.update!(dt, state.keys);
    status?.update!(dt);
    menu.update!(dt);
    state.packSelect?.update?.(dt, state);
    // The native wizard closes inside its own tick (the commit store sets the
    // root's lifecycle to 3), so the walker's done handler must run from here;
    // the legacy wizard's own key path still fires it on a press.
    if (state.packSelect?.isDone?.() && state.packSelectDone) state.packSelectDone();
    if (state.endScreen) {
        // The card samples the held pad on every callback, so it needs the walker's
        // current keys, and it runs one callback per display tick.
        state.endScreen.setHeld(state.keys ?? []);
        state.endScreen.step(dt);
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
                if (f!.parked) continue;
                const sample = followerGatherSample(partnerHistory, i, tick);
                if (!sample) { f!.parked = true; f!.gathering = false; continue; }
                f!.gathering = true;
                f!.x = sample.x;
                f!.y = sample.y;
                f!.dir = sample.dir;
                f!.animTime = (f!.animTime ?? 0) + dt;
            }
        }
        // The resident scene object's notify arms the player's FIELDCOM sparkle actor
        // (`SETANIM 813 824/825/842` -> setSub1(1/2/3), fieldstg F0x800837EC). The browser
        // has no type-0x16 object, so the arm becomes the same `state.sparkleActor` the
        // bank-0x70 PlaySparkle op drives; the draw pass renders it at the player.
        if (cutscene.sparkleSeq !== (state._sparkleSeq ?? 0)) {
            state._sparkleSeq = cutscene.sparkleSeq;
            state.sparkleActor = { program: cutscene.sparkleProgram, start: fieldcomTick() };
            if (cutscene.sparkleProgram === 1 || cutscene.sparkleProgram === 3) sfx.play!("item_get");
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
            if (d.mode === "hole") sfx.play!("dig_demo");
            else sfx.play!("sub_demo");
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
    placeCard.hold!(fade.dir !== 0 || fade.alpha > 0);
    placeCard.step!(dt);

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
            if (!(window as any).__wipe28Hold)
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
        stepWipeClock(state.wipe, fade.dir, dt);
        fade.alpha = Math.min(Math.max(wipeProgress(state.wipe), 0), 1);
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
            if (S.knownStageIds.includes(ex.to) && !readyStageIds.has(ex.to)) {
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
        textbox.isOpen!() ||
        choice.isOpen!() ||
        // A chase (the `chase` step) is the one scene that hands the field back: the player walks it themselves.
        (cutscene.isActive() && !state._questChase) ||
        fade.dir !== 0 ||
        state.wipe28 ||
        state.diveDemo ||
        state.nameEntry ||
        state.packSelect ||
        state.endScreen ||
        state.titleScreen ||
        !state.started ||   // the title is up over a still-loaded field (after a lost fight): it must not walk
        state.menuOpen ||
        shop.isOpen!() ||
        driMenu.isOpen!() ||
        dialogueBox.isOpen!() ||
        gym.isOpen!() ||
        cardShop.isOpen!() ||
        cardAlbum.isOpen!() ||
        cardDeck.isOpen!() ||
        cardDuel.isOpen() ||
        inn.isOpen!() ||
        saveScreen.isOpen!() ||
        fightReport.isOpen!() ||
        cntyselNative.isOpen()
    ) {
        state.moving = false;
        return;
    }

    // EXPERIMENT (mounts): the climb on / step off plays out on the field before anything else reads input
    // (19 and 13 frames, the disc's own mount-onto-the-rail and step-off clip lengths). While RIDING this
    // returns false: the player keeps the controls, faster, and the mount follows them.
    if (mountTick(dt, state, { mapId: currentMap().id })) {
        state.moving = false;
        return;
    }

    // Fishing. The op-7 scene controller raises the scene lock for the whole
    // cast (the replay saw leader mode 1 -> 0x48 and scene lock 0 -> 1 on the
    // frame of the press), so the D-pad is dead until the cast resolves — the
    // same shape as the fire trap and the launch pads below.
    if (state.fishing) {
        const fk = consumeFieldTicks(S.fieldTickAccumulator, dt);
        S.fieldTickAccumulator = fk.accumulator;
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
                if (cue.kind === "sound") sfx.playPacked!(cue.id, { overlap: true });
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
            if (pc.sound) sfx.playPacked!(pc.sound, { overlap: true });
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
        const tk = consumeFieldTicks(S.fieldTickAccumulator, dt);
        S.fieldTickAccumulator = tk.accumulator;
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
        const spt = consumeFieldTicks(S.fieldTickAccumulator, dt);
        S.fieldTickAccumulator = spt.accumulator;
        const ss = stepSlope(state.slope, spt.ticks);
        state.x = ss.x;
        state.y = ss.y;
        state.moving = ss.phase !== "landed";
        state.stopping = false;
        if (ss.playSound) sfx.play!(ss.playSound);
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
        const ft = consumeFieldTicks(S.fieldTickAccumulator, dt);
        S.fieldTickAccumulator = ft.accumulator;
        state.moving = false;
        state.stopping = false;
        for (const cue of state.fireTrap.run.tick(ft.ticks, fireTrapPositionOf)) {
            // overlap: the controller fires one explosion per Digimon 30 ticks
            // apart, but COMEX113 runs longer than that. On the PS1 those are
            // separate SPU voices and they pile up; through the common-sound
            // category arbitration each one would instead cut the last, so the
            // first two blasts were being truncated to a short thud.
            if (cue.kind === "sound") sfx.playPacked!(cue.id, { overlap: true });
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
        const bt = consumeFieldTicks(S.fieldTickAccumulator, dt);
        S.fieldTickAccumulator = bt.accumulator;
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
                sfx.playPacked!(BLOCK_CUE, { overlap: true });
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
                S.lastBlockIx = be.ix;
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
        const bt = consumeFieldTicks(S.fieldTickAccumulator, dt);
        S.fieldTickAccumulator = bt.accumulator;
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
            if (st.playSound === LAUNCH_PAD_SOUND) sfx.play!("teleport");
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
            followers[i]!.stopping = true;
            followers[i]!.stopTime = 0;
            followers[i]!._idleTime = 0;
        }
    }
    const fieldTicks = consumeFieldTicks(S.fieldTickAccumulator, dt);
    S.fieldTickAccumulator = fieldTicks.accumulator;

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
                    followers[i]!.x = sample.x;
                    followers[i]!.y = sample.y;
                    followers[i]!.dir = sample.dir;
                    followers[i]!.parked = !!sample.parked;
                    followers[i]!.animTime =
                        (followers[i]!.animTime ?? 0) + FIELD_TICK_SECONDS;
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
            // EXPERIMENT (mounts): riding multiplies the STEP, not the collision test. The step is split into
            // sub-steps of the ordinary magnitude, so at 3x the foot box still meets every 16 px cell it crosses
            // and no wall is tunnelled (tests/mount.test.js walks a 1-cell wall at every speed).
            const mountStep = mountSpeedFactor();
            const stepDx = delta.x * mountStep;
            const stepDy = delta.y * mountStep;
            const moved = boxStuck(grid, state.x, state.y)
                // A foot box already overlapping a blocked cell (a save written
                // while the push trap existed, an editor-placed spawn) must never
                // be permanent: while the box is stuck the destination check is
                // skipped, so the player can always walk back out — the same
                // exemption the pre-push step model carried. With the push
                // clamped below, nothing new can get in.
                ? { x: state.x + stepDx, y: state.y + stepDy }
                : mountStep === 1
                    ? moveWithCollision(
                        grid,
                        state.x,
                        state.y,
                        stepDx,
                        stepDy,
                        { w: 12, h: 8 },
                    )
                    : moveWithSubSteps(
                        (x, y, dx, dy) => moveWithCollision(grid, x, y, dx, dy, { w: 12, h: 8 }),
                        state.x,
                        state.y,
                        stepDx,
                        stepDy,
                        Math.hypot(delta.x, delta.y),
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
            // A chase hands the field to the player, so the party trails them here too.
            if (followCount > 0 && (!cutscene.isActive() || state._questChase)) {
                pushFollowerHistory(partnerHistory, {
                    x: state.x,
                    y: state.y,
                    dir: state.dir,
                });
                for (let i = 0; i < followCount; i++) {
                    const sample = followerHistorySample(partnerHistory, i);
                    if (!sample) continue;
                    followers[i]!.x = sample.x;
                    followers[i]!.y = sample.y;
                    followers[i]!.dir = sample.dir;
                    followers[i]!.parked = !!sample.parked;
                    followers[i]!.animTime =
                        (followers[i]!.animTime ?? 0) + FIELD_TICK_SECONDS;
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
            sfx.play!("switch02");
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
        if (ambush && !NO_ENCOUNTERS && !state._questChase && storyFlags.get(ambush.gateFlag) === 0 && !battle.isActive()) {   // ?noEncounters=1 also silences the ambush patches; a chase never rolls one
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
            // EXPERIMENT (mounts): no random encounters while riding — a mount is a way to cross a map, not a
            // fight magnet (the same rule as a chase, which also never rolls one).
            !mountRiding() &&
            // A chase is a scripted moment: nothing may interrupt it with a random fight (the card's own rule).
            !state._questChase &&
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
        // EXPERIMENT (omen): when the driver cannot run at all (a mount, a chase, no party)
        // no roll is pending, so the mirrored tier reads 0 and the field's feeling fades.
        if (!encEligible) state._encLevel = 0;
        for (let tick = 0; tick < fieldTicks.ticks; tick++) {
            if (encEligible && state._encTick % ENCOUNTER_TICK_FRAMES === 0) {
                const level = battle.encounterRateLevel(m.id, state.x, state.y);
                // EXPERIMENT (omen): mirror the tier the driver just used (the counter below
                // stays the driver's own: the cue only ever reads it).
                state._encLevel = level;
                // 0 covers all three ways the driver (F0x80092664) bails out: the
                // stage registers no type-4 zone map (module gate), the player is
                // on a zone-0 cell, or the block is the level-0 sentinel only the
                // scripted trigger path reaches.
                if (level > 0) {
                    const r = encounterStepTick(state._encCounter, level);
                    state._encCounter = r.counter;
                    if (r.expired) {
                        // EXPERIMENT (encounter dial): the F2 setting is applied HERE, at the
                        // call site, so the decoded routine stays the one authority. With the
                        // switch off it reads "normal" — the decoded reset and the gated
                        // launch, exactly as before. "none" drops only the launch; "rare" and
                        // "lure" only scale the reset value (rare x2, lure floor(/2)), so the
                        // 8-tick driver, the zone rate table and the slot roll are untouched.
                        const dial = dialModeFromFx(window.__fx);
                        // Original order: the gated launch, then the reset.
                        if (!NO_ENCOUNTERS && dialAllowsFight(dial!))
                            triggerRandomEncounter(m.id, state.x, state.y);
                        state._encCounter = dialReset(resetEncounterCounter(
                            () => Math.floor(Math.random() * 0x10000),
                        ), dial!);
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

    // EXPERIMENT (omen): "A feeling before a fight" — read the decoded counter (never write it)
    // and put the field cue on window.__omen for web/ambience.js. Only the last 12 driver runs
    // show anything, and only while the switch is on: off, the counter is not read, no cue is
    // computed and web/omen.js is not called at all.
    if (window.__fx?.omen === true) {
        const om = currentMap();
        const seed = [...om.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) >>> 0;
        // Standing still drains nothing: the feeling fades until the player walks again.
        const quiet = !(state.moving || state.submarimon);
        const level = omenLevel(state._encCounter, state._encLevel, { enabled: true, quiet });
        window.__omen = { level, cues: omenCues(level, seed), seed };
    } else if (window.__omen) {
        window.__omen = null;             // switched off mid-walk: the field clears at once
    }

    // WS4 position-triggered story VM (engine/systems/trigger-system.ts): the player's (x,y)
    // may sit in a step-trigger zone whose gate is open — fire that scripted cutscene
    // (walk-triggered story beats). Runs on ALL stages including the opening (s7xx): the s7xx
    // position cutscenes (s735/736/755/756/800/815) fire here, faithfully by position+flag,
    // never on bare entry. Fully flag-gated + busy-guarded, so it cannot disrupt intro ordering.
    if (S.engineTriggerSystem)
        S.engineTriggerSystem.tick(
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
        onExitZone?.gondola && S.engine && fade.dir === 0 &&
        !textbox.isOpen!() && !battle.isActive() &&
        !(S.engineBridge && S.engineBridge.isBusy()) && !state.gondolaAutoFired
    ) {
        const hasCard =
            S.engine.state.flags.get(0x818e, 1) || S.engine.state.flags.get(0x818f, 1);
        if (!hasCard) {
            state.gondolaAutoFired = true; // once per visit (reset on stage entry)
            startTransition(onExitZone); // → OnExit{to:s440} → event 90 → s400
        }
    }
    // The gondola is auto-only with no card; the "?" prompt is for card-holding
    // (click-to-board) and every other exit.
    state.onExit = !!onExitZone && !(onExitZone.gondola && state.gondolaAutoFired);
}
