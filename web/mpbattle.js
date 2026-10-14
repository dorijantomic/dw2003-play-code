// EXPERIMENT: many-vs-many fights for multiplayer (not original game content).
//
// The game's own battle is one Digimon against one enemy and stays exactly that for single player. This is an EXTENSION that
// multiplayer uses instead: two or more players fight two or more enemies at once, each player controlling their own lead
// Digimon on their own screen. It does not re-implement the battle: every number comes from the game's own engine through
// `battle.mpKit()` (web/battle.js): the same fighter records, the same damage / accuracy / critical rolls, the same technique
// lists and MP prices, the same EXP and BIT payout.
//
// How a fight runs (one player's game is the "host" and keeps the turn order; nobody needs anyone else's stats):
//   - every round, everybody who is still standing acts once, fastest first
//   - on YOUR turn you pick Fight / Tech / Run on your screen; YOUR game rolls the damage against the enemy and tells the host
//   - on an ENEMY's turn the host picks a target (or everybody, for a spread technique); the TARGET's game rolls the damage against
//     its own real defence and tells the host how much HP it has left
//   - the host sends everyone the same small snapshot after every action, and everyone draws it
// Spread techniques (strong magic) hit every enemy (or every player) at 65% of the single-target damage.
// A fight with many enemies is fought in waves of at most max(2, players) at a time.
// Nothing here writes a story flag.

const SPREAD_FACTOR = 0.65;
const SPREAD_MP = 40;               // a magical technique that costs at least this much hits everyone
const TURN_MS = 45000;              // how long a player may think
const FOE_WAIT_MS = 4000;           // how long the host waits for a player's game to answer an enemy attack
const ANIM_MS = 1000;               // the pause after each action
const READY_MS = 25000;             // how long the host waits for the others to get into the fight (the battle-start transition plays first)

const isSpread = (skill) => !!skill && skill.attack_category === "magical" && (skill.mp_cost ?? 0) >= SPREAD_MP;

let A = null;       // what the game gives us (see installMpBattle)
let F = null;       // the fight I am in, or null

export const mpbActive = () => !!F;
/** True while the fight screen is up (also during its result page). */
export const mpbVisible = () => !!F || (!!A?.ui && A.ui.root.style.display === "flex");

// ------------------------------------------------------------ the screen
const css = `
#mpb { position:absolute; inset:0; z-index:70; display:none; flex-direction:column; color:#fff; font:13px/1.35 system-ui,sans-serif;
  background:radial-gradient(ellipse at 50% 30%, #1d2b63 0%, #0b0f2c 70%); user-select:none; }
#mpb .top { padding:8px 14px; display:flex; justify-content:space-between; font:bold 14px monospace; background:rgba(0,0,0,.35); }
#mpb .row { flex:1; display:flex; gap:14px; justify-content:center; align-items:center; padding:6px 14px; flex-wrap:wrap; }
#mpb .vs { text-align:center; font:bold 12px monospace; color:#8a94d6; letter-spacing:6px; padding:0; }
#mpb .card { position:relative; width:190px; padding:8px 10px; border:2px solid #45509a; border-radius:10px; background:rgba(20,26,70,.85); transition:transform .15s, border-color .15s, opacity .3s; }
#mpb .card.foe { border-color:#a84a5a; background:rgba(60,20,36,.85); }
#mpb .card.act { border-color:#ffd34d; transform:translateY(-4px); box-shadow:0 0 14px #ffd34d88; }
#mpb .card.me .nm { color:#7dffa0; }
#mpb .card.ko { opacity:.35; filter:grayscale(1); }
#mpb .card.pick { cursor:pointer; border-color:#fff; } #mpb .card.pick:hover { background:rgba(120,40,60,.95); }
#mpb .pic { float:left; width:38px; height:38px; margin-right:8px; border-radius:50%; font:bold 20px/38px monospace; text-align:center; text-shadow:0 1px 2px #000; border:2px solid #fff6; }
#mpb .nm { font-weight:bold; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } #mpb .sub { color:#aab3e8; font-size:11px; }
#mpb .bar { clear:both; height:7px; margin-top:5px; background:#0009; border-radius:4px; overflow:hidden; } #mpb .bar i { display:block; height:100%; transition:width .5s; }
#mpb .bar.hp i { background:#5fe07f; } #mpb .bar.mp i { background:#58a8ff; } #mpb .bar.foe i { background:#ff7a5f; }
#mpb .num { font:10px monospace; color:#cfd6ff; }
#mpb .float { position:absolute; left:50%; top:0; font:bold 24px monospace; pointer-events:none; text-shadow:0 2px 3px #000; animation:mpbfloat 1.1s ease-out forwards; }
@keyframes mpbfloat { from { transform:translate(-50%,0); opacity:1; } to { transform:translate(-50%,-46px); opacity:0; } }
#mpb .log { padding:6px 14px; min-height:68px; background:rgba(0,0,0,.4); font:12px/1.5 monospace; }
#mpb .log div:last-child { color:#ffe9a0; }
#mpb .bar2 { padding:8px 14px; min-height:46px; background:rgba(0,0,0,.55); display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
#mpb .bar2 button { background:#2f3d9a; color:#fff; border:2px solid #8a98ff; border-radius:6px; padding:6px 16px; font:bold 13px monospace; cursor:pointer; }
#mpb .bar2 button:hover { background:#4a5cd0; } #mpb .bar2 button:disabled { opacity:.4; cursor:default; }
#mpb .bar2 .hint { color:#cfd6ff; font:12px monospace; }
#mpb .end { position:absolute; inset:0; display:flex; flex-direction:column; gap:10px; align-items:center; justify-content:center; background:rgba(5,8,30,.9); }
#mpb .end h2 { margin:0; font:bold 38px monospace; letter-spacing:4px; } #mpb .end .sm { color:#cfd6ff; font:14px monospace; }
`;

