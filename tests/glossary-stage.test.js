// The one 3D stage for the glossary (web/glossary-stage.js), with a recording renderer and the real free camera.
import test from "node:test";
import assert from "node:assert/strict";
import { CANVAS_SIZE, FILL, TURN_DEG_PER_S, TURN_SECONDS, createStage } from "../web/glossary-stage.js";
import { createFreeCamera } from "../web/anim-viewer-camera.js";

function recorder() {
    const log = [], pending = [];
    const r = {
        log, pending,
        bounds: { min: [-50, 0, -50], max: [50, 160, 50], center: [0, 80, 0], size: [100, 160, 100] },
        setEnemyVisible: (v) => log.push(["enemyVisible", v]),
        setPlayerVisible: (v) => log.push(["playerVisible", v]),
        setIsolated: (on, side) => log.push(["isolated", on, side]),
        setCameraMode: (m) => log.push(["cameraMode", m]),
        setFreeCameraView: (fn) => { r.view = fn; log.push(["freeView", typeof fn]); },
        setPlayerDigimon: (folder) => new Promise((res) => { log.push(["player", folder]); pending.push({ folder, res }); }),
        setViewerStudio: (on) => log.push(["studio", on]),
        getFighterBounds: () => r.bounds,
        render: (dt) => log.push(["render", dt]),
        destroy: () => log.push(["destroy"]),
    };
    return r;
}
function setup(over = {}) {
    const r = recorder();
    const tints = [];
    let made = 0, cams = [];
    const stage = createStage({
        makeRenderer: () => { made++; return r; },
        makeCamera: (o) => { const c = createFreeCamera(o); cams.push(c); return c; },
        resolveFolder: async (name) => (name === "Nope" ? null : `m_${name}`),
        setTint: (side, rgba) => tints.push([side, rgba]),
        size: [376, 172],
        canvasFactory: () => ({ width: 376, height: 172 }),
        ...over,
    });
    return { stage, r, tints, made: () => made, cams };
}
const ctx = () => { const calls = []; return { calls, drawImage: (...a) => calls.push(a) }; };
const settle = () => new Promise((res) => setTimeout(res, 0));

test("one turn per 12 seconds is 30 degrees a second", () => {
    assert.equal(TURN_SECONDS, 12);
    assert.equal(TURN_DEG_PER_S, 30);
});

test("the renderer is built once, set up as the animation viewer sets it up, and reused for the next species", async () => {
    const { stage, r, made } = setup();
    const a = stage.show("Agumon", { shadow: false });
    await settle(); r.pending[0].res(true); assert.equal(await a, true);
    const b = stage.show("Gabumon", { shadow: false });
    await settle(); r.pending[1].res(true); await b;
    assert.equal(made(), 1, "no second WebGL context");
    const calls = r.log.filter((l) => ["enemyVisible", "playerVisible", "isolated", "cameraMode", "freeView", "studio"].includes(l[0]));
    assert.deepEqual(calls, [["enemyVisible", false], ["playerVisible", true], ["isolated", true, "player"], ["studio", false], ["cameraMode", "free"], ["freeView", "function"]]);
});

test("a newer show() wins over a slower older one (holding a direction through the list)", async () => {
    const { stage, r } = setup();
    const first = stage.show("Agumon", { shadow: false });
    await settle();
    const second = stage.show("Gabumon", { shadow: false });
    await settle();
    r.pending[1].res(true);
    assert.equal(await second, true);
    r.pending[0].res(true);
    assert.equal(await first, false, "the older request is told it lost");
    assert.equal(stage.debug().folder, "m_Gabumon");
});

test("a species with no model folder, or a model that fails to load, is not ready and draws nothing", async () => {
    const { stage, r } = setup();
    assert.equal(await stage.show("Nope", { shadow: false }), false);
    assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), false);
    const p = stage.show("Agumon", { shadow: false });
    await settle(); r.pending[0].res(false);
    assert.equal(await p, false);
    assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), false);
});

test("the camera turns 30 degrees a second: after 12 seconds the target has gone round once", async () => {
    const { stage, r, cams } = setup();
    const p = stage.show("Agumon", { shadow: false });
    await settle(); r.pending[0].res(true); await p;
    const c = ctx();
    for (let i = 0; i < 600; i++) assert.equal(stage.draw(c, 0, 0, 188, 86, 0.02), true);
    const cam = cams[0];
    assert.ok(Math.abs(cam.targetYaw - 2 * Math.PI) < 1e-6, `yaw ${cam.targetYaw}`);
    assert.equal(cam.autoOrbitSpeed, 30);
    assert.equal(c.calls.length, 600, "every frame copies the renderer canvas into the window");
});

