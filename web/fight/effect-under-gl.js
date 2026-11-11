// The "under the fighters" half of the op3 sprite effects, drawn inside the GL pass.
//
// The original (sprite_anim.c:13-45, sprite_effect.c:432-438) draws every op3 effect except
// 1000-1002 and 1007 into the fighters' own ordering table, and a sprite spawned at z == -1 lands
// at depth 0xFFF, BEFORE every fighter polygon: the effect sits over the stage and under the
// Digimon. The 2D canvas of web/battle.js sits over the whole GL frame, so those sprites have to
// be drawn here, between the backdrop and the fighters (effectLayer() in effect-player.js picks them).
//
// No depth test, no depth write. Blends are the PS1 ones, done natively:
//   opaque = none   semi 0 = 0.5B + 0.5F   semi 1 = B + F   semi 2 = B - F   semi 3 = B + 0.25F
// The placement comes from spriteGeometry()/spriteCorners() in effect-player.js, the same maths the
// 2D pass (drawEffects) uses.
import { effectClip, spriteGeometry, spriteCorners } from "./effect-player.js";

const VS = "attribute vec2 aP; attribute vec2 aT; varying vec2 vT; void main(){ vT = aT; gl_Position = vec4(aP, 0.0, 1.0); }";
// Same sampling as drawEffects: the UV is clamped inside the clip rect (the source rect of drawImage never
// reads the neighbouring sheet cells) and the texel colour is weighted by its own alpha through the
// blend (SRC_ALPHA), which is what the canvas does with premultiplied pixels. uK = the mode's constant
// (semi 0 = 0.5, semi 3 = 0.25, else 1). Transparent texels (alpha 0) write nothing.
const FS = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n"
  + "uniform sampler2D uTex; uniform vec4 uBox; uniform float uK; varying vec2 vT; "
  + "void main(){ vec4 c = texture2D(uTex, clamp(vT, uBox.xy, uBox.zw)); if (c.a <= 0.0) discard; gl_FragColor = vec4(c.rgb, c.a * uK); }";

const perGl = new WeakMap();     // gl -> { prog, aP, aT, uTex, buf, tex: WeakMap(image -> texture) }

function resources(gl) {
  let r = perGl.get(gl);
  if (r) return r;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("effect-under shader: " + gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("effect-under link: " + gl.getProgramInfoLog(prog));
  r = {
    prog,
    aP: gl.getAttribLocation(prog, "aP"), aT: gl.getAttribLocation(prog, "aT"),
    uTex: gl.getUniformLocation(prog, "uTex"),
    uBox: gl.getUniformLocation(prog, "uBox"), uK: gl.getUniformLocation(prog, "uK"),
    buf: gl.createBuffer(),
    tex: new WeakMap(),
  };
  perGl.set(gl, r);
  return r;
}

function textureFor(gl, r, img) {
  let t = r.tex.get(img);
  if (t) return t;
  t = gl.createTexture();
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  const prevPre = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPre);
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  r.tex.set(img, t);
  return t;
}

/**
 * GL blend state for a PS1 semi-transparency mode (clip.semi), with the fragment alpha = texel alpha * K
 * (K = blendConstant(semi)). Matches the canvas result of drawEffects per texel:
 *   opaque = source-over   0 = 0.5B + 0.5F*a   1 = B + F*a   2 = B - F*a   3 = B + 0.25F*a
 * Opaque keeps the frame alpha (ONE, ONE_MINUS_SRC_ALPHA on alpha); the semi modes never write alpha.
 */
export function applySemiBlend(gl, semi) {
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  if (semi === 0) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  else if (semi === 2) { gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); }
  else if (semi === 1 || semi === 3) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}

/** The constant the fragment alpha is multiplied by for a semi mode. */
export function blendConstant(semi) { return semi === 0 ? 0.5 : semi === 3 ? 0.25 : 1; }

