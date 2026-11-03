// Quest editor page (web/quest-editor.html): where the characters the extra quests added stand, and the named paths their
// scenes walk. Walkable ground is web/quest-walk.js over web/assets/collision/<map>.json, the same test the game and the
// build-time checker use (rules in web/quest-editor-lib.js). Load / save go through tools/quest_editor_server.py (port 8091).
import { DIRS, PATH_NAME, questGrid, walkable, snapPoint, pathLegs, questCellFree } from "./quest-editor-lib.js";

const HELPER = `http://${location.hostname}:8091`;
const $ = (id) => document.getElementById(id);
const clone = (v) => JSON.parse(JSON.stringify(v));

let saved = null;            // { characters: [{npc_id, name, residents}], paths } as of the last save (JSON string for compare)
let work = null;             // the same, being edited
let canSave = false;
let allMaps = [];
let mapId = "";
let grid = null, mapImg = null, groundCanvas = null;
let Z = 2;
let selChar = null;          // npc_id
let selPath = null;          // path name
let drawMode = false, addMode = false;
let drag = null;
const grids = new Map();

const say = (text, kind = "note") => { const m = $("msg"); m.textContent = text; m.className = "msg " + kind; };
const isDirty = () => !!work && JSON.stringify(work) !== saved;
const refreshDirty = () => { $("dirty").textContent = isDirty() ? "(unsaved changes)" : ""; };
const charOf = (id) => work.characters.find((c) => c.npc_id === id);
const residentOn = (ch, map) => ch.residents.find((r) => r.map === map);

// ---------------------------------------------------------------------------------------------------- loading
async function fetchGrid(id) {
    if (grids.has(id)) return grids.get(id);
    let g = null;
    try {
        const r = await fetch(`assets/collision/${id}.json`);
        if (r.ok) g = questGrid(await r.json());
    } catch { /* no data for this map */ }
    grids.set(id, g);
    return g;
}

async function load() {
    try {
        const r = await fetch(HELPER + "/load");
        const d = await r.json();
        work = { characters: d.characters.map((c) => ({ npc_id: c.npc_id, name: c.name, residents: c.residents ?? [] })), paths: d.paths ?? {} };
        allMaps = d.maps ?? [];
        canSave = true;
    } catch {
        // read-only fallback: what the game itself reads
        const ex = await (await fetch("extra_npcs.json")).json();
        const byId = new Map();
        for (const r of ex.residents ?? []) {
            if (!byId.has(r.npc_id)) byId.set(r.npc_id, { npc_id: r.npc_id, name: "#" + r.npc_id, residents: [] });
            byId.get(r.npc_id).residents.push({ map: r.map, x: r.x, y: r.y, dir: r.dir });
        }
        let paths = {};
        try { paths = (await (await fetch("quest-paths.json")).json()).paths ?? {}; } catch { /* none yet */ }
        work = { characters: [...byId.values()], paths };
        canSave = false;
        say("The save helper is not running, so this is read-only. Start it: python3 tools/quest_editor_server.py", "bad");
    }
    saved = JSON.stringify(work);
    $("maps").innerHTML = allMaps.map((m) => `<option value="${m}">`).join("");
    $("save").disabled = !canSave;
    if (selChar != null && !charOf(selChar)) selChar = null;
    if (selPath && !work.paths[selPath]) selPath = null;
    if (!mapId) {
        const first = work.characters.find((c) => c.residents.length);
        if (first) { selChar = first.npc_id; await showMap(first.residents[0].map); }
    } else await showMap(mapId);
    renderLists();
    refreshDirty();
}

async function showMap(id) {
    id = String(id || "").trim();
    const g = await fetchGrid(id);
    if (!g) { say(`No walk data for map "${id}".`, "bad"); return; }
    mapId = id; grid = g; $("mapId").value = id;
    mapImg = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = `assets/maps/${id}.png`; });
    // the walkable cells once, as a tiny image scaled up when drawn
    const c = document.createElement("canvas");
    c.width = g.cols; c.height = g.rows;
    const cx = c.getContext("2d"), img = cx.createImageData(g.cols, g.rows);
    for (let r = 0; r < g.rows; r++) for (let q = 0; q < g.cols; q++) {
        if (!questCellFree(g, q, r)) continue;
        const o = (r * g.cols + q) * 4;
        img.data[o] = 60; img.data[o + 1] = 204; img.data[o + 2] = 153; img.data[o + 3] = 90;
    }
    cx.putImageData(img, 0, 0);
    groundCanvas = c;
    const cv = $("view");
    cv.width = g.cols * g.cell * Z; cv.height = g.rows * g.cell * Z;
    if (selPath && work.paths[selPath]?.map !== id) { selPath = null; drawMode = false; }
    renderLists();
    draw();
}

