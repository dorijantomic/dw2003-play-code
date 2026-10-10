// Playtest 2026-10-07 item 18 capture: a digivolution's learned techniques, as
// the DRI "Load technique" screen shows them for one acquired form. Run it on
// the build BEFORE the tech-gate fix and again after; the signature row that
// appears far too early is the difference.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/capture_digivolution_tech_gate.mjs <out-dir> [dvexp]
//
// Fixture: a Dinohumon (form id 9) at form ("Skill LV") level 25, seeded the way
// an ordinary save carries it -- only the DVEXP bank, so the DRI derives the
// form-ledger record through the production migration path (dri-model.js
// ensureFormLedger). Every step after the seed is an ordinary button through the
// game's own key handler, exactly as tools/verify_dri_tech_load.mjs does.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || "/tmp/digivolution-tech-gate";
const DVEXP = Number(process.argv[3] ?? 245);   // 245 -> form level 25 (1 + floor(245/10))
const FORM = 9;                                  // Dinohumon
const BASE = process.env.DRI_URL || `${baseUrl(8741)}/?skipTitle=1&noEncounters=1&legacyDri=1`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.error("PAGEERROR", e));

const waitScreen = (screen) =>
  page.waitForFunction((s) => window.__dri?.screen === s, screen, { timeout: 15_000 });
const waitMenuOpen = () =>
  page.waitForFunction(() => window.__dri.screen === "digivolve_menu"
    && (!window.__dri.folds || Object.values(window.__dri.folds).every((f) => !f.active)),
    null, { timeout: 5_000 });
const shot = async (name) =>
  writeFileSync(`${OUT}/${name}.png`,
    Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

const results = {};
try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });

  // Seed: a Dinohumon with a DVEXP bank but no ledger record yet, so opening the
  // DRI derives the record through the walker's own migration path.
  await page.evaluate(({ form, dvexp }) => {
    const s = window.__state;
    s.party = ["p003pken", "p009rena", "p010pata"];
    s.partyStats = [null, null, null];
    s.partnerStats = {
      digimonId: form, level: 40, hp: 999, maxHp: 999, mp: 999, maxMp: 999,
      bonuses: {}, elemBonuses: {}, equippedForms: [form], dvexpByForm: { [form]: dvexp },
    };
    s.partyStats[0] = s.partnerStats;
    s.digimonNames = {};
  }, { form: FORM, dvexp: DVEXP });

  await page.evaluate(() => window.__labOpen("dri"));
  await page.locator("canvas#game").click({ position: { x: 160, y: 200 } });
  await waitScreen("root");

  // Derive the form-ledger record through the walker's own migration path
  // (dri-model.js ensureFormLedger) from the DVEXP bank, exactly as the DRI does
  // for a save that predates the ledger, and read what it produced.
  results.derived = await page.evaluate(async ({ form }) => {
    const m = await import("./dri-model.js");
    const st = window.__state.partnerStats;
    m.ensureFormLedger(st, window.__dri.digimonById);
    const rec = (st.formLedger ?? []).find((r) => Number(r.id) === form);
    return rec ? { formLevel: rec.formLevel, techSlots: rec.techSlots.map((w) => w & 0xffff) } : null;
  }, { form: FORM });

  // Root -> Digivolve -> picker -> Select Action -> "Load technique." -> rows.
  await page.keyboard.press("s");
  await page.keyboard.press("c");
  await waitScreen("digivolve_picker");
  await page.keyboard.press("c");
  await waitScreen("digivolve_menu");
  await waitMenuOpen();
  await page.keyboard.press("s");               // row 0 -> row 1 "Load technique."
  await page.keyboard.press("c");
  await waitScreen("load_tech");
  // The load_tech rows the screen itself draws: the record's six slots filtered
  // to the ones carrying a technique (dri.js load_tech branch).
  const readRows = () => page.evaluate((form) => {
    const rec = (window.__state.partnerStats.formLedger ?? []).find((r) => Number(r.id) === form);
    return (rec?.techSlots ?? []).map((w, slot) => ({ slot, word: w & 0xffff })).filter((r) => r.word & 0x1fff);
  }, FORM);
  results.loadTechRows = await readRows();
  await shot("load-tech-top");
  // The window draws three rows, so walk the cursor to the bottom to reveal the
  // last learned row (the signature, when the bug is present). Extra presses clamp.
  for (let i = 0; i < 4; i++) { await page.keyboard.press("s"); }
  await shot("load-tech-bottom");
  results.cursor = await page.evaluate(() => window.__dri.cursor);
} finally {
  await browser.close();
}
console.log(JSON.stringify({ ok: true, dvexp: DVEXP, results }, null, 2));