function drawRect(gl, r, tex, img, rect, corners, W, H) {
  const px = ([x, y]) => [x / W * 2 - 1, 1 - y / H * 2];
  const u0 = rect.x / img.width, v0 = rect.y / img.height;
  const u1 = (rect.x + rect.w) / img.width, v1 = (rect.y + rect.h) / img.height;
  const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  // sampling stays half a texel inside the rect, like the source-rect clamp of drawImage
  gl.uniform4f(r.uBox, u0 + 0.5 / img.width, v0 + 0.5 / img.height, u1 - 0.5 / img.width, v1 - 0.5 / img.height);
  const v = [];
  for (const i of [0, 1, 2, 0, 2, 3]) v.push(...px(corners[i]), ...uv[i]);
  gl.bindBuffer(gl.ARRAY_BUFFER, r.buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(r.aP, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(r.aT, 2, gl.FLOAT, false, 16, 8);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

/**
 * Draw `list` (descriptors already filtered to the "under" sprites) into the current GL frame.
 * W,H = drawing-buffer size, the same px the view maps to. Leaves the GL state as it found it.
 * Returns the number of sprites drawn.
 */
export function drawUnderEffects(gl, list, manifest, images, view, W, H) {
  if (!list?.length) return 0;
  const r = resources(gl);
  const prev = {
    prog: gl.getParameter(gl.CURRENT_PROGRAM),
    buf: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
    tex: gl.getParameter(gl.TEXTURE_BINDING_2D),
    active: gl.getParameter(gl.ACTIVE_TEXTURE),
    blend: gl.isEnabled(gl.BLEND), depth: gl.isEnabled(gl.DEPTH_TEST), cull: gl.isEnabled(gl.CULL_FACE),
    mask: gl.getParameter(gl.COLOR_WRITEMASK),
    dMask: gl.getParameter(gl.DEPTH_WRITEMASK),
    aOn: [gl.getVertexAttrib(r.aP, gl.VERTEX_ATTRIB_ARRAY_ENABLED), gl.getVertexAttrib(r.aT, gl.VERTEX_ATTRIB_ARRAY_ENABLED)],
  };
  gl.useProgram(r.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(r.uTex, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);
  gl.enableVertexAttribArray(r.aP);
  gl.enableVertexAttribArray(r.aT);
  let drawn = 0;
  for (const s of list) {
    const arch = manifest.archives[String(s.arch)];
    const img = images[String(s.arch)];
    if (!arch || !img) continue;
    const clip = effectClip(arch, s);
    if (!clip || !clip.w || !clip.h) continue;
    const g = spriteGeometry(s, clip, view);
    if (!g) continue;
    const tex = textureFor(gl, r, img);
    const corners = spriteCorners(g);
    // semi modes blend colour only: B - F must not drive the frame's alpha to 0
    gl.colorMask(true, true, true, clip.semi !== 0 && clip.semi !== 1 && clip.semi !== 2 && clip.semi !== 3);
    applySemiBlend(gl, clip.semi);
    gl.uniform1f(r.uK, blendConstant(clip.semi));
    drawRect(gl, r, tex, img, clip, corners, W, H);
    // texels with the STP bit clear are drawn solid inside the same sprite (see drawEffects)
    if (clip.solid) {
      gl.colorMask(true, true, true, true);
      applySemiBlend(gl, undefined);
      gl.uniform1f(r.uK, 1);
      drawRect(gl, r, tex, img, clip.solid, corners, W, H);
    }
    drawn++;
  }
  if (!prev.aOn[0]) gl.disableVertexAttribArray(r.aP);
  if (!prev.aOn[1]) gl.disableVertexAttribArray(r.aT);
  gl.colorMask(prev.mask[0], prev.mask[1], prev.mask[2], prev.mask[3]);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  (prev.blend ? gl.enable : gl.disable).call(gl, gl.BLEND);
  (prev.depth ? gl.enable : gl.disable).call(gl, gl.DEPTH_TEST);
  (prev.cull ? gl.enable : gl.disable).call(gl, gl.CULL_FACE);
  gl.depthMask(prev.dMask);
  gl.bindTexture(gl.TEXTURE_2D, prev.tex);
  gl.activeTexture(prev.active);
  gl.bindBuffer(gl.ARRAY_BUFFER, prev.buf);
  gl.useProgram(prev.prog);
  return drawn;
}
