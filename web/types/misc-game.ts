// Types shared by the small game files of one group: web/evolution-planner.ts, web/dri-model.ts,
// web/fxaudio.ts, web/dev-panel.ts. Declarations only, nothing here is emitted.
import type { PartnerStats } from "../game/types.js";
import type { BattleSkill, DigimonRecord } from "./battle.js";

// ---------------------------------------------------------------- web/evolution-planner.ts

/** The six core stats an evolution gate of kind 1..6 reads. */
export type EvoCoreStat = "str" | "def" | "spt" | "wis" | "spd" | "chr";

/** The seven element points an evolution gate of kind 8..14 reads. */
export type EvoElement = "fire" | "water" | "ice" | "wind" | "thunder" | "machine" | "dark";

/** One evolutions.json record as the planner reads it: the target form, two required forms with their form level, one extra gate. */
export interface EvolutionRecord {
  to?: number | string;
  kind?: number;
  threshold?: number;
  req0?: number;
  req0Level?: number;
  req1?: number;
  req1Level?: number;
}

/** One digivolution line: the roster slot it belongs to and its records in table order. */
export interface EvoPlannerLine {
  slot?: number | string;
  records?: EvolutionRecord[];
}

/** evolutions.json (after web/extra-roster.js merged the extras): the lines. */
export interface EvoPlannerTable {
  lines?: EvoPlannerLine[] | null;
}

/** One digimon.json profile, as far as the planner reads it. */
export interface EvoProfile {
  id: number | string;
  name?: string;
}

/** digimon.json as an object: the profile list and the skill table. */
export interface EvoDigimonObject {
  digimon?: EvoProfile[];
  skills?: BattleSkill[];
}

/** digimon.json's profile list as a bare array (the same optional keys are read off it, as codex-data's line list does). */
export interface EvoProfileList extends Array<EvoProfile> {
  digimon?: EvoProfile[];
  skills?: BattleSkill[];
}

/** digimon.json whole, or just its profile array. */
export type EvoDigimonSource = EvoProfileList | EvoDigimonObject;

/** What the fetch hands back: a Response (json()) or, in tests, the table itself. */
export interface EvoFetched extends EvoPlannerTable, EvoDigimonObject {
  json?: () => EvoFetched | Promise<EvoFetched>;
}

/** The planner's injectable fetch. */
export type EvoFetch = (url: string) => EvoFetched | Promise<EvoFetched>;

export interface EvolutionReqProgress {
  id: number;
  name: string;
  level: number;
  have: number;
  met: boolean;
  text: string;
}

export interface EvolutionGateProgress {
  kind: number;
  label?: string | null;
  threshold: number;
  have: number | null;
  met: boolean;
  text: string;
}

export interface EvolutionProgress {
  reqs: EvolutionReqProgress[];
  gate: EvolutionGateProgress;
  unmet: string[];
  ready: boolean;
  text: string;
}

/** The extra gate of a record in plain words (kind 0 = no gate). */
export interface EvoGate {
  kind: number;
  key: string | null;
  label: string | null;
  threshold: number;
  text: string;
}

/** One requirement row of a record, names resolved. */
export interface EvoReq {
  id: number;
  name: string;
  level: number;
  text: string;
}

/** requirementsFor(): the requirement rows, the gate, and both in one line. */
export interface EvoRequirements {
  reqs: EvoReq[];
  gate: EvoGate;
  text: string;
}

export interface EvolutionStats {
  digimonId?: number;
  level?: number;
  stats?: Record<string, number>;
  bonuses?: Record<string, number>;
  elemBonuses?: Record<string, number>;
}

/** A member's live state: its form ledger (object or Map), battle level and stored stat record. */
export interface EvolutionLive {
  formLevels: Record<number, number> | Map<number, number>;
  level: number;
  stats: EvolutionStats;
}

/** One party member as game.js's snapshot reads it. */
export interface EvoMember {
  slot: number;
  name: string;
  live: EvolutionLive;
}

/** The snapshot reader's answer: the members (plannerPartyMembers answers the member array itself, a snapshot object carries them as .members). */
export interface EvoSnapshot extends Array<EvoMember | null> {
  members?: EvoMember[];
}

/** One row of the planner's list: a form the line can still learn. */
export interface EvoPlannerRow {
  to: number;
  name: string;
  index: number;
  ready: boolean;
  unmet: string[];
  text: string;
}

/** The page's state. */
export interface EvoPlannerState {
  open: boolean;
  wasOn: boolean;
  evolutions: EvoPlannerTable | null;
  profiles: EvoProfile[];
  skills: BattleSkill[];
  members: EvoMember[];
  index: number;
  cursor: number;
  rows: EvoPlannerRow[];
  loading: Promise<boolean> | null;
  error: string | null;
}

