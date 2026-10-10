// The eight digivolution trees, and the one rule that unlocks from them.
//
// The disc's unlock routine is pro/stfgtrep.s file 0x369C-0x390C (RAM 0x8008634C).
// It is the ONLY thing in the game that hands the player a new form, so it is
// ported once here and every caller asks this rule instead of indexing the trees
// its own way.
//
//   tree choice   `sll $v0,$s4,0x2` / `addu $v0,$v1` / `lw $s7,($v0)` (file 0x36C8-0x36EC)
//                 — the line is picked by ROSTER SLOT from the eight pointers at
//                 0x8008903C, not by which form the member is in.
//   scan          `addiu $s3,0x10` (0x38C8) against `addiu $v0,$s7,0x2c0` (0x38CC) — that
//                 line's 44 records in TABLE ORDER, restarting at record 0 each call,
//                 and the routine RETURNS as soon as one passes: one acquisition per call.
//   already have  `bgez $v0` on the ledger read (0x3734) — a form already in the ledger is
//                 skipped, and `blez $s1` (0x373C) skips a record that grants nothing.
//   two gates     `addiu $s0,0x4` (0x37BC) with the loop bound at 2 (0x37B4) — the record
//                 holds exactly two (DigimonId, SkillLV) requirements; a 0 evo is no gate.
//   gate compare  `slt $v0,$v0,$v1` + `beqz` (0x37A0/0x385C) — the requirement is met when
//                 the ledger entry's form level is >= the required one.
//   kind          0 none | 1..6 str,def,spt,wis,spd,chr (0x3800: `lh 0x26(stats+2*kind)`)
//                 | 7 the line's own battle level (0x3818: `lh 0x1c`)
//                 | 8..14 the seven elements (0x3850: `lh 0x24(stats+2*kind)`), all
//                 compared >= `threshold` at +0x0E.
//
// Equipping the new form is a separate concern and lives with the rest of the
// equip-slot handling; this rule only says which form this line learns next.

/** One 0x10-byte row of a line's table, as the routine reads it. */
export interface EvoTreeRecord {
  /** DigimonId the row grants (the 1-based species-table row). */
  to: number;
  /** Requirement 0: a DigimonId, 0 = no gate, and the form level it needs. */
  req0: number;
  req0Level: number;
  /** Requirement 1 — the same pair, tested by the routine's second pass. */
  req1: number;
  req1Level: number;
  /** 0 none | 1..6 str,def,spt,wis,spd,chr | 7 the line's own level | 8..14 elements. */
  kind: number;
  threshold: number;
}

export interface EvoTreeLine {
  slot: number;
  digimonId: number;
  records: EvoTreeRecord[];
}

export interface EvoTrees {
  lines: EvoTreeLine[];
}

export interface EvoTreeStats {
  stats?: Record<string, number>;
  bonuses?: Record<string, number>;
  elemBonuses?: Record<string, number>;
}

export interface EvoTreeState {
  /** DigimonId -> that ledger entry's form level (SkillLV). */
  formLevels?: Record<number, number>;
  /** The line's own battle level (kind 7). */
  level?: number;
  stats?: EvoTreeStats;
}

export interface EvoTreeHit {
  record: EvoTreeRecord;
  index: number;
}

/** pro/stfgtrep loads here, so a tree pointer is a RAM address in this overlay. */
export const EVO_TREE_LOAD_BASE = 0x80082cb0;
/** `lui $v1,0x8009` / `addiu $v1,-0x6fc4` (file 0x36C0-0x36C4): one pointer per roster slot. */
export const EVO_TREE_GROUP_TABLE = 0x8008903c;
export const EVO_TREE_LINE_COUNT = 8;
export const EVO_TREE_RECORD_SIZE = 0x10;
export const EVO_TREE_GROUP_BYTES = 0x2c0;
export const EVO_TREE_RECORD_COUNT = EVO_TREE_GROUP_BYTES / EVO_TREE_RECORD_SIZE;

/** Kinds 1..6 index this list (0x3800 reads `stats + 0x26 + 2*kind`, so kind 1 is index 0). */
export const EVO_TREE_COMBAT_STATS = ["str", "def", "spt", "wis", "spd", "chr"] as const;
/** Kinds 8..14 index this list (`stats + 0x24 + 2*kind`). */
export const EVO_TREE_ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"] as const;

/** A human name for a record's kind, for a comment or a test. null = no gate. */
export function evoTreeKindName(kind: number): string | null {
  if (kind === 0) return null;
  if (kind === 7) return "line_level";
  if (kind >= 1 && kind <= 6) return EVO_TREE_COMBAT_STATS[kind - 1] ?? null;
  if (kind >= 8 && kind <= 14) return EVO_TREE_ELEMENTS[kind - 8] ?? null;
  return null;
}

