import { battleSpeedOn, battleDelta } from "../../battle-speed.js";
import { fighterBaseStance, commandPhaseWaitsForLine, enemyMsgName } from "../hud.js";
import { ST, faceBoxHudEvents, DNA_RESULT_TABLE } from "../messages.js";
import { dnaTagBranchKind, FINALE_WIN_ENDING_MOVIE } from "../../vendor/engine.js";
import { jokeMenuRows, COMMAND_COUNT, TAG_PRESENTATION } from "../layout.js";
import { battleAilmentByte } from "../../battlecmd-translated.js";
import { itemForDropName } from "../../drop-item.js";
import { paidParticipants } from "../progress.js";
import { buildFightReportRows, buildFightReportPages } from "../report.js";

// moved by tools/rewrite/split-closure.mjs
export function makeUpdate(B) {
/**
   * The battle's whole frame: message clock, HP plate, blast cinematic and the 3D
   * scene, all stepped by one dt. "Faster battles" (F2 -> Extras, off by default)
   * scales that dt here -- and only here -- so a battle at x2 really is two
   * battle-frames per frame while the field and cutscenes keep the game's own dt.
   */
  function update(dt) {
    if (battleSpeedOn(window.__fx)) dt = battleDelta(dt, window.__fx.battleSpeed);
    if (!B.battle) return;
    const b = B.battle;
    B.tickHudEase(dt);
    // A hurt Digimon rests in the low-HP stance; a healthy one rests in the normal idle. Every
    // action script's trailing "return to base" record plays whichever is current. The finale's
    // head (kind 6, slot 0x10) is the one exception: its flag is the weakened byte.
    B.renderer3d?.setFighterBaseIdle?.("player", fighterBaseStance(b, "player"));
    B.renderer3d?.setFighterBaseIdle?.("enemy", fighterBaseStance(b, "enemy"));
    // Cinematic camera shot follows the battle phase, then render the 3D scene.
    // The walker no longer carries a state list for camera ownership: the renderer retires the
    // idle director on the confirm edge (its own absence makes it stop republishing), and the
    // coordinator answers the live script's ownership directly. The old
    // SCRIPT_OWNED_CAMERA_STATES list was removed 2026-10-08 (worker-bc).
    B.renderer3d?.setCameraMode(
      b.state === ST.TAG_PRESENT ? "tag"
      : b.state === ST.INTRO ? "opening"
      : B.DIRECTOR_STATES.has(b.state) ? "director"
      : b.state === ST.LOSE ? B.lossCameraMode()
      : B.ORBIT_STATES.has(b.state) ? "orbit"
      : "behind",
      { scriptOwnsCamera: !!B.renderer3d?.coordinator?.cameraScriptOwned?.() });
    // The defeat effect F0x8008c93c's FIRST tick -- the same tick that cuts the camera --
    // calls `[0x800a4548](2)`: F0x8009e510(2) stores the level at 0x800a453c, zeroes the
    // accumulator at 0x800a4540 and starts F0x8009e428. That stepper publishes one animation
    // unit out of every four accumulated raw deltas to 0x800a4464, and 0x800a4464 is what the
    // BATTLE's animation clock reads: the model actor's frame counter `self+0x80 += delta`
    // (F0x80083d30, fightstg.s), the second actor clock (.L0x80089614) and every op2
    // slot-motion blend (F0x8009b1fc / .L0x8009b380 / .L0x8009b520 / .L0x8009b5d4). So the
    // fight's own clock runs at a quarter speed while the shot keeps turning at full speed:
    // the orbit reads `[0x8004df9c]()` directly (.L0x8008cad4) and nothing ever swaps that
    // pointer. Nothing on the loss path lowers the level again -- F0x8008c93c's phase 3
    // would, but no writer of phase 3 was found -- so it stays at 2 until the scene goes.
    // The ported loss arms the level from the defeat effect's own first tick (the
    // session's slowMotion port).
    // The close-up face box is one object of the HUD, not a flag: it is up while this
    // side's command menu is up and down from the moment a battle message line is up
    // (engine/dw3/ui/native/battle-face-box.ts; the rule and the five-frame capture in
    // docs/research/battle/captures/face-box-rounds-2026-10-03/). msgHoldsTurn is the
    // walker's own "a line is up and owns the pad" predicate, so the box is fed the same
    // fact the turn machine is held on.
    B.renderer3d?.syncFaceBox?.(faceBoxHudEvents(b, B.msgHoldsTurn(b)));
    B.renderer3d?.render(dt);

    // The battle boot pipeline (the pro/wfightmn SET_STATE bank loader) is the screen's own
    // boot, not a step of the battle's turn machine: in the original it belongs to the host
    // screen, and the message line is a separate fightstg object, so a line holding the turn
    // never starves it. It is ticked here, above every turn hold, because that is the
    // original's shape -- the banks are still arriving while the player reads "Ambush!".
    // It retires by itself, so nothing changes once it has finished.
    if (B.wfightNative.isOpen()) B.wfightNative.update(dt);

    // Blast digivolution (sequence 0x61). Freeze the battle for the whole
    // cinematic: the capture runs ~880 frames with no input and no turn
    // progress, and the form swap and heal land inside it.
    if (b.blastShow) { B.advanceBlastPresentation(b, dt); return; }

    // A line the message panel is showing holds the turn until the player presses
    // Circle, the way the original's own sequencer does (see msgHoldsTurn). The 3D
    // scene, the effects and the HP bar keep running above this line; only the battle's
    // own step machine waits, so nothing else can advance behind the player's back.
    if (B.msgHoldsTurn(b)) return;

    if (b.state === ST.INTRO) {
      // The battle's OPENING PHASE MACHINE (port of pro/wfightmn's #2 arm). It replaces
      // the walker's flat 1.2 s timer: the seven phases run one per frame and the exit
      // (top state 1) hands the fight to the command menu — the original's hand-off to
      // the secondary sequencer F0x800a9cb4.
      B.stepBattleOpening(b, dt);
      return;
    }

    // Phase 6.3 group 4: while the player picks a command, the shipped
    // pro/fightstg list owns the surface. It reports its chosen row on the frame
    // the player confirms; the battle then runs the very same confirm path a
    // Circle press takes, so the native and legacy routes cannot drift.
    // The original battle boot pipeline runs first and retires on its own; the
    // command menu waits for the driver slot. Its own tick sits above, with the
    // other screen work, so a line holding the turn cannot starve it.

    // The TECH screen: the translated pro/fightstg list owns the surface from
    // the frame the TECH command is chosen, and update() hands the chosen
    // technique id back on the frame the player confirms (-2 is a cancel).
    if (b.state === ST.PLAYER_TECH && !B.techNative.failed()) {
      if (!B.techNative.isOpen()) B.techNative.open(B.techListSeed(b));
      const chosen = B.techNative.update(B.getState()?.keys, dt);
      if (chosen !== null && chosen !== undefined) {
        B.techNative.close();
        if (chosen === -2) {
          b.state = ST.PLAYER_MENU;
          return;
        }
        B.confirmTech(b, chosen);
      }
    } else if (B.techNative.isOpen()) {
      B.techNative.close();
    }

    // The ITEM screen: the same hand-off the TECH list uses. The chosen item id
    // comes back on the frame the player confirms (-2 is a cancel), and the
    // battle then runs the very same confirm path the Circle press takes, so the
    // native and legacy routes cannot drift.
    if (b.state === ST.PLAYER_ITEM && !B.itemNative.failed()) {
      if (!B.itemNative.isOpen()) B.itemNative.open(B.itemListSeed(b));
      const chosen = B.itemNative.update(B.getState()?.keys, dt);
      if (chosen !== null && chosen !== undefined) {
        B.itemNative.close();
        if (chosen === -2) {
          b.state = ST.PLAYER_MENU;
          return;
        }
        B.confirmItem(b, chosen);
      }
    } else if (B.itemNative.isOpen()) {
      B.itemNative.close();
    }

    // The TAG partner list: the translated pro/fightstg screen owns the surface
    // from the frame the Tag command is chosen, and update() hands the chosen
    // party slot back on the frame the player confirms (-2 is a cancel).
    if (b.state === ST.PLAYER_TAG && !B.tagNative.failed()) {
      if (!B.tagNative.isOpen()) B.tagNative.open(B.tagListSeed(b));
      const chosen = B.tagNative.update(B.getState()?.keys, dt);
      if (chosen !== null && chosen !== undefined) {
        // fightstg.s:21312: the confirm stores the cursor row into the cell the
        // screen opened from, before the party slot, so the NEXT list this battle
        // opens starts on the row the player last took. A refused confirm (the
        // row's HP is 0, fightstg.s:21300-21308) answers nothing, so the word is
        // untouched and the cursor stays where it was.
        const row = B.tagNative.chosenRow?.();
        if (typeof row === "number") b.tagRow = row;
        B.tagNative.close();
        if (chosen === -2) {
          if (b._forcedTag) return;
          b.state = ST.PLAYER_MENU;
          return;
        }
        B.confirmTag(b, chosen);
      }
    } else if (B.tagNative.isOpen()) {
      B.tagNative.close();
    }

    // The Digivolve form list: the translated pro/fightstg screen owns the surface
    // from the frame the DV command is chosen. update() hands back the chosen
    // species id on the frame the player confirms, and -2 on a cancel.
    if (b.state === ST.PLAYER_DV && !B.formNative.failed()) {
      if (!B.formNative.isOpen()) B.formNative.open(B.formListSeed(b));
      const species = B.formNative.update(B.getState()?.keys, dt);
      if (species !== null && species !== undefined) {
        B.formNative.close();
        if (species === -2) {
          b.state = ST.PLAYER_MENU;
          return;
        }
        B.confirmDvForm(b, species);
      }
    } else if (B.formNative.isOpen()) {
      B.formNative.close();
    }

    // The follow-up pane, the original's ONE object for both the DNA command and
    // the Tag follow-up (both walk into ST.PLAYER_DNA_CHOICE). It answers with
    // the row it took in the low nibble and the species under its cursor in the
    // high nibble. Cross on the names writes -2; both phase routes restart
    // their partner picker on that word (fightstg.s:16314-16316).
    if (b.state === ST.PLAYER_DNA_CHOICE
        && !B.dnaNative.failed() && !b._dnaBranchBlocked) {
      if (!B.dnaNative.isOpen()) B.dnaNative.open(B.dnaPaneSeed(b));
      const answer = B.dnaNative.update(B.getState()?.keys, dt);
      if (answer !== null && answer !== undefined) {
        B.dnaNative.close();
        B.applyDnaAnswer(b, answer, dnaTagBranchKind(!!b._forcedTag));
      }
    } else if (B.dnaNative.isOpen()) {
      B.dnaNative.close();
    }

    if (b.state === ST.PLAYER_MENU) {
      // The command list is built here, so while a line is up and unread this branch does
      // not run at all: the original's controller instruction returns before it arms
      // anything while the line's slot is occupied (commandPhaseWaitsForLine,
      // `wfightmn.s:1494-1496`). No list is opened and nothing reads the pad until the
      // line has been read.
      if (commandPhaseWaitsForLine(B.msgSession, b.state)) return;
      // The Frozen gate sits between the line wait and the arming, where the original
      // puts it (F0x800a7418 step 1, `wfightmn.s:1503-1512`). A partner that loses the
      // roll never gets a list: its line goes up and the turn is handed straight to the
      // next actor. The line itself holds the turn through commandPhaseWaitsForLine above.
      if (B.frozenGateLosesTurn(b)) {
        if (b._timelineMessage) {
          // Poison or a timed recovery landed on the lost turn; the walker's own line for
          // it comes first, the way FLEE_FAIL shows the same pending timeline text.
          b.state = ST.RESULT_MSG;
        } else {
          b.state = b._nextState ?? ST.ENEMY_ACT;
          b.menuSel = 0;
        }
        b.timer = 0;
        return;
      }
      if (!B.commandNative.failed() && !B.wfightNative.isOpen()) {
        // Null unless the acting Digimon is confused, and then the six joke rows
        // this decision is drawn from (shuffled once, as the original's owner does).
        const joke = jokeMenuRows(b);
        if (!B.commandNative.isOpen()) {
          B.commandNative.open(joke ? 0 : b.menuSel | 0, {
            activeIndex: b.activePlayerIndex | 0,
            ailmentBits: battleAilmentByte(b.player),
            // The joke owner (FIGHTSTG_F0x8009A898) builds the same six-row widget
            // from the joke config and the shuffle's own six entries.
            jokeIndices: joke ? joke.map((j) => j.jokeIndex) : null,
          });
        }
        const row = B.commandNative.update(B.getState()?.keys, dt);
        if (row !== null && row !== undefined && row < COMMAND_COUNT) {
          B.commandNative.close();
          if (joke) {
            // The joke owner answers with the chosen joke; the walker's own
            // remembered row belongs to the command list, not to the gag.
            B.confirmJokePick(b, row);
          } else {
            b.menuSel = row;
            B.confirmCommand(b);
          }
        }
      } else if (B.commandNative.isOpen()) {
        // The hand-drawn list takes over when the shared list cannot run.
        B.commandNative.close();
      }
    }

    if (b.state === ST.RESULT_MSG) {
      b.timer += dt;
      // A technique's result belongs to the technique, not to its animation: the
      // original's record machine runs after the action and never reads the clip. A
      // script that fires no contact — clip 15, the seven field techniques — must still
      // put its page up, so an armed result is committed as soon as the action is over.
      B.commitPendingImpact(b);
      // A counter swings back once the blow that provoked it is over, and the page waits for it.
      if (B.stepCounter(b)) return;
      // Hold the result message until the attack/recoil animation has finished (or a 5s safety cap),
      // so the next actor's turn starts AFTER the current action plays out — not mid-animation.
      if (b.timer > 1.0 && (!B.animBusy() || b.timer > 5.0)) {
        if (b._resultPages?.length) {
          b._resultReady = true;
          return;
        }
        B.advanceAfterResult(b);
      }
      return;
    }

    if (b.state === ST.PLAYER_ACT) {
      b.timer += dt;
      if (b.timer > TAG_PRESENTATION.outgoingSeconds) {
        const presentation = B.applyPlayerAction();
        // The tag commits the new active fighter at the entrance's cut (f114); the turn is queued with the
        // OUTGOING fighter's speed (read at command time, menu.c:312): commitTag calls queueAfterAction.
        if (presentation !== true) B.queueAfterAction(b, "player");
        if (presentation === "dna") {
          b.state = ST.DNA_PRESENT;
          b.timer = 0;
          return;
        }
        if (presentation) {
          b.state = ST.TAG_PRESENT;
          b.timer = 0;
          return;
        }
        B.tickBlastTurn(b);   // this committed player turn counts against the Blast schedule
        b.state = ST.RESULT_MSG;
        // After player acts: if enemy was faster, they already went — go to menu; else enemy goes next
        if (b.enemy.hp <= 0) b._nextState = ST.WIN;
        b.timer = 0;
      }
      return;
    }

    if (b.state === ST.TAG_PRESENT) {
      // "prompt": the 0x38 line waits for Circle (handleKey). "entrance": b.blastShow runs the entrance and its
      // onDone moves on to RESULT_MSG (the loop above returns while it runs).
      return;
    }

    if (b.state === ST.DNA_PRESENT) {
      const dna = b._dnaPresentation;
      if (!dna) return;
      b.timer += dt;
      if (dna.mode === "full") {
        // Segment sequencer: each segment plays as its own script; when its VM ends the owner
        // advances to the next chunk, swapping the single stage actor when the model changes
        // (no op0 barrier: the mode-4 skip word was misread as one; clip12-full-script.md).
        if (dna.swapping || B.renderer3d?.playerAnimator?.vm) return;
        const prev = dna.chunks[dna.chunk];
        dna.chunk += 1;
        const next = dna.chunks[dna.chunk];
        if (!next) {                       // op255 teardown done → back to the battle
          B.renderer3d?.setDataField(false);
          B.renderer3d?.dnaPresentationStop?.(); // the beach/arena returns with teardown
          B.renderer3d?.setFaceCamVisible?.(true);
          B.renderer3d?.setEnemyVisible?.(true);
          B.renderer3d?.setPlayerVisible(true);
          B.renderer3d?.setPlayerAnim("idle");
          // The cinematic (attack included) plays inside the void; the instant it ends and
          // cuts back to the arena, the enemy plays its hit-recoil and the damage line
          // appears in the bottom message panel (original shows "{1} damage!" via the
          // message-panel VM kind 4, not a floating number — BATTLE-Q004-DMGMSG-001).
          // Reaction lives here — in the normal battle view — not during the void sequence.
          if (dna.hit) B.renderer3d?.setEnemyAnim?.("hit");
          const enemyName = enemyMsgName(b.enemy);
          if (dna.restoreRecord) B.commitDnaRestore(b, dna);
          else if (dna.hit) B.commitDnaImpact(b, dna);
          else b.message = `${dna.fusedName ?? dna.resultProfile.name}! ${enemyName} evaded!`;
          b._dnaPresentation = null;
          b.state = ST.RESULT_MSG;
          b.timer = 0;
          return;
        }
        if (next.model !== prev.model) {   // boundary swap happens while the actor is hidden
          dna.swapping = Promise.resolve(B.swapPlayerModel(next.model)).then((ok) => {
            if (B.battle !== b || b._dnaPresentation !== dna) return;
            // A result whose model has no pack to load holds the acting form in
            // the result slot — never the partner, which the previous chunk left
            // on screen. All ten fusions now have their pack (the three
            // Jogress-only results 468 Agunimon, 469 BladeGarurumon and 470
            // AncientGreymon were built from the disc on 2026-10-03), so this is
            // the guard for a model id the game never shipped a mesh for.
            if (ok === false && next.result) {
              return Promise.resolve(B.swapPlayerModel(dna.originalProfile.name)).then(() => {
                if (B.battle !== b || b._dnaPresentation !== dna) return;
                dna.swapping = null;
                B.startDnaChunk(b, dna);
              });
            }
            dna.swapping = null;
            B.startDnaChunk(b, dna);
          });
        } else {
          B.startDnaChunk(b, dna);
        }
        return;
      }
      if (dna.phase === "parents" && b.timer >= 3) {
        dna.phase = "loading-result";
        b.timer = 0;
        B.renderer3d?.setPlayerVisible(false);
        Promise.resolve(B.swapPlayerModel(dna.resultProfile.name)).then(() => {
          if (B.battle !== b || b._dnaPresentation !== dna) return;
          dna.phase = "result";
          b.timer = 0;
          B.renderer3d?.playPlayerScript(B.dnaResultScript, {
            motionTables: { 30: DNA_RESULT_TABLE },
            rotationBase: B.dnaResultScript.resultSlot.rotation[1],
            onOverlay: () => B.renderer3d?.setPlayerVisible(true),
          });
        });
      } else if (dna.phase === "result" && b.timer > 1 && !B.renderer3d?.playerAnimator?.vm) {
        dna.phase = "restoring";
        Promise.resolve(B.swapPlayerModel(dna.originalProfile.name)).then(() => {
          if (B.battle !== b || b._dnaPresentation !== dna) return;
          B.renderer3d?.setPlayerVisible(true);
          B.renderer3d?.setFaceCamVisible?.(true);
          B.renderer3d?.dnaPresentationStop?.();
          B.renderer3d?.setPlayerAnim("idle");
          const enemyName = enemyMsgName(b.enemy);
          if (dna.restoreRecord) B.commitDnaRestore(b, dna);
          else if (dna.hit) B.commitDnaImpact(b, dna);
          else b.message = `${dna.fusedName ?? dna.resultProfile.name}! ${enemyName} evaded!`;
          b._dnaPresentation = null;
          b.state = ST.RESULT_MSG;
          b.timer = 0;
        });
      }
      return;
    }

    if (b.state === ST.ENEMY_ACT) {
      b.timer += dt;
      if (b.timer > 0.6) {
        B.applyEnemyAction();
        // The enemy's own tag ends its turn only after the entrance and the name page (enemy_turn.c substates
        // 3-6): the turn's status events are queued then (advanceAfterResult), with the new enemy in place.
        if (!b._selfTag) B.queueAfterAction(b, "enemy");
        b.state = ST.RESULT_MSG;
        b.timer = 0;
      }
      return;
    }

    if (b.state === ST.WIN) {
      if (b._winReward === undefined) {
        // EXP/BIT/DVEXP come from the battle's own reward record; only drops were
        // accumulated per defeated enemy in defeatCurrentEnemy. First drop shown on the
        // win screen; endBattle applies every drop to the inventory.
        // A defeated Cardmon grants a guaranteed Booster in place of the ordinary
        // drop (its sprite records are drop_rate 0), so the report shows it AND
        // endBattle banks it from _loot.drops like any other drop.
        const boosterId = B.cardmonBoosterForBattle(b);
        const boosterName = boosterId != null
          ? (window.__ITEM_BY_ID?.[boosterId]?.name ?? null) : null;
        if (boosterName && !b._loot.drops.includes(boosterName)) b._loot.drops.push(boosterName);
        const firstDrop = b._loot.drops.find(Boolean) ?? null;
        const droppedItem = firstDrop ? itemForDropName(firstDrop) : null;
        const rewards = B.winRewards(b);
        // Only the participants still standing at the outcome are paid, and only
        // they divide the share (paidParticipants; pro/wfightmn.s
        // .L0x00002070 and pro/stfgtrep.s .L0x00002c68).
        const progress = paidParticipants(b)
          .map((index) => ({ index, ...B.applyParticipantProgress(b, index) }));
        const activeProgress = progress.find((entry) => entry.index === b.activePlayerIndex)
          ?? progress[0] ?? { xp: 0, newLevel: b.player.level, levelUp: false };
        b._winProgress = progress;
        b._winApplied = true;
        b._winReward = { xp: rewards.xp, bits: rewards.bits, dvexp: rewards.dvexp,
                         droppedItem, levelUp: activeProgress.levelUp };
        b._winNewLevel = activeProgress.newLevel;
        // XP is already on the roster; the report shows the banked totals.
        b._winReportRows = buildFightReportRows(
          b.playerRoster, b.playerRecords, B.digimonDB,
        );
        b._winPages = buildFightReportPages({
          xp: rewards.xp,
          bits: rewards.bits,
          droppedItem: droppedItem?.name ?? null,
          events: progress,
        });
        // ITEM_GET plays when the reward presenter shows an item drop
        // (wfightmn [s0+4]==0 branch, sfx-triggers.json)
        if (droppedItem) B.sfx?.play("item_get");
      }
      if (b._victoryPhase === "pose") {
        b.timer += dt;
        // Table 44 loops after its authored first cycle.  Only then may the player close the
        // "Battle Won!" message; the timer is a safety path for a missing/late 3D model.
        if (B.renderer3d?.playerVictoryComplete || b.timer > 3) {
          b._victoryReady = true;
          b.timer = 0;
          if (b._winLaunchCode === FINALE_WIN_ENDING_MOVIE) {
            // The finale's win goes straight into the ending movie
            // (wfightmn.s:2165-2174): STFRPT never opens, the launch cue 0xE0B
            // plays movie row 10 (MOVIEE01_STR) and its own return selector
            // chains to row 11 (MOVIEE02_STR) and then 0x2d7 (screen 727 =
            // stage 780). The host plays the chain and calls finishEnding when
            // it is done; with no host the battle finishes directly rather than
            // stranding the player in the ending phase.
            b._victoryPhase = "ending";
            b._endingHosted = B.endingHandoff?.play ? B.endingHandoff.play(b) === true : false;
            if (!b._endingHosted) B.endBattle("win");
          } else {
            b._victoryPhase = "report";
            b._winPageIndex = 0;
            // The native results screen takes over the whole framebuffer when a
            // host is registered; the inline report stays the fallback.
            if (B.reportHandoff?.open) b._reportNative = B.reportHandoff.open(b) === true;
          }
        }
      } else if (b._victoryPhase === "report") {
        b.timer += dt;
        const page = b._winPages?.[b._winPageIndex ?? 0];
        if (page && b._winJinglePage !== (b._winPageIndex ?? 0)) {
          b._winJinglePage = b._winPageIndex ?? 0;
          if (page.jingle) B.sfx?.play(page.jingle);
        }
      }
      return;
    }

    if (b.state === ST.LOSE) {
      // The translated sequence, one tick per displayed frame: the exit F0x800a7c00,
      // the defeat effect F0x8008c93c and the fade F0x8008aa08 are the original's own
      // objects, in the session's memory, and the delta they count is the shared frame
      // clock's published word (engine/systems/frame-clock.ts). The screen goes black a
      // tenth of a second at a time and the exit asks for the title screen (0xE00) out
      // of that black; the launch itself is the walker's screen change, `onLose`.
      const session = b._lossSession;
      // One step per displayed frame, each counting that frame's published delta: the
      // defeat effect reaches its phase 2 after 0xF0 delta units, and the exit's turns
      // and the fade's ramp are the original's own objects inside the session.
      for (const frame of (b._displayFrames ?? [])) session.tick();
      b.timer += dt;
      // F0x8008a96c: the quad's grey is the fade level's high byte, so the first tenth
      // of the fade is 25 and not 26.
      b._loseFade = session.fadeLevel() === 0 ? 0 : session.fadeGrey() / 255;
      if (session.finished()) {
        if (session.launchCode() !== 0xe00) console.warn("[battle] loss exit asked for", session.launchCode());
        B.endBattle("lose");
      }
      return;
    }

    if (b.state === ST.FLEE_FAIL) {
      b.timer += dt;
      if (b.timer > 1.0) {
        if (b._timelineMessage) {
          b.message = b._timelineMessage;
          b._timelineMessage = "";
          b.state = ST.RESULT_MSG;
        } else {
          b.state = b._nextState ?? ST.ENEMY_ACT;
        }
        b.timer = 0;
      }
      return;
    }
  }
  return { update };
}
