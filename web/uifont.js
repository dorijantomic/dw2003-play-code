// web/uifont.js — the game's real bitmap UI font (CMFONTTM.BIN pages + EXE
// glyph tables, extracted by tools/extract_ui_font.py; charset from ddw3's
// own text codec). Draws menu/shop text exactly as the PS1 does: per-glyph
// rects with dx/dy offsets and proportional advances.
//
// kind 1 = 8x12 face, kind 2 = 8x9 face, kind 3 = 8x8 face. Colour is the
// glyph CLUT row plus widget +0xC0 (unk138). See extract_ui_font.py.
//
// WHERE A NUMBER'S COLOUR COMES FROM. Kind 3 is the game's number face: the
// HP plate's current/max/slash elements are built by the widget factory
// F0x8001ae38(layer, 3, x, y) (exe/fns.s:12133-, called from
// pro/fightstg.s:17063, :17085, :17384-:17431 for the two HP numbers and the
// "/"), and the drawer's CLUT word is
//     ((widget+0xC0 + widget+0xAE + glyph[+4]) << 6) | (((0x140 + glyph[+3]) >> 4) & 0x3f)
// (exe/fns.s:10605-:10621, ported as clutWord() in engine/dw3/ui/text-drawer.ts).
// The factory stores paletteAdd = 0 into +0xAE (exe/fns.s:12119) and never
// touches +0xC0; the ONLY writer of +0xC0 is method +0x138 = F0x8001a1f4,
// `sb $a1, 0xc0($a0)` (exe/fns.s:11132-:11134, installed at :12069-:12070),
// and no arm that owns a number element calls it -- not the plate (no
// `lw $v0, 0x138(` anywhere in FIGHTSTG_F0x800934f0 / FIGHTSTG_F0x80093a74 /
// FIGHTSTG_F0x80093108 / FIGHTSTG_F0x8009328c, pro/fightstg.s:16706-17510), not
// the technique list's MP plate (FIGHTSTG_F0x80096048's two calls, :19892 and
// :19910, are on the L1/R1 markers at (0x1a,0x9f)/(0x80,0x9f) and set row 2),
// not the TAG rows (FIGHTSTG_F0x800970c0 / F0x80097ab0, zero calls). So every
// number reads CLUT row 0 of its own font bank, and row 0 is baked into
// uifont.png: the amber ramp, brightest entry (248,136,16). That is why
// drawText() needs no `color` for a number and why no call site supplies one.
// Elements that DO take a colour pass `clut`, not a CSS colour: the technique
// list's row names use rows 3/4/7/0 (FIGHTSTG_F0x80096314, :20108-:20147) and
// a TAG row whose partner is at 0 HP dims its name plate to row 7
// (FIGHTSTG_F0x800972c8, :21154-:21159). The "L1"/"R1" page hints under a
// battle list window are kind 3 in row 2 (FIGHTSTG_F0x80096048 :19892-:19895
// and :19910-:19913, FIGHTSTG_F0x8009563c :19227-:19230 and :19245-:19248,
// FIGHTSTG_F0x8009492c :18365-:18368 and :18383-:18386), which is the flat
// white of the number face -- web/battle.js listPageHint() is the one place
// that pair is written.

import { assetImageScale, loadAssetImage, tagAssetSource } from "./assets.js";

let img = null;
let map = null;
const tinted = {}; // color -> tinted copy of the sheet (canvas)
const clutSheets = {}; // "kind:clut" -> remapped sheet

// Guarded so pure-logic modules that import this file's helpers (but only
// call them from browser draw code) stay importable under `node --test`
// (no DOM/Image there) — e.g. nameentry.js's createNameEntry() unit tests.
if (typeof Image !== "undefined") {
  loadAssetImage("assets/ui/uifont.png")
    .then((im) => { img = im; })
    .catch(() => {});
  fetch("assets/ui/uifont.json").then((r) => r.json()).then((j) => { map = j; }).catch(() => {});
}

export function fontReady() { return !!(img && map); }

/**
 * Kind 3 is the game's number face -- see the header note for the decode.
 * It is the font kind every HP / MP / Lv / cost readout is built with.
 */
export const NUMBER_FONT_KIND = 3;

/**
 * One CLUT (colour) row out of the shipped font manifest, as
 * `[{r, g, b, a}, ...]`, or null when the manifest has no such row. `cluts` is
 * `uifont.json`'s `cluts` object; the caller passes it so this stays testable
 * without a DOM. Row 0 is the face the glyphs are baked with, so it is the
 * colour a number element actually shows.
 */
