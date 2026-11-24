// web/world-globe.js -- the dev page world-globe.html: the game's two world maps as two continents on one three.js sphere
// (Asuka centred at longitude 0, Amaterasu at 180, sea channels between, ice caps at the poles). The globe itself (renderer,
// texture, place icons) is web/world-globe-view.js, the same module the pause MAP screen draws; this page adds the mouse
// controls, the server radio (turns the globe to that continent), hover names and the side panel. Maths in web/world-globe-map.js.
// GPU only: the renderer is made with failIfMajorPerformanceCaveat, so a software GL is refused (the page says so) instead of used.
// The zoom (maths web/world-globe-zoom.js, objects web/world-globe-zoom-view.js, screens web/world-globe-places.js), the same
// as the MAP book's: drag (or the arrows) turns the globe at every zoom (over a window it pans), the wheel / E / Q / the slider
// zoom into the place whose icon is nearest the view's centre; its icon swaps for a round window with that place's screen. The
// page plays "you are here" on West Wire Forest (s350) at the arrival spawn of the s335 exit, so that place shows its dot.
import * as THREE from "three";
import { CONTINENT_LON, GLOBE_VIEW, MAP_LON_SPAN, areaAt, bandEdgeLat, hitGlobe, areaLabel, easeInOut } from "./world-globe-map.js";
import { makeGlobeRenderer, loadGlobeAssets, buildGlobeScene } from "./world-globe-view.js";
import { ZOOM, ZOOM_BANDS, dragTurn, slerpLonLat, startZoomView, stepZoom, stepZoomView, turnView, zoomView } from "./world-globe-zoom.js";
import { buildZoomScene } from "./world-globe-zoom-view.js";
import type { Rgb, ZoomScene } from "./world-globe-zoom-view.js";
import { globePlaces, parsePlaceMaps, parsePlaceScenes, parseWalkerMap, placeOfMap, screenForTarget } from "./world-globe-places.js";
import type { GlobeHit, GlobeServer, LonLat } from "./types/world-globe-map.js";
import type { GlobePlacesInput, ZoomState, ZoomStepEnv, ZoomView } from "./types/world-globe-zoom.js";

function el<T extends HTMLElement>(id: string, ctor: new () => T): T {
    const e = document.getElementById(id);
    if (!(e instanceof ctor)) throw new Error(`world-globe.html: #${id} missing`);
    return e;
}
const statusEl = el("status", HTMLDivElement), tip = el("tip", HTMLDivElement), info = el("info", HTMLDivElement);
const cv = el("cv", HTMLCanvasElement), pinsBox = el("pins", HTMLInputElement);
const serverBoxes: { server: GlobeServer; box: HTMLInputElement }[] = [
    { server: "asuka", box: el("srv-asuka", HTMLInputElement) },
    { server: "amaterasu", box: el("srv-amaterasu", HTMLInputElement) },
];
const zoomSlider = el("zoom-z", HTMLInputElement), zoomValue = el("zoom-zv", HTMLSpanElement), zoomInfo = el("zoom-info", HTMLDivElement);
const SERVER_NAME: Readonly<Record<GlobeServer, string>> = { asuka: "Asuka", amaterasu: "Amaterasu" };
/** z per wheel px (one notch of 100 px = 0.06), z per second with E / Q held */
const ZOOM_PER_WHEEL_PX = 0.0006, ZOOM_KEY_RATE = ZOOM.zoomRate;
const MARKER_PICK_PX = 6;      // frame px: hover snaps to a place marker this close
const TURN_MS = 1400;          // radio switch: time to turn the globe to the other continent
/** the page's "you are here": West Wire Forest, at the spawn of the s335 exit into it */
const DEV_MAP = "s350", DEV_FROM = "s335";

const say = (t: string): void => { statusEl.textContent = t; };
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const deg = (r: number): string => ((r * 180) / Math.PI).toFixed(1);

async function fetchJson(url: string): Promise<unknown> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const raw: unknown = await r.json();
    return raw;
}

