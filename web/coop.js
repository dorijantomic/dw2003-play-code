// EXPERIMENT: optional co-op by remote play (not original game content). Off by default: F2 -> "Co-op".
//
// How it works. The HOST runs the game as usual. A friend (the GUEST) opens coop-guest.html in any browser,
// needing no game files: it shows the host's game as live video and sends the friend's key presses back. The
// host turns those into ordinary keyboard events. Because the host's browser runs the one and only game, there is
// nothing to keep in sync, and the game's own rules are untouched.
//
//   * Connecting is by copy and paste (an invite code and a reply code), over WebRTC, with no server of ours.
//     Without a STUN server it works on the same network or machine; for the internet add one in the panel.
//     (A STUN server only learns your IP address. None is used unless you type one in.)
//   * Who controls what. In a battle the Digimon in front belongs to someone: even party slots to the host, odd
//     slots to the guest. Only the owner's keys reach the game while their Digimon is active, so the control
//     passes when you tag in your partner. Out of battle the host drives; "shared field control" lets both.
//   * Harder fights. While a guest is connected, enemies are tougher (HP and stats scaled), and a wild
//     encounter can bring a second enemy of the same kind (a double ambush: fought one after the other).
//   * Not done: audio for the guest, a gamepad for the guest, and true 2-versus-2 fights.
import { fx } from "./ambience.js";
import { on } from "./gameEvents.js";

const CFG = { hpMult: 1.6, statMult: 1.25, doubleChance: 0.35, stunKey: "dw.coop.stun" };
let pc = null, dc = null, connected = false, sharedField = false, lastController = null;
let panel = null, toastEl = null, toastTimer = 0, gameCanvas = null;
const held = new Set();                     // keys the guest is currently holding (released when control changes)
const downAt = new Map();                    // when each remote key went down
const MIN_HOLD = 60;                         // ms a remote key stays down at least, so a fast tap is still seen by the next frame
const log = [];                              // for tests: what was injected / dropped

const enc = (d) => btoa(unescape(encodeURIComponent(JSON.stringify(d))));
const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.trim()))));
const waitIce = (p, ms = 4000) => new Promise((res) => {
    if (p.iceGatheringState === "complete") return res();
    const t = setTimeout(res, ms);
    p.addEventListener("icegatheringstatechange", () => { if (p.iceGatheringState === "complete") { clearTimeout(t); res(); } });
});
const enabled = () => !!(fx && fx.coop);
const stunServers = () => { try { const s = (localStorage.getItem(CFG.stunKey) || "").trim(); return s ? [{ urls: s }] : []; } catch { return []; } };

// ------------------------------------------------------------ who holds the controls
export function controller() {
    const b = window.__battleB && window.__battleB();
    if (b && window.__battle && window.__battle.isActive && window.__battle.isActive()) return ((b.activePlayerIndex | 0) % 2 === 0) ? "host" : "guest";
    return sharedField ? "both" : "host";
}

function releaseHeld() {
    for (const k of held) window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true, cancelable: true }));
    held.clear();
}

// the host's own keystrokes do nothing while the guest holds the controls (F-keys, Esc and typing still work)
function installGate() {
    for (const type of ["keydown", "keyup"]) {
        window.addEventListener(type, (e) => {
            if (!connected || !e.isTrusted || /^F\d+$/.test(e.key) || e.key === "Escape") return;
            if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
            if (controller() === "guest") { e.stopImmediatePropagation(); e.preventDefault(); log.push({ dropped: "host", key: e.key, type }); }
        }, true);
    }
}

function onGuestMessage(raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t !== "key" || typeof m.key !== "string") return;
    const c = controller();
    if (c === "host") { log.push({ dropped: "guest", key: m.key, type: m.d ? "keydown" : "keyup" }); return; }
    const type = m.d ? "keydown" : "keyup";
    const fire = () => {
        if (!m.d) held.delete(m.key);
        window.dispatchEvent(new KeyboardEvent(type, { key: m.key, code: m.code || "", bubbles: true, cancelable: true }));
        log.push({ injected: m.key, type });
    };
    if (m.d) { held.add(m.key); downAt.set(m.key, performance.now()); fire(); return; }
    // The game's screens read "is this button held THIS frame". A remote tap whose down and up arrive together
    // would be gone before a frame sees it, so every remote key is held for at least MIN_HOLD ms.
    const wait = Math.max(0, MIN_HOLD - (performance.now() - (downAt.get(m.key) ?? 0)));
    if (wait > 0) setTimeout(fire, wait); else fire();
}

