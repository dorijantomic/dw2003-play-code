import type { createBattle3D } from "../battle3d.js";
import type { FIGHT_UI_CLIPS } from "../battle/layout.js";
import type { CameraMode } from "./battle3d.js";
import type { Combatant } from "../../engine/dw3/battle-combat.js";
import type { ActorTimeline } from "../../engine/dw3/battle-formulas.js";
import type { newOpeningState } from "../vendor/engine.js";
import type { StatusEventPool } from "../../engine/dw3/battle-status-events.js";
import type { BattleEndContext, BattleMusicTrack, BattlePartyEntry, FusionBoss, BattleStartArgs, ParticipantProgress, ParticipantReward, WinReward } from "../battle/core/types.js";
import type { GameState, PartnerStats } from "../game/types.js";

/** The engine's `ui` namespace as its own source types it (web/vendor/engine.js is a bundle whose `ui` export carries no types). */
export type EngineUi = typeof import("../../engine/dw3/ui/index.js");

/** one page of battle text: the message kind, its payload words, and the words its template fills in */
export interface BattleLineSpec {
  kind: number;
  payload: number[];
  /** line one, usually the actor's name */
  name?: string | null | undefined;
  /** the words the template's {n} placeholders take */
  slots?: string[] | undefined;
}

/** what a heal page needs: how much was restored, how much was missing, and who healed */
export interface BattleHeal {
  heal: number;
  missingHp: number;
  healer: string;
}

/** one line of the RESULT page: the sentence the walker wrote, and the disc's page that paints it */
export interface BattleResultPage {
  text: string;
  spec: BattleLineSpec | null;
}

/** per-element or per-status numbers a record carries (digimon.json / enemies.json) */
export type ElementNumbers = {
  fire: number;
  water: number;
  ice: number;
  wind: number;
  thunder: number;
  machine: number;
  dark: number;
}

export type StatusNumbers = {
  poison: number;
  paralyze: number;
  confuse: number;
  sleep: number;
  ko: number;
}

export type StatGrowth = {
  hp: number;
  mp: number;
  str: number;
  def: number;
  spt: number;
  wis: number;
  spd: number;
  chr: number;
}

/** one species row of assets/data/digimon.json (battle.ts keys the table by id) */
export type DigimonRecord = {
  id: number;
  name: string;
  hp: number;
  mp: number;
  str: number;
  def: number;
  spt: number;
  wis: number;
  spd: number;
  chr: number;
  growth: StatGrowth;
  resistances: ElementNumbers;
  resistance_growth: ElementNumbers;
  growth_xp: number;
  dv_cap: number;
  status_resist: StatusNumbers;
  family: number;
  tech_basic?: number | null;
  tech_signature?: number | null;
  tech_dna_dv: number;
  tech_level_learn: number[];
  tech_level_load: number[];
  tech_slots: number[];
  tech_learn_levels: number[];
  tech_load_levels: number[];
  blasts: number[];
  techs: number[];
  is_starter: boolean;
}

/** one form the partner can digivolve to right now (web/battle/core/records.ts availableEvolutions) */
export interface EvolutionOption {
  to: string;
  formId: number;
  equipped: boolean;
}

/** one technique row of digimon.json's skill list, with the three bytes battle.ts merges on from fight_tech_table.json */
export interface BattleSkill {
  id: number;
  name: string;
  desc: string;
  tech_basic?: boolean;
  mp_cost: number;
  power: number;
  element: string;
  attack_category: string;
  attack_cat: number;
  type: string;
  target_family: number;
  damage_scalar: number;
  hits: number;
  clip: number;
  effect?: string;
  effect_p1?: number;
  effect_p2?: number;
  effect_id?: number;
  effect_power?: number;
  base_acc?: number;
  /** set on a copy that is used as a basic attack */
  basic_attack?: boolean;
  /** the finale head's copied record bytes ride on the skill (finale.ts) */
  elem1?: number;
  techRecord?: Partial<FightTechRow>;
}

