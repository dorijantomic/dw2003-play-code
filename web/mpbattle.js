// EXPERIMENT: many-vs-many fights for multiplayer (not original game content).
//
// The game's own battle is one Digimon against one enemy and stays exactly that for single player. This is an EXTENSION that
// multiplayer uses instead: two or more players fight two or more enemies at once, each controlling their own lead Digimon.
//   - the PICTURE is the game's own 3D battle renderer (web/battle3d.js), extended to hold any number of fighters in one arena:
//     the same arena, models, attack animations, effects, projectiles and special-attack backdrops;
//   - the RULES are the game's own decoded battle routines, run for any number of fighters by web/mpbattle-rules.js: its action
//     timeline, enemy AI, damage / accuracy / critical rolls, status effects, heals and buffs, items, running away, its
//     battle strings and the EXP / BIT payout. Nothing is re-invented where the game has a rule.
// One player's game (the one that started the fight) is the REFEREE: it holds every fighter's record, runs the rules, and sends
// everyone the same small snapshot after each action. The other players send only their choices (Fight / Tech / Item / Run and a
// target) and see the result. Spread techniques (strong magic) hit everyone on the other side at 65% damage; a fight with many
// enemies is fought in waves of at most max(2, players).
// Each player brings their party (up to three Digimon) and can Tag: swap the one in the fight; a fallen Digimon is replaced from
// the reserves. Every Digimon has its own DV gauge that fills from the hits it takes; a full gauge is the automatic Blast. A steal
// technique that lands takes the enemy's drop item.
// The menus are the game's OWN translated screens (command list, TECH, ITEM, Digivolve, TAG) and its message window, opened over
// the 3D scene (web/mpbattle-menus.js). If WebGL is not available the fight falls back to plain cards and buttons.
// Nothing here writes a story flag.
import { createBattle3D, resolveModelFolder } from "./battle3d.js";
import { drawEffects } from "./fight/effect-player.js";
import { Arena, isSpread, T, plainLine } from "./mpbattle-rules.js";
import { ITEM_BY_ID } from "./vendor/engine.js";
import { createMenus } from "./mpbattle-menus.js";
import { battleAilmentByte } from "./battlecmd-translated.js";
import { asButton } from "./input.js";

const TURN_MS = 45000;              // how long a player may think
const MIN_ANIM_MS = 900;            // the shortest pause after an action
const MAX_ANIM_MS = 7000;           // the longest the referee waits for the attack animation to finish
const READY_MS = 25000;             // how long the referee waits for the others to get into the fight (the battle-start transition plays first)
const LANE = 1900;                  // sideways distance between two fighters of one side, in the game's own arena units
const LOG_LINES = 5;

let A = null;       // what the game gives us (see installMpBattle)
let F = null;       // the fight I am in, or null

export const mpbActive = () => !!F;
/** True while the fight screen is up (also during its result page). */
export const mpbVisible = () => !!F || (!!A?.ui && A.ui.root.style.display === "flex");

// ------------------------------------------------------------ the screen
const css = `
#mpb { position:absolute; inset:0; z-index:70; display:none; flex-direction:column; color:#fff; font:13px/1.35 system-ui,sans-serif;
  background:radial-gradient(ellipse at 50% 30%, #1d2b63 0%, #0b0f2c 70%); user-select:none; overflow:hidden; }
#mpb canvas.view { display:none; position:absolute; inset:0; width:100%; height:100%; }
#mpb .top { padding:8px 14px; display:flex; justify-content:space-between; font:bold 14px monospace; background:rgba(0,0,0,.35); }
#mpb .row { flex:1; display:flex; gap:14px; justify-content:center; align-items:center; padding:6px 14px; flex-wrap:wrap; }
#mpb .vs { text-align:center; font:bold 12px monospace; color:#8a94d6; letter-spacing:6px; padding:0; }
#mpb .card { position:relative; width:190px; padding:8px 10px; border:2px solid #45509a; border-radius:10px; background:rgba(20,26,70,.85); transition:transform .15s, border-color .15s, opacity .3s; }
#mpb .card.foe { border-color:#a84a5a; background:rgba(60,20,36,.85); }
#mpb .card.act, #mpb .plate.act { border-color:#ffd34d; box-shadow:0 0 14px #ffd34d88; }
#mpb .card.act { transform:translateY(-4px); }
#mpb .card.me .nm, #mpb .plate.me .nm { color:#7dffa0; }
#mpb .card.ko, #mpb .plate.ko { opacity:.35; filter:grayscale(1); }
#mpb .card.pick, #mpb .plate.pick { cursor:pointer; border-color:#fff; } #mpb .card.pick:hover, #mpb .plate.pick:hover { background:rgba(120,40,60,.95); }
#mpb .pic { float:left; width:38px; height:38px; margin-right:8px; border-radius:50%; font:bold 20px/38px monospace; text-align:center; text-shadow:0 1px 2px #000; border:2px solid #fff6; }
#mpb .nm { font-weight:bold; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } #mpb .sub { color:#aab3e8; font-size:11px; }
#mpb .bar { clear:both; height:7px; margin-top:5px; background:#0009; border-radius:4px; overflow:hidden; } #mpb .bar i { display:block; height:100%; transition:width .5s; }
#mpb .bar.hp i { background:#5fe07f; } #mpb .bar.mp i { background:#58a8ff; } #mpb .bar.foe i { background:#ff7a5f; }
#mpb .num { font:10px monospace; color:#cfd6ff; } #mpb .ail { color:#ffb347; font:bold 10px monospace; margin-left:4px; }
#mpb .float { position:absolute; left:50%; top:0; font:bold 24px monospace; pointer-events:none; text-shadow:0 2px 3px #000; animation:mpbfloat 1.1s ease-out forwards; z-index:3; }
@keyframes mpbfloat { from { transform:translate(-50%,0); opacity:1; } to { transform:translate(-50%,-46px); opacity:0; } }
#mpb .log { padding:6px 14px; min-height:68px; background:rgba(0,0,0,.4); font:12px/1.5 monospace; }
#mpb .log div:last-child { color:#ffe9a0; }
#mpb .bar2 { padding:8px 14px; min-height:46px; background:rgba(0,0,0,.55); display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
#mpb .bar2 button { background:#2f3d9a; color:#fff; border:2px solid #8a98ff; border-radius:6px; padding:6px 16px; font:bold 13px monospace; cursor:pointer; }
#mpb .bar2 button:hover { background:#4a5cd0; } #mpb .bar2 button:disabled { opacity:.4; cursor:default; }
#mpb .bar2 .hint { color:#cfd6ff; font:12px monospace; }
#mpb .end { position:absolute; inset:0; z-index:5; display:flex; flex-direction:column; gap:10px; align-items:center; justify-content:center; background:rgba(5,8,30,.72); }
#mpb .end h2 { margin:0; font:bold 38px monospace; letter-spacing:4px; text-shadow:0 3px 6px #000; } #mpb .end .sm { color:#e4e8ff; font:14px monospace; text-shadow:0 2px 3px #000; }
/* 3D mode: the scene fills the screen; plates float over the fighters; the log and the buttons sit on top of it */
#mpb.d3 .row, #mpb.d3 .vs { display:none; }
#mpb.d3 canvas.view { display:block; }
#mpb.d3 .top { position:absolute; top:0; left:0; right:0; z-index:2; background:linear-gradient(rgba(0,0,0,.6), transparent); }
#mpb.d3 .log { position:absolute; left:0; bottom:52px; width:52%; min-height:0; z-index:2; background:linear-gradient(to right, rgba(0,0,0,.6), transparent); }
#mpb.d3 .bar2 { position:absolute; left:0; right:0; bottom:0; z-index:2; background:linear-gradient(transparent, rgba(0,0,0,.75) 55%); }
#mpb .plates { display:none; position:absolute; inset:0; z-index:1; pointer-events:none; }
#mpb.d3 .plates { display:block; }
#mpb .plate { position:absolute; width:132px; padding:3px 6px 4px; border:2px solid #45509a; border-radius:8px; transform:translate(-50%,-100%); pointer-events:auto; background:rgba(8,12,40,.72); }
#mpb .plate .pic { display:none; } #mpb .plate .nm { font-size:12px; } #mpb .plate .sub { font-size:10px; } #mpb .plate .bar { margin-top:3px; height:6px; }
#mpb .plate.foe { background:rgba(50,14,28,.74); border-color:#a84a5a; }
#mpb .bar.dv { height:4px; margin-top:2px; } #mpb .bar.dv i { background:#e8c14a; }
#mpb .blast .bar.dv i { background:#ff5ad0; } #mpb .blast .sub { color:#ff9de6; }
#mpb .plate.cur, #mpb .card.cur { border-color:#ffd34d; box-shadow:0 0 16px #ffd34d; background:rgba(150,60,40,.95); }
#mpb canvas { border:0; border-radius:0; max-width:none; max-height:none; }
#mpb canvas.ui2d { display:none; position:absolute; inset:0; width:100%; height:100%; z-index:3; pointer-events:none; image-rendering:auto; background:transparent; }
#mpb.nat canvas.ui2d { display:block; }
#mpb.nat .log, #mpb.nat .bar2 { display:none; }
#mpb .pad { display:none; position:absolute; top:36px; right:8px; z-index:4; gap:4px; flex-wrap:wrap; width:176px; justify-content:flex-end; }
#mpb.nat .pad.on { display:flex; }
#mpb .pad button { width:36px; height:30px; background:rgba(15,25,90,.8); color:#fff; border:2px solid #8a98ff; border-radius:6px; font:bold 13px monospace; cursor:pointer; padding:0; }
#mpb .pad button:hover { background:#4a5cd0; }
`;

