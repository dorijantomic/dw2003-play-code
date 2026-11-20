// web/fishing-underwater.js — a 3D underwater view while the line is in the water (three.js, GPU).
//
// NEW CONTENT of this project, on for everyone (no option row, no URL flag, no F2 toggle).
// It only READS state.fishing (via fishing-underwater-state.js): cast -> wait -> strike ->
// bite / miss -> reel. Fishing rules, timing and odds are never touched. The fish is a
// stylised silhouette (the field never loads a Digimon model for the hooked species; the
// fight that follows is the battle screen).
//
// Cheap and GPU-safe: NO context of its own. It renders into the field's one shared WebGL context
// (web/gl-shared.js, the same one water3d and grass3d use) inside a 128x96 viewport + scissor in the
// corner, and the caller copies that corner onto the 2D canvas in the same frame (no readPixels,
// no GPU->CPU stall). Nothing is drawn when the page is hidden; the per-frame path allocates
// nothing. Context lost = the inset is off for good (fishing looks as it always did, never
// retried); a frame budget guard (avg > 4 ms over 30 frames) also turns it off for the session.
import * as THREE from "./lib3d/three.module.js";
import { phaseFor, progressFor, sizeFor, themeIdFor, THEMES, DEFAULT_THEME, createBudgetGuard } from "./fishing-underwater-state.js";
import { getSharedRenderer, sharedLost } from "./gl-shared.js";
import { FIELD_VIEW_W } from "./field-view.js";

export const UW_W = 128;
export const UW_H = 96;
const SHARED_H = 240 * 2;   // the shared canvas is the field view at 2x (water3d / grass3d size)

let renderer = null;
let failed = false;
let budget = createBudgetGuard(30, 4);
let perfNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
export function __setClock(f) { perfNow = f; }
export function __resetForTest() { budget = createBudgetGuard(30, 4); renderer = null; failed = false; scene = null; lastNow = -1; lastPhase = ""; appliedTheme = ""; }
let scene = null;
let camera = null;
let fog = null;

// ---- shared uniforms ---------------------------------------------------------------------
const uTime = { value: 0 };
const uFog = { value: new THREE.Color() };
const uTop = { value: new THREE.Color() };
const uDeep = { value: new THREE.Color() };
const uLight = { value: new THREE.Color() };
const uMote = { value: new THREE.Color() };
const uFloor = { value: new THREE.Color() };
const uDensity = { value: 0.07 };
const uShafts = { value: 0.5 };

// ---- scene objects (built once) ---------------------------------------------------------
let floorMesh = null;
let floorPos = null;
let rocks = null;
let rockMat = null;
let ambient = null;
let sun = null;
let shafts = null;
let lureGroup = null;
let floatMesh = null;
let lineAttr = null;
let fishGroup = null;
let tailPivot = null;
let fishMat = null;
let eyeMesh = null;

const FLOOR_Y = -2.6;
const SURFACE_Y = 3.1;
const LURE_X = 1.4;
const LURE_Y = -0.5;
const LINE_SEGS = 8;
const SHAFT_COUNT = 4;
const shaftBase = new Float32Array(SHAFT_COUNT);

// Floor relief by x,z (also places the rocks on it).
function floorHeight(x, z, amp) {
    return amp * (Math.sin(x * 0.5) * Math.cos(z * 0.4) + 0.5 * Math.sin(x * 1.3 + z * 0.9));
}

const VERT_VIEW = `
varying vec3 vW; varying float vDepth;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}`;

