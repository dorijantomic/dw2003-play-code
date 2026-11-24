// World Globe page maths (web/world-globe-map.js): the game's two world maps as two continents on one sphere (Asuka at
// longitude 0, Amaterasu at 180, Mercator in latitude); frame px -> longitude / latitude -> sphere point / texture -> back,
// no overlap, turning, area and marker lookup, data file check, and the baked texture's channel / pole pixels. Then the older
// stitched layout (web/world-globe-layout.js). Synthetic cases always run; the real data (web/assets) runs when it is there.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import {
    buildWorld, buildPlaces, nearestSide, overlaps, adjacent, fitWorld, textureSize, worldToTex, texToWorld, hitTest,
    OVERLAP_TOL,
} from "../web/world-globe-layout.js";
import { isOpenAirMapName } from "../web/map-open-air.js";
import {
    GLOBE_TEXTURE, GLOBE_TEX_W, GLOBE_TEX_H, GLOBE_SERVERS, CONTINENT_LON, MAP_LON_SPAN, makeBand, bandEdgeLat, continentBand,
    frameToLonLat, lonLatToFrame, lonLatToUv, uvToLonLat, lonLatToPoint, pointToLonLat, inFrame, areaAt, nearestMarker, hitAt,
    hitGlobe, parseGlobeMap, viewAzimuth, angleDelta, easeInOut,
} from "../web/world-globe-map.js";

const DEG = Math.PI / 180;
const BANDS = { asuka: makeBand(392, 336, CONTINENT_LON.asuka), amaterasu: makeBand(392, 336, CONTINENT_LON.amaterasu) };
/** frame px -> sphere point -> frame px, and frame px -> three.js uv -> frame px */
const viaPoint = (b, x, y) => lonLatToFrame(b, pointToLonLat(lonLatToPoint(frameToLonLat(b, x, y), 1)));
const viaUv = (b, x, y) => lonLatToFrame(b, uvToLonLat(lonLatToUv(frameToLonLat(b, x, y))));
/** longitude / latitude -> the texture pixel (column, row) that holds it */
const texelOf = (ll, texW = GLOBE_TEX_W, texH = GLOBE_TEX_H) => {
    const uv = lonLatToUv(ll);
    return { tx: Math.min(texW - 1, Math.floor(uv.u * texW)), ty: Math.min(texH - 1, Math.floor((1 - uv.v) * texH)) };
};
/** frame px -> nearest texture pixel centre -> frame px (what a picked texel can tell apart) */
const viaTexel = (b, x, y, texW = GLOBE_TEX_W, texH = GLOBE_TEX_H) => {
    const { tx, ty } = texelOf(frameToLonLat(b, x, y), texW, texH);
    return lonLatToFrame(b, uvToLonLat({ u: (tx + 0.5) / texW, v: 1 - (ty + 0.5) / texH }));
};

