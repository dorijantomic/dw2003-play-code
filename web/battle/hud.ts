import {
  partyIconCel as enginePartyIconCel,
  partyIconIndex as enginePartyIconIndex,
  enemyStatsIndex,
  ui,
} from "../vendor/engine.js";
import { enemyMessageName, enemyDisplayName } from "../fusion.js";
import { battleHudNameBankSync, battleHudPlateLabels } from "../battlehud-translated.js";
import { S } from "./state.js";
import { ST } from "./messages.js";
import { battleKindOf } from "./form-blast.js";
import { BATTLE_UI_LAYOUT } from "../battle.js";
import { DV_GAUGE_MAX, normalizeDvGauge } from "./layout.js";

/**
 * The pgfgc00 cel each party pip must draw, straight from the decoded HUD rule
 * (FIGHTSTG_F0x800934f0): the pip picture IS the member's state — cel 0xC+state
 * for the side's active slot, 0x3C+state otherwise. `null` = no member there.
 */
export function partyPipCels(b) {
  const records = b?.playerRecords ?? [];
  const active = b?.activePlayerIndex ?? 0;
  const player = [];
  for (let i = 0; i < 3; i++) {
    const rec = records[i];
    player.push(rec ? enginePartyIconCel(enginePartyIconIndex(rec), i === active) : null);
  }
  const enemy = b?.enemy
    ? enginePartyIconCel(enginePartyIconIndex({ hp: b.enemy.hp, maxHp: b.enemy.maxHp, ailments: b.enemy.ailments }), true)
    : null;
  return { enemy, player };
}

/**
 * The plate's two names and the slash between the HP numbers, through the ported
 * block (FIGHTSTG_F0x80093a74's build arm and F0x80093364).
 *
 * The original builds once per plate and rebuilds a name only when that side's active
 * fighter moves, so this is keyed the same way and the ported build does not run on a
 * frame where nothing changed.
 *
 * `playerName` is the roster member's own stored name — the walker keeps the nickname
 * in `playerRoster[i].name` and falls back to the rookie's species name, which is what
 * the roster record holds. `enemyNameId` is bank 0x4e's line for the enemy, the
 * `+0x06` halfword of that enemy's record in resource `0x1cf`
 * (`web/assets/data/battlecmd/enemy_stats.json`). When the enemy is not in that table
 * the id stays null and the port takes the original's null-record path: the element is
 * still created, the text is left empty, and the walker draws its own species name.
 */
let hudLabelsCache = null;

/** The leading `u16` of record `index` — the word F0x8009b864's scan matches. */
function enemyStatReadId(index) {
  const r = S.enemyStatRecords?.[index];
  return r ? (r.id & 0xffff) : 0;
}

/** The original's id→record scan over the decoded table. Returns the index, or -1. */
function enemyStatIndexForName(name) {
  if (!S.enemyStatRecords || !S.enemyStatIdByName) return -1;
  const id = S.enemyStatIdByName[String(name ?? "")];
  if (id == null) return -1;
  return enemyStatsIndex(enemyStatReadId, id);
}

/**
 * The enemy stat record for an enemies.json name, resolved through the original's scan
 * (FIGHTSTG_F0x8009b864/F0x8009b8d0) rather than a name-keyed object map. Returns null
 * when the name has no runtime id or the scan misses, exactly as the resolver returns 0.
 */
export function enemyStatRecordFor(name) {
  const i = enemyStatIndexForName(name);
  return i >= 0 ? S.enemyStatRecords[i] : null;
}

/** Enemy name for battle messages: the disc name line the HUD plate reads (see fusion.js). */
export function enemyMsgName(en, fallback = "Enemy") {
  const record = enemyStatRecordFor(en?.eStats?.enemy_id ?? en?.profile?.name ?? "");
  return enemyMessageName(en, record, battleHudNameBankSync(), fallback);
}

