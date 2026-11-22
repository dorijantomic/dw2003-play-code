import type { FieldEncounterEnemy } from "./battle.js";

/** One AI row of a wild record: its condition byte and what it does. */
export interface CodexAiRow {
  index: number;
  action: number;
  comparator: number;
  value: number;
  /** row 4 is the fallback: its condition byte is never read */
  fallback: boolean;
  condition: string;
  actionText: string;
  line: string;
}

export interface CodexRow {
  aiRows?: CodexAiRow[];
  attack: { id: number; name: string | null; };
  digimonId: string;
  drop: string;
  dropRate: number;
  family: number;
  model: string | null;
  move1: { id: number; name: string | null; };
  move2: { id: number; name: string | null; };
  name: string;
  number: number;
  resists: { [k: string]: number; };
  stats: { [k: string]: number; };
  status: { [k: string]: number; };
}

/** One skill record of digimon.json: its id, display name, power and element. */
export interface CodexSkill {
  id: number;
  name: string;
  power: number;
  element: string;
}

/** One row of partnerRows(): a digimon.json profile in the shape the codex and the glossary read. */
export interface CodexPartnerRow {
  id: number;
  name: string;
  added: boolean;
  hp: number;
  mp: number;
  family: number;
  is_starter: boolean;
  stats: { str: number; def: number; spt: number; wis: number; spd: number; chr: number; };
  resistances: { [k: string]: number; };
  resistanceGrowth: { [k: string]: number; };
  statusResist: { [k: string]: number; };
  signature: { id: number; name: string; power: number; element: string; } | null;
  blasts: string[];
  techSlots: number[];
  learnLevels: number[];
  loadLevels: number[];
}

/** One zone of a stage's encounter record: the screen ids its slots hold and the level its rate rolls at. */
export interface StageZone {
  slots?: (number | string)[];
  rate_level?: number;
}

/** One stage's encounter record: its zones, group-major (four zones per selector group). */
export interface StageEncounters {
  zones?: StageZone[];
  groups?: { blocks?: number[] }[];
}

/** A stage-encoding file: the stages by numeric key, as the codex and the boss list read it. */
export interface StageEncoding {
  stages?: Record<string, StageEncounters>;
}

/** The stages by numeric key (stage_encounters.json's `stages` object). */
export type StageTable = Record<string, StageEncounters>;

/** The enemy party of each screen id (field_encounters.json's `screens` map). */
export type ScreenTable = Record<string, FieldEncounterEnemy[]>;

/** stage_encounters.json: the file with its header key, or the stage table itself. */
export type StageSource = { stages?: StageTable } | StageTable;

/** field_encounters.json: the file with its header key, or the screen table itself. */
export type ScreenSource = { screens?: ScreenTable } | ScreenTable;

/** One map of web/assets/manifest.json: its id ("s<stage key>") and display name. */
export interface CodexMapEntry {
  id?: string;
  name?: string;
}

/** The manifest's map list inside the whole manifest object. */
export interface CodexMapManifest {
  maps?: CodexMapEntry[];
}

/** One real encounter roll: where it is, which screen it rolls and the enemy it holds. */
export interface EncounterRow {
  stage: number;
  stageName: string | null;
  zone: number;
  slot: number;
  screen: number;
  name: string;
  level: number;
  hp: number;
  statScale: number;
  rateLevel: number;
}

/** What encounterIndex() returns: every roll, and the same rolls by species name. */
export interface EncounterIndex {
  bySpecies: Map<string, EncounterRow[]>;
  rows: EncounterRow[];
}

/** One evolutions.json record: what a form needs. */
export interface EvolutionRecord {
  from?: string | number;
  to?: string | number;
  level?: number;
  stats?: Record<string, number>;
  dna?: (string | number)[];
  item?: string | number | null;
  time?: string | null;
  happiness?: number;
  mistakes?: number;
}

/** One digivolution line of evolutions.json: the starter it belongs to and its records. */
export interface EvolutionLine {
  digimonId?: string | number;
  records?: EvolutionRecord[];
}

/** evolutions.json: the lines (a bare array of lines is read too). */
export interface EvolutionLinesFile extends Array<EvolutionLine> {
  lines?: EvolutionLine[] | null;
}

/** The disc's drop odds: `n` in `of` per win. */
export interface DropOdds {
  n: number;
  of: number;
}

/** One enemy record that drops an item. */
export interface DropDropper {
  enemy: string;
  rate: number;
  odds: DropOdds;
}

/** One item's droppers and the stages they can be met on. */
export interface DropRecord {
  droppers: DropDropper[];
  stages: number[];
}

/** One item entry as the tab lists it. */
export interface DropEntry extends DropRecord {
  item: string;
}

/** dropIndex(): every dropped item with its droppers. */
export interface DropIndex {
  byItem: Map<string, DropRecord>;
}

/** One record of items.json: only its name is read here. */
export interface CodexItemRecord {
  name?: unknown;
}

/** items.json: `{catalog, items}` or a bare array. */
export type CodexItemsSource = CodexItemRecord[] | { catalog?: CodexItemRecord[]; items?: CodexItemRecord[] };
