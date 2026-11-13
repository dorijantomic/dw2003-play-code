// web/world-globe.js -- the page world-globe.html: the stitched world (web/world-globe-layout.js) drawn into one canvas texture and
// mapped, equirectangular, onto a three.js sphere. Local assets only (web/assets/manifest.json, scenes, maps/*.png), as the game loads them.
// GPU only: the renderer is made with failIfMajorPerformanceCaveat, so a software GL is refused (the page says so) instead of used.
import * as THREE from "three";
import { OrbitControls } from "./lib3d/addons/OrbitControls.js";
import { buildWorld, fitWorld, textureSize, worldToTex, texToWorld, hitTest } from "./world-globe-layout.js";

const $ = (id) => document.getElementById(id);
const statusEl = $("status"), tip = $("tip"), info = $("info"), cv = $("cv");
const MAX_TEX_W = 8192;
const SEA = "#0a1d33";

const say = (t) => { statusEl.textContent = t; };
const fetchJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };
const hueOf = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
const regionColor = (r) => `hsl(${hueOf(r)} 70% 60%)`;

function makeRenderer() {
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: "high-performance", failIfMajorPerformanceCaveat: true });
    } catch (e) {
        say("No GPU WebGL context (a software renderer is refused on purpose).\n" + e.message);
        throw e;
    }
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    if (/swiftshader|llvmpipe|software/i.test(name)) { say("Software renderer refused: " + name); throw new Error("software renderer " + name); }
    return { renderer, gpu: name };
}

function loadImage(src) {
    return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}

