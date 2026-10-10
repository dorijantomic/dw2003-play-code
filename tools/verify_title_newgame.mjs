// Section 7 opening coverage, case 1: the title screen's New Game action and
// the consumer that receives it.
//
// The native title screen (web/titlescreen.js) is driven with ordinary keys
// only: confirm the prompt, move the cursor up from Continue to Start and
// confirm. The outgoing result is the game's own New Game handler, which must
// wipe the saved game and start a fresh one on the opening map (s780, Kusanagi
// City street corner — stdwtitl Start resets game state and launches 0x2d7,
// docs/research/ui/stdwtitl-title-menu-2026-08-14.md).
//
// A save is seeded only so Continue is a real alternative; the New Game wipe
// itself is what is asserted. No success value is injected.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_title_newgame.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.TITLE_ROOT || `${baseUrl(8741)}/?skipLanguage=1`;
const OUT = process.env.TITLE_SHOT || ".bunny-scratch/shots/title-newgame";
mkdirSync(OUT, { recursive: true });

// localStorage keys that must not carry the previous save into the new game.
// engineFlags/progressOrdinal/rosterOwned/fieldLocation are re-persisted by the
// live engine after the wipe, so those are asserted against the engine/state
// values below instead of by key absence.
const CLEARED_KEYS = [
  "flags", "charId", "playerName", "chapter", "chapterOverride", "party",
  "pendingParty", "packId", "partnerStats", "partyStats", "equipment",
  "reserveStats", "reserveEquipment", "digimonNames",
];

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 3,
  hp: 100, maxHp: 120, mp: 20, maxMp: 40,
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  // A real, populated save: Continue is lit, and New Game has something to wipe.
  localStorage.setItem("playerName", "Veteran");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("packId", "A");
  localStorage.setItem("bits", "4321");
  localStorage.setItem("inventory", JSON.stringify([{ id: 92, qty: 2 }]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("digimonNames", JSON.stringify({ p003pken: "Blade" }));
  localStorage.setItem("visitedMaps", JSON.stringify([9999]));
  localStorage.setItem("playSeconds", "36000");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s210", x: 600, y: 400, dir: "down" }));
}, { lead: member(1, 9, 77), rena: member(7, 5, 0), pata: member(8, 4, 0) });

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
        result: window.__titleState().result(),
      } : null,
      started: !!window.__state?.started,
      map: window.__state?.manifest?.maps?.[window.__state?.mapIdx]?.id ?? null,
    })), null, 2));
    await shot("failure");
  } catch { /* page may be gone */ }
};

