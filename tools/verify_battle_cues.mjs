// tools/verify_battle_cues.mjs — live-browser proof that the battle cues the 2026-10-05
// rig sweep found the original plays (and the walker once did not) actually ARRIVE at the
// walker's sound layer, at the moment the disc plays them. Each case is driven through the
// REAL game page (index.html) and the REAL web/audio.js players, and the assertion reads
// the arrived-at sound name / track name — not a source string.
//
// The triggers the probe pins (all code reads, docs/research/audio/sfx-triggers.md and
// sound-system.md):
//
//   COMCD103 0x800429bf  fightstg F0x800880f0 .L0x8008828c — the fight-opening actor's
//       cue, the same arm that applies the arena shot; it opens every battle.
//   COMEX102 0x8004413e  fightstg F0x8008c454 .L0x8008c4a0/.L0x8008c4d4 — a contact
//       marker whose damage result is 3 (an evade) substitutes this for the weapon's own
//       contact sound. The battle's own miss path calls playerAttack(..., {miss:true}).
//   W_JINGLE 0x6004001e  wfightmn win arm .L0x000034c0 — the victory jingle on the win.
//   0x60980000 boss04   fightstg F0x80086a00 .L0x80086e84-.L0x80086ea0 — the final boss's
//       mid-fight phase track, taken on the third landed player commit in battle mode 4.
//   EVOLUTIO + the saved-track replay: fightstg F0x80089cd8 .L0x8008a764-.L0x8008a778
//       re-plays [0x80042b30] once the digivolution jingle ends.
//
// Run (serve web/ first):
//   python3 -m http.server 8788 --directory web
//   VERIFY_PORT=8788 tools/run-playwright.sh tools/verify_battle_cues.mjs
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu, runBattleTurn, tapCircle } from "./verify-battle-wait.mjs";

