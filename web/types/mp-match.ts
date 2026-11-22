// Types of the many-vs-many fight (web/mpbattle-rules.ts, web/mpbattle/*.ts). Declarations only: nothing here is emitted.
import type { PlayerRecord, EnemyBattleRecord, BattleSkill, BattleState, FightTechRow } from "./battle.js";
import type { MpPracticeOptions } from "../mpbattle/types.js";

/** One player's choice as the referee reads it (host.ts hostCommand builds it from the wire). */
export interface MpCommand {
  k: string;
  sk: number;
  tw: number;
  item: number;
  form: number;
  slot: number;
  to: string;
  /** a foe's index, a fighter key, or -1 */
  t: string | number;
}

/** A player in the arena: the Digimon out, its reserves, and the Tag state. */
export interface MpSeatPlayer {
  key: string;
  id: number | string;
  name: string;
  rec: MpPlayerRec;
  fled: boolean;
  party: MpPlayerRec[];
  act: number;
  needTag: boolean;
}

/** An enemy in the arena. */
export interface MpSeatFoe {
  key: string;
  i: number;
  name: string;
  rec: MpFoeRec;
  fled: boolean;
}

export type MpSeat = MpSeatPlayer | MpSeatFoe;

/** The element and power of the field the fight is on (the engine's setField call). */
export interface MpField {
  element: string;
  power: number;
}

/** What the battle kit hands the rules (the kit itself is built in the game's battle code). */
export interface MpKit {
  skillDB(): Record<number, BattleSkill>;
  basic(rec: MpPlayerRec | MpFoeRec): BattleSkill;
  techRecord(id: number): FightTechRow | null;
  blastForm(rec: MpPlayerRec): PlayerRecord["profile"] | null | undefined;
  forms(rec: MpPlayerRec): { id: number; name: string }[];
  digivolve(rec: MpPlayerRec, id: number): void;
  stealRoll?(skill: Partial<BattleSkill>, att: MpPlayerRec | MpFoeRec, def: MpPlayerRec | MpFoeRec): { ok?: boolean; nothing?: boolean; item?: string | number; name?: string | number } | null | undefined;
}

/** The constructor options of the arena. */
export interface MpArenaOptions {
  kit: MpKit;
  players: { id: number | string; name: string; rec: MpPlayerRec; party?: MpPlayerRec[] }[];
  foes: { name: string; rec: MpFoeRec }[];
  screenId?: number | null;
  waveSize?: number;
  rng?: () => number | undefined;
}


/** What a player's Blast keeps on the record while it lasts ({ active, saved, turns }). */
export interface MpBlast {
  active?: boolean;
  saved?: PlayerRecord["profile"];
  turns: number;
}

/** The fields the arena hangs on a fighter's record (the engine's own record shape has no place for them). */
export interface MpRecordExtras {
  blast?: MpBlast | null;
  cantFlee?: boolean;
  cantDigivolve?: boolean;
  gauge?: number;
  gaugeAccessories?: number[];
  multiAttack?: boolean;
  eStats?: EnemyBattleRecord["eStats"];
  fightSkill?: BattleSkill | null;
}

/** A player's record as the arena holds it. */
export type MpPlayerRec = PlayerRecord & MpRecordExtras;
/** An enemy's record as the arena holds it. */
export type MpFoeRec = EnemyBattleRecord & MpRecordExtras;

/** One result row: [fighter key, damage, hit, went down]. */
export type MpRow = [string, number, number, number];

/** What the arena hands back for one turn (every kind of turn: the optional fields belong to some kinds). */
export interface MpTurnResult {
  a: string;
  kind: "atk" | "self" | "item" | "tag" | "dv" | "run";
  lines: string[];
  rows: MpRow[];
  sk: number;
  st?: string | number | null;
  forced?: boolean;
  refused?: boolean;
  fled?: boolean;
  blasted?: string[];
}

/** One blow's result: the single-hit and the multi-hit resolver return this shape (landed only for multi-hit). */
export interface MpHitResult {
  hit: boolean;
  dmg: number;
  heal: number;
  crit?: boolean | undefined;
  eff?: number | undefined;
  landed?: number;
}

/** One row of the live fight snapshot every screen draws: the numbers shared by every fighter's plate. */
export interface MpPlate {
  hp: number;
  mhp: number;
  mp: number;
  mmp: number;
  ko: number;
  ail: string[];
  dv: number;
  bl: number;
}

/** An enemy as the snapshot lists it. */
export interface MpFoeEntry extends MpPlate {
  pn?: undefined;
  i: number;
  n: string;
  lv: number;
}

