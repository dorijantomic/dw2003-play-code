// EXPERIMENT: the room logic of the optional multiplayer relay (not original game content).
//
// Pure and transport-free, so the same code runs in the Node relay (server/relay.mjs) and in the unit tests. It never
// sees game data: a player's display name, the stage id they stand in, a position, a facing, an emote number, chat
// lines, a small "player card" the player chose to share, and the items two players agree to swap.
//
// A client connects with a URL query: `?create=1&name=Ken` makes a new room and gets its code, `?room=ABCDE&name=Ana`
// joins one. Add `&rj=1` to say "I know about seats" (every current game does): the relay then keeps a dropped player's seat
// "away" for AWAY_MS and sends `key` in `welcome`; `&key=...` takes that seat back (same id, name, place). Older games send
// neither and are treated exactly as before. After that a client sends small JSON messages:
//   {t:"pos", map, x, y, dir, mv}   where I am (only players in the same stage are told)
//   {t:"emote", e}                  a small icon over my head, e = 0..7
//   {t:"chat", text}                a line of talk: in everyone's chat log, and over my head for players in my stage
//   {t:"feed", kind, text}          something I did (a level up, a finished quest): in everyone's log
//   {t:"card", card}                my player card (name, Digimon, levels...): what others see when they inspect me
//   {t:"trade", op, ...}            trading, see #trade below
//   {t:"mpb", to:[ids], d:{...}}    a many-vs-many fight message (turns, actions, results) passed to those players (see #mpb)
//   {t:"coop", op, to, ...}         team-up and shared fights between two players (see #coop)
//   {t:"duel", op, to, hp, won}     a friendly duel: ask / yes / no / cancel / result, passed to player `to` (see #direct)
//   {t:"lg", op, ...}               a Server Champ night among the room's tamers (see #lg)
//   {t:"bye"}                     I am leaving for good (the Leave button): my seat is freed at once, not kept
//   {t:"ping"}                      keep-alive, answered with {t:"pong"}
// and receives:
//   {t:"welcome", id, room, host, roster:[{id,name,map,card}]}
//   welcome also carries key (rj only), and for a returning seat resumed:true and at:{map,x,y,dir}; roster entries of away seats carry away:true
//   {t:"away", id} / {t:"back", id}   a rj player's seat went away / came back (older games get leave / join instead)
//   {t:"join", id, name} / {t:"leave", id}
//   {t:"pos", id, map, x, y, dir, mv} / {t:"gone", id} (that player left my stage) / {t:"emote", id, e}
//   {t:"at", id, map}               that player is now in this stage (everyone is told, so the list can say where)
//   {t:"chat", id, text, map} / {t:"feed", id, kind, text} / {t:"card", id, card}
//   {t:"trade", op, ...}
//   {t:"err", reason}   reasons: no_room, full, exists, busy, bad, gone (the key is not a seat of this room, or it expired)
import { newLeague, nextPairing, report, forfeit, matchScore, packLeague } from "../web/mp-league.js";

export const MAX_PEERS = 50;         // a room of friends; positions only go to the same stage, so this stays cheap
export const MAX_ROOMS = 200;        // per relay, so a flood of "create" cannot fill its memory
export const MAX_MESSAGE = 8000;     // bytes; a position update is about 80, a player card up to ~2000, a fighter record ~2500
const SMALL = 600;                   // every message except a card is held to this
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I, O, 0, 1: easy to read out loud
const CODE_LEN = 5;
const DIRS = /^[a-z]{2,5}(-[a-z]{2,5})?$/;            // "down", "up-right"
const MAP_ID = /^[A-Za-z0-9_-]{1,24}$/;
const LIMIT = 80;                    // messages a second a player may send before the rest are dropped (burst is 2x)
const CHAT_GAP = 600;                // ms between two chat lines from one player
const CHAT_MAX = 100, FEED_MAX = 90, CARD_MAX = 2000;
const FEED_KINDS = new Set(["level", "quest", "evolve", "info"]);
const DUEL_OPS = new Set(["ask", "yes", "no", "cancel", "result"]);
const COOP_OPS = new Set(["pask", "pyes", "pno", "pleave", "ask", "yes", "no", "cancel", "hit", "stat"]);

