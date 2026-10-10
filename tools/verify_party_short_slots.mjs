// tools/verify_party_short_slots.mjs — party-management: the empty pedestal.
//
// Original rule (claims party-lab-count-and-pack-2026-09-14 and the Switch flow
// reads below, authority 2): the party is three packed slots, and the Lab's
// Switch screen lists all THREE pedestals, free ones included — its pedestal
// picker wraps over the root's +0x5C (=3), the draw loops i < ctx+0x5C (=3)
// skipping negative words (F0x80089aec), the picker wraps the selection over
// three for Select Action row 0 (F0x80088b5c case 5), and the confirm writes
// party[chosen] = candidate then re-packs (F0x8008b798 case 8). So a two-member
// party can deploy a third partner into the free pedestal.
//
// This check drives the real Lab Switch on a two-member party through the
// TRANSLATED screen (web/lab-translated.js), whose two lists are the pedestal
// picker (the Select Action pane at its word 15, the pedestal under the cursor
// being the lab root's +0x64) and the Switch screen's candidate list (the
// "lab switch" task at its word 4, waiting partners at +0xE4, rows at +0x104):
//   A. the pedestal picker offers the three pedestals (one Left from 0 lands on
//      the third, because the root's +0x5C is 3);
//   B. a switch on the middle pedestal puts the waiting partner in the MIDDLE
//      and leaves the third pedestal standing — the confirm writes
//      party[chosen] = candidate and then the root's count-and-pack, which packs
//      the hole away, so the pedestal the player did not touch keeps standing;
//   C. the same waiting partner, chosen on the FREE third pedestal, lands at the
//      end and the party is three deep;
//   D. a production battle builds three records and Continue keeps three.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { backOutToTitle, loadFromCard, openContinueCard, saveToCard } from "./memcard-continue.mjs";
import { closeLab, labState, openLab, pedestals, press, selectAction, switchScreen, waitLab } from "./translated-lab-drive.mjs";

const ROOT = process.env.SHORT_SLOTS_ROOT || `${baseUrl(8742)}/`;
const BASE = ROOT + "?skipTitle=1&map=s245&noEncounters=1";
// The title boot. The country/language screen (code 0x1600) comes before it and ends
// in the opening movie, so the leg that comes back through the title skips it.
const TITLE = ROOT + "?skipLanguage=1&noEncounters=1";
const OUT = process.env.SHORT_SLOTS_SHOT || ".dw3-research/autonomous-plan/shots/party-short-slots";
mkdirSync(OUT, { recursive: true });

// Obtained roster slots 0 (Kotemon), 6 (Renamon), 7 (Patamon); only 0 and 7 stand.
const OWNED = (1 << 0) | (1 << 6) | (1 << 7);
const KOTO = { digimonId: 1, level: 20, xp: 0, hp: 400, maxHp: 400, mp: 160, maxMp: 160, stats: { str: 80, def: 55, spt: 40, wis: 40, spd: 45, chr: 30 }, bonuses: {}, elemBonuses: {} };
const PATA = { digimonId: 8, level: 15, xp: 0, hp: 290, maxHp: 290, mp: 130, maxMp: 130, stats: { str: 52, def: 42, spt: 70, wis: 58, spd: 61, chr: 55 }, bonuses: {}, elemBonuses: {} };
const RENA = { digimonId: 7, level: 17, xp: 0, hp: 310, maxHp: 310, mp: 140, maxMp: 140, stats: { str: 70, def: 45, spt: 60, wis: 55, spd: 66, chr: 40 }, bonuses: {}, elemBonuses: {} };
const RENA_SLOT = 6; // the roster slot Renamon waits in

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("shortSlotsFixture")) return;
  sessionStorage.setItem("shortSlotsFixture", "1");
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
  party: ["p003pken", "p010pata"],
  partyStats: [KOTO, PATA],
  partnerStats: KOTO,
  equipment: [{}, {}],
  reserveStats: { p009rena: RENA },
  reserveEquipment: { p009rena: {} },
  owned: OWNED,
});

const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };

