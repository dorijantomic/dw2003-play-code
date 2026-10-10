// tools/verify_battle_instant_death.mjs — the battle box when an instant-death KO lands.
//
// WHAT THE PLAYER SEES: nothing. The original's result-page chooser
// FIGHTSTG_F0x8008cb70 (~/ddw3/asm/dw2003/pro/fightstg.s:10141-:10656) tests the header's
// result-event queue in a fixed order, and its SECOND arm is queue slot 6 — the byte
// FIGHTSTG_F0x8009d470 writes when the instant-death roll lands. That arm zeroes the beaten
// member's HP (`sh $zr, 0x8($v1)` in the `jal` delay slot, `:10375`), puts the page object it
// had already allocated into its state 3 (`:10377`-`:10379`, which resets the line panel) and
// falls through to the drain with `self+0x58` still zero — so it never asks the page's `+0xac`
// show method for a kind, and never draws a line. Because that arm is tested BEFORE the
// landed-damage arm, the damage line for the same blow goes with it.
//
// This drives the REAL battle: it equips SoulChopper (item 186, the `+0x33` gate — one of the
// two right-hand weapons that carry an instant-death) and picks Fight on the shipped command
// list. The enemy's HP is held at 99999 so a normal blow can never be what drops it: HP 0 can
// only mean the KO fired. Math.random is pinned to 0, which pins the walker's RNG
// (`RAND_U16 = (Math.random() * 0x10000) | 0`) and makes the KO roll land every time.
//
//   python3 -m http.server 8963 --directory web &
//   VERIFY_PORT=8963 tools/run-playwright.sh tools/verify_battle_instant_death.mjs
//
// KO_LABEL=before writes the BEFORE half of the pair: run it against the code as it was
// before this change (the damage page was up).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.KO_ROOT || `${baseUrl(8963)}/`;
const OUT = process.env.KO_SHOT || ".bunny-scratch/shots/battle-instant-death";
const LABEL = process.env.KO_LABEL || "after";
const ESMFIGHT = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esmfight.json", import.meta.url), "utf8")).strings;
mkdirSync(OUT, { recursive: true });

const KO_WEAPON = 186; // SoulChopper — the +0x33 instant-death gate
const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 400, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{ right: seed.weapon }, {}, {}]));
  localStorage.setItem("inventory", JSON.stringify([{ id: seed.weapon, qty: 1 }]));
  localStorage.setItem("bits", "1000");
}, { lead: member(1, 10, 0), rena: member(7, 10, 0), pata: member(8, 10, 0), weapon: KO_WEAPON });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate(
    (el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

/** What the box is showing right now, and the enemy's HP. */
const box = () => page.evaluate(() => {
  const b = window.__battleB();
  const p = window.__battle.peek();
  const spec = b._msgSpec ?? null;
  return {
    lines: p.messageLine?.frame?.lines ?? null,
    kind: spec ? spec.kind : null,
    slots: spec ? (spec.slots ?? []).slice() : null,
    name: spec ? (spec.name ?? null) : null,
    message: String(p.message ?? ""),
    resultPages: (b._resultPages ?? []).slice(),
    enemyHp: b.enemy ? b.enemy.hp : null,
  };
});

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  await page.evaluate(async (wid) => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
    const b = window.__battleB();
    b.enemy.hp = 99999; b.enemy.maxHp = 99999;
  }, KO_WEAPON);
  await waitForCommandMenu(page);
  const equipped = await page.evaluate(() => window.__battleB().player.rightWeapon ?? null);
  if (equipped !== KO_WEAPON) fail(`the instant-death weapon is equipped: got ${equipped}`);
  await shot(`ko-00-${LABEL}-command-menu`);

  // Pin the walker's RNG so the KO roll lands on every attack, and hold the enemy up.
  await page.evaluate(() => {
    window.__koOrigRandom = Math.random;
    Math.random = () => 0;
    const b = window.__battleB();
    b.enemy.hp = 99999; b.enemy.maxHp = 99999;
    b.player.hp = 300;
  });
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true,
    null, { timeout: 30_000 });

  await tap("Enter");
  // Watch every step of the hit's page sequence: the KO's whole signature is that no page
  // is ever put up, so a single later step would prove it.
  const seen = [];
  let ko = null;
  for (let step = 0; step < 8 && !ko; step++) {
    let now = await box();
    seen.push(now);
    if (now.enemyHp === 0) { ko = now; break; }
    if (now.lines === null && now.resultPages.length === 0 && step > 0) break;
    await tap("Enter");
    await page.waitForTimeout(240);
  }
  if (!ko) {
    // The fight may already have advanced past the drop; take one more read.
    ko = await box();
    seen.push(ko);
  }
  await shot(`ko-01-${LABEL}-after-the-ko`);
  const after = await box();
  await shot(`ko-02-${LABEL}-settled`);

  console.log("RESULT " + JSON.stringify({
    ok: failed === null,
    label: LABEL,
    enemyHp: after.enemyHp,
    lines: after.lines,
    kind: after.kind,
    slots: after.slots,
    message: after.message,
    resultPages: after.resultPages,
    steps: seen.map((s) => ({ hp: s.enemyHp, kind: s.kind, lines: s.lines })),
  }));

  // The KO is only readable as a KO because the enemy was held at 99999: HP 0 here can
  // only be the instant-death arm, because a normal blow could never do that much.
  if (after.enemyHp !== 0) fail(`the KO dropped the enemy: hp ${after.enemyHp}`);

  // The whole point: at NO step of this hit did the box draw a damage line, and the
  // walker's own invented "was struck down!" never reached it. What DOES follow is the
  // fallen fighter's own page — the battle-flow machine's `esmfight[0x51]` "Defeated!"
  // (wfightmn.s:3265), a different machine from the one this change ports.
  const drewDamage = seen.filter((s) => /\d+\s*damage!/i.test(String(s.lines?.[1] ?? "")));
  if (drewDamage.length) {
    fail(`the damage line was drawn for the KO: ${JSON.stringify(drewDamage.map((s) => s.lines))}`);
  }
  for (const s of seen) {
    if (/was struck down/i.test(String(s.message ?? ""))) {
      fail(`the walker's invented line reached the box: ${s.message}`);
    }
  }
  // And the walker's own page list never held one either.
  if ((after.resultPages ?? []).some((t) => /damage!/i.test(String(t)))) {
    fail(`a damage line was put up for the KO: ${JSON.stringify(after.resultPages)}`);
  }
  console.log("note: the page after the KO is " + JSON.stringify(after.lines)
    + " (kind " + after.kind + ") — the fallen fighter's own page");
  await page.evaluate(() => { Math.random = window.__koOrigRandom; });
} catch (e) {
  fail(`threw: ${e.message}`);
  console.error(e);
} finally {
  if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
  await browser.close();
  if (failed) process.exitCode = 1;
}