export const AWAY_MS = 120000;       // how long a dropped rejoin-aware player's seat is kept (id, name, place, card)
const KEY_RE = /^[0-9a-f]{32}$/;
const NOOP = () => {};

/** A seat key: 128 random bits from the platform's secure generator (never Math.random), 32 hex characters. The relay makes it; a client cannot choose it. */
export function makeKey() {
    const b = new Uint8Array(16);
    globalThis.crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function makeCode(rand = Math.random) {
    let s = "";
    for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
    return s;
}

export function cleanCode(s) {
    const c = String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return c.length === CODE_LEN && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}

/** Plain text: control characters and angle brackets out, one line, cut to `max`. */
export function cleanText(s, max) {
    return String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function cleanName(s) {
    const n = String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 12).trim();
    return n || "Tamer";
}

const finite = (n, lim) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= lim;

function cleanOffer(o) {
    const items = [];
    for (const it of Array.isArray(o?.items) ? o.items.slice(0, 12) : []) {
        const id = it?.id, qty = it?.qty;
        if (!Number.isInteger(id) || id < 0 || id > 9999 || !Number.isInteger(qty) || qty < 1 || qty > 99) continue;
        if (items.some((x) => x.id === id)) continue;
        items.push({ id, qty, name: cleanText(it.name, 24) });
    }
    const bits = Number.isInteger(o?.bits) && o.bits > 0 && o.bits <= 9999999 ? o.bits : 0;
    return { items, bits };
}

export class Hub {
    constructor({ rand = Math.random, now = () => Date.now(), maxPeers = MAX_PEERS, awayMs = AWAY_MS, keyGen = makeKey } = {}) {
        this.rand = rand;
        this.now = now;
        this.maxPeers = maxPeers;
        this.awayMs = awayMs;
        this.keyGen = keyGen;
        this.rooms = new Map();      // code -> { peers: Map(id -> peer), host, league, pair }; an away seat stays in `peers` with away = true
        this.trades = new Map();     // peer id -> its open trade (both players point at the same object)
        this.nextId = 1;
    }

    /** Connect a client. `send(string)` delivers to it. `rj` = it knows about seats; `key` = it wants its old seat back. Returns { session } or { error }. */
    open(send, { room, create, name, rj = false, key = null } = {}) {
        const aware = !!rj || !!key;                     // every current game; an older game sends neither and is treated as before
        let code, seat = null;
        if (create) {
            if (this.rooms.size >= MAX_ROOMS) return { error: "busy" };
            code = room ? cleanCode(room) : null;
            if (room && !code) return { error: "bad" };
            if (!code) {
                for (let i = 0; i < 20 && (!code || this.rooms.has(code)); i++) code = makeCode(this.rand);
            }
            if (this.rooms.has(code)) return { error: "exists" };
            this.rooms.set(code, { peers: new Map(), host: null, league: null, pair: null });
        } else {
            code = cleanCode(room);
            if (!code) return { error: "bad" };
            const known = this.rooms.get(code);
            if (!known) return { error: "no_room" };
            if (key) {
                seat = KEY_RE.test(key) ? ([...known.peers.values()].find((p) => p.key === key) ?? null) : null;
                if (!seat) return { error: "gone" };        // not a seat of THIS room, or it expired
                if (!seat.away) seat = null;                // still live (a second tab): no take-over, join as a new player below
            }
            if (!seat && known.peers.size >= this.maxPeers) return { error: "full" };
        }
        const r = this.rooms.get(code);
        if (seat) return this.#resume(code, r, seat, send);
        const peer = {
            id: this.nextId++, name: cleanName(name), send, map: null, x: 0, y: 0, dir: "down", mv: 0,
            card: null, lastChat: 0, tokens: LIMIT * 2, last: this.now(),
            rj: aware, key: aware ? this.keyGen() : null, away: false, awayAt: 0, gen: 0, bye: false,
        };
        const roster = [...r.peers.values()].filter((p) => aware || !p.away).map((p) => this.#entry(p));   // an older client never hears about an away seat (as if it had left)
        r.peers.set(peer.id, peer);
        if (r.host == null) r.host = peer.id;               // whoever made the room runs its Server Champ nights
        this.#to(peer, { t: "welcome", id: peer.id, room: code, host: r.host, roster, ...(aware ? { key: peer.key } : {}) });
        if (r.league) this.#to(peer, { t: "lg", op: "state", host: r.host, ev: null, pair: r.pair, lg: packLeague(r.league) });   // join mid-night: see the bracket
        for (const o of r.peers.values()) if (o !== peer) this.#to(o, { t: "join", id: peer.id, name: peer.name });
        return { session: this.#session(code, peer) };
    }

    /** One roster row. Only an away seat carries `away`, so a plain roster has the same shape as before. */
    #entry(p) {
        return p.away ? { id: p.id, name: p.name, map: p.map, card: p.card, away: true } : { id: p.id, name: p.name, map: p.map, card: p.card };
    }

    /** The handle a socket gets. A close or message from a socket that has since been replaced by a return (gen moved on) is ignored. */
    #session(code, peer) {
        const gen = peer.gen;
        return {
            id: peer.id, room: code,
            onMessage: (raw) => { if (peer.gen === gen) this.#message(code, peer, raw); },
            onClose: () => { if (peer.gen === gen) this.#close(code, peer); },
        };
    }

    /** A returning seat: same id, name, card and place. The name in the URL is ignored. */
    #resume(code, r, peer, send) {
        peer.send = send; peer.gen++; peer.away = false; peer.awayAt = 0;
        peer.tokens = LIMIT * 2; peer.last = this.now();
        const roster = [...r.peers.values()].filter((p) => p !== peer).map((p) => this.#entry(p));
        const cur = r.peers.get(r.host);
        const takeHost = r.host !== peer.id && (!cur || cur.away);   // every present player left while the host was away: the first to return runs the room
        if (takeHost) r.host = peer.id;
        this.#to(peer, { t: "welcome", id: peer.id, room: code, host: r.host, roster, key: peer.key, resumed: true, at: { map: peer.map, x: peer.x, y: peer.y, dir: peer.dir } });
        if (r.league) this.#to(peer, { t: "lg", op: "state", host: r.host, ev: null, pair: r.pair, lg: packLeague(r.league) });
        for (const o of r.peers.values()) {
            if (o === peer) continue;
            if (o.rj) this.#to(o, { t: "back", id: peer.id });
            else { this.#to(o, { t: "join", id: peer.id, name: peer.name }); if (peer.card) this.#to(o, { t: "card", id: peer.id, card: peer.card }); }
        }
        if (takeHost) for (const o of r.peers.values()) if (o !== peer) this.#to(o, { t: "host", id: r.host });
        this.#show(r, peer);
        return { session: this.#session(code, peer) };
    }

    /** Tell the room where a returning player stands: the same fan-out as walking into a stage (#pos). */
    #show(r, peer) {
        if (!peer.map) return;
        this.#others(r, peer, { t: "at", id: peer.id, map: peer.map });
        const msg = { t: "pos", id: peer.id, map: peer.map, x: peer.x, y: peer.y, dir: peer.dir, mv: 0 };
        for (const o of r.peers.values()) {
            if (o === peer || o.away || o.map !== peer.map) continue;
            this.#to(o, msg);
            this.#to(peer, { t: "pos", id: o.id, map: o.map, x: o.x, y: o.y, dir: o.dir, mv: o.mv });
        }
    }

    #to(peer, obj) {
        if (!peer) return;
        try { peer.send(JSON.stringify(obj)); } catch { /* the socket is already going away */ }
    }

    #others(r, peer, msg) { for (const o of r.peers.values()) if (o !== peer) this.#to(o, msg); }

    #close(code, peer) {
        const r = this.rooms.get(code);
        if (!r || !r.peers.has(peer.id) || peer.away) return;
        if (peer.rj && !peer.bye) { this.#away(r, peer); return; }   // a drop keeps the seat; "bye" (Leave) does not
        this.#remove(code, r, peer);
    }

    /** The old removal, unchanged: the player is gone for good. */
    #remove(code, r, peer) {
        r.peers.delete(peer.id);
        this.#endTrade(r, peer, "left");
        for (const o of r.peers.values()) this.#to(o, { t: "leave", id: peer.id });
        if (!r.peers.size) { this.rooms.delete(code); return; }   // the room and its Server Champ night are gone
        this.#dropFromNight(r, peer);
    }

    /** A rj player's socket closed: keep the seat for awayMs. Id, name, map, x, y, dir and card stay. */
    #away(r, peer) {
        peer.away = true; peer.awayAt = this.now(); peer.send = NOOP;
        this.#endTrade(r, peer, "away");              // the client shows "ended the trade." for a reason it has no text for
        for (const o of r.peers.values()) if (o !== peer) this.#to(o, o.rj ? { t: "away", id: peer.id } : { t: "leave", id: peer.id });
        this.#dropFromNight(r, peer);
    }

    /** Host role and Server Champ night when `peer` is gone or away (the rules of the old #close, unchanged). */
    #dropFromNight(r, peer) {
        if (r.host === peer.id) {
            // only the host can run a night, so theirs ends here; the next present tamer can open a new one
            const next = [...r.peers.values()].find((p) => p !== peer && !p.away);
            const had = r.league != null;
            r.league = null; r.pair = null;
            if (!next) return;                        // everyone else is away too: the first to return takes the role (#resume)
            r.host = next.id;
            if (had) this.#league(r, { k: "closed" });
            for (const o of r.peers.values()) this.#to(o, { t: "host", id: r.host });
        } else if (r.league && r.league.ids.includes(peer.id) && !r.league.dropped.includes(peer.id)) {
            // a tamer who disconnects mid-night counts as a loss for that fight and leaves the night (no re-entry)
            const res = forfeit(r.league, peer.id);
            if (res.ok) {
                r.pair = nextPairing(r.league);
                this.#league(r, { k: "drop", id: peer.id, w: res.to ?? undefined });
            }
        }
    }

    /** Remove every away seat older than awayMs. The relay calls this on every heartbeat. */
    sweep() {
        const t = this.now();
        for (const [code, r] of [...this.rooms]) {
            for (const p of [...r.peers.values()]) {
                if (!p.away || t - p.awayAt < this.awayMs) continue;
                r.peers.delete(p.id);
                for (const o of r.peers.values()) if (o.rj) this.#to(o, { t: "leave", id: p.id });   // older clients got their leave when the seat went away
            }
            if (!r.peers.size) this.rooms.delete(code);
        }
    }

    #message(code, peer, raw) {
        const r = this.rooms.get(code);
        if (!r || peer.away || typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
        if (raw.length > SMALL && !raw.startsWith('{"t":"card"') && !raw.startsWith('{"t":"mpb"')) return;
        const t = this.now();
        peer.tokens = Math.min(LIMIT * 2, peer.tokens + ((t - peer.last) / 1000) * LIMIT);
        peer.last = t;
        if (peer.tokens < 1) return;     // too fast: drop it (a real client sends about 10 a second)
        peer.tokens -= 1;
        let m;
        try { m = JSON.parse(raw); } catch { return; }
        if (!m || typeof m !== "object") return;
        if (m.t === "bye") { peer.bye = true; return; }   // the Leave button: my close is not a drop
        if (m.t === "ping") return this.#to(peer, { t: "pong" });
        if (m.t === "pos") return this.#pos(r, peer, m);
        if (m.t === "chat") return this.#chat(r, peer, m);
        if (m.t === "feed") return this.#feed(r, peer, m);
        if (m.t === "card") return this.#card(r, peer, m);
        if (m.t === "trade") return this.#trade(r, peer, m);
        if (m.t === "duel") return this.#direct(r, peer, m, "duel", DUEL_OPS);
        if (m.t === "coop") return this.#coop(r, peer, m);
        if (m.t === "mpb") return this.#mpb(r, peer, m);
        if (m.t === "lg") return this.#lg(r, peer, m);
        if (m.t === "emote" && Number.isInteger(m.e) && m.e >= 0 && m.e <= 7) {
            for (const o of r.peers.values()) if (o !== peer && o.map && o.map === peer.map) this.#to(o, { t: "emote", id: peer.id, e: m.e });
        }
    }

    #pos(r, peer, m) {
        if (!MAP_ID.test(m.map ?? "") || !finite(m.x, 100000) || !finite(m.y, 100000)) return;
        const dir = DIRS.test(m.dir ?? "") ? m.dir : "down";
        const left = peer.map && peer.map !== m.map ? peer.map : null;
        const entered = peer.map !== m.map;
        peer.map = m.map; peer.x = Math.round(m.x); peer.y = Math.round(m.y); peer.dir = dir; peer.mv = m.mv ? 1 : 0;
        if (entered) this.#others(r, peer, { t: "at", id: peer.id, map: peer.map });
        const msg = { t: "pos", id: peer.id, map: peer.map, x: peer.x, y: peer.y, dir: peer.dir, mv: peer.mv };
        for (const o of r.peers.values()) {
            if (o === peer) continue;
            if (left && o.map === left) this.#to(o, { t: "gone", id: peer.id });
            if (o.map === peer.map) {
                this.#to(o, msg);
                // moving into a stage: also show me who is already standing there
                if (entered) this.#to(peer, { t: "pos", id: o.id, map: o.map, x: o.x, y: o.y, dir: o.dir, mv: o.mv });
            }
        }
    }

    #chat(r, peer, m) {
        const text = cleanText(m.text, CHAT_MAX);
        const t = this.now();
        if (!text || t - peer.lastChat < CHAT_GAP) return;
        peer.lastChat = t;
        // everyone gets the line for their log; a client shows the bubble only when the speaker is in its stage
        this.#others(r, peer, { t: "chat", id: peer.id, text, map: peer.map });
    }

    #feed(r, peer, m) {
        const text = cleanText(m.text, FEED_MAX);
        if (!text || !FEED_KINDS.has(m.kind)) return;
        this.#others(r, peer, { t: "feed", id: peer.id, kind: m.kind, text });
    }

    /** A player card is free-form JSON from a client: keep it small. Clients only ever draw it as text. */
    #card(r, peer, m) {
        const card = m.card;
        if (!card || typeof card !== "object" || Array.isArray(card)) return;
        const json = JSON.stringify(card);
        if (json.length > CARD_MAX) return;
        peer.card = JSON.parse(json);
        this.#others(r, peer, { t: "card", id: peer.id, card: peer.card });
    }

    // ---- #direct
    // Short messages from one player to one other player in the room (duel requests and results). The relay keeps no state
    // for them: it checks the op, fills in who it is from, and passes on only the few plain fields that op may carry.
    #direct(r, peer, m, type, ops) {
        const to = r.peers.get(m.to);
        if (!to || to === peer || to.away || !ops.has(m.op)) return;
        const out = { t: type, op: m.op, from: peer.id };
        if (m.op === "result") {
            out.hp = typeof m.hp === "number" && Number.isFinite(m.hp) ? Math.max(0, Math.min(1, m.hp)) : 0;
            out.won = !!m.won;
        }
        this.#to(to, out);
    }

    // ---- #mpb
    // Messages of a many-vs-many fight: a JSON object (up to ~6 KB: the setup carries each player's fighter record) passed to up to 8 named players in the room. The relay never reads
    // it beyond its size: it only fills in who it is from. (The fight is run by the players' games, see web/mpbattle.js.)
    #mpb(r, peer, m) {
        if (!m.d || typeof m.d !== "object" || Array.isArray(m.d) || JSON.stringify(m.d).length > 6500) return;
        const ids = (Array.isArray(m.to) ? m.to : [m.to]).slice(0, 8);
        for (const id of ids) {
            const to = r.peers.get(id);
            if (to && to !== peer && !to.away) this.#to(to, { t: "mpb", from: peer.id, d: m.d });
        }
    }

    // ---- #coop
    // pask/pyes/pno/pleave: two players team up (or stop). ask{foes,label}/yes/no/cancel: one starts a fight and invites the
    // other, who fights the same enemies. hit{i,hp}: "enemy number i is down to hp", so the two of them share its HP.
    // Like duels, the relay only checks, labels the sender and passes on a few plain fields.
    #coop(r, peer, m) {
        const to = r.peers.get(m.to);
        if (!to || to === peer || to.away || !COOP_OPS.has(m.op)) return;
        const out = { t: "coop", op: m.op, from: peer.id };
        if (m.op === "ask") {
            const foes = [];
            for (const f of Array.isArray(m.foes) ? m.foes.slice(0, 6) : []) {
                const name = cleanText(f?.name, 24), int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
                const level = int(f?.level, 1, 99), hp = int(f?.hp, 1, 999999), mp = int(f?.mp ?? 0, 0, 99999), scale = int(f?.stat_scale ?? 16, 1, 64);
                if (name && level != null && hp != null && mp != null && scale != null) foes.push({ name, level, hp, mp, stat_scale: scale });
            }
            if (!foes.length) return;
            out.foes = foes; out.label = cleanText(m.label, 40);
            const sc = (Array.isArray(m.screens) ? m.screens.slice(0, 8) : []).filter((v) => Number.isInteger(v) && v >= 0 && v <= 99999);
            if (sc.length) out.screens = sc;
        } else if (m.op === "stat") {                       // my Digimon, shown on my partner's battle screen
            const int = (v) => (Number.isInteger(v) && v >= 0 && v <= 999999 ? v : 0);
            out.name = cleanText(m.name, 24); out.hp = int(m.hp); out.maxHp = int(m.maxHp);
        } else if (m.op === "hit") {
            if (!Number.isInteger(m.i) || m.i < 0 || m.i > 20 || !Number.isInteger(m.hp) || m.hp < 0 || m.hp > 999999) return;
            out.i = m.i; out.hp = m.hp;
        }
        this.#to(to, out);
    }

    // ---- #lg
    // A Server Champ night: 2..8 tamers of this room, one bracket, best of three fights (web/mp-league.js holds
    // the rules). The room keeps the bracket for the evening and drops it when it closes or its host leaves.
    // The host alone opens it, calls a fight (`next`) and reports one (`win`); a tamer may only drop themselves.
    //   client -> relay: open{ids,bestOf?} | next | win{winner,games} | drop
    //   relay -> everyone: {t:"lg", op:"state", host, ev, pair, lg}   (lg = null when the night is over)
    //   relay -> one peer: {t:"lg", op:"no", why}                      (a refused request)
    #league(r, ev) {
        const msg = { t: "lg", op: "state", host: r.host, ev, pair: r.pair, lg: packLeague(r.league) };
        for (const o of r.peers.values()) this.#to(o, msg);
    }

    #lg(r, peer, m) {
        const no = (why) => this.#to(peer, { t: "lg", op: "no", why });
        if (!m || typeof m.op !== "string") return;
        if (m.op === "drop") {                                   // anyone may leave the night, but only themselves
            if (!r.league) return no("no_league");
            const res = forfeit(r.league, peer.id);
            if (res.refused) return no(res.refused);
            r.pair = nextPairing(r.league);
            return this.#league(r, { k: "drop", id: peer.id, w: res.to ?? undefined });
        }
        if (peer.id !== r.host) return;                          // everything else is the host's alone
        if (m.op === "open") {
            if (r.league && r.league.phase !== "done") return no("open");   // one night at a time; a won one makes way for the next
            const ids = Array.isArray(m.ids) ? m.ids : [];
            if (ids.length < 2 || ids.length > 8 || new Set(ids).size !== ids.length
                || !ids.every((id) => Number.isInteger(id) && r.peers.has(id) && !r.peers.get(id).away)) return no("ids");
            r.league = newLeague({ ids, bestOf: m.bestOf === 1 ? 1 : 3 });
            r.pair = null;
            return this.#league(r, { k: "open" });
        }
        if (!r.league) return no("no_league");
        if (m.op === "next") {
            if (r.league.phase === "done") return no("done");
            r.pair = nextPairing(r.league);
            if (!r.pair) return this.#league(r, { k: "round", r: r.league.r });
            return this.#league(r, { k: "pair", a: r.pair.a, b: r.pair.b, r: r.pair.r, m: r.pair.m, game: r.pair.game });
        }
        if (m.op === "win") {
            const res = report(r.league, m.winner, m.games);
            if (res.refused) return no(res.refused);
            r.pair = nextPairing(r.league);
            if (!res.ended) return this.#league(r, { k: "game", a: res.a, b: res.b, n: res.games.length, w: m.winner });
            const won = r.league.champ === res.winner;
            // the score is written from the winner's side, whoever of the two won (web/mp-league.js matchScore)
            const g = matchScore({ a: res.a, b: res.b, w: res.winner, g: res.games });
            return this.#league(r, { k: "win", w: res.winner, l: res.a === res.winner ? res.b : res.a, g, c: won ? 1 : undefined });
        }
    }

    // ---- #trade
    // Two players, one open trade each. The relay keeps the two offers and who has pressed OK; the two games move the
    // items themselves when it says "done". Any change to either offer clears both OKs, so what you accept is what you get.
    // client -> relay: ask{to}, yes, no, offer{items:[{id,qty,name}],bits}, ok, cancel
    // relay -> client: ask{from}, open{with}, offer{from,items,bits}, ok{from}, done{gives,gets}, end{reason}
    #endTrade(r, peer, reason) {
        const tr = this.trades.get(peer.id);
        if (!tr) return;
        this.trades.delete(tr.a); this.trades.delete(tr.b);
        const other = r.peers.get(tr.a === peer.id ? tr.b : tr.a);
        if (other && other !== peer) this.#to(other, { t: "trade", op: "end", reason });
    }

    #trade(r, peer, m) {
        const tr = this.trades.get(peer.id);
        if (m.op === "ask") {
            const to = r.peers.get(m.to);
            if (!to || to.away || to === peer || tr || this.trades.has(to.id)) return this.#to(peer, { t: "trade", op: "end", reason: to && !to.away ? "busy" : "gone" });
            const t = { a: peer.id, b: to.id, state: "asked", offer: {}, ok: {} };
            this.trades.set(peer.id, t); this.trades.set(to.id, t);
            return this.#to(to, { t: "trade", op: "ask", from: peer.id });
        }
        if (!tr) return;
        const other = r.peers.get(tr.a === peer.id ? tr.b : tr.a);
        if (m.op === "no" || m.op === "cancel") {
            const reason = m.op === "no" ? "declined" : "cancelled";
            this.#endTrade(r, peer, reason);
            return this.#to(peer, { t: "trade", op: "end", reason: "cancelled" });
        }
        if (m.op === "yes" && tr.state === "asked" && tr.b === peer.id) {
            tr.state = "open";
            tr.offer = { [tr.a]: { items: [], bits: 0 }, [tr.b]: { items: [], bits: 0 } };
            this.#to(peer, { t: "trade", op: "open", with: tr.a });
            return this.#to(other, { t: "trade", op: "open", with: tr.b });
        }
        if (tr.state !== "open" || !other) return;
        if (m.op === "offer") {
            tr.offer[peer.id] = cleanOffer(m); tr.ok = {};
            const msg = { t: "trade", op: "offer", from: peer.id, ...tr.offer[peer.id] };
            this.#to(peer, msg); return this.#to(other, msg);
        }
        if (m.op === "ok") {
            tr.ok[peer.id] = true;
            this.#to(other, { t: "trade", op: "ok", from: peer.id });
            if (tr.ok[tr.a] && tr.ok[tr.b]) {
                this.trades.delete(tr.a); this.trades.delete(tr.b);
                this.#to(r.peers.get(tr.a), { t: "trade", op: "done", gives: tr.offer[tr.a], gets: tr.offer[tr.b] });
                this.#to(r.peers.get(tr.b), { t: "trade", op: "done", gives: tr.offer[tr.b], gets: tr.offer[tr.a] });
            }
        }
    }
}
