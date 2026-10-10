import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { backOutToTitle, loadFromCard, openContinueCard, saveToCard } from "./memcard-continue.mjs";
import { closeLab, labState, openLab, pedestals, press, selectAction, switchScreen } from "./translated-lab-drive.mjs";

// Plan 6.3: the reserve/DRI confirm path. An obtained non-starter partner goes
// through the real Switch screen: cancel writes nothing, confirm deploys it,
// switching back returns the outgoing member's own stats and gear, the deployed
// partner reaches a real battle's combat record, and the party survives a
// reload. The obtaining handover producer itself is proven separately by
// tools/verify_partner_handover.mjs; here the partner is seeded as obtained.
//
// The desk is the TRANSLATED lab (web/lab-translated.js). Its two lists are the
// pedestal picker (the Select Action pane at word 15, the pedestal under the
// cursor being the lab root's +0x64, wrapping over the root's +0x5C) and the
// Switch screen's candidate list (the "lab switch" task at word 4, the waiting
// partners at +0xE4, the row under the cursor at +0x60).
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/verify_partner_switch_cycle.mjs
const ROOT = process.env.PARTY_ROOT || `${baseUrl(8741)}/`;
const BASE = ROOT + "?skipTitle=1&map=s245&noEncounters=1";
// The title boot. The country/language screen (code 0x1600) comes before it and ends
// in the opening movie, so the leg that comes back through the title skips it.
const TITLE = ROOT + "?skipLanguage=1&noEncounters=1";
const OUT = process.env.PARTY_SHOT || "/tmp/partner-cycle";
mkdirSync(OUT, { recursive: true });

// roster slots 0,4,6,7 obtained: pack A party plus the handed-over Veemon.
const OWNED = (1 << 0) | (1 << 4) | (1 << 6) | (1 << 7);
const KOTO = { digimonId: 1, level: 20, xp: 0, hp: 400, maxHp: 400, mp: 160, maxMp: 160, stats: { str: 80, def: 55, spt: 40, wis: 40, spd: 45, chr: 30 }, bonuses: {}, elemBonuses: {} };
const RENA = { digimonId: 7, level: 17, xp: 0, hp: 310, maxHp: 310, mp: 140, maxMp: 140, stats: { str: 70, def: 45, spt: 60, wis: 55, spd: 66, chr: 40 }, bonuses: {}, elemBonuses: {} };
const PATA = { digimonId: 8, level: 15, xp: 0, hp: 290, maxHp: 290, mp: 130, maxMp: 130, stats: { str: 52, def: 42, spt: 70, wis: 58, spd: 61, chr: 55 }, bonuses: {}, elemBonuses: {} };
const VEEMON = { digimonId: 5, level: 12, xp: 0, hp: 260, maxHp: 260, mp: 120, maxMp: 120, stats: { str: 66, def: 48, spt: 38, wis: 36, spd: 52, chr: 33 }, bonuses: {}, elemBonuses: {} };
const VEEMON_SLOT = 4;
const PATA_SLOT = 7;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.error("PAGEERROR", e));
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("partyFixture")) return;
  sessionStorage.setItem("partyFixture", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(seed.party));
  localStorage.setItem("partyStats", JSON.stringify(seed.partyStats));
  localStorage.setItem("partnerStats", JSON.stringify(seed.partnerStats));
  localStorage.setItem("equipment", JSON.stringify(seed.equipment));
  localStorage.setItem("reserveStats", JSON.stringify(seed.reserveStats));
  localStorage.setItem("reserveEquipment", JSON.stringify(seed.reserveEquipment));
  localStorage.setItem("rosterOwned", String(seed.owned));
}, {
  party: ["p003pken", "p009rena", "p010pata"],
  partyStats: [KOTO, RENA, PATA],
  partnerStats: KOTO,
  equipment: [{}, {}, { head: 215 }],
  reserveStats: { p007vmon: VEEMON },
  reserveEquipment: { p007vmon: { right: 92 } },
  owned: OWNED,
});

