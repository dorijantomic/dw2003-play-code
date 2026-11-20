// web/quest-ghost.js
// The `ghost` scene step's runtime: one character (an NPC id, or "player") drawn as a faded, tinted figure for the rest of
// the scene -- a memory replay -- until { "ghost": <id>, "off": true } or the scene ends.
//
// The step is data (web/quest-scenes.js compiles it into the `ghost` event kind). This module does two things:
//
//   1. It remembers per actor what the renderer should do -- { alpha, tint } -- and the field renderer in web/game.js asks
//      it, per actor, through three small calls (the only edits that file carries for this step):
//        questGhostActor(ctx, key, draw)       around one actor's whole draw closure   -> alpha (sprite AND its shadow)
//        questGhostImage(ctx, img, sx, sy, sw, sh, dx, dy)   inside the two frame draws -> tint
//      Everything else about the sprite (which frame, which facing, the billboard anchor, the drop shadow) is the game's
//      own code, unchanged.
//   2. It owns the camera rule for `drop`/`rise`: whatever a `pan` step left the camera looking at, the fall is watched
//      from the player (questSceneCameraToPlayer(), called by the host when a drive starts).
//
// TINT WITHOUT NEW ART: the frame the game was about to draw is copied into a small offscreen canvas, washed with the
// tint colour while keeping the frame's own shading (`source-atop` at 60%), and cached under (image, source rect, tint).
// A repeated frame -- the same walk cell next cycle -- is then one drawImage of the cached copy. Art stays the game's; only
// compositing happens here. Nothing is written to an asset.
//
// Nothing here may outlive its scene: questGhostClear() empties the table and drops the tint cache, and web/quest-fx.js
// questFxClear() (the single exit path: scene end, skip, mid-scene battle, warp, map change, save load, title, F2 "Quests"
// off) calls it. A ghost is therefore never left on a map, and a second scene never inherits the first one's ghosts.

/** Per actor: "player" or the NPC id (a number) -> { alpha, tint }. */
const ghosts = new Map();

/** The actor whose draw closure is running right now (null outside one); read by questGhostImage. */
let current = null;

/** Host callback: put the field camera back on the player (installed once by web/game.js). */
let cameraToPlayer = null;

/** Host reader: is the quest layer switched on (F2 -> Extras -> Quests)? Installed once by web/game.js. */
let questsGate = null;

/** Cache of tinted frames: image -> Map("sx,sy,sw,sh|#rrggbb" -> canvas). Bounded per image; a ghost is a few frames. */
const tintCache = new WeakMap();
const TINT_CACHE_PER_IMAGE = 96;

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)));

/** The actor key the renderer uses: "player", or the numeric NPC id. */
function actorKey(who) {
    if (who === "player") return "player";
    if (who == null || typeof who === "boolean") return null;
    if (typeof who === "string" && who.trim() === "") return null;
    const n = Number(who);
    return Number.isFinite(n) ? n : null;
}

