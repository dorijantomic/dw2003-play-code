// web/fusion.js — the fusion-boss rules: two real species blended into one fighter.
//
// NEW content, not original-game behaviour. The fan lore it stands on (Kimeramon +
// Machinedramon = Millenniummon) is ours to add; every game number it reads is a real
// enemy row, a real encounter screen or a real technique row, and the authored intent
// lives in data/authored/fusion_bosses.json + fusion_skills.json, built by
// tools/build_fusion_bosses.py into web/fusion_bosses.json.
//
// The module is pure so the battle (web/battle.js) and the later fusion roulette share
// one arithmetic. Nothing here is on unless F2 -> Extras -> "Fusion bosses" is ticked
// (key `fusionbosses`, off by default): web/battle.js asks fusionEnabled() before it
// merges the authored skill, keeps a party entry's `fuseInto`, or tints a fighter.

import type { FusionDefeatArgs } from "./battle/core/types.js";
import type { BattleSkill } from "./types/battle.js";

import type { EnemyBattleRecord } from "./types/battle.js";
import type { FusionBoss } from "./battle/core/types.js";
import type { FusedRecordArgs, FusionBossLookup, FusionBossRef, FusionPartyEntry, FusionSkillRow, FusionStatKey, FusionStatRow, LabBossCandidate } from "./types/rest-a.js";
/** The five primary stats every blend covers. */
export const FUSION_STATS: readonly FusionStatKey[] = Object.freeze(["str", "def", "spt", "wis", "spd"]);

/** Is the fusion layer switched on? (F2 -> Extras -> Fusion bosses, off by default.) */
export function fusionEnabled() {
  return typeof window !== "undefined" && window.__fx?.fusionbosses === true;
}

/**
 * One blended number: `round(max + 0.25 * secondLargest)`. With two values this is the
 * original `max + 0.25 * min` rule exactly; a third or fourth donor adds nothing more, so
 * a long recipe cannot pile stat on stat. A single value is returned as it is.
 */
export function blendValues(values: readonly (number | string | null | undefined)[] | null | undefined) {
  const v = (Array.isArray(values) ? values : []).map((x) => Number(x ?? 0) || 0).sort((p, q) => q - p);
  return Math.round((v[0] ?? 0) + 0.25 * (v[1] ?? 0));
}

/**
 * The blended primary stats: each stat is `round(max + 0.25 * second largest)` over every
 * row given. `blendStats(a, b)` and `blendStats([a, b, c, ...])` both work.
 *
 * Our own rule (new content): the biggest part dominates, the next one still adds a
 * quarter of itself, so neither half's weakness survives the fusion. The rows are enemy
 * stat rows (enemies.json) or anything else carrying the five keys.
 */
export function blendStats(...rows: FusionStatRow[] | [FusionStatRow[]]) {
  const list = Array.isArray(rows[0]) ? rows[0] : rows;
  const out: Record<string, number> = {};
  for (const key of FUSION_STATS) out[key] = blendValues(list.map((r) => r?.[key]));
  return out;
}

/**
 * The MP the walker's own enemy formula gives a stat row at a level: the same
 * `max(10, round(spt * 1.5 + level * 3))` web/battle.js's enemyMp uses. Kept here so the
 * fused record needs no battle closure.
 */
function enemyMpFor(row: FusionStatRow | null | undefined, level: number) {
  const spt = Number(row?.spt ?? 0) || 0;
  const lv = Number(level ?? 1) || 1;
  return Math.max(10, Math.round(spt * 1.5 + lv * 3));
}

/**
 * The fused AI rows: the body half's own four conditions, with the LAST row that used
 * the first technique (`action` 2 = move_1 in FIGHTSTG_F0x80089148) promoted to the
 * second technique (`action` 3 = move_2). That is what puts the new move_2 — Time
 * Unlimited — into the picker at all: an action-3 row must exist or the technique can
 * never fire. A row set with no action-2 row gets its third row promoted instead.
 */
export function fusedAiMoves(rows) {
  const src = Array.isArray(rows) && rows.length
    ? rows.map((r) => ({ ...(r ?? {}) }))
    : [
      { action: 1, comparator: 0, value: 0 },
      { action: 2, comparator: 0, value: 0 },
      { action: 3, comparator: 0, value: 0 },
      { action: 1, comparator: 0, value: 0 },
    ];
  let at = -1;
  for (let i = Math.min(3, src.length - 1); i >= 0; i--) {
    if ((src[i].action | 0) === 2) { at = i; break; }
  }
  if (at < 0) at = Math.min(2, src.length - 1);
  src[at] = { ...src[at], action: 3 };
  return src;
}

/**
 * AI rows for a fusion whose technique slots were refilled from several donors (Fusion
 * Lab bosses). The body's own rows stay as they are; every filled slot (`move_1`, `move_2`)
 * that no row calls gets one, by changing the action of the LAST row whose action is used
 * more than once (a row keeps its own condition). Nothing changes when every filled slot
 * is already called, so a fusion that keeps its body's kit keeps its body's AI exactly.
 */
