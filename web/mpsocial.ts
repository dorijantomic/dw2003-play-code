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
import { mpOn, isOnline, myId, myName, peerList, peerOf, peerHere, playingCount, sendChat, sendFeed, sendCard, sendTrade, sendDuel, sendCoop, sendGoto, sendLeague, amHost, serverChampOn, chatPending, chatQueueOn } from "./multiplayer.js";
import { GOTO_TIMEOUT_MS } from "./mp-goto.js";
import { unpackLeague, matchScore, MAX_TAMERS } from "./mp-league.js";
import type { MpFoe, MpSocialEls, MpTrade, MpTradeItem } from "./types/mpsocial.js";
// the tamer ids of a Server Champ night are the room's peer ids: whole numbers (server/room-core.mjs checks Number.isInteger)
interface MpLeaguePair { a: number; b: number; r: number; m: number; game: number; }

interface MpLeagueMatch {
  a: number;
  b: number;
  w?: number | null;
  g?: number[];
  bye?: boolean;
  dead?: boolean;
  wo?: boolean;
}

/** The Server Champ night as the dock reads it (unpackLeague in web/mp-league.ts makes it from the room's packed copy). */
interface MpLeagueNight {
  bestOf: number;
  ids: number[];
  dropped: number[];
  r: number;
  phase: string;
  asked: boolean;
  champ: number | null;
  rounds: MpLeagueMatch[][];
}

/** The room's packed bracket as it travels in one relay message (see packLeague in web/mp-league.ts). */
interface MpLeagueWire {
  b: number;
  i: number[];
  d: number[];
  r: number;
  f: string;
  k: 0 | 1;
  c?: number | null;
  R: (number | null)[][][];
}

/** What the room says happened in the bracket; the fields depend on k. */
type MpLeagueEvent =
  | { k: "closed" }
  | { k: "open" }
  | { k: "pair"; r: number; a: number; b: number }
  | { k: "game"; w: number; n: number; a: number; b: number }
  | { k: "win"; w: number; l: number; g: string; c?: boolean }
  | { k: "drop"; id: number; w?: number | null }
  | { k: "round"; r: number };

interface MpLogMark { queued?: boolean; dropped?: boolean; }

/** One line of the ALL / CHAT / EVENTS log. */
type MpLogEntry =
  | { k: "sys"; text: string; at?: string }
  | { k: "chat"; name: string; text: string; self?: boolean | undefined; mark?: MpLogMark | undefined; at?: string }
  | { k: "feed"; kind: string; name: string; text: string; self?: boolean; at?: string };

interface MpSocialState { tab: string; log: MpLogEntry[]; collapsed: boolean; unread: number; }

/** One Digimon of a player card (what mpCard in web/game/mp-chat.ts sends). */
interface MpCardMon {
  n: string;
  f: string;
  id: number;
  lv: number;
  xp: number;
  hp: number;
  mhp: number;
  mp: number;
  mmp: number;
  st: Record<string, number>;
}

/** A player's card: their party, chapter, BIT and quests. `champ` is set by the dock for the Server Champ. */
interface MpCard {
  v: number;
  chapter: number;
  bits: number;
  quests: number;
  party: MpCardMon[];
  champ?: boolean;
}

/** One row of the PLAYERS tab: a peer of the room, or me ("self"). */
interface MpPlayerRow {
  id: number;
  name: string;
  map: string | null;
  card: MpCard | null;
  self?: boolean;
  away?: boolean;
}

/** An offer in a trade: items and BIT. */
interface MpTradeOffer { items: MpTradeItem[]; bits: number; }

type MpTimerId = ReturnType<typeof setTimeout>;

interface MpDuelResult { hp: number; won: boolean; }
interface MpDuel { st: string; id: number; mine: MpDuelResult | null; theirs: MpDuelResult | null; }

interface MpCoopBase { id: number; foes: MpFoe[]; label: string; screens?: number[] | undefined; timer: MpTimerId; }
/** A co-op fight I offered ("out"): `start` runs it here. */
interface MpCoopOut extends MpCoopBase { st: "out"; scaled: MpFoe[]; start: (foes: MpFoe[], partnerId?: number | null) => boolean | void; }
/** A co-op fight my partner offered me ("in"). */
interface MpCoopIn extends MpCoopBase { st: "in"; }
type MpCoop = MpCoopOut | MpCoopIn;

interface MpPartyAsk { id: number; out: boolean; }
interface MpGo { st: string; id: number; timer: MpTimerId; }

/** The shared enemy of a co-op fight, as the battle reports it. */
interface MpCoopState {
  index: number;
  hp: number;
  maxHp: number;
  count: number;
  me: { name: string; hp: number; maxHp: number } | null;
}

/** What the game gives the dock (built in web/game.ts). */
interface MpSocialApi {
  card: () => MpCard | null;
  currentMapId: () => string | null;
  mapName: (id: string) => string | null;
  busy: () => boolean;
  releaseKeys: () => void;
  where: () => { map: string | null; x: number; y: number; dir: string };
  canGo: () => boolean;
  warpNear: (mapId: string, x: number, y: number) => Promise<string>;
  bits: () => number;
  canFight: () => boolean;
  coopState: () => MpCoopState | null;
  coopSetHp: (i: number, hp: number) => void;
  coopFight: (foes: MpFoe[], done: () => void, screens?: number[]) => boolean;
  startDuel: (card: MpCard | null, cb: (res: MpDuelResult) => void) => boolean;
  tradable: () => MpTradeItem[];
  exchange: (gives: MpTradeOffer, gets: MpTradeOffer) => string;
}

