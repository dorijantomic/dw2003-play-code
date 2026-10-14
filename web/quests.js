// EXPERIMENT: optional extra quests (not original game content). Off by default: F2 -> "Extra quests".
//
// Design rules (docs/quests-and-coop-plan.md):
//   * Never writes the story: no story flags, no master story counter. Quest progress lives under its
//     own localStorage key, so the story and the normal save are valid with this layer on or off.
//   * Hears the game through gameEvents.js (battle won) and one per-frame call (stage entered); it
//     changes no game rule.
//   * Rewards go through the game's own helpers (supplied by game.js), and are paid once: the quest is
//     marked done and saved BEFORE the reward is handed over.
//   * Night / story variants of a map (map-variants.json) count as the same place.
//
// Quest definitions are data (quests.json). Objective types: "defeat" (species, count, optional maps),
// "visit" (one map). A quest may require another to be done first ({ requires: { done: id } }).
import { fx } from "./ambience.js";
import { on } from "./gameEvents.js";

const KEY = "dw.quests.v1";
const OBJECTIVES = {
    defeat: { target: (o) => Math.max(1, o.count | 0), valid: (o) => Array.isArray(o.species) && o.species.length > 0 },
    visit: { target: () => 1, valid: (o) => typeof o.map === "string" },
    // a fight the quest layer launches itself: real encounter screens (a boss, or two roaming fights back to back),
    // optionally stronger (scale 16 = normal, hpMult). Only a WIN completes it.
    challenge: { target: () => 1, valid: (o) => (Number.isInteger(o.screen) || (Array.isArray(o.screens) && o.screens.every(Number.isInteger) && o.screens.length > 0)) },
    // visit any N distinct places out of a set; remembers WHICH ones (night/story variants of a place count as one)
    visitSet: { target: (o) => Math.max(1, o.count | 0), valid: (o) => Array.isArray(o.maps) && o.maps.length > 0 && (o.count | 0) >= 1 && (o.count | 0) <= o.maps.length },
    duelWin: { target: (o) => Math.max(1, o.count | 0), valid: (o) => (o.count | 0) > 0 },
    // walk from one gate to another in one go; any fight (or leaving the map) sends you back to the start
    reach: { target: () => 2, valid: (o) => typeof o.map === "string" && o.from && o.to && [o.from.x, o.from.y, o.from.r, o.to.x, o.to.y, o.to.r].every(Number.isFinite) },
};

let defs = [];
let st = loadState();
let api = null, fieldEnc = null, challengeBusy = false;
let variants = {};
let mapNames = {};
let lastMap = null, lastX = 0, lastY = 0;
let panel = null, toastEl = null, toastTimer = 0, resetArmed = 0;

function freshState() { return { v: 1, active: {}, done: {} }; }
function loadState() {
    try {
        const j = JSON.parse(localStorage.getItem(KEY) || "null");
        if (j && j.v === 1 && j.active && j.done) return j;
    } catch { /* fall through to a fresh state */ }
    return freshState();
}
function saveState() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private window: progress lasts for the session */ } }

const enabled = () => !!(fx && fx.quests);
const atGiver = (d) => !d.acceptAt || (lastMap != null && d.acceptAt.some((m) => sameMapId(m, lastMap)));
function sameMapId(a, b) { return canon(a) === canon(b); }
const canon = (id) => variants[id] ?? id;
const sameMap = (a, b) => canon(a) === canon(b);
const mapLabel = (id) => (mapNames[id] ?? mapNames[canon(id)] ?? id).replace(/^.*— /, "");

function validate(d) {
    if (!d || typeof d.id !== "string" || !Array.isArray(d.objectives) || !d.objectives.length) return "needs an id and objectives";
    for (const o of d.objectives) { const t = OBJECTIVES[o.type]; if (!t || !t.valid(o)) return `bad objective ${JSON.stringify(o)}`; }
    return null;
}

