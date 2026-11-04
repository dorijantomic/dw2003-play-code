// web/battle-speed.js — the battle speed slider's rules, and the one scaled dt.
//
// A player setting for battle time only: x1, x1.5, x2 or x3. web/battle.js asks
// this module for the battle's frame delta at the top of its update(); every
// consumer of that dt (the message line's display clock, the HP plate's ease,
// the blast cinematic and renderer3d.render) then runs faster together, the way
// an emulator's speed-up button does. The field, the cutscenes and the menus
// never see this number: they are stepped by web/game.js's own frame loop with
// the untouched dt.
//
// dt is in SECONDS (web/game.js: `dt = Math.min((t - lastT) / 1000, 0.1)`).
//
// Honest limits, by design:
//   * a wall-clock `setTimeout` path is not scaled (e.g. the 1400 ms forced-flee
//     exit in battle.js). Those are the browser's timers, not the battle clock.
//   * `window.__gameSpeed` is a different, older console hack: it sub-steps the
//     WHOLE simulation, cutscenes included. This setting touches the battle only
//     and is the one with a UI.
//
// The module is pure (no DOM, no window) so the arithmetic can be tested alone.

/** The slider's four positions. 1 = normal speed; the panel's default is 2. */
export const SPEEDS = Object.freeze([1, 1.5, 2, 3]);

/**
 * The battle's dt for a frame of `dt` seconds at `speed`.
 *
 * The speed is clamped to the slider's 1..3 (a stored value from an older build,
 * or none at all, cannot invent a speed the player cannot see), and the result is
 * capped at `capSeconds` — the battle's step machine was tuned for at most three
 * 60 Hz frames per update, so a long browser stall must not hand it a giant step
 * even at x3. With x1 and a normal 60 Hz frame the frame is handed through
 * unchanged.
 */
export function battleDelta(dt, speed, capSeconds = 0.05) {
  const wanted = Number(speed);
  const s = Number.isFinite(wanted) ? Math.min(SPEEDS[SPEEDS.length - 1], Math.max(SPEEDS[0], wanted)) : 1;
  return Math.min(dt * s, capSeconds);
}

/**
 * Is "Faster battles" on? The F2 panel (web/ambience.js) owns `window.__fx`; the
 * row is `fx.battlespeed` and starts off. Anything but a real `true` is off, so
 * an old save or a missing settings object behaves exactly like the setting has
 * never existed.
 */
export function battleSpeedOn(fx) {
  return fx?.battlespeed === true;
}
