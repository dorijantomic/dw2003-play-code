// Safety net recorder: plays one scripted scenario with fixed dice and a fake clock
// (exactly 1000/60 ms per frame), writes one JSON line per frame.
//   tools/run-playwright.sh tools/rewrite/record.mjs --repo <path> --port <n> --scenario field|battle|menu --seed <n> --out <file.jsonl>
// GPU only: launches Chromium with the HARDWARE args of tools/verify-launch.mjs and
// prints the WebGL renderer; a software renderer stops the run.
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
const repo = resolve(args.repo ?? ".");
const port = Number(args.port ?? 8191);
const scenarioName = args.scenario ?? "field";
const seed = Number(args.seed ?? 1);
const out = args.out;
// --mutate "<web path>|<old text>|<new text>": changes the SERVED text in memory only (no file is
// touched). Used to prove the net catches a break. The old text must occur exactly once.
const mutate = args.mutate ? args.mutate.split("|") : null;
if (!out) throw new Error("--out is required");

// playwright: the repo's own copy, else the old game's.
const req = createRequire(import.meta.url);
let pwPath = null;
for (const base of [repo, join(homedir(), "dw2003-play-integration")]) {
  try { pwPath = req.resolve("playwright", { paths: [base] }); break; } catch { /* next */ }
}
if (!pwPath) throw new Error("playwright not found");
const { chromium } = await import(pathToFileURL(pwPath).href).then((m) => m.default ?? m);
const HARDWARE = ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu"];

// ---- static server for <repo>/web (no cache) ----
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".css": "text/css", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".svg": "image/svg+xml" };
const webRoot = realpathSync(join(repo, "web"));
const server = http.createServer((rq, rs) => {
  try {
    let p = normalize(decodeURIComponent(new URL(rq.url, "http://x").pathname));
    if (p.endsWith("/")) p += "index.html";
    const f = join(webRoot, p);
    if (!existsSync(f) || statSync(f).isDirectory()) { rs.writeHead(404); rs.end(); return; }
    rs.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream", "cache-control": "no-store" });
    let body = readFileSync(f);
    if (mutate && p === "/" + mutate[0].replace(/^web\//, "")) {
      const t = body.toString("utf8");
      if (t.split(mutate[1]).length !== 2) throw new Error("mutate: old text must occur exactly once in " + mutate[0]);
      body = Buffer.from(t.replace(mutate[1], () => mutate[2]));
    }
    rs.end(body);
  } catch { rs.writeHead(500); rs.end(); }
});
await new Promise((r) => server.listen(port, "127.0.0.1", r));

// ---- init script: runs in the page before any page script ----
function initScript(seed) {
  const realSetTimeout = window.setTimeout.bind(window);
  let s = seed >>> 0;
  let rndCalls = 0; const rnd = () => { rndCalls++; s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  Math.random = rnd;
  if (window.crypto) {
    window.crypto.getRandomValues = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < u.length; i++) u[i] = (rnd() * 256) | 0; return a; };
    window.crypto.randomUUID = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (rnd() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); });
  }
  const FRAME = 1000 / 60, EPOCH = 1.8e12;
  let T = 1000, frames = 0, nid = 1;
  performance.now = () => T;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(EPOCH + T); else super(...a); }
    static now() { return EPOCH + T; }
  }
  window.Date = FakeDate;
  let rafQ = [];
  window.requestAnimationFrame = (cb) => { const id = nid++; rafQ.push([id, cb]); return id; };
  window.cancelAnimationFrame = (id) => { rafQ = rafQ.filter((e) => e[0] !== id); };
  const timers = new Map();
  const addTimer = (cb, ms, rep, a) => { const id = nid++; timers.set(id, { id, cb, at: T + Math.max(0, Number(ms) || 0), rep: rep ? Math.max(1, Number(ms) || 0) : 0, a }); return id; };
  window.setTimeout = (cb, ms, ...a) => addTimer(cb, ms, false, a);
  window.setInterval = (cb, ms, ...a) => addTimer(cb, ms, true, a);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  window.requestIdleCallback = (cb) => addTimer(() => cb({ didTimeout: false, timeRemaining: () => 10 }), 1, false, []);
  window.cancelIdleCallback = (id) => { timers.delete(id); };
  // loads finish in real time: a frame only runs when none are pending
  let pending = 0;
  const track = (p) => { pending++; const done = () => { pending--; }; p.then(done, done); return p; };
  const rf = window.fetch.bind(window);
  window.fetch = (...a) => track(rf(...a));
  for (const m of ["json", "text", "arrayBuffer", "blob"]) { const orig = Response.prototype[m]; Response.prototype[m] = function (...a) { return track(orig.apply(this, a)); }; }
  if (window.createImageBitmap) { const c = window.createImageBitmap.bind(window); window.createImageBitmap = (...a) => track(c(...a)); }
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    get() { return srcDesc.get.call(this); },
    set(v) {
      pending++; let d = false; const done = () => { if (!d) { d = true; pending--; } };
      this.addEventListener("load", done, { once: true }); this.addEventListener("error", done, { once: true });
      srcDesc.set.call(this, v);
    },
  });
  const rxo = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) { pending++; this.addEventListener("loadend", () => { pending--; }, { once: true }); return rxo.apply(this, a); };
  const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));
  window.__rw = {
    get frames() { return frames; },
    get pending() { return pending; },
    async step() {
      let guard = 0;
      while (pending > 0 && guard++ < 20000) await sleep(2);
      await sleep(0);
      T += FRAME; frames++;
      const due = [...timers.values()].filter((t) => t.at <= T).sort((a, b) => a.at - b.at || a.id - b.id);
      for (const t of due) {
        if (!timers.has(t.id)) continue;
        if (t.rep) t.at += t.rep; else timers.delete(t.id);
        try { t.cb(...t.a); } catch (e) { realSetTimeout(() => { throw e; }); }
      }
      const q = rafQ; rafQ = [];
      for (const [, cb] of q) { try { cb(T); } catch (e) { realSetTimeout(() => { throw e; }); } }
      await sleep(0);
    },
  };
  // the per-frame numbers
  const prim = (o, skip) => {
    const r = {}; if (!o) return r;
    for (const k of Object.keys(o).sort()) {
      if (skip && skip(k)) continue;
      let v; try { v = o[k]; } catch { continue; }
      const t = typeof v;
      if (t === "number") r[k] = Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : String(v);
      else if (t === "string" || t === "boolean" || v === null) r[k] = v;
    }
    return r;
  };
  window.__snap = () => {
    const st = window.__state ?? {};
    const b = window.__battleB && window.__battleB();
    const o = { f: frames, rnd: rndCalls, map: (st.manifest && st.manifest.maps && st.manifest.maps[st.mapIdx] && st.manifest.maps[st.mapIdx].id) || null, game: prim(st, (k) => k[0] === "_" && k !== "_bits") };
    o.keys = st.keys ? [...st.keys].sort() : [];
    o.partner = prim(st.partnerStats);
    o.inv = (st.inventory || []).map((x) => x.id + ":" + x.qty).join(",");
    o.flagsN = st.flags ? Object.keys(st.flags).length : 0;
    o.battleActive = !!(window.__battle && window.__battle.isActive && window.__battle.isActive());
    if (b) { o.battle = prim(b, (k) => k[0] === "_" && !/^_(victoryPhase|winApplied)$/.test(k)); o.player = prim(b.player); o.enemy = prim(b.enemy); }
    o.menu = (window.__menu && window.__menu.isOpen && window.__menu.isOpen()) ?? null;
    o.textbox = (window.__textbox && window.__textbox.isOpen && window.__textbox.isOpen()) ?? null;
    try { const d = window.__shop && window.__shop.diagnostics && window.__shop.diagnostics(); if (d) o.shop = prim(d); } catch (e) { o.shop = "err"; }
    try { const d = window.__saveNative && window.__saveNative.diagnostics && window.__saveNative.diagnostics(); if (d) o.save = prim(d); } catch (e) { o.save = "err"; }
    return o;
  };
}