export function battleHudPlateLabelsFor(b) {
  const activePlayerIndex = b.activePlayerIndex ?? 0;
  const activeEnemyIndex = b.enemySlot ?? 0;
  const playerName = String(b.playerRoster?.[activePlayerIndex]?.name ?? b.player?.profile?.name ?? "");
  const enemyKey = String(b.enemy?.eStats?.enemy_id ?? b.enemy?.profile?.name ?? "");
  // NEW content (F2 -> Extras -> "Fusion bosses"): a record with an authored display name
  // (the fused body is still Kimeramon) short-circuits the original's name line, so the
  // plate says Millenniummon instead of the species it is drawn as.
  const enemyName = enemyDisplayName(b.enemy);
  // The original's numeric enemy id is the word at 0x80042b1c + slot*0xc + 0x18, which
  // FIGHTSTG_F0x8009b8d0 scans the record table for; the record it finds carries the
  // name line at +0x06, so the plate's enemy name comes out of the original's own table
  // rather than the walker's species string.
  const enemyRow = b.enemy?.displayName != null ? null : enemyStatRecordFor(enemyKey);
  const enemyNameId = enemyRow?.nameId ?? null;
  const enemyId = enemyRow?.id ?? 0;
  const key = `${activePlayerIndex}|${activeEnemyIndex}|${playerName}|${enemyName}|${enemyNameId}`;
  if (hudLabelsCache?.key !== key) {
    hudLabelsCache = {
      key,
      labels: battleHudPlateLabels({
        activePlayerIndex, activeEnemyIndex, playerName, enemyName, enemyNameId, enemyId,
      }),
    };
  }
  return hudLabelsCache.labels;
}

/**
 * Whether the battle's command phase is still waiting for a message line to be read.
 *
 * This is the original's battle controller (`wfightmn`), which runs a table of three-step
 * script instructions keyed on the record's own `+0x14`. "Wait for the line, then open the
 * command menu" is ONE instruction (0x800A7418, file 0x1638), and its very first act is to
 * read the owner's message-line slot and return while it is occupied:
 *
 * ```
 * wfightmn.s:1494  .L0x0000173c: lw    $v0, 0x1c($s2)     # the owner's line slot
 * wfightmn.s:1496  .L0x00001744: bnez  $v0, .L0x000019b4  # -> this routine's epilogue: return
 * ```
 *
 * `0x19B4` is the epilogue (`wfightmn.s:1652` `lw $ra, 0x24($sp)`), so while the line is up
 * the instruction arms nothing and does not step on. Only once the slot reads 0 does it fall
 * through to the arming, `jal 0x80092d80` with the literal 2 in the delay slot
 * (`wfightmn.s:1552-1556`), which sets the command sequencer's `+0x10` = 2; the menu actor
 * itself is built one object step later, in the sequencer's own step routine
 * (`fightstg.s:16118-16130`, the creation `jal F0x80093f9c` at `:16144`). The same wait sits
 * in the other battle script's dispatch entry, `wfightmn.s:1303-1305`.
 *
 * So in the original the command menu is never built beside a waiting line: the phase is not
 * armed and there is nothing to read the pad. `line` is the walker message line ({active,
 * finished} -- the translated `FIGHTSTG_F0x80098a84` panel, which draws only while it is up
 * and waits for Circle with no timeout); `state` the battle phase. The two phases that can
 * hold an unread line in front of the command menu are the intro (the opening "Ambush!", put
 * up by the instruction at `wfightmn.s:1472-1493`) and the command phase itself (the walker's
 * own "No techs!"/"No items!" lines, `web/battle.js` confirmCommand). The timed action phases
 * are held by `msgHoldsTurn` instead.
 */
export function commandPhaseWaitsForLine(line, state) {
  if (!line?.active || line.finished) return false;
  return state === ST.INTRO || state === ST.PLAYER_MENU;
}

// A fighter stands in the low-HP stance while its HP is at or below a quarter of its maximum.
// Decoded from the battle menu overlay: it divides max HP by four (truncating) and compares the HP
// the fighter will have after the pending change, then tells the fight stage to latch that
// fighter's resting pose to the hurt one (1) or the normal one (0). Applies to both sides.
// See docs/research/fight-3d/original-fight-engine.md.
export function lowHpStance(c) {
  const max = Number(c?.maxHp ?? 0), hp = Number(c?.hp ?? 0);
  return max > 0 && hp > 0 && hp <= Math.trunc(max / 4);
}

// The flag WFIGHTMN_F0x800aa9f0 latches into the anim object's base-table field (+0x18) — which
// resting pose a fighter plays. The routine's own kind-6 branch (wfightmn.s:4875-4946, file
// 0x4c10) replaces the HP test for ONE fighter: arena slot 0x10 — the enemy — while the battle
// kind word (+0xD6) is 6 takes the battle's weakened byte (+0xDB) as the flag, so the finale's
// head stands in the hurt stance from the moment the third landed hit weakens it, whatever its
// HP; every other fighter and phase keeps the quarter-HP rule. Claims
// wfightmn-endweakness-and-weaken-chain-2026-10-10 (verified), BATTLE-C009,
// low-hp-resting-stance-threshold-2026-08-19.
export function fighterBaseStance(b, side) {
  if (side === "enemy" && battleKindOf(b) === 6) return !!b?._bossPhaseDone;
  return lowHpStance(side === "enemy" ? b?.enemy : b?.player);
}

