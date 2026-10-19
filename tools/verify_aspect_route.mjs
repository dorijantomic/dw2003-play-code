// An element route unlocks a form in the real game: a Kotemon with weak stats (so no stat gate can pass) and exactly one form
// left to learn wins a fight; the form is learned only when its element gate is met.
//
// Four cases (docs/aspect-system-plan.md, 2.1b). Measured 2026-10-19 on the aspect build: control false, below false, full true, minus-base false.
//   control    trained points 0                       -> must not learn (the stat route is out of reach)
//   below      trained points = the record's gate - 1 -> must not learn
//   full       trained points = the record's gate     -> must learn
//   minus-base trained points = gate - the line's own base tolerance -> learns only if the live game counts base + trained
//              (it does not: the live game counts the trained points only, so the gate carries no base)
//
// Needs a served web/ tree whose extra_species.json is the ASPECT build (scratch copy, see the notes at the end of this file).
//   ASPECT_EXTRA=/path/extra_species.json CASE=full VERIFY_PORT=8792 tools/run-playwright.sh tools/verify_aspect_route.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(8792)}/`;
const CASE = process.env.CASE || "full";
const extra = JSON.parse(readFileSync(process.env.ASPECT_EXTRA, "utf8"));
const digimon = JSON.parse(readFileSync("web/assets/data/digimon.json", "utf8")).digimon;
const ELEMS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const partnerIds = new Set((extra.starters ?? []).map((p) => p.id));
const extraIds = extra.digimon.map((d) => d.id).filter((id) => !partnerIds.has(id));

// the target: on line 0 (Kotemon), the easiest element record whose prerequisites are all of the disc's 44 forms.
// TARGET=disc probes one of the DISC's own element gates instead (the original forms). Measured 2026-10-19 on SkullGreymon (Dark 140,
// Kotemon's base 95): control false, 139 false, 140 true, 140-minus-base false: the live game counts trained points only there too.
const DISC = process.env.TARGET === "disc";
const discRecords = JSON.parse(readFileSync("web/assets/data/evolutions.json", "utf8")).lines[0].records.slice(0, 44);
const line = DISC ? discRecords : extra.tree["0"];
const target = line.filter((r) => r.kind >= 8 && r.req0 >= 9 && r.req0 <= 52 && (!r.req1 || (r.req1 >= 9 && r.req1 <= 52)))
  .sort((a, b) => a.threshold - b.threshold)[0];
const name = (DISC ? digimon : extra.digimon).find((d) => d.id === target.to).name;
const element = ELEMS[target.kind - 8];
const ownBase = digimon[0].resistances[element];
const trained = { control: 0, below: target.threshold - 1, full: target.threshold }[CASE] ?? target.threshold - ownBase;   // minus-base: the scale probe
console.log(`target ${name} (id ${target.to}): ${element} gate ${target.threshold}, Kotemon's own base ${ownBase}; case ${CASE}: trained points ${trained}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); });

await page.addInitScript(({ extraIds, targetId, element, trained }) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("xlFixture")) return;
  sessionStorage.setItem("xlFixture", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  // the 44 disc forms and every extra form except the target are already learned, at the top form level
  const ledger = [...Array.from({ length: 44 }, (_, i) => 9 + i).filter((id) => id !== targetId), ...extraIds.filter((id) => id !== targetId)]
    .map((id) => ({ id, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }));
  const member = (digimonId, level, formLedger, equippedForms) => ({
    digimonId, level, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300,
    // weak stats: no stat gate can pass, so only the element route can
    stats: { str: 20, def: 20, spt: 20, wis: 20, spd: 20, chr: 100 }, bonuses: {}, elemBonuses: trained ? { [element]: trained } : {}, formLedger, equippedForms,
  });
  const lead = member(1, 40, ledger, [9, 10, 11]);
  localStorage.setItem("partnerStats", JSON.stringify(lead));
  localStorage.setItem("partyStats", JSON.stringify([lead, member(7, 10, [], []), member(8, 10, [], [])]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, { extraIds, targetId: target.to, element, trained });

const press = async (k, ms = 600) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); await page.waitForTimeout(80); };
const ledgerIds = () => page.evaluate(() => (window.__state.partnerStats?.formLedger ?? []).map((e) => e.id));
let learned = false;
try {
  await page.goto(ROOT + "?skipTitle=1&map=s245&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  const before = await ledgerIds();
  if (before.includes(target.to)) throw new Error("fixture: the target is already learned");
  await page.evaluate(async () => {
    await window.__battle.start({ enemyId: 1, enemyLevel: 1, screenId: 200, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
  });
  await waitForCommandMenu(page);
  await page.evaluate(() => { window.__battleB().enemy.hp = 1; });
  await press("Enter", 90);
  let guard = 0;
  while (await page.evaluate(() => window.__battleB?.()?.state) !== 8 && guard++ < 40) { await press("Enter", 90); await page.waitForTimeout(400); }
  await page.waitForFunction(() => window.__battleB?.()?._victoryPhase === "report", null, { timeout: 40_000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 25 && (await page.evaluate(() => !!window.__battle?.isActive?.())); i++) await press("Enter", 600);
  await page.waitForFunction(() => !window.__battle?.isActive?.(), null, { timeout: 30_000 });
  learned = (await ledgerIds()).includes(target.to);
} catch (error) {
  console.error("ERROR", error.message);
  process.exitCode = 2;
} finally {
  await browser.close();
}
console.log(`RESULT case=${CASE} learned=${learned} pageErrors=${errors.length}`);

// Notes: serve a scratch copy of web/ whose assets/data/extra_species.json (and extra_profiles.bin) are the aspect build:
//   ASPECT_ROUTES=1 EXTRA_SPECIES_OUT=$HOME/aspect_out python3 tools/build_extra_species.py
//   mkdir -p $HOME/aspect_web && ln -sfn $PWD/web/* $HOME/aspect_web/ && rm $HOME/aspect_web/assets
//   mkdir -p $HOME/aspect_web/assets && ln -sfn $PWD/web/assets/* $HOME/aspect_web/assets/ && rm $HOME/aspect_web/assets/data
//   mkdir -p $HOME/aspect_web/assets/data && ln -sfn $PWD/web/assets/data/* $HOME/aspect_web/assets/data/
//   cp $HOME/aspect_out/extra_* $HOME/aspect_web/assets/data/   (replaces the links with the aspect files)
//   python3 -m http.server 8792 --directory $HOME/aspect_web
