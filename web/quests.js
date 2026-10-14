// Extra quests (new content, not part of the shipped game). On by default; F2 -> "Quests" switches them off.
// Open the log with F3 or the Quests button. Quests unlock as you play (see "unlock" below).
//
// Design rules (docs/quests-plan.md):
//   * Never writes the story: no story flags, no master story counter. Quest progress lives under its
//     own localStorage key, so the story and the normal save are valid with this layer on or off.
//   * Hears the game through gameEvents.js (battle won) and one per-frame call (stage entered); it
//     changes no game rule.
//   * Rewards go through the game's own helpers (supplied by game.js), and are paid once: the quest is
//     marked done and saved BEFORE the reward is handed over.
//   * Night / story variants of a map (map-variants.json) count as the same place.
//
// Quest definitions are data (quests.json). Objective types: "defeat" (species, count, optional maps),
// "visit" (one map), "talk" (speak to a real NPC of the game, see questTalk), and the others listed in OBJECTIVES.
// A quest may require another to be done first ({ requires: { done: id } }).
// Quests appear in the log only once they unlock: { unlock: { visited: [maps, any one], done: id, flag: n,
// duelWins: n, level: n, partner: "p008giru", met: [{ npc, map }] } }. Some quests are generated (see generateBounty) and scale with
// the party's level.
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
    // speak to one of the game's own NPCs (npc_id from the scene files), on one of the listed maps
    talk: { target: () => 1, valid: (o) => Number.isInteger(o.npc) && Array.isArray(o.maps) && o.maps.length > 0 && Array.isArray(o.lines) && o.lines.length > 0 },
    // walk from one gate to another in one go; any fight (or leaving the map) sends you back to the start
    reach: { target: () => 2, valid: (o) => typeof o.map === "string" && o.from && o.to && [o.from.x, o.from.y, o.from.r, o.to.x, o.to.y, o.to.r].every(Number.isFinite) },
};

let defs = [];
let st = loadState();
let api = null, fieldEnc = null, challengeBusy = false;
let variants = {};
let mapNames = {};
let lastMap = null, lastX = 0, lastY = 0;
let panel = null, toastEl = null, toastTimer = 0, resetArmed = 0, btn = null;

function freshState() { return { v: 1, active: {}, done: {}, visited: [], met: [], duelWins: 0, announced: {}, seen: {}, gen: { n: 0, def: null } }; }
function loadState() {
    try {
        const j = JSON.parse(localStorage.getItem(KEY) || "null");
        if (j && j.v === 1 && j.active && j.done) {      // older saves lack the newer fields
            j.visited ??= []; j.met ??= []; j.duelWins ??= 0; j.announced ??= {}; j.seen ??= {}; j.gen ??= { n: 0, def: null };
            return j;
        }
    } catch { /* fall through to a fresh state */ }
    return freshState();
}
function saveState() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private window: progress lasts for the session */ } }

const enabled = () => !fx || fx.quests !== false;
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
const allDefs = () => (st.gen.def ? [...defs, st.gen.def] : defs);
const defOf = (id) => allDefs().find((d) => d.id === id);
function isReady(id) {
    const a = st.active[id], d = defOf(id);
    return !!(a && d && d.objectives.every((_, i) => (a.p[i] || 0) >= targetOf(d, i)));
}
const hasVisited = (maps) => maps.some((m) => st.visited.includes(canon(m)));
function unlocked(d) {
    if (d.requires?.done && !st.done[d.requires.done]) return false;
    if (d.requires?.flag != null && api?.readFlag?.(d.requires.flag) !== 1) return false;   // read-only: needs a story beat
    const u = d.unlock;
    if (!u) return true;
    if (u.visited && !hasVisited(u.visited)) return false;
    if (u.done && !st.done[u.done]) return false;
    if (u.flag != null && api?.readFlag?.(u.flag) !== 1) return false;
    if (u.duelWins && st.duelWins < u.duelWins) return false;
    if (u.level && (api?.partyLevel?.() ?? 1) < u.level) return false;
    if (u.partner && !(api?.partnerIds?.() ?? []).includes(u.partner)) return false;
    if (u.met && !u.met.every((r) => st.met.includes(`${r.npc}@${canon(r.map)}`))) return false;      // "you have seen this character there"
    return true;
}
function statusOf(d) {
    if (st.done[d.id]) return "done";
    if (st.active[d.id]) return isReady(d.id) ? "ready" : "active";
    return unlocked(d) ? "available" : "locked";
}
// tell the player once when something new opens up
function announceUnlocks() {
    let changed = false;
    for (const d of allDefs()) {
        if (st.announced[d.id] || statusOf(d) !== "available") continue;
        st.announced[d.id] = 1; changed = true;
        toast(`New quest: ${d.title}`);
    }
    if (changed) { saveState(); render(); updateButton(); }
}

