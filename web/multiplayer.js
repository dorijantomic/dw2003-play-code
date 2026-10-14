// EXPERIMENT: optional multiplayer (not original game content). F4 opens a small panel; the social dock (web/mpsocial.js)
// shows the chat, the activity feed, the player list, inspect and trading once you are in a room.
//
//   HOST:  press "Host a game". Your game starts a small relay on your own computer (no account, nothing to install) and
//          the panel shows your address and a five-letter code to tell your friends.
//   JOIN:  type the host's address and the code, press "Join".
//
// Friends reach the host's computer the usual way for LAN-style games: all on one network. Hamachi, Radmin VPN or
// Tailscale put friends on one network over the internet; the panel recognises those addresses and names them.
//
// Everyone runs their own copy of the game from their own disc, with their own story, saves and battles. The relay
// (server/relay.mjs) only passes names, positions, chat lines, player cards and agreed trades between the players in one
// room: nothing from anyone's disc. For tests, `?relay=ws://host:port` on the page address skips the launcher.
//
//   multiplayerTick(mapId, state)   called every frame: remembers where I am and moves the others smoothly
//   multiplayerGhosts(mapId)        the other players standing in this stage, for game.js to draw
//   multiplayerSelf()               me, as a ghost-like record (name tag, speech bubble, emote) when online

const PORT = 20031;             // the relay's port on the host's computer
const KEY_ADDR = "dw.mp.addr";
const SEND_MS = 100;            // at most ten position updates a second
const BEAT_MS = 2000;           // standing still, still say "I am here" now and then
const STALE_MS = 9000;          // a player silent this long is hidden (their connection probably dropped)
const SNAP = 140;               // farther away than this (a map change, a warp): jump instead of gliding
const SAY_MS = 6500;            // how long a speech bubble stays over a head
export const EMOTES = ["♥", "!", "?", "...", "♪", ":)", "GG", "zZ"];   // 0..7

const mp = {
    ws: null, status: "off", room: null, id: null, name: "",
    addresses: [], hosting: false, host: "",   // the host's own addresses, to show to friends
    peers: new Map(),           // id -> { name, map, x, y, tx, ty, dir, mv, animTime, seen, emote, emoteUntil, say, sayUntil, card }
    me: { map: null, x: 0, y: 0, dir: "down", mv: 0, say: "", sayUntil: 0, emote: "", emoteUntil: 0 },
    sent: { map: null, x: 0, y: 0, dir: "", mv: 0, at: 0 },
    retry: 0, retryTimer: 0, want: null, beat: 0,
    ui: null, lastTick: 0,
};

// ------------------------------------------------------------ events for the social dock
const listeners = new Set();
/** fn(type, data): "status" | "roster" | "chat" {id,name,text,self} | "feed" {id,name,kind,text} | "sys" {text} | "trade" {...} */
export const mpOn = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (type, data = {}) => { for (const f of [...listeners]) { try { f(type, data); } catch (e) { console.warn("[multiplayer]", e); } } };

export const isOnline = () => mp.status === "online";
export const myId = () => mp.id;
export const myName = () => mp.name;
/** Everyone in the room except me: [{ id, name, map, card }] */
export const peerList = () => [...mp.peers].map(([id, p]) => ({ id, name: p.name, map: p.map, card: p.card }));
export const peerOf = (id) => mp.peers.get(id) ?? null;

/** What a friend typed ("25.1.2.3", "25.1.2.3:20031", "ws://...") -> a WebSocket address, or null. */
function wsAddress(text) {
    let h = String(text ?? "").trim().replace(/^(wss?|https?):\/\//i, "").replace(/\/.*$/, "");
    if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(h)) return null;
    if (!h.includes(":")) h += ":" + PORT;
    return "ws://" + h;
}
const testRelay = () => new URLSearchParams(location.search).get("relay");

// ------------------------------------------------------------ connection
const REASONS = {
    no_room: "Connected, but there is no room with that code. Check the code with your friend.",
    full: "That room is full.",
    busy: "The server is busy. Try again in a moment.",
    bad: "That is not a room code (five letters and numbers).",
    exists: "That code is taken. Try again.",
};

