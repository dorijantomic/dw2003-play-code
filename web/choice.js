// web/choice.js
// Canvas choice-menu widget. Rendered in screen space after ctx.restore().
// Layout/colors pixel-sampled from a verified PS1 savestate (the partner-download
// Yes/No prompt): full-width, bottom-anchored (same band as the talk box, not
// centered), near-black navy fill, white text, white "▶" cursor.
// See docs/research/ui/dialogue-chrome-decoded-2026-07-01.md.
import { drawWindow } from "./uiRects.js";

export function createChoice() {
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

  ch.moveUp = () => {
    if (!ch.isOpen()) return;
    ch.cursorIdx = (ch.cursorIdx - 1 + ch.options.length) % ch.options.length;
  };

  ch.moveDown = () => {
    if (!ch.isOpen()) return;
    ch.cursorIdx = (ch.cursorIdx + 1) % ch.options.length;
  };

  ch.confirm = () => {
    if (!ch.isOpen()) return;
    const idx = ch.cursorIdx;
    const cb = ch._onSelect;
    ch._onSelect = null;
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
