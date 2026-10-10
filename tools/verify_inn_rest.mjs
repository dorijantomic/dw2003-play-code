// tools/verify_inn_rest.mjs — actually STAY at the inn, then come back.
//
// The other inn verifiers open the screen and price it; this one proves the stay
// itself. A starting save is parked at the Asuka Inn (s235) with a damaged party
// and 1000 BIT; after that every step is an ordinary button: walk up to the
// innkeeper (NPC 20, sprite p039tail), let the box close, choose "Stay in Inn",
// and the party is healed and the wallet charged. Then the page is reloaded and
// the game is entered again through the title's Continue, because a stay is a
// persistent transaction and must survive the reload.
//
// UPDATES 2026-10-02. Two things moved under this script and both are the GAME's
// current shape, not a loosened check:
//
//   * The rest screen is TRANSLATED code (engine/dw3/ui/inn-session.ts behind
//     web/inn-translated.js), so the inn no longer carries `_price` / `_party`.
//     Its own record, its painted text, its step and its party count come from
//     `diagnostics()`, the selected row from `selection()` — the same surface
//     tools/verify_inn.mjs reads. Every press is followed by a wait for the
//     screen's own step, because the panels are folded windows and a fixed sleep
//     can land the next press while the fold is still opening.
//
//   * Continue no longer starts the game. On the original, Continue launches code
//     0xC00 — the memory card in LOAD mode
//     (docs/research/ui/stdwtitl-title-menu-2026-08-14.md, the title's lower
//     option: "launch code 0xc00 argument 0 -- the stmcrd overlay's LOAD row").
//     The walker now runs that as translated code too, so the script drives it:
//     the memory-card LOAD screen opens, and backing out of it returns to the
//     TITLE, because that is the selector the card's own root writes when LOAD
//     mode closes with nothing loaded (pro/stgmcard.s 0x4dc4-0x4e2c -> 0xE00).
//     The stay is a persistent transaction, so the script now saves it to the
//     card the way the inn's own save point does, and comes back in by LOADING
//     that file: title -> Continue -> back out -> the title -> Continue -> the
//     saved file -> the healed stay, in the field. Nothing here presses Start,
//     which would wipe the save the checks are about.
//
// Server: python3 -m http.server <port> --directory web
// Run:    tools/run-playwright.sh tools/verify_inn_rest.mjs [out-dir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { baseUrl } from "./verify-base-url.mjs";
import {
  backOutToTitle, cardWindow, loadFromCard, openContinueCard, press, saveToCard, waitCardWindow,
  waitTitlePrompt,
} from "./memcard-continue.mjs";

const ROOT = process.env.INN_ROOT || `${baseUrl(8741)}/`;
const BASE = ROOT + "?skipTitle=1&map=s235&noEncounters=1";
const TITLE = ROOT + "?skipLanguage=1&noEncounters=1";
const OUT = resolve(process.env.INN_SHOT ?? process.argv[2] ?? ".bunny-scratch/inn-rest");
mkdirSync(OUT, { recursive: true });