function buildUi() {
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const root = document.createElement("div"); root.id = "mpb";
    const view = document.createElement("canvas"); view.className = "view";
    const top = document.createElement("div"); top.className = "top";
    const title = document.createElement("span"), status = document.createElement("span");
    top.append(title, status);
    const foes = document.createElement("div"); foes.className = "row";
    const vs = document.createElement("div"); vs.className = "vs"; vs.textContent = "VS";
    const mine = document.createElement("div"); mine.className = "row";
    const plates = document.createElement("div"); plates.className = "plates";
    const log = document.createElement("div"); log.className = "log";
    const bar = document.createElement("div"); bar.className = "bar2";
    const ui2d = document.createElement("canvas"); ui2d.className = "ui2d";
    const pad = document.createElement("div"); pad.className = "pad";
    for (const [label, btn] of [["▲", "up"], ["▼", "down"], ["◀", "left"], ["▶", "right"], ["L1", "l1"], ["R1", "r1"], ["○", "circle"], ["✕", "cross"]]) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.dataset.btn = btn;
        b.addEventListener("click", () => mpbKey(btn)); pad.append(b);
    }
    root.append(view, plates, top, foes, vs, mine, log, bar, ui2d, pad);
    A.stageEl.append(root);
    return { root, view, plates, title, status, foes, mine, log, bar, ui2d, pad, cards: new Map(), plateMap: new Map(), endEl: null, nat: null };
}

const hue = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function makeCard(key, foe, small = false) {
    const root = mk("div", (small ? "plate " : "card ") + (foe ? "foe" : ""));
    const pic = mk("div", "pic"), nm = mk("div", "nm"), sub = mk("div", "sub");
    const hp = mk("div", "bar " + (foe ? "foe" : "hp")), hpi = mk("i"); hp.append(hpi);
    const hpn = mk("div", "num"), ail = mk("span", "ail");
    hpn.append(ail);
    root.append(pic, nm, sub, hp, hpn);
    let mpi = null, dvi = null;
    if (!foe) {
        const mp = mk("div", "bar mp"); mpi = mk("i"); mp.append(mpi); root.append(mp);
        const dv = mk("div", "bar dv"); dvi = mk("i"); dv.append(dvi); root.append(dv);          // this Digimon's own DV gauge
    }
    root.addEventListener("click", () => onPick(key));
    return { key, root, pic, nm, sub, hpi, hpn, ail, mpi, dvi, last: null };
}

function updateCard(c, o, foe) {
    c.pic.textContent = (o.n || "?")[0].toUpperCase();
    c.pic.style.background = `hsl(${hue(o.n)} 55% 38%)`;
    c.nm.textContent = foe ? o.n : `${o.pn}`;
    c.sub.textContent = foe ? `Lv ${o.lv}` : `${o.n}  Lv ${o.lv}${o.bl ? "  BLAST" : ""}`;
    if (c.dvi) { c.dvi.style.width = Math.max(0, Math.min(100, (o.dv | 0) / 10)) + "%"; c.root.classList.toggle("blast", !!o.bl); }
    c.hpi.style.width = Math.max(0, Math.min(100, (o.hp / Math.max(1, o.mhp)) * 100)) + "%";
    c.hpn.firstChild.textContent = foe ? `HP ${o.hp}/${o.mhp}` : `HP ${o.hp}/${o.mhp}   MP ${o.mp}/${o.mmp}`;
    c.ail.textContent = o.ail?.length ? o.ail.join(" ") : "";
    if (c.mpi) c.mpi.style.width = Math.max(0, Math.min(100, (o.mp / Math.max(1, o.mmp)) * 100)) + "%";
    c.root.classList.toggle("ko", !!o.ko);
    if (c.last != null && o.hp !== c.last) {
        const d = o.hp - c.last;
        const f = mk("div", "float", d < 0 ? String(d) : "+" + d);
        f.style.color = d < 0 ? "#ff6a6a" : "#7dffa0";
        c.root.append(f); f.addEventListener("animationend", () => f.remove());
    }
    c.last = o.hp;
}