const results = { errors };
try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  results.start = await labState(page);
  results.execution = await page.evaluate(() => window.__dri.diagnostics().execution);
  if (results.start.party.length !== 2) fail(`seeded party is not two: ${JSON.stringify(results.start.party)}`);
  if (results.execution !== "translated") fail(`the lab is not the translated screen: ${results.execution}`);

  // A. The pedestal picker is the three pedestals. `Left` from pedestal 0 wraps
  // over the root's +0x5C, so it lands on pedestal 2 — the FREE one — while a
  // two-member party would wrap over two.
  await openLab(page);
  results.rowsIdle = await selectAction(page);
  await press(page, "Enter");
  results.pick = await pedestals(page);
  results.threePedestals = { pedestals: results.pick.pedestals, from: results.pick.pedestal };
  await press(page, "ArrowLeft");
  results.afterLeft = await waitLab(page, () => {
    const g = window.__dri?._session;
    if (!g) return false;
    const t = [...g.tree.tasks.values()].find((x) => g.tree.classes.get(x.classId).name === "lab root");
    return !!t && (g.mem.read32(t.address + 0x64) | 0) === 2;
  }, "the third pedestal");
  await press(page, "ArrowRight");   // back to pedestal 0

  // B. Switch on the MIDDLE pedestal: Renamon takes the second place and the
  // third pedestal keeps Patamon standing.
  await press(page, "ArrowRight");
  results.middle = await waitLab(page, () => {
    const g = window.__dri?._session;
    if (!g) return false;
    const t = [...g.tree.tasks.values()].find((x) => g.tree.classes.get(x.classId).name === "lab root");
    return !!t && (g.mem.read32(t.address + 0x64) | 0) === 1;
  }, "the second pedestal");
  await press(page, "Enter");
  results.switchList = await switchScreen(page);
  results.offer = { rows: results.switchList.rows, candidates: results.switchList.candidates, cursor: results.switchList.cursor };
  await shot("switch-swap-middle");
  await press(page, "Enter");        // the waiting partner under the cursor
  await pedestals(page);
  results.midUncommitted = await page.evaluate(() => window.__dri.diagnostics().screen.party);
  await closeLab(page);
  results.swapped = await labState(page);

  // C. Put Patamon back on the middle pedestal, then fill the FREE third one.
  await openLab(page);
  await selectAction(page);
  await press(page, "Enter");
  await pedestals(page);
  await press(page, "ArrowRight");   // pedestal 1
  await waitLab(page, () => {
    const g = window.__dri?._session;
    if (!g) return false;
    const t = [...g.tree.tasks.values()].find((x) => g.tree.classes.get(x.classId).name === "lab root");
    return !!t && (g.mem.read32(t.address + 0x64) | 0) === 1;
  }, "the second pedestal (switch back)");
  await press(page, "Enter");
  results.switchBackList = await switchScreen(page);
  results.offerBack = { rows: results.switchBackList.rows, candidates: results.switchBackList.candidates };
  await press(page, "Enter");        // Patamon is the only waiting partner now
  await pedestals(page);
  await closeLab(page);
  results.swappedBack = await labState(page);

  await openLab(page);
  await selectAction(page);
  await press(page, "Enter");
  await pedestals(page);
  await press(page, "ArrowLeft");    // wrap onto the FREE third pedestal
  results.freePedestal = await waitLab(page, () => {
    const g = window.__dri?._session;
    if (!g) return false;
    const t = [...g.tree.tasks.values()].find((x) => g.tree.classes.get(x.classId).name === "lab root");
    return !!t && (g.mem.read32(t.address + 0x64) | 0) === 2;
  }, "the free pedestal");
  await press(page, "Enter");
  results.freeList = await switchScreen(page);
  results.offerFree = { rows: results.freeList.rows, candidates: results.freeList.candidates, cursor: results.freeList.cursor };
  await press(page, "Enter");        // deploy Renamon into the free pedestal
  await pedestals(page);
  await shot("switch-free-pedestal-filled");
  await closeLab(page);
  results.filled = await labState(page);

  // D. The battle builds one record per partner and Continue keeps all three.
  results.battle = await page.evaluate(async () => {
    await window.__battle.start({ enemyId: 1, enemyLevel: 1, onWin() {}, onFlee() {}, onLose() {} });
    const live = window.__battleB?.();
    return {
      personRoster: (live?.playerRoster ?? []).map((m) => m.charId),
      records: (live?.playerRecords ?? []).length,
    };
  });

  // The filled party survives a reload. It goes on the card first — the SAVE
  // card is `openMemoryCard("save")`, the call an inn or tower save point's
  // HANDOFF makes — because Continue only reaches the field by LOADING a file:
  // the card's own exit answers 0xE00, the title, when LOAD mode closes with
  // nothing loaded (pro/stgmcard.s 0x4dc4-0x4e2c).
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
  await page.waitForTimeout(400);
  results.afterReload = await labState(page);
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
try {
  assert(!failed, failed ?? "unknown failure");
  assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
  assert(results.execution === "translated", `the lab is not the translated screen: ${results.execution}`);
  // A. The pedestal picker offers the three pedestals, free one included.
  assert(results.threePedestals.pedestals === 3 && results.threePedestals.from === 0,
    `the pedestal picker is not the three pedestals: ${JSON.stringify(results.threePedestals)}`);
  assert(results.afterLeft.pedestal === 2, `Left from pedestal 0 did not wrap to the third: ${results.afterLeft.pedestal}`);
  // B. The middle pedestal takes the waiting partner. The confirm writes
  // party[1] = candidate (F0x8008b798 case 8) and then the root's count-and-pack,
  // so the displaced partner leaves the map and the walker keeps its block in the
  // reserve.
  assert(results.offer.candidates[results.offer.cursor] === RENA_SLOT,
    `the Switch list did not offer Renamon under the cursor: ${JSON.stringify(results.offer)}`);
  assert(results.midUncommitted.join(",") === "0,6,-1",
    `the screen's party map did not hold Renamon in the middle: ${results.midUncommitted}`);
  assert(results.swapped.party.join(",") === "p003pken,p009rena",
    `the middle switch did not land: ${JSON.stringify(results.swapped.party)}`);
  assert(results.swapped.reserveStats.includes("p010pata"),
    `the outgoing member was not reserved: ${JSON.stringify(results.swapped.reserveStats)}`);
  // C. Back out, then fill the FREE pedestal: the same partner lands at the end.
  assert(results.offerBack.candidates.includes(7),
    `Patamon was not offered back: ${JSON.stringify(results.offerBack)}`);
  assert(results.swappedBack.party.join(",") === "p003pken,p010pata",
    `the switch back did not land: ${JSON.stringify(results.swappedBack.party)}`);
  assert(results.swappedBack.reserveStats.join(",") === "p009rena",
    `Renamon did not wait in the reserve again: ${JSON.stringify(results.swappedBack.reserveStats)}`);
  assert(results.offerFree.candidates[results.offerFree.cursor] === RENA_SLOT,
    `the free pedestal did not offer Renamon: ${JSON.stringify(results.offerFree)}`);
  assert(results.filled.party.join(",") === "p003pken,p010pata,p009rena",
    `free pedestal not filled: ${JSON.stringify(results.filled.party)}`);
  assert(results.filled.stats.length === 3, `partyStats did not grow with the party: ${results.filled.stats.length}`);
  assert(results.filled.reserveStats.length === 0,
    `filling a free pedestal reserved an outgoing member: ${JSON.stringify(results.filled.reserveStats)}`);
  assert(results.filled.storedParty.length === 3, `storage did not keep the three-member party: ${JSON.stringify(results.filled.storedParty)}`);
  // D. The battle builds one record per partner and Continue keeps all three.
  assert(results.battle.personRoster.join(",") === "p003pken,p010pata,p009rena",
    `battle roster wrong: ${JSON.stringify(results.battle)}`);
  assert(results.battle.records === 3, `battle record count ${results.battle.records}`);
  assert(results.afterReload.party.length === 3 &&
    results.afterReload.party.join(",") === results.filled.party.join(","),
    `Continue lost the party: ${JSON.stringify(results.afterReload.party)}`);
  console.log("RESULT", JSON.stringify({
    ok: true,
    summary: "lab Switch: the picker offered all three pedestals, the middle one took the waiting partner, the free third pedestal grew the party to three, and Continue kept it",
    results,
  }, null, 2));
} catch (e) {
  console.error("ASSERT FAILED:", e.message);
  process.exit(1);
}