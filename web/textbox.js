// web/textbox.js
import { drawTalkWindow, drawAdvanceCursor } from "./uiRects.js";
import { loadPack, packReady, drawClip, drawClipOpaque } from "./screenpack.js";

const CHARS_PER_SEC = 40;
const cmfont = loadPack("cmfont");

// `?legacyBalloonTail=1` restores the pre-port hand-drawn chrome triangle, so a
// capture can show the tail before/after. Default: the decoded CMFONTCS sprite.
const USE_LEGACY_BALLOON_TAIL = typeof location !== "undefined"
  && new URLSearchParams(location.search).has("legacyBalloonTail");

// Balloon tail (G23): one CMFONTCS sprite per quadrant mode, drawn by the
// resident EXE F0x8001c050 from the layout table D0x8004dcf4. `clip` is the
// table's field[0] (the tail variant 3/5/4/6); `dx`/`dy` are field[2]/field[3],
// the sprite's top-left relative to the anchor in native 320x240 pixels (the
// tapering tip then lands on the speaker). The sprite is painted opaque (see
// drawClipOpaque). Verified dump:
// docs/research/ui/dialogue-window-placement-decoded-2026-07-02.md:30-40.
export const BALLOON_TAIL = [
  { clip: 3, dx: 0, dy: -16 },   // mode 0: body left of the anchor, above
  { clip: 5, dx: 0, dy: 0 },     // mode 1: body left, below
  { clip: 4, dx: -16, dy: -16 }, // mode 2: body right, above
  { clip: 6, dx: -20, dy: 0 },   // mode 3: body right, below
];

// System-window band (F0x8001b814): CMFONTCS clips 8 then 9 at (0, 166),
// X-scaled from anchors (320, 196) and (0, 196) while unk68 ramps to 0x1000.
export const SYSTEM_BAND_CLIPS = [8, 9];
const BAND_ANCHORS = [[0x140, 0xC4], [0, 0xC4]];

// ── Decoded balloon-placement algorithm (disasm, fieldstg + EXE) ─────────────
// Every field dialogue window goes through the controller spawned by fieldstg
// 0x80088ca0 (tick 0x80088b84). Two paths:
//   mode 0-3  -> anchored speaker balloon, EXE F0x8001ce44: anchor point =
//                projected speaker screen pos + (mode∈{2,3} ? -11 : +11,
//                -(mode∈{0,2} ? 19 : 7)) [fieldstg F0x80088a84]; window body /
//                name tab / tail offsets per mode from the EXE layout table
//                D0x8004dcf4 (0x20-stride): body top y = anchor-58 (above,
//                modes 0/2) or anchor+28 (below, modes 1/3); the body's inner
//                edge is +6 for modes 0/1 (body LEFT of the anchor, shifted left
//                by the width) and -20 for modes 2/3 (body RIGHT); tail sprite
//                variants 3/5/4/6 point back at the anchor.
//   mode 4 / no actor -> plain system window, EXE F0x8001be00: FIXED position
//                (18,176) on the 320x240 screen, plus a companion object
//                (F0x8001bb88 -> tick F0x8001ba2c) that wipes in two 320-wide
//                chrome strips (CMFONTCS.BIN, LBA idx 646) across the bottom
//                band at y=166 — the "dimmed band behind the window".
// Mode selection for plain NPC talk (fieldstg 0x80088d38): see autoBalloonMode.
// Quadrant meaning (side of the anchor the BODY lies on):
// 0=above-left 1=below-left 2=above-right 3=below-right.

// PS1-screen-proportional constants (320x240 frame).
const PS1_W = 320, PS1_H = 240;
const FLIP_DOWN_Y = 121 / PS1_H;  // above-balloon too high -> flip below
const FLIP_UP_Y = 172 / PS1_H;    // below-balloon too low  -> flip above

// Our own box/text margins for the legacy balloon (they size our sampled chrome;
// not decoded). Exported so a test can pin the TEXT origin = body box + this
// inset: the text is painted inside the disc's body cell (the box), so pinning
// the box pins the text, and a body-side change cannot drag the text anywhere
// the body cell does not itself go.
export const BALLOON_TEXT_INSET = { x: 14, y: 22 };