// ------------------------------------------------------------ the 3D scene
async function makeScene() {
    const U = F.ui;
    if (typeof OffscreenCanvas === "undefined") return false;
    const w = Math.max(320, U.view.clientWidth || 640), h = Math.max(240, U.view.clientHeight || 480);
    U.off = new OffscreenCanvas(w, h);
    let r3d = null;
    try { r3d = createBattle3D(U.off, A.sfx ?? null); } catch (e) { console.warn("[mpbattle] no 3D renderer", e); }
    if (!r3d) { U.off = null; return false; }
    r3d.setPlayerVisible?.(false); r3d.setEnemyVisible?.(false);        // the two built-in fighters stay out; everybody is an extra
    try { r3d.setArenaStage?.(A.mapId?.() ?? null, F.screenId ?? null); } catch { /* the plain arena is fine */ }
    U.r3d = r3d; F.r3d = r3d;
    U.root.classList.add("d3");
    try {                                                   // the game's own menu screens and message window go over the scene
        U.nat = F.nat = createMenus({ sfx: A.sfx ?? null, languageByte: () => (A.languageByte ? A.languageByte() : 2) });
        U.root.classList.add("nat");
    } catch (e) { console.warn("[mpbattle] no native menus, using buttons", e); U.nat = F.nat = null; }
    U.ctx = U.view.getContext("2d");
    U.last = performance.now();
    const loop = (t) => {
        if (!U.r3d) return;
        const dt = Math.min(0.05, (t - U.last) / 1000); U.last = t;
        const cw = U.view.clientWidth, ch = U.view.clientHeight;
        if (cw && ch && (U.view.width !== cw || U.view.height !== ch)) { U.view.width = cw; U.view.height = ch; U.off.width = cw; U.off.height = ch; }
        try {
            U.r3d.render(dt);
            const ctx = U.ctx;
            ctx.drawImage(U.off, 0, 0, cw, ch);
            const fx = U.r3d.getEffectDraw?.();                       // op3 sprite effects, composited over the 3D frame
            if (fx) { ctx.save(); ctx.scale(cw / U.off.width, ch / U.off.height); drawEffects(ctx, fx.list, fx.manifest, fx.images, fx.view); ctx.restore(); }
            const overlay = U.r3d.getScreenOverlay?.();
            if (overlay) { ctx.save(); ctx.globalAlpha = overlay.alpha; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); ctx.restore(); }
            placePlates(cw, ch);
            if (U.nat) {
                if (U.ui2d.width !== cw || U.ui2d.height !== ch) { U.ui2d.width = cw; U.ui2d.height = ch; }
                if (F) driveNative(dt); else U.nat.update(dt);
                const g = U.ui2d.getContext("2d");
                g.clearRect(0, 0, cw, ch);
                U.nat.draw(g, cw, ch);
            }
        } catch (e) { console.warn("[mpbattle] frame failed", e); }
        U.raf = requestAnimationFrame(loop);
    };
    U.raf = requestAnimationFrame(loop);
    return true;
}

function endScene(U) {
    cancelAnimationFrame(U.raf); U.raf = 0;
    try { U.r3d?.destroy?.(); } catch { /* already gone */ }
    U.r3d = null; U.off = null;
    try { U.nat?.close(); } catch { /* gone */ }
    U.nat = null; U.pad.classList.remove("on");
    U.root.classList.remove("d3", "nat");
    for (const c of U.plateMap.values()) c.root.remove();
    U.plateMap.clear();
}

function placePlates(cw, ch) {
    const U = A.ui; if (!U?.r3d) return;
    const placed = [], rows = [];
    for (const [key, c] of U.plateMap) {
        const p = U.r3d.getFighterScreen(key);
        if (!p) { c.root.style.display = "none"; continue; }
        c.root.style.display = "";
        rows.push({ c, x: Math.round(p.x * cw), y: Math.round(Math.max(60, p.topY * ch - 6)) });
    }
    // plates of fighters standing close would sit on top of each other: lift the lower one clear of the plates already placed
    rows.sort((a, b) => a.y - b.y);
    for (const r of rows) {
        for (let guard = 0; guard < 6; guard++) {
            const hit = placed.find((q) => Math.abs(q.x - r.x) < 138 && Math.abs(q.y - r.y) < 52);
            if (!hit) break;
            r.y = hit.y - 54;
        }
        r.y = Math.max(40, r.y);
        placed.push(r);
        r.c.root.style.left = r.x + "px"; r.c.root.style.top = r.y + "px";
    }
}

/** Keep the 3D arena in step with the shared state: who is standing where, who is hurt, and what just happened. */
function syncScene() {
    const U = F.ui, S = F.S, r = F.r3d;
    if (!r || !S) return;
    const laneOf = (i, n) => (i - (n - 1) / 2) * LANE;
    S.P.forEach((p, i) => {                                          // players: placed once, in the order the referee lists them
        const key = "p" + p.id;
        if (F.placed.has(key) && F.modelName.get(key) !== p.n) {         // it digivolved: the new form's model takes its place
            F.modelName.set(key, p.n);
            resolveModelFolder(p.n).then((folder) => { if (folder && F && F.r3d === r) r.addFighter(key, "player", folder, laneOf(i, S.P.length)); });
        }
        if (!F.placed.has(key)) {
            F.modelName.set(key, p.n);
            F.placed.add(key);
            resolveModelFolder(p.n).then((folder) => { if (folder && F && F.r3d === r) r.addFighter(key, "player", folder, laneOf(i, S.P.length)); });
            const c = makeCard(key, false, true); U.plateMap.set(key, c); U.plates.append(c.root);
        }
    });
    const waveKey = S.E.map((e) => e.i).join(",");                   // the current wave of enemies (rebuilt when the wave changes)
    if (F.waveKey !== waveKey) {
        F.waveKey = waveKey;
        r.clearFighters("enemy");
        for (const [k, c] of [...U.plateMap]) if (k[0] === "e") { c.root.remove(); U.plateMap.delete(k); F.placed.delete(k); }
        S.E.forEach((e, i) => {
            const key = "e" + e.i;
            F.placed.add(key);
            resolveModelFolder(e.n).then((folder) => { if (folder && F && F.r3d === r) r.addFighter(key, "enemy", folder, laneOf(i, S.E.length)); });
            const c = makeCard(key, true, true); U.plateMap.set(key, c); U.plates.append(c.root);
        });
    }
    r.setMultiCamera(true);
    for (const e of S.E) { const c = U.plateMap.get("e" + e.i); if (c) updateCard(c, e, true); r.setFighterHurt("e" + e.i, e.hp / Math.max(1, e.mhp) < 0.25); }
    for (const p of S.P) {
        const c = U.plateMap.get("p" + p.id);
        if (c) { updateCard(c, p, false); c.root.classList.toggle("me", p.id === A.myId()); }
        r.setFighterHurt("p" + p.id, p.hp / Math.max(1, p.mhp) < 0.25 && !p.ko);
    }
    // an action just happened: play it with the game's own animation, on every screen
    const ev = S.ev;
    if (ev && ev.q !== F.lastEv) {
        F.lastEv = ev.q;
        if (ev.kind === "atk") {
            const [first, ...rest] = ev.d;
            if (first) {
                r.fighterAttack(ev.a, first[0], ev.sk, { lethal: !!first[3], miss: !first[2] });
                for (const t of rest) setTimeout(() => { if (F && F.r3d === r) r.fighterReact(t[0], { lethal: !!t[3], miss: !t[2] }); }, 650);
            }
        } else if (ev.kind === "self") r.fighterTech(ev.a, ev.sk);       // a heal or a buff: its own motion, no one is hit
        else if (ev.kind === "item") r.fighterAction(ev.a, 10);           // the item-use motion (clip 10), as in the one-on-one battle
        // (a digivolve needs no motion of its own here: the new form's model is put in place above)
        if (ev.kind !== "atk") for (const t of ev.d) if (t[3]) r.fighterReact(t[0], { lethal: true });
    }
    if (S.ph === "won" && !F.cheered) { F.cheered = true; for (const p of S.P) if (!p.ko) r.fighterVictory("p" + p.id); }
}

