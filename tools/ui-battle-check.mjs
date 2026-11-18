#!/usr/bin/env node
// Dev tool (not shipped): ONE scripted battle walk that checks the look C battle HUD by numbers at many window sizes.
//   run (Windows node, it launches its own hidden Chrome on the AMD GPU):  node tools/ui-battle-check.mjs [--seed normal|max|both] [--quick]
// Raw CDP over WebSocket (no Playwright). Own Chrome (own profile + debug port), killed at the end. Prints the WebGL renderer first and stops
// on SwiftShader / llvmpipe. Server: localhost:8090 (serve_game.py is started hidden when it is down).
// Output: ONE short summary on stdout and built\check\summary.json; a screenshot per stop per size in built\check\<size>-<stop>.png.
// Read the SUMMARY only. Exit code 0 = everything green.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = "C:\\Users\\dorij\\scratch\\ui-remaster\\built\\check";
const PROFILE = "C:\\Users\\dorij\\scratch\\ui-remaster\\chk-profile";
const PORT = 9447;
const GAME = "http://localhost:8090/index.html?skipTitle=1&noEncounters=1";
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find((p) => fs.existsSync(p));
const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SEEDS = argv("--seed", "both") === "both" ? ["normal", "max"] : [argv("--seed", "normal")];
const QUICK = args.includes("--quick");
const ALL = ["1280x720", "1920x1080", "2560x1440", "960x720", "1024x768", "1366x768", "3440x1440", "720x1280"];
const TWO = ["1920x1080", "960x720"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------ chrome + cdp
let chrome = null, ws = null, nid = 0;
const pend = new Map();
async function launch() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--disable-extensions",
    "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu", "--autoplay-policy=no-user-gesture-required", "--window-size=1920,1080", "about:blank"],
  { windowsHide: true, stdio: "ignore", detached: false });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pg = list.find((t) => t.type === "page");
  ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
}
const send = (method, params = {}) => new Promise((res) => { const id = ++nid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expr, ms = 120000) {
  const r = await Promise.race([send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ timeout: true }))]);
  if (r.timeout) throw new Error("evaluate timeout: " + expr.slice(0, 80));
  if (r.result?.exceptionDetails) throw new Error("page error: " + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text).slice(0, 300));
  return r.result?.result?.value;
}
function killAll() {
  try { ws?.close(); } catch {}
  if (chrome?.pid) { try { execFileSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); } catch {} }
}
process.on("exit", killAll);
process.on("SIGINT", () => { killAll(); process.exit(2); });

async function ensureServer() {
  try { const r = await fetch("http://localhost:8090/index.html"); if (r.ok) return; } catch {}
  spawn("wsl.exe", ["-e", "bash", "-c", "nohup setsid python3 /home/dorij/serve_game.py >/dev/null 2>&1 & sleep 100000"], { windowsHide: true, stdio: "ignore", detached: true }).unref();
  for (let i = 0; i < 40; i++) { try { const r = await fetch("http://localhost:8090/index.html"); if (r.ok) return; } catch {} await sleep(500); }
  throw new Error("server 8090 is not up");
}