/** one row of assets/data/fight_tech_table.json: the disc's 16-field technique record, keyed by technique id */
export interface FightTechRow {
  mp: number;
  power: number;
  category: number;
  f3: number;
  elemCtx: number;
  elem1: number;
  scalar: number;
  elem2: number;
  dispatch: number;
  f8: number;
  crit: number;
  sigEffect: number;
  effect: number;
  motion: number;
  clip: number;
  f14: number;
}

/** one AI move / counter row of an enemy record */
export interface EnemyAiMove {
  action: number;
  comparator: number;
  value: number;
}

/** one row of assets/data/enemies.json (the sdigiedt enemy entry), keyed by enemy_id */
export interface EnemyRecord {
  enemy_id: string;
  digimon_id: string;
  attack: number;
  move_1: number;
  move_2: number;
  str: number;
  def: number;
  spt: number;
  wis: number;
  spd: number;
  resistances: ElementNumbers;
  status_resist: StatusNumbers;
  digimon_type: number;
  drop_item: string;
  drop_rate: number;
  ai_moves: EnemyAiMove[];
  counter: EnemyAiMove;
}

/** one enemy of an assets/data/field_encounters.json screen */
export interface FieldEncounterEnemy {
  name: string;
  id: number;
  level: number;
  hp: number;
  mp: number;
  stat_scale: number;
}

/** assets/data/field_encounters.json: the enemy party of each screen id and each screen's battle config bytes */
export interface FieldEncounters {
  _comment: string;
  screens: Record<string, FieldEncounterEnemy[]>;
  battle_config: Record<string, { raw_2b58_2b65: number[]; effect_gates: Record<string, number>; }>;
}

/** assets/data/stage_encounters.json: per stage, the zones' eight enemy slots and rate level; some stages pick a group by story progress */
export interface StageEncounters {
  _comment: string;
  rate_table: number[];
  stages: Record<string, {
    zones: { slots: number[]; rate_level: number; }[];
    groups?: { tag: number; key: number; blocks: number[]; }[];
    selector?: { family: string; var: string; site: string; thresholds: number[]; groups: number[]; };
  }>;
}

/** assets/data/zone_grids.json: per stage, one zone for the whole stage (`uniform`) or a cell grid that maps a spot to its zone */
export interface ZoneGrids {
  _comment: string;
  stages: Record<string, { uniform?: number; cell?: number; w?: number; h?: number; grid?: number[]; }>;
}

/** assets/data/progression.json: the disc's reward, level-up and gym drill tables */
export interface ProgressionTables {
  _comment: string;
  /** per battle screen id: [dvexp base, exp base, bits base] */
  battle_rewards: number[][];
  level_up: {
    exp_tier_bounds: number[];
    exp_tier_const: number[];
    hpmp_tier_adj: number[];
    hpmp_rand9: number[];
    core_tier_bounds: number[];
    core_table: number[][];
    elem_level_limit: number;
    elem_table: number[];
    exp_cap: number;
    level_cap: number;
    hpmp_cap: number;
    stat_cap: number;
    tp_per_level: number;
    tp_cap: number;
    /** the DV experience ceiling; the extractor (tools/extract_progression_tables.py) writes it, the shipped file may not carry it */
    dvexp_cap?: number;
  };
  gym: GymTables;
}

/** one gain row of the gym tables: [base, random range] */
export type GymRow = readonly [number, number];

/** one drill of a gym rank menu: its number and the two stats it trains */
export interface GymDrill {
  drill: number;
  primary: number;
  secondary: number;
}

/** progression.json's gym block: what a drill costs and what each rep gains */
export interface GymTables {
  tp_costs: number[];
  rank_menus: GymDrill[][];
  core_rows: GymRow[];
  loss_rows: GymRow[];
  /** per growth bracket, the gain rows by variant and TP choice */
  elem_tables: GymRow[][];
  /** per element growth (1-based), the elem_tables index of each stat bracket */
  elem_ptr: number[][];
  elem_brackets: number[];
  hpmp_rows: GymRow[];
}

