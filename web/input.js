// web/input.js — the browser side of the PlayStation pad abstraction.
//
// WHAT THE PLAYER SEES. The game plays the same whether you use the keyboard or
// plug in a joystick. The d-pad, the left stick, the four face buttons, the two
// shoulders and Start/Select all do exactly what the matching keys do, and a
// real controller confirms with Cross and goes back with Triangle in English,
// which is the layout the original's disc uses: its poll moves the three face
// buttons whenever the language index is not 0 (engine/systems/input-map.ts
// `padWordButton`).
//
// The pure part — which key or which pad index is which physical button, the
// swap from that button to the game's word bit, the stick deadzone, the repeat
// timings — lives in engine/systems/input-map.ts and is unit-tested there. This
// file only does the browser work: listening, polling the Gamepad API once a
// frame, and turning held state into press events.
//
// Both roads hand the rest of the walker the same thing: a WORD-BIT button
// name, which is what the screens compare against. Nothing downstream knows
// whether the player used a key or a pad.
//
// The original reads its pad as a raw "held" word plus a separate "newly
// pressed" latch (docs/research/field/submarimon-buoyancy-decoded-2026-07-28.md
// § "Entry gate"). This mirrors that split: `held` is the raw state that
// movement polls every frame, and the press callback is the latch that menus
// consume once per press.

import { buttonForKey, buttonsFromGamepad, isPadButton, repeats, padRepeatFires }
  from "./vendor/engine.js";

export { isPadButton };

/**
 * Normalize whatever a caller passed into a word-bit button name.
 *
 * Every screen's `handleKey` runs its argument through this, so it works the
 * same whether the dispatcher sent a button name ("circle") or a test sent the
 * raw key it stands for ("enter"). A key with no pad button — a name-entry
 * letter, a dev-tool key — passes through lowercased and unchanged.
 */
export function asButton(k) {
  if (k == null) return "";
  const raw = String(k).toLowerCase();
  return buttonForKey(raw) ?? raw;
}

/**
 * Poll-driven joystick support.
 *
 * The Gamepad API has no press events — a page must read a snapshot each frame
 * and diff it itself. `createGamepadReader` does that diff and reports which
 * buttons went down this frame, which are held, and which auto-repeated.
 */
export function createGamepadReader(nav = typeof navigator !== "undefined" ? navigator : null) {
  let held = new Set();
  // button -> display ticks held, counted one per poll, for the pad service's
  // 16 / 6 / 4 auto-repeat curve (engine/systems/input-map.ts).
  const heldFrames = new Map();
  let connected = false;

  /** The first pad the browser reports as connected, or null. */
  function activePad() {
    if (!nav || typeof nav.getGamepads !== "function") return null;
    const pads = nav.getGamepads() || [];
    for (const pad of pads) {
      if (pad && pad.connected !== false) return pad;
    }
    return null;
  }

  /**
   * Read the pad and report what changed.
   *
   * Returns `{ pressed, held, released }`. `pressed` holds the buttons that went
   * down this frame PLUS any direction that auto-repeated, because a menu treats
   * a repeat exactly like a fresh press. One poll is one display tick, so the
   * repeat is the pad service's curve (edge, then 16, then 6, then every 4).
   */
  function poll(_dt = 0) {
    const pad = activePad();
    connected = pad != null;
    const now = pad ? buttonsFromGamepad(pad, held) : new Set();

    const pressed = [];
    const released = [];
    for (const button of now) {
      if (!held.has(button)) {
        pressed.push(button);
        heldFrames.set(button, 1);
        continue;
      }
      // Held since an earlier frame: only directions repeat, on the curve.
      if (!repeats(button)) continue;
      const frames = (heldFrames.get(button) ?? 1) + 1;
      heldFrames.set(button, frames);
      if (padRepeatFires(frames)) pressed.push(button);
    }
    for (const button of held) {
      if (!now.has(button)) {
        released.push(button);
        heldFrames.delete(button);
      }
    }

    held = now;
    return { pressed, held: now, released };
  }

  /** Drop all held state — used when the window loses focus. */
  function clear() {
    held = new Set();
    heldFrames.clear();
  }

  return { poll, clear, isConnected: () => connected, held: () => held };
}

/**
 * Wire the pad into a running game.
 *
 * `onPress(button)` is called once per press or repeat — it is the latch, and is
 * what feeds the same dispatcher the keyboard feeds. `heldKeys` is the game's
 * held-button Set (`state.keys`), which the pad adds to and removes from
 * directly so movement polls it without knowing where the input came from.
 */
export function attachGamepad({ onPress, heldKeys, nav, win }) {
  const reader = createGamepadReader(nav);
  const target = win ?? (typeof window !== "undefined" ? window : null);
  const onBlur = () => {
    for (const button of reader.held()) heldKeys?.delete(button);
    reader.clear();
  };
  target?.addEventListener?.("blur", onBlur);

  return {
    /** Call once per frame from the render loop, with the frame's dt in seconds. */
    tick(dt) {
      const { pressed, released } = reader.poll(dt);
      for (const button of released) heldKeys?.delete(button);
      // The press is dispatched BEFORE the button joins the held set, which is
      // the order the keyboard path uses (game.js adds to `state.keys` after
      // `dispatchInput` returns). Menus test "is this key already held?" to let
      // the per-frame tick own auto-repeat; adding first made that test true on
      // the very first pad press, so on a joystick the pause menu, the item
      // categories and the SORT arrow could not move at all.
      for (const button of pressed) {
        onPress?.(button);
        heldKeys?.add(button);
      }
      // A button can be held without having just been pressed; keep the held set
      // in step so a direction held from before the last frame still moves.
      for (const button of reader.held()) heldKeys?.add(button);
    },
    isConnected: () => reader.isConnected(),
    detach() { target?.removeEventListener?.("blur", onBlur); },
  };
}