// ---------------------------------------------------------------------------------------------------- drawing
function marker(ctx, x, y, label, colour, big) {
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.beginPath(); ctx.ellipse(x * Z, y * Z, 9 * Z / 2, 4 * Z / 2, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = big ? 3 : 2;
    ctx.beginPath(); ctx.moveTo(x * Z, y * Z); ctx.lineTo(x * Z, (y - 34) * Z); ctx.stroke();
    ctx.beginPath(); ctx.arc(x * Z, (y - 34) * Z, 5 * Z / 2, 0, 7); ctx.fill();
    ctx.font = `${Math.max(11, 6 * Z)}px system-ui`; ctx.textAlign = "center";
    ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText(label, x * Z, (y - 40) * Z);
    ctx.fillStyle = "#fff"; ctx.fillText(label, x * Z, (y - 40) * Z);
}

function draw() {
    if (!grid) return;
    const cv = $("view"), ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#222"; ctx.fillRect(0, 0, cv.width, cv.height);
    if (mapImg && $("showMap").checked) ctx.drawImage(mapImg, 0, 0, cv.width, cv.height);
    if ($("showGround").checked) ctx.drawImage(groundCanvas, 0, 0, cv.width, cv.height);
    // paths on this map
    for (const [name, p] of Object.entries(work.paths)) {
        if (p.map !== mapId) continue;
        const sel = name === selPath;
        const owner = p.npc != null ? charOf(p.npc) : null;
        const post = owner ? residentOn(owner, mapId) : null;
        const pts = post ? [[post.x, post.y], ...p.points] : p.points;
        ctx.lineWidth = sel ? 3 : 2; ctx.strokeStyle = sel ? "#4fd1ff" : "rgba(79,209,255,.55)";
        ctx.beginPath();
        pathLegs(grid, pts).forEach((legs, i) => {
            let [x, y] = pts[i];
            ctx.moveTo(x * Z, y * Z);
            for (const [lx, ly] of legs) { ctx.lineTo(lx * Z, ly * Z); }
        });
        ctx.stroke();
        p.points.forEach(([x, y], i) => {
            ctx.fillStyle = sel ? "#4fd1ff" : "rgba(79,209,255,.7)";
            ctx.beginPath(); ctx.arc(x * Z, y * Z, 4 * Z / 2 + 1, 0, 7); ctx.fill();
            ctx.fillStyle = "#000"; ctx.font = `${Math.max(9, 5 * Z)}px system-ui`; ctx.textAlign = "center";
            ctx.fillText(String(i + 1), x * Z, y * Z + 3 * Z / 2);
        });
        if (p.points.length) {
            ctx.fillStyle = "#fff"; ctx.font = `${Math.max(10, 5 * Z)}px system-ui`; ctx.textAlign = "left";
            ctx.fillText(name, p.points[0][0] * Z + 8, p.points[0][1] * Z - 6);
        }
    }
    // characters standing on this map
    for (const ch of work.characters) {
        const r = residentOn(ch, mapId);
        if (!r) continue;
        const ok = walkable(grid, r.x, r.y);
        marker(ctx, r.x, r.y, ch.name + (ok ? "" : " (not walkable)"), !ok ? "#ff5a5a" : ch.npc_id === selChar ? "#ffcc33" : "#e0a020", ch.npc_id === selChar);
    }
}

// ---------------------------------------------------------------------------------------------------- lists
function renderLists() {
    if (!work) return;
    const box = $("chars");
    box.innerHTML = "";
    for (const ch of work.characters) {
        const d = document.createElement("div");
        d.className = "char" + (ch.npc_id === selChar ? " sel" : "");
        const head = document.createElement("div");
        head.className = "head";
        head.innerHTML = `<div class="face" style="width:24px;height:48px;background-image:url(extra_sprites/q${ch.npc_id}.png)"></div><div><b>${ch.name}</b><div class="dim">npc ${ch.npc_id}</div></div>`;
        head.onclick = () => { selChar = ch.npc_id; renderLists(); draw(); updateSel(); };
        d.appendChild(head);
        for (const r of ch.residents) {
            const it = document.createElement("div");
            it.className = "item" + (ch.npc_id === selChar && r.map === mapId ? " sel" : "");
            const bad = fetchedBad(r);
            it.innerHTML = `<span>${r.map}  ${r.x}, ${r.y}  ${r.dir}</span><span class="dim">${bad ? "not walkable" : ""}</span>`;
            it.onclick = async () => { selChar = ch.npc_id; await showMap(r.map); updateSel(); };
            d.appendChild(it);
        }
        box.appendChild(d);
    }
    // paths on this map
    const pb = $("paths");
    pb.innerHTML = "";
    const names = Object.keys(work.paths).filter((n) => work.paths[n].map === mapId);
    if (!names.length) pb.innerHTML = '<div class="dim">none on this map</div>';
    for (const n of names) {
        const it = document.createElement("div");
        it.className = "item" + (n === selPath ? " sel" : "");
        it.innerHTML = `<span>${n}</span><span class="dim">${work.paths[n].points.length} points</span>`;
        it.onclick = () => { selPath = n; drawMode = false; renderLists(); draw(); updateSel(); };
        pb.appendChild(it);
    }
    updateSel();
}

// "not walkable" in a list row is judged only for maps whose grid is already loaded (the current one and visited ones)
function fetchedBad(r) {
    const g = grids.get(r.map);
    return g ? !walkable(g, r.x, r.y) : false;
}

function updateSel() {
    const ch = selChar != null ? charOf(selChar) : null;
    const r = ch ? residentOn(ch, mapId) : null;
    $("selInfo").textContent = ch ? `${ch.name} (npc ${ch.npc_id})${r ? `: on ${mapId} at ${r.x}, ${r.y}` : `: not on ${mapId}`}` : "none";
    const dirSel = $("dir");
    dirSel.disabled = !r;
    if (r) dirSel.value = r.dir;
    $("addRes").disabled = !ch || !!r;
    $("addRes").classList.toggle("on", addMode);
    $("rmRes").disabled = !r;
    $("rmChar").disabled = !ch;
    $("rmPath").disabled = !selPath;
    $("drawMode").disabled = !selPath;
    $("drawMode").classList.toggle("on", drawMode);
    $("discard").disabled = !isDirty();
    refreshDirty();
}

// ---------------------------------------------------------------------------------------------------- pointer
const worldOf = (e) => {
    const b = $("view").getBoundingClientRect();
    return [(e.clientX - b.left) / b.width * $("view").width / Z, (e.clientY - b.top) / b.height * $("view").height / Z];
};

function hit(x, y) {
    const R = 10;
    // path points first (they sit on top), then characters
    for (const [name, p] of Object.entries(work.paths)) {
        if (p.map !== mapId) continue;
        for (let i = p.points.length - 1; i >= 0; i--) if (Math.hypot(p.points[i][0] - x, p.points[i][1] - y) < R) return { kind: "pt", name, i };
    }
    for (const ch of work.characters) {
        const r = residentOn(ch, mapId);
        if (r && Math.hypot(r.x - x, r.y - y - 14) < 24 && Math.abs(r.x - x) < 14) return { kind: "res", ch, r };
    }
    return null;
}

$("view").addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !grid) return;
    const [x, y] = worldOf(e);
    if (addMode) { placeResident(x, y); return; }
    const h = hit(x, y);
    if (h) {
        drag = { ...h, from: h.kind === "res" ? [h.r.x, h.r.y] : [...work.paths[h.name].points[h.i]] };
        if (h.kind === "res") selChar = h.ch.npc_id; else selPath = h.name;
        renderLists();
        return;
    }
    if (drawMode && selPath) {
        const p = snapPoint(grid, x, y);
        if (!p) { say(`(${Math.round(x)}, ${Math.round(y)}) is not walkable ground and nothing walkable is within 24 px: point not added.`, "bad"); return; }
        work.paths[selPath].points.push(p);
        say(`Point ${work.paths[selPath].points.length} added at ${p[0]}, ${p[1]}.`, "ok");
        renderLists(); draw();
    }
});

