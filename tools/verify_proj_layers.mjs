// On-screen proof for the op6 projectile-mesh layer transforms.
//
// Two things were being ported wrongly and both are geometry, so the only honest check is a
// picture:
//   1. every layer was hung directly off the root, dropping the parent-index chain that
//      184 of the 572 shipped layer rows use (FIGHTSTG_F0x80084560 stores the index at
//      layer+0x00; F0x80083e0c turns it into the parent's matrix pointer);
//   2. the layer rotation matrix was built as Rx*Ry*Rz when F0x8002b45c builds Rz*Ry*Rx,
//      which is wrong for the 109 layers that author two or more nonzero rotation axes;
//   3. the effect's ticks were fed to the layer tracks directly and its lifetime came from
//      the last authored keyframe, instead of from the pack's compiled CLIP stream. The
//      clip disagrees for 17 of the 129 packs, and packs 108/109 replay their beam segment
//      four times, which a raw tick count cannot express at all.
//
// This drives the real Battle Lab through `r.debugRenderProjectileAt(id, tick)`, which
// spawns one flight mesh through the real EffectPlayer, pins its tick, and renders one
// frame with the real render(). Pinning the tick is the point: the lab's animation is
// wall-clock driven, so two ordinary runs never land on the same frame and their
// screenshots are not comparable. Here a run against the old code and a run against the new
// one are the same moment of the same effect.
//
// Run:  tools/run-playwright.sh tools/verify_proj_layers.mjs
// Then: OUT_DIR=/tmp/proj-after tools/run-playwright.sh tools/verify_proj_layers.mjs
//       and diff the two directories.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";

const OUT_DIR = process.env.OUT_DIR || "/tmp/proj-layers";
const PORT = Number(process.env.PORT || 8763);
// Sampled as FRACTIONS of each pack's own authored duration, not as fixed tick numbers: the
// packs run for anywhere between a few ticks and a hundred, so one global tick list lands
// outside most of them and captures an empty arena, which then compares equal for the wrong
// reason.
const FRACTIONS = (process.env.FRACTIONS || "0.2,0.45,0.75").split(",").map(Number);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css" };

// Pick the packs where the two fixes actually change something, straight from the shipped
// data so the list cannot drift from what is on disk:
//   - `nested`  : has at least one non-root parent   -> exercises the hierarchy fix
//   - `multiAxis`: has a layer with >=2 nonzero rotation axes -> exercises the axis order
// Plus pack 39, Armormon's basic attack, which has NEITHER and must therefore be unchanged
// — a control that catches an over-broad "fix".
const MANIFEST = JSON.parse(fs.readFileSync("web/assets/battle/effects/manifest.json", "utf8"));
// Sample against the CLIP length, which is the real lifetime, falling back to the authored
// keyframe span for a pack whose clip did not decode.
const durOf = (id) => MANIFEST.projectiles?.[String(id)]?.ticks
                   || MANIFEST.projectiles?.[String(id)]?.dur || 0;
const clipOf = (id) => MANIFEST.projectiles?.[String(id)]?.clip || null;
const lastFrameOf = (id) => {
  const c = clipOf(id);
  return c ? Math.max(...c.segments.map(([f, n]) => f + n - 1)) : 0;
};
// Packs whose clip REPLAYS a segment: the sustained beams. A raw tick could never revisit a
// frame, so these change the most.
const replays = (id) => {
  const c = clipOf(id);
  if (!c) return false;
  const starts = c.segments.map(([f]) => f);
  return starts.some((f, i) => i > 0 && f <= starts[i - 1]);
};

function pickPacks() {
  const dir = "web/assets/battle/effects/proj";
  const nested = [], multiAxis = [], both = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const id = Number(path.basename(f, ".json"));
    const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
    const hasParent = j.layers.some((L) => L.parent > 0);
    const hasMulti = j.layers.some((L) => (L.tracks?.r ?? [])
      .some((k) => [k[1], k[2], k[3]].filter((v) => v !== 0).length >= 2));
    if (durOf(id) < 8) continue;              // too short to sample meaningfully
    if (hasParent && hasMulti) both.push(id);
    else if (hasParent) nested.push(id);
    else if (hasMulti) multiAxis.push(id);
  }
  const take = (a, n) => a.sort((x, y) => x - y).slice(0, n);
  const ids = Object.keys(MANIFEST.projectiles || {}).map(Number);
  const replayed = ids.filter(replays).sort((a, b) => a - b);
  // Packs whose clip outlives, or is outlived by, the authored keyframes: these are the ones
  // whose lifetime changes.
  const relifed = take(ids.filter((id) => lastFrameOf(id) !== (MANIFEST.projectiles[id]?.dur ?? 0)
                                          && !replays(id)), 3);
  return { both: take(both, 4), nested: take(nested, 3), multiAxis: take(multiAxis, 3),
           replayed, relifed };
}