// The authentic auto-mode for plain NPC talk (fieldstg 0x80088d38 + jump table
// @0x80082ed0): facing dirs 3/4/5 (up-left/up/up-right) -> balloon below, all
// other facings -> above; speaker on the left half of the screen -> balloon on
// its right side, else left; then the vertical screen-edge flips (below at
// sy>=172 flips above, above at sy<121 flips below). The quadrant numbers are
// the disc's own: 0=above-left 1=below-left 2=above-right 3=below-right, where
// left/right is the side of the anchor the BODY lies on (verified against the
// original in tests/lane-b/dialogue-controller.test.js: R/M->0 R/T->1 L/M->2
// L/T->3 for the down facings; R/M->1 L/M->3 R/B->0 L/B->2 for the up facings).
export function autoBalloonMode(dirStr, sx, sy, viewW, viewH) {
  const below = /^up/.test(dirStr ?? "");
  const right = sx < viewW / 2; // speaker on the left half -> balloon on its right
  let mode = below ? (right ? 3 : 1) : (right ? 2 : 0);
  if ((mode === 0 || mode === 2) && sy < viewH * FLIP_DOWN_Y) mode += 1;
  else if ((mode === 1 || mode === 3) && sy >= viewH * FLIP_UP_Y) mode -= 1;
  return mode;
}

// Decoded balloon anchor point (fieldstg F0x80088a84): the tail's tip, offset
// from the speaker's projected screen position by (+11|-11, -19|-7) native px —
// dx is +11 for modes 0/1 and -11 for 2/3, dy is -19 above (modes 0/2) and -7
// below (1/3). Verified against the original in
// tests/lane-b/dialogue-controller.test.js (`anchor: modes, the 0xD6 quirk`).
export function balloonAnchor(mode, sx, sy, sc) {
  const above = mode === 0 || mode === 2;
  return {
    ax: sx + (mode < 2 ? 11 : -11) * sc,
    ay: sy - (above ? 19 : 7) * sc,
  };
}

// Decoded balloon body box (EXE F0x8001ce44 build + layout table D0x8004dcf4,
// 0x20-byte records). The record's +0x18 halfword is the body's inner edge
// relative to the anchor: +6 for modes 0/1 — the body lies LEFT of the anchor,
// and the build then subtracts the clamped width w so its right edge sits at
// anchor+6 — and -20 for modes 2/3 — the body lies RIGHT, its left edge at
// anchor-20. +0x1a is the body top: -58 above (modes 0/2), +28 below (1/3); for
// the above case a dynamic-height box instead pins its BOTTOM edge at anchor-12
// (the fill quad D0x8004dd00 +0x66=62 spans anchor-74..anchor-12) so it grows
// upward, exactly as the fixed-height PS1 body does. w/h are canvas px, sc the
// native-240p -> canvas scale. No value here is invented: all come from the
// tables (see docs/research/ui/dialogue-window-placement-decoded-2026-07-02.md).
export function balloonBodyRect(mode, ax, ay, w, h, sc) {
  const above = mode === 0 || mode === 2;
  const leftBody = mode === 0 || mode === 1;
  return {
    x: leftBody ? ax + 6 * sc - w : ax - 20 * sc,
    y: above ? ay - 12 * sc - h : ay + 28 * sc,
  };
}