test("the distance is fitted to a sphere once, so it does not change while the model turns", async () => {
    const { stage, r, cams } = setup();
    const p = stage.show("Agumon", { shadow: false });
    await settle(); r.pending[0].res(true); await p;
    const c = ctx();
    stage.draw(c, 0, 0, 188, 86, 0.02);
    const d0 = cams[0].targetDist;
    assert.ok(d0 > 0 && Number.isFinite(d0));
    for (let i = 0; i < 100; i++) stage.draw(c, 0, 0, 188, 86, 0.02);
    assert.equal(cams[0].targetDist, d0);
});

test("a shadow species is tinted black; a known one puts the game's own tint back; closing restores it too", async () => {
    const { stage, r, tints } = setup();
    let p = stage.show("Agumon", { shadow: true });
    await settle(); r.pending[0].res(true); await p;
    assert.deepEqual(tints.at(-1), ["player", [0, 0, 0, 1]]);
    p = stage.show("Gabumon", { shadow: false });
    await settle(); r.pending[1].res(true); await p;
    assert.deepEqual(tints.at(-1), ["player", null]);
    stage.close();
    assert.deepEqual(tints.at(-1), ["player", null]);
    assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), false, "closed: nothing drawn");
});

test("without WebGL the stage says so and draws nothing, it does not throw", async () => {
    const { stage } = setup({ makeRenderer: () => null });
    assert.equal(await stage.show("Agumon", { shadow: false }), false);
    assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), false);
});

test("20 open / close cycles use exactly ONE renderer (one WebGL context for the whole session); close never destroys it", async () => {
    const { stage, r, made } = setup();
    for (let i = 0; i < 20; i++) {
        const p = stage.show(i % 2 ? "Gabumon" : "Agumon", { shadow: false });
        await settle(); r.pending.at(-1).res(true); assert.equal(await p, true);
        assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), true);
        stage.close();
        assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), false, "closed: nothing is drawn");
    }
    assert.equal(made(), 1, "one renderer made");
    assert.equal(r.log.filter((l) => l[0] === "destroy").length, 0, "never destroyed: the next open reuses it");
});

test("close gives the shared tint back and stops drawing", async () => {
    const { stage, r, tints } = setup();
    const p = stage.show("Agumon", { shadow: true });
    await settle(); r.pending[0].res(true); await p;
    stage.close();
    assert.deepEqual(tints.at(-1), ["player", null]);
});

test("the next species on the SAME model folder while it still loads is the same load: no failure, no No picture", async () => {
    const { stage, r } = setup({ resolveFolder: async () => "m_same" });
    const a = stage.show("Guardromon", { shadow: false });
    const b = stage.show("Guardromon2", { shadow: false });
    await settle();
    assert.equal(r.log.filter((l) => l[0] === "player").length, 1, "the model is asked for once");
    r.pending[0].res(true);
    assert.equal(await a, false, "the older call is superseded");
    assert.equal(await b, true);
    assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), true);
});

test("a load that finishes after close() is dropped", async () => {
    const { stage, r } = setup();
    const p = stage.show("Agumon", { shadow: false });
    await settle();
    stage.close();
    r.pending[0].res(true);
    assert.equal(await p, false);
    assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), false);
});

test("the book canvas is 288 x 144: the 144 x 72 image rectangle at the 2x game scale", () => {
    assert.deepEqual(CANVAS_SIZE, [288, 144]);
});