/** one member of the party as buildPlayerRoster lists it (web/battle/core/records.ts) */
export interface RosterMember {
  index: number;
  charId: string | number;
  rookieId: number;
  /** buildPlayerRoster never sets it; forms.ts still reads it first (a member without one falls to rookieId) */
  id?: undefined;
  /** which of the eight digivolution trees this line learns from */
  slot: number;
  name: string;
  /** the member's stored stat block (state.partnerStats / state.partyStats[i]) */
  stats: PartnerStats;
}

/** the live combat record of one party member (buildPlayerRecord, then start.ts links the shared pool on) */
export interface PlayerRecord extends Combatant {
  profile: DigimonRecord;
  level: number;
  rosterIndex: number;
  rookieId: number;
  statsRecord: PartnerStats;
  savedSpeciesId: number;
  savedProfile: DigimonRecord;
  rosterSpeciesId: number;
  mp: number;
  maxMp: number;
  chr: number;
  elemBonuses: Record<string, number>;
  statusResists: Record<string, number>;
  regeneration: boolean;
  crit: number;
  armor: number;
  accBonus: number;
  evadeBonus: number;
  escapeBonus: number;
  mpCostDown: number;
  stealBonus: number;
  multiAttack: boolean;
  weaponFamilies: number[];
  affinity: number;
  statMods: { str: number; def: number; spd: number; };
  statPenalty: { str: number; def: number; spd: number; };
  binderCrest: boolean;
  counterCrest: boolean;
  gaugeAccessories: number[];
  rightWeapon: number | null;
  gauge: number;
  /** the raw record +0x1c ailment byte, when a record carries it (nothing writes it yet) */
  statusBits?: number;
}

/** a live combat record of either side */
export type BattleRecord = PlayerRecord | EnemyBattleRecord;

/** the live combat record of the enemy (buildEnemyRecord, then the phase modules hang their own fields on) */
export interface EnemyBattleRecord extends Combatant {
  profile: EnemyProfile | DigimonRecord;
  speciesId: number;
  /** the raw enemies.json row (null for a legacy numeric enemy) */
  eStats: EnemyRecord | null;
  displayName: string | null;
  fightSkill: BattleSkill | null;
  level: number;
  mp: number;
  maxMp: number;
  chr: number;
  powerScale: number;
  weaponFamilies: number[];
  affinity: number;
  statMods: { str: number; def: number; spd: number; };
  turnCounter: number;
  /** the fusion boss this record became (set by fuseIntoBoss) */
  bossId?: string | null;
  /** the boss phase cursor, -1 before the first line */
  bossPhase?: number;
  /** the raw record +0x1c ailment byte, when a record carries it (nothing writes it yet) */
  statusBits?: number;
  /** only a party record carries its stored stat block */
  statsRecord?: undefined;
}

/** the profile-like object enemyToProfile builds from an enemy row so elementFactor works */
export type EnemyProfile = {
  name: string;
  resistances: ElementNumbers;
  family: number;
  id?: number;
  /** an enemy row has none (a digimon profile does); readers take it off either */
  tech_basic?: undefined;
}

/**
 * The live battle record: web/battle/core/start.ts builds it as one object literal (the fields
 * named here) and every phase module then hangs its own `_...` fields on it, which read back as any.
 * (The record itself is kept as any on BattleContext.battle: end.ts and update.ts hand it to the
 * win-report helpers, whose BattleEndContext demands a `formFlags` the record does not carry yet.)
 */
