// Compares an arena AS BUILT (Arena Viewer look=built) with the same arena in HD Remaster (look=hd), from identical cameras.
// Poses: the battle idle pose, 8 free-camera poses at the fight centre (eye height 1.7 m = 680 units, looking out every 45 deg
// of azimuth, az = atan2(x,z)), 2 high views. Digimon hidden, canvas 960x720, time frozen. Asserts the view-projection of both
// looks is the same (1e-4 relative). Writes PNG pairs + numbers.json to ~/scratch-research/compare/<arena>/ :
//  per pair: 8x6 grid cell mean sRGB + luma and the delta (built - hd), horizon row (first row from the top where the column
//  stops looking like sky: step > 18 summed over rgb, or luma < 90), non-sky share per 8 azimuth column groups (120 px each),
//  4x4x4 sRGB histogram distance (half L1, 0..1), edge density (share of pixels with Sobel luma magnitude > 40).
//   VERIFY_PORT=8090 [ARENA=meft1008] tools/verify-lock.sh tools/run-playwright.sh tools/compare_built_vs_hd.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1008";
const OUT = path.join(os.homedir(), "scratch-research", "compare", ARENA);
fs.mkdirSync(OUT, { recursive: true });
const url = (look) => `${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=${look}&p=m373rena&e=m051kuwa`;
const browser = await launch();
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

async function open(look) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.addInitScript(() => { performance.now = () => globalThis.__tNow || 0; window.requestAnimationFrame = () => 0; });
  await page.goto(url(look));
  await page.waitForFunction(() => !!window.__renderFrame && !!window.__r && !!window.__viewerState, null, { timeout: 90000, polling: 200 });
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate((look) => { window.__renderFrame(0); const B = window.__built; const r = window.__r;
      const fo = !!r.getFighterBounds("player") && !!r.getFighterBounds("enemy");
      return look === "built" ? (!!B && !B.missing && B.info.triangles > 0 && fo && (B.info.layers?.sand ? !!B.info.layers.sand.tex?.ready : true)) : fo; }, look);
    if (ok && i >= 15) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return { ctx, page, errors };
}

const ANALYSE = `(() => {
  const cv = document.getElementById("cv"), W = cv.width, H = cv.height;
  const d = cv.getContext("2d").getImageData(0, 0, W, H).data;
  const L = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const gx = 8, gy = 6, cw = W / gx, ch = H / gy, cells = [];
  for (let cy = 0; cy < gy; cy++) for (let cx = 0; cx < gx; cx++) {
    let r = 0, g = 0, b = 0, l = 0, n = 0;
    for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw; x < (cx + 1) * cw; x++) { const i = (y * W + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; l += L(i); n++; }
    cells.push([r / n, g / n, b / n, l / n]);
  }
  const hor = new Array(W);
  for (let x = 0; x < W; x++) {
    let y = 0; const i0 = x * 4;
    if (L(i0) < 90) { hor[x] = 0; continue; }
    for (y = 1; y < H; y++) { const i = (y * W + x) * 4, j = ((y - 1) * W + x) * 4;
      if (Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]) > 18 || L(i) < 90) break; }
    hor[x] = y;
  }
  const hist = new Array(64).fill(0);
  for (let i = 0; i < d.length; i += 4) hist[(d[i] >> 6) * 16 + (d[i + 1] >> 6) * 4 + (d[i + 2] >> 6)]++;
  const tot = W * H; for (let k = 0; k < 64; k++) hist[k] /= tot;
  let e = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = (y * W + x) * 4, a = (dx, dy) => L(i + (dy * W + dx) * 4);
    const sx = -a(-1, -1) - 2 * a(-1, 0) - a(-1, 1) + a(1, -1) + 2 * a(1, 0) + a(1, 1);
    const sy = -a(-1, -1) - 2 * a(0, -1) - a(1, -1) + a(-1, 1) + 2 * a(0, 1) + a(1, 1);
    if (Math.hypot(sx, sy) / 4 > 40) e++;
  }
  return { cells, hor, hist, edge: e / ((W - 2) * (H - 2)), png: cv.toDataURL("image/png") };
})()`;

const hd = await open("hd");
await hd.page.selectOption("#cam", "free");
for (let i = 0; i < 80 && !(await hd.page.evaluate(() => { window.__renderFrame(0); return !!window.__tools.freeCam; })); i++) await new Promise((r) => setTimeout(r, 250));
const base = await hd.page.evaluate(() => {
  const r = window.__r, fc = window.__tools.freeCam, a = r.getFighterBounds("player"), b = r.getFighterBounds("enemy");
  const c = [(a.center[0] + b.center[0]) / 2, 0, (a.center[2] + b.center[2]) / 2];
  const f = document.getElementById("fighters"); f.checked = false; f.dispatchEvent(new Event("change"));
  return { start: fc.start, centre: c, fov: fc.start.fovDeg, gy: Math.min(a.min[1], b.min[1]) };
});
const EYE_H = 680;
const poses = [{ name: "battle", eye: base.start.eye, look: base.start.look }];
for (let k = 0; k < 8; k++) {
  const az = k * 45, s = Math.sin(az * Math.PI / 180), c = Math.cos(az * Math.PI / 180), e = [base.centre[0], base.gy + EYE_H, base.centre[2]];
  poses.push({ name: `az${String(az).padStart(3, "0")}`, eye: e, look: [e[0] + s * 1000, e[1], e[2] + c * 1000] });
}
// high views: behind the battle camera side of the fight, looking down at the centre
const bd = [base.start.eye[0] - base.centre[0], base.start.eye[2] - base.centre[2]], bl = Math.hypot(...bd) || 1;
for (const [n, h, back] of [["high1", 4000, 2500], ["high2", 12000, 6000]])
  poses.push({ name: n, eye: [base.centre[0] + bd[0] / bl * back, base.gy + h, base.centre[2] + bd[1] / bl * back], look: [base.centre[0], base.gy, base.centre[2]] });

