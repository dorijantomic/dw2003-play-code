// web/encounter-dial.js — the F2 "Encounter dial": a volume knob on the game's own
// random-encounter step counter. Pure: no DOM, no imports, no state.
//
// The decoded driver is the one authority (engine/dw3/encounters.ts): the fieldstg
// routine subtracts the standing zone's rate from the countdown once per
// ENCOUNTER_TICK_FRAMES (8) movement ticks and rolls when it expires, then resets the
// counter to rand()%0x900 folded into 0..1279. This module only changes WHAT the
// counter is reset to (rare = twice as long, lure = half as long) and whether the
// launch is allowed at all ("none"). The tick, the zone rate table and the slot roll
// are never touched, and with the switch off nothing here is read.
//
// Authority: docs/research/field/encounter-step-counter-decoded-2026-07-25.md
// (walker), engine/dw3/encounters.ts resetEncounterCounter / encounterStepTick.

/** The four settings of the dial, in panel order. "normal" is the game's own rate. */
export const DIAL_MODES = ["none", "rare", "normal", "lure"];

/** True unless the dial says "none": only that setting suppresses the launch. */
export function dialAllowsFight(mode) {
    return mode !== "none";
}

/**
 * The counter value to store after one driver expiry. `decoded` is the game's own
 * reset (0..1279); "rare" doubles it, "lure" halves it (floored), and every other
 * setting — including off/unknown — keeps the decoded value exactly.
 */
export function dialReset(decoded, mode) {
    if (mode === "rare") return decoded * 2;
    if (mode === "lure") return Math.floor(decoded / 2);
    return decoded;
}

/**
 * The live mode from the F2 settings object. The switch off always reads "normal"
 * (today's game), and a stored value that is not one of the four also reads
 * "normal" rather than inventing a fifth setting.
 */
export function dialModeFromFx(fx) {
    if (!fx || fx.encounterdial !== true) return "normal";
    return DIAL_MODES.includes(fx.encounterDialMode) ? fx.encounterDialMode : "normal";
}
