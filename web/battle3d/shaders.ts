// ─── Shader sources ───────────────────────────────────────────────────────────

export const VERT_SRC = `
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uMVP;
uniform mat4 uSkyM;       // battle atmosphere, arena draw only: model -> world (zero elsewhere)
varying vec2 vUV;
varying float vDepth;
varying vec3 vWorld;
// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
attribute vec3 aNormal;
varying vec3 vNrm;
// SCENE-LIGHT-END
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vUV = aUV;
// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
  vNrm = aNormal;
// SCENE-LIGHT-END
  vDepth = gl_Position.w * 0.001;   // view depth in thousands (battle atmosphere fog)
  vWorld = (uSkyM * vec4(aPos, 1.0)).xyz * 0.001;
}`;

export const FRAG_SRC = `
precision mediump float;
uniform sampler2D uTex;
uniform float uAlpha;
uniform vec4 uTint;
// battle atmosphere (F2, off by default); all zero = the game's own colours
uniform vec3 uGradeSub;   // colour *= 1 - uGradeSub
uniform vec3 uFogCol;
uniform vec3 uFogP;       // fog start, 1 / (end - start), most fog; depths in thousands
uniform vec4 uSky;        // horizon height (thousands), stars, moon, time (s); arena draw only
uniform vec3 uEye;        // camera, thousands
uniform vec3 uMoonDir;
uniform vec2 uWater;      // waves on, ground height band (thousands)
varying vec2 vUV;
varying float vDepth;
varying vec3 vWorld;
// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
uniform float uSLOn;      // 0 = off (the default: nothing below runs)
uniform vec3 uSLDir, uSLCol, uSLAmb;   // light direction (render space), lit and shade multipliers (sRGB)
varying vec3 vNrm;
// SCENE-LIGHT-END
// TOON-BEGIN (F2 "Toon shading", off by default; strip these blocks = the code before toon)
uniform float uToon;      // 0 = off (the default: nothing below runs); 1 = flat cel bands on the Digimon
uniform vec3 uToonDir;    // light direction (render space)
// TOON-END
// SOFTA-BEGIN (F2 "Smooth cut-out edges", off by default; strip these blocks = the code before softa)
uniform vec2 uSoftA;      // x: 0 = off (the default: nothing below runs), 1 = cut-out edge from a blurred alpha; y: tap spacing in UV
// SOFTA-END
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec4 c = texture2D(uTex, vUV) * uTint;
  c.a *= uAlpha;
// SOFTA-BEGIN (F2 "Smooth cut-out edges", off by default; strip these blocks = the code before softa)
  if (uSoftA.x > 0.5) {   // the 4 px alpha staircase of the HD sheet: 3x3 taps of the alpha, kept where the mean >= 0.5
    float sa = 0.0;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) sa += texture2D(uTex, vUV + vec2(float(i), float(j)) * uSoftA.y).a;
    if (sa < 4.5 || uTint.a * uAlpha < 0.05) discard;
    c.a = uTint.a * uAlpha;
  } else
// SOFTA-END
  if (c.a < 0.05) discard;
  vec3 raw = c.rgb;
  float mx = max(raw.r, max(raw.g, raw.b)), mn = min(raw.r, min(raw.g, raw.b));
  float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
  // water: a water-coloured texel on the floor of an arena that has water (tools/measure_arena_sky_water.py)
  bool water = uWater.x > 0.0 && abs(vWorld.y) < uWater.y && sat > 0.25 && mx > 0.2 && raw.b >= raw.r + 0.08 && raw.b >= raw.g * 0.85;
  if (water) {
    vec2 q = vWorld.xz * 3.0;
    float t = uSky.w;
    vec2 wob = vec2(sin(q.y * 2.1 + t * 1.3) + sin(q.x * 1.3 - t * 0.9), cos(q.x * 1.7 + t * 1.1) + sin(q.y * 0.9 + t * 1.6)) * 0.0025;
    vec4 w2 = texture2D(uTex, vUV + wob) * uTint;
    if (w2.a > 0.05) c.rgb = w2.rgb;
    float wave = sin(q.x * 2.3 + q.y * 1.1 + t * 1.7) * sin(q.y * 2.9 - q.x * 0.7 + t * 1.2);
    c.rgb *= 0.92 + 0.12 * wave;
    float glint = pow(max(0.0, wave), 12.0) * uWater.x;
    c.rgb += vec3(glint * 0.55);
  }
// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
  if (uSLOn > 0.5) {
    float nl = length(vNrm);
    float k = nl > 1e-6 ? smoothstep(-0.15, 0.25, dot(vNrm / nl, uSLDir)) : 0.5;
    c.rgb *= mix(uSLAmb, uSLCol, k);
  }
// SCENE-LIGHT-END
// TOON-BEGIN (F2 "Toon shading", off by default; strip these blocks = the code before toon)
  if (uToon > 0.5) {      // 3 hard grey bands (never tinted): the lit band keeps the texture's own colour, whites stay white
    float tl = length(vNrm);
    float td = tl > 1e-6 ? dot(vNrm / tl, uToonDir) : 1.0;
    c.rgb *= td > 0.15 ? 1.0 : (td > -0.35 ? 0.80 : 0.64);
  }
// TOON-END
  c.rgb *= vec3(1.0) - uGradeSub;
  // night sky: stars and the moon on blue sky texels above the horizon, so nearer rock covers them
  if (uSky.y + uSky.z > 0.0 && vWorld.y > uSky.x && sat > 0.15 && mx > 0.3 && raw.b > raw.r + 0.06 && raw.b >= raw.g) {
    vec3 d = normalize(vWorld - uEye);
    vec3 cell = floor(d * 420.0);
    float h = hash3(cell);
    if (h > 0.985) {
      vec3 ctr = (cell + 0.5) / 420.0;
      float r = length(d - ctr) * 420.0;
      float tw = 0.65 + 0.35 * sin(uSky.w * (2.0 + h * 5.0) + h * 40.0);
      c.rgb += vec3(smoothstep(0.45, 0.0, r) * (h - 0.985) / 0.015 * tw * uSky.y);
    }
    float m = dot(d, uMoonDir);
    float disc = smoothstep(0.99955, 0.99975, m);
    float halo = pow(max(0.0, (m - 0.985) / 0.015), 3.0) * 0.35;
    c.rgb = mix(c.rgb, vec3(0.95, 0.94, 0.86), disc * uSky.z);
    c.rgb += vec3(0.55, 0.6, 0.75) * halo * uSky.z;
  }
  c.rgb = mix(c.rgb, uFogCol, clamp((vDepth - uFogP.x) * uFogP.y, 0.0, 1.0) * uFogP.z);
  gl_FragColor = c;
}`;