export type BattleState = {
  /** ST.* */
  state: number;
  timer: number;
  message: string;
  /** the field state accessor, carried on the record so the shared gauge-saving routines can reach it */
  getState: () => GameState;
  _opening: ReturnType<typeof newOpeningState>;
  _introLineArmed: boolean;
  player: PlayerRecord;
  playerRoster: RosterMember[];
  playerRecords: PlayerRecord[];
  activePlayerIndex: number;
  participantIndices: Set<number>;
  enemy: EnemyBattleRecord;
  /** the sequential boss gauntlet (1+ members) */
  party: BattlePartyEntry[];
  partyIndex: number;
  /** the battle id: keys progression.battle_rewards */
  screenId?: number | undefined;
  /** the field screen the fight started on */
  mapId?: number | string | undefined;
  statusImmunities: Record<string, boolean>;
  specialMode: number;
  _finaleKind: number | null;
  _finaleRecordedTechId: number;
  _finaleCopiedAttack: BattleSkill | null;
  menuSel: number;
  techSel: number;
  itemSel: number;
  tagSel: number;
  tagRow: number;
  formSel: number;
  tagTargetIndex: number | null;
  playerFirst: boolean;
  _turnSeq: number;
  _frozenGateTurn: number;
  _frozenGateLost: boolean;
  timeline: ActorTimeline;
  /** the battle's ONE shared status-event pool; both records are linked to the same array */
  statusEvents: StatusEventPool;
  onWin?: BattleStartArgs["onWin"] | undefined;
  onFlee?: BattleStartArgs["onFlee"] | undefined;
  onLose?: BattleStartArgs["onLose"] | undefined;
  _hudClock: number;
  /** drops: what endBattle banks; candidates: defeated enemies carrying an item (one disc roll at the win) */
  _loot: BattleEndContext["_loot"];
  _winApplied?: boolean | undefined;
  _winProgress?: ParticipantProgress[] | undefined;
  _winReportRows?: BattleEndContext["_winReportRows"];
  _winReward?: WinReward | undefined;
  /** per participant, the ten form flags the DNA/revert rules read (form-blast.ts creates it at the first form mark) */
  formFlags?: number[][] | undefined;
} & Record<string, any>;

