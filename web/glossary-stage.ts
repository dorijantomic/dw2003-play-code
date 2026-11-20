// web/glossary-stage.js -- the Digimon on the right of GLOSSARY > DIGIMON: the game's own battle renderer, one model alone,
// turning slowly with its own idle motion. One renderer (one WebGL context) for the whole book.
//
// It uses what the animation viewer already uses (web/anim-viewer.html:584-585, 1573-1575): the enemy hidden, isolated mode, the
// free camera mode with the camera from web/anim-viewer-camera.js. The free camera orbits the model at `autoOrbitSpeed` degrees a
// second, which is the model turning. `setViewerStudio(false)` (battle3d.js, additive) takes away the viewer's background, grid and
// axis lines and clears to transparent, so the book's own panel shows behind the model. The renderer's canvas must be created with
// {alpha: true}; its size for the book is 288 x 144 (the 144 x 72 image rectangle at the 2x game scale).
export const TURN_SECONDS = 12;                       // decided: one turn per 12 seconds
export const TURN_DEG_PER_S = 360 / TURN_SECONDS;     // 30
export const CANVAS_SIZE = [288, 144];                // the image rectangle 144 x 72 times the 2x game scale
export const FILL = 0.8;                              // the model's height as a share of the window height

const SHADOW = [0, 0, 0, 1];                          // a ???: the model drawn black
const PITCH_DEG = 8;                                  // the viewer's "front" preset pitch (anim-viewer-camera.js PRESETS)