async function shoot(h, look) {
  const res = [];
  for (const p of poses) {
    const o = await h.page.evaluate(async ([p, fov, ANALYSE]) => {
      const fc = window.__tools.freeCam; fc.set(p.eye, p.look); fc.camera.fov = fov; fc.camera.updateProjectionMatrix();
      for (let i = 0; i < 4; i++) { globalThis.__tNow = 7000 + i * 16; window.__renderFrame(globalThis.__tNow); }
      const pv = Array.from(window.__r.getViewProjection()), bpv = window.__built?.info?.pv ? Array.from(window.__built.info.pv) : null;
      return { pv, bpv, an: await eval(ANALYSE) };
    }, [p, base.fov, ANALYSE]);
    fs.writeFileSync(path.join(OUT, `${p.name}_${look}.png`), Buffer.from(o.an.png.split(",")[1], "base64"));
    delete o.an.png; res.push({ name: p.name, pv: o.pv, bpv: o.bpv, ...o.an });
  }
  return res;
}
const R_hd = await shoot(hd, "hd");
console.log(`INFO hd page errors: ${hd.errors.length}`);
await hd.ctx.close();
const bt = await open("built");
await bt.page.selectOption("#cam", "free");
for (let i = 0; i < 80 && !(await bt.page.evaluate(() => { window.__renderFrame(0); return !!window.__tools.freeCam; })); i++) await new Promise((r) => setTimeout(r, 250));
await bt.page.evaluate(() => { const f = document.getElementById("fighters"); f.checked = false; f.dispatchEvent(new Event("change")); });
const R_bt = await shoot(bt, "built");
console.log(`INFO built page errors: ${bt.errors.length} ${[...new Set(bt.errors)].slice(0, 2).join(" | ")}`);
await bt.ctx.close(); await browser.close();

const out = { arena: ARENA, fov: base.fov, centre: base.centre, poses: [] };
for (let i = 0; i < poses.length; i++) {
  const a = R_hd[i], b = R_bt[i];
  let worst = 0; for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(a.pv[k] - b.pv[k]) / Math.max(1, Math.abs(a.pv[k])));
  let worstB = 0; if (b.bpv) for (let k = 0; k < 16; k++) worstB = Math.max(worstB, Math.abs(b.bpv[k] - b.pv[k]) / Math.max(1, Math.abs(b.pv[k])));
  check(worst <= 1e-4 && worstB <= 1e-4, `${poses[i].name}: view-projection hd vs built worst ${worst.toExponential(1)}, built layer vs battle3d ${worstB.toExponential(1)}`);
  const delta = a.cells.map((c, k) => c.map((v, j) => +(b.cells[k][j] - v).toFixed(1)));
  const groups = (h) => Array.from({ length: 8 }, (_, g) => { let s = 0; for (let x = g * 120; x < (g + 1) * 120; x++) s += h[x]; return +(s / 120).toFixed(1); });
  const med = (h) => [...h].sort((x, y) => x - y)[h.length >> 1];
  let hd1 = 0; for (let k = 0; k < 64; k++) hd1 += Math.abs(a.hist[k] - b.hist[k]);
  out.poses.push({ name: poses[i].name, eye: poses[i].eye, look: poses[i].look,
    cells: { hd: a.cells.map((c) => c.map((v) => +v.toFixed(1))), built: b.cells.map((c) => c.map((v) => +v.toFixed(1))), delta },
    horizonRowMedian: { hd: med(a.hor), built: med(b.hor) }, horizonRowPer120px: { hd: groups(a.hor), built: groups(b.hor) },
    nonSkyShare120px: { hd: groups(a.hor).map((v) => +(1 - v / 720).toFixed(3)), built: groups(b.hor).map((v) => +(1 - v / 720).toFixed(3)) },
    histDistance: +(hd1 / 2).toFixed(4), edgeDensity: { hd: +a.edge.toFixed(4), built: +b.edge.toFixed(4) },
    meanLuma: { hd: +(a.cells.reduce((s, c) => s + c[3], 0) / 48).toFixed(1), built: +(b.cells.reduce((s, c) => s + c[3], 0) / 48).toFixed(1) } });
}
fs.writeFileSync(path.join(OUT, "numbers.json"), JSON.stringify(out, null, 1));
for (const p of out.poses) console.log(`${p.name}: luma hd ${p.meanLuma.hd} built ${p.meanLuma.built}; horizon row hd ${p.horizonRowMedian.hd} built ${p.horizonRowMedian.built}; hist ${p.histDistance}; edges ${p.edgeDensity.hd} / ${p.edgeDensity.built}`);
console.log(`${fails ? "FAIL" : "PASS"} ${fails} failed; output ${OUT}`);
process.exit(fails ? 1 : 0);