export function ensureAiRows(rows, moves: number[] = []) {
  const src = Array.isArray(rows) && rows.length
    ? rows.map((r) => ({ ...(r ?? {}) }))
    : fusedAiMoves(null);
  const [, move1 = 0, move2 = 0] = moves;
  for (const [action, id] of [[2, move1], [3, move2]]) {
    if (!(Number(id) > 0) || src.some((r) => (r.action | 0) === action)) continue;
    for (let i = src.length - 1; i >= 0; i--) {
      const a = src[i].action | 0;
      if (src.filter((r) => (r.action | 0) === a).length > 1) { src[i] = { ...src[i], action }; break; }
    }
  }
  return src;
}

/**
 * One fused combat record, from the halves' real stat rows and the authored boss spec.
 *
 *   halves     [bodyRow, otherRow, ...] — enemies.json rows, body first (a Fusion Lab boss may list more)
 *   body       the species the fused body is drawn as (the model swap)
 *   level      the fused level (authored)
 *   hp         the authored HP — the two encounter screens' HP added by the build script
 *   statScale  the boss screen's own stat scale + the authored delta (18 = 16 + 2)
 *   moves      [attack, move_1, move_2] — the real two-hit Fight, Dark Elemental and
 *              the authored Time Unlimited
 *   aiFill     Fusion Lab bosses: keep the body's AI rows and only add a row for each
 *              technique slot that was refilled (ensureAiRows), instead of the authored
 *              promotion of one row to move_2
 *
 * Every primary stat is the blend times statScale/16, rounded — the same +0x0a/16
 * multiplier FIGHTSTG_F0x8009ec94 applies to an enemy row. Nothing is a full heal: the
 * record's HP is the authored number, not a player's maximum.
 */
export function fusedRecord({ halves = [], body = null, level = 1, hp = 0, statScale = 16, moves = [], aiFill = false }: FusedRecordArgs = {}) {
  const a = halves[0];
  const blend = blendStats(halves);
  const scale = Math.max(1, Number(statScale) || 16);
  const stats: Record<string, number> = {};
  for (const key of FUSION_STATS) stats[key] = Math.round((blend[key] * scale) / 16);
  const [attack = 0, move1 = 0, move2 = 0] = moves;
  const mp = blendValues(halves.map((row) => enemyMpFor(row, level)));
  const maxHp = Math.max(0, Number(hp) || 0);
  return {
    body: body ?? null,
    level: Number(level) || 1,
    hp: maxHp, maxHp,
    mp, maxMp: mp,
    statScale: scale,
    stats,
    attack: Number(attack) || 0,
    move_1: Number(move1) || 0,
    move_2: Number(move2) || 0,
    ai_moves: aiFill ? ensureAiRows(a?.ai_moves, moves) : fusedAiMoves(a?.ai_moves),
  };
}

/**
 * The party entries the battle starts with, as web/battle.js hands them over.
 *
 * An ordinary entry comes back as the same object — byte-identical to today. An authored
 * entry (one carrying `displayName` and/or `fuseInto`) is copied so the battle can clear
 * `fuseInto` once the fusion has happened without touching the caller's data. With
 * `fxOn` false (F2 -> Extras -> Fusion bosses off) both fields are dropped: no party
 * entry may carry a fusion into a battle the player did not switch on.
 */
export function partyEntriesFor(party: FusionPartyEntry[] | null | undefined, fxOn = true): FusionPartyEntry[] {
  if (!Array.isArray(party)) return [];
  return party.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const authored = entry.displayName != null || entry.fuseInto != null;
    if (!authored) return entry;
    if (fxOn) return { ...entry };
    const { displayName, fuseInto, ...rest } = entry;
    return rest;
  });
}

/**
 * Resolve a party entry's `fuseInto` to the boss record it names.
 *
 * `fuseInto` is either the built boss record itself (what the authored data holds) or
 * its id, resolved through the built table (`bosses.bosses` or the bosses object).
 * Returns null when nothing real is named.
 */
export function fusionBossFor(fuseInto: FusionBossRef | null | undefined, bosses: FusionBossLookup | null = null): FusionBoss | null {
  if (!fuseInto) return null;
  if (typeof fuseInto === "object") return Number(fuseInto.hp) > 0 ? fuseInto : null;
  const table = bosses?.bosses ?? bosses ?? null;
  const row = table?.[String(fuseInto)] ?? null;
  return row && Number(row.hp) > 0 ? row : null;
}

/**
 * Does the body that just fell fuse? Only the LAST member of the party may carry
 * `fuseInto`, and only with the switch on — a fallen first half or a middle member never
 * fuses, so a three-member party still ends on its own last body.
 *
 * Returns `{ fuse: false }`, or `{ fuse: true, hp, boss }` with the authored record.
 */
export function fusionOnDefeat({ party, partyIndex = 0, fxOn = false, bosses = null }: FusionDefeatArgs = {}) {
  if (!fxOn || !Array.isArray(party) || !party.length) return { fuse: false };
  if (partyIndex !== party.length - 1) return { fuse: false };
  const boss = fusionBossFor(party[partyIndex]?.fuseInto, bosses!);
  if (!boss) return { fuse: false };
  return { fuse: true, hp: Number(boss.hp) || 0, boss };
}