$("view").addEventListener("mousemove", (e) => {
    if (!grid) return;
    const [x, y] = worldOf(e);
    $("cursor").textContent = `${Math.round(x)}, ${Math.round(y)} ${walkable(grid, x, y) ? "walkable" : "blocked"}`;
    if (!drag) return;
    if (drag.kind === "res") { drag.r.x = Math.round(x); drag.r.y = Math.round(y); }
    else work.paths[drag.name].points[drag.i] = [Math.round(x), Math.round(y)];
    draw();
});

window.addEventListener("mouseup", () => {
    if (!drag) return;
    const d = drag; drag = null;
    const cur = d.kind === "res" ? [d.r.x, d.r.y] : work.paths[d.name].points[d.i];
    const p = snapPoint(grid, cur[0], cur[1]);
    const put = (pt) => { if (d.kind === "res") { d.r.x = pt[0]; d.r.y = pt[1]; } else work.paths[d.name].points[d.i] = pt; };
    if (!p) { put(d.from); say(`Not walkable and nothing walkable within 24 px of ${Math.round(cur[0])}, ${Math.round(cur[1])}: it went back.`, "bad"); }
    else { put(p); say(`Now at ${p[0]}, ${p[1]}.`, "ok"); }
    renderLists(); draw();
});

$("view").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (drawMode && selPath && work.paths[selPath].points.length) {
        work.paths[selPath].points.pop();
        renderLists(); draw();
    }
});

