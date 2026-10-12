// EXPERIMENT: animated 3D-lit water on the 2D overworld maps (three.js).
//
// Same idea as grass3d.js, but water is a surface, not geometry:
//   1. On first visit to a stage, build a soft mask of water-coloured pixels.
//   2. Each frame, one full-view quad is shaded: waves are a sum of directional
//      sines laid out on the *ground plane* (z = mapY / sin(PITCH)), so ripples
//      foreshorten like the map's own isometric view. Their slope bends the
//      painted water's colour (reflection/refraction wobble), and sun glints and
//      a shoreline foam line ride on top.
//   3. game.js draws the result right after the map, before the y-sorted
//      entities, so the party and props stand on top of the water.
import * as THREE from "./lib3d/three.module.min.js";
import { classSource } from "./mapclass.js";

const VIEW_W = 320;
const VIEW_H = 240;
const PX = 2;
const PITCH = (50 * Math.PI) / 180; // must match grass3d.js
const SIN = Math.sin(PITCH);

let renderer = null;
let scene = null;
let camera = null;
let quad = null;
const uniforms = {
    uMap: { value: null },
    uMask: { value: null },
    uCam: { value: new THREE.Vector2() },
    uMapSize: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uRefl: { value: null },
    uReflOn: { value: 1 },
};
const stages = new Map(); // stageId -> { mapTex, maskTex } | null

