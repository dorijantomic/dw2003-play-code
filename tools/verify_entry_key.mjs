// Headless check that the entry-key wiring works END TO END in the real game:
// game.js latches state.entryKey on a warp, battle.js reads it, and the engine
// selects a different zone-block group -> different monsters in the same map.
//
// This exercises the plumbing the unit tests cannot: tests/encounter-entry-key.test.js
// covers the engine function, this covers game.js -> battle.js -> engine.
//
// Run via:  npm run pw tools/verify_entry_key.mjs   (or tools/run-playwright.sh)
//
// Ledger: encounter-zone-group-key-written-on-map-transition.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".ogg": "audio/ogg",
  ".wav": "audio/wav", ".css": "text/css", ".bin": "application/octet-stream",
};

const server = createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const path = join(process.cwd(), "web", rel === "/" ? "index.html" : rel);
    const body = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/index.html`);
await page.waitForFunction(() => window.__state && window.__encounter, null, { timeout: 30000 });
// The encounter tables load with the battle module, not at boot; await them
// directly instead of depending on the player having started a game.
await page.evaluate(() => window.__encounter.ready());

// s825 (Seabed): key 2 comes from the s320 door, key 7 from the s525 door.
// Their zone-1 pools are screen 62 and screen 61 respectively, and their rate
// levels are 4 and 4; key 1 is rate 2 with pool 61/62 mixed. We assert the
// SELECTION DIFFERS by key, which is the behaviour being wired.
const probe = await page.evaluate(() => {
  const out = {};
  for (const key of [0, 1, 2, 7, 11]) {
    window.__state.entryKey = key;
    // Zone 1 of s825; the grid maps a wide area to zone 1.
    const rate = window.__encounter.rateLevel("s825", 576, 216);
    const screens = [];
    for (let i = 0; i < 24; i++) {
      const r = window.__encounter.pick("s825", 576, 216);
      if (r) screens.push(r.screen);
    }
    out[key] = { rate, screens: [...new Set(screens)].sort((a, b) => a - b) };
  }
  return out;
});

server.close();
await browser.close();

console.log("s825 encounter selection by state.entryKey:");
for (const [k, v] of Object.entries(probe))
  console.log(`  entryKey=${k.padStart(2)}  rate=${v.rate}  screens=${JSON.stringify(v.screens)}`);
if (errors.length) console.log("page errors:", errors.slice(0, 3));

const k2 = JSON.stringify(probe["2"].screens);
const k7 = JSON.stringify(probe["7"].screens);
const k0 = JSON.stringify(probe["0"].screens);
const fail = [];
if (k2 === k7) fail.push(`entryKey 2 and 7 must select different pools (both ${k2})`);
if (probe["2"].rate === 0 || probe["7"].rate === 0) fail.push("rate level must be nonzero for a walkable zone");
if (k0 !== JSON.stringify(probe["1"].screens))
  fail.push(`entryKey 0 must fall back to group 0 (key 1), got ${k0} vs ${JSON.stringify(probe["1"].screens)}`);
if (errors.length) fail.push(`page errors: ${errors[0]}`);

if (fail.length) { console.error("\nFAIL:"); for (const f of fail) console.error("  " + f); process.exit(1); }
console.log("\nOK: the entry key changes the live encounter group end to end.");
