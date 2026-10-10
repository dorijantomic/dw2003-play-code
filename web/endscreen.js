// web/endscreen.js — the game's END card.
//
// DECODED 2026-08-14, ledger UI-ENDSCREEN-DECODED-2026-08-14; see
// docs/research/ui/end-screen-decoded-2026-08-14.md and
// web/assets/data/stdwtitl_ui.json `end_screen`.
//
// It lives in the title overlay. F0x8008453c runs a seven-entry jump table on
// the language global to pick one of four images — END, Ende, Fin, Fine — and
// draws it from the end__all pack at (96, 100), which is exactly centred on the
// 320x240 screen. F0x80084628 is the sequence: the card flashes in white and
// settles to green, holds, waits for the player, flashes back out, holds, then
// hands off through the resident loading message.
//
// The fade is a CLUT row walk, not alpha: the screen object's level 0..15 goes
// through the draw context's set-CLUT-row-offset slot, and the pack's frames
// name CLUT y 240 inside a 256-row page, so the levels are palette rows
// 240..255. The extractor ships all sixteen as clip ids "<n>" and
// "<n>#1".."<n>#15", so the walker steps ids rather than tinting.
import { loadPack, drawClip, packReady, paletteClipId } from "./screenpack.js";

const ART = loadPack("endall");

let UI = null;
if (typeof fetch === "function") {
  fetch("assets/data/stdwtitl_ui.json")
    .then((r) => r.json())
    .then((j) => { UI = j; })
    .catch(() => {});
}

// Fallback for the node tests, which have no fetch. Mirrors `end_screen`.
const FALLBACK = {
  x: 96, y: 100, w: 128, h: 40,
  fade: { levels: 16, min: 0, max: 15, ticksPerStep: 2 },
  clipByLanguage: { 0: 0, 1: 0, 2: 0, 3: 2, 4: 3, 5: 1, 6: 2 },
  clipLabels: { 0: "END", 1: "Ende", 2: "Fin", 3: "Fine" },
};

// The `eng` pack is language index 2 (./dw3-research languages).
export const LANGUAGE_ENGLISH = 2;

function layout() {
  const e = UI?.end_screen;
  if (!e) return FALLBACK;
  return {
    x: e.x, y: e.y, w: e.w, h: e.h,
    fade: {
      levels: e.fade.levels, min: e.fade.min, max: e.fade.max,
      ticksPerStep: e.fade.ticks_per_step,
    },
    clipByLanguage: e.language_table.clip_by_language,
    clipLabels: e.clip_labels,
  };
}

/** Which of the four images a language index gets. Out of range takes clip 0,
 *  the same as the overlay's `sltiu 0x7` gate falling through. */
export function endClipFor(language = LANGUAGE_ENGLISH) {
  const L = layout();
  const clip = L.clipByLanguage[String(language)] ?? L.clipByLanguage[language];
  return Number.isInteger(clip) ? clip : 0;
}

export function endLabelFor(language = LANGUAGE_ENGLISH) {
  return layout().clipLabels[String(endClipFor(language))] ?? "END";
}

// The six states of F0x80084628, in order. `timer` is the object's own
// accumulator; the walker feeds it whole frames, which is the unit the original
// advances it in.
const HOLD_AFTER_FADE_IN = 0x78;   // state 1
const WAIT_FOR_PLAYER = 0x4650;    // state 2 timeout
const HOLD_AFTER_FADE_OUT = 0x3c;  // state 4

export function createEndScreen({ language = LANGUAGE_ENGLISH } = {}) {
  const L = layout();
  const clip = endClipFor(language);
  let state = 0;
  let level = L.fade.max;   // entry sets level 15, timer 0
  let timer = 0;
  let done = false;

  const advance = () => { state += 1; timer = 0; };

  const es = {
    clip: () => clip,
    label: () => L.clipLabels[String(clip)] ?? "END",
    state: () => state,
    level: () => level,
    timer: () => timer,
    isDone: () => done,
    // The id the sheet carries for the current level: level 0 is the base clip,
    // every other level is the CLUT-cycled variant.
    clipId: () => paletteClipId(clip, level),

    /** One frame. `dt` is the timer delta the original adds each vsync. */
    tick(dt = 1) {
      if (done) return;
      timer += dt;
      switch (state) {
        case 0: // fade in, level 15 -> 0
          while (timer >= L.fade.ticksPerStep && level > L.fade.min) {
            timer -= L.fade.ticksPerStep;
            level -= 1;
          }
          if (level <= L.fade.min) advance();
          break;
        case 1:
          if (timer >= HOLD_AFTER_FADE_IN) advance();
          break;
        case 2:
          if (timer >= WAIT_FOR_PLAYER) advance();
          break;
        case 3: // fade out, level 0 -> 15
          while (timer >= L.fade.ticksPerStep && level < L.fade.max) {
            timer -= L.fade.ticksPerStep;
            level += 1;
          }
          if (level >= L.fade.max) advance();
          break;
        case 4:
          if (timer >= HOLD_AFTER_FADE_OUT) advance();
          break;
        default: // state 5: the loading handoff
          done = true;
          break;
      }
    },

    /** The player's button. The original only reads it in state 2, where it
     *  jumps the timer straight to the timeout rather than skipping outright. */
    press() {
      if (state === 2) timer = WAIT_FOR_PLAYER;
    },
  };
  return es;
}

const NATIVE_W = 320, NATIVE_H = 240;

export function drawEndScreen(ctx, es, viewW, viewH) {
  const L = layout();
  const s = viewW / NATIVE_W;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.save();
  ctx.scale(s, s);
  if (packReady(ART)) {
    // The clip's own layer offset already carries (96, 100), so the draw call
    // passes (0, 0) exactly as the overlay does.
    drawClip(ctx, ART, es.clipId(), 0, 0);
  } else {
    // No art (node tests, or a missing sheet): keep the decoded rect visible
    // rather than drawing nothing.
    ctx.strokeStyle = "rgba(0,255,0,0.6)";
    ctx.strokeRect(L.x, L.y, L.w, L.h);
  }
  ctx.restore();
  void NATIVE_H;
}
