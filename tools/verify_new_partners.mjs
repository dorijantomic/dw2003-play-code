import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { loadFromCard, openContinueCard, saveToCard, press } from "./memcard-continue.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

// The three new partners (data/authored/web/assets/data/new_starters.json): once a party exists they wait
// in the Digimon Lab's Switch screen. Switch DemiDevimon in, fight with it, save to the card and load it back.
//
// Server: python3 -m http.server <port> --directory web (VERIFY_PORT)
// Run:    tools/run-playwright.sh tools/verify_new_partners.mjs [outdir]
const ROOT = `${baseUrl(8770)}/`;
const BASE = ROOT + "?skipTitle=1&map=s245&noEncounters=1";
const TITLE = ROOT + "?skipLanguage=1&noEncounters=1";
const OUT = process.argv[2] ?? "/tmp/new-partners";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 }, bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1500 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const modelReqs = [];
page.on("response", (r) => { if (/pdev|m217/i.test(r.url())) modelReqs.push(`${r.status()} ${r.url().replace(/^.*\/assets\//, "")}`); });
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("npFixture")) return;
  sessionStorage.setItem("npFixture", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p004kogu"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.a));
  localStorage.setItem("partyStats", JSON.stringify([seed.a, seed.b]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, { a: member(1, 10, 0), b: member(2, 10, 0) });

const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));
const st = () => page.evaluate(() => {
  const s = window.__state;
  return JSON.parse(JSON.stringify({ party: s.party, owned: s.rosterOwned, partner: s.partnerStats, reserve: Object.keys(s.reserveStats ?? {}) }));
});
const wf = async (fn, what, timeout = 40000) => {
  try { await page.waitForFunction(fn, null, { timeout, polling: 100 }); return true; } catch {
    check(`wait: ${what}`, false, JSON.stringify(await page.evaluate(() => window.__dri?.diagnostics?.()?.screen ?? null)));
    return false;
  }
};