function build() {
    scene = new THREE.Scene();
    fog = new THREE.FogExp2(0x1d6a62, 0.07);
    scene.fog = fog;
    scene.background = new THREE.Color(0x1d6a62);
    camera = new THREE.PerspectiveCamera(40, UW_W / UW_H, 0.1, 60);
    camera.position.set(0, 0.2, 9);

    ambient = new THREE.AmbientLight(0x88aacc, 0.9);
    sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(-2, 8, 4);
    scene.add(ambient, sun);

    // Back wall: a depth gradient so the open water is never a flat colour.
    const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(90, 50),
        new THREE.ShaderMaterial({
            uniforms: { uTop, uDeep, uFog },
            depthWrite: false,
            fog: false,
            vertexShader: `varying float vY; void main(){ vY=(modelMatrix*vec4(position,1.)).y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
            fragmentShader: `uniform vec3 uTop,uDeep,uFog; varying float vY;
              void main(){ float k=smoothstep(-5.,5.,vY); vec3 c=mix(uDeep,uTop,k); gl_FragColor=vec4(mix(uFog,c,0.55),1.); }`,
        }),
    );
    wall.position.set(0, 0, -18);
    wall.renderOrder = -10;
    scene.add(wall);

    // Floor with moving caustics.
    const fg = new THREE.PlaneGeometry(40, 22, 64, 36);
    fg.rotateX(-Math.PI / 2);
    floorPos = fg.attributes.position;
    floorMesh = new THREE.Mesh(
        fg,
        new THREE.ShaderMaterial({
            uniforms: { uTime, uFog, uLight, uFloor, uDensity, uCaus: { value: 1 } },
            fog: false,
            vertexShader: VERT_VIEW,
            fragmentShader: `uniform float uTime,uDensity,uCaus; uniform vec3 uFog,uLight,uFloor; varying vec3 vW; varying float vDepth;
              float caus(vec2 p){ float t=uTime*.6; vec2 a=p*.9; float v=sin(a.x*1.7+t)*sin(a.y*1.9-t*1.1)+sin((a.x+a.y)*1.3+t*.8)*sin((a.x-a.y)*1.1-t*.7); v=abs(v)*.5; return pow(1.-v,5.); }
              void main(){ float c=caus(vW.xz)*uCaus; vec3 col=uFloor*(.5+.22*sin(vW.x*3.)*sin(vW.z*2.7))+uLight*c*.5;
                float f=1.-exp(-uDensity*uDensity*vDepth*vDepth); gl_FragColor=vec4(mix(col,uFog,f),1.); }`,
        }),
    );
    floorMesh.position.y = FLOOR_Y;
    scene.add(floorMesh);

    // Rocks (instanced, laid out once; the theme sets how many show and their colour).
    rockMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
    rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), rockMat, 10);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 10; i++) {
        const x = -7 + ((i * 37) % 15) + (i % 3) * 0.4;
        const z = -5 + ((i * 53) % 9) - 1;
        const s = 0.25 + ((i * 29) % 7) * 0.09;
        dummy.position.set(x, FLOOR_Y + floorHeight(x, z, 0.3) + s * 0.3, z);
        dummy.scale.set(s * 1.3, s, s * 1.1);
        dummy.rotation.set(i, i * 2.1, 0);
        dummy.updateMatrix();
        rocks.setMatrixAt(i, dummy.matrix);
    }
    scene.add(rocks);

    // The underside of the water surface.
    const sg = new THREE.PlaneGeometry(70, 50);
    sg.rotateX(Math.PI / 2);
    const surface = new THREE.Mesh(
        sg,
        new THREE.ShaderMaterial({
            uniforms: { uTime, uFog, uTop, uLight, uDensity },
            fog: false,
            side: THREE.DoubleSide,
            vertexShader: VERT_VIEW,
            fragmentShader: `uniform float uTime,uDensity; uniform vec3 uFog,uTop,uLight; varying vec3 vW; varying float vDepth;
              void main(){ float w=.5+.5*sin(vW.x*1.6+uTime*.9)*sin(vW.z*1.3-uTime*.7); vec3 c=mix(uTop*1.15,uLight,w*.45);
                float f=1.-exp(-uDensity*uDensity*vDepth*vDepth*.6); gl_FragColor=vec4(mix(c,uFog,f),1.); }`,
        }),
    );
    surface.position.set(0, SURFACE_Y, -8);
    scene.add(surface);

    // Light shafts: additive soft quads from the surface, swaying.
    const shg = new THREE.PlaneGeometry(1.5, 12);
    shg.translate(0, -6, 0);
    const shMat = new THREE.ShaderMaterial({
        uniforms: { uTime, uLight, uShafts },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        vertexShader: `varying vec2 vUv; varying float vPh; void main(){ vUv=uv; vPh=modelMatrix[3].x*1.7; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `uniform float uTime,uShafts; uniform vec3 uLight; varying vec2 vUv; varying float vPh;
          void main(){ float a=1.-abs(vUv.x*2.-1.); a*=a; a*=pow(vUv.y,1.6); a*=.7+.3*sin(uTime*.7+vPh); gl_FragColor=vec4(uLight*a*uShafts*.5,1.); }`,
    });
    shafts = new THREE.Group();
    for (let i = 0; i < SHAFT_COUNT; i++) {
        const m = new THREE.Mesh(shg, shMat);
        m.position.set(-8 + i * 4.6, SURFACE_Y, -3 + (i % 3) * 2);
        shaftBase[i] = 0.22 + (i % 2) * 0.12;
        m.rotation.z = shaftBase[i];
        m.renderOrder = 5;
        shafts.add(m);
    }
    scene.add(shafts);

    // Drifting particles: moved entirely in the vertex shader (no per-frame CPU work).
    const N = 140;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        pos[i * 3] = -8 + ((i * 97) % 160) * 0.1;
        pos[i * 3 + 1] = -3 + ((i * 61) % 62) * 0.1;
        pos[i * 3 + 2] = -6 + ((i * 41) % 150) * 0.1;
        seed[i] = ((i * 0.6180339) % 1);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    pg.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const motes = new THREE.Points(
        pg,
        new THREE.ShaderMaterial({
            uniforms: { uTime, uMote, uSize: { value: 46 } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
            vertexShader: `attribute float aSeed; uniform float uTime,uSize;
              void main(){ vec3 p=position; p.x+=sin(uTime*.3+aSeed*20.)*.4; p.y=mod(p.y+3.+uTime*(.05+.08*fract(aSeed*7.)),6.4)-3.; p.z+=cos(uTime*.25+aSeed*13.)*.4;
                vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize=uSize*(.5+fract(aSeed*5.))/-mv.z; gl_Position=projectionMatrix*mv; }`,
            fragmentShader: `uniform vec3 uMote; void main(){ float d=length(gl_PointCoord-.5)*2.; float a=smoothstep(1.,.2,d)*.5; gl_FragColor=vec4(uMote*a,1.); }`,
        }),
    );
    motes.frustumCulled = false;
    scene.add(motes);

    // The lure on its line, and the float at the surface.
    lureGroup = new THREE.Group();
    const lureBody = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a3c }));
    lureBody.scale.set(1, 1.7, 1);
    const lureCap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2d0 }));
    lureCap.position.y = 0.17;
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 12, Math.PI * 1.4), new THREE.MeshBasicMaterial({ color: 0xcfd8dc }));
    hook.position.y = -0.2;
    hook.rotation.z = Math.PI * 0.8;
    lureGroup.add(lureBody, lureCap, hook);
    scene.add(lureGroup);
    floatMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    scene.add(floatMesh);
    const lg = new THREE.BufferGeometry();
    lineAttr = new THREE.BufferAttribute(new Float32Array(LINE_SEGS * 3), 3);
    lg.setAttribute("position", lineAttr);
    const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.7 }));
    line.frustumCulled = false;
    scene.add(line);

    // The fish: a stylised silhouette (body, tail on a pivot, two fins, an eye for the bite).
    fishMat = new THREE.MeshBasicMaterial({ color: 0x0b2630 });
    fishGroup = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), fishMat);
    body.scale.set(1, 0.42, 0.28);
    tailPivot = new THREE.Group();
    tailPivot.position.x = -0.85;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.8, 3), fishMat);
    tail.rotation.z = Math.PI / 2;   // apex points +x (into the body), base at -x
    tail.position.x = -0.35;
    tail.scale.set(1, 1, 0.35);
    tailPivot.add(tail);
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 3), fishMat);
    dorsal.position.set(-0.1, 0.42, 0);
    dorsal.scale.set(1.6, 1, 0.3);
    const belly = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 3), fishMat);
    belly.position.set(0.1, -0.36, 0);
    belly.rotation.z = Math.PI;
    belly.scale.set(1.4, 1, 0.3);
    eyeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
    eyeMesh.position.set(0.62, 0.1, 0.25);
    fishGroup.add(body, tailPivot, dorsal, belly, eyeMesh);
    scene.add(fishGroup);
}

