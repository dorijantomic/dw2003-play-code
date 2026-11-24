// web/world-globe-reveal.js -- what the World Globe reveals, by the disc MAP page's own rules (web/menu/draw-map.ts,
// engine/dw3/ui/native/pause-map.ts; the rules are read in web/menu/pure.ts mapGlobeReveal):
// - land: the disc draws its dark base map and, per AREA (22 per server) in the reveal tier's list, that area's patch. The
//   globe lays a dark drifting mist over every area that is not in the list; the listed ones are clear. An area newly in
//   the list since the last MAP open fades in (REVEAL.fadeSec) when the globe first draws.
// - icons: a place's icon shows only when its visited flag is set (F0x8009A6B8); your own place always shows. The zoom only
//   goes into shown places (web/world-globe-zoom.ts nearestTarget).
// Where each area lies on the globe is the reveal mask, web/assets/world-globe/<REVEAL.maskFile> (git-ignored, made by the
// scratch tool world-globe/reveal/make_mask.py from each area patch's own alpha, mapped into the globe texture's layout):
// per texel the two areas covering it most and how much (soft edges, RevealMaskPixels). The mist amount at a point =
// the bilinear mix of the four nearest texels' sum of weight x (1 - that area's reveal value); the shader
// (REVEAL_FRAG_HEAD / REVEAL_FRAG_MIX, put into the globe's material by web/world-globe-view.ts) does the same maths as
// mistAt / mistAlpha here, which the node tests (tests/world-globe-reveal.test.js) run on the real mask.
// No DOM, no three.js.
import type { GlobeReveal, GlobeServer, RevealMaskPixels } from "./types/world-globe-map.js";

/** The reveal's numbers (the rules are the disc's; the look is chosen). */
export const REVEAL = Object.freeze({
    /** the mask file in the globe asset folder, and its size (texels) */
    maskFile: "reveal_mask.png",
    maskW: 2048,
    maskH: 1024,
    /** areas per server; a mask id is server index x 22 + area (Asuka 1..22, Amaterasu 23..44), 0 = none */
    areas: 22,
    /** seconds a newly revealed area takes to clear */
    fadeSec: 1.5,
    /** mist alpha where an area is fully covered: FLOOR at the noise's darkest, 1 at its brightest (the land stays hidden) */
    alphaFloor: 0.94,
    /** how far the drifting noise pushes the soft edge in / out (share of the edge's own 0..1 ramp) */
    edgeNoise: 0.35,
    /** mist colours (sRGB 0..255): deep haze, from the globe sea's (27,36,70) darkened, and its lighter drifting wisps */
    deep: Object.freeze([14, 19, 36] as const),
    light: Object.freeze([66, 78, 108] as const),
    /** noise: frequency per globe radius and drift (globe radii a second) of the two layers */
    freq: 7,
    drift: Object.freeze([0.021, 0.008, -0.015] as const),
});

const SERVER_INDEX: Readonly<Record<GlobeServer, number>> = { asuka: 0, amaterasu: 1 };
const SERVERS: readonly GlobeServer[] = ["asuka", "amaterasu"];
/** reveal values: index 0 (no area) and every area id */
export const REVEAL_SLOTS = 2 * REVEAL.areas + 1;