// ------------------------------------------------------------ the view of the shared state S (same on every screen)
function render() {
    const U = F?.ui; if (!U) return;
    const S = F.S;
    if (!S) { U.title.textContent = F.label || "Fight"; U.status.textContent = "Waiting for everyone to get ready..."; return; }
    const mine = S.P.find((p) => p.id === A.myId());
    if (mine) {
        if (!F.isHost && mine.pt) mine.pt.forEach((q, i) => { const r = F.party[i]?.rec; if (r) { r.hp = q.hp; r.mp = q.mp; r.gauge = q.dv; } });   // the referee's numbers are the true ones
        const key = `${mine.ac | 0}|${mine.n}|${mine.bl | 0}`;
        if (F.mineKey !== key) {                                             // I digivolved, tagged or blasted: my record and technique list follow
            F.mineKey = key; F.act = mine.ac | 0; (F.took ??= new Set()).add(F.act);
            F.me = F.party[F.act]?.rec ?? F.me;
            if (!F.isHost && F.me.profile?.name !== mine.n) F.kit.setFormByName(F.me, mine.n);
            F.techs = F.kit.myTechs(F.me, !!mine.bl);
        }
    }
    const ev = S.ev;
    if (ev && ev.q !== F.lastStealQ) {                                       // what I stole goes into my bag
        F.lastStealQ = ev.q;
        if (ev.st && ev.a === "p" + A.myId()) { try { F.kit.giveItem(ev.st); } catch (e) { console.warn("[mpbattle] steal", e); } }
    }
    U.title.textContent = `${F.label || "Fight"}   ·   round ${S.r}${F.waves > 1 ? `   ·   wave ${S.w + 1}/${F.waves}` : ""}`;
    if (F.r3d) syncScene();
    else renderCards(U, S);
    for (const [k, c] of F.r3d ? U.plateMap : U.cards) {
        const t = S.t;
        c.root.classList.toggle("act", !!t && t === k);
    }
    U.log.replaceChildren(...S.g.map((l) => mk("div", "", l)));
    if (F.nat && S.lq !== F.lastLq) {                                       // the latest action, through the game's own message window
        F.lastLq = S.lq;
        if (!(F.cmd?.stage === "target")) F.nat.say(S.ln ?? []);
    }
    const t = S.t;
    const who = !t ? "" : t[0] === "e" ? (S.E.find((e) => "e" + e.i === t)?.n ?? "Enemy") : (S.P.find((p) => "p" + p.id === t)?.pn ?? "Player");
    U.status.textContent = S.ph !== "play" ? "" : t === "p" + A.myId() ? "YOUR TURN" : t ? `${who}'s turn` : "";
    renderCmd();
}

// the fallback when there is no WebGL: plain cards
function renderCards(U, S) {
    const foeKeys = S.E.map((e) => "e" + e.i).join(",");
    if (U.foeKeys !== foeKeys) {
        for (const [k, c] of [...U.cards]) if (k[0] === "e") { c.root.remove(); U.cards.delete(k); }
        for (const e of S.E) { const c = makeCard("e" + e.i, true); U.cards.set(c.key, c); U.foes.append(c.root); }
        U.foeKeys = foeKeys;
    }
    for (const e of S.E) updateCard(U.cards.get("e" + e.i), e, true);
    for (const p of S.P) {
        let c = U.cards.get("p" + p.id);
        if (!c) { c = makeCard("p" + p.id, false); U.cards.set(c.key, c); U.mine.append(c.root); }
        updateCard(c, p, false);
        c.root.classList.toggle("me", p.id === A.myId());
    }
}

// ------------------------------------------------------------ my turn: the command menu
const itemTargets = (item) => {
    if (!item) return { allies: true, foes: false };
    if (["hp", "mp", "full_hp"].includes(item.effect) && !(item.id >= 66 && item.id <= 90)) return { allies: true, foes: false };
    return item.id >= 85 && item.id !== 84 ? { allies: false, foes: true } : { allies: true, foes: false };
};

function renderCmd() {
    const U = F?.ui; if (!U) return;
    const S = F.S, bar = U.bar;
    bar.replaceChildren();
    for (const c of [...U.cards.values(), ...U.plateMap.values()]) c.root.classList.remove("pick", "cur");
    if (F.nat) {                                                  // the game's own screens draw the menus; here only the target marks
        const cmd = F.cmd;
        if (cmd?.stage === "target") {
            cmd.options.forEach((key, i) => { const r = (U.plateMap.get(key) ?? U.cards.get(key))?.root; if (r) { r.classList.add("pick"); if (i === cmd.cur) r.classList.add("cur"); } });
        }
        return;
    }
    const myKey = "p" + A.myId();
    const mineTurn = S && S.ph === "play" && S.t === myKey && F.me.hp > 0 && !F.iFled;
    if (!mineTurn) {
        F.cmd = null;
        bar.append(mk("span", "hint", F.iFled ? "You ran away. Watching the rest of the fight." : S?.ph === "play" ? "Waiting..." : ""));
        return;
    }
    const btn = (label, fn, disabled) => { const b = mk("button", "", label); b.type = "button"; b.disabled = !!disabled; b.onclick = fn; bar.append(b); return b; };
    if (!F.cmd) F.cmd = { stage: "menu" };
    const cmd = F.cmd;
    const back = () => btn("Back", () => { F.cmd = { stage: "menu" }; renderCmd(); });
    if (cmd.stage === "menu") {
        btn("Fight", () => askTarget({ foes: true }, (t) => send({ k: "fight", t: Number(t.slice(1)) }), "Pick a target"));
        btn("Tech", () => { F.cmd = { stage: "tech" }; renderCmd(); }, !F.techs.length);
        btn("Item", () => { F.items = F.kit.items(); F.cmd = { stage: "item" }; renderCmd(); }, !F.kit.items().length);
        const forms = F.kit.forms(F.me);
        if (forms.length) btn("Digivolve", () => { F.cmd = { stage: "dv" }; renderCmd(); }, !!F.me.cantDigivolve);
        if (F.party.length > 1) btn("Tag", () => { F.cmd = { stage: "tag" }; renderCmd(); }, !F.party.some((m, i) => i !== F.act && m.rec.hp > 0));
        btn("Run", () => { F.cmd = { stage: "run" }; renderCmd(); });
        bar.append(mk("span", "hint", `HP ${F.me.hp}/${F.me.maxHp}   MP ${F.me.mp}/${F.me.maxMp}`));
    } else if (cmd.stage === "run") {
        bar.append(mk("span", "hint", "Try to run away?"));
        btn("Yes, run", () => send({ k: "run" }));
        btn("No", () => { F.cmd = { stage: "menu" }; renderCmd(); });
    } else if (cmd.stage === "tech") {
        for (const t of F.techs) {
            const spread = t.type === "attack" && isSpread(t.skill), ok = F.me.mp >= t.cost;
            btn(`${t.name}  (${t.cost} MP)${spread ? "  [all]" : t.type !== "attack" ? "  [support]" : ""}`, () => {
                if (spread) send({ k: "tech", sk: t.id, tw: t.tw, t: -1 });
                else if (t.type === "attack") askTarget({ foes: true }, (k) => send({ k: "tech", sk: t.id, tw: t.tw, t: Number(k.slice(1)) }), `Pick a target for ${t.name}`);
                else askTarget({ allies: true, foes: true }, (k) => send({ k: "tech", sk: t.id, tw: t.tw, t: k[0] === "e" ? Number(k.slice(1)) : k }), `Pick a target for ${t.name}`);
            }, !ok);
        }
        back();
    } else if (cmd.stage === "dv") {
        for (const f of F.kit.forms(F.me)) btn(f.name, () => send({ k: "dv", form: f.id }));
        back();
    } else if (cmd.stage === "tag") {
        F.party.forEach((m, i) => { if (i !== F.act) btn(`${m.rec.profile?.name ?? "?"}  HP ${Math.max(0, m.rec.hp | 0)}/${m.rec.maxHp | 0}`, () => send({ k: "tag", slot: i }), m.rec.hp <= 0); });
        if (!F.S?.ft) back();
    } else if (cmd.stage === "item") {
        for (const it of F.items) {
            btn(`${it.name}  x${it.qty}`, () => {
                const tg = itemTargets(ITEM_BY_ID[it.id] ?? it);
                askTarget({ ...tg, revive: it.id === 70 || it.id === 67 }, (k) => { send({ k: "item", item: it.id, to: k[0] === "p" ? k : myKey, t: k[0] === "e" ? Number(k.slice(1)) : -1 }); F.kit.spendItem(it.id); }, `Use ${it.name} on...`);
            });
        }
        back();
    } else if (cmd.stage === "target") {
        bar.append(mk("span", "hint", cmd.label));
        for (const key of cmd.options) (U.plateMap.get(key) ?? U.cards.get(key))?.root.classList.add("pick");
        back();
    }
}

