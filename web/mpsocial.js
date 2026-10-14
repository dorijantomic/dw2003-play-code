// EXPERIMENT: the social side of the optional multiplayer (not original game content).
//
// A see-through box at the bottom left once you are in a room:
//   ALL / CHAT / EVENTS  the chat history, and what everyone is doing (level ups, digivolutions, finished quests, joins)
//   PLAYERS              who is here, their level and Digimon, where they are; Inspect, Trade, Go there
//   a line to type in    your words also appear over your character's head, for everyone in the same place
// Inspect shows a player's card (their name exactly as they typed it, their Digimon, levels, HP/MP, stats, BIT, quests).
// Trade swaps items and BIT between two players; both press Confirm on the same offer and each game moves its own items.
//
// Nothing here writes a story flag. Names and chat from other players are only ever put on the page as text.
import { mpOn, isOnline, myId, myName, peerList, peerOf, sendChat, sendFeed, sendCard, sendTrade, sendDuel, sendCoop } from "./multiplayer.js";

const MAX_LOG = 300;
const S = { tab: "all", log: [], collapsed: false, unread: 0 };
let api = null, dock = null, el = {}, trade = null, duel = null, inspectId = null, goArm = null;
let prevParty = null, lastCardJson = "";

// ------------------------------------------------------------ small helpers
const h = (tag, cls, ...kids) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const k of kids) { if (k == null || k === false) continue; e.append(k.nodeType ? k : document.createTextNode(String(k))); }
    return e;
};
const btn = (label, onclick, cls = "") => { const b = h("button", cls, label); b.type = "button"; b.onclick = onclick; return b; };
const clock = () => new Date().toTimeString().slice(0, 5);
const hue = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };
const nameColor = (n) => `hsl(${hue(n)} 85% 72%)`;
const place = (mapId) => (mapId ? (api.mapName(mapId) || mapId) : "somewhere new");
const note = (text) => add({ k: "sys", text });

function add(entry) {
    entry.at = clock();
    S.log.push(entry);
    if (S.log.length > MAX_LOG) S.log.shift();
    if (S.collapsed || S.tab === "players") S.unread++;
    drawLog();
}

// ------------------------------------------------------------ the log
const KIND = { level: ["▲", "#ffd34d"], quest: ["★", "#7dffa0"], evolve: ["◆", "#ff9af0"], info: ["•", "#9ad0ff"] };

function drawLog() {
    if (!el.log) return;
    const near = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 40;
    el.log.replaceChildren();
    for (const e of S.log) {
        if (S.tab === "chat" && e.k !== "chat") continue;
        if (S.tab === "events" && e.k === "chat") continue;
        const row = h("div", "ln " + e.k);
        row.append(h("span", "tm", e.at));
        if (e.k === "chat") {
            const n = h("b", "", e.name); n.style.color = nameColor(e.name);
            row.append(n, ": ", e.text);
        } else if (e.k === "feed") {
            const [icon, col] = KIND[e.kind] ?? KIND.info;
            const i = h("span", "", icon + " "); i.style.color = col;
            const n = h("b", "", e.name); n.style.color = nameColor(e.name);
            row.append(i, n, " ", e.text);
        } else row.append(e.text);
        el.log.append(row);
    }
    if (near) el.log.scrollTop = el.log.scrollHeight;
    badge();
}

function badge() {
    if (!el.tabs) return;
    const n = peerList().length + 1;
    el.tabs.players.textContent = `PLAYERS ${n}`;
    el.unread.textContent = S.collapsed && S.unread ? String(Math.min(S.unread, 99)) : "";
    el.unread.hidden = !(S.collapsed && S.unread);
}

function setTab(t) {
    S.tab = t; if (t !== "players") S.unread = 0;
    for (const [k, b] of Object.entries(el.tabs)) b.classList.toggle("on", k === t);
    el.log.hidden = t === "players"; el.players.hidden = t !== "players";
    if (t === "players") drawPlayers(); else drawLog();
}

// ------------------------------------------------------------ players
function levelLine(card) {
    const lead = card?.party?.[0];
    return lead ? `Lv ${lead.lv} ${lead.f || lead.n}` : card ? "no Digimon yet" : "no card yet";
}

