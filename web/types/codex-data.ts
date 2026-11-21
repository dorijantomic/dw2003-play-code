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
  digimonId: any;
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
  id?: number;
  name?: string;
  power?: number;
  element?: string;
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