// ------------------------------------------------------------ quest state
const targetOf = (d, i) => OBJECTIVES[d.objectives[i].type].target(d.objectives[i]);
const defOf = (id) => defs.find((d) => d.id === id);
function isReady(id) {
    const a = st.active[id], d = defOf(id);
    return !!(a && d && d.objectives.every((_, i) => (a.p[i] || 0) >= targetOf(d, i)));
}
function statusOf(d) {
    if (st.done[d.id]) return "done";
    if (st.active[d.id]) return isReady(d.id) ? "ready" : "active";
    if (d.requires?.done && !st.done[d.requires.done]) return "locked";
    if (d.requires?.flag != null && api?.readFlag?.(d.requires.flag) !== 1) return "locked";   // read-only: needs a story beat
    return "available";
}

function accept(id) {
    const d = defOf(id);
    if (!enabled() || !d || statusOf(d) !== "available" || !atGiver(d)) return false;
    st.active[id] = { p: d.objectives.map(() => 0), seen: d.objectives.map(() => []), at: Date.now() };
    saveState(); toast(`Quest accepted: ${d.title}`); render();
    return true;
}

function claim(id) {
    const d = defOf(id);
    if (!enabled() || !d || statusOf(d) !== "ready") return false;
    // mark done and save FIRST, so a reload can never pay the reward twice
    delete st.active[id]; st.done[id] = Date.now(); saveState();
    const got = [];
    if (d.reward?.bits) { api.giveBits(d.reward.bits); got.push(`${d.reward.bits} BIT`); }
    for (const it of d.reward?.items ?? []) {
        if (api.giveItem(it.name, it.count ?? 1)) got.push(`${it.count ?? 1} x ${it.name}`);
        else console.warn(`[quests] reward item "${it.name}" is not in the game's item table; skipped`);
    }
    toast(`Quest complete: ${d.title}${got.length ? "  (" + got.join(", ") + ")" : ""}`); render();
    return true;
}

async function enemyParty(o) {
    if (!fieldEnc) fieldEnc = (await fetch("assets/data/field_encounters.json").then((r) => r.json())).screens;
    const party = [];
    for (const scr of o.screens ?? [o.screen]) {
        for (const p of fieldEnc[String(scr)] ?? []) {
            party.push({ name: p.name, level: p.level, hp: Math.round(p.hp * (o.hpMult ?? 1)), mp: p.mp, stat_scale: Math.round((p.stat_scale ?? 16) * ((o.scale ?? 16) / 16)) });
        }
    }
    return party;
}
const challengeIndex = (d) => d.objectives.findIndex((o, i) => o.type === "challenge" && (st.active[d.id]?.p[i] || 0) < 1);
const canBegin = (d) => !!api?.startBattle && !challengeBusy && (!d.objectives[challengeIndex(d)]?.startAt || (lastMap != null && d.objectives[challengeIndex(d)].startAt.some((m) => sameMapId(m, lastMap))));
async function beginChallenge(id) {
    const d = defOf(id), i = d ? challengeIndex(d) : -1;
    if (!enabled() || i < 0 || statusOf(d) !== "active" || !canBegin(d)) return false;
    const o = d.objectives[i];
    const party = await enemyParty(o);
    if (!party.length) { console.warn(`[quests] challenge for "${id}" has no enemies`); return false; }
    challengeBusy = true;
    if (panel) panel.hidden = true;
    const started = api.startBattle(party, {
        screenId: (o.screens ?? [o.screen])[0],
        onWin: (res) => { challengeBusy = false; if (res?.enemyFled) toast("They got away. Try again."); else { bump("challenge", (x) => x === o); } },
        onFlee: () => { challengeBusy = false; toast("You ran away. The challenge is still open."); },
        onLose: () => { challengeBusy = false; toast("You were beaten. The challenge is still open."); },
    });
    if (!started) { challengeBusy = false; toast("Not now - finish what you are doing first."); }
    return started;
}

