// web/cntysel.js — native CNTY_SEL language/localisation QA screen.
//
// Decode: docs/research/ui/cnty_sel-full-decode-2026-08-05.md and
// docs/research/ui/cnty_sel-decoded-2026-07-11.md. Third of the debug-tool
// trio with web/stagslct.js and the sound test. Not a screen an ordinary
// player meets. Do not put any of this in web/titlescreen.js.
//
// Language names come from stagslct's own table (data/language_table.json).
// Cursor bytes: 2,3,5,4,6,1,0 → ENG FRA GER ITA SPN USA JPN.
//
// SCREEN-OBJECT-NAME-AUDIT-001: the routine stores the cursor row and the draw
// uses clip (row+4) at (0,0). The first naming pass called this "the sparkle";
// it is the CLUT-cycling cursor highlight named in
// docs/research/ui/cnty_sel-full-decode-2026-08-05.md. The pack's clips 0..3 are
// the window panes and row+4 is the highlight. The key below keeps its old name
// so the layout file stays readable; the picture is the highlight.
//
// Pane positions are literal immediates in the five draw-context ctors.
// cntselwn's 14 tiles are still unextracted, so there is no authentic
// chrome pack to draw. Per-row list pitch was not transcribed — the
// original names live in those tiles. This screen therefore prints the
// decoded names with the UI font, at the sparkle origin for the main
// list highlight and at the two side-pane origins for USA / JPN.
//
// OPEN GAPS (do not fill with guesses):
//  - cntselwn pack not extracted
//  - three window-fold table shapes at 0x173c/0x174c/0x175c
//  - the resident caller that opens this overlay

import { paintScreenDim } from "./screendim.js";
import { drawText } from "./uifont.js";
import { loadPack, drawClip, packReady } from "./screenpack.js";
import { padRepeatFires } from "./vendor/engine.js";

const NATIVE_W = 320;
const NATIVE_H = 240;
const VSYNC_S = 0.02;
const cntselwn = loadPack("cntselwn");

// Overlay F0x80082fc4: 0 to 255 over 30 frames. Same 8.8 leave dim as the
// other screens (0xFF00 / 0x1E per vsync).
const LEAVE_FADE_FRAMES = 0x1E;
const LEAVE_FADE_MAX = 0xFF00;
const LEAVE_FADE_DELTA = Math.trunc(LEAVE_FADE_MAX / LEAVE_FADE_FRAMES);

// Pane draws, F0x80082ef0 / 833dc / 83630 / 83894 / 83b00.
const PANE = Object.freeze({
  emblem: { clip: 0, wrap: 96 },
  right: { clip: 1, x: 0x140, y: 0x14 },
  top: { clip: 2, x: 0x94, y: 0 },
  bottom: { clip: 3, x: 0, y: 0x9E },
  sparkle: { x: 0, y: 0, clipBase: 4 },
});

// data/language_table.json, cursor order.
const ROWS = Object.freeze([
  { cursor: 0, index: 2, name: "ENG", pack: "eng", side: false },
  { cursor: 1, index: 3, name: "FRA", pack: "fra", side: false },
  { cursor: 2, index: 5, name: "GER", pack: "ger", side: false },
  { cursor: 3, index: 4, name: "ITA", pack: "ita", side: false },
  { cursor: 4, index: 6, name: "SPN", pack: "spn", side: false },
  { cursor: 5, index: 1, name: "USA", pack: "usa", side: "right" },
  { cursor: 6, index: 0, name: "JPN", pack: "jpn", side: "left" },
]);

// Decorations arrive 6, then 11, then 6 frames apart; the list is live after.
const STAGGER = Object.freeze({ first: 6, second: 11, third: 6 });
export const LIST_READY_FRAMES = STAGGER.first + STAGGER.second + STAGGER.third;

export { LEAVE_FADE_FRAMES, PANE, ROWS, STAGGER };

export function sparkleClipFor(cursor) {
  return PANE.sparkle.clipBase + (cursor | 0);
}