export interface BattleContext {
  _battleTargetSize: () => { w: number; h: number; };
  _init3DRenderer: (b: BattleState) => Promise<void>;
  _profileByName?: any;
  _savedCanvas?: { w: number; h: number; } | null;
  advanceAfterResult: (b: BattleState) => void;
  advanceBlastPresentation: (b: BattleState, dt: number) => void;
  advanceBossPhase: (b: BattleState) => { text: string; spec: BattleLineSpec; }[];
  advanceDisplayFrames: (dt: number) => any;
  animBusy: () => boolean;
  applyCounter: (b: BattleState, c: any) => void;
  applyDnaAction: (action: any) => boolean;
  applyDnaAnswer: (b: BattleState, answer: any, kind?: string) => boolean;
  applyDvAction: (action: any) => void;
  applyEnemyAction: () => void;
  applyEvolution?: any;
  applyParticipantProgress: (b: BattleEndContext, rosterIndex: number) => ParticipantReward;
  applyPlayerAction?: any;
  applyTagAction: (action: any) => boolean;
  armContactDamage?: any;
  armIntroLine: (b: BattleState) => number;
  armPendingImpact: (b: BattleState, commit: any) => void;
  attackSpec: (b: BattleState, name?: string) => BattleLineSpec | null;
  availableEvolutions: (state: GameState, rosterIndex?: number) => EvolutionOption[];
  battle: BattleState;
  BATTLE_REF_H?: number;
  BATTLE_REF_W?: number;
  battleFormLevel: (rosterIndex: number, formId: number, bb?: any) => number;
  battleMusicDB?: Record<string, BattleMusicTrack[]>;
  bgm?: any;
  BLAST_CAPTURE_HZ?: number;
  blastReady: (b?: BattleState) => boolean;
  buildEnemyRecord: (entry: BattlePartyEntry) => EnemyBattleRecord | null;
  buildPlayerRecord: (member: RosterMember, requestedFormId?: number | null) => PlayerRecord;
  buildPlayerRoster: (state: GameState) => RosterMember[];
  canvas?: HTMLCanvasElement;
  cardmonBoosterForBattle: (b: BattleState) => any;
  cardmonBoostersDB?: any;
  chromeReady: () => boolean;
  clearBattleLine: (b: BattleState) => void;
  commandNative?: any;
  commitDnaImpact: (b: BattleState, dna: any) => void;
  commitDnaRestore: (b: BattleState, dna: any) => void;
  commitPendingImpact: (b: BattleState) => boolean;
  commitTag: (b: BattleState, action: any, spd: any) => void;
  confirmCommand: (b: BattleState) => void;
  confirmDvForm: (b: BattleState, speciesId: number) => void;
  confirmItem: (b: BattleState, id: number | string) => void;
  confirmJokePick: (b: BattleState, row: number) => void;
  confirmTag: (b: BattleState, slot: number) => void;
  confirmTech: (b: BattleState, id: number | string) => void;
  contactOnHit: (contact: any, commit: any) => (rec: any) => void;
  coopSetEnemyHp: (index: number, hp: number) => void;
  coopState?: any;
  coversField: () => boolean;
  ctx?: CanvasRenderingContext2D;
  damageSpec: (name: string, total: number, extra?: string, techniqueId?: number, side?: number, heal?: BattleHeal | null) => BattleLineSpec | null;
  defeatCurrentEnemy: () => void;
  defeatedSpec: (enemyName: string) => BattleLineSpec | null;
  digimonDB: { [k: string]: DigimonRecord; };
  DIRECTOR_STATES?: Set<number>;
  dnaChoiceFor?: any;
  dnaNative?: any;
  dnaPaneSeed?: any;
  dnaParticipantsFor?: any;
  dnaProfileRecord: (reader: any, profile: any) => number;
  dnaResultScript?: any;
  dnaScriptChunks?: any;
  dnaTableReader: (species: any, techniques?: any) => { read8: (addr: number) => number; read16: (addr: number) => number; };
  draw: () => void;
  drawBattleHud: (b: BattleState) => void;
  drawChrome: (name: keyof typeof FIGHT_UI_CLIPS, x: number, y: number, w?: number, h?: number) => boolean;
  drawCommandMenu: (b: BattleState) => void;
  drawDescription: (text: string, mp?: number) => void;
  drawDnaChoice: (b: BattleState) => void;
  drawFightPane: (x: number, y: number, w: number, h: number, angled?: boolean) => void;
  drawFightReport: (b: BattleState) => void;
  drawFightReportGroup?: any;
  drawFormMenu: (b: BattleState, rosterIndex: number, title: string) => void;
  drawItemMenu: (b: BattleState) => void;
  drawListChrome: (hint?: Readonly<{ kind: number; clut: number; l1: any; r1: any; }>) => void;
  drawListSelector: (x: number, y: number, selected: boolean) => void;
  drawMenuNotice: (b: BattleState) => void;
  drawNativeBar: (x: number, y: number, w: number, h: number, cur: number, max: number) => void;
  drawNativePanel: (x: number, y: number, w: number, h: number, fill?: string) => void;
  drawPips: (def: any, active?: number) => void;
  drawSubtractiveFade: (ctx: CanvasRenderingContext2D, cw: number, ch: number, amount: number) => void;
  drawTagMenu: (b: BattleState) => void;
  drawTechMenu: (b: BattleState) => void;
  /** element index -> the element's name (built once off skillDB) */
  elem1NameCache?: Record<number, string>;
  elementNameForElem1: (elem1: number) => string;
  encounterRateLevel: (mapId: number | string, x?: number, y?: number) => any;
  /** endBattle()'s outcome words: the fight was won, lost, or the enemy ran */
  endBattle: (result: "win" | "lose" | "enemy-fled") => void;
  endingHandoff?: any;
  enemiesDB: { [k: string]: EnemyRecord; };
  enemyConditionSlots: (b: BattleState, en: any) => { enemySlots: any[]; activeEnemyIndex: any; };
  enemyHp: (eStats: any, level: number) => number;
  enemyMp: (eStats: any, level: number) => number;
  enemyTeamActive: (b: BattleState) => boolean;
  enemyTeamRecord: (b: BattleState, i: number) => any;
  enemyTeamRecords: (b: BattleState) => any[];
  enemyTechniqueSpec: (enemyName: string, skill: any) => BattleLineSpec | null;
  enemyToProfile: (eStats: EnemyRecord) => EnemyProfile;
  enterBattleFullscreen: () => void;
  enterLossState: (b: BattleState) => void;
  entryKey: () => number | undefined;
  evadeSpec: (b: BattleState, enemyName: string) => BattleLineSpec | null;
  evolutionTrees?: any;
  evoTargets: (evos: any) => any[];
  exitBattleFullscreen: () => void;
  fieldEncDB: FieldEncounters | null;
  fieldMovieHandoff?: any;
  fightTechDB: { [k: string]: FightTechRow; };
  fillHpBar: (x: number, y: number, w: number, h: number, cur: number, max: number) => void;
  finishFinaleBeat: (b: BattleState, index: number, beat: any) => void;
  FORCE_INTRO_NO_LINE?: boolean;
  forcedDedigivolve: (b: BattleState) => void;
  FORM_ELEMENTS?: string[];
  formListSeed?: any;
  formNative?: any;
  formOptionsFor: (rosterIndex: number, bb?: any) => any[];
  formPanelMemberSeed?: any;
  frozenGateLosesTurn: (b: BattleState) => boolean;
  fuseIntoBoss: (b: BattleState, boss: FusionBoss) => void;
  fusionBossesDB?: Record<string, FusionBoss> | null;
  fusionDataTried?: boolean;
  getPlayerProfile: (state: GameState) => any;
  /** the field state accessor, carried on the context so shared routines can save a gauge */
  getState: () => GameState;
  handleKey: (rawKey: string) => any;
  hpPlateMembers: (b: BattleState) => { index: number; hp: number; maxHp: number; }[];
  hpPlateOf: (b: BattleState) => any;
  HUD_CELS_DECODED?: Set<number>;
  hudCels?: any[];
  hudClip: (cel: string | number, x: number, y: number) => boolean;
  initializePartyStats: (state: GameState) => boolean;
  introLinePendingFor: (b: BattleState) => boolean;
  isActive: () => boolean;
  itemAnnouncementSpec: (b: BattleState, item: any) => BattleLineSpec;
  itemListSeed: (b: BattleState) => { items: any; };
  itemNative?: any;
  jogressDB?: any;
  jogressFused?: any;
  liveFormId: (b: BattleState, slot: number) => number;
  loadData: () => Promise<void>;
  loadFusionData: () => Promise<void>;
  LOSS_MESSAGE_WORDS?: Record<number, string>;
  lossCameraMode: () => CameraMode;
  mpKit?: any;
  mpKitTechs?: any;
  msgClock?: any;
  msgHoldsTurn: (b: BattleState) => boolean;
  msgPadWords?: number;
  msgSession?: any;
  musicForScreen: (screenId: number | null | undefined, mapId: number | string | undefined) => string;
  nativePanelPath: (x: number, y: number, w: number, h: number, notch?: number) => void;
  nativeText?: any;
  noteFinalBossPhaseDamage: (b: BattleState) => void;
  offscreen3d?: HTMLCanvasElement | OffscreenCanvas | null;
  onBattleResize: () => void;
  openingPorts?: any;
  ORBIT_STATES?: Set<number>;
  paintHpBar: (x: number, y: number, w: number, h: number, cur: number, max: number, side?: number) => void;
  partnerInfo?: any;
  partyFormState?: any;
  partyForScreen: (screenId: number) => any;
  partyRosterSlot: (b: BattleState, position: number) => any;
  pDispShown: (cur: BattleState) => number;
  peek?: any;
  pickEnemy: (mapId: number | string, x?: number, y?: number) => { party: any; screen: any; } | null;
  pickEnemyMove: (en: any) => any;
  playerTechs: () => any[];
  profileById: (id: number | string) => any;
  profileByName: (name: string) => any;
  progressionDB: ProgressionTables | null;
  queueAfterAction: (b: BattleState, acted: any, playerSpd?: number) => void;
  queueCounter: (b: BattleState, from: any, { dmg, hit, techId }: { dmg: number; hit?: boolean; techId: any; }) => void;
  recordFinaleTechnique: (b: BattleState, techniqueId: number) => void;
  renderer3d?: ReturnType<typeof createBattle3D> | null;
  reportHandoff?: any;
  resolveRepeatDispatch?: any;
  revertBlast: (b?: BattleState) => void;
  rollEncounter: (mapId: number | string, x: number, y: number) => Promise<{ party: any; screen: any; } | null>;
  runFinaleBeat: (b: BattleState, index: number) => void;
  sayOriginal: (b: BattleState, spec: BattleLineSpec, walker: any) => void;
  sayWalker: (b: BattleState, walker: any) => void;
  scriptedScreen: (mapId: number | string, index: number) => Promise<any>;
  setResultPages: (b: BattleState, pages: Array<BattleResultPage | string | null>, spec?: BattleLineSpec | null) => void;
  sfx?: any;
  showItemPage: (b: BattleState, prefix: any, walker: string, pages: BattleLineSpec[]) => void;
  skillDB: { [k: string]: BattleSkill; };
  slotDamage: (slotTechId: any, atk: any, def: any, rng: any, field: any) => number;
  spawnFightTaskFor: (side: number, techniqueId: number) => any;
  stageEncDB: StageEncounters | null;
  start?: any;
  startDnaChunk: (b: BattleState, dna: any) => void;
  startEnemySelfTag: (b: BattleState, tag: any) => void;
  startEntrance?: any;
  startLossSession: (b: BattleState) => any;
  startParty?: any;
  startRandom: (mapId: number | string, x: number, y: number, onWin: any, onFlee: any, onLose: any) => Promise<boolean>;
  startScreen?: any;
  statusEventQueueAdvance?: any;
  stepBattleOpening: (b: BattleState, dt: number) => void;
  stepCounter: (b: BattleState) => boolean;
  storyOrdinal: () => number;
  swapEnemyModel: (name: string) => Promise<void>;
  swapPlayerModel: (name: string) => Promise<any>;
  tagListSeed?: any;
  tagMembers: () => any[];
  tagNative?: any;
  techListSeed: (b: BattleState) => { activeIndex: number; mp: number; maxMp: number; noCharge: number; techniques: any; };
  techNative?: any;
  techniqueSpec: (b: BattleState, skill: any) => BattleLineSpec;
  tickBattleMessage: (b: BattleState, dt: number) => void;
  tickBlastTurn: (b?: BattleState) => void;
  tickHudEase: (dt: number) => void;
  triggerBlast: (b?: BattleState) => boolean;
  triggerEnemyCounterRow: (b: BattleState, attacker: any, defender: any, damage: number, attackerName: string, defenderName: string) => string;
  triggerPlayerCounter: (b: BattleState, attacker: any, defender: any, damage: number, attackerName: string, defenderName: string) => string;
  triggersForStage: (mapId: number | string) => unknown[];
  trySteal?: any;
  update: (dt: number) => void;
  usableItems: () => any[];
  visibleList: (rows: any, selected: number) => { visible: number; top: number; };
  wfightNative?: any;
  winRewards: (b: BattleEndContext, rosterIndex?: number) => { xp: number; bits: number; dvexp: number; };
  zoneGridDB: ZoneGrids | null;
}
