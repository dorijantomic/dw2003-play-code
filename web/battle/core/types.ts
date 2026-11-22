// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

import type { EnemyAiMove, EnemyRecord } from "../../types/battle.js";
import type { PartnerStats } from "../../game/types.js";
/** The bit of a digimon profile a DNA presentation needs: the model name it stages. */
export interface DnaProfileName {
  name: string;
}

/** One op row of a decoded clip-12 script segment: the op code and the words it carries. */
export interface DnaScriptOp {
  op: number;
  words?: number[];
}

/** One single-actor stage chunk of the DNA clip: the ops, the model that acts them, its slot. */
export interface DnaClipChunk {
  ops: DnaScriptOp[];
  model: string;
  /** 1 = parent A, 2 = parent B, 3 = the result */
  slot: number;
  /** the result form's reveal chunks (they carry the finishing pose) */
  result?: boolean;
  /** the chunk that brings the original actor back on screen */
  show?: boolean;
}

export interface BattleDnaPresentation {
  /** index into `chunks` */
  chunk?: number;
  chunks?: DnaClipChunk[] | null;
  committed: boolean;
  damage: number;
  fusedName: string | null;
  /** the DNA roll landed (a miss still plays the pages) */
  hit: boolean;
  lethal: boolean;
  mode?: string;
  originalProfile: DnaProfileName;
  partnerName: string;
  phase: string;
  /** the fight_tech.json record the presentation rolled; the table itself is untyped JSON */
  record: any;
  /** the record to restore when the DNA is undone */
  restoreRecord: any;
  resultId: number;
  resultProfile: DnaProfileName;
}

/** A form that gained a level this fight. */
export interface FormLevelGain {
  name: string;
  level: number;
}

/** A Digivolve form this fight unlocked; `slotFull` when the equipped triple had no room for it. */
export interface UnlockedForm {
  name: string;
  slotFull?: boolean;
  id?: number;
}

/** What applyParticipantProgress returns for one partner: its payout from a won fight. */
export interface ParticipantReward {
  /** look data for the victory rings: how far through its level the EXP stood before and stands after */
  ringA: number;
  ringB: number;
  xp: number;
  oldXp: number;
  oldLevel: number;
  newLevel: number;
  levelUp: boolean;
  availableEvos: unknown[];
  /** the partner's stored stat block as it stood before the battle's rewards */
  before: PartnerStats;
  formId: number;
  name: string;
  learnedTechs: string[];
  loadableTechs: string[];
  formLevels: FormLevelGain[];
  unlocked: UnlockedForm[];
}

/** One partner's payout from a won fight, with the roster position it was paid to. */
export interface ParticipantProgress extends ParticipantReward {
  index: number;
}

/** What a won fight pays, as endBattle reads it back off the context. */
export interface WinReward {
  xp: number;
  bits: number;
  dvexp: number;
  /** the row of the item this fight dropped, null when it dropped none */
  droppedItem: any;
  levelUp: boolean;
}

export interface BattleEndContext {
  /** drops: what endBattle banks; candidates: the defeated enemies that carry an item */
  _loot: { drops: any[]; candidates?: any[] | undefined; };
  _winApplied?: boolean | undefined;
  _winProgress?: ParticipantProgress[] | undefined;
  /** the per-partner rows buildFightReportRows() built (web/battle/report.ts) */
  _winReportRows?: any[] | undefined;
  _winReward?: WinReward | undefined;
  activePlayerIndex: number;
  enemy: any;
  /** per participant, the ten form flags the DNA/revert rules read */
  formFlags?: number[][] | undefined;
  participantIndices: Set<number>;
  player: any;
  playerRecords: any[];
  playerRoster: any[];
  screenId?: number | undefined;
}

/** an enemies.json row (the fused boss builds its own copy of one) */
export type EnemyStatBlock = EnemyRecord;

/** One entry of a startParty() gauntlet: an enemy and the stats it is fought with. */
export interface BattlePartyEntry {
  /** enemies.json enemy_id (a name), or a numeric digimon profile id (the legacy path) */
  enemyId: string | number | undefined;
  enemyLevel?: number | undefined;
  enemyHp?: number | undefined;
  enemyMp?: number | undefined;
  enemyStatScale?: number | undefined;
  /** authored name the plate shows instead of the body species (Fusion content) */
  displayName?: string | null | undefined;
  /** the fusion boss this entry fuses into (a boss record, or the name of one), cleared once it has happened */
  fuseInto?: unknown;
  /** giant mode: the fighter scale */
  size?: number | undefined;
}

/** What a won fight hands onWin() (web/battle/core/end.ts). */
export interface BattleWinResult {
  xp: number;
  bits: number;
  levelUp: boolean;
  newLevel?: number;
  droppedItem?: any;
  /** the evolutions this win opened */
  availableEvos?: unknown[];
  /** every paid partner's payout */
  participantProgress?: ParticipantProgress[];
  /** the enemy ran instead of being beaten */
  enemyFled?: boolean;
}

