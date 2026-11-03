// Render the built arena from exact cameras and classify the pixels in-page: a text picture plus numbers.
// (The vision model is not needed; this is the repo's "numbers, not screenshots" rule applied to the look.)
//   VERIFY_PORT=8090 tools/run-playwright.sh tools/_shot_spires.mjs [ONLY=01,02] [MODE=both]
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const ARENA = process.env.ARENA || "meft1002";
const OUT = process.env.OUT || "/home/dorij/.hermes/cache/scratch/spires";
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const MODE = process.env.MODE || "both";              // full | spires | both
const GRID = Number(process.env.GRID || 100);
const FOV = Number(process.env.FOV || 0.95);
mkdirSync(OUT, { recursive: true });
const D = Math.PI / 180;
const P = (az, r, y) => [Math.sin(az * D) * r, y, Math.cos(az * D) * r];   // az in degrees, r units

// the wall stands at az -137..-42, r ~4.3-4.9k, base y 273, top 3409; the islands at az 94 (r 5783), 106 (r 6121)
const VIEWS = [
  ["01-wall", P(-90, 2600, 900), [-4300, 1800, 0]],
  ["02-wall-close", P(-90, 3900, 1500), [-4450, 1900, 0]],
  ["03-wall-left", [-2500, 1300, 2200], [-4500, 1700, 250]],
  ["04-wall-high", [0, 4200, 1400], [-4300, 700, 0]],
  ["05-island", [3900, 900, -1400], [5771, 700, -379]],   // the sea stack at az 93.75, r 5783 = (5771, 0, -379)
  ["06-arena", P(-90, 2600, 700), [-4300, 1400, 0]],
];
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2000);

