// web/titlescreen.js — extracted-art adapter for the translated title screen.
//
// DECODED 2026-08-14, ledger UI-TITLE-MENU-2026-08-14 /
// UI-TITLE-LOGO-PLACEMENT-2026-08-14 / UI-TITLE-SEQUENCE-2026-08-14; see
// docs/research/ui/stdwtitl-title-menu-2026-08-14.md and
// web/assets/data/stdwtitl_ui.json `title_menu`.
//
// The 2026-07-11 pass searched this overlay for the text-label constructor
// every other decoded UI screen uses, found none, and concluded the title
// screen had no menu. The search was right and the conclusion was wrong: every
// word on this screen is a picture in a sprite pack, so a font-widget search
// could not have found it. F0x80085594 is the menu's own state machine and
// F0x800852f0 draws it.
//
// The screen shows "Press Start Button" at (79, 166) with a hollow blue box
// around it. Press the button and the box blinks three times, the line splits
// into "Start" (79, 154) and "Continue" (79, 174) over fifteen frames, and the
// box lands on one of them. Up and Down move it; confirm blinks it three more
// times and commits.
import { paintTitleVignette } from "./screendim.js";
import { loadPack, drawClip, drawClipAtPaletteRow, packReady } from "./screenpack.js";
import { ui } from "./vendor/engine.js";
import { TITLE_TWINKLES } from "./title-twinkle-data.js";

const ART_PAL = loadPack("tlogopal");
let ART_JPN = null;
let ART_USA = null;
const TWINKLE_A = loadPack("ttcommpk3");
const TWINKLE_B = loadPack("ttcommpk8");

let UI = null;
if (typeof fetch === "function") {
  fetch("assets/data/stdwtitl_ui.json")
    .then((r) => r.json())
    .then((j) => { UI = j; })
    .catch(() => {});
}

// Fallback for the node tests, which have no fetch. Mirrors `title_menu`.
const FALLBACK = {
  promptAt: [79, 166],
  optionAt: [[79, 154], [79, 174]],
  optionPalette: { selected: 0, unselected: 1 },
  clipByLanguage: {
    0: [8, 9, 10], 1: [8, 9, 10], 2: [8, 9, 10],
    3: [17, 18, 19], 4: [11, 12, 13], 5: [20, 21, 22], 6: [14, 15, 16],
  },
  logo: [
    { clip: 0, at: [19, 24], start: [-301, 24], from: "left" },
    { clip: 1, at: [19, 111], start: [339, 111], from: "right" },
  ],
  numeral: { clip: 2, at: [253, 100] },
  glow: {
    clip: 4, at: [243, 90],
    script: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  },
  legalScripts: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 1, 2, 3, 4, 5, 6, 7]],
  twinkles: TITLE_TWINKLES,
  boxClip: 7,
  jpn: {
    logo: { at: [17, 61], start: [-303, 61] },
    wordmark: { at: [207, 34], start: [527, 34] },
    numeral: { at: [49, 121] },
    glow: { at: [37, 114], script: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], stay: 11 },
  },
};

const TITLE_BG_SRC = "assets/ui/stdwtitl_bg.png";
const TITLE_BG = (typeof Image !== "undefined")
  ? Object.assign(new Image(), { src: TITLE_BG_SRC })
  : null;

// The `eng` pack is language index 2, the same constant endscreen.js uses.
export const LANGUAGE_ENGLISH = 2;

function layout() {
  const t = UI?.title_menu;
  if (!t) return FALLBACK;
  const clip = (k) => t.clips?.[k] ?? {};
  const j = t.jpn_layout ?? {};
  return {
    promptAt: t.split?.from ?? FALLBACK.promptAt,
    optionAt: t.split?.to ?? FALLBACK.optionAt,
    optionPalette: t.option_palette ?? FALLBACK.optionPalette,
    clipByLanguage: t.clip_by_language ?? FALLBACK.clipByLanguage,
    logo: [
      {
        clip: 0,
        at: clip("0").settles_at ?? FALLBACK.logo[0].at,
        start: clip("0").starts_at ?? FALLBACK.logo[0].start,
        from: "left",
      },
      {
        clip: 1,
        at: clip("1").settles_at ?? FALLBACK.logo[1].at,
        start: clip("1").starts_at ?? FALLBACK.logo[1].start,
        from: "right",
      },
    ],
    numeral: { clip: 2, at: clip("2").at ?? FALLBACK.numeral.at },
    glow: {
      clip: 4, at: clip("4").at ?? FALLBACK.glow.at,
      script: clip("4").script ?? FALLBACK.glow.script,
    },
    legalScripts: [
      t.legal_block?.clips?.["3"]?.clut_script ?? FALLBACK.legalScripts[0],
      t.legal_block?.clips?.["5"]?.clut_script ?? FALLBACK.legalScripts[1],
    ],
    twinkles: TITLE_TWINKLES,
    boxClip: 7,
    jpn: {
      logo: {
        at: j.logo?.settles_at ?? FALLBACK.jpn.logo.at,
        start: j.logo?.starts_at ?? FALLBACK.jpn.logo.start,
      },
      wordmark: {
        at: j.wordmark?.settles_at ?? FALLBACK.jpn.wordmark.at,
        start: j.wordmark?.starts_at ?? FALLBACK.jpn.wordmark.start,
      },
      numeral: { at: j.numeral?.at ?? FALLBACK.jpn.numeral.at },
      glow: {
        at: j.glow?.at ?? FALLBACK.jpn.glow.at,
        script: j.glow?.script ?? FALLBACK.jpn.glow.script,
        stay: j.glow?.stays_lit_at ?? FALLBACK.jpn.glow.stay,
      },
    },
  };
}

