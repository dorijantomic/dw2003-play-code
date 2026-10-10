// The first Zanbamon fight (s480 Jungle Grave) is a scripted, UNWINNABLE battle, and our
// build must model it that way.
//
// The disc gives the encounter a battle MODE: WFIGHTMN 0xfdc..0x10a8 selects mode 2 for the
// exact pair field screen 0x23a + battle id 0x0b, and the finalizer 0x800aabf0
// (asm/dw2003/pro/wfightmn.s:5003-5072) floors the PLAYER's landed damage so Zanbamon's HP
// can never fall below max/11. He cannot be killed in this encounter — "There is no way to
// beat him here" (docs/research/story-progression/WALKTHROUGH_FULL.txt:2989).
//
// The walker ported the rule (engine/dw3/battle-formulas.ts specialModeDamage) but wired it
// only into the item path, so an ordinary Fight could kill him. web/battle.js
// finalizePlayerDamage is the shared point the three player→enemy commits now call. This
// check drives the real encounter and shows the clamp in play:
//
//   AFTER  (as shipped): seed Zanbamon at the floor + 1, land a Fight — he SURVIVES at the
//                        floor (max/11), exactly as on the disc.
//   BEFORE (emulated):   the same battle with specialMode forced to 0 (the pre-fix state,
//                        where the finalizer was never reached) — the same hit takes him
//                        to 0 and the fight is winnable.
//
// Server: python3 -m http.server $PORT --directory web
// Run:    VERIFY_PORT=$PORT tools/run-playwright.sh tools/verify_zanbamon_scripted_loss.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu, runBattleTurn, tapCircle } from "./verify-battle-wait.mjs";

const PORT = Number(process.env.VERIFY_PORT || 8788);
const ROOT = process.env.ZSC_ROOT || `${baseUrl(PORT)}/`;
const OUT = process.env.ZSC_SHOT || ".dw3-research/zanbamon-scripted-loss-2026-10-08/shots";
mkdirSync(OUT, { recursive: true });

const SCREEN = 11;   // the s480 scripted block's record 0 = Jungle Grave / Zanbamon

// A party strong enough that one ordinary attack clears the floor test regardless of level.
const strong = {
  digimonId: 3, level: 40, xp: 0, tp: 60, hp: 4000, maxHp: 4000, mp: 400, maxMp: 400,
  stats: { str: 900, def: 600, spt: 600, wis: 600, spd: 500, chr: 40 },
  bonuses: {}, elemBonuses: {},
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("progressOrdinal", "8");   // s480's own beat (event 171 advances to 8)
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.lead, seed.lead]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("rosterOwned", "1");
}, { lead: strong });

const shot = async (n) => writeFileSync(`${OUT}/${n}.png`, await page.screenshot());

