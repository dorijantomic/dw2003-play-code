import { createBattleLayer, releaseBattleLayer } from "../../battle-layer.js";
import { createBattle3D, resolveModelFolder } from "../../battle3d.js";
import {
  applyGiantScales,
  giantModeOn,
  blastTargetProfile,
  setLiveBattleForm,
  blastLandingHeal,
  releaseReservedSecondForm,
} from "../form-blast.js";
import {
  cardmonBooster,
  RAND_U16,
  FormChangeProgram,
  DV_TASK_START_FRAME,
  formChangeState,
  evolEffectsDue,
  BLAST_FIRST_FRAME,
  formChangeSoundFrame,
  formChangeMusicFrame,
} from "../../vendor/engine.js";
import { DV_GAUGE_MAX } from "../layout.js";
import { MSG_KIND, MSG } from "../messages.js";
import { digivolveDemoOn } from "../../blast-presentation.js";
import { lowHpStance, enemyMsgName } from "../hud.js";
import { ENTRANCE_TASK_END_FRAME } from "../../enemy-switch.js";
import { clearActionAffinity } from "../restore.js";
import type { BattleContext } from "../../types/battle.js";

import type { BattleState } from "../../types/battle.js";
interface BattleEntranceEndSpec {
  kind: number;
  payload: number[];
  name: string;
}

interface BattleEntranceArgs {
  side: number;
  name: string;
  endMessage?: string;
  endSpec?: BattleEntranceEndSpec | null;
  onSwap?: (() => void) | null;
  onDone?: (() => void) | null;
  onTaskEnd?: (() => boolean) | null;
}

interface BattleEntranceShow {
  program: string;
  frame: number;
  target: null;
  swapped: boolean;
  healed: boolean;
  state: null;
  sounded: boolean;
  endMessage: string;
  endSpec: BattleEntranceEndSpec | null;
  swapName: string;
  entranceSide: number;
  onSwap: (() => void) | null;
  onDone: (() => void) | null;
  onTaskEnd: (() => boolean) | null;
  taskEnded: boolean;
  entrance: { folder: string | null; ready: boolean };
}