async function main() {
    const { renderer, gpu } = makeRenderer();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    say("reading maps and scenes...");
    const manifest = await fetchJson("assets/manifest.json");
    const variants = await fetchJson("map-variants.json").catch(() => ({}));
    const maps = manifest.maps;
    const scenes = {};
    await Promise.all(maps.map(async (m) => { scenes[m.id] = await fetchJson(`assets/scenes/${m.id}.json`).catch(() => ({ exits: [] })); }));

    const world = buildWorld({ maps, scenes, variants });
    const maxTex = Math.min(MAX_TEX_W, renderer.capabilities.maxTextureSize);
    const { w: texW, h: texH } = textureSize(world.bounds, maxTex);
    const fit = fitWorld(world.bounds, texW, texH);

    say(`drawing ${world.places.length} places into ${texW} x ${texH}...`);
    const canvas = document.createElement("canvas");
    canvas.width = texW; canvas.height = texH;
    const g = canvas.getContext("2d");
    g.fillStyle = SEA; g.fillRect(0, 0, texW, texH);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    const images = await Promise.all(world.places.map((p) => loadImage(p.image || `assets/maps/${p.id}.png`)));
    let missing = 0;
    world.places.forEach((p, i) => {
        const t = worldToTex(fit, p.x, p.y), w = p.w * fit.scale, h = p.h * fit.scale;
        if (images[i]) g.drawImage(images[i], t.x, t.y, w, h); else { missing++; g.fillStyle = "#334"; g.fillRect(t.x, t.y, w, h); }
        g.strokeStyle = regionColor(p.region); g.lineWidth = Math.max(2, 3 * fit.scale * 4);
        g.strokeRect(t.x + g.lineWidth / 2, t.y + g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
    });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070d);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    camera.position.set(3.2, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.MeshBasicMaterial({ map: tex }));
    scene.add(globe);

    // pins: same equirectangular mapping as three's SphereGeometry (u = phi / 2pi, theta = (1 - v) * pi)
    const toSphere = (u, v, r) => {
        const phi = u * Math.PI * 2, theta = (1 - v) * Math.PI;
        return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
    };
    const pinPos = new Float32Array(world.pins.length * 3);
    world.pins.forEach((p, i) => {
        const t = worldToTex(fit, p.wx, p.wy);
        const v = toSphere(t.x / texW, 1 - t.y / texH, 1.004);
        pinPos.set([v.x, v.y, v.z], i * 3);
    });
    // pins: small instanced spheres (PointsMaterial failed program validation on ANGLE/D3D11)
    const pinPts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd24a }), Math.max(1, world.pins.length));
    pinPts.count = world.pins.length;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < world.pins.length; i++) { m4.makeTranslation(pinPos[i * 3], pinPos[i * 3 + 1], pinPos[i * 3 + 2]); pinPts.setMatrixAt(i, m4); }
    pinPts.instanceMatrix.needsUpdate = true;
    pinPts.frustumCulled = false;
    scene.add(pinPts);
    $("pins").addEventListener("change", (e) => { pinPts.visible = e.target.checked; });

    const controls = new OrbitControls(camera, cv);
    controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 1.12; controls.maxDistance = 6;
    controls.zoomSpeed = 0.8;

    const resize = () => {
        const w = window.innerWidth, h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize); resize();

    // picking: ray -> sphere -> uv -> texture pixel -> world pixel -> place / pin
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const pick = (ev) => {
        const r = cv.getBoundingClientRect();
        ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -(((ev.clientY - r.top) / r.height) * 2 - 1));
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObject(globe)[0];
        if (!hit || !hit.uv) return null;
        const w = texToWorld(fit, hit.uv.x * texW, (1 - hit.uv.y) * texH);
        return hitTest(world, w.x, w.y, 14 / fit.scale);
    };
    const label = (h) => {
        if (!h) return "";
        if (h.pin && pinPts.visible) return h.pin.names.slice(0, 6).join("\n") + (h.pin.names.length > 6 ? `\n+${h.pin.names.length - 6} more` : "");
        return h.place ? h.place.names.join(" / ") : "";
    };
    cv.addEventListener("pointermove", (ev) => {
        if (ev.buttons) { tip.style.display = "none"; return; }
        const t = label(pick(ev));
        if (!t) { tip.style.display = "none"; return; }
        tip.textContent = t; tip.style.whiteSpace = "pre";
        tip.style.display = "block"; tip.style.left = ev.clientX + 14 + "px"; tip.style.top = ev.clientY + 14 + "px";
    });
    let down = null;
    cv.addEventListener("pointerdown", (ev) => { down = [ev.clientX, ev.clientY]; cv.classList.add("drag"); });
    window.addEventListener("pointerup", (ev) => {
        cv.classList.remove("drag");
        if (!down || ev.target !== cv) { down = null; return; }
        const moved = Math.hypot(ev.clientX - down[0], ev.clientY - down[1]); down = null;
        if (moved > 4) return;
        const h = pick(ev);
        if (!h || !h.place) { info.textContent = ""; return; }
        const p = h.place;
        const pins = world.pins.filter((q) => q.placeKey === p.key);
        info.textContent = `${p.names.join(" / ")}\nregion: ${p.region}\nmaps: ${p.ids.join(", ")} (${p.w} x ${p.h})\n`
            + (h.pin ? `door: ${h.pin.names.join("; ")}\n` : "")
            + `door pins here: ${pins.length}`;
    });

    // legend: regions with place counts
    const byRegion = new Map();
    for (const p of world.places) byRegion.set(p.region, (byRegion.get(p.region) ?? 0) + 1);
    $("legend").innerHTML = [...byRegion].map(([r, n]) => `<div><span class="sw" style="background:${regionColor(r)}"></span>${r} (${n})</div>`).join("");

    const s = world.stats;
    say(`GPU: ${gpu}\n${s.places} places = ${s.mapsPlaced} of ${s.openMaps} open-air maps\noverlaps: ${s.overlaps}; links touching: ${s.linksAdjacent} / ${s.links}\n`
        + `door pins: ${s.pins} (${s.pinnedInterior} interior maps)\nworld ${world.bounds.w} x ${world.bounds.h} px -> texture ${texW} x ${texH} (scale ${fit.scale.toFixed(3)})`
        + (missing ? `\nmissing pictures: ${missing}` : ""));
    window.__worldGlobe = { world, fit, texW, texH, gpu };

    renderer.setAnimationLoop(() => {
        controls.rotateSpeed = Math.min(1, Math.max(0.12, (camera.position.length() - 1) * 0.45));
        controls.update();
        renderer.render(scene, camera);
    });
}

main().catch((e) => { console.error(e); if (!statusEl.textContent.startsWith("No GPU") && !statusEl.textContent.startsWith("Software")) say("failed: " + e.message); });