function makeRenderer() {
    if (failed) return false;
    if (typeof document === "undefined") return false;
    if (sharedLost()) { failed = true; renderer = null; return false; }
    if (renderer) return true;
    try {
        const r = getSharedRenderer(FIELD_VIEW_W * 2, SHARED_H);
        if (!r) { failed = true; return false; }
        const gl = r.getContext();
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
        if (/swiftshader|llvmpipe|software/i.test(name)) throw new Error(`software renderer refused: ${name}`);
        renderer = r;
        build();
        return true;
    } catch (e) {
        console.warn("fishing-underwater: WebGL unavailable, fishing looks as before", e);
        failed = true;
        renderer = null;
        return false;
    }
}

// ---- theme ------------------------------------------------------------------------------
let appliedTheme = "";

function applyTheme(id) {
    if (id === appliedTheme) return;
    appliedTheme = id;
    const t = THEMES[id];
    uFog.value.set(t.fog); uTop.value.set(t.top); uDeep.value.set(t.deep);
    uLight.value.set(t.light); uMote.value.set(t.mote); uFloor.value.set(t.floorColor);
    uDensity.value = t.density; uShafts.value = t.shafts;
    fog.color.set(t.fog); fog.density = t.density;
    scene.background.set(t.fog);
    sun.color.set(t.light);
    ambient.color.set(t.top);
    rockMat.color.set(t.floorColor).multiplyScalar(0.7);
    rocks.count = t.rocks;
    // Fish silhouette: the fog colour pulled dark, so it reads as a shape in the water.
    fishMat.color.set(t.fog).multiplyScalar(0.3);
    // Floor relief: ice is flat, mud is soft, rock is lumpy, sand is gentle.
    const amp = t.floor === "ice" ? 0.05 : t.floor === "mud" ? 0.15 : t.floor === "rock" ? 0.4 : 0.22;
    for (let i = 0; i < floorPos.count; i++) floorPos.setY(i, floorHeight(floorPos.getX(i), floorPos.getZ(i), amp));
    floorPos.needsUpdate = true;
}