/** Ask for a target on the screen: { foes, allies } say which plates may be picked. Only one choice? it is taken for me. */
function askTarget(spec, done, label) {
    const options = [];
    if (spec.allies) for (const p of F.S.P) if (!p.ko || spec.revive) options.push("p" + p.id);
    if (spec.foes) for (const e of F.S.E) if (!e.ko) options.push("e" + e.i);
    if (!options.length) return;
    if (options.length === 1) return done(options[0]);
    F.cmd = { stage: "target", options, done, label, cur: Math.max(0, options.findIndex((k) => k[0] === "e")) };
    if (F.nat) { F.nat.close(); F.nat.say([label ?? "Choose a target."], { hold: true }); }
    renderCmd();
}
function onPick(key) {
    if (!F || F.cmd?.stage !== "target" || !F.cmd.options.includes(key)) return;
    const done = F.cmd.done;
    F.cmd = null;
    if (F.nat) F.nat.clearSay();
    done(key);
}

/** A pad button (keyboard, the on-screen pad, a gamepad): it drives the game's menu, or moves the target mark. */
function mpbKey(btn) {
    if (!F?.nat || !btn) return;
    const cmd = F.cmd;
    if (cmd?.stage === "target") {
        const n = cmd.options.length;
        if (btn === "left" || btn === "up") { cmd.cur = (cmd.cur + n - 1) % n; A.sfx?.play?.("system07"); }
        else if (btn === "right" || btn === "down") { cmd.cur = (cmd.cur + 1) % n; A.sfx?.play?.("system07"); }
        else if (btn === "circle") { A.sfx?.play?.("system08"); const done = cmd.done, k = cmd.options[cmd.cur]; F.cmd = null; F.nat.clearSay(); done(k); }
        else if (btn === "cross" || btn === "triangle") { A.sfx?.play?.("system02"); F.cmd = null; F.nat.clearSay(); }
        renderCmd();
        return;
    }
    F.nat.press(btn);
}

/** My turn, through the game's own screens: the command list, then TECH / ITEM / Digivolve / TAG, then a target. */
function driveNative(dt) {
    const N = F.nat, S = F.S;
    const myId = A.myId(), myKey = "p" + myId;
    const mine = S?.P.find((p) => p.id === myId);
    const forced = !!(S && S.ft && S.t === myKey);
    const mineTurn = !!(S && S.ph === "play" && S.t === myKey && !F.iFled && mine && (forced || !mine.ko));
    F.ui.pad.classList.toggle("on", mineTurn);
    if (!mineTurn) { if (N.mode) N.close(); if (F.cmd) { F.cmd = null; renderCmd(); } N.update(dt); return; }
    if (N.busy() && !F.cmd) { N.update(dt); return; }                // let the last action's lines finish in the window first
    if (!F.cmd) { F.cmd = { stage: forced ? "tag" : "menu" }; renderCmd(); }
    const stage = F.cmd.stage;
    if (stage === "target") { N.update(dt); return; }
    if (stage === "notice") { N.update(dt); if (!N.busy()) F.cmd = { stage: "menu" }; return; }
    const wm = { menu: "cmd", tech: "tech", item: "item", dv: "form", tag: "tag" }[stage];
    if (!wm) return;
    if (N.mode !== wm) {
        if (stage === "menu") N.open("cmd", { row: F.cmdRow | 0, activeIndex: 0, ailmentBits: battleAilmentByte(F.me) });
        else if (stage === "tech") N.open("tech", F.kit.techSeed(F.me, !!mine.bl));
        else if (stage === "item") N.open("item", F.kit.itemSeed());
        else if (stage === "dv") N.open("form", F.kit.formSeed(F.me, F.party[F.act].member));
        else if (stage === "tag") {
            const seed = F.kit.tagSeed(F.party.map((m) => m.member), F.party.map((m) => m.rec), F.act);
            seed.interactive = forced ? 0 : 1;
            if (forced) seed.cursorRow = Math.max(0, F.party.findIndex((m, i) => i !== F.act && m.rec.hp > 0));
            N.open("tag", seed);
        }
    }
    const res = N.update(dt);
    if (res) onNativeResult(res, forced, mine);
}

function notice(text) { F.nat.say([text], { ms: 1100 }); F.cmd = { stage: "notice" }; }