interface MpSocialInstall { stageEl: HTMLElement; api: MpSocialApi; }

// The messages the relay sends the dock (server/room-core.mjs checks them). One interface per kind of message;
// MpDockEvent is all of them together, because the listener gets every kind.
interface MpChatEv { name: string; text: string; self?: boolean; mark?: MpLogMark; kind: string; status: string; }
interface MpTradeMsg { op: string; from: number; items: MpTradeItem[]; bits: number; gives: MpTradeOffer; gets: MpTradeOffer; reason: string; }
interface MpDuelMsg { op: string; from: number; hp: number; won: boolean; }
interface MpCoopMsg { op: string; from: number; foes: MpFoe[]; label: string; screens?: number[]; }
interface MpGotoMsg { op: string; from: number; map: string; x: number; y: number; }
interface MpLeagueMsg { op: string; why: string; lg: MpLeagueWire | null; pair: MpLeaguePair | null; ev: MpLeagueEvent | null; }
interface MpDockEvent extends MpChatEv, MpTradeMsg, MpDuelMsg, MpCoopMsg, MpGotoMsg, MpLeagueMsg { }

interface MpKindIcons { level: [string, string]; quest: [string, string]; evolve: [string, string]; info: [string, string]; [kind: string]: [string, string] | undefined; }


const MAX_LOG = 300;
const S: MpSocialState = { tab: "all", log: [], collapsed: false, unread: 0 };
// ETS item 9: installSocial sets api, dock and el (null as never, {} as MpSocialEls) before any other function of this file can run
let api: MpSocialApi = null as never, dock: HTMLElement = null as never, el = {} as MpSocialEls, trade: MpTrade | null = null, duel: MpDuel | null = null, go: MpGo | null = null, inspectId: number | null = null;
let prevParty: MpCardMon[] | null = null, lastCardJson = "";
let myMapSeen: string | null = null;                         // the map my PLAYERS row was last drawn for
let league: MpLeagueNight | null = null, leaguePair: MpLeaguePair | null = null, leagueGames: number[] = [], leagueKey = "", champOn = false;   // the Server Champ night (web/mp-league.js)

// ------------------------------------------------------------ small helpers
// ETS item 38: the kids are nodes, strings, numbers or false/null; each is checked in the body (nodeType), never returned
/** A kid that is not a node: a string, a number or anything else that prints itself; it has no nodeType (typed false so that a truthy nodeType narrows the kid to a Node, in the loose config too). */
interface Printable { readonly nodeType?: false; toString(): string }
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, ...kids: (Node | Printable | false | null | undefined)[]): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const k of kids) { if (k == null || k === false) continue; e.append(k.nodeType ? k : document.createTextNode(String(k))); }
    return e;
};
const btn = (label: string, onclick: () => void, cls = "") => { const b = h("button", cls, label); b.type = "button"; b.onclick = onclick; return b; };
const clock = () => new Date().toTimeString().slice(0, 5);
const hue = (s: string) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };
const nameColor = (n: string) => `hsl(${hue(n)} 85% 72%)`;
const place = (mapId: string | null) => (mapId ? (api.mapName(mapId) || mapId) : "somewhere new");
const note = (text: string) => add({ k: "sys", text });

function add(entry: MpLogEntry) {
    entry.at = clock();
    S.log.push(entry);
    if (S.log.length > MAX_LOG) S.log.shift();
    if (S.collapsed || S.tab === "players") S.unread++;
    drawLog();
}

// ------------------------------------------------------------ the log
const KIND: MpKindIcons = { level: ["▲", "#ffd34d"], quest: ["★", "#7dffa0"], evolve: ["◆", "#ff9af0"], info: ["•", "#9ad0ff"] };

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
            if (e.mark?.queued) row.append(h("span", "wait", " ..."));           // typed, still waiting its turn
            else if (e.mark?.dropped) row.append(h("span", "wait", " (not sent)"));   // it never left this game
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
    const n = playingCount();
    el.tabs.players!.textContent = `PLAYERS ${n}`;
    el.unread.textContent = S.collapsed && S.unread ? String(Math.min(S.unread, 99)) : "";
    el.unread.hidden = !(S.collapsed && S.unread);
}

function setTab(t: string) {
    S.tab = t; if (t !== "players") S.unread = 0;
    for (const [k, b] of Object.entries(el.tabs)) b.classList.toggle("on", k === t);
    el.log.hidden = t === "players"; el.players.hidden = t !== "players";
    if (t === "players") drawPlayers(); else drawLog();
}

// ------------------------------------------------------------ players
function levelLine(card: MpCard | null) {
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
    if (serverChampOn()) el.players.append(leagueStrip());
    // ETS item 9: the dock is shown only while online (see tick below), and a room welcome gave me my id; offline the row is hidden
    const rows: MpPlayerRow[] = [{ id: myId()!, name: myName(), map: here, card: api.card(), self: true }, ...peerList()];
    for (const p of rows) {
        const nm = h("b", "nm", (p.id === partner ? "★ " : "") + p.name); nm.style.color = isChamp(p) ? "#ffd34d" : nameColor(p.name);
        const where = h("div", "sub", `${levelLine(p.card)}  ·  ${place(p.map)}${p.map && p.map === here ? "  ●" : ""}`);
        const acts = h("div", "acts", btn("Inspect", () => openInspect(p.id)));
        if (!p.self && !p.away) {
            acts.append(btn("Trade", () => askTrade(p.id)), btn("Duel", () => askDuel(p.id)),
                p.id === partner ? btn("Leave party", leaveParty) : btn("Team up", () => askParty(p.id)),
                Object.assign(btn("Go to", () => askGoto(p.id)), { title: `Ask ${p.name} if you can come to them` }));
        }
        el.players.append(h("div", "pl", h("div", "who", nm, p.self ? " (you)" : "", p.away ? h("span", "sub", "  (away)") : "", isChamp(p) ? h("span", "chmp", "  SERVER CHAMP") : ""), where, acts));
    }
    badge();
}

