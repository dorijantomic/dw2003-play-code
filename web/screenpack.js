// web/screenpack.js — shared renderer for the decoded screen packs
// (tools/extract_screen_packs.py → assets/ui/<name>_sheet.png/json).
//
// A pack's json maps clip id → { semi, layers: [{frame, x,y,w,h, dx,dy}] }
// (ststat wraps that under .ids and adds .portraits/.backdrop; both shapes are
// accepted). Clips are pre-composed multi-layer window/backdrop art straight
// from the game's own *cs sprite directories — draw back-to-front with the
// authored dx/dy offsets. See docs/research/ui/menu-assets-decoded-2026-07-03.md.

import { loadAssetImage } from "./assets.js";

const packs = {}; // name -> { img, map, ids, patterns }

// Packs whose source data is not present in this checkout, so no
// `<name>_sheet.*` can exist. Requesting one would 404 and, under a strict
// console-error harness, fail an unrelated screen's check. cntselwn used to be
// here (the local splat's tm half was empty); it is now extracted from the
// disc by tools/extract_screen_packs.py DISC_SPLIT_PACKS, so it is no longer
// absent. Keep this list explicit rather than catching 404s: a pack missing for
// any OTHER reason should still be visible.
const ABSENT_PACKS = new Set();

export function loadPack(name) {
  if (packs[name]) return packs[name];
  // patterns is keyed by clip id, not one per pack: sttrng3 alone holds eight
  // different scrolling walls (0x2d..0x34, one per training ground), so a
  // single cached pattern would draw the wrong cave.
  const p = { img: null, map: null, ids: null, patterns: {} };
  packs[name] = p;
  if (ABSENT_PACKS.has(name)) return p;
  // Guarded so pure-logic modules that import screen-pack-drawing helpers
  // (but only call them from browser draw code) stay importable under
  // `node --test` (no DOM/Image/fetch there) — same pattern as uifont.js.
  if (typeof Image === "undefined") return p;
  loadAssetImage(`assets/ui/${name}_sheet.png`)
    .then((im) => { p.img = im; })
    .catch(() => {});
  fetch(`assets/ui/${name}_sheet.json`).then((r) => r.json()).then((j) => {
    p.map = j;
    p.ids = j.ids ?? j;
  }).catch(() => {});
  return p;
}

export function packReady(p) { return !!(p.img && p.ids); }

/**
 * The native pixel size of clip `id`, taken from the sheet's own layer records.
 * Used by the battle HUD read-out so a check can ask what the player actually sees
 * in a rectangle rather than only which cel was asked for.
 */
export function clipSize(p, id) {
  const clip = p?.ids?.[String(id)];
  if (!clip || !Array.isArray(clip.layers)) return null;
  let w = 0, h = 0;
  for (const l of clip.layers) {
    w = Math.max(w, (l.dx | 0) + (l.w | 0));
    h = Math.max(h, (l.dy | 0) + (l.h | 0));
  }
  return { w, h };
}

/** Draw clip `id` of pack `p` with its top-left at (x, y). Native pixels × scale. */
export function drawClip(ctx, p, id, x, y, scale = 1) {
  const clip = p.ids?.[String(id)];
  if (!clip || !p.img) return false;
  ctx.imageSmoothingEnabled = false;
  // The PS1 blends a textured primitive per texel: the pack record's `semi`
  // only selects the ABR mode, and a texel blends only when its palette entry
  // has the STP bit set. The extractor records `stp` = "any visible texel has
  // STP"; a clip without it (older sheets) keeps the old whole-sprite blend.
  const semi = clip.semi ?? -1;
  const blend = semi >= 0 && clip.stp !== false;
  if (blend) {
    // clip.semi = the pack's own PS1 ABR blend mode (same mapping as
    // web/effects.js drawSprite): 0 = B/2+F/2, 1 = B+F, 2 = B-F, 3 = B+F/4.
    ctx.save();
    if (semi === 1) ctx.globalCompositeOperation = "lighter";
    else if (semi === 2) ctx.globalCompositeOperation = "difference";
    else if (semi === 3) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.25; }
    else ctx.globalAlpha = 0.5;
  }
  for (const l of clip.layers) {
    ctx.drawImage(p.img, l.x, l.y, l.w, l.h,
      x + l.dx * scale, y + l.dy * scale, l.w * scale, l.h * scale);
  }
  if (blend) ctx.restore();
  return true;
}