function sendState() {
    const c = controller();
    if (c === lastController && !sendState.force) return;
    if (lastController === "guest" && c !== "guest") releaseHeld();
    lastController = c; sendState.force = false;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify({ t: "state", c, battle: !!(window.__battle && window.__battle.isActive && window.__battle.isActive()) }));
}

// ------------------------------------------------------------ connection (manual signalling)
function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.style.opacity = "1";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.style.opacity = "0"; }, 4200);
}
function wireChannel(ch) {
    dc = ch;
    ch.onopen = () => { connected = true; sendState.force = true; sendState(); toast("Co-op: friend connected"); renderPanel(); };
    ch.onclose = () => { if (connected) toast("Co-op: friend left"); connected = false; releaseHeld(); renderPanel(); };
    ch.onmessage = (e) => onGuestMessage(e.data);
}
export async function createInvite() {
    closeConnection();
    pc = new RTCPeerConnection({ iceServers: stunServers() });
    wireChannel(pc.createDataChannel("input"));
    const stream = gameCanvas.captureStream(30);
    for (const t of stream.getVideoTracks()) pc.addTrack(t, stream);
    pc.onconnectionstatechange = () => { if (["failed", "closed", "disconnected"].includes(pc.connectionState)) { connected = false; releaseHeld(); renderPanel(); } };
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    return enc(pc.localDescription.toJSON());
}
export async function acceptReply(code) {
    if (!pc) throw new Error("create an invite first");
    await pc.setRemoteDescription(dec(code));
}
export function closeConnection() {
    releaseHeld();
    try { dc && dc.close(); } catch { /* already closed */ }
    try { pc && pc.close(); } catch { /* already closed */ }
    pc = dc = null; connected = false; lastController = null;
}

// ------------------------------------------------------------ tougher fights while a friend is connected
on("partyBuilt", ({ entries, kind }) => {
    if (!connected || !enabled()) return;
    if (fx.coopharder) {
        for (const e of entries) {
            if (Number.isFinite(e.enemyHp)) e.enemyHp = Math.round(e.enemyHp * CFG.hpMult);
            e.enemyStatScale = Math.round((e.enemyStatScale ?? 16) * CFG.statMult);
        }
    }
    if (fx.coopdouble && kind === "random" && entries.length === 1 && Math.random() < (window.__coop?.config?.doubleChance ?? CFG.doubleChance)) {
        entries.push({ ...entries[0] });      // a second one of the same kind: fought after the first
    }
});

