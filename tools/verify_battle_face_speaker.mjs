import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { waitForCommandMenu, runBattleTurn, COMMAND_PHASE } from "./verify-battle-wait.mjs";
import { baseUrl } from "./verify-base-url.mjs";

// THE CLOSE-UP BOX'S RULE (pro/fightstg, layer key 0x1009):
//   1. it shows OUR OWN Digimon and never the enemy, on either side's line —
//      FIGHTSTG_F0x80094064's state-1 arm asks the battle manager for ONE
//      fighter record and hands the box both that record and its +0x14, so the
//      speaker cannot move either (docs/research/battle/
//      battle-hud-ownership-check-2026-10-03.md §6.2; the live capture there
//      reads self+0x50 = 383 for a player line AND for an enemy line);
//   2. it is up while the command menu is up and gone the moment a battle line
//      is up, and back at the next menu (§5.1a; the five frames in
//      docs/research/battle/captures/face-box-rounds-2026-10-03/, and the ported
//      rule itself in engine/dw3/ui/native/battle-face-box.ts, pinned by
//      tests/engine/unit/battle-face-box.test.ts).
//
// The previous version of this check asserted the OPPOSITE of rule 1 — it
// required an enemy close-up during the enemy's turn and a changed picture
// between the two sides. That was the first pass's reading, which the capture
// rules out. Rule 2 (the box is down at a line, so there is no enemy close-up
// to find) is asserted here directly: at a line the viewport is gone.
//
// Server: python3 -m http.server $VERIFY_PORT --directory web
// Run:    VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_battle_face_speaker.mjs
const ROOT = process.env.FACE_ROOT || `${baseUrl(8752)}/`;
const BASE = ROOT + "?skipTitle=1&map=s245&noEncounters=1";
const OUT = process.env.FACE_SHOT || ".bunny-scratch/battle-face";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level) => ({
  digimonId, level, xp: 0, tp: 10, hp: 99999, maxHp: 99999, mp: 300, maxMp: 300,
  stats: { str: 200, def: 300, spt: 60, wis: 50, spd: 200, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("faceFixture")) return;
  sessionStorage.setItem("faceFixture", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", "null");
  localStorage.setItem("equipment", JSON.stringify([{}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, { lead: member(1, 10) });

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

// The whole rule, read back from the live canvas in one call: the box's viewport,
// how much contrast is inside it, and which model record the close-up came out of
// beside both fighters' own model keys.
const boxSignature = () => page.evaluate(() => {
  const cam = window.__battle?.debugFaceCam?.();
  const c = document.querySelector("canvas#game");
  if (!cam?.rect || !c) return { speaker: cam?.speaker ?? null, rect: cam?.rect ?? null, subject: cam?.subject ?? null, sig: null };
  const off = document.createElement("canvas");
  off.width = c.width; off.height = c.height;
  off.getContext("2d").drawImage(c, 0, 0);
  const r = cam.rect;
  const d = off.getContext("2d").getImageData(r.x, r.y, Math.max(1, r.w), Math.max(1, r.h)).data;
  let sr = 0, sg = 0, sb = 0, n = 0, vmax = 0;
  for (let i = 0; i < d.length; i += 4) { sr += d[i]; sg += d[i+1]; sb += d[i+2]; n++;
    vmax = Math.max(vmax, Math.abs(d[i]-d[i+1]) + Math.abs(d[i+1]-d[i+2])); }
  return { speaker: cam.speaker, rect: r, subject: cam.subject ?? null,
           sig: [Math.round(sr/n), Math.round(sg/n), Math.round(sb/n)], spread: vmax };
});
const results = { errors };
try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);

  // Production battle entry: the same createBattle object game.js uses.
  await page.evaluate(async () => {
    window.__faceResult = null;
    await window.__battle.start({
      enemyId: 2, enemyLevel: 1, screenId: 5,
      onWin: (res) => { window.__faceResult = { win: true, res }; },
      onFlee: () => { window.__faceResult = { fled: true }; },
      onLose: () => { window.__faceResult = { lost: true }; },
    });
  });
  await waitForCommandMenu(page);
  // Wait until both fighters' models are rendered and the box has a viewport.
  await page.waitForFunction(() => !!window.__battle?.debugFaceCam?.()?.rect, null, { timeout: 40_000 });
  await page.waitForTimeout(500);

  // ── frame 1: the round-1 command menu is up, so the box is up, and it is ours.
  results.menu1 = await boxSignature();
  await shot("face-menu1");

  await page.evaluate(() => { window.__battleB().enemy.hp = 99999; window.__battleB().enemy.maxHp = 99999; });
  await tap("Enter");   // the Fight row: the player's line
  // The whole turn, the way a player lives it: every line read, every results page
  // turned, back to the command menu. `onSnapshot` samples the box once per CHANGE of
  // (phase, line, speaker), which is where rule 2 and rule 1 are read from. Only a
  // snapshot with a line actually held is sampled — that is the state the box's rule
  // keys on, and the command phase it comes from is `menu1`.
  let left = false;
  results.trail = await runBattleTurn(page, {
    until: (s) => left && s.state === COMMAND_PHASE && !s.holds,
    onSnapshot: async (s) => {
      if (s.state !== COMMAND_PHASE) left = true;
      if (!s.holds) return;
      const box = await boxSignature();
      if (s.speaker === "enemy" && !results.enemyLine) {
        results.enemyLine = box; results.enemyMessage = s.msg;
        await shot("face-enemy-line");
      } else if (s.speaker === "player" && !results.playerLine) {
        results.playerLine = box;
        await shot("face-player-line");
      }
    },
  });
  // ── frame 4: back at the next round's menu, and the box is ours again.
  await page.waitForFunction(() => !!window.__battle?.debugFaceCam?.()?.rect, null, { timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  results.menu2 = await boxSignature();
  await shot("face-menu2");
} catch (err) {
  results.stepError = String(err?.message ?? err);
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
const name = (s) => JSON.stringify(s);
assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
assert(!results.stepError, `the run did not finish: ${results.stepError} ${name(results.enemyTrail ?? [])}`);

// RULE 2 — up at the command menu, down at a line, back at the next menu.
assert(results.menu1.speaker === "player", `menu speaker was ${results.menu1.speaker}`);
assert(results.menu1.rect, `no box at the command menu: ${name(results.menu1)}`);
assert(results.menu1.spread > 10, `player box looks blank: ${name(results.menu1)}`);
assert(results.playerLine && results.enemyLine,
  `the turn never showed a held line on both sides: ${name(results.trail)}`);
assert(results.playerLine.rect === null,
  `the box must be gone while a player line is up: ${name(results.playerLine)}`);
assert(results.enemyLine.rect === null,
  `the box must be gone while an enemy line is up: ${name(results.enemyLine)}`);
assert(results.menu2.rect, `the box must come back at the next command menu: ${name(results.menu2)}`);
assert(results.menu2.spread > 10, `the box came back blank: ${name(results.menu2)}`);

// RULE 1 — the subject is OUR OWN Digimon, never the enemy, on either side's
// line. Read off the box's own record lookup (web/battle3d.js
// `faceBoxSource(placementTable, modelKeyFromFolder(playerFolder), side)`).
for (const [label, box] of [["menu1", results.menu1], ["playerLine", results.playerLine],
                            ["enemyLine", results.enemyLine], ["menu2", results.menu2]]) {
  const s = box.subject;
  assert(s, `${label}: no model record behind the box: ${name(box)}`);
  assert(s.playerKey != null && s.playerKey !== s.enemyKey,
    `${label}: the fixture must give the two fighters different model keys: ${name(s)}`);
  assert(s.key === s.playerKey,
    `${label}: the box drew record ${s.key}, not our own Digimon's ${s.playerKey}: ${name(s)}`);
  assert(s.key !== s.enemyKey, `${label}: the box drew the ENEMY's record ${s.key}: ${name(s)}`);
}
// The speaker only picks WHICH of that one record's two framings is used
// (group 6 on a player line, group 7 on an enemy line), so the two must differ
// even though the record does not.
assert(results.playerLine.subject.side === "player" && results.playerLine.subject.group === 6,
  `a player line must take group 6: ${name(results.playerLine.subject)}`);
assert(results.enemyLine.subject.side === "enemy" && results.enemyLine.subject.group === 7,
  `an enemy line must take group 7 of the SAME record: ${name(results.enemyLine.subject)}`);
assert(results.enemyLine.subject.key === results.playerLine.subject.key,
  `the record moved when the enemy spoke: ${name(results.enemyLine.subject)}`);
console.log(JSON.stringify({ ok: true, results }, null, 2));