const shots = [];
for (const [name, eye, look] of VIEWS) {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) continue;
  for (const mode of (MODE === "both" ? ["full", "spires"] : [MODE])) {
    const r = await page.evaluate(async ({ eye, look, mode, grid, fov }) => {
      const B = window.__built, THREE = B.THREE || null;
      const R = B.renderer, cv = R.domElement, W = cv.width, H = cv.height;
      const cam = { fovRad: fov, aspect: W / H, eye, up: [0, 1, 0], look, arenaScale: 1 };
      const hide = [];
      if (mode === "spires") {
        B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isSprite) && o.visible && o.userData?.kind !== "spire") { o.visible = false; hide.push(o); } });
      } else if (mode === "bush") {
        B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isSprite) && o.visible && !/builtSpireBush|builtSpireShrub/.test(o.name)) { o.visible = false; hide.push(o); } });
      } else if (mode === "veg") {
        B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isSprite) && o.visible && !/builtSpireBush|builtSpireShrub|builtSpireCards/.test(o.name)) { o.visible = false; hide.push(o); } });
      }
      const prevClear = R.getClearColor(new (await import("./lib3d/three.module.js")).Color()), prevA = R.getClearAlpha();
      R.setClearColor(0xff00ff, 1);          // magenta = "no geometry here", so the shares are shares OF THE WALL
      B.render(cam);
      const url = cv.toDataURL("image/png");
      const c2 = document.createElement("canvas");
      const rows = Math.round(grid * H / W), cols = grid;
      c2.width = cols; c2.height = rows;
      const g = c2.getContext("2d");
      g.drawImage(cv, 0, 0, cols, rows);
      const d = g.getImageData(0, 0, cols, rows).data;
      R.setClearColor(prevClear, prevA);
      for (const o of hide) o.visible = true;
      const cls = (r0, g0, b0) => {
        const mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0), lu = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0;
        const sat = mx ? (mx - mn) / mx : 0;
        if (r0 > 200 && g0 < 60 && b0 > 200) return " ";                         // the magenta clear = no geometry
        // the SAME four buckets the reference cliff texture was measured with (wall.png: pale>140 = 68%, mid 80-140 =
        // 9%, dark <=80 = 21%, green = 11%, and not one blue-dominant pixel), so the numbers are comparable
        if (g0 > r0 + 8 && g0 > b0 + 8) return "V";                             // vegetation green
        if (lu > 140) return "R";                                               // pale rock
        if (lu > 80) return "r";                                                // mid rock / shade
        return "D";                                                             // dark: a crevice
      };
      const lines = [], counts = {};
      for (let j = 0; j < rows; j++) {
        let s = "";
        for (let i = 0; i < cols; i++) { const o = (j * cols + i) * 4; const c = cls(d[o], d[o + 1], d[o + 2]); s += c; counts[c] = (counts[c] || 0) + 1; }
        lines.push(s);
      }
      // sky through the wall: a column of the frame that is background across the wall's own vertical extent is a
      // hole in the cliff (the seams between two recipe cards used to open exactly such a slot)
      const colBg = new Array(cols).fill(0), colTop = new Array(cols).fill(-1), colBot = new Array(cols).fill(-1);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const bg = lines[j][i] === " ";
        if (!bg) { if (colTop[i] < 0) colTop[i] = j; colBot[i] = j; } else colBg[i]++;
      }
      let holes = 0, run = 0, worstRun = 0;
      for (let i = 0; i < cols; i++) {
        const ext = colBot[i] - colTop[i];
        const solidCol = ext > rows * 0.35;
        const hole = solidCol && colBg[i] > ext * 0.55;
        if (hole) { holes++; run++; worstRun = Math.max(worstRun, run); } else run = 0;
      }
      const tot = cols * rows;
      const wallPx = tot - (counts[" "] || 0);
      const share = (k) => +(((counts[k] || 0) * 100) / Math.max(1, wallPx)).toFixed(1);
      const frameShare = (k) => +(((counts[k] || 0) * 100) / tot).toFixed(1);
      // the pale-rock share of everything that is not sky: how pale the cliff reads
      let rockPx = 0, bright = 0, sum = [0, 0, 0], nRock = 0;
      for (let k = 0; k < tot; k++) {
        const o = k * 4, c = { r: d[o], g: d[o + 1], b: d[o + 2] };
        const ch = cls(c.r, c.g, c.b);
        if (ch === "R" || ch === "r") { rockPx++; sum[0] += c.r; sum[1] += c.g; sum[2] += c.b; nRock++; if (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 120) bright++; }
      }
      return { url, lines, counts, tot, wallPx, holes, worstRun, frameVeg: frameShare("V"), shares: { pale: share("R"), mid: share("r"), veg: share("V"), dark: share("D") }, rockPx, paleShare: nRock ? bright / nRock : 0,
               meanRock: nRock ? sum.map((v) => Math.round(v / nRock)) : null };
    }, { eye, look, mode, grid: GRID, fov: FOV });
    const file = `${OUT}/${name}-${mode}.png`;
    writeFileSync(file, Buffer.from(r.url.split(",")[1], "base64"));
    shots.push({ name, mode, file, frameVeg: r.frameVeg, holes: r.holes, worstRun: r.worstRun, shares: r.shares, wallPx: r.wallPx, meanRock: r.meanRock, paleShare: +r.paleShare.toFixed(2), lines: r.lines });
  }
}
for (const s of shots) {
  console.log(`\n=== ${s.name} [${s.mode}] -> ${s.file}\n    OF THE WALL: pale ${s.shares.pale}%  mid ${s.shares.mid}%  veg ${s.shares.veg}%  dark ${s.shares.dark}%`
    + `  (ref texture: pale 68 / mid 9 / green 11 / dark 21, no blue)   mean rock rgb ${JSON.stringify(s.meanRock)}`
    + `   green ${s.frameVeg}% of the FRAME; sky-through-wall columns: ${s.holes} (longest run ${s.worstRun})`);
  for (const l of s.lines) console.log("   " + l);
}
console.log("\nerrors", errors.length, errors.slice(0, 4));
writeFileSync(`${OUT}/stats.json`, JSON.stringify(shots.map(({ lines, ...s }) => s), null, 1));
await browser.close().catch(() => {});
