// web/uiRects.js
// Draws PS1-style DW2003 window chrome using canvas primitives.
//
// No packed texture asset exists for these — `ttcommpk` was checked and disproven
// (its TIM decodes to a green circuit-board tile, nothing like the real dialogue box;
// see docs/research/ui/screen-pack-format.md). The real chrome is almost certainly
// GPU-primitive-drawn at runtime by the field engine, not a texture blit. Geometry and
// colors here are pixel-sampled from a verified PS1 savestate screenshot (talking to
// Genji/Junior, and the partner-download Yes/No prompt) — see
// docs/research/ui/dialogue-chrome-decoded-2026-07-01.md for the sampled values and method.

// Generic system window (menus, shop, item list, Yes/No choice prompt) — sampled from
// the "Download your partner Digimon now?" screenshot: near-black navy fill, thin
// blue-violet border line, full-width bottom-anchored in its original context.
export function drawWindow(ctx, img, _rects, x, y, w, h) {
  ctx.save();

  ctx.fillStyle = "rgb(0, 0, 32)";
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = "rgb(104, 104, 208)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.restore();
}

// Kept for callers that import CMN_WINDOW but it's no longer used for drawing.
export const CMN_WINDOW = {};

// Field NPC/player talk box — sampled from savestate 2 (Junior: "Yeah I won!").
// Two-tier silhouette: a shorter/narrower name tab sits above a wider body, divided
// by a solid teal line; bottom-right corner is chamfered (45° cut), not rounded;
// whole box has a solid dark drop-shadow offset down+right.
const TALK = {
  nameFill: "rgb(184, 216, 224)",
  bodyFill: "rgb(216, 232, 248)",
  borderBright: "rgb(184, 232, 232)", // outer highlight bevel
  borderMid: "rgb(152, 208, 208)",
  borderCore: "rgb(0, 128, 112)", // the teal accent line
  shadow: "rgba(0, 0, 0, 0.55)",
  chamfer: 10,
};

function roundedChamferedPath(ctx, x, y, w, h, chamfer) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - chamfer);
  ctx.lineTo(x + w - chamfer, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

// x,y,w,h describe the body box; nameW/nameH describe the name tab sitting on top
// (nameW <= w). Pass nameH=0 to draw a plain chamfered box (used for smaller popups).
export function drawTalkWindow(ctx, x, y, w, h, nameW = 0, nameH = 0) {
  ctx.save();

  // Drop shadow first (offset down+right, solid).
  ctx.fillStyle = TALK.shadow;
  const shadowOff = 4;
  roundedChamferedPath(ctx, x + shadowOff, y + shadowOff, w, h, TALK.chamfer);
  ctx.fill();
  if (nameH > 0) {
    ctx.fillRect(x + shadowOff, y - nameH + shadowOff, nameW, nameH);
  }

  // Body fill + chamfered bottom-right corner.
  roundedChamferedPath(ctx, x, y, w, h, TALK.chamfer);
  ctx.fillStyle = TALK.bodyFill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = TALK.borderMid;
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = TALK.borderCore;
  ctx.stroke();

  if (nameH > 0) {
    // Name tab (narrower, sits above the body, no top chamfer).
    ctx.fillStyle = TALK.nameFill;
    ctx.fillRect(x, y - nameH, nameW, nameH);
    ctx.strokeStyle = TALK.borderMid;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y - nameH, nameW, nameH);
    ctx.strokeStyle = TALK.borderCore;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y - nameH, nameW, nameH);

    // Divider line under the name tab.
    ctx.strokeStyle = TALK.borderCore;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();

    // Dashed corner accent, top-left (the "marching ants" detail visible in-game).
    ctx.strokeStyle = TALK.borderBright;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x + 1, y - nameH + 2);
    ctx.lineTo(x + 1, y - 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// The blinking "advance" chevron indicator, bottom-right of a talk box (sampled: solid
// orange, stacked downward chevrons).
export function drawAdvanceCursor(ctx, x, y, t = 0) {
  ctx.save();
  ctx.fillStyle = "rgb(230, 140, 20)";
  const bob = Math.sin(t * 6) * 2;
  for (let i = 0; i < 2; i++) {
    const cy = y + i * 6 + bob;
    ctx.beginPath();
    ctx.moveTo(x - 5, cy);
    ctx.lineTo(x + 5, cy);
    ctx.lineTo(x, cy + 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