// s235 quotes 8 BIT per Digimon and three Digimon are deployed, so the stay
// costs 24 and 1000 - 24 = 976. Each block starts damaged, so "healed" means a
// number actually moved: HP 120/400 and 60/310 and 5/290, MP 30/160, 10/140,
// 0/130. partyStats[0] is the lead's own block and is not a party member
// (web/game.js:813-814, web/inn.js partyOf) — the deployed party is
// [partnerStats, partyStats[1], partyStats[2]].
const DAMAGED = {
  partnerStats: { digimonId: 1, level: 20, xp: 0, hp: 120, maxHp: 400, mp: 30, maxMp: 160, stats: { str: 80, def: 55, spt: 40, wis: 40, spd: 45, chr: 30 }, bonuses: {}, elemBonuses: {} },
  partyStats: [
    { digimonId: 1, level: 20, xp: 0, hp: 120, maxHp: 400, mp: 30, maxMp: 160, bonuses: {}, elemBonuses: {} },
    { digimonId: 7, level: 17, xp: 0, hp: 60, maxHp: 310, mp: 10, maxMp: 140, bonuses: {}, elemBonuses: {} },
    { digimonId: 8, level: 15, xp: 0, hp: 5, maxHp: 290, mp: 0, maxMp: 130, bonuses: {}, elemBonuses: {} },
  ],
  bits: 1000,
};
// What each deployed member reads after F0x8001104C copies max into current:
// [hp, mp, maxHp, maxMp].
const FULL = [[400, 160, 400, 160], [310, 140, 310, 140], [290, 130, 290, 130]];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
// Seed the profile once per browser context. sessionStorage survives the reload,
// so the second entry (the title) sees the profile as the stay left it instead
// of being reset to the damaged fixture.
await page.addInitScript((seed) => {
  if (sessionStorage.getItem("innFixture")) return;
  sessionStorage.setItem("innFixture", "1");
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "45");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s235", x: 188, y: 184, dir: "up" }));
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.partnerStats));
  localStorage.setItem("partyStats", JSON.stringify(seed.partyStats));
  localStorage.setItem("bits", String(seed.bits));
}, DAMAGED);

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const hold = async (k, ms) => {
  await page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk })), k);
  await page.waitForTimeout(ms);
  await page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keyup", { key: kk })), k);
};
const snap = () => page.evaluate(() => {
  const s = window.__state;
  return {
    bits: s.bits,
    map: window.__mapInfo?.()?.id ?? null,
    party: (s.party ?? []).slice(),
    partner: s.partnerStats ? { hp: s.partnerStats.hp, mp: s.partnerStats.mp, maxHp: s.partnerStats.maxHp, maxMp: s.partnerStats.maxMp } : null,
    partyStats: (s.partyStats ?? []).map((x) => (x ? { hp: x.hp, mp: x.mp, maxHp: x.maxHp, maxMp: x.maxMp } : null)),
    innOpen: !!window.__inn?.isOpen?.(),
    inn: window.__inn?.diagnostics?.() ?? null,
    innSelection: window.__inn?.selection?.() ?? null,
    memcardOpen: !!window.__saveNative?.isOpen?.(),
    memcardWindow: window.__saveNative?.diagnostics?.()?.state?.window ?? null,
    memcardSlots: (window.__saveNative?.diagnostics?.()?.stores ?? []).map((x) => x.slot),
    memcardExit: window.__memcardExitScreen ?? null,
    titlePhase: window.__titleState?.()?.phase?.() ?? null,
    titleHighlight: window.__titleState?.()?.highlight?.() ?? null,
    ls: {
      bits: localStorage.getItem("bits"),
      partner: JSON.parse(localStorage.getItem("partnerStats") ?? "null"),
      partyStats: JSON.parse(localStorage.getItem("partyStats") ?? "null"),
    },
  };
});
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));
// The memory-card screen paints on the title canvas before the field exists
// (web/game.js continueLoadFrame).
const shotTitle = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#title-canvas").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));
// The translated screen's own step: 3 is the two-row prompt, once both folds have
// landed. A press is only judged after it.
const waitInnStep = (want) => page.waitForFunction((n) =>
  window.__inn?.isOpen?.() && (window.__inn.diagnostics?.().state?.step ?? null) === n, want, { timeout: 30000 });

const lines = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  lines.push(line);
  if (!ok) failures += 1;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** [hp, mp, maxHp, maxMp] for the three deployed members, lead first. */
const vitalsOf = (s) => [s.partner, ...s.partyStats.slice(1)]
  .map((x) => (x ? [x.hp, x.mp, x.maxHp, x.maxMp] : null));

