// EXPERIMENT: optional multiplayer (not original game content). F4 opens a small panel.
//
//   HOST:  press "Host a game". Your game starts a small relay on your own computer (no account, nothing to install) and
//          the panel shows your address and a five-letter code to tell your friends.
//   JOIN:  type the host's address and the code, press "Join".
//
// Friends reach the host's computer the usual way for LAN-style games: all on one network. Hamachi, Radmin VPN or
// Tailscale put friends on one network over the internet; the panel recognises those addresses and names them.
//
// Everyone runs their own copy of the game from their own disc, with their own story, saves and battles. The relay
// (server/relay.mjs) only passes names and positions between the players in one room: no game data, nothing from anyone's
// disc. For tests, `?relay=ws://host:port` on the page address skips the launcher and uses that relay.
//
//   multiplayerTick(mapId, state)   called every frame: sends where I am (about 10 times a second) and moves the others smoothly
//   multiplayerGhosts(mapId)        the other players standing in this stage, for game.js to draw

const PORT = 20031;             // the relay's port on the host's computer
const KEY_ADDR = "dw.mp.addr", KEY_NAME = "dw.mp.name";
const SEND_MS = 100;            // at most ten position updates a second
const BEAT_MS = 2000;           // standing still, still say "I am here" now and then
const STALE_MS = 9000;          // a player silent this long is hidden (their connection probably dropped)
const SNAP = 140;               // farther away than this (a map change, a warp): jump instead of gliding
const EMOTES = ["♥", "!", "?", "...", "♪", ":)", "GG", "zZ"];   // 0..7

const mp = {
    ws: null, status: "off", room: null, id: null, name: "",
    addresses: [], hosting: false, host: "",   // the host's own addresses, to show to friends
    peers: new Map(),           // id -> { name, map, x, y, tx, ty, dir, mv, animTime, seen, emote, emoteUntil }
    sent: { map: null, x: 0, y: 0, dir: "", mv: 0, at: 0 },
    retry: 0, retryTimer: 0, want: null,
    ui: null, lastTick: 0,
};


/** What a friend typed ("25.1.2.3", "25.1.2.3:20031", "ws://...") -> a WebSocket address, or null. */
function wsAddress(text) {
    let h = String(text ?? "").trim().replace(/^(wss?|https?):\/\//i, "").replace(/\/.*$/, "");
    if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(h)) return null;
    if (!h.includes(":")) h += ":" + PORT;
    return "ws://" + h;
}
const testRelay = () => new URLSearchParams(location.search).get("relay");

function playerName(fallback) {
    let n = "";
    try { n = localStorage.getItem(KEY_NAME) || ""; } catch { /* storage blocked */ }
    return (n || fallback || "Tamer").slice(0, 12);
}

// ------------------------------------------------------------ connection
const REASONS = {
    no_room: "Connected, but there is no room with that code. Check the code with your friend.",
    full: "That room is full.",
    busy: "The server is busy. Try again in a moment.",
    bad: "That is not a room code (five letters and numbers).",
    exists: "That code is taken. Try again.",
};

function setStatus(s, text) { mp.status = s; render(text); }

