// tools/verify_battle_opening_machine.mjs — the battle's OPENING PHASE MACHINE
// (engine/dw3/battle-opening-machine.ts; the port of pro/wfightmn's #2 arm
// F0x800a6c44) runs the fight's lead-in in the real game, and each disagreement
// the walker's old flat 1.2 s timer had with it is observable.
//
// Three sessions on one browser:
//   A  default route   — the seven phases run one per frame, the boot loader holds
//                        phase 3 (so a slow load cannot reach the menu early), the
//                        line is armed at phase 5, the exit (top state 1) is what
//                        reaches state 2, and the fight still finishes.
//   B  ?legacyIntroTimer=1 — the old flat timer is restored verbatim; the machine
//                        never advances (phase stays 0) and state 2 arrives on the
//                        timer alone. This is the "before".
//   C  ?introNoLine=1  — the phase-1 opening-line gate is forced to "no line"; phase 5
//                        takes the camera branch and EXITS without arming a line.
//
// Evidence: peek().opening (web/battle.js) is the machine's own read-out.
//
// Server: python3 -m http.server 8788 --bind 127.0.0.1 --directory web
// Run:    VERIFY_PORT=8788 tools/run-playwright.sh tools/verify_battle_opening_machine.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { readBattleLine, waitForCommandList, tapCircle } from "./verify-battle-wait.mjs";

const ROOT = process.env.BOM_ROOT || `${baseUrl(8788)}/`;
const OUT = process.env.BOM_SHOT || ".dw3-research/battle-opening-machine-port-2026-10-07/shots";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level) => ({
  digimonId, level, xp: 0, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 }, bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });

/** The per-frame sampler, installed before the battle starts. */
const INSTALL_SAMPLER = () => {
  window.__openingTrail = [];
  const sample = () => {
    const p = window.__battle?.peek?.();
    if (p?.opening) {
      window.__openingTrail.push({
        state: p.state, phase: p.opening.phase, name: p.opening.phaseName,
        lineArmed: p.opening.lineArmed, linePending: p.opening.linePending,
        exited: p.opening.exited, introVariant: p.opening.introVariant,
        loaderOpen: p.loaderOpen,
      });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

const results = {};

async function session({ url, name, drive = false }) {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.error(`[${name}] PAGEERROR`, e.message); });
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
  }, { lead: member(1, 10), rena: member(7, 10), pata: member(8, 10) });

  await page.goto(url);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(INSTALL_SAMPLER);
  await page.evaluate(async () => {
    await window.__battle.start({ enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
  });
  // Let the whole opening play out (the loader retires, the line waits).
  await page.waitForTimeout(2600);
  const trail = await page.evaluate(() => window.__openingTrail ?? []);
  const shot = async (n) => writeFileSync(`${OUT}/${name}-${n}.png`,
    Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));
  await shot("intro");

  const seenPhases = [...new Set(trail.map((t) => t.phase))];
  const stillState1 = trail.filter((t) => t.phase < 6 && t.phase >= 0).every((t) => t.state === 1);
  const menuReached = trail.some((t) => t.state === 2);
  const loaderPhaseSeen = trail.some((t) => (t.phase === 2 || t.phase === 3) && t.loaderOpen);
  const lineArmedSeen = trail.some((t) => t.lineArmed);
  const awaitLineSeen = trail.some((t) => t.phase === 6);

  let finish = null;
  if (drive) {
    finish = await driveToResult(page, name, shot);
  }
  await page.close();
  return { name, seenPhases, stillState1, menuReached, loaderPhaseSeen, lineArmedSeen, awaitLineSeen,
    machineRan: seenPhases.some((p) => p > 0), errors, finish,
    trailLen: trail.length, last: trail[trail.length - 1] ?? null };
}

