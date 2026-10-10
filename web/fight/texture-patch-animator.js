// Per-model animated texture patches — the shared-pool list every smdldata record points at.
//
// Each entry names a rectangle on the fighter's texture page and three pictures to copy into
// it; FIGHTSTG_F0x8008b200 re-issues the copy whenever the chosen picture changes. THIS MODULE
// IS ONLY THE CHOICE — which of the three, this tick. The copy itself is the renderer's job,
// because on hardware it is a VRAM-to-VRAM blit.
//
// The choice is not written here: it is the ported system in engine/dw3/battle-presentation.ts
// (the eye-state override FIGHTSTG_F0x8008b118 and the blink/copy driver FIGHTSTG_F0x8008b200,
// oracled against the disc in tests/lane-b/battle-presentation.test.js). This file is the thin
// browser adapter over it — the blink jump table, the state band, the pause and the free cycle
// all come from that one port, so the animation has a single decoded source:
//   slots 0 and 1  the eyes, on a blink timer that the fighter's state can override
//   slots 2 and up looping body animation (flames, scrolling light), free-running
import {
  eyePatchVariant, blinkVariant, blinkPause, cycleVariant,
  BLINK_TABLE, BLINK_TARGET_VARIANT, BLINK_PAUSE_BASE, BLINK_PAUSE_MASK,
  CYCLE_PERIOD, CYCLE_HOLD,
} from "../vendor/engine.js";

export { cycleVariant, CYCLE_PERIOD, CYCLE_HOLD };

// D0x80082e1c, indexed by `timer >> 1`, read out of the disc table the port carries: the timer
// counts DOWN, so read this right to left — open, half, shut, half, and index 0 reloads.
// Anything past the table is open.
export const BLINK_SEQUENCE = BLINK_TABLE.map((t) => BLINK_TARGET_VARIANT[t]);
// (rand() & 0x7f) + 0x3c — 60 to 187 ticks between blinks.
export const BLINK_RELOAD_MIN = BLINK_PAUSE_BASE;
export const BLINK_RELOAD_MASK = BLINK_PAUSE_MASK;

/**
 * FIGHTSTG_F0x8008b118: the fighter's own state code can hold the eyes. Returns 0 when the
 * blink timer is allowed to run. The ported selector, kept under its browser name.
 */
export const stateVariant = eyePatchVariant;

export class TexturePatchAnimator {
  /** @param entries model_placement.json `texture_anim` rows for one Digimon. */
  constructor(entries, rng = Math.random) {
    this.entries = (entries || []).map((e) => ({ ...e, variant: 0 }));
    this.rng = rng;
    this.blinkTimer = 0;     // object +0x1a0
    this.cycleTime = 0;      // object +0x1a4
  }

  get active() { return this.entries.length > 0; }

  /**
   * One logic tick. `delta` is the same per-tick frame delta the rest of the fight sim runs on
   * (D0x800a4464). Returns only the entries whose picture changed — the original caches the last
   * variant per element and re-blits on a change only.
   *
   * The selection is the port's: eyePatchVariant holds the eyes from the state code, otherwise
   * blinkVariant picks from the disc jump table and reloads the pause when its entry-0 arm runs,
   * and cycleVariant is the free-running body cycle.
   */
  update(delta, state = 1) {
    let blink = eyePatchVariant(state);
    if (blink !== 0) {
      this.blinkTimer = 0;                       // 0x8008b31c
    } else {
      const { variant, reload } = blinkVariant(this.blinkTimer);
      blink = variant;
      if (reload) {
        this.blinkTimer =
          blinkPause(Math.floor(this.rng() * 0x8000));
      }
      this.blinkTimer = Math.max(0, this.blinkTimer - delta);
    }
    this.cycleTime += delta;
    const cycle = cycleVariant(this.cycleTime);

    const changed = [];
    for (const entry of this.entries) {
      const want = entry.slot < 2 ? blink : cycle;
      if (want !== entry.variant) { entry.variant = want; changed.push(entry); }
    }
    return changed;
  }
}