// The in-fight HP bar, decoded from the 3D battle's HUD draw (FIGHTSTG_F0x800934f0).
// Length is HP*128/maxHP in 128ths of the full bar, and a Digimon that is still standing never
// shows less than 3/128 however little HP is left. The colour is chosen with the SAME quarter-HP
// test as the resting pose: green above a quarter of maximum HP, red at or below it. Each state is
// a two-colour gradient read from a table in the fight stage's own data at 0x800a3490.
export const HP_BAR_COLORS = Object.freeze({
  healthy: Object.freeze(["#007128", "#00c83e"]),
  low: Object.freeze(["#b33716", "#ff370d"]),
});

/**
 * The rate the walker's own `_hudClock` is read at for the parts of the plate that
 * count a free-running tick rather than a drain: the Blast gauge's four-phase cel
 * and the command cursor's blink. It stands in for `[0x8004df98]()`
 * (F0x8001D6F4, the tick), which the engine's `frameTick()` publishes for a whole
 * displayed frame — this HUD draws inside the battle's own 2D pass, which the
 * translated message line drives per displayed frame. The HP bar's drain does NOT
 * use it: that is the plate's own poll, in engine/dw3/ui/native/battle-hp-plate.ts.
 */
export const HUD_CLOCK_HZ = 30;

// The plate's drain rule (FIGHTSTG_F0x80093108's 8-frame poll and
// FIGHTSTG_F0x8009328c's 30-frame sine tween) lives in the engine next to the rest of
// the battle HUD's ports; web/battle.js only supplies the live members and the
// displayed frame's delta.
export const { createHpPlateState, hpPlateShown, hpPlateTick } = ui;

/** Bar length in 128ths of the full bar. @returns {number} */
export function hpBarLength(cur, max) {
  const hp = Number(cur ?? 0), maxHp = Number(max ?? 0);
  if (maxHp <= 0) return 0;
  if (hp <= 0) return 0;
  const len = Math.trunc(Math.min(hp, maxHp) * 128 / maxHp);
  return len < 4 ? 3 : len;
}

/**
 * F0x800934f0 HP-fill quad. Partner grows right from 0xAF; enemy shrinks left
 * from 0x8F. @returns {{x:number,y:number,w:number,h:number}}
 */
export function hpBarFillRect(side, cur, max) {
  const len = hpBarLength(cur, max);
  const B = BATTLE_UI_LAYOUT.hpBar;
  if (side === "enemy") return { x: B.enemyRight - len, y: B.y, w: len, h: B.h };
  return { x: B.playerLeft, y: B.y, w: len, h: B.h };
}

/** The two gradient stops the bar is drawn with. @returns {readonly string[]} */
export function hpBarColors(cur, max) {
  return lowHpStance({ hp: cur, maxHp: max }) || Number(cur ?? 0) <= 0
    ? HP_BAR_COLORS.low : HP_BAR_COLORS.healthy;
}

/**
 * FIGHTSTG_F0x800934f0 DV fill: gauge/100 levels while below 1000, a separate
 * full state at 1000. Returns 0..10 tenths of the bar.
 */
export function dvGaugeLength(gauge) {
  const g = normalizeDvGauge(gauge);
  return g >= DV_GAUGE_MAX ? 10 : Math.trunc(g / 100);
}

// The gauge fill's authored sprite (FIGHTSTG_F0x800934F0, decoded): while the
// gauge is below 1000 the four-tick cycle selects sprites 0x33..0x36; at full it
// selects 0x37..0x3A. The frames are 40x8 in the pgfgc00 pack (cels 51-58). The
// draw lands at (0x109, 0x3E) and its width is gauge/25 pixels, i.e. 0..40.
export const DV_GAUGE_ANCHOR = Object.freeze({ x: 0x109, y: 0x3e, w: 40, h: 8 });

export function dvGaugeCel(gauge, phase) {
  const g = normalizeDvGauge(gauge);
  const p = ((Math.trunc(phase) || 0) % 4 + 4) % 4;
  return (g >= DV_GAUGE_MAX ? 0x37 : 0x33) + p;
}

export function dvGaugeWidth(gauge) {
  return Math.trunc(normalizeDvGauge(gauge) / 25);
}
