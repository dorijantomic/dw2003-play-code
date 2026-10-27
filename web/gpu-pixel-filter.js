// GPU PIXEL FILTER: EPX, MMPX and xBR as one WebGL2 shader, applied to the WHOLE finished game frame.
//
// The switch is F2 -> Settings -> "Pixel filter" (ambience.js fx.spriteFilter, default "off": nothing
// here runs). When on, like an emulator's shader, every frame:
//   1. the finished game canvas (field, maps, sprites, UI, text, the 3D battle, effects) is copied into
//      a texture and sampled down to the PlayStation's own 320x240 grid (the field canvas is an exact
//      2x of it in Authentic mode);
//   2. the filter makes a 4x picture of that (EPX and MMPX: two 2x passes; xBR: one 4x pass);
//   3. the result is shown on a canvas laid exactly over the game canvas (no pointer events).
// The game's own drawing is never touched, so nothing can move. The HD-2D look (post2d.js) takes this
// filtered frame as its input.
//
// HD Remaster mode: the frame is not on the 320x240 grid (the maps are 4x AI art), so instead each
// NATIVE image (sprites, effects, menus: the art the HD pack keeps native) is filtered once to 4x and
// drawn from that copy, through assets.js's density-aware drawImage (frame rectangles x4, like an HD
// file). Only draws onto the game canvas: hidden helper canvases copy images pixel for pixel and must
// keep the original pixels (filtering them drew black copies of map art, 2026-10-26).
//
// Big images are filtered in tiles of at most 2048 px: a browser may give a WebGL canvas a SMALLER
// drawing buffer than asked (186 maps are over 4096 px at 4x), which shrank and shifted the result
// (2026-10-26, "it moves where I stand"); every tile checks it got the size it asked for.
//
// pixelFilterNow(image, name) runs the same shader on one image (4x, no down-sampling): the lab
// (sprite-filter-lab.html) counts the pixels where it differs from the CPU filters in sprite-filters.js.

export const GPU_FILTER_NAMES = ["bilinear", "epx", "mmpx", "xbr", "xbrblend"];
const NATIVE_W = 320, NATIVE_H = 240;

export function pixelFilterName() {
  try { return (typeof window !== "undefined" && window.__fx?.spriteFilter) || "off"; } catch { return "off"; }
}

const VS = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

// rule 0 = EPX 2x, 1 = MMPX 2x, 2 = xBR 4x (blend = 1: blended), 8 = linear resample, 9 = nearest resample.
// Pixels are handled as 0..255 values like the CPU versions. Image rows run top-down in texel space;
// flip = 1 when drawing into a canvas (whose row 0 is at the bottom).
const FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D src; uniform ivec2 size; uniform ivec2 outSize; uniform int rule; uniform int flip; uniform int blend;
uniform ivec2 off; uniform int tileH;      // the output tile this draw fills
out vec4 o;
vec4 at(int x, int y) { return floor(texelFetch(src, clamp(ivec2(x, y), ivec2(0), size - 1), 0) * 255.0 + 0.5); }

// ---- MMPX helpers
float luma(vec4 c) { return 2126.0 * c.r + 7152.0 * c.g + 722.0 * c.b; }
bool any3(vec4 b, vec4 a0, vec4 a1, vec4 a2) { return b == a0 || b == a1 || b == a2; }
bool all2(vec4 b, vec4 a0, vec4 a1) { return b == a0 && b == a1; }
bool all3(vec4 b, vec4 a0, vec4 a1, vec4 a2) { return b == a0 && b == a1 && b == a2; }
bool all4(vec4 b, vec4 a0, vec4 a1, vec4 a2, vec4 a3) { return b == a0 && b == a1 && b == a2 && b == a3; }
bool none2(vec4 b, vec4 a0, vec4 a1) { return b != a0 && b != a1; }
bool none4(vec4 b, vec4 a0, vec4 a1, vec4 a2, vec4 a3) { return b != a0 && b != a1 && b != a2 && b != a3; }