/** Screen position of a world point for a view {eye, look, up, fovDeg}: x, y in -1..1 (y up), and the depth. */
export function projectPoint(view, p, aspect) {
    const f = [view.look[0] - view.eye[0], view.look[1] - view.eye[1], view.look[2] - view.eye[2]];
    const fl = Math.hypot(...f) || 1; f[0] /= fl; f[1] /= fl; f[2] /= fl;
    const rx = f[1] * view.up[2] - f[2] * view.up[1], ry = f[2] * view.up[0] - f[0] * view.up[2], rz = f[0] * view.up[1] - f[1] * view.up[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    const r = [rx / rl, ry / rl, rz / rl];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const v = [p[0] - view.eye[0], p[1] - view.eye[1], p[2] - view.eye[2]];
    const depth = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
    const th = Math.tan(view.fovDeg * Math.PI / 360);
    return { x: (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / (depth * th * aspect), y: (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / (depth * th), depth };
}

export function createStage({ makeRenderer, makeCamera, resolveFolder, setTint, size = CANVAS_SIZE, canvasFactory = null, drawFallback = null }) {
    let r = null, canvas = null, cam = null;
    let token = 0, loading = null, folder = null, ready = false, framed = false, closed = false, failed = false;
    let shown = null;                                   // { name, partnerId } of the species asked for last
    let feet = null;                                    // { center: [x, y, z], radius } for the floor shadow

    function ensure() {
        if (r || failed) return !!r;
        try {
            canvas = canvasFactory ? canvasFactory(size[0], size[1])
                : (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size[0], size[1]) : null);
            r = canvas ? makeRenderer(canvas) : null;
        } catch { r = null; }
        if (!r) { failed = true; return false; }
        cam = makeCamera({ yaw: 0, pitch: PITCH_DEG * Math.PI / 180, fovDeg: 45, damping: 14 });
        cam.autoOrbitSpeed = TURN_DEG_PER_S;
        r.setEnemyVisible(false);
        r.setPlayerVisible(true);
        r.setIsolated(true, "player");
        r.setViewerStudio?.(false);                     // no grid, no axis lines, no background: the panel shows through
        r.setCameraMode("free");
        r.setFreeCameraView(() => cam.view());
        return true;
    }

    return {
        /**
         * Show species `name`. Resolves true when its model is up, false when there is none, it failed, or a newer show() won.
         * While the new model loads the last finished frame keeps being drawn (no flash between species).
         */
        async show(name, { shadow = false, partnerId = null } = {}) {
            const mine = ++token;
            closed = false;
            shown = { name, partnerId };
            if (!ensure()) { ready = false; return false; }
            let f = null;
            try { f = await resolveFolder(name); } catch { f = null; }
            if (mine !== token) return false;
            if (!f) { ready = false; folder = null; return false; }
            // the same model folder as a load still in flight (Guardromon, then Guardromon2): it is that load, not a second request
            if (!(loading && loading.folder === f)) {
                const p = Promise.resolve().then(() => r.setPlayerDigimon(f)).catch(() => false);
                loading = { folder: f, promise: p };
                p.then(() => { if (loading?.promise === p) loading = null; });
            }
            const ok = await loading.promise;
            if (mine !== token) return false;
            if (!ok) { ready = false; folder = null; return false; }
            folder = f;
            setTint("player", shadow ? SHADOW : null);   // set at the swap, so the old model keeps its look until the new one is in
            framed = false; feet = null;
            ready = true;
            return true;
        },
        /** Render one frame and copy it into (x, y, w, h) of `ctx`. Falls back to the partner picture; false when there is nothing. */
        draw(ctx, x, y, w, h, dt = 0.02) {
            if (closed) return false;
            if (!ready || !r) return drawFallback && shown ? !!drawFallback(ctx, shown, x, y, w, h) : false;
            cam.update(dt);
            r.render(dt);
            const aspect = canvas.width / canvas.height;
            if (!framed) {
                const b = r.getFighterBounds("player");
                if (b) {
                    // The distance is fitted once, to a circle round the turning axis, so it does not change while the model turns.
                    const H = Math.max(1, b.size[1]);
                    const radius = Math.max(1, Math.hypot(b.size[0], b.size[2]) / 2);
                    cam.frameBounds({ center: b.center, half: [radius, H / 2, radius] }, aspect, { immediate: true });   // the pivot
                    // the distance: the height fills FILL of the window (depth of the box is not added, it would shrink the
                    // model); a wide model is held back so its nearest edge still fits across the window as it turns
                    const th = Math.tan(cam.fovDeg * Math.PI / 360);
                    const dTall = (H / 2) * Math.cos(PITCH_DEG * Math.PI / 180) / th / FILL;
                    const dWide = radius * (1 + 1 / (th * aspect)) / 0.95;
                    cam.targetDist = cam.dist = Math.max(dTall, dWide);
                    // the feet always stand at the same place, FILL below the middle (90% down the window); for a tall model that is
                    // the centre of the box, for a wide, low one it keeps the feet from floating
                    const pr = PITCH_DEG * Math.PI / 180;
                    const py = b.min[1] + FILL * th * cam.dist / (Math.cos(pr) - FILL * th * Math.sin(pr));   // the camera looks down a little
                    cam.targetPivot = [b.center[0], py, b.center[2]]; cam.pivot = cam.targetPivot.slice();
                    framed = true;
                    feet = { center: [b.center[0], b.min[1], b.center[2]], radius };
                }
            }
            // the soft round floor shadow, under the feet (drawn here: the renderer's own one is a hard rectangle)
            if (feet && ctx.createRadialGradient) {
                const p = projectPoint(cam.view(), feet.center, aspect);
                const q = projectPoint(cam.view(), [feet.center[0] + feet.radius * 0.8, feet.center[1], feet.center[2]], aspect);
                const cx = x + (p.x + 1) / 2 * w, cy = y + (1 - p.y) / 2 * h;
                const rx = Math.max(2, Math.abs(q.x - p.x) / 2 * w), ry = rx * 0.3;
                const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
                g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(1, "rgba(0,0,0,0)");
                ctx.save();
                ctx.translate(cx, cy); ctx.scale(1, ry / rx);
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
            ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, y, w, h);
            return true;
        },
        /**
         * The book shut: stop drawing and give the game's tint table back (it is shared with real fights). The renderer is KEPT, one
         * WebGL context for the whole session: every open used to make a new context and Chrome drops old ones, maybe the battle's.
         */
        close() {
            token++; closed = true; ready = false; framed = false; feet = null; loading = null;
            setTint("player", null);
        },
        debug: () => ({ folder, ready, framed, closed, yaw: cam?.yaw ?? null, targetYaw: cam?.targetYaw ?? null, dist: cam?.dist ?? null, speed: cam?.autoOrbitSpeed ?? null }),
    };
}