// ------------------------------------------------------------------------------------------------ in-page helpers
const PAGE = String.raw`(() => {
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = async (k, wait = 650, hold = 45) => { for (const t of ["keydown", "keyup"]) { window.dispatchEvent(new KeyboardEvent(t, { key: k, code: k, bubbles: true })); await sleep(t === "keydown" ? hold : 40); } await sleep(wait); };
const until = async (fn, ms = 20000) => { const t = performance.now(); while (performance.now() - t < ms) { try { if (fn()) return true; } catch {} await sleep(120); } return false; };
const B = () => window.__battleB && window.__battleB();
// Escape only closes a list; on the command menu it would run away, so it is sent only while a list is up
const LISTS = [3, 4, 11, 13, 15];
// go to command row i (never press Enter on Run) and confirm it
const pick = async (i, wait = 1600) => { for (let n = 0; n < 12 && sel() !== i; n++) await tap(sel() == null ? "ArrowDown" : (sel() < i ? "ArrowDown" : "ArrowUp"), 650); if (sel() !== i || sel() === 5) throw new Error("cannot reach command " + i + " (at " + sel() + ", battle state " + (B() && B().state) + ")"); await tap("Enter", wait); };
const back = async (wait = 1500) => { const b = B(); if (b && LISTS.includes(b.state)) await tap("Escape", wait); else await sleep(300); };
const sel = () => window.__battleCmdNative && window.__battleCmdNative.diagnostics().selection;
const root = () => document.getElementById("ui-c-root");
const K = (e) => (e.dataset.uicKey || "");
const grp = (e) => { const k = K(e); const p = k.split("."); return p[0] === "ring" ? p[0] + "." + p[1] : p[0]; };
const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
const textRect = (e) => { const g = document.createRange(); g.selectNodeContents(e); const r = g.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
const inter = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1;
const hitCircle = (c, r) => { const nx = Math.max(r.l, Math.min(c.cx, r.r)), ny = Math.max(r.t, Math.min(c.cy, r.b)); return Math.hypot(nx - c.cx, ny - c.cy) < c.rad - 1; };
function measure(opt) {
  opt = opt || {};
  const rt = root(), rr = rt.getBoundingClientRect(), res = { vp: [innerWidth, innerHeight], root: [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width), Math.round(rr.height)], issues: [] };
  const bad = (k, d) => res.issues.push(k + ": " + d);
  const ov = __uiC.overflow(); if (ov && (Array.isArray(ov) ? ov.length : Object.keys(ov).length)) bad("overflow", JSON.stringify(ov).slice(0, 140));
  // the field's place card (scope placecardT1) stays alive under the report (it is hidden by the report; not part of this look): left out on the victory pages
  const ck = __uiC.check(), cps = (ck.parts || []).filter((p) => !(opt.vic && /^pc\./.test(p.key)));
  res.worst = opt.vic ? cps.reduce((m, p) => Math.max(m, p.err || 0), 0) : ck.worst; if (res.worst !== 0) bad("worst", res.worst + " " + JSON.stringify(cps.slice(0, 2)).slice(0, 200));
  const cov = __uiC.coverage(); for (const [k, v] of Object.entries(cov)) if (v.flatUnclaimed) bad("unclaimed", k + " " + v.flatUnclaimed);
  // boxes
  const boxes = [], rings = [];
  rt.querySelectorAll(".uic-ring").forEach((e) => { const r = R(e); if (r.w < 2) return; rings.push({ g: "ring." + K(e).split(".")[1], cx: r.l + r.w / 2, cy: r.t + r.h / 2, rad: r.w / 2 * (176 / 180), rect: r, main: e.classList.contains("uic-ring-main") }); });
  rt.querySelectorAll("[data-uic-text]").forEach((e) => {
    if (e.closest(".uic-dock")) return;
    if (opt.vic && e.closest('[data-uic-scope^="placecard"]')) return;
    const r = e.classList.contains("uic-pop") ? R(e) : textRect(e); if (r.w < 1) return;
    boxes.push({ g: grp(e), k: K(e), name: e.dataset.uicText + (e.classList.contains("uic-pop") ? "@" + e.dataset.uicRect : ""), r, el: e, kind: e.classList.contains("uic-pop") ? "pop" : "text" });
    const cs = getComputedStyle(e), fs = parseFloat(cs.fontSize);
    if (e.dataset.uicFits === "0") bad("fits", e.dataset.uicText);
    if (!e.classList.contains("uic-pop") && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) bad("scrollWidth", e.dataset.uicText + " " + e.scrollWidth + ">" + e.clientWidth);
    if (fs < 8 || fs > (e.classList.contains("uic-pop") ? 300 : 170)) bad("font", e.dataset.uicText + " " + fs.toFixed(1) + "px");
  });
  const dock = rt.querySelector(".uic-dock");
  if (dock) {
    dock.querySelectorAll(".dk-w").forEach((e) => {
      const i = +e.dataset.dkI, rw = e.classList.contains("rw");
      const r = rw ? R(e) : textRect(e.querySelector(".ol"));
      boxes.push({ g: "dock", k: "w" + i, name: e.dataset.uicText, r, kind: "word" });
      if (e.dataset.uicFits === "0") bad("fits", "dock " + e.dataset.uicText);
      if (rw) { const tn = e.querySelector(".tn"); if (tn.scrollWidth > tn.clientWidth + 1) bad("scrollWidth", "row " + e.dataset.uicText + " " + tn.scrollWidth + ">" + tn.clientWidth);
        for (const q of e.children) { const fs = parseFloat(getComputedStyle(q).fontSize) * 1; if (fs < 8) bad("font", "row part " + fs.toFixed(1)); } }
      else { const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 8 || fs > 170) bad("font", "word " + fs.toFixed(1)); }
    });
    const t = dock.querySelector(".dk-ttl"); if (t) boxes.push({ g: "dock", k: "ttl", name: "title", r: R(t), kind: "word" });
  }
  // plates that are real boxes of their own (a text may sit inside its own plate)
  const plates = [];
  rt.querySelectorAll('[data-uic-part="msgBand"],[data-uic-part="hpBar"],[data-uic-part="hitLine"]').forEach((e) => { const r = R(e); if (r.w > 1 && r.h > 0) plates.push({ g: grp(e), k: K(e), r, part: e.dataset.uicPart }); });
  // inside the stage
  const out = (r) => r.l < rr.left - 1.5 || r.r > rr.right + 1.5 || r.t < rr.top - 1.5 || r.b > rr.bottom + 1.5;
  for (const b of boxes) if (out(b.r)) bad("offstage", b.g + " " + b.name + " [" + [b.r.l, b.r.t, b.r.r, b.r.b].map(Math.round) + "]");
  for (const c of rings) { const r = { l: c.cx - c.rad, t: c.cy - c.rad, r: c.cx + c.rad, b: c.cy + c.rad }; if (out(r)) bad("offstage", c.g + " ring"); }
  // overlaps
  const n = boxes.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.g === b.g && a.g !== "dock") continue;
    if (a.kind === "pop" && b.kind === "pop") continue;
    if (inter(a.r, b.r)) bad("overlap", a.g + ":" + a.name + " x " + b.g + ":" + b.name);
  }
  for (const c of rings) for (const b of boxes) { if (b.g === c.g) continue; if (hitCircle(c, b.r)) bad("ring-overlap", c.g + " x " + b.g + ":" + b.name + " word[" + [b.r.l, b.r.t, b.r.r, b.r.b].map(Math.round) + "] ring[" + [c.cx, c.cy, c.rad].map(Math.round) + "]"); }
  for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) { const a = rings[i], b = rings[j]; if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.rad + b.rad - 2) bad("ring-ring", a.g + " x " + b.g); }
  for (const p of plates) for (const b of boxes) { if (p.g === b.g) continue; if (p.part === "msgBand" && b.kind !== "pop") { const inside = b.r.l >= p.r.l - 1 && b.r.r <= p.r.r + 1 && b.r.t >= p.r.t - 1 && b.r.b <= p.r.b + 1; if (inside) continue; }
    if (inter(p.r, b.r)) bad("overlap", "plate " + p.part + " x " + b.g + ":" + b.name); }
  for (const c of rings) for (const p of plates) if (hitCircle(c, p.r)) bad("ring-overlap", c.g + " x plate " + p.part);
  // size / placement rules
  const main = rings.find((c) => c.main);
  if (main) {
    const s = main.rect.w / 120, k = main.rect.w;
    const ratio = main.rect.h / rr.height; res.ringRatio = +ratio.toFixed(3);
    const wide = rr.width / rr.height >= 1.2;
    if (wide ? (ratio < 0.26 || ratio > 0.34) : (ratio < 0.18 || ratio > 0.34)) bad("rule-ring-size", ratio.toFixed(3) + " of stage height");
    // left and bottom margins: equal, and a small share of the ring's width (8 native of a 72 native ring = 0.11)
    const ml = (main.rect.l - rr.left) / k, mb = (rr.bottom - main.rect.b) / k;
    res.margins = [+ml.toFixed(3), +mb.toFixed(3)];
    if (Math.abs(ml - mb) > 0.02 || ml < 0.04 || ml > 0.14) bad("rule-ring-margin", "left " + ml.toFixed(3) + " bottom " + mb.toFixed(3) + " of the ring width");
    // the small partner rings stand at the main ring's side of the stage, not up in the scene: their centres lie in the ring's column, above its top
    for (const c of rings) if (!c.main && (c.cx > main.rect.r || c.cy > main.rect.t + 2)) bad("rule-mini-place", c.g + " centre [" + [c.cx, c.cy].map(Math.round) + "] ring box [" + [main.rect.l, main.rect.t, main.rect.r].map(Math.round) + "]");
    // the enemy block: name + thin HP bar at the TOP CENTRE (about 38 % of the stage, 35-42 % allowed), no number, no old top-right callout
    const fbar = rt.querySelector('[data-uic-key="foe0.bar"]'), fname = rt.querySelector('[data-uic-key="foe0.name"]');
    if (rt.querySelector('[data-uic-key^="co."]')) bad("rule-foe-old", "the top-right callout is still there");
    if (opt.hud && !fbar) bad("rule-foe-bar", "missing");
    let foeRect = null;
    if (fbar) {
      const r = R(fbar), cxm = (r.l + r.w / 2 - rr.left) / rr.width, wf = r.w / rr.width, wide = rr.width / rr.height >= 0.8;
      foeRect = r; res.foe = { cx: +cxm.toFixed(3), w: +wf.toFixed(3), top: Math.round(r.t - rr.top), state: fbar.dataset.hpState };
      if (wide) { if (Math.abs(cxm - 0.5) > 0.015) bad("rule-foe-centre", "bar centre " + cxm.toFixed(3) + " of the stage"); if (wf < 0.35 || wf > 0.42) bad("rule-foe-width", "bar width " + wf.toFixed(3) + " of the stage"); }
      else if (wf < 0.3 || wf > 0.8) bad("rule-foe-width", "narrow stage bar width " + wf.toFixed(3));
      if (fname) { const top = R(fname).t - rr.top; res.calloutTop = Math.round(top); if (top < 33) bad("rule-foe-top", "margin " + top.toFixed(0) + " px (the dev label is about 33 px incl. margin)"); }
      if (rt.querySelector('[data-uic-key^="foe"][data-uic-text*="/"]')) bad("rule-foe-number", "an HP number is shown");
    }
    // the turn arc: three round nodes at the top right, the one acting now the biggest, enemies with a red rim
    const nodes = [...rt.querySelectorAll(".uic-node")];
    if (opt.hud && nodes.length !== 3) bad("rule-turn-arc", "nodes " + nodes.length);
    if (nodes.length) {
      const rs = nodes.map((n) => ({ n, r: R(n) })), now = rs.find((x) => x.n.dataset.turn === "now");
      res.nodes = rs.map((x) => x.n.dataset.turn + ":" + x.n.dataset.side + ":" + Math.round(x.r.w));
      if (!now || rs.some((x) => x !== now && x.r.w >= now.r.w)) bad("rule-turn-now", "the actor is not the biggest " + res.nodes.join(","));
      for (const x of rs) {
        if (x.r.l < rr.left || x.r.r > rr.right || x.r.t < rr.top) bad("rule-turn-place", "node outside the stage");
        if (rr.width / rr.height >= 0.8 && x.r.l < rr.left + rr.width * 0.8) bad("rule-turn-place", "node not at the top right " + Math.round(x.r.l - rr.left));
        if (foeRect && inter(x.r, foeRect)) bad("rule-turn-overlap", "node over the enemy bar");
        const bc = getComputedStyle(x.n).borderTopColor;
        if (x.n.dataset.side === "enemy" && !/255, 61, 110/.test(bc)) bad("rule-turn-rim", "enemy rim " + bc);
      }
    }
    if (dock && dock.querySelector(".rw")) {
      res.rows = dock.querySelectorAll(".rw").length;
      if (plates.some((p) => p.part === "msgBand")) bad("rule-caption-box", "a message box is up over a list");
      const tm = [...dock.querySelectorAll(".rw")].map((e) => { const a = e.querySelector(".tn").getBoundingClientRect(), z = e.querySelector(".tm").getBoundingClientRect(); const fs = parseFloat(getComputedStyle(e.querySelector(".tn")).fontSize) * (e.getBoundingClientRect().width / e.offsetWidth); return (z.left - a.right) / fs; });
      if (tm.some((g) => g > 4)) bad("rule-row-tight", "chip / cost far from the name " + tm.map((g) => g.toFixed(2)).join(","));
    }
  }
  // victory text contrast: every text of the page against its own backdrop (the brightest stop of the blue) >= 4.5
  if (opt.vic) {
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const num = (v) => (v.match(/[\d.]+/g) || []).map(Number);
    const bgOf = (e) => { const ls = []; for (let n = e; n && !(n.classList && n.classList.contains("uic-vic")); n = n.parentElement) { const c = num(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0)) ls.push(c); } let base = [20, 60, 150]; for (const c of ls.reverse()) { const a = c[3] === undefined ? 1 : c[3]; base = [0, 1, 2].map((q) => c[q] * a + base[q] * (1 - a)); } return base; };
    let minC = 99, minT = "";
    rt.querySelectorAll(".uic-vic [data-uic-text]").forEach((e) => {
      const cs = getComputedStyle(e), col = num(cs.color); if (!e.dataset.uicText.trim() || (col[3] !== undefined && col[3] < 0.5) || cs.webkitTextFillColor === "rgba(0, 0, 0, 0)") return;
      const L1 = lum(col), L2 = lum(bgOf(e)), c = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      if (c < minC) { minC = c; minT = e.dataset.uicText; }
    });
    res.contrast = +minC.toFixed(2); res.contrastText = minT;
    if (minC < 4.5) bad("rule-contrast", minC.toFixed(2) + " for " + minT);
  }
  if (opt.vic) res.scopes = [...rt.children].map((c) => c.className + "|" + (c.dataset.uicScope || c.id || "") + "|z" + getComputedStyle(c).zIndex + "|" + getComputedStyle(c).display + "|" + c.children.length).slice(0, 8);
  res.art = Object.values(cov).flatMap((v) => v.unclaimed.map((x) => x.pack + ":" + x.id + "@" + x.x + "," + x.y)).slice(0, 6);
  res.counts = { boxes: n, rings: rings.length, plates: plates.length };
  return res;
}
const hits = () => { const rt = root(); const p = rt.querySelector(".uic-pop"); return p ? +p.dataset.uicText : null; };
// the pop log: every .pp element the page creates (one per hit event is the rule); screenshots keep the finished pop visible
window.__popLog = [];
new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; const l = n.matches && n.matches(".pp") ? [n] : (n.querySelectorAll ? [...n.querySelectorAll(".pp")] : []); for (const p of l) window.__popLog.push({ evt: p.dataset.evt, kind: p.parentElement && p.parentElement.dataset.popKind, tone: p.parentElement && p.parentElement.dataset.popTone }); } }).observe(document.documentElement, { childList: true, subtree: true });
const frz = document.createElement("style"); frz.textContent = "#ui-c-root .uic-pop .pp{animation:none!important;opacity:1!important;transform:none!important}"; document.head.appendChild(frz);
const popNow = () => { const p = root().querySelector(".uic-pop"); if (!p) return null; const pp = p.querySelector(".pp"), tg = pp && pp.querySelector(".tg"); return { kind: p.dataset.popKind, tone: p.dataset.popTone, side: /player/.test(p.className) ? "player" : "enemy", text: p.dataset.uicText, tag: tg ? tg.textContent : "", evt: pp ? pp.dataset.evt : "" }; };
const popCount = () => root().querySelectorAll(".uic-pop .pp").length;
window.__chk = { sleep, tap, pick, back, until, B, sel, measure, hits, root, popNow, popCount };
return "ok";
})()`;

