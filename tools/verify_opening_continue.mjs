// Section 7 opening coverage, case 5: save/Continue for the opening state.
//
// The opening's committed result (the downloaded pack, the lead's post-battle
// stats, money and the lead identity) is seeded, the game boots into the field
// from that seed and the seed is written to a memory card through the real save
// screen, then the REAL game is booted to the native title and driven with
// ordinary keys only: START on the prompt, which opens the two-option menu with
// Continue lit, then confirm again — the card in LOAD mode. The consumer under
// test is that load: the slot's snapshot is restored and the field comes back
// with the opening's result. Nothing about the result is injected after the seed.
//
// Backing out of the card is part of the route now, and it is the other half of
// what the card's own root decides: LOAD mode that closes with nothing loaded
// answers with the selector 0xE00, the TITLE SCREEN (pro/stgmcard.s
// 0x4dc4-0x4e2c -> engine/dw3/ui/memcard-root.ts state 3), so the player is put
// back on the title's "Press Start" prompt instead of in a game they did not
// load. Continue then opens the card again from there.
//
// The save-screen producer itself (slot -> file -> confirm -> populated record)
// is proven separately by tools/verify_save_ui.mjs.
//
// Server: python3 -m http.server <port> --directory web, VERIFY_PORT set.
// Run:    tools/run-playwright.sh tools/verify_opening_continue.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { backOutToTitle, loadFromCard, openContinueCard, saveToCard } from "./memcard-continue.mjs";

const ROOT = process.env.CONT_ROOT || `${baseUrl(8741)}/`;
// The seeded field, so the card can be written before the title is used.
const BASE = `${ROOT}?skipTitle=1&noEncounters=1`;
// The title boot. Without ?skipLanguage=1 the country/language screen runs first
// and its confirm opens the opening movie (code 0xE01/0xE02), which holds the
// title at its slide until the movie ends; Continue is not what is under test.
const TITLE = `${ROOT}?skipLanguage=1&noEncounters=1`;
const OUT = process.env.CONT_SHOT || "/tmp/opening-continue";
mkdirSync(OUT, { recursive: true });

const PACK_B = ["p005koet", "p006agum", "p009rena"];
const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 180, maxHp: 200, mp: 60, maxMp: 80,
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  // The opening's committed result, as the download + first battle leave it.
  localStorage.setItem("playerName", "A");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(seed.party));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1010");
  localStorage.setItem("inventory", JSON.stringify([{ id: 31, qty: 1 }]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("rosterOwned", "76");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s210", x: 730, y: 382, dir: "down" }));
}, {
  party: PACK_B,
  lead: { ...member(3, 5, 12) },
  rena: member(7, 5, 0),
  pata: member(8, 5, 0),
});

const shot = async (name) => {
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot());
  console.log("shot", name);
};

let failed = null;
const fail = async (msg) => {
  failed = msg;
  console.error("FAIL:", msg);
  try {
    writeFileSync(`${OUT}/failure-state.json`, JSON.stringify(await page.evaluate(() => ({
      title: window.__titleState?.() ? {
        phase: window.__titleState().phase(),
        highlight: window.__titleState().highlight(),
      } : null,
      started: !!window.__state?.started,
      map: window.__state?.manifest?.maps?.[window.__state?.mapIdx]?.id ?? null,
    })), null, 2));
    await shot("failure");
  } catch { /* page may be gone */ }
};

