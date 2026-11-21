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
import * as uiC from "./ui-c/index.js";
import { composeWindow } from "./ui-c/screens.js";
import type { ChoicePrompt, ChoiceRun } from "./types/choice.js";

let choiceCount = 0;

/** The move blip: `ori $a0,0x513e` at file 0x19bc (the packed id). */
export const CHOICE_MOVE_SOUND = 0x8004513e;
/** The confirm blip: `ori $a0,0x503c` at file 0x1a38. */
export const CHOICE_CONFIRM_SOUND = 0x8004503c;

/**
 * The box in the field Yes / No box's own native frame (cmfont 69 at y 172, 320 x 50 for two options: the prompt 4 below the top at x 18,
 * the options at x 28 on a 14 pitch, the cursor at x 18 on the cursor row ([enter] pose: this box does not blink it), 4 spare at the bottom). More options grow the box up;
 * the bottom stays at 222. Pure: { parts, runs } for the look C composer (a "question" part, as claims.js gives cmfont 69).
 */
export const CHOICE_BOX = Object.freeze({ x: 0, bottom: 222, w: 320, pad: 4, pitch: 14, promptX: 18, optionX: 28, cursorX: 18 });
export function choiceScene(ch: ChoicePrompt) {
  const B = CHOICE_BOX, n = ch.options.length, h = B.pad * 2 + B.pitch * (n + 1), y = B.bottom - h;
  const rel = { a: 1, d: 1, e: 0, f: 0 };
  const parts = [{ part: "question", layer: "over", rows: 0, pack: "choice", id: "box", x: B.x, y, bx: 0, by: 0, w: B.w, h, rel }];
  const runs: ChoiceRun[] = [{ text: ch.prompt, x: B.promptX, y: y + B.pad, kind: 1 }];
  ch.options.forEach((o, i) => runs.push({ text: o, x: B.optionX, y: y + B.pad + B.pitch * (i + 1), kind: 1 }));
  runs.push({ text: "[enter]", x: B.cursorX, y: y + B.pad + B.pitch * (ch.cursorIdx + 1), kind: 1 });
  return { parts, runs };
}

export function createChoice(sfx = null) {
  const uiKey = `choice${++choiceCount}`;
  const ch = {
    prompt: "",
    options: [],
    cursorIdx: 0,
    _onSelect: null,
  } as ChoicePrompt;

  ch.isOpen = () => ch._onSelect !== null;

  ch.open = (prompt, options, onSelect) => {
    ch.prompt = prompt;
    ch.options = options;
    ch.cursorIdx = 0;
    ch._onSelect = onSelect;
  };

  // The move branch: set the cursor, and blip only when the value moved.
  const move = (next: number) => {
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
    if (!ch.isOpen()) { uiC.hide(uiKey); return; }
    // look C (web/ui-c, task T5): the C question box, the same composer as the field Yes / No box (choiceScene); the canvas below is the
    // fallback when the overlay is not there.
    const s = Math.max(1, Math.min(viewW / 320, viewH / 240));
    ctx.save();
    ctx.scale(s, s);
    const shown = uiC.scope(uiKey, ctx, { enable: true, compose: () => composeWindow(choiceScene(ch)) }, () => {});
    ctx.restore();
    if (shown) return;
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