/** the game's tables for the places (status_ui walker_map, the manifest, every scene's exits) and the page's "you are here" */
async function loadPlaces(): Promise<{ places: GlobePlacesInput; scenesRead: number }> {
    const [ui, manifest] = await Promise.all([fetchJson("assets/data/status_ui.json"), fetchJson("assets/manifest.json")]);
    const walker = parseWalkerMap(ui);
    const mapsRaw = typeof manifest === "object" && manifest !== null && "maps" in manifest ? manifest.maps : [];
    const maps = parsePlaceMaps(mapsRaw);
    const raw: Record<string, unknown> = {};
    await Promise.all(maps.map(async (m) => {
        try { raw[m.id] = await fetchJson(`assets/scenes/${m.id}.json`); } catch { /* a map with no scene file has no exits */ }
    }));
    const scenes = parsePlaceScenes(raw);
    const spawn = scenes[DEV_FROM]?.exits.find((e) => e.to === DEV_MAP);
    const p = placeOfMap(walker, DEV_MAP);
    const pos = spawn && typeof spawn.spawnX === "number" && typeof spawn.spawnY === "number" ? { x: spawn.spawnX, y: spawn.spawnY } : null;
    const here = p ? { server: p.server, record: p.record, map: DEV_MAP, pos, entry: null } : null;
    return { places: globePlaces(walker, maps, scenes, here), scenesRead: Object.keys(raw).length };
}

interface Turn { t0: number; from: LonLat; to: LonLat }