// ---------------------------------------------------------------- web/dri-model.ts

/** One decoded 0x14-byte form-ledger record: the form, its form level, its DV exp and its six technique words. */
export interface DriFormLedgerEntry {
  id: number | string;
  formLevel: number;
  dvexp: number;
  techSlots: number[];
}

/** The numbers a profile table is read by: digimon.json's species id. */
export type DriDigimonById = Record<number, DigimonRecord>;

/** A party member's stored stat block (state.partnerStats / state.partyStats[i]); the other keys are read where they are used. */
export interface DriStatFields {
  digimonId?: number;
  level?: number;
  xp?: number;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  bonuses?: Record<string, number>;
  elemBonuses?: Record<string, number>;
  /** the older walker saves only had this map; ensureFormLedger migrates it */
  dvexpByForm?: Record<string, number>;
  formLedger?: DriFormLedgerEntry[];
  equippedForms?: number[];
  loadedTechs?: number[];
}

/** The stat block as the game stores it (its five numbers, the other keys read where used) plus the keys the DRI model reads and writes. */
export type DriStats = Partial<PartnerStats> & DriStatFields;

/** One manifest character, as far as the DRI model touches it. */
export interface DriManifestCharacter {
  id: string | number;
  digimonId?: number | string;
}

/** What the DRI model reads and writes of the live game state. */
export interface DriModelState {
  party: (string | number)[];
  partyStats: (DriStats | null)[];
  partnerStats: DriStats | null;
  equipment?: (Record<string, number> | null)[];
  reserveStats?: Record<string, DriStats | null>;
  reserveEquipment?: Record<string, Record<string, number>>;
  rosterOwned?: number;
  digimonNames?: Record<string, string>;
  manifest?: { characters?: DriManifestCharacter[] };
  charId?: string | number;
  charIdx: number;
}

/** One row of the party list (driRoster). */
export interface DriRosterRow {
  index: number;
  charId: string | number;
  profile: DigimonRecord | undefined;
  stats: DriStats;
  name: string | number;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
}

/** One pedestal of the Switch screen: a party member, or an empty slot. */
export interface DriSwitchSlot {
  index: number;
  charId: string | number | null;
  profile: DigimonRecord | null | undefined;
  stats: DriStats | null;
  empty?: boolean;
}

/** One reserve partner the Switch screen offers (driReserve). */
export interface DriReserveRow {
  slot: number;
  charId: string | undefined;
  profile: DigimonRecord | undefined;
  starter: DigimonRecord | undefined;
  stats: DriStats | null;
  name: string | undefined;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
}

/** One form the partner has acquired, with its species row. */
export interface DriFormRecord { id: number | string; }

/** One row of the digivolve list: a form, or "Do nothing." (the rookie row). */
export interface StandingChoice { profile: DigimonRecord; formId: number; doNothing?: boolean; }

/** One chart entry: the evolutions.json record with its profile, `to` replaced by the form's name. */
export interface DriChartEntry extends Omit<EvolutionRecord, "to"> {
  to: string;
  profile: DigimonRecord;
}

/** One of the chart's four pages. */
export interface DriChartPage {
  page: number;
  starter: DigimonRecord | undefined;
  entries: DriChartEntry[];
}

/** One evolutions.json record as the chart reads it. */
export interface DriChartRecord extends Omit<EvolutionRecord, "to"> {
  to: number;
}

// ---------------------------------------------------------------- web/fxaudio.ts

/** A looping filtered noise: its gain (the level knob) and its filter. */
export interface NoiseLoop {
  g: GainNode;
  f: BiquadFilterNode;
}

/** The place ambience: water lapping, forest rustle, city hum and the hum's own gain. */
export interface PlaceAmbience {
  lap: NoiseLoop;
  rustle: NoiseLoop;
  hum: NoiseLoop;
  hg: GainNode;
}

/** The music element's route through the weather: its low-pass filter and its gain. */
export interface MusicRoute {
  f: BiquadFilterNode;
  g: GainNode;
}

/** The game's music element; web/audio.ts sets routedToGain once the gain node carries the level. */
export interface RoutableMusicElement extends HTMLMediaElement {
  routedToGain?: boolean;
}

// ---------------------------------------------------------------- web/dev-panel.ts

/** The F2 page's own state: the open tab, the search text, the In / Auto / Out filter, the switches not on this map, the quest note. */
export interface DevPanelState {
  tab: string;
  query: string;
  filter: string;
  na: Set<string>;
  note: string;
}