/**
 * The name the battle shows for an enemy: the authored display name when a record has
 * one (the fused body is still drawn and stored as Kimeramon), else the species name the
 * enemy table carries, else the profile's own name.
 */
export function enemyDisplayName(en: EnemyBattleRecord) {
  return String(en?.displayName ?? en?.eStats?.digimon_id ?? en?.profile?.name ?? "");
}

/**
 * The name a battle MESSAGE prints for an enemy: the authored display name when the
 * record has one, else the disc's own name line (bank 0x4e line `record.nameId`, the
 * same line the HUD plate reads), else the enemy table's species key. The numbered
 * records (Goburimon2, Cardmon3, ...) carry the plain species line on the disc.
 */
export function enemyMessageName(en: EnemyBattleRecord, record: { nameId: number | null; }, nameBank: readonly (string | null)[] | null | undefined, fallback = "") {
  if (en?.displayName != null) return String(en.displayName);
  const line = record?.nameId == null ? null : nameBank?.[record.nameId | 0];
  if (typeof line === "string" && line !== "") return line;
  return String(en?.eStats?.digimon_id ?? en?.profile?.name ?? fallback);
}

/**
 * Merge the authored fusion skills into a skill map, only with the switch on.
 *
 * The map is returned untouched (the same object) when the switch is off or there is
 * nothing authored, so the battle's skill table is exactly today's. Keys stay the
 * technique ids the battle already indexes by.
 */
export function mergeFusionSkills(skillDB: { [k: string]: BattleSkill; }, skills: ArrayLike<FusionSkillRow> | { [s: string]: FusionSkillRow; }, fxOn = false) {
  if (!fxOn || !skills) return skillDB;
  const rows = Array.isArray(skills) ? skills : Object.values(skills);
  if (!rows.length) return skillDB;
  const out = { ...skillDB };
  for (const row of rows) {
    if (row && row.id != null) out[row.id] = { ...row };
  }
  return out;
}

// ── Fusion Lab bosses ─────────────────────────────────────────────────────────────────
// A fusion made on web/fusion-lab.html and saved as a favourite can be turned into a boss
// by tools/fusion_lab_server.py ("Make boss"). The record is written to
// web/assets/data/fusion_lab_bosses.json, a private, git-ignored file (the fused model and
// its numbers come from the disc). The game reads it only when the Fusion bosses switch is
// on and only if the file exists; the records join the authored ones and go through the
// same fusedRecord / fuseIntoBoss path.

/** A Fusion Lab model folder (m800lab1, m990fus1, ...): nothing else is ever fetched. */
export const LAB_MODEL_RE = /^m[0-9]{3}[a-z0-9_]+$/;

/** A Lab boss record as fusion_lab_bosses.json carries it: the fused body and its numbers. */
interface LabBossRecord extends FusionBoss { id: string }

/** Is this a usable Lab boss record? (Shape only; the numbers are the helper's.) */
export function labBossValid(rec: LabBossCandidate | null | undefined) {
  return !!rec && typeof rec === "object"
    && typeof rec.id === "string" && rec.id !== ""
    && Array.isArray(rec.halves) && rec.halves.length >= 1 && rec.halves.every((h: string | number) => typeof h === "string" && h !== "")
    && typeof rec.body === "string" && rec.body !== ""
    && typeof rec.modelFolder === "string" && LAB_MODEL_RE.test(rec.modelFolder)
    && Number(rec.hp) > 0 && Array.isArray(rec.moves) && rec.moves.length === 3;
}

/**
 * Add the Lab bosses to the authored table. An authored id is never replaced, a record
 * that is not valid is skipped. `table` is returned as it is when nothing is added.
 */
export function mergeLabBosses(table: Record<string, FusionBoss> | null | undefined, lab: { bosses: { [s: string]: LabBossRecord; } | ArrayLike<LabBossRecord>; }) {
  const rows = (lab?.bosses && typeof lab.bosses === "object" ? Object.values(lab.bosses) : []) as LabBossRecord[];
  const good = rows.filter(labBossValid);
  if (!good.length) return table;
  const out = { ...(table ?? {}) };
  for (const rec of good) if (!(rec.id in out)) out[rec.id] = { ...rec, aiFill: true };
  return out;
}

/**
 * The party a Lab boss is fought as: its body species first (as an ordinary encounter
 * entry, the strongest screen the disc has it on), carrying `fuseInto` the boss id, so
 * the existing rule "the last body falls, the fusion appears" does the rest.
 */
export function labBossParty(rec: LabBossCandidate | null | undefined) {
  const p = rec?.party ?? {};
  return [{
    name: rec?.body, id: p.id, level: p.level, hp: p.hp, mp: p.mp, stat_scale: p.stat_scale ?? 16,
    // a body with no enemies.json row (a partner form) is fought from its digimon.json profile, by id
    ...(p.digimonId != null ? { digimonId: p.digimonId } : {}),
    fuseInto: rec?.id,
  }];
}