// moved by tools/rewrite/split-closure.mjs
export function makeOpening(B: BattleContext) {
function _battleTargetSize() {
    const stage = B.canvas!.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(640, Math.round((stage?.clientWidth  || 640)));
    const ch = Math.max(480, Math.round((stage?.clientHeight || 480)));
    const cap = 1600;                                   // keep fill-rate sane
    const k = Math.min(1, cap / Math.max(cw * dpr, ch * dpr));
    return { w: Math.round(cw * dpr * k), h: Math.round(ch * dpr * k) };
  }
function enterBattleFullscreen() {
    B._savedCanvas = { w: B.canvas!.width, h: B.canvas!.height };
    B.canvas!.classList.add("battle-fs");
    const { w, h } = _battleTargetSize();
    B.canvas!.width = w; B.canvas!.height = h;
  }
function exitBattleFullscreen() {
    B.canvas!.classList.remove("battle-fs");
    if (B._savedCanvas) { B.canvas!.width = B._savedCanvas.w; B.canvas!.height = B._savedCanvas.h; B._savedCanvas = null; }
  }
function onBattleResize() {
    if (!B.battle) return;
    const { w, h } = _battleTargetSize();
    B.canvas!.width = w; B.canvas!.height = h;
    if (B.offscreen3d) { B.offscreen3d.width = w; B.offscreen3d.height = h; }
  }
async function _init3DRenderer(b: BattleState) {
    try {
      B.offscreen3d = createBattleLayer(B.canvas)
        ?? (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(B.canvas!.width, B.canvas!.height) : null);
      if (!B.offscreen3d) return;
      B.renderer3d  = createBattle3D(B.offscreen3d, B.sfx);
      if (!B.renderer3d) { releaseBattleLayer(); B.offscreen3d = null; return; }
      // The disc's own per-AREA battle arena: the field screen the fight started on and the
      // encounter id it rolled resolve to the battle descriptor's arena id (the trigger record's
      // `param`, copied to 0x80042b28 by fieldstg fn 0x800925a8), which selects the SFSTDATA
      // MEFT10<id> stage pack. See web/battle3d.js `setArenaStage`.
      B.renderer3d.setArenaStage?.(b.mapId, b.screenId);
      window.__battle3d = B.renderer3d;  // debug handle (matches window.__ITEM_BY_ID pattern)
      window.__battleB = () => B.battle; // debug handle: live battle state (labs/headless diagnostics)
      // Phase 6.3 group 4: the shipped pro/fightstg command list's adapter, so a
      // focused check can read its boot/traps and the row it handed back.
      window.__battleCmdNative = B.commandNative;
      window.__battleTechNative = B.techNative;
      window.__battleItemNative = B.itemNative;
      window.__battleTagNative = B.tagNative;
      window.__battleFormNative = B.formNative;
      window.__battleDnaNative = B.dnaNative;
      window.__battleWfightmn = B.wfightNative;
      // Debug handle: start the Blast transformation on demand. In play it only
      // fires when the DV gauge saturates, which a headless capture cannot reach
      // reliably; this runs the SAME triggerBlast the gauge path calls, so the
      // lab exercises the real cinematic and not a copy of it.
      window.__battleBlast = () => triggerBlast(B.battle);
      // The other two sequences on the same manager, for the same reason: both
      // run the REAL commit path, so the lab exercises the shipped code.
      window.__battleDv = (formId) => {
        const cur = B.battle.player.profile?.id;
        const opts = B.formOptionsFor(B.battle.activePlayerIndex) || [];
        // Fall back to any other profile. The lab's level-5 starter usually has
        // NO eligible evolution, so requiring one made this entry point unusable
        // for a capture. The eligibility gate still lives on the real DV menu
        // path; this only picks a destination for applyDvAction, which is the
        // shipped commit either way.
        const pick = formId
          ?? opts.find((f) => f.id !== cur)?.id
          ?? Object.keys(B.digimonDB || {}).map(Number).find((id) => id !== cur);
        if (pick == null) return false;
        B.applyDvAction({ type: "dv", formId: pick });
        return true;
      };
      window.__battleRevert = () => {
        // Arm a Blast if one is not active, so revertBlast has a form to
        // restore; reverting is what is under test, not the arming.
        if (!B.battle.blast) {
          B.battle.blast = {
            active: true,
            savedFormId: B.battle.player.profile?.id ?? B.battle.player.rookieId,
            playerTurns: 1,
          };
        }
        revertBlast(B.battle);
        return true;
      };

      const playerName = b.player.profile.name;
      const enemyName  = b.enemy.eStats?.digimon_id ?? b.enemy.profile?.name ?? "";

      const [pFolder, eFolder] = await Promise.all([
        resolveModelFolder(playerName),
        resolveModelFolder(enemyName),
      ]);
      if (B.renderer3d) {
        if (pFolder) B.renderer3d.setPlayerDigimon(pFolder);
        if (eFolder) B.renderer3d.setEnemyDigimon(eFolder);
        // Giant mode part 1: the opening member's own size. The toggle gates the read; off, the
        // renderer is not called at all and both sides stay at the shipped size.
        applyGiantScales(B.renderer3d, b?.party?.[b?.partyIndex ?? 0], giantModeOn());
        // The disc opens a fight on a canned shot the ENEMY's record names, framing our
        // Digimon (FIGHTSTG_F0x800880f0 sub-state 0 -> F0x8009257c). It yields as soon as
        // an action's own camera runs.
        B.renderer3d.applyIntroCamera?.();
        // The same fight-opening actor cues COMCD103 here: in its state-1 sub-state 0 it
        // applies that shot ([+0x100]/[+0xf8], .L0x80088244-.L0x80088264), creates the
        // effect-0x33 owner (.L0x80088268) and plays 0x800429bf through [0x80055c48]
        // (.L0x8008828c-.L0x80088290). One cue per battle open, every battle.
        B.sfx?.play("comcd103");
      }
    } catch (err) {
      releaseBattleLayer();
      B.renderer3d = null; B.offscreen3d = null;
    }
  }
// The entry warp's own parameter, latched into game state when the warp ran
  // (web/game.js, the fade.pending map change). This is the walker's stand-in
  // for the u16 at [0x80048d78] that the fieldstg warp executor writes from the
  // step record's params[5]. runtime_key stages (Seabed/Circuit/endgame) select
  // which of their zone-block groups is live by matching it.
  function entryKey() {
    const k = Number(B.getState()?.entryKey ?? 0);
    return Number.isFinite(k) && k > 0 ? k : undefined;
  }
// The master story-progress ordinal [0x8004b370] — the walker's single source of
  // truth is the engine's `$story.ordinal`, proxied by game state.progressOrdinal.
  // Multi-group stages (scene_struct+0x20, see engine/dw3/encounters.ts) pick which
  // record's four zone blocks are live from it.
  function storyOrdinal() {
    return Number(B.getState()?.progressOrdinal ?? 0) || 0;
  }
// The guaranteed Booster pack a defeated Cardmon leaves (fieldstg battle setup
  // F0x8008B798; the pure selection is engine/dw3/cardmon-booster.ts). The fight's
  // field screen keys the odd/even table and the enemy id parity picks which; the
  // draw is RAND_U16 masked to 0x1f/0xf. Returns the item id or null for any other
  // enemy. Computed once per battle and remembered, because the native flag is set
  // at setup.
  function cardmonBoosterForBattle(b: BattleState) {
    if (b._cardmonBoosterId !== undefined) return b._cardmonBoosterId;
    b._cardmonBoosterId = null;
    const entries = B.fieldEncDB?.screens?.[String(b.screenId)];
    const card = entries?.find((e) => String(e.name ?? "").startsWith("Cardmon"));
    if (card && B.cardmonBoostersDB) {
      const screen = Number(String(b.mapId ?? "").replace(/^s/, ""));
      b._cardmonBoosterId = cardmonBooster(B.cardmonBoostersDB, {
        screen, enemyId: card.id, rand: RAND_U16(), progressOrdinal: storyOrdinal(),
      });
    }
    return b._cardmonBoosterId;
  }
// ── Automatic Blast digivolution (event 0x12/0x13) ─────────────────────────
  // Decoded + runtime-verified 2026-07-13/14 (BLAST-C001..C010). The DV gauge
  // fills from taking hits (gaugeGain); saturating at DV_GAUGE_MAX enqueues the
  // automatic Blast. Blast picks a target from the partner's ROOKIE-profile
  // blasts[] by battle-level tier, heals to full unconditionally, and reverts on
  // a turn-queue schedule of 6 player + 3 enemy turns. While active, techniques
  // are MP-free and the gauge takes no further gain (a Tag would forfeit it).

  /** True when the gauge just saturated and an automatic Blast can fire. */
  function blastReady(b: BattleState = B.battle) {
    return !b?.blast?.active
        && (b?.player?.gauge ?? 0) >= DV_GAUGE_MAX
        && !!blastTargetProfile(b?.player, B.digimonDB);
  }
/**
   * Begin Blast-on. The form swap, the full heal and the EVOLUTIO jingle do not land on
   * this call: the original change task (digimon_change.c, timeline in
   * engine/systems/blast-presentation.ts) plays EVOLUTIO on f-180, swaps the model on f278 and
   * the menu heals when the new model's motion is 13 (f438), so advanceBlastPresentation()
   * applies them on those frames, counted from the task start f-214. The state flags land here.
   */
  function triggerBlast(b: BattleState = B.battle) {
    const p = b.player;
    const target = blastTargetProfile(p, B.digimonDB);
    if (!target) return false;
    b.blast = { active: true, savedFormId: p.profile?.id ?? p.rookieId, playerTurns: 6 };
    // The shared digivolution jingle EVOLUTIO [BLAST-C009] is played by advanceBlastPresentation on f-180.
    // EVOLUTIO (0x41140000) is a bit-30 music-start id: its start takes the one
    // exclusive-track register D0x80055c34 and the register stops the held battle
    // track through it — no explicit stop call is needed (fns.s:17704-17717). The
    // track is re-triggered by returnToBattle on f651 (see the replay in
    // advanceBlastPresentation), and that start stops EVOLUTIO in turn.
    // esmfight 0x61 = "Blasted!", shown under the name banner (obj A carries
    // string 0x16 = "{1}", the bare name slot).
    B.sayOriginal(b,
      { kind: MSG_KIND.OUTCOME, payload: [MSG.BLASTED], name: p.profile?.name ?? "Your partner" },
      `${p.profile?.name ?? "Your partner"} Blasted!`);
    // The presentation itself. `frame` counts 60 Hz ticks, f0 = the start cut; the task starts on f-214.
    b.blastShow = {
      program: FormChangeProgram.BLAST_ON,
      frame: DV_TASK_START_FRAME, target, swapped: false, healed: false, state: null, sounded: false,
      endMessage: "",   // the "Blasted!" line already showed; nothing follows it
    };
    // No face-cam inset during the transformation: the capture is a clean scene
    // with only the two HP plates over it.
    B.renderer3d?.setFaceCamVisible?.(false);
    return true;
  }
/**
   * Advance the Blast transformation by `dt` seconds and apply whatever its
   * decoded schedule says lands on this frame. The battle state machine is
   * frozen while this runs — the capture is 14 s of cinematic with no input and
   * no turn progress.
   */
  function advanceBlastPresentation(b: BattleState, dt: number) {
    const show = b.blastShow;
    // An entrance first has its entering fighter's model loaded (the original adds it hidden in state 0 before
    // anything shows): the presentation clock does not start until the folder is resolved and preloaded.
    if (show.entrance && !show.entrance.ready) return;
    // "Digivolve Demo: OFF" (the pause-menu setting) skips the CINEMATIC only.
    // The program still runs; it is advanced far enough in one step to cross
    // every threshold it owns, so the model swap, the full heal and the end
    // state all still fire and the battle reaches an identical state. The
    // transformation effects are suppressed because they are the cinematic.
    const skip = !digivolveDemoOn();
    if (skip) show.frame = 1e6;
    else show.frame += dt * B.BLAST_CAPTURE_HZ!;
    const prevFrame = show.lastFrame ?? -Infinity;
    const frame = Math.round(show.frame);
    show.lastFrame = frame;
    const s = formChangeState(show.program, frame);
    // The REAL transformation art: E000EVOL effect types spawned through the
    // same EffectPlayer op3 uses (claim
    // blast-dv-visuals-are-e000evol-effects-2026-08-13).
    if (!skip) {
      for (const sp of evolEffectsDue(show.program, prevFrame, frame)) {
        B.renderer3d?.blastSpawnEffect?.(sp.type, sp.pos);
      }
    }
    show.state = s;
    B.renderer3d?.blastPresentationSet?.(s, show.program, skip,
      () => lowHpStance(show.entranceSide === 1 ? b.enemy : b.player), show.entrance ?? null);

    // The "... Blasted!" line is dismissed before the animation proper starts.
    if (show.program === FormChangeProgram.BLAST_ON
      && show.frame >= BLAST_FIRST_FRAME && b.message) b.message = "";

    // Each program's jingle fires on its own frame, not at commit: EVOLUTIO on f-180 for
    // Blast and manual DV (substate 1, once the stage fade-out is over) and the revert's
    // PLAYER11 at +50 (blast_run4.txt: commit f5938, SOUND 0xa0045ec9 f5991).
    const soundFrame = formChangeSoundFrame(show.program);
    if (!show.sounded && soundFrame != null && frame >= soundFrame) {
      show.sounded = true;
      if (show.program === FormChangeProgram.BLAST_REVERT || show.program === FormChangeProgram.ENTRANCE_ENEMY) B.sfx?.play("player11");
      else B.sfx?.playBank?.("evo_00", "evolutio");   // takes the register; the battle track stops
    }
    // returnToBattle (f651, the run that arms the camera fade): the battle music starts again. That
    // start stops EVOLUTIO through the same register — two exclusive starts, no stop call.
    const musicFrame = formChangeMusicFrame(show.program);
    if (!show.musicBack && musicFrame != null && frame >= musicFrame) {
      show.musicBack = true;
      if (B.bgm && b._battleTrack) B.bgm.play(b._battleTrack);
    }

    // Swap point (f278, swapInNewDigimon): from here the fighter IS the incoming form, wiped in
    // over its wireframe by the renderer. Blast and manual DV both swap here. The ENTRANCE (either side)
    // swaps at its cut, f114 (entrance.c showEnteringModel: models->setId), and its caller commits its record in
    // the same step through `onSwap` (menu.c: `entrance->done`).
    if (!show.swapped && s.showNewModel && (show.target || show.swapName)) {
      show.swapped = true;
      if (show.target) setLiveBattleForm(b.player, show.target);   // temporary, not persisted (like manual DV)
      show.onSwap?.();
      const folder = show.entrance?.folder;
      if (show.entranceSide === 1) {
        if (folder && B.renderer3d) B.renderer3d.setEnemyDigimon(folder);
        else B.swapEnemyModel(show.swapName);
      } else if (folder && B.renderer3d) {
        B.renderer3d.setPlayerDigimon(folder);
      } else {
        B.swapPlayerModel(show.target?.name ?? show.swapName);
      }
    }

    // The entrance task is reaped on f300 and its caller sees the empty slot on f301 (ENTRANCE_TASK_END_FRAME): the
    // next page is made THEN, not at the end of the camera glide (f361 on the player side), and it is drawn over it.
    if (show.entrance && !show.taskEnded && frame >= ENTRANCE_TASK_END_FRAME) {
      show.taskEnded = true;
      if (show.endMessage) B.sayOriginal(b, show.endSpec ?? null, show.endMessage);
      show.pageMade = !!show.endMessage || show.onTaskEnd?.() === true;   // onTaskEnd returns true when it made a page
    }

    // Unconditional full heal [BLAST-C007], landing on its captured frame. Only
    // Blast-on heals: the capture records no heal at revert, and manual DV
    // leaves every live combat value in place.
    if (!show.healed && s.healed) {
      show.healed = true;
      // wfightmn F0x800a8bf4: the landing heal is unconditional, and the SAME
      // handler clears exactly the confusion bit (0x04) with its pending
      // recovery event. Poison/Frozen/Sleep are not touched.
      blastLandingHeal(b.player);
      if (b.confusedMenu) b.confusedMenu = null;
    }

    // An entrance is over on ENTRANCE_TASK_END_FRAME (f301), not on the window end (f361 on the player side): that is
    // the frame the parent task sees the entrance task gone and makes its page; the battle runs on and the page is
    // answerable while the player entrance camera glide (f299-f360, the camera task) finishes, owned by the digivolve
    // camera past this stop (digiCam.reset keeps a running fade). The previous update must already have published the
    // f299 return stage so the renderer armed the glide: a stop in the same update as the first f>=299 state loses it.
    const ended = s.done || (show.entrance && frame >= ENTRANCE_TASK_END_FRAME && prevFrame >= ENTRANCE_TASK_END_FRAME - 2);
    if (ended) {
      b.blastShow = null;
      B.renderer3d?.blastPresentationStop?.();
      B.renderer3d?.setFaceCamVisible?.(true);
      if (show.entrance) { if (!show.endMessage && !show.pageMade) B.clearBattleLine(b); }   // its page was made at f301
      else if (show.endMessage) B.sayOriginal(b, show.endSpec ?? null, show.endMessage);
      else B.clearBattleLine(b);   // the original's box is empty when the cinematic ends
      b.timer = 0;
      show.onDone?.();
      // The saved battle track was re-played on f651 (musicFrame above); the revert's PLAYER11 is a
      // positional one-shot that never touches the register and has nothing to restore.
    }
  }
/**
   * Revert Blast, sequence 0x62 — its own de-digivolution program, not a replay
   * of 0x61. Order matters and is captured (blast_run4.txt): event 0x13 state 0
   * runs cleanup and restores the form FIRST (f5938-5939), and only then does
   * state 1 start the presentation (f5941). So the model is already back before
   * a single frame of the effect plays, and there is NO heal.
   */
  function revertBlast(b: BattleState = B.battle) {
    const p = b.player;
    if (!b.blast) return;
    const saved = B.digimonDB?.[b.blast.savedFormId] ?? B.digimonDB?.[p.rookieId] ?? p.profile;
    // The roster record is restored here (capture: STATE form 0x177 -> 0x175 before the presentation); the 3D
    // MODEL is swapped by the entrance at its cut, f114 (menu.c:942 FIGHTSTG_startEntrance(prevId, 0, weak)).
    setLiveBattleForm(p, saved);
    // The shared release (0x800A7328) is what drops the reservation: it zeroes the
    // roster gauge [BLAST-C001/C002] and clears the standing reserved second form.
    // The Digivolve commit and the Tag commit run the same routine, so all three
    // go through it instead of each repeating the gauge write.
    releaseReservedSecondForm(b);
    b.message = "";
    // The captured revert sound is PLAYER11 (0xa0045ec9), authority 1
    // (captures/blast-presentation-2026-07-14/README.md). It used to be left
    // silent because "the extracted set has no player11" — that was a defect in
    // the sample resolver, not a gap in the disc: the id addresses program slot
    // 11, tone 13, note 73, and the bank does contain it. It fires 50 frames
    // into the sequence, not at commit (blast_run4.txt: commit f5938, SOUND
    // f5991), so advanceBlastPresentation plays it on its captured frame.
    startEntrance(b, {
      side: 0, name: saved.name,
      // esmfight 0x62 verbatim, on its own line under the name (wfightmn.s .L0x0000316c).
      endMessage: `${saved.name}\nBack to normal!`,
      endSpec: { kind: MSG_KIND.OUTCOME, payload: [MSG.BACK_TO_NORMAL], name: saved.name },
    });
  }
/**
   * FIGHTSTG_startEntrance(id, side, weak), entrance.c: the one "a model comes in" presentation. `side` 0 is the
   * player (Blast ending, tag, KO replacement), 1 the enemy (next enemy, boss bodies). The frames are the engine's
   * (FormChangeProgram.BLAST_REVERT / ENTRANCE_ENEMY): fade armed f-10, the other side's model hidden f19, PLAYER11 +
   * white flash f50, the cut f114 (this is where `onSwap` commits the caller's record and the model is swapped),
   * flash over f178, final fade + other model shown + motion 1 (2 weak) f299. `onDone` runs when the window ends.
   * `name` is the entering fighter's model (species name or id). The clock waits until that model is loaded.
   */
  function startEntrance(b: BattleState, { side, name, endMessage = "", endSpec = null, onSwap = null, onDone = null, onTaskEnd = null }: BattleEntranceArgs): BattleEntranceShow {
    const show = {
      program: side ? FormChangeProgram.ENTRANCE_ENEMY : FormChangeProgram.BLAST_REVERT,
      frame: 0, target: null, swapped: false, healed: false, state: null, sounded: false,
      endMessage, endSpec, swapName: name, entranceSide: side ? 1 : 0, onSwap, onDone,
      // The entrance TASK is gone for its caller on ENTRANCE_TASK_END_FRAME (f301): every page that waits for it (the
      // `endMessage`, the enemy's name page) is made then, while the player entrance's camera glide still runs to f360.
      onTaskEnd, taskEnded: false,
      entrance: { folder: null, ready: !B.renderer3d },
    };
    b.blastShow = show;
    B.renderer3d?.setFaceCamVisible?.(false);
    if (B.renderer3d) {
      const load = Promise.resolve(resolveModelFolder(name)).then((folder) => {
        show.entrance.folder = folder || null;
        return folder ? B.renderer3d?.preloadDigimon?.(folder) : null;
      });
      Promise.race([load, new Promise((resolve) => setTimeout(resolve, 4000))])
        .catch(() => null)
        .then(() => { show.entrance.ready = true; });
    }
    return show;
  }
/**
   * The enemy's own tag after its "Taking out Digimon!" page was read (enemy_turn.c substate 5):
   * FIGHTSTG_startEntrance(enemies[switchTo].id, 1, 0), the SAME side 0x10 entrance every other enemy entrance runs.
   * The active slot is committed at the cut, f114 (substate 6 `entrance->done`; the swapped-out record stays in the
   * team with its hp). The entering enemy's name page (kind 0xD, substate 4) waits for the child slot, which holds the
   * entrance task, so it is made when the task is gone (ENTRANCE_TASK_END_FRAME, f301); reading it ends the turn.
   */
  function startEnemySelfTag(b: BattleState, tag: { slot: number; stage: string; }) {
    const next = B.enemyTeamRecord(b, tag.slot);
    if (!next) { b._selfTag = null; B.queueAfterAction(b, "enemy"); return; }
    const nextName = enemyMsgName(next, "");
    startEntrance(b, {
      side: 1,
      name: next.eStats?.digimon_id ?? next.profile?.name ?? nextName,
      onSwap: () => {
        b._team ??= [];
        b._team[b.partyIndex] = b.enemy;
        b._team[tag.slot] = undefined;
        b.partyIndex = tag.slot;
        b.enemy = next;
        applyGiantScales(B.renderer3d!, b.party?.[b.partyIndex], giantModeOn());
      },
      // enemy_turn.c substate 4 waits for the child slot, which holds the entrance: the name page is made when the
      // task is gone (ENTRANCE_TASK_END_FRAME), not at f115.
      onTaskEnd: () => {
        tag.stage = "named";
        B.setResultPages(b, [{
          text: `${nextName} steps forward!`,
          spec: { kind: MSG_KIND.NEXT_OUT, payload: [0], slots: [nextName] },
        }]);
        return true;
      },
    });
  }
/**
   * EVENT_DIGIDEVOLVE, WFIGHTMN_digidevolve (menu.c:1164-1198), queued by tech 0x187 = 391 "Helter Skelter"
   * (tech_action.c:585-589) when its roll landed: the partner goes back to its OWN Digimon (the party member's base
   * form, DIGIMON_DATA[member].id), its charge is dropped (unit->charge = 0), a standing Blast is cancelled
   * (WFIGHTMN_cancelBlast: only a `temporary` fighter loses its gauge and its Blast-end event; the release below
   * is that and is a no-op without a Blast), then the ONE entrance runs (FIGHTSTG_startEntrance(unit->id, 0, weak),
   * the same program as Blast ending) and "Digidevolved!" (esmfight 0x47, kind 2) is made once the task is gone.
   * HP, MP, statuses, the DV gauge of a manual form and the form flags are untouched (nothing else is written).
   * The partner's queued technique event (EVENT_PARTNER_TECH) has no counterpart in this game's turn model.
   */
  function forcedDedigivolve(b: BattleState) {
    const p = b.player;
    const saved = B.digimonDB?.[p.rookieId] ?? p.profile;
    setLiveBattleForm(p, saved);
    clearActionAffinity(b, 0);
    releaseReservedSecondForm(b);
    B.clearBattleLine(b);
    startEntrance(b, {
      side: 0, name: saved.name,
      endMessage: `${saved.name}\nDigidevolved!`,
      endSpec: { kind: MSG_KIND.OUTCOME, payload: [MSG.DIGIDEVOLVED], name: saved.name },
    });
  }
/** Count one elapsed player turn while Blast is active; flag the revert when the schedule expires. */
  function tickBlastTurn(b: BattleState = B.battle) {
    if (!b?.blast?.active) return;
    if (--b.blast.playerTurns <= 0) b._blastRevertPending = true;
  }
  return { _battleTargetSize, enterBattleFullscreen, exitBattleFullscreen, onBattleResize, _init3DRenderer, entryKey, storyOrdinal, cardmonBoosterForBattle, blastReady, triggerBlast, advanceBlastPresentation, revertBlast, startEntrance, startEnemySelfTag, forcedDedigivolve, tickBlastTurn };
}