const results = { errors };
try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started && window.__talkTarget, null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  for (let i = 0; i < 40; i++) {
    const busy = await page.evaluate(() => (window.__textbox?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false));
    if (!busy) break;
    await tap(" ");
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => window.__teleport(188, 184));
  await page.waitForTimeout(400);
  await hold("ArrowUp", 150);
  await page.waitForTimeout(300);
  results.target = await page.evaluate(() => window.__talkTarget());
  check("the player is facing the innkeeper", results.target?.npc === 20, JSON.stringify(results.target));

  await tap(" ");                       // the innkeeper speaks first
  await page.waitForTimeout(500);
  const spoke = await page.evaluate(() => window.__textbox?.isOpen?.() ?? false);
  check("the innkeeper speaks before the rest screen opens", spoke);

  // One press per page of the box, then its on_close (the bank-0x7A write) opens
  // the rest screen. The cap is a time limit, not a page count: the translated box
  // advances one page per press, so the count depends on how the line is split.
  let presses = 0;
  for (; presses < 40; presses++) {
    if (await page.evaluate(() => !!window.__inn?.isOpen?.())) break;
    await tap(" ");
    await page.waitForTimeout(400);
  }
  await waitInnStep(3);
  await page.waitForTimeout(200);
  results.innOpen = await snap();
  results.presses = presses;
  await shot("inn-open");
  check("closing the innkeeper's box opens the rest screen", results.innOpen.innOpen,
    `${presses} page press(es)`);
  check("the rest screen is the translated one", results.innOpen.inn?.execution === "translated",
    `execution=${results.innOpen.inn?.execution}`);
  check("the screen quotes s235's decoded price of 8 BIT per Digimon",
    results.innOpen.inn?.inn?.stage === 235 && results.innOpen.inn?.inn?.price === 8,
    JSON.stringify(results.innOpen.inn?.inn));
  check("the line the player reads is the decoded quote",
    results.innOpen.inn?.painted?.includes("Each Digimon\n8 BIT"),
    JSON.stringify(results.innOpen.inn?.painted));
  check("the screen counted the three deployed Digimon",
    results.innOpen.inn?.state?.party === 3, `party=${results.innOpen.inn?.state?.party}`);
  check("the prompt starts on \"Stay in Inn\"", results.innOpen.innSelection === 0,
    `selection=${results.innOpen.innSelection}`);

  await tap(" ");                       // circle = Stay
  await page.waitForFunction(() => !window.__inn?.isOpen?.(), null, { timeout: 60_000 });
  await page.waitForTimeout(300);
  results.afterRest = await snap();
  results.errorsAfterRest = errors.slice();
  await shot("inn-after-rest");
  check("resting threw nothing", results.errorsAfterRest.length === 0, results.errorsAfterRest.join("; "));
  check("the stay closed the rest screen", results.afterRest.innOpen === false);
  check("the stay charged the decoded total (1000 - 3 x 8)", results.afterRest.bits === 976,
    `bits=${results.afterRest.bits}`);
  check("the lead was healed to full",
    eq(vitalsOf(results.afterRest)[0], FULL[0]), JSON.stringify(results.afterRest.partner));
  check("both non-lead members were healed to full",
    eq(vitalsOf(results.afterRest), FULL), JSON.stringify(results.afterRest.partyStats));
  check("the stay was flushed to storage",
    results.afterRest.ls.bits === "976" && results.afterRest.ls.partner?.hp === 400 &&
    results.afterRest.ls.partner?.mp === 160 && results.afterRest.ls.partyStats?.[1]?.hp === 310 &&
    results.afterRest.ls.partyStats?.[2]?.hp === 290, JSON.stringify(results.afterRest.ls));

  // ── the card: the stay goes on the card so the reload can load it ──
  // The save itself is the real one — `openMemoryCard("save")`, the call the
  // inn's own save-point HANDOFF makes (web/game.js doStoryHandoff, and
  // engine/dw3/save-points.ts: s235 is save point 1, place index 43 = Asuka Inn)
  // — opened here through the lab's entry rather than by walking the innkeeper's
  // second dialogue. That dialogue is the same one this check already walked, and
  // its own branch re-opens the REST screen: driving it here charged the stay
  // twice and the wallet, which these checks measure, stopped being the subject.
  const slot = await saveToCard(page, async () => { await page.evaluate(() => window.__labOpen("save")); },
    { timeout: 60_000 });
  check("the stay was written to a card slot", slot != null, `slot=${slot}`);
  await page.waitForFunction((n) => JSON.parse(localStorage.getItem(`mcardSlot${n}`) ?? "null")?.record != null,
    slot, { timeout: 20_000 });
  const written = await page.evaluate((n) => JSON.parse(localStorage.getItem(`mcardSlot${n}`) ?? "null"), slot);
  check("the file on the card carries the stay's wallet and the inn's place",
    written?.record?.bits === 976 && written?.record?.placeIndex === 43,
    JSON.stringify({ bits: written?.record?.bits, placeIndex: written?.record?.placeIndex }));
  check("the card did not charge the stay a second time",
    results.afterRest.bits === 976 && (await page.evaluate(() => window.__state.bits)) === 976,
    `bits=${await page.evaluate(() => window.__state.bits)}`);

  // ── the reload: the title's Continue is the memory card in LOAD mode ──
  await page.goto(TITLE);
  await waitTitlePrompt(page, 40_000);
  await page.waitForTimeout(400);
  await tap("i");                       // START leaves the prompt
  await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 20_000 });
  results.titleMenu = await snap();
  // The two title options are the upper Start (highlight 0) and the lower
  // Continue (highlight 1); the decoded menu opens with the lower one lit.
  check("the title menu opens with Continue lit", results.titleMenu.titleHighlight === 1,
    `highlight=${results.titleMenu.titleHighlight}`);
  await tap("Enter");                   // circle on Continue = launch code 0xC00
  await page.waitForFunction(() => window.__saveNative?.isOpen?.(), null, { timeout: 40_000 });
  await page.waitForTimeout(600);
  results.continue = await snap();
  check("Continue opens the memory card in LOAD mode instead of starting the game",
    results.continue.memcardOpen && results.continue.memcardWindow === 2,
    JSON.stringify({ open: results.continue.memcardOpen, window: results.continue.memcardWindow }));
  await shotTitle("continue-memory-card-load");

  // Backing out with nothing loaded: the card's own exit writes 0xE00, and the
  // title answers it. This is the leg that used to drop the player into a game.
  const back = await backOutToTitle(page);
  results.afterBackOut = back;
  check("leaving the memory-card screen closes it and does NOT start the game",
    back.started === false && back.titleHidden === false, JSON.stringify(back));
  check("the card's exit selector was 0xE00, the title screen",
    back.exitScreen === 0xe00 && eq(back.transition, [0xe00, 0]),
    `selector=${back.exitScreen} transition=${JSON.stringify(back.transition)}`);
  check("the title's Press Start prompt is on screen again", back.phase === "prompt", `phase=${back.phase}`);
  await shotTitle("title-after-backing-out");

  // Continue again and load the file the stay was written to: the page reloads
  // into the field with the slot's snapshot restored.
  await openContinueCard(page);
  check("Continue opens the card a second time from the returned title",
    (await cardWindow(page)) === 2, `window=${await cardWindow(page)}`);
  await loadFromCard(page);
  await page.waitForTimeout(500);
  results.afterReload = await snap();
  check("loading the saved file closed the card and reloaded into the field",
    results.afterReload.memcardOpen === false && results.afterReload.map === "s235",
    JSON.stringify({ open: results.afterReload.memcardOpen, map: results.afterReload.map }));
  check("the loaded file kept the stay: the wallet, the lead and both members",
    results.afterReload.bits === 976 && eq(vitalsOf(results.afterReload), FULL),
    JSON.stringify({ bits: results.afterReload.bits, vitals: vitalsOf(results.afterReload) }));
  check("no page error on the whole route", errors.length === 0, errors.join("; "));

  // ── one pad owner: the card's own confirm is not the rest screen's ──
  // The double charge above was a RACE, and a check that only fires on a race
  // cannot prove a fix. So build the same overlap on purpose, from the same
  // pieces the race used: the real memory card, and the real translated rest
  // screen, up at the same time, then drive the card's own confirms.
  //
  // The original cannot be in this state. `f15` (~/ddw3/asm/dw2003/exe/f15.s:13-56)
  // keeps the loaded overlays in a LIST at D0x80055ccc and the "already loaded?"
  // word at D0x80055d28, so overlays stack and only the TOP library's task tree
  // is ticked — a rest screen left alive under the memory card never reads the
  // pad again, and the charge (exe/fns.s:2017-2019, one `subu`/`sw` of
  // price x party into the BIT cell) is taken exactly once inside the rest
  // screen's own step machine, which reaches that step only from the prompt's
  // Confirm (fns.s:1797-1807 sets the affordability test on the way).
  //
  // In the walker both screens are siblings and both read the same key, so before
  // the fix one Circle was charged by the rest screen AND advanced the card:
  // 1000 -> 976 for the stay, then 976 -> 952 under the card. The card's
  // exclusive dispatch branch now sits above the field's screens (web/game.js),
  // and the walker's card still samples the held word for itself.
  await page.evaluate(() => window.__labOpen("save"));
  await page.waitForFunction(() => window.__saveNative?.isOpen?.(), null, { timeout: 40_000 });
  await waitCardWindow(page, 2);
  const beforeOverlap = await snap();
  // The rest screen comes up UNDER the card, exactly as the race left it.
  await page.evaluate(() => window.__inn.open(window.__state, { map: "s235" }));
  await page.waitForFunction(() => !!window.__inn?.isOpen?.(), null, { timeout: 20_000 });
  await waitInnStep(3);
  const overlapCard = await cardWindow(page);
  for (let i = 0; i < 4; i++) await press(page, "Enter", 700);
  const duringOverlap = await page.evaluate(() => ({
    bits: window.__state.bits,
    rests: window.__inn?.diagnostics?.()?.rests ?? null,
    card: window.__saveNative?.diagnostics?.()?.state?.window ?? null,
  }));
  check("the rest screen and the memory card were both up (the overlap is real)",
    duringOverlap.card != null && (await page.evaluate(() => window.__inn?.isOpen?.())) === true,
    JSON.stringify({ card: duringOverlap.card, window: overlapCard }));
  check("the card's own confirms advanced the card",
    duringOverlap.card !== overlapCard, `${overlapCard} -> ${duringOverlap.card}`);
  check("the card did not charge the stay while the rest screen was under it",
    duringOverlap.bits === beforeOverlap.bits && duringOverlap.rests === 0,
    JSON.stringify({ bits: `${beforeOverlap.bits} -> ${duringOverlap.bits}`, rests: duringOverlap.rests }));
  await page.evaluate(() => window.__inn.close());
  await page.evaluate(() => window.__labClose());
  check("no page error after the overlap check", errors.length === 0, errors.join("; "));
} catch (e) {
  check(`the run threw: ${e.message}`, false);
  lines.push(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/verify-output.txt`, lines.join("\n") + "\n");
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
process.exit(failures === 0 ? 0 : 1);
