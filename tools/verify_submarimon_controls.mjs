// Live check of Submarimon's swimming in the real game (WORLD-Q004 + buoyancy).
//
// Asserts, through web/game.js itself rather than the engine module:
//   1. a seabed screen builds a Submarimon with motion state, inside the band;
//   2. left/right TURN the sub instead of walking it, and turning alone neither
//      moves it nor opens the throttle;
//   3. holding X drives it FORWARD along its facing and DOWNWARD at once, and
//      keys the SUB_MOVE thrust loop on (a sustained voice, still sounding past
//      the sample's own length);
//   4. releasing X coasts the hull to a stop while it floats back up, and keys
//      the thrust loop off;
//   5. depth keeps changing with no input at all, while the ground x/y that
//      collision and exit triggers read never moves;
//   6. Junior on a surface screen is completely unaffected.
//
// Test-rig notes, both learned the hard way:
//   * Route in with ?skipTitle=1&map=. Going through New Game leaves the opening
//     cutscene active, and an active cutscene legitimately freezes the field
//     (the walker's equivalent of the native scene_struct+0x50/+0x58/+0x5c
//     gate), so nothing would tick and every check would fail for the wrong
//     reason.
//   * The s825 route spawn (384,256) has only DOWN walkable. Thrust tests must
//     use a facing that is actually free, or collision correctly refuses to move
//     the sub and the test lies about it. Junior's leg uses s320 because s200
//     runs a story event on entry.
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = `${baseUrl(8741)}`;
const SEABED = "s825";
const SURFACE = "s320";
const BAND = { min: 0x1800, max: 0x7000 };

const browser = await chromium.launch();
let bad = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) bad++;
};
const hex = (n) => `0x${n.toString(16)}`;

/** Advance real frames; the field ticks at 50 Hz off the rAF clock. */
const settle = (page, ms) => page.waitForTimeout(ms);

