// EXPERIMENT: ambient villagers — a few extra characters strolling the city and town maps.
//
// They are ordinary scene actors, built the way the game builds the actors its own scripts
// conjure (`_ephemeral`), and walk the game's own looping-path movement (npc.path), so the
// existing drawing, shadows and effects (breath, footprints, grass parting, reflections)
// work on them with no special case. Three safeguards keep them from touching the story:
//   * `invisible` with no `ptrB` makes them non-talkable (the engine's talkCandidates filter);
//   * they only borrow sprites already loaded for the map's own cast, and never the player's;
//   * every path is walked through the map's collision grid first, so they stay on walkable
//     ground, and they are removed during cutscenes, textboxes and battles.
const MAX_PER_MAP = 4;

function walkable(grid, x, y) {
    const c = (x / grid.cell) | 0, r = (y / grid.cell) | 0;
    return c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && grid.cells[r * grid.cols + c] === 0;
}
function clearLine(grid, a, b) {
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let i = 0; i <= n; i++) if (!walkable(grid, a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)) return false;
    return true;
}
// a closed loop of 3-5 waypoints around a start point, every leg on walkable ground
function makeLoop(grid, start, rand) {
    for (let attempt = 0; attempt < 30; attempt++) {
        const pts = [start], n = 3 + ((rand() * 3) | 0);
        let ok = true;
        for (let i = 0; i < n; i++) {
            let next = null;
            for (let tries = 0; tries < 14 && !next; tries++) {
                const a = rand() * 6.283, d = 40 + rand() * 90;
                const p = [pts[pts.length - 1][0] + Math.cos(a) * d, pts[pts.length - 1][1] + Math.sin(a) * d * 0.6];
                if (walkable(grid, p[0], p[1]) && clearLine(grid, pts[pts.length - 1], p)) next = p;
            }
            if (!next) { ok = false; break; }
            pts.push(next);
        }
        if (ok && clearLine(grid, pts[pts.length - 1], start)) return pts;
    }
    return null;
}
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const placed = new Map();   // stageId -> [npc objects we added]

export function villagersActive(stageId) { return (placed.get(stageId) || []).length; }

export function removeVillagers(stageId, state) {
    const list = placed.get(stageId);
    if (!list || !list.length) return;
    const scene = state.scenes?.[stageId];
    if (scene) {
        scene.npcs = scene.npcs.filter((n) => !list.includes(n));
        if (scene._cast) scene._cast = scene._cast.filter((n) => !list.includes(n));
    }
    placed.set(stageId, []);
}

// Called every frame with the game state; adds or removes the villagers as needed.
export function syncVillagers(on, map, profile, state) {
    const id = map.id;
    const scene = state.scenes?.[id];
    const busy = !!(state._inCutscene || state.battleActive || state.textboxOpen);
    const have = placed.get(id) || [];
    if (!on || busy || !profile.villagers) { if (have.length) removeVillagers(id, state); return have.length; }
    if (have.length || !scene || !scene._cast) return have.length;     // already placed, or the cast is not built yet
    const grid = state.collision?.[id];
    if (!grid || !grid.cells) return 0;
    // the map's own cast tells us which sprites are loaded and fit this place
    const templates = [];
    const seenSprites = new Set();
    for (const n of scene.npcs) {
        if (!n.sprite || n.cutsceneOnly || !(n.x > 0 && n.y > 0)) continue;
        if (/^p00[12]/.test(n.sprite) || seenSprites.has(n.sprite)) continue;
        if (!state.npcImgs?.[n.sprite]) continue;
        seenSprites.add(n.sprite); templates.push(n);
    }
    if (templates.length < 2) { placed.set(id, [{ _none: true }]); return 0; }   // nothing sensible to borrow; do not retry every frame
    const rand = rng([...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 11));
    const made = [];
    for (let k = 0; k < Math.min(MAX_PER_MAP * 2, templates.length * 2 + 2) && made.length < MAX_PER_MAP; k++) {
        const tpl = templates[(k + ((rand() * templates.length) | 0)) % templates.length];
        const start = [tpl.x + (rand() - 0.5) * 30, tpl.y + (rand() - 0.5) * 20];
        if (!walkable(grid, start[0], start[1])) continue;
        if (made.some((m) => Math.hypot(m.x - start[0], m.y - start[1]) < 140)) continue;   // spread them out
        const path = makeLoop(grid, start, rand);
        if (!path) continue;
        made.push({
            id: `ambient_${k}`, sprite: tpl.sprite, npc_id: tpl.npc_id, slot: tpl.slot, n: 1,
            x: start[0], y: start[1], dir: "down-left", path,
            _pathIdx: (rand() * path.length) | 0, _pathFrac: rand(),
            invisible: true,              // no ptrB: excluded from the talk cone
            _ephemeral: true, _ambient: true, spawn_flags: [],
        });
    }
    for (const n of made) scene.npcs.push(n);
    placed.set(id, made.length ? made : [{ _none: true }]);
    console.log(`crowd: ${id} -> ${made.length} villagers`);
    return made.length;
}
window.__crowd = (id) => ({ placed: (placed.get(id) || []).filter((n) => !n._none).length });
