import { registerPixelScreen } from "../gpu-pixel-filter.js";
import { createBattle3D, resolveModelFolder } from "../battle3d.js";
import { createMenus } from "../mpbattle-menus.js";
import { drawEffects } from "../fight/effect-player.js";
import { pzText } from "../mpbattle-pause.js";
import { LANE, driveNative, mpbKey, onPick, renderCmd } from "./command.js";
import { MB } from "./state.js";

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

export function buildUi() {
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const root = document.createElement("div"); root.id = "mpb";
    // battle-fs: the stage rule for a window-fill / fullscreen canvas (width:auto) must not size the fight canvases,
    // or on a wide window they keep their first backing width and the scene fills only part of the screen
    const view = document.createElement("canvas"); view.className = "view battle-fs";
    const top = document.createElement("div"); top.className = "top";
    const title = document.createElement("span"), status = document.createElement("span");
    top.append(title, status);
    const foes = document.createElement("div"); foes.className = "row";
    const vs = document.createElement("div"); vs.className = "vs"; vs.textContent = "VS";
    const mine = document.createElement("div"); mine.className = "row";
    const plates = document.createElement("div"); plates.className = "plates";
    const log = document.createElement("div"); log.className = "log";
    const bar = document.createElement("div"); bar.className = "bar2";
    const ui2d = document.createElement("canvas"); ui2d.className = "ui2d battle-fs";
    registerPixelScreen(ui2d);                              // HD Remaster: the menus drawn from their sharp 4x copy
    const pad = document.createElement("div"); pad.className = "pad";
    for (const [label, btn] of [["▲", "up"], ["▼", "down"], ["◀", "left"], ["▶", "right"], ["L1", "l1"], ["R1", "r1"], ["○", "circle"], ["✕", "cross"]]) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.dataset.btn = btn;
        b.addEventListener("click", () => mpbKey(btn)); pad.append(b);
    }
    root.append(view, plates, top, foes, vs, mine, log, bar, ui2d, pad);
    MB.A.stageEl.append(root);
    return { root, view, plates, title, status, foes, mine, log, bar, ui2d, pad, cards: new Map(), plateMap: new Map(), endEl: null, nat: null };
}

const hue = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };

