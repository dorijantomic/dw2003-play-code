// web/weapon-lab.js — the signature weapon's hidden on-hit effect, as the one
// plain line the equipment sheet's footer can show.
//
// The disc's signature-weapon ladder (pro/fightstg.s:29436-29500, decoded in
// engine/dw3/equipment.ts WEAPON_LADDER and ddw3-walker docs/research/battle/
// accessory-effects-decoded-2026-07-10.md) tests eleven ids in six rungs and
// writes the wearer's effective-stat bytes +0x2D..+0x36:
//
//   +0x2D/+0x2E poison   (151 VenomFang)
//   +0x2F/+0x30 frozen   (210 ShockHorn — its proc byte is 0, so it has no effect)
//   +0x31/+0x32 confuse  (180 RockBreaker, 194 RavenBow)
//   +0x33/+0x34 instant KO (109 NeedleGlove, 186 SoulChopper)
//   +0x35/+0x36 drain    (94 CrimsonBlade, 147 CerberusFang, 173 VampireLance)
//
// and, for the 150 SaberFang / 191 Shuriken rung, the Search-Crest crit byte
// +0x38 instead of a status pair. The odd byte is the proc power (the f9[0]
// gate, rolled against 128); the even byte is the magnitude, or the HP ratio
// for drain (engine/dw3/battle-formulas.ts statusInflictionRoll and
// engine/dw3/battle-combat.ts weaponDrainHeal are the consumers).
//
// This module only puts those decoded numbers into one line. It imports the
// engine's own weaponSecondary / weaponCritByte (the browser bundle, built from
// engine/dw3/equipment.ts) so the text cannot drift from the fight, and it
// reads nothing: no DOM, no fetch, no store. web/menu.js draws the line under
// F2 -> Extras -> "Weapon effects" (off by default).
import { weaponSecondary, weaponCritByte, WEAPON_LADDER_BY_ID } from "./vendor/engine.js";

/**
 * The wording of one status family. `proc` is the 128-point power the disc
 * rolls; `value` is the magnitude for poison/confuse/frozen and the HP ratio
 * for drain. Instant KO carries no value byte (it is always 0), so it prints
 * only the proc.
 */
function statusLine(kind, proc, value) {
    if (kind === "ko") return `On hit: instant KO (${proc}/128)`;
    if (kind === "drain") return `On hit: drain (${proc}/128, ratio ${value}/128)`;
    return `On hit: ${kind} (${proc}/128, magnitude ${value})`;
}

/**
 * The one footer line for a weapon: its decoded on-hit effect, or null when the
 * item is not one of the ladder's signature weapons. A ladder weapon whose proc
 * byte is 0 (ShockHorn) says "none" rather than disappearing, so the footer
 * still tells the player why that horn is special.
 */
export function weaponEffectLine(weaponId) {
    if (weaponId == null) return null;
    if (!WEAPON_LADDER_BY_ID[weaponId]) return null;   // an ordinary item: no third line
    const secondary = weaponSecondary(weaponId);
    if (secondary) return statusLine(secondary.kind, secondary.proc, secondary.value);
    const crit = weaponCritByte(weaponId);
    if (crit) return `On hit: crit +${crit}`;
    return "On hit: none";
}