export function createTextbox(sfx = null) {
  const tb = {
    dialogue: null, pageIdx: 0, shown: 0, onClose: null, t: 0, openT: 0,
    anchor: null,
  };

  tb.isOpen = () => tb.dialogue !== null;
  tb.currentPage = () => tb.dialogue.pages[tb.pageIdx];
  tb.pageLength = () => tb.currentPage().join("").length;
  tb.isPageFullyShown = () => tb.shown >= tb.pageLength();

  // `anchor` (optional): per-frame () => {x, y, mode} — SCREEN position of the
  // speaker (entity origin) and the balloon quadrant mode 0-3 — or null for
  // the plain system window (SAY mode 4 / no speaking actor).
  tb.open = (dialogue, onClose = null, anchor = null) => {
    if (!dialogue || !dialogue.pages || dialogue.pages.length === 0) return;
    tb.dialogue = dialogue;
    tb.pageIdx = 0;
    tb.shown = 0;
    tb.onClose = onClose;
    tb.anchor = anchor;
    tb.openT = 0;
    // Both window paths blip on open with id 0x00040019 (true name SYSTEM03):
    // the plain mode-4 window via its companion (EXE F0x8001bb88) AND the
    // anchored speaker balloon via its own companion (F0x8001ce44 spawns
    // F0x8001cab0, which plays 0x19 opening / 0x1a closing on [+0x10]).
    // The old anchored-silent gating had only traced the plain path.
    sfx?.play("system03");
  };

  tb.advance = () => {
    if (!tb.isOpen()) return;
    if (!tb.isPageFullyShown()) { tb.shown = tb.pageLength(); return; }
    if (tb.pageIdx + 1 < tb.dialogue.pages.length) {
      tb.pageIdx++;
      tb.shown = 0;
    } else {
      // Close blip 0x0004001a (true name SYSTEM04) -- the boolean-complement
      // branch of both window companions (plain F0x8001cc84/94 pair and the
      // balloon companion F0x8001cab0), so it fires for balloons too.
      sfx?.play("system04");
      tb.dialogue = null;
      tb.anchor = null;
      if (tb.onClose) { const cb = tb.onClose; tb.onClose = null; cb(); }
    }
  };

  tb.update = (dt) => {
    tb.t += dt;
    tb.openT += dt;
    if (tb.isOpen() && !tb.isPageFullyShown()) tb.shown += dt * CHARS_PER_SEC;
  };

  const drawPageText = (ctx, x, y, lineH) => {
    ctx.font = "bold 16px monospace";
    let remaining = Math.floor(tb.shown);
    tb.currentPage().forEach((line, i) => {
      if (remaining <= 0) return;
      const text = line.slice(0, remaining);
      const ty = y + i * lineH;
      ctx.fillStyle = "#1a3a8a";
      ctx.fillText(text, x + 1, ty + 1);
      ctx.fillStyle = "#3868d8";
      ctx.fillText(text, x, ty);
      remaining -= line.length;
    });
  };

  const drawName = (ctx, x, y, nameH) => {
    const grad = ctx.createLinearGradient(x + 8, y - nameH, x + 120, y);
    grad.addColorStop(0, "#0a8070");
    grad.addColorStop(1, "#3050b0");
    ctx.fillStyle = grad;
    ctx.font = "italic bold 15px monospace";
    ctx.fillText(tb.dialogue.name, x + 10, y - 6);
  };

  const drawBalloon = (ctx, viewW, viewH, pos) => {
    const mode = pos.mode & 3;
    const above = mode === 0 || mode === 2;
    const sc = viewH / PS1_H; // decoded offsets are PS1-240p pixels

    // Anchor point (fieldstg F0x80088a84): the tail's tip, offset from the
    // speaker. Kept on its own mode key so a body-side change can never drag the
    // anchor (and with it the text) sideways.
    const { ax, ay } = balloonAnchor(mode, pos.x, pos.y, sc);

    const pad = BALLOON_TEXT_INSET.x, lineH = 24;
    const lines = tb.currentPage();
    ctx.font = "bold 16px monospace";
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width), 80);
    const w = Math.min(Math.ceil(textW) + pad * 2 + 12, viewW - 24);
    const h = pad * 2 + lines.length * lineH - 6;

    const hasName = !!tb.dialogue.name;
    const nameW = hasName ? 12 + tb.dialogue.name.length * 10 : 0;
    const nameH = hasName ? 22 : 0;

    // Body box from the disc's layout table D0x8004dcf4 (record +0x18 edge, then
    // the mode<2 width shift) and the fill quad (anchor-12 bottom above / record
    // +28 top below). The text is painted INSIDE this box at (x,y)+BALLOON_TEXT_INSET
    // and rides it, exactly as the original's body text widget rides its own
    // layout cell — so the text position is pinned by pinning the box.
    let { x, y } = balloonBodyRect(mode, ax, ay, w, h, sc);
    // Keep on screen (the PS1 relies on the mode flips for this; our dynamic
    // window sizes still need a final clamp).
    x = Math.min(Math.max(x, 6), viewW - w - 6);
    y = Math.min(Math.max(y, nameH + 6), viewH - h - 6);

    // Tail: the original draws a small CMFONTCS sprite whose tip lands on the
    // anchor (the speaker). Drawn BEFORE the body so the body's border overpaints
    // the sprite's top edge, exactly as the reference capture shows the tail
    // hanging below the balloon's bottom border. Clips/offsets are the decoded
    // numbers (F0x8001c050 + layout table D0x8004dcf4); see BALLOON_TAIL.
    // `?legacyBalloonTail=1` keeps the old hand-drawn chrome triangle, for the
    // before/after capture.
    if (USE_LEGACY_BALLOON_TAIL) {
      const baseY = above ? y + h : y - nameH;
      const baseX = Math.min(Math.max(ax, x + 12), x + w - 12);
      ctx.save();
      ctx.fillStyle = "rgb(216, 232, 248)";
      ctx.strokeStyle = "rgb(152, 208, 208)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(baseX - 7, baseY + (above ? -2 : 2));
      ctx.lineTo(ax, ay + (above ? 8 : -8));
      ctx.lineTo(baseX + 7, baseY + (above ? -2 : 2));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else {
      const tail = BALLOON_TAIL[mode];
      drawClipOpaque(ctx, cmfont, tail.clip, ax + tail.dx * sc, ay + tail.dy * sc, sc);
    }

    drawTalkWindow(ctx, x, y, w, h, nameW, nameH);

    if (hasName) drawName(ctx, x, y, nameH);
    drawPageText(ctx, x + BALLOON_TEXT_INSET.x, y + BALLOON_TEXT_INSET.y, lineH);
    if (tb.isPageFullyShown()) {
      drawAdvanceCursor(ctx, x + w - 16, y + h - 20, tb.t);
    }
  };

  // Drawn in SCREEN space (call after ctx.restore(), coords in canvas px).
  // Chrome geometry/colors pixel-sampled from verified PS1 savestates — see
  // docs/research/ui/dialogue-chrome-decoded-2026-07-01.md.
  tb.draw = (ctx, viewW, viewH) => {
    if (!tb.isOpen()) return;

    const pos = tb.anchor ? tb.anchor() : null;
    if (pos && pos.mode != null && pos.mode !== 4) {
      drawBalloon(ctx, viewW, viewH, pos);
      return;
    }

    // System window (SAY mode 4 / no speaker): CMFONTCS clips 8 and 9 at
    // (0, 166) behind a fixed bottom window (F0x8001be00 at (18, 176)).
    // Wipe ramp = 0x199/0x1000 per frame ≈ 0.17s (F0x8001ba2c).
    const s = viewW / PS1_W;
    const wipe = Math.min(1, tb.openT / 0.17);
    if (wipe > 0 && packReady(cmfont)) {
      ctx.save();
      ctx.scale(s, s);
      SYSTEM_BAND_CLIPS.forEach((clip, i) => {
        const [ax, ay] = BAND_ANCHORS[i];
        ctx.save();
        if (wipe < 1) {
          ctx.translate(ax, ay);
          ctx.scale(wipe, 1);
          ctx.translate(-ax, -ay);
        }
        drawClip(ctx, cmfont, clip, 0, 0xA6);
        ctx.restore();
      });
      ctx.restore();
    }

    const boxH = 110, pad = 16;
    const x = Math.floor(viewW * (18 / PS1_W));
    const w = viewW - x * 2;
    const y = viewH - boxH - 12;

    const hasName = !!tb.dialogue.name;
    const nameW = hasName ? 12 + tb.dialogue.name.length * 10 : 0;
    const nameH = hasName ? 22 : 0;

    drawTalkWindow(ctx, x, y, w, boxH, nameW, nameH);
    if (hasName) drawName(ctx, x, y, nameH);
    drawPageText(ctx, x + pad, y + pad + 14, 24);

    if (tb.isPageFullyShown()) {
      drawAdvanceCursor(ctx, x + w - 14, y + boxH - 24, tb.t);
    }
  };

  return tb;
}