// ---- xBR 4x (Hyllian), as in xbr-js 2.0.1 (MIT, Josep del Rio) with scaleAlpha on
vec4 E[16];
vec3 yuv(vec4 p) { return vec3(dot(p.rgb, vec3(0.299, 0.587, 0.114)), dot(p.rgb, vec3(-0.168736, -0.331264, 0.5)), dot(p.rgb, vec3(0.5, -0.418688, -0.081312))); }
float df(vec4 A, vec4 B) {
  if (A.a == 0.0 && B.a == 0.0) return 0.0;
  if (A.a == 0.0 || B.a == 0.0) return 1000000.0;
  vec3 d = abs(yuv(A) - yuv(B)); return d.x * 48.0 + d.y * 7.0 + d.z * 6.0;
}
bool eq(vec4 A, vec4 B) {
  if (A.a == 0.0 && B.a == 0.0) return true;
  if (A.a == 0.0 || B.a == 0.0) return false;
  vec3 d = abs(yuv(A) - yuv(B)); return d.x <= 48.0 && d.y <= 7.0 && d.z <= 6.0;
}
vec4 interp(vec4 A, vec4 B, float q1, float q2) {
  vec3 rgb = A.a == 0.0 ? B.rgb : (B.a == 0.0 ? A.rgb : (q2 * B.rgb + q1 * A.rgb) / (q1 + q2));
  return floor(vec4(rgb, (q2 * B.a + q1 * A.a) / (q1 + q2)));
}
vec4 b64(vec4 d, vec4 s) { return blend == 1 ? interp(d, s, 3.0, 1.0) : d; }
vec4 b128(vec4 d, vec4 s) { return blend == 1 ? interp(d, s, 1.0, 1.0) : d; }
vec4 b192(vec4 d, vec4 s) { return blend == 1 ? interp(d, s, 1.0, 3.0) : s; }
float sh(float v, int k) { return float(int(v) * k); }       // the JS "<< 1" / "<< 2" (integer, truncated)
void kernel(vec4 pe, vec4 pi, vec4 ph, vec4 pf, vec4 pg, vec4 pc, vec4 pd, vec4 pb, vec4 f4, vec4 i4, vec4 h5, vec4 i5,
            int n15, int n14, int n11, int n3, int n7, int n10, int n13, int n12) {
  if (!(pe != ph && pe != pf)) return;
  float e = df(pe, pc) + df(pe, pg) + df(pi, h5) + df(pi, f4) + sh(df(ph, pf), 4);
  float i = df(ph, pd) + df(ph, i5) + df(pf, i4) + df(pf, pb) + sh(df(pe, pi), 4);
  vec4 px = df(pe, pf) <= df(pe, ph) ? pf : ph;
  if (e < i && ((!eq(pf, pb) && !eq(ph, pd)) || (eq(pe, pi) && !eq(pf, i4) && !eq(ph, i5)) || eq(pe, pg) || eq(pe, pc))) {
    float ke = df(pf, pg), ki = df(ph, pc);
    bool ex2 = pe != pc && pb != pc, ex3 = pe != pg && pd != pg;
    bool L = sh(ke, 2) <= ki && ex3, U = ke >= sh(ki, 2) && ex2;
    if (L || U) {
      if (L) { E[n15] = px; E[n14] = px; E[n11] = b192(E[n11], px); E[n13] = b192(E[n13], px); E[n12] = b64(E[n12], px); E[n10] = b64(E[n10], px); }
      if (U) { E[n15] = px; E[n14] = b192(E[n14], px); E[n11] = px; E[n3] = b64(E[n3], px); E[n7] = b192(E[n7], px); E[n10] = b64(E[n10], px); }
    } else { E[n15] = px; E[n14] = b128(E[n14], px); E[n11] = b128(E[n11], px); }
  } else if (e <= i) { E[n15] = b128(E[n15], px); }
}

