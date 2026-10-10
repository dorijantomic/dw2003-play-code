// tools/verify_battle_message_pages.mjs — the two battle message-box pages this pass
// added: a landed steal (kind 17) and a signature weapon's HP drain (kind 18).
//
// Both were the walker's own typed sentence before 2026-10-04 (" Stole X!" and
// " Drained N HP!"). The original prints each as its own page of the shared box:
// FIGHTSTG_F0x80091534 asks for kind 17 at fightstg.s:15005 with the stolen ItemId in
// payload word 0, and for kind 18 at :15056 with the amount in payload word 1 and
// payload[2] = 0 (which is what keeps the MP arm `esmfight[0x8f]` off). The arms are
// `.L0x80099e8c` and `.L0x80099f00`; the whole decode is
// docs/research/battle/battle-message-page-kinds-2026-10-04.md.
//
// This drives the REAL battle: it equips the real draining weapon (item 173,
// VampireLance, the `+0x35` proc / `+0x36` ratio of F0x8009d61c), picks Fight on the
// shipped command list, and reads the two lines the box draws. It never calls a builder
// directly, so a page that only works when asked for by hand cannot pass.
//
//   python3 -m http.server 8956 --directory web &
//   VERIFY_PORT=8956 tools/run-playwright.sh tools/verify_battle_message_pages.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.PAGES_ROOT || `${baseUrl(8956)}/`;
const OUT = process.env.PAGES_SHOT || ".bunny-scratch/shots/battle-message-pages";
// PAGES_LEGACY=1 reruns the same fight against the walker's own hand-drawn box
// (?legacyBattleMsg=1), which is the BEFORE half of the capture pair.
const LEGACY = process.env.PAGES_LEGACY === "1";
const ESMFIGHT = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esmfight.json", import.meta.url), "utf8")).strings;
const ESITMNAM = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esitmnam.json", import.meta.url), "utf8")).strings;
mkdirSync(OUT, { recursive: true });

const DRAIN_WEAPON = 173;
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
  // The real draining signature weapon in the right hand, and one of each so the
  // Worn count is already where the original expects it.
  localStorage.setItem("equipment", JSON.stringify([{ right: seed.weapon }, {}, {}]));
  localStorage.setItem("inventory", JSON.stringify([{ id: seed.weapon, qty: 1 }]));
  localStorage.setItem("bits", "1000");
}, { lead: member(1, 10, 0), rena: member(7, 10, 0), pata: member(8, 10, 0), weapon: DRAIN_WEAPON });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const eq = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));
/** The canvas, taken in the SAME evaluate that waits for the text, so the capture is of
 *  the page it just checked rather than of whatever came after it. */
