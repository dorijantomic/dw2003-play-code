// The enemy's own tag: the pure rules of the original's enemy turn, src/battle/battle_mode/enemy_turn.c.
//   FIGHTSTG_getEnemyAction   :438-470   table action kinds 5..8 are the targets -2..-5
//   FIGHTSTG_pickEnemySwitch  :9-62      which team member comes in (-1 = none)
//   switchEnemyOut            :150-166   the page for the pick (esmfight 0x4D, kind 1) or the failure (0x8E, kind 2)
//   updateEnemyTurn substates :270-297   5: entrance(id, side 1, 0) after the page; 6: wait done; 4: name page (kind 0xD)
//   normal_battle/menu.c      :1088-1096 the next enemy after a KO: the lowest slot with an id and hp
// The game's enemy team is its boss party (web/battle.js b.party): slot i is party[i], three slots at most.

/** esmfight 0x4D, kind 1 (enemy_turn.c:157-160; fightstg.s:6153 "Taking out Digimon!"). */
export const ENEMY_SWITCH_MSG_TAKING_OUT = 0x4d;
/** esmfight 0x8E, kind 2 (enemy_turn.c:163-166): "Switch failed!". */
export const ENEMY_SWITCH_MSG_FAILED = 0x8e;
/**
 * The frame, in the side 0x10 entrance's own count, where the entering enemy's name page (kind 0xD, enemy_turn.c
 * showEnemyName) is made: the entrance commits at f114 (entrance.c, `done`); the turn task sees `done` in substate 6
 * and sets substate 4 (enemy_turn.c:279-286), which makes the page on its next update. Not proven: whether the turn
 * task updates before or after the entrance task inside one frame (this is the earliest, f114 + 1).
 */
export const ENEMY_SELFTAG_NAME_FRAME = 115;

/** Table action kind -> EnemyTurn.target (enemy_turn.c:456-466): 5 -> -2 (slot 0), 6 -> -3, 7 -> -4, 8 -> -5 (random other). */
export function enemySwitchTarget(kind) {
  const k = kind | 0;
  return k >= 5 && k <= 8 ? -(k - 3) : 0;
}

/**
 * FIGHTSTG_pickEnemySwitch (enemy_turn.c:9-62). `slots` = the three team records {id, hp} (a missing slot is id 0, hp 0),
 * `active` the active slot, `target` -2..-5, `rand` = RANDOM.next. Returns the slot to switch to, or -1.
 *   -2/-3/-4: slot 0/1/2, unless its id equals the active slot's id (:17,:25,:33 break), when it has hp;
 *   else (-5): the slots != active with id != 0 and hp != 0; none -> -1, one -> it, two -> found[rand() & 1].
 */
export function pickEnemySwitch(slots, active, target, rand) {
  const at = (i) => slots?.[i] ?? { id: 0, hp: 0 };
  const named = target === -2 ? 0 : target === -3 ? 1 : target === -4 ? 2 : -1;
  if (named >= 0) {
    if (at(named).id === at(active).id) return -1;
    return at(named).hp !== 0 ? named : -1;
  }
  const found = [];
  for (let i = 0; i < 3; i++) {
    if (active !== i && at(i).id !== 0 && at(i).hp !== 0) found.push(i);
  }
  if (found.length === 1) return found[0];
  if (found.length === 2) return found[rand() & 1];
  return -1;
}

/**
 * The enemy's whole self-tag decision once the table row is chosen: null when the row is not a switch (kinds 5..8),
 * else the slot to switch to or -1 ("Switch failed!"). One call = the original's one pickEnemySwitch.
 */
export function enemySelfTagPick(move, slots, active, rand) {
  const target = enemySwitchTarget(move?.action);
  if (target === 0) return null;
  return pickEnemySwitch(slots, active, target, rand);
}

/** The slot the next enemy comes from after a KO (menu.c:1088-1096): the lowest with an id and hp, -1 for none. */
export function firstAliveEnemySlot(slots) {
  for (let i = 0; i < 3; i++) {
    if ((slots?.[i]?.id ?? 0) !== 0 && (slots[i].hp ?? 0) !== 0) return i;
  }
  return -1;
}

/**
 * Team records ({profile: {id}, hp} or null) -> the slot list the rules read: {id, hp}, plus `speciesId` for
 * condition 10 (engine enemyMoveCondition's enemySlots). Three slots at most.
 */
export function enemyTeamSlots(records) {
  const out = [];
  for (let i = 0; i < Math.min(3, records?.length ?? 0); i++) {
    const rec = records[i];
    // an enemies.json profile carries no id: the record keeps the disc id as speciesId (battle.js buildEnemyRecord)
    const id = rec ? (Number(rec.profile?.id) || Number(rec.speciesId) || 0) : 0;
    out.push({ id, speciesId: id, hp: rec ? Math.max(0, rec.hp | 0) : 0 });
  }
  return out;
}