function markVisited(mapId) {
    if (!enabled()) return;
    let changed = false;
    for (const id of Object.keys(st.active)) {
        const d = defOf(id), a = st.active[id];
        if (!d) continue;
        const wasReady = isReady(id);
        d.objectives.forEach((o, i) => {
            if (o.type !== "visitSet" || !o.maps.some((m) => sameMap(m, mapId))) return;
            a.seen = a.seen ?? d.objectives.map(() => []);
            const key = canon(mapId);
            if (a.seen[i].includes(key)) return;
            a.seen[i].push(key);
            a.p[i] = Math.min(targetOf(d, i), a.seen[i].length);
            changed = true;
        });
        if (!wasReady && isReady(id)) toast(`Quest ready to claim: ${d.title}  (F3)`);
    }
    if (changed) { saveState(); render(); }
}

function bump(type, match) {
    if (!enabled()) return;
    let changed = false;
    for (const id of Object.keys(st.active)) {
        const d = defOf(id), a = st.active[id];
        if (!d) continue;
        const wasReady = isReady(id);
        d.objectives.forEach((o, i) => {
            if (o.type !== type || !match(o)) return;
            const t = targetOf(d, i);
            if ((a.p[i] || 0) < t) { a.p[i] = (a.p[i] || 0) + 1; changed = true; }
        });
        if (!wasReady && isReady(id)) toast(`Quest ready to claim: ${d.title}  (F3)`);
    }
    if (changed) { saveState(); render(); }
}

// ------------------------------------------------------------ what the game tells us
on("cardDuelEnded", (e) => { if (e.won) bump("duelWin", () => true); });
on("battleWon", (e) => {
    for (const sp of e.enemies ?? []) bump("defeat", (o) => o.species.includes(sp) && (!o.maps || o.maps.some((m) => sameMap(m, e.mapId))));
});
const near = (p, r) => Math.hypot(lastX - p.x, lastY - p.y) <= p.r;
function resetRoutes(why, onlyMap) {
    let changed = false;
    for (const id of Object.keys(st.active)) {
        const d = defOf(id), a = st.active[id];
        if (!d) continue;
        d.objectives.forEach((o, i) => {
            if (o.type === "reach" && (a.p[i] || 0) === 1 && (!onlyMap || !sameMap(o.map, onlyMap))) { a.p[i] = 0; changed = true; toast(why); }
        });
    }
    if (changed) { saveState(); render(); }
}
on("battleStarted", (e) => { if (enabled()) resetRoutes("A fight broke out. Start the route again.", null); });
export function questsTick(mapId, x, y) {
    lastX = x ?? lastX; lastY = y ?? lastY;
    if (mapId !== lastMap) {
        lastMap = mapId;
        if (enabled()) resetRoutes("You left the route. Start it again.", mapId);   // leaving the route's map abandons it
        if (mapId) { bump("visit", (o) => sameMap(o.map, mapId)); markVisited(mapId); }
        if (panel && !panel.hidden) render();                                    // the board may now be in reach
    }
    if (!enabled() || !mapId) return;
    for (const id of Object.keys(st.active)) {
        const d = defOf(id), a = st.active[id];
        if (!d) continue;
        d.objectives.forEach((o, i) => {
            if (o.type !== "reach" || !sameMap(o.map, mapId)) return;
            const p = a.p[i] || 0;
            if (p === 0 && near(o.from, o.from.r)) { a.p[i] = 1; saveState(); toast(`Route started: ${o.startLabel ?? "go to the far gate"} - no fights!`); render(); }
            else if (p === 1 && near(o.to, o.to.r)) {
                a.p[i] = 2; saveState(); render();
                if (isReady(id)) toast(`Quest ready to claim: ${d.title}  (F3)`);
            }
        });
    }
}