// The eight lines out of the disc's own overlay image, in roster-slot order.
// `to`, `req0` and `req1` are DigimonIds: the 1-based rows of the 55-row species
// table, which is the same order as web/assets/data/digimon.json.
export function readEvoTreeLines(overlay: Uint8Array, loadBase = EVO_TREE_LOAD_BASE): EvoTreeLine[] {
  const dv = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const lines: EvoTreeLine[] = [];
  for (let slot = 0; slot < EVO_TREE_LINE_COUNT; slot++) {
    const group = dv.getUint32(EVO_TREE_GROUP_TABLE - loadBase + 4 * slot, true);
    const start = group - loadBase;
    const records = [];
    for (let i = 0; i < EVO_TREE_RECORD_COUNT; i++) {
      const at = start + EVO_TREE_RECORD_SIZE * i;
      records.push({
        to: dv.getUint32(at, true),
        req0: dv.getUint16(at + 4, true),
        req0Level: dv.getInt16(at + 6, true),
        req1: dv.getUint16(at + 8, true),
        req1Level: dv.getInt16(at + 10, true),
        kind: dv.getInt16(at + 12, true),
        threshold: dv.getInt16(at + 14, true),
      });
    }
    lines.push({ slot, digimonId: slot + 1, records });
  }
  return lines;
}

/** The record list for one roster slot, or null when the slot has no tree. */
export function evoTreeRecords(trees: EvoTrees | null | undefined, slot: number): EvoTreeRecord[] | null {
  const line = trees?.lines?.[slot];
  return Array.isArray(line?.records) ? line.records : null;
}

/**
 * The line's own state, as the rule needs it. Any of it may be missing, which
 * reads as "no progress" — the routine would then find the gate unmet.
 *   formLevels DigimonId -> that ledger entry's form level (SkillLV). A key in this
 *                map IS the form being in the ledger, which is the routine's
 *                `bgez` test at file 0x3734.
 *   level      the line's own battle level (kind 7)
 *   stats      { stats, bonuses, elemBonuses } for kinds 1..6 and 8..14
 */
function evoTreeContext(ctx: EvoTreeState) {
  const formLevels = ctx?.formLevels ?? {};
  const stats = ctx?.stats ?? {};
  const combat = (stat: string): boolean =>
    (EVO_TREE_COMBAT_STATS as readonly string[]).includes(stat);
  return {
    hasForm: (id: number): boolean => formLevels[id] != null,
    formLevel: (id: number): number => Number(formLevels[id] ?? 0),
    statValue: (stat: string): number => {
      if (stat === "line_level") return Number(ctx?.level ?? 1);
      const isCombat = combat(stat);
      const base = isCombat ? Number(stats.stats?.[stat] ?? 0) : 0;
      return base + Number(stats[isCombat ? "bonuses" : "elemBonuses"]?.[stat] ?? 0);
    },
  };
}

// One record's gates, exactly as the routine tests them. Returns false as soon as
// a gate fails; the routine drops the record on the first failure too (it sets
// $s1 to -1 and skips the rest of the record's checks).
function evoTreeRecordPasses(
  record: EvoTreeRecord,
  ctx: ReturnType<typeof evoTreeContext>,
): boolean {
  // Both requirements: 0 evo is no gate; otherwise the form must be in the ledger
  // AND its form level must be at least the required one.
  const gates: Array<[number, number]> = [[record.req0, record.req0Level], [record.req1, record.req1Level]];
  for (const [evo, need] of gates) {
    if (!evo) continue;
    if (!ctx.hasForm(evo)) return false;
    if (ctx.formLevel(evo) < need) return false;
  }
  const stat = evoTreeKindName(record.kind);
  if (stat && ctx.statValue(stat) < record.threshold) return false;
  return true;
}

/**
 * The next form this line learns, or null. One acquisition per call: the first
 * record in table order that is not already acquired and whose gates are all met.
 */
export function firstUnlockedTreeRecord(
  trees: EvoTrees | null | undefined, slot: number, ctx: EvoTreeState,
): EvoTreeHit | null {
  const records = evoTreeRecords(trees, slot);
  if (!records) return null;
  const inner = evoTreeContext(ctx);
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (!record.to || record.to <= 0) continue;   // blez $s1 (file 0x373C)
    if (inner.hasForm(record.to)) continue;      // bgez $v0 (file 0x3734)
    if (!evoTreeRecordPasses(record, inner)) continue;
    return { record, index: i };
  }
  return null;
}

/**
 * Every record in this line that the routine's gates would pass, in table order,
 * excluding forms already acquired. This is the candidate list the Digivolve
 * menus read; each entry is still one acquisition away.
 */
export function unlockedTreeRecords(
  trees: EvoTrees | null | undefined, slot: number, ctx: EvoTreeState,
): EvoTreeHit[] {
  const records = evoTreeRecords(trees, slot);
  if (!records) return [];
  const inner = evoTreeContext(ctx);
  const out: EvoTreeHit[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (!record.to || record.to <= 0) continue;
    if (inner.hasForm(record.to)) continue;
    if (!evoTreeRecordPasses(record, inner)) continue;
    out.push({ record, index: i });
  }
  return out;
}