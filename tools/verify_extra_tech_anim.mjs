// An enemy-only Digimon (Kunemon, which has only idle / hit / basic-attack clips) uses techniques whose clips it
// does not have: the fallback (web/fight/clip-fallback.js) must give it a real animation, the technique's own
// effect, and a contact marker. Plays a spell (156 Thunder Bolt, clip 9), a combo (105 Heat Cutter, clip 6) and a
// support move (198 Double Power, clip 10) on the 3D renderer and records what the action script did.
//
// Server: python3 -m http.server 8791 --directory web
// Run:    VERIFY_PORT=8791 tools/run-playwright.sh tools/verify_extra_tech_anim.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.XT_ROOT || `${baseUrl(8791)}/`;
const OUT = process.env.XT_SHOT || "/tmp/xtshots";
mkdirSync(OUT, { recursive: true });
const extra = JSON.parse(readFileSync(resolve(HERE, "../web/assets/data/extra_species.json"), "utf8"));
const SPECIES = extra.digimon.find((d) => d.name === (process.env.XT_NAME || "Kunemon"));
const KUNEMON = SPECIES.id;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript((k) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  const ledger = [3, k].map((id) => ({ id, formLevel: 3, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }));
  const member = (digimonId, level, formLedger, equippedForms) => ({
    digimonId, level, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 400, maxMp: 400,
    stats: { str: 90, def: 60, spt: 50, wis: 50, spd: 60, chr: 20 },
    bonuses: {}, elemBonuses: {}, formLedger, equippedForms,
  });
  localStorage.setItem("partnerStats", JSON.stringify(member(3, 12, ledger, [k, 0, 0])));
  localStorage.setItem("partyStats", JSON.stringify([member(3, 12, ledger, [k, 0, 0]), member(7, 5, [], []), member(8, 5, [], [])]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
}, KUNEMON);

const shot = async (name) => { const c = await page.$("canvas"); writeFileSync(`${OUT}/${name}.png`, c ? await c.screenshot() : await page.screenshot()); };
const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };

try {
  await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !(await page.evaluate(() => !!window.__battle?.isActive?.()))) {
    if (await page.evaluate(() => window.__textbox?.isOpen?.() ?? false)) await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  await waitForCommandMenu(page);
  // become Kunemon through the game's own Digivolve path
  await page.evaluate((id) => window.__battleDv(id), KUNEMON);
  await page.waitForFunction((id) => window.__battleB?.()?.playerRecords?.[0]?.profile?.id === id, KUNEMON, { timeout: 60_000 });
  await waitForCommandMenu(page).catch(() => {});
  await page.waitForTimeout(7000);

  const play = async (call, techId, label) => {
    await page.evaluate(({ call, techId }) => {
      const r = window.__battle3d;
      window.__xt = { contacts: 0, maxFx: 0, ok: false };
      if (r.effectPlayer) r.effectPlayer.lastProjectile = null;
      const origDraw = r.getEffectDraw.bind(r);
      window.__xt.ok = call === "attack"
        ? r.playerAttack(techId, { onHit: () => { window.__xt.contacts++; } })
        : r.setPlayerAnimByTech(techId, { onHit: () => { window.__xt.contacts++; } });
      window.__xt.timer = setInterval(() => {
        const d = origDraw();
        if (d) window.__xt.maxFx = Math.max(window.__xt.maxFx, Array.isArray(d.list) ? d.list.length : (d.effects?.length ?? Object.keys(d).length));
      }, 50);
    }, { call, techId });
    for (const [i, ms] of [700, 700, 900].entries()) { await page.waitForTimeout(ms); await shot(`${label}-${i}`); }
    await page.waitForTimeout(2200);
    return page.evaluate(() => { clearInterval(window.__xt.timer); const { ok, contacts, maxFx } = window.__xt; return { ok, contacts, maxFx, samples: 0 }; });
  };

  const spell = await play("attack", 156, "spell");
  console.log("  spell", JSON.stringify(spell));
  expect(spell.ok, "Thunder Bolt (clip 9) found a script for a model that has none");
  expect(spell.maxFx > 0, "its effects were drawn");
  // the shot leaves the near side (our Kunemon) toward the far side: the player-authored direction is -z in flight space
  const lp = await page.evaluate(() => { const p = window.__battle3d.effectPlayer?.lastProjectile; return p ? { from: p.from, side: p.side } : null; });
  console.log("  projectile", JSON.stringify(lp));
  expect(!lp || lp.from[2] < 0, "a projectile of an owned enemy model flies from the near side toward the enemy");
  await shot("spell-after");

  // the species' own basic attack is its enemy-authored script: a shot in it must also fly away from the near side
  const basic = await play("attack", SPECIES.tech_basic, "basic");
  const bp = await page.evaluate(() => { const p = window.__battle3d.effectPlayer?.lastProjectile; return p ? { from: p.from } : null; });
  console.log("  basic", JSON.stringify(basic), "projectile", JSON.stringify(bp));
  expect(basic.ok && (!bp || bp.from[2] < 0), `${SPECIES.name}'s own basic attack aims at the enemy`);

  const combo = await play("attack", 105, "combo");
  console.log("  combo", JSON.stringify(combo));
  expect(combo.ok && combo.contacts > 0, "Heat Cutter (clip 6) plays, with a contact marker");

  const buff = await play("tech", 198, "support");
  console.log("  support", JSON.stringify(buff));
  expect(buff.ok, "Double Power (clip 10) plays");
  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
} catch (error) {
  console.error("ERROR", error.message);
  problems.push(error.message);
  try { await shot("failure"); } catch { /* page may be gone */ }
} finally {
  await browser.close();
}
console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exitCode = problems.length ? 1 : 0;
