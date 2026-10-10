// Journey 6 acceptance: a card gained in play survives a reload, and New Game
// clears the collection back to the starter deck.
//
// Measured before the fix: a story-flag grant added Gabumon (owned 1, seen),
// but a reload dropped it (owned 0) because the card collection was module-only
// state with no localStorage write anywhere. The collection is now serialized
// into the `cardCollection` save key on the grant path and by the shell's
// throttled sweep, and New Game clears it and re-seeds the 40-card starter deck.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_card_persistence.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.CP_ROOT || `${baseUrl(8741)}/`;
const BASE = ROOT + "?skipTitle=1&map=s210&noEncounters=1";
const OUT = process.env.CP_SHOT || "/tmp/card-persistence";
const GABUMON = 183;
const FLAG = 0x92b7;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

const collection = () => page.evaluate(async (id) => {
  const cs = await import("./cardstate.js");
  const col = cs.cards();
  return {
    owned: cs.ownedCount(col, id),
    seen: cs.seenCard(id),
    total: [...col.owned.values()].reduce((a, b) => a + b, 0),
    folders: col.folders.length,
    folder0: col.folders[0]?.cards?.length ?? 0,
    stored: !!localStorage.getItem("cardCollection"),
  };
}, GABUMON);

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };

try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForTimeout(600);

  const seeded = await collection();
  if (seeded.owned !== 0 || seeded.folders !== 3 || seeded.folder0 !== 40)
    await fail(`fixture not a fresh starter deck: ${JSON.stringify(seeded)}`);

  // The real card reward path: a dialogue state's on_close write into bank 0x92.
  await page.evaluate(() => window.__applyStoryFlag(0x92b7, 1));
  await page.waitForTimeout(300);
  const granted = await collection();
  await shot("card-after-grant");
  if (granted.owned !== 1 || !granted.seen || granted.total !== 41)
    await fail(`grant did not land: ${JSON.stringify(granted)}`);
  if (!granted.stored) await fail("grant path did not write the card save key");

  // A mutation through the engine directly (as the folder editor does) is caught
  // by the shell's throttled sweep. Take one card out of folder 0 and wait.
  await page.evaluate(async () => {
    const cs = await import("./cardstate.js");
    const eng = await import("./vendor/engine.js");
    eng.removeFromFolder(cs.cards(), 0);
  });
  await page.waitForTimeout(2600);

  // Reload is the browser's Continue: the collection must come back whole.
  await page.reload();
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForTimeout(600);
  const after = await collection();
  await shot("card-after-reload");
  if (after.owned !== 1 || !after.seen) await fail(`card did not survive reload: ${JSON.stringify(after)}`);
  if (after.total !== 41) await fail(`collection total ${after.total}, expected 41`);
  if (after.folder0 !== 39) await fail(`folder edit did not survive: ${JSON.stringify(after)}`);

  // New Game clears the collection and re-seeds the starter deck (F0x80016E6C).
  // Drive the REAL title the way a player meets it, because that is the order the
  // disc boots in: the country/language pick, then the opening movie it hands the
  // launcher, then the title itself. Booting `/` and waiting straight for the
  // title's prompt timed out forever (measured 2026-10-04: the title's own script
  // sat at state 0 / phase "slide" for 45 s because the shell only starts the
  // title's frame loop from the language screen's pick — web/game.js onPick).
  await page.goto(ROOT);
  await page.waitForFunction(() => window.__cntyselNative?.active?.() === true
    && window.__cntyselNative.diagnostics().host?.state?.state1 === 7, null, { timeout: 30_000 });
  // START confirms the language row, but the screen reads the pad once a field,
  // so the key is held long enough for one (the same press other checks use).
  const press = async (key, ms = 120) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(140);
  };
  let picked = null;
  for (let i = 0; i < 20 && !picked; i += 1) {
    await press("i");                                  // START confirms the language row
    picked = await page.evaluate(() => window.__bootLanguage ?? null);
  }
  if (!picked) await fail("the language pick never committed");
  // The pick hands the launcher an opening movie; START skips it.
  await page.waitForFunction(() => window.__titleMovie?.()?.open === true, null, { timeout: 30_000 });
  await press("i");
  await page.waitForFunction(() => window.__titleMovie?.()?.open === false, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "prompt", null, { timeout: 20_000 });
  await page.waitForFunction(async () => {
    const cs = await import("./cardstate.js");
    return !!cs.catalogReady?.() && !!cs.starter();
  }, null, { timeout: 10_000 });
  // "Press Start Button" answers START, not the confirm button: the prompt arm
  // polls the pad's identity button table with code 3 (pro/stdwtitl.s:2689-2698,
  // `li $a1, 0x3`), and code 3 IS pad bit 0x08 — the walker's START. So the split
  // is raised with "i"; Enter then moves the box and commits.
  await page.keyboard.press("i");
  await page.waitForFunction(() => window.__titleState().phase() === "menu", null, { timeout: 10_000 });
  await page.keyboard.press("ArrowUp"); // Continue -> Start
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 15_000 });
  await page.waitForTimeout(700);
  const afterNew = await collection();
  await shot("card-after-newgame");
  if (afterNew.owned !== 0 || afterNew.seen) await fail(`New Game kept the card: ${JSON.stringify(afterNew)}`);
  if (afterNew.folders !== 3 || afterNew.folder0 !== 40)
    await fail(`New Game did not re-seed the starter folders: ${JSON.stringify(afterNew)}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, seeded, granted, after, afterNew }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