export const mk = (tag, cls?: any, text?: any) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function makeCard(key: string, foe: boolean, small = false) {
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

function updateCard(c, o, foe: boolean) {
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
export async function makeScene() {
    const U = MB.F.ui;
    if (typeof OffscreenCanvas === "undefined") return false;
    const w = Math.max(320, U.view.clientWidth || 640), h = Math.max(240, U.view.clientHeight || 480);
    U.off = new OffscreenCanvas(w, h);
    let r3d = null;
    try { r3d = createBattle3D(U.off, MB.A.sfx ?? null); } catch (e) { console.warn("[mpbattle] no 3D renderer", e); }
    if (!r3d) { U.off = null; return false; }
    r3d.setPlayerVisible?.(false); r3d.setEnemyVisible?.(false);        // the two built-in fighters stay out; everybody is an extra
    try { r3d.setArenaStage?.(MB.A.mapId?.() ?? null, MB.F.screenId ?? null); } catch { /* the plain arena is fine */ }
    U.r3d = r3d; MB.F.r3d = r3d;
    U.root.classList.add("d3");
    try {                                                   // the game's own menu screens and message window go over the scene
        U.nat = MB.F.nat = createMenus({ sfx: MB.A.sfx ?? null, languageByte: () => (MB.A.languageByte ? MB.A.languageByte() : 2) });
        U.root.classList.add("nat");
    } catch (e) { console.warn("[mpbattle] no native menus, using buttons", e); U.nat = MB.F.nat = null; }
    U.ctx = U.view.getContext("2d");
    U.last = performance.now();
    const loop = (t: number) => {
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
                if (MB.F) driveNative(dt); else U.nat.update(dt);
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

export function endScene(U) {
    cancelAnimationFrame(U.raf); U.raf = 0;
    try { U.r3d?.destroy?.(); } catch { /* already gone */ }
    U.r3d = null; U.off = null;
    try { U.nat?.close(); } catch { /* gone */ }
    U.nat = null; U.pad.classList.remove("on");
    U.root.classList.remove("d3", "nat");
    for (const c of U.plateMap.values()) c.root.remove();
    U.plateMap.clear();
}

function placePlates(cw: number, ch: number) {
    const U = MB.A.ui; if (!U?.r3d) return;
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
    const U = MB.F.ui, S = MB.F.S, r = MB.F.r3d;
    if (!r || !S) return;
    const laneOf = (i: number, n: number) => (i - (n - 1) / 2) * LANE;
    S.P.forEach((p, i: number) => {                                          // players: placed once, in the order the referee lists them
        const key = "p" + p.id;
        if (MB.F.placed.has(key) && MB.F.modelName.get(key) !== p.n) {         // it digivolved: the new form's model takes its place
            MB.F.modelName.set(key, p.n);
            resolveModelFolder(p.n).then((folder) => { if (folder && MB.F && MB.F.r3d === r) r.addFighter(key, "player", folder, laneOf(i, S.P.length)); });
        }
        if (!MB.F.placed.has(key)) {
            MB.F.modelName.set(key, p.n);
            MB.F.placed.add(key);
            resolveModelFolder(p.n).then((folder) => { if (folder && MB.F && MB.F.r3d === r) r.addFighter(key, "player", folder, laneOf(i, S.P.length)); });
            const c = makeCard(key, false, true); U.plateMap.set(key, c); U.plates.append(c.root);
        }
    });
    const waveKey = S.E.map((e) => e.i).join(",");                   // the current wave of enemies (rebuilt when the wave changes)
    if (MB.F.waveKey !== waveKey) {
        MB.F.waveKey = waveKey;
        r.clearFighters("enemy");
        for (const [k, c] of [...U.plateMap]) if (k[0] === "e") { c.root.remove(); U.plateMap.delete(k); MB.F.placed.delete(k); }
        S.E.forEach((e, i: number) => {
            const key = "e" + e.i;
            MB.F.placed.add(key);
            resolveModelFolder(e.n).then((folder) => { if (folder && MB.F && MB.F.r3d === r) r.addFighter(key, "enemy", folder, laneOf(i, S.E.length)); });
            const c = makeCard(key, true, true); U.plateMap.set(key, c); U.plates.append(c.root);
        });
    }
    r.setMultiCamera(true);
    for (const e of S.E) { const c = U.plateMap.get("e" + e.i); if (c) updateCard(c, e, true); r.setFighterHurt("e" + e.i, e.hp / Math.max(1, e.mhp) < 0.25); }
    for (const p of S.P) {
        const c = U.plateMap.get("p" + p.id);
        if (c) { updateCard(c, p, false); c.root.classList.toggle("me", p.id === MB.A.myId()); }
        r.setFighterHurt("p" + p.id, p.hp / Math.max(1, p.mhp) < 0.25 && !p.ko);
    }
    // an action just happened: play it with the game's own animation, on every screen
    const ev = S.ev;
    if (ev && ev.q !== MB.F.lastEv) {
        MB.F.lastEv = ev.q;
        if (ev.kind === "atk") {
            const [first, ...rest] = ev.d;
            if (first) {
                r.fighterAttack(ev.a, first[0], ev.sk, { lethal: !!first[3], miss: !first[2] });
                for (const t of rest) setTimeout(() => { if (MB.F && MB.F.r3d === r) r.fighterReact(t[0], { lethal: !!t[3], miss: !t[2] }); }, 650);
            }
        } else if (ev.kind === "self") r.fighterTech(ev.a, ev.sk);       // a heal or a buff: its own motion, no one is hit
        else if (ev.kind === "item") r.fighterAction(ev.a, 10);           // the item-use motion (clip 10), as in the one-on-one battle
        // (a digivolve needs no motion of its own here: the new form's model is put in place above)
        if (ev.kind !== "atk") for (const t of ev.d) if (t[3]) r.fighterReact(t[0], { lethal: true });
    }
    if (S.ph === "won" && !MB.F.cheered) { MB.F.cheered = true; for (const p of S.P) if (!p.ko) r.fighterVictory("p" + p.id); }
}

// ------------------------------------------------------------ the view of the shared state S (same on every screen)
export function render() {
    const U = MB.F?.ui; if (!U) return;
    const S = MB.F.S;
    if (!S) { U.title.textContent = MB.F.label || "Fight"; U.status.textContent = MB.F.link.text ?? "Waiting for everyone to get ready..."; return; }
    const mine = S.P.find((p) => p.id === MB.A.myId());
    if (mine) {
        if (!MB.F.isHost && mine.pt) mine.pt.forEach((q, i: string | number) => { const r = MB.F.party[i]?.rec; if (r) { r.hp = q.hp; r.mp = q.mp; r.gauge = q.dv; } });   // the referee's numbers are the true ones
        const key = `${mine.ac | 0}|${mine.n}|${mine.bl | 0}`;
        if (MB.F.mineKey !== key) {                                             // I digivolved, tagged or blasted: my record and technique list follow
            MB.F.mineKey = key; MB.F.act = mine.ac | 0; (MB.F.took ??= new Set()).add(MB.F.act);
            MB.F.me = MB.F.party[MB.F.act]?.rec ?? MB.F.me;
            if (!MB.F.isHost && MB.F.me.profile?.name !== mine.n) MB.F.kit.setFormByName(MB.F.me, mine.n);
            MB.F.techs = MB.F.kit.myTechs(MB.F.me, !!mine.bl);
        }
    }
    const ev = S.ev;
    if (ev && ev.q !== MB.F.lastStealQ) {                                       // what I stole goes into my bag
        MB.F.lastStealQ = ev.q;
        if (ev.st && ev.a === "p" + MB.A.myId()) { try { MB.F.kit.giveItem(ev.st); } catch (e) { console.warn("[mpbattle] steal", e); } }
    }
    U.title.textContent = `${MB.F.label || "Fight"}   ·   round ${S.r}${MB.F.waves > 1 ? `   ·   wave ${S.w + 1}/${MB.F.waves}` : ""}`;
    if (MB.F.r3d) syncScene();
    else renderCards(U, S);
    for (const [k, c] of MB.F.r3d ? U.plateMap : U.cards) {
        const t = S.t;
        c.root.classList.toggle("act", !!t && t === k);
    }
    U.log.replaceChildren(...S.g.map((l) => mk("div", "", l)));
    if (MB.F.nat && S.lq !== MB.F.lastLq) {                                       // the latest action, through the game's own message window
        MB.F.lastLq = S.lq;
        if (!(MB.F.cmd?.stage === "target")) MB.F.nat.say(S.ln ?? []);
    }
    const t = S.t;
    const who = !t ? "" : t[0] === "e" ? (S.E.find((e: { i: string; }) => "e" + e.i === t)?.n ?? "Enemy") : (S.P.find((p: { id: string; }) => "p" + p.id === t)?.pn ?? "Player");
    U.status.textContent = MB.F.link.text ?? (S.ph !== "play" ? "" : t === "p" + MB.A.myId() ? "YOUR TURN" : S.pz ? pzText(S.pz, S.P) : t ? `${who}'s turn` : "");
    renderCmd();
}

// the fallback when there is no WebGL: plain cards
function renderCards(U, S) {
    const foeKeys = S.E.map((e: { i: string; }) => "e" + e.i).join(",");
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
        c.root.classList.toggle("me", p.id === MB.A.myId());
    }
}