const picks = pickPacks();
const CASES = [
  ...picks.both.map((id) => ({ id, why: "nested + multi-axis" })),
  ...picks.nested.map((id) => ({ id, why: "nested only" })),
  ...picks.multiAxis.map((id) => ({ id, why: "multi-axis only" })),
  ...picks.replayed.map((id) => ({ id, why: "REPLAYED clip segment (sustained beam)" })),
  ...picks.relifed.map((id) => ({ id, why: "clip length differs from authored keyframes" })),
  { id: 39, why: "CONTROL: Armormon basic attack, flat + single-axis, must not change" },
];

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
const page = await browser.newPage({ viewport: { width: 1400, height: 760 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// Ignore resource 404s: the lab asks for a per-model slot_map.json that not every pack
// ships, which is pre-existing and unrelated to the projectile path.
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("Failed to load resource")) errors.push(m.text());
});

await page.goto(`http://127.0.0.1:${PORT}/battle-lab.html`, { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.__r, null, { timeout: 30000 });
// Let the models and arena finish loading, then STOP the lab's animation loop. It calls
// render() on every animation frame, which would advance past the tick we pin and overwrite
// the frame before it can be read.
await page.waitForTimeout(3000);
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

// Make the frame deterministic, so a byte comparison between two runs measures the
// projectile and nothing else. The lab defaults to the idle-director camera and both
// Digimon bob on an accumulating clock, so the number of animation frames that happened
// before the freeze — which varies run to run — would otherwise change every pixel.
await page.evaluate(() => {
  window.__r.setCameraMode("game");     // the real PS1 fixed camera: no time term
  window.__r.setPlayerVisible(false);   // the bobbing actors are not what is under test
  window.__r.setEnemyVisible(false);
});

// Self-check: the same case captured twice must be byte-identical, or the comparison at the
// end is measuring scene noise rather than the projectile. Fail loudly instead of reporting
// a difference that means nothing.
await page.waitForFunction(() => window.__r.debugProjectileReady(39), null,
                           { timeout: 20000, polling: 200 });
const twice = [];
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => window.__r.debugRenderProjectileAt(39, 18));
  const u = await page.evaluate(() => window.__r.debugCaptureFrame());
  twice.push(crypto.createHash("sha256").update(u).digest("hex"));
}
if (twice[0] !== twice[1]) {
  console.error("NOT DETERMINISTIC: the same tick rendered twice gave different frames.");
  await browser.close(); server.close();
  process.exit(1);
}
console.log("determinism self-check: two renders of pack 39 @ t=18 are identical");

const rows = [];
let blank = 0;
for (const c of CASES) {
  // Wait for the pack's geometry AND its atlas: a capture taken before they resolve is an
  // empty frame, which would silently read as "no change".
  // Timer polling, not the default animation-frame polling: the lab's frame loop is frozen
  // above by stubbing requestAnimationFrame, so rAF-based polling would never fire.
  const ready = await page.waitForFunction(
    (id) => window.__r.debugProjectileReady(id), c.id, { timeout: 20000, polling: 200 },
  ).then(() => true).catch(() => false);
  if (!ready) { rows.push({ ...c, tick: null, status: "PACK NEVER LOADED" }); continue; }

  const ticks = FRACTIONS.map((f) => Math.max(1, Math.round(durOf(c.id) * f)));
  for (const tick of ticks) {
    const ok = await page.evaluate(
      ([id, t]) => window.__r.debugRenderProjectileAt(id, t), [c.id, tick],
    );
    if (!ok) { rows.push({ ...c, tick, status: "SPAWN REFUSED" }); continue; }
    const url = await page.evaluate(() => window.__r.debugCaptureFrame());
    const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const name = `proj${String(c.id).padStart(3, "0")}_t${String(tick).padStart(2, "0")}.png`;
    fs.writeFileSync(path.join(OUT_DIR, name), buf);
    const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
    if (buf.length < 2000) blank++;
    rows.push({ ...c, tick, name, sha, bytes: buf.length, status: "captured" });
  }
}

await browser.close();
server.close();

const manifest = { out: OUT_DIR, fractions: FRACTIONS, picks, rows };
fs.writeFileSync(path.join(OUT_DIR, "captures.json"), JSON.stringify(manifest, null, 2));

console.log(`\ncaptures -> ${OUT_DIR}  (ticks = ${FRACTIONS.join("/")} of each pack's dur)`);
console.log(`packs: nested+multi ${picks.both.join(",")} | nested ${picks.nested.join(",")} | ` +
            `multi ${picks.multiAxis.join(",")} | replayed ${picks.replayed.join(",")} | ` +
            `re-lifed ${picks.relifed.join(",")} | control 39`);
for (const r of rows) {
  console.log(`  ${String(r.id).padStart(3)} t=${String(r.tick ?? "-").padStart(2)} ` +
              `${(r.sha ?? "").padEnd(16)} ${r.status.padEnd(6)} ${r.why}`);
}
console.log(`\n${rows.length} captures, ${blank} blank, ${errors.length} page errors`);
for (const e of errors.slice(0, 10)) console.log(`  ERROR ${e}`);
if (errors.length) process.exitCode = 1;