/**
 * Draw clip `id` of pack `p` at (x, y), native pixels × scale, WITHOUT the
 * record's ABR blend — the raw atlas art.
 *
 * The dialogue balloon's chrome clips (CMFONTCS 0..6) carry `semi=2`/`stp=true`
 * in the sheet, which `drawClip` renders as a whole-clip difference blend. The
 * reference capture `web/assets/ref/s415_bulbmon_dialogue_ref.png` (a real PS1
 * frame) shows them painted OPAQUE: the balloon body fill lands on screen as
 * exactly the palette's `rgb(216,232,248)`, and the tail (clip 3) as its own
 * `(160,208,208)/(120,160,168)/(88,112,120)` — never a difference blend. So the
 * tail asks for the raw art. See
 * docs/research/ui/dialogue-window-placement-decoded-2026-07-02.md.
 */
export function drawClipOpaque(ctx, p, id, x, y, scale = 1) {
  const clip = p?.ids?.[String(id)];
  if (!clip || !p.img) return false;
  ctx.imageSmoothingEnabled = false;
  for (const l of clip.layers) {
    ctx.drawImage(p.img, l.x, l.y, l.w, l.h,
      x + l.dx * scale, y + l.dy * scale, l.w * scale, l.h * scale);
  }
  return true;
}

/**
 * Draw clip `id` cropped to `width` native pixels, keeping native pixel size
 * (the source rectangle is clipped, never scaled). Used by the DV/Blast gauge,
 * whose sprite is an authored 40x8 fill revealed up to the gauge's own width.
 */
export function drawClipWidth(ctx, p, id, x, y, width) {
  const clip = p.ids?.[String(id)];
  if (!clip || !p.img || !(width > 0)) return false;
  ctx.imageSmoothingEnabled = false;
  // The PS1 blends a textured primitive per texel: the pack record's `semi`
  // only selects the ABR mode, and a texel blends only when its palette entry
  // has the STP bit set. The extractor records `stp` = "any visible texel has
  // STP"; a clip without it (older sheets) keeps the old whole-sprite blend.
  const semi = clip.semi ?? -1;
  const blend = semi >= 0 && clip.stp !== false;
  if (blend) {
    ctx.save();
    if (semi === 1) ctx.globalCompositeOperation = "lighter";
    else if (semi === 2) ctx.globalCompositeOperation = "difference";
    else if (semi === 3) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.25; }
    else ctx.globalAlpha = 0.5;
  }
  for (const l of clip.layers) {
    const w = Math.min(l.w, Math.max(0, Math.round(width)));
    if (w <= 0) continue;
    ctx.drawImage(p.img, l.x, l.y, w, l.h, x + l.dx, y + l.dy, w, l.h);
  }
  if (blend) ctx.restore();
  return true;
}

/**
 * The id of clip `id` drawn at palette row shift `row`.
 *
 * A HIGHLIGHT IN THIS GAME IS NOT A SECOND PICTURE. The screen draws the SAME
 * picture with its palette rows shifted down by a number — the picture service
 * carries one shift for the whole draw, and the title menu is the clearest case
 * of it: neither of its two animated pictures is ever redrawn or swapped, only
 * shifted (docs/research/ui/screen-rendering-model.md sections 2 and 9). Any
 * renderer that swaps images to highlight a row is doing something the original
 * does not do.
 *
 * tools/extract_screen_packs.py already cuts those palette variants as extra
 * manifest ids "<id>#<row>", with row 0 being the base id. This is the one
 * place that spelling is written, because eight call sites had spelled it three
 * different ways.
 */
export function paletteClipId(id, row = 0) {
  return row ? `${id}#${row}` : String(id);
}

/**
 * Draw clip `id` at palette row shift `row`. Falls back to the base clip when
 * the variant was never cut, so a screen that asks for a row the extractor does
 * not hold still draws rather than vanishing.
 */
export function drawClipAtPaletteRow(ctx, p, id, row, x, y, scale = 1) {
  const shifted = paletteClipId(id, row);
  if (p.ids?.[shifted]) return drawClip(ctx, p, shifted, x, y, scale);
  return drawClip(ctx, p, id, x, y, scale);
}