void main() {
  ivec2 d = ivec2(gl_FragCoord.xy);
  if (flip == 1) d.y = tileH - 1 - d.y;
  d += off;
  if (rule == 8) { o = texture(src, (vec2(d) + 0.5) / vec2(outSize)); return; }
  if (rule == 9) {
    ivec2 s = ivec2((vec2(d) + 0.5) * vec2(size) / vec2(outSize));
    o = texelFetch(src, clamp(s, ivec2(0), size - 1), 0);
    return;
  }
  vec4 r;
  if (rule == 2) {
    int x = d.x >> 2, y = d.y >> 2;
    vec4 a1 = at(x - 1, y - 2), b1 = at(x, y - 2), c1 = at(x + 1, y - 2);
    vec4 a0 = at(x - 2, y - 1), pa = at(x - 1, y - 1), pb = at(x, y - 1), pc = at(x + 1, y - 1), c4 = at(x + 2, y - 1);
    vec4 d0 = at(x - 2, y), pd = at(x - 1, y), pe = at(x, y), pf = at(x + 1, y), f4 = at(x + 2, y);
    vec4 g0 = at(x - 2, y + 1), pg = at(x - 1, y + 1), ph = at(x, y + 1), pi = at(x + 1, y + 1), i4 = at(x + 2, y + 1);
    vec4 g5 = at(x - 1, y + 2), h5 = at(x, y + 2), i5 = at(x + 1, y + 2);
    for (int k = 0; k < 16; k++) E[k] = pe;
    kernel(pe, pi, ph, pf, pg, pc, pd, pb, f4, i4, h5, i5, 15, 14, 11, 3, 7, 10, 13, 12);
    kernel(pe, pc, pf, pb, pi, pa, ph, pd, b1, c1, f4, c4, 3, 7, 2, 0, 1, 6, 11, 15);
    kernel(pe, pa, pb, pd, pc, pg, pf, ph, d0, a0, b1, a1, 0, 1, 4, 12, 8, 5, 2, 3);
    kernel(pe, pg, pd, ph, pa, pi, pb, pf, h5, g5, d0, g0, 12, 8, 13, 15, 14, 9, 4, 0);
    r = E[(d.y & 3) * 4 + (d.x & 3)];
  } else {
    int x = d.x >> 1, y = d.y >> 1, qx = d.x & 1, qy = d.y & 1;
    vec4 B = at(x, y - 1), D = at(x - 1, y), E0 = at(x, y), F = at(x + 1, y), H = at(x, y + 1);
    vec4 J = E0, K = E0, L = E0, M = E0;
    if (rule == 0) {
      if (B != H && D != F) { J = D == B ? D : E0; K = B == F ? F : E0; L = D == H ? D : E0; M = H == F ? F : E0; }
    } else {
      vec4 E = E0;
      vec4 A = at(x - 1, y - 1), C = at(x + 1, y - 1), G = at(x - 1, y + 1), I = at(x + 1, y + 1);
      vec4 P = at(x, y - 2), Q = at(x - 2, y), R = at(x + 2, y), S = at(x, y + 2);
      float Bl = luma(B), Dl = luma(D), El = luma(E), Fl = luma(F), Hl = luma(H);
      if ((D == B && D != H && D != F) && (El >= Dl || E == A) && any3(E, A, C, G) && ((El < Dl) || A != D || E != P || E != Q)) J = D;
      if ((B == F && B != D && B != H) && (El >= Bl || E == C) && any3(E, A, C, I) && ((El < Bl) || C != B || E != P || E != R)) K = B;
      if ((H == D && H != F && H != B) && (El >= Hl || E == G) && any3(E, A, G, I) && ((El < Hl) || G != H || E != S || E != Q)) L = H;
      if ((F == H && F != B && F != D) && (El >= Fl || E == I) && any3(E, C, G, I) && ((El < Fl) || I != H || E != R || E != S)) M = F;
      if ((E != F && all4(E, C, I, D, Q) && all2(F, B, H)) && (F != at(x + 3, y))) { K = F; M = F; }
      if ((E != D && all4(E, A, G, F, R) && all2(D, B, H)) && (D != at(x - 3, y))) { J = D; L = D; }
      if ((E != H && all4(E, G, I, B, P) && all2(H, D, F)) && (H != at(x, y + 3))) { L = H; M = H; }
      if ((E != B && all4(E, A, C, H, S) && all2(B, D, F)) && (B != at(x, y - 3))) { J = B; K = B; }
      if (Bl < El && all4(E, G, H, I, S) && none4(E, A, D, C, F)) { J = B; K = B; }
      if (Hl < El && all4(E, A, B, C, P) && none4(E, D, G, I, F)) { L = H; M = H; }
      if (Fl < El && all4(E, A, D, G, Q) && none4(E, B, C, I, H)) { K = F; M = F; }
      if (Dl < El && all4(E, C, F, I, R) && none4(E, B, A, G, H)) { J = D; L = D; }
      if (H != B) {
        if (H != A && H != E && H != C) {
          if (all3(H, G, F, R) && none2(H, D, at(x + 2, y - 1))) L = M;
          if (all3(H, I, D, Q) && none2(H, F, at(x - 2, y - 1))) M = L;
        }
        if (B != I && B != G && B != E) {
          if (all3(B, A, F, R) && none2(B, D, at(x + 2, y + 1))) J = K;
          if (all3(B, C, D, Q) && none2(B, F, at(x - 2, y + 1))) K = J;
        }
      }
      if (F != D) {
        if (D != I && D != E && D != C) {
          if (all3(D, A, H, S) && none2(D, B, at(x + 1, y + 2))) J = L;
          if (all3(D, G, B, P) && none2(D, H, at(x + 1, y - 2))) L = J;
        }
        if (F != E && F != A && F != G) {
          if (all3(F, C, H, S) && none2(F, B, at(x - 1, y + 2))) K = M;
          if (all3(F, I, B, P) && none2(F, H, at(x - 1, y - 2))) M = K;
        }
      }
    }
    r = qy == 0 ? (qx == 0 ? J : K) : (qx == 0 ? L : M);
  }
  o = r / 255.0;
}`;

// ── one WebGL2 pipeline on a given canvas ──────────────────────────────────────────────────────
function createPipeline(canvas) {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true });
  if (!gl) return null;
  const sh = (type, text) => {
    const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const u = Object.fromEntries(["src", "size", "outSize", "rule", "flip", "blend", "off", "tileH"].map((n) => [n, gl.getUniformLocation(prog, n)]));
  const fb = gl.createFramebuffer();
  const texs = new Map();          // reusable intermediate textures, by "w x h"
  const newTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    // LINEAR only matters to rule 8; every other rule reads exact texels with texelFetch
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    return t;
  };
  const input = newTex();
  const scratch = (w, h, slot) => {
    const key = `${slot}:${w}x${h}`;
    if (!texs.has(key)) {
      const t = newTex();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      texs.set(key, t);
    }
    return texs.get(key);
  };
  // one pass: read `tex` (w x h), write the `outW x outH` result into `target` (a texture, whole) or,
  // with target null, the part `tile` of it into the canvas
  const pass = (tex, w, h, rule, outW, outH, target, blend = 0, tile = { x: 0, y: 0, w: outW, h: outH }) => {
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? fb : null);
    if (target) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, tile.w, tile.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.src, 0); gl.uniform2i(u.size, w, h); gl.uniform2i(u.outSize, outW, outH);
    gl.uniform1i(u.rule, rule); gl.uniform1i(u.flip, target ? 0 : 1); gl.uniform1i(u.blend, blend);
    gl.uniform2i(u.off, tile.x, tile.y); gl.uniform1i(u.tileH, tile.h);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const upload = (source) => {
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return input;
  };
  // the 4x filter of a w x h texture, drawn into the canvas tile by tile (at most TILE px a side);
  // emit(tile) is called after each tile is drawn. False = the browser gave a smaller buffer than asked.
  const TILE = 2048;
  const filter4 = (tex, w, h, name, emit = () => {}) => {
    const W = w * 4, H = h * 4;
    let src = tex, sw = w, sh = h, rule = 2, blend = name === "xbrblend" ? 1 : 0;
    if (name === "bilinear") rule = 8;
    else if (name === "epx" || name === "mmpx") {
      rule = name === "epx" ? 0 : 1;
      src = scratch(w * 2, h * 2, "mid"); sw = w * 2; sh = h * 2;
      pass(tex, w, h, rule, sw, sh, src);
    }
    const c = gl.canvas;
    for (let y = 0; y < H; y += TILE) for (let x = 0; x < W; x += TILE) {
      const tile = { x, y, w: Math.min(TILE, W - x), h: Math.min(TILE, H - y) };
      if (c.width !== tile.w) c.width = tile.w;
      if (c.height !== tile.h) c.height = tile.h;
      if (gl.drawingBufferWidth !== tile.w || gl.drawingBufferHeight !== tile.h) return false;
      pass(src, sw, sh, rule, W, H, null, blend, tile);
      emit(tile);
    }
    return true;
  };
  return { gl, pass, upload, scratch, filter4, max: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
}

const makeCanvas = (w, h) => (typeof OffscreenCanvas !== "undefined"
  ? new OffscreenCanvas(w, h)
  : Object.assign(document.createElement("canvas"), { width: w, height: h }));

// ── one image, 4x (the lab) ────────────────────────────────────────────────────────────────────
let imagePipe;
/** Filter one image: a 4x canvas, or null (unknown filter, no WebGL2, too big). */
export function pixelFilterNow(source, name) {
  if (!GPU_FILTER_NAMES.includes(name) || !source) return null;
  const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
  if (imagePipe === undefined) {
    try { imagePipe = createPipeline(makeCanvas(1, 1)); } catch (error) { console.warn("[pixel filter]", error); imagePipe = null; }
  }
  // the input and the 2x middle step are textures and must fit the GPU's texture size
  if (!imagePipe || !(w > 0 && h > 0) || w * 2 > imagePipe.max || h * 2 > imagePipe.max) return null;
  const canvas = imagePipe.gl.canvas;
  const out = makeCanvas(w * 4, h * 4), g = out.getContext("2d");
  const ok = imagePipe.filter4(imagePipe.upload(source), w, h, name,
    (t) => g.drawImage(canvas, 0, 0, t.w, t.h, t.x, t.y, t.w, t.h));
  canvas.width = 1; canvas.height = 1;      // give the drawing buffer back
  if (!ok) console.warn("[pixel filter] the browser gave a smaller drawing buffer than asked; image left native");
  return ok ? out : null;
}

// ── HD Remaster: native images, filtered once, drawn from the 4x copy ─────────────────────────
const screens = new WeakSet();
let imageMode = () => false;
const cache = new WeakMap();      // image -> Map(name -> canvas | null)
const queue = [];
let pumping = false;
function pump() {
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < 6) {
    const [image, name] = queue.shift();
    let out = null;
    try { out = pixelFilterNow(image, name); } catch (error) { console.warn("[pixel filter]", error); }
    cache.get(image).set(name, out);
  }
  if (queue.length) requestAnimationFrame(pump); else pumping = false;
}

/** assets.js's drawImage wrapper: the 4x filtered canvas for a native <img> drawn onto the game canvas
 * in HD Remaster mode, or null (draw it as it is). The first draw queues it and draws native. */
export function pixelFiltered(image, target) {
  if (!screens.has(target) || !imageMode()) return null;
  const name = pixelFilterName();
  if (!GPU_FILTER_NAMES.includes(name)) return null;
  if (typeof HTMLImageElement === "undefined" || !(image instanceof HTMLImageElement)) return null;
  if (!image.complete || !image.naturalWidth) return null;
  let per = cache.get(image);
  if (!per) cache.set(image, per = new Map());
  if (per.has(name)) return per.get(name);
  per.set(name, null);
  queue.push([image, name]);
  if (!pumping) { pumping = true; requestAnimationFrame(pump); }
  return null;
}

// ── the whole frame (the game) ─────────────────────────────────────────────────────────────────
let frameCanvas = null;          // the filtered frame while the filter runs, else null
/** post2d.js reads the frame from here when the pixel filter is on (so HD-2D sits on top of it). */
export function pixelFilteredFrame() { return frameCanvas; }

/** Install the filter for the game canvas. `isHd()` true = HD Remaster: native images are filtered one
 * by one; false = Authentic: the whole frame is filtered. */
export function installPixelFilter(stageEl, gameCanvas, isHd = () => false) {
  if (!stageEl || !gameCanvas) return;
  screens.add(gameCanvas);
  imageMode = isHd;
  const allowed = () => !isHd();
  const ov = document.createElement("canvas");
  ov.id = "pixel-filter";
  ov.style.cssText = "position:absolute;pointer-events:none;display:none;border:none;border-radius:0;background:transparent;max-width:none;max-height:none;z-index:2";
  stageEl.appendChild(ov);
  let pipe = null, failed = false;
  function frame() {
    requestAnimationFrame(frame);
    const name = pixelFilterName();
    const on = GPU_FILTER_NAMES.includes(name) && !failed && allowed() && !gameCanvas.hidden && gameCanvas.width > 0;
    if (!on) { frameCanvas = null; if (ov.style.display !== "none") ov.style.display = "none"; return; }
    if (!pipe) {
      try { pipe = createPipeline(ov); } catch (error) { console.warn("[pixel filter]", error); }
      if (!pipe) { failed = true; return; }
    }
    if (ov.width !== NATIVE_W * 4 || ov.height !== NATIVE_H * 4) { ov.width = NATIVE_W * 4; ov.height = NATIVE_H * 4; }
    const s = stageEl.getBoundingClientRect(), r = gameCanvas.getBoundingClientRect();
    ov.style.left = (r.left - s.left + gameCanvas.clientLeft) + "px"; ov.style.top = (r.top - s.top + gameCanvas.clientTop) + "px";
    ov.style.width = gameCanvas.clientWidth + "px"; ov.style.height = gameCanvas.clientHeight + "px";
    // the HD-2D look draws its own overlay from this frame; ours then stays hidden under it
    ov.style.display = window.__fx?.hd2d ? "none" : "block";
    const tex = pipe.upload(gameCanvas);
    const native = pipe.scratch(NATIVE_W, NATIVE_H, "native");
    pipe.pass(tex, gameCanvas.width, gameCanvas.height, 9, NATIVE_W, NATIVE_H, native);
    pipe.filter4(native, NATIVE_W, NATIVE_H, name);      // 1280x960: one tile, straight into the overlay
    frameCanvas = ov;
  }
  requestAnimationFrame(frame);
}
