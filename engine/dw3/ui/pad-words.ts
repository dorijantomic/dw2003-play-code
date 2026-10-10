// The menu input words, with the accelerating repeat service.
// CORE-PAD-RECORD-BUTTON-WORDS-001, UI-PAD-REPEATCURVE-2026-08-21.
// docs/research/ui/pad-input-service-behaviour-2026-08-21.md.
import { consumeFieldTicks } from "../../systems/field-movement.ts";
import { advanceFrameClock, frameDelta } from "../../systems/frame-clock.ts";

/** PAL update boundaries and the region-normalized script/input clock.
 * UI-DISPLAY-TICK-CHAIN-2026-08-21,
 * display-frame-delta-feeder-runs-on-vblank-2026-08-27.
 *
 * This is the ONE place a browser frame becomes displayed frames for the twenty-
 * four translated screens, so `advanceFrameClock()` inside it is the ONE place
 * the game's shared clock is advanced for them: every displayed frame is one
 * vertical blank of the original, and the delta each screen reads is the word
 * that blank published (F0x8001D3F4 feeds, F0x8001D504 publishes, F0x8001D704
 * hands it out — engine/systems/frame-clock.ts).
 *
 * `tick` is still this screen's own display counter, counted from the frame the
 * screen opened, exactly as before. It answers a session's `frameCounter()`,
 * which counts frames and phases of its own; the free-running word
 * [0x8004DE20] stays the native runtime's (engine/native/runtime.ts:983) and is
 * a separate merge — see the frame clock's report.
 */
export class MenuDisplayClock {
  private elapsed = 0;
  private fraction = 0;
  private tick = 0;

  advance(seconds: number): Array<{ tick: number; delta: number }> {
    const due = consumeFieldTicks(this.elapsed, seconds);
    this.elapsed = due.accumulator;
    const ticks = [];
    for (let i = 0; i < due.ticks; i++) {
      this.fraction += 0x133;
      const next = Math.floor(this.fraction / 0x100);
      this.tick = next;
      // One displayed frame: the shared clock publishes this frame's delta.
      advanceFrameClock();
      ticks.push({ tick: next, delta: frameDelta() });
    }
    return ticks;
  }
}

export class MenuPadWords {
  private tick = 0;
  private previous = 0;
  private last = new Int32Array(16);
  private credit = new Uint8Array(16);

  update(buttons: number, displayTick = this.tick + 1): { pressed: number; repeated: number } {
    const held = buttons & 0xffff;
    this.tick = displayTick;
    let repeated = 0;
    for (let bit = 0; bit < 16; bit++) {
      if (held & (1 << bit)) {
        const due = this.tick - this.last[bit]! + this.credit[bit]!;
        if (Math.trunc(due / 16) !== 0) {
          repeated |= 1 << bit;
          this.last[bit] = this.tick;
          this.credit[bit] = Math.min(this.credit[bit]! + 10, 12);
        }
      } else {
        this.last[bit] = this.tick;
        this.credit[bit] = 0;
      }
    }
    const pressed = held & ~this.previous;
    this.previous = held;
    return { pressed, repeated };
  }
}
