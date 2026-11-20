// web/partner-pictures.js — the turning picture of a new partner (roster slots 8..).
//
// The disc's eight partners have 32x32 pictures in the status pack (ststat clips 0..28) that the
// pause STATUS cards, the Digimon Lab and the fight report draw. The new partners have none, so
// the engine numbers theirs from 0x400 (engine/dw3/ui/digimon-picture.ts: 0x400 + (slot-8)*0x10 +
// frame, frames 0,1,2,1). This module paints them from the partner's own field sprite
// (web/extra_partners.json): the idle clip facing down-left, like the disc's pictures, three
// frames spread over the idle loop, shrunk to fit the 32x32 cell with the feet on its bottom line.
import { newPartnerOfSlot } from "./vendor/engine.js";

const BASE = 0x400;
const LAST = 0x47f;
const CELL = 32;
const FRAMES = 3;

const records = new Map(); // charId -> extra_partners.json record
const cache = new Map();   // slot -> { canvas } | { pending: true } | { none: true }
let loading = null;

function loadRecords() {
  if (loading) return loading;
  loading = (typeof fetch === "function" ? fetch("extra_partners.json") : Promise.reject())
    .then((r) => (r.ok ? r.json() : { characters: [] }))
    .then((j) => { for (const rec of j.characters ?? []) records.set(rec.id, rec); })
    .catch(() => {});
  return loading;
}

/** True for a picture number the engine gives a new partner. */
export function isPartnerPicture(id) {
  return Number.isInteger(id) && id >= BASE && id <= LAST;
}

function build(slot) {
  const partner = newPartnerOfSlot(slot);
  const rec = partner ? records.get(partner.charId) : null;
  const idle = rec?.art && rec.clips?.["1"]?.["down-left"];
  if (!idle || !rec.clipSheet || typeof Image === "undefined") { cache.set(slot, { none: true }); return; }
  cache.set(slot, { pending: true });
  const img = new Image();
  img.onload = () => {
    const fw = rec.clipFrameW, fh = rec.clipFrameH;
    const perRow = Math.max(1, Math.floor(img.width / fw));
    const cols = idle.cols;
    const picks = Array.from({ length: FRAMES }, (_, i) => cols[Math.floor((i * cols.length) / FRAMES)]);
    // the frames' common opaque box, so all three are cut and shrunk alike
    const src = document.createElement("canvas");
    src.width = fw * FRAMES; src.height = fh;
    const sc = src.getContext("2d");
    picks.forEach((c, i) => sc.drawImage(img, (c % perRow) * fw, Math.floor(c / perRow) * fh, fw, fh, i * fw, 0, fw, fh));
    const px = sc.getImageData(0, 0, src.width, fh).data;
    let x0 = fw, x1 = -1, y0 = fh, y1 = -1;
    for (let y = 0; y < fh; y++) for (let x = 0; x < src.width; x++) {
      if (px[(y * src.width + x) * 4 + 3] < 16) continue;
      const lx = x % fw;
      if (lx < x0) x0 = lx; if (lx > x1) x1 = lx; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) { cache.set(slot, { none: true }); return; }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const k = Math.min(1, (CELL - 2) / bh, (CELL - 2) / bw);
    const dw = Math.max(1, Math.round(bw * k)), dh = Math.max(1, Math.round(bh * k));
    const out = document.createElement("canvas");
    out.width = CELL * FRAMES; out.height = CELL;
    const oc = out.getContext("2d");
    oc.imageSmoothingEnabled = false;
    for (let i = 0; i < FRAMES; i++) {
      oc.drawImage(src, i * fw + x0, y0, bw, bh, i * CELL + Math.floor((CELL - dw) / 2), CELL - 1 - dh, dw, dh);
    }
    cache.set(slot, { canvas: out });
  };
  img.onerror = () => cache.set(slot, { none: true });
  img.src = rec.clipSheet;
}

/**
 * Paint picture `id` with its top-left at (x, y), as a 32x32 status-pack clip is. Returns false
 * while the sprite is still loading or when the partner has no sprite yet (the cell stays empty,
 * as before).
 */
export function drawPartnerPicture(ctx, id, x, y) {
  if (!isPartnerPicture(id)) return false;
  const slot = 8 + ((id - BASE) >> 4);
  const frame = (id - BASE) & 0xf;
  const entry = cache.get(slot);
  if (!entry) {
    cache.set(slot, { pending: true });
    loadRecords().then(() => build(slot));
    return false;
  }
  if (!entry.canvas) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(entry.canvas, (frame % FRAMES) * CELL, 0, CELL, CELL, x, y, CELL, CELL);
  return true;
}

/** Start loading the pictures early (the first screen that asks then has them). */
export function preloadPartnerPictures() {
  return loadRecords().then(() => {
    for (let slot = 8; slot < 16; slot++) if (newPartnerOfSlot(slot) && !cache.has(slot)) build(slot);
  });
}