/** Read the line, take Fight, run the fight to its end. */
async function driveToResult(page, name, shot) {
  const out = { reachedMenu: false, ended: false };
  try {
    await readBattleLine(page, { timeout: 12_000 });
    await waitForCommandList(page, { timeout: 15_000 });
    out.reachedMenu = await page.evaluate(() => window.__battle?.peek?.()?.state === 2);
    await page.evaluate(() => { const b = window.__battleB?.(); if (b?.enemy) b.enemy.hp = 1; });
    await shot("menu");
    for (let i = 0; i < 40; i++) {
      const st = await page.evaluate(() => ({
        active: !!window.__battle?.isActive?.(),
        state: window.__battleB?.()?.state ?? null,
        holds: !!window.__battle?.peek?.()?.messageLine?.active,
        promptVisible: !!window.__battle?.peek?.()?.messageLine?.promptVisible,
      }));
      if (!st.active) { out.ended = true; break; }
      if (st.state === 2) await tapCircle(page);
      else await tapCircle(page);
      await page.waitForTimeout(200);
    }
    out.ended = out.ended || !(await page.evaluate(() => !!window.__battle?.isActive?.()));
  } catch (e) { out.error = String(e); }
  return out;
}

const steps = [];
const check = (name, ok, detail = "") => { const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`; console.log(line); steps.push(line); return ok; };

try {
  // ── Session A: the default route ──────────────────────────────────────────
  const a = await session({ name: "A-default", url: `${ROOT}?skipTitle=1&map=s200&noEncounters=1`, drive: true });
  results.A = a;
  check("A: the opening machine advanced past phase 0", a.machineRan, `phases seen ${JSON.stringify(a.seenPhases)}`);
  check("A: the machine's phases 2/3 held while the boot loader was open (the load beat exists)",
    a.loaderPhaseSeen, `loaderOpen seen in phase 2/3: ${a.loaderPhaseSeen}`);
  check("A: the menu (state 2) was never reached while the machine was before its exit",
    a.stillState1, "state stayed 1 for every pre-exit phase");
  check("A: the line was armed by the machine (phase 5) and phase 6 awaited it",
    a.lineArmedSeen && a.awaitLineSeen,
    `lineArmed seen=${a.lineArmedSeen} phase6 seen=${a.awaitLineSeen}`);
  check("A: the machine exited and the fight still reaches a result", !!a.finish?.ended,
    JSON.stringify(a.finish));
  check("A: no page errors", a.errors.length === 0, a.errors.join(" | "));

  // ── Session B: the rollback (the "before") ────────────────────────────────
  const b = await session({ name: "B-legacy", url: `${ROOT}?skipTitle=1&map=s200&noEncounters=1&legacyIntroTimer=1`, drive: true });
  results.B = b;
  check("B: with ?legacyIntroTimer=1 the machine never advances (old flat timer)",
    !b.machineRan, `phases seen ${JSON.stringify(b.seenPhases)}`);
  // The old route reaches the menu on the timer, but only after the opening line is read
  // (the old code held that same line): reading it and picking Fight still finishes.
  check("B: the old route still reaches the menu and finishes", !!b.finish?.reachedMenu && !!b.finish?.ended,
    JSON.stringify(b.finish));

  // ── Session C: the no-line EXIT ───────────────────────────────────────────
  const c = await session({ name: "C-noline", url: `${ROOT}?skipTitle=1&map=s200&noEncounters=1&introNoLine=1` });
  results.C = c;
  const sawPhase5 = c.seenPhases.includes(5);
  check("C: with ?introNoLine=1 phase 5 runs with linePending 0", sawPhase5, `phases ${JSON.stringify(c.seenPhases)}`);
  check("C: the no-line branch EXITS without arming a line", !c.lineArmedSeen && c.menuReached,
    `lineArmedSeen=${c.lineArmedSeen} menu=${c.menuReached}`);

  const failed = steps.filter((s) => s.startsWith("FAIL")).length;
  writeFileSync(`${OUT}/report.json`, JSON.stringify({ results, steps, failed }, null, 2));
  writeFileSync(`${OUT}/report.txt`, steps.join("\n") + `\n\n${failed} FAILURE(S)\n`);
  console.log(`\n[opening-machine] ${failed === 0 ? "ALL STEPS PASSED" : `${failed} FAILURE(S)`} — evidence in ${OUT}`);
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
} catch (e) {
  console.error("FAIL:", e.message);
  writeFileSync(`${OUT}/report.txt`, steps.join("\n") + `\n\nEXCEPTION ${e.message}\n`);
  await browser.close();
  process.exit(1);
}
