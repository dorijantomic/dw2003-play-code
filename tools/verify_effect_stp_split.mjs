// On-screen proof for the per-texel semi-transparency split in the 2D sprite effect path.
//
// The PS1 blends a semi-transparent sprite only where the palette entry's STP bit is set; a
// texel with the bit clear is drawn SOLID inside the same sprite. 62 of the 1,757 shipped
// clips mix the two, and within those 60.6% of the drawn pixels are solid — the arch-1 rings
// are 99% solid and E144ROSE's petal 86%, all of which the walker used to draw wholly
// additive. The extractor now packs the solid texels as a second, pixel-disjoint region and
// effect-player.js draws it under default compositing.
//
// This renders each affected clip twice against the same background — additive-only, the way
// it used to look, and the split — so the difference is a picture rather than a count.
//
// Run: tools/run-playwright.sh tools/verify_effect_stp_split.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const OUT_DIR = process.env.OUT_DIR || "/tmp/stp-split";
const PORT = Number(process.env.PORT || 8791);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".css": "text/css" };

const MAN = JSON.parse(fs.readFileSync("web/assets/battle/effects/manifest.json", "utf8"));
// Straight from the shipped data so the list cannot drift: every clip carrying a solid half,
// widest first, capped so the sheet stays readable.
const CASES = [];
for (const [a, arch] of Object.entries(MAN.archives)) {
  for (const [id, c] of Object.entries(arch.clips)) {
    if (c.solid) CASES.push({ arch: a, id, sheet: arch.sheet, c });
  }
}
CASES.sort((p, q) => q.c.w * q.c.h - p.c.w * p.c.h);
const PICK = CASES.slice(0, Number(process.env.LIMIT || 6));

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
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/battle-lab.html`, { waitUntil: "networkidle" });

const rows = [];
for (const cs of PICK) {
  // Draw the clip onto a mid-grey field twice: additive only (the old behaviour), then
  // additive plus the solid half under default compositing (the decoded behaviour).
  const shots = await page.evaluate(async ({ sheet, c }) => {
    const img = new Image();
    img.src = `assets/battle/effects/${sheet}`;
    await img.decode();
    const draw = (withSolid) => {
      const cv = document.createElement("canvas");
      cv.width = c.w; cv.height = c.h;
      const g = cv.getContext("2d");
      g.fillStyle = "#3a3a4a"; g.fillRect(0, 0, c.w, c.h);
      g.save();
      if (c.semi === 1) g.globalCompositeOperation = "lighter";
      else if (c.semi === 3) { g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.25; }
      else if (c.semi === 0) g.globalAlpha = 0.5;
      g.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
      if (withSolid) {
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
        g.drawImage(img, c.solid.x, c.solid.y, c.solid.w, c.solid.h, 0, 0, c.w, c.h);
      }
      g.restore();
      return cv.toDataURL("image/png");
    };
    return { before: draw(false), after: draw(true) };
  }, cs);
  for (const which of ["before", "after"]) {
    const url = shots[which];
    const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const name = `arch${cs.arch}_clip${cs.id.replace("@", "s")}_${which}.png`;
    fs.writeFileSync(path.join(OUT_DIR, name), buf);
    rows.push({ ...cs, which, name, bytes: buf.length });
  }
}

await browser.close();
server.close();
console.log(`clips carrying a solid half: ${CASES.length} of ` +
  `${Object.values(MAN.archives).reduce((n, a) => n + Object.keys(a.clips).length, 0)}`);
console.log(`captures -> ${OUT_DIR}`);
for (const r of rows) console.log(`  arch ${r.arch} clip ${r.id} semi ${r.c.semi} ${r.which}: ${r.name}`);
if (errors.length) { console.log("page errors:"); errors.slice(0, 5).forEach((e) => console.log("  " + e)); process.exitCode = 1; }