test("two continents: frame px -> sphere point / uv -> back is exact, Mercator (no stretch), edges at +-58.2 deg", () => {
    for (const s of GLOBE_SERVERS) {
        const b = BANDS[s];
        for (let y = 0; y <= 336; y += 21) for (let x = 0; x <= 392; x += 28) {
            for (const f of [viaPoint, viaUv]) {
                const q = f(b, x, y);
                assert.ok(Math.abs(q.x - x) < 1e-6 && Math.abs(q.y - y) < 1e-6, `${s} ${f.name} ${x},${y} -> ${q.x},${q.y}`);
            }
            const p = lonLatToPoint(frameToLonLat(b, x, y), 1);
            assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < 1e-12);
        }
        const top = frameToLonLat(b, 196, 0).lat / DEG, bottom = frameToLonLat(b, 196, 336).lat / DEG;
        assert.ok(Math.abs(top + bottom) < 1e-9 && Math.abs(top - bandEdgeLat(b) / DEG) < 1e-9 && top > 58 && top < 58.5, `${s} edge at ${top} deg`);
        for (const y of [20, 100, 168, 250, 320]) {
            const ll = frameToLonLat(b, 196, y), ll2 = frameToLonLat(b, 196, y + 1e-4);
            const dLat = Math.abs(ll2.lat - ll.lat) / 1e-4, dLon = b.lonSpan / 392 * Math.cos(ll.lat);
            assert.ok(Math.abs(dLat / dLon - 1) < 1e-3, `${s} stretch ${dLat / dLon} at y ${y}`);
        }
    }
    assert.ok(Math.abs(MAP_LON_SPAN / DEG - 168) < 1e-9);
    // Asuka's centre faces the starting camera (+x), Amaterasu's centre the opposite side (-x)
    const a = lonLatToPoint(frameToLonLat(BANDS.asuka, 196, 168), 1), m = lonLatToPoint(frameToLonLat(BANDS.amaterasu, 196, 168), 1);
    assert.ok(Math.abs(a.x - 1) < 1e-12 && Math.abs(a.y) < 1e-12 && Math.abs(a.z) < 1e-12);
    assert.ok(Math.abs(m.x + 1) < 1e-12 && Math.abs(m.y) < 1e-12 && Math.abs(m.z) < 1e-12);
    // edges: Asuka -84..84 deg, Amaterasu 96..264 (= -96 through 180); channels 84..96 and -96..-84
    assert.ok(Math.abs(frameToLonLat(BANDS.asuka, 392, 0).lon / DEG - 84) < 1e-9);
    assert.ok(Math.abs(frameToLonLat(BANDS.asuka, 0, 0).lon / DEG + 84) < 1e-9);
    assert.ok(Math.abs(frameToLonLat(BANDS.amaterasu, 0, 0).lon / DEG - 96) < 1e-9);
    assert.ok(Math.abs(frameToLonLat(BANDS.amaterasu, 392, 0).lon / DEG + 96) < 1e-9);
});

test("two continents: the maps never overlap, channels and poles belong to no map", () => {
    for (const [s, o] of [["asuka", "amaterasu"], ["amaterasu", "asuka"]]) {
        for (let y = 0; y < 336; y += 4) for (let x = 0; x < 392; x += 2) {
            const f = lonLatToFrame(BANDS[o], frameToLonLat(BANDS[s], x + 0.5, y + 0.5));
            assert.ok(!inFrame(BANDS[o], f), `${s} ${x},${y} lies on ${o} at ${f.x},${f.y}`);
        }
    }
    for (let lat = -58; lat <= 58; lat += 2) for (const lon of [85, 90, 95, -85, -90, -95]) {
        for (const s of GLOBE_SERVERS) assert.ok(!inFrame(BANDS[s], lonLatToFrame(BANDS[s], { lon: lon * DEG, lat: lat * DEG })), `channel ${lon},${lat} on ${s}`);
    }
    for (let lon = -180; lon < 180; lon += 5) for (const lat of [60, 75, 89.9, -60, -75, -89.9]) {
        for (const s of GLOBE_SERVERS) assert.ok(!inFrame(BANDS[s], lonLatToFrame(BANDS[s], { lon: lon * DEG, lat: lat * DEG })), `polar ${lon},${lat} on ${s}`);
    }
});

test("globe texture: texel picking within 1 px on both continents (also across the texture's left / right edge)", () => {
    for (const s of GLOBE_SERVERS) for (let y = 0.5; y < 336; y += 7) for (let x = 0.5; x < 392; x += 9) {
        const q = viaTexel(BANDS[s], x, y);
        assert.ok(Math.hypot(q.x - x, q.y - y) < 1, `${s} texel ${x},${y} -> ${q.x},${q.y}`);
    }
});