// ---- scenarios ----
const member = (digimonId, level, xp) => ({ digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120, stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 }, bonuses: {}, elemBonuses: {} });
const fixture = { lead: member(1, 10, 0), rena: member(7, 10, 0), pata: member(8, 10, 0) };
const hold = (key, from, len) => [[from, "down", key], [from + len, "up", key]];
const taps = (key, list) => list.flatMap((f) => hold(key, f, 6));
const URL_Q = "?skipTitle=1&map=s245&noEncounters=1";
const SCENARIOS = {
  field: { url: URL_Q, frames: 900,
    keys: [...hold("ArrowLeft", 60, 120), ...hold("ArrowUp", 200, 90), ...hold("ArrowRight", 320, 150), ...hold("ArrowDown", 500, 100), ...hold("ArrowLeft", 640, 60)] },
  menu: { url: URL_Q, frames: 600,
    keys: [...taps("i", [60]), ...taps("ArrowDown", [120, 150, 240]), ...taps("Enter", [180]), ...taps("Escape", [300, 420, 480]), ...taps("ArrowUp", [360])] },
  battle: { url: URL_Q, frames: 1500, start: "battle",
    keys: taps("Enter", [120, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]) },
};
SCENARIOS.shop = { url: URL_Q, frames: 700, start: "lab:shop", keys: [...taps("ArrowDown", [200, 260]), ...taps("Enter", [320, 400]), ...taps("Escape", [480, 560, 640])] };
SCENARIOS.save = { url: URL_Q, frames: 700, start: "lab:save", keys: [...taps("ArrowDown", [250]), ...taps("Enter", [320, 420]), ...taps("Escape", [560, 640])] };
const sc = SCENARIOS[scenarioName];
if (!sc) throw new Error(`unknown scenario ${scenarioName}`);