/**
 * Draw a pack's full-screen diamond backdrop clip, scrolling. The pre-composed
 * grids are 96×96-period checkers of 48×48 tiles with a -96 margin — because
 * the real backdrop scrolls, at (+0.5,+0.5)px per vsync = 25px/s down-right
 * (PAL 50Hz). One period is baked to an offscreen pattern and translated with
 * time.
 *
 * TEN screens do this, and all ten share one code shape: a counter that is
 * incremented by 1 only on frames where a companion toggle field is already
 * set (so +1 every SECOND frame), reset to 0 rather than ever reaching 0x60,
 * and passed as BOTH x and y of the clip draw — the y argument arriving via a
 * `move_ $a3, $a2` in the jalr delay slot. The full census, with the file line
 * of every part, is data/scrolling_walls.json (tools/extract_scroll_walls.py);
 * docs/research/ui/scrolling-backdrop-walls-2026-08-14.md is the prose. Verified
 * per screen in the original assembly, 2026-08-14 and 2026-10-04:
 *
 *   ststatus 0x1d  @0x00016bd0   status menu     web/status-backdrop.js
 *   stitshop 0x14  @0x00008c44   item shop       web/shop.js
 *   stgdglab 0x37  @0x0000c1b8   DRI lab         web/dri.js
 *   stgmcard 0x1e  @0x00004da8   save            web/save.js
 *   stfgtrep 0x1e  @0x0000210c   fight report    web/battle.js
 *   stcrdabm 0x08  @0x00001910   card album      web/cardalbum.js
 *   stcrddek 0x08  @0x0000628c   card deck       web/carddeck.js
 *   stcrdshp 0x08  @0x000054cc   card shop       web/cardshop.js
 *   stdgname 0x24  @0x00003798   naming          web/nameentry.js
 *   stgtrain  var  @0x00002498   training ground web/gym.js  (clip id is read
 *                                from the state object, one of sttrng3
 *                                0x2d..0x34 per ground, not an immediate)
 *
 * The naming screen's wrap is the SHORT FORM, `slti $v0, 0x5f`
 * (pro/stdgname.s:3545), which is `slti $v0, $v0, 0x5f`; the other nine write
 * `slti $v0, $v1, 0x60`. Same 96 phases, and the first census missed it for a
 * year because it matched one spelling only.
 *
 * The card duel is the one exception and is NOT routed here: its tiles are
 * 64×64 with a 0x40 wrap, and web/cardduel.js already draws it correctly.
 */
export function drawPackBackdrop(ctx, p, clipId, viewW, viewH, timeSec) {
  const grid = p.ids?.[String(clipId)];
  if (!grid || !p.img) return false;
  if (!p.patterns) p.patterns = {};
  const key = String(clipId);
  if (!p.patterns[key]) {
    const cell = {};
    for (const l of grid.layers) cell[`${((l.dx % 96) + 96) % 96},${((l.dy % 96) + 96) % 96}`] = l;
    const off = document.createElement("canvas");
    off.width = off.height = 96;
    const octx = off.getContext("2d");
    for (const k of ["0,0", "48,0", "0,48", "48,48"]) {
      const l = cell[k];
      if (!l) continue;
      const [cx, cy] = k.split(",").map(Number);
      octx.drawImage(p.img, l.x, l.y, l.w, l.h, cx, cy, 48, 48);
    }
    p.patterns[key] = ctx.createPattern(off, "repeat");
  }
  const s = Math.max(viewW / 320, viewH / 240);
  // Screens that keep their own clock pass it; the card screens are draw-only
  // with no per-frame update hook, so they fall back to the wall clock rather
  // than each inventing a timer (web/battle.js already does this for the
  // fight report).
  const t = timeSec ?? (typeof performance !== "undefined" ? performance.now() / 1000 : 0);
  const o = (t * 25 % 96) * s;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(o, o);
  ctx.scale(s, s);
  ctx.fillStyle = p.patterns[key];
  ctx.fillRect(-o / s - 96, -o / s - 96, viewW / s + 192, viewH / s + 192);
  ctx.restore();
  return true;
}
