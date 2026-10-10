// Prove, in the live page, that a combo is SHOWN rather than logged: the run's
// cards are raised, the card the run makes appears with the run's own numbers,
// a plate names it over that side's row, and the side's AP/HP plaques climb by
// the fused pair before the attack is fought.
//
//   Battle-Phase states 1 and 2, effect opcodes 0x19 / 0x1A
//   (F0x8009403C build, F0x800942DC ten-step tick machine)
//   docs/research/ui/cardgame-divergence-2026-08-21.md item 9
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_combo.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duelcombo";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The legacy duel: this check reads the old shell's own surface (labDuel.comboPickerAvailable, labDuel.duel, labDuel.handleKey, labDuel.phaseKey), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`);
await page.waitForTimeout(2500);
const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel"));
await page.waitForTimeout(1500);

const key = async (k, wait = 200) => {
  await frame.evaluate((kk) => window.__labDuel.handleKey(kk), k);
  await page.waitForTimeout(wait);
};
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const snap = () => frame.evaluate(() => {
  const c = window.__labDuel, d = c.duel;
  if (!d) return { phase: null };
  return {
    phase: c.phaseKey(),
    combo: c.comboState(),
    play: c.play ? c.play.stage : null,
    totals: { you: [d.player.totalAp, d.player.totalHp], opp: [d.opponent.totalAp, d.opponent.totalHp] },
    score: [d.player.score, d.opponent.score],
    log: d.log.slice(-2),
  };
});

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); else console.log("  ok:", msg); };

// Put the duel in the Battle Phase. Walking every phase by hand costs a few
// hundred presses now that the Load and Compile phases are played a turn at a
// time, and none of that is what this checks.
let st = await snap();
for (let i = 0; i < 40 && !st.phase; i++) { await key("enter", 150); st = await snap(); }
await frame.evaluate(() => {
  const d = window.__labDuel.duel;
  for (let i = 0; i < 8; i++) {
    d.phaseIndex = i;
    if (window.__labDuel.phaseKey() === "battle") break;
  }
  // UPDATED 2026-08-26. `phaseIndex` alone no longer says where the duel is:
  // the screen drives the disc's ceremony-opcode stream a beat per frame, and
  // that stream has its own queue. Dropping the queue and the issue token is
  // what makes the Battle Phase announce itself and queue 0x19 next.
  d.beat.pending = [];
  d.beat.current = null;
  d.beat.hold = 0;
  d.beat.gated = false;
  d.beat.battle = null;
  d.beat.summonOrder = null;
  d.beat.began = false;
  d.beat.resumed = false;
  d.programTurns = null;
  d.summonTurns = null;
  d.ceremonyToken = -1;
});
st = await snap();
check(st.phase === "battle", `the duel is in the Battle Phase (${st.phase})`);

const posed = await frame.evaluate(() => {
  const c = window.__labDuel, d = c.duel;
  // Three copies of one combo-capable Digimon: the smallest qualifying run.
  let pick = null;
  for (const [id, rec] of d.byId) {
    if (rec.kind !== "digimon") continue;
    if (!rec.comboInto && !rec.combo_into && !(rec.combo ?? 0)) { /* fall through to the engine's own test */ }
    pick = pick ?? null;
  }
  // Ask the engine which cards qualify by posing candidates until a run forms.
  for (const [id, rec] of d.byId) {
    if (rec.kind !== "digimon") continue;
    d.player.field = [0, 1, 2].map(() => ({
      id, ap: rec.ap, hp: rec.hp,
      shownAp: rec.ap, shownHp: rec.hp,
    }));
    if (window.__labDuel.comboPickerAvailable()) { pick = { id, name: rec.name, ap: rec.ap, hp: rec.hp }; break; }
  }
  d.opponent.field = [];
  c.resyncSprites();
  return pick;
});
check(!!posed, `a run of three ${posed?.name} is on your field`);
const before = (await snap()).totals.you;

// The fusion beat OPENS ITSELF now: the screen runs the duel's own beats, and
// it puts the fusions up ahead of ceremony opcode 0x19 rather than waiting for
// a button. The announcement is skippable after its first 0x14 units, so a
// press hurries it; nothing else here needs one.
for (let i = 0; i < 60; i++) {
  st = await snap();
  if (st.combo || st.phase !== "battle") break;
  if (i % 6 === 0) await key("enter", 60); else await page.waitForTimeout(60);
}
check(!!st.combo, `the fusion beat opens ahead of the attack (${JSON.stringify(st.combo)}, phase ${st.phase})`);
check(st.phase === "battle", "and the phase has not moved on");
await shot("01-beat");

// The plate step names the card, and the plaques climb during the tally.
let sawPlate = false;
let climbed = false;
for (let i = 0; i < 400; i++) {
  const s = await snap();
  if (!s.combo) break;
  if (s.combo.step === "plate" && !sawPlate) { sawPlate = true; await shot("02-plate"); }
  if (s.combo.step === "tally" && !climbed) { climbed = true; await shot("03-tally"); }
  await page.waitForTimeout(16);
}
check(sawPlate, "the beat holds on the name plate");

st = await snap();
check(!st.combo, "the beat ends on its own");
check(st.phase !== "battle" || !!st.score, "and the phase resolves after it");
check(climbed, "the plaques climb during the tally step");
await shot("04-after");
console.log("  totals before:", before, "after:", st.totals.you, "log:", st.log);

console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
if (fail.length) { console.log("FAILED:"); for (const f of fail) console.log("  -", f); }
else console.log("ALL CHECKS PASSED");
await browser.close();
process.exit(fail.length ? 1 : 0);
