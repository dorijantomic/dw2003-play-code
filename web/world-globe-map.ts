// web/world-globe-map.js -- pure maths for the World Globe (the dev page web/world-globe.js and the pause MAP screen
// web/world-globe-book.js, both drawn by web/world-globe-view.js): the game's two world maps (one per
// server, the Gemini repaint cropped into the original 392 x 336 map frame) are two continents on one sphere: Asuka centred
// at longitude 0, Amaterasu at 180, each MAP_LON_SPAN wide, narrow sea channels between them, ice caps at the poles (all
// baked into one texture, GLOBE_TEXTURE, by the scratch tool world-globe/two/make_two.py with the same numbers).
// Longitude is linear in frame x; latitude is Mercator in frame y, so land keeps its shape (no stretch).
// Also the area / marker lookup, the check of the data file, and for the MAP screen: the server rule, your place, the camera
// steps and which MAP screen opens; and the original map icons on the markers (which clip, where, how big). No DOM, no
// three.js: the tests (tests/world-globe.test.js, tests/world-globe-menu.test.js) run it in node.
import type {
  AreaRun, ClipBox, FramePoint, GlobeArea, GlobeCamView, GlobeContinent, GlobeHereInput, GlobeHit, GlobeMapData, GlobeMarker,
  GlobeIconArt, GlobeMarkerIcon, GlobeMarkerRecord, GlobePlace, GlobeServer, IconClip, IconLayer, IconSheet, LonLat, MapBand, MapScreenChoice,
  MapScreenRoute, Point3, SheetSize, SphereUv,
} from "./types/world-globe-map.js";

/** the one sphere texture (equirectangular, both continents, sea and ice) and its size */
export const GLOBE_TEXTURE = "two_continents.png";
export const GLOBE_TEX_W = 8192;
export const GLOBE_TEX_H = 4096;
/** longitude one map's width covers (168 degrees): 3823 texture px for the 1176 px picture; 12 degree channels between */
export const MAP_LON_SPAN = (168 * Math.PI) / 180;
export const GLOBE_SERVERS: readonly GlobeServer[] = ["asuka", "amaterasu"];
/** the longitude each continent is centred on */
export const CONTINENT_LON: Readonly<Record<GlobeServer, number>> = { asuka: 0, amaterasu: Math.PI };

const wrap01 = (u: number): number => u - Math.floor(u);
/** longitude to (-pi, pi] */
const wrapLon = (lon: number): number => { const t = wrap01((lon + Math.PI) / (2 * Math.PI)); return t === 0 ? Math.PI : t * 2 * Math.PI - Math.PI; };

export function makeBand(frameW: number, frameH: number, lonCentre = 0, lonSpan = MAP_LON_SPAN): MapBand {
    return { frameW, frameH, lonCentre, lonSpan, mercHalf: (lonSpan * frameH) / frameW / 2 };
}

/** latitude (radians) of the map's top edge; the bottom edge is its negative */
export function bandEdgeLat(b: MapBand): number {
    return Math.atan(Math.sinh(b.mercHalf));
}

/** frame px -> longitude / latitude (radians) */
export function frameToLonLat(b: MapBand, x: number, y: number): LonLat {
    return { lon: wrapLon(b.lonCentre + (x / b.frameW - 0.5) * b.lonSpan), lat: Math.atan(Math.sinh((0.5 - y / b.frameH) * 2 * b.mercHalf)) };
}

/** longitude / latitude -> frame px (may lie outside the frame: that is open sea or the other continent) */
export function lonLatToFrame(b: MapBand, ll: LonLat): FramePoint {
    return { x: (wrapLon(ll.lon - b.lonCentre) / b.lonSpan + 0.5) * b.frameW, y: (0.5 - Math.asinh(Math.tan(ll.lat)) / (2 * b.mercHalf)) * b.frameH };
}

export function inFrame(b: MapBand, p: FramePoint): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < b.frameW && p.y < b.frameH;
}

/** signed shortest turn from angle a to angle b, in (-pi, pi] */
export function angleDelta(a: number, b: number): number {
    return wrapLon(b - a);
}

