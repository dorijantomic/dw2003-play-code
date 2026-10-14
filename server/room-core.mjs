// EXPERIMENT: the room logic of the optional multiplayer relay (not original game content).
//
// Pure and transport-free, so the same code runs in the Node relay (server/relay.mjs), in the Cloudflare Worker
// (server/worker/index.js) and in the unit tests. It never sees game data: only a player's display name, the stage id
// they are standing in, a position, a facing and an emote number.
//
// A client connects with a URL query: `?create=1&name=Ken` makes a new room and gets its code, `?room=ABCDE&name=Ana`
// joins one. After that it sends small JSON messages:
//   {t:"pos", map, x, y, dir, mv}   where I am (only players in the same stage are told)
//   {t:"emote", e}                  a small icon over my head, e = 0..7
//   {t:"ping"}                      keep-alive, answered with {t:"pong"}
// and receives:
//   {t:"welcome", id, room, roster:[{id,name}]}
//   {t:"join", id, name} / {t:"leave", id}
//   {t:"pos", id, map, x, y, dir, mv} / {t:"gone", id} (that player left my stage) / {t:"emote", id, e}
//   {t:"err", reason}   reasons: no_room, full, exists, busy, bad
export const MAX_PEERS = 8;          // a room is a few friends, not a crowd
export const MAX_ROOMS = 200;        // per relay, so a flood of "create" cannot fill its memory
export const MAX_MESSAGE = 400;      // bytes; a position update is about 80
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I, O, 0, 1: easy to read out loud
const CODE_LEN = 5;
const DIRS = /^[a-z]{2,5}(-[a-z]{2,5})?$/;            // "down", "up-right"
const MAP_ID = /^[A-Za-z0-9_-]{1,24}$/;
const LIMIT = 80;                    // messages a second a player may send before the rest are dropped (burst is 2x)

export function makeCode(rand = Math.random) {
    let s = "";
    for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
    return s;
}

export function cleanCode(s) {
    const c = String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return c.length === CODE_LEN && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}

export function cleanName(s) {
    const n = String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 12).trim();
    return n || "Tamer";
}

const finite = (n, lim) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= lim;

export class Hub {
    constructor({ rand = Math.random, now = () => Date.now() } = {}) {
        this.rand = rand;
        this.now = now;
        this.rooms = new Map();      // code -> { peers: Map(id -> peer) }
        this.nextId = 1;
    }

    /** Connect a client. `send(string)` delivers to it. Returns { session } or { error }. */
    open(send, { room, create, name } = {}) {
        let code;
        if (create) {
            if (this.rooms.size >= MAX_ROOMS) return { error: "busy" };
            code = room ? cleanCode(room) : null;
            if (room && !code) return { error: "bad" };
            if (!code) {
                for (let i = 0; i < 20 && (!code || this.rooms.has(code)); i++) code = makeCode(this.rand);
            }
            if (this.rooms.has(code)) return { error: "exists" };
            this.rooms.set(code, { peers: new Map() });
        } else {
            code = cleanCode(room);
            if (!code) return { error: "bad" };
            if (!this.rooms.has(code)) return { error: "no_room" };
            if (this.rooms.get(code).peers.size >= MAX_PEERS) return { error: "full" };
        }
        const r = this.rooms.get(code);
        const peer = {
            id: this.nextId++, name: cleanName(name), send, map: null, x: 0, y: 0, dir: "down", mv: 0,
            tokens: LIMIT * 2, last: this.now(),
        };
        const roster = [...r.peers.values()].map((p) => ({ id: p.id, name: p.name }));
        r.peers.set(peer.id, peer);
        this.#to(peer, { t: "welcome", id: peer.id, room: code, roster });
        for (const o of r.peers.values()) if (o !== peer) this.#to(o, { t: "join", id: peer.id, name: peer.name });
        return {
            session: {
                id: peer.id, room: code,
                onMessage: (raw) => this.#message(code, peer, raw),
                onClose: () => this.#close(code, peer),
            },
        };
    }

    #to(peer, obj) {
        try { peer.send(JSON.stringify(obj)); } catch { /* the socket is already going away */ }
    }

    #close(code, peer) {
        const r = this.rooms.get(code);
        if (!r || !r.peers.delete(peer.id)) return;
        for (const o of r.peers.values()) this.#to(o, { t: "leave", id: peer.id });
        if (!r.peers.size) this.rooms.delete(code);
    }

    #message(code, peer, raw) {
        const r = this.rooms.get(code);
        if (!r || typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
        const t = this.now();
        peer.tokens = Math.min(LIMIT * 2, peer.tokens + ((t - peer.last) / 1000) * LIMIT);
        peer.last = t;
        if (peer.tokens < 1) return;     // too fast: drop it (a real client sends about 10 a second)
        peer.tokens -= 1;
        let m;
        try { m = JSON.parse(raw); } catch { return; }
        if (!m || typeof m !== "object") return;
        if (m.t === "ping") return this.#to(peer, { t: "pong" });
        if (m.t === "pos") return this.#pos(r, peer, m);
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
}