function onNativeResult(res, forced, mine) {
    if (res.failed) { console.warn("[mpbattle] a native screen failed; using buttons"); F.ui.nat = null; F.nat = null; F.ui.root.classList.remove("nat"); F.cmd = null; renderCmd(); return; }
    const v = res.value;
    if (res.mode === "cmd") {
        F.cmdRow = v | 0;
        if (v === 0) askTarget({ foes: true }, (k) => send({ k: "fight", t: Number(k.slice(1)) }), "Choose a target.");
        else if (v === 1) { if (F.techs.length) F.cmd = { stage: "tech" }; else notice("No techs!"); }
        else if (v === 2) { if (F.kit.forms(F.me).length && !F.me.cantDigivolve) F.cmd = { stage: "dv" }; else notice("Cannot digivolve."); }
        else if (v === 3) { if (F.party.some((m, i) => i !== F.act && m.rec.hp > 0)) F.cmd = { stage: "tag" }; else notice("Cannot tag."); }
        else if (v === 4) { if (F.kit.items().length) F.cmd = { stage: "item" }; else notice("No items!"); }
        else if (v === 5) send({ k: "run" });
        else F.cmd = { stage: "menu" };
    } else if (res.mode === "tech") {
        if (v === -2) { F.cmd = { stage: "menu" }; return; }
        const t = F.techs.find((x) => (x.id | 0) === (v | 0));
        if (!t) { F.cmd = { stage: "menu" }; return; }
        const spread = t.type === "attack" && isSpread(t.skill);
        if (spread) send({ k: "tech", sk: t.id, tw: t.tw, t: -1 });
        else if (t.type === "attack") askTarget({ foes: true }, (k) => send({ k: "tech", sk: t.id, tw: t.tw, t: Number(k.slice(1)) }), `Choose a target for ${t.name}.`);
        else askTarget({ allies: true, foes: true }, (k) => send({ k: "tech", sk: t.id, tw: t.tw, t: k[0] === "e" ? Number(k.slice(1)) : k }), `Choose a target for ${t.name}.`);
    } else if (res.mode === "item") {
        if (v === -2) { F.cmd = { stage: "menu" }; return; }
        const it = F.kit.items().find((x) => (x.id | 0) === (v | 0));
        if (!it) { F.cmd = { stage: "menu" }; return; }
        const tg = itemTargets(ITEM_BY_ID[it.id] ?? it);
        askTarget({ ...tg, revive: it.id === 70 || it.id === 67 }, (k) => {
            send({ k: "item", item: it.id, to: k[0] === "p" ? k : "p" + A.myId(), t: k[0] === "e" ? Number(k.slice(1)) : -1 }); F.kit.spendItem(it.id);
        }, `Use ${it.name} on...`);
    } else if (res.mode === "form") {
        if (v === -2) { F.cmd = { stage: "menu" }; return; }
        send({ k: "dv", form: v });
    } else if (res.mode === "tag") {
        if (v === -2) { if (!forced) F.cmd = { stage: "menu" }; else F.cmd = { stage: "tag" }; return; }
        send({ k: "tag", slot: v | 0 });
    }
    void mine;
}

/** My choice for this turn goes to the referee (or is taken straight in when it is me). */
function send(c) {
    F.cmd = null;
    if (F.nat) { F.nat.close(); F.nat.clearSay(); F.cmdRow = 0; }
    const d = { k: "cmd", fid: F.fid, c };
    if (F.isHost) hostCommand(A.myId(), d); else A.send([F.hostId], d);
    renderCmd();
}

// ------------------------------------------------------------ the referee: runs the rules, tells everyone
const later = (ms, fn) => { const id = setTimeout(() => { if (F) fn(); }, ms); (F.timers ??= new Set()).add(id); return id; };
const say = (lines) => {
    const list = [].concat(lines).filter(Boolean).map((l) => String(l).slice(0, 120));
    for (const l of list) F.H.log.push(plainLine(l).slice(0, 72));
    while (F.H.log.length > LOG_LINES) F.H.log.shift();
    F.H.ln = list.slice(0, 10); F.H.lq = (F.H.lq | 0) + 1;          // the latest action's lines, for the message window
};

/** Run `fn` once the attack animation on the referee's own screen is over (and at least a moment has passed). */
function afterAnim(fn) {
    const t0 = performance.now();
    const poll = () => {
        if (!F) return;
        const waited = performance.now() - t0;
        if (waited >= MAX_ANIM_MS || (waited >= MIN_ANIM_MS && !(F.r3d && F.r3d.fightersBusy?.()))) { fn(); return; }
        later(120, poll);
    };
    later(MIN_ANIM_MS / 3, poll);
}

function snapshot(ph = "play") {
    const H = F.H, ar = H.arena;
    return {
        r: H.round, w: ar.wave, t: H.turn, ph, g: H.log.slice(), ev: H.ev ?? null, ft: H.forced ? 1 : 0, ln: H.ln ?? [], lq: H.lq | 0,
        E: ar.waveFoes().map((e) => ({ i: e.i, n: e.name, lv: e.rec.level | 0, ...ar.plate(e) })),
        P: ar.P.map((p) => ({ id: p.id, pn: p.name, n: p.rec.profile?.name ?? "?", lv: p.rec.level | 0, ...ar.plate(p), ko: p.rec.hp <= 0 || p.fled ? 1 : 0, pt: ar.partyPlate(p), ac: p.act })),
    };
}
function broadcast(ph = "play") {
    const S = snapshot(ph);
    const others = F.ids.filter((id) => id !== A.myId() && !F.H.arena.byKey("p" + id)?.fled);
    if (others.length) A.send(others, { k: "st", fid: F.fid, S });
    F.S = S; render();
}
function setEvent(res) {
    const H = F.H;
    if (!res.rows?.length && res.kind !== "self" && res.kind !== "item" && res.kind !== "dv") return;
    H.ev = { q: (H.evq = (H.evq | 0) + 1), a: res.a, sk: res.sk | 0, kind: res.kind, d: res.rows ?? [], st: res.st ?? null };
}

function hostBegin() {
    const H = F.H;
    clearTimeout(H.readyTimer);
    if (H.started) return; H.started = true;
    F.ids = F.ids.filter((id) => H.P.has(id));                // never got ready: not in the fight
    if (!H.P.size) { finish(false, { fled: true }); return; }
    const players = [...H.P.values()].map((p) => ({ id: p.id, name: p.pn, rec: p.rec, party: p.party }));
    const waveSize = Math.max(2, players.length);
    H.arena = new Arena({ kit: F.kit, players, foes: F.erec.map((rec, i) => ({ name: H.names[i], rec })), screenId: F.screenId, waveSize });
    F.waves = H.arena.waves();
    say("The fight begins!");
    A.send(F.ids.filter((id) => id !== A.myId()), { k: "go", fid: F.fid, waves: F.waves });
    broadcast();                                               // everyone sees the arena and the lineup straight away
    later(1800, nextTurn);
}

function nextTurn() {
    const H = F.H, ar = H.arena;
    clearTimeout(H.turnTimer);
    H.turn = null;
    const st = ar.state();
    if (st !== "play") { hostEnd(st); return; }
    const nx = ar.next();
    if (!nx) { hostEnd(ar.state()); return; }
    if (nx.wave != null) { say(`Next wave! (${nx.wave + 1}/${F.waves})`); broadcast(); later(1800, nextTurn); return; }
    const key = nx.key, actor = ar.byKey(key);
    if (nx.forced) {                                           // a Digimon fell and the player has others: they pick who comes in
        H.turn = key; H.forced = true;
        say(`${actor.name}: Choose the next Digimon.`);
        broadcast();
        H.turnTimer = later(TURN_MS, () => {
            const slot = actor.party.findIndex((r, i) => i !== actor.act && r.hp > 0);
            if (H.forced && H.turn === key && slot >= 0) hostCommand(Number(key.slice(1)), { fid: F.fid, c: { k: "tag", slot } });
        });
        return;
    }
    H.turns = (H.turns | 0) + 1;                               // "round" = everyone standing has had about one action
    H.round = Math.floor((H.turns - 1) / Math.max(1, ar.alivePlayers().length + ar.aliveFoes().length)) + 1;
    const ts = ar.turnStart(key);
    H.turn = key;
    if (ts.skipped) {                                          // asleep, frozen or confused: the turn is lost
        const res = { lines: ts.lines, rows: [], a: key, sk: 0, kind: "run" };
        ar.finish(key, res);
        say(res.lines); broadcast(); afterAnim(nextTurn); return;
    }
    broadcast();
    if (key[0] === "p") armTurnTimer(key, actor);
    else later(700, () => foeTurn(key));
}