function ensureRenderer() {
    if (renderer) return true;
    try {
        const canvas = document.createElement("canvas");
        canvas.width = VIEW_W * PX;
        canvas.height = VIEW_H * PX;
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: true });
        renderer.setPixelRatio(1);
        renderer.setSize(VIEW_W * PX, VIEW_H * PX, false);
        renderer.setClearColor(0x000000, 0);
    } catch (e) {
        console.warn("water3d: WebGL unavailable", e);
        renderer = null;
        return false;
    }
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        vertexShader: `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `
            precision highp float;
            uniform sampler2D uMap;
            uniform sampler2D uMask;
            uniform vec2 uCam;
            uniform vec2 uMapSize;
            uniform float uTime;
            uniform sampler2D uRefl;   // distance (px) from each water pixel up to the shore above it
            uniform float uReflOn;
            const float SIN = ${SIN.toFixed(6)};
            const vec2 VIEWPX = vec2(${VIEW_W * PX}.0, ${VIEW_H * PX}.0);
            const float PXS = ${PX}.0;

            // One directional wave: returns slope (d height / d ground x,z).
            vec2 wave(vec2 g, vec2 dir, float lambda, float speed, float amp) {
                float k = 6.2831853 / lambda;
                return normalize(dir) * cos(dot(normalize(dir), g) * k + uTime * speed) * k * amp;
            }

            void main() {
                vec2 mp = vec2(uCam.x + gl_FragCoord.x / PXS,
                               uCam.y + (VIEWPX.y - gl_FragCoord.y) / PXS);
                vec2 uv = mp / uMapSize;
                float m = texture2D(uMask, uv).r;
                if (m < 0.02) discard;

                vec2 g = vec2(mp.x, mp.y / SIN);           // ground-plane coordinates
                vec2 s = vec2(0.0);
                s += wave(g, vec2( 1.0,  0.4), 34.0, 1.3, 1.30);
                s += wave(g, vec2(-0.6,  1.0), 21.0, 1.9, 0.90);
                s += wave(g, vec2( 0.3, -1.0), 13.0, 2.6, 0.55);

                // painted water, bent by the wave slope (refraction wobble)
                vec2 off = s * vec2(1.6, 1.6 * SIN);
                vec3 base = texture2D(uMap, (mp + off) / uMapSize).rgb;

                // lighting from the slope: sun glints + slight shading
                vec3 N = normalize(vec3(-s.x * 0.9, 1.0, -s.y * 0.9));
                vec3 L = normalize(vec3(-0.45, 0.75, 0.50));
                vec3 V = normalize(vec3(0.0, SIN, cos(asin(SIN))));
                float spec = pow(max(dot(reflect(-L, N), V), 0.0), 90.0);
                float glint = smoothstep(0.50, 0.95, spec) * 0.85;
                float shade = 0.93 + 0.14 * dot(N, L);
                float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.07;  // faint sky sheen
                vec3 col = base * shade + vec3(0.55, 0.72, 0.95) * fres
                         + vec3(1.0, 0.97, 0.86) * glint;

                // shoreline reflection: mirror the picture about the shore row above this
                // pixel, wobbled by the waves and fading out away from the bank
                float rd = texture2D(uRefl, uv).r * 255.0;
                if (uReflOn > 0.5 && rd > 1.0) {
                    vec2 rp = vec2(mp.x + s.x * 2.2, mp.y - 2.0 * rd + s.y * 1.4);
                    vec3 rc = texture2D(uMap, rp / uMapSize).rgb;
                    float k = clamp(1.0 - rd / 64.0, 0.0, 1.0) * 0.40;
                    col = mix(col, rc * 0.88 + vec3(0.02, 0.05, 0.10), k);
                }

                // foam hugging the shoreline (the soft edge of the mask)
                float edge = 1.0 - abs(m * 2.0 - 1.0);
                float lap = 0.5 + 0.5 * sin(g.x * 0.55 + g.y * 0.35 + uTime * 2.4
                                            + 3.0 * sin(g.y * 0.21));
                float foam = smoothstep(0.35, 0.95, edge) * (0.35 + 0.65 * lap);
                col = mix(col, vec3(0.93, 0.97, 1.0), foam * 0.38);

                float a = smoothstep(0.02, 0.55, m);
                gl_FragColor = vec4(col * a, a);
            }`,
    });
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    scene.add(quad);
    return true;
}

// Only these maps get water. "Blue pixels" is a poor test on its own: city
// interiors have blue floors and screens (30-43% "water" in Amaterasu City) and
// night variants are tinted blue all over. Each id is listed with its day/night
// variant. Lake of Ice (ice) and the swamps (murky, ~0% blue) are left out for now.
const WATER_STAGES = new Set([
    "s330", "s331",   // Central Park
    "s340", "s341",   // Shell Beach
    "s345", "s346",   // Plug Cape
    "s380", "s381",   // Divermon's Lake
    "s385", "s386",   // Duel Island
    "s495", "s496",   // South Cape
    "s525", "s526",   // Suzaku / Zhu Que UG Lake
    "s560", "s561",   // Pelche Oasis
]);

// Maps whose water is murky GREEN rather than blue. A green rule would put water
// on forest shadows elsewhere (e.g. Wind Prairie), so it is opt-in per stage.
const GREEN_WATER_STAGES = new Set(["s380", "s381"]); // Divermon's Lake

function isWater(r, g, b, greenMode) {
    if (b >= 62 && b > r + 28 && b > g + 6 && r < 150) return true;
    return greenMode && g >= 45 && g <= 150 && g > r + 18
        && b >= g * 0.4 && b <= g * 0.97 && g - b <= 60 && b >= 20;
}

// The water test for one stage, so grass3d.js can keep blades out of water
// with exactly the rule that decides where water is drawn.
export function waterPixelTest(stageId) {
    if (!WATER_STAGES.has(stageId)) return () => false;
    const greenMode = GREEN_WATER_STAGES.has(stageId);
    return (r, g, b) => isWater(r, g, b, greenMode);
}

function boxBlur(src, W, H, rad) {
    const tmp = new Float32Array(W * H);
    const out = new Uint8Array(W * H);
    const win = rad * 2 + 1;
    for (let y = 0; y < H; y++) {            // horizontal
        let acc = 0;
        const row = y * W;
        for (let x = -rad; x <= rad; x++) acc += src[row + Math.min(W - 1, Math.max(0, x))];
        for (let x = 0; x < W; x++) {
            tmp[row + x] = acc / win;
            acc += src[row + Math.min(W - 1, x + rad + 1)] - src[row + Math.max(0, x - rad)];
        }
    }
    for (let x = 0; x < W; x++) {            // vertical
        let acc = 0;
        for (let y = -rad; y <= rad; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
        for (let y = 0; y < H; y++) {
            out[y * W + x] = Math.round(acc / win);
            acc += tmp[Math.min(H - 1, y + rad + 1) * W + x] - tmp[Math.max(0, y - rad) * W + x];
        }
    }
    return out;
}

// clsImg decides WHERE the water is (the base map for a day/night variant);
// the shader draws it over mapImg, the map on screen, so it keeps that palette.
function buildStage(stageId, mapImg, clsImg) {
    const W = mapImg.naturalWidth, H = mapImg.naturalHeight;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(clsImg, 0, 0);
    const data = cx.getImageData(0, 0, W, H).data;
    const raw = new Uint8Array(W * H);
    let count = 0;
    const greenMode = GREEN_WATER_STAGES.has(stageId);
    for (let i = 0, p = 0; p < W * H; p++, i += 4) {
        if (isWater(data[i], data[i + 1], data[i + 2], greenMode)) { raw[p] = 255; count++; }
    }
    // ignore specks: need at least ~0.4% of the map to be water
    if (count < W * H * 0.004) return null;
    const mask = boxBlur(boxBlur(raw, W, H, 2), W, H, 2);   // soft shoreline
    // for the reflection: how far each water pixel is below the nearest shore pixel above it
    const refl = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) {
        let land = -1;
        for (let y = 0; y < H; y++) {
            const q = y * W + x;
            if (raw[q]) { if (land >= 0) refl[q] = Math.min(255, y - land); } else land = y;
        }
    }
    const reflTex = new THREE.DataTexture(refl, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    reflTex.minFilter = reflTex.magFilter = THREE.LinearFilter;
    reflTex.unpackAlignment = 1;
    reflTex.flipY = false;
    reflTex.needsUpdate = true;
    const maskTex = new THREE.DataTexture(mask, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    maskTex.minFilter = maskTex.magFilter = THREE.LinearFilter;
    maskTex.unpackAlignment = 1;
    maskTex.flipY = false;
    maskTex.needsUpdate = true;
    const mapTex = new THREE.Texture(mapImg);
    mapTex.minFilter = mapTex.magFilter = THREE.LinearFilter;
    mapTex.generateMipmaps = false;
    mapTex.flipY = false;
    mapTex.needsUpdate = true;
    console.log(`water3d: ${stageId} -> ${(100 * count / (W * H)).toFixed(1)}% water`);
    return { mapTex, maskTex, reflTex, maskData: mask, W, H };
}

// Returns the hidden canvas (VIEW_W*PX by VIEW_H*PX, camera-relative) or null.
export function renderWater(stageId, mapImg, camX, camY, timeSec) {
    if (!WATER_STAGES.has(stageId)) return null;
    if (!(mapImg instanceof Image) || !mapImg.complete || !mapImg.naturalWidth) return null;
    if (!ensureRenderer()) return null;
    let st = stages.get(stageId);
    if (st === undefined) {
        const cls = classSource(stageId, mapImg);
        if (!cls) return null;                 // variant list / base map still loading
        st = buildStage(stageId, mapImg, cls);
        stages.set(stageId, st);
    }
    if (!st) return null;
    uniforms.uMap.value = st.mapTex;
    uniforms.uMask.value = st.maskTex;
    uniforms.uRefl.value = st.reflTex;
    uniforms.uReflOn.value = window.__noWaterRefl ? 0 : 1;
    uniforms.uMapSize.value.set(st.W, st.H);
    uniforms.uCam.value.set(camX, camY);
    uniforms.uTime.value = timeSec;
    renderer.render(scene, camera);
    return renderer.domElement;
}

export const WATER_VIEW = { w: VIEW_W, h: VIEW_H, px: PX };

// Is this map pixel water (so wading can ripple)? False until the stage has been drawn once.
export function isWaterAt(stageId, x, y) {
    const st = stages.get(stageId);
    if (!st) return false;
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= st.W || yi >= st.H) return false;
    return st.maskData[yi * st.W + xi] > 140;
}

// Is this one of the maps that gets the water shader (so real water, not blue paving)?
export function isWaterStage(stageId) { return WATER_STAGES.has(stageId); }
