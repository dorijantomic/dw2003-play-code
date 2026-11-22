import type { BattleSkill, DigimonRecord, EnemyRecord } from "./battle.js";
import type { PartnerStats } from "../game/types.js";
import type { EvolutionStats } from "./misc-game.js";
import type { CodexMapEntry, CodexMapManifest, CodexPartnerRow, CodexRow, EvolutionLinesFile, ScreenSource, StageSource } from "./codex-data.js";

/** The eight numbers a species page shows. */
export type StatKey = "hp" | "mp" | "str" | "def" | "spt" | "wis" | "spd" | "chr";

/** The six core stats (a profile row holds these as plain numbers). */
export type CoreKey = "str" | "def" | "spt" | "wis" | "spd" | "chr";

/** A low and a high over a wild record's encounter rows. */
export interface GlossaryRange {
  lo: number;
  hi: number;
}

/** The five stats a wild record holds in its table (no CHR). */
export type WildKey = "str" | "def" | "spt" | "wis" | "spd";

/** wildAsFought(): HP and the five table stats as low-high ranges. */
export interface GlossaryDigimonOut {
  hp?: GlossaryRange;
  str: GlossaryRange;
  def: GlossaryRange;
  spt: GlossaryRange;
  wis: GlossaryRange;
  spd: GlossaryRange;
  [stat: string]: GlossaryRange | undefined;
}

/** A form's base numbers: HP and MP, and each core stat or null when the profile holds none. */
export interface BaseNumbers {
  hp: number;
  mp: number;
  [core: string]: number | null;
}

/** What names a species row: its record names (a numbered record lists its own) or just its one name. */
export interface SpeciesNames {
  names?: string[];
  name?: string;
}

/** A species' drop: the item, the odds as n in 1024 and the percent the book prints. */
export interface GlossaryDrop {
  item: string;
  n: number;
  of: number;
  percent: number;
}

/** One entry of the species list (buildSpecies().species). */
export interface GlossarySpecies {
  index: number;
  number: number;
  name: string;
  names: string[];
  partner: CodexPartnerRow | null;
  wild: CodexRow | null;
  profileId: number | null;
  fought: GlossaryDigimonOut | null;
  profile: DigimonRecord | null;
  getting: string[];
  hp: number | null;
  mp: number | null;
  stats: { [stat: string]: number | null | undefined };
  resists: { [element: string]: number };
  levels: { min: number; max: number } | null;
  lives: string[];
  drop: GlossaryDrop | null;
  drops: GlossaryDrop[];
  techniques: string[];
  from: string | null;
  into: string[];
}

/** The scale of each bar: the real maximum of that stat over the species. */
export type GlossaryMaxima = Record<StatKey, number>;

/** The tables the species were built from, kept for page 2. */
export interface GlossaryWorld {
  evolutions: EvolutionLinesFile | null;
  profiles: DigimonRecord[];
  skills: BattleSkill[];
}

/** buildSpecies(): the species list, the world it came from and the bar scales. */
export interface GlossarySpeciesData {
  species: GlossarySpecies[];
  world: GlossaryWorld;
  maxima: GlossaryMaxima;
  wildMaxima: GlossaryMaxima;
}

/** One party member as the glossary reads it (web/game/followers.ts glossaryPartners). */
export interface GlossaryPartner {
  slot: number;
  /** the starter species */
  rookie: string | null;
  /** the species it wears now */
  form: string;
  formId: number;
  level: number;
  live: { formLevels: Record<number, number>; level: number; stats: PartnerStats & EvolutionStats };
}

/** One row of the species list as the book draws it. */
export interface GlossaryRow {
  index: number;
  number: number;
  label: string;
  state: string;
}

/** The planner's row of one next form (web/evolution-planner.ts plannerRows). */
export interface EvolutionPlannerRow {
  to: number;
  name: string;
  index: number;
  ready: boolean;
  unmet: string[];
  text: string;
}

/** The counts line over the list. */
export interface HeaderCounts {
  met: number;
  beaten: number;
  total: number;
  text: string;
}

/** The species log's stored counts. */
export interface DigimonLogState {
  met: Record<string, number>;
  beaten: Record<string, number>;
  owned?: Record<string, number> | null;
}

/** The species log as the glossary asks it. */
export interface DigimonLog {
  read?: () => DigimonLogState | null;
  metCount: (id: string | number) => number;
  beatenCount: (id: string | number) => number;
  ownedCount: (id: string | number) => number;

  totals: () => { met: number; beaten: number };
}

/** The card text of page 1. */
export interface GlossaryPageOne {
  title: string;
  row1: string;
  record: string;
  lives: string;
  drops: string;
  shadow: boolean;
}

/** One line of page 2: a heading, a labelled text line or a bar. */
export type PageTwoLine =
  | { kind: "head"; label: string }
  | { kind: "text"; label: string; text: string }
  | { kind: "bar"; label: string; icon: string | null; value: number; max: number; text?: string };

/** The game's own tables the species page is built from: the digimon tables, the evolution lines, the wild
 *  rows, the model map, and where each species is met. */
export interface SpeciesTables {
  digimon?: { digimon?: DigimonRecord[]; skills?: BattleSkill[] } | null;
  evolutions?: EvolutionLinesFile | null;
  enemies?: { enemies?: EnemyRecord[] } | null;
  modelMap?: Record<string, string> | null;
  encounters?: { stages?: StageSource | null; screens?: ScreenSource | null; maps?: CodexMapEntry[] | CodexMapManifest | null } | null;
}
