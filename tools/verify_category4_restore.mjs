// tools/verify_category4_restore.mjs — the category-4 heal-and-cure arm, driven in real play.
//
// THE SHARED SYSTEM: the record machine FIGHTSTG_F0x8008f714's category-4 handler
// `0x8008fbec` (`~/ddw3/asm/dw2003/pro/fightstg.s:13269`-`:13664`), the ONE routine behind all
// sixteen of the disc's heal and cure techniques, with six arms its own five id comparisons
// pick (`:13272`-`:13290`). Decode: docs/research/battle/battle-message-page-kinds-2026-10-04.md
// §11. Port: engine/dw3/battle-damage-terms.ts (`category4RestorePlan`,
// `damageTermCategory4Arm`), called once per side from web/battle.js (`battleRestorePlanFor`).
//
// What this check is FOR, because the unit census cannot show any of it: a category-4
// technique must reach the walker's own party RECORDS, not just the page builder. Each case
// gives the acting Digimon one real technique off the disc's own id, puts the party into the
// state the arm is about, uses the technique through the shipped command and Tech lists, and
// reads the three party HP/ailment values back at the first frame that carries the technique's
// result page — the player's action is complete by then and the enemy has not answered yet.
//
//   188 Final Heal   the three-slot party heal: ALL THREE standing members rise (pro/fightstg.s
//                    :13602-:13633, stride 0x20, three iterations, skipping an empty slot
//                    :13607 and a fallen one :13611). Before this port only the actor moved.
//   186 Full Heal   184..186 cap the number they print at the ACTIVE record's missing HP
//                    (`slt $v0, $a0, $a2` :13577 / `sw $a2, 0x68($s4)` :13582), so the box
//                    reads 820HP healed! for an 820-point wound and NOT the ~8900 the getter
//                    FIGHTSTG_F0x800a0108 returns — and `li $s0, 0x8` (:13579) is the delay
//                    slot of the branch at :13578, so kind 8 is asked either way.
//   191 Erase Poison the odd half of the cure window: every STANDING member carrying poison is
//                    cured, the clean one is not touched, and the page is kind 9.
//   196 Anti-Magic  the even half's all-ailments cure: BOTH members' ailments go, whatever the
//                    page said, because step 1 is a separate step from the page (:13420).
//   100 Crimson Flame  the fallen member alone is put back on its feet at its maximum, and its
//                    own ailment is NOT cleared — that arm touches no ailment byte.
//
// Math.random is pinned to 0 for the whole run (the walker's battle RNG is
// `RAND_U16 = (Math.random() * 0x10000) | 0`, engine/dw3/battle-formulas.ts:70), so every
// accuracy roll takes its first branch; the same stub tools/verify_battle_damage_terms.mjs
// uses. It is restored at the end.
//
//   python3 -m http.server 8979 --directory web &
//   VERIFY_PORT=8979 tools/run-playwright.sh tools/verify_category4_restore.mjs
//   CATEGORY4_ONLY=anti-magic VERIFY_PORT=8979 tools/run-playwright.sh tools/verify_category4_restore.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { runBattleTurn, tapCircle, waitForCommandMenu } from "./verify-battle-wait.mjs";

const OUT = process.env.CATEGORY4_SHOT || ".bunny-scratch/shots/category4-restore";
mkdirSync(OUT, { recursive: true });
const ROOT = baseUrl();
const failures = [];

