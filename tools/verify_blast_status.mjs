// tools/verify_blast_status.mjs — a Blast heals to full and clears ONLY the
// confusion bit; poison, frozen and sleep survive it.
//
// Authority: wfightmn F0x800a8bf4 state 2 (the Blast-on landing):
//     temp_s0->unk8 = temp_s0->unk6;             // hp = maxHP, unconditional
//     if (temp_s0->unk1C & 4) { ...; temp_s0->unk1C &= 0xFB; }  // clear CONFUSE
// plus FIGHTSTG_F0x800934f0 for the pip (any ailment bit -> state 3). The Blast
// itself is started through the game's own `window.__battleBlast` (the same
// triggerBlast the DV-gauge path calls). `digivolveDemo=0` is the pause-menu
// "Digivolve Demo: OFF" setting: it skips the 14 s cinematic only, the program
// still runs, so the landing heal and clear land in one update.
//
// Run: .opencode/autonomy/check-browser tools/verify_blast_status.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.BLAST_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.BLAST_SHOT || ".dw3-research/autonomous-plan/shots/blast-status";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, hp) => ({
  digimonId, level, xp: 0, tp: 10, hp, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("digivolveDemo", "0");   // pause-menu cinematic off
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, { lead: member(1, 10, 400), rena: member(7, 10, 400), pata: member(8, 10, 400) });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));
const read = () => page.evaluate(() => {
  const b = window.__battleB();
  return {
    hp: b.player.hp, maxHp: b.player.maxHp,
    ailments: Object.keys(b.player.ailments || {}).sort(),
    pip: window.__battle.debugPips().player[0],
    blast: b.blast ? { active: b.blast.active } : null,
  };
});

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
  });
  await waitForCommandMenu(page);
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });

  // Seeded prerequisites: hurt, confused AND poisoned; the gauge is full.
  await page.evaluate(() => {
    const b = window.__battleB();
    b.player.hp = 100;
    b.player.gauge = 999;
    b.player.ailments.confuse = { power: 5, recoveryTime: 5000 };
    b.player.ailments.poison = { power: 4, tickTime: 9000 };
  });
  const before = await read();
  if (before.hp !== 100 || JSON.stringify(before.ailments) !== JSON.stringify(["confuse", "poison"]))
    fail(`seeded state wrong: ${JSON.stringify(before)}`);
  if (before.pip !== 15) fail(`ailment pip before the Blast: ${before.pip}`);
  await shot("blast-before");

  // Start the real Blast, then wait for the landing heal.
  const armed = await page.evaluate(() => window.__battleBlast());
  if (!armed) fail("window.__battleBlast() found no Blast target for this profile");
  await page.waitForFunction(() => {
    const b = window.__battleB();
    return b.player.hp === b.player.maxHp;
  }, null, { timeout: 8000 });
  await page.waitForTimeout(300);
  const after = await read();
  await shot("blast-after");

  if (after.hp !== after.maxHp) fail(`the Blast did not full-heal: ${after.hp}/${after.maxHp}`);
  if (after.ailments.includes("confuse")) fail(`confusion survived the Blast: ${JSON.stringify(after.ailments)}`);
  if (!after.ailments.includes("poison")) fail(`poison must survive the Blast: ${JSON.stringify(after.ailments)}`);
  if (after.pip !== 15) fail(`the poison pip after the Blast: ${after.pip}`);
  if (!after.blast?.active) fail("the Blast was not active after the landing");

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, before, after,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