/** want = { base: "ws://host:port", create: true } or { base, room: "ABCDE" } */
export function connect(want) {
    disconnect(true);
    const base = want.base;
    if (!base) { setStatus("off", "That address does not look right. Use the numbers your friend shows, like 25.1.2.3"); return; }
    mp.want = want;
    mp.name = playerName(mp.name);
    const q = new URLSearchParams({ name: mp.name });
    if (want.create) q.set("create", "1"); else q.set("room", want.room);
    let ws;
    try { ws = new WebSocket(`${base}/?${q}`); } catch { setStatus("off", "Could not open a connection."); return; }
    mp.ws = ws;
    setStatus("connecting", "Connecting...");
    let gotWelcome = false;
    ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === "welcome") {
            gotWelcome = true; mp.retry = 0;
            mp.id = m.id; mp.room = m.room; mp.want = { base, room: m.room };   // a reconnect rejoins this room
            mp.peers.clear();
            for (const p of m.roster) mp.peers.set(p.id, newPeer(p.name));
            mp.sent.at = 0; mp.sent.map = null;                                  // announce myself straight away
            setStatus("online");
        } else if (m.t === "err") {
            mp.want = null;
            setStatus("off", REASONS[m.reason] ?? "The server said no.");
        } else if (m.t === "join") {
            mp.peers.set(m.id, newPeer(m.name)); render(); toast(`${m.name} joined`);
        } else if (m.t === "leave") {
            const p = mp.peers.get(m.id); mp.peers.delete(m.id); render(); if (p) toast(`${p.name} left`);
        } else if (m.t === "gone") {
            const p = mp.peers.get(m.id); if (p) p.map = null;
        } else if (m.t === "pos") {
            const p = mp.peers.get(m.id) ?? (mp.peers.set(m.id, newPeer("Tamer")), mp.peers.get(m.id));
            const jump = p.map !== m.map || Math.hypot(m.x - p.tx, m.y - p.ty) > SNAP;
            p.map = m.map; p.tx = m.x; p.ty = m.y; p.dir = m.dir; p.mv = m.mv; p.seen = performance.now();
            if (jump || p.x == null) { p.x = m.x; p.y = m.y; }
        } else if (m.t === "emote") {
            const p = mp.peers.get(m.id); if (p) { p.emote = EMOTES[m.e] ?? ""; p.emoteUntil = performance.now() + 2500; }
        }
    };
    ws.onclose = () => {
        if (mp.ws !== ws) return;                  // I closed it myself
        mp.ws = null; mp.peers.clear();
        if (mp.want && gotWelcome && mp.retry < 5) {
            const wait = 1500 * 2 ** mp.retry++;
            setStatus("connecting", "Connection lost. Reconnecting...");
            mp.retryTimer = setTimeout(() => connect(mp.want), wait);
        } else if (mp.status !== "off") setStatus("off", gotWelcome ? "Connection lost." : "Could not reach your friend. Check the address, that you are on the same Hamachi / Tailscale network, and that their game is still hosting.");
    };
    ws.onerror = () => { /* onclose follows and reports it */ };
}

/** Host: have the launcher start the relay on this computer, then make a room on it. */
export async function hostGame() {
    setStatus("connecting", "Starting your game server...");
    let base = testRelay();
    try {
        if (!base) {
            const r = await (await fetch("/__mp/host")).json();
            if (!r.ok) { setStatus("off", r.error || "Could not start the server."); return; }
            base = `ws://127.0.0.1:${r.port}`;
        }
        const info = await (await fetch(base.replace(/^ws/, "http") + "/info")).json();
        mp.addresses = info.addresses ?? [];
    } catch {
        setStatus("off", "Hosting only works in the installed game (the launcher starts the server). Opened some other way? Start it with: node server/relay.mjs");
        return;
    }
    mp.hosting = true;
    connect({ base, create: true });
}

export function disconnect(quiet = false) {
    clearTimeout(mp.retryTimer);
    if (!quiet) mp.hosting = false;
    const ws = mp.ws; mp.ws = null; mp.want = quiet ? mp.want : null;
    if (ws) try { ws.close(); } catch { /* already closed */ }
    mp.peers.clear(); mp.room = null; mp.id = null;
    if (!quiet) setStatus("off");
}

function newPeer(name) { return { name, map: null, x: null, y: null, tx: 0, ty: 0, dir: "down", mv: 0, animTime: 0, seen: 0, emote: "", emoteUntil: 0 }; }
const send = (o) => { if (mp.ws?.readyState === 1) mp.ws.send(JSON.stringify(o)); };
export function sendEmote(i) { send({ t: "emote", e: i }); const me = EMOTES[i]; toast(`You: ${me}`); }

// ------------------------------------------------------------ every frame
export function multiplayerTick(mapId, st) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - (mp.lastTick || now)) / 1000);
    mp.lastTick = now;
    if (mp.status !== "online") return;
    const mv = st.moving || st._cutTarget ? 1 : 0;
    const x = Math.round(st.x), y = Math.round(st.y), s = mp.sent;
    const changed = s.map !== mapId || s.x !== x || s.y !== y || s.dir !== st.dir || s.mv !== mv;
    if ((changed && (now - s.at >= SEND_MS || s.map !== mapId)) || now - s.at >= BEAT_MS) {
        send({ t: "pos", map: mapId, x, y, dir: st.dir, mv });
        mp.sent = { map: mapId, x, y, dir: st.dir, mv, at: now };
    }
    // glide the others toward their latest position, and run their walk animation while they are moving
    for (const p of mp.peers.values()) {
        if (p.x == null) continue;
        const k = Math.min(1, dt * 14);
        p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
        p.moving = !!p.mv || Math.hypot(p.tx - p.x, p.ty - p.y) > 1.5;
        if (p.moving) p.animTime += dt; else p.animTime = 0;
    }
}