function buildUi() {
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const root = document.createElement("div"); root.id = "mpb";
    const top = document.createElement("div"); top.className = "top";
    const title = document.createElement("span"), status = document.createElement("span");
    top.append(title, status);
    const foes = document.createElement("div"); foes.className = "row";
    const vs = document.createElement("div"); vs.className = "vs"; vs.textContent = "VS";
    const mine = document.createElement("div"); mine.className = "row";
    const log = document.createElement("div"); log.className = "log";
    const bar = document.createElement("div"); bar.className = "bar2";
    root.append(top, foes, vs, mine, log, bar);
    A.stageEl.append(root);
    return { root, title, status, foes, mine, log, bar, cards: new Map(), endEl: null };
}

const hue = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function makeCard(key, foe) {
    const root = mk("div", "card" + (foe ? " foe" : ""));
    const pic = mk("div", "pic"), nm = mk("div", "nm"), sub = mk("div", "sub");
    const hp = mk("div", "bar " + (foe ? "foe" : "hp")), hpi = mk("i"); hp.append(hpi);
    const hpn = mk("div", "num");
    root.append(pic, nm, sub, hp, hpn);
    let mp = null, mpi = null;
    if (!foe) { mp = mk("div", "bar mp"); mpi = mk("i"); mp.append(mpi); root.append(mp); }
    return { key, root, pic, nm, sub, hpi, hpn, mpi, last: null };
}