const ROOT = process.env.CUE_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.CUE_REPORT || "/tmp/battle_cues_report.txt";
const WIN = 8;    // web/battle.js ST.WIN
const MENU = 2;   // web/battle.js ST.PLAYER_MENU

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 9999, maxHp: 9999, mp: 999, maxMp: 999,
  stats: { str: 400, def: 200, spt: 120, wis: 120, spd: 400, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const fail = [];
const lines = [];
const browser = await chromium.launch({ headless: true });

// Instrument the real players on whatever page is current: every cue that reaches the sound
// layer is recorded with the name/track it arrived as. Inert after a navigation, so it is
// re-applied once per page load.
async function instrument(page) {
  await page.waitForFunction(() => !!window.__sfx && !!window.__bgm && !!window.__battle,
    null, { timeout: 30_000 });
  await page.evaluate(() => {
    window.__cues = [];
    const rec = (fnName, args) => window.__cues.push({
      fn: fnName, a: args.map((x) => String(x)), t: Math.round(performance.now()),
    });
    const sfx = window.__sfx;
    for (const fn of ["play", "playBattle", "playBank", "playPacked", "playArea", "playSustained"]) {
      const orig = sfx[fn].bind(sfx);
      sfx[fn] = (...a) => { rec(fn, a); return orig(...a); };
    }
    const bgm = window.__bgm;
    const ob = bgm.play.bind(bgm);
    bgm.play = (trackId) => { rec("bgm.play", [trackId]); return ob(trackId); };
  });
}

const readCues = (page) => page.evaluate(() => window.__cues.map((e) => `${e.fn}:${e.a[0]}`));
const clearCues = (page) => page.evaluate(() => { window.__cues.length = 0; });
const has = (list, needle) => list.some((s) => s === needle);

// Boot the real game page fresh, start one battle, and settle at the command menu.
async function openBattle(page) {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await instrument(page);
  await clearCues(page);
  await page.evaluate(async () => {
    await window.__battle.start({ enemyId: 1, enemyLevel: 5, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
  });
  await page.waitForFunction(() => !!window.__battle3d, null, { timeout: 30_000 });
  await waitForCommandMenu(page);
  await page.evaluate(() => { const b = window.__battleB(); b.player.hp = 9999; b.player.maxHp = 9999; });
}

// One player turn: confirm the highlighted row, then let the fight run back to the menu (or
// end). Returns the state it settled on.
async function attackOnce(page, untilEnd = false) {
  await tapCircle(page);
  await runBattleTurn(page, { ticks: 80, until: (s) => (untilEnd ? s.state === WIN : s.state === MENU) || s.state === WIN });
  return page.evaluate(() => window.__battleB()?.state ?? null);
}

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  page.on("pageerror", (e) => console.error("PAGE", e.message));
  await page.addInitScript((seed) => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
    localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
    localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
    localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
    localStorage.setItem("bits", "1000");
    localStorage.setItem("inventory", "[]");
  }, { lead: member(1, 20, 0), rena: member(7, 20, 0), pata: member(8, 20, 0) });

  // ── Battle 1: the open cue, the evade substitute, and the final-boss phase track ──
  await openBattle(page);
  const openCues = await readCues(page);
  lines.push(`battle open         cue=${has(openCues, "play:comcd103") ? "comcd103" : "(none)"}   all=${openCues.filter((s) => s.startsWith("play:")).join(",") || "-"}`);
  if (!has(openCues, "play:comcd103")) fail.push(`COMCD103 did not play on battle open: ${JSON.stringify(openCues)}`);

  // COMEX102: the battle's own miss path calls playerAttack(tech_basic, { miss: true })
  // (web/battle.js:5859); this is that exact call, so the op10 hook runs the real
  // replacement and the arrived-at battle sound is the substitute.
  await clearCues(page);
  const techBasic = await page.evaluate(() => window.__battleB().player.profile.tech_basic);
  await page.evaluate((tech) => { window.__battle3d.playerAttack(tech, { miss: true }); }, techBasic);
  await page.waitForTimeout(3500);
  const evadeCues = await readCues(page);
  const battleSounds = evadeCues.filter((s) => s.startsWith("playBattle:"));
  lines.push(`evaded contact      cue=${has(battleSounds, "playBattle:comex102") ? "comex102" : "(none)"}   battle=${battleSounds.join(",") || "-"}`);
  if (!has(battleSounds, "playBattle:comex102"))
    fail.push(`COMEX102 did not play for an evaded contact: ${JSON.stringify(evadeCues)}`);

  // boss04: arm the Galacticmon counters two-commits-in and land the third.
  await page.evaluate(() => {
    const b = window.__battleB();
    b.specialMode = 4; b._bossPhaseCount = 2; b._bossPhaseDone = false;
    b.enemy.hp = 999999; b.enemy.maxHp = 999999;
    b.player.hp = 9999; b.player.maxHp = 9999;
  });
  await clearCues(page);
  let boss04 = false;
  for (let attempt = 0; attempt < 8 && !boss04; attempt++) {
    await attackOnce(page);
    boss04 = has(await readCues(page), "bgm.play:boss04");
    if (!boss04) await waitForCommandMenu(page).catch(() => {});
  }
  const bossLog = (await readCues(page)).filter((s) => s.startsWith("bgm.play:"));
  lines.push(`final-boss phase    cue=${boss04 ? "boss04" : "(none)"}   bgm=${bossLog.join(",") || "-"}`);
  if (!boss04) fail.push(`boss04 did not play on the third landed commit: ${JSON.stringify(bossLog)}`);

  // ── Battle 2 (fresh): W_JINGLE on a won battle ──────────────────────────────
  await openBattle(page);
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 1; b.enemy.maxHp = 1; });
  await clearCues(page);
  let won = false;
  for (let attempt = 0; attempt < 8 && !won; attempt++) {
    await attackOnce(page, true);
    won = await page.evaluate(() => window.__battleB()?.state === 8);
    if (!won) await waitForCommandMenu(page).catch(() => {});
  }
  const winCues = await readCues(page);
  lines.push(`won battle          state=${won ? 8 : "?"} cue=${has(winCues, "play:w_jingle") ? "w_jingle" : "(none)"}`);
  if (!has(winCues, "play:w_jingle")) fail.push(`W_JINGLE did not play on the win transition: ${JSON.stringify(winCues)}`);

  // ── Battle 3 (fresh): digivolution — EVOLUTIO then the saved-track replay ────
  await openBattle(page);
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 999999; b.player.hp = 9999; });
  await clearCues(page);
  const dvStarted = await page.evaluate(() => {
    const track = window.__battleB()._battleTrack;
    return { ok: window.__battleDv?.() ?? false, track };
  });
  await page.waitForFunction(() => window.__cues.some((e) => e.fn === "playBank" && String(e.a[0]) === "evo_00"),
    null, { timeout: 20_000 }).catch(() => {});
  const evolutioArrived = has(await readCues(page), "playBank:evo_00");
  await page.waitForFunction(() => !window.__battleB()?.blastShow, null, { timeout: 40_000 }).catch(() => {});
  await page.waitForTimeout(800);
  const dvCues = await readCues(page);
  const replay = dvStarted.track ? dvCues.filter((s) => s === `bgm.play:${dvStarted.track}`) : [];
  lines.push(`digivolution        evolutio=${evolutioArrived ? "evo_00" : "(none)"} replay=${replay.length ? replay[0] : "(none)"} track=${dvStarted.track ?? "-"}`);
  if (!evolutioArrived) fail.push(`EVOLUTIO did not start: ${JSON.stringify(dvCues)}`);
  if (!replay.length) fail.push(`the saved battle track did not replay after the digivolution: ${JSON.stringify(dvCues)}`);

  console.log(lines.join("\n"));
  writeFileSync(OUT, lines.join("\n") + "\n" + (fail.length ? "FAIL\n" + fail.join("\n") : "OK") + "\n");
  if (fail.length) { console.error("FAIL:\n" + fail.join("\n")); process.exitCode = 1; }
  else console.log("OK — every decoded battle cue arrived at its decoded moment.");
} finally {
  await browser.close();
}