function armTurnTimer(key, actor) {
    const H = F.H, ar = H.arena;
    clearTimeout(H.turnTimer);
    H.turnTimer = later(TURN_MS, () => { say(`${actor.name} took too long.`); const res = { lines: [], rows: [], a: key, sk: 0, kind: "run" }; ar.finish(key, res); say(res.lines); H.turn = null; broadcast(); later(400, nextTurn); });
}

function foeTurn(key) {
    const H = F.H, ar = H.arena;
    const res = ar.foeAction(key);
    ar.finish(key, res);
    say(res.lines); setEvent(res);
    broadcast();
    afterAnim(nextTurn);
}

/** A player's choice reached the referee. */
function hostCommand(from, d) {
    const H = F.H; if (!H?.arena) return;
    const ar = H.arena, key = "p" + from;
    if (d.fid !== F.fid || H.turn !== key) return;
    const c = d.c && typeof d.c === "object" ? d.c : {};
    const cmd = { k: String(c.k), sk: c.sk | 0, tw: c.tw | 0, item: c.item | 0, form: c.form | 0, slot: c.slot | 0, to: String(c.to ?? ""), t: typeof c.t === "string" ? c.t : (Number.isInteger(c.t) ? c.t : -1) };
    if (H.forced && cmd.k !== "tag") { armTurnTimer(key, ar.byKey(key)); return; }      // only the replacement is asked for
    clearTimeout(H.turnTimer);
    const res = ar.playerAction(key, cmd);
    if (res.refused) { say(res.lines); broadcast(); armTurnTimer(key, ar.byKey(key)); return; }   // a swap that cannot be done: ask again
    if (H.forced) {                                            // the fallen Digimon's replacement costs no turn
        ar.afterFree(res); H.forced = false; H.turn = null;
        say(res.lines); setEvent(res);
        broadcast();
        afterAnim(nextTurn);
        return;
    }
    ar.finish(key, res);
    H.turn = null;
    say(res.lines); setEvent(res);
    broadcast();
    if (res.fled) {                                            // the player got away: they leave the fight (the host keeps refereeing)
        if (from === A.myId()) F.iFled = true; else A.send([from], { k: "left", fid: F.fid });
    }
    afterAnim(nextTurn);
}

function releaseBlasts() {                                    // a Blast does not outlive the fight: its gauge is spent
    const ar = F.H.arena;
    for (const p of ar.P) for (const r of p.party) if (r.blast?.active) { r.blast = null; r.gauge = 0; }
}

function hostGone(from) {                                     // a player's connection dropped mid-fight
    const H = F.H; if (!H?.arena) return;
    const p = H.arena.byKey("p" + from); if (!p || p.fled) return;
    p.fled = true; say(`${p.name} left the fight.`);
    const wasTurn = H.turn === p.key;
    if (wasTurn) { clearTimeout(H.turnTimer); H.turn = null; }
    broadcast();
    if (wasTurn || H.arena.state() !== "play") later(MIN_ANIM_MS, nextTurn);
}

function hostEnd(state) {
    const won = state === "won";
    releaseBlasts();
    const others = F.ids.filter((id) => id !== A.myId());
    broadcast(won ? "won" : "lost");
    if (others.length) A.send(others, { k: "end", fid: F.fid, won: won ? 1 : 0, st: state });
    finish(won, { fled: state === "fled" || F.iFled });
}

// ------------------------------------------------------------ starting, joining, finishing
async function begin(setup, isHost, hostId, done) {
    if (F) return false;
    const kit = await A.getKit();
    const party = kit.party();
    const me = party[0]?.rec;
    if (!me) return false;
    const erec = isHost ? setup.foes.map((e) => kit.enemyRecord(e, setup.screenId ?? null)) : [];
    if (erec.some((r) => !r)) return false;
    if (F) return false;
    F = {
        fid: setup.fid, isHost, hostId, ids: setup.ids.slice(), names: setup.names ?? {}, foes: setup.foes, label: setup.label || "Fight",
        screenId: setup.screenId ?? null, challenge: setup.ch ?? null, kit, me, party, act: 0, erec, techs: kit.myTechs(me), items: [], done, S: null, cmd: null, waves: 1, nat: null,
        snap: A.snapshot(), timers: new Set(), ui: null, H: null, r3d: null, placed: new Set(), modelName: new Map(), waveKey: null, lastEv: null, cheered: false, iFled: false,
    };
    const U = F.ui = A.ui ?? (A.ui = buildUi());
    U.cards.clear(); U.foes.replaceChildren(); U.mine.replaceChildren(); U.foeKeys = ""; U.bar.replaceChildren(); U.log.replaceChildren(); U.plateMap.clear(); U.plates.replaceChildren();
    if (U.endEl) { U.endEl.remove(); U.endEl = null; }
    U.root.style.display = "flex";
    A.releaseKeys();
    try {                                                      // the battle track (and the field's back afterwards)
        F.prevTrack = A.bgm?.current;
        const track = kit.musicFor(F.screenId, A.mapId?.() ?? null);
        if (track && A.bgm) A.bgm.play(track);
    } catch { /* silence is fine */ }
    const mePublic = { id: A.myId(), pn: A.myName(), n: me.profile?.name ?? "?", lv: me.level | 0 };
    if (!isHost) {                                           // the referee needs my fighter records before anything else: the scene can load after
        for (let i = 1; i < party.length; i++) A.send([hostId], { k: "res", fid: F.fid, i, rec: kit.pack(party[i].rec) });   // my reserves first (in order)
        A.send([hostId], { k: "ready", fid: F.fid, p: { ...mePublic, rec: kit.pack(me) } });
    }
    await makeScene();                                       // (falls back to plain cards without WebGL)
    if (!F) return true;
    if (isHost) {
        F.H = {
            P: new Map([[mePublic.id, { ...mePublic, rec: me, party: party.map((m) => m.rec) }]]), names: erec.map((r) => r.eStats?.digimon_id ?? r.profile?.name ?? "?"),
            arena: null, round: 0, turn: null, log: ["Waiting for everyone..."], started: false, res: new Map(),
        };
        A.send(F.ids.filter((id) => id !== mePublic.id), { k: "setup", fid: F.fid, foes: F.foes, ids: F.ids, names: F.names, label: F.label, screenId: F.screenId, ch: F.challenge });
        F.H.readyTimer = setTimeout(() => { if (F) hostBegin(); }, READY_MS);
        if (F.H.P.size >= F.ids.length) hostBegin();
    }
    render();
    return true;
}