const placesOf = (maps) => [...new Set(maps.map(mapLabel))].join(" / ");
const turnInRef = (d) => d.turnIn ?? d.offer ?? null;      // the NPC a finished quest is reported to, if any
function accept(id, viaNpc = false) {
    const d = defOf(id);
    if (!enabled() || !d || statusOf(d) !== "available" || !atGiver(d)) return false;
    if (d.offer && !viaNpc) return false;                    // this one is handed out by a character, not by the log
    st.active[id] = { p: d.objectives.map(() => 0), seen: d.objectives.map(() => []), at: Date.now() };
    saveState(); toast(`Quest accepted: ${d.title}`); render();
    return true;
}

function claim(id, viaNpc = false) {
    const d = defOf(id);
    if (!enabled() || !d || statusOf(d) !== "ready") return false;
    if (turnInRef(d) && !viaNpc) return false;               // report to the character instead
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
on("cardDuelEnded", (e) => { if (e.won) { st.duelWins += 1; saveState(); bump("duelWin", () => true); announceUnlocks(); } });
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
// A quest about a character unlocks once you have actually seen that character where the quest says (story-gated
// characters only appear at certain points of the story, so the quest waits for you to meet them).
let metTick = 0;
function scanMet(mapId) {
    if (!api?.npcsHere || !mapId) return;
    const here = api.npcsHere();
    if (!here.length) return;
    let changed = false;
    for (const d of allDefs()) {
        for (const r of d.unlock?.met ?? []) {
            const key = `${r.npc}@${canon(r.map)}`;
            if (sameMap(r.map, mapId) && here.includes(r.npc) && !st.met.includes(key)) { st.met.push(key); changed = true; }
        }
    }
    if (changed) { saveState(); announceUnlocks(); }
}
export function questsTick(mapId, x, y) {
    lastX = x ?? lastX; lastY = y ?? lastY;
    if (++metTick % 45 === 0) scanMet(mapId);
    if (mapId !== lastMap) {
        lastMap = mapId;
        if (enabled()) resetRoutes("You left the route. Start it again.", mapId);   // leaving the route's map abandons it
        if (mapId) {
            const key = canon(mapId);
            if (!st.visited.includes(key)) { st.visited.push(key); saveState(); }
            bump("visit", (o) => sameMap(o.map, mapId)); markVisited(mapId);
            ensureGenerated(); announceUnlocks();
        }
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

// ------------------------------------------------------------ talking to the game's own characters
// game.js calls questTalk() when you press confirm on an NPC, AFTER the game's own story check, so a quest can never
// replace a story scene: if the story or a scripted battle takes the conversation, this is never reached.
let dlg = null, dialogBusy = false;
const declined = new Set();                                  // offers you said "not now" to, until you reload
function say(name, lines, choices) {
    return new Promise((resolve) => {
        dialogBusy = true;
        const cv = document.getElementById("game"), sr = dlg.parentElement.getBoundingClientRect();
        if (cv) { const r = cv.getBoundingClientRect(); Object.assign(dlg.style, { left: `${r.left - sr.left + 8}px`, right: "auto", width: `${r.width - 16}px`, bottom: `${sr.bottom - r.bottom + 8}px` }); }   // over the game picture, not the whole page
        let i = 0, sel = 0;
        const draw = () => {
            const last = i >= lines.length - 1;
            dlg.hidden = false;
            dlg.innerHTML = `<div class="dn">${esc(name)}</div><div class="dtx">${esc(lines[i])}</div>`
                + (last && choices ? `<div class="dc">${choices.map((c, k) => `<button data-c="${k}" class="${k === sel ? "sel" : ""}">${esc(c)}</button>`).join("")}</div>` : `<div class="dh">Enter &#9660;</div>`);
        };
        const close = (v) => { window.removeEventListener("keydown", onKey, true); dlg.removeEventListener("click", onClick); dlg.hidden = true; dialogBusy = false; resolve(v); };
        const advance = () => { if (i < lines.length - 1) { i++; draw(); } else close(choices ? sel : 0); };
        const onKey = (e) => {
            if (/^F\d+$/.test(e.key)) return;
            e.stopImmediatePropagation(); e.preventDefault();         // the game must not also act on this key
            if (e.repeat) return;
            const last = i >= lines.length - 1;
            if (e.key === "Enter" || e.key === " " || e.key === "z" || e.key === "Z") advance();
            else if (e.key === "Escape") close(choices ? choices.length - 1 : 0);
            else if (last && choices && /^Arrow(Left|Up)$/.test(e.key)) { sel = Math.max(0, sel - 1); draw(); }
            else if (last && choices && /^Arrow(Right|Down)$/.test(e.key)) { sel = Math.min(choices.length - 1, sel + 1); draw(); }
        };
        const onClick = (e) => { const b = e.target.closest("[data-c]"); if (b) close(+b.dataset.c); else advance(); };
        window.addEventListener("keydown", onKey, true);           // capture: ahead of the game's own key handler
        dlg.addEventListener("click", onClick);
        draw();
    });
}
const atNpc = (ref, npcId, mapId) => ref && ref.npc === npcId && ref.maps.some((m) => sameMap(m, mapId));
const talksDone = (d, a, upTo) => d.objectives.slice(0, upTo).every((_, j) => (a.p[j] || 0) >= targetOf(d, j));

/** Returns true when a quest took this conversation (the game then skips the character's normal line). */
export function questTalk(npcId, mapId) {
    if (!enabled() || dialogBusy || !dlg || !mapId) return false;
    // 1. a "talk" step of a running quest
    for (const id of Object.keys(st.active)) {
        const d = defOf(id), a = st.active[id];
        if (!d) continue;
        for (let i = 0; i < d.objectives.length; i++) {
            const o = d.objectives[i];
            if (o.type !== "talk" || (a.p[i] || 0) >= 1 || !atNpc(o, npcId, mapId)) continue;
            if (d.ordered && !talksDone(d, a, i)) continue;
            (async () => {
                await say(o.name ?? "", o.lines);
                const was = isReady(id);
                a.p[i] = 1; saveState(); render(); updateButton();
                if (!was && isReady(id)) toast(`Quest ready: ${d.title}${turnInRef(d) ? "" : "  (F3)"}`);
            })();
            return true;
        }
    }
    // 2. reporting a finished quest
    for (const id of Object.keys(st.active)) {
        const d = defOf(id), ref = d && turnInRef(d);
        if (!d || !isReady(id) || !atNpc(ref, npcId, mapId)) continue;
        (async () => { await say(ref.name, ref.doneLines ?? ["Well done. Here is your reward."]); claim(id, true); updateButton(); })();
        return true;
    }
    // 3. an offer
    for (const d of allDefs()) {
        if (statusOf(d) !== "available" || !d.offer || declined.has(d.id) || !atNpc(d.offer, npcId, mapId)) continue;
        (async () => {
            const pick = await say(d.offer.name, d.offer.lines, ["I will do it", "Not now"]);
            if (pick === 0) { accept(d.id, true); } else declined.add(d.id);
            updateButton();
        })();
        return true;
    }
    return false;
}

// ------------------------------------------------------------ generated bounties (they scale with the party)
let roam = null;                                             // stage id -> [{ name, screen, level }] wild single enemies met while walking
async function loadRoam() {
    try {
        if (!fieldEnc) fieldEnc = (await fetch("assets/data/field_encounters.json").then((r) => r.json())).screens;
        const se = (await fetch("assets/data/stage_encounters.json").then((r) => r.json())).stages;
        roam = {};
        for (const [stage, v] of Object.entries(se)) {
            for (const z of v.zones ?? []) {
                if (!((z.rate_level ?? 0) > 0)) continue;
                for (const scr of z.slots ?? []) {
                    const party = scr ? fieldEnc[String(scr)] : null;
                    if (!party || party.length !== 1) continue;
                    const list = (roam["s" + stage] ??= []);
                    if (!list.some((e) => e.name === party[0].name)) list.push({ name: party[0].name, screen: scr, level: party[0].level });
                }
            }
        }
    } catch (e) { console.warn("[quests] bounty tables unavailable:", e); roam = null; }
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round10 = (v) => Math.round(v / 10) * 10;
/** Pure: builds the next wanted-board job from where you have been and how strong your party is. */
export function generateBounty(visited, level, n, table) {
    const places = visited.filter((m) => table[m] && table[m].length);
    if (places.length < 2) return null;                       // there must be somewhere to hunt
    const rand = rng(Math.imul(n + 1, 2654435761) ^ Math.imul(visited.length, 40503) ^ 0x9e3779b1);
    const map = places[Math.floor(rand() * places.length)];
    const e = table[map][Math.floor(rand() * table[map].length)];
    const L = Math.max(1, level | 0), elite = (n + 1) % 3 === 0;      // every third job is an elite hunt: one real, stronger fight
    const count = clamp(2 + Math.floor(L / 7) + Math.floor(rand() * 2), 2, 9);
    const tier = L >= 35 ? ["Super Charge"] : L >= 20 ? ["Life Disk", "Power Charge"] : L >= 9 ? ["Energy Disk", "Revive Disk", "Sober Disk"] : ["Antidote Disk", "Energy Disk"];
    const item = tier[Math.floor(rand() * tier.length)];
    const where = mapLabel(map);
    if (elite) {
        return {
            id: "", title: `Elite hunt: ${e.name}`, giver: "Wanted board", generated: true, text: `A ${e.name} near ${where} has grown far stronger than the rest. Take it on.`,
            objectives: [{ type: "challenge", screen: e.screen, scale: 16 + clamp(Math.floor(L / 5), 1, 10), hpMult: Math.round((1 + clamp(L / 50, 0, 1)) * 100) / 100, startAt: [map], label: `Beat the stronger ${e.name}` }],
            reward: { bits: clamp(round10((90 + 16 * L) * 4), 300, 6000), items: [{ name: item, count: 1 }] },
        };
    }
    return {
        id: "", title: `Wanted: ${e.name}`, giver: "Wanted board", generated: true, text: `${e.name} keep turning up around ${where}. Thin them out.`,
        objectives: [{ type: "defeat", species: [e.name], count, maps: [map] }],
        reward: { bits: clamp(round10((60 + 12 * L) * count), 120, 5000), items: L >= 6 ? [{ name: item, count: 1 }] : [] },
    };
}
function ensureGenerated() {
    if (!roam || !enabled()) return;
    const cur = st.gen.def;
    if (cur && !st.done[cur.id]) return;                      // the current job is still open
    if (cur) { st.gen.completed = (st.gen.completed || 0) + 1; delete st.done[cur.id]; }
    const d = generateBounty(st.visited, api?.partyLevel?.() ?? 1, st.gen.n, roam);
    if (!d) { st.gen.def = null; return; }
    st.gen.n += 1; d.id = `gen_${st.gen.n}`; st.gen.def = d;
    const bad = validate(d); if (bad) { console.warn("[quests] generated job rejected:", bad); st.gen.def = null; return; }
    saveState();
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
    if (o.type === "talk") return `${o.label ?? `Talk to ${o.name ?? "someone"} in ${placesOf(o.maps)}`}${a ? (p >= 1 ? "  ✓" : "") : ""}`;
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
    const hint = (t) => `<div class="qr" style="color:#c9a45a">${t}</div>`;
    const ref = turnInRef(d);
    const btn0 = status === "available"
        ? (d.offer ? hint(`Talk to ${esc(d.offer.name)} in ${esc(placesOf(d.offer.maps))}`) : here ? `<button data-q="accept:${d.id}">Accept</button>` : hint(`Accept it at: ${esc(placesOf(d.acceptAt))}`))
        : status === "ready" ? (ref ? hint(`Report to ${esc(ref.name)} in ${esc(placesOf(ref.maps))}`) : `<button data-q="claim:${d.id}" class="go">Claim reward</button>`) : "";
    const btn = cBtn || btn0;
    const rw = [d.reward?.bits ? `${d.reward.bits} BIT` : "", ...(d.reward?.items ?? []).map((it) => `${it.count ?? 1} x ${it.name}`)].filter(Boolean).join(", ");
    return `<div class="qc ${status}"><b>${esc(d.title)}</b><div class="qt">${esc(d.giver ?? "")}${d.giver ? " — " : ""}${esc(d.text ?? "")}</div><ul>${objs}</ul>${rw ? `<div class="qr">Reward: ${esc(rw)}</div>` : ""}${btn}</div>`;
}
function updateButton() {
    if (!btn) return;
    const ready = allDefs().filter((d) => statusOf(d) === "ready").length;
    const fresh = allDefs().filter((d) => statusOf(d) === "available" && !st.seen[d.id]).length;
    const n = ready + fresh;
    btn.innerHTML = `Quests${n ? ` <i>${n}</i>` : ""}`;
    btn.hidden = !enabled();
}
function render() {
    if (!panel || panel.hidden) return;
    for (const d of allDefs()) if (statusOf(d) === "available" && !st.seen[d.id]) { st.seen[d.id] = 1; }
    saveState();
    const by = (s) => allDefs().filter((d) => statusOf(d) === s);
    const sect = (title, list, st2) => (list.length ? `<h4>${title}</h4>${list.map((d) => card(d, st2)).join("")}` : "");
    const ready = by("ready"), active = by("active"), avail = by("available"), done = by("done");
    panel.innerHTML = `<h3>QUESTS <span>F3 / Esc to close</span></h3>`
        + sect("Ready to claim", ready, "ready") + sect("In progress", active, "active") + sect("Available", avail, "available") + sect("Done", done, "done")
        + (!ready.length && !active.length && !avail.length && !done.length ? `<div class="qt">No quests yet. Explore, fight and talk to people: quests unlock as you play.</div>` : "")
        + (st.gen.completed ? `<div class="qt" style="margin-top:8px">Wanted-board jobs completed: ${st.gen.completed}</div>` : "")
        + `<div class="qfoot"><button data-q="reset">${resetArmed > Date.now() ? "Click again to reset ALL quest progress" : "Reset quests"}</button></div>`;
}
function togglePanel(force) {
    if (!panel || !enabled()) { if (panel) panel.hidden = true; return; }
    panel.hidden = force === undefined ? !panel.hidden : !force;
    if (!panel.hidden) render();
    updateButton();
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
      #quest-btn { position:absolute; top:8px; right:8px; z-index:40; padding:3px 10px; border:1px solid #45456a; border-radius:6px; background:#1d1d2bd9; color:#e8e8f0; font:600 12px "Segoe UI",system-ui,sans-serif; cursor:pointer; }
      #quest-btn i { font-style:normal; background:#ffd34d; color:#1d1d2b; border-radius:8px; padding:0 6px; margin-left:3px; }
      #quest-btn[hidden] { display:none; }
      #quest-dlg { box-sizing:border-box; position:absolute; left:12px; right:12px; bottom:12px; z-index:60; padding:10px 16px 12px; border:2px solid #ffd34d; border-radius:10px; background:#101020f5; color:#f0f0f8; font:15px/1.5 "Segoe UI",system-ui,sans-serif; cursor:pointer; }
      #quest-dlg[hidden] { display:none; } #quest-dlg .dn { color:#ffd34d; font-weight:700; font-size:13px; letter-spacing:1px; } #quest-dlg .dh { text-align:right; color:#8a8aa8; font-size:11px; }
      #quest-dlg .dc { display:flex; gap:10px; margin-top:6px; } #quest-dlg .dc button { background:#2a2a40; color:#e8e8f0; border:1px solid #45456a; border-radius:4px; padding:3px 14px; font:inherit; cursor:pointer; } #quest-dlg .dc button.sel { border-color:#ffd34d; color:#ffd34d; }
      #quest-toast { position:absolute; left:14px; bottom:22px; z-index:51; max-width:70%; padding:6px 14px; border-radius:8px; background:#000c; color:#fff; font:600 13px 'Segoe UI',system-ui,sans-serif; pointer-events:none; opacity:0; transition:opacity .3s; }`;
    document.head.appendChild(css);
    panel = document.createElement("div"); panel.id = "quest-panel"; panel.hidden = true;
    toastEl = document.createElement("div"); toastEl.id = "quest-toast";
    btn = document.createElement("button"); btn.id = "quest-btn"; btn.type = "button"; btn.textContent = "Quests";
    btn.addEventListener("click", () => { togglePanel(); btn.blur(); });
    btn.addEventListener("keydown", (e) => e.stopPropagation());
    dlg = document.createElement("div"); dlg.id = "quest-dlg"; dlg.hidden = true;
    stageEl.append(panel, toastEl, btn, dlg);
    panel.addEventListener("keydown", (e) => e.stopPropagation());
    panel.addEventListener("click", (e) => {
        const b = e.target.closest("[data-q]");
        if (!b) return;
        const [act, id] = b.dataset.q.split(":");
        if (act === "accept") accept(id);
        else if (act === "claim") claim(id);
        else if (act === "begin") beginChallenge(id);
        else if (act === "reset") {
            if (resetArmed > Date.now()) { st = { ...freshState(), visited: st.visited, duelWins: st.duelWins }; saveState(); resetArmed = 0; toast("Quest progress reset"); ensureGenerated(); announceUnlocks(); }
            else { resetArmed = Date.now() + 3500; setTimeout(render, 3600); }
            render();
        }
        b.blur();
    });
    window.addEventListener("keydown", (e) => {
        if (e.key === "F3" && !enabled()) { if (e.isTrusted) { e.preventDefault(); toast("Quests are switched off. Press F2 and tick \"Quests\" (under Extras)."); } }
        else if (e.key === "F3") { e.preventDefault(); togglePanel(); }
        else if (e.key === "Escape" && panel && !panel.hidden) { panel.hidden = true; }
    });
}

// ------------------------------------------------------------ install
export async function installQuests({ stageEl, giveItem, giveBits, startBattle, readFlag, partyLevel, partnerIds, npcsHere }) {
    if (!stageEl || api) return;
    api = { giveItem, giveBits, startBattle, readFlag, partyLevel, partnerIds, npcsHere };
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
    await loadRoam();
    ensureGenerated(); announceUnlocks(); updateButton();
    window.__quests = {   // debug / test hooks; nothing in the game reads these
        get state() { return st; }, get defs() { return defs; }, accept, claim, status: (id) => (defOf(id) ? statusOf(defOf(id)) : null),
        togglePanel, bump, beginChallenge, questTalk, save: saveState, generateBounty, ensureGenerated, announceUnlocks, get roam() { return roam; },
        where: () => ({ lastMap, lastX, lastY, enabled: enabled() }),
    };
}
