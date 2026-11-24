// web/world-globe-view.js -- THE World Globe in three.js, one module for both places that show it: the dev page
// web/world-globe.html (web/world-globe.js adds its mouse controls and side panel) and the pause MAP screen
// (OPTIONS > GAME > Map screen: New, the book web/world-globe-book.js). The two continents in one baked texture
// (web/assets/world-globe/<GLOBE_TEXTURE>), the place markers from web/assets/world-globe/<server>.json drawn as the
// disc's own map icons, and a "you are here" marker that always faces the camera. Maths in web/world-globe-map.js.
// GPU only: the renderer is made with failIfMajorPerformanceCaveat and a software renderer string is refused, so the
// MAP row falls back to the disc's page instead of drawing on the CPU.
//
// Place icons: each marker shows the clip the disc's MAP page draws for its record (status_ui.json screens.map.markers ->
// stwmp0icon Asuka / stwmp1icon Amaterasu, web/world-globe-map.ts markerIcons). Each is a billboard sprite (always faces the
// camera, upright with the camera's up = +y), so it stays readable however the globe is turned; a decal lying on the ground
// would squash to a line near the horizon. The picture is the clip's HD repaint (web/assets/world-globe/icons-hd, smooth:
// linear filter + mipmaps, web/world-globe-map.ts iconArt); a clip whose HD picture did not load draws the disc clip
// pixel-sharp (nearest filter, no mipmaps) instead. Size: the icon covers on the globe what it covers on the original map (its
// box px times the map's local scale there; the HD picture spans HD_ICON_SPAN px at that scale, centred on the box, and
// picking still uses the box). The icons draw without the depth test (a
// billboard standing up from a curved surface would sink into it); the ones past the horizon are hidden and those near it
// fade, each frame (faceIcons). The "you are here" marker draws after them, so it stays on top.
import * as THREE from "./lib3d/three.module.js";
import type { Mesh, SpriteMaterial, Texture } from "./lib3d/three.module.js";
import type { GlobeCamera, GlobeGroup, GlobeRenderer, GlobeSprite, GlobeThreeScene } from "./types/world-globe-view.js";
import {
    GLOBE_TEXTURE, GLOBE_TEX_W, GLOBE_TEX_H, GLOBE_SERVERS, ICON_PACK, continentBand, lonLatToPoint, parseGlobeMap, globePlace,
    markerIcons, parseIconSheet, parseMarkerRecords, iconArt, loadHdIcons, shownIconClips,
} from "./world-globe-map.js";
import { ZOOM } from "./world-globe-zoom.js";
import { buildZoomScene } from "./world-globe-zoom-view.js";
import type { Rgb, ZoomScene } from "./world-globe-zoom-view.js";
import { placeKey, screenForTarget } from "./world-globe-places.js";
import type {
    GlobeContinent, GlobeHereInput, GlobeMarkerIcon, GlobeMarkerRecord, GlobePlace, GlobeServer, GlobeStageLike,
    GlobeStageStatus, IconSheet, LonLat, Point3,
} from "./types/world-globe-map.js";
import type { GlobePlacesInput, TargetScreen, ZoomState, ZoomView } from "./types/world-globe-zoom.js";

/** Where the globe files are, relative to the page (both pages live in web/). */
export const GLOBE_ASSET_DIR = "assets/world-globe/";
/** The UI sheets (the map icons) and the disc's UI table (the marker records), relative to the page. */
export const GLOBE_UI_DIR = "assets/ui/";
export const GLOBE_STATUS_UI = "assets/data/status_ui.json";
/** Radius of the place icons' centres and of the "you are here" marker's foot, in globe radii. */
const PIN_R = ZOOM.pinR;
/** Icons fade out over this last share of the way from the view centre to the horizon (faceIcons). */
const ICON_FADE = 0.12;
/** Draw order: the globe (0), the place icons, then the "you are here" marker on top. */
const ICON_ORDER = 1, HERE_ORDER = 2;
/** The "you are here" marker's height as a share of the view height (the sprite ignores distance). */
const HERE_SIZE = 0.075;
const HERE_COLOUR = "#ff5a2a";

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A GPU WebGL renderer on `canvas`, and the GPU's name. Throws when there is none or it is a software one. */
export function makeGlobeRenderer(canvas: HTMLCanvasElement | OffscreenCanvas): { renderer: GlobeRenderer; gpu: string } {
    let renderer: GlobeRenderer;
    try {
        // ETS item 9: WebGLRenderer sets `capabilities` while it sets up its context; the JS-inferred class has no type for it
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance", failIfMajorPerformanceCaveat: true }) as GlobeRenderer;
    } catch (e) {
        throw new Error("No GPU WebGL context (a software renderer is refused on purpose). " + errText(e));
    }
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/swiftshader|llvmpipe|software/i.test(gpu)) {
        renderer.dispose();
        throw new Error("Software renderer refused: " + gpu);
    }
    return { renderer, gpu };
}

