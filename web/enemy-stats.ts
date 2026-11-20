// web/enemy-stats.js -- the one rule for a wild enemy's five primary stats as it is fought. Pure.
//
// FIGHTSTG_F0x8009ec94 scales the resolved species stats (enemies.json str/def/spt/wis/spd) by the encounter member's
// stat_scale (descriptor +0x22, field_encounters.json) / 16; 16 is identity. web/battle.js buildEnemyRecord and the
// glossary (web/glossary-digimon.js) both call this, so the book shows the numbers the battle uses.
// Integer division toward zero (truncation), as the battle has always done; no lower clamp here.
export const scaleEnemyStat = (raw, statScale = 16) => Math.trunc((Number(raw ?? 1) * statScale) / 16);