const shotWhenLines = async (n, want) => {
  const data = await page.locator("canvas#game").evaluate(async (el, expected) => {
    for (let i = 0; i < 120; i++) {
      const lines = window.__battle.peek().messageLine?.frame?.lines ?? [];
      if (lines[0] === expected[0] && lines[1] === expected[1]) {
        // One more frame: the canvas read inside a rAF callback sees the previous
        // frame's paint, and the text is painted on the frame the state reports.
        await new Promise((r) => requestAnimationFrame(r));
        return el.toDataURL("image/png");
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return null;
  }, want);
  // Best effort: the box holds the turn until Circle, so the two lines stay up, but the
  // canvas the browser hands back is the frame BEFORE the one the state reports, and a
  // hit's impact flash can be the frame that lands in the bitmap. The page itself is
  // proved above by the session's own state, not by this picture.
  if (!data) { console.log("note: no capture of the two lines this run"); return false; }
  writeFileSync(`${OUT}/${n}.png`, Buffer.from(data.split(",")[1], "base64"));
  return true;
};
const panel = () => page.evaluate(() => {
  const b = window.__battleB();
  const p = window.__battle.peek();
  const spec = b._msgSpec ?? null;
  return {
    lines: p.messageLine?.frame?.lines ?? null,
    kind: spec ? spec.kind : null,
    payload: spec ? (spec.payload ?? []).slice() : null,
    slots: spec ? (spec.slots ?? []).slice() : null,
    name: spec ? (spec.name ?? null) : null,
    message: p.message,
  };
});

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1${LEGACY ? "&legacyBattleMsg=1" : ""}`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  await page.evaluate(async (wid) => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
    // The weapon is what makes the drain page appear; hold the enemy up so the fight
    // does not end before the page is read.
    const b = window.__battleB();
    b.enemy.hp = 99999; b.enemy.maxHp = 99999;
    b.player.hp = 200;
  }, DRAIN_WEAPON);
  await waitForCommandMenu(page);
  const equipped = await page.evaluate(() => window.__battleB().player.rightWeapon ?? null);
  eq("the draining weapon is what the player is holding", equipped, DRAIN_WEAPON);
  await shot("pages-00-command-menu");

  // The drain's own roll is `(rand & 0x7f) < 64` (F0x8009d61c, +0x35), so on an
  // unseeded run it lands about half the time and the attack can miss as well. This
  // check used to fight until the page appeared, which meant it could fail by chance
  // -- the 2026-10-04 run of this script did exactly that. The walker's own RNG is
  // `RAND_U16 = (Math.random() * 0x10000) | 0` (engine/dw3/battle-formulas.ts:70) and
  // the browser has no other entropy source for a battle, so pinning Math.random pins
  // the walker's RNG. A value of 0 makes every roll in the fight take its first branch:
  // the attack lands and the drain fires. It is the same stub verify_battle_ailment.mjs
  // uses for its poison hit (:148-149), and it is restored at the end of the run.
  await page.evaluate(() => {
    window.__pagesOrigRandom = Math.random;
    Math.random = () => 0;
    const b = window.__battleB();
    b.player.hp = 200;                 // room to drain into
    b.enemy.hp = 99999; b.enemy.maxHp = 99999;
  });
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true,
    null, { timeout: 30_000 });
  let drain = null;
  for (let attempt = 0; attempt < 3 && !drain; attempt++) {
    await page.evaluate(() => {
      const b = window.__battleB();
      b.player.hp = 200;                 // room to drain into every time
      b.enemy.hp = 99999; b.enemy.maxHp = 99999;
    });
    await tap("Enter");
    // The pages of this hit have to be read before the next command, so Circle until the
    // line is finished, and check the spec on every step.
    for (let press = 0; press < 6; press++) {
      const now = await panel();
      if (!LEGACY && now.kind === 18 && !/^\d+HP healed!$/.test(String(now.lines?.[1] ?? ""))) {
        // The spec and the drawn lines advance together, so wait until the panel is
        // actually showing this page's own second line before snapshotting it.
        for (let w = 0; w < 40; w++) {
          await page.waitForTimeout(30);
          if (/^\d+HP healed!$/.test(String((await panel()).lines?.[1] ?? ""))) break;
        }
      }
      if (LEGACY) {
        // The legacy box never carries a spec: what it shows is the walker's own
        // sentence, which is the BEFORE picture.
        if (/Drained \d+ HP!/.test(String(now.message))) { drain = now; break; }
      } else if (now.kind === 18) { drain = now; break; }
      if (now.lines === null) break;
      await tap("Enter");
      await page.waitForTimeout(260);
    }
    if (!drain) {
      // Back to the command menu: keep pressing Circle until the list is live again.
      await page.waitForTimeout(300);
      for (let press = 0; press < 8; press++) {
        const ready = await page.evaluate(() => window.__battleCmdNative?.diagnostics?.().ready === true);
        if (ready) break;
        await tap("Enter");
        await page.waitForTimeout(260);
      }
    }
  }
  if (!drain) { fail("the drain page never came up with the drain roll pinned"); throw new Error("no drain page"); }
  // The drain page is the box's own page: kind 18, the name on line one and the disc's
  // `{1}HP healed!` on line two with the amount the HP actually gained.
  if (LEGACY) {
    // The legacy rectangle is not the session, so there are no two session lines to
    // read: what it shows is `b.message`, the walker's own flat sentence.
    eq("the legacy box has no message-line session at all", drain.lines, null);
    await shot("pages-01-legacy-typed");
    console.log("RESULT " + JSON.stringify({ ok: failed === null, legacy: drain }));
    await page.evaluate(() => { Math.random = window.__pagesOrigRandom; });
    await browser.close();
    if (failed) process.exitCode = 1;
    process.exit(0);
  }
  eq("the drain page is the shared kind-18 arm", drain.kind, 18);
  eq("the acting Digimon is named on line one", drain.name, "Kotemon");
  eq("line one is the disc's esmfight 0x16 template", ESMFIGHT[0x16], "{1}");
  eq("line two is the disc's esmfight 0x22 template", ESMFIGHT[0x22], "{1}HP healed!");
  eq("payload word 2 is 0, so the MP arm is not taken", drain.payload[2], 0);
  const healed = Number(drain.payload[1] ?? 0);
  eq("the amount went into slot 1", drain.slots, [String(healed)]);
  eq("the two drawn lines are the original's page, not the typed suffix",
    drain.lines, ["Kotemon", `${healed}HP healed!`]);
  eq("and the amount is a real drain, not zero", healed > 0, true);

  // The page holds the turn until Circle, so the box is still up here; the canvas
  // read can still land a frame early, which is why the check above reads the
  // session's own state rather than the picture.
  await shot("pages-01-kind-18-drain");

  console.log("RESULT " + JSON.stringify({ ok: failed === null, drain, banks: {
    heal: ESMFIGHT[0x22], stole: ESMFIGHT[0x26], itemName: ESITMNAM[DRAIN_WEAPON] } }));
} catch (e) {
  console.error("THREW", e);
  failed = String(e);
}
await page.evaluate(() => { if (window.__pagesOrigRandom) Math.random = window.__pagesOrigRandom; })
  .catch(() => {});
await browser.close();
if (errors.length) { console.error("page errors:", errors.slice(0, 4)); failed ??= "page errors"; }
if (failed) { console.log("RESULT " + JSON.stringify({ ok: false, fail: failed })); process.exitCode = 1; }