const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));
const onPedestal = (n) => page.waitForFunction((want) => {
  const g = window.__dri?._session;
  if (!g) return false;
  const t = [...g.tree.tasks.values()].find((x) => g.tree.classes.get(x.classId).name === "lab root");
  return !!t && (g.mem.read32(t.address + 0x64) | 0) === want;
}, n, { timeout: 30_000, polling: 120 });
/** Open the lab, take the Switch row, and park the pedestal cursor on `pedestal`. */
async function choosePedestal(pedestal) {
  await openLab(page);
  await selectAction(page);
  await press(page, "Enter");              // the Switch row
  await pedestals(page);
  for (let i = 0; i < pedestal; i++) await press(page, "ArrowRight", 260);
  await onPedestal(pedestal);
  await press(page, "Enter");              // the Switch screen for that pedestal
  return switchScreen(page);
}

const results = {};
try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__dri?.diagnostics?.().execution === "translated", null, { timeout: 30_000 });
  await page.waitForTimeout(300);
  results.start = await labState(page);

  // A. Cancel: park on the third pedestal (Patamon), open the waiting partners and
  // back out without confirming. Nothing may move.
  results.cancelOffer = await choosePedestal(2);
  results.cancelBefore = await labState(page);
  // Back is word bit 0x4000, reached with Escape or x (engine/systems/input-map.ts,
  // commit 173ebcf0). `c` reached that bit before 2026-10-03 and confirms now, so
  // the old press confirmed the swap instead of cancelling it.
  await press(page, "Escape");            // Back out of the Switch screen
  results.cancelMid = await pedestals(page);
  results.cancelMidMap = await page.evaluate(() => window.__dri.diagnostics().screen.party);
  await closeLab(page);
  results.cancelAfter = await labState(page);

  // B. Confirm: deploy Veemon over party slot 2.
  results.deployOffer = await choosePedestal(2);
  results.deployMidMap = await page.evaluate(() => window.__dri.diagnostics().screen.party);
  await press(page, "Enter");             // confirm the swap
  await pedestals(page);
  results.deployedMap = await page.evaluate(() => window.__dri.diagnostics().screen.party);
  await closeLab(page);
  results.deployed = await labState(page);
  await shot("after-deploy");

  // C. Switch back: the outgoing Patamon is the waiting partner now.
  results.backOffer = await choosePedestal(2);
  await press(page, "Enter");             // Patamon back in
  await pedestals(page);
  results.swappedBackMap = await page.evaluate(() => window.__dri.diagnostics().screen.party);
  await closeLab(page);
  results.swappedBack = await labState(page);
  await shot("after-switch-back");

  // D. Deploy again so the reload and battle legs see the new partner.
  await choosePedestal(2);
  await press(page, "Enter");
  await pedestals(page);
  await closeLab(page);
  results.redeployed = await labState(page);

  // E. Real battle: the deployed partner must be one of the live combat records.
  results.battle = await page.evaluate(async () => {
    const b = window.__battle;
    await b.start({ enemyId: 1, enemyLevel: 1, onWin() {}, onFlee() {}, onLose() {} });
    const live = window.__battleB?.();
    return {
      active: !!live,
      charIds: (live?.playerRoster ?? []).map((m) => m.charId),
      levels: (live?.playerRecords ?? []).map((r) => r.level ?? null),
      digimonIds: (live?.playerRecords ?? []).map((r) => r.profile?.id ?? null),
      partyStatsLevels: (window.__state.partyStats ?? []).map((s) => s?.level ?? null),
    };
  });

  // F. Continue: leave the battle page state behind and read the party back.
  // The switch goes on the card first — the SAVE card is
  // `openMemoryCard("save")`, the call an inn or tower save point's HANDOFF
  // makes — because Continue only reaches the field by LOADING a file: the card's
  // own exit answers 0xE00, the title, when LOAD mode closes with nothing loaded
  // (pro/stgmcard.s 0x4dc4-0x4e2c).
  results.slot = await saveToCard(page, async () => { await page.evaluate(() => window.__labOpen("save")); });
  await page.goto(TITLE);
  await page.waitForFunction(() => {
    const t = document.querySelector("#title-screen");
    return t && !t.hidden;
  }, null, { timeout: 30_000 });
  await openContinueCard(page);
  results.backOut = await backOutToTitle(page);
  if (results.backOut.started || results.backOut.phase !== "prompt" || results.backOut.exitScreen !== 0xe00)
    throw new Error(`backing out of the card did not return to the title: ${JSON.stringify(results.backOut)}`);
  await openContinueCard(page);
  await loadFromCard(page);
  await page.waitForTimeout(500);
  results.afterReload = await labState(page);
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The lab seeds every member it shows: a block that carried no form ledger gains
// an empty `formLedger` array when the screen builds its record. That is the
// screen's own default with no data in it, so the returning partner's numbers are
// compared rather than the raw JSON identity.
const numBlock = (block) => {
  const out = JSON.parse(JSON.stringify(block ?? {}));
  if (Array.isArray(out.formLedger) && out.formLedger.length === 0) delete out.formLedger;
  if (Array.isArray(out.equippedForms) && out.equippedForms.every((v) => !v)) delete out.equippedForms;
  return out;
};
// A. Cancel wrote nothing, and the screen's own party map never changed.
assert(results.cancelOffer.candidates.includes(VEEMON_SLOT),
  `the Switch list did not offer Veemon: ${JSON.stringify(results.cancelOffer.candidates)}`);
