// A new partner's field sprite in the game: DemiDevimon leading the party on Asuka's streets, walking
// in each direction. Screenshots for the eye; fails on page errors or a sprite that never loaded.
//
// Server: python3 -m http.server <port> --directory web (VERIFY_PORT)
// Run:    tools/run-playwright.sh tools/verify_partner_sprite.mjs [outdir] [charId]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/partner-sprite";
const CHAR = process.argv[3] ?? "x191demi";
const ID = { x191demi: 191, x192beta: 192, x193hagu: 193 }[CHAR];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
const errors = [];
const sheetReqs = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => { if (r.url().includes(`extra_partners/${CHAR}`)) sheetReqs.push(r.status()); });
const member = (digimonId) => ({ digimonId, level: 5, xp: 0, tp: 10, hp: 200, maxHp: 200, mp: 100, maxMp: 100, bonuses: {}, elemBonuses: {} });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("psFixture")) return;
  sessionStorage.setItem("psFixture", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
  localStorage.setItem("charId", seed.char);
  localStorage.setItem("party", JSON.stringify([seed.char]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.m));
  localStorage.setItem("partyStats", JSON.stringify([seed.m]));
  localStorage.setItem("equipment", JSON.stringify([{}]));
}, { char: CHAR, m: member(ID) });
await page.goto(`${baseUrl(8770)}/?skipTitle=1&map=s245&noEncounters=1`);
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));
await shot("0-standing");
for (const [k, n] of [["ArrowDown", "1-down"], ["ArrowLeft", "2-left"], ["ArrowUp", "3-up"], ["ArrowRight", "4-right"]]) {
  await page.keyboard.down(k);
  await page.waitForTimeout(700);
  await shot(n);
  await page.keyboard.up(k);
  await page.waitForTimeout(200);
}
const party = await page.evaluate(() => window.__state.party);
await browser.close();
console.log(`party=${JSON.stringify(party)} sheet=${JSON.stringify(sheetReqs)} errors=${errors.length ? errors.join(" | ") : "none"}`);
process.exit(errors.length || !sheetReqs.includes(200) ? 1 : 0);