// independent of the stage's own projection: the angle of a point above or below the look direction, in the plane of look and up
function heightShare(view, bottom, top) {
    const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
    const len = (a) => Math.sqrt(dot(a, a));
    let f = sub(view.look, view.eye); f = f.map((v) => v / len(f));
    const upv = view.up;
    const u0 = sub(upv, f.map((v) => v * dot(upv, f)));
    const u = u0.map((v) => v / len(u0));
    const ang = (p) => { const v = sub(p, view.eye); return Math.atan2(dot(v, u), dot(v, f)); };
    const th = Math.tan(view.fovDeg * Math.PI / 360);
    const yb = Math.tan(ang(bottom)) / th, yt = Math.tan(ang(top)) / th;      // -1..1, up positive
    return { share: (yt - yb) / 2, mid: (yt + yb) / 2, bottom: yb };
}
for (const [label, H, W] of [["small", 60, 40], ["big", 600, 380], ["wide and low", 80, 300]]) {
    test(`framing: a ${label} model fills about 80% of the window height, centred`, async () => {
        const { stage, r, cams } = setup();
        r.bounds = { min: [-W / 2, 0, -W / 2], max: [W / 2, H, W / 2], center: [0, H / 2, 0], size: [W, H, W] };
        const p = stage.show("Agumon", { shadow: false });
        await settle(); r.pending[0].res(true); await p;
        stage.draw(ctx(), 0, 0, 144, 72, 0.02);
        const v = cams[0].view();
        const s = heightShare(v, [0, 0, 0], [0, H, 0]);
        assert.ok(Math.abs(s.bottom + FILL) < 0.03, `feet at ${s.bottom}, expected ${-FILL} (90% down the window)`);
        if (label !== "wide and low") {
            assert.ok(Math.abs(s.share - FILL) < 0.03, `share ${s.share}`);
            assert.ok(Math.abs(s.mid) < 0.05, `mid ${s.mid}`);
        } else {
            assert.ok(s.share <= FILL + 0.03, `a wide model must not be bigger than 80%: ${s.share}`);
        }
    });
}

test("the viewer's background, grid and axis lines are switched off for this stage only (setViewerStudio(false))", async () => {
    const { stage, r } = setup();
    const p = stage.show("Agumon", { shadow: false });
    await settle(); r.pending[0].res(true); await p;
    assert.deepEqual(r.log.filter((l) => l[0] === "studio"), [["studio", false]]);
});

test("while the next model loads, the last finished frame keeps being drawn; the tint changes only at the swap", async () => {
    const { stage, r, tints } = setup();
    let p = stage.show("Agumon", { shadow: false });
    await settle(); r.pending[0].res(true); await p;
    const tintsBefore = tints.length;
    const q = stage.show("Gabumon", { shadow: true });
    await settle();
    const c = ctx();
    assert.equal(stage.draw(c, 0, 0, 144, 72, 0.02), true, "old model still drawn while the new one loads");
    assert.equal(c.calls.length, 1);
    assert.equal(tints.length, tintsBefore, "no tint change before the swap");
    r.pending[1].res(true); await q;
    assert.deepEqual(tints.at(-1), ["player", [0, 0, 0, 1]]);
});

test("no model: the partner picture is drawn instead; draw says false only when neither exists", async () => {
    const asked = [];
    const { stage } = setup({ drawFallback: (c, who, x, y, w, h) => { asked.push([who, x, y, w, h]); return who.partnerId === 9; } });
    await stage.show("Nope", { shadow: false, partnerId: 9 });
    assert.equal(stage.draw(ctx(), 1, 2, 144, 72, 0.02), true);
    assert.deepEqual(asked.at(-1), [{ name: "Nope", partnerId: 9 }, 1, 2, 144, 72]);
    await stage.show("Nope", { shadow: false, partnerId: null });
    assert.equal(stage.draw(ctx(), 1, 2, 144, 72, 0.02), false);
});

test("a species that loads fine never uses the fallback", async () => {
    let used = 0;
    const { stage, r } = setup({ drawFallback: () => { used++; return true; } });
    const p = stage.show("Agumon", { shadow: false, partnerId: 1 });
    await settle(); r.pending[0].res(true); await p;
    stage.draw(ctx(), 0, 0, 144, 72, 0.02);
    assert.equal(used, 0);
});

test("a soft round floor shadow is drawn under the feet when the 2d context can paint a gradient", async () => {
    const { stage, r } = setup();
    const p = stage.show("Agumon", { shadow: false });
    await settle(); r.pending[0].res(true); await p;
    const c = ctx(); const ops = [];
    c.createRadialGradient = () => ({ addColorStop: () => {} });
    for (const k of ["save", "restore", "translate", "scale", "beginPath", "arc", "fill"]) c[k] = () => ops.push(k);
    stage.draw(c, 0, 0, 144, 72, 0.02);
    assert.ok(ops.includes("arc") && ops.includes("fill"));
    assert.equal(c.calls.length, 1);
});