/** One server's icon sheet: its clips and its picture. */
export interface GlobeIconSheet {
    clips: IconSheet;
    image: HTMLImageElement;
}

/** The two continents' tables, the globe picture, the disc's marker records and the two icon sheets. */
export interface GlobeAssets {
    continents: GlobeContinent[];
    image: HTMLImageElement;
    records: GlobeMarkerRecord[];
    sheets: Record<GlobeServer, GlobeIconSheet>;
    /** the HD picture of each shown clip that loaded (a missing clip draws its disc art) */
    hdIcons: ReadonlyMap<number, HTMLImageElement>;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error(`${src}: not loaded`));
        im.src = src;
    });
}

/** an HD icon picture: must load and be square, else it counts as missing (the clip then draws its disc art) */
async function loadHdIconImage(src: string): Promise<HTMLImageElement> {
    const im = await loadImage(src);
    if (!(im.naturalWidth > 0) || im.naturalWidth !== im.naturalHeight) throw new Error(`${src}: ${im.naturalWidth} x ${im.naturalHeight}, not square`);
    return im;
}

async function fetchJson(url: string): Promise<unknown> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const raw: unknown = await r.json();
    return raw;
}

async function loadContinent(server: GlobeServer, dir: string): Promise<GlobeContinent> {
    const data = parseGlobeMap(await fetchJson(`${dir}${server}.json`));
    if (data.server !== server) throw new Error(`${dir}${server}.json: holds server ${data.server}`);
    return { data, band: continentBand(data) };
}

async function loadIconSheet(server: GlobeServer, uiDir: string): Promise<GlobeIconSheet> {
    const base = `${uiDir}${ICON_PACK[server]}_sheet`;
    const [raw, image] = await Promise.all([fetchJson(`${base}.json`), loadImage(`${base}.png`)]);
    return { clips: parseIconSheet(raw), image };
}

let assetsLoading: Promise<GlobeAssets> | null = null;

/** Load the globe files once per session (a failed load is tried again next time). */
export function loadGlobeAssets(dir = GLOBE_ASSET_DIR, uiDir = GLOBE_UI_DIR, statusUi = GLOBE_STATUS_UI): Promise<GlobeAssets> {
    if (assetsLoading) return assetsLoading;
    const p = (async (): Promise<GlobeAssets> => {
        const continentsP = Promise.all(GLOBE_SERVERS.map((s) => loadContinent(s, dir)));
        const recordsP = fetchJson(statusUi).then(parseMarkerRecords);
        // the HD icons of the shown clips, as soon as the markers are known; a failed one is left out (never rejects)
        const hdP = Promise.all([continentsP, recordsP]).then(([cs, rs]) => loadHdIcons(shownIconClips(cs, rs), dir, loadHdIconImage));
        const [continents, image, records, asuka, amaterasu, hdIcons] = await Promise.all([
            continentsP,
            loadImage(`${dir}${GLOBE_TEXTURE}`),
            recordsP,
            loadIconSheet("asuka", uiDir),
            loadIconSheet("amaterasu", uiDir),
            hdP,
        ]);
        if (image.naturalWidth !== GLOBE_TEX_W || image.naturalHeight !== GLOBE_TEX_H)
            throw new Error(`${GLOBE_TEXTURE}: ${image.naturalWidth} x ${image.naturalHeight}, expected ${GLOBE_TEX_W} x ${GLOBE_TEX_H}`);
        return { continents, image, records, sheets: { asuka, amaterasu }, hdIcons };
    })();
    assetsLoading = p;
    p.catch(() => { if (assetsLoading === p) assetsLoading = null; });
    return p;
}

/** the baked texture as is, or scaled down onto a canvas when the GPU's texture limit is smaller */
function globeTexture(image: HTMLImageElement, maxTex: number): { tex: Texture; w: number; h: number } {
    if (image.naturalWidth <= maxTex) return { tex: new THREE.Texture(image), w: image.naturalWidth, h: image.naturalHeight };
    const c = document.createElement("canvas");
    c.width = maxTex; c.height = maxTex / 2;
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2D canvas");
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(image, 0, 0, c.width, c.height);
    return { tex: new THREE.CanvasTexture(c), w: c.width, h: c.height };
}

