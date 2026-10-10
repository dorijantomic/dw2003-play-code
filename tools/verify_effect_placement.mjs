// On-screen proof that a 3D battle effect lands on the Digimon it is aimed at.
//
// The walker used to mirror every enemy-issued effect across a supposed arena mid-line
// (x' = -x, z' = 640 - z) and to stand both fighters at fixed slots -5248 / +5888. Neither
// is authentic: the original never mirrors a world effect (the two sides' scripts are
// authored separately) and each fighter's slot comes from its own smdldata record. So an
// enemy attack's effect, authored to land on YOUR Digimon at z = -5120, was being moved to
// z = +5760 - the enemy's own end of the arena.
//
// This drives web/battle-lab.html, reads the live effect spawns out of the renderer during
// an attack, and reports for each world-space effect which fighter it is nearer. It also
// prints what the retired mirror would have produced, so the before/after is in the numbers
// as well as in the captures.
//
// Run:  tools/run-playwright.sh tools/verify_effect_placement.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const OUT_DIR = process.env.OUT_DIR || "/tmp/effect-placement";
const PORT = Number(process.env.PORT || 8751);

// Each case attacks with one side and expects its world effects to land on the other.
const PLAYER = "m003agum";            // Agumon, stand-off 384 -> slot z = -5504
const CASES = [
  { name: "Tyrannomon", model: "m008tyra", side: "enemy",  aimsAt: "player" },
  { name: "Meramon",    model: "m009mera", side: "enemy",  aimsAt: "player" },
  { name: "Seadramon",  model: "m010sead", side: "enemy",  aimsAt: "enemy"  }, // hovers, hits near itself
  { name: "Agumon",     model: "m008tyra", side: "player", aimsAt: "enemy"  }, // control: was already right
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
  page.on("response", (r) => {
    if (r.status() >= 400 && !/favicon|slot_map\.json/i.test(r.url())) {
      errors.push(`HTTP ${r.status()} ${r.url()}`);
    }
  });

  await page.goto(`http://localhost:${PORT}/battle-lab.html`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelectorAll("#eModel option").length > 0,
    { timeout: 30000 });
  await page.selectOption("#pModel", PLAYER);

  for (const c of CASES) {
    await page.selectOption("#eModel", c.model);
    await page.fill("#rawTech", "1");            // tech 1 -> clip 5, the basic attack
    await page.waitForTimeout(1400);

    const seen = await page.evaluate(async (side) => {
      const r = window.__r;
      if (!r?.effectPlayer || !r?.debugArenaSlots) return { error: "debug hooks unavailable" };
      const slots = r.debugArenaSlots();
      document.querySelector(side === "enemy" ? "#atkE" : "#atkP").click();
      const world = [];
      for (let i = 0; i < 240; i++) {
        for (const s of r.effectPlayer.renderList()) {
          if (s.screen) continue;                 // screen-space markers carry no arena position
          const key = `${s.side}:${s.pos.x},${s.pos.y},${s.pos.z}`;
          if (!world.some((w) => w.key === key)) world.push({ key, ...s.pos, side: s.side });
        }
        await new Promise((res) => requestAnimationFrame(res));
      }
      return { slots, world };
    }, c.side);

    if (seen.error) { errors.push(`${c.name}: ${seen.error}`); continue; }
    const pz = seen.slots.player.z, ez = seen.slots.enemy.z;
    const rows = seen.world.map((w) => {
      const nearer = Math.abs(w.z - pz) <= Math.abs(w.z - ez) ? "player" : "enemy";
      const wasZ = w.side === "enemy" ? 640 - w.z : w.z;   // what the retired mirror produced
      const wasNearer = Math.abs(wasZ - pz) <= Math.abs(wasZ - ez) ? "player" : "enemy";
      return { z: w.z, nearer, wasZ, wasNearer };
    });
    const ok = rows.length > 0 && rows.every((r) => r.nearer === c.aimsAt);
    results.push({ ...c, pz, ez, rows, ok });

    await page.click(c.side === "enemy" ? "#atkE" : "#atkP");
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(OUT_DIR, `${c.name.toLowerCase()}-${c.side}.png`) });
    await page.waitForTimeout(900);
  }
} finally {
  await browser.close();
  server.close();
}

for (const r of results) {
  console.log(`\n  ${r.name} attacks (${r.side}) — player slot z=${r.pz}, enemy slot z=${r.ez}`);
  console.log("    effect z    lands on     with the old mirror     verdict");
  for (const row of r.rows) {
    console.log(`    ${String(row.z).padStart(7)}     ${row.nearer.padEnd(9)}    ` +
      `z=${String(row.wasZ).padStart(6)} -> ${row.wasNearer.padEnd(7)}   ` +
      `${row.nearer === r.aimsAt ? "OK" : "FAIL"}`);
  }
  if (!r.rows.length) console.log("    (no world-space effect observed)");
}
console.log(`\ncaptures: ${OUT_DIR}`);
console.log("page errors:", errors.length ? errors.join(" ;; ") : "none");
const pass = errors.length === 0 && results.length === CASES.length && results.every((r) => r.ok);
console.log(pass ? "\nPASS" : "\nFAIL");
process.exit(pass ? 0 : 1);