function placeResident(x, y) {
    addMode = false;
    const ch = charOf(selChar);
    if (!ch) return;
    const p = snapPoint(grid, x, y);
    if (!p) { say("Not walkable there, nothing placed.", "bad"); updateSel(); return; }
    ch.residents.push({ map: mapId, x: p[0], y: p[1], dir: "down" });
    say(`${ch.name} now stands on ${mapId} at ${p[0]}, ${p[1]}.`, "ok");
    renderLists(); draw();
}

// ---------------------------------------------------------------------------------------------------- buttons
$("dir").innerHTML = DIRS.map((d) => `<option>${d}</option>`).join("");
$("dir").onchange = () => { const r = residentOn(charOf(selChar), mapId); if (r) { r.dir = $("dir").value; renderLists(); } };
$("go").onclick = () => showMap($("mapId").value);
$("mapId").onkeydown = (e) => { if (e.key === "Enter") showMap($("mapId").value); };
$("zoom").onchange = () => { Z = Number($("zoom").value); showMap(mapId); };
$("showGround").onchange = $("showMap").onchange = draw;
$("addRes").onclick = () => {
    const ch = charOf(selChar);
    if (!ch || residentOn(ch, mapId)) return;
    addMode = !addMode; drawMode = false;
    say(addMode ? `Click where ${ch.name} should stand on ${mapId}.` : "", "note");
    updateSel();
};
$("rmRes").onclick = () => {
    const ch = charOf(selChar);
    if (!ch) return;
    ch.residents = ch.residents.filter((r) => r.map !== mapId);
    say(`${ch.name} no longer stands on ${mapId}.`, "ok");
    renderLists(); draw();
};
$("rmChar").onclick = () => {
    const ch = charOf(selChar);
    if (!ch || !confirm(`Remove ${ch.name} (npc ${ch.npc_id}) completely, with all places and paths? Nothing is written until you press Save.`)) return;
    work.characters = work.characters.filter((c) => c.npc_id !== ch.npc_id);
    for (const [n, p] of Object.entries(work.paths)) if (p.npc === ch.npc_id) { delete work.paths[n]; if (selPath === n) selPath = null; }
    selChar = null;
    say(`${ch.name} removed (not saved yet).`, "note");
    renderLists(); draw();
};
$("mkPath").onclick = () => {
    const n = $("newPath").value.trim();
    if (!PATH_NAME.test(n)) { say("Path name: lower-case letters, digits and _ only, starting with a letter (like park_leomon_to_gate).", "bad"); return; }
    if (work.paths[n]) { say(`A path called ${n} exists already.`, "bad"); return; }
    work.paths[n] = { map: mapId, ...(selChar != null ? { npc: selChar } : {}), points: [] };
    selPath = n; drawMode = true; addMode = false; $("newPath").value = "";
    say(`Path ${n} made on ${mapId}. Click the ground to add points.`, "ok");
    renderLists(); draw();
};
$("drawMode").onclick = () => { drawMode = !drawMode; addMode = false; updateSel(); };
$("rmPath").onclick = () => {
    if (!selPath || !confirm(`Delete path ${selPath}? Scenes naming it will stop working once you Save.`)) return;
    delete work.paths[selPath]; selPath = null; drawMode = false;
    renderLists(); draw();
};

$("save").onclick = async () => {
    if (!canSave) return;
    const body = {
        keep: work.characters.map((c) => c.npc_id),
        residents: Object.fromEntries(work.characters.map((c) => [c.npc_id, c.residents])),
        paths: work.paths,
    };
    let r, d;
    try { r = await fetch(HELPER + "/save", { method: "POST", body: JSON.stringify(body) }); d = await r.json(); }
    catch { say("The save helper does not answer. Nothing was saved.", "bad"); return; }
    if (!r.ok) { say("Not saved:\n" + (d.problems ?? ["unknown error"]).join("\n"), "bad"); return; }
    say("Saved. " + (d.built ?? ""), "ok");
    await load();
};

$("discard").onclick = async () => {
    if (!isDirty()) return;
    if (!confirm("Throw away everything since the last save?")) return;
    drag = null; addMode = false; drawMode = false;
    await load();
    say("Back to the last save.", "ok");
};

window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

load();