/** The "you are here" marker's picture: a pointer whose tip is the bottom centre. */
function hereTexture(): Texture {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 96;
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2D canvas");
    g.lineJoin = "round";
    g.beginPath();
    g.arc(32, 32, 24, Math.PI * 0.78, Math.PI * 2.22);
    g.lineTo(32, 92);
    g.closePath();
    g.fillStyle = HERE_COLOUR; g.fill();
    g.lineWidth = 5; g.strokeStyle = "#ffffff"; g.stroke();
    g.beginPath(); g.arc(32, 32, 9, 0, Math.PI * 2); g.fillStyle = "#ffffff"; g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/** One map icon clip as its own small texture: its layers drawn in order into a canvas the size of the clip's box, nearest
 *  filter both ways and no mipmaps (the pixels stay sharp at any size). */
function iconTexture(sheet: GlobeIconSheet, icon: GlobeMarkerIcon): Texture {
    const clip = sheet.clips.get(icon.clip);
    if (!clip) throw new Error(`${ICON_PACK[icon.server]}: no clip ${icon.clip}`);
    const c = document.createElement("canvas");
    c.width = icon.box.w; c.height = icon.box.h;
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2D canvas");
    g.imageSmoothingEnabled = false;
    for (const l of clip.layers) g.drawImage(sheet.image, l.x, l.y, l.w, l.h, l.dx - icon.box.x, l.dy - icon.box.y, l.w, l.h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
}

/** One HD icon picture as a texture: smooth both ways (linear filter, mipmaps for the small sizes far out). */
function hdIconTexture(image: HTMLImageElement): Texture {
    const tex = new THREE.Texture(image);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}

/** One place icon on the globe: the sprite, what it shows, and the unit normal of its place (for the horizon test). */
export interface GlobeIconSprite {
    sprite: GlobeSprite;
    /** its own material (each icon fades on its own) */
    material: SpriteMaterial;
    icon: GlobeMarkerIcon;
    normal: Point3;
}

/** One built globe: the scene, its camera, the sphere, the place icons and the "you are here" marker. */
export interface GlobeScene {
    scene: GlobeThreeScene;
    camera: GlobeCamera;
    globe: Mesh;
    /** all place icons (hide the group to hide them all) */
    icons: GlobeGroup;
    iconList: readonly GlobeIconSprite[];
    here: GlobeSprite;
    /** the texture as drawn (smaller than the file when the GPU limit is), and the GPU limit */
    texW: number;
    texH: number;
    maxTex: number;
    /** put the "you are here" marker on a point (null hides it) */
    setHere(ll: LonLat | null): void;
    /** before a render: hide the icons past the horizon seen from `cam` (camera position), fade the ones near it */
    faceIcons(cam: Point3): void;
    /** the place icon under a view point (`ndc`: -1..1 across the canvas, y up) of `camera` as last rendered: the nearest one
     *  when several overlap; hidden icons do not count. null = none. */
    pickIcon(ndc: { x: number; y: number }, camera: GlobeCamera): GlobeMarkerIcon | null;
    /** free the GPU memory (textures, geometry, materials); the renderer stays */
    dispose(): void;
}

export function buildGlobeScene(renderer: GlobeRenderer, assets: GlobeAssets): GlobeScene {
    const maxTex: number = renderer.capabilities.maxTextureSize;
    // ETS item 9: three.js defines position and scale on its objects with Object.defineProperties, which gives TypeScript no
    // types for them; the scene, camera and sprite built here are typed with them (web/types/world-globe-view.ts)
    const scene = new THREE.Scene() as GlobeThreeScene;
    const camera = new THREE.PerspectiveCamera(ZOOM.fovDeg, 1, 0.05, 100) as GlobeCamera;
    camera.position.set(3.2, 0, 0);
    const { tex, w: texW, h: texH } = globeTexture(assets.image, maxTex);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;               // the texture's left / right edge is longitude 180 (middle of Amaterasu)
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    const globeGeo = new THREE.SphereGeometry(1, 192, 128), globeMat = new THREE.MeshBasicMaterial({ map: tex });
    const globe = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globe);

    // place icons of both continents: each marker's clip as a billboard sprite (see the head of this file): its HD picture
    // (one per clip, shared by both continents) or, when that did not load, the disc clip of the server's sheet.
    // One texture per picture (a clip shared by several places is made once), one material per icon (each fades on its own).
    // ETS item 9: Group is built like the scene (types/world-globe-view.ts)
    const icons = new THREE.Group() as GlobeGroup;
    const iconList: GlobeIconSprite[] = [];
    const iconTex = new Map<string, Texture>();
    for (const c of assets.continents) {
        const sheet = assets.sheets[c.data.server];
        for (const icon of markerIcons(c, assets.records, sheet.clips, { w: sheet.image.naturalWidth, h: sheet.image.naturalHeight })) {
            const art = iconArt(icon, assets.hdIcons);
            const key = art.hd ? `hd:${icon.clip}` : `${icon.server}:${icon.clip}`;
            let map = iconTex.get(key);
            if (!map) { map = art.hd ? hdIconTexture(art.hd) : iconTexture(sheet, icon); iconTex.set(key, map); }
            const mat = new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false });
            const sprite = new THREE.Sprite(mat) as GlobeSprite;
            const p = lonLatToPoint(icon.lonLat, PIN_R);
            sprite.position.set(p.x, p.y, p.z);
            sprite.scale.set(art.size.w, art.size.h, 1);
            sprite.renderOrder = ICON_ORDER;
            icons.add(sprite);
            iconList.push({ sprite, material: mat, icon, normal: lonLatToPoint(icon.lonLat, 1) });
        }
    }
    scene.add(icons);

    // "you are here": a sprite always faces the camera; its tip (bottom centre) stands on the place, a fixed share of the view tall
    const hereTex = hereTexture();
    const hereMat = new THREE.SpriteMaterial({ map: hereTex, sizeAttenuation: false, transparent: true, depthTest: true });
    const here = new THREE.Sprite(hereMat) as GlobeSprite;
    here.center.set(0.5, 0);
    here.scale.set(HERE_SIZE * (64 / 96), HERE_SIZE, 1);
    here.renderOrder = HERE_ORDER;
    here.visible = false;
    scene.add(here);

    renderer.initTexture(tex);
    return {
        scene, camera, globe, icons, iconList, here, texW, texH, maxTex,
        setHere(ll: LonLat | null) {
            here.visible = ll !== null;
            if (!ll) return;
            const p = lonLatToPoint(ll, PIN_R);
            here.position.set(p.x, p.y, p.z);
        },
        faceIcons(cam: Point3) {
            // a place with unit normal n is in sight from cam while n.cam > 1; k = 1 straight below the camera, 0 on the horizon
            const d = Math.hypot(cam.x, cam.y, cam.z);
            for (const s of iconList) {
                const n = s.normal, k = d > 1 ? ((n.x * cam.x + n.y * cam.y + n.z * cam.z) - 1) / (d - 1) : -1;
                s.sprite.visible = k > 0;
                s.material.opacity = Math.min(1, Math.max(0, k / ICON_FADE));
            }
        },
        pickIcon(ndc: { x: number; y: number }, cam: GlobeCamera) {
            // the icon box as the camera sees it: centre at (x, y) / depth, half size (w, h) / 2 / depth, in units of tan(fov / 2)
            if (!icons.visible) return null;
            const t = Math.tan((cam.fov * Math.PI) / 360), px = ndc.x * t * cam.aspect, py = ndc.y * t;
            const v = new THREE.Vector3();
            let best: GlobeMarkerIcon | null = null, bestDepth = Infinity;
            for (const s of iconList) {
                if (!s.sprite.visible) continue;
                v.copy(s.sprite.position).applyMatrix4(cam.matrixWorldInverse);
                const depth = -v.z;
                if (!(depth > cam.near) || depth >= bestDepth) continue;
                if (Math.abs(v.x / depth - px) <= s.icon.size.w / 2 / depth && Math.abs(v.y / depth - py) <= s.icon.size.h / 2 / depth) {
                    best = s.icon; bestDepth = depth;
                }
            }
            return best;
        },
        dispose() {
            scene.clear();
            for (const t of [tex, hereTex, ...iconTex.values()]) t.dispose();
            globeGeo.dispose();
            for (const m of [globeMat, hereMat, ...iconList.map((s) => s.material)]) m.dispose();
        },
    };
}