/** The other players standing in this stage: [{ id, name, x, y, dir, moving, animTime, emote }] */
export function multiplayerGhosts(mapId) {
    if (mp.status !== "online") return [];
    const now = performance.now(), out = [];
    for (const [id, p] of mp.peers) {
        if (p.map !== mapId || p.x == null || now - p.seen > STALE_MS) continue;
        out.push({ id, name: p.name, x: p.x, y: p.y, dir: p.dir, moving: p.moving, animTime: p.animTime, emote: now < p.emoteUntil ? p.emote : "" });
    }
    return out;
}

/** Name tag and emote over a ghost; (sx, headY) is the point just above its head on the canvas (the game's balloon anchor). */
export function drawGhostLabel(ctx, g, sx, headY) {
    ctx.save();
    ctx.font = "bold 8px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    const w = Math.ceil(ctx.measureText(g.name).width) + 6, y = headY - 1;
    ctx.fillStyle = "rgba(0,0,32,0.72)"; ctx.fillRect(Math.round(sx - w / 2), y - 9, w, 11);
    ctx.fillStyle = "#fff"; ctx.fillText(g.name, Math.round(sx), y);
    if (g.emote) {
        ctx.font = "bold 12px monospace";
        ctx.fillStyle = "#000"; ctx.fillText(g.emote, Math.round(sx) + 1, y - 13);
        ctx.fillStyle = "#ffd34d"; ctx.fillText(g.emote, Math.round(sx), y - 14);
    }
    ctx.restore();
}

// ------------------------------------------------------------ the panel
let toastEl = null, toastTimer = 0;
function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text; toastEl.style.opacity = "1";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.style.opacity = "0"; }, 2200);
}

function render(note) {
    const u = mp.ui; if (!u) return;
    const online = mp.status === "online";
    u.badge.hidden = !online;
    u.badge.textContent = online ? `ROOM ${mp.room}  ·  ${mp.peers.size + 1} playing` : "";
    u.off.hidden = online || mp.status === "connecting";
    u.on.hidden = !online;
    u.msg.textContent = note ?? (online ? "" : mp.status === "connecting" ? "Connecting..." : "");
    if (online) {
        u.tell.textContent = mp.hosting ? "Tell your friends this address and code:" : `Connected to ${mp.host}. Room code:`;
        u.addrs.textContent = mp.hosting
            ? (mp.addresses.length ? mp.addresses.map((a) => `${a.ip}  (${a.kind})`).join("\n") : "(no network address found)")
            : "";
        u.addrs.style.whiteSpace = "pre";
        u.addrs.hidden = !mp.hosting;
        u.code.textContent = mp.room;
        u.roster.textContent = [mp.name + " (you)", ...[...mp.peers.values()].map((p) => p.name)].join(", ");
    }
}

function openPanel(show) {
    if (!mp.ui) return;
    mp.ui.panel.hidden = show === undefined ? !mp.ui.panel.hidden : !show;
    if (!mp.ui.panel.hidden) { mp.ui.fillName(); render(); }
}

