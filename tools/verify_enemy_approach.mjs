// On-screen proof for the op2 mode-5 slot motion object (the enemy attack step-in).
//
// Before this fix the walker honoured only op2 mode 3 (an absolute move) as an approach, so the
// 8 models that use it — Kuwagamon among them — jumped at their target while the 112 that author
// `op2 [5, slot, 4, param]` stood still and swung at empty air. This drives web/battle-lab.html,
// makes each enemy perform its basic attack, and samples the enemy actor's arena offset every
// frame to measure how far it actually travels.
//
// Run:  tools/run-playwright.sh tools/verify_enemy_approach.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const OUT_DIR = process.env.OUT_DIR || "/tmp/enemy-approach";
const PORT = Number(process.env.PORT || 8749);

// The enemies the user named as broken, plus Kuwagamon as the control that already worked.
const CASES = [
  { name: "Tyrannomon",  model: "m008tyra", expect: "leap" },
  { name: "Tuskmon",     model: "m136tusk", expect: "leap" },
  { name: "Meramon",     model: "m009mera", expect: "leap" },
  { name: "Devidramon",  model: "m006devi", expect: "leap" },
  { name: "Kuwagamon",   model: "m051kuwa", expect: "leap" },   // control: mode 3, worked before
  { name: "Andromon",    model: "m040andr", expect: "still" },  // control: no displacement authored
];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css", ".bin": "application/octet-stream" };

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

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const errors = [];
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
  page.on("pageerror", (e) => errors.push("JS: " + e.message));
  // slot_map.json is an optional per-model override; every model 404s it and the lab copes.
  page.on("response", (r) => {
    if (r.status() >= 400 && !/favicon|slot_map\.json/i.test(r.url())) {
      errors.push(`HTTP ${r.status()} ${r.url()}`);
    }
  });

  await page.goto(`http://localhost:${PORT}/battle-lab.html`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelectorAll("#eModel option").length > 0,
    { timeout: 30000 });

  for (const c of CASES) {
    // Pick the enemy and let its model + timeline load.
    await page.selectOption("#eModel", c.model);
    // The lab defaults to tech 59 (Diamond Storm), which is a SIGNATURE — clip 11. The approach
    // under test is the BASIC ATTACK, clip 5, so drive a tech that maps there (techToClip(1) = 5).
    // Getting this wrong reads as "no movement" on every model whose leap lives only in clip 5.
    await page.fill("#rawTech", "1");
    await page.waitForTimeout(1200);

    // Sample the enemy actor's own arena offset while it attacks. moveDelta()[2] is the
    // forward axis (PS1 z); the leap should carry it thousands of units toward us.
    const travel = await page.evaluate(async () => {
      const r = window.__r;
      if (!r?.debugMoveDelta) return { error: "battle3d debugMoveDelta not available" };
      document.querySelector("#atkE").click();
      const seen = [];
      for (let i = 0; i < 240; i++) {
        seen.push(r.debugMoveDelta().enemy?.[2] ?? 0);
        await new Promise((res) => requestAnimationFrame(res));
      }
      return { peak: Math.min(...seen), last: seen[seen.length - 1] };
    });

    if (travel.error) { errors.push(`${c.name}: ${travel.error}`); continue; }
    const dist = Math.abs(travel.peak);
    const moved = dist > 1000;
    const ok = c.expect === "leap" ? moved : !moved;
    results.push({ ...c, dist: Math.round(dist), moved, ok });

    // Capture mid-leap, where the travel is most visible.
    await page.click("#atkE");
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT_DIR, `${c.model}.png`) });
    await page.waitForTimeout(900);
  }
} finally {
  await browser.close();
  server.close();
}

console.log("\n  enemy         model      travelled   verdict");
console.log("  ------------------------------------------------");
for (const r of results) {
  console.log(`  ${r.name.padEnd(12)}  ${r.model}   ${String(r.dist).padStart(6)}    ` +
    `${r.ok ? "OK" : "FAIL"}  (expected ${r.expect})`);
}
console.log(`\ncaptures: ${OUT_DIR}`);
console.log("page errors:", errors.length ? errors.join(" ;; ") : "none");
const pass = errors.length === 0 && results.length === CASES.length && results.every((r) => r.ok);
console.log(pass ? "\nPASS" : "\nFAIL");
process.exit(pass ? 0 : 1);