// ------------------------------------------------------------ the panel (F4)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function renderPanel() {
    if (!panel || panel.hidden) return;
    const url = new URL("coop-guest.html", location.href).href;
    const c = connected ? controller() : null;
    panel.innerHTML = `<h3>CO-OP <span>F4 / Esc to close</span></h3>
      <div class="cs">${connected ? `Friend connected. Controls: <b>${c === "both" ? "both of you (shared)" : c === "guest" ? "your friend" : "you"}</b>` : pc ? "Waiting for your friend's reply..." : "Not connected."}</div>
      <div class="ct">Your friend opens <code>${esc(url)}</code> and pastes your invite there.</div>
      <label>Optional STUN server (internet play) <input data-coop="stun" placeholder="stun:host:port" value="${esc(localStorage.getItem(CFG.stunKey) || "")}"></label>
      <button data-coop="invite">1. Create invite</button>
      <textarea data-coop="invitebox" readonly placeholder="Invite code appears here. Copy it to your friend."></textarea>
      <label>2. Paste your friend's reply <textarea data-coop="replybox" placeholder="Reply code"></textarea></label>
      <button data-coop="connect">3. Connect</button>
      <label class="chk"><input type="checkbox" data-coop="shared" ${sharedField ? "checked" : ""}> Shared field control (both can walk and use menus)</label>
      <label class="chk"><input type="checkbox" data-fx="coopharder" ${fx.coopharder ? "checked" : ""}> Tougher enemies while connected</label>
      <label class="chk"><input type="checkbox" data-fx="coopdouble" ${fx.coopdouble ? "checked" : ""}> Wild fights can bring a second enemy</label>
      <button data-coop="leave">Disconnect</button>
      <div class="ct">Battles: your Digimon in the front slot are yours; every other slot is your friend's. Control passes when you tag in. No audio for your friend yet.</div>`;
}
function installUi(stageEl) {
    const css = document.createElement("style");
    css.textContent = `
      #coop-panel { position:absolute; top:44px; left:8px; z-index:42; width:300px; max-height:calc(100% - 60px); overflow-y:auto; padding:10px 14px 12px;
        border:2px solid #45456a; border-radius:10px; background:#1d1d2bf2; color:#e8e8f0; font:13px/1.5 "Segoe UI",system-ui,sans-serif; box-shadow:0 8px 30px #000; }
      #coop-panel[hidden] { display:none; } #coop-panel h3 { margin:0 0 4px; font-size:13px; color:#ffd34d; letter-spacing:1px; }
      #coop-panel h3 span { color:#707090; font-size:10px; letter-spacing:0; margin-left:6px; } #coop-panel .ct { color:#8a8aa8; font-size:11px; margin:6px 0; } #coop-panel .cs { margin:4px 0; }
      #coop-panel code { font-size:11px; color:#9ad7a0; word-break:break-all; } #coop-panel textarea, #coop-panel input:not([type=checkbox]) { width:100%; box-sizing:border-box; background:#252540; color:#e8e8f0; border:1px solid #45456a; border-radius:4px; font:11px monospace; }
      #coop-panel textarea { height:54px; } #coop-panel label { display:block; margin:6px 0 2px; font-size:12px; } #coop-panel label.chk { display:flex; gap:6px; align-items:center; }
      #coop-panel button { background:#2a2a40; color:#e8e8f0; border:1px solid #45456a; border-radius:4px; padding:3px 10px; font:inherit; cursor:pointer; margin:4px 4px 4px 0; }
      #coop-toast { position:absolute; left:50%; top:14px; transform:translateX(-50%); z-index:52; padding:6px 14px; border-radius:8px; background:#000c; color:#fff; font:600 13px 'Segoe UI',system-ui,sans-serif; pointer-events:none; opacity:0; transition:opacity .3s; }`;
    document.head.appendChild(css);
    panel = document.createElement("div"); panel.id = "coop-panel"; panel.hidden = true;
    toastEl = document.createElement("div"); toastEl.id = "coop-toast";
    stageEl.append(panel, toastEl);
    panel.addEventListener("keydown", (e) => e.stopPropagation());
    panel.addEventListener("change", (e) => {
        const t = e.target;
        if (t.dataset.coop === "shared") sharedField = t.checked;
        else if (t.dataset.coop === "stun") { try { localStorage.setItem(CFG.stunKey, t.value.trim()); } catch { /* private window */ } }
        else if (t.dataset.fx) { fx[t.dataset.fx] = t.checked; }
    });
    panel.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-coop]");
        if (!b || b.tagName !== "BUTTON") return;
        try {
            if (b.dataset.coop === "invite") { const code = await createInvite(); renderPanel(); panel.querySelector('[data-coop="invitebox"]').value = code; panel.querySelector('[data-coop="invitebox"]').select(); }
            else if (b.dataset.coop === "connect") { await acceptReply(panel.querySelector('[data-coop="replybox"]').value); toast("Co-op: connecting..."); }
            else if (b.dataset.coop === "leave") { closeConnection(); renderPanel(); }
        } catch (err) { toast("Co-op: " + (err.message || err)); }
    });
    window.addEventListener("keydown", (e) => {
        if (e.key === "F4" && enabled()) { e.preventDefault(); panel.hidden = !panel.hidden; renderPanel(); }
        else if (e.key === "Escape" && !panel.hidden && e.isTrusted) { panel.hidden = true; }
    });
}

export function installCoop({ stageEl, canvas }) {
    if (!stageEl || !canvas || gameCanvas) return;
    gameCanvas = canvas;
    installUi(stageEl);
    installGate();
    setInterval(() => { if (connected) sendState(); }, 250);
    window.__coop = {      // debug / test hooks; nothing in the game reads these
        createInvite, acceptReply, closeConnection, controller,
        get connected() { return connected; }, get log() { return log; }, config: CFG,
        setShared: (v) => { sharedField = !!v; },
    };
}