function drawPlayers() {
    if (!el.players || el.players.hidden) { badge(); return; }
    el.players.replaceChildren();
    const here = api.currentMapId();
    const sel = h("select");
    for (const v of [1, 2, 3]) { const o = h("option", "", `x${v}`); o.value = String(v); sel.append(o); }
    sel.value = String(strength());
    sel.onchange = () => { try { localStorage.setItem(KEY_STR, sel.value); } catch { /* storage blocked */ } };
    el.players.append(h("div", "sub", "Co-op boss strength ", sel, partner != null ? `   Partner: ${peerOf(partner)?.name ?? "?"}` : ""));
    const rows = [{ id: myId(), name: myName(), map: here, card: api.card(), self: true }, ...peerList()];
    for (const p of rows) {
        const nm = h("b", "nm", (p.id === partner ? "★ " : "") + p.name); nm.style.color = nameColor(p.name);
        const where = h("div", "sub", `${levelLine(p.card)}  ·  ${place(p.map)}${p.map && p.map === here ? "  ●" : ""}`);
        const acts = h("div", "acts", btn("Inspect", () => openInspect(p.id)));
        if (!p.self) {
            acts.append(btn("Trade", () => askTrade(p.id)), btn("Duel", () => askDuel(p.id)),
                p.id === partner ? btn("Leave party", leaveParty) : btn("Team up", () => askParty(p.id)));
            if (p.map && p.map !== here) {
                const go = btn(goArm === p.id ? "Sure?" : "Go", () => {
                    if (goArm !== p.id) { goArm = p.id; setTimeout(() => { if (goArm === p.id) { goArm = null; drawPlayers(); } }, 2500); drawPlayers(); return; }
                    goArm = null;
                    if (!api.warp(p.map)) note("Not now - finish what you are doing first.");
                    else note(`You went to ${place(p.map)} to find ${p.name}.`);
                    drawPlayers();
                });
                go.title = `Travel to ${place(p.map)}. Your story is not changed.`;
                acts.append(go);
            }
        }
        el.players.append(h("div", "pl", h("div", "who", nm, p.self ? " (you)" : ""), where, acts));
    }
    badge();
}

// ------------------------------------------------------------ inspect
function bar(v, max, cls) {
    const w = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
    const b = h("div", "bar " + cls); const f = h("i"); f.style.width = w + "%"; b.append(f); return b;
}

function openInspect(id) {
    inspectId = id; drawInspect();
}
function closeInspect() { inspectId = null; if (el.inspect) el.inspect.hidden = true; }

function drawInspect() {
    if (inspectId == null || !el.inspect) return;
    const self = inspectId === myId();
    const p = self ? { name: myName(), map: api.currentMapId(), card: api.card() } : peerOf(inspectId);
    if (!p) { closeInspect(); return; }
    const c = p.card;
    const box = el.inspect; box.hidden = false; box.replaceChildren();
    const title = h("div", "ttl", p.name); title.style.color = nameColor(p.name);
    box.append(h("div", "hd", title, btn("×", closeInspect, "x")));
    box.append(h("div", "sub", `${place(p.map)}${c?.chapter ? `  ·  Chapter ${c.chapter}` : ""}`));
    if (!c) { box.append(h("div", "sub", "This player's card has not arrived yet.")); return; }
    box.append(h("div", "sub", `${c.bits ?? 0} BIT  ·  ${c.quests ?? 0} extra quest${c.quests === 1 ? "" : "s"} done`));
    for (const d of c.party ?? []) {
        const card = h("div", "dg");
        const nick = d.n && d.f && d.n !== d.f ? `${d.n} (${d.f})` : (d.n || d.f);
        card.append(h("div", "dn", `${nick}  `, h("span", "lv", `Lv ${d.lv}`)));
        card.append(h("div", "hp", "HP", bar(d.hp, d.mhp, "g"), `${d.hp}/${d.mhp}`));
        card.append(h("div", "hp", "MP", bar(d.mp, d.mmp, "b"), `${d.mp}/${d.mmp}`));
        const st = Object.entries(d.st ?? {});
        if (st.length) card.append(h("div", "stats", st.map(([k, v]) => `${k.toUpperCase()} ${v}`).join("   ")));
        box.append(card);
    }
    if (!(c.party ?? []).length) box.append(h("div", "sub", "No Digimon yet."));
    if (!self) { const id = inspectId; box.append(h("div", "acts", btn("Trade", () => { closeInspect(); askTrade(id); }), btn("Duel", () => { closeInspect(); askDuel(id); }))); }
}

// ------------------------------------------------------------ trading
const offerLine = (o) => {
    const parts = (o?.items ?? []).map((i) => `${i.qty} x ${i.name || "item " + i.id}`);
    if (o?.bits) parts.push(`${o.bits} BIT`);
    return parts.join(", ") || "nothing";
};

function newTrade(st, id) { return { st, id, mine: { items: {}, bits: 0 }, theirs: { items: [], bits: 0 }, myOk: false, theirOk: false, bag: [] }; }

function askTrade(id) {
    if (trade) { note("You are already in a trade."); return; }
    const p = peerOf(id); if (!p) return;
    trade = newTrade("out", id);
    sendTrade({ op: "ask", to: id });
    drawTrade();
}

