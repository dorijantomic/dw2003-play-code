// Repro: ordinary boot → language → title → New Game → opening.
// Drives real held-pad input; captures every distinct screen state.
// Run: tools/run-playwright.sh tools/repro_opening_tmp.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.ROOT || `${baseUrl(8742)}`;
const OUT = process.argv[2] || "/tmp/opencode/repro-opening";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 576 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
});

let step = 0;
const seen = new Set();
const shot = async (name) => {
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot());
  console.log("shot", name);
};

const snap = () => page.evaluate(() => ({
  started: !!window.__state?.started,
  map: window.__state?.manifest?.maps?.[window.__state.mapIdx]?.id ?? null,
  titleHidden: document.getElementById("title-screen")?.hidden ?? null,
  titleNative: document.getElementById("title-screen")?.classList?.contains("native") ?? null,
  titleDiag: window.__titleState ? (() => { try { return window.__titleState().diagnostics?.() ?? null; } catch { return null; } })() : null,
  packSelect: !!window.__state?.packSelect,
  packDiag: window.__packSelectNative?.diagnostics?.() ?? null,
  nameEntry: !!window.__state?.nameEntry,
  nameOpen: window.__nameEntryNative?.isOpen?.() ?? null,
  nameDiag: window.__nameEntryNative?.diagnostics?.() ?? null,
  nameVal: (() => { const ne = window.__state?.nameEntry; return ne ? { v: ne.value?.(), cell: ne.currentCell?.() } : null; })(),
  cut: window.__cutscene?.isActive?.() ?? false,
  tb: window.__textbox?.isOpen?.() ?? false,
  bootLang: window.__bootLanguage ?? null,
  nativeObjs: (window.__nativeScreenObjects?.() ?? []).map((o) => ({
    cb: "0x" + (o.cb >>> 0).toString(16),
    sub: window.__nativeScreenRead?.(o.addr + 0x10, 4) ?? null,
    lc: window.__nativeScreenRead?.(o.addr + 0xc, 4) ?? null,
  })),
}));

const press = async (key, ms = 150) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(100);
};

const record = async (label) => {
  const s = await snap();
  const key = JSON.stringify({
    pack: s.packSelect, name: s.nameEntry, nameOpen: s.nameOpen, map: s.map,
    cut: s.cut, tb: s.tb, titleHidden: s.titleHidden, boot: !!s.bootLang,
    objs: s.nativeObjs.map((o) => o.cb + ":" + o.sub),
    nameCell: s.nameVal?.cell ?? null,
  });
  if (!seen.has(key)) {
    seen.add(key);
    const n = String(++step).padStart(2, "0");
    await shot(`${n}-${label ?? "state"}`);
    writeFileSync(`${OUT}/${n}-${label ?? "state"}.json`, JSON.stringify(s, null, 2));
    console.log(`STEP ${n} ${label}`, JSON.stringify({
      started: s.started, map: s.map, titleHidden: s.titleHidden, boot: s.bootLang,
      pack: s.packSelect, name: s.nameEntry, nameOpen: s.nameOpen, nameCell: s.nameVal?.cell,
      cut: s.cut, tb: s.tb,
      packHost: s.packDiag?.host?.module, packPending: s.packDiag?.pending,
      nameHost: s.nameDiag?.host?.module, namePending: s.nameDiag?.pending,
      objs: s.nativeObjs,
    }));
  }
  return s;
};

try {
  await page.goto(ROOT + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3000);
  await record("boot");

  // Phase A: language screen → title. The container is unhidden before the
  // language screen draws, so watch __bootLanguage instead.
  for (let i = 0; i < 12; i++) {
    const s = await snap();
    if (s.bootLang != null) break;
    await press("Enter", 300);
    await record("language");
  }
  await page.waitForTimeout(1500);
  await record("title");

  // Phase B: title — `i` is START, default highlight is Continue, Up picks
  // Start, Circle confirms (tools/verify_native_title.mjs contract).
  await page.waitForFunction(
    () => (window.__titleState?.().diagnostics?.()?.host?.frames ?? 0) >= 240,
    null, { timeout: 40000 },
  ).catch(() => {});
  await press("i", 160);
  await page.waitForTimeout(600);
  await record("title-menu");
  await press("ArrowUp", 140);
  await page.waitForTimeout(300);
  await press("Enter", 160);
  await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await record("after-title");

  // Phase C: opening — pump confirm through cutscene text at speed.
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 90000;
  let last = 0;
  while (Date.now() < deadline) {
    const s = await record("tick");
    if (s.packSelect || s.nameEntry) break;
    if (s.cut || s.tb) await press("Enter", 100);
    if (Date.now() - last > 5000) {
      last = Date.now();
      console.log("progress", JSON.stringify({ started: s.started, map: s.map, cut: s.cut, tb: s.tb, pack: s.packSelect, name: s.nameEntry }));
    }
    await page.waitForTimeout(60);
  }

  // Phase D: the wizard / name screen — slow down and capture animation frames.
  {
    let s = await snap();
    if (s.packSelect || s.nameEntry) {
      await page.evaluate(() => { window.__gameSpeed = 1; });
      for (let i = 0; i < 16; i++) { await record("hold"); await page.waitForTimeout(450); }
      // Drive like a player: confirm through steps.
      for (let i = 0; i < 40; i++) {
        s = await snap();
        if (!s.packSelect && !s.nameEntry) break;
        if (s.tb) await press("Enter", 150);
        else await press("Enter", 200);
        await record("drive");
      }
      await page.evaluate(() => { window.__gameSpeed = 8; });
    }
  }

  // Phase E: continue through whatever follows (handoff → name entry?).
  const end = Date.now() + 45000;
  let last2 = 0;
  while (Date.now() < end) {
    const s = await record("tail");
    if (s.cut || s.tb) await press("Enter", 100);
    if (Date.now() - last2 > 5000) {
      last2 = Date.now();
      console.log("tail", JSON.stringify({ map: s.map, cut: s.cut, tb: s.tb, pack: s.packSelect, name: s.nameEntry }));
    }
    await page.waitForTimeout(60);
  }
  await record("end");
  writeFileSync(`${OUT}/errors.json`, JSON.stringify(errors, null, 2));
  console.log("RESULT", JSON.stringify({ errors: errors.length, steps: step }));
} catch (e) {
  console.error("FATAL", e);
  try { await record("fatal"); } catch {}
} finally {
  await browser.close();
}