const enter = async (page, map) => {
  await page.goto(`${BASE}/?skipTitle=1&map=${map}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });
  await settle(page, 1200);
};

const snap = (page) => page.evaluate(() => {
  const s = window.__state;
  return { x: s.x, y: s.y, dir: s.dir, sub: s.submarimon ? { ...s.submarimon } : null };
});

/** Park the sub at the ceiling, where the band clamp has zeroed its velocity. */
const parkAtCeiling = async (page) => {
  await settle(page, 4000);
  return snap(page);
};

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); bad++; });

  // ── 1. the sub exists, inside the water column ────────────────────────────
  await enter(page, SEABED);
  const start = await snap(page);
  check(!!start.sub, "seabed screen builds a Submarimon with motion state");
  if (!start.sub) throw new Error("no motion state; the rest cannot be checked");
  check(
    start.sub.heightFixed >= BAND.min && start.sub.heightFixed <= BAND.max,
    "sits inside the water column", `height=${hex(start.sub.heightFixed)}`,
  );
  check(start.sub.speedFixed === 0, "starts stationary");
  check(start.sub.facing === 0, "starts on the default facing", `facing=${start.sub.facing}`);

  // ── 2. left/right turn rather than walk ───────────────────────────────────
  const beforeTurn = await snap(page);
  await page.keyboard.down("ArrowRight");
  await settle(page, 700);
  await page.keyboard.up("ArrowRight");
  const afterTurn = await snap(page);
  check(
    afterTurn.sub.facing !== beforeTurn.sub.facing,
    "holding right ROTATES the sub", `${beforeTurn.sub.facing} -> ${afterTurn.sub.facing}`,
  );
  check(
    Math.abs(afterTurn.x - beforeTurn.x) < 0.5 && Math.abs(afterTurn.y - beforeTurn.y) < 0.5,
    "turning alone does not move it",
    `dx=${(afterTurn.x - beforeTurn.x).toFixed(2)} dy=${(afterTurn.y - beforeTurn.y).toFixed(2)}`,
  );
  check(afterTurn.sub.speedFixed === 0, "turning alone leaves the throttle shut");

  // ── 3. X drives forward AND down ──────────────────────────────────────────
  // Re-enter so the facing is the free one (down), and let the sub settle at the
  // ceiling first so its vertical velocity is a known zero — otherwise the dive
  // has to cancel existing upward momentum before the height turns over, which
  // is authentic but makes a short-window assertion meaningless.
  await enter(page, SEABED);
  const parked = await parkAtCeiling(page);
  check(
    parked.sub.heightFixed === BAND.max,
    "left alone, the sub floats to the ceiling and stops there", hex(parked.sub.heightFixed),
  );
  check(parked.sub.velocityFixed === 0, "the band clamp zeroes its climb");

  await page.keyboard.down("x");
  await settle(page, 900);
  const thrusting = await snap(page);
  check(thrusting.sub.speedFixed > 0, "holding X spins the throttle up", hex(thrusting.sub.speedFixed));
  check(
    thrusting.sub.heightFixed < parked.sub.heightFixed,
    "and the sub dives on the same hold",
    `${hex(parked.sub.heightFixed)} -> ${hex(thrusting.sub.heightFixed)}`,
  );
  const dist = Math.hypot(thrusting.x - parked.x, thrusting.y - parked.y);
  check(dist > 1, "and it travels along its facing", `moved ${dist.toFixed(1)} px`);
  check(
    thrusting.sub.speedFixed <= 0x266,
    "throttle never exceeds the PAL cap", `${hex(thrusting.sub.speedFixed)} <= 0x266`,
  );

  // ── 3b. the thrust LOOP sounds while the throttle is open (SUB-Q003) ──────
  // The native handler plays SUB_MOVE on the first thrust tick (handle at
  // [+0xc8] == -1) and stops it on release. The sustained-voice player is the
  // handle: debugSustained() lists the names it holds. The second half waits
  // past the sample's own duration at its decoded rate (5348 frames at
  // 0.15885 ≈ 0.76 s) — a one-shot would have ended and dropped out of the
  // map; only the ADPCM loop points keep it there.
  const sounding = await page.evaluate(() => window.__sfx?.debugSustained?.() ?? []);
  check(sounding.includes("sub_move"), "holding X keys the SUB_MOVE thrust loop on", JSON.stringify(sounding));
  await settle(page, 1400);
  const stillSounding = await page.evaluate(() => window.__sfx?.debugSustained?.() ?? []);
  check(
    stillSounding.includes("sub_move"),
    "and it LOOPS — still sounding past the sample's own length",
    JSON.stringify(stillSounding),
  );
  // Fresh throttle reading at the moment of release — the wait above let the
  // ramp climb, so the pre-release value is the one the drop is measured from.
  const preRelease = await snap(page);

  // ── 4. release coasts to a stop while rising ──────────────────────────────
  await page.keyboard.up("x");
  await settle(page, 200);
  const coasting = await snap(page);
  const afterRelease = await page.evaluate(() => window.__sfx?.debugSustained?.() ?? []);
  check(!afterRelease.includes("sub_move"), "releasing X keys the thrust loop off", JSON.stringify(afterRelease));
  check(
    coasting.sub.speedFixed < preRelease.sub.speedFixed,
    "releasing X bleeds the throttle off",
    `${hex(preRelease.sub.speedFixed)} -> ${hex(coasting.sub.speedFixed)}`,
  );
  await settle(page, 1800);
  const stopped = await snap(page);
  check(stopped.sub.speedFixed === 0, "the hull glides to a full stop");
  check(
    stopped.sub.heightFixed > coasting.sub.heightFixed,
    "and buoyancy floats it back up",
    `${hex(coasting.sub.heightFixed)} -> ${hex(stopped.sub.heightFixed)}`,
  );

  // ── 5. depth moves with no input; ground position does not ────────────────
  await enter(page, SEABED);
  const a = await snap(page);
  await settle(page, 700);
  const bSnap = await snap(page);
  check(
    bSnap.sub.heightFixed !== a.sub.heightFixed,
    "depth changes with NO input at all (buoyancy is a tick method)",
    `${hex(a.sub.heightFixed)} -> ${hex(bSnap.sub.heightFixed)}`,
  );
  check(
    Math.abs(bSnap.x - a.x) < 0.5 && Math.abs(bSnap.y - a.y) < 0.5,
    "while the ground position collision and exits read never moves",
    `dx=${(bSnap.x - a.x).toFixed(2)} dy=${(bSnap.y - a.y).toFixed(2)}`,
  );
  check(
    bSnap.sub.heightFixed <= BAND.max && bSnap.sub.heightFixed >= BAND.min,
    "and it stays inside the water column", hex(bSnap.sub.heightFixed),
  );

  // ── 6. Junior is untouched ────────────────────────────────────────────────
  await enter(page, SURFACE);
  const junior = await snap(page);
  check(junior.sub === null, "a surface screen drops the motion state entirely");
  // s320's route spawn has LEFT walkable (right is a wall), so steer left.
  await page.keyboard.down("ArrowLeft");
  await settle(page, 600);
  await page.keyboard.up("ArrowLeft");
  const juniorMoved = await snap(page);
  check(
    juniorMoved.x < junior.x,
    "and left still WALKS Junior rather than turning him",
    `dx=${(juniorMoved.x - junior.x).toFixed(1)}`,
  );
  check(juniorMoved.dir === "left", "his facing follows the D-pad", `dir=${juniorMoved.dir}`);
  check(juniorMoved.sub === null, "and he never acquires depth state");
} finally {
  await browser.close();
}

console.log(bad === 0 ? "\nALL CHECKS PASSED" : `\n${bad} CHECK(S) FAILED`);
process.exit(bad === 0 ? 0 : 1);