export function clutRow(cluts, kind, row = 0) {
  return cluts?.[String(kind)]?.rows?.[String(row)] ?? null;
}

/** Row 0 of the number face -- the amber the original draws HP and MP in. */
export function numberClutRow(cluts = map?.cluts, row = 0) {
  return clutRow(cluts, NUMBER_FONT_KIND, row);
}

/**
 * Which sheet drawText() paints a string from: the font's own CLUT row
 * (`clut`, the widget's +0xC0), or a flat `color` tint of the whole sheet.
 * Pure, so the decision is testable without a canvas.
 */
export function glyphPaint(opts = {}) {
  const { kind = 1, clut = 0, color = null } = opts;
  return color ? { source: "tint", color } : { source: "font", kind, clut };
}

/** Bake a copy of the sheet with this kind's CLUT offset applied. */
function sheetForClut(kind, clut) {
  if (!clut) return img;
  const key = `${kind}:${clut}`;
  if (clutSheets[key]) return clutSheets[key];
  const src = map.cluts?.[String(kind)]?.rows?.["0"];
  const dst = map.cluts?.[String(kind)]?.rows?.[String(clut)];
  if (!src || !dst || !img) return img;
  const density = assetImageScale(img);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0, c.width, c.height);
  const data = x.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const from = new Map();
  for (let i = 0; i < src.length; i++) {
    const s = src[i];
    if (!s[3]) continue;
    from.set(`${s[0]},${s[1]},${s[2]}`, dst[i]);
  }
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const n = from.get(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    if (!n) continue;
    px[i] = n[0]; px[i + 1] = n[1]; px[i + 2] = n[2]; px[i + 3] = n[3];
  }
  x.putImageData(data, 0, 0);
  clutSheets[key] = tagAssetSource(c, density);
  return clutSheets[key];
}

function sheetFor(color) {
  if (!color) return img;
  if (!tinted[color]) {
    const c = document.createElement("canvas");
    const density = assetImageScale(img);
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, c.width, c.height);
    x.globalCompositeOperation = "source-in";
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    tinted[color] = tagAssetSource(c, density);
  }
  return tinted[color];
}

function glyphFor(kind, ch) {
  const c = map.chars[ch];
  if (!c) return null;
  const tbl = c.t === "b" ? "basic" : "ext";
  const k = map.kinds[String(kind)] ?? map.kinds["1"];
  // Symbol glyphs (arrows, PS buttons, stat icons) only exist in the kind-1
  // face's extended table — fall back there rather than dropping the glyph.
  return k[tbl][String(c.i)] ?? map.kinds["1"][tbl][String(c.i)] ?? null;
}

// The game's own lang-file codec (ddw3 codepoint.rs) writes 2-byte glyphs as
// bracket tokens in the extracted TOML strings — "[arrow-right]" (the menu
// cursor, esitshop string 12), "[triangle]"/"[circle]"/... (PS button icons).
// Those tokens ARE keys in map.chars; split text into per-glyph units so they
// resolve instead of being drawn character-by-character. A few unicode aliases
// let call sites write the arrow directly.
const ALIASES = {
  "▶": "[arrow-right]", "◀": "[arrow-left]", "▲": "[arrow-up]", "▼": "[arrow-down]",
  "△": "[triangle]", "◯": "[circle]", "○": "[circle]", "□": "[square]", "✕": "[cross]",
};
function units(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "[") {
      const end = text.indexOf("]", i);
      if (end > i) {
        const tok = text.slice(i, end + 1);
        if (map.chars[tok]) { out.push(tok); i = end; continue; }
      }
    }
    out.push(ALIASES[ch] ?? ch);
  }
  return out;
}

/** Width in unscaled pixels of `text` at `kind`. */
// Pen advance per glyph = dx + adv (measured off dri_s2/s3 captures: letters
// dx=1 step adv+1, space dx=0 steps exactly adv; the record's draw offset
// shifts the pen too).
function advanceOf(g) {
  return (g.dx || 0) + (g.adv || g.w + 1);
}

export function textWidth(text, kind = 1) {
  if (!fontReady()) return text.length * 7;
  let w = 0;
  for (const ch of units(text)) {
    const g = glyphFor(kind, ch);
    w += g ? advanceOf(g) : 6;
  }
  return w;
}

/**
 * Draw text with the real font. y is the TOP of the line (glyph dy applied).
 * opts: { kind = 1, clut = 0 (widget +0xC0 / unk138), scale = 1,
 *         color = null (native CLUT) | css color,
 *         alignRight = false (x is then the RIGHT edge — numeric widgets) }.
 * Returns the advance width actually used (scaled).
 *
 * `color` is a flat tint of the whole sheet and exists only for text the
 * original never draws (debug overlays). A widget the original builds gets its
 * colour from `clut`, which is +0xC0: pass nothing for the face's own row.
 */
