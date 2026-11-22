import type { MpRow } from "./mp-match.js";

/** What kind of turn the result came from. */
export type MpResultKind = "atk" | "self" | "item" | "tag" | "dv" | "run";

export interface MpAttackResult {
  /** the acting fighter's key ("p0", "e1") */
  a: string;
  kind: MpResultKind;
  /** the text lines the fight report shows */
  lines: string[];
  /** [fighter key, damage, hit, went down] per line -- the private #row helper's own array */
  rows: MpRow[];
  /** the skill id, 0 when the turn used none */
  sk: number;
  /** relic/secondary result the rule returned, when it produced one */
  st?: string | number | null;
}

export interface MpTagResult {
  a: string;
  forced?: { key: string; forced: true; } | null;
  kind: MpResultKind;
  lines: string[];
  refused?: boolean;
  /** [fighter key, damage, hit, went down] per line -- the private #row helper's own array */
  rows: MpRow[];
  sk: number;
}

export interface MpRunResult {
  a: string;
  fled?: boolean;
  kind: MpResultKind;
  lines: string[];
  /** [fighter key, damage, hit, went down] per line -- the private #row helper's own array */
  rows: MpRow[];
  sk: number;
}

export interface MpEnemyAttackResult {
  a: string;
  fled?: boolean;
  kind: MpResultKind;
  lines: string[];
  /** [fighter key, damage, hit, went down] per line -- the private #row helper's own array */
  rows: MpRow[];
  sk: number;
}
