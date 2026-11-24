// web/world-globe-zoom-view.js -- the three.js side of the World Globe zoom (the dev page web/world-globe.html and the pause
// MAP book through web/world-globe-view.js createGlobeStage): the round map window with the zoomed place's picture, the
// digital grid transition, the "you are here" pointer and its pulse ring, and the camera, all set from one ZoomState
// (web/world-globe-zoom.js) each frame. Added to the globe scene web/world-globe-view.js builds.
//
// The place's icon stays on the globe: as z goes into the swap band it fades out while the window grows in from the icon's
// size (and back). The picture is the one the game draws for the screen in HD: its tiles assets-hd/map-tiles/<map>/<c>_<r>.webp
// (web/map-tiles.ts, each tile + a gutter) stitched into one canvas no larger than MAX_PICTURE_SIDE; without the HD tiles, the
// native assets/maps/<map>.png. Pictures load only when a zoom asks for them, and at most PICTURE_CACHE stay (the oldest
// one's texture is freed).
// Draw order: globe (0), place icons (1), map window (3), grid glow (4), pulse ring (6), the "you are here" pointer (7).
// The window and grid draw without the depth test (the window lies on the plane touching the globe, outside it).
import * as THREE from "./lib3d/three.module.js";
import type { Color, Mesh, ShaderMaterial, SpriteMaterial, Texture, Vector2 } from "./lib3d/three.module.js";
import type { GlobeIconSprite, GlobeScene } from "./world-globe-view.js";
import type { GlobeRenderer, GlobeSprite } from "./types/world-globe-view.js";
import { ZOOM, mapPxMatrix, mapPxToWorld, parseTileInfo, zoomCamera, zoomState } from "./world-globe-zoom.js";
import { lonLatToPoint, lonLatToUv } from "./world-globe-map.js";
import { placeKey } from "./world-globe-places.js";
import type { GlobeServer, LonLat } from "./types/world-globe-map.js";
import type { TargetScreen, ZoomState, ZoomTarget, ZoomTileInfo, ZoomView } from "./types/world-globe-zoom.js";

const TILE_INDEX = "assets-hd/map-tiles/index.json";
const HERE_ORDER = 7, RING_ORDER = 6, GRID_ORDER = 4, WINDOW_ORDER = 3, HERE_ORDER_GLOBE = 2;
/** the pulse ring: its height as a share of the view (sprite size ignores distance), period (s), and how far it grows */
const RING_SIZE = 0.05, RING_PERIOD = 1.3, RING_GROW = 1.6;
const HERE_COLOUR = "#ff5a2a";
/** grid lines: major / minor spacing on the picture (native px); the glow colour (sRGB) */
const GRID_MAJOR = 128, GRID_MINOR = 32;
const GRID_GLOW = 0x41e0ff;
/** the grid glow plane reaches this many window radii (over the land around the window) */
const GRID_SPAN = 1.8;
/** the stitched HD picture's longest side (px): 4096 x 2048 = 32 MB as a canvas; more than any view of it needs */
export const MAX_PICTURE_SIDE = 4096;
/** how many place pictures stay loaded */
export const PICTURE_CACHE = 2;
/** the place icons' centre radius (web/world-globe-view.ts PIN_R) */
const PIN_R = ZOOM.pinR;

/** an sRGB colour, 0..255 a channel */
export type Rgb = readonly [number, number, number];

/** One place picture, ready for a texture. */
export interface ZoomPicture {
    image: HTMLCanvasElement | HTMLImageElement;
    /** the native map size (px): the window works in native px whatever the picture's own size */
    w: number;
    h: number;
    /** where it came from (shown on the dev page) */
    source: string;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error(`${src}: not loaded`));
        im.src = src;
    });
}

async function fetchJson(url: string): Promise<unknown> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const raw: unknown = await r.json();
    return raw;
}

let tileIndex: Promise<unknown> | null = null;
/** the HD tile index, fetched once (a failed fetch is tried again next time) */
function loadTileIndex(): Promise<unknown> {
    if (tileIndex) return tileIndex;
    const p = fetchJson(TILE_INDEX);
    tileIndex = p;
    p.catch(() => { if (tileIndex === p) tileIndex = null; });
    return p;
}

/** the HD tiles of one map stitched into one canvas of at most MAX_PICTURE_SIDE (tile (c, r) holds picture px
 *  (c * tile, r * tile) at (gutter, gutter)) */