export function createCntyselMenu(sfx = null) {
  const d = {
    open: false,
    cursor: 0,
    lastMain: 0,
    vsync: 0,
    time: 0,
    fadeLeaving: false,
    fadeFrames: 0,
    chosen: null,
    onPick: null,
  };

  d.isOpen = () => d.open;

  d.show = (onPick) => {
    d.open = true;
    d.cursor = 0;
    d.lastMain = 0;
    d.vsync = 0;
    d.time = 0;
    d.fadeLeaving = false;
    d.fadeFrames = 0;
    d.chosen = null;
    d.onPick = onPick || null;
  };

  d.hide = () => {
    d.open = false;
    d.fadeLeaving = false;
  };
  d.close = () => d.hide();

  d.sparkleClip = () => sparkleClipFor(d.cursor);
  d.row = () => ROWS[d.cursor] ?? ROWS[0];
  d.listReady = () => d.vsync >= LIST_READY_FRAMES;
  d.emblemFrame = () => Math.floor(d.vsync / 2) % PANE.emblem.wrap;

  d.leaveFadeAlpha = () => {
    if (!d.fadeLeaving) return 0;
    return Math.min(255, (d.fadeFrames * LEAVE_FADE_DELTA) >> 8) / 255;
  };

  function requestLeave() {
    if (d.fadeLeaving) return;
    d.fadeLeaving = true;
    d.fadeFrames = 0;
  }

  d.tick = () => {
    if (!d.open) return;
    d.vsync += 1;
    if (d.fadeLeaving) {
      d.fadeFrames += 1;
      if (d.fadeFrames * LEAVE_FADE_DELTA >= LEAVE_FADE_MAX) {
        d.open = false;
        d.fadeLeaving = false;
        if (d.onPick && d.chosen) d.onPick(d.chosen);
      }
    }
  };

  // Held-direction repeat on the pad service's curve (edge then 16/6/4). The
  // keydown path handles the edge; the held step fires the repeats, so a held
  // arrow walks the list like every other menu.
  d._held = {};
  d._stepHeld = (heldKeys) => {
    if (!heldKeys) return;
    for (const dir of ["up", "down", "left", "right"]) {
      if (heldKeys.has?.(dir)) {
        const n = (d._held[dir] ?? 0) + 1;
        d._held[dir] = n;
        if (n > 1 && padRepeatFires(n) && d.open && !d.fadeLeaving && d.listReady()) d.handleKey(dir);
      } else {
        d._held[dir] = 0;
      }
    }
  };

  d.update = (dt, heldKeys = null) => {
    if (!d.open) return;
    d.time += dt;
    const target = Math.floor(d.time / VSYNC_S);
    while (d.open && d.vsync < target) d.tick();
    d._stepHeld(heldKeys);
  };

  d.handleKey = (k) => {
    if (!d.open) return false;
    if (d.fadeLeaving) return true;
    if (!d.listReady()) return true;
    if (k === "arrowup" || k === "up") {
      if (d.cursor <= 4 && d.cursor > 0) {
        d.cursor -= 1;
        d.lastMain = d.cursor;
        sfx?.play("system07");
      }
      return true;
    }
    if (k === "arrowdown" || k === "down") {
      if (d.cursor < 4) {
        d.cursor += 1;
        d.lastMain = d.cursor;
        sfx?.play("system07");
      }
      return true;
    }
    if (k === "arrowleft" || k === "left") {
      if (d.cursor !== 6) {
        if (d.cursor <= 4) d.lastMain = d.cursor;
        d.cursor = 6;
        sfx?.play("system07");
      }
      return true;
    }
    if (k === "arrowright" || k === "right") {
      const prev = d.cursor;
      if (d.cursor === 6) d.cursor = 5;
      else if (d.cursor === 5) d.cursor = d.lastMain;
      else {
        d.lastMain = d.cursor;
        d.cursor = 5;
      }
      if (d.cursor !== prev) sfx?.play("system07");
      return true;
    }
    if (k === "enter" || k === " " || k === "circle") {
      d.chosen = d.row();
      sfx?.play("system08");
      requestLeave();
      return true;
    }
    return true;
  };

  d.draw = (ctx, W, H) => {
    if (!d.open) return;
    ctx.save();
    // cntselwn in this checkout is git-lfs pointers; a dim fill stays for
    // legibility when the pack is missing. Names print at the sparkle origin
    // because the per-row pitch inside those tiles was not transcribed.
    ctx.fillStyle = "rgba(8,12,24,0.92)";
    ctx.fillRect(0, 0, W, H);
    const s = W / NATIVE_W;
    ctx.scale(s, s);

    if (packReady(cntselwn)) {
      drawClip(ctx, cntselwn, PANE.emblem.clip, 0, 0);
      drawClip(ctx, cntselwn, PANE.right.clip, PANE.right.x, PANE.right.y);
      drawClip(ctx, cntselwn, PANE.top.clip, PANE.top.x, PANE.top.y);
      drawClip(ctx, cntselwn, PANE.bottom.clip, PANE.bottom.x, PANE.bottom.y);
      if (d.listReady()) {
        drawClip(ctx, cntselwn, d.sparkleClip(), PANE.sparkle.x, PANE.sparkle.y);
      }
    }

    const sel = d.row();
    if (d.listReady()) {
      drawText(ctx, sel.name, PANE.sparkle.x, PANE.sparkle.y, { kind: 1 });
      if (d.cursor === 6) {
        drawText(ctx, sel.name, PANE.bottom.x, PANE.bottom.y, { kind: 3 });
      } else if (d.cursor === 5) {
        drawText(ctx, sel.name, PANE.right.x, PANE.right.y, { kind: 3 });
      }
    }

    const a = d.leaveFadeAlpha();
    if (a > 0) {
      paintScreenDim(ctx, a * 255, NATIVE_W, NATIVE_H);
    }
    ctx.restore();
  };

  return d;
}
