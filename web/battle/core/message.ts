import { ST, MSG_KIND, MSG } from "../messages.js";
import { battleMsgBankSync, battleMsgText } from "../../battlemsg-translated.js";
import {
  ui,
  battleMessagePage,
  itemAnnouncementPage,
  ambushRoll,
  RAND_U16,
  introVariantFor,
  stepOpeningPhase,
  spawnPlateHud,
  FIGHT_TASK_ARG_BYTE_OFF,
  FIGHT_TASK_ARG_WORD_OFF,
  spawnFightTask,
} from "../../vendor/engine.js";
import { attackPageSpec, evadePageSpec } from "../hit-results.js";
import { createHpPlateState } from "../hud.js";
import type { BattleContext, BattleState } from "../../types/battle.js";

import type { BattleLineSpec, EngineUi } from "../../types/battle.js";
// moved by tools/rewrite/split-closure.mjs
export function makeMessage(B: BattleContext) {
function tickBattleMessage(b: BattleState, dt: number) {
    const frames = B.advanceDisplayFrames(dt);
    b._displayFrames = frames;
    // While the opening machine has not yet armed the line (its phases 0..4) there is no
    // battle line to show. Suppress the open here so no empty box appears before the
    // original's phase 5 makes its window.
    if (b.state === ST.INTRO && !b._introLineArmed) return;
    for (const frame of frames) {
      B.msgSession.tick(frame.tick, B.msgPadWords);
    }
    B.msgPadWords = 0;
    const text = b.state === ST.LOSE ? "Annihilated..." : String(b.message ?? "");
    // A line the walker read off the original's own call site draws the original's
    // two lines. `b._msgSpec` is set by sayOriginal() and cleared by any site that
    // puts up a line with no read counterpart, so the fallback below is the
    // walker's own wording and never a blank panel.
    const spec = b._msgSpec && b._msgSpecFor === text && battleMsgBankSync() ? b._msgSpec : null;
    const key = spec ? `${text}|${spec.kind}|${spec.payload ?? ""}|${spec.name ?? ""}|${spec.slots ?? ""}`
      : text;
    if (key !== (b._msgOpened ?? null)) {
      b._msgOpened = key;
      if (spec) B.msgSession.openOriginal(spec);
      else B.msgSession.open(text.length ? text.split("\n") : []);
    }
  }
/**
   * Whether the message line is holding the turn.
   *
   * It does, because the original's battle does: every caller of the panel's message
   * object returns while that object is still up -- `lw $v0, ($s2); bnez -> return` in
   * the attack-resolution sequencer F0x80090e84 (`.L0x80091094`) and the same check in
   * the action object F0x80088564 (`.L0x80088680`, `.L0x8008876c`, `.L0x80088ac0`,
   * `.L0x80088afc`). The child runner F0x80018230 zeroes that slot only when the line
   * reaches state 3, which F0x80098a84 phase 3 sets on a Circle press alone
   * (`.L0x80098bb8` -> `.L0x80098c08`). The timed close (phase 4, F0x8009a254 at the
   * object's +0xb0) has no caller, so no line times out.
   *
   * The walker's own gated states are the timed action phases. The player's command
   * menu and the results/report screens are deliberately excluded: they are the ones
   * that own the pad, and the results pages (ST.RESULT_MSG with `_resultPages`) are the
   * walker's post-battle pages, which the original's fight report draws itself.
   *
   * The two phases that can hold an unread line in front of the command menu -- the
   * intro ("Ambush!") and the command phase itself -- are held by
   * `commandPhaseWaitsForLine` instead, because there the original's rule is stronger than
   * "hold the turn": the menu is never built (`wfightmn.s:1494-1496`).
   */
  /**
   * Put up a battle line the original's own call site would put up.
   *
   * `walker` stays in `b.message` so `peek()` still
   * reports what the battle is saying; `spec` is the original's `unkAC(task, kind,
   * payload)` call, which the translated panel turns into the game's two lines:
   * the acting Digimon's name and what the bank says happened.
   *
   * `payload[0]` is the esmfight index the original writes for arms that read it
   * (kinds 1, 2 and 7), and the side test the shared tail uses to choose between
   * the current actor and a party record (FIGHTSTG_F0x80098d14) — 0 for the enemy
   * or the digivolving Digimon, as the original's own sites write it.
   */
  function sayOriginal(b: BattleState, spec: BattleLineSpec, walker: string) {
    b.message = walker;
    b._msgSpec = spec;
    // The spec only belongs to this one sentence: any other site that overwrites
    // `b.message` (there are dozens, and they never clear the field) makes the
    // text disagree and the spec drop out in tickBattleMessage.
    b._msgSpecFor = walker;
  }
/** Drop any original-words spec, for a line the original has no counterpart for. */
  function sayWalker(b: BattleState, walker: string) {
    clearBattleLine(b);
    b.message = walker;
  }
/**
   * Take the battle box down without putting anything up.
   *
   * Two beats need it and neither is a line the original prints: the Digivolution
   * cinematic opens with an empty box (the original builds its `kind 12` "Digivolved!
   * {1}!" page only when the transformation is over, `pro/wfightmn.s:1717`-`:1719`),
   * and the Blast cinematic ends with one (the `esmfight[0x61]` "Blasted!" page is
   * asked for at the moment the gauge saturates, `pro/wfightmn.s:2977`-`:2982` and
   * `pro/fightstg.s:14077`-`:14084`, both before the transformation plays).
   *
   * It is deliberately NOT `sayWalker(b, "")`: an empty walker sentence is a line with
   * no original counterpart, which is a different claim from "the original's box is
   * empty here", and the census in
   * docs/research/battle/battle-message-page-kinds-2026-10-04.md counts the two apart.
   */
  function clearBattleLine(b: BattleState) {
    b.message = "";
    b._msgSpec = null;
    b._msgSpecFor = null;
  }
/**
   * The loss, as the original runs it: `F0x8008CB44` builds the defeat effect, the
   * branch's own tail opens the battle's message window on arm 1 with the payload word
   * the branch wrote, and the exit `F0x800A7C00` later fades the screen out and asks
   * the launcher for 0xE00, the title screen. All of that is the translated session
   * (engine/dw3/ui/battle-loss-session.ts), checked frame by frame against the original
   * routines in tests/lane-b/battle-loss.test.js; this only hands it the four things the
   * session cannot own:
   *
   *   playSound          0x60040008, the GAMEOVER jingle, which the walker's music table
   *                      names gameover (build_music.py renders it gameover.ogg).
   *   armDefeatEffect    the entry tick's cut to the original's close shot — the same
   *                      shared switch update() drives every frame, so it is already in
   *                      this mode and the call is its statement of the beat. The
   *                      motion 0x17 and the class-0x14 object that go with it are the
   *                      renderer's, not built here.
   *   turnDefeatCamera   the per-frame re-apply of that shot through the camera's +0xF8
   *                      with the Y angle grown by delta * 2: web/battle3d.js owns the
   *                      picture in its "defeat" mode and turns it from its own clock.
   *   slowMotion         `[0x800A4548](level)`: F0x8009E510. Level 2 on the entry tick,
   *                      level 0 again when the exit puts the effect in phase 3.
   *
   * The message is NOT built here: the branch's own `window->+0xAC` call is read back out
   * of the session's memory and opened through the already-ported panel, so "Annihilated..."
   * arrives the way every other battle line does.
   */
  function startLossSession(b: BattleState) {
    // ETS item 9: the bundle (web/vendor/engine.js) lost the types of its `ui` export; engine/dw3/ui/index.ts is its source.
    const session = new (ui as EngineUi).BattleLossSession({
      playSound: (id: number) => { if ((id >>> 0) === 0x60040008) B.bgm?.play("gameover"); },
      armDefeatEffect: () => { B.renderer3d?.setCameraMode?.(B.lossCameraMode()); return 0; },
      turnDefeatCamera: () => {},
      // The port owns the level's arming and lowering, the renderer draws the
      // quarter-speed result.
      slowMotion: (level: number) => B.renderer3d?.setSlowMotion?.(level),
    }, { onLaunch: (code: number) => { b._lossLaunch = code >>> 0; } });
    session.begin();
    b._lossSession = session;
    const opened = session.messages[session.messages.length - 1];
    if (opened) {
      const [kind, payload] = opened;
      const id = session.mem.read32(payload) >>> 0;
      sayOriginal(b, { kind, payload: [id] }, B.LOSS_MESSAGE_WORDS![id] ?? "");
    }
    return session;
  }
/** The one place the battle is lost: the shared loss sequence starts here. */
  function enterLossState(b: BattleState) {
    b.state = ST.LOSE;
    b._lossSession = null;
    startLossSession(b);
  }
/**
   * "Fight" chosen: the partner's name on line one and the game's "Attack!" on line
   * two. `fightstg.s .L0x80090fe8` allocates the panel and calls
   * `unkAC(kind 2, {0x08, 0x10})`; `.L0x800996cc` reads the first payload word as
   * line 2's bank index and the shared tail F0x80098d14 fills the name.
   *
   * The SAME page is the enemy's ordinary-attack announcement: one builder
   * (`attackPageSpec`) serves both sides, so the name is an argument and the
   * caller supplies its own fighter.
   */
  function attackSpec(b: BattleState, name: string = b.player?.profile?.name) {
    return attackPageSpec(name);
  }
/**
   * An attack that missed: the defender's name and the game's "Evade!". `fightstg.s`
   * `.L0x8008ed70`, `.L0x800911b0` and `.L0x8009149c` all allocate the panel and call
   * `unkAC(kind 2, {0x1d, 0x10})` — three sites because three different attackers can
   * miss, and all three write the same two payload words.
   */
  function techniqueSpec(b: BattleState, skill: { name: string; }) {
    return {
      kind: MSG_KIND.TECHNIQUE, payload: [MSG.ATTACK], name: b.player.profile.name,
      slots: [skill.name],
    };
  }
/**
   * The same page for the ENEMY's technique: line one is the enemy's name, line two is
   * `esmfight[0x09]` "{1}!" with the technique's own name in slot 1.
   *
   * `payload[0]` is the side test the shared tail reads (`pro/fightstg.s:14371`
   * `li $v0, 0x10` for the enemy arm, and `:14573` for the one in the attack-resolution
   * sequencer), so it is the word that says "name the fighter at `[0x800a4460 + 8]`"
   * rather than the acting Digimon -- the enemy is the other side of the fight from the
   * player's partner.
   */
  function enemyTechniqueSpec(enemyName: string, skill: { name: string; }) {
    // `battleMessagePage(3, ...)` IS the original's call: payload[0] = 0x10 (the side
    // test) and the technique name in slot 1 out of bank 0xa2 by payload[1]
    // (`pro/fightstg.s:23476` / `:23479`).
    return battleMessagePage(MSG_KIND.TECHNIQUE, { name: enemyName, slot: skill.name });
  }
/**
   * The item action's own first page: the announcement, `FIGHTSTG_F0x8008dac0` outer
   * step 0.
   *
   * That step allocates a line object, writes payload word 0 = 0 (`:11158`) and payload
   * word 1 = the ItemId (`:11157`/`:11159`), and calls the panel's `+0xac` with **kind
   * 14** (`:11161` `li $a1, 0xe`). The arm `.L0x80099ca0` (`:23809-23847`) is line 1
   * `esmfight[0x16]` (`:23822`) — the bare name placeholder — line 2 `esmfight[0x09]`
   * `{1}!` (`:23833`), and the second line's slot 1 is the item's name read out of **bank
   * 0x6a by ItemId** (`addiu $a0, 0x6a` at `:23838`, `lw $a2, 0x4($s2)` at `:23841`, then
   * `+0x120(line2, handle, payload[1], 1)` at `:23842`/`:23845`). payload[0] = 0 makes the
   * shared tail name the acting Digimon, not a party record (`:24035` `.L0x8009a028 lw
   * $a2, ($s2)`, then `FIGHTSTG_F0x80098d14 .L0x80098d28 bnez $a2` at `:22789`).
   *
   * So the player reads two lines and one press of Circle before anything happens: the
   * Digimon's name, then the item's own name and "!".
   *
   * @param {object} b the battle
   * @param {{id: number}} item the item the player chose
   * @returns {{kind: number, payload: number[], name: string, slots: string[]}}
   */
  function itemAnnouncementSpec(b: BattleState, item: { id: number | undefined; }) {
    return itemAnnouncementPage(
      b.player.profile.name, item.id, battleMsgText((ui as EngineUi).BATTLE_MESSAGE_BANK_FIELD, item.id));
  }
function evadeSpec(b: BattleState, enemyName: string) {
    return evadePageSpec(enemyName);
  }
/**
   * A fallen enemy's page: the Digimon's name on line one and the bank's own
   * `esmfight[0x51]` "Defeated!" on line two.
   *
   * The original's controller asks for it in one place: `pro/wfightmn.s:3265`
   * (`li $v0, 0x51`) / `:3266` (`sw $v0, 0x50($s2)`) / `:3267` (`li $v0, 0x10` into
   * payload word 1) / `:3270` (`li $a1, 0x2`) / `:3271` (`lw $v0, 0xac($a0)`). The
   * branch at `:3253` (`bnez $a1, .L0x000032e8`) tests the fallen fighter's side
   * index (`lw $a1, 0x4($s0)` / `sra $a1, 0x4` at `:3241`/`:3243`): side 1, the enemy,
   * prints "Defeated!", and side 0 at `:3254`-`:3264` prints `esmfight[0x50]` "KO!"
   * through a different tail (`j 0x800a90d8`).
   */
  function defeatedSpec(enemyName: string) {
    return battleMessagePage(MSG_KIND.OUTCOME, { index: MSG.DEFEATED, name: enemyName });
  }
function msgHoldsTurn(b: BattleState) {
    if (!B.msgSession?.active || B.msgSession.finished) return false;
    if (b._resultPages?.length || b._victoryPhase || b.blastShow) return false;
    return b.state === ST.PLAYER_ACT || b.state === ST.ENEMY_ACT || b.state === ST.RESULT_MSG;
  }
// ── The battle's opening phase machine (port of pro/wfightmn's #2 arm) ──────
  //
  // The seven phases run one per frame (engine/dw3/battle-opening-machine.ts). Every
  // phase's real work is an already-ported system or the walker's own build:
  //
  //   0 assembleBattleObjects      the walker built the scene, the HUD and both fighters
  //                                synchronously in start(), before this frame.
  //   1 loadEncounterAndFighters   the intro variant by the disc's own rule
  //                                (introVariantFor: battle id x map id pairs, map 0x144
  //                                the special-mode-4 arm) + the ambush roll F0x800a684c
  //                                (ambushRoll), fed the encounter's own numbers.
  //   2 queueBattleOverlay         the boot loader (web/wfight-translated.js, the
  //                                WfightLoaderSession) is the overlay F0x800a6414 queues.
  //   3 awaitOverlay               holds while the loader is still running, so a slow load
  //                                cannot let the player reach the menu early.
  //   4 sweepActionQueue           F0x800a69f0; the status-event pool is rebuilt per battle.
  //   5 frameCameraOrOpenLine      no line -> camera beat + EXIT; line -> arm the window.
  //   6 awaitLineThenHandOff       the window is up until the player reads the line, then
  //                                EXIT (top state 1) -> the walker's PLAYER_MENU.
  function armIntroLine(b: BattleState) {
    // The original's own opener: phase 5 makes the window (F0x8009a298) and writes kind 1,
    // payload 7 (wfightmn.s .L0x000012f8) — one line, "Ambush!".
    sayOriginal(b, { kind: MSG_KIND.ONE_LINE, payload: [MSG.AMBUSH] }, "Ambush!");
    b._introLineArmed = true;
    return 1;
  }
/**
   * Phase 1's ambush roll F0x800a684c, fed the encounter's own three numbers.
   *
   * The disc's call site (`wfightmn.s` file `0x10ac`-`0x10fc`) reads the chance
   * byte `[0x80042B1C]+0x3C` (the battle host's copy of the selected screen
   * record's `+0xC` — `fieldstg.s` file `0x8b84`-`0x8b8c`), the first enemy's
   * level `[0x80042B1C]+0x1C` (the host stores it at `fieldstg.s` file `0x8bf8`)
   * and the first party member's level (`GAME + idx*0x3DC + 0x784`), then rolls
   * against the shared RANDOM.next. The result decides BOTH the "Ambush!" page
   * (phase 5's line window) and, in the original, the partner's opening form —
   * the form half is a named gap (engine/dw3/battle-opening-machine.ts).
   *
   * A screen outside the mined encounter table has no row at all: keep the
   * walker's previous default (a line), exactly what the old constant call did.
   * `?introNoLine=1` still forces the no-line branch for captures.
   */
  function introLinePendingFor(b: BattleState) {
    if (B.FORCE_INTRO_NO_LINE) return false;
    const chanceByte = b.encounterGateBytes?.[0];
    if (chanceByte == null) return true;
    // The disc returns BEFORE the RNG draw when the byte is zero (`wfightmn.s`
    // file 0x0a8c-0x0a98), so do not spend a stream value here either.
    if (chanceByte === 0) return false;
    return ambushRoll({
      chanceByte,
      partnerLevel: b.player?.level ?? 0,
      enemyLevel: b.enemy?.level ?? 0,
      roll: RAND_U16(),
    });
  }
function openingPorts(b: BattleState) {
    return {
      assembleBattleObjects() {},
      loadEncounterAndFighters(state: { introVariant: number; specialMode4: boolean; }) {
        const ans = introVariantFor(Number(b.screenId) || 0, Number(String(b.mapId ?? "").replace(/^s/, "")) || 0);
        state.introVariant = ans.variant;
        state.specialMode4 = ans.specialMode4;
        b._introVariant = ans.variant;
        b._specialMode4 = ans.specialMode4;
      },
      introLinePending: () => introLinePendingFor(b),
      queueBattleOverlay: () => (B.wfightNative.isOpen() ? 1 : 0),
      overlayPending: (handle: number) => handle !== 0 && B.wfightNative.isOpen() && !B.wfightNative.diagnostics?.().failed,
      sweepActionQueue() {},
      frameCamera() {},
      frameCameraAndOpenLine: () => armIntroLine(b),
      // The disc's slot-6 create (wfightmn.s:1175-1178, `F0x800a246c`), which the machine runs
      // once per battle at the end of phase 1. The actor itself lives in the renderer, which owns
      // the one camera record and ticks it from the opening camera mode.
      createOpenCamera() { B.renderer3d?.beginOpeningCamera?.(); },
      // The window is up until the message panel that shows it reports the line read.
      lineUp: () => b._introLineArmed && !(B.msgSession && B.msgSession.finished),
    };
  }
/**
   * The opening machine's per-frame step. Returns nothing; when the machine EXITs
   * (top state -> 1) the walker enters its command menu, which is the hand-off the
   * original makes to the already-ported secondary sequencer F0x800a9cb4.
   */
  function stepBattleOpening(b: BattleState, dt: number) {
    stepOpeningPhase(b._opening, openingPorts(b));
    b.timer += dt;
    if (b._opening.exited) {
      // The machine exit is the hand-off: top state 1 is the turn machinery.
      b.state = ST.PLAYER_MENU;
      b.menuSel = 0;
    }
  }
/**
   * The two live members the plate's poll reads, in the original's order: side 0 is
   * the player's active party member out of `0x800a4468`, side 1 the active enemy
   * out of `0x800a446c`, and each carries the record's own `+0x08` and `+0x06`.
   */
  function hpPlateMembers(b: BattleState) {
    return [
      { index: b.activePlayerIndex ?? 0, hp: Number(b.player?.hp ?? 0), maxHp: Number(b.player?.maxHp ?? 0) },
      { index: b.enemySlot ?? 0, hp: Number(b.enemy?.hp ?? 0), maxHp: Number(b.enemy?.maxHp ?? 0) },
    ];
  }
/** The plate object (FIGHTSTG_F0x80093a74), built on its first frame. */
  function hpPlateOf(b: BattleState) {
    if (!b._hpPlate) {
      // FIGHTSTG_F0x80093cc8, the plate-HUD spawner, ported (engine/dw3/battle-task-spawn.ts):
      // the plate object is created through the shared resident allocator with the plate build
      // method 0x80093a74, size 0x88 and flags 0x14. The browser has no allocator — its
      // factory is createHpPlateState — so it supplies the allocator and the port owns the
      // call and its constants; nothing in the spawner's body is hand-written here.
      b._hpPlate = spawnPlateHud((method: number, size: number, flags: number) =>
        Object.assign(createHpPlateState(hpPlateMembers(b)), { method, size, flags }));
    }
    return b._hpPlate;
  }
/**
   * FIGHTSTG_F0x80090c44, the fight task spawner, ported (engine/dw3/battle-task-spawn.ts).
   *
   * The battle command phase allocates the acting fighter's action object through the shared
   * resident allocator with method 0x8008f714 (the technique record machine, so the new
   * object's tick IS that machine), size 0x84 and flags 4, then writes the side byte at +0x50
   * and the technique id word at +0x54. The browser has no allocator and no resident object
   * with a tick pointer — it runs the technique record machine inline over a plain action
   * descriptor — so it supplies the allocator (`spawn`) and the port owns the call, its
   * constants and the two stores. The technique word the record machine runs is read back out
   * of the port's +0x54 store, so the id the machine sees is the one the original stored.
   */
  function spawnFightTaskFor(side: number, techniqueId: number) {
    const spawn = (method: number, size: number, flags: number) => {
      const cell = { method, size, flags, side: 0, technique: 0 };
      return {
        cell,
        write8: (off: number, v: number) => { if (off === FIGHT_TASK_ARG_BYTE_OFF) cell.side = v & 0xff; },
        write32: (off: number, v: number) => { if (off === FIGHT_TASK_ARG_WORD_OFF) cell.technique = v | 0; },
      };
    };
    return spawnFightTask(spawn, side & 0xff, techniqueId | 0).cell;
  }
  return { tickBattleMessage, sayOriginal, sayWalker, clearBattleLine, startLossSession, enterLossState, attackSpec, techniqueSpec, enemyTechniqueSpec, itemAnnouncementSpec, evadeSpec, defeatedSpec, msgHoldsTurn, armIntroLine, introLinePendingFor, openingPorts, stepBattleOpening, hpPlateMembers, hpPlateOf, spawnFightTaskFor };
}