async function stitchTiles(t: ZoomTileInfo): Promise<HTMLCanvasElement> {
    const k = Math.min(1, MAX_PICTURE_SIDE / Math.max(t.w, t.h));
    const c = document.createElement("canvas");
    c.width = Math.round(t.w * k); c.height = Math.round(t.h * k);
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2D canvas");
    g.imageSmoothingQuality = "high";
    const skip = new Set(t.skip), jobs: Promise<void>[] = [];
    for (let row = 0; row < t.rows; row++) {
        for (let col = 0; col < t.cols; col++) {
            if (skip.has(`${col}_${row}`)) continue;
            const tw = Math.min(t.tile, t.w - col * t.tile), th = Math.min(t.tile, t.h - row * t.tile);
            jobs.push(loadImage(`assets-hd/map-tiles/${t.name}/${col}_${row}.webp`).then((im) => {
                g.drawImage(im, t.gutter, t.gutter, tw, th, col * t.tile * k, row * t.tile * k, tw * k, th * k);
            }));
        }
    }
    await Promise.all(jobs);
    return c;
}

/** The picture the game draws for a map: the HD tiles when they are there, else the native picture. */
export async function loadZoomPicture(map: string): Promise<ZoomPicture> {
    try {
        const t = parseTileInfo(await loadTileIndex(), map);
        if (t) {
            const image = await stitchTiles(t);
            return { image, w: t.w / t.scale, h: t.h / t.scale, source: `HD tiles assets-hd/map-tiles/${map}/ (${t.cols} x ${t.rows}, ${t.w} x ${t.h} -> ${image.width} x ${image.height})` };
        }
    } catch (e) {
        console.warn("[world-globe zoom] HD tiles: " + errText(e));
    }
    const im = await loadImage(`assets/maps/${map}.png`);
    return { image: im, w: im.naturalWidth, h: im.naturalHeight, source: `native assets/maps/${map}.png (${im.naturalWidth} x ${im.naturalHeight})` };
}

/** The globe picture's mean colour around a place (a square `half` texture px each way): the palette the window is tinted to. */
export function globePaletteAround(image: HTMLImageElement, ll: LonLat, half = 48): Rgb {
    const uv = lonLatToUv(ll);
    const cx = uv.u * image.naturalWidth, cy = (1 - uv.v) * image.naturalHeight;
    const c = document.createElement("canvas");
    c.width = 8; c.height = 8;
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2D canvas");
    g.drawImage(image, cx - half, cy - half, half * 2, half * 2, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i] ?? 0; gr += d[i + 1] ?? 0; b += d[i + 2] ?? 0; }
    const n = d.length / 4;
    return [r / n, gr / n, b / n];
}

/** a picture as a mipmapped texture (scaled down to the GPU limit if it is larger) */
function pictureTexture(renderer: GlobeRenderer, pic: ZoomPicture): Texture {
    const maxTex = renderer.capabilities.maxTextureSize;
    let src: HTMLCanvasElement | HTMLImageElement = pic.image;
    const pw = src instanceof HTMLCanvasElement ? src.width : src.naturalWidth, ph = src instanceof HTMLCanvasElement ? src.height : src.naturalHeight;
    if (pw > maxTex || ph > maxTex) {
        const k = maxTex / Math.max(pw, ph), c = document.createElement("canvas");
        c.width = Math.floor(pw * k); c.height = Math.floor(ph * k);
        const g = c.getContext("2d");
        if (!g) throw new Error("no 2D canvas");
        g.imageSmoothingQuality = "high";
        g.drawImage(pic.image, 0, 0, c.width, c.height);
        src = c;
    }
    const tex = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    renderer.initTexture(tex);
    return tex;
}

/** One cached place picture. */
interface CachedPicture {
    map: string;
    status: "loading" | "ready" | "failed";
    tex: Texture | null;
    picture: ZoomPicture | null;
    /** last asked for (the oldest goes first) */
    used: number;
}

/** The place pictures the zoom has asked for: loaded on first ask, at most `max` kept (the least recently asked one is freed). */
export interface PictureCache {
    /** ask for a map's picture: its cached entry once ready (null while loading or when it failed) */
    get(map: string): { tex: Texture; picture: ZoomPicture } | null;
    /** the cached entry if it is ready, without asking (no load starts, the age does not change) */
    peek(map: string): { tex: Texture; picture: ZoomPicture } | null;
    status(map: string): "none" | "loading" | "ready" | "failed";
    /** the maps held now (the test hook) */
    held(): string[];
    dispose(): void;
}

