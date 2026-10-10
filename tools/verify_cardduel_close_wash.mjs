// tools/verify_cardduel_close_wash.mjs — the duel's CLOSE full-screen wash.
//
// Claim `cardduel-start-end-wash-is-100-units-2026-09-13` (verified): the duel
// close sets the wash colour black and starts it toward white over countdown
// 100 (cardgame.s:33043, hold 0). The open half is already wired; this drives
// the close half and checks the value curve.
//
// Playing a whole duel to its end headlessly is not practical, so this uses the
// module's own posed-end hook `__endDuel(outcome)` (the same shape as the
// existing `__runBattleReactions`): it sets the outcome and takes the screen's
// beats down, the state the result window is dismissed from. The dismissal key
// then goes through the real `handleKey` -> `startCloseWash` path.
//
// Needs the lab served:  python3 -m http.server 8742 --directory web
// Run through the wrapper: tools/run-playwright.sh tools/verify_cardduel_close_wash.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/cardduel-close-wash";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
// The legacy duel: this check reads the old shell's own surface (labDuel.handleKey, labDuel.open), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "ok" : "FAIL"}: ${label}`);
  if (!ok) failures++;
};

// Open the duel and confirm through the challenge screen to the folder chooser.
await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  w.__labOpen("cardduel");
  w.__labDuel.open(null, "Opponent", null, 13);
});
await p.waitForTimeout(1500);
await p.evaluate(() => {
  document.getElementById("game").contentWindow.__labDuel.handleKey("circle");
});

// Confirm the chooser once its plates have arrived, then wait for beginDuel()
// and for the OPEN wash to drain.
const drain = await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  const d = w.__labDuel;
  const cv = document.createElement("canvas");
  cv.width = 320; cv.height = 240;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;
  while (!d.chooserArrival()?.ready && d.isOpen()) d.draw(g, 320, 240);
  const ready = d.chooserArrival()?.ready === true;
  d.handleKey("circle");
  let openedAt = -1;
  for (let i = 1; i <= 200; i++) {
    d.draw(g, 320, 240);
    if (openedAt < 0 && d.duel) openedAt = i;
    const ws = d.washState();
    if (openedAt > 0 && ws.value === 0 && ws.t === 0 && ws.closing === false) {
      return { ready, openedAt, drainedAt: i, wash: ws };
    }
  }
  return { ready, openedAt, drainedAt: -1, wash: d.washState() };
});
console.log(`chooser ready=${drain.ready}; duel opened at frame ${drain.openedAt}; open wash drained at frame ${drain.drainedAt}`);
check(drain.ready === true, "the folder plates arrive and take input");
check(drain.openedAt > 0, "the chooser confirm opens the duel");
check(
  drain.drainedAt > drain.openedAt && drain.wash.value === 0 && drain.wash.closing === false,
  "before the end: the open wash has drained and no close wash is running",
);

// Pose the duel end, dismiss the result window, and watch the close wash.
const run = await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  const d = w.__labDuel;
  const cv = document.createElement("canvas");
  cv.width = 320; cv.height = 240;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;

  const before = d.washState();
  const posed = d.__endDuel("win");
  const afterPose = d.washState();
  // Render the duel's result window before it is dismissed.
  d.draw(g, 320, 240);
  const resultPng = cv.toDataURL("image/png");

  d.handleKey("circle");
  const atStart = d.washState();

  // A second dismissal must not restart the running wash.
  d.handleKey("circle");
  const afterSecondPress = d.washState();

  const samples = [];
  const pngs = {};
  for (let i = 0; i < 130; i++) {
    d.draw(g, 320, 240);
    const s = { i: i + 1, ...d.washState(), open: d.isOpen() };
    samples.push(s);
    if (i + 1 === 50) pngs.half = cv.toDataURL("image/png");
    if (!d.isOpen()) { pngs.black = cv.toDataURL("image/png"); break; }
  }
  return { before, posed, afterPose, atStart, afterSecondPress, samples, pngs,
           resultPng, final: samples[samples.length - 1] };
});

check(run.posed === true, "the posed duel end is accepted");
check(run.before.value === 0 && run.before.closing === false, "no close wash before the end");
check(run.afterPose.value === 0 && run.afterPose.closing === false, "posing the end alone does not start the wash");
check(
  run.atStart.closing === true && run.atStart.value === 0 && run.atStart.total === 100,
  `dismissing the result starts the close wash at value 0 over 100 (value=${run.atStart.value}, t=${run.atStart.t})`,
);
check(run.afterSecondPress.t === 100 && run.afterSecondPress.value === 0,
  "a second dismissal does not restart the once-per-end wash");

const at = (t) => run.samples.find((s) => s.i === t);
const mid50 = at(50);
const mid90 = at(90);
console.log(
  `close wash: t=0 value=${run.atStart.value}; t=50 value=${mid50?.value.toFixed(3)}; `
  + `t=90 value=${mid90?.value.toFixed(3)}; final tick=${run.final.i} value=${run.final.value.toFixed(3)} open=${run.final.open}`,
);
check(mid50 && Math.abs(mid50.value - 0.5) < 0.03, `at 50 ticks the wash is about half blacked out (${mid50?.value.toFixed(3)})`);
check(mid90 && mid90.value > 0.85, `at 90 ticks the wash is most of the way to black (${mid90?.value.toFixed(3)})`);
check(run.final.value >= 0.99, `the wash reaches full black (${run.final.value.toFixed(3)})`);
check(run.final.open === false, "the screen closes only once the close wash has run");

writeFileSync(
  `${out}/close-wash-series.json`,
  JSON.stringify(run.samples.map((s) => ({ i: s.i, value: s.value, t: s.t, open: s.open })), null, 2),
);
for (const [name, url] of Object.entries({ "00-before-end": run.resultPng, "01-half": run.pngs.half, "02-full-black": run.pngs.black })) {
  if (url) writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
}
console.log(`wrote ${out}/close-wash-series.json and 3 PNGs`);
await b.close();
if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log("close wash OK");
