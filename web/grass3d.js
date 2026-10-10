// EXPERIMENT: real 3D grass (three.js) on the 2D overworld maps.
//
// The field maps are flat pre-rendered pictures, so there is nothing to put 3D
// grass *into*. Instead:
//   1. On first visit to a stage, scan its map image for grass-coloured pixels
//      and scatter blade instances there (each blade takes the colour of the
//      painted grass under it, so it matches the art).
//   2. Each frame, render the visible blades with an orthographic camera that
//      is pitched like the map's own isometric view, onto a hidden canvas.
//   3. game.js pastes that canvas into its y-sorted draw list in thin
//      horizontal strips, so the player walks behind blades that are nearer
//      the camera and in front of ones that are farther.
//
// Map pixel (px, py) <-> world: x = px, z = py / sin(PITCH), y = up.
// Screen y (down) of a world point = z*sin(PITCH) - y*cos(PITCH), which is what
// the OrthographicCamera below produces, so a blade planted at (px, py) lands
// exactly on that map pixel and a blade h tall rises h*cos(PITCH) pixels.
import * as THREE from "./lib3d/three.module.min.js";

const VIEW_W = 320;          // map pixels visible (game draws at ZOOM 2)
const VIEW_H = 240;
const PX = 2;                // device pixels per map pixel (matches ZOOM)
const PITCH = (50 * Math.PI) / 180; // view direction below the horizon
const SIN = Math.sin(PITCH);
const COS = Math.cos(PITCH);
const BAND_H = 128;          // map rows per instanced mesh (for culling)
const CELL = 5;              // jittered placement grid, map pixels
const BLADES_PER_CELL = 3;
const MAX_BLADE_H = 20;      // world units, for band culling margin

let renderer = null;
let scene = null;
let camera = null;
let uTime = { value: 0 };
let material = null;
const stages = new Map();    // stageId -> { bands: [{mesh, y0, y1}], count } | null

function ensureRenderer() {
    if (renderer) return true;
    try {
        const canvas = document.createElement("canvas");
        canvas.width = VIEW_W * PX;
        canvas.height = VIEW_H * PX;
        renderer = new THREE.WebGLRenderer({
            canvas, alpha: true, antialias: true, premultipliedAlpha: true,
        });
        renderer.setPixelRatio(1);
        renderer.setSize(VIEW_W * PX, VIEW_H * PX, false);
        renderer.setClearColor(0x000000, 0);
    } catch (e) {
        console.warn("grass3d: WebGL unavailable", e);
        renderer = null;
        stages.set("__fail", null);
        return false;
    }
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(0, VIEW_W, 0, -VIEW_H, -1e5, 1e5);
    camera.rotation.x = -PITCH;
    material = new THREE.ShaderMaterial({
        uniforms: { uTime },
        side: THREE.DoubleSide,
        vertexShader: `
            attribute vec3 iPos;    // blade base in world space
            attribute vec4 iData;   // yaw, height, width, wind phase
            attribute vec3 iColor;  // painted grass colour under the blade
            uniform float uTime;
            varying vec3 vColor;
            void main() {
                float t = position.y;                         // 0 base .. 1 tip
                float h = iData.y;
                float w = iData.z * (1.0 - 0.92 * t);         // taper to a point
                vec3 p = vec3(position.x * w, t * h, 0.0);
                float gust = sin(uTime * 2.2 + iPos.x * 0.04 + iPos.z * 0.025 + iData.w)
                           + 0.4 * sin(uTime * 4.1 + iData.w * 3.0);
                float bend = t * t * h;
                p.x += bend * (0.18 + 0.30 * gust);           // sway
                p.z += bend * 0.22;                           // lean toward camera
                p.y -= bend * 0.10;                           // arc over
                float c = cos(iData.x), s = sin(iData.x);
                p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
                gl_Position = projectionMatrix * viewMatrix * vec4(iPos + p, 1.0);
                // dark at the root, lit at the tip; faces turned away read darker
                vColor = iColor * mix(0.55, 1.18, t) * (0.9 + 0.1 * c);
            }`,
        fragmentShader: `
            varying vec3 vColor;
            void main() { gl_FragColor = vec4(vColor, 1.0); }`,
    });
    return true;
}

// One blade: a ribbon of SEG quads, x in [-0.5, 0.5], y in [0, 1].
function bladeGeometry() {
    const SEG = 4;
    const pos = [];
    const idx = [];
    for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        pos.push(-0.5, t, 0, 0.5, t, 0);
        if (i < SEG) {
            const a = i * 2;
            idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
}

// Deterministic PRNG so a stage's grass is identical every visit.
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
        return s / 4294967296;
    };
}