test("turning: the camera azimuth for a continent looks at its centre; shortest turn; easing", () => {
    for (const s of GLOBE_SERVERS) {
        const th = viewAzimuth(CONTINENT_LON[s]);
        // three.js Spherical at phi = pi/2: (sin theta, 0, cos theta)
        const cam = { x: Math.sin(th), y: 0, z: Math.cos(th) };
        const c = lonLatToPoint(frameToLonLat(BANDS[s], 196, 168), 1);
        assert.ok(Math.hypot(cam.x - c.x, cam.y - c.y, cam.z - c.z) < 1e-12, `${s} camera direction`);
    }
    assert.ok(Math.abs(Math.abs(angleDelta(viewAzimuth(0), viewAzimuth(Math.PI))) - Math.PI) < 1e-12);
    assert.ok(Math.abs(angleDelta(3, -3) - (2 * Math.PI - 6)) < 1e-12, "turns the short way across +-pi");
    assert.equal(easeInOut(0), 0); assert.equal(easeInOut(1), 1); assert.equal(easeInOut(0.5), 0.5);
    for (let t = 0; t < 1; t += 0.05) assert.ok(easeInOut(t + 0.05) >= easeInOut(t));
});

const SYN = parseGlobeMap({
    server: "asuka", image: "asuka_globe_map.png", frameW: 392, frameH: 336, imageScale: 3, seaRgb: [20, 40, 90], fitIou: 0.9,
    areas: [
        { area: 1, names: ["Town A"], maps: ["s1"], centre: { x: 15, y: 11 }, runs: [[10, 10, 20], [11, 10, 20], [12, 12, 18]] },
        { area: 2, names: [], maps: [], centre: { x: 19, y: 11 }, runs: [[11, 18, 25]] },
    ],
    markers: [{ loc: 3, name: "Gym", maps: ["s9"], x: 14.5, y: 10.5, area: 1 }, { loc: 4, name: "Cave", maps: [], x: 100.5, y: 100.5, area: null }],
});
const SYN2 = parseGlobeMap({ ...SYN, server: "amaterasu", markers: [{ loc: 5, name: "Dock", maps: [], x: 14.5, y: 10.5, area: 1 }] });

test("globe lookup: topmost area by runs, nearest marker, the right continent, sea in the channels", () => {
    assert.equal(areaAt(SYN, 11, 10.7)?.area, 1);
    assert.equal(areaAt(SYN, 19.5, 11.2)?.area, 2, "area 2 is drawn later, so it lies on top");
    assert.equal(areaAt(SYN, 11, 12.5), null);
    assert.equal(nearestMarker(SYN, 16, 12, 6)?.name, "Gym");
    assert.equal(nearestMarker(SYN, 60, 60, 6), null);
    const p = lonLatToPoint(frameToLonLat(BANDS.asuka, 12.5, 10.5), 1);
    const h = hitAt(SYN, BANDS.asuka, p);
    assert.equal(h?.area?.area, 1);
    assert.equal(h?.marker?.name, "Gym");
    assert.equal(h?.server, "asuka");
    assert.equal(hitAt(SYN, BANDS.asuka, { x: -1, y: 0, z: 0 }), null, "the far side is the other continent");
    const both = [{ data: SYN, band: continentBand(SYN) }, { data: SYN2, band: continentBand(SYN2) }];
    const far = hitGlobe(both, lonLatToPoint(frameToLonLat(BANDS.amaterasu, 12.5, 10.5), 1));
    assert.equal(far?.server, "amaterasu");
    assert.equal(far?.marker?.name, "Dock");
    assert.equal(hitGlobe(both, lonLatToPoint({ lon: 90 * DEG, lat: 0 }, 1)), null, "channel");
    assert.equal(hitGlobe(both, { x: 0, y: 1, z: 0 }), null, "north pole");
    assert.throws(() => parseGlobeMap({ ...SYN, server: "mars" }));
    assert.throws(() => parseGlobeMap({ ...SYN, areas: [{ area: 1 }] }));
});