// ------------------------------------------------------------ inspect
function bar(v: number, max: number, cls: string) {
    const w = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
    const b = h("div", "bar " + cls); const f = h("i"); f.style.width = w + "%"; b.append(f); return b;
}

function openInspect(id: number) {
    inspectId = id; drawInspect();
}
function closeInspect() { inspectId = null; if (el.inspect) el.inspect.hidden = true; }

function drawInspect() {
    if (inspectId == null || !el.inspect) return;
    const self = inspectId === myId();
    const p: MpPlayerRow | null = self ? { id: myId(), name: myName(), map: api.currentMapId(), card: api.card() } : (peerOf(inspectId) ? { ...peerOf(inspectId), id: inspectId } : null);
    if (!p) { closeInspect(); return; }
    const c = p.card;
    const box = el.inspect; box.hidden = false; box.replaceChildren();
    const title = h("div", "ttl", p.name); title.style.color = isChamp(p) ? "#ffd34d" : nameColor(p.name);
    box.append(h("div", "hd", title, btn("×", closeInspect, "x")));
    box.append(h("div", "sub", `${place(p.map)}${c?.chapter ? `  ·  Chapter ${c.chapter}` : ""}`));
    if (isChamp(p)) box.append(h("div", "sub champ", "SERVER CHAMP"));
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
const offerLine = (o: MpTradeOffer | null | undefined) => {
    const parts = (o?.items ?? []).map((i) => `${i.qty} x ${i.name || "item " + i.id}`);
    if (o?.bits) parts.push(`${o.bits} BIT`);
    return parts.join(", ") || "nothing";
};

function newTrade(st: string, id: number): MpTrade { return { st, id, mine: { items: {}, bits: 0 }, theirs: { items: [], bits: 0 }, myOk: false, theirOk: false, bag: [] }; }

function askTrade(id: number) {
    if (trade) { note("You are already in a trade."); return; }
    const p = peerOf(id); if (!p) return;
    if (p.away) { note(`${p.name} is away.`); return; }
    trade = newTrade("out", id);
    sendTrade({ op: "ask", to: id });
    drawTrade();
}

function myOffer() {
    // ETS item 9: myOffer only runs while a trade is open (drawTrade, confirmTrade, pushOffer)
    const held: Map<number, MpTradeItem> = new Map(trade!.bag.map((b): [number, MpTradeItem] => [b.id, b]));
    const items: MpTradeItem[] = [];
    // ETS item 9: a trade is open here (see above)
    for (const [id, qty] of Object.entries(trade!.mine.items)) {
        const b = held.get(+id);
        if (b && qty > 0) items.push({ id: +id, qty: Math.min(qty, b.qty), name: b.name });
    }
    // ETS item 9: a trade is open here (see above)
    return { items, bits: Math.max(0, Math.min(trade!.mine.bits | 0, api.bits())) };
}
// ETS item 9: pushOffer is only called from the trade window's buttons and confirmTrade, while a trade is open
function pushOffer() { trade!.myOk = false; trade!.theirOk = false; sendTrade({ op: "offer", ...myOffer() }); }

function endTrade(msg?: string | null) {
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
            // ETS item 9: these buttons are only on screen while the trade is open
            btn("-", () => { trade!.mine.items[b.id] = Math.max(0, q - 1); pushOffer(); drawTrade(); }),
            btn("+", () => { trade!.mine.items[b.id] = Math.min(b.qty, q + 1); pushOffer(); drawTrade(); }));
        list.append(row);
    }
    // ETS item 38: the input's value is a string that `| 0` turns into a number (as the code always did)
    const bits: HTMLInputElement & { value: any } = h("input"); bits.type = "number"; bits.min = "0"; bits.max = String(api.bits()); bits.value = String(trade.mine.bits || 0); bits.className = "bits";
    // ETS item 9: the BIT box is only on screen while the trade is open
    bits.onchange = () => { trade!.mine.bits = Math.max(0, Math.min(api.bits(), bits.value | 0)); pushOffer(); drawTrade(); };
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
        // ETS item 9: confirmTrade returned above unless a trade is open
        && o.items.every((i) => trade!.mine.items[i.id] === i.qty) && o.bits === (trade.mine.bits | 0);
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

const END_TEXT: Record<string, string> = { declined: "declined the trade.", cancelled: "cancelled the trade.", left: "left the room.", busy: "is busy with another trade.", gone: "is not here any more." };