try {
  // The field, from the seeded opening result, so that a card file exists to read
  // back: the game's own save screen (`openMemoryCard("save")` — the call a save
  // point makes, web/game.js doStoryHandoff), opened here through the lab entry.
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 40_000 });
  const slot = await saveToCard(page, async () => { await page.evaluate(() => window.__labOpen("save")); });
  if (slot == null) await fail("the opening's result was not written to a memory card slot");

  // The real game boots to the native title (a card file exists, so Continue is live).
  await page.goto(TITLE);
  await page.waitForFunction(
    () => document.getElementById("title-screen")?.classList.contains("native")
      && window.__titleState?.(),
    null, { timeout: 30_000 },
  );
  await page.waitForFunction(() => window.__titleState().phase() === "prompt", null, { timeout: 30_000 });

  // Ordinary input: START (the title's own logical 3) leaves the prompt, and the
  // menu opens with the cursor on the lower option, Continue. Confirm commits it.
  await page.keyboard.press("i", { delay: 120 });
  await page.waitForFunction(() => window.__titleState().phase() === "menu", null, { timeout: 20_000 });
  const lit = await page.evaluate(() => window.__titleState().highlight());
  if (lit !== 1) await fail(`menu opened with highlight ${lit}, expected 1 (Continue)`);
  await shot("title-continue-lit");
  await page.keyboard.press("Enter", { delay: 120 });

  // Continue opens the card in LOAD mode, and leaving it without loading answers
  // with the card's own selector: 0xE00, the title. The game must not start.
  const back = await backOutToTitle(page);
  if (back.started !== false) await fail(`leaving the card started the game: ${JSON.stringify(back)}`);
  if (back.exitScreen !== 0xe00) await fail(`the card's exit selector was ${back.exitScreen}, expected 0xE00 (the title)`);
  if (back.titleHidden !== false || back.phase !== "prompt")
    await fail(`the title prompt is not on screen again: ${JSON.stringify(back)}`);
  await shot("title-after-backing-out");

  // Continue again from the title that came back, and load the file.
  await openContinueCard(page);
  await loadFromCard(page);
  await page.waitForTimeout(400);
  await shot("continue-field");

  const after = await page.evaluate(() => ({
    map: window.__state.manifest.maps[window.__state.mapIdx].id,
    x: Math.round(window.__state.x), y: Math.round(window.__state.y),
    playerName: window.__state.playerName,
    charId: window.__state.charId,
    party: window.__state.party,
    packId: window.__state.packId,
    xp: window.__state.partnerStats?.xp,
    level: window.__state.partnerStats?.level,
    hp: window.__state.partnerStats?.hp,
    bits: window.__state.bits,
    engineBit: Number(window.__engine?.state?.vars?.get("$party.bit")),
    rosterOwned: window.__state.rosterOwned,
    engineRoster: Number(window.__engine?.state?.vars?.get("$roster.owned")),
    bag: (window.__state.inventory ?? []).map((i) => [i.id, i.qty ?? 1]),
    pending: window.__state.pendingParty ?? null,
  }));

  if (after.map !== "s210") await fail(`Continue loaded ${after.map}, expected the saved s210`);
  if (after.playerName !== "A") await fail(`playerName ${after.playerName}, expected A`);
  if (after.charId !== "p005koet") await fail(`charId ${after.charId}, expected the pack lead`);
  if (JSON.stringify(after.party) !== JSON.stringify(PACK_B))
    await fail(`party ${JSON.stringify(after.party)}, expected the downloaded pack`);
  if (after.packId !== "B") await fail(`packId ${after.packId}, expected B`);
  if (after.xp !== 12 || after.level !== 5) await fail(`lead stats ${after.xp}xp L${after.level}, expected 12 xp L5`);
  if (after.bits !== 1010 || after.engineBit !== 1010) await fail(`bits ${after.bits} / engine ${after.engineBit}, expected 1010`);
  if (after.rosterOwned !== 76 || after.engineRoster !== 76) await fail(`roster ${after.rosterOwned} / engine ${after.engineRoster}, expected 76`);
  if (JSON.stringify(after.bag) !== JSON.stringify([[31, 1]])) await fail(`bag ${JSON.stringify(after.bag)}, expected [[31,1]]`);
  if (after.pending !== null) await fail(`pendingParty ${JSON.stringify(after.pending)} survived Continue`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, lit, after }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