const globeFile = (s) => new URL(`../web/assets/world-globe/${s}.json`, import.meta.url);
const HAVE_GLOBE = GLOBE_SERVERS.every((s) => existsSync(globeFile(s)));
const readGlobe = (s) => parseGlobeMap(JSON.parse(readFileSync(globeFile(s), "utf8")));
test("real globe data: every area centre -> sphere point -> back within 1 px (also via texel), markers on their continent and area", { skip: !HAVE_GLOBE && "web/assets/world-globe not present" }, () => {
    const continents = GLOBE_SERVERS.map((s) => { const data = readGlobe(s); return { data, band: continentBand(data) }; });
    for (const { data: d, band: b } of continents) {
        const s = d.server;
        assert.equal(d.areas.length, 22);
        assert.equal(d.markers.length, 45);
        assert.deepEqual([b.frameW, b.frameH, b.lonCentre], [392, 336, CONTINENT_LON[s]]);
        for (const a of d.areas) {
            const { x, y } = a.centre;
            const back = lonLatToFrame(b, pointToLonLat(lonLatToPoint(frameToLonLat(b, x, y), 1)));
            assert.ok(Math.hypot(back.x - x, back.y - y) < 1, `${s} area ${a.area} point round trip`);
            const t = viaTexel(b, x, y);
            assert.ok(Math.hypot(t.x - x, t.y - y) < 1, `${s} area ${a.area} texel round trip ${t.x},${t.y}`);
            for (const [ry, x0, x1] of a.runs) assert.ok(ry >= 0 && ry < 336 && x0 >= 0 && x1 <= 392 && x1 > x0);
        }
        for (const m of d.markers) {
            const h = hitGlobe(continents, lonLatToPoint(frameToLonLat(b, m.x, m.y), 1));
            assert.ok(h, `${s} marker ${m.name} off the map`);
            assert.equal(h.server, s, `${s} marker ${m.name} continent`);
            assert.equal(h.area?.area ?? null, m.area, `${s} marker ${m.name} area`);
            assert.equal(h.marker, m);
        }
        // the per-server picture: PNG, 3 x the frame
        const png = readFileSync(new URL(`../web/assets/world-globe/${d.image}`, import.meta.url));
        assert.equal(png.toString("latin1", 1, 4), "PNG");
        assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [d.frameW * d.imageScale, d.frameH * d.imageScale]);
    }
});

/** minimal PNG reader: 8-bit RGB, not interlaced (what the texture tool writes) -> { w, h, px } */
function readPngRgb(buf) {
    assert.equal(buf.toString("latin1", 1, 4), "PNG");
    let off = 8, w = 0, h = 0;
    const idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off), type = buf.toString("latin1", off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
        if (type === "IHDR") {
            w = data.readUInt32BE(0); h = data.readUInt32BE(4);
            assert.deepEqual([data[8], data[9], data[12]], [8, 2, 0], "8-bit RGB, not interlaced");
        } else if (type === "IDAT") idat.push(data);
        else if (type === "IEND") break;
        off += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const stride = w * 3, px = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
        for (let i = 0; i < stride; i++) {
            const a = i >= 3 ? px[dst + i - 3] : 0, b = y > 0 ? px[up + i] : 0, c = i >= 3 && y > 0 ? px[up + i - 3] : 0;
            let v = raw[src + i];
            if (f === 1) v += a;
            else if (f === 2) v += b;
            else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
            px[dst + i] = v & 255;
        }
    }
    return { w, h, px };
}
/** the map tools' sea colour rule (scratch gemmask.py): HSV on PIL's 0-255 scale, hue 136..225, sat >= 90, value <= 160 */
function isSea(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (mx === 0 || d === 0) return false;
    let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = ((hue * 60 + 360) % 360) / 360 * 255;
    return hue >= 136 && hue <= 225 && (d / mx) * 255 >= 90 && mx <= 160;
}
const isIce = (r, g, b) => r >= 200 && g >= 200 && b >= 200 && b >= r;