/// The swing queueCounter() queues after the blow that provoked it (b._counter), until stepCounter() settles it.
export interface QueuedCounter {
  /** the countering side */
  from: string;
  dmg: number;
  hit: boolean;
  techId: number | null | undefined;
  phase: "wait" | "run";
  applied: boolean;
}

/// One authored fusion boss (web/fusion_bosses.json, or a Fusion Lab part merged on by mergeLabBosses).
export interface FusionBossPhase {
  /** the HP fraction the phase opens at */
  at: number;
  moves?: number[];
  size?: number;
  page?: string;
  field?: string;
  tint?: number[];
  music?: string;
}

export interface FusionBoss {
  id?: string;
  halves?: (string | number)[];
  body: string;
  displayName?: string | null;
  level: number;
  hp: number;
  statScale: number;
  moves: number[];
  aiFill?: boolean;
  tint?: number[] | null;
  transform?: string;
  phases?: FusionBossPhase[];
  /** a Fusion Lab part with no enemies.json row brings its own stat rows, and its own built model */
  rows?: Record<string, EnemyRecord>;
  modelFolder?: string;
}

// What start() is opened with: a scalars-only enemy, or a `party` of encounter entries fought
// back to back, plus the music/return hooks the caller reads back (web/battle/core/start.ts).
export interface BattleStartArgs {
  enemyId?: string | number | undefined;
  enemyLevel?: number | undefined;
  enemyHp?: number | undefined;
  enemyMp?: number | undefined;
  party?: BattlePartyEntry[];
  screenId?: number | undefined;
  mapId?: number | string | undefined;
  onWin?: ((result: BattleWinResult) => void) | undefined;
  onFlee?: (() => void) | undefined;
  onLose?: (() => void) | undefined;
}

// startScreen(): `lead` keeps the lead fighter alone (the 1v1 dev path).
export interface StartScreenOptions {
  mapId?: number | string | undefined;
  lead?: boolean;
}

// startParty(): where the fight takes place, so the music stage and the map tag survive.
export interface StartPartyOptions {
  screenId?: number | undefined;
  mapId?: number | string | undefined;
}

// One battle_music.json entry: the rolled battle-trigger screen id and the music archive it plays.
export interface BattleMusicTrack {
  screen_id: number;
  bank: string;
}

// fusionOnDefeat()'s arguments (web/fusion.ts): the authored party, the body that just fell and
// the fusion-boss table to look its `fuseInto` up in.
export interface FusionDefeatArgs {
  /** the party as it stands; the last body may carry `fuseInto` (a boss id or its record) */
  party?: { fuseInto?: any; hp?: any }[];
  partyIndex?: number;
  fxOn?: boolean;
  /** the fusion-boss table (fusion.json), looked up by the fallen body's id */
  bosses?: Record<string, any> | null;
}

// The fused body's stat block, re-rolled to the fusion's own attack/techniques (web/fusion.ts).
export interface FusedStats {
  str?: number;
  def?: number;
  spt?: number;
  wis?: number;
  spd?: number;
}

// What fusedRecord() returns: the body's row with the fused values on top.
export interface FusedRecord {
  body: string | null;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  move_1: number;
  move_2: number;
  ai_moves: EnemyAiMove[];
  statScale: number;
  stats: FusedStats;
}

// nativeText(): the native 8px font fallback's own drawing knobs.
export interface NativeTextOptions {
  color?: string;
  kind?: number;
  alignRight?: boolean;
}

// drawFightReportGroup(): the rows the overlay is drawing this frame.
export interface ReportGroupOptions {
  seconds?: number;
  marked?: boolean;
  levelling?: boolean;
  /** the EXP odometer's displayed value for this row */
  countingXp?: number | null | undefined;
  /** the bar of the marked form, null when none is marked */
  markedSlot?: number | null;
}

// battleScriptedPlanFor(): a caller may hand in the roll it already made.
export interface ScriptedPlanOptions {
  /** the 7-bit damage/status roll */
  roll7?: number;
  rollLanded?: boolean;
  rollStatusLanded?: boolean;
  /** the page name printed with the plan */
  name?: string;
}

// winBattleRewards(): which accessory each fighter carries (the EXP/BIT Adapters pay x/5).
export interface EquipmentSlots {
  acc0?: number;
  acc1?: number;
}

export interface WinBattleRewardsArgs {
  screenId?: number | undefined;
  participants?: number;
  equipment?: EquipmentSlots;
  /** progression.json's battle_rewards block */
  rewards?: any;
}

// applyStatDebuffDispatch(): the names the page should print for each side.
export interface StatDebuffNames {
  player?: string;
  enemy?: string;
}

// The post-hit dispatcher's knobs: the draw to use, the flee-lock record and the two names
// the pages print (web/battle/status.ts).
export interface PostHitDispatchOptions {
  /** the random draw, when the caller already rolled one */
  rng?: () => number;
  /** fight_tech.json record 211, the flee-lock whose +0x0c is the magnitude */
  lockRecord?: any;
  playerName?: string;
  enemyName?: string;
}

// battleRestorePlanFor(): the caster's wisdom (the restore amount's input) and the name its page
// prints, when a caller already has them.
export interface RestorePlanOptions {
  wisdom?: number;
  name?: string;
}
