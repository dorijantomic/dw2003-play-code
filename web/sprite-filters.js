// SPRITE FILTERS: pixel-art upscalers for the field sprite sheets, a TEST of which one looks best.
//
// The switch is F2 -> Settings -> "Sprite filter" (ambience.js fx.spriteFilter, default "off": the
// game draws the native sheet exactly as before). sprite-filter-lab.html shows the same filters side
// by side on one sheet. Every filter turns a native sheet into a 4x one; the game tags it with
// density 4 (assets.js) so all frame rectangles stay in native coordinates.

export const SPRITE_FILTERS = {
  off: "Off (original pixels)",
  bilinear: "Plain smooth (bilinear)",
  epx: "EPX / Scale2x, twice",
  mmpx: "MMPX, twice",
  xbr: "xBR 4x, no new colours",
  xbrblend: "xBR 4x, blended",
};

// ── filters: (ImageData native) -> ImageData 4x ───────────────────────────────────────────────
export function nearest4(src) {
  const { width: w, height: h, data } = src, out = new ImageData(w * 4, h * 4);
  for (let y = 0; y < h * 4; y++) for (let x = 0; x < w * 4; x++) {
    const s = ((y >> 2) * w + (x >> 2)) * 4, d = (y * w * 4 + x) * 4;
    out.data[d] = data[s]; out.data[d + 1] = data[s + 1]; out.data[d + 2] = data[s + 2]; out.data[d + 3] = data[s + 3];
  }
  return out;
}

// generic 2x pass over packed RGBA (Uint32), clamp-to-edge neighbours
function pass2x(src, rule) {
  const w = src.width, h = src.height;
  const px = new Uint32Array(src.data.buffer.slice(0));
  const out = new ImageData(w * 2, h * 2), o = new Uint32Array(out.data.buffer);
  const at = (x, y) => px[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [j, k, l, m] = rule(at, x, y);
    o[(2 * y) * 2 * w + 2 * x] = j; o[(2 * y) * 2 * w + 2 * x + 1] = k;
    o[(2 * y + 1) * 2 * w + 2 * x] = l; o[(2 * y + 1) * 2 * w + 2 * x + 1] = m;
  }
  return out;
}

// Scale2x / EPX (A. Mazzoleni): the classic edge rule
function epxRule(at, x, y) {
  const B = at(x, y - 1), D = at(x - 1, y), E = at(x, y), F = at(x + 1, y), H = at(x, y + 1);
  if (B !== H && D !== F) {
    return [D === B ? D : E, B === F ? F : E, D === H ? D : E, H === F ? F : E];
  }
  return [E, E, E, E];
}