/** The three clip ids a language index draws: prompt, upper, lower. Read from
 *  the four-byte record at 0x80087da0. Out of range takes the English trio,
 *  which is what an unlisted language would land on. */
export function titleClipsFor(language = LANGUAGE_ENGLISH) {
  const L = layout();
  const trio = L.clipByLanguage[String(language)] ?? L.clipByLanguage[language];
  return Array.isArray(trio) && trio.length === 3 ? trio : [8, 9, 10];
}

// F0x80085594's own constants.
const IDLE_TIMEOUT = 600;   // 0x258 ticks in the prompt phase
const BLINK_STEPS = 3;      // the box flashes through three levels
const BLINK_PERIOD = 4;     // one level every four frames
const SPLIT_FRAMES = 15;    // the options slide apart over fifteen
const SETTLE_FRAMES = 6;    // then a short hold before the menu goes live
const PROMPT_HOLD = 6;      // frames on the prompt before its box appears
// SCREEN-OBJECT-METHODS-001, start_title_fade / title_fade_finished.
// The title screen does NOT use the flat dim quad every other screen uses.
// `stdwtitl F0x80085d64` fans four shaded triangles out from the screen centre
// to the four edges, and `F0x80085cd4` gives the level a quarter-sine curve
// rather than a straight ramp — so the picture darkens fastest at its border
// and the middle holds its light longest. Decoded 2026-09-03; the geometry and
// the curve live in engine/dw3/ui/screen-dim.ts.
const TITLE_FADE_FRAMES = ui.TITLE_VIGNETTE_FRAMES;
const SLIDE_STEPS = 10;

// The outcomes F0x80086834 branches on.
export const RESULT_START = 1;
export const RESULT_CONTINUE = 2;
export const RESULT_IDLE = 3;

export function createTitleScreen({
  language = LANGUAGE_ENGLISH,
  skipReveal = false,
  previousScreenCode = 0,
} = {}) {
  return new ui.TitleSession(layout(), language, skipReveal, previousScreenCode);
}

const NATIVE_W = 320, NATIVE_H = 240;

/** How the 320x240 screen maps into a view of the given size: fit inside it
 *  without distortion and centre the remainder. The draw and the mouse hit
 *  test both go through this, so they cannot drift apart. */
export function titleViewTransform(viewW, viewH) {
  const scale = Math.min(viewW / NATIVE_W, viewH / NATIVE_H);
  return {
    scale,
    offsetX: Math.round((viewW - NATIVE_W * scale) / 2),
    offsetY: Math.round((viewH - NATIVE_H * scale) / 2),
  };
}

