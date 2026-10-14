// The places system, end to end in the real page: entering a stage with a given
// route pair re-aims that stage's exits to the matching placePoints chain — the
// disc's copyPlacePoints, which runs on the stage's first tick (WS7 of
// docs/research/scripting/field-script-engine-verified.md; ledger
// places-copy-place-points-family-2026-10-10).
//
// This exercises the plumbing the unit tests cannot: web/game.js loads the scene,
// snapshots its base rows, and applyPlacePoints re-aims them inside setMap on every
// arrival, through the shipped scene data and the bundled engine. The walking-into-
// the-exit press itself is asserted at the row level (the row's own pair, which the
// route-pair commit publishes) and by tests/places-system.test.js.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_places_system.mjs
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";
import { chromium } from "playwright";

const ROOT = baseUrl(8742);
const PARTY = ["p003pken", "p005koet", "p004kogu"];

// What each (place, placeArg) must aim wstage835's two exits to — the audit's own
// measured numbers (field-script audit 2026-10-13), plus the (0,0) default the rig
// captured and the static placeholder an unmatched pair must leave standing. The
// fifth element is the pair the SLOT publishes: each point carries its own
// destination section, so a hole publishes (0,0) and a carried-on section
// publishes the same pair that was entered with.
const EXPECT = {
  "4:1": {
    0: ["s490", 160, 1000, "down", { d78: 0, d7a: 0 }],
    1: ["s850", 224, 288, "up", { d78: 4, d7a: 1 }],
  },
  "7:1": {
    0: ["s500", 1056, 488, "down", { d78: 0, d7a: 0 }],
    1: ["s825", 176, 376, "up", { d78: 7, d7a: 1 }],
  },
  "0:0": {
    0: ["s570", 720, 800, "down", { d78: 0, d7a: 0 }],
    1: ["s855", 160, 336, "up", { d78: 3, d7a: 1 }],
  },
  "99:99": {
    0: ["s835", 176, 328, "up", null],
    1: ["s835", 816, 248, "up-right", null],
  },
};

const browser = await chromium.launch();
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    storageState: {
      cookies: [],
      origins: [{
        origin: ROOT,
        localStorage: [
          { name: "engineSchema", value: "2" },
          { name: "party", value: JSON.stringify(PARTY) },
          { name: "charId", value: PARTY[0] },
        ],
      }],
    },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ROOT}/ui-lab.html`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const f = document.getElementById("game");
    return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
  }, null, { timeout: 30_000 });
  await page.waitForTimeout(800);
  const frame = page.frames().find((f) => f.url().includes("index.html"));

  // Arrive at `sid` with the pair published, the way a warp does: set the two
  // scalars, then setMap — the same order the transition code uses.
  const arrive = (sid, key, companion) => frame.evaluate(async ([s, k, c]) => {
    const st = window.__state;
    st.entryKey = k;
    st.entryCompanion = c;
    const idx = st.manifest.maps.findIndex((m) => m.id === s);
    window.__setMap(idx);
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
    const rows = (st.scenes[s]?.exits ?? []).filter((e) => "warp" in e);
    return {
      map: st.manifest.maps[st.mapIdx].id,
      rows: rows.map((e) => ({
        slot: e.slot, to: e.to, x: e.spawnX, y: e.spawnY, dir: e.dir,
        aimed: !!e.aimed, selfWarp: !!e.selfWarp,
        pair: e.routeWords ?? null,
      })),
      baseTo: (st.scenes[s]?._baseExits ?? []).filter((e) => "warp" in e).map((e) => e.to),
    };
  }, [sid, key, companion]);

  const check = (label, got, want) => {
    const row = got.rows.find((r) => r.slot === want.slot);
    assert.ok(row, `${label}: slot ${want.slot} exists`);
    assert.deepEqual([row.to, row.x, row.y, row.dir],
      want.cell, `${label}: slot ${want.slot} aims at the chain's point`);
    if (want.aimed) {
      assert.equal(row.aimed, true, `${label}: slot ${want.slot} is marked aimed`);
      assert.equal(row.selfWarp, false, `${label}: the placeholder is cleared`);
      assert.deepEqual(row.pair, want.pair, `${label}: slot ${want.slot} publishes its own pair`);
    } else {
      assert.ok(!row.aimed, `${label}: slot ${want.slot} keeps its static record`);
      assert.equal(row.selfWarp, true, `${label}: the static record is a self-warp`);
    }
  };

  // s835: the measured stage. Place 4 is the audit's number; place 7 the second;
  // (0,0) is the captured default; (99,99) matches nothing and leaves the slots.
  for (const [pair, want] of Object.entries(EXPECT)) {
    const [k, c] = pair.split(":").map(Number);
    const got = await arrive("s835", k, c);
    assert.equal(got.map, "s835");
    for (const slot of Object.keys(want)) {
      const [to, x, y, dir, publish] = want[slot];
      check(`s835 from ${pair}`, got, {
        slot: Number(slot), cell: [to, x, y, dir],
        aimed: pair !== "99:99", pair: publish,
      });
    }
    // The pristine base rows are never mutated, whichever pair arrived.
    assert.deepEqual(got.baseTo, ["s835", "s835"], "base rows stay the static placeholders");
    console.log(`  s835 from place ${pair}: ${got.rows.map((r) =>
      `${r.to}@(${r.x},${r.y})${r.aimed ? "*" : ""}`).join(" / ")}`);
  }

  // s875 was a dead stage before the places system: its static program is a single
  // self-warp and every exit is carried by the section table. From (2,1) its one
  // exit must lead to s890 at (928,128).
  const dead = await arrive("s875", 2, 1);
  assert.equal(dead.map, "s875");
  check("s875 from 2:1", dead, { slot: 0, cell: ["s890", 928, 128, "down"], aimed: true,
    pair: { d78: 2, d7a: 1 } });
  console.log(`  s875 from place 2:1: ${dead.rows.map((r) => `${r.to}@(${r.x},${r.y})*`).join(", ")}`);

  // The ui-lab harness itself hits one drawImage TypeError on a plain load, before
  // any of this probe's steps (reproduced with no probe actions at all); every
  // other page error is a failure.
  const unexpected = errors.filter((e) => !/drawImage/.test(e));
  assert.deepEqual(unexpected, [], "no page errors beyond the lab's own drawImage");
  console.log("places system OK — the exits follow the incoming place.");
} finally {
  await browser.close();
}