export function installMultiplayer({ stageEl, defaultName = () => "Tamer" }) {
    const css = document.createElement("style");
    css.textContent = `
      #mp-panel { position:absolute; top:44px; left:8px; z-index:41; width:262px; padding:10px 12px; background:rgba(14,14,28,.94); color:#e8e8f0;
        border:1px solid #45456a; border-radius:8px; font:12px/1.4 system-ui,sans-serif; }
      #mp-panel[hidden], #mp-badge[hidden], #mp-panel [hidden] { display:none; }
      #mp-panel h3 { margin:0 0 6px; font-size:13px; color:#ffd34d; letter-spacing:1px; }
      #mp-panel input, #mp-panel button { background:#2a2a40; color:#e8e8f0; border:1px solid #45456a; border-radius:4px; padding:3px 7px; font:inherit; }
      #mp-panel button { cursor:pointer; } #mp-panel button:hover { background:#3a3a5a; }
      #mp-panel .row { display:flex; gap:6px; margin-top:6px; align-items:center; }
      #mp-panel input.code { width:78px; text-transform:uppercase; letter-spacing:2px; text-align:center; }
      #mp-panel .big { font:bold 22px monospace; letter-spacing:4px; color:#fff; text-align:center; margin:4px 0; }
      #mp-panel .small { font-size:11px; color:#8a8ab0; margin-top:6px; } #mp-msg { color:#ff9a7a; margin-top:6px; min-height:1em; }
      #mp-panel .emotes button { padding:1px 6px; font-size:12px; }
      #mp-badge { position:absolute; top:8px; left:8px; z-index:40; padding:2px 8px; background:rgba(0,0,32,.78); color:#fff; border:1px solid #45456a;
        border-radius:4px; font:11px monospace; cursor:pointer; }
      #mp-toast { position:absolute; left:50%; transform:translateX(-50%); bottom:16px; z-index:51; padding:4px 12px; background:rgb(0,0,32); color:#fff;
        border:1px solid #6a6aa0; font:13px monospace; pointer-events:none; opacity:0; transition:opacity .3s; }`;
    document.head.appendChild(css);
    const panel = document.createElement("div");
    panel.id = "mp-panel"; panel.hidden = true;
    panel.innerHTML = `
      <h3>MULTIPLAYER</h3>
      <div id="mp-off">
        <div class="row"><label for="mp-name">Your name</label><input id="mp-name" maxlength="12" size="12"></div>
        <div class="row"><button id="mp-host" type="button">Host a game</button></div>
        <div class="small" style="margin-top:10px">or join a friend:</div>
        <div class="row"><input id="mp-addr" size="18" placeholder="their address" autocomplete="off" spellcheck="false"></div>
        <div class="row"><input id="mp-join-code" class="code" maxlength="5" placeholder="CODE" autocomplete="off"><button id="mp-join" type="button">Join</button></div>
        <div class="small">Friends must be on one network: Hamachi, Radmin VPN, Tailscale, or the same Wi-Fi.</div>
      </div>
      <div id="mp-on" hidden>
        <div class="small" id="mp-tell"></div>
        <div class="big small" id="mp-addrs" style="font:bold 14px monospace;letter-spacing:0;text-align:left;color:#fff"></div>
        <div class="big" id="mp-code"></div>
        <div class="small" id="mp-roster"></div>
        <div class="row emotes" id="mp-emotes"></div>
        <div class="row"><button id="mp-leave" type="button">Leave room</button></div>
      </div>
      <div id="mp-msg"></div>
      <div class="small">Everyone plays their own game, from their own disc. You just see each other. F4 closes this.</div>`;
    const badge = document.createElement("div");
    badge.id = "mp-badge"; badge.hidden = true; badge.title = "Multiplayer (F4)";
    toastEl = document.createElement("div"); toastEl.id = "mp-toast";
    stageEl.append(panel, badge, toastEl);
    const $ = (id) => panel.querySelector("#" + id);
    mp.ui = { panel, badge, off: $("mp-off"), on: $("mp-on"), msg: $("mp-msg"), code: $("mp-code"), roster: $("mp-roster"), tell: $("mp-tell"), addrs: $("mp-addrs") };
    EMOTES.forEach((t, i) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.title = `Emote ${i + 1}`;
        b.onclick = () => sendEmote(i);
        $("mp-emotes").append(b);
    });
    const nameBox = $("mp-name"), addrBox = $("mp-addr"), codeBox = $("mp-join-code");
    const readName = () => {
        const n = nameBox.value.trim().slice(0, 12) || defaultName();
        try { localStorage.setItem(KEY_NAME, n); } catch { /* storage blocked */ }
        mp.name = n;
    };
    mp.ui.fillName = () => { if (!nameBox.value) nameBox.value = playerName(defaultName()); };   // not at install: the game's state does not exist yet
    try { addrBox.value = localStorage.getItem(KEY_ADDR) || ""; } catch { /* storage blocked */ }
    $("mp-host").onclick = () => { readName(); hostGame(); };
    const join = () => {
        readName();
        const base = testRelay() ? testRelay() : wsAddress(addrBox.value);
        try { localStorage.setItem(KEY_ADDR, addrBox.value.trim()); } catch { /* storage blocked */ }
        mp.hosting = false; mp.host = base ? base.replace(/^ws:\/\//, "") : "";
        connect({ base, room: codeBox.value.trim() });
    };
    $("mp-join").onclick = join;
    codeBox.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
    $("mp-leave").onclick = () => disconnect();
    badge.onclick = () => openPanel(true);
    // typing in the panel must not move the character: stop key events before they reach the game's window handlers
    for (const type of ["keydown", "keyup", "keypress"]) {
        panel.addEventListener(type, (e) => { if (e.key !== "F4" && e.key !== "Escape") e.stopPropagation(); });
    }
    window.addEventListener("keydown", (e) => {
        if (e.key === "F4") { e.preventDefault(); openPanel(); }
        else if (e.key === "Escape" && !panel.hidden && panel.contains(document.activeElement)) openPanel(false);
    });
    // for tests and the console
    window.__mp = { mp, connect, hostGame, disconnect, sendEmote, ghosts: multiplayerGhosts, open: openPanel };
}