const texFile = new URL(`../web/assets/world-globe/${GLOBE_TEXTURE}`, import.meta.url);
test("globe texture pixels: channels and the sea above / below the maps are sea, the poles are ice, the maps where this module puts them", { skip: !(HAVE_GLOBE && existsSync(texFile)) && "globe texture not present" }, () => {
    const { w, h, px } = readPngRgb(readFileSync(texFile));
    assert.deepEqual([w, h], [GLOBE_TEX_W, GLOBE_TEX_H]);
    const rgb = (lonDeg, latDeg) => { const { tx, ty } = texelOf({ lon: lonDeg * DEG, lat: latDeg * DEG }, w, h); const i = (ty * w + tx) * 3; return [px[i], px[i + 1], px[i + 2]]; };
    let n = 0;
    // channels (12 deg wide; 1 deg kept clear of each map edge) from map bottom to map top
    for (let lat = -58; lat <= 58; lat += 0.5) for (const lon of [85, 87.5, 90, 92.5, 95, -85, -87.5, -90, -92.5, -95]) {
        const c = rgb(lon, lat); n++;
        assert.ok(isSea(...c), `channel ${lon},${lat} not sea: ${c}`);
    }
    // between the map edges (58.2 deg) and the ice: sea all round
    for (let lon = -179.5; lon < 180; lon += 1) for (const lat of [59, 61, 63, -59, -61, -63]) {
        const c = rgb(lon, lat); n++;
        assert.ok(isSea(...c), `polar sea ${lon},${lat} not sea: ${c}`);
    }
    // ice caps from 80 deg to the poles
    for (let lon = -179.5; lon < 180; lon += 1) for (const lat of [80, 85, 89.9, -80, -85, -89.9]) {
        const c = rgb(lon, lat); n++;
        assert.ok(isIce(...c), `pole ${lon},${lat} not ice: ${c}`);
    }
    assert.ok(n > 3000);
    // the texture tool and this module agree on where the maps are: at every area centre the texture shows the colour the
    // per-server map picture has at that frame point
    for (const s of GLOBE_SERVERS) {
        const d = readGlobe(s), b = continentBand(d);
        const pic = readPngRgb(readFileSync(new URL(`../web/assets/world-globe/${d.image}`, import.meta.url)));
        // measured 2026-11-23: mean RGB distance 4.0 / 3.9 here; 33-67 with the band shifted 2 frame px or on the other continent
        let sum = 0;
        for (const a of d.areas) {
            const ll = frameToLonLat(b, a.centre.x, a.centre.y);
            const t = rgb(ll.lon / DEG, ll.lat / DEG);
            const i = (Math.floor(a.centre.y * d.imageScale) * pic.w + Math.floor(a.centre.x * d.imageScale)) * 3;
            sum += Math.hypot(t[0] - pic.px[i], t[1] - pic.px[i + 1], t[2] - pic.px[i + 2]);
        }
        assert.ok(sum / d.areas.length < 12, `${s}: texture vs map picture at the area centres, mean RGB distance ${sum / d.areas.length}`);
    }
});

const D = " — ";
// Three open-air maps in a row (A east exit -> B -> C), a twin of A (renamed), and one interior map behind a door of B.
const MAPS = [
    { id: "s330", name: `Central Sector${D}Central Park`, width: 1000, height: 800 },
    { id: "s331", name: `Central Sector${D}Central Park`, width: 1000, height: 800 },
    { id: "s335", name: `Central Sector${D}Wire Forest Entrance`, width: 600, height: 700 },
    { id: "s350", name: `East Sector${D}West Wire Forest`, width: 1200, height: 600 },
    { id: "s1000", name: `Central Sector${D}Some House`, width: 320, height: 240 },
    { id: "s1001", name: `Central Sector${D}Some House Upstairs`, width: 320, height: 240 },
    { id: "s780", name: `Kusanagi City${D}Street Corner`, width: 640, height: 384 },
];
const ex = (x, y, w, h, to, spawnX, spawnY) => ({ x, y, w, h, to, spawnX, spawnY });
const SCENES = {
    s330: { exits: [ex(940, 380, 40, 64, "s335", 60, 300), ex(400, 300, 64, 64, "s1000", 100, 200)] },
    s331: { exits: [ex(940, 380, 40, 64, "s335", 60, 300), ex(400, 300, 64, 64, "s1000", 100, 200)] },
    s335: { exits: [ex(20, 280, 40, 64, "s330", 930, 410), ex(300, 640, 64, 40, "s350", 200, 60)] },
    s350: { exits: [ex(200, 20, 64, 40, "s335", 330, 640)] },
    s1000: { exits: [ex(20, 20, 40, 40, "s330", 430, 360), ex(100, 100, 40, 40, "s1001", 50, 50)] },
    s1001: { exits: [ex(20, 20, 40, 40, "s1000", 120, 120)] },
    s780: { exits: [] },
};