/** Start a fight as the referee. ids = everyone in it (me first). done({won, fled, reward}) runs when it is over. */
export function mpbHost({ foes, ids, label, screenId, challenge, done }) {
    const names = Object.fromEntries(ids.map((id) => [id, A.nameOf(id)]));
    return begin({ fid: (Date.now() % 1000000000) + Math.floor(Math.random() * 1000), foes, ids, names, label, screenId, ch: challenge }, true, A.myId(), done);
}

/** Messages of a fight from the relay. */
export function mpbMessage(from, d) {
    if (!d || typeof d !== "object") return;
    if (d.k === "setup") {
        if (F || !A.canJoin()) { A.send([from], { k: "decline", fid: d.fid }); return; }
        begin({ fid: d.fid, foes: d.foes, ids: d.ids, names: d.names, label: d.label, screenId: d.screenId, ch: d.ch }, false, from, A.joinDone(d))
            .then((ok) => { if (!ok) A.send([from], { k: "decline", fid: d.fid }); });
        return;
    }
    if (!F || d.fid !== F.fid) return;
    if (F.isHost) {
        if (!F.ids.includes(from)) return;
        if (d.k === "ready" && d.p && !F.H.started && d.p.rec && typeof d.p.rec === "object") {
            const p = d.p;
            const reserves = F.H.res.get(from) ?? [];
            F.H.P.set(from, { id: from, pn: String(p.pn ?? "?").slice(0, 12), n: String(p.n ?? "?").slice(0, 14), lv: Math.max(1, Math.min(99, p.lv | 0)), rec: p.rec, party: [p.rec, ...reserves.filter(Boolean)] });
            if (F.H.P.size >= F.ids.length) hostBegin();
        } else if (d.k === "res" && d.rec && typeof d.rec === "object" && !F.H.started) {
            const list = F.H.res.get(from) ?? [];
            const i = Math.max(1, Math.min(2, d.i | 0));
            list[i - 1] = d.rec; F.H.res.set(from, list);
        } else if (d.k === "decline") { F.ids = F.ids.filter((x) => x !== from); if (F.H.P.size >= F.ids.length) hostBegin(); }
        else if (d.k === "cmd") hostCommand(from, d);
    } else if (from === F.hostId) {
        if (d.k === "go") F.waves = Math.max(1, Math.min(20, d.waves | 0));
        else if (d.k === "st") { F.S = d.S; render(); }
        else if (d.k === "left") finish(false, { fled: true });
        else if (d.k === "end") finish(!!d.won, { fled: d.st === "fled" });
    }
}

/** Someone left the room mid-fight. */
export function mpbPeerGone(id) {
    if (!F) return;
    if (!F.isHost && id === F.hostId) { finish(false, { fled: true, hostLeft: true }); return; }
    if (F.isHost && F.H?.arena) hostGone(id);
    if (F.isHost && F.H && !F.H.started) { F.ids = F.ids.filter((x) => x !== id); if (F.H.P.size >= F.ids.length) hostBegin(); }
}

function finish(won, { fled = false, hostLeft = false } = {}) {
    const f = F; if (!f) return;
    for (const t of f.timers ?? []) clearTimeout(t);
    clearTimeout(f.H?.readyTimer); clearTimeout(f.H?.turnTimer);
    F = null;                                   // from here on the fight is over; the screen stays up for the result
    fled = fled || f.iFled;
    let reward = null, report = null, committed = false;
    if (won && !fled) {
        for (const m of f.party) f.kit.commit(m.rec);          // everyone in my party, as the fight left them (HP, MP, DV gauge)
        committed = true;
        const took = [...(f.took ?? [0])].filter((i) => f.party[i]);
        report = f.kit.winReport?.({ screenId: f.screenId, party: f.party, took }) ?? null;   // the disc's payout for each Digimon that fought
        reward = report?.reward ?? f.kit.applyWin({ screenId: f.screenId, participants: f.ids.length });
    }
    if (!won && !fled) A.restore(f.snap);       // a lost optional fight costs nothing
    else if (!committed) for (const m of f.party) f.kit.commit(m.rec);
    try { if (f.prevTrack && A.bgm) A.bgm.play(f.prevTrack); } catch { /* ignore */ }
    const U = f.ui;
    const close = () => {
        endScene(U);
        U.root.style.display = "none"; if (U.endEl) { U.endEl.remove(); U.endEl = null; }
        A.releaseKeys();
        try { f.done?.({ won, fled, reward }); } catch (e) { console.warn("[mpbattle] done failed", e); }
    };
    if (hostLeft || (fled && !f.isHost)) { close(); return; }
    if (fled && f.iFled && f.isHost) { close(); return; }
    // let the last hit and the victory (or defeat) pose play before the result page covers the scene
    setTimeout(() => {
        if (!U.root || U.root.style.display !== "flex") return;
        if (won && report && A.openReport) {      // the game's own post-battle screen, full frame, for each player
            U.root.style.display = "none";
            let opened = false;
            try { opened = A.openReport(report.b, () => { report.save?.(); close(); }) === true; } catch (e) { console.warn("[mpbattle] report", e); }
            if (opened) return;
            U.root.style.display = "flex";
        }
        const end = mk("div", "end");
        const h2 = mk("h2", "", won ? "VICTORY!" : fled ? "FIGHT OVER" : "DEFEATED");
        h2.style.color = won ? "#ffd34d" : "#ff7a7a";
        end.append(h2);
        if (won && reward) {
            end.append(mk("div", "sm", `+${reward.xp} EXP   +${reward.bits} BIT`));
            if (reward.to > reward.from) end.append(mk("div", "sm", `Your ${f.me.profile?.name ?? "Digimon"} reached Lv ${reward.to}!`));
        } else if (!won) end.append(mk("div", "sm", "Nothing was lost."));
        const b = mk("button", "", "Continue"); b.type = "button";
        b.style.cssText = "background:#2f3d9a;color:#fff;border:2px solid #8a98ff;border-radius:6px;padding:8px 24px;font:bold 15px monospace;cursor:pointer";
        b.onclick = close; end.append(b);
        U.root.append(end); U.endEl = end;
    }, won ? 2800 : 1600);
}

// ------------------------------------------------------------ install
/**
 * api: { stageEl, getKit(), myId(), myName(), nameOf(id), send(ids, d), releaseKeys(), snapshot(), restore(snap),
 *        canJoin(), joinDone(setup) -> done fn, sfx, bgm, mapId() }
 */
export function installMpBattle(api) {
    A = api;
    // while a fight is up, no key reaches the game (the character must not walk off)
    window.addEventListener("keydown", (e) => {
        if (!F && !(A.ui && A.ui.root.style.display === "flex")) return;
        if (/^F\d+$/.test(e.key)) return;
        A.releaseKeys(); e.stopImmediatePropagation();
        if (F?.nat) { const b = asButton(e.key); if (b) { e.preventDefault(); mpbKey(b); } }      // the game's own menus take the pad buttons
    }, true);
    window.addEventListener("keyup", (e) => { if (F || (A.ui && A.ui.root.style.display === "flex")) e.stopImmediatePropagation(); }, true);
    window.__mpb = { get fight() { return F; }, isSpread, host: mpbHost, T, Arena, key: mpbKey };   // (for tests and the console)
}