/** The pause MAP screen's globe (web/world-globe-book.js): one renderer on an offscreen canvas for the whole session (a new
 *  context per open makes Chrome drop old ones, maybe the battle's), the scene and the zoom (web/world-globe-zoom-view.js,
 *  its place pictures included) built per open and freed when the book shuts. */
export interface GlobeStage extends GlobeStageLike {
    /** make the renderer now if there is none (sync); false = no GPU WebGL here (the MAP row then opens the disc's page) */
    ensure(): boolean;
    /** the GPU's name, once the renderer is made */
    gpu(): string | null;
    /** the zoom's last state and the maps its picture cache holds (checks) */
    zoomState(): ZoomState | null;
    heldPictures(): string[];
}

/** The largest offscreen size the stage renders at (px wide). */
const MAX_RENDER_W = 2048;

/** each continent's sea colour from its data file */
function seaColours(continents: readonly GlobeContinent[]): Record<GlobeServer, Rgb> {
    const of = (s: GlobeServer): Rgb => continents.find((c) => c.data.server === s)?.data.seaRgb ?? [27, 36, 70];
    return { asuka: of("asuka"), amaterasu: of("amaterasu") };
}

export function createGlobeStage(): GlobeStage {
    let canvas: OffscreenCanvas | HTMLCanvasElement | null = null, renderer: GlobeRenderer | null = null, gpuName: string | null = null;
    let failed = false, status: GlobeStageStatus = "idle", built: GlobeScene | null = null, place: GlobePlace | null = null, token = 0;
    let zoom: ZoomScene | null = null, places: GlobePlacesInput | null = null, home = -1, lastState: ZoomState | null = null;
    let size = { w: 0, h: 0 };
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    /** the screen a target's window shows */
    const screenOf = (i: number): TargetScreen | null => {
        const t = zoom?.targets[i];
        return t && places ? screenForTarget(t.key, places) : null;
    };

    const ensure = (): boolean => {
        if (renderer) return true;
        if (failed) return false;
        try {
            canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 128) : document.createElement("canvas");
            const made = makeGlobeRenderer(canvas);
            renderer = made.renderer; gpuName = made.gpu;
            renderer.setPixelRatio(1);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.setClearColor(0x000000, 0);
            return true;
        } catch (e) {
            console.warn("[world-globe] " + errText(e));
            failed = true; canvas = null; renderer = null;
            return false;
        }
    };

    const freeScene = (): void => {
        zoom?.dispose(); zoom = null;
        built?.dispose(); built = null;
        place = null; places = null; home = -1; lastState = null;
    };

    return {
        ensure,
        gpu: () => gpuName,
        open(here: GlobeHereInput, placesIn: GlobePlacesInput) {
            const mine = ++token;
            freeScene();
            if (!ensure()) { status = "failed"; return; }
            status = "loading";
            loadGlobeAssets().then((assets) => {
                if (mine !== token || !renderer) return;
                built = buildGlobeScene(renderer, assets);
                place = globePlace(assets.continents, here);
                built.setHere(place ? place.lonLat : null);
                zoom = buildZoomScene(renderer, built, { globeImage: assets.image, sea: seaColours(assets.continents) });
                places = placesIn;
                const key = here.server ? placeKey(here.server, here.record) : null;
                home = key ? zoom.targets.findIndex((t) => t.key === key) : -1;
                status = "ready";
            }).catch((e: unknown) => {
                if (mine !== token) return;
                console.warn("[world-globe] " + errText(e));
                freeScene();
                status = "failed";
            });
        },
        status: () => status,
        place: () => place,
        targets: () => zoom?.targets ?? [],
        home: () => home,
        want(i: number) {
            const s = screenOf(i);
            return !!(s && zoom && zoom.pictures.get(s.map));
        },
        draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, view: ZoomView) {
            if (status !== "ready" || !built || !zoom || !renderer || !canvas || !(w > 0) || !(h > 0)) return false;
            const m = ctx.getTransform();
            const sx = Math.hypot(m.a, m.b) || 1;
            const pw = Math.max(64, Math.min(MAX_RENDER_W, Math.round(w * sx)));
            const ph = Math.max(32, Math.round((pw * h) / w));
            if (pw !== size.w || ph !== size.h) {
                renderer.setSize(pw, ph, false);
                built.camera.aspect = pw / ph;
                built.camera.updateProjectionMatrix();
                size = { w: pw, h: ph };
            }
            const now = typeof performance !== "undefined" ? performance.now() : t0;
            lastState = zoom.update({
                view, screen: screenOf(view.target), hereLonLat: place ? place.lonLat : null, aspect: pw / ph, timeSec: (now - t0) / 1000,
            });
            renderer.render(built.scene, built.camera);
            ctx.drawImage(canvas, 0, 0, pw, ph, x, y, w, h);
            return true;
        },
        zoomState: () => lastState,
        heldPictures: () => zoom?.pictures.held() ?? [],
        close() {
            token++;
            freeScene();
            status = "idle";
        },
    };
}