function myOffer() {
    const held = new Map(trade.bag.map((b) => [b.id, b]));
    const items = [];
    for (const [id, qty] of Object.entries(trade.mine.items)) {
        const b = held.get(+id);
        if (b && qty > 0) items.push({ id: +id, qty: Math.min(qty, b.qty), name: b.name });
    }
    return { items, bits: Math.max(0, Math.min(trade.mine.bits | 0, api.bits())) };
}
function pushOffer() { trade.myOk = false; trade.theirOk = false; sendTrade({ op: "offer", ...myOffer() }); }

function endTrade(msg) {
    if (msg) note(msg);
    trade = null; if (el.trade) el.trade.hidden = true;
}

function drawTrade() {
    const box = el.trade; if (!box) return;
    if (!trade) { box.hidden = true; return; }
    const other = peerOf(trade.id);
    const who = other?.name ?? "that player";
    box.hidden = false; box.replaceChildren();
    const title = h("div", "ttl", `Trade with ${who}`);
    box.append(h("div", "hd", title, btn("×", () => cancelTrade(), "x")));
    if (trade.st === "out") { box.append(h("div", "sub", `Waiting for ${who} to answer...`), h("div", "acts", btn("Cancel", cancelTrade))); return; }
    if (trade.st === "in") {
        box.append(h("div", "sub", `${who} would like to trade with you.`),
            h("div", "acts", btn("Accept", () => sendTrade({ op: "yes" })), btn("Decline", () => { sendTrade({ op: "no" }); endTrade(`You declined ${who}.`); })));
        return;
    }
    // open: left = what I give, right = what they give
    const cols = h("div", "cols");
    const mine = h("div", "col", h("div", "sub", "You give"));
    const list = h("div", "bag");
    if (!trade.bag.length) list.append(h("div", "sub", "Nothing you can trade."));
    for (const b of trade.bag) {
        const q = trade.mine.items[b.id] ?? 0;
        const row = h("div", "it" + (q ? " pick" : ""), h("span", "in", b.name), h("span", "ct", `${q}/${b.qty}`),
            btn("-", () => { trade.mine.items[b.id] = Math.max(0, q - 1); pushOffer(); drawTrade(); }),
            btn("+", () => { trade.mine.items[b.id] = Math.min(b.qty, q + 1); pushOffer(); drawTrade(); }));
        list.append(row);
    }
    const bits = h("input"); bits.type = "number"; bits.min = "0"; bits.max = String(api.bits()); bits.value = String(trade.mine.bits || 0); bits.className = "bits";
    bits.onchange = () => { trade.mine.bits = Math.max(0, Math.min(api.bits(), bits.value | 0)); pushOffer(); drawTrade(); };
    mine.append(list, h("div", "sub", "BIT ", bits, ` of ${api.bits()}`));
    const theirs = h("div", "col", h("div", "sub", `${who} gives`), h("div", "offer", offerLine(trade.theirs)),
        h("div", "sub", trade.theirOk ? `${who} confirmed.` : `${who} has not confirmed.`));
    cols.append(mine, theirs);
    box.append(cols);
    box.append(h("div", "sub", `You give: ${offerLine(myOffer())}`));
    box.append(h("div", "acts",
        btn(trade.myOk ? "Confirmed - waiting" : "Confirm trade", confirmTrade, trade.myOk ? "on" : ""), btn("Cancel", cancelTrade)));
}

function confirmTrade() {
    if (!trade || trade.myOk) return;
    trade.bag = api.tradable();                                    // what I really have right now
    const o = myOffer();
    const same = o.items.length === Object.values(trade.mine.items).filter((q) => q > 0).length
        && o.items.every((i) => trade.mine.items[i.id] === i.qty) && o.bits === (trade.mine.bits | 0);
    if (!same) {                                                   // I no longer have all of it: fix the offer, and ask again
        trade.mine.items = Object.fromEntries(o.items.map((i) => [i.id, i.qty])); trade.mine.bits = o.bits;
        pushOffer(); note("Your offer changed (you no longer had all of it). Check it, then confirm again."); drawTrade();
        return;
    }
    sendTrade({ op: "ok" });                                       // only the confirmation: sending the offer again would clear the other player's OK
    trade.myOk = true;
    drawTrade();
}
function cancelTrade() { if (trade) sendTrade({ op: "cancel" }); endTrade(); }

const END_TEXT = { declined: "declined the trade.", cancelled: "cancelled the trade.", left: "left the room.", busy: "is busy with another trade.", gone: "is not here any more." };