assert(results.cancelMidMap.join(",") === "0,6,7",
  `cancel setup moved the screen's party map: ${results.cancelMidMap}`);
assert(eq(results.cancelAfter.party, results.cancelBefore.party) &&
  eq(results.cancelAfter.stats, results.cancelBefore.stats) &&
  eq(results.cancelAfter.equipment, results.cancelBefore.equipment) &&
  eq(results.cancelAfter.reserveStats, results.cancelBefore.reserveStats),
  "cancel changed the party state");
// B. Confirm deployed the reserve partner and stored the outgoing one.
assert(results.deployMidMap.join(",") === "0,6,7", `deploy setup: ${results.deployMidMap}`);
assert(results.deployedMap.join(",") === "0,6,4",
  `the screen's party map did not take Veemon: ${results.deployedMap}`);
assert(results.deployed.party[2] === "p007vmon",
  `confirm did not deploy: ${JSON.stringify(results.deployed.party)}`);
assert(results.deployed.equipment[2]?.right === 92,
  `incoming gear missing: ${JSON.stringify(results.deployed.equipment[2])}`);
assert(results.deployed.reserveStats.includes("p010pata"),
  `outgoing member not reserved: ${JSON.stringify(results.deployed.reserveStats)}`);
// C. The outgoing member returns with its own stats and gear.
assert(results.backOffer.candidates.includes(PATA_SLOT),
  `Patamon was not offered back: ${JSON.stringify(results.backOffer.candidates)}`);
assert(results.swappedBackMap.join(",") === "0,6,7", `switch back map: ${results.swappedBackMap}`);
assert(results.swappedBack.party[2] === "p010pata",
  `switch back failed: ${JSON.stringify(results.swappedBack.party)}`);
assert(eq(numBlock(results.swappedBack.stats[2]), numBlock(PATA)), `Patamon stats changed: ${JSON.stringify(results.swappedBack.stats[2])}`);
assert(eq(results.swappedBack.equipment[2], { head: 215 }),
  `Patamon gear changed: ${JSON.stringify(results.swappedBack.equipment[2])}`);
assert(results.swappedBack.reserveEquipment.includes("p007vmon"),
  `Veemon gear not reserved: ${JSON.stringify(results.swappedBack.reserveEquipment)}`);
// D/E. The redeployed partner reaches the live battle record.
assert(results.redeployed.party[2] === "p007vmon",
  `the second deploy did not land: ${JSON.stringify(results.redeployed.party)}`);
assert(results.battle.active, "battle did not start");
assert(results.battle.charIds.includes("p007vmon"),
  `deployed partner absent from the battle roster: ${JSON.stringify(results.battle.charIds)}`);
assert(results.battle.levels[2] === 12 && results.battle.digimonIds[2] === 5,
  `battle record not built from the deployed stats: ${JSON.stringify(results.battle)}`);
// F. Continue keeps the party.
assert(eq(results.afterReload.party, results.redeployed.party),
  `party lost on Continue: ${JSON.stringify(results.afterReload.party)}`);
assert(results.afterReload.owned === results.start.owned,
  `obtained set lost on Continue: ${results.afterReload.owned} != ${results.start.owned}`);
console.log(JSON.stringify({
  ok: true,
  summary: "lab Switch: Back wrote nothing, Veemon took the third pedestal with its own gear, Patamon came back with its stats and gear, and the deployed Veemon reached the battle record",
  results,
}, null, 2));