function updateCard(c, o, foe) {
    c.pic.textContent = (o.n || "?")[0].toUpperCase();
    c.pic.style.background = `hsl(${hue(o.n)} 55% 38%)`;
    c.nm.textContent = foe ? o.n : `${o.pn}`;
    c.sub.textContent = foe ? `Lv ${o.lv}` : `${o.n}  Lv ${o.lv}`;
    c.hpi.style.width = Math.max(0, Math.min(100, (o.hp / Math.max(1, o.mhp)) * 100)) + "%";
    c.hpn.textContent = foe ? `HP ${o.hp}/${o.mhp}` : `HP ${o.hp}/${o.mhp}   MP ${o.mp}/${o.mmp}`;
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

// ------------------------------------------------------------ the view of the shared state S (same on every screen)
function render() {
    const U = F?.ui; if (!U) return;
    const S = F.S;
    if (!S) { U.title.textContent = F.label || "Fight"; U.status.textContent = "Waiting for everyone to get ready..."; return; }
    U.title.textContent = `${F.label || "Fight"}   ·   round ${S.r}${F.waves > 1 ? `   ·   wave ${S.w + 1}/${F.waves}` : ""}`;
    // enemy row (rebuilt when the wave changes)
    const foeKeys = S.E.map((e) => "e" + e.i).join(",");
    if (U.foeKeys !== foeKeys) {
        for (const [k, c] of [...U.cards]) if (k[0] === "e") { c.root.remove(); U.cards.delete(k); }
        for (const e of S.E) { const c = makeCard("e" + e.i, true); U.cards.set(c.key, c); U.foes.append(c.root); c.root.addEventListener("click", () => onPick(e.i)); }
        U.foeKeys = foeKeys;
    }
    for (const e of S.E) updateCard(U.cards.get("e" + e.i), e, true);
    for (const p of S.P) {
        let c = U.cards.get("p" + p.id);
        if (!c) { c = makeCard("p" + p.id, false); U.cards.set(c.key, c); U.mine.append(c.root); }
        updateCard(c, p, false);
        c.root.classList.toggle("me", p.id === A.myId());
    }
    for (const [k, c] of U.cards) {
        const t = S.t;
        c.root.classList.toggle("act", !!t && ((t.t === "e" && k === "e" + t.i) || (t.t === "p" && k === "p" + t.id)));
    }
    U.log.replaceChildren(...S.g.map((l) => mk("div", "", l)));
    const t = S.t;
    const who = !t ? "" : t.t === "e" ? (S.E.find((e) => e.i === t.i)?.n ?? "Enemy") : (S.P.find((p) => p.id === t.id)?.pn ?? "Player");
    U.status.textContent = S.ph !== "play" ? "" : t?.t === "p" && t.id === A.myId() ? "YOUR TURN" : t ? `${who}'s turn` : "";
    renderCmd();
}

function renderCmd() {
    const U = F?.ui; if (!U) return;
    const S = F.S, bar = U.bar;
    bar.replaceChildren();
    for (const c of U.cards.values()) c.root.classList.remove("pick");
    const mineTurn = S && S.ph === "play" && S.t?.t === "p" && S.t.id === A.myId() && F.me.hp > 0;
    if (!mineTurn) { F.cmd = null; bar.append(mk("span", "hint", S?.ph === "play" ? "Waiting..." : "")); return; }
    const alive = S.E.filter((e) => !e.ko);
    const btn = (label, fn, disabled) => { const b = mk("button", "", label); b.type = "button"; b.disabled = !!disabled; b.onclick = fn; bar.append(b); return b; };
    if (!F.cmd) F.cmd = { stage: "menu" };
    const cmd = F.cmd;
    if (cmd.stage === "menu") {
        btn("Fight", () => chooseTarget(F.kit.basic(F.me), 0));
        btn("Tech", () => { F.cmd = { stage: "tech" }; renderCmd(); }, !F.techs.length);
        btn("Run", () => { F.cmd = { stage: "run" }; renderCmd(); });
        bar.append(mk("span", "hint", `HP ${F.me.hp}/${F.me.maxHp}   MP ${F.me.mp}/${F.me.maxMp}`));
    } else if (cmd.stage === "run") {
        bar.append(mk("span", "hint", "Run away and leave the fight?"));
        btn("Yes, run", () => run());
        btn("No", () => { F.cmd = { stage: "menu" }; renderCmd(); });
    } else if (cmd.stage === "tech") {
        for (const t of F.techs) {
            const spread = isSpread(t.skill), ok = F.me.mp >= t.cost;
            btn(`${t.name}  (${t.cost} MP)${spread ? "  [all]" : ""}`, () => chooseTarget(t.skill, t.cost), !ok);
        }
        btn("Back", () => { F.cmd = { stage: "menu" }; renderCmd(); });
    } else if (cmd.stage === "target") {
        bar.append(mk("span", "hint", `Pick a target for ${cmd.skill.name}`));
        for (const e of alive) U.cards.get("e" + e.i)?.root.classList.add("pick");
        btn("Back", () => { F.cmd = { stage: "menu" }; renderCmd(); });
    }
}

function chooseTarget(skill, cost) {
    const alive = F.S.E.filter((e) => !e.ko);
    if (!alive.length) return;
    if (isSpread(skill)) return attack(skill, cost, alive.map((e) => e.i));
    if (alive.length === 1) return attack(skill, cost, [alive[0].i]);
    F.cmd = { stage: "target", skill, cost }; renderCmd();
}
function onPick(i) {
    if (!F || F.cmd?.stage !== "target") return;
    if (F.S.E.find((e) => e.i === i)?.ko) return;
    attack(F.cmd.skill, F.cmd.cost, [i]);
}

// ------------------------------------------------------------ my actions (computed here, with my real stats)
function attack(skill, cost, targets) {
    const spread = targets.length > 1;
    const res = targets.map((i) => {
        const r = F.kit.attack(F.me, F.erec[i], skill);
        const dmg = r.hit ? Math.max(0, spread ? Math.floor(r.dmg * SPREAD_FACTOR) : r.dmg) : 0;
        return [i, dmg, r.hit ? 1 : 0];
    });
    F.me.mp = Math.max(0, F.me.mp - cost);
    F.cmd = null;
    const d = { k: "act", fid: F.fid, r: F.S.r, sk: skill.id, nm: skill.name, res, cost };
    if (F.isHost) hostAct(A.myId(), d); else A.send([F.hostId], d);
    renderCmd();
}
function run() {
    F.cmd = null;
    if (F.isHost) hostRun(A.myId()); else A.send([F.hostId], { k: "run", fid: F.fid });
    finish(false, { fled: true });
}

/** An enemy attacks ME: roll it against my real defence, answer with the HP I have left. */
function onFoe(d) {
    if (!F || d.fid !== F.fid || F.me.hp <= 0) return;
    const rec = F.erec[d.e]; if (!rec) return;
    const skill = d.b ? (F.kit.foeMoves(rec).find((m) => !m.tech)?.skill ?? null) : F.kit.skillOf(d.sk);
    let dmg = 0, hit = false;
    if (skill) {
        const sk = d.b ? skill : { ...skill };
        const r = F.kit.attack(rec, F.me, sk);
        hit = r.hit; dmg = r.hit ? Math.max(0, d.sp ? Math.floor(r.dmg * SPREAD_FACTOR) : r.dmg) : 0;
    }
    F.me.hp = Math.max(0, F.me.hp - dmg);
    const res = { k: "res", fid: F.fid, e: d.e, dmg, hit: hit ? 1 : 0, hp: F.me.hp };
    if (F.isHost) hostRes(A.myId(), res); else A.send([F.hostId], res);
}

// ------------------------------------------------------------ the host: turn order, enemies, who is down
const later = (ms, fn) => { const id = setTimeout(() => { if (F) fn(); }, ms); (F.timers ??= new Set()).add(id); return id; };
const alivePlayers = () => [...F.H.P.values()].filter((p) => !p.ko && !p.fled);
const waveEnemies = () => F.H.E.filter((e) => e.i >= F.H.wave * F.H.waveSize && e.i < (F.H.wave + 1) * F.H.waveSize);
const say = (line) => { F.H.log.push(String(line).slice(0, 70)); if (F.H.log.length > 4) F.H.log.shift(); };

function snapshot(ph = "play") {
    const H = F.H;
    return {
        r: H.round, w: H.wave, t: H.turn, ph, g: H.log.slice(),
        E: waveEnemies().map((e) => ({ i: e.i, n: e.n, lv: e.lv, hp: e.hp, mhp: e.mhp, ko: e.ko ? 1 : 0 })),
        P: [...H.P.values()].map((p) => ({ id: p.id, pn: p.pn, n: p.n, lv: p.lv, hp: p.hp, mhp: p.mhp, mp: p.mp, mmp: p.mmp, ko: p.ko || p.fled ? 1 : 0 })),
    };
}
function broadcast(ph = "play") {
    const S = snapshot(ph);
    const others = F.ids.filter((id) => id !== A.myId() && !F.H.P.get(id)?.fled);
    if (others.length) A.send(others, { k: "st", fid: F.fid, S });
    F.S = S; render();
}

function hostBegin() {
    const H = F.H;
    clearTimeout(H.readyTimer);
    if (H.started) return; H.started = true;
    for (const id of F.ids) if (!H.P.has(id)) F.ids = F.ids.filter((x) => x !== id);   // never got ready: not in the fight
    if (!H.P.size) { finish(false, { fled: true }); return; }
    say("The fight begins!");
    F.ids = [...H.P.keys()];
    H.waveSize = Math.max(2, F.ids.length);
    F.waves = Math.ceil(F.foes.length / H.waveSize);
    A.send(F.ids.filter((id) => id !== A.myId()), { k: "go", fid: F.fid, waves: F.waves });
    later(500, nextTurn);
}

function buildOrder() {
    const H = F.H;
    H.round++;
    const actors = [
        ...alivePlayers().map((p) => ({ t: "p", id: p.id, spd: p.spd + Math.random() })),
        ...waveEnemies().filter((e) => !e.ko).map((e) => ({ t: "e", i: e.i, spd: e.spd + Math.random() })),
    ].sort((a, b) => b.spd - a.spd);
    H.order = actors;
}

function checkEnd() {
    const H = F.H;
    if (!alivePlayers().length) { hostEnd(false); return true; }
    if (waveEnemies().every((e) => e.ko)) {
        if ((H.wave + 1) * H.waveSize >= F.foes.length) { hostEnd(true); return true; }
        H.wave++; H.order = []; say(`Next wave! (${H.wave + 1}/${F.waves})`); broadcast();
        later(ANIM_MS, nextTurn); return true;
    }
    return false;
}

function nextTurn() {
    const H = F.H;
    clearTimeout(H.turnTimer);
    if (checkEnd()) return;
    for (let guard = 0; guard < 50; guard++) {
        if (!H.order.length) { buildOrder(); say(`-- Round ${H.round} --`); }
        const a = H.order.shift();
        if (a.t === "p") {
            const p = H.P.get(a.id);
            if (!p || p.ko || p.fled) continue;
            H.turn = { t: "p", id: a.id };
            broadcast();
            H.turnTimer = later(TURN_MS, () => { say(`${p.pn} took too long.`); H.turn = null; broadcast(); later(400, nextTurn); });
            return;
        }
        const e = H.E[a.i];
        if (e.ko) continue;
        H.turn = { t: "e", i: a.i };
        broadcast();
        later(600, () => foeTurn(e));
        return;
    }
}

function hostAct(from, d) {
    const H = F.H;
    if (d.fid !== F.fid || H.turn?.t !== "p" || H.turn.id !== from || d.r !== H.round) return;
    clearTimeout(H.turnTimer);
    const p = H.P.get(from); if (!p) return;
    H.turn = null;
    p.mp = Math.max(0, p.mp - (Number(d.cost) || 0));
    const nm = String(d.nm || "attack").slice(0, 24);
    for (const row of Array.isArray(d.res) ? d.res.slice(0, 6) : []) {
        const [i, dmg, hit] = row, e = H.E[i];
        if (!e || e.ko || i < H.wave * H.waveSize || i >= (H.wave + 1) * H.waveSize) continue;
        const dm = Math.max(0, Math.min(99999, Number(dmg) | 0));
        e.hp = Math.max(0, e.hp - dm);
        if (e.hp <= 0) e.ko = true;
        say(hit ? `${p.pn}: ${nm} -> ${e.n} -${dm}${e.ko ? "  DOWN!" : ""}` : `${p.pn}: ${nm} missed ${e.n}`);
    }
    broadcast();
    later(ANIM_MS, nextTurn);
}

function hostRun(from) {
    const H = F.H, p = H.P.get(from); if (!p || p.fled) return;
    p.fled = true; say(`${p.pn} ran away!`);
    const wasTurn = H.turn?.t === "p" && H.turn.id === from;
    if (wasTurn) { clearTimeout(H.turnTimer); H.turn = null; }
    broadcast();
    if (wasTurn) later(ANIM_MS, nextTurn); else if (!alivePlayers().length) later(500, nextTurn);
}

function foeTurn(e) {
    const H = F.H, rec = F.erec[e.i];
    const alive = alivePlayers();
    if (!alive.length) { nextTurn(); return; }
    const moves = F.kit.foeMoves(rec).filter((m) => m.cost <= e.mp);
    const techs = moves.filter((m) => m.tech);
    const move = techs.length && Math.random() < 0.35 ? techs[Math.floor(Math.random() * techs.length)] : (moves.find((m) => !m.tech) ?? moves[0]);
    if (!move) { say(`${e.n} waits.`); broadcast(); later(ANIM_MS, nextTurn); return; }
    e.mp -= move.cost;
    const spread = move.tech && isSpread(move.skill);
    const targets = spread ? alive : [alive[Math.floor(Math.random() * alive.length)]];
    H.pending = { e: e.i, move, spread, need: new Set(targets.map((p) => p.id)), res: [] };
    H.pending.timer = later(FOE_WAIT_MS, finishFoe);        // (before the attacks go out: my own Digimon answers at once)
    say(`${e.n} uses ${move.tech ? move.skill.name : "an attack"}!`);
    broadcast();
    for (const p of targets) {
        const d = { k: "foe", fid: F.fid, e: e.i, sk: move.skill.id, b: move.tech ? 0 : 1, sp: spread ? 1 : 0 };
        if (p.id === A.myId()) onFoe(d); else A.send([p.id], d);
    }
}

function hostRes(from, d) {
    const H = F.H, pend = H.pending;
    if (!pend || d.fid !== F.fid || d.e !== pend.e || !pend.need.has(from)) return;
    pend.need.delete(from);
    const p = H.P.get(from);
    if (p) {
        const hp = Math.max(0, Math.min(p.mhp, Number(d.hp) | 0));
        p.hp = hp; if (hp <= 0) p.ko = true;
        say(d.hit ? `  ${p.pn} takes ${Math.max(0, Number(d.dmg) | 0)}${p.ko ? "  DOWN!" : ""}` : `  ${p.pn} dodged!`);
    }
    if (!pend.need.size) finishFoe();
}
function finishFoe() {
    const H = F.H;
    if (!H.pending) return;
    clearTimeout(H.pending.timer); H.pending = null; H.turn = null;
    broadcast();
    later(ANIM_MS, nextTurn);
}

function hostEnd(won) {
    const others = F.ids.filter((id) => id !== A.myId());
    broadcast(won ? "won" : "lost");
    if (others.length) A.send(others, { k: "end", fid: F.fid, won: won ? 1 : 0 });
    finish(won, {});
}

// ------------------------------------------------------------ starting, joining, finishing
async function begin(setup, isHost, hostId, done) {
    if (F) return false;
    const kit = await A.getKit();
    const me = kit.myRecord();
    if (!me) return false;
    const erec = setup.foes.map((e) => kit.enemyRecord(e));
    if (erec.some((r) => !r)) return false;
    if (F) return false;
    F = {
        fid: setup.fid, isHost, hostId, ids: setup.ids.slice(), names: setup.names ?? {}, foes: setup.foes, label: setup.label || "Fight",
        screenId: setup.screenId ?? null, challenge: setup.ch ?? null, kit, me, erec, techs: kit.myTechs(me), done, S: null, cmd: null, waves: 1,
        snap: A.snapshot(), timers: new Set(), ui: null, H: null,
    };
    F.ui = A.ui ?? (A.ui = buildUi());
    F.ui.cards.clear(); F.ui.foes.replaceChildren(); F.ui.mine.replaceChildren(); F.ui.foeKeys = ""; F.ui.bar.replaceChildren(); F.ui.log.replaceChildren();
    if (F.ui.endEl) { F.ui.endEl.remove(); F.ui.endEl = null; }
    F.ui.root.style.display = "flex";
    A.releaseKeys();
    const mePublic = { id: A.myId(), pn: A.myName(), n: me.profile?.name ?? "?", lv: me.level | 0, hp: me.hp | 0, mhp: me.maxHp | 0, mp: me.mp | 0, mmp: me.maxMp | 0, spd: me.spd | 0 };
    if (isHost) {
        F.H = {
            P: new Map([[mePublic.id, { ...mePublic, ko: false, fled: false }]]),
            E: erec.map((r, i) => ({ i, n: r.eStats?.digimon_id ?? r.profile?.name ?? "?", lv: r.level | 0, hp: r.hp | 0, mhp: r.maxHp | 0, mp: r.mp | 0, spd: r.spd | 0, ko: false })),
            wave: 0, waveSize: 2, round: 0, order: [], turn: null, log: ["Waiting for everyone..."], started: false, pending: null,
        };
        A.send(F.ids.filter((id) => id !== mePublic.id), { k: "setup", fid: F.fid, foes: F.foes, ids: F.ids, names: F.names, label: F.label, screenId: F.screenId, ch: F.challenge });
        F.H.readyTimer = setTimeout(() => { if (F) hostBegin(); }, READY_MS);
        if (F.H.P.size >= F.ids.length) hostBegin();
    } else {
        A.send([hostId], { k: "ready", fid: F.fid, p: mePublic });
    }
    render();
    return true;
}

/** Start a fight as the host. ids = everyone in it (me first). done({won, fled, reward}) runs when it is over. */
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
        if (d.k === "ready" && d.p && !F.H.started) {
            const p = d.p, int = (v, hi) => Math.max(0, Math.min(hi, Number(v) | 0));
            F.H.P.set(from, { id: from, pn: String(p.pn ?? "?").slice(0, 12), n: String(p.n ?? "?").slice(0, 14), lv: int(p.lv, 99), hp: int(p.hp, 99999), mhp: Math.max(1, int(p.mhp, 99999)),
                mp: int(p.mp, 99999), mmp: int(p.mmp, 99999), spd: int(p.spd, 9999), ko: false, fled: false });
            if (F.H.P.size >= F.ids.length) hostBegin();
        } else if (d.k === "decline") { F.ids = F.ids.filter((x) => x !== from); if (F.H.P.size >= F.ids.length) hostBegin(); }
        else if (d.k === "act") hostAct(from, d);
        else if (d.k === "res") hostRes(from, d);
        else if (d.k === "run") hostRun(from);
    } else if (from === F.hostId) {
        if (d.k === "go") F.waves = Math.max(1, Math.min(20, d.waves | 0));
        else if (d.k === "st") { F.S = d.S; render(); }
        else if (d.k === "foe") onFoe(d);
        else if (d.k === "end") finish(!!d.won, {});
    }
}