// MMPX (McGuire & Gagiu 2021, MIT), ported from the Rust port (mmpx crate 0.2.0, MIT) with every
// neighbour read per pixel (the port reads P and S once per row).  luma = Rec.709 like the port, in integers
// (x10000) so gpu-pixel-filter.js makes exactly the same comparisons.
function luma(c) { return 2126 * (c & 255) + 7152 * ((c >>> 8) & 255) + 722 * ((c >>> 16) & 255); }
function mmpxRule(at, x, y) {
  const A = at(x - 1, y - 1), B = at(x, y - 1), C = at(x + 1, y - 1);
  const D = at(x - 1, y), E = at(x, y), F = at(x + 1, y);
  const G = at(x - 1, y + 1), H = at(x, y + 1), I = at(x + 1, y + 1);
  const P = at(x, y - 2), Q = at(x - 2, y), R = at(x + 2, y), S = at(x, y + 2);
  const Bl = luma(B), Dl = luma(D), El = luma(E), Fl = luma(F), Hl = luma(H);
  const any3 = (b, a0, a1, a2) => b === a0 || b === a1 || b === a2;
  const all2 = (b, a0, a1) => b === a0 && b === a1;
  const all3 = (b, a0, a1, a2) => b === a0 && b === a1 && b === a2;
  const all4 = (b, a0, a1, a2, a3) => b === a0 && b === a1 && b === a2 && b === a3;
  const none2 = (b, a0, a1) => b !== a0 && b !== a1;
  const none4 = (b, a0, a1, a2, a3) => b !== a0 && b !== a1 && b !== a2 && b !== a3;
  let J = E, K = E, L = E, M = E;
  // 1:1 slope rules
  if ((D === B && D !== H && D !== F) && (El >= Dl || E === A) && any3(E, A, C, G) && ((El < Dl) || A !== D || E !== P || E !== Q)) J = D;
  if ((B === F && B !== D && B !== H) && (El >= Bl || E === C) && any3(E, A, C, I) && ((El < Bl) || C !== B || E !== P || E !== R)) K = B;
  if ((H === D && H !== F && H !== B) && (El >= Hl || E === G) && any3(E, A, G, I) && ((El < Hl) || G !== H || E !== S || E !== Q)) L = H;
  if ((F === H && F !== B && F !== D) && (El >= Fl || E === I) && any3(E, C, G, I) && ((El < Fl) || I !== H || E !== R || E !== S)) M = F;
  // intersection rules
  if ((E !== F && all4(E, C, I, D, Q) && all2(F, B, H)) && (F !== at(x + 3, y))) { K = F; M = F; }
  if ((E !== D && all4(E, A, G, F, R) && all2(D, B, H)) && (D !== at(x - 3, y))) { J = D; L = D; }
  if ((E !== H && all4(E, G, I, B, P) && all2(H, D, F)) && (H !== at(x, y + 3))) { L = H; M = H; }
  if ((E !== B && all4(E, A, C, H, S) && all2(B, D, F)) && (B !== at(x, y - 3))) { J = B; K = B; }
  if (Bl < El && all4(E, G, H, I, S) && none4(E, A, D, C, F)) { J = B; K = B; }
  if (Hl < El && all4(E, A, B, C, P) && none4(E, D, G, I, F)) { L = H; M = H; }
  if (Fl < El && all4(E, A, D, G, Q) && none4(E, B, C, I, H)) { K = F; M = F; }
  if (Dl < El && all4(E, C, F, I, R) && none4(E, B, A, G, H)) { J = D; L = D; }
  // 2:1 slope rules
  if (H !== B) {
    if (H !== A && H !== E && H !== C) {
      if (all3(H, G, F, R) && none2(H, D, at(x + 2, y - 1))) L = M;
      if (all3(H, I, D, Q) && none2(H, F, at(x - 2, y - 1))) M = L;
    }
    if (B !== I && B !== G && B !== E) {
      if (all3(B, A, F, R) && none2(B, D, at(x + 2, y + 1))) J = K;
      if (all3(B, C, D, Q) && none2(B, F, at(x - 2, y + 1))) K = J;
    }
  }
  if (F !== D) {
    if (D !== I && D !== E && D !== C) {
      if (all3(D, A, H, S) && none2(D, B, at(x + 1, y + 2))) J = L;
      if (all3(D, G, B, P) && none2(D, H, at(x + 1, y - 2))) L = J;
    }
    if (F !== E && F !== A && F !== G) {
      if (all3(F, C, H, S) && none2(F, B, at(x - 1, y + 2))) K = M;
      if (all3(F, I, B, P) && none2(F, H, at(x - 1, y - 2))) M = K;
    }
  }
  return [J, K, L, M];
}

// xBR 4x (Hyllian), xbr-js 2.0.1 (MIT), loaded from the CDN only when chosen.  It reads byte 0 of each
// word as red, which is exactly a little-endian ImageData word, so the pixels go in as they are.
let xbr4x = null;
export async function ensureXbr() {
  if (!xbr4x) xbr4x = (await import("https://cdn.jsdelivr.net/npm/xbr-js@2.0.1/dist/xBRjs.esm.js")).xbr4x;
  return xbr4x;
}
export function xbr(src, blendColors) {
  const view = new Uint32Array(src.data.buffer.slice(0));
  const outPx = xbr4x(view, src.width, src.height, { blendColors, scaleAlpha: true });
  return new ImageData(new Uint8ClampedArray(outPx.buffer), src.width * 4, src.height * 4);
}

export const epx4 = (s) => pass2x(pass2x(s, epxRule), epxRule);
export const mmpx4 = (s) => pass2x(pass2x(s, mmpxRule), mmpxRule);

// ── game side: a loaded native sheet -> a 4x Image, cached per sheet and filter ─────────────────
const cache = new WeakMap();          // native image -> Map(filter -> Promise<Image>)

function nativePixels(img) {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

async function run(img, name) {
  const w = img.width, h = img.height, c = document.createElement("canvas");
  c.width = w * 4; c.height = h * 4;
  const g = c.getContext("2d");
  if (name === "bilinear") {
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, w * 4, h * 4);
  } else {
    if (name === "xbr" || name === "xbrblend") await ensureXbr();
    const src = nativePixels(img);
    const out = name === "epx" ? epx4(src) : name === "mmpx" ? mmpx4(src) : xbr(src, name === "xbrblend");
    g.putImageData(out, 0, 0);
  }
  const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
  const out = new Image();
  out.src = URL.createObjectURL(blob);
  await out.decode();
  out.width = w; out.height = h;      // logical size = native; naturalWidth stays 4x (like an HD file)
  return out;
}

/** The 4x filtered copy of a native sheet (Promise<Image>), or null for "off" / an unknown name. */
export function filteredSheet(img, name) {
  if (!img || !SPRITE_FILTERS[name] || name === "off") return null;
  let per = cache.get(img);
  if (!per) cache.set(img, per = new Map());
  if (!per.has(name)) per.set(name, run(img, name));
  return per.get(name);
}