try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  let s = await st();
  check("the new partners are owned once a party exists", ((s.owned >> 8) & 7) === 7, `owned=${s.owned}`);

  // 1. The lab: Switch Digimon, take the first candidate in Kotemon's place.
  await page.evaluate(() => window.__dri.open(window.__state, null));
  await wf(() => { const d = window.__dri.diagnostics().screen; return d && d.root === 1 && d.pane === 3 && !d.child; }, "Select Action");
  await page.waitForTimeout(600);
  await press(page, "Enter", 300);
  await wf(() => { const d = window.__dri.diagnostics().screen; return d && d.pane === 15 && !d.child; }, "partner list");
  await page.waitForTimeout(600);
  await press(page, "Enter", 300);
  await wf(() => { const d = window.__dri.diagnostics().screen; return d && d.child === "lab switch" && d.childLifecycle === 1; }, "lab switch");
  await page.waitForTimeout(1200);
  await shot("01-switch");
  await press(page, "Enter", 300);
  await wf(() => { const d = window.__dri.diagnostics().screen; return d && !d.child && d.pane === 15; }, "back at partner list");
  const map = await page.evaluate(() => window.__dri.diagnostics().screen.party);
  check("the switch put a new partner first", map[0] >= 8, JSON.stringify(map));
  await page.waitForTimeout(600);
  await shot("02-pedestals");
  await press(page, "Escape", 600);
  await wf(() => { const d = window.__dri.diagnostics().screen; return d && d.root === 1 && d.pane === 3 && !d.child; }, "Select Action again");
  await press(page, "Escape", 300);
  await wf(() => !window.__dri.isOpen(), "lab closed", 30000);
  await page.waitForTimeout(600);
  s = await st();
  check("the party leads with DemiDevimon", s.party[0] === "x191demi", JSON.stringify(s.party));
  check("its block is DemiDevimon's", s.partner?.digimonId === 191, JSON.stringify(s.partner)?.slice(0, 300));
  check("Kotemon waits in the reserve", s.reserve.includes("p003pken"), JSON.stringify(s.reserve));
  await shot("03-field");

  // 2. A fight with DemiDevimon in the lead.
  const before = s.partner;
  await page.evaluate(async () => {
    window.__npResult = null;
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, screenId: 200,
      onWin: (r) => { window.__npResult = r; }, onFlee: () => { window.__npResult = { fled: true }; }, onLose: () => { window.__npResult = { lost: true }; },
    });
  });
  await waitForCommandMenu(page);
  await page.waitForTimeout(800);
  await page.locator("canvas#game").locator("..").screenshot({ path: `${OUT}/04-battle.png` });
  const lead = await page.evaluate(() => {
    const b = window.__battleB();
    const keys = Object.keys(b).filter((k) => /play|party|ally|partner|member/i.test(k));
    const p = b.player ?? b.partner ?? b.ally ?? b.members?.[0] ?? b.party?.[0];
    return { keys, p: p ? JSON.parse(JSON.stringify(p, (k, v) => (typeof v === "object" && v && k && /mesh|model|scene|obj|tex/i.test(k)) ? "[obj]" : v)) : null };
  });
  console.log("lead:", JSON.stringify(lead).slice(0, 900));
  check("DemiDevimon's battle model loaded", modelReqs.some((m) => m.startsWith("200")), modelReqs.slice(0, 4).join(", "));
  check("the battle lead is DemiDevimon", JSON.stringify(lead).includes("191") || /DemiDevimon/.test(JSON.stringify(lead)));
  // the Tech list
  await press(page, "ArrowDown", 300);
  await press(page, "Enter", 1200);
  await page.locator("canvas#game").locator("..").screenshot({ path: `${OUT}/04b-tech.png` });
  await press(page, "Escape", 800);
  await press(page, "ArrowUp", 300);
  await page.evaluate(() => { window.__battleB().enemy.hp = 1; });
  await press(page, "Enter", 300);
  let guard = 0;
  while (await page.evaluate(() => window.__battleB?.()?.state) !== 8 && guard++ < 30) { await press(page, "Enter", 400); }
  guard = 0;
  while (await page.evaluate(() => !!window.__battle?.isActive?.()) && guard++ < 25) { await press(page, "Enter", 600); }
  await page.waitForTimeout(500);
  s = await st();
  const res = await page.evaluate(() => window.__npResult);
  check("the fight was won", res && !res.fled && !res.lost, JSON.stringify(res)?.slice(0, 200));
  check("DemiDevimon gained EXP", (s.partner?.xp ?? 0) > (before?.xp ?? 0), `${before?.xp} -> ${s.partner?.xp}`);
  await shot("05-after-battle");

  // 3. Save to the card, load it back.
  const slot = await saveToCard(page, async () => { await page.evaluate(() => window.__labOpen("save")); });
  check("saved to a card slot", slot != null);
  const saved = await st();
  await page.goto(TITLE);
  await page.waitForFunction(() => { const t = document.querySelector("#title-screen"); return t && !t.hidden; }, null, { timeout: 30000 });
  await openContinueCard(page);
  await loadFromCard(page);
  await page.waitForTimeout(800);
  s = await st();
  check("load keeps DemiDevimon in the lead", s.party?.[0] === "x191demi" && s.partner?.digimonId === 191, JSON.stringify(s.party));
  check("load keeps its EXP", s.partner?.xp === saved.partner?.xp, `${saved.partner?.xp} vs ${s.partner?.xp}`);
  check("load keeps the other new partners owned", ((s.owned >> 8) & 7) === 7, `owned=${s.owned}`);
  await shot("06-after-load");

  // 4. The pause menu's STATUS page with DemiDevimon in the lead.
  await page.evaluate(() => { window.__state.menuOpen = false; });
  await page.waitForTimeout(1200);
  await press(page, "i", 500);
  await page.waitForFunction(() => window.__status?.diagnostics?.().entry === "home" && window.__status.diagnostics().pending === false, null, { timeout: 40000 });
  await page.waitForTimeout(700);
  for (let n = 0; n < 4; n++) await press(page, "ArrowDown", 200);
  await press(page, "Enter", 300);
  const statusOpen = await page.waitForFunction(() => window.__status?.diagnostics?.().entry === "status", null, { timeout: 30000 }).then(() => true, () => false);
  await page.waitForTimeout(2500);
  check("the STATUS page opens", statusOpen);
  await page.locator("canvas#game").locator("..").screenshot({ path: `${OUT}/07-status.png` });
  for (let n = 0; n < 8 && await page.evaluate(() => !!window.__status?.isOpen?.()); n++) await press(page, "Escape", 700);
} catch (e) {
  check("no exception", false, e.stack?.split("\n").slice(0, 4).join(" | "));
} finally {
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
