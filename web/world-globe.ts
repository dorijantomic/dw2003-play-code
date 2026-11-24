// web/world-globe.js -- the dev page world-globe.html: the game's two world maps as two continents on one three.js sphere
// (Asuka centred at longitude 0, Amaterasu at 180, sea channels between, ice caps at the poles). The globe itself (renderer,
// texture, place markers) is web/world-globe-view.js, the same module the pause MAP screen draws; this page adds the mouse
// controls, the server radio (turns the globe to that continent), hover names and the side panel. Maths in web/world-globe-map.js.
// GPU only: the renderer is made with failIfMajorPerformanceCaveat, so a software GL is refused (the page says so) instead of used.
import * as THREE from "three";
import { OrbitControls } from "./lib3d/addons/OrbitControls.js";
import { CONTINENT_LON, MAP_LON_SPAN, areaAt, bandEdgeLat, hitGlobe, areaLabel, viewAzimuth, angleDelta, easeInOut } from "./world-globe-map.js";
import { makeGlobeRenderer, loadGlobeAssets, buildGlobeScene } from "./world-globe-view.js";
import type { GlobeHit, GlobeServer } from "./types/world-globe-map.js";

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
const SERVER_NAME: Readonly<Record<GlobeServer, string>> = { asuka: "Asuka", amaterasu: "Amaterasu" };
const MARKER_PICK_PX = 6;      // frame px: hover snaps to a place marker this close
const TURN_MS = 1400;          // radio switch: time to turn the globe to the other continent

const say = (t: string): void => { statusEl.textContent = t; };
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const deg = (r: number): string => ((r * 180) / Math.PI).toFixed(1);

interface Turn { t0: number; theta0: number; dTheta: number; phi0: number; dPhi: number; server: GlobeServer }

async function main() {
    const { renderer, gpu } = (() => {
        try { return makeGlobeRenderer(cv); } catch (e) { say(errText(e)); throw e; }
    })();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    say("loading...");
    const assets = await loadGlobeAssets();
    const { continents, image } = assets;
    const { scene, camera, globe, icons, iconList, faceIcons, pickIcon, texW, texH, maxTex } = buildGlobeScene(renderer, assets);
    scene.background = new THREE.Color(0x05070d);
    pinsBox.addEventListener("change", () => { icons.visible = pinsBox.checked; });

    const controls = new OrbitControls(camera, cv);
    controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 1.12; controls.maxDistance = 6;
    controls.zoomSpeed = 0.8;

    // radio switch: turn the camera around the globe (shortest way) to look at that continent's centre, eased
    const sph = new THREE.Spherical();
    let turn: Turn | null = null;
    const startTurn = (server: GlobeServer, now: number): void => {
        sph.setFromVector3(camera.position);
        turn = {
            t0: now, theta0: sph.theta, dTheta: angleDelta(sph.theta, viewAzimuth(CONTINENT_LON[server])),
            phi0: sph.phi, dPhi: Math.PI / 2 - sph.phi, server,
        };
    };
    const stepTurn = (now: number): void => {
        if (!turn) return;
        const t = Math.min(1, (now - turn.t0) / TURN_MS), e = easeInOut(t);
        sph.setFromVector3(camera.position);
        sph.theta = turn.theta0 + turn.dTheta * e;
        sph.phi = turn.phi0 + turn.dPhi * e;
        camera.position.setFromSpherical(sph);
        camera.lookAt(0, 0, 0);
        if (t >= 1) turn = null;
    };
    controls.addEventListener("start", () => { turn = null; });   // a drag / zoom takes over from the turn
    const showStatus = (server: GlobeServer): void => {
        const lines = [`GPU: ${gpu}`, `facing: ${SERVER_NAME[server]}`];
        for (const c of continents) {
            const named = c.data.areas.filter((a) => a.names.length).length;
            lines.push(`${SERVER_NAME[c.data.server]}: longitude ${deg(c.band.lonCentre)} +- ${deg(MAP_LON_SPAN / 2)}, latitude +- ${deg(bandEdgeLat(c.band))}; `
                + `${c.data.areas.length} areas (${named} named), ${c.data.markers.length} markers, Gemini fit ${c.data.fitIou.toFixed(3)}`);
        }
        lines.push(`texture ${texW} x ${texH} (file ${image.naturalWidth} x ${image.naturalHeight}, GPU limit ${maxTex})`);
        say(lines.join("\n"));
    };
    for (const { server, box } of serverBoxes) {
        box.addEventListener("change", () => {
            if (!box.checked) return;
            startTurn(server, performance.now());
            showStatus(server);
        });
    }
    const first = serverBoxes.find((s) => s.box.checked)?.server ?? "asuka";
    sph.set(camera.position.length(), Math.PI / 2, viewAzimuth(CONTINENT_LON[first]));
    camera.position.setFromSpherical(sph);
    camera.lookAt(0, 0, 0);
    showStatus(first);
    Object.assign(window, { __worldGlobe: { continents, texW, texH, gpu, maxTex, icons: iconList.length } });

    const resize = (): void => {
        const w = window.innerWidth, h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize); resize();

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
    cv.addEventListener("pointermove", (ev: PointerEvent) => {
        if (ev.buttons) { tip.style.display = "none"; return; }
        const t = label(pick(ev));
        if (!t) { tip.style.display = "none"; return; }
        tip.textContent = t;
        tip.style.display = "block"; tip.style.left = ev.clientX + 14 + "px"; tip.style.top = ev.clientY + 14 + "px";
    });
    let down: [number, number] | null = null;
    cv.addEventListener("pointerdown", (ev: PointerEvent) => { down = [ev.clientX, ev.clientY]; cv.classList.add("drag"); });
    window.addEventListener("pointerup", (ev: PointerEvent) => {
        cv.classList.remove("drag");
        const d = down; down = null;
        if (!d || ev.target !== cv) return;
        if (Math.hypot(ev.clientX - d[0], ev.clientY - d[1]) > 4) return;
        const h = pick(ev);
        if (!h || (!h.area && !h.marker)) { info.textContent = ""; return; }
        const lines: string[] = [`continent: ${SERVER_NAME[h.server]}`];
        if (h.marker) lines.push(`place: ${h.marker.name}`, `maps: ${h.marker.maps.join(", ") || "-"}`);
        if (h.area) lines.push(`area ${h.area.area}: ${areaLabel(h.area)}`, `area maps: ${h.area.maps.join(", ") || "-"}`);
        lines.push(`map px: ${h.frame.x.toFixed(0)}, ${h.frame.y.toFixed(0)}`);
        info.textContent = lines.join("\n");
    });

    renderer.setAnimationLoop((now: number) => {
        stepTurn(now);
        controls.rotateSpeed = Math.min(1, Math.max(0.12, (camera.position.length() - 1) * 0.45));
        controls.update();
        faceIcons(camera.position);
        renderer.render(scene, camera);
    });
}

main().catch((e: unknown) => {
    console.error(e);
    const t = statusEl.textContent ?? "";
    if (!t.startsWith("No GPU") && !t.startsWith("Software")) say("failed: " + errText(e));
});
