// Both halves' loot — a fusion carries what both halves carried (pure, no DOM).
//
// NEW content, not original-game behaviour. It rides F2 -> Extras -> "Fusion bosses"
// (key `fusionbosses`, off by default), the same switch that fuses Kimeramon and
// Machinedramon into Millenniummon (web/fusion.js, web/fusion_bosses.json).
//
// web/battle.js's defeatCurrentEnemy rolls every defeated enemy's own row. A fusion is
// two defeats in one fight: Kimeramon falls first and its row (DevilChip, rate 16) is
// rolled there, then fuseIntoBoss swaps in the fused record, which keeps Kimeramon's
// eStats. When that body falls the ordinary path would roll Kimeramon's row a SECOND
// time. So the fused body rolls the OTHER halves' real rows instead: Machinedramon's
// MetalPowerS (rate 32), and each distinct item only once, at the highest rate any
// other half carries it. The body's own item was already paid; it is never paid twice.
//
// The chance text follows the live roll the "Disc-accurate hit & drop rolls" switch
// (`discrolls`, off by default) selects — the same pair web/battle.js's rollDrop uses:
//   off -> Math.random() * 255 < rate        -> rate / 255
//   on  -> dropPasses: draw % 1024 < rate + 1 -> (rate + 1) / 1024
import { dropPasses } from "./tech-record.js";

/** A drop that can actually be banked: a name, not the table's "Null" placeholder. */
const isRealDrop = (item) => typeof item === "string" && item.length > 0 && item !== "Null";

/**
 * One enemies row by name. `enemies` is the battle's own `enemiesDB` (a name-keyed map,
 * built by web/battle.js from data/enemies.json); the raw parsed data file (`{enemies:
 * [...]}`) and a bare row array are accepted too, so a checker can hand over either.
 */
function rowFor(enemies, name) {
  if (!enemies || typeof name !== "string" || !name) return null;
  if (Array.isArray(enemies)) return enemies.find((row) => row?.enemy_id === name) ?? null;
  const direct = enemies[name];
  if (direct && typeof direct === "object") return direct;
  const list = enemies.enemies;
  if (Array.isArray(list)) return list.find((row) => row?.enemy_id === name) ?? null;
  if (list && typeof list === "object") return list[name] ?? null;
  return null;
}

/**
 * The real drops a fused body still owes, one row per DISTINCT item, in halves order.
 *
 * Every half equal to `body` is skipped: that is the half the fused record is drawn as,
 * and its own row was already rolled when that half fell. Halves the enemy table does
 * not know, and halves whose drop is "Null", contribute nothing. Two other halves that
 * carry the same item make one row at the larger rate.
 *
 * @param {string[]} halves  the boss's authored halves (enemies.json enemy_id names)
 * @param {string|null} body the species the fused body is drawn as
 * @param {object} enemies   enemiesDB (name -> enemies.json row)
 * @returns {{item: string, rate: number}[]}
 */
export function fusionDrops(halves, body, enemies) {
  const rows = [];
  const byItem = new Map();
  for (const name of Array.isArray(halves) ? halves : []) {
    if (name === body) continue;
    const row = rowFor(enemies, name);
    if (!row || !isRealDrop(row.drop_item)) continue;
    const rate = Math.max(0, Number(row.drop_rate) || 0);
    const seen = byItem.get(row.drop_item);
    if (seen) {
      seen.rate = Math.max(seen.rate, rate);
      continue;
    }
    const entry = { item: row.drop_item, rate };
    byItem.set(row.drop_item, entry);
    rows.push(entry);
  }
  return rows;
}

/**
 * The chance a row's roll passes, as text the pages can print.
 *
 * `disc` picks the arithmetic of the live roll: the float roll can pass at most every
 * time (rate 255+), the disc's own word at rate 1023+, so neither reads over 100%.
 */
export function dropChanceText(rate, disc = false) {
  const r = Math.max(0, Number(rate) || 0);
  const percent = disc
    ? (Math.min(r + 1, 1024) / 1024) * 100
    : (Math.min(r, 255) / 255) * 100;
  return `${percent.toFixed(1)}%`;
}

/** The fused body's loot, with the chance text for the switch that is on right now. */
export function fusionLootRows(halves, body, enemies, disc = false) {
  return fusionDrops(halves, body, enemies).map(({ item, rate }) => ({
    item,
    rate,
    chance: dropChanceText(rate, disc),
  }));
}

/**
 * Roll the fused body's loot. One live draw per row — the same single draw per enemy the
 * ordinary path spends — through the stream the switch selects:
 * `dropPasses(rate, rng)` (RAND_U16 words) with `disc`, else `rng() * 255 < rate`
 * (Math.random, today's roll). `rng` must be the matching source: pass RAND_U16 only
 * with `disc` true, Math.random only with it false.
 *
 * @returns {string[]} the item names that dropped, in row order
 */
export function rollFusionDrops(halves, body, enemies, rng, disc = false) {
  const dropped = [];
  for (const { item, rate } of fusionDrops(halves, body, enemies)) {
    const live = disc ? dropPasses(rate, rng) : rng() * 255 < rate;
    if (live) dropped.push(item);
  }
  return dropped;
}