export function drawTitleScreen(ctx, ts, viewW, viewH, background = null) {
  const L = layout();
  const ART = ts.isJapanese?.() ? (ART_JPN ??= loadPack("tlogojpn"))
    : ts.isUsa?.() ? (ART_USA ??= loadPack("tlogousa")) : ART_PAL;
  // Fit the 320x240 screen inside the view without distorting it, and centre
  // what is left over. Scaling by width alone overflows any container that is
  // not 4:3, which pushed the menu off the bottom of the game's own stage.
  const { scale: s, offsetX, offsetY } = titleViewTransform(viewW, viewH);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.translate(offsetX, offsetY);
  ctx.scale(s, s);

  const bg = (background && background.complete && background.naturalWidth)
    ? background
    : (TITLE_BG && TITLE_BG.complete && TITLE_BG.naturalWidth ? TITLE_BG : null);
  if (bg) ctx.drawImage(bg, 0, 0, NATIVE_W, NATIVE_H);
  for (const sparkle of ts.twinkles?.() ?? []) {
    const pack = sparkle.pack === 0x08870003 ? TWINKLE_A : TWINKLE_B;
    drawClip(ctx, pack, String(sparkle.clip), sparkle.x, sparkle.y);
  }

  if (!packReady(ART)) {
    ctx.restore();
    return false;
  }

  // The legal block. F0x80083054 draws all three of its clips once its gate is
  // set; F0x800831e8 walks a CLUT-row script into clips 3 and 5 and holds each
  // at its last row. Clip 6, the copyright line, takes no shift and is the one
  // clip with pixels in the USA pack. The walker drew none of them until
  // 2026-09-03.
  const legal = UI?.title_menu?.legal_block;
  if (legal && ts.legalVisible?.() !== false) {
    // The picture service records these three calls front to back. Its depth
    // bucket paints later calls behind earlier ones, so Canvas draws in reverse.
    for (const id of [...(legal.draw_order ?? [6, 3, 5])].reverse()) {
      const c = legal.clips?.[String(id)];
      if (!c) continue;
      const row = id === 3 ? ts.legalRows?.()[0] ?? c.settles_at_row
        : id === 5 ? ts.legalRows?.()[1] ?? c.settles_at_row : null;
      if (row == null) drawClip(ctx, ART, String(id), c.at[0], c.at[1]);
      else drawClipAtPaletteRow(ctx, ART, String(id), row, c.at[0], c.at[1]);
    }
  }

  const [promptClip, upperClip, lowerClip] = ts.clips();

  const [lx, ly] = ts.logoAt?.() ?? L.logo[0].at;
  const [wx, wy] = ts.wordmarkAt?.() ?? L.logo[1].at;
  drawClip(ctx, ART, String(L.logo[0].clip), lx, ly);
  drawClip(ctx, ART, String(L.logo[1].clip), wx, wy);

  // International: numeral hidden while the glow walks, then the glow goes
  // out and the numeral comes on in the same step (F0x8008426c). Japanese:
  // the glow stays at level 11 behind the numeral (F0x80083f80).
  const [nx, ny] = ts.numeralAt?.() ?? L.numeral.at;
  const [gx, gy] = ts.glowAt?.() ?? L.glow.at;
  const gLevel = ts.glowLevel?.() ?? -1;
  if (gLevel >= 0) drawClipAtPaletteRow(ctx, ART, String(L.glow.clip), gLevel, gx, gy);
  if (ts.showNumeral?.() ?? true) {
    drawClip(ctx, ART, String(L.numeral.clip), nx, ny);
  }

  const revealing = ts.phase?.() === "slide" || ts.phase?.() === "glow";
  if (revealing) {
    // The sequence owner has not raised the menu yet.
  } else if (!ts.optionsShown()) {
    drawClip(ctx, ART, String(promptClip), L.promptAt[0], L.promptAt[1]);
  } else {
    const [uy, ly] = ts.optionY();
    const hl = ts.highlight();
    drawClipAtPaletteRow(ctx, ART, String(upperClip),
      hl === 0 ? L.optionPalette.selected : L.optionPalette.unselected,
      L.optionAt[0][0], uy);
    drawClipAtPaletteRow(ctx, ART, String(lowerClip),
      hl === 1 ? L.optionPalette.selected : L.optionPalette.unselected,
      L.optionAt[1][0], ly);
  }

  if (ts.showBox()) {
    // The box's flash level rides the same slot as the dim flag.
    ctx.globalAlpha = 1 - ts.blink() * 0.3;
    const [bx, by] = ts.boxAt();
    drawClipAtPaletteRow(ctx, ART, String(L.boxClip), ts.blink(), bx, by);
    ctx.globalAlpha = 1;
  }

  const dim = ts.dimLevel?.() ?? 0;
  if (dim > 0) {
    paintTitleVignette(
      ctx, dim, ui.TITLE_VIGNETTE_CENTRE, ui.TITLE_VIGNETTE_EDGES,
      ui.titleVignetteEdgeLevel(dim), NATIVE_W, NATIVE_H,
    );
  }

  ctx.restore();
  void NATIVE_H;
  return true;
}

/** The screen rectangles the two options occupy, for mouse hit-testing.
 *  Derived from the same layout the draw uses — no parallel coordinate table. */
export function titleOptionRects(ts) {
  const L = layout();
  const [uy, ly] = ts.optionY();
  const W = 164, H = 16;
  return [
    { index: 0, x: L.optionAt[0][0], y: uy, w: W, h: H },
    { index: 1, x: L.optionAt[1][0], y: ly, w: W, h: H },
  ];
}
