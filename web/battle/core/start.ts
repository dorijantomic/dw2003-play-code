import { resolveModelFolder, setFighterTint } from "../../battle3d.js";
import { battleMsgBank } from "../../battlemsg-translated.js";
import {
  ui,
  newOpeningState,
  specialBattleMode,
  initialActorTimeline,
  emptyStatusEventPool,
} from "../../vendor/engine.js";
import { ST } from "../messages.js";
import { effectiveSpd } from "../plans.js";
import { markFormTaken, battleKindOf, partyEntriesWithSize, giantModeOn } from "../form-blast.js";
import type { BattleStartArgs, StartPartyOptions, StartScreenOptions } from "./types.js";
import { emit as emitGameEvent } from "../../gameEvents.js";
import { fusionEnabled, partyEntriesFor } from "../../fusion.js";
import type { BattleContext, EnemyBattleRecord, PlayerRecord } from "../../types/battle.js";

// moved by tools/rewrite/split-closure.mjs
export function makeStart(B: BattleContext) {
async function swapPlayerModel(name: string) {
    if (!B.renderer3d) return false;
    const folder = await resolveModelFolder(name);
    if (!folder || !B.renderer3d) return false;
    return B.renderer3d.setPlayerDigimon(folder);
  }
// Swap the on-screen 3D enemy model when the next boss-party member steps in.
  async function swapEnemyModel(name: string) {
    if (!B.renderer3d) return;
    const folder = await resolveModelFolder(name);
    if (folder && B.renderer3d) B.renderer3d.setEnemyDigimon(folder);
  }
// enemyId: string name (enemies.json enemy_id) OR numeric digimon profile id (legacy).
  // `party`: optional array of encounter entries {enemyId,enemyLevel,enemyHp,enemyMp} fought
  // sequentially (boss gauntlet); when omitted, the scalar enemy* args form a 1-member party.
  // Battle music for a rolled screen_id: the battle-trigger record's tag field
  // (battle_music.json — fieldstg 0x80092780 copies record+0x8 → 0x80042b30,
  // wfightmn plays it; archive=(id>>18)&0x7f). Stage-local record first (4
  // screens collide across stages), then global; batl00 = the documented
  // default written by wfightts@0xebc for non-trigger battles.
  function musicForScreen(screenId: number | null | undefined, mapId: number | string | undefined) {
    if (screenId == null || !B.battleMusicDB) return "batl00";
    const sk = mapId ? "s" + String(mapId).replace(/^s/, "") : null;
    const local = sk ? (B.battleMusicDB[sk] || []).find(r => r.screen_id === screenId) : null;
    if (local) return local.bank;
    for (const recs of Object.values(B.battleMusicDB)) {
      const r = recs.find(r => r.screen_id === screenId);
      if (r) return r.bank;
    }
    return "batl00";
  }
async function start({ enemyId, enemyLevel, enemyHp: realHp, enemyMp: realMp, party, screenId, mapId, onWin, onFlee, onLose }: BattleStartArgs) {
    await B.loadData();
    // NEW content (F2 -> Extras -> "Fusion bosses"): every battle opens with the game's own
    // untinted colour on both sides; the fusion tints the enemy when it happens.
    setFighterTint("player", null);
    setFighterTint("enemy", null);
    // The decoded message banks, so the panel can put the game's own words on the line
    // from the very first message rather than the walker's English: bank 0x7f for the
    // lines themselves, and bank 0x6a for the item name kind 14's second slot holds.
    await battleMsgBank();
    await battleMsgBank(ui.BATTLE_MESSAGE_BANK_FIELD);
    // Phase 6.3 group 4: start fetching pro/fightstg now so the intro covers the
    // overlay's one-time load and the command list is up on the first frame the
    // player can act, and run the original battle boot pipeline (pro/wfightmn).
    B.commandNative.preload();
    B.techNative.preload();
    B.tagNative.preload();
    B.formNative.preload();
    B.dnaNative.preload();
    B.wfightNative.open();
    const state      = B.getState();
    const playerProf = B.getPlayerProfile(state);
    if (!playerProf) return;

    const playerRoster = B.buildPlayerRoster(state);
    if (!playerRoster.length) return;
    const playerRecords = playerRoster.map((member, index: number) =>
      B.buildPlayerRecord(member, index === 0 ? playerProf.id : null));
    const initialPlayer = playerRecords[0];

    const partyEntries = (party && party.length)
      ? party
      : [{ enemyId, enemyLevel, enemyHp: realHp, enemyMp: realMp, enemyStatScale: 16 }];
    const enemyObj = B.buildEnemyRecord(partyEntries[0]!);
    if (!enemyObj) return;
    const battleConfig = B.fieldEncDB?.battle_config?.[String(screenId)] ?? null;
    const effectGates = battleConfig?.effect_gates ?? {};
    const statusImmunities = Object.fromEntries(
      ["poison", "frozen", "confuse", "sleep", "ko"].map(k => [k, !!effectGates[k]]),
    );
    enemyObj.statusImmunities = statusImmunities;

    B.battle = {
      state: ST.INTRO,
      timer: 0,
      message: "",
      // The field state accessor, carried on the record so the SHARED routines
      // that save a gauge (persistPlayerGauge, and through it the original's
      // reserved-second-form release) can reach it without living inside this
      // factory. Nothing else reads it.
      getState: B.getState,
      // The battle's OPENING PHASE MACHINE (engine/dw3/battle-opening-machine.ts):
      // the walker's flat INTRO timer is replaced by the original's seven phases,
      // run one per frame, exiting (top state 1) into the turn machinery. The line
      // is armed at phase 5, exactly where the original opens its window.
      _opening: newOpeningState(),
      _introLineArmed: false,
      // Phase 1's ambush roll F0x800a684c is the disc's own gate and is fed the
      // encounter's three real numbers by introLinePendingFor() below.

      player: initialPlayer,
      playerRoster,
      playerRecords,
      activePlayerIndex: 0,
      participantIndices: new Set([0]),
      enemy: enemyObj,
      party: partyEntries,                 // sequential boss gauntlet (1+ members)
      partyIndex: 0,
      screenId,                            // battle id — keys progression.battle_rewards
      mapId,                               // field screen the fight started on (Cardmon booster)
      effectGates,
      // The raw 0x80042b58..0x80042b65 encounter config bytes; check_move_cond 13
      // tests byte 1.
      encounterGateBytes: battleConfig?.raw_2b58_2b65 ?? null,
      statusImmunities,
      specialMode: specialBattleMode(mapId, Number(screenId)),
      // The finale's live phase state (claim wfightmn-finale-kinds-2026-10-10): the
      // kind word's 4 -> 5 -> 6 advance. `_finaleKind` is null until the tail falls
      // (the live kind is then `specialMode`, 4); `_finaleRecordedTechId` is the
      // technique latched while the tail stands (F0x800aa06c); `_finaleCopiedAttack`
      // is the head's rebuilt attack record (arm 22 state 2); `_finaleAfter` runs the
      // next scripted beat once the current result pages are read.
      _finaleKind: null,
      _finaleRecordedTechId: 0,
      _finaleCopiedAttack: null,
      _finaleAfter: null,
      _loot: { drops: [], candidates: [] }, // drops: what endBattle banks; candidates: defeated enemies carrying an item (one disc roll at the win)

      menuSel: 0,
      techSel: 0,
      itemSel: 0,
      tagSel: 0,
      // The TAG list's own row word: the original's caller-side row counter, the
      // cell the screen reads to open on (fightstg.s:21258-21260) and writes the
      // confirmed row back into (fightstg.s:21312). It belongs to the ported
      // screen, not to the walker's own list: `tagSel` indexes tagMembers(),
      // which is the hp>0 list, so the two are different row spaces and the
      // forced TAG after a knock-out (which DOES list a fallen partner) cannot
      // borrow it.
      tagRow: 0,
      formSel: 0,
      tagTargetIndex: null,
      pendingAction: null,
      playerFirst: true,
      // The command phase's Frozen gate (`frozenGateLosesTurn`) rolls once per turn and
      // latches against `_turnSeq`, the walker's turn identity.
      _turnSeq: 0,
      _frozenGateTurn: -1,
      _frozenGateLost: false,
      timeline: initialActorTimeline(effectiveSpd(initialPlayer), effectiveSpd(enemyObj)),
      // The 99-slot, 28-byte-stride status-event pool at 0x800a3868. It holds EVERY timed
      // battle effect — the stat changes, the two locks, the poison tick and the three
      // ailment recoveries — and `statusEventQueueAdvance` is its clock. Both records are
      // linked to the SAME array and to the side byte / active slot their stagers are
      // handed, because in the original the pool is global and the stagers take
      // `andi $s2, $a0, 0xff` (0 or 0x10) plus `[0x800a4468 + 4 * (side != 0)]`.
      statusEvents: emptyStatusEventPool(),
      onWin,
      onFlee,
      onLose,
      // The plate object is built on its first tick (hpPlateOf), which is the
      // original's build arm: both bars start on the live HP with no tween.
      _hudClock: 0,
    };
    // F0x800A69F0's setup call for the lead (wfightmn's setup F0x800a66b0 runs
    // it): byte 6 of position 0's word, plus byte 7 + the equipped row carrying
    // the form the lead fights in. This is the mark the report's DVEXP scan
    // reads — without it a battle that never changed form would bank no DVEXP
    // (stfgtrep.s state 0x14 arm, file 0x12C0, reads byte 7 + formIndex).
    markFormTaken(B.battle, 0, initialPlayer!.profile.id);
    B.renderer3d?.setFaceCamVisible?.(true);
    // Both sides reach the SAME pool and name themselves in the original's own terms, so
    // `applyAilment` can queue a recovery without knowing which battle it is in. The side
    // bytes are 0 and 0x10 (the `andi $s2, $a0, 0xff` over the two side words every
    // stager does), and each side's active fighter slot is 0.
    for (const [side, rec] of [[0, B.battle.player], [0x10, B.battle.enemy]] as [number, PlayerRecord | EnemyBattleRecord][]) {
      if (!rec) continue;
      rec.statusEvents = B.battle.statusEvents;
      rec.sideByte = side;
      rec.slot = 0;
      // The accuracy leaf F0x800a06ac's kind word (0x800a4536). The walker's
      // `specialMode` IS that word for the scripted battles (WFIGHTMN's init writes
      // 1..4 by field-screen/battle-id pair); the finale's own 4 -> 5 -> 6 advance
      // (runFinaleBeat) restamps both records as the phases change, so the kind-6
      // fixed roll fires from the head phase on.
      rec.battleKind = battleKindOf(B.battle);
    }

    // The field's own handoff cues ENCOUNTS once, on the transition's first frame:
    // pro/fieldstg F0x80089F7C (the checkerboard handoff, chosen when the scene
    // descriptor's +0x5C is non-zero by the type-7 manager F0x8008AA10 case 2 and by
    // the stage-change router; the iris/tile wipe F0x8008A5E4 is the ==0 fallback)
    // plays 0x00040005 in its state-0 arm through the canonical play cell
    // [0x80055c48] (fieldstg.s .L0x00007448-.L0x00007458; s0 = 0x800519ec, +0x425c).
    // Every stop of the field into a battle is that handoff, so the cue belongs here.
    B.sfx?.play("encounts");
    emitGameEvent("battleStarted", { mapId: B.battle?.mapId ?? null, screenId: B.battle?.screenId ?? null, enemies: (B.battle?.party ?? []).map((e) => e?.enemyId).filter((n) => typeof n === "string") });   // optional layers (extra quests, the glossary counter) hear it

    // Battle music: per-battle packed id at battle-struct+0x2b30 = the
    // trigger record's tag (mined into battle_music.json — batl00/batl10 for
    // regular zones, bossNN for boss screens). batl00 default for battles
    // with no trigger record (wfightts@0xebc). Restored in endBattle.
    // `_battleTrack` is the walker's live value of that register: the final
    // boss's phase transition overwrites it (0x60980000 at fightstg 0x80086ea0)
    // and the digivolution path replays it (fightstg .L0x8008a768).
    if (B.bgm) {
      B.battle._fieldTrack = B.bgm.current;
      B.battle._battleTrack = musicForScreen(screenId, mapId);
      B.bgm.play(B.battle._battleTrack);
    }

    // Grow the canvas to fullscreen BEFORE creating the offscreen (it sizes to canvas).
    B.enterBattleFullscreen();
    // Kick off 3D renderer asynchronously (textures load in background)
    B._init3DRenderer(B.battle);
  }
// Start a random encounter for (mapId, player x,y). Returns true if a battle started,
  // false when the authentic roll lands on an empty slot (no encounter this step). Wild
  // walk-up encounters are always a SINGLE Digimon (user-confirmed in-game) — the multi-member
  // screens in the stage pool are scripted boss screens, so we fight only the lead here. The
  // sequential gauntlet (full party) is reserved for scripted battles via startParty.
  async function startRandom(mapId: number | string, x: number, y: number, onWin, onFlee, onLose) {
    await B.loadData();
    const roll = B.pickEnemy(mapId, x, y);
    if (!roll) return false;
    return startParty([roll.party[0]], onWin, onFlee, onLose, { screenId: roll.screen, mapId });
  }
// The authentic party for a global screen_id (field_encounters.json), e.g. screen
  // 200 = Genji's Kuwagamon. Used by the story engine to fight a scripted battle.
  function partyForScreen(screenId: number) {
    return B.fieldEncDB?.screens?.[String(screenId)] ?? null;
  }
// The trigger-table screens for a stage (stage_encounters.json, the scene_ctx+0x18
  // pools). The story engine validates a scripted battle's screen_id against these so
  // it never fires a fight the field engine wouldn't roll for that stage.
  function triggersForStage(mapId: number | string) {
    const key = String(mapId).replace(/^s/, "");
    const st = B.stageEncDB?.stages?.[key];
    if (!st) return [];
    const out = new Set();
    for (const z of st.zones || []) for (const s of z.slots || []) if (s) out.add(s);
    return [...out];
  }
// Start a battle from a global screen_id, resolving the party HERE.
  //
  // `partyForScreen` is synchronous and reads a table this module loads lazily,
  // so it answers null until something has already fought. Any caller that
  // resolves the party itself and then starts the battle therefore silently
  // does nothing on the first fight of a session. This awaits the load first,
  // which is the only safe order for a caller holding just a screen id.
  async function startScreen(screenId: number, onWin, onFlee, onLose, { mapId, lead = true }: StartScreenOptions = {}) {
    await B.loadData();
    const party = partyForScreen(screenId);
    if (!party || !party.length) {
      console.warn("[battle] no party for screen", screenId, "on", mapId);
      return false;
    }
    return startParty(lead ? [party[0]] : party, onWin, onFlee, onLose, { screenId, mapId });
  }
// Start a battle from a resolved party array (1v1: take the lead, as startRandom).
  async function startParty(party, onWin, onFlee, onLose, { screenId, mapId }: StartPartyOptions = {}) {
    await B.loadData();
    if (!party || !party.length) return false;
    // F0x8008B798: the field's handoff runs its pre-battle presentation first —
    // at ordinal 43, MOVIED08_STR, whose own return selector is this battle. The
    // handler resolves when the movie is over (or immediately when none is due).
    if (B.fieldMovieHandoff) await B.fieldMovieHandoff({ screenId, mapId });
    // Fight every member sequentially (boss gauntlet); random encounters are 1-member parties.
    // NEW content (F2 -> Extras -> "Fusion bosses"): partyEntriesFor carries an authored
    // entry's `displayName` and `fuseInto` through this mapping and leaves an ordinary
    // entry byte-identical; with the switch off it drops both, so no fight can smuggle a
    // fusion in.
    const fusionOn = fusionEnabled();
    // Giant mode part 1: an entry may carry `size`, but it is only kept when the F2 toggle is
    // on (off: no entry has a `size` key and the renderer is never told anything).
    const entries = partyEntriesWithSize(partyEntriesFor(party, fusionOn).map(e => ({
      // (multiplayer duels: a player's own Digimon form may not be in the enemy table, so those entries carry its numeric id)
      enemyId: (typeof e.name === "string" && !B.enemiesDB?.[e.name] && Number.isFinite(e.digimonId)) ? e.digimonId : e.name, enemyLevel: e.level, enemyHp: e.hp, enemyMp: e.mp,
      enemyStatScale: e.stat_scale ?? 16,
      ...(fusionOn && e.displayName != null ? { displayName: e.displayName } : {}),
      ...(fusionOn && e.fuseInto != null ? { fuseInto: e.fuseInto } : {}),
      size: e.size,
    })), giantModeOn(), 1);
    await start({ party: entries, screenId, mapId, onWin, onFlee, onLose });
    return true;
  }
  return { swapPlayerModel, swapEnemyModel, musicForScreen, start, startRandom, partyForScreen, triggersForStage, startScreen, startParty };
}
