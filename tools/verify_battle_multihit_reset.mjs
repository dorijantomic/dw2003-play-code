// tools/verify_battle_multihit_reset.mjs — Back Storm (technique 406) driven through the
// real battle menus, BEFORE and AFTER the dispatch-byte-0x1f arm (FIGHTSTG_F0x8009ddd8) was
// wired onto the ordinary route.
//
// WHAT THIS MEASURES. One technique on the whole disc carries dispatch byte 0x1f — 406
// "Back Storm", Raijinmon's move_2 — and the move resolver FIGHTSTG_F0x8009e0cc calls the
// reset F0x8009ddd8 for it INSTEAD of computing the single damage value the ordinary path
// carries. The reset seeds TWO hit slots, each with its OWN accuracy roll and its OWN damage
// leaf (F0x800a08c8 / F0x8009fab4), and the record machine applies their SUM
// (`pro/fightstg.s:13154`-`:13158`). Before the wiring the browser treated 406 as an ordinary
// single-hit technique (`resolveAttack`, from the record's f14 = 1); after it it runs the port.
//
// So the check drives the SAME record through the SAME menu, twice: once against the committed
// `HEAD` battle.js (served by request interception — the tree is untouched) and once against
// the working tree. It reports the enemy's HP loss and the box's own damage page each time, and
// CHARACTERISES the difference rather than calling it an improvement.
//
// Math.random is pinned to 0 for the whole run, so every accuracy roll takes its first branch
// and both slots land; the browser has no other entropy source (`RAND_U16`).
//
//   python3 -m http.server 8977 --directory web &
//   VERIFY_PORT=8977 tools/run-playwright.sh tools/verify_battle_multihit_reset.mjs
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { COMMAND_PHASE, runBattleTurn, tapCircle, waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.REPEAT_ROOT || `${baseUrl(8977)}/`;
const OUT = process.env.REPEAT_SHOT || ".bunny-scratch/repeat-dispatch";
mkdirSync(OUT, { recursive: true });

const TECH_ID = 406;
const RECORD = JSON.parse(readFileSync(
  new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"))[String(TECH_ID)];
if (RECORD.dispatch !== 0x1f) throw new Error(`record ${TECH_ID} is not dispatch 0x1f`);

const HEAD_BATTLE_JS = execFileSync("git", ["show", "HEAD:web/battle.js"],
  { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

const member = (digimonId) => ({
  digimonId, level: 20, xp: 0, tp: 10, hp: 500, maxHp: 500, mp: 400, maxMp: 400,
  stats: { str: 400, def: 80, spt: 220, wis: 50, spd: 90, chr: 30 }, bonuses: {}, elemBonuses: {},
});

const panel = (pg) => pg.evaluate(() => {
  const b = window.__battleB();
  const p = window.__battle.peek();
  const spec = b._msgSpec ?? null;
  const r = {};
  const j = (x) => { try { return JSON.parse(JSON.stringify(x)); } catch { return null; } };
  try { r.enemyKeys = Object.keys(b.enemy ?? {}); } catch { r.enemyKeys = null; }
  try { r.enemyElemBonuses = j(b.enemy?.elemBonuses); } catch { r.enemyElemBonuses = null; }
  try { r.enemyEStats = j(b.enemy?.eStats); } catch { r.enemyEStats = null; }
  try { r.playerElemBonuses = j(b.player?.elemBonuses); } catch { r.playerElemBonuses = null; }
  try { r.playerEStats = j(b.player?.eStats); } catch { r.playerEStats = null; }
  return {
    stats: r,
    enemyHp: b.enemy?.hp ?? null,
    message: p?.message ?? null,
    kind: spec ? spec.kind : null,
    payload: spec ? (spec.payload ?? []).slice() : null,
    slots: spec ? (spec.slots ?? []).slice() : null,
    lines: p?.messageLine?.frame?.lines ?? null,
  };
});

/** Drive one Back Storm turn and report the HP swing and the damage page. */
async function runCase(label, serveOldBattle) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (serveOldBattle) {
    await page.route("**/battle.js", (route) => route.fulfill({
      status: 200, contentType: "text/javascript; charset=utf-8", body: HEAD_BATTLE_JS,
    }));
  }
  await page.addInitScript((seed) => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(["p003pken"]));
    localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
    localStorage.setItem("partyStats", JSON.stringify([seed.lead]));
    localStorage.setItem("inventory", JSON.stringify([{ id: 1, qty: 1 }]));
    localStorage.setItem("bits", "1000");
  }, { lead: member(1) });

  let result;
  try {
    await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => { Math.random = () => 0; });
    await page.evaluate(async (techId) => {
      await window.__battle.start({ enemyId: 2, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
      const b = window.__battleB();
      b.enemy.hp = 99999; b.enemy.maxHp = 99999;
      b.player.hp = 500;
      // Give the acting Digimon Back Storm the way a form ledger carries it.
      b.player.statsRecord.formLedger = [
        { id: b.player.profile.id, formLevel: 1, dvexp: 0, techSlots: [techId] },
      ];
      b.player.mp = 400; b.player.maxMp = 400;
    }, TECH_ID);
    await waitForCommandMenu(page);
    const before = await panel(page);

    // Pick "Tech" (row 1), confirm, then its first row.
    await page.evaluate(() => { window.__battleCmdNative?.close?.(); window.__battleB().menuSel = 1; });
    await page.waitForFunction(() => {
      const p = window.__battle.peek();
      return p?.state === 2 && !!p?.commandList?.active && p?.loaderOpen === false;
    }, null, { timeout: 20_000 });
    await page.waitForTimeout(120);
    await tapCircle(page); // confirm "Tech"
    await page.waitForFunction(() => window.__battle.peek().state === 3, null, { timeout: 10_000 }).catch(() => {});
    await tapCircle(page); // pick row 0

    const seen = [];
    for (let press = 0; press < 24; press++) {
      const now = await panel(page);
      const key = JSON.stringify([now.kind, now.payload, now.lines]);
      if (now.kind !== null && !seen.some((s) => s.key === key)) seen.push({ key, ...now });
      if (now.enemyHp < before.enemyHp) break;
      if (now.kind === 4 && now.lines) break;
      await tapCircle(page);
      await page.waitForTimeout(180);
    }
    // Let the action settle so the enemy HP is the committed value.
    await runBattleTurn(page, { ticks: 40, until: (s) => s.state === COMMAND_PHASE && !s.holds })
      .catch(() => {});
    const after = await panel(page);
    const damagePage = seen.find((s) => s.kind === 4) ?? null;
    result = {
      label,
      served: serveOldBattle ? "HEAD battle.js" : "working tree",
      record: { id: TECH_ID, dispatch: RECORD.dispatch, category: RECORD.category,
        power: RECORD.power, f14: RECORD.f14 },
      defenderStats: after.stats ?? null,
      enemyHpBefore: before.enemyHp,
      enemyHpAfter: after.enemyHp,
      hpLost: before.enemyHp - after.enemyHp,
      damagePagePayload: damagePage ? damagePage.payload : null,
      damagePageLines: damagePage ? damagePage.lines : null,
      pages: seen.map((s) => ({ kind: s.kind, payload: s.payload, lines: s.lines })),
      pageErrors: errors.slice(0, 3),
    };
  } catch (e) {
    result = { label, error: String(e), pageErrors: errors.slice(0, 3) };
  }
  await browser.close();
  return result;
}

const before = await runCase("before", true);
const after = await runCase("after", false);
console.log("RESULT " + JSON.stringify({ before, after }, null, 2));
if (before.error || after.error) process.exitCode = 1;