function onTrade(m) {
    if (m.op === "ask") {
        trade = newTrade("in", m.from);
        const n = peerOf(m.from)?.name ?? "A player";
        note(`${n} wants to trade. Open the trade window to answer.`);
        if (S.collapsed) toggleCollapse();
        drawTrade();
    } else if (m.op === "open" && trade) {
        trade.st = "open"; trade.bag = api.tradable(); drawTrade();
    } else if (m.op === "offer" && trade) {
        if (m.from === myId()) return;                             // the echo of my own change: pushOffer already reset the flags
        trade.theirs = { items: m.items, bits: m.bits };
        trade.myOk = false; trade.theirOk = false; drawTrade();
    } else if (m.op === "ok" && trade) {
        trade.theirOk = true; drawTrade();
    } else if (m.op === "done" && trade) {
        const n = peerOf(trade.id)?.name ?? "the other player";
        const r = api.exchange(m.gives, m.gets);
        endTrade(`Trade with ${n} done. You gave ${offerLine(m.gives)}; you got ${offerLine(m.gets)}.${r ? " " + r : ""}`);
    } else if (m.op === "end") {
        const n = peerOf(trade?.id)?.name ?? "The other player";
        endTrade(trade ? `${n} ${END_TEXT[m.reason] ?? "ended the trade."}` : null);
    }
}


// ------------------------------------------------------------ duels
// A friendly duel: you each fight a copy of the other's team (their Digimon, levels and HP from their card), played by the
// computer, using the game's own battle. Nothing is kept: EXP, drops and BIT from it are taken back afterwards. Each side
// then sends how it went; the one who did better against the other's team wins.
function askDuel(id) {
    if (duel || trade) { note("Finish what you are doing first."); return; }
    const p = peerOf(id); if (!p) return;
    if (!p.card?.party?.length) { note(`${p.name} has no Digimon to fight with yet.`); return; }
    if (!api.canFight()) { note("Not now - finish what you are doing first."); return; }
    duel = { st: "out", id, mine: null, theirs: null };
    sendDuel({ op: "ask", to: id });
    drawDuel();
}

function startFight() {
    const p = peerOf(duel?.id);
    if (!p) { endDuel("They left."); return; }
    duel.st = "fight"; drawDuel();
    const started = api.startDuel(p.card, (res) => {
        if (!duel) return;
        duel.mine = res; duel.st = "wait";
        sendDuel({ op: "result", to: duel.id, hp: res.hp, won: res.won });
        drawDuel(); verdict();
    });
    if (!started) { sendDuel({ op: "cancel", to: duel.id }); endDuel("The duel could not start (are you busy, or without a Digimon?)."); }
}

function verdict() {
    if (!duel?.mine) return;
    const n = peerOf(duel.id)?.name ?? "your friend";
    if (!duel.theirs) { if (!peerOf(duel.id)) endDuel(`${n} left before finishing the duel.`); return; }
    const score = (r) => (r.won ? 1 : 0) + r.hp, me = score(duel.mine), them = score(duel.theirs);
    const pct = (r) => (r.won ? `won with ${Math.round(r.hp * 100)}% HP left` : "lost");
    const text = Math.abs(me - them) < 0.02 ? "A draw!" : me > them ? `You win the duel against ${n}!` : `${n} wins the duel.`;
    endDuel(`Duel with ${n}: ${text}  (you ${pct(duel.mine)}; ${n} ${pct(duel.theirs)})`);
}

function endDuel(msg) {
    const won = duel?.mine && duel?.theirs && (duel.mine.won ? 1 : 0) + duel.mine.hp > (duel.theirs.won ? 1 : 0) + duel.theirs.hp + 0.02;
    const n = peerOf(duel?.id)?.name;
    if (msg) note(msg);
    if (won && n) post("info", `beat ${n} in a duel!`);
    duel = null; if (el.duel) el.duel.hidden = true;
}

function drawDuel() {
    const box = el.duel; if (!box) return;
    if (!duel) { box.hidden = true; return; }
    const who = peerOf(duel.id)?.name ?? "that player";
    box.hidden = false; box.replaceChildren();
    box.append(h("div", "hd", h("div", "ttl", `Duel with ${who}`)));
    if (duel.st === "out") box.append(h("div", "sub", `Waiting for ${who} to answer...`), h("div", "acts", btn("Cancel", () => { sendDuel({ op: "cancel", to: duel.id }); endDuel(); })));
    else if (duel.st === "in") box.append(h("div", "sub", `${who} challenges you to a friendly duel. You each fight a copy of the other's team; nothing is kept.`),
        h("div", "acts", btn("Accept", () => { sendDuel({ op: "yes", to: duel.id }); startFight(); }), btn("Decline", () => { sendDuel({ op: "no", to: duel.id }); endDuel(`You declined ${who}.`); })));
    else if (duel.st === "fight") box.append(h("div", "sub", "Fighting..."));
    else box.append(h("div", "sub", `Your fight is over. Waiting for ${who} to finish theirs...`));
}

function onDuel(m) {
    const n = peerOf(m.from)?.name ?? "A player";
    if (m.op === "ask") {
        if (duel || trade || !api.canFight() || !peerOf(m.from)?.card?.party?.length) { sendDuel({ op: "no", to: m.from }); return; }
        duel = { st: "in", id: m.from, mine: null, theirs: null };
        note(`${n} challenges you to a duel!`);
        if (S.collapsed) toggleCollapse();
        drawDuel();
    } else if (!duel || duel.id !== m.from) return;
    else if (m.op === "yes" && duel.st === "out") startFight();
    else if (m.op === "no" && duel.st === "out") endDuel(`${n} declined the duel.`);
    else if (m.op === "cancel" && (duel.st === "out" || duel.st === "in")) endDuel(`${n} cancelled the duel.`);
    else if (m.op === "result") { duel.theirs = { hp: m.hp, won: m.won }; verdict(); }
}


