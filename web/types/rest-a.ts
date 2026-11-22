import type { DigimonRecord, EnemyAiMove } from "./battle.js";
import type { FusionBoss } from "../battle/core/types.js";
import type { FlagGate } from "../game/types.js";
import type { GameState } from "../game/types.js";
import type { MenuState } from "../menu/types.js";
import type { StatusScreen } from "./status-translated.js";
// Shared types of the "rest A" group of web/*.ts files (the small leaf modules). Type-only: nothing here is emitted.

/** The F2 switches the pause list reads for its two book rows (web/pause-extra-rows.ts). */
export interface PauseBookSwitches {
  glossary?: boolean;
  options?: boolean;
}

/** What web/pause-extra-rows.ts pauseExtraRows takes: the quests row (or null), the F2 switches, the FLY flag. */
export interface PauseExtraRowsArgs {
  quests?: { label: string } | null;
  fx?: PauseBookSwitches | null;
  fly?: boolean;
}

/** What web/pause-home.ts needs of its callers: the game state, the translated pause (or null), the old menu. */
export interface PauseHomeArgs {
  state: GameState;
  status: StatusScreen | null;
  menu: MenuState;
  row?: number;
}

/** The cel numbers of the six pause-panel tiles (web/panel-kit.ts PANEL_FRAMES). */
export type PanelFrameNumber = 56 | 57 | 58 | 59 | 60 | 61;

