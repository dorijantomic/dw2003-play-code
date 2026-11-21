// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

import type { EnemyAiMove, EnemyRecord } from "../../types/battle.js";
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

/** One partner's payout from a won fight (applyParticipantProgress). */
export interface ParticipantProgress {
  index: number;
  xp: number;
  bits: number;
  oldLevel: number;
  newLevel: number;
  levelUp: boolean;
  availableEvos?: unknown[];
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
  _loot: { drops: any[]; candidates?: any[]; };
  _winApplied?: boolean;
  _winProgress?: ParticipantProgress[];
  /** the per-partner rows buildFightReportRows() built (web/battle/report.ts) */
  _winReportRows?: any[];
  _winReward?: WinReward;
  activePlayerIndex: number;
  enemy: any;
  /** per participant, the ten form flags the DNA/revert rules read */
  formFlags?: number[][];
  participantIndices: Set<number>;
  player: any;
  playerRecords: any[];
  playerRoster: any[];
  screenId?: number;
}

/** an enemies.json row (the fused boss builds its own copy of one) */
export type EnemyStatBlock = EnemyRecord;

/** One entry of a startParty() gauntlet: an enemy and the stats it is fought with. */
export interface BattlePartyEntry {
  /** enemies.json enemy_id (a name), or a numeric digimon profile id (the legacy path) */
  enemyId: string | number;
  enemyLevel?: number;
  enemyHp?: number;
  enemyMp?: number;
  enemyStatScale?: number;
  /** authored name the plate shows instead of the body species (Fusion content) */
  displayName?: string | null;
  /** the fusion boss this entry fuses into (a boss record, or the name of one), cleared once it has happened */
  fuseInto?: unknown;
  /** giant mode: the fighter scale */
  size?: number;
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

// What start() is opened with: a scalars-only enemy, or a `party` of encounter entries fought
// back to back, plus the music/return hooks the caller reads back (web/battle/core/start.ts).
export interface BattleStartArgs {
  enemyId?: string | number;
  enemyLevel?: number;
  enemyHp?: number;
  enemyMp?: number;
  party?: BattlePartyEntry[];
  screenId?: number;
  mapId?: number | string;
  onWin?: (result: BattleWinResult) => void;
  onFlee?: () => void;
  onLose?: () => void;
}

// startScreen(): `lead` keeps the lead fighter alone (the 1v1 dev path).
export interface StartScreenOptions {
  mapId?: number | string;
  lead?: boolean;
}

// startParty(): where the fight takes place, so the music stage and the map tag survive.
export interface StartPartyOptions {
  screenId?: number;
  mapId?: number | string;
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
  body?: any;
  level?: number;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  attack?: number;
  move_1?: number;
  move_2?: number;
  ai_moves?: EnemyAiMove[];
  statScale?: number;
  stats?: FusedStats;
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
  countingXp?: number;
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
  screenId?: number;
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