// ---- per-frame state (module numbers: no allocation) ------------------------------------
let lastNow = -1;
let lastPhase = "";
let phaseSince = 0;
let fx = -8, fy = 0, fz = -1, fyaw = 0, fsize = 0.8;
let lureX = LURE_X, lureY = SURFACE_Y;
let lastInfoPhase = "idle";

const sstep = (e0, e1, x) => { const t = x < e0 ? 0 : x > e1 ? 1 : (x - e0) / (e1 - e0); return t * t * (3 - 2 * t); };

// Theme lookup cache (the extras table never changes during a session).
let cacheMap = null, cacheData = null, cacheTheme = DEFAULT_THEME;
function themeOf(extrasData, mapId) {
    if (mapId !== cacheMap || extrasData !== cacheData) {
        cacheMap = mapId; cacheData = extrasData; cacheTheme = themeIdFor(extrasData, mapId);
    }
    return cacheTheme;
}

/**
 * Draw one frame of the underwater scene for the live fishing state `f` (state.fishing) and
 * return the canvas, or null (idle / page hidden / no GPU WebGL). Read-only on `f`.
 */
export function renderUnderwater(f, mapId, extrasData, nowSec) {
    if (typeof document !== "undefined" && document.hidden) return null;
    const phase = phaseFor(f);
    if (phase === "idle") { lastInfoPhase = "idle"; return null; }
    if (!makeRenderer()) return null;
    if (sharedLost()) { failed = true; renderer = null; return null; }
    applyTheme(themeOf(extrasData, mapId));

    let dt = nowSec - lastNow;
    if (lastNow < 0 || dt > 0.5 || dt < 0) {      // a new session (or a long pause): reset the scene
        dt = 0.016;
        fx = -8; fy = 0; fz = -1; fyaw = 0; fsize = 0.8;
        lureX = LURE_X; lureY = SURFACE_Y;
        lastPhase = "";
    }
    lastNow = nowSec;
    if (phase !== lastPhase) { lastPhase = phase; phaseSince = nowSec; }
    lastInfoPhase = phase;
    const e = nowSec - phaseSince;
    const p = progressFor(f);
    const t = nowSec;
    uTime.value = t;

    // Targets for the lure, the fish and its tail speed.
    let lx = LURE_X, ly = LURE_Y;
    let tx = fx, ty = fy, tz = fz, yawT = fyaw, k = 4, wag = 5, show = false, eye = false;
    const size = sizeFor(f);
    const sizeT = size === "big" ? 1.5 : size === "small" ? 0.55 : 0.8;
    switch (phase) {
        case "cast": {
            const q = sstep(0, 1, p);
            ly = SURFACE_Y + (LURE_Y - SURFACE_Y) * q;
            lx = LURE_X + Math.sin(t * 2) * 0.12 * (1 - q);
            fx = -8; tx = -8;
            break;
        }
        case "wait": {
            show = true;
            const dist = 5.0 - 3.2 * p;
            tx = LURE_X - dist;
            ty = LURE_Y + 0.4 + Math.sin(t * 0.9) * 0.5;
            tz = -0.5 + Math.sin(t * 0.5) * 1.5;
            yawT = Math.cos(t * 0.5) >= 0 ? 0 : Math.PI;
            k = 2.2; wag = 5 + 6 * p;
            ly = LURE_Y + Math.sin(t * 9) * 0.04 * p * p;
            break;
        }
        case "strike": {
            show = true;
            tx = LURE_X - 0.6 * fsize; ty = LURE_Y; tz = 0; yawT = 0;
            k = 9; wag = 20;
            ly = LURE_Y + Math.sin(t * 25) * 0.06;
            break;
        }
        case "bite": {
            show = true; eye = true;
            const amp = 0.6 + 0.8 * p;
            tx = LURE_X - 0.6 * fsize + Math.cos(t * 21) * 0.18 * amp;
            ty = LURE_Y + Math.sin(t * 17) * 0.25 * amp;
            tz = Math.sin(t * 13) * 0.3;
            yawT = Math.sin(t * 15) * 0.5;
            k = 14; wag = 26;
            lx = LURE_X + (tx - (LURE_X - 0.6 * fsize)) * 0.5;
            ly = LURE_Y + (ty - LURE_Y) * 0.5;
            break;
        }
        case "miss": {
            show = true;
            tx = LURE_X - 1 - e * 3; ty = LURE_Y + 0.3; tz = -1; yawT = Math.PI;
            k = 5; wag = 14;
            break;
        }
        case "reel":
        case "gone": {
            const r = sstep(0, 1.2, e);
            ly = LURE_Y + (SURFACE_Y - 0.5 - LURE_Y) * r;
            lx = LURE_X + 0.3 * r;
            if (phase === "reel") {
                show = true; eye = true;
                tx = lx - 0.6 * fsize + Math.cos(t * 21) * 0.12;
                ty = ly + Math.sin(t * 17) * 0.15; tz = Math.sin(t * 13) * 0.2;
                yawT = Math.sin(t * 15) * 0.4;
                k = 14; wag = 26;
            }
            break;
        }
        default:
            break;
    }

    // Damped follow (frame-rate independent).
    const a = 1 - Math.exp(-k * dt);
    fx += (tx - fx) * a; fy += (ty - fy) * a; fz += (tz - fz) * a;
    fyaw += (yawT - fyaw) * (1 - Math.exp(-6 * dt));
    fsize += (sizeT - fsize) * (1 - Math.exp(-3 * dt));
    lureX += (lx - lureX) * (1 - Math.exp(-12 * dt));
    lureY += (ly - lureY) * (1 - Math.exp(-12 * dt));

    // Apply to the scene.
    lureGroup.position.set(lureX, lureY, 0);
    lureGroup.rotation.z = Math.sin(t * 3) * 0.08;
    const surfX = lureX - 0.5;
    floatMesh.position.set(surfX, SURFACE_Y - 0.02 + Math.sin(t * 2.4) * 0.025, 0);
    const lp = lineAttr.array;
    const sag = phase === "bite" || phase === "strike" ? 0.02 : 0.25;
    const topY = lureY + 0.25;
    for (let i = 0; i < LINE_SEGS; i++) {
        const u = i / (LINE_SEGS - 1);
        lp[i * 3] = surfX + (lureX - surfX) * u + Math.sin(u * Math.PI) * sag * 0.6;
        lp[i * 3 + 1] = SURFACE_Y + (topY - SURFACE_Y) * u;
        lp[i * 3 + 2] = 0;
    }
    lineAttr.needsUpdate = true;

    fishGroup.visible = show && fx > -7.5;
    fishGroup.position.set(fx, fy, fz);
    fishGroup.rotation.set(0, fyaw, (ty - fy) * 0.3);
    fishGroup.scale.setScalar(fsize);
    tailPivot.rotation.y = Math.sin(t * wag) * 0.55;
    eyeMesh.visible = eye;

    for (let i = 0; i < SHAFT_COUNT; i++) shafts.children[i].rotation.z = shaftBase[i] + 0.05 * Math.sin(t * 0.3 + i);
    camera.position.x = Math.sin(t * 0.2) * 0.3;
    camera.lookAt(0.4, 0.2, 0);

    // Render into the bottom-left UW_W x UW_H corner of the shared canvas (viewport + scissor), then put the
    // shared state back for water3d / grass3d (full viewport, no scissor, transparent clear).
    const t0 = perfNow();
    try {
        renderer.setViewport(0, 0, UW_W, UW_H);
        renderer.setScissor(0, 0, UW_W, UW_H);
        renderer.setScissorTest(true);
        renderer.setClearColor(scene.background, 1);
        renderer.render(scene, camera);
    } catch (err) {
        failed = true; renderer = null;
        console.warn("fishing-underwater: render failed, inset off", err);
        return null;
    } finally {
        if (renderer) {
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
            renderer.setClearColor(0x000000, 0);
        }
    }
    if (renderer && budget.record(perfNow() - t0)) {
        failed = true; renderer = null;
        console.warn(`fishing-underwater: over budget (avg ${budget.lastAvg.toFixed(2)} ms), inset off for this session`);
        return null;
    }
    return renderer ? renderer.domElement : null;
}

/** Dev/script info: the last phase drawn, the theme applied, whether WebGL works. */
export function underwaterInfo() {
    return { phase: lastInfoPhase, theme: appliedTheme || null, gpu: !!renderer, failed, avgMs: budget.lastAvg };
}