export function createPictureCache(renderer: GlobeRenderer, max = PICTURE_CACHE): PictureCache {
    const entries = new Map<string, CachedPicture>();
    let clock = 0, disposed = false;
    const free = (e: CachedPicture): void => { e.tex?.dispose(); e.tex = null; e.picture = null; entries.delete(e.map); };
    const trim = (): void => {
        while (entries.size > max) {
            let oldest: CachedPicture | null = null;
            for (const e of entries.values()) if (!oldest || e.used < oldest.used) oldest = e;
            if (!oldest) return;
            free(oldest);
        }
    };
    return {
        get(map: string) {
            let e = entries.get(map);
            if (!e) {
                const made: CachedPicture = { map, status: "loading", tex: null, picture: null, used: ++clock };
                e = made;
                entries.set(map, made);
                trim();
                loadZoomPicture(map).then((pic) => {
                    if (disposed || entries.get(map) !== made) return;      // freed while it loaded
                    made.tex = pictureTexture(renderer, pic);
                    made.picture = pic;
                    made.status = "ready";
                }).catch((err: unknown) => {
                    if (entries.get(map) !== made) return;
                    console.warn("[world-globe zoom] " + errText(err));
                    made.status = "failed";
                });
            }
            e.used = ++clock;
            return e.status === "ready" && e.tex && e.picture ? { tex: e.tex, picture: e.picture } : null;
        },
        peek(map: string) {
            const e = entries.get(map);
            return e && e.status === "ready" && e.tex && e.picture ? { tex: e.tex, picture: e.picture } : null;
        },
        status: (map: string) => entries.get(map)?.status ?? "none",
        held: () => [...entries.keys()],
        dispose() {
            disposed = true;
            for (const e of [...entries.values()]) free(e);
        },
    };
}

/** The zoom targets: one per place icon, in the icon list's order. */
export function zoomTargets(iconList: readonly GlobeIconSprite[]): ZoomTarget[] {
    return iconList.map((s) => ({
        key: placeKey(s.icon.server, s.icon.marker.loc), server: s.icon.server, record: s.icon.marker.loc,
        lonLat: s.icon.lonLat, iconRadius: Math.max(s.icon.size.w, s.icon.size.h) / 2,
    }));
}

/** a shader uniform */
interface U<T> { value: T }

interface WindowUniforms {
    uMap: U<Texture | null>; uMapSize: U<Vector2>; uCentre: U<Vector2>; uRadius: U<number>; uFeather: U<number>; uWobble: U<number>;
    uTint: U<Color>; uTintAmt: U<number>; uPaintAmt: U<number>; uBlur: U<number>; uSea: U<Color>;
    uSweepY: U<number>; uSweepSoft: U<number>; uAlpha: U<number>;
}
interface GridUniforms {
    uCentre: U<Vector2>; uRadius: U<number>; uSpan: U<number>; uAmt: U<number>; uSweepY: U<number>; uSweepSoft: U<number>;
    uGlow: U<Color>; uMajor: U<number>; uMinor: U<number>; uTime: U<number>;
}