const member = (digimonId, level, xp, maxHp) => ({
  digimonId, level, xp, tp: 10, hp: maxHp, maxHp, mp: 400, maxMp: 400,
  stats: { str: 400, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("pageerror", (e) => { failures.push(`PAGEERROR ${e.message}`); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("bits", "1000");
}, { lead: member(1, 30, 0, 900), rena: member(7, 28, 0, 600), pata: member(8, 28, 0, 400) });

const party = () => page.evaluate(() => (window.__battleB().playerRecords ?? []).map((r) => ({
  name: r.profile?.name, hp: r.hp, maxHp: r.maxHp,
  ailments: Object.keys(r.ailments ?? {}).filter((k) => r.ailments[k]),
})));
const panel = () => page.evaluate(() => {
  const p = window.__battle.peek();
  const spec = window.__battleB()._msgSpec ?? null;
  return { lines: p.messageLine?.frame?.lines ?? null, kind: spec?.kind ?? null,
    payload: spec ? (spec.payload ?? []).slice() : null, walker: p.message };
});
async function selectCommand(row) {
  await page.evaluate((r) => {
    window.__battleCmdNative?.close?.();
    window.__battleB().menuSel = r;
  }, row);
  await page.waitForFunction(() => {
    const p = window.__battle.peek();
    return p?.state === 2 && !!p?.commandList?.active && p?.loaderOpen === false;
  }, null, { timeout: 20_000 });
  await page.waitForTimeout(120);
}
async function settle() {
  await runBattleTurn(page, { ticks: 600, until: (snap) => snap.state === 2 && !snap.holds });
  await page.waitForFunction(() => {
    const p = window.__battle.peek();
    return p?.state === 2 && !!p?.commandList?.active && p?.loaderOpen === false;
  }, null, { timeout: 30_000 }).catch((e) => failures.push(`settle: ${e.message}`));
}

/** A fresh fight per case: an enemy that cannot be killed hits back, and a party that
 *  falls over ends the battle, so each case needs its own. */
async function restart() {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.evaluate(() => { window.__termOrigRandom = Math.random; Math.random = () => 0; });
  await page.evaluate(async () => {
    await window.__battle.start({ enemyId: 2, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
  });
  await waitForCommandMenu(page);
}

/**
 * Use one technique and read every box state it puts up, sampling rather than waiting for
 * a right instant, so a page that is up for only a few frames is still recorded. `expect` is
 * what a player must be able to see afterwards: the three party records, and the line two
 * that named the technique's result.
 */
async function useTechnique(label, techId, partyHp, ailments, RESULT_KIND, expect) {
  await restart();
  await page.evaluate(([techId, partyHp, ailments]) => {
    const b = window.__battleB();
    b.player.statsRecord.formLedger = [{
      id: b.player.profile.id, formLevel: 1, dvexp: 0, techSlots: [techId],
    }];
    b.enemy.hp = 99999; b.enemy.maxHp = 99999;
    b.player.mp = 400; b.player.maxMp = 400;
    (b.playerRecords ?? []).forEach((r, i) => {
      r.hp = partyHp[i];
      r.ailments = { ...(ailments?.[i] ?? {}) };
    });
  }, [techId, partyHp, ailments]);
  const before = await party();
  const enemyBefore = await page.evaluate(() => window.__battleB().enemy?.hp ?? null);
  await selectCommand(1);
  await tapCircle(page);                                      // confirm "Tech"
  await page.waitForFunction(() => window.__battle.peek().state === 3, null, { timeout: 20_000 })
    .catch(() => failures.push(`${label}: the Tech list did not open`));
  await tapCircle(page);                                      // row 0 of the Tech list
  const seen = [];
  // The enemy's own turn lands later and damages the lead, so the party's numbers are read
  // at the FIRST sample that carries this technique's result page -- the player's action is
  // complete by then and nothing else has run.
  let after = null;
  let enemyAfter = null;
  for (let i = 0; i < 40; i++) {
    const now = await panel();
    const key = JSON.stringify([now.kind, now.lines]);
    const fresh = !seen.some((x) => x.key === key);
    if (fresh) {
      seen.push({ key, kind: now.kind, lines: now.lines, payload: now.payload });
      await page.screenshot({ path: `${OUT}/${label}-${seen.length}.png` }).catch(() => {});
    }
    if (after === null && seen.some((x) => x.kind === RESULT_KIND)) {
      after = await party();
      enemyAfter = await page.evaluate(() => window.__battleB().enemy?.hp ?? null);
    }
    if (i % 2 === 0) await tapCircle(page);                  // a player reads each line
    await page.waitForTimeout(90);
  }
  await settle();
  console.log(`--- ${label} (record ${techId})`);
  console.log("  before", JSON.stringify(before));
  console.log("  after ", JSON.stringify(after));
  console.log("  box   ", JSON.stringify(seen.map((x) => [x.kind, x.lines])));
  const extra = { enemyBefore, enemyAfter };
  for (const [what, got, want] of expect(after, seen, extra)) {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`${label}: ${what} is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
      console.error("FAIL", label, what, JSON.stringify(got), "!=", JSON.stringify(want));
    } else {
      console.log(`  ok   ${what}: ${JSON.stringify(got)}`);
    }
  }
  return { techId, before, after, box: seen.map((x) => ({ kind: x.kind, lines: x.lines })) };
}

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.evaluate(() => { window.__termOrigRandom = Math.random; Math.random = () => 0; });
  const only = process.env.CATEGORY4_ONLY ?? null;
  const want = (label) => !only || only === label;
  const cases = [];
  const hp = (after) => (after ?? []).map((r) => r.hp);
  // A heal and a cure never touch the other side, so the enemy's HP is read across each case
  // rather than inferred from the pages.
  const ail = (after) => (after ?? []).map((r) => r.ailments.slice().sort());
  // The box reveals its second line a few frames after the spec changes, so the first sample
  // of a kind can still read ""; a LATER page of the same kind (kind 2 is the command gate
  // too) is a different sentence. So take the FIRST sample of that kind carrying words.
  const line2 = (seen, kind) => {
    const drawn = seen.find((x) => x.kind === kind && x.lines?.[1]);
    return drawn ? drawn.lines[1] : null;
  };

  // 188 Final Heal — every STANDING party member, not just the one that acted.
  if (want("party-heal")) {
    cases.push(await useTechnique("party-heal", 188, [100, 60, 40], null, 9, (after, seen, extra) => [
      ["all three party members rise", hp(after), [900, 600, 400]],
      ["the page is kind 9 and prints nothing", seen.some((x) => x.kind === 9), true],
      ["and the enemy took nothing at all", extra.enemyAfter, extra.enemyBefore],
    ]));
  }
  // 186 Full Heal — a wound the heal covers, so the number shown is the wound.
  if (want("active-heal")) {
    cases.push(await useTechnique("active-heal", 186, [80, 300, 300], null, 8, (after, seen) => [
      ["only the ACTIVE member rises", hp(after), [900, 300, 300]],
      // 900 - 80 = 820. The getter FIGHTSTG_F0x800a0108 returns ~8900 for this record at
      // this wisdom, so a page that printed the raw amount would read "8921HP healed!".
      ["the number is capped at the missing HP", line2(seen, 8), "820HP healed!"],
    ]));
  }
  // 191 Erase Poison — the odd half: every standing member carrying it, nothing else.
  if (want("erase-poison")) {
    cases.push(await useTechnique("erase-poison", 191, [300, 300, 300],
      [{ poison: true }, { poison: true }, {}], 9, (after, seen) => [
      ["both poisoned members are cured, the clean one untouched", ail(after), [[], [], []]],
      ["no member's HP moves", hp(after), [300, 300, 300]],
      ["the page is kind 9 and prints nothing", seen.some((x) => x.kind === 9), true],
    ]));
  }
  // 196 Anti-Magic — the even half's all-ailments cure, on a member at 1 HP too.
  if (want("anti-magic")) {
    cases.push(await useTechnique("anti-magic", 196, [300, 1, 300],
      [{ poison: true }, { frozen: true, confuse: true }, {}], 2, (after, seen) => [
      ["every ailment on both afflicted members is gone", ail(after), [[], [], []]],
      ["no member's HP moves", hp(after), [300, 1, 300]],
      ["the page names the all-ailments cure", line2(seen, 2), "All status cured!"],
    ]));
  }
  // 100 Crimson Flame — the one member on the floor gets its full HP back.
  if (want("crimson-flame")) {
    cases.push(await useTechnique("crimson-flame", 100, [300, 0, 300],
      [{}, { confuse: true }, {}], 9, (after, seen) => [
      ["only the fallen member is put back on its feet", hp(after), [300, 600, 300]],
      // `sb $zr, 0x1c($s0)` is in FIGHTSTG_F0x8008f5d4, the 375 helper, not in 100's arm.
      ["and its own confusion is NOT cleared", ail(after), [[], ["confuse"], []]],
      ["the page is kind 9 and prints nothing", seen.some((x) => x.kind === 9), true],
    ]));
  }

  writeFileSync(`${OUT}/result.json`, JSON.stringify({ cases, failures }, null, 2));
} catch (e) {
  console.error("THREW", e);
  failures.push(String(e));
} finally {
  await page.evaluate(() => { if (window.__termOrigRandom) Math.random = window.__termOrigRandom; }).catch(() => {});
  await browser.close();
}
console.log("RESULT " + JSON.stringify({ ok: failures.length === 0, failures }));
process.exit(failures.length ? 1 : 0);