// ------------------------------------------------------------ co-op: team up, fight the same enemy, share its HP
// Only the side quests and the extra fights are shared. The main story is never touched.
// Two players team up. Then, whenever either of them starts a quest challenge fight or runs into a wild Digimon, the other is
// invited into the SAME fight (same enemies, made stronger by the "boss strength" setting). Each plays their own Digimon on
// their own screen; the enemy's HP is one shared pool, so damage from either of you counts for both, and when it is down
// you both win. Each player's own game gives them their own EXP, drops and quest progress for it.
const KEY_STR = "dw.mp.strength";
let partner = null, partyAsk = null, coop = null, rolling = false;
const pool = {};                       // enemy number -> lowest HP either of us has brought it to
const strength = () => { try { return Math.max(1, Math.min(3, Number(localStorage.getItem(KEY_STR)) || 2)); } catch { return 2; } };
const scaleFoes = (foes, m) => foes.map((f) => ({
    ...f, hp: Math.min(999999, Math.round(f.hp * m)), stat_scale: Math.max(1, Math.min(64, Math.round((f.stat_scale ?? 16) * (1 + (m - 1) * 0.25)))),
}));

export const coopPartner = () => partner;
/** True when a fight should be offered to the partner right now. */
export const coopReady = () => !!(isOnline() && partner != null && peerOf(partner) && !coop && !rolling && !duel && !trade);
export function coopRolling(on) { rolling = !!on; }

/** Offer a fight to my partner. `start(foes)` runs it here. Returns false when I have no partner (the caller just fights). */
export function coopTry(foes, label, start) {
    if (!(isOnline() && partner != null && peerOf(partner) && !coop && !duel && !trade)) return false;   // (a pending roll is fine: that is us)
    rolling = false;
    const m = strength(), scaled = scaleFoes(foes, m);
    coop = { st: "out", id: partner, foes, scaled, label, start, timer: setTimeout(() => {
        if (coop?.st !== "out") return;
        sendCoop({ op: "cancel", to: coop.id });
        note("No answer - you fight this one alone."); const c = coop; coop = null; drawCoop(); c.start(c.foes);
    }, 14000) };
    sendCoop({ op: "ask", to: partner, foes: scaled, label });
    drawCoop();
    return true;
}

function askParty(id) {
    if (partner != null) { note("You are already teamed up. Leave your party first."); return; }
    const p = peerOf(id); if (!p) return;
    partyAsk = { id, out: true };
    sendCoop({ op: "pask", to: id }); note(`You asked ${p.name} to team up.`); drawPlayers();
}
function leaveParty() {
    if (partner == null) return;
    sendCoop({ op: "pleave", to: partner });
    note(`You left ${peerOf(partner)?.name ?? "your partner"}'s party.`); partner = null; drawPlayers();
}

let sync = null;
function beginSync(id) {
    for (const k of Object.keys(pool)) delete pool[k];
    let started = false, quiet = 0;
    clearInterval(sync);
    sync = setInterval(() => {
        const s = api.coopState();
        if (!s) { if ((started && ++quiet > 2) || ++quiet > 25) { clearInterval(sync); sync = null; if (started) note("The co-op fight is over."); } return; }
        started = true; quiet = 0;
        const k = pool[s.index];
        if (k === undefined) pool[s.index] = s.hp;
        else if (s.hp < k) { pool[s.index] = s.hp; sendCoop({ op: "hit", to: id, i: s.index, hp: Math.max(0, s.hp | 0) }); }
        else if (s.hp > k) api.coopSetHp(s.index, k);        // my partner already brought it lower
    }, 120);
}

