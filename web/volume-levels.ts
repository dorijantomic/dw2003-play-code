// web/volume-levels.js -- the OPTIONS volumes as multipliers of the game's own fixed gains. Pure.
// 1 = today's gain (music element 0.6 in web/audio.js, effects 0.7, weather and place sounds 0.55 in web/fxaudio.js), so
// nothing changes until the player moves a slider. Anything that is not a number reads 1.

/** A level as a number from 0 to 1; missing or not a number is 1 (today's loudness). */
export function clampLevel(level) {
    if (level === undefined || level === null || level === "") return 1;
    const v = Number(level);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

/** `base` (the game's own gain) scaled by the player's level. */
export const scaleGain = (base, level) => base * clampLevel(level);

/** The game's own gains, one place. */
export const BASE_GAIN = Object.freeze({ music: 0.6, effects: 0.7, weather: 0.55 });