/** ease in-out (cubic) for t in 0..1 */
export function easeInOut(t: number): number {
    const c = Math.min(1, Math.max(0, t));
    return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** three.js SphereGeometry: phi = u * 2pi, theta = (1 - v) * pi; longitude 0 at u = 0.5 (the side the starting camera sees) */
export function lonLatToUv(ll: LonLat): SphereUv {
    return { u: wrap01((ll.lon + Math.PI) / (2 * Math.PI)), v: 0.5 + ll.lat / Math.PI };
}

export function uvToLonLat(uv: SphereUv): LonLat {
    return { lon: wrapLon(uv.u * 2 * Math.PI - Math.PI), lat: (uv.v - 0.5) * Math.PI };
}

/** the point on a sphere of radius r, same formula as three.js SphereGeometry */
export function lonLatToPoint(ll: LonLat, r = 1): Point3 {
    const phi = ll.lon + Math.PI, c = Math.cos(ll.lat);
    return { x: -r * Math.cos(phi) * c, y: r * Math.sin(ll.lat), z: r * Math.sin(phi) * c };
}

export function pointToLonLat(p: Point3): LonLat {
    const r = Math.hypot(p.x, p.y, p.z);
    if (r === 0) return { lon: 0, lat: 0 };
    return { lon: wrapLon(Math.atan2(p.z, -p.x) - Math.PI), lat: Math.asin(Math.max(-1, Math.min(1, p.y / r))) };
}

/** three.js Spherical theta (azimuth about +y, atan2(x, z)) of a camera that looks straight at longitude lon */
export function viewAzimuth(lon: number): number {
    const p = lonLatToPoint({ lon, lat: 0 });
    return Math.atan2(p.x, p.z);
}

/** topmost area under a frame point (areas are listed in the game's draw order: later ones lie on top) */
export function areaAt(data: GlobeMapData, x: number, y: number): GlobeArea | null {
    const yi = Math.floor(y), xi = x;
    for (let i = data.areas.length - 1; i >= 0; i--) {
        const a = data.areas[i];
        if (!a) continue;
        for (const [ry, x0, x1] of a.runs) if (ry === yi && xi >= x0 && xi < x1) return a;
    }
    return null;
}

export function nearestMarker(data: GlobeMapData, x: number, y: number, maxDist: number): GlobeMarker | null {
    let best: GlobeMarker | null = null, bd = maxDist;
    for (const m of data.markers) {
        const d = Math.hypot(m.x - x, m.y - y);
        if (d <= bd) { bd = d; best = m; }
    }
    return best;
}

/** sphere point -> what lies there on this map (null = outside this map's frame) */
export function hitAt(data: GlobeMapData, b: MapBand, p: Point3, markerRadius = 6): GlobeHit | null {
    const f = lonLatToFrame(b, pointToLonLat(p));
    if (!inFrame(b, f)) return null;
    return { server: data.server, frame: f, area: areaAt(data, f.x, f.y), marker: nearestMarker(data, f.x, f.y, markerRadius) };
}

/** sphere point -> the continent whose frame holds it, and what lies there (null = channel / polar sea) */
export function hitGlobe(continents: readonly GlobeContinent[], p: Point3, markerRadius = 6): GlobeHit | null {
    for (const c of continents) {
        const h = hitAt(c.data, c.band, p, markerRadius);
        if (h) return h;
    }
    return null;
}

/** the band of one server's map on the two-continent globe */
export function continentBand(data: GlobeMapData): MapBand {
    return makeBand(data.frameW, data.frameH, CONTINENT_LON[data.server]);
}

export function areaLabel(a: GlobeArea): string {
    return a.names.length ? a.names.join(" / ") : `Area ${a.area} (no named place on the game map)`;
}

// ---- the pause MAP screen's globe (web/world-globe-book.js) ----

/** The disc MAP page's server rule (F0x8009a670; engine/dw3/ui/native/map-server.ts MAP_SERVER_LOW / MAP_SERVER_HIGH):
 *  PS1 stage id below 0x270 = Asuka, 0x270..0x2D6 = Amaterasu, 0x2D7 and up = no map (the pause list refuses MAP there). */
export const STAGE_AMATERASU = 0x270;
export const STAGE_NO_MAP = 0x2d7;

export function globeServerOfStage(ps1: number): GlobeServer | null {
    if (!Number.isInteger(ps1) || ps1 >= STAGE_NO_MAP) return null;
    return ps1 < STAGE_AMATERASU ? "asuka" : "amaterasu";
}

/** status_ui.json screens.map.markers holds each record's icon top-left; the globe files hold the icon centre, 12.5 frame px
 *  further on both axes (measured: the same offset for all 45 records of both files). Used only for a record the globe file
 *  lacks (record 46, Phoenix Bay). */
export const MARKER_ICON_CENTRE = 12.5;

/** Your place on the globe: the globe file's marker for the record (`here.record` = place + 1, web/menu/pure.ts mapMarkerRecord),
 *  else the status_ui icon's centre; null when the stage has no map or nothing is known about the record. */
export function globePlace(continents: readonly GlobeContinent[], here: GlobeHereInput): GlobePlace | null {
    const server = here.server;
    if (!server) return null;
    const c = continents.find((k) => k.data.server === server);
    if (!c) return null;
    const marker = c.data.markers.find((m) => m.loc === here.record) ?? null;
    const frame: FramePoint | null = marker ? { x: marker.x, y: marker.y }
        : here.icon ? { x: here.icon.x + MARKER_ICON_CENTRE, y: here.icon.y + MARKER_ICON_CENTRE } : null;
    if (!frame) return null;
    return { server, record: here.record, frame, lonLat: frameToLonLat(c.band, frame.x, frame.y), marker };
}

/** The MAP screen's camera limits (chosen, not from the disc). The turn and zoom speeds are the zoom's (web/world-globe-zoom.ts
 *  ZOOM.turnRate / zoomRate): the turn scales with the camera's height, so it feels the same at every zoom. */
export const GLOBE_VIEW = Object.freeze({
    /** distance from the centre the start view is given in (globe radii) */
    distStart: 2.2,
    /** the maps reach +-58.2 deg; the camera may look a little past that, never over a pole */
    latMax: (65 * Math.PI) / 180,
});

/** The buttons that move the MAP globe this frame (held directions turn, L1 zooms in, R1 zooms out). */
export interface GlobeMoves {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    zoomIn: boolean;
    zoomOut: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Where the MAP globe opens: looking straight at your place, else at your server's continent centre. */
export function globeStartView(server: GlobeServer | null, place: GlobePlace | null): GlobeCamView {
    if (place) return { lon: place.lonLat.lon, lat: clamp(place.lonLat.lat, -GLOBE_VIEW.latMax, GLOBE_VIEW.latMax), dist: GLOBE_VIEW.distStart };
    return { lon: CONTINENT_LON[server ?? "asuka"], lat: 0, dist: GLOBE_VIEW.distStart };
}

/** The Map screen value in force. The player's own pick ("classic" or "new", saved in fx) wins in both modes;
 *  with no pick it follows the mode: HD Remaster = "new" (the globe), Authentic = "classic". */
export function effectiveMapScreen(saved: unknown, hd: boolean): MapScreenChoice {
    if (saved === "classic" || saved === "new") return saved;
    return hd ? "new" : "classic";
}

/** Which screen the pause list's MAP row opens. OPTIONS > GAME > Map screen: "new" = the globe, anything else = the disc's page.
 *  The globe also needs a map for the stage and a GPU WebGL context (`gpu()` makes or reuses it); without either it is the disc's page. */
export function mapScreenRoute(choice: unknown, server: GlobeServer | null, gpu: () => boolean): MapScreenRoute {
    if (choice !== "new" || !server) return "classic";
    return gpu() ? "globe" : "classic";
}

// ---- data file check (the json is outside data: it enters as unknown and is checked field by field) ----

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, what: string): number => { if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`world-globe data: ${what} is not a number`); return v; };
const str = (v: unknown, what: string): string => { if (typeof v !== "string") throw new Error(`world-globe data: ${what} is not a string`); return v; };
const arr = (v: unknown, what: string): unknown[] => { if (!Array.isArray(v)) throw new Error(`world-globe data: ${what} is not a list`); return v; };
const strList = (v: unknown, what: string): string[] => arr(v, what).map((s, i) => str(s, `${what}[${i}]`));
const rec = (v: unknown, what: string): Rec => { if (!isRec(v)) throw new Error(`world-globe data: ${what} is not an object`); return v; };
const isServer = (s: string): s is GlobeServer => s === "asuka" || s === "amaterasu";