function setStatus(s, text) { mp.status = s; render(text); emit("status", { status: s }); }

/** want = { base: "ws://host:port", create: true } or { base, room: "ABCDE" } */
export function connect(want) {
    disconnect(true);
    const base = want.base;
    if (!base) { setStatus("off", "That address does not look right. Use the numbers your friend shows, like 25.1.2.3"); return; }
    mp.want = want;
    mp.name = (mp.name || "Tamer").slice(0, 12);
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
            for (const p of m.roster) { const q = newPeer(p.name); q.map = p.map ?? null; q.card = p.card ?? null; mp.peers.set(p.id, q); }
            mp.sent.at = 0; mp.sent.map = null;                                  // announce myself straight away
            setStatus("online");
            emit("sys", { text: `You joined room ${m.room}.` });
            emit("roster");
        } else if (m.t === "err") {
            mp.want = null;
            setStatus("off", REASONS[m.reason] ?? "The server said no.");
        } else if (m.t === "join") {
            mp.peers.set(m.id, newPeer(m.name)); render(); toast(`${m.name} joined`);
            emit("sys", { text: `${m.name} joined.` }); emit("roster");
        } else if (m.t === "leave") {
            const p = mp.peers.get(m.id); mp.peers.delete(m.id); render(); if (p) toast(`${p.name} left`);
            if (p) emit("sys", { text: `${p.name} left.` }); emit("roster");
        } else if (m.t === "gone") {
            const p = mp.peers.get(m.id); if (p) p.hidden = true;
        } else if (m.t === "at") {
            const p = mp.peers.get(m.id); if (p) { p.map = m.map; emit("roster"); }
        } else if (m.t === "pos") {
            const p = mp.peers.get(m.id) ?? (mp.peers.set(m.id, newPeer("Tamer")), mp.peers.get(m.id));
            const jump = p.map !== m.map || p.hidden || Math.hypot(m.x - p.tx, m.y - p.ty) > SNAP;
            const moved = p.map !== m.map;
            p.map = m.map; p.hidden = false; p.tx = m.x; p.ty = m.y; p.dir = m.dir; p.mv = m.mv; p.seen = performance.now();
            if (jump || p.x == null) { p.x = m.x; p.y = m.y; }
            if (moved) emit("roster");
        } else if (m.t === "emote") {
            const p = mp.peers.get(m.id); if (p) { p.emote = EMOTES[m.e] ?? ""; p.emoteUntil = performance.now() + 2500; }
        } else if (m.t === "chat") {
            const p = mp.peers.get(m.id); if (!p) return;
            p.say = m.text; p.sayUntil = performance.now() + sayTime(m.text);
            emit("chat", { id: m.id, name: p.name, text: m.text, self: false });
        } else if (m.t === "feed") {
            const p = mp.peers.get(m.id); if (!p) return;
            emit("feed", { id: m.id, name: p.name, kind: m.kind, text: m.text });
        } else if (m.t === "card") {
            const p = mp.peers.get(m.id); if (!p) return;
            p.card = m.card; emit("roster");
        } else if (m.t === "trade") {
            emit("trade", m);
        }
    };
    ws.onclose = () => {
        if (mp.ws !== ws) return;                  // I closed it myself
        mp.ws = null; mp.peers.clear(); emit("roster");
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

function newPeer(name) { return { name, map: null, x: null, y: null, tx: 0, ty: 0, dir: "down", mv: 0, animTime: 0, seen: 0, emote: "", emoteUntil: 0, say: "", sayUntil: 0, card: null, hidden: false }; }
export const sendRaw = (o) => { if (mp.ws?.readyState === 1) { mp.ws.send(JSON.stringify(o)); return true; } return false; };
const sayTime = (text) => Math.min(SAY_MS + 3000, 3200 + text.length * 70);

export function sendEmote(i) {
    sendRaw({ t: "emote", e: i });
    mp.me.emote = EMOTES[i] ?? ""; mp.me.emoteUntil = performance.now() + 2500;
}

/** Say something: it goes to everyone's chat log, and shows over my head here and over my character for players in my stage. */
export function sendChat(text) {
    text = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!text) return false;
    mp.me.say = text; mp.me.sayUntil = performance.now() + sayTime(text);
    emit("chat", { id: mp.id, name: mp.name, text, self: true });
    return sendRaw({ t: "chat", text });
}
export function sendFeed(kind, text) { return sendRaw({ t: "feed", kind, text }); }
export function sendCard(card) { return sendRaw({ t: "card", card }); }
export const sendTrade = (o) => sendRaw({ t: "trade", ...o });