async function main() {
    const { renderer, gpu } = (() => {
        try { return makeGlobeRenderer(cv); } catch (e) { say(errText(e)); throw e; }
    })();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    say("loading...");
    const [assets, placeData] = await Promise.all([loadGlobeAssets(), loadPlaces()]);
    const { continents, image } = assets;
    const { places, scenesRead } = placeData;
    const built = buildGlobeScene(renderer, assets);
    const { scene, camera, globe, icons, pickIcon, texW, texH, maxTex } = built;
    scene.background = new THREE.Color(0x05070d);
    pinsBox.addEventListener("change", () => { icons.visible = pinsBox.checked; });
    const seaOf = (s: GlobeServer): Rgb => continents.find((c) => c.data.server === s)?.data.seaRgb ?? [27, 36, 70];
    const zoom: ZoomScene = buildZoomScene(renderer, built, { globeImage: image, sea: { asuka: seaOf("asuka"), amaterasu: seaOf("amaterasu") } });
    const targets = zoom.targets;
    const home = places.here ? targets.findIndex((t) => t.key === places.here?.key) : -1;
    const homeLonLat: LonLat | null = targets[home]?.lonLat ?? null;
    const env: ZoomStepEnv = {
        targets, home, aspect: 1, fovDeg: ZOOM.fovDeg,
        ready: (i: number) => {
            const t = targets[i], s = t ? screenForTarget(t.key, places) : null;
            return !!(s && zoom.pictures.get(s.map));
        },
    };

    const first = serverBoxes.find((s) => s.box.checked)?.server ?? "asuka";
    let view: ZoomView = startZoomView(homeLonLat ?? { lon: CONTINENT_LON[first], lat: 0 }, home);
    let zWanted = 0, lastNow = 0, lastState: ZoomState | null = null, turn: Turn | null = null;
    const keysHeld = new Set<string>();

    const showStatus = (server: GlobeServer): void => {
        const lines = [`GPU: ${gpu}`, `facing: ${SERVER_NAME[server]}`];
        for (const c of continents) {
            const named = c.data.areas.filter((a) => a.names.length).length;
            lines.push(`${SERVER_NAME[c.data.server]}: longitude ${deg(c.band.lonCentre)} +- ${deg(MAP_LON_SPAN / 2)}, latitude +- ${deg(bandEdgeLat(c.band))}; `
                + `${c.data.areas.length} areas (${named} named), ${c.data.markers.length} markers, Gemini fit ${c.data.fitIou.toFixed(3)}`);
        }
        lines.push(`texture ${texW} x ${texH} (file ${image.naturalWidth} x ${image.naturalHeight}, GPU limit ${maxTex})`);
        lines.push(`places: ${places.screens.size} main screens from ${scenesRead} scenes; you are here: ${places.here ? `${places.here.map} (${places.here.how})` : "-"}`);
        say(lines.join("\n"));
    };
    // radio switch: zoom out and turn the look point (shortest way) to that continent's centre, eased
    for (const { server, box } of serverBoxes) {
        box.addEventListener("change", () => {
            if (!box.checked) return;
            zWanted = 0;
            turn = { t0: performance.now(), from: { ...view.look }, to: { lon: CONTINENT_LON[server], lat: 0 } };
            showStatus(server);
        });
    }
    zoomSlider.addEventListener("input", () => { zWanted = Number(zoomSlider.value) / 1000; });
    cv.addEventListener("wheel", (ev: WheelEvent) => {
        ev.preventDefault();
        const px = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaMode === 2 ? ev.deltaY * 800 : ev.deltaY;
        zWanted = Math.min(1, Math.max(0, zWanted - px * ZOOM_PER_WHEEL_PX));
    }, { passive: false });
    const KEYS = new Set(["e", "q", "arrowleft", "arrowright", "arrowup", "arrowdown"]);
    window.addEventListener("keydown", (ev: KeyboardEvent) => { const k = ev.key.toLowerCase(); if (KEYS.has(k)) { keysHeld.add(k); if (k.startsWith("arrow")) ev.preventDefault(); } });
    window.addEventListener("keyup", (ev: KeyboardEvent) => { keysHeld.delete(ev.key.toLowerCase()); });
    window.addEventListener("blur", () => keysHeld.clear());

    // drag: the ground under the pointer moves with it, at every zoom
    let drag: { x: number; y: number; moved: number } | null = null;
    cv.addEventListener("pointerdown", (ev: PointerEvent) => {
        drag = { x: ev.clientX, y: ev.clientY, moved: 0 };
        turn = null;
        cv.classList.add("drag");
        cv.setPointerCapture(ev.pointerId);
    });
    cv.addEventListener("pointermove", (ev: PointerEvent) => {
        if (drag && ev.buttons) {
            const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
            drag.x = ev.clientX; drag.y = ev.clientY; drag.moved += Math.hypot(dx, dy);
            const r = dragTurn(view.z, dx, dy, cv.clientHeight, ZOOM.fovDeg);
            view = turnView(view, r.east, r.north, env, GLOBE_VIEW.latMax);
            tip.style.display = "none";
            return;
        }
        const t = label(pick(ev));
        if (!t) { tip.style.display = "none"; return; }
        tip.textContent = t;
        tip.style.display = "block"; tip.style.left = ev.clientX + 14 + "px"; tip.style.top = ev.clientY + 14 + "px";
    });
    cv.addEventListener("pointerup", (ev: PointerEvent) => {
        cv.classList.remove("drag");
        const d = drag; drag = null;
        if (!d || d.moved > 4) return;
        const h = pick(ev);
        if (!h || (!h.area && !h.marker)) { info.textContent = ""; return; }
        const lines: string[] = [`continent: ${SERVER_NAME[h.server]}`];
        if (h.marker) lines.push(`place: ${h.marker.name}`);
        if (h.area) lines.push(`area ${h.area.area}: ${areaLabel(h.area)}`);
        lines.push(`map px: ${h.frame.x.toFixed(0)}, ${h.frame.y.toFixed(0)}`);
        info.textContent = lines.join("\n");
    });

    // picking: a place icon under the pointer first (the front one); else ray -> sphere point -> longitude / latitude -> the
    // continent's map frame px -> area / marker
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const pick = (ev: PointerEvent): GlobeHit | null => {
        const r = cv.getBoundingClientRect();
        ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -(((ev.clientY - r.top) / r.height) * 2 - 1));
        ray.setFromCamera(ndc, camera);
        const icon = pickIcon(ndc, camera);
        if (icon) {
            const data = continents.find((c) => c.data.server === icon.server)?.data;
            const m = icon.marker;
            return { server: icon.server, frame: { x: m.x, y: m.y }, area: data ? areaAt(data, m.x, m.y) : null, marker: m };
        }
        const hit = ray.intersectObject(globe)[0];
        if (!hit) return null;
        return hitGlobe(continents, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, icons.visible ? MARKER_PICK_PX : 0);
    };
    const label = (h: GlobeHit | null): string => {
        if (!h) return "";
        if (h.marker) return h.marker.name;
        return h.area ? areaLabel(h.area) : "";
    };

    const describe = (): string => {
        const t = targets[view.target];
        if (!t) return "target: none in sight";
        const s = screenForTarget(t.key, places), main = places.screens.get(t.key);
        const pic = s ? zoom.pictures.status(s.map) : "none";
        return [
            `target: ${t.server} record ${t.record} (${t.key})`,
            s ? `screen: ${s.map} ${s.w} x ${s.h}${s.mine ? ` (yours, ${places.here?.how}; dot ${s.spot ? `${s.spot.x}, ${s.spot.y}` : "none"})` : ` (main: ${main?.rule}, ${main?.links} links)`}` : "screen: none",
            `picture: ${pic}; held: ${zoom.pictures.held().join(", ") || "-"}`,
            lastState ? `icon ${lastState.iconAlpha.toFixed(3)} + window ${lastState.windowAlpha.toFixed(3)}; grid ${lastState.gridAmount.toFixed(2)}; globe fade ${lastState.globeFade.toFixed(2)}` : "",
            `bands: swap ${ZOOM_BANDS.swap.join("-")}, grid ${ZOOM_BANDS.transition.join("-")}, globe fades ${ZOOM_BANDS.globeFade.join("-")}`,
        ].join("\n");
    };

    const step = (now: number): void => {
        const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
        env.aspect = camera.aspect;
        if (turn) {
            const k = Math.min(1, (now - turn.t0) / TURN_MS);
            view = zoomView({ ...view, look: slerpLonLat(turn.from, turn.to, easeInOut(k)), turned: true }, view.z, env);
            if (k >= 1) turn = null;
        }
        const zdir = (keysHeld.has("e") ? 1 : 0) - (keysHeld.has("q") ? 1 : 0);
        if (zdir) zWanted = Math.min(1, Math.max(0, zWanted + zdir * ZOOM_KEY_RATE * dt));
        view = stepZoomView(view, {
            left: keysHeld.has("arrowleft"), right: keysHeld.has("arrowright"), up: keysHeld.has("arrowup"), down: keysHeld.has("arrowdown"),
            zoomIn: false, zoomOut: false,
        }, env, dt, GLOBE_VIEW.latMax);
        view = zoomView(view, stepZoom(view.z, zWanted, dt), env);
        const t = targets[view.target];
        lastState = zoom.update({ view, screen: t ? screenForTarget(t.key, places) : null, hereLonLat: homeLonLat, aspect: camera.aspect, timeSec: now / 1000 });
        const shown = view.z.toFixed(3);
        if (zoomValue.textContent !== shown) {
            zoomValue.textContent = shown;
            if (document.activeElement !== zoomSlider) zoomSlider.value = String(Math.round(zWanted * 1000));
        }
        const text = describe();
        if (zoomInfo.textContent !== text) zoomInfo.textContent = text;
    };

    showStatus(first);
    Object.assign(window, { __worldGlobe: {
        continents, texW, texH, gpu, maxTex, icons: targets.length,
        /** zoom hooks for checks (numbers only): jump to z (no easing), turn by radians, read the view / state / screens */
        zoom: {
            setZ(z: number) { zWanted = Math.min(1, Math.max(0, z)); view = zoomView(view, zWanted, env); },
            turn(east: number, north: number) { view = turnView(view, east, north, env, GLOBE_VIEW.latMax); },
            view: () => view,
            state: () => lastState,
            target: () => targets[view.target] ?? null,
            held: () => zoom.pictures.held(),
            here: () => places.here,
        },
    } });

    const resize = (): void => {
        const w = window.innerWidth, h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize); resize();

    renderer.setAnimationLoop((now: number) => {
        step(now);
        lastNow = now;
        renderer.render(scene, camera);
    });
}

main().catch((e: unknown) => {
    console.error(e);
    const t = statusEl.textContent ?? "";
    if (!t.startsWith("No GPU") && !t.startsWith("Software")) say("failed: " + errText(e));
});