const tintOf = (t) => (typeof t === "string" && /^#[0-9a-fA-F]{6}$/.test(t) ? t.toLowerCase() : null);

/**
 * The `ghost` event: { kind: "ghost", npc: <id>|"player", alpha, tint } fades and tints that actor;
 * { ..., off: true } puts them back. Bad data is ignored (the scene goes on; the step never blocks).
 */
export function questGhostSet(ev) {
    const key = actorKey(ev?.npc);
    if (key == null) return;
    if (ev.off === true) {
        ghosts.delete(key);
        return;
    }
    const alpha = ev.alpha == null || !Number.isFinite(Number(ev.alpha)) ? 0.5 : clamp01(Number(ev.alpha));
    ghosts.set(key, { alpha, tint: tintOf(ev.tint) });
}

/** What the renderer should do with that actor, or null for "draw them normally". */
export function questGhostOf(key) {
    return ghosts.get(actorKey(key)) ?? null;
}

/** True while at least one actor is ghosted (a verifier reads it; the renderer does not need it). */
export const questGhostActive = () => ghosts.size > 0;

/** The ghost step's live state, for a verifier: [{ actor, alpha, tint }]. */
export const questGhostState = () => [...ghosts].map(([actor, g]) => ({ actor, alpha: g.alpha, tint: g.tint }));

/**
 * The live table itself (actor -> { alpha, tint }), as a Map. The host publishes it at `window.__state._questGhosts`
 * (tools/verify_quest_edges.mjs reads its keys); the object identity never changes, questGhostClear empties it in place.
 */
export const questGhostMap = () => ghosts;

/**
 * One actor's whole draw closure. A ghosted actor is drawn at its alpha -- sprite AND drop shadow, because the alpha is
 * set around the closure rather than around the sprite call. `key` is "player" or the NPC id.
 */
export function questGhostActor(ctx, key, draw) {
    // F2 -> Extras -> Quests switched off mid-scene: the ghosts come off on the next frame drawn, exactly as if the
    // scene had ended. (The quest layer's own switch; the scene itself is the game's cutscene and runs on.)
    if (ghosts.size && !ghostsAllowed()) questGhostClear();
    const g = questGhostOf(key);
    if (!g) return draw();
    const prev = current;
    const outerAlpha = ctx.globalAlpha;
    ctx.save();
    ctx.globalAlpha = outerAlpha * g.alpha;
    current = { key: actorKey(key), tint: g.tint };
    try {
        return draw();
    } finally {
        current = prev;
        ctx.restore();
    }
}

/**
 * The two frame draws' own call, standing in for ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh). A tinted actor's
 * frame is composited through a cached offscreen copy; every other actor (and every actor while no ghost is on) is the
 * plain call, so the ordinary field costs one comparison.
 */
export function questGhostImage(ctx, img, sx, sy, sw, sh, dx, dy) {
    const tint = current?.tint;
    if (!tint) {
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
        return;
    }
    ctx.drawImage(tintedFrame(img, sx, sy, sw, sh, tint), 0, 0, sw, sh, dx, dy, sw, sh);
}

/** The frame, washed with `tint` and cached: at most TINT_CACHE_PER_IMAGE frames per image, oldest out first. */
function tintedFrame(img, sx, sy, sw, sh, tint) {
    let byKey = tintCache.get(img);
    if (!byKey) { byKey = new Map(); tintCache.set(img, byKey); }
    const key = `${sx},${sy},${sw},${sh}|${tint}`;
    const hit = byKey.get(key);
    if (hit) return hit;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(sw));
    cv.height = Math.max(1, Math.round(sh));
    const g = cv.getContext("2d");
    g.imageSmoothingEnabled = false;      // pixel art: the field's own setting, so the copy cannot blur
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    // Keep the frame's own shading: a 60% wash of the tint over its pixels, never a flat silhouette.
    g.globalCompositeOperation = "source-atop";
    g.globalAlpha = 0.6;
    g.fillStyle = tint;
    g.fillRect(0, 0, cv.width, cv.height);
    if (byKey.size >= TINT_CACHE_PER_IMAGE) byKey.delete(byKey.keys().next().value);
    byKey.set(key, cv);
    return cv;
}

/**
 * Install the host's "the camera belongs on the player now" action, once. web/game.js supplies the real one (release the
 * scene's fixed FN6B camera and let the field's own follow rule take over), so this module needs no game internals.
 */
export function installQuestGhostCamera(fn) {
    cameraToPlayer = typeof fn === "function" ? fn : null;
}

/**
 * Install the host's reader for the quest layer's own switch (F2 -> Extras -> Quests), once. With it off no actor is
 * drawn as a ghost, and one already on screen is cleared on the next frame.
 */
export function installQuestGhostGate(fn) {
    questsGate = typeof fn === "function" ? fn : null;
}

function ghostsAllowed() {
    if (!questsGate) return true;
    try {
        return questsGate() !== false;
    } catch {
        return true;      // a host that cannot answer never leaves a sprite faded
    }
}

/**
 * A `drop`/`rise` is watched from the player: an earlier `pan` to a point is released here, before the first pixel of the
 * fall, so the room scrolls with the player instead of showing the place the camera was left on. Harmless when the camera
 * is already on the player. The next `pan` step in the scene sets a camera again, as usual.
 */
export function questSceneCameraToPlayer() {
    try {
        cameraToPlayer?.();
    } catch {
        /* a host without a field camera (tests) has nothing to move */
    }
}

/** Put every actor back and empty the tint cache. Called from questFxClear(), the single exit path. */
export function questGhostClear() {
    ghosts.clear();
    current = null;
}
