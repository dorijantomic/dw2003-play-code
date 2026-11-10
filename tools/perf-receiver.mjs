// Receiver for web/perf-test.html: takes the finished results as JSON and writes them OUTSIDE the repo.
//
//   node tools/perf-receiver.mjs [port]          (default 20032; env PERF_PORT, PERF_DIR also work)
//
//   POST /results   body = the results JSON  -> ~/perf-results/<browser>-<timestamp>.json   answer {ok, file}
//   POST /backup    body = any JSON          -> ~/perf-results/backup-<timestamp>.json       (the page's saved localStorage)
//   POST /progress  body = JSON line (scene id, tries, status) -> appended to ~/perf-results/progress.log
//   GET  /ping                               -> {ok:true}
// No dependencies. CORS is open (the test page is on another port). Nothing from the game's data is stored here.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.argv[2] || process.env.PERF_PORT || 20032);
const DIR = process.env.PERF_DIR || path.join(os.homedir(), "perf-results");
const MAX_BYTES = 64 * 1024 * 1024;

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
};

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
const clean = (s, fallback) => String(s || fallback).toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 24) || fallback;

function send(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { ...CORS, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let n = 0;
        req.on("data", (c) => {
            n += c.length;
            if (n > MAX_BYTES) { reject(Object.assign(new Error("too large"), { code: 413 })); req.destroy(); return; }
            chunks.push(c);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

export function createServer() {
    return http.createServer(async (req, res) => {
        const url = new URL(req.url, "http://x");
        if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
        if (req.method === "GET" && url.pathname === "/ping") { send(res, 200, { ok: true, dir: DIR }); return; }
        if (req.method === "POST" && url.pathname === "/progress") {
            try {
                const json = JSON.parse(await readBody(req));
                fs.mkdirSync(DIR, { recursive: true });
                fs.appendFileSync(path.join(DIR, "progress.log"), JSON.stringify({ ...json, got: new Date().toISOString() }) + "\n");
                send(res, 200, { ok: true });
            } catch (e) { send(res, e.code === 413 ? 413 : 400, { ok: false, error: String(e.message || e) }); }
            return;
        }
        if (req.method === "POST" && (url.pathname === "/results" || url.pathname === "/backup")) {
            try {
                const text = await readBody(req);
                const json = JSON.parse(text);   // refuse anything that is not JSON
                fs.mkdirSync(DIR, { recursive: true });
                const kind = url.pathname === "/backup" ? "backup" : clean(json?.meta?.browser, "browser");
                let file = `${kind}-${stamp()}.json`;
                if (fs.existsSync(path.join(DIR, file))) file = `${kind}-${stamp()}-${process.pid}.json`;
                fs.writeFileSync(path.join(DIR, file), JSON.stringify(json, null, 1));
                console.log(`${new Date().toISOString()} wrote ${path.join(DIR, file)} (${text.length} bytes)`);
                send(res, 200, { ok: true, file, dir: DIR });
            } catch (e) {
                send(res, e.code === 413 ? 413 : 400, { ok: false, error: String(e.message || e) });
            }
            return;
        }
        send(res, 404, { ok: false, error: "not found" });
    });
}

if (process.argv[1]?.endsWith("perf-receiver.mjs")) {
    createServer().listen(PORT, "0.0.0.0", () => console.log(`perf receiver on port ${PORT}, writing to ${DIR}`));
}