/** Someone left the room mid-fight. */
export function mpbPeerGone(id) {
    if (!F) return;
    if (!F.isHost && id === F.hostId) { finish(false, { fled: true, hostLeft: true }); return; }
    if (F.isHost && F.H?.P.has(id)) hostRun(id);
    if (F.isHost && F.H && !F.H.started) { F.ids = F.ids.filter((x) => x !== id); if (F.H.P.size >= F.ids.length) hostBegin(); }
}

function finish(won, { fled = false, hostLeft = false } = {}) {
    const f = F; if (!f) return;
    for (const t of f.timers ?? []) clearTimeout(t);
    clearTimeout(f.H?.readyTimer); clearTimeout(f.H?.turnTimer);
    F = null;                                   // from here on the fight is over; the screen stays up for the result
    let reward = null;
    if (won && !fled) {
        const standing = f.isHost ? [...f.H.P.values()].filter((p) => !p.fled).length : f.ids.length;
        reward = f.kit.applyWin({ screenId: f.screenId, participants: standing });
    }
    if (!won && !fled) A.restore(f.snap);       // a lost optional fight costs nothing
    else f.kit.commit(f.me);
    const U = f.ui;
    const close = () => { U.root.style.display = "none"; if (U.endEl) { U.endEl.remove(); U.endEl = null; } A.releaseKeys(); try { f.done?.({ won, fled, reward }); } catch (e) { console.warn("[mpbattle] done failed", e); } };
    if (fled) { close(); return; }
    const end = mk("div", "end");
    const h2 = mk("h2", "", won ? "VICTORY!" : "DEFEATED");
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
}

// ------------------------------------------------------------ install
/**
 * api: { stageEl, getKit(), myId(), myName(), nameOf(id), send(ids, d), releaseKeys(), snapshot(), restore(snap),
 *        canJoin(), joinDone(setup) -> done fn }
 */
export function installMpBattle(api) {
    A = api;
    // while a fight is up, no key reaches the game (the character must not walk off)
    window.addEventListener("keydown", (e) => {
        if (!F && !(A.ui && A.ui.root.style.display === "flex")) return;
        if (/^F\d+$/.test(e.key)) return;
        A.releaseKeys(); e.stopImmediatePropagation();
    }, true);
    window.addEventListener("keyup", (e) => { if (F || (A.ui && A.ui.root.style.display === "flex")) e.stopImmediatePropagation(); }, true);
    window.__mpb = { get fight() { return F; }, isSpread, host: mpbHost };   // (for tests and the console)
}
