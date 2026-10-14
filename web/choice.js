// web/choice.js
// Canvas choice-menu widget. Rendered in screen space after ctx.restore().
// Layout/colors pixel-sampled from a verified PS1 savestate (the partner-download
// Yes/No prompt): full-width, bottom-anchored (same band as the talk box, not
// centered), near-black navy fill, white text, white "▶" cursor.
// See docs/research/ui/dialogue-chrome-decoded-2026-07-01.md.
//
// The INPUT rules are the field question box's own state machine, FIELDSTG_runChoice
// (0x80084200, pro/fieldstg.s file 0x1550-0x1b4c; claim
// fieldstg-runchoice-window-machine-2026-10-14, verified):
//
//   * Up (logical button 4) sets the cursor to 0 and Down (button 6) sets it to 1 —
//     for the box's two options that is decrement/increment CLAMPED, never a wrap.
//   * The move sound 0x8004513e plays only when the cursor actually CHANGED: the
//     listing compares the old cursor (task+0x70) with the new one and skips both
//     the sound and the cursor reposition when they are equal (file 0x199c-0x19a4
//     `beq $s4,$v0` -> past the `ori $a0,0x513e` call).
//   * Confirm (logical button 13) plays 0x8004503c and starts the box's close
//     (substate 10). The window's fold and the close-before-answer timing are the
//     remaining part of the same decode (the walker still shows/hides instantly).
import { drawWindow } from "./uiRects.js";

/** The move blip: `ori $a0,0x513e` at file 0x19bc (the packed id). */
export const CHOICE_MOVE_SOUND = 0x8004513e;
/** The confirm blip: `ori $a0,0x503c` at file 0x1a38. */
export const CHOICE_CONFIRM_SOUND = 0x8004503c;

export function createChoice(sfx = null) {
  const ch = {
    prompt: "",
    options: [],
    cursorIdx: 0,
    _onSelect: null,
  };

  ch.isOpen = () => ch._onSelect !== null;

  ch.open = (prompt, options, onSelect) => {
    ch.prompt = prompt;
    ch.options = options;
    ch.cursorIdx = 0;
    ch._onSelect = onSelect;
  };

  // The move branch: set the cursor, and blip only when the value moved.
  const move = (next) => {
    if (!ch.isOpen()) return;
    const target = Math.max(0, Math.min(ch.options.length - 1, next));
    if (target === ch.cursorIdx) return; // clamped: no sound, no reposition
    ch.cursorIdx = target;
    sfx?.playPacked?.(CHOICE_MOVE_SOUND);
  };

  ch.moveUp = () => move(ch.cursorIdx - 1);
  ch.moveDown = () => move(ch.cursorIdx + 1);

  ch.confirm = () => {
    if (!ch.isOpen()) return;
    const idx = ch.cursorIdx;
    const cb = ch._onSelect;
    ch._onSelect = null;
    sfx?.playPacked?.(CHOICE_CONFIRM_SOUND);
    cb(idx);
  };

  // Drawn in SCREEN space (call after ctx.restore()).
  ch.draw = (ctx, viewW, viewH) => {
    if (!ch.isOpen()) return;
    const lineH = 24, pad = 16;
    const boxH = pad * 2 + lineH + ch.options.length * lineH;
    const x = 12, w = viewW - 24;
    const y = viewH - boxH - 12;

    drawWindow(ctx, null, null, x, y, w, boxH);

    ctx.fillStyle = "#e8e8f8";
    ctx.font = "16px monospace";
    ctx.fillText(ch.prompt, x + pad, y + pad + 12);

    ch.options.forEach((opt, i) => {
      const oy = y + pad + lineH + i * lineH;
      if (i === ch.cursorIdx) {
        ctx.fillStyle = "#f0f0f0";
        ctx.fillText("▶", x + pad - 4, oy + 14);
      }
      ctx.fillStyle = i === ch.cursorIdx ? "#ffffff" : "#a8a8c8";
      ctx.font = "16px monospace";
      ctx.fillText(opt, x + pad + 16, oy + 14);
    });
  };

  return ch;
}
