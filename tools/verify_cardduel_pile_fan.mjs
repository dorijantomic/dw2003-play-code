// tools/verify_cardduel_pile_fan.mjs - the pile picker's fan reveal motion.
//
// Decoded 2026-09-14 from the original assembly (authority 2), closing gap row
// H6. The `count*4+10` widget is the centre-row pile FAN, not a HUD pile lift:
//   * F0x8009DBE8 places every card of the pile edge-on at its final fan x/y and
//     sets its sx to 0 (`sh $zr, 0x120($s4)`, cardgame.s 27729);
//   * F0x8009E668 starts card i's 10-frame LINEAR sx 0 -> 1 once its +0x4D0
//     cadence reaches 4 (then -= 4), passing `li a2,0xa / a3,0x1000` for the fan
//     family; the whole window is `count*4+10` (duel+0x4D8).
// Nothing moves in y and there is no fade. Claim
// `pile-fan-reveals-one-card-every-four-frames-2026-09-14`.
//
// The lap poses the pending pile choice directly (a fixture) and reads the
// shell's own `__labDuel.pileFanScale(i)`; it does not inject a success value.
//
// Needs the lab served:  python3 -m http.server 8742 --directory web
// Run:  .opencode/autonomy/check-browser tools/verify_cardduel_pile_fan.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { pileAnimDuration } from "../web/vendor/engine.js";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.env.DUEL_PILE_FAN_SHOT || ".dw3-research/autonomous-plan/shots/cardduel-pile-fan";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
// The legacy duel: this check reads the old shell's own surface (labDuel.duel, labDuel.pileFanScale), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "load" });
await page.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
const inGame = (fn) => page.evaluate((src) => {
  const w = document.getElementById("game").contentWindow;
  // eslint-disable-next-line no-new-func
  return new Function("w", src)(w);
}, fn);

const failures = [];
const check = (ok, m) => { if (!ok) failures.push(m); else console.log("  ok:", m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const eq = (a, b) => a.length === b.length && a.every((v, i) => near(v, b[i]));

try {
  check(pileAnimDuration(6) === 34, `the pile window for 6 cards is 34 ticks (got ${pileAnimDuration(6)})`);
  await inGame(`w.__labOpen("cardduel");`);
  await page.waitForTimeout(800);
  for (let i = 0; i < 60; i++) {
    if (await inGame(`return !!w.__labDuel.duel;`)) break;
    await inGame(`const c = w.__labDuel; c.handleKey(${JSON.stringify("enter")});`);
    await page.waitForTimeout(80);
  }
  check(await inGame(`return !!w.__labDuel.duel;`), "the duel started");

  // A fixture: six Program cards in hand and a pending hand-pile choice. The
  // picker is opened on the current tick, so the reveal clock starts here.
  //
  // The age-zero sample has to be taken in the SAME script that opens the
  // picker. `t0` is `c.ticks` as of the line above, and the screen runs its own
  // animation loop, so any reading taken later - even a few milliseconds later,
  // from a second evaluate - has already aged, and the fan was then sampled from
  // tick 2 with tick 0 simply never observed.
  const ageZero = await inGame(`
    const c = w.__labDuel, d = c.duel;
    const progs = [...d.byId.values()].filter((r) => r.kind === "program").slice(0, 6).map((r) => r.id);
    d.player.hand = progs.slice();
    d.player.handSlots = progs.map((_, i) => i);
    d.effectVm = { choice: { kind: "pile", side: d.player, zone: "hand", slots: [0, 1, 2, 3, 4, 5] } };
    c.effectPicker = { cursor: 0, t0: c.ticks };
    c.resyncSprites();
    return { age: c.ticks - c.effectPicker.t0,
             scales: [0, 1, 2, 3, 4, 5].map((i) => c.pileFanScale(i)) };
  `);
  check(await inGame(`const d = w.__labDuel.duel; return !!d.effectVm?.choice && d.effectVm.choice.kind === "pile";`),
    "a pile choice is pending (fixture)");

  const frames = await inGame(`
    const c = w.__labDuel;
    const cv = w.document.createElement("canvas"); cv.width = 320; cv.height = 240;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
    const read = () => ({ age: c.ticks - c.effectPicker.t0,
      scales: [0, 1, 2, 3, 4, 5].map((i) => c.pileFanScale(i)) });
    const out = [];                 // age 0 comes from the fixture, above
    const want = [0, 4, 5, 9, 14, 18, 25, 34];
    const png = {};
    for (let k = 0; k < 80; k++) {
      c.draw(g, 320, 240);
      const f = read();
      if (want.includes(f.age) && !out.some((o) => o.age === f.age)) {
        out.push(f);
        if (f.age === 14 || f.age === 34) png[f.age] = cv.toDataURL();
      }
      if (f.age >= 34) break;
    }
    return { out, png };
  `);
  frames.out = [ageZero, ...frames.out.filter((f) => f.age !== ageZero.age)];
  const at = (n) => frames.out.find((f) => f.age === n);
  console.log("  fan ages:", JSON.stringify(frames.out.map((f) => [f.age, f.scales.map((v) => +v.toFixed(2))])));
  check(eq(at(0).scales, [0, 0, 0, 0, 0, 0]), "at open every card is edge-on (sx 0)");
  check(eq(at(4).scales, [0, 0, 0, 0, 0, 0]), "the cadence must reach 4 before any card starts");
  check(eq(at(5).scales, [0.1, 0, 0, 0, 0, 0]), "card 0 starts at tick 4 (0.1 at tick 5)");
  check(eq(at(9).scales, [0.5, 0.1, 0, 0, 0, 0]), "card 1 starts exactly 4 ticks after card 0");
  check(eq(at(14).scales, [1, 0.6, 0.2, 0, 0, 0]), "card 0 is full; cards 1 and 2 are mid-ramp");
  check(eq(at(18).scales, [1, 1, 0.6, 0.2, 0, 0]), "the wave advances one card every 4 ticks");
  check(eq(at(25).scales, [1, 1, 1, 0.9, 0.5, 0.1]), "the last card starts at tick 24 (0.1 at 25)");
  check(eq(at(34).scales, [1, 1, 1, 1, 1, 1]), "all six are full at count*4+10 = 34, where the last ramp ends");
  for (const age of [14, 34]) {
    if (frames.png[age]) {
      writeFileSync(`${OUT}/pile-fan-t${age}.png`, Buffer.from(frames.png[age].split(",")[1], "base64"));
    }
  }

  if (errors.length) check(false, `${errors.length} page error(s)`);
} catch (e) {
  check(false, `check threw: ${e.message}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nFAILED:");
  for (const m of failures) console.error(" -", m);
  process.exit(1);
}
console.log("\nOK: the pile fan reveals one card every 4 frames over count*4+10");
