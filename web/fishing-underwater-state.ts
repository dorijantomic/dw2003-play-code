// web/fishing-underwater-state.js — the pure half of the underwater fishing view.
//
// NEW CONTENT of this project, on for everyone (no option row, no URL flag).
// It only READS the live fishing state (state.fishing in web/game.js, built by
// engine/systems/fishing.ts). It never changes a rule, a timer or an odd: the
// cast, the meter, the band and the catch are the disc's, untouched.
//
// Pure: no DOM, no three.js, no game state. web/fishing-underwater.js draws it.

// Mirrors of engine/systems/fishing.ts (CAST_SETTLE_TICKS, METER_MAX, RESOLVE_TICKS, METER_SPEED).
export const SETTLE_TICKS = 0x5b;
export const METER_TOP = 0x3000;
export const HOLD_TICKS = 0x3c;
export const FULL_SPEED = 0x100;

/** The scene phases, in the order a cast walks through them. */
export const PHASES = ["idle", "cast", "wait", "strike", "bite", "miss", "reel", "gone"];

/**
 * Fishing state -> scene phase.
 *   settle                      cast   the lure sinks, no fish yet
 *   sweep                       wait   the shape circles and nibbles
 *   brake                       strike you struck: it darts at the lure
 *   hold, band has a catch      bite   it is on the hook and fighting
 *   hold, band not read yet     strike the engine enters hold one tick before it sets the band: still darting
 *   hold, band 0                miss   it loses interest and leaves
 *   over, a fight is pending    reel   it is pulled up out of the water
 *   over, nothing pending       gone   the empty line comes up
 * `f` is state.fishing (or null = idle). The band is only read once the game
 * itself has set it (hold phase), so the view never shows the odds early.
 */
export function phaseFor(f) {
    const run = f?.run;
    if (!run) return "idle";
    switch (run.phase) {
        case "settle": return "cast";
        case "sweep": return "wait";
        case "brake": return "strike";
        case "hold":
            if (run.band == null) return "strike";
            return run.band === 1 || run.band === 2 ? "bite" : "miss";
        case "over": return f.pending != null ? "reel" : "gone";
        default: return "idle";
    }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 0..1 progress of the current phase, from the game's own counters:
 * cast = settle timer, wait = meter position, strike = speed braking to 0,
 * bite/miss = the hold timer. reel/gone have no counter (the view times them).
 */
export function progressFor(f) {
    const run = f?.run;
    if (!run) return 0;
    switch (run.phase) {
        case "settle": return clamp01(run.timer / SETTLE_TICKS);
        case "sweep": return clamp01(run.meter / METER_TOP);
        case "brake": return clamp01(1 - run.speed / FULL_SPEED);
        case "hold": return clamp01(run.timer / HOLD_TICKS);
        default: return 0;
    }
}

/** Fish size class: the hooked band (1 = small card-sized catch, 2 = the big water Digimon). */
export function sizeFor(f) {
    const band = f?.run?.band;
    return band === 1 ? "small" : band === 2 ? "big" : "shadow";
}

/**
 * One look per fishing_extras.json theme (town, forest, sea, lake, cold, swamp,
 * oasis). Colours are 0xRRGGBB; fog is exponential density.
 * floor: "sand" | "rock" | "ice" | "mud".
 */
export const THEMES = {
    sea:    { fog: 0x0b5f80, density: 0.055, top: 0x2aa8c8, deep: 0x06324a, light: 0xbff4ff, shafts: 0.55, floor: "sand", floorColor: 0xd9c690, rocks: 4, mote: 0xd8f6ff },
    lake:   { fog: 0x1d6a62, density: 0.07,  top: 0x3aa39a, deep: 0x0a3b3a, light: 0xd8ffe8, shafts: 0.45, floor: "rock", floorColor: 0x8a8a70, rocks: 8, mote: 0xe6fff0 },
    cold:   { fog: 0x3a86b8, density: 0.06,  top: 0x9fd8f2, deep: 0x16486e, light: 0xeaf8ff, shafts: 0.6,  floor: "ice",  floorColor: 0xc8e4f0, rocks: 6, mote: 0xffffff },
    swamp:  { fog: 0x3d4a1c, density: 0.11,  top: 0x7f9a3a, deep: 0x1a2208, light: 0xcde68a, shafts: 0.25, floor: "mud",  floorColor: 0x4a3a22, rocks: 3, mote: 0xd6e08a },
    forest: { fog: 0x1f5a3a, density: 0.08,  top: 0x3f9a62, deep: 0x0c2a1a, light: 0xd8ffd0, shafts: 0.4,  floor: "mud",  floorColor: 0x5a5236, rocks: 5, mote: 0xe6ffd8 },
    town:   { fog: 0x2a5a78, density: 0.075, top: 0x4a8fb0, deep: 0x102a40, light: 0xe0f0ff, shafts: 0.4,  floor: "rock", floorColor: 0x7a7e86, rocks: 6, mote: 0xe8f2ff },
    oasis:  { fog: 0x16909a, density: 0.045, top: 0x46c8c8, deep: 0x0a4a52, light: 0xfff4c8, shafts: 0.6,  floor: "sand", floorColor: 0xe6cf8a, rocks: 3, mote: 0xfff4d8 },
};
export const DEFAULT_THEME = "lake";

/** Theme id of a stage from the extras table (fishing_extras.json), falling back to the default. */
export function themeIdFor(extrasData, stage: string | number) {
    const rec = extrasData?.stages?.[stage];
    const area = rec ? (extrasData.areas ?? []).find((a) => a.id === rec.area) : null;
    return area && THEMES[area.theme] ? area.theme : DEFAULT_THEME;
}

/** The theme record of a stage. */
export function themeFor(extrasData, stage: string | number) {
    return THEMES[themeIdFor(extrasData, stage)];
}

/**
 * Frame budget guard (pure). record(ms) per drawn frame; after each window of `frames` frames
 * the average is compared with `limitMs`: over = tripped for good (the caller stops drawing the
 * inset for the session). The first `skip` frames (shader compile / first upload) are ignored.
 */
export function createBudgetGuard(frames = 30, limitMs = 4, skip = 2) {
    let n = 0, sum = 0, skipped = 0, tripped = false, lastAvg = 0;
    return {
        record(ms: number) {
            if (tripped) return true;
            if (skipped < skip) { skipped++; return false; }
            sum += ms; n++;
            if (n >= frames) {
                lastAvg = sum / n;
                if (lastAvg > limitMs) tripped = true;
                n = 0; sum = 0;
            }
            return tripped;
        },
        get tripped() { return tripped; },
        get lastAvg() { return lastAvg; },
    };
}