try {
  await page.goto(ROOT);
  // Wait for the native title (its own canvas over the DOM background).
  await page.waitForFunction(
    () => document.getElementById("title-screen")?.classList.contains("native")
      && window.__titleState?.(),
    null, { timeout: 10_000 },
  );
  await page.waitForFunction(
    () => window.__titleState().phase() === "prompt",
    null, { timeout: 10_000 },
  );
  await shot("title-prompt");

  // Ordinary input: START opens the Start/Continue split, then move up from
  // Continue to Start. The prompt does NOT answer Circle — the menu tick tests the
  // pad's logical button 3 (see tools/verify_native_title.mjs:78-84, and the same
  // fact in docs/research/ui/stdwtitl-title-menu-2026-08-14.md), so Enter here left
  // the screen in its closing fade and this check could never have passed.
  await page.keyboard.press("i");
  await page.waitForFunction(
    () => window.__titleState().phase() === "menu",
    null, { timeout: 10_000 },
  );
  const lit = await page.evaluate(() => window.__titleState().highlight());
  if (lit !== 1) await fail(`menu opened with highlight ${lit}, expected 1 (Continue)`);
  await shot("title-continue-lit");

  await page.keyboard.press("ArrowUp");
  const onStart = await page.evaluate(() => window.__titleState().highlight());
  if (onStart !== 0) await fail(`ArrowUp left highlight ${onStart}, expected 0 (Start)`);
  await shot("title-start-selected");

  // Confirm. The title fades, commits RESULT_START, the New Game handler wipes
  // the save and startGame("s780") runs.
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 10_000 });
  await page.waitForTimeout(300); // let setMap/checkStageCutscene settle
  await shot("newgame-field");

  const after = await page.evaluate((keys) => {
    const s = window.__state;
    const vars = (n) => window.__engine?.state?.vars?.get(n);
    // FlagManager.toJSON keeps one bitmap per bank even when nothing is set, so
    // read the SET BITS and their flag ids, not a byte count: DW3_BANK_SCHEME
    // splits an id into (id >> 8) & 0xfe for the bank and id & 0x1ff for the bit.
    let engineFlagBits = null;
    try {
      engineFlagBits = [];
      const banks = window.__engine.state.flags.toJSON();
      for (const [bank, b64] of Object.entries(banks)) {
        const bin = atob(b64);
        for (let i = 0; i < bin.length; i++) {
          const byte = bin.charCodeAt(i);
          if (!byte) continue;
          for (let b = 0; b < 8; b++) if (byte & (1 << b)) engineFlagBits.push((Number(bank) << 8) | (i * 8 + b));
        }
      }
    } catch { /* no engine */ }
    return {
      map: s.manifest.maps[s.mapIdx].id,
      playerName: s.playerName,
      charId: s.charId ?? null,
      party: s.party ?? null,
      packId: s.packId ?? null,
      progressOrdinal: s.progressOrdinal,
      rosterOwned: s.rosterOwned,
      equipment: (s.equipment ?? []).length,
      partnerStats: s.partnerStats,
      bits: s.bits,
      engineBit: Number(vars("$party.bit")),
      engineRoster: Number(vars("$roster.owned")),
      engineOrdinal: Number(vars("$story.ordinal")),
      enginePack: vars("$party.pack") ?? null,
      engineFlagBits,
      bag: (s.inventory ?? []).map((x) => [x.id, x.qty ?? 1]),
      names: Object.keys(s.digimonNames ?? {}),
      playSeconds: s.playSeconds,
      visited: [...(s.visitedMaps ?? [])].map(Number),
      cleared: Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])),
      storedBits: localStorage.getItem("bits"),
      storedInventory: localStorage.getItem("inventory"),
      storedNames: localStorage.getItem("digimonNames"),
      storedVisited: localStorage.getItem("visitedMaps"),
    };
  }, CLEARED_KEYS);

  if (after.map !== "s780") await fail(`New Game started on ${after.map}, expected s780`);
  if (after.playerName !== "Junior") await fail(`name is ${after.playerName}, expected the placeholder Junior`);
  if (after.charId !== null) await fail(`charId survived New Game: ${after.charId}`);
  if (after.party) await fail(`party survived New Game: ${JSON.stringify(after.party)}`);
  if (after.packId !== null) await fail(`packId survived New Game: ${after.packId}`);
  if (after.progressOrdinal !== 0) await fail(`progressOrdinal ${after.progressOrdinal}, expected 0`);
  if (after.rosterOwned !== 0) await fail(`rosterOwned ${after.rosterOwned}, expected 0`);
  if (after.equipment !== 0) await fail(`${after.equipment} equipment slots survived New Game`);
  if (after.partnerStats?.hp !== 500 || after.partnerStats?.level !== 1)
    await fail(`partnerStats not the fresh default: ${JSON.stringify(after.partnerStats)}`);

  // The engine is the single source of truth for the wallet/roster/ordinal.
  if (after.engineBit !== 500) await fail(`engine $party.bit ${after.engineBit}, expected 500`);
  if (after.engineRoster !== 0) await fail(`engine $roster.owned ${after.engineRoster}, expected 0`);
  if (after.engineOrdinal !== 0) await fail(`engine $story.ordinal ${after.engineOrdinal}, expected 0`);
  if (after.enginePack !== null) await fail(`engine $party.pack ${after.enginePack}, expected null`);
  // NOT "no flag bits at all": arriving in the first field is itself a flag
  // write. pro/fieldstg.s:8201-8209 calls the screen-id getter and then the flag
  // setter with a0 = screenId + 0x1E00, a1 = 1, and s780's own row of the decoded
  // screen table (assets/data/screen_table.json) is screen 727. So one bit MUST
  // stand after New Game: the one that says you have been to this place. What
  // must not survive is anything else — that is what the old save would leave.
  const visitedFlag = await page.evaluate(async () => {
    const table = await fetch("assets/data/screen_table.json").then((r) => r.json());
    const rows = Object.entries(table).filter(([, v]) => v.stage === 780).map(([id]) => Number(id));
    return rows.map((id) => 0x1e00 + id);
  });
  const strays = after.engineFlagBits.filter((id) => !visitedFlag.includes(id));
  if (strays.length) await fail(`engine flag bits survived New Game: ${strays.map((i) => `0x${i.toString(16)}`).join(", ")}`);
  if (!after.engineFlagBits.some((id) => visitedFlag.includes(id)))
    await fail(`the place-visited flag ${visitedFlag.map((i) => `0x${i.toString(16)}`).join("/")} is not set after arriving on ${after.map}`);

  if (after.bits !== 500) await fail(`bits ${after.bits} survived New Game, expected the fresh 500`);
  if (after.storedBits !== "500") await fail(`stored bits ${after.storedBits}, expected "500"`);
  if (after.bag.length !== 0) await fail(`bag ${JSON.stringify(after.bag)} survived New Game, expected empty`);
  if (after.storedInventory && after.storedInventory !== "[]")
    await fail(`stored inventory ${after.storedInventory}, expected empty`);
  if (after.names.length) await fail(`digimon nicknames survived: ${after.names.join(", ")}`);
  if (after.storedNames) await fail(`stored digimonNames ${after.storedNames}, expected absent`);
  if (!(after.playSeconds >= 0 && after.playSeconds < 30))
    await fail(`playSeconds ${after.playSeconds} looks carried over`);
  if (after.visited.includes(9999)) await fail(`visitedMaps kept the previous save's marker`);

  const kept = Object.entries(after.cleared).filter(([, v]) => v !== null).map(([k]) => k);
  if (kept.length) await fail(`save keys survived New Game: ${kept.join(", ")}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, lit, onStart, map: after.map, playerName: after.playerName,
    bits: after.bits, bag: after.bag, names: after.names, visited: after.visited,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
