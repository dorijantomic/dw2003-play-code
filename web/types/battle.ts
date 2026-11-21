import type { BattleMusicTrack } from "../battle/core/types.js";
import type { GameState } from "../game/types.js";

/** one page of battle text: the message kind, its payload words, and the words its template fills in */
export interface BattleLineSpec {
  kind: number;
  payload: number[];
  /** line one, usually the actor's name */
  name?: string;
  /** the words the template's {n} placeholders take */
  slots?: string[];
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

/**
 * The live battle record: web/battle/core/start.ts builds it as one object literal and every phase
 * module then hangs its own fields on it, so only the fields all of them share are named here and
 * the rest read back as any. (The record itself is kept as any on BattleContext.battle: end.ts and
 * update.ts hand it to the win-report helpers, whose BattleEndContext demands a `formFlags` the
 * record does not carry yet.)
 */
export type BattleState = {
  /** ST.* */
  state?: number;
  timer?: number;
  message?: string;
  /** the field screen the fight started on */
  mapId?: number;
} & Record<string, any>;

export interface BattleContext {
  _battleTargetSize?: () => { w: number; h: number; };
  _init3DRenderer?: (b: BattleState) => Promise<void>;
  _profileByName?: any;
  _savedCanvas?: { w: number; h: number; };
  advanceAfterResult?: (b: BattleState) => void;
  advanceBlastPresentation?: (b: BattleState, dt: number) => void;
  advanceBossPhase?: (b: BattleState) => { text: string; spec: BattleLineSpec; }[];
  advanceDisplayFrames?: (dt: number) => any;
  animBusy?: () => boolean;
  applyCounter?: (b: BattleState, c: any) => void;
  applyDnaAction?: (action: any) => boolean;
  applyDnaAnswer?: (b: BattleState, answer: any, kind?: string) => boolean;
  applyDvAction?: (action: any) => void;
  applyEnemyAction?: () => void;
  applyEvolution?: any;
  applyParticipantProgress?: any;
  applyPlayerAction?: any;
  applyTagAction?: (action: any) => boolean;
  armContactDamage?: any;
  armIntroLine?: (b: BattleState) => number;
  armPendingImpact?: (b: BattleState, commit: any) => void;
  attackSpec?: (b: BattleState, name?: string) => BattleLineSpec;
  availableEvolutions?: (state: GameState, rosterIndex?: number) => any[];
  battle?: any;
  BATTLE_REF_H?: number;
  BATTLE_REF_W?: number;
  battleFormLevel?: (rosterIndex: number, formId: number, bb?: any) => number;
  battleMusicDB?: Record<string, BattleMusicTrack[]>;
  bgm?: any;
  BLAST_CAPTURE_HZ?: number;
  blastReady?: (b?: BattleState) => boolean;
  buildEnemyRecord?: any;
  buildPlayerRecord?: any;
  buildPlayerRoster?: (state: GameState) => any;
  canvas?: HTMLCanvasElement;
  cardmonBoosterForBattle?: (b: BattleState) => any;
  cardmonBoostersDB?: any;
  chromeReady?: () => boolean;
  clearBattleLine?: (b: BattleState) => void;
  commandNative?: any;
  commitDnaImpact?: (b: BattleState, dna: any) => void;
  commitDnaRestore?: (b: BattleState, dna: any) => void;
  commitPendingImpact?: (b: BattleState) => boolean;
  commitTag?: (b: BattleState, action: any, spd: any) => void;
  confirmCommand?: (b: BattleState) => void;
  confirmDvForm?: (b: BattleState, speciesId: number) => void;
  confirmItem?: (b: BattleState, id: number | string) => void;
  confirmJokePick?: (b: BattleState, row: number) => void;
  confirmTag?: (b: BattleState, slot: number) => void;
  confirmTech?: (b: BattleState, id: number | string) => void;
  contactOnHit?: (contact: any, commit: any) => (rec: any) => void;
  coopSetEnemyHp?: (index: number, hp: number) => void;
  coopState?: any;
  coversField?: () => boolean;
  ctx?: CanvasRenderingContext2D;
  damageSpec?: (name: string, total: number, extra?: string, techniqueId?: number, side?: number, heal?: BattleHeal | null) => BattleLineSpec | null;
  defeatCurrentEnemy?: () => void;
  defeatedSpec?: (enemyName: string) => BattleLineSpec;
  digimonDB?: { [k: string]: any; };
  DIRECTOR_STATES?: Set<number>;
  dnaChoiceFor?: any;
  dnaNative?: any;
  dnaPaneSeed?: any;
  dnaParticipantsFor?: any;
  dnaProfileRecord?: (reader: any, profile: any) => number;
  dnaResultScript?: any;
  dnaScriptChunks?: any;
  dnaTableReader?: (species: any, techniques?: any) => { read8: (addr: number) => number; read16: (addr: number) => number; };
  draw?: () => void;
  drawBattleHud?: (b: BattleState) => void;
  drawChrome?: (name: string, x: number, y: number, w?: number, h?: number) => boolean;
  drawCommandMenu?: (b: BattleState) => void;
  drawDescription?: (text: string, mp?: number) => void;
  drawDnaChoice?: (b: BattleState) => void;
  drawFightPane?: (x: number, y: number, w: number, h: number, angled?: boolean) => void;
  drawFightReport?: (b: BattleState) => void;
  drawFightReportGroup?: any;
  drawFormMenu?: (b: BattleState, rosterIndex: number, title: string) => void;
  drawItemMenu?: (b: BattleState) => void;
  drawListChrome?: (hint?: Readonly<{ kind: number; clut: number; l1: any; r1: any; }>) => void;
  drawListSelector?: (x: number, y: number, selected: number) => void;
  drawMenuNotice?: (b: BattleState) => void;
  drawNativeBar?: (x: number, y: number, w: number, h: number, cur: number, max: number) => void;
  drawNativePanel?: (x: number, y: number, w: number, h: number, fill?: string) => void;
  drawPips?: (def: any, active?: number) => void;
  drawSubtractiveFade?: (ctx: CanvasRenderingContext2D, cw: number, ch: number, amount: number) => void;
  drawTagMenu?: (b: BattleState) => void;
  drawTechMenu?: (b: BattleState) => void;
  /** element index -> the element's name (built once off skillDB) */
  elem1NameCache?: Record<number, string>;
  elementNameForElem1?: (elem1: number) => string;
  encounterRateLevel?: (mapId: number | string, x?: number, y?: number) => any;
  /** endBattle()'s outcome words: the fight was won, lost, or the enemy ran */
  endBattle?: (result: "win" | "lose" | "enemy-fled") => void;
  endingHandoff?: any;
  enemiesDB?: { [k: string]: any; };
  enemyConditionSlots?: (b: BattleState, en: any) => { enemySlots: any[]; activeEnemyIndex: any; };
  enemyHp?: (eStats: any, level: number) => number;
  enemyMp?: (eStats: any, level: number) => number;
  enemyTeamActive?: (b: BattleState) => boolean;
  enemyTeamRecord?: (b: BattleState, i: number) => any;
  enemyTeamRecords?: (b: BattleState) => any[];
  enemyTechniqueSpec?: (enemyName: string, skill: any) => BattleLineSpec;
  enemyToProfile?: (eStats: any) => { name: any; resistances: any; family: any; };
  enterBattleFullscreen?: () => void;
  enterLossState?: (b: BattleState) => void;
  entryKey?: () => number;
  evadeSpec?: (b: BattleState, enemyName: string) => BattleLineSpec;
  evolutionTrees?: any;
  evoTargets?: (evos: any) => any[];
  exitBattleFullscreen?: () => void;
  fieldEncDB?: any;
  fieldMovieHandoff?: any;
  fightTechDB?: any;
  fillHpBar?: (x: number, y: number, w: number, h: number, cur: number, max: number) => void;
  finishFinaleBeat?: (b: BattleState, index: number, beat: any) => void;
  FORCE_INTRO_NO_LINE?: boolean;
  forcedDedigivolve?: (b: BattleState) => void;
  FORM_ELEMENTS?: string[];
  formListSeed?: any;
  formNative?: any;
  formOptionsFor?: (rosterIndex: number, bb?: any) => any[];
  formPanelMemberSeed?: any;
  frozenGateLosesTurn?: (b: BattleState) => boolean;
  fuseIntoBoss?: (b: BattleState, boss: any) => void;
  fusionBossesDB?: any;
  fusionDataTried?: boolean;
  getPlayerProfile?: (state: GameState) => any;
  /** the field state accessor, carried on the context so shared routines can save a gauge */
  getState?: () => GameState;
  handleKey?: (rawKey: string) => any;
  hpPlateMembers?: (b: BattleState) => { index: number; hp: number; maxHp: number; }[];
  hpPlateOf?: (b: BattleState) => any;
  HUD_CELS_DECODED?: Set<number>;
  hudCels?: any[];
  hudClip?: (cel: any, x: number, y: number) => boolean;
  initializePartyStats?: (state: GameState) => boolean;
  introLinePendingFor?: (b: BattleState) => boolean;
  isActive?: () => boolean;
  itemAnnouncementSpec?: (b: BattleState, item: any) => BattleLineSpec;
  itemListSeed?: (b: BattleState) => { items: any; };
  itemNative?: any;
  jogressDB?: any;
  jogressFused?: any;
  liveFormId?: (b: BattleState, slot: number) => number;
  loadData?: () => Promise<void>;
  loadFusionData?: () => Promise<void>;
  LOSS_MESSAGE_WORDS?: { 83: string; };
  lossCameraMode?: () => string;
  mpKit?: any;
  mpKitTechs?: any;
  msgClock?: any;
  msgHoldsTurn?: (b: BattleState) => boolean;
  msgPadWords?: number;
  msgSession?: any;
  musicForScreen?: (screenId: number, mapId: number | string) => any;
  nativePanelPath?: (x: number, y: number, w: number, h: number, notch?: number) => void;
  nativeText?: any;
  noteFinalBossPhaseDamage?: (b: BattleState) => void;
  offscreen3d?: HTMLCanvasElement | OffscreenCanvas;
  onBattleResize?: () => void;
  openingPorts?: any;
  ORBIT_STATES?: Set<number>;
  paintHpBar?: (x: number, y: number, w: number, h: number, cur: number, max: number, side?: number) => void;
  partnerInfo?: any;
  partyFormState?: any;
  partyForScreen?: (screenId: number) => any;
  partyRosterSlot?: (b: BattleState, position: number) => any;
  pDispShown?: (cur: number) => any;
  peek?: any;
  pickEnemy?: (mapId: number | string, x?: number, y?: number) => { party: any; screen: any; };
  pickEnemyMove?: (en: any) => any;
  playerTechs?: () => any[];
  profileById?: (id: number | string) => any;
  profileByName?: (name: string) => any;
  progressionDB?: any;
  queueAfterAction?: (b: BattleState, acted: any, playerSpd?: number) => void;
  queueCounter?: (b: BattleState, from: any, { dmg, hit, techId }: { dmg: number; hit?: boolean; techId: any; }) => void;
  recordFinaleTechnique?: (b: BattleState, techniqueId: number) => void;
  renderer3d?: any;
  reportHandoff?: any;
  resolveRepeatDispatch?: any;
  revertBlast?: (b?: BattleState) => void;
  rollEncounter?: (mapId: number | string, x: number, y: number) => Promise<{ party: any; screen: any; }>;
  runFinaleBeat?: (b: BattleState, index: number) => void;
  sayOriginal?: (b: BattleState, spec: BattleLineSpec, walker: any) => void;
  sayWalker?: (b: BattleState, walker: any) => void;
  scriptedScreen?: (mapId: number | string, index: number) => Promise<any>;
  setResultPages?: (b: BattleState, pages: Array<BattleResultPage | string | null>, spec?: BattleLineSpec | null) => void;
  sfx?: any;
  showItemPage?: (b: BattleState, prefix: any, walker: string, pages: BattleLineSpec[]) => void;
  skillDB?: any;
  slotDamage?: (slotTechId: any, atk: any, def: any, rng: any, field: any) => number;
  spawnFightTaskFor?: (side: number, techniqueId: number) => any;
  stageEncDB?: any;
  start?: any;
  startDnaChunk?: (b: BattleState, dna: any) => void;
  startEnemySelfTag?: (b: BattleState, tag: any) => void;
  startEntrance?: any;
  startLossSession?: (b: BattleState) => any;
  startParty?: any;
  startRandom?: (mapId: number | string, x: number, y: number, onWin: any, onFlee: any, onLose: any) => Promise<boolean>;
  startScreen?: any;
  statusEventQueueAdvance?: any;
  stepBattleOpening?: (b: BattleState, dt: number) => void;
  stepCounter?: (b: BattleState) => boolean;
  storyOrdinal?: () => number;
  swapEnemyModel?: (name: string) => Promise<void>;
  swapPlayerModel?: (name: string) => Promise<any>;
  tagListSeed?: any;
  tagMembers?: () => any[];
  tagNative?: any;
  techListSeed?: (b: BattleState) => { activeIndex: number; mp: number; maxMp: number; noCharge: number; techniques: any; };
  techNative?: any;
  techniqueSpec?: (b: BattleState, skill: any) => BattleLineSpec;
  tickBattleMessage?: (b: BattleState, dt: number) => void;
  tickBlastTurn?: (b?: BattleState) => void;
  tickHudEase?: (dt: number) => void;
  triggerBlast?: (b?: BattleState) => boolean;
  triggerEnemyCounterRow?: (b: BattleState, attacker: any, defender: any, damage: number, attackerName: string, defenderName: string) => string;
  triggerPlayerCounter?: (b: BattleState, attacker: any, defender: any, damage: number, attackerName: string, defenderName: string) => string;
  triggersForStage?: (mapId: number | string) => unknown[];
  trySteal?: any;
  update?: (dt: number) => void;
  usableItems?: () => any[];
  visibleList?: (rows: any, selected: number) => { visible: number; top: number; };
  wfightNative?: any;
  winRewards?: (b: BattleState, rosterIndex?: number) => { xp: number; bits: number; dvexp: number; };
  zoneGridDB?: any;
}