const NOISE_GLSL = /* glsl */`
float zHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float zNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(zHash(i), zHash(i + vec2(1.0, 0.0)), u.x), mix(zHash(i + vec2(0.0, 1.0)), zHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

/** vertex shader of the window and the grid: a unit square scaled to the circle on the picture (px), then the px -> globe matrix */
const DISC_VERT = /* glsl */`
uniform vec2 uCentre; uniform float uRadius; uniform float uSpan;
varying vec2 vPx;
void main() {
    vPx = uCentre + position.xy * uRadius * uSpan;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vPx, 0.0, 1.0);
}`;

const WINDOW_FRAG = /* glsl */`
uniform sampler2D uMap; uniform vec2 uMapSize; uniform vec2 uCentre; uniform float uRadius; uniform float uFeather; uniform float uWobble;
uniform vec3 uTint; uniform float uTintAmt; uniform float uPaintAmt; uniform float uBlur; uniform vec3 uSea;
uniform float uSweepY; uniform float uSweepSoft; uniform float uAlpha;
varying vec2 vPx;
${NOISE_GLSL}
void main() {
    vec2 d = vPx - uCentre;
    float r = length(d) / uRadius;
    // painted edge: the radius wobbles with two octaves of noise around the circle (seamless: noise on the unit circle)
    vec2 dir = r > 1e-5 ? d / length(d) : vec2(1.0, 0.0);
    float n = zNoise(dir * 3.0 + 5.0) * 0.65 + zNoise(dir * 11.0 + 21.0) * 0.35;
    float rr = r * (1.0 + uWobble * (n * 2.0 - 1.0));
    float alpha = (1.0 - smoothstep(1.0 - uFeather, 1.0, rr)) * uAlpha;
    if (alpha <= 0.002) discard;
    vec2 uv = clamp(vPx / uMapSize, 0.0, 1.0);
    uv.y = 1.0 - uv.y;
    // the real map is revealed where the grid's scan line has passed (rows above it)
    float reveal = 1.0 - smoothstep(uSweepY - uSweepSoft, uSweepY, vPx.y);
    vec3 sharp = texture2D(uMap, uv).rgb;
    vec3 soft = texture2D(uMap, uv, uBlur).rgb;
    vec3 base = mix(soft, sharp, reveal);
    // tint toward the globe palette: keep the brightness, take the palette's hue
    vec3 W = vec3(0.2126, 0.7152, 0.0722);
    vec3 graded = uTint * (dot(base, W) / max(dot(uTint, W), 0.02));
    vec3 col = mix(base, graded, mix(uPaintAmt, uTintAmt, reveal));
    // outside the picture (inside the round window): a dark sea-coloured margin continuing the edge
    vec2 outside = max(vec2(0.0), max(-vPx, vPx - uMapSize));
    col = mix(col, mix(sharp * 0.45, uSea, 0.55), smoothstep(0.0, 6.0, length(outside)));
    // painted rim: darker just inside the soft edge
    col *= 1.0 - 0.25 * smoothstep(1.0 - uFeather * 2.0, 1.0 - uFeather * 0.4, rr);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
}`;

const GRID_FRAG = /* glsl */`
uniform vec2 uCentre; uniform float uRadius; uniform float uAmt; uniform float uSweepY; uniform float uSweepSoft;
uniform vec3 uGlow; uniform float uMajor; uniform float uMinor; uniform float uTime;
varying vec2 vPx;
float gridLines(vec2 p, float spacing, float px) {
    vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
    vec2 fw = fwidth(p) * px;
    vec2 l = 1.0 - smoothstep(fw * 0.5, fw * 1.5, g);
    return max(l.x, l.y);
}
void main() {
    float r = length(vPx - uCentre) / uRadius;
    float fall = 1.0 - smoothstep(1.0, 1.75, r);
    float grid = max(gridLines(vPx, uMajor, 1.6), 0.4 * gridLines(vPx, uMinor, 1.0));
    float ahead = vPx.y - uSweepY;
    float scan = exp(-pow(ahead / (uSweepSoft * 0.35), 2.0));
    float trail = ahead < 0.0 ? exp(ahead / (uSweepSoft * 3.0)) : 0.0;
    float flicker = 0.85 + 0.15 * sin(uTime * 9.0 + vPx.y * 0.05);
    float k = uAmt * fall * (grid * (0.18 + 0.75 * trail + 1.4 * scan) * flicker + 0.9 * scan);
    gl_FragColor = vec4(uGlow * k, clamp(k, 0.0, 1.0));
    #include <colorspace_fragment>
}`;

const rgbColour = (c: Rgb): Color => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

/** the pulse ring's picture */
function ringTexture(): Texture {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2D canvas");
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2);
    g.lineWidth = 12; g.strokeStyle = "#ffffff"; g.stroke();
    g.lineWidth = 7; g.strokeStyle = HERE_COLOUR; g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/** What the zoom needs to make its objects. */
export interface ZoomSceneOptions {
    /** the globe picture (the palette each window is tinted to) */
    globeImage: HTMLImageElement;
    /** each continent's sea colour (sRGB 0..255) */
    sea: Readonly<Record<GlobeServer, Rgb>>;
}

/** One frame of the zoom: the view, the target's screen (null = no window), your place's icon (the pointer stands there when
 *  the window is not your screen), the view's aspect and the time. */
export interface ZoomFrame {
    view: ZoomView;
    screen: TargetScreen | null;
    hereLonLat: LonLat | null;
    aspect: number;
    timeSec: number;
}

/** The zoom's objects in the globe scene. */
export interface ZoomScene {
    /** the places the zoom can go into (one per icon, same order as the icon list) */
    targets: readonly ZoomTarget[];
    /** the picture cache (lazy, PICTURE_CACHE at most) */
    pictures: PictureCache;
    /** set the camera, icons, window, grid and "you are here" for one frame (after this, render); the state used, or null when
     *  there is no target or screen (the camera then comes from the view alone) */
    update(f: ZoomFrame): ZoomState | null;
    dispose(): void;
}

export function buildZoomScene(renderer: GlobeRenderer, globe: GlobeScene, opts: ZoomSceneOptions): ZoomScene {
    const { scene, camera, here, iconList } = globe;
    const targets = zoomTargets(iconList);
    const pictures = createPictureCache(renderer);
    const tints = new Map<string, Color>();
    const tintOf = (t: ZoomTarget): Color => {
        let c = tints.get(t.key);
        if (!c) { c = rgbColour(globePaletteAround(opts.globeImage, t.lonLat)); tints.set(t.key, c); }
        return c;
    };
    const sea: Record<GlobeServer, Color> = { asuka: rgbColour(opts.sea.asuka), amaterasu: rgbColour(opts.sea.amaterasu) };
    const square = new THREE.PlaneGeometry(2, 2);
    const mapSize = new THREE.Vector2(1, 1);

    const wu: WindowUniforms = {
        uMap: { value: null }, uMapSize: { value: mapSize }, uCentre: { value: new THREE.Vector2() }, uRadius: { value: 1 },
        uFeather: { value: ZOOM.feather }, uWobble: { value: ZOOM.wobble },
        uTint: { value: new THREE.Color() }, uTintAmt: { value: 0 }, uPaintAmt: { value: 0 }, uBlur: { value: 0 }, uSea: { value: new THREE.Color() },
        uSweepY: { value: 0 }, uSweepSoft: { value: 1 }, uAlpha: { value: 0 },
    };
    const windowMat: ShaderMaterial = new THREE.ShaderMaterial({
        uniforms: { ...wu, uSpan: { value: 1 } }, vertexShader: DISC_VERT, fragmentShader: WINDOW_FRAG,
        transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const gu: GridUniforms = {
        uCentre: wu.uCentre, uRadius: wu.uRadius, uSpan: { value: GRID_SPAN }, uAmt: { value: 0 }, uSweepY: wu.uSweepY, uSweepSoft: wu.uSweepSoft,
        uGlow: { value: new THREE.Color(GRID_GLOW) }, uMajor: { value: GRID_MAJOR }, uMinor: { value: GRID_MINOR }, uTime: { value: 0 },
    };
    const gridMat: ShaderMaterial = new THREE.ShaderMaterial({
        uniforms: { ...gu }, vertexShader: DISC_VERT, fragmentShader: GRID_FRAG,
        transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const placeOnPicture = (m: Mesh, order: number): Mesh => {
        m.matrixAutoUpdate = false;
        m.frustumCulled = false;
        m.renderOrder = order;
        m.visible = false;
        scene.add(m);
        return m;
    };
    const windowMesh = placeOnPicture(new THREE.Mesh(square, windowMat), WINDOW_ORDER);
    const gridMesh = placeOnPicture(new THREE.Mesh(square, gridMat), GRID_ORDER);

    const ringTex = ringTexture();
    const ringMat: SpriteMaterial = new THREE.SpriteMaterial({ map: ringTex, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false });
    // ETS item 9: Sprite gets position / scale from Object3D's defineProperties (types/world-globe-view.ts GlobeSprite)
    const ring = new THREE.Sprite(ringMat) as GlobeSprite;
    ring.renderOrder = RING_ORDER;
    ring.visible = false;
    scene.add(ring);
    const hereMat = here.material;

    const globeMat = globe.globe.material;
    const pxMatrix = new THREE.Matrix4();

    const setCamera = (c: { camera: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; up: { x: number; y: number; z: number } }, near: number, far: number): void => {
        camera.position.set(c.camera.x, c.camera.y, c.camera.z);
        camera.up.set(c.up.x, c.up.y, c.up.z);
        camera.near = near; camera.far = far;
        camera.updateProjectionMatrix();
        camera.lookAt(c.target.x, c.target.y, c.target.z);
        camera.updateMatrixWorld(true);
    };

    return {
        targets, pictures,
        update(f: ZoomFrame) {
            const v = f.view, t = targets[v.target] ?? null;
            // only shows a picture a zoom in asked for (the view's ready -> pictures.get); drawing never starts a load
            const got = t && f.screen ? pictures.peek(f.screen.map) : null;
            const st = t && f.screen ? zoomState(v.z, {
                look: v.look, place: t.lonLat, mapW: f.screen.w, mapH: f.screen.h, spot: f.screen.spot,
                iconRadius: t.iconRadius, aspect: f.aspect, fovDeg: ZOOM.fovDeg,
            }) : null;
            if (st) setCamera(st, st.near, st.far);
            else {
                const c = zoomCamera(v.look, v.z);
                setCamera(c, Math.min(0.05, Math.max(0.002, c.height * 0.05)), c.height + 6);
            }
            const fade = st ? st.globeFade : 0;
            // icons: the horizon fade, then the globe's fade; the target's icon swaps with its window (when its picture is in)
            globe.faceIcons(camera.position);
            iconList.forEach((s, i) => {
                if (i === v.target && st && got) s.material.opacity *= st.iconAlpha;
                else s.material.opacity *= 1 - fade;
            });
            if (globeMat instanceof THREE.MeshBasicMaterial) globeMat.color.setScalar(1 - fade);
            // window + grid on the picture
            const show = !!(st && got && t && st.windowAlpha > 0);
            windowMesh.visible = show;
            gridMesh.visible = show && !!st && st.gridAmount > 0;
            if (st && got && t && f.screen && show) {
                pxMatrix.fromArray(mapPxMatrix(st));
                for (const m of [windowMesh, gridMesh]) { m.matrix.copy(pxMatrix); m.matrixWorldNeedsUpdate = true; }
                wu.uMap.value = got.tex;
                mapSize.set(f.screen.w, f.screen.h);
                wu.uCentre.value.set(st.centre.x, st.centre.y);
                wu.uRadius.value = st.radius;
                wu.uTint.value.copy(tintOf(t));
                wu.uSea.value.copy(sea[t.server]);
                wu.uTintAmt.value = st.tint; wu.uPaintAmt.value = st.paint; wu.uBlur.value = st.blur;
                wu.uSweepY.value = st.sweepY; wu.uSweepSoft.value = st.sweepSoft;
                wu.uAlpha.value = st.windowAlpha;
                gu.uAmt.value = st.gridAmount * st.windowAlpha; gu.uTime.value = f.timeSec;
            }
            // "you are here": on your screen's dot (window or not yet), else on your place's icon; the ring pulses on the dot
            // while the window shows
            const spot = st && f.screen?.mine && f.screen.spot ? f.screen.spot : null;
            if (st && spot) {
                const p = mapPxToWorld(st, spot);
                here.visible = true;
                here.renderOrder = HERE_ORDER;
                here.position.set(p.x, p.y, p.z);
                hereMat.opacity = got ? 1 : 1 - fade;
                ring.visible = show;
                if (show) {
                    ring.position.set(p.x, p.y, p.z);
                    const ph = (f.timeSec / RING_PERIOD) % 1;
                    const sz = RING_SIZE * (0.35 + RING_GROW * ph);
                    ring.scale.set(sz, sz, 1);
                    ringMat.opacity = (1 - ph * ph) * st.windowAlpha;
                }
            } else {
                ring.visible = false;
                here.renderOrder = HERE_ORDER_GLOBE;
                here.visible = !!f.hereLonLat && fade < 1;
                if (f.hereLonLat) {
                    const p = lonLatToPoint(f.hereLonLat, PIN_R);
                    here.position.set(p.x, p.y, p.z);
                }
                hereMat.opacity = 1 - fade;
            }
            return st;
        },
        dispose() {
            for (const o of [windowMesh, gridMesh, ring]) o.removeFromParent();
            for (const m of [windowMat, gridMat, ringMat]) m.dispose();
            ringTex.dispose();
            pictures.dispose();
            square.dispose();
        },
    };
}