// ------------------------------------------------------------------------------------------------ driver
const summary = { when: new Date().toISOString(), renderer: "", seeds: {}, stops: [], fails: [], parity: null, dmg: [] };
const worst = new Map();
function sizeOf(s) { const [w, h] = s.split("x").map(Number); return { w, h }; }
async function setSize(s) {
  const { w, h } = sizeOf(s);
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await ev("window.dispatchEvent(new Event('resize'))");
  await sleep(QUICK ? 500 : 800);
}
async function shot(file) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) fs.writeFileSync(path.join(OUT, file), Buffer.from(r.result.data, "base64"));
}
/** One stop: measure + screenshot at each size. */
async function stop(seed, name, sizes = ALL, opt = {}) {
  const rec = { seed, stop: name, sizes: {} };
  for (const s of sizes) {
    await setSize(s);
    let m;
    try { m = await ev(`window.__chk.measure(${JSON.stringify(opt)})`); } catch (e) { m = { issues: ["measure failed: " + e.message] }; }
    await shot(`${seed}-${s}-${name}.png`);
    rec.sizes[s] = m.issues;
    for (const i of m.issues) { const k = i.split(":")[0]; worst.set(`${k}`, (worst.get(k) ?? 0) + 1); }
    if (m.issues.length) summary.fails.push({ seed, stop: name, size: s, issues: m.issues.slice(0, 6) });
    if (m.art && m.art.length) (summary.art ??= {})[`${seed}/${name}`] = m.art;
    if (m.scopes && s === "1920x1080") (summary.scopes ??= {})[`${seed}/${name}`] = m.scopes;
  }
  summary.stops.push(rec);
  const bad = Object.entries(rec.sizes).filter(([, v]) => v.length).map(([s]) => s);
  console.log(`${bad.length ? "FAIL" : "pass"} ${seed}/${name} ${bad.length ? bad.join(",") : sizes.length + " sizes"}`);
}
const toMenu = () => P(`for(let i=0;i<30 && !(c.B() && c.B().state===2 && document.querySelector(".dk-w:not(.rw)") && c.sel()!=null);i++){ if(!c.B()) throw new Error("battle ended early"); await c.tap(c.B().state===11&&c.B().player.hp<=0?"Enter":(c.B().state===3||c.B().state===4||c.B().state===11||c.B().state===13?"Escape":"Enter"),900); } await c.sleep(700);`);
const P = (code) => ev(`(async()=>{const c=window.__chk;${code}})()`);