/** One tile frame of the pause list's panel: its cel number and source rectangle on the sheet. */
export interface PanelFrame {
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** All six tile frames, by cel number. */
export type PanelFrames = Record<PanelFrameNumber, PanelFrame>;

/** The battle's elemental field: its element (null = none) and its power (web/field-war.ts). */
export interface FieldWarField {
  element?: string | null;
  power?: number;
}

/** The part of a roster-view entry web/charisma.ts reads (a member's stored stats, chip bonuses, profile and level). */
export interface CharismaEntry {
  profile?: DigimonRecord;
  level?: number;
  stats?: Record<string, number> | null;
  bonuses?: Record<string, number> | null;
}

/** One ambient villager (web/crowd.ts), or a scene NPC it borrows a sprite from. */
export interface CrowdNpc {
  id?: string;
  sprite?: string | undefined;
  npc_id?: number | undefined;
  slot?: number | undefined;
  n?: number;
  x: number;
  y: number;
  dir?: string;
  path?: [number, number][];
  cutsceneOnly?: boolean;
  invisible?: boolean;
  _pathIdx?: number;
  _pathFrac?: number;
  _ephemeral?: boolean;
  _ambient?: boolean;
  spawn_flags?: FlagGate[];
  _none?: undefined;
}

/** What web/crowd.ts stores for a map it decided to leave empty, so it does not retry every frame. */
export interface CrowdNone {
  _none: true;
  x?: undefined;
  y?: undefined;
  sprite?: undefined;
}

/** A map's walkable-cell grid as web/crowd.ts reads it. */
export interface CrowdGrid {
  cell: number;
  cols: number;
  rows: number;
  cells: number[];
}

/** One scene's cast: its NPCs and the sub-list the crowd must not touch. */
export interface CrowdScene {
  npcs: CrowdNpc[];
  _cast?: CrowdNpc[] | null;
}

/** The game state web/crowd.ts reads and writes. */
export interface CrowdState {
  scenes?: Record<string, CrowdScene | undefined>;
  collision?: Record<string, CrowdGrid | undefined>;
  npcImgs?: Record<string, HTMLImageElement>;
  _inCutscene?: boolean;
  battleActive?: boolean;
  textboxOpen?: boolean;
}

/** The map record syncVillagers is given, and the ambience profile it reads. */
export interface CrowdMap {
  id: string;
}
export interface CrowdProfile {
  villagers?: boolean;
}

/** The technique fields of a digimon.json profile that web/form-tech-slots.ts reads (all optional: older profiles lack some). */
export interface TechSlotProfile {
  tech_slots?: number[];
  tech_learn_levels?: number[];
  tech_load_levels?: number[];
  tech_level_learn?: number[];
  tech_level_load?: number[];
  techs?: number[];
  tech_signature?: number | null;
}

/** The part of one form-ledger record the learn / load passes read and write. */
export interface TechLedgerRecord {
  formLevel?: number;
  techSlots?: number[];
}

/** The stored-bit backend the flag store sits on (the engine FlagManager adapter). */
export interface FlagBackend {
  get(id: number): boolean | number;
  set(id: number, val: boolean | number): void;
}

// ---------------------------------------------------------------- web/fusion.ts

/** The five primary stats every fusion blend covers. */
export type FusionStatKey = "str" | "def" | "spt" | "wis" | "spd";

/** One enemy AI row (enemies.json ai_moves). */
export type FusionAiRow = EnemyAiMove;

/** An enemies.json stat row: the five primary stats and the AI rows. */
export interface FusionStatRow {
  str?: number;
  def?: number;
  spt?: number;
  wis?: number;
  spd?: number;
  ai_moves?: FusionAiRow[] | null;
}

/** What fusedRecord takes: the halves' stat rows and the authored boss spec. */
export interface FusedRecordArgs {
  halves?: FusionStatRow[];
  body?: string | null;
  level?: number;
  hp?: number;
  statScale?: number;
  moves?: number[];
  aiFill?: boolean;
}

/** A party entry's `fuseInto`: the built boss record itself, or its id. */
export type FusionBossRef = string | number | FusionBoss;

/** The built boss table: the bosses by id, directly or under a `bosses` key. */
export type FusionBossLookup = Record<string, FusionBoss>;

/** A party entry the battle starts with: an encounter row, plus the authored display name and fusion the fusion layer reads or drops. */
export interface FusionPartyEntry {
  name?: string;
  id?: number;
  level?: number;
  hp?: number;
  mp?: number;
  stat_scale?: number;
  digimonId?: number | null;
  size?: number;
  displayName?: string | null;
  fuseInto?: FusionBossRef | null;
}

/** A fusion skill row (fusion_skills.json): keyed in the skill map by its technique id. */
export interface FusionSkillRow {
  id?: number | string | null;
}

/** One enemy's party entry in a Lab boss record. */
export interface LabBossPartyEntry {
  id?: number | string;
  level?: number;
  hp?: number;
  mp?: number;
  stat_scale?: number;
  digimonId?: number | null;
}

/** A Lab boss record as fusion_lab_bosses.json carries it, as far as web/fusion.ts reads it. */
export interface LabBossCandidate {
  id?: string;
  halves?: (string | number)[];
  body?: string;
  modelFolder?: string;
  hp?: number | string;
  moves?: number[];
  party?: LabBossPartyEntry | null;
}

// ---------------------------------------------------------------- web/titlescreen.ts

/** A point on the 320x240 title screen. */
export type TitlePoint = [number, number];

/** One clip entry of assets/data/stdwtitl_ui.json title_menu.clips. */
export interface TitleUiClip {
  settles_at?: TitlePoint;
  starts_at?: TitlePoint;
  at?: TitlePoint;
  script?: number[];
}

/** One clip of the legal block. */
export interface TitleLegalClip {
  at: TitlePoint;
  clut_script?: number[];
  settles_at_row?: number;
}

/** The Japanese layout block of title_menu. */
export interface TitleJpnLayout {
  logo?: TitleUiClip;
  wordmark?: TitleUiClip;
  numeral?: TitleUiClip;
  glow?: { at?: TitlePoint; script?: number[]; stays_lit_at?: number };
}

/** assets/data/stdwtitl_ui.json, as far as web/titlescreen.ts reads it. */
export interface TitleUiJson {
  title_menu?: {
    split?: { from?: TitlePoint; to?: [TitlePoint, TitlePoint] };
    option_palette?: { selected: number; unselected: number };
    clip_by_language?: Record<string, [number, number, number]>;
    clips?: Record<string, TitleUiClip | undefined>;
    jpn_layout?: TitleJpnLayout;
    legal_block?: {
      draw_order?: number[];
      clips?: Record<string, TitleLegalClip | undefined>;
    };
  };
}

/** The merged title layout (stdwtitl_ui.json over the built-in fallback) that drawTitleScreen and TitleSession read. */
export interface TitleLayout {
  promptAt: TitlePoint;
  optionAt: [TitlePoint, TitlePoint];
  optionPalette: { selected: number; unselected: number };
  clipByLanguage: Record<string, [number, number, number]>;
  logo: { clip: number; at: TitlePoint; start: TitlePoint; from: string }[];
  numeral: { clip: number; at: TitlePoint };
  glow: { clip: number; at: TitlePoint; script: number[] };
  legalScripts: (number[] | undefined)[];
  twinkles: unknown;
  boxClip: number;
  jpn: {
    logo: { at: TitlePoint; start: TitlePoint };
    wordmark: { at: TitlePoint; start: TitlePoint };
    numeral: { at: TitlePoint };
    glow: { at: TitlePoint; script: number[]; stay: number };
  };
}

// ---------------------------------------------------------------- web/quest-chase.ts

/** A chase step's event after compileScene resolved it: the path the target runs and its limits. */
export interface QuestChaseSpec {
  path?: number[][];
  speed?: number;
  lose?: number;
  frames?: number;
  grace?: number;
}

/** Where the chase target stands when the chase begins. */
export interface QuestChaseStart {
  x: number;
  y: number;
}

// ---------------------------------------------------------------- web/stage-wipe.ts

/** The live checkerboard walk state: the 60-word grid plus the schedule cursor. */
export interface Checkerboard {
  grid: number[];
  index: number;
  calls: number;
  done: boolean;
}

/** One record of the checkerboard schedule: the word it moves, how, and where it stops. */
export interface CheckerboardRecord {
  ptr: number;
  mode: number;
  limit: number;
}

// ---------------------------------------------------------------- web/title-movie.ts

/** assets/data/stdwtitl_ui.json title_menu.movie_display: the video's place on the title screen and the launch-code -> file table. */
export interface TitleMovieLayout {
  logical: [number, number, number, number];
  launch: Record<string, string | undefined>;
  fps?: number;
  frames?: number;
}



/** A point on a villager's walking loop, in map pixels. */
export type CrowdPoint = [number, number];