// TOON-BEGIN (F2 "Toon outlines", off by default; strip these blocks = the code before toon)
// Inverted hull: the fighter's own skinned corners (same VBO the model draws from, so the same bones and animation),
// pushed out along smooth welded normals by uPush * view depth = a constant number of pixels on screen; drawn with the
// faces toward the camera culled, so only the rim around the silhouette shows. Solid near-black #141414.
export const TOON_HULL_VERT_SRC = `
attribute vec3 aPos;
attribute vec2 aUV;
attribute vec3 aNormal;
uniform mat4 uMVP;
uniform float uPush;      // render units per unit of view depth (= outline px * 2 / (viewport height * proj[5]))
varying vec2 vUV;
void main() {
  vec4 c = uMVP * vec4(aPos, 1.0);
  gl_Position = uMVP * vec4(aPos + aNormal * (uPush * c.w), 1.0);
  vUV = aUV;
}`;

export const TOON_HULL_FRAG_SRC = `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uCol;
varying vec2 vUV;
void main() {
  if (texture2D(uTex, vUV).a < 0.05) discard;   // cut-out texels have no outline, as they have no body
  gl_FragColor = vec4(uCol, 1.0);
}`;

// TOON-END
export const VERT_COL_SRC = `
attribute vec3 aPos;
attribute vec4 aColor;
uniform mat4 uMVP;
varying vec4 vColor;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vColor = aColor;
}`;

export const FRAG_COL_SRC = `
precision mediump float;
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}`;