// ------------------------------------------------------------ UI
function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.style.opacity = "1";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.style.opacity = "0"; }, 4200);
}
function objectiveText(d, i) {
    const o = d.objectives[i], a = st.active[d.id], p = a ? (a.p[i] || 0) : 0, t = targetOf(d, i);
    if (o.type === "defeat") return `Defeat ${o.species.join(" / ")}${o.maps ? " in " + [...new Set(o.maps.map(mapLabel))].join(" / ") : ""}  ${a ? `${p}/${t}` : `x${t}`}`;
    if (o.type === "challenge") return `${o.label ?? "Win the challenge fight"}${a ? (p >= 1 ? "  ✓" : "") : ""}`;
    if (o.type === "visitSet") return `${o.label ?? `Visit ${t} different places`}  ${a ? `${p}/${t}` : `(${t} of ${o.maps.length})`}`;
    if (o.type === "duelWin") return `Win ${t} card duel${t > 1 ? "s" : ""}  ${a ? `${p}/${t}` : `x${t}`}`;
    if (o.type === "visit") return `Visit ${mapLabel(o.map)}${a ? (p >= 1 ? "  ✓" : "") : ""}`;
    if (o.type === "reach") return `${o.label ?? `Cross ${mapLabel(o.map)} without a fight`}${a ? (p >= 2 ? "  ✓" : p === 1 ? "  (on the route - no fights!)" : "  (go to the start)") : ""}`;
    return "?";
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function card(d, status) {
    const objs = d.objectives.map((_, i) => `<li>${esc(objectiveText(d, i))}</li>`).join("");
    const here = atGiver(d);
    const cIdx = status === "active" ? challengeIndex(d) : -1;
    const cBtn = cIdx >= 0 ? (canBegin(d) ? `<button data-q="begin:${d.id}" class="go">Begin challenge (a real fight)</button>` : `<div class="qr" style="color:#c9a45a">${challengeBusy ? "Fight in progress" : d.objectives[cIdx].startAt ? "Begin it at: " + esc([...new Set(d.objectives[cIdx].startAt.map(mapLabel))].join(" / ")) : ""}</div>`) : "";
    const btn0 = status === "available" ? (here ? `<button data-q="accept:${d.id}">Accept</button>` : `<div class="qr" style="color:#c9a45a">Accept it at: ${esc([...new Set(d.acceptAt.map(mapLabel))].join(" / "))}</div>`) : status === "ready" ? `<button data-q="claim:${d.id}" class="go">Claim reward</button>` : "";
    const btn = cBtn || btn0;
    const rw = [d.reward?.bits ? `${d.reward.bits} BIT` : "", ...(d.reward?.items ?? []).map((it) => `${it.count ?? 1} x ${it.name}`)].filter(Boolean).join(", ");
    return `<div class="qc ${status}"><b>${esc(d.title)}</b><div class="qt">${esc(d.giver ?? "")}${d.giver ? " — " : ""}${esc(d.text ?? "")}</div><ul>${objs}</ul>${rw ? `<div class="qr">Reward: ${esc(rw)}</div>` : ""}${btn}</div>`;
}
function render() {
    if (!panel || panel.hidden) return;
    const by = (s) => defs.filter((d) => statusOf(d) === s);
    const sect = (title, list, st2) => (list.length ? `<h4>${title}</h4>${list.map((d) => card(d, st2)).join("")}` : "");
    const ready = by("ready"), active = by("active"), avail = by("available"), done = by("done");
    panel.innerHTML = `<h3>QUESTS <span>F3 / Esc to close</span></h3>`
        + sect("Ready to claim", ready, "ready") + sect("In progress", active, "active") + sect("Available", avail, "available") + sect("Done", done, "done")
        + (!ready.length && !active.length && !avail.length && !done.length ? `<div class="qt">No quests yet.</div>` : "")
        + `<div class="qfoot"><button data-q="reset">${resetArmed > Date.now() ? "Click again to reset ALL quest progress" : "Reset quests"}</button></div>`;
}
function togglePanel(force) {
    if (!panel || !enabled()) { if (panel) panel.hidden = true; return; }
    panel.hidden = force === undefined ? !panel.hidden : !force;
    if (!panel.hidden) render();
}

function installUi(stageEl) {
    const css = document.createElement("style");
    css.textContent = `
      #quest-panel { position:absolute; top:44px; left:8px; z-index:41; width:300px; max-height:calc(100% - 60px); overflow-y:auto;
        padding:10px 14px 12px; border:2px solid #45456a; border-radius:10px; background:#1d1d2bf2; color:#e8e8f0;
        font:13px/1.5 "Segoe UI",system-ui,sans-serif; box-shadow:0 8px 30px #000; }
      #quest-panel[hidden] { display:none; }
      #quest-panel h3 { margin:0 0 4px; font-size:13px; color:#ffd34d; letter-spacing:1px; }
      #quest-panel h3 span { color:#707090; font-size:10px; letter-spacing:0; margin-left:6px; }
      #quest-panel h4 { margin:10px 0 3px; font-size:11px; color:#8a8ab0; letter-spacing:1.5px; text-transform:uppercase; }
      #quest-panel .qc { border:1px solid #35355a; border-radius:8px; padding:6px 9px; margin:5px 0; background:#252540; }
      #quest-panel .qc.ready { border-color:#ffd34d; } #quest-panel .qc.done { opacity:.55; }
      #quest-panel .qt { color:#a8a8c8; font-size:12px; } #quest-panel ul { margin:4px 0 4px 16px; padding:0; } #quest-panel .qr { color:#9ad7a0; font-size:12px; }
      #quest-panel button { background:#2a2a40; color:#e8e8f0; border:1px solid #45456a; border-radius:4px; padding:2px 8px; font:inherit; cursor:pointer; margin-top:4px; }
      #quest-panel button.go { border-color:#ffd34d; color:#ffd34d; }
      #quest-panel .qfoot { margin-top:10px; border-top:1px solid #35355a; padding-top:4px; }
      #quest-toast { position:absolute; left:14px; bottom:22px; z-index:51; max-width:70%; padding:6px 14px; border-radius:8px; background:#000c; color:#fff; font:600 13px 'Segoe UI',system-ui,sans-serif; pointer-events:none; opacity:0; transition:opacity .3s; }`;
    document.head.appendChild(css);
    panel = document.createElement("div"); panel.id = "quest-panel"; panel.hidden = true;
    toastEl = document.createElement("div"); toastEl.id = "quest-toast";
    stageEl.append(panel, toastEl);
    panel.addEventListener("keydown", (e) => e.stopPropagation());
    panel.addEventListener("click", (e) => {
        const b = e.target.closest("[data-q]");
        if (!b) return;
        const [act, id] = b.dataset.q.split(":");
        if (act === "accept") accept(id);
        else if (act === "claim") claim(id);
        else if (act === "begin") beginChallenge(id);
        else if (act === "reset") {
            if (resetArmed > Date.now()) { st = freshState(); saveState(); resetArmed = 0; toast("Quest progress reset"); }
            else { resetArmed = Date.now() + 3500; setTimeout(render, 3600); }
            render();
        }
        b.blur();
    });
    window.addEventListener("keydown", (e) => {
        if (e.key === "F3" && !enabled()) { if (e.isTrusted) { e.preventDefault(); toast("Extra quests are off. Press F2, tick \"Extra quests\" (under Extras), then F3."); } }
        else if (e.key === "F3") { e.preventDefault(); togglePanel(); }
        else if (e.key === "Escape" && panel && !panel.hidden) { panel.hidden = true; }
    });
}

// ------------------------------------------------------------ install
export async function installQuests({ stageEl, giveItem, giveBits, startBattle, readFlag }) {
    if (!stageEl || api) return;
    api = { giveItem, giveBits, startBattle, readFlag };
    installUi(stageEl);
    try {
        const [q, v, m] = await Promise.all([
            fetch("quests.json").then((r) => r.json()),
            fetch("map-variants.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
            fetch("assets/manifest.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
        ]);
        variants = v || {};
        mapNames = Object.fromEntries((m.maps ?? []).map((x) => [x.id, x.name]));
        const seen = new Set();
        for (const d of q.quests ?? []) {
            const bad = validate(d);
            if (bad || seen.has(d.id)) { console.warn(`[quests] skipped "${d.id}": ${bad || "duplicate id"}`); continue; }
            seen.add(d.id); defs.push(d);
        }
    } catch (e) { console.warn("[quests] could not load quests.json:", e); }
    window.__quests = {   // debug / test hooks; nothing in the game reads these
        get state() { return st; }, get defs() { return defs; }, accept, claim, status: (id) => (defOf(id) ? statusOf(defOf(id)) : null),
        togglePanel, bump, beginChallenge,
        where: () => ({ lastMap, lastX, lastY, enabled: enabled() }),
    };
}