/** the mask id of one server's area (1..22) */
export function revealId(server: GlobeServer, area: number): number {
    return SERVER_INDEX[server] * REVEAL.areas + area;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (t: number): number => { const c = clamp01(t); return c * c * (3 - 2 * c); };

/** A reveal that shows everything (the dev page's "show all", and a globe opened without a reveal). */
export function revealAll(): GlobeReveal {
    const none: Record<GlobeServer, readonly number[]> = { asuka: [], amaterasu: [] };
    return { tier: 4, areas: none, visited: none, fadeIn: none, all: true };
}

/** Each area's reveal value (1 = clear, 0 = under mist) `sec` seconds after the fade began (Infinity = done; the areas in
 *  `fadeIn` ease from 0 to 1 over REVEAL.fadeSec, the other listed ones are clear at once). Index = revealId; index 0 = 1. */
export function revealValues(reveal: GlobeReveal, sec: number): Float32Array {
    const out = new Float32Array(REVEAL_SLOTS);
    out[0] = 1;
    if (reveal.all) { out.fill(1); return out; }
    const k = smooth(sec / REVEAL.fadeSec);
    for (const s of SERVERS) {
        const fading = new Set(reveal.fadeIn[s]);
        for (const a of reveal.areas[s]) {
            if (!(Number.isInteger(a) && a >= 1 && a <= REVEAL.areas)) continue;
            out[revealId(s, a)] = fading.has(a) ? k : 1;
        }
    }
    return out;
}

/** Is a place's icon shown: visited (or "show all"), and your own place always. */
export function iconShown(reveal: GlobeReveal, server: GlobeServer, record: number, own: { server: GlobeServer | null; record: number } | null): boolean {
    if (reveal.all) return true;
    if (own && own.server === server && own.record === record) return true;
    return reveal.visited[server].includes(record);
}

/** one mask texel's mist: weight 1 x (1 - value of id 1) + weight 2 x (1 - value of id 2), at most 1 */
function texelMist(mask: RevealMaskPixels, values: ArrayLike<number>, x: number, y: number): number {
    const i = (y * mask.w + x) * 4, d = mask.data;
    const id1 = Math.min(REVEAL_SLOTS - 1, d[i] ?? 0), id2 = Math.min(REVEAL_SLOTS - 1, d[i + 1] ?? 0);
    const w2 = (d[i + 2] ?? 0) / 255, w1 = (d[i + 3] ?? 0) / 255;
    return Math.min(1, w1 * (1 - (values[id1] ?? 1)) + w2 * (1 - (values[id2] ?? 1)));
}

/** The mist amount (0..1) at sphere texture point (u, v) (three.js uv: v = 1 north): the bilinear mix of the four nearest
 *  texels (longitude wraps, latitude clamps). The shader's revealMist does the same. */
export function mistAt(mask: RevealMaskPixels, values: ArrayLike<number>, u: number, v: number): number {
    const x = (u - Math.floor(u)) * mask.w - 0.5, y = (1 - v) * mask.h - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const col = (c: number): number => ((c % mask.w) + mask.w) % mask.w;
    const row = (r: number): number => Math.min(mask.h - 1, Math.max(0, r));
    const t = (c: number, r: number): number => texelMist(mask, values, col(c), row(r));
    const top = t(x0, y0) * (1 - fx) + t(x0 + 1, y0) * fx;
    const bottom = t(x0, y0 + 1) * (1 - fx) + t(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
}

/** The mist's opacity for amount m (mistAt) and the drifting noise n (0..1): the noise moves the soft edge (only where
 *  0 < m < 1) and shades the full mist between REVEAL.alphaFloor and 1. m = 0 gives 0; m = 1 gives at least alphaFloor. */
export function mistAlpha(m: number, n: number): number {
    const e = 4 * m * (1 - m);
    return clamp01(m + (n - 0.5) * REVEAL.edgeNoise * e) * (REVEAL.alphaFloor + (1 - REVEAL.alphaFloor) * clamp01(n));
}

// ---- the shader (the globe's MeshBasicMaterial gets it in web/world-globe-view.ts) ----
// uRevealMask = the mask (texelFetch, no filtering), uReveal = revealValues, vRevealUv / vRevealPos = the sphere's uv and
// object-space point (radius 1). The mist colour mixes REVEAL.deep and REVEAL.light by a second noise layer; it is
// multiplied by the material colour, so it fades out with the globe when the zoom fades it (world-globe-zoom-view.ts).

const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

/** the vertex shader's additions: the declarations, and the line after <begin_vertex> */
export const REVEAL_VERT_HEAD = /* glsl */`
varying vec2 vRevealUv;
varying vec3 vRevealPos;`;
export const REVEAL_VERT_MAIN = /* glsl */`
vRevealUv = uv;
vRevealPos = position;`;

/** the fragment shader's declarations and functions */
export const REVEAL_FRAG_HEAD = /* glsl */`
uniform sampler2D uRevealMask;
uniform float uReveal[${REVEAL_SLOTS}];
uniform float uRevealTime;
uniform vec3 uMistDeep;
uniform vec3 uMistLight;
varying vec2 vRevealUv;
varying vec3 vRevealPos;
float revealTexel(int x, int y) {
    ivec2 sz = ivec2(${REVEAL.maskW}, ${REVEAL.maskH});
    x = ((x % sz.x) + sz.x) % sz.x;
    y = clamp(y, 0, sz.y - 1);
    vec4 m = texelFetch(uRevealMask, ivec2(x, y), 0);
    int i1 = min(int(m.r * 255.0 + 0.5), ${REVEAL_SLOTS - 1});
    int i2 = min(int(m.g * 255.0 + 0.5), ${REVEAL_SLOTS - 1});
    return min(1.0, m.a * (1.0 - uReveal[i1]) + m.b * (1.0 - uReveal[i2]));
}
float revealMist(vec2 uv) {
    vec2 p = vec2(fract(uv.x) * ${glslFloat(REVEAL.maskW)}, (1.0 - uv.y) * ${glslFloat(REVEAL.maskH)}) - 0.5;
    vec2 p0 = floor(p), f = p - p0;
    int x0 = int(p0.x), y0 = int(p0.y);
    float top = mix(revealTexel(x0, y0), revealTexel(x0 + 1, y0), f.x);
    float bottom = mix(revealTexel(x0, y0 + 1), revealTexel(x0 + 1, y0 + 1), f.x);
    return mix(top, bottom, f.y);
}
float revealHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float revealNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(revealHash(i), revealHash(i + vec3(1, 0, 0)), f.x), mix(revealHash(i + vec3(0, 1, 0)), revealHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(revealHash(i + vec3(0, 0, 1)), revealHash(i + vec3(1, 0, 1)), f.x), mix(revealHash(i + vec3(0, 1, 1)), revealHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float revealFbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int k = 0; k < 4; k++) { s += a * revealNoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
    return s / 0.9375;
}
float revealAlpha(float m, float n) {
    float e = 4.0 * m * (1.0 - m);
    return clamp(m + (n - 0.5) * ${glslFloat(REVEAL.edgeNoise)} * e, 0.0, 1.0) * (${glslFloat(REVEAL.alphaFloor)} + ${glslFloat(1 - REVEAL.alphaFloor)} * clamp(n, 0.0, 1.0));
}`;

/** the fragment shader's line after <map_fragment>: the mist over diffuseColor */
export const REVEAL_FRAG_MIX = /* glsl */`
{
    float mistM = revealMist(vRevealUv);
    if (mistM > 0.0005) {
        vec3 drift = vec3(${REVEAL.drift.map(glslFloat).join(", ")}) * uRevealTime;
        vec3 q = vRevealPos * ${glslFloat(REVEAL.freq)};
        vec3 warp = vec3(revealNoise(q * 0.5 + drift * 3.0), revealNoise(q * 0.5 + vec3(5.2, 1.3, 7.7) - drift * 2.0), revealNoise(q * 0.5 + vec3(2.9, 8.1, 4.4))) - 0.5;
        float n = revealFbm(q + drift * ${glslFloat(REVEAL.freq)} + warp * 1.2);
        float wisp = revealFbm(q * 1.7 - drift * ${glslFloat(REVEAL.freq * 1.3)} + vec3(11.0, 3.0, 7.0));
        vec3 mistCol = mix(uMistDeep, uMistLight, smoothstep(0.42, 0.85, wisp) * 0.85) * diffuse;
        diffuseColor.rgb = mix(diffuseColor.rgb, mistCol, revealAlpha(mistM, n));
    }
}`;