// ------------------------------------------------------------ every frame
/** Called from the game's render loop: just remembers where I am. Sending runs on a timer so a hidden window still says "I am here". */
export function multiplayerTick(mapId, st) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - (mp.lastTick || now)) / 1000);
    mp.lastTick = now;
    mp.me.map = mapId; mp.me.x = Math.round(st.x); mp.me.y = Math.round(st.y); mp.me.dir = st.dir;
    mp.me.mv = st.moving || st._cutTarget ? 1 : 0;
    if (mp.status !== "online") return;
    // glide the others toward their latest position, and run their walk animation while they are moving
    for (const p of mp.peers.values()) {
        if (p.x == null) continue;
        const k = Math.min(1, dt * 14);
        p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
        p.moving = !!p.mv || Math.hypot(p.tx - p.x, p.ty - p.y) > 1.5;
        if (p.moving) p.animTime += dt; else p.animTime = 0;
    }
}

function sendPresence() {
    if (mp.status !== "online" || !mp.me.map) return;
    const now = performance.now(), m = mp.me, s = mp.sent;
    const changed = s.map !== m.map || s.x !== m.x || s.y !== m.y || s.dir !== m.dir || s.mv !== m.mv;
    if ((changed && (now - s.at >= SEND_MS || s.map !== m.map)) || now - s.at >= BEAT_MS) {
        if (sendRaw({ t: "pos", map: m.map, x: m.x, y: m.y, dir: m.dir, mv: m.mv })) mp.sent = { map: m.map, x: m.x, y: m.y, dir: m.dir, mv: m.mv, at: now };
    }
}

/** The other players standing in this stage: [{ id, name, x, y, dir, moving, animTime, emote, say }] */
export function multiplayerGhosts(mapId) {
    if (mp.status !== "online") return [];
    const now = performance.now(), out = [];
    for (const [id, p] of mp.peers) {
        if (p.map !== mapId || p.hidden || p.x == null || now - p.seen > STALE_MS) continue;
        out.push({ id, name: p.name, x: p.x, y: p.y, dir: p.dir, moving: p.moving, animTime: p.animTime,
            emote: now < p.emoteUntil ? p.emote : "", say: now < p.sayUntil ? p.say : "" });
    }
    return out;
}

/** Me, for the name tag, my own speech bubble and my emote (null when not in a room). */
export function multiplayerSelf() {
    if (mp.status !== "online") return null;
    const now = performance.now(), m = mp.me;
    return { id: mp.id, name: mp.name, emote: now < m.emoteUntil ? m.emote : "", say: now < m.sayUntil ? m.say : "" };
}

/** Name tag, emote and speech bubble over a player; (sx, headY) is the point just above the head on the canvas (the game's balloon anchor). */
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
    // speech is drawn by the game itself: its own balloon, one per speaker (see mpBalloon in game.js)
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
      <div class="small">Your name is the one you gave your character. Chat, trade and inspect are in the box at the bottom left. F4 closes this.</div>`;
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
    // The name is the one the player gave their character (so SENIOR stays SENIOR); the box lets them change it for this room only.
    const readName = () => { mp.name = nameBox.value.trim().slice(0, 12) || defaultName(); };
    mp.ui.fillName = () => { if (mp.status === "off") nameBox.value = defaultName(); };   // not at install: the game's state does not exist yet
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
    mp.beat = setInterval(sendPresence, 50);     // a timer, not the render loop: a hidden or covered window still says "I am here"
    // for tests and the console
    window.__mp = { mp, connect, hostGame, disconnect, sendEmote, sendChat, ghosts: multiplayerGhosts, open: openPanel };
}