// ---- HP bar colour at 3 HP levels (the enemy's real HP is set, the plate eases to it)
async function foeColours(seed) {
  const levels = [["high", 0.8, "ok"], ["mid", 0.4, "mid"], ["low", 0.1, "low"]], got = [];
  for (const [lab, f, want] of levels) {
    const r = await P(`const b=c.B(); b.enemy.hp=Math.round(b.enemy.maxHp*${f}); const q=()=>{const e=c.root().querySelector('[data-uic-key="foe0.bar"]'); if(!e) return null; const fl=e.querySelector(".uic-bar-fill"), tr=e.querySelector(".uic-bar-track"); return {state:e.dataset.hpState, ratio:parseFloat(fl.style.width)/parseFloat(tr.style.width), bg:getComputedStyle(fl).backgroundImage};};
      await c.until(()=>{const x=q(); return x && Math.abs(x.ratio-${f})<0.03;},12000); await c.sleep(300); return q();`);
    got.push({ lab, want, ...r });
    const ok = r && r.state === want && Math.abs(r.ratio - f) < 0.03;
    if (!ok) summary.fails.push({ seed, stop: "foe-colour-" + lab, issues: [JSON.stringify(r)] });
    console.log(`${ok ? "pass" : "FAIL"} ${seed}/foe-colour-${lab} ${r && r.state} ratio ${r && r.ratio && r.ratio.toFixed(2)}`);
    if (lab === "low") await stop(seed, "foe-low", TWO, { hud: true });
  }
  const distinct = new Set(got.map((g) => g.bg)).size === 3;
  if (!distinct) summary.fails.push({ seed, stop: "foe-colour-distinct", issues: ["the three states share a colour"] });
  console.log(`${distinct ? "pass" : "FAIL"} ${seed}/foe-colour-distinct`);
  summary.foeColours = got;
  await P(`const b=c.B(); b.enemy.hp=b.enemy.maxHp; await c.sleep(1500);`);
}
// ---- player HP ring colour at 3 HP levels (the player's real HP is set; the ring eases to it); main ring + mini rings
async function ringColours(seed) {
  const levels = [["high", 0.8, "ok"], ["mid", 0.4, "mid"], ["low", 0.1, "low"]], got = [];
  for (const [lab, f, want] of levels) {
    const r = await P(`const b=c.B(); b.player.hp=Math.max(1,Math.round(b.player.maxHp*${f})); const q=()=>{const e=c.root().querySelector('[data-uic-key="ring.main"]'); if(!e) return null; const st=e.querySelector("stop"); return {state:e.dataset.hpState, stop:st?getComputedStyle(st).stopColor:null, anim:getComputedStyle(e.querySelector(".hp")).animationName, minis:[...c.root().querySelectorAll(".uic-ring-mini")].map(m=>m.dataset.hpState)};};
      await c.until(()=>{const x=q(); return x && x.state==="${want}";},12000); await c.sleep(400); return q();`);
    got.push({ lab, want, ...r });
    const ok = r && r.state === want && (want === "low" ? r.anim !== "none" : r.anim === "none") && r.minis.every((m) => m);
    if (!ok) summary.fails.push({ seed, stop: "ring-colour-" + lab, issues: [JSON.stringify(r)] });
    console.log(`${ok ? "pass" : "FAIL"} ${seed}/ring-colour-${lab} ${r && r.state} ${r && r.stop}`);
  }
  const distinct = new Set(got.map((g) => g.stop)).size === 3;
  if (!distinct) summary.fails.push({ seed, stop: "ring-colour-distinct", issues: ["the three states share a colour"] });
  console.log(`${distinct ? "pass" : "FAIL"} ${seed}/ring-colour-distinct`);
  summary.ringColours = got;
  await P(`const b=c.B(); b.player.hp=b.player.maxHp; await c.sleep(1500);`);
}
// ---- one pop per hit event: the DOM .pp elements created for the hit, grouped by their event id
async function popOnce(seed, label, r, kind) {
  const log = r.log ?? [], byEvt = {};
  for (const l of log) byEvt[l.evt] = (byEvt[l.evt] ?? 0) + 1;
  const evts = Object.keys(byEvt), worstN = Math.max(0, ...Object.values(byEvt));
  const ok = evts.length >= 1 && worstN === 1 && (kind == null || (r.pop && r.pop.kind === kind));
  (summary.pops ??= []).push({ seed, label, created: log.length, events: evts.length, perEvent: worstN, pop: r.pop && [r.pop.kind, r.pop.tone, r.pop.tag, r.pop.text].join("/") });
  if (!ok) summary.fails.push({ seed, stop: "pop-once-" + label, issues: [`created ${log.length} .pp for ${evts.length} events (max ${worstN} per event); pop ${JSON.stringify(r.pop)}; per event ${JSON.stringify(byEvt)}`] });
  console.log(`${ok ? "pass" : "FAIL"} ${seed}/pop-once-${label} created ${log.length} events ${evts.length} per-event ${worstN} pop ${r.pop && [r.pop.kind, r.pop.tone, r.pop.tag, r.pop.text].join("/")}`);
}
// ---- every type the game can produce here, seeded with the engine's own RNG seed (randU16SetSeed) and predicted with the engine's own resolver on copies
const NOTSEEDED = [];
let evadeSeen = null;
async function seedTypes(seed) {
  const setup = await P(`c.E=await import("./vendor/engine.js"); const dj=await (await fetch("assets/data/digimon.json")).json(); c.SK=dj.skills;
    c.pred=(s,sk)=>{const b=c.B(); const a=JSON.parse(JSON.stringify(b.player)), d=JSON.parse(JSON.stringify(b.enemy)); c.E.randU16SetSeed(s); const r=c.E.resolveAttack(a,d,sk,c.E.randU16,b.field); c.E.randU16SetSeed(s); return {hit:!!r.hit,dmg:r.dmg,crit:!!r.crit,eff:r.eff};};
    c.skillById=(id)=>c.SK.find((x)=>x.id===id)||null;
    const b=c.B(); const basic=c.skillById(b.player.profile.tech_basic); c.basic=basic?Object.assign({},basic,{basic_attack:true}):null;
    const slots=((b.player.statsRecord||{}).formLedger||[]).flatMap((f)=>f.techSlots||[]).map((w)=>w&0x1fff).filter(Boolean);
    return {basic:!!c.basic, slots, enemy:b.enemy.profile&&b.enemy.profile.name};`);
  console.log(`${seed}/seed-setup ${JSON.stringify(setup)}`);
  const done = (summary.types ??= {})[seed] = {};
  const verdict = async (kind, r, okFn) => {
    const ok = !!(r.pop && okFn(r.pop));
    done[kind] = ok ? "seeded: " + [r.pop.kind, r.pop.tone, r.pop.tag, r.pop.text].join("/") : "FAILED " + JSON.stringify(r.pop);
    if (!ok) summary.fails.push({ seed, stop: "type-" + kind, issues: [done[kind] + " note " + JSON.stringify(r.note)] });
    console.log(`${ok ? "pass" : "FAIL"} ${seed}/type-${kind} ${done[kind]}`);
    if (ok) { await stop(seed, "pop-" + kind, TWO, { hud: true }); await popOnce(seed, "type-" + kind, { pop: r.pop, log: r.log }, r.pop.kind); }
  };
  const atk = (sd, extra = "") => P(`const b=c.B(); b.player.hp=b.player.maxHp; b.player.mp=b.player.maxMp; b.enemy.hp=b.enemy.maxHp; window.__popLog.length=0; ${extra}
    c.E.randU16SetSeed(${sd}); await c.pick(0,300); for(let i=0;i<14&&!c.root().querySelector(".uic-pop");i++) await c.tap("Enter",1000); await c.sleep(500);
    const bm=await import("./battle.js"); return {pop:c.popNow(), note:bm.lastHitNote(), log:window.__popLog.slice(), txt:__uiC.texts().join("|")};`);
  // evade: the enemy's own blow missed on its turn (seen above)
  if (evadeSeen) { done.evade = "seeded: " + [evadeSeen.kind, evadeSeen.tone, evadeSeen.tag, evadeSeen.text].join("/") + " (the enemy's blow missed the partner)"; console.log(`pass ${seed}/type-evade ${done.evade}`); }
  else {
    let r = null;
    for (let round = 0; round < 6 && !(r && r.pop); round++) {
      await toMenu();
      r = await P(`const b=c.B(); b.player.hp=b.player.maxHp; b.enemy.hp=b.enemy.maxHp; b.player.evadeBonus=4000; window.__popLog.length=0; await c.pick(0,300); let got=null;
        for(let i=0;i<30&&!got;i++){ await c.tap("Enter",900); const e=c.root().querySelector(".uic-pop"); if(e&&e.dataset.popKind==="miss"&&/player/.test(e.className)) got={kind:"miss",tone:"",text:e.dataset.uicText,tag:""}; }
        return {pop:got, log:window.__popLog.slice()};`);
    }
    await P(`c.B().player.evadeBonus=0;`);
    await verdict("evade", r, (p) => p.kind === "miss" && p.text === "EVADE");
  }
  // crit: the target carries a confusion magnitude (critProc reads it as def.critStatusBonus: a state poke, the resolver and the RNG are untouched), up to 8 real attacks
  {
    let r = null;
    for (let t = 0; t < 8; t++) {
      await toMenu();
      r = await atk(t + 3, "b.enemy.ailments=Object.assign({},b.enemy.ailments,{confuse:{power:254}});");
      if (r.pop && r.pop.tone === "crit") break;
    }
    await P(`c.B().enemy.ailments={};`);
    await verdict("crit", r, (p) => p.kind === "dmg" && p.tone === "crit" && p.tag === "CRITICAL");
  }
  // weak / resist: a technique whose predicted element x family multiplier is >= 1.5 / <= 0.75 against this enemy (hit, no crit)
  await toMenu();
  const techNames = await P(`await c.pick(1); const n=[...document.querySelectorAll(".uic-dock .dk-w.rw .tn")].map((e)=>e.textContent.trim()); await c.back(1500); return n;`);
  const techIds = await P(`return ${JSON.stringify(techNames)}.map((n)=>{const s=c.SK.find((x)=>x.name===n&&x.type==="attack"); return s?s.id:0;}).filter(Boolean);`);
  console.log(`${seed}/techs ${JSON.stringify(techNames)} attack ids ${JSON.stringify(techIds)}`);
  await toMenu();
  for (const [kind, val] of [["weak", 30], ["resist", 300]]) {
    await P(`const b=c.B(); const el={}; for(const k of ["fire","water","ice","wind","thunder","machine","dark"]) el[k]=${val}; if(!c.saveProfile) c.saveProfile=b.enemy.profile; b.enemy.profile=Object.assign({},c.saveProfile,{resistances:el});`);
    const got = await P(`const out=[]; for(const id of ${JSON.stringify(techIds)}){ const sk=c.skillById(id); if(!sk||sk.type!=="attack") continue; for(let s=1;s<=60;s++){ const p=c.pred(s,sk); if(p.hit&&!p.crit){ out.push({id,name:sk.name,s,eff:p.eff,el:sk.element}); break; } } } return out;`);
    console.log(`${seed}/tech-eff ${kind} (enemy elements ${val}) ${JSON.stringify(got.map((x) => [x.name, x.el, x.eff]))}`);
    const t = got.find((x) => (kind === "weak" ? x.eff >= 1.5 : x.eff <= 0.75));
    if (!t) { done[kind] = "NOT SEEDED: no technique reaches eff " + (kind === "weak" ? ">= 1.5" : "<= 0.75") + " even with the enemy's element values set to " + val + " (effs " + got.map((x) => x.eff).join(",") + ")"; NOTSEEDED.push(`${seed}/${kind}`); console.log(`note ${seed}/type-${kind} ${done[kind]}`); continue; }
    await toMenu();
    const r = await P(`const b=c.B(); b.player.hp=b.player.maxHp; b.player.mp=b.player.maxMp; b.enemy.hp=b.enemy.maxHp; window.__popLog.length=0; await c.pick(1);
      const names=[...document.querySelectorAll(".uic-dock .dk-w.rw .tn")].map((e)=>e.textContent.trim()); const i=names.indexOf(${JSON.stringify(t.name)}); if(i<0) return {pop:null,note:{names}};
      for(let k=0;k<i;k++) await c.tap("ArrowDown",700); c.E.randU16SetSeed(${t.s}); await c.tap("Enter",300); for(let q=0;q<14&&!c.root().querySelector(".uic-pop");q++) await c.tap("Enter",1000); await c.sleep(500);
      const bm=await import("./battle.js"); return {pop:c.popNow(), note:bm.lastHitNote(), log:window.__popLog.slice()};`);
    await verdict(kind, r, kind === "weak" ? (p) => p.tone === "weak" && p.tag === "WEAK" : (p) => p.tone === "resist" && p.tag === "RESIST");
    await toMenu();
  }
  await P(`if(c.saveProfile){ c.B().enemy.profile=c.saveProfile; c.saveProfile=null; }`);
  const tpOld = await P(`const out=[]; for(const id of ${JSON.stringify(setup.slots)}){ const sk=c.skillById(id); if(!sk||sk.type!=="attack") continue; for(let s=1;s<=60;s++){ const p=c.pred(s,sk); if(p.hit&&!p.crit){ out.push({id,name:sk.name,s,eff:p.eff,el:sk.element}); break; } } } return out;`);
  // heal: an item on a hurt partner
  await toMenu();
  let healed = null;
  for (let row = 0; row < 3 && !healed; row++) {
    await toMenu();
    const r = await P(`const b=c.B(); c.origMax=c.origMax||b.player.maxHp; b.player.hp=Math.round(b.player.maxHp*0.3); window.__popLog.length=0; await c.pick(4); for(let k=0;k<${row};k++) await c.tap("ArrowDown",700); await c.tap("Enter",300); const seen=[]; for(let q=0;q<14;q++){ const p=c.popNow(); if(p&&p.kind==="heal") break; const t=__uiC.texts().join("|"); if(seen[seen.length-1]!==t) seen.push(t); await c.tap("Enter",900); } await c.sleep(300); return {pop:c.popNow(), log:window.__popLog.slice(), txt:seen.map((x)=>x.slice(-70)).join(" // ").slice(0,420), st:c.B().state};`);
    if (r.pop && r.pop.kind === "heal") healed = r; else console.log(`note ${seed}/heal row ${row}: ${JSON.stringify([r.pop && r.pop.kind, r.txt])}`);
  }
  if (healed) await verdict("heal", healed, (p) => p.kind === "heal" && /^\+\d+$/.test(p.text));
  else { done.heal = "NOT SEEDED: no item row produced a heal line in 3 tries"; NOTSEEDED.push(`${seed}/heal`); console.log(`note ${seed}/type-heal ${done.heal}`); }
  // counter (Counter Crest on) and status (poison put on through the engine's own applyAilment): watched over a few rounds
  for (const [kind, prep, test] of [["counter", "b.player.counterCrest=true; b.player.evadeBonus=-4000; b.enemy.eStats=b.enemy.eStats||{}; if(!('eCtr' in c)) c.eCtr=b.enemy.eStats.counter; b.enemy.eStats.attack=b.enemy.eStats.attack||b.enemy.profile.tech_basic; b.enemy.eStats.counter={action:1,comparator:19,value:0};", "p.kind==='counter'"], ["status", "c.E.applyAilment(b.player,'poison',null,b.enemy);", "(p.kind==='status'||/st-/.test(p.cls||''))"]]) {
    let hit = null, lastCt = "";
    for (let round = 0; round < (kind === "counter" ? 14 : 3) && !hit; round++) {
      await toMenu();
      const r = await P(`const b=c.B(); b.player.hp=b.player.maxHp; b.enemy.hp=b.enemy.maxHp; ${prep} window.__popLog.length=0; ${kind === "counter" ? `c.E.randU16SetSeed(${round * 613 + 17});` : ""} await c.pick(0,300); let got=null, ct=""; const hp0=b.player.hp; let seen=[];
        for(let i=0;i<30&&!got;i++){ await c.tap("Enter",900); const tx=__uiC.texts().join("|"); if(/counter/i.test(tx)) ct=tx.slice(-170); if(i<12) seen.push(tx.slice(-60)); for(const e of c.root().querySelectorAll(".uic-pop")){ const p={kind:e.dataset.popKind,tone:e.dataset.popTone,cls:e.className,text:e.dataset.uicText,tag:(e.querySelector(".tg")||{}).textContent||""}; if(${test}) got=p; } }
        return {pop:got, ct, log:window.__popLog.slice(), cc:b.player.counterCrest, dhp:hp0-b.player.hp, seen};`);
      if (kind === "counter") console.log(`  counter try ${round}: crest ${r.cc} hpDrop ${r.dhp} pages ${JSON.stringify(r.seen).slice(0, 260)}`);
      if (r.ct) lastCt = r.ct;
      if (r.pop) hit = r;
    }
    if (hit) await verdict(kind, hit, () => true);
    else { done[kind] = "NOT SEEDED: the game did not produce it in the tries (" + (kind === "counter" ? "Counter Crest on + the enemy counter row set to always (comparator 19), 14 seeded rounds; counter text seen: " + JSON.stringify(lastCt) : "poison applied, 3 rounds") + ")"; NOTSEEDED.push(`${seed}/${kind}`); console.log(`note ${seed}/type-${kind} ${done[kind]}`); }
  }
  await P(`const b=c.B(); b.player.counterCrest=false; if(b.enemy.eStats) b.enemy.eStats.counter=c.eCtr; b.player.ailments={}; b.player.evadeBonus=0; if(c.origMax){b.player.maxHp=c.origMax;} b.player.hp=b.player.maxHp;`);
}