function isGrass(r, g, b) {
    return g >= 105 && g > r * 1.22 && g > b * 1.7 && g - b >= 55;
}

function buildStage(stageId, mapImg) {
    const W = mapImg.naturalWidth, H = mapImg.naturalHeight;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(mapImg, 0, 0);
    const data = cx.getImageData(0, 0, W, H).data;
    const rand = rng(stageId.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7));

    const bandCount = Math.ceil(H / BAND_H);
    const perBand = Array.from({ length: bandCount }, () => []);
    let total = 0;
    const sample = (x, y) => {
        x = Math.min(W - 1, Math.max(0, x | 0));
        y = Math.min(H - 1, Math.max(0, y | 0));
        const o = (y * W + x) * 4;
        return [data[o], data[o + 1], data[o + 2]];
    };
    for (let cy = 0; cy < H; cy += CELL) {
        for (let cxp = 0; cxp < W; cxp += CELL) {
            // a cell is grass only if its centre and two nearby probes all are
            const m = [sample(cxp + 2, cy + 2), sample(cxp, cy), sample(cxp + 4, cy + 4)];
            if (!m.every((p) => isGrass(p[0], p[1], p[2]))) continue;
            for (let k = 0; k < BLADES_PER_CELL; k++) {
                const px = cxp + rand() * CELL;
                const py = cy + rand() * CELL;
                const [r, g, b] = sample(px, py);
                if (!isGrass(r, g, b)) continue;
                const vary = 0.85 + rand() * 0.35;
                perBand[Math.min(bandCount - 1, (py / BAND_H) | 0)].push(
                    px, 0, py / SIN,                                  // iPos
                    rand() * Math.PI, 9 + rand() * 9, 2.2 + rand() * 1.6, rand() * 6.28, // iData
                    (r / 255) * vary, (g / 255) * vary * 1.05, (b / 255) * vary,        // iColor
                );
                total++;
            }
        }
    }

    const bands = [];
    for (let i = 0; i < bandCount; i++) {
        const arr = perBand[i];
        if (!arr.length) continue;
        const n = arr.length / 10;
        const geo = bladeGeometry();
        const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(arr), 10);
        geo.setAttribute("iPos", new THREE.InterleavedBufferAttribute(buf, 3, 0));
        geo.setAttribute("iData", new THREE.InterleavedBufferAttribute(buf, 4, 3));
        geo.setAttribute("iColor", new THREE.InterleavedBufferAttribute(buf, 3, 7));
        geo.instanceCount = n;
        const mesh = new THREE.Mesh(geo, material);
        mesh.frustumCulled = false;
        mesh.visible = false;
        scene.add(mesh);
        bands.push({ mesh, y0: i * BAND_H, y1: (i + 1) * BAND_H });
    }
    return { bands, count: total };
}

// Render the grass for the current camera. Returns the hidden canvas (always
// VIEW_W*PX by VIEW_H*PX, camera-relative) or null when there is no grass.
export function renderGrass(stageId, mapImg, camX, camY, timeSec) {
    if (!(mapImg instanceof Image) || !mapImg.complete || !mapImg.naturalWidth) return null;
    if (!ensureRenderer()) return null;
    let st = stages.get(stageId);
    if (st === undefined) {
        st = buildStage(stageId, mapImg);
        if (!st.count) st = null;
        stages.set(stageId, st);
        console.log(`grass3d: ${stageId} -> ${st ? st.count : 0} blades`);
    }
    if (!st) return null;
    // A blade rises up to MAX_BLADE_H*COS pixels above its base, so keep bands
    // whose base rows are within that of the view.
    const top = camY, bottom = camY + VIEW_H;
    let any = false;
    for (const b of st.bands) {
        b.mesh.visible = b.y1 >= top && b.y0 <= bottom + MAX_BLADE_H * COS;
        any = any || b.mesh.visible;
    }
    if (!any) return null;
    camera.left = camX;
    camera.right = camX + VIEW_W;
    camera.top = -camY;
    camera.bottom = -camY - VIEW_H;
    camera.updateProjectionMatrix();
    uTime.value = timeSec;
    renderer.render(scene, camera);
    return renderer.domElement;
}

export const GRASS_VIEW = { w: VIEW_W, h: VIEW_H, px: PX };
