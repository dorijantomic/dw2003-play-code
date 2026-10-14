// EXPERIMENT: the optional multiplayer relay as a plain Node program (not original game content).
//
//   node server/relay.mjs            listens on port 20031 (PORT=... to change it)
//
// Use it to host your own server for friends (put it behind a tunnel or any host that gives you a wss:// address), or
// locally to test. The same room logic runs on Cloudflare in server/worker/. It carries player names, the stage id
// and positions only: no game data, nothing from anyone's disc.
import http from "node:http";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { Hub, MAX_MESSAGE } from "./room-core.mjs";

/** This computer's IPv4 addresses, the ones a friend on Hamachi / Radmin / Tailscale / the same Wi-Fi would type. */
export function addresses() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
        for (const a of list ?? []) {
            if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
            const [p, q] = a.address.split(".").map(Number);
            const kind = p === 25 || /hamachi/i.test(name) ? "Hamachi"
                : p === 26 || /radmin/i.test(name) ? "Radmin VPN"
                : (p === 100 && q >= 64 && q <= 127) || /tailscale/i.test(name) ? "Tailscale"
                : "this network";
            out.push({ ip: a.address, kind });
        }
    }
    return out.sort((x, y) => (x.kind === "this network") - (y.kind === "this network"));
}

const PER_IP = 12;                       // sockets one address may hold open at once

export function startRelay({ port = 20031, host = "0.0.0.0", hub = new Hub({ maxPeers: Number(process.env.MP_MAX) || undefined }) } = {}) {
    const byIp = new Map();
    const server = http.createServer((req, res) => {
        if (req.url === "/info") {
            res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
            res.end(JSON.stringify({ ok: true, addresses: addresses(), port: server.address().port }));
            return;
        }
        if (req.url === "/health") {
            res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
            res.end(JSON.stringify({ ok: true, rooms: hub.rooms.size }));
            return;
        }
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("DW2003 multiplayer relay. Connect with a WebSocket.\n");
    });
    const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE });
    wss.on("connection", (ws, req) => {
        const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress).split(",")[0].trim();
        const n = byIp.get(ip) ?? 0;
        const q = new URL(req.url, "http://relay").searchParams;
        const sendRaw = (s) => { if (ws.readyState === ws.OPEN) ws.send(s); };
        if (n >= PER_IP) { sendRaw(JSON.stringify({ t: "err", reason: "busy" })); ws.close(); return; }
        const r = hub.open(sendRaw, { room: q.get("room"), create: q.get("create") === "1", name: q.get("name") });
        if (r.error) { sendRaw(JSON.stringify({ t: "err", reason: r.error })); ws.close(); return; }
        byIp.set(ip, n + 1);
        ws.isAlive = true;
        ws.on("pong", () => { ws.isAlive = true; });
        ws.on("message", (data) => r.session.onMessage(data.toString()));
        ws.on("close", () => {
            r.session.onClose();
            const left = (byIp.get(ip) ?? 1) - 1;
            if (left > 0) byIp.set(ip, left); else byIp.delete(ip);
        });
        ws.on("error", () => ws.terminate());
    });
    // drop sockets that stopped answering (a closed laptop, a lost connection) so their player disappears for the others
    const beat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.isAlive) { ws.terminate(); continue; }
            ws.isAlive = false;
            ws.ping();
        }
    }, 30000);
    return new Promise((resolve) => {
        server.listen(port, host, () => resolve({
            port: server.address().port, hub,
            close: () => new Promise((done) => { clearInterval(beat); for (const c of wss.clients) c.terminate(); wss.close(); server.close(done); }),
        }));
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    const r = await startRelay({ port: Number(process.env.PORT) || 20031 });
    console.log(`DW2003 relay listening on port ${r.port}`);
}
