// On-screen proof for the effect sprite's three rotation angles (tip / turn / spin).
//
// Effect-program channels 6 and 7 were read as colour terms and dropped, so every effect that
// tips or turns its sprite drew flat. They are the X and Y angles of the same RotMatrix call
// that channel 8 (spin) already fed. This drives web/fight-effects-lab.html and captures each
// affected effect type at an EXACT tick, so a run against the old code and a run against the new
// one are directly comparable frames rather than two arbitrary moments of an animation.
//
// Run:  tools/run-playwright.sh tools/verify_effect_angles.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";

const OUT_DIR = process.env.OUT_DIR || "/tmp/effect-angles";
const PORT = Number(process.env.PORT || 8752);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css" };

// Every type whose program authors a nonzero tip (channel 6) or turn (channel 7), read straight
// from the shipped manifest so the list cannot drift from the data.
function tiltedTypes(manifest) {
  const out = [];
  for (const [tid, t] of Object.entries(manifest.types)) {
    let tilted = false;
    for (const rec of t.records || []) {
      for (const c of [6, 7]) {
        if (rec.defaults?.[c]) tilted = true;
        if (rec.mask & (1 << c)) {
          let col = 0;
          for (let k = 0; k < c; k++) if (rec.mask & (1 << k)) col++;
          for (const row of rec.frames || []) if (row[col]) tilted = true;
        }
      }
    }
    if (tilted) out.push(Number(tid));
  }
  return out.sort((a, b) => a - b);
}

const manifest = JSON.parse(fs.readFileSync("web/assets/battle/effects/manifest.json", "utf8"));
const TYPES = tiltedTypes(manifest);
const TICKS = [4, 10, 18];        // three points in each program's life

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(process.cwd(), "web", rel);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(PORT, r));
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const errors = [];
const rows = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
  page.on("pageerror", (e) => errors.push("JS: " + e.message));
  page.on("response", (r) => {
    if (r.status() >= 400 && !/favicon/i.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto(`http://localhost:${PORT}/fight-effects-lab.html`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__fxlab, { timeout: 30000 });

  const canvas = await page.$("#cv");
  for (const type of TYPES) {
    for (const ticks of TICKS) {
      const sprites = await page.evaluate(([t, n]) => window.__fxlab.renderAt(t, n), [type, ticks]);
      const file = path.join(OUT_DIR, `type${type}_t${ticks}.png`);
      await canvas.screenshot({ path: file });
      // Hash the canvas so a before/after pair is comparable without eyeballing 36 images.
      const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 12);
      const tilt = sprites.some((s) => s.rotX || s.rotY);
      rows.push({ type, ticks, sprites: sprites.length, tilt, hash });
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n  tilted effect types (from the shipped manifest): ${TYPES.join(" ")}`);
console.log("\n  type   tick  sprites  tipOrTurn  canvas");
console.log("  ------------------------------------------------");
for (const r of rows) {
  console.log(`  ${String(r.type).padStart(4)}   ${String(r.ticks).padStart(4)}  ` +
    `${String(r.sprites).padStart(7)}  ${r.tilt ? "   yes   " : "   no    "}  ${r.hash}`);
}
const manifestOut = path.join(OUT_DIR, "frames.json");
fs.writeFileSync(manifestOut, JSON.stringify(rows, null, 1));
console.log(`\ncaptures: ${OUT_DIR}\nframe table: ${manifestOut}`);
console.log("page errors:", errors.length ? errors.join(" ;; ") : "none");
const drew = rows.some((r) => r.sprites > 0);
console.log(errors.length === 0 && drew ? "\nPASS" : "\nFAIL");
process.exit(errors.length === 0 && drew ? 0 : 1);