export function drawText(ctx, text, x, y, opts = {}) {
  // TRIGGER AUDIT HOOK. A headless run sets globalThis.__uiTextTrace to a Set
  // and every string the game actually draws lands in it, so a decoded text id
  // that renders NOWHERE becomes measurable instead of assumed. Costs one
  // undefined check when the trace is off, which is always in play.
  if (globalThis.__uiTextTrace) globalThis.__uiTextTrace.add(String(text));
  const { kind = 1, clut = 0, scale = 1, color = null, alignRight = false, cellWidth = null, glyphMetrics = null } = opts;
  if (alignRight) x -= textWidth(text, kind) * scale;
  if (!fontReady()) {
    ctx.fillStyle = color ?? "#e8e8f0";
    ctx.font = `${Math.round(11 * scale)}px monospace`;
    ctx.fillText(text, x, y + 11 * scale);
    return ctx.measureText(text).width;
  }
  const paint = glyphPaint(opts);
  const sheet = paint.source === "tint" ? sheetFor(paint.color) : sheetForClut(paint.kind, paint.clut);
  ctx.imageSmoothingEnabled = false;
  let cx = x;
  for (const ch of units(text)) {
    const source = glyphFor(kind, ch);
    const g = source && glyphMetrics ? { ...source, ...glyphMetrics(map.chars[ch]) } : source;
    if (!g) { cx += (cellWidth ?? 6) * scale; continue; }
    if (g.w > 0 && g.h > 0) {
      ctx.drawImage(sheet, g.x, g.y, g.w, g.h,
        cx + (g.dx || 0) * scale, y + (g.dy || 0) * scale, g.w * scale, g.h * scale);
    }
    cx += (cellWidth ?? advanceOf(g)) * scale;
  }
  return cx - x;
}

/** Draw a named icon glyph (str/def/.../dark). Returns false until loaded. */
export function drawIconGlyph(ctx, name, x, y, scale = 1) {
  if (!fontReady()) return false;
  const r = map.icons?.[name];
  if (!r) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, r.x, r.y, r.w, r.h, x, y, r.w * scale, r.h * scale);
  return true;
}

// ── The list cursor ───────────────────────────────────────────────────────────
// The pause menu's cursor is not a static glyph and not a sprite. F0x8001b364
// builds a widget whose only job is to own a text child and swap its string;
// F0x8001b0a4 drives that swap on a five-step cycle: it rests `unk74` = 32
// vsyncs on frame 0, then steps every `unk78` = 6 vsyncs through frames 1..4
// and back to the rest frame. The five strings are the pointer table at
// D0x8004dce0 (entry 4 repeats entry 2), and they resolve to the four
// contiguous cursor glyphs the game's own codec names [enter], [enter2],
// [select] and [space2] — a small solid triangle, a large solid triangle, a
// short bar, and nothing. The bar frame matches the cursor in
// docs/research/ui/captures/pause-overlay-home-2026-08-20.png pixel for pixel.
//
// This is NOT "[arrow-right]" (extended glyph 54, the tailed arrow). That one
// is the SHOP's cursor, which is a literal character inside esitshop string 12.
export const CURSOR_FRAMES = Object.freeze(
  ["[enter]", "[enter2]", "[select]", "[space2]", "[select]"]);
export const CURSOR_REST_VSYNC = 32;   // F0x8001b364 unk74
export const CURSOR_STEP_VSYNC = 6;    // F0x8001b364 unk78
const CURSOR_CYCLE_VSYNC = CURSOR_REST_VSYNC + CURSOR_STEP_VSYNC * 4;

/** The cursor glyph token for a whole-cycle position measured in vsyncs. */
export function cursorFrame(vsyncs) {
  const k = ((Math.floor(vsyncs) % CURSOR_CYCLE_VSYNC) + CURSOR_CYCLE_VSYNC)
    % CURSOR_CYCLE_VSYNC;
  if (k < CURSOR_REST_VSYNC) return CURSOR_FRAMES[0];
  return CURSOR_FRAMES[1 + Math.floor((k - CURSOR_REST_VSYNC) / CURSOR_STEP_VSYNC)];
}

/** Draw the animated list cursor. `vsyncs` is the screen clock in vsyncs. */
export function drawCursor(ctx, vsyncs, x, y, opts = {}) {
  return drawText(ctx, cursorFrame(vsyncs), x, y, opts);
}