function parseRun(v: unknown, what: string): AreaRun {
    const a = arr(v, what);
    if (a.length !== 3) throw new Error(`world-globe data: ${what} needs 3 numbers`);
    return [num(a[0], what), num(a[1], what), num(a[2], what)];
}

function parseArea(v: unknown, i: number): GlobeArea {
    const r = rec(v, `areas[${i}]`), c = rec(r["centre"], `areas[${i}].centre`);
    return {
        area: num(r["area"], `areas[${i}].area`),
        names: strList(r["names"], `areas[${i}].names`),
        maps: strList(r["maps"], `areas[${i}].maps`),
        centre: { x: num(c["x"], `areas[${i}].centre.x`), y: num(c["y"], `areas[${i}].centre.y`) },
        runs: arr(r["runs"], `areas[${i}].runs`).map((q, j) => parseRun(q, `areas[${i}].runs[${j}]`)),
    };
}

function parseMarker(v: unknown, i: number): GlobeMarker {
    const r = rec(v, `markers[${i}]`), a = r["area"];
    return {
        loc: num(r["loc"], `markers[${i}].loc`), name: str(r["name"], `markers[${i}].name`),
        maps: strList(r["maps"], `markers[${i}].maps`),
        x: num(r["x"], `markers[${i}].x`), y: num(r["y"], `markers[${i}].y`),
        area: a === null ? null : num(a, `markers[${i}].area`),
    };
}