function drawCoop() {
    const box = el.coop; if (!box) return;
    box.replaceChildren();
    if (coop) {
        const who = peerOf(coop.id)?.name ?? "your partner";
        box.hidden = false;
        box.append(h("div", "hd", h("div", "ttl", `Co-op fight with ${who}`)));
        if (coop.st === "out") box.append(h("div", "sub", `${coop.label || "A fight"}: waiting for ${who} to join (enemies x${strength()} stronger)...`),
            h("div", "acts", btn("Fight alone", () => { clearTimeout(coop.timer); sendCoop({ op: "cancel", to: coop.id }); const c = coop; coop = null; drawCoop(); c.start(c.foes); })));
        else box.append(h("div", "sub", `${who} is starting a fight: ${coop.label || "enemies"} (${coop.foes.map((f) => `${f.name} Lv${f.level}`).join(", ")}). Join them?`),
            h("div", "acts", btn("Join", () => {
                clearTimeout(coop.timer); sendCoop({ op: "yes", to: coop.id });
                const c = coop; coop = null; drawCoop(); beginSync(c.id);
                if (!api.coopFight(c.foes, () => {})) note("You could not join right now.");
            }), btn("No", () => { clearTimeout(coop.timer); sendCoop({ op: "no", to: coop.id }); coop = null; drawCoop(); })));
        return;
    }
    if (partyAsk && !partyAsk.out) {
        const who = peerOf(partyAsk.id)?.name ?? "A player";
        box.hidden = false;
        box.append(h("div", "hd", h("div", "ttl", `${who} wants to team up`)),
            h("div", "sub", "Team up for the side quests: when one of you starts a quest fight or meets a wild Digimon, the other can join the same fight and share the enemy's HP. The main story stays your own."),
            h("div", "acts", btn("Team up", () => { sendCoop({ op: "pyes", to: partyAsk.id }); partner = partyAsk.id; note(`You teamed up with ${who}.`); partyAsk = null; drawCoop(); drawPlayers(); }),
                btn("No", () => { sendCoop({ op: "pno", to: partyAsk.id }); partyAsk = null; drawCoop(); })));
        return;
    }
    box.hidden = true;
}

function onCoop(m) {
    const n = peerOf(m.from)?.name ?? "A player";
    if (m.op === "pask") {
        if (partner != null || partyAsk) { sendCoop({ op: "pno", to: m.from }); return; }
        partyAsk = { id: m.from, out: false }; note(`${n} wants to team up with you.`); if (S.collapsed) toggleCollapse(); drawCoop();
    } else if (m.op === "pyes" && partyAsk?.out && partyAsk.id === m.from) {
        partner = m.from; partyAsk = null; note(`You teamed up with ${n}. Quest fights and wild fights are now shared.`); drawPlayers();
    } else if (m.op === "pno" && partyAsk?.out && partyAsk.id === m.from) {
        partyAsk = null; note(`${n} said no.`);
    } else if (m.op === "pleave" && partner === m.from) {
        partner = null; note(`${n} left the party.`); drawPlayers();
    } else if (m.op === "ask") {
        if (m.from !== partner || coop || duel || trade || !api.canFight()) { sendCoop({ op: "no", to: m.from }); return; }
        coop = { st: "in", id: m.from, foes: m.foes, label: m.label, timer: setTimeout(() => { if (coop?.st === "in") { sendCoop({ op: "no", to: coop.id }); coop = null; drawCoop(); } }, 14000) };
        note(`${n} started a fight${m.label ? ": " + m.label : ""}. Join them!`); if (S.collapsed) toggleCollapse(); drawCoop();
    } else if (m.op === "cancel" && coop?.st === "in" && coop.id === m.from) {
        clearTimeout(coop.timer); coop = null; drawCoop();
    } else if (m.op === "yes" && coop?.st === "out" && coop.id === m.from) {
        clearTimeout(coop.timer); const c = coop; coop = null; drawCoop();
        note(`${n} joined your fight. The enemy's HP is shared.`);
        beginSync(c.id);
        if (!c.start(c.scaled)) { clearInterval(sync); sync = null; }
    } else if (m.op === "no" && coop?.st === "out" && coop.id === m.from) {
        clearTimeout(coop.timer); const c = coop; coop = null; drawCoop(); note(`${n} could not join - you fight alone.`); c.start(c.foes);
    } else if (m.op === "hit") {
        pool[m.i] = Math.min(pool[m.i] ?? Infinity, m.hp);
    }
}

// ------------------------------------------------------------ what I am doing -> everyone's log
function post(kind, text) {
    add({ k: "feed", kind, name: myName(), text, self: true });
    sendFeed(kind, text);
}

/** The quest layer calls this when I finish an extra quest. */
export function socialQuestDone(title) { if (isOnline() && api) post("quest", `finished the quest "${String(title).slice(0, 50)}"`); }

function pollSelf() {
    if (!api) return;
    // tuck the box away during battles and cutscenes, so it never covers them
    if (dock) dock.style.display = isOnline() && !api.busy() ? "" : "none";
    if (!isOnline()) { prevParty = null; lastCardJson = ""; return; }
    const card = api.card();
    if (!card) return;
    if (duel && (duel.st === "fight")) { prevParty = null; return; }   // a duel's EXP is taken back: not news
    if (prevParty) {
        card.party.forEach((b, i) => {
            const a = prevParty[i];
            if (!a || a.n !== b.n) return;
            if (b.lv > a.lv) post("level", `${b.n} reached Lv ${b.lv}!`);
            else if (b.f && a.f && b.f !== a.f) post("evolve", `${b.n} became ${b.f}!`);
        });
    }
    prevParty = card.party;
    const json = JSON.stringify(card);
    if (json !== lastCardJson) { if (sendCard(card)) lastCardJson = json; }
    if (inspectId === myId() && inspectId != null) drawInspect();
}