test("nearestSide: the closest edge and how far (0..0.5)", () => {
    assert.deepEqual(nearestSide(990, 400, 1000, 800), { side: "E", score: 0.01 });
    assert.equal(nearestSide(500, 10, 1000, 800).side, "N");
    assert.equal(nearestSide(5, 400, 1000, 800).side, "W");
    assert.equal(nearestSide(500, 790, 1000, 800).side, "S");
});

test("overlap and adjacency tolerances", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    assert.equal(overlaps(a, { x: 100, y: 0, w: 100, h: 100 }), false);          // flush
    assert.equal(overlaps(a, { x: 100 - OVERLAP_TOL, y: 0, w: 100, h: 100 }), false);
    assert.equal(overlaps(a, { x: 50, y: 50, w: 100, h: 100 }), true);
    assert.equal(adjacent(a, { x: 100, y: 40, w: 50, h: 50 }), true);
    assert.equal(adjacent(a, { x: 100, y: 200, w: 50, h: 50 }), false);          // corner-far
    assert.equal(adjacent(a, { x: 300, y: 0, w: 50, h: 50 }), false);
});

test("synthetic world: twins merge, B east of A, C south of B, exit meets spawn, interior becomes a pin", () => {
    const w = buildWorld({ maps: MAPS, scenes: SCENES, variants: {} });
    const by = Object.fromEntries(w.places.map((p) => [p.key, p]));
    assert.equal(w.places.length, 4, "s330+s331 are one place; s335, s350, s780 each one");
    assert.deepEqual(by.s330.ids, ["s330", "s331"]);
    assert.equal(w.stats.overlaps, 0);
    // s335 east of s330: flush on x, exit (960,412) meets spawn (60,300): y = 412 - 300
    assert.equal(by.s335.x, by.s330.x + 1000);
    assert.equal(by.s335.y - by.s330.y, 112);
    // s350 south of s335 (exit on its S edge), exit (332,660) meets spawn (200,60): x = 332 - 200
    assert.equal(by.s350.y, by.s335.y + 700);
    assert.equal(by.s350.x - by.s335.x, 132);
    assert.equal(w.stats.treeAdjacent, w.stats.treeEdges);
    // one pin on Central Park holding both interior maps (house + upstairs), at the door centre
    assert.equal(w.pins.length, 1);
    assert.deepEqual(w.pins[0].ids.sort(), ["s1000", "s1001"]);
    assert.equal(w.pins[0].placeKey, "s330");
    assert.deepEqual([w.pins[0].x, w.pins[0].y], [432, 332]);
    // Kusanagi City has no link and no sector side: outside the others
    assert.equal(w.places.filter((p) => overlaps(p, by.s780)).length, 1);
});

test("synthetic world: a blocked slot slides along the edge, still touching", () => {
    const maps = [
        { id: "s330", name: `Central Sector${D}Central Park`, width: 1000, height: 800 },
        { id: "s335", name: `Central Sector${D}Wire Forest Entrance`, width: 600, height: 700 },
        { id: "s340", name: `Central Sector${D}Shell Beach`, width: 640, height: 700 },
    ];
    // both want the same east slot of s330 at the same height
    const scenes = {
        s330: { exits: [ex(940, 380, 40, 64, "s335", 60, 300), ex(940, 400, 40, 64, "s340", 60, 300)] },
        s335: { exits: [ex(20, 280, 40, 64, "s330", 930, 410)] },
        s340: { exits: [ex(20, 300, 40, 64, "s330", 930, 430)] },
    };
    const w = buildWorld({ maps, scenes });
    assert.equal(w.stats.overlaps, 0);
    assert.equal(w.stats.linksAdjacent, 2);
});