// ---- error collection ----
// A rewrite must not change what the page complains about, so page errors AND console
// errors/warnings are recorded. The old app and the rewrite differ in port and repo path only,
// so those are replaced before comparing; the list keeps first-seen order and a repeat count.
const normText = (s) => {
  let t = String(s);
  for (const p of [...new Set([repo, webRoot, realpathSync(repo)])].sort((a, b) => b.length - a.length)) t = t.split(p).join("<repo>");
  t = t.replace(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+/g, "http://127.0.0.1:<port>");
  return t.replace(/\s+/g, " ").trim();
};
const errors = [], errIndex = new Map();
const noteError = (kind, text) => {
  const t = normText(text);
  if (!t) return;
  const k = kind + "\u0000" + t;
  const hit = errIndex.get(k);
  if (hit) { hit.n++; return; }
  const e = { kind, text: t, n: 1 };
  errIndex.set(k, e); errors.push(e);
};
const errorTotal = () => errors.reduce((a, e) => a + e.n, 0);
let errorsPrinted = false;
const printErrors = (when) => {
  errorsPrinted = true;
  if (!errors.length) { console.error(`${when}: no page or console errors`); return; }
  console.error(`${when}: ${errors.length} kind(s) of page/console error, ${errorTotal()} occurrence(s)`);
  for (const e of errors.slice(0, 20)) console.error(`  [${e.kind} x${e.n}] ${e.text}`);
};

const browser = await chromium.launch({ headless: true, args: HARDWARE });
const lines = [];
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.on("pageerror", (e) => noteError("pageerror", (e && e.message) || String(e)));
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error") noteError("console-error", m.text());
    else if (t === "warning") noteError("console-warning", m.text());
  });
  // network quiet gate (covers module imports, workers, images, fetch): a frame waits until
  // no request is in flight, and 25 ms more when requests happened since the last frame.
  let inflight = 0, total = 0, seen = 0;
  page.on("request", () => { inflight++; total++; });
  page.on("requestfinished", () => { inflight--; });
  page.on("requestfailed", () => { inflight--; });
  const quiet = async () => {
    while (inflight > 0) await new Promise((r) => setTimeout(r, 2));
    if (total !== seen) { seen = total; await new Promise((r) => setTimeout(r, 25)); while (inflight > 0) await new Promise((r) => setTimeout(r, 2)); seen = total; }
  };
  await page.addInitScript(initScript, seed);
  await page.addInitScript((fx) => {
    localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
    localStorage.setItem("charId", "p003pken"); localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
    localStorage.setItem("partnerStats", JSON.stringify(fx.lead)); localStorage.setItem("partyStats", JSON.stringify([fx.lead, fx.rena, fx.pata]));
    localStorage.setItem("equipment", JSON.stringify([{}, {}, {}])); localStorage.setItem("bits", "1000"); localStorage.setItem("inventory", "[]");
  }, fixture);
  await page.goto(`http://127.0.0.1:${port}/${sc.url}`, { waitUntil: "commit" });
  await page.waitForFunction(() => window.__rw, null, { timeout: 30000 });
  const renderer = await page.evaluate(() => { const c = document.createElement("canvas"); const g = c.getContext("webgl"); const e = g && g.getExtension("WEBGL_debug_renderer_info"); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown"; });
  console.error("WebGL renderer:", renderer);
  if (/swiftshader|llvmpipe/i.test(renderer)) throw new Error("software renderer: stop");
  let boot = 0;
  // boot: no frames run while the game loads (real time), so the frame count at start never varies.
  while (!(await page.evaluate(() => window.__state && window.__state.started === true)) && boot < 4000) {
    await page.waitForTimeout(25); boot++;
    if (boot % 80 === 0) await page.evaluate(() => window.__rw.step());
  }
  if (boot >= 4000) { printErrors("boot timed out"); throw new Error("game never started"); }
  for (let i = 0; i < 30; i++) { await quiet(); await page.evaluate(() => window.__rw.step()); }
  if (sc.start === "battle") {
    await page.evaluate(() => { window.__battle.start({ enemyId: 1, enemyLevel: 20, screenId: 200, onWin() {}, onFlee() {}, onLose() {} }); });
  }
  if (sc.start && sc.start.startsWith("lab:")) await page.evaluate((w) => window.__labOpen(w), sc.start.slice(4));
  const byFrame = new Map();
  for (const [f, kind, key] of sc.keys) { if (!byFrame.has(f)) byFrame.set(f, []); byFrame.get(f).push([kind, key]); }
  for (let f = 0; f < sc.frames; f++) {
    for (const [kind, key] of byFrame.get(f) ?? []) await page.keyboard[kind](key);
    await quiet();
    const row = await page.evaluate(async () => { await window.__rw.step(); return window.__snap(); });
    lines.push(JSON.stringify(row));
  }
  printErrors("page/console errors");
} catch (e) {
  if (!errorsPrinted) printErrors("run failed"); // the error list explains a failure better than the bare message
  throw e;
} finally {
  await browser.close(); server.close();
}
// the last line is metadata, not a frame: compare.mjs reads the error list out of it
writeFileSync(out, lines.join("\n") + "\n" + JSON.stringify({ errors }) + "\n");
console.error(`wrote ${lines.length} frames and ${errors.length} error kind(s) to ${out}`);