// ------------------------------------------------------------ install
function toggleCollapse() {
    S.collapsed = !S.collapsed; if (!S.collapsed) S.unread = 0;
    dock.classList.toggle("min", S.collapsed);
    el.toggle.textContent = S.collapsed ? "+" : "–";
    badge();
}

export function installSocial({ stageEl, api: a }) {
    api = a;
    const css = document.createElement("style");
    css.textContent = `
      #mp-dock { position:absolute; left:8px; bottom:8px; width:344px; z-index:42; color:#fff; font:12px/1.35 system-ui,sans-serif; text-shadow:0 1px 2px #000; }
      #mp-dock[hidden] { display:none; }
      #mp-dock .top { display:flex; gap:2px; align-items:center; }
      #mp-dock .top button { background:rgba(8,10,30,.55); color:#cfd6ff; border:0; border-radius:4px 4px 0 0; padding:3px 8px; font:bold 10px monospace; cursor:pointer; letter-spacing:.5px; }
      #mp-dock .top button.on { background:rgba(30,40,110,.8); color:#fff; }
      #mp-dock .top .sp { flex:1; }
      #mp-dock .un { background:#e0457b; color:#fff; border-radius:8px; padding:0 6px; font:bold 10px monospace; }
      #mp-dock .body { background:rgba(8,10,30,.34); border:1px solid rgba(120,130,220,.35); border-radius:0 4px 0 0; transition:background .2s; }
      #mp-dock:hover .body, #mp-dock:focus-within .body { background:rgba(8,10,30,.78); }
      #mp-dock.min .body, #mp-dock.min .say { display:none; }
      #mp-dock .log, #mp-dock .players { height:170px; overflow-y:auto; padding:4px 6px; }
      #mp-dock .log[hidden], #mp-dock .players[hidden] { display:none; }
      #mp-dock .ln { word-break:break-word; } #mp-dock .tm { color:#8e95c9; font:10px monospace; margin-right:5px; }
      #mp-dock .ln.sys { color:#aab; font-style:italic; } #mp-dock .ln.feed { color:#e8ecff; }
      #mp-dock .say { display:flex; gap:4px; padding:4px 0 0; }
      #mp-dock .say input { flex:1; background:rgba(8,10,30,.55); color:#fff; border:1px solid rgba(120,130,220,.45); border-radius:4px; padding:4px 7px; font:inherit; text-shadow:none; }
      #mp-dock .say input:focus { background:rgba(8,10,30,.9); outline:1px solid #6a78ff; }
      #mp-dock button.go { background:rgba(40,60,160,.8); color:#fff; border:0; border-radius:4px; padding:3px 9px; cursor:pointer; }
      #mp-dock .pl { padding:4px 2px; border-bottom:1px solid rgba(120,130,220,.2); } #mp-dock .pl .nm { font-size:13px; }
      .mp-sub, #mp-dock .sub { color:#aab3e8; font-size:11px; }
      #mp-dock .acts, .mp-win .acts { display:flex; gap:4px; margin-top:3px; }
      #mp-dock .acts button, .mp-win button { background:rgba(50,60,150,.85); color:#fff; border:1px solid rgba(140,150,240,.5); border-radius:4px; padding:2px 8px; font:inherit; cursor:pointer; }
      .mp-win { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:60; width:340px; max-height:80%; overflow:auto; padding:10px 12px;
        background:rgba(12,14,40,.96); color:#fff; border:2px solid #6a78ff; border-radius:8px; font:12px/1.4 system-ui,sans-serif; }
      .mp-win[hidden] { display:none; } .mp-win.wide { width:460px; }
      .mp-win .hd { display:flex; justify-content:space-between; align-items:center; } .mp-win .ttl { font:bold 16px system-ui; }
      .mp-win .x { padding:0 8px; font-size:16px; } .mp-win .sub { color:#aab3e8; margin-top:2px; }
      .mp-win .dg { margin-top:8px; padding:6px 8px; background:rgba(60,70,170,.25); border-radius:6px; }
      .mp-win .dn { font-weight:bold; } .mp-win .lv { color:#ffd34d; margin-left:6px; }
      .mp-win .hp { display:flex; align-items:center; gap:6px; font:10px monospace; margin-top:2px; } .mp-win .bar { flex:1; height:6px; background:#0008; border-radius:3px; overflow:hidden; }
      .mp-win .bar i { display:block; height:100%; } .mp-win .bar.g i { background:#5fe07f; } .mp-win .bar.b i { background:#58a8ff; }
      .mp-win .stats { margin-top:4px; font:10px monospace; color:#cfd6ff; word-spacing:2px; }
      .mp-win .cols { display:flex; gap:10px; margin-top:6px; } .mp-win .col { flex:1; min-width:0; }
      .mp-win .bag { max-height:150px; overflow-y:auto; margin:3px 0; } .mp-win .it { display:flex; gap:4px; align-items:center; padding:1px 0; }
      .mp-win .it .in { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .mp-win .it.pick .in { color:#ffd34d; }
      .mp-win .it button { padding:0 7px; } .mp-win .ct { font:10px monospace; color:#aab3e8; }
      .mp-win .offer { min-height:3em; padding:4px; background:rgba(0,0,0,.25); border-radius:4px; }
      .mp-win input.bits { width:80px; background:#0006; color:#fff; border:1px solid #6a78ff; border-radius:3px; padding:1px 4px; }
      .mp-win button.on { background:#2e8b57; }`;
    document.head.appendChild(css);

    dock = h("div"); dock.id = "mp-dock"; dock.style.display = "none";
    const tabs = {};
    const top = h("div", "top");
    for (const [k, label] of [["all", "ALL"], ["chat", "CHAT"], ["events", "EVENTS"], ["players", "PLAYERS"]]) {
        tabs[k] = btn(label, () => { if (S.collapsed) toggleCollapse(); setTab(k); }); top.append(tabs[k]);
    }
    const unread = h("span", "un"); unread.hidden = true;
    const toggle = btn("–", toggleCollapse); toggle.title = "Hide / show";
    top.append(unread, h("span", "sp"), toggle);
    const log = h("div", "log"), players = h("div", "players"); players.hidden = true;
    const input = h("input"); input.maxLength = 100; input.placeholder = "Say something... (Enter)"; input.autocomplete = "off"; input.spellcheck = false;
    const say = h("div", "say", input, btn("Say", () => submit(), "go"));
    dock.append(top, h("div", "body", log, players), say);
    const inspect = h("div", "mp-win"); inspect.hidden = true;
    const tradeBox = h("div", "mp-win wide"); tradeBox.hidden = true;
    const duelBox = h("div", "mp-win"); duelBox.hidden = true;
    const coopBox = h("div", "mp-win"); coopBox.hidden = true;
    stageEl.append(dock, inspect, tradeBox, duelBox, coopBox);
    el = { log, players, tabs, unread, toggle, inspect, trade: tradeBox, duel: duelBox, coop: coopBox };
    tabs.all.classList.add("on");

    const submit = () => {
        const text = input.value.replace(/\s+/g, " ").trim();
        input.value = "";
        if (text) sendChat(text);
        input.blur(); api.releaseKeys();
    };
    // typing here must not walk the character or press game buttons
    for (const box of [dock, inspect, tradeBox, duelBox, coopBox]) {
        for (const type of ["keydown", "keyup", "keypress"]) box.addEventListener(type, (e) => { if (e.key !== "F4") e.stopPropagation(); });
        box.addEventListener("focusin", () => api.releaseKeys());
    }
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        else if (e.key === "Escape") { input.value = ""; input.blur(); api.releaseKeys(); }
    });
    for (const w of [inspect, tradeBox]) w.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (w === inspect) closeInspect(); else cancelTrade(); } });

    mpOn((type, d) => {
        if (type === "chat") add({ k: "chat", name: d.name, text: d.text, self: d.self });
        else if (type === "feed") add({ k: "feed", kind: d.kind, name: d.name, text: d.text });
        else if (type === "sys") note(d.text);
        else if (type === "roster") {
            drawPlayers(); drawInspect(); badge();
            if (trade && !peerOf(trade.id)) endTrade("The other player left.");
            if (duel && !peerOf(duel.id) && duel.st !== "fight") endDuel("The other player left.");
            if (partner != null && !peerOf(partner)) { partner = null; note("Your party partner left."); }
            if (partyAsk && !peerOf(partyAsk.id)) { partyAsk = null; drawCoop(); }
            if (coop && !peerOf(coop.id)) { clearTimeout(coop.timer); const c = coop; coop = null; drawCoop(); if (c.st === "out") c.start(c.foes); }
        }
        else if (type === "trade") onTrade(d);
        else if (type === "duel") onDuel(d);
        else if (type === "coop") onCoop(d);
        else if (type === "status") {
            if (d.status !== "online") { if (trade) endTrade(); if (duel && duel.st !== "fight") endDuel(); closeInspect(); partner = null; partyAsk = null; if (coop) { clearTimeout(coop.timer); const c = coop; coop = null; drawCoop(); if (c.st === "out") c.start(c.foes); } }
            dock.style.display = d.status === "online" && !api.busy() ? "" : "none";
            badge();
        }
    });
    setInterval(pollSelf, 1500);
    setInterval(() => { if (dock && isOnline()) dock.style.display = api.busy() ? "none" : ""; }, 400);
    window.__mpsocial = { S, api, post, openInspect, askTrade, get trade() { return trade; } };
}