function onTrade(m: MpTradeMsg) {
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
function askDuel(id: number) {
    if (duel || trade) { note("Finish what you are doing first."); return; }
    const p = peerOf(id); if (!p) return;
    if (p.away) { note(`${p.name} is away.`); return; }
    if (!p.card?.party?.length) { note(`${p.name} has no Digimon to fight with yet.`); return; }
    if (!api.canFight()) { note("Not now - finish what you are doing first."); return; }
    duel = { st: "out", id, mine: null, theirs: null };
    sendDuel({ op: "ask", to: id });
    drawDuel();
}

function startFight() {
    const p = peerHere(duel?.id);
    if (!p) { endDuel("They left."); return; }
    // ETS item 9: startFight is only called while a duel is open (askDuel / onDuel / the Accept button set it first)
    duel!.st = "fight"; drawDuel();
    const started = api.startDuel(p.card, (res) => {
        if (!duel) return;
        duel.mine = res; duel.st = "wait";
        sendDuel({ op: "result", to: duel.id, hp: res.hp, won: res.won });
        drawDuel(); verdict();
    });
    // ETS item 9: the duel is still open here (see startFight above)
    if (!started) { sendDuel({ op: "cancel", to: duel!.id }); endDuel("The duel could not start (are you busy, or without a Digimon?)."); }
}

function verdict() {
    if (!duel?.mine) return;
    const n = peerOf(duel.id)?.name ?? "your friend";
    if (!duel.theirs) { if (!peerHere(duel.id)) endDuel(`${n} left before finishing the duel.`); return; }
    const score = (r: MpDuelResult) => (r.won ? 1 : 0) + r.hp, me = score(duel.mine), them = score(duel.theirs);
    const pct = (r: MpDuelResult) => (r.won ? `won with ${Math.round(r.hp * 100)}% HP left` : "lost");
    const text = Math.abs(me - them) < 0.02 ? "A draw!" : me > them ? `You win the duel against ${n}!` : `${n} wins the duel.`;
    endDuel(`Duel with ${n}: ${text}  (you ${pct(duel.mine)}; ${n} ${pct(duel.theirs)})`);
}

function endDuel(msg?: string) {
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
    // ETS item 9: these buttons are only on screen while the duel is open
    if (duel.st === "out") box.append(h("div", "sub", `Waiting for ${who} to answer...`), h("div", "acts", btn("Cancel", () => { sendDuel({ op: "cancel", to: duel!.id }); endDuel(); })));
    else if (duel.st === "in") box.append(h("div", "sub", `${who} challenges you to a friendly duel. You each fight a copy of the other's team; nothing is kept.`),
        // ETS item 9: these buttons are only on screen while the duel is open
        h("div", "acts", btn("Accept", () => { sendDuel({ op: "yes", to: duel!.id }); startFight(); }), btn("Decline", () => { sendDuel({ op: "no", to: duel!.id }); endDuel(`You declined ${who}.`); })));
    else if (duel.st === "fight") box.append(h("div", "sub", "Fighting..."));
    else box.append(h("div", "sub", `Your fight is over. Waiting for ${who} to finish theirs...`));
}

function onDuel(m: MpDuelMsg) {
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
// invited into the SAME fight (same enemies, made stronger by the "boss strength" setting). It runs as a many-vs-many fight
// (web/mpbattle.js): both Digimon on one side, all the enemies on the other. Each player's own game gives them their own EXP,
// BIT and quest progress for it.
const KEY_STR = "dw.mp.strength";
let partner: number | null = null, partyAsk: MpPartyAsk | null = null, coop: MpCoop | null = null, rolling = false;
const strength = () => { try { return Math.max(1, Math.min(3, Number(localStorage.getItem(KEY_STR)) || 2)); } catch { return 2; } };
const scaleFoes = (foes: MpFoe[], m: number) => foes.map((f) => ({
    ...f, hp: Math.min(999999, Math.round(f.hp * m)), stat_scale: Math.max(1, Math.min(64, Math.round((f.stat_scale ?? 16) * (1 + (m - 1) * 0.25)))),
}));

export const coopPartner = () => partner;
/** True when a fight should be offered to the partner right now. */
export const coopReady = () => !!(isOnline() && partner != null && peerHere(partner) && !coop && !rolling && !duel && !trade);
export function coopRolling(on: boolean) { rolling = !!on; }

/** Offer a fight to my partner. `start(foes, partnerId)` runs it here (partnerId null = fight alone). Returns false when I have no partner (the caller just fights). */
export function coopTry(foes: MpFoe[], label: string, start: MpCoopOut["start"], screens?: number[]) {
    if (!(isOnline() && partner != null && peerHere(partner) && !coop && !duel && !trade)) return false;   // (a pending roll is fine: that is us)
    rolling = false;
    const m = strength(), scaled = scaleFoes(foes, m);
    coop = { st: "out", id: partner, foes, scaled, label, start, screens, timer: setTimeout(() => {
        if (coop?.st !== "out") return;
        sendCoop({ op: "cancel", to: coop.id });
        note("No answer - you fight this one alone."); const c = coop; coop = null; drawCoop(); c.start(c.foes);
    }, 14000) };
    sendCoop({ op: "ask", to: partner, foes: scaled, label, screens });
    drawCoop();
    return true;
}

function askParty(id: number) {
    if (partner != null) { note("You are already teamed up. Leave your party first."); return; }
    const p = peerOf(id); if (!p) return;
    if (p.away) { note(`${p.name} is away.`); return; }
    partyAsk = { id, out: true };
    sendCoop({ op: "pask", to: id }); note(`You asked ${p.name} to team up.`); drawPlayers();
}
function leaveParty() {
    if (partner == null) return;
    sendCoop({ op: "pleave", to: partner });
    note(`You left ${peerOf(partner)?.name ?? "your partner"}'s party.`); partner = null; drawPlayers();
}

function drawCoop() {
    const box = el.coop; if (!box) return;
    box.replaceChildren();
    if (coop) {
        const who = peerOf(coop.id)?.name ?? "your partner";
        box.hidden = false;
        box.append(h("div", "hd", h("div", "ttl", `Co-op fight with ${who}`)));
        if (coop.st === "out") box.append(h("div", "sub", `${coop.label || "A fight"}: waiting for ${who} to join (enemies x${strength()} stronger)...`),
            // ETS item 9: this button is only on screen while the fight I offered ("out") is open
            h("div", "acts", btn("Fight alone", () => { clearTimeout(coop!.timer); sendCoop({ op: "cancel", to: coop!.id }); const c = coop as MpCoopOut; coop = null; drawCoop(); c.start(c.foes); })));
        else box.append(h("div", "sub", `${who} is starting a fight: ${coop.label || "enemies"} (${coop.foes.map((f) => `${f.name} Lv${f.level}`).join(", ")}). Join them?`),
            // ETS item 9: these buttons are only on screen while the fight I was offered is open
            h("div", "acts", btn("Join", () => {
                clearTimeout(coop!.timer); sendCoop({ op: "yes", to: coop!.id });
                const c = coop!; coop = null; drawCoop();
                note(`Joining ${peerOf(c.id)?.name ?? "your partner"}'s fight...`);   // their game sends the fight setup next
            }), btn("No", () => { clearTimeout(coop!.timer); sendCoop({ op: "no", to: coop!.id }); coop = null; drawCoop(); })));
        return;
    }
    if (partyAsk && !partyAsk.out) {
        const who = peerOf(partyAsk.id)?.name ?? "A player";
        box.hidden = false;
        box.append(h("div", "hd", h("div", "ttl", `${who} wants to team up`)),
            h("div", "sub", "Team up for the side quests: when one of you starts a quest fight or meets a wild Digimon, the other can join the same fight and share the enemy's HP. The main story stays your own."),
            // ETS item 9: these buttons are only on screen while the team-up request is open
            h("div", "acts", btn("Team up", () => { sendCoop({ op: "pyes", to: partyAsk!.id }); partner = partyAsk!.id; note(`You teamed up with ${who}.`); partyAsk = null; drawCoop(); drawPlayers(); }),
                btn("No", () => { sendCoop({ op: "pno", to: partyAsk!.id }); partyAsk = null; drawCoop(); })));
        return;
    }
    box.hidden = true;
}

function onCoop(m: MpCoopMsg) {
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
        coop = { st: "in", id: m.from, foes: m.foes, label: m.label, screens: m.screens, timer: setTimeout(() => { if (coop?.st === "in") { sendCoop({ op: "no", to: coop.id }); coop = null; drawCoop(); } }, 14000) };
        note(`${n} started a fight${m.label ? ": " + m.label : ""}. Join them!`); if (S.collapsed) toggleCollapse(); drawCoop();
    } else if (m.op === "cancel" && coop?.st === "in" && coop.id === m.from) {
        clearTimeout(coop.timer); coop = null; drawCoop();
    } else if (m.op === "yes" && coop?.st === "out" && coop.id === m.from) {
        clearTimeout(coop.timer); const c = coop; coop = null; drawCoop();
        note(`${n} joined your fight.`);
        if (!c.start(c.scaled, c.id)) note("The fight could not start right now.");
    } else if (m.op === "no" && coop?.st === "out" && coop.id === m.from) {
        clearTimeout(coop.timer); const c = coop; coop = null; drawCoop(); note(`${n} could not join - you fight alone.`); c.start(c.foes);
    }
}

// ------------------------------------------------------------ go to a player
// "Go to": I ask, they get a yes/no (a team-up partner is answered for them at once). On yes their game sends the place it
// stands in (stage id, x, y); my game then warps me next to it with the game's own stage change (api.warpNear). Neither of us
// may be in a battle, a cutscene or a menu. No answer in 14 s = cancelled, like a co-op invite.
function askGoto(id: number) {
    const p = peerOf(id); if (!p) return;
    if (p.away) { note(`${p.name} is away.`); return; }
    if (go) { note("Finish what you are doing first."); return; }
    if (!api.canGo()) { note("Not now - finish what you are doing first."); return; }
    go = { st: "out", id, timer: setTimeout(() => { if (go?.st === "out") { sendGoto({ op: "cancel", to: id }); endGoto(`No answer from ${peerOf(id)?.name ?? "that player"}.`); } }, GOTO_TIMEOUT_MS) };
    sendGoto({ op: "ask", to: id });
    note(`You asked ${p.name} if you can come to them.`);
    drawGoto();
}

function endGoto(msg?: string) {
    if (go) clearTimeout(go.timer);
    go = null; if (el.go) el.go.hidden = true;
    if (msg) note(msg);
}

function answerGoto(id: number) {                                        // I say yes: tell them where I stand
    const w = api.where();
    if (!w?.map) { sendGoto({ op: "no", to: id }); return; }
    sendGoto({ op: "at", to: id, map: w.map, x: w.x, y: w.y, dir: w.dir });
}

function drawGoto() {
    const box = el.go; if (!box) return;
    if (!go || go.st !== "in") { box.hidden = true; return; }
    const who = peerOf(go.id)?.name ?? "A player";
    box.hidden = false; box.replaceChildren();
    box.append(h("div", "hd", h("div", "ttl", `${who} wants to come to you`)),
        // ETS item 9: these buttons are only on screen while the request is open
        h("div", "acts", btn("Yes", () => { const id = go!.id; endGoto(); if (api.canGo()) answerGoto(id); else sendGoto({ op: "no", to: id }); }),
            btn("No", () => { sendGoto({ op: "no", to: go!.id }); endGoto(); })));
}

async function onGoto(m: MpGotoMsg) {
    const n = peerOf(m.from)?.name ?? "A player";
    if (m.op === "ask") {
        if (go || !api.canGo()) { sendGoto({ op: "no", to: m.from }); return; }
        if (m.from === partner) { answerGoto(m.from); note(`${n} is coming to you.`); return; }   // a team-up partner needs no prompt
        go = { st: "in", id: m.from, timer: setTimeout(() => { if (go?.st === "in") { sendGoto({ op: "no", to: go.id }); endGoto(); } }, GOTO_TIMEOUT_MS) };
        note(`${n} wants to come to you.`); if (S.collapsed) toggleCollapse(); drawGoto();
    } else if (!go || go.id !== m.from) return;
    else if (m.op === "cancel" && go.st === "in") endGoto(`${n} cancelled.`);
    else if (m.op === "no" && go.st === "out") endGoto(`${n} cannot be reached right now.`);
    else if (m.op === "at" && go.st === "out") {
        endGoto();
        const r = await api.warpNear(m.map, m.x, m.y);
        note(r === "ok" ? `You went to ${n}.` : r === "noroom" ? `There is no free ground next to ${n}.` : r === "busy" ? "Not now - finish what you are doing first." : `${n} is somewhere you cannot go.`);
    }
}

// ------------------------------------------------------------ the Server Champ night
// The game's own Online Center promises exactly this: "Server Champs can battle with others to be the next World
// Champ", and the stated goal "to become the strongest of the over 200,000 players" (dw3-systems-reference,
// Server Tournament / Server Champ / World Champ). The disc gives you nobody to battle; this is that evening with
// the friends in your room. The room keeps the bracket (server/room-core.mjs, `lg`; rules in web/mp-league.js), the
// host opens it and calls each fight, and the winner's card says SERVER CHAMP until the next night.
// F2 -> Extras -> "Server Champ league", off by default: no button, no message, and a card that carries the mark
// draws as a normal card.
const LEAGUE_NO: Record<string, string> = {
    no_league: "No Server Champ night is open.",
    open: "A Server Champ night is already open.",
    ids: "A Server Champ night needs 2 to 8 tamers who are in the room.",
    done: "This night is won - wait for the next one.",
    dropped: "That tamer already left the night.",
    no_fight: "No fight is on the table right now.",
    not_in_match: "That tamer is not in this fight.",
    no_games: "Report at least one game.",
    too_many_games: "A best-of-three fight has at most three games.",
    already_over: "That fight was already decided.",
    wrong_winner: "The winner does not match the games you reported.",
};

const lgName = (id: number | null | undefined) => (id === myId() ? myName() : (peerOf(id)?.name ?? `Tamer ${id}`));
const matchOf = (pair: MpLeaguePair | null): MpLeagueMatch | null => (pair ? league?.rounds?.[pair.r]?.[pair.m] ?? null : null);
const leagueScore = (m: MpLeagueMatch | null, id: number): number => (m?.g ?? []).filter((g) => g === id).length;
/** The room's champion from its own bracket; null until the final is won, or with the switch off. */
const champId = () => (serverChampOn() && league ? league.champ : null);
/** The champ colour: the room's champion, or a card that says so itself. Off = a normal card. */
const isChamp = (p: { id: number | string | null; card?: MpCard | null }) => serverChampOn() && (p.id === champId() || p.card?.champ === true);

function matchText(m: MpLeagueMatch | null | undefined) {
    if (!m) return "?";
    if (m.bye) return `${lgName(m.a ?? m.b)} (bye)`;
    if (m.dead) return "no tamer left";
    if (m.w == null) return `${lgName(m.a)} vs ${lgName(m.b)}`;
    const lost = m.a === m.w ? m.b : m.a;
    return `${lgName(m.w)} beat ${lgName(lost)} ${m.wo ? "w.o." : matchScore(m)}`;
}

function leagueStrip() {
    const box = h("div", "lg");
    box.append(h("div", "lgh", `SERVER CHAMP · best of ${league?.bestOf ?? 3}`));
    if (!league) {
        if (amHost()) box.append(h("div", "sub", "2 to 8 tamers, one bracket, one evening."), btn("Start a Server Champ night", startLeague));
        else box.append(h("div", "sub", "The host can start a Server Champ night."));
        return box;
    }
    league.rounds.forEach((round, r) => box.append(h("div", "sub", `Round ${r + 1}: ${round.map(matchText).join("  ·  ")}`)));
    if (league.champ != null) box.append(h("div", "champ", `${lgName(league.champ)} is SERVER CHAMP`));
    else if (leaguePair) {
        const m = matchOf(leaguePair), score = leagueGames.length ? `  (${leagueScore(m, leaguePair.a)}-${leagueScore(m, leaguePair.b)})` : "";
        box.append(h("div", "cur", `Next: ${lgName(leaguePair.a)} vs ${lgName(leaguePair.b)}, game ${leaguePair.game}${score}`));
    } else box.append(h("div", "sub", league.phase === "break" ? "Round over - the host calls the next round." : "Waiting for the host to call the first fight."));
    const acts = h("div", "acts");
    if (amHost() && league.champ == null) {
        if (!leaguePair) acts.append(btn("Next fight", () => sendLeague({ op: "next" })));
        // ETS item 9: these buttons only exist while a fight is on the table
        else acts.append(btn(`${lgName(leaguePair.a)} won game`, () => reportGame(leaguePair!.a)),
            btn(`${lgName(leaguePair.b)} won game`, () => reportGame(leaguePair!.b)));
    }
    // the pair on the table can start today's friendly duel (each side fights a copy of the other's team)
    if (leaguePair && !duel && !trade && (myId() === leaguePair.a || myId() === leaguePair.b)) {
        const other = myId() === leaguePair.a ? leaguePair.b : leaguePair.a;
        acts.append(btn(`Duel ${lgName(other)}`, () => askDuel(other)));
    }
    // ETS item 9: a night exists only in a room, and the room has welcomed me (it gave me an id) before it sends one
    if (league.ids.includes(myId()!) && !league.dropped.includes(myId()!)) acts.append(btn("Drop out", () => sendLeague({ op: "drop" })));
    if (acts.childNodes.length) box.append(acts);
    return box;
}

function startLeague() {
    const all = [myId(), ...peerList().map((p) => p.id)];
    if (all.length < 2) { note("You need at least one more tamer in the room."); return; }
    // a night holds 8 tamers; in a bigger room the first 7 others in join order are the night, and the host is told
    const ids = all.slice(0, MAX_TAMERS);
    if (ids.length < all.length) note(`A Server Champ night holds ${MAX_TAMERS} tamers. This one has you and the next ${ids.length - 1} in the room.`);
    sendLeague({ op: "open", ids });
}

function reportGame(id: number) {
    if (!leaguePair) return;
    leagueGames.push(id);                                     // the games of this fight, in order (best of three)
    if (!sendLeague({ op: "win", winner: id, games: leagueGames })) { leagueGames.pop(); note("Could not send the result (not in a room, or the switch is off)."); }
}

function announceLeague(ev: MpLeagueEvent | null) {
    if (!ev) return;
    const feed = (text: string) => add({ k: "feed", kind: "info", name: "Server Champ", text });
    if (ev.k === "closed") { note("The Server Champ night ended (the host left)."); return; }
    if (!league) return;
    if (ev.k === "open") feed(`night is on: ${league.ids.length} tamers, best of ${league.bestOf}. The winner is Server Champ until the next night.`);
    else if (ev.k === "pair") feed(`round ${ev.r + 1}: ${lgName(ev.a)} vs ${lgName(ev.b)}.`);
    else if (ev.k === "game") feed(`${lgName(ev.w)} takes game ${ev.n} of ${lgName(ev.a)} vs ${lgName(ev.b)}.`);
    else if (ev.k === "win") feed(`${lgName(ev.w)} beat ${lgName(ev.l)} ${ev.g}.${ev.c ? ` ${lgName(ev.w)} is SERVER CHAMP!` : ""}`);
    else if (ev.k === "drop") feed(`${lgName(ev.id)} left the night.${ev.w != null ? ` ${lgName(ev.w)} goes through.` : ""}`);
    else if (ev.k === "round") feed(`round ${ev.r + 1} is over.`);
}

function clearLeague() { league = null; leaguePair = null; leagueGames = []; leagueKey = ""; }

function onLeague(m: MpLeagueMsg) {
    if (!serverChampOn()) return;
    if (m.op === "no") {
        note(LEAGUE_NO[m.why] ?? "The Server Champ night server said no.");
        leagueGames = matchOf(leaguePair)?.g?.slice() ?? [];      // the server's tally is the truth after a refusal
        return;
    }
    if (m.op !== "state") return;
    league = m.lg ? unpackLeague(m.lg) : null; leaguePair = m.pair ?? null;
    const key = leaguePair ? `${leaguePair.r}:${leaguePair.m}` : "";
    if (key !== leagueKey) { leagueKey = key; leagueGames = matchOf(leaguePair)?.g?.slice() ?? []; }
    announceLeague(m.ev);
    drawPlayers();
    drawInspect();
}

// ------------------------------------------------------------ what I am doing -> everyone's log
function post(kind: string, text: string) {
    add({ k: "feed", kind, name: myName(), text, self: true });
    sendFeed(kind, text);
}

/** The quest layer calls this when I finish an extra quest. */
export function socialQuestDone(title: string) { if (isOnline() && api) post("quest", `finished the quest "${String(title).slice(0, 50)}"`); }

function pollSelf() {
    if (!api) return;
    const mapNow = api.currentMapId();
    if (mapNow !== myMapSeen) { myMapSeen = mapNow; drawPlayers(); }      // my map changed: my row and every "same map" mark follow
    const on = serverChampOn();
    if (on !== champOn) {                                    // the switch flipped: the bracket strip appears or goes
        champOn = on;
        if (!on) clearLeague();
        drawPlayers();
    }
    // tuck the box away during battles and cutscenes, so it never covers them
    if (dock) dock.style.display = isOnline() && !api.busy() ? "" : "none";
    if (!isOnline()) { prevParty = null; lastCardJson = ""; return; }
    const card = api.card();
    if (!card) return;
    if (serverChampOn() && league?.champ != null && league.champ === myId()) card.champ = true;   // my card says SERVER CHAMP until the next night
    if (duel && (duel.st === "fight")) { prevParty = null; return; }   // a duel's EXP is taken back: not news
    if (prevParty) {
        card.party.forEach((b, i) => {
            // ETS item 9: prevParty was checked just above, and nothing in this loop changes it
            const a = prevParty![i];
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

export function installSocial({ stageEl, api: a }: MpSocialInstall) {
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
      #mp-dock .ln .wait { color:#ffb15a; font-style:italic; }
      #mp-dock .ln.sys { color:#aab; font-style:italic; } #mp-dock .ln.feed { color:#e8ecff; }
      #mp-dock .say { display:flex; gap:4px; padding:4px 0 0; }
      #mp-dock .say input { flex:1; background:rgba(8,10,30,.55); color:#fff; border:1px solid rgba(120,130,220,.45); border-radius:4px; padding:4px 7px; font:inherit; text-shadow:none; }
      #mp-dock .say input:focus { background:rgba(8,10,30,.9); outline:1px solid #6a78ff; }
      #mp-dock button.go { background:rgba(40,60,160,.8); color:#fff; border:0; border-radius:4px; padding:3px 9px; cursor:pointer; }
      #mp-dock .pl { padding:4px 2px; border-bottom:1px solid rgba(120,130,220,.2); } #mp-dock .pl .nm { font-size:13px; }
      #mp-dock .lg { padding:4px 2px 6px; margin-bottom:3px; border-bottom:1px solid rgba(120,130,220,.35); }
      #mp-dock .lg .lgh { color:#cfd6ff; font:bold 10px monospace; letter-spacing:.6px; }
      #mp-dock .lg .cur { color:#e8ecff; font-size:11px; }
      #mp-dock .lg .champ, .mp-win .sub.champ { color:#ffd34d; font-weight:bold; }
      #mp-dock .pl .chmp { color:#ffd34d; font:bold 9px monospace; letter-spacing:1px; }
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
    const tabs: Record<string, HTMLElement> = {};
    const top = h("div", "top");
    for (const [k, label] of [["all", "ALL"], ["chat", "CHAT"], ["events", "EVENTS"], ["players", "PLAYERS"]] satisfies [string, string][]) {
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
    const goBox = h("div", "mp-win"); goBox.hidden = true;
    stageEl.append(dock, inspect, tradeBox, duelBox, coopBox, goBox);
    el = { log, players, tabs, unread, toggle, inspect, trade: tradeBox, duel: duelBox, coop: coopBox, go: goBox };
    tabs.all!.classList.add("on");

    const submit = () => {
        const text = input.value.replace(/\s+/g, " ").trim();
        input.value = "";
        if (text) {
            const r = sendChat(text);
            if (r === "queued") {
                const n = chatPending();
                note(n === 1 ? "One line waiting..." : `${n} lines waiting...`);
            } else if (r === false && chatQueueOn()) note("That line was not sent - you are not in a room.");
        }
        input.blur(); api.releaseKeys();
    };
    // typing here must not walk the character or press game buttons
    for (const box of [dock, inspect, tradeBox, duelBox, coopBox, goBox]) {
        for (const type of ["keydown", "keyup", "keypress"] as const) box.addEventListener(type, (e) => { if (e.key !== "F4") e.stopPropagation(); });
        box.addEventListener("focusin", () => api.releaseKeys());
    }
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        else if (e.key === "Escape") { input.value = ""; input.blur(); api.releaseKeys(); }
    });
    for (const w of [inspect, tradeBox]) w.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (w === inspect) closeInspect(); else cancelTrade(); } });

    mpOn((type: string, d: MpDockEvent) => {
        if (type === "chat") add({ k: "chat", name: d.name, text: d.text, self: d.self, mark: d.mark });
        else if (type === "chatstate") drawLog();          // a waiting line left (or did not): repaint its "..." mark
        else if (type === "feed") add({ k: "feed", kind: d.kind, name: d.name, text: d.text });
        else if (type === "sys") note(d.text);
        else if (type === "roster") {
            drawPlayers(); drawInspect(); badge();
            if (trade && !peerHere(trade.id)) endTrade("The other player left.");
            if (duel && !peerHere(duel.id) && duel.st !== "fight") endDuel("The other player left.");
            if (partner != null && !peerHere(partner)) { partner = null; note("Your party partner left."); }
            if (partyAsk && !peerHere(partyAsk.id)) { partyAsk = null; drawCoop(); }
            if (go && !peerHere(go.id)) endGoto("The other player left.");
            if (coop && !peerHere(coop.id)) { clearTimeout(coop.timer); const c = coop; coop = null; drawCoop(); if (c.st === "out") c.start(c.foes); }
        }
        else if (type === "trade") onTrade(d);
        else if (type === "duel") onDuel(d);
        else if (type === "coop") onCoop(d);
        else if (type === "goto") onGoto(d);
        else if (type === "league") onLeague(d);
        else if (type === "status") {
            if (d.status !== "online") { if (trade) endTrade(); if (duel && duel.st !== "fight") endDuel(); if (go) endGoto(); closeInspect(); partner = null; partyAsk = null; clearLeague(); if (coop) { clearTimeout(coop.timer); const c = coop; coop = null; drawCoop(); if (c.st === "out") c.start(c.foes); } }
            dock.style.display = d.status === "online" && !api.busy() ? "" : "none";
            badge();
        }
    });
    setInterval(pollSelf, 1500);
    setInterval(() => { if (dock && isOnline()) dock.style.display = api.busy() ? "none" : ""; }, 400);
    window.__mpsocial = { S, api, coopTry, post, openInspect, askTrade, get trade() { return trade; } };
}
