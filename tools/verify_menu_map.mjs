// Headless screenshot verifier for the translated pause-menu MAP page.
// Route: the shipped first pause list (translated code), START in the field,
// Down x2 onto MAP, confirm. Compares against the rig capture (Suzaku City save:
// screen 0x23E, ordinal 0xA -> tier 2, southwest visited) — see
// docs/research/ui/status-menu-chrome-decompiled-2026-07-10.md §MAP.
// Usage: tools/run-playwright.sh tools/verify_menu_map.mjs [outdir]
// Requires: python3 -m http.server <port> --directory web
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/menumap";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
// A fresh profile would stop on the visual-style chooser and dim the page behind it.
await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
await page.goto(`${baseUrl(8741)}/?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 60000 });

const press = async (key, ms = 120) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(160);
};
const entry = () => page.evaluate(() => window.__status?.diagnostics?.().entry ?? null);
const waitEntry = (want) => page.waitForFunction(
  (w) => window.__status?.diagnostics?.().entry === w, want, { timeout: 30000 });
// The list is only reading the pad once its state word reaches 3.
const homeReady = () => page.waitForFunction(() => {
  const s = window.__status?._session;
  return window.__status?.diagnostics?.().entry === "home" && s && s.mem.read32(s.root + 0x10) === 3;
}, null, { timeout: 30000 });
const shot = async (name, wait = 700) => {
  await page.waitForTimeout(wait);
  await page.locator("canvas#game").screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};

// The default Asuka fixture can still be playing its scripted opening; settle it so
// START reaches the field input path (as tools/verify_translated_pause_home.mjs does).
await page.evaluate(async () => {
  if (window.__cutscene?.isActive?.()) {
    window.__cutscene.start([], null, null);
    window.__cutscene.step(1);
  }
  const s = window.__state;
  // s505 (Suzaku City) = Asuka server (screen 0x23F < 0x270). Ordinal 10 -> tier 2.
  const idx = s.manifest.maps.findIndex((m) => m.id === "s505");
  if (idx >= 0) s.mapIdx = idx;
  s.progressOrdinal = 10;
  // Revealed places: the bits the field entry writes on arrival, written through the
  // engine's own store — the MAP page reads 0x2000|(ps1 & 0xff) out of it. A spread of
  // Asuka-server places so several location markers reveal (Suzaku's sector, the four
  // capital cities and others).
  const table = await (await fetch("assets/data/screen_table.json")).json();
  const screenOf = (stage) => {
    for (const [id, row] of Object.entries(table)) {
      if (row.stage === stage || row.alt?.stage === stage) return Number(id);
    }
    return null;
  };
  for (const stage of [505, 500, 520, 525, 200, 205, 210, 350, 400, 450, 300, 250, 230, 240]) {
    const id = screenOf(stage);
    if (id != null) window.__engine.state.flags.set(0x1e00 + id, true);
  }
});

// START in the field opens the first pause list; Down x2 walks ITEMS -> SORT -> MAP;
// `c` is the walker's keyboard stand-in for the pad's confirm button (Enter stands for
// Circle in web/input.js KEYBOARD_BINDINGS).
await press("i");
await waitEntry("home");
await homeReady();
await page.waitForTimeout(900);
await press("ArrowDown");
await press("ArrowDown");
await press("c");
await waitEntry("map");
console.log("map page open:", await entry());
await page.waitForFunction(() => {
  const s = window.__status?._session;
  return s && s.mem.read32(s.pageObject() + 0x16c) !== 0;
}, null, { timeout: 30000 });
await shot("map0_open", 1200);
// pan to the top-left corner (scroll limits) — hover ring should drop
for (let i = 0; i < 60; i++) await press("ArrowLeft", 60);
for (let i = 0; i < 60; i++) await press("ArrowUp", 60);
await shot("map1_topleft", 500);
// pan back to bottom-right
for (let i = 0; i < 80; i++) await press("ArrowRight", 60);
for (let i = 0; i < 80; i++) await press("ArrowDown", 60);
await shot("map2_bottomright", 500);

await browser.close();
console.log("done ->", out);