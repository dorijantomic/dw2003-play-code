import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

// Plan 6.3 form flow: the Change-digivolve-type grid confirm writes the equipped
// triple through set_equipped (claim party-c-seteqipped-confirm-writes-triple-
// 2026-09-13). A form already in the triple is rejected before that write, and
// the grid never touches the standing form -- that is the separate Digivolve
// row. Cancel writes nothing.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/verify_dri_change_type.mjs
const BASE = process.env.DRI_URL || `${baseUrl(8741)}/?skipTitle=1&map=s245&noEncounters=1&legacyDri=1`;
const OUT = process.env.DRI_SHOT || "/tmp/dri-change-type";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.error("PAGEERROR", e));
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
});
await page.goto(BASE);
await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
await page.waitForFunction(() => window.__dri && Object.keys(window.__dri.digimonById ?? {}).length > 0,
  null, { timeout: 30_000 });

// Fixture: three equipped slots with the third free, four acquired forms.
// pool order = acquired ledger order [9, 10, 11, 12], then the starter row.
async function reset() {
  return page.evaluate(() => {
    const s = window.__state;
    s.party = ["p003pken", "p009rena", "p010pata"];
    s.partyStats = [null, null, null];
    s.partnerStats = {
      digimonId: 1, level: 30, hp: 500, maxHp: 500, mp: 200, maxMp: 200,
      bonuses: {}, elemBonuses: {},
      equippedForms: [9, 10, 0],
      formLedger: [9, 10, 11, 12].map((id) => ({ id, formLevel: 10, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] })),
    };
    s.partyStats[0] = s.partnerStats;
    localStorage.setItem("partnerStats", JSON.stringify(s.partnerStats));
    const d = window.__dri;
    d.openState("change_type", s, null);
    d.cursor = 0; d.page = 0;
    return { standing: s.partnerStats.digimonId, equipped: [...s.partnerStats.equippedForms] };
  });
}
const read = () => page.evaluate(() => ({
  screen: window.__dri.screen,
  feedback: window.__dri.feedback,
  standing: window.__state.partnerStats.digimonId,
  equipped: [...window.__state.partnerStats.equippedForms],
  stored: JSON.parse(localStorage.getItem("partnerStats")).equippedForms,
}));
// Logical button NAMES, not keys: web/dri.js confirms on word bit 0x2000 ("circle")
// and cancels on 0x4000 ("cross") since 173ebcf0.
const press = (k) => page.evaluate((kk) => window.__dri.handleKey(kk), k);

const results = {};
try {
  // A. Selecting a form already in the triple is rejected with no write.
  results.aStart = await reset();
  results.aBefore = await read();
  await page.evaluate(() => { window.__dri.cursor = 1; });   // pool[1] = acquired 10, equipped slot 1
  await press("circle");
  results.aAfter = await read();

  // B. Selecting an acquired form into the free slot writes the triple.
  results.bStart = await reset();
  results.bBefore = await read();
  await page.evaluate(() => { window.__dri.cursor = 2; });   // pool[2] = acquired 11
  await press("circle");
  results.bAfter = await read();
  await writeFileSync(`${OUT}/change-type-after-confirm.png`,
    Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

  // C. Cancel leaves the triple and the store untouched.
  results.cStart = await reset();
  results.cBefore = await read();
  await page.evaluate(() => { window.__dri.cursor = 2; });
  await press("cross");
  results.cAfter = await read();
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A
assert(results.aAfter.screen === "change_type", `duplicate left the grid: ${results.aAfter.screen}`);
assert(eq(results.aAfter.equipped, [9, 10, 0]) && results.aAfter.standing === 1,
  `duplicate changed state: ${JSON.stringify(results.aAfter)}`);
assert(eq(results.aAfter.stored, [9, 10, 0]), `duplicate persisted a write: ${JSON.stringify(results.aAfter.stored)}`);
// B
assert(eq(results.bAfter.equipped, [9, 10, 11]),
  `free-slot confirm did not write the triple: ${JSON.stringify(results.bAfter.equipped)}`);
assert(eq(results.bAfter.stored, [9, 10, 11]),
  `free-slot confirm did not persist: ${JSON.stringify(results.bAfter.stored)}`);
assert(results.bAfter.standing === 1, `the grid changed the standing form: ${results.bAfter.standing}`);
// C
assert(results.cAfter.screen !== "change_type", `cancel stayed on the grid: ${results.cAfter.screen}`);
assert(eq(results.cAfter.equipped, [9, 10, 0]) && eq(results.cAfter.stored, [9, 10, 0]) && results.cAfter.standing === 1,
  `cancel changed state: ${JSON.stringify(results.cAfter)}`);
console.log(JSON.stringify({ ok: true, results }, null, 2));