test("fit / texture size / pixel maths round-trip", () => {
    const bounds = { x: 0, y: 0, w: 21128, h: 14950 };
    const t = textureSize(bounds);
    assert.equal(t.w, 8192);
    assert.equal(t.h, 4096);
    const fit = fitWorld(bounds, t.w, t.h);
    assert.ok(fit.scale < 1 && bounds.w * fit.scale <= t.w && bounds.h * fit.scale <= t.h);
    const p = worldToTex(fit, 1234, 5678), q = texToWorld(fit, p.x, p.y);
    assert.ok(Math.abs(q.x - 1234) < 1e-6 && Math.abs(q.y - 5678) < 1e-6);
    assert.equal(textureSize({ x: 0, y: 0, w: 900, h: 400 }).w, 1024);
});

test("hitTest finds the place and the nearest pin", () => {
    const w = buildWorld({ maps: MAPS, scenes: SCENES, variants: {} });
    const a = w.places.find((p) => p.key === "s330");
    const inside = hitTest(w, a.x + 10, a.y + 10);
    assert.equal(inside.place.key, "s330");
    assert.equal(inside.pin, null);
    const pin = w.pins[0];
    assert.equal(hitTest(w, pin.wx + 3, pin.wy - 3).pin, pin);
    assert.equal(hitTest(w, -50, -50).place, null);
});

const HAVE = existsSync(new URL("../web/assets/manifest.json", import.meta.url)) && existsSync(new URL("../web/assets/scenes/s200.json", import.meta.url));
test("real data: every open-air map placed, no overlaps, linked maps adjacent", { skip: !HAVE && "web/assets not present" }, () => {
    const read = (p) => JSON.parse(readFileSync(new URL(`../web/${p}`, import.meta.url), "utf8"));
    const maps = read("assets/manifest.json").maps;
    const variants = read("map-variants.json");
    const scenes = {};
    for (const m of maps) scenes[m.id] = read(`assets/scenes/${m.id}.json`);
    const w = buildWorld({ maps, scenes, variants });
    const open = maps.filter((m) => isOpenAirMapName(m.name));
    // every open-air map belongs to exactly one placed place
    const placed = new Map();
    for (const p of w.places) for (const id of p.ids) { assert.ok(!placed.has(id), `${id} twice`); placed.set(id, p); }
    for (const m of open) {
        const p = placed.get(m.id);
        assert.ok(p, `${m.id} ${m.name} is not placed`);
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0, `${m.id} has no position`);
        assert.ok(isOpenAirMapName(m.name));
    }
    assert.equal(placed.size, open.length);
    // interior maps are never drawn
    for (const m of maps) if (!isOpenAirMapName(m.name)) assert.ok(!placed.has(m.id), `${m.id} interior was placed`);
    // no overlaps beyond the tolerance
    for (let i = 0; i < w.places.length; i++) for (let j = i + 1; j < w.places.length; j++)
        assert.ok(!overlaps(w.places[i], w.places[j]), `${w.places[i].key} overlaps ${w.places[j].key}`);
    assert.equal(w.stats.overlaps, 0);
    // linked maps adjacent: every open-air link is touching, allowing the few that a crowded slot pushed apart (counted, small)
    const apart = w.links.filter((l) => !l.adjacent);
    assert.ok(w.links.length >= 30, `only ${w.links.length} links`);
    assert.ok(apart.length <= Math.ceil(w.links.length * 0.1), `${apart.length} of ${w.links.length} links not adjacent: ${apart.map((l) => `${l.a}-${l.b}`)}`);
    // the pinned interior maps lie on their place
    for (const pin of w.pins) {
        const p = w.places.find((q) => q.key === pin.placeKey);
        assert.ok(pin.x >= 0 && pin.x <= p.w && pin.y >= 0 && pin.y <= p.h, `pin of ${pin.placeKey} off the picture`);
        assert.ok(pin.names.length > 0);
    }
    assert.ok(w.pins.length >= 20);
    // the 8192 cap holds
    assert.ok(textureSize(w.bounds, 8192).w <= 8192);
});