let failed = null;
const fail = (m) => { if (!failed) { failed = m; console.error("FAIL:", m); } };
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) fail(name + (detail ? ` (${detail})` : ""));
};

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s480&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started && window.__battle, null, { timeout: 40_000 });
  await page.waitForTimeout(400);

  // Pin the game's own RNG so every accuracy roll lands (as the sibling battle checks do).
  await page.evaluate(() => { Math.random = () => 0; });

  // Start the disc's own encounter: field screen s480, battle/screen 11.
  const opened = await page.evaluate(async (screen) => {
    await window.__battle.startScreen(screen, () => {}, null, () => {}, { mapId: "s480", lead: false });
    return true;
  }, SCREEN).catch((e) => String(e));
  check("the s480 scripted encounter starts", opened === true, String(opened));

  await waitForCommandMenu(page, { timeout: 40_000 });
  await shot("01-zanbamon-battle-open");

  const info = await page.evaluate(() => {
    const b = window.__battleB?.();
    return {
      screenId: b?.screenId ?? null,
      enemy: b?.enemy?.eStats?.digimon_id ?? b?.enemy?.profile?.name ?? null,
      maxHp: b?.enemy?.maxHp ?? null,
      specialMode: b?.specialMode ?? null,
    };
  });
  console.log("open:", JSON.stringify(info));
  check("the battle is screen 11 (Jungle Grave / Zanbamon)", info.screenId === SCREEN, `got ${info.screenId}`);
  check("the walker selects special battle mode 2 for it", info.specialMode === 2, `got ${info.specialMode}`);
  check("the enemy is Zanbamon", String(info.enemy).includes("Zanbamon"), String(info.enemy));

  const floor = Math.trunc(info.maxHp / 11);
  check("Zanbamon's HP floor is max/11 > 0", floor > 0, `floor=${floor} max=${info.maxHp}`);

  // One ordinary Fight against him, seeded at the floor + 1: the disc's finalizer must
  // refuse to let the hit pass the floor.
  const after = await swingOnce(page, floor + 1);
  console.log("AFTER (shipped, mode 2):", JSON.stringify(after));
  await shot("02-after-mode2-swing");
  check("AFTER: the Fight lands", after.landed, JSON.stringify(after));
  check("AFTER: Zanbamon SURVIVES at the floor (cannot be killed)",
    after.hp === floor, `hp=${after.hp} floor=${floor}`);
  check("AFTER: the displayed damage is the clamped value",
    after.message != null && after.message.includes(`took ${Math.max(1, floor + 1 - floor)} damage`),
    String(after.message));

  // BEFORE (the pre-fix state): the exact same hit with the finalizer bypassed. This is what
  // every special encounter did before finalizePlayerDamage was wired to the attack path.
  await page.evaluate(() => { window.__battleB().specialMode = 0; });
  const before = await swingOnce(page, floor + 1);
  console.log("BEFORE (mode 0, finalizer bypassed):", JSON.stringify(before));
  await shot("03-before-mode0-swing");
  check("BEFORE: the same Fight lands", before.landed, JSON.stringify(before));
  check("BEFORE: the hit drives Zanbamon's HP BELOW the floor (the finalizer was not applied)",
    before.hp < floor, `hp=${before.hp} floor=${floor}`);
  check("BEFORE: the displayed damage is the full, unclamped value",
    before.message != null && !before.message.includes("took 1 damage"), String(before.message));

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  fail(String(e?.stack || e));
  await shot("failure").catch(() => {});
} finally {
  console.log(failed ? `RESULT: FAIL — ${failed}` : "RESULT: PASS");
  await browser.close();
  process.exit(failed ? 1 : 0);
}

/**
 * Seed the enemy at `seedHp`, choose the ordinary Fight command (menu row 0), run the turn,
 * and report the enemy's HP and the line the box put up. `runBattleTurn` reads every line the
 * turn raises and pages every result, exactly as a player does.
 */
async function swingOnce(page, seedHp) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate((hp) => {
      Math.random = () => 0;   // every accuracy roll lands (the game's own RAND_U16 walks this)
      const b = window.__battleB();
      b.enemy.hp = hp;
      b.message = "";
    }, seedHp);
    // Reach the command phase again if the previous turn left a line up.
    await waitForCommandMenu(page, { timeout: 30_000 }).catch(() => {});
    await tapCircle(page);   // the list opens on Fight (row 0); Circle confirms it
    const trail = await runBattleTurn(page, {
      ticks: 120,
      until: (s) => s.gone || (s.msg && /took .* damage|defeated|evaded|Evade/.test(s.msg)),
    });
    const final = await page.evaluate(() => {
      const b = window.__battleB?.();
      const p = window.__battle?.peek?.();
      return {
        hp: b?.enemy?.hp ?? null,
        maxHp: b?.enemy?.maxHp ?? null,
        message: b?.message ?? null,
        active: !!window.__battle?.isActive?.(),
        resultPages: p?.messageLine?.text ?? null,
      };
    });
    const landed = trail.some((s) => s.msg && /damage/.test(s.msg));
    if (landed) return { ...final, landed, trail: trail.map((s) => s.msg).filter(Boolean) };
    await page.waitForTimeout(200);   // the swing missed; take another turn
  }
  const b = await page.evaluate(() => ({ hp: window.__battleB?.()?.enemy?.hp ?? null,
    maxHp: window.__battleB?.()?.enemy?.maxHp ?? null, message: window.__battleB?.()?.message ?? null }));
  return { ...b, landed: false, trail: [] };
}