async function playSeed(seed) {
  const big = seed === "max";
  await send("Page.navigate", { url: GAME });
  await sleep(2500);
  await ev(`localStorage.setItem("assetMode","authentic"); localStorage.setItem("dw2003.windowFill","1");`);
  await send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  await send("Page.navigate", { url: GAME });
  await sleep(2500);
  await ev(PAGE);
  await setSize("1920x1080");
  const boot = await P(`if(!(await c.until(()=>window.__battle&&window.__state&&__state.bits!=null,60000))) return "game not ready"; await c.sleep(1500);
    __state.charIdx=1; const chars=(__state.manifest?.characters??[]).map(x=>x.id); if(chars.length>=4)__state.party=[chars[1],chars[2],chars[3]];
    const e=await import("./vendor/engine.js"); [70,71,66,43,92,236,292,402,91].forEach((id)=>e.storeAddItem(__state,id,${big ? 99 : 3}));
    Object.assign(__state.partnerStats,{formLedger:[{id:30,formLevel:5,dvexp:0,techSlots:[0xb8,0xb9,0xba,0xbb,0,0]}],equippedForms:[30],
      hp:${big ? 999 : 300},maxHp:${big ? 999 : 300},mp:${big ? 999 : 80},maxMp:${big ? 999 : 120},dvGauge:${big ? 1000 : 400}${big ? ",level:99" : ""}});
    const ids=${big ? '["MetalGarurumon","MetalGreymon","WarGreymon","Kunemon"]' : '["Kunemon"]'}; let started=false;
    for(const id of ids){ try{ await Promise.resolve(__battle.start({enemyId:id,enemyLevel:${big ? 99 : 1},enemyHp:60000,enemyMp:999,screenId:34,mapId:"s330"})); if(await c.until(()=>window.__battleCmdNative&&window.__battleCmdNative.active&&window.__battleCmdNative.active(),20000)){ started=id; break; } }catch(err){ window.__bootErr=String(err&&err.message||err); } }
    const ok=await c.until(()=>window.__battleCmdNative&&window.__battleCmdNative.active&&window.__battleCmdNative.active()&&document.querySelector(".dk-w"),90000);
    await c.sleep(2500); return ok?"menu":"no menu "+JSON.stringify({err:window.__bootErr,st:c.B()&&c.B().state,started,act:window.__battle&&window.__battle.isActive&&window.__battle.isActive()});`);
  if (!String(boot).startsWith("menu") || boot !== "menu") { summary.fails.push({ seed, stop: "boot", issues: [boot] }); console.log("FAIL boot " + boot); return; }
  summary.seeds[seed] = "started";

  // look on vs off: the same keys, the same game state
  const run = (off) => P(`for(let i=0;i<8&&c.sel()!==0;i++) await c.tap("ArrowUp",600); __uiC.setEnabled(${off ? "false" : "true"}); await c.sleep(400); const out=[]; const snap=()=>{const b=c.B(); out.push([b.state,c.sel(),b.techSel,b.player.mp,b.player.hp,b.enemy.hp].join(","));};
    snap(); for(const k of ["ArrowDown","ArrowDown","ArrowUp","Enter","ArrowDown","Escape"]){ if(k==="Escape") await c.back(750); else await c.tap(k,900,40); snap(); } __uiC.setEnabled(true); await c.sleep(300); return out;`);
  const off = await run(true), on = await run(false);
  summary.parity = JSON.stringify(off) === JSON.stringify(on) ? "equal" : "DIFF " + JSON.stringify([off, on]);
  console.log(`${summary.parity === "equal" ? "pass" : "FAIL"} ${seed}/look-on-off-state ${summary.parity === "equal" ? "equal" : ""}`);
  await P(`await c.until(()=>c.sel()===0 && document.querySelector(".dk-w"),8000); await c.sleep(600);`);

  // OS in reduce mode (emulated in setSize): the dock and ring animations must still run
  {
    await P(`await c.tap("ArrowDown",40);`);
    const an = await ev(`(()=>{const n=(sel)=>{const e=document.querySelector(sel); return e?getComputedStyle(e).animationName:"missing";}; return {mq:matchMedia("(prefers-reduced-motion: reduce)").matches, arc:n(".uic-dock .dk-gd"), spin:n(".uic-dock .dk-spin"), ticks:n(".uic-ring-spin"), kick:n(".uic-dock[data-kick] .dk-gd")};})()`);
    const okA = an.mq && ["arc", "spin", "ticks"].every((k) => an[k] && an[k] !== "none" && an[k] !== "missing") && /jolt/.test(an.kick);
    if (!okA) summary.fails.push({ seed, stop: "reduce-motion-anim", issues: [JSON.stringify(an)] });
    console.log(`${okA ? "pass" : "FAIL"} ${seed}/reduce-motion-anim ${JSON.stringify(an)}`);
    await P(`await c.tap("ArrowUp",700);`);
  }
  // command arc: all six focus positions
  await stop(seed, "cmd0", ALL, { hud: true });
  await foeColours(seed);
  await ringColours(seed);
  for (let i = 1; i < 6; i++) { await P(`await c.tap("ArrowDown",700);`); await stop(seed, `cmd${i}`, TWO, { hud: true }); }
  await P(`for(let i=0;i<8&&c.sel()!==0;i++) await c.tap("ArrowDown",600); await c.sleep(400);`);

  // Item, Tag, DV lists, each with Esc (every one starts from the command menu)
  for (const [name, idx] of [["item", 4], ["tag", 3], ["dv", 2]]) {
    await toMenu();
    await P(`await c.pick(${idx});`);
    await stop(seed, name, name === "dv" ? TWO : ALL, { hud: true });
    await P(`await c.back(1500); for(let i=0;i<4&&!document.querySelector(".dk-w:not(.rw)");i++) await c.sleep(600);`);
    await stop(seed, `${name}-esc`, TWO, { hud: true });
    await P(`for(let i=0;i<8&&c.sel()!==0;i++) await c.tap("ArrowUp",600); await c.sleep(300);`);
  }

  // Tech: open, move, Esc, pick
  await toMenu();
  await P(`await c.pick(1);`);
  await stop(seed, "tech0", ALL, { hud: true });
  await P(`await c.tap("ArrowDown",900);`);
  await stop(seed, "tech1", TWO, { hud: true });
  await P(`await c.back(1500);`);
  await stop(seed, "tech-esc", TWO, { hud: true });
  await toMenu();
  await P(`await c.pick(1);`);
  const dbg = await P(`return {b:!!c.B(), st:c.B()&&c.B().state, sel:c.sel(), ttl:!!document.querySelector(".dk-ttl"), layers:__uiC.layers().join()};`);
  console.log("before tech pick: " + JSON.stringify(dbg));
  await P(`window.__popLog.length=0;`);
  const e0 = await P(`return c.B().enemy.hp;`);
  const p0 = await P(`return c.B().player.hp;`);
  await P(`await c.tap("Enter",300); for(let i=0;i<14&&c.hits()===null;i++) await c.tap("Enter",1000); await c.sleep(500);`);
  const dmg = await P(`return {pop:c.hits(), e0:${e0}, e1:c.B().enemy.hp, st:c.B().state};`);
  if (Number.isFinite(dmg.pop)) summary.dmg.push({ seed, who: "enemy", pop: dmg.pop, drop: dmg.e0 - dmg.e1 });       // an evade (a real game outcome) has no number: a damage round follows below
  await stop(seed, "hit", ALL, { hud: true });
  await popOnce(seed, "hit", await P(`const bm=await import("./battle.js"); return {pop:c.popNow(), note:bm.lastHitNote(), log:window.__popLog.slice()};`), null);
  await P(`window.__popLog.length=0;`);

  // enemy turn: press through the pages until the enemy's damage line shows
  await P(`for(let i=0;i<24 && !document.querySelector(".uic-pop-player");i++) await c.tap("Enter",1000); await c.sleep(400);`);
  const d2 = await P(`return {pop:c.hits(), side:(document.querySelector(".uic-pop")||{}).className||"", p1:c.B().player.hp, st:c.B().state};`);
  const missed = !Number.isFinite(d2.pop);       // the enemy's blow was an evade: that IS the evade case, and a damage round follows
  if (/player/.test(d2.side) && !missed) summary.dmg.push({ seed, who: "player", pop: d2.pop, drop: p0 - d2.p1 });
  await stop(seed, "enemy-turn", ALL, { hud: true });
  const et = await P(`const bm=await import("./battle.js"); return {pop:c.popNow(), note:bm.lastHitNote(), log:window.__popLog.slice()};`);
  await popOnce(seed, "enemy-turn", et, null);
  console.log("  after enemy-turn: " + JSON.stringify(await P(`const b=c.B(); return {st:b.state, hp:b.player.hp, max:b.player.maxHp, name:b.player.profile&&b.player.profile.name, sel:c.sel(), texts:__uiC.texts().join('|').slice(-200)};`)));
  evadeSeen = missed && et.pop && et.pop.kind === "miss" && et.pop.text === "EVADE" ? et.pop : null;
  for (let round = 0; missed && round < 4 && !summary.dmg.some((d) => d.seed === seed && d.who === "player"); round++) {
    await toMenu();
    const q = await P(`const b=c.B(); b.player.hp=b.player.maxHp; const h0=b.player.hp; await c.pick(0,300); for(let i=0;i<30 && !(document.querySelector(".uic-pop-player") && Number.isFinite(c.hits()));i++) await c.tap("Enter",1000); return {pop:c.hits(), p1:c.B().player.hp, h0};`);
    if (Number.isFinite(q.pop)) summary.dmg.push({ seed, who: "player", pop: q.pop, drop: q.h0 - q.p1 });
  }
  for (let round = 0; round < 4 && !summary.dmg.some((d) => d.seed === seed && d.who === "enemy"); round++) {
    await toMenu();
    const q = await P(`const b=c.B(); b.player.hp=b.player.maxHp; b.enemy.hp=b.enemy.maxHp; const e0=b.enemy.hp; await c.pick(0,300); for(let i=0;i<14&&!Number.isFinite(c.hits());i++) await c.tap("Enter",1000); await c.sleep(400); return {pop:c.hits(), e0, e1:c.B().enemy.hp};`);
    if (Number.isFinite(q.pop)) summary.dmg.push({ seed, who: "enemy", pop: q.pop, drop: q.e0 - q.e1 });
  }
  await P(`c.B().player.hp=c.B().player.maxHp;`);
  try { await seedTypes(seed); } catch (e) { summary.fails.push({ seed, stop: "seed-types", issues: [String(e.message).slice(0, 200)] }); console.log("FAIL seed-types " + seed + ": " + e.message); console.log("  state now " + JSON.stringify(await P(`const b=c.B(); return {st:b&&b.state, hp:b&&b.player.hp, max:b&&b.player.maxHp, sel:c.sel(), texts:__uiC.texts().join("|").slice(-300), layers:__uiC.layers().join()};`))); }
  await P(`c.B().player.hp=c.B().player.maxHp;`);          // a big hit must never leave the partner down (the Tag screen would take over the menu)

  // back to the command menu, then the winning hit
  await toMenu();
  await P(`c.B().player.hp=c.B().player.maxHp; c.B().enemy.hp=1; await c.pick(0, 300);`);
  await P(`await c.until(()=>c.B().state===8||c.hits()!==null,20000); await c.sleep(600);`);
  await stop(seed, "win-hit", TWO, { hud: true });
  await P(`for(let i=0;i<30 && !(window.__reportNative&&window.__reportNative.isOpen&&window.__reportNative.isOpen());i++) await c.tap("Enter",1100); await c.sleep(1500);`);
  const fin = await P(`const b=c.B(); return b?{st:b.state,ph:b._victoryPhase,nat:b._reportNative,open:!!(window.__reportNative&&window.__reportNative.isOpen&&window.__reportNative.isOpen())}:null;`);
  if (!fin || !fin.open) console.log("victory not open: " + JSON.stringify(fin));
  await victory(seed);
}