/** One Digimon of a player's party in the snapshot (the Tag list). */
export interface MpPartyPlate {
  n: string;
  hp: number;
  mhp: number;
  mp: number;
  mmp: number;
  dv: number;
}

/** A player as the snapshot lists it. */
export interface MpPlayerEntry extends MpPlate {
  id: number;
  pn: string;
  n: string;
  lv: number;
  pt: MpPartyPlate[];
  ac: number;
}

/** The latest action, for every screen to play. */
export interface MpEvent {
  q: number;
  a: string;
  sk: number;
  kind: MpTurnResult["kind"];
  d: MpRow[];
  st: string | number | null;
}

/** The referee's snapshot (host.ts snapshot()). */
export interface MpSnapshot {
  r: number;
  w: number;
  t: string | null;
  ph: string;
  g: string[];
  ev: MpEvent | null;
  ft: number;
  ln: string[];
  lq: number;
  E: MpFoeEntry[];
  P: MpPlayerEntry[];
  pz?: { ids: (string | number)[]; s: number; };
}

/** What the plate or card of one fighter holds on the plain (non-WebGL) screen and over the 3D scene. */
export interface MpCard {
  key: string;
  root: HTMLDivElement;
  pic: HTMLDivElement;
  nm: HTMLDivElement;
  sub: HTMLDivElement;
  hpi: HTMLElement;
  hpn: HTMLDivElement;
  ail: HTMLSpanElement;
  mpi: HTMLElement | null;
  dvi: HTMLElement | null;
  last: number | null;
}

/** The numbers updateCard reads off a fighter entry (a player has pn, an enemy does not). */
export type MpCardEntry = MpFoeEntry | MpPlayerEntry;

/** A plate waiting to be placed over its fighter. */
export interface MpPlaceRow {
  c: MpCard;
  x: number;
  y: number;
}

/** A member of my own party as the fight keeps it. */
export interface MpPartyMember {
  rec: MpPlayerRec;
  member: unknown;
}

/** Which plates the target pick may land on. */
export interface MpTargetSpec {
  foes?: boolean;
  allies?: boolean;
  revive?: boolean;
}

/** My choice as it goes over the wire (the referee fills in the rest). */
export interface MpWireCommand {
  k: string;
  sk?: number;
  tw?: number;
  t?: string | number;
  item?: number;
  to?: string;
  form?: number;
  slot?: number;
}

/** What a native menu screen hands back on the frame the player confirms. */
export type MpNativeResult = { mode: string; failed: true; value?: undefined; } | { mode: string; value: number; failed?: undefined; };

/** What a fight is started with (net.ts begin). */
export interface MpSetup {
  fid: number;
  foes: unknown[];
  ids: (number | null | undefined)[];
  names?: Record<number, string> | undefined;
  label?: string | undefined;
  screenId?: number | null | undefined;
  mapId?: number | null | undefined;
  ch?: unknown;
  bots?: { id: number; name: string; party: PlayerRecord["profile"][]; }[] | undefined;
}

/** What endScene tears down of the fight screen. */
export interface MpSceneUi {
  raf: number;
  r3d: { destroy?: () => void; } | null;
  off: OffscreenCanvas | null;
  nat: { close(): void; } | null;
  pad: HTMLElement;
  root: HTMLElement;
  plateMap: Map<string, MpCard>;
}

/** What the plain-cards screen keeps. */
export interface MpCardsUi {
  foeKeys: string;
  cards: Map<string, MpCard>;
  foes: HTMLElement;
  mine: HTMLElement;
}

/** The `battleWon` event of a co-op fight (web/mp-credit.ts). */
export interface MpWinEvent {
  enemies: string[];
  mapId: string | null;
  screenId: number | null;
}

/** A foe as the setup packet carries it: a bare name or a row with one. */
export type MpFoeRef = { name?: string; } | string | null | undefined;

/** What the game hands the many-vs-many fight (web/game.ts installMpBattle). */
export interface MpBattleApi {
  stageEl: HTMLElement | null;
  getKit: () => unknown;
  sfx: unknown;
  bgm: unknown;
  mapId: () => string | null;
  languageByte: () => number;
  openReport: (b: BattleState, onClose: () => void) => unknown;
  myId: () => number;
  myName: () => string;
  practice: (o: MpPracticeOptions) => unknown;
  nameOf: (id: number) => string;
  send: (ids: number[], d: unknown) => unknown;
  releaseKeys: () => void;
  snapshot: () => { lead: string; party: string; bits: number; };
  restore: (sn: { lead: string; party: string; bits: number; }) => void;
  canJoin: () => boolean;
  joinDone: (setup: { ch?: number[]; }) => (r: { won?: boolean; fled?: boolean; }) => void;
}