// ETS item 42: the json comes from outside (fetch / readFileSync), so it is unknown and every field is checked here.
export function parseGlobeMap(raw: unknown): GlobeMapData {
    const r = rec(raw, "file");
    const server = str(r["server"], "server");
    if (!isServer(server)) throw new Error(`world-globe data: unknown server ${server}`);
    const sea = arr(r["seaRgb"], "seaRgb");
    if (sea.length !== 3) throw new Error("world-globe data: seaRgb needs 3 numbers");
    return {
        server, image: str(r["image"], "image"),
        frameW: num(r["frameW"], "frameW"), frameH: num(r["frameH"], "frameH"), imageScale: num(r["imageScale"], "imageScale"),
        seaRgb: [num(sea[0], "seaRgb"), num(sea[1], "seaRgb"), num(sea[2], "seaRgb")],
        fitIou: num(r["fitIou"], "fitIou"),
        areas: arr(r["areas"], "areas").map(parseArea),
        markers: arr(r["markers"], "markers").map(parseMarker),
    };
}

// ---- the original map icons on the markers ----
// The disc's MAP page (web/menu/draw-map.ts, engine/dw3/ui/native/pause-map.ts) draws every shown marker record as clip
// `record.clip` of the server's icon sheet at (record.x, record.y); the globe draws the same clip, centred on the same box.

/** The icon sheet of each server's map (sub 2 of the map packs): stwmp0 Asuka, stwmp1 Amaterasu. */
export const ICON_PACK: Readonly<Record<GlobeServer, string>> = { asuka: "stwmp0icon", amaterasu: "stwmp1icon" };

/** Globe radii per map frame px at latitude `lat`: the map's local scale on the sphere (Mercator keeps it the same both ways). */
export function frameScaleAt(b: MapBand, lat: number): number {
    return (b.lonSpan / b.frameW) * Math.cos(lat);
}