async function victory(seed) {
  let last = "", n = 0;
  for (let i = 0; i < 40 && n < 9; i++) {
    const info = await P(`const r=window.__reportNative; const st=r&&r.isOpen&&r.isOpen()?r.diagnostics().state:null; return {st, texts:__uiC.texts().join("|"), layers:__uiC.layers().join(",")};`);
    if (!info.st) break;
    const sig = `${info.st.step}:${info.texts}`;
    if (sig !== last) {
      await P(`await c.sleep(1400);`);       // let the page's own counters and animations settle
      last = sig; n++;
      await stop(seed, `vic${n}`, ALL, { vic: true });
    }
    await P(`await c.tap("Enter",1300);`);
  }
  summary.seeds[seed] = `vic pages: ${n}`;
}

// ------------------------------------------------------------------------------------------------ main
try {
  await ensureServer();
  await launch();
  await send("Runtime.enable"); await send("Page.enable");
  const gl = await ev(`(()=>{const g=document.createElement('canvas').getContext('webgl'); const e=g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL);})()`);
  summary.renderer = gl;
  console.log("renderer: " + gl);
  if (/swiftshader|llvmpipe|software/i.test(gl) || !/AMD|Radeon/i.test(gl)) { console.log("STOP: not the AMD GPU"); process.exitCode = 3; throw new Error("software renderer"); }
  for (const seed of SEEDS) { try { await playSeed(seed); } catch (e) { summary.fails.push({ seed, stop: "script", issues: [String(e.message).slice(0, 200)] }); console.log("FAIL script " + seed + ": " + e.message); } }
  for (const d of summary.dmg) { const ok = d.pop != null && d.pop === d.drop; if (!ok) summary.fails.push({ seed: d.seed, stop: "damage-" + d.who, issues: [`pop ${d.pop} vs HP drop ${d.drop}`] }); console.log(`${ok ? "pass" : "FAIL"} ${d.seed}/damage-${d.who} pop ${d.pop} drop ${d.drop}`); }
} catch (e) { if (process.exitCode !== 3) console.log("ERROR " + e.message); process.exitCode ||= 1; }
finally {
  summary.worstKinds = Object.fromEntries([...worst.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
  const total = summary.stops.length, failedStops = new Set(summary.fails.map((f) => `${f.seed}/${f.stop}`));
  if (NOTSEEDED.length) console.log("NOT SEEDED: " + NOTSEEDED.join(", "));
  console.log(`SUMMARY stops ${total}, failing ${failedStops.size}, issue kinds ${JSON.stringify(summary.worstKinds)}`);
  for (const f of summary.fails.slice(0, 12)) console.log(` ${f.seed}/${f.stop}${f.size ? " " + f.size : ""}: ${f.issues.slice(0, 3).join(" ; ")}`);
  killAll();
  if (summary.fails.length) process.exitCode ||= 1;
}