/** The box a clip's layers cover, relative to the clip's position (px). */
export function clipBox(clip: IconClip): ClipBox {
    const L = clip.layers;
    if (!L.length) return { x: 0, y: 0, w: 0, h: 0 };
    const x0 = Math.min(...L.map((l) => l.dx)), y0 = Math.min(...L.map((l) => l.dy));
    const x1 = Math.max(...L.map((l) => l.dx + l.w)), y1 = Math.max(...L.map((l) => l.dy + l.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** true when every layer's source rect lies inside a sheet picture of `size` */
export function clipInSheet(clip: IconClip, size: SheetSize): boolean {
    return clip.layers.length > 0 && clip.layers.every((l) => l.w > 0 && l.h > 0 && l.x >= 0 && l.y >= 0 && l.x + l.w <= size.w && l.y + l.h <= size.h);
}

/** One continent's markers with their original icons: each globe marker's record (same `loc`), its clip from the server's
 *  sheet, the icon box centre (record position + box centre) on the sphere, and its size there (box px x frameScaleAt).
 *  Throws when a marker has no record, the clip is missing or a layer lies outside the sheet: the globe then fails to load. */
export function markerIcons(c: GlobeContinent, records: readonly GlobeMarkerRecord[], sheet: IconSheet, size: SheetSize): GlobeMarkerIcon[] {
    const byLoc = new Map(records.map((r) => [r.loc, r]));
    return c.data.markers.map((marker) => {
        const r = byLoc.get(marker.loc);
        if (!r) throw new Error(`world-globe icons: ${c.data.server} marker ${marker.loc} has no record in the marker table`);
        const clip = sheet.get(r.clip);
        if (!clip) throw new Error(`world-globe icons: ${ICON_PACK[c.data.server]} has no clip ${r.clip} (marker ${marker.loc})`);
        if (!clipInSheet(clip, size)) throw new Error(`world-globe icons: ${ICON_PACK[c.data.server]} clip ${r.clip} lies outside the sheet`);
        const box = clipBox(clip);
        const centre: FramePoint = { x: r.x + box.x + box.w / 2, y: r.y + box.y + box.h / 2 };
        const lonLat = frameToLonLat(c.band, centre.x, centre.y);
        const s = frameScaleAt(c.band, lonLat.lat);
        return { server: c.data.server, marker, clip: r.clip, box, centre, lonLat, size: { w: box.w * s, h: box.h * s } };
    });
}

// ---- the HD icons: Gemini's repaint of the 36 location clips (the same art on both continents) ----
// Files web/assets/world-globe/icons-hd/clipNN.png (git-ignored, made by the scratch tool world-globe/icons/gemini/cut/cut.py):
// square RGBA pictures that cover HD_ICON_SPAN original px, centred on the clip's 24 x 24 box (the repaint reaches a little
// past the box), the same px per original px for every clip. The globe draws them smooth (linear filter, mipmaps), at the
// clip's own map scale, so the size rule stays the original one. A picture that does not load leaves that clip on the disc art.

/** the HD icon folder inside the globe asset folder */
export const HD_ICON_DIR = "icons-hd/";
/** original px one HD picture covers, both ways (the clip box is 24) */
export const HD_ICON_SPAN = 36;

/** the HD picture of a clip, relative to the globe asset folder */
export function hdIconFile(clip: number): string {
    return `${HD_ICON_DIR}clip${String(clip).padStart(2, "0")}.png`;
}

/** the clips the shown markers draw (each once, ascending): only these HD pictures are loaded */
export function shownIconClips(continents: readonly GlobeContinent[], records: readonly GlobeMarkerRecord[]): number[] {
    const locs = new Set(continents.flatMap((c) => c.data.markers.map((m) => m.loc)));
    return [...new Set(records.filter((r) => locs.has(r.loc)).map((r) => r.clip))].sort((a, b) => a - b);
}

/** Load the HD picture of every clip in `clips` with `load` (url -> picture); one that fails is left out (that clip then
 *  draws the disc art). Never rejects. */
export async function loadHdIcons<T>(clips: readonly number[], dir: string, load: (url: string) => Promise<T>): Promise<Map<number, T>> {
    const got = await Promise.all(clips.map((clip) => load(`${dir}${hdIconFile(clip)}`).then((img): [number, T] | null => [clip, img], () => null)));
    return new Map(got.filter((e): e is [number, T] => e !== null));
}

/** What a marker's billboard shows: its clip's HD picture at HD_ICON_SPAN px of the icon's own scale, or, when there is
 *  none, the disc clip at the box size. */
export function iconArt<T>(icon: GlobeMarkerIcon, hd: ReadonlyMap<number, T>): GlobeIconArt<T> {
    const pic = hd.get(icon.clip);
    if (pic === undefined || !(icon.box.w > 0) || !(icon.box.h > 0)) return { hd: null, size: icon.size };
    return { hd: pic, size: { w: (HD_ICON_SPAN * icon.size.w) / icon.box.w, h: (HD_ICON_SPAN * icon.size.h) / icon.box.h } };
}

// ETS item 42: status_ui.json and the sheet files come from outside, so they enter as unknown and are checked here.

/** status_ui.json -> screens.map.markers, the disc's marker table (records 1..46). */
export function parseMarkerRecords(raw: unknown): GlobeMarkerRecord[] {
    const map = rec(rec(rec(raw, "status_ui")["screens"], "status_ui.screens")["map"], "status_ui.screens.map");
    return arr(map["markers"], "screens.map.markers").map((v, i) => {
        const r = rec(v, `screens.map.markers[${i}]`), w = `screens.map.markers[${i}]`;
        return { loc: num(r["loc"], `${w}.loc`), clip: num(r["clip"], `${w}.clip`), x: num(r["x"], `${w}.x`), y: num(r["y"], `${w}.y`) };
    });
}

function parseLayer(v: unknown, what: string): IconLayer {
    const l = rec(v, what);
    return { x: num(l["x"], `${what}.x`), y: num(l["y"], `${what}.y`), w: num(l["w"], `${what}.w`), h: num(l["h"], `${what}.h`),
        dx: num(l["dx"], `${what}.dx`), dy: num(l["dy"], `${what}.dy`) };
}

/** a UI sheet json (web/assets/ui/<pack>_sheet.json: clip id -> {layers}, maybe under "ids") -> its clips by id */
export function parseIconSheet(raw: unknown): IconSheet {
    const top = rec(raw, "sheet"), ids = top["ids"] === undefined ? top : rec(top["ids"], "sheet.ids");
    const out = new Map<number, IconClip>();
    for (const [k, v] of Object.entries(ids)) {
        const id = Number(k);
        if (!Number.isInteger(id)) throw new Error(`world-globe data: sheet clip id ${k} is not a whole number`);
        out.set(id, { layers: arr(rec(v, `clip ${k}`)["layers"], `clip ${k}.layers`).map((l, i) => parseLayer(l, `clip ${k}.layers[${i}]`)) });
    }
    return out;
}
