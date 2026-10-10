// Journey 7 post-game producer: the s780 reunion advances the story to 45.
//
// Source (authority 2): wstag780's leaf at file 0x1864-0x1870 stores 0x2d (45)
// into the master ordinal; the event is the OnEnterMap row `s780.auto.1500`
// (wstag event 1500, flag_key 014a0024), gated on flag 0x602B = ordinal 43 —
// the value wstag820's own setter writes after the terminal encounter. The
// event's script ends `HANDOFF 3587`; the movie's post-game return resolves to s925.
// Full current route/text/visited-flag proof: verify_story_s780_to_s925.mjs.
// Claim POST-CL-002 (partially_verified); the walker ladder is byStage.s780=[45].
//
// This drives the REAL producer with ordinary confirm presses. Only the
// prerequisites are seeded: the ordinal is 43 and the opening row
// `s780.auto.0` is already marked fired in the durable once store (what a real
// save at this point carries — otherwise the opening cutscene would replay).
// The 1500 cutscene is long, so the check sub-steps the sim with __gameSpeed=8
// while advancing it: the same authored frames run, only faster in wall-clock.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_postgame_reunion.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.POST_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.POST_SHOT || ".bunny-scratch/postgame-reunion";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
const fired = [];
page.on("console", (m) => {
  const hit = m.text().match(/EVENT FIRED (\S+)/);
  if (hit) fired.push(hit[1]);
});

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const shot = async (n) => writeFileSync(
  `${OUT}/${n}.png`,
  Buffer.from(
    (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64",
  ),
);
const state = () => page.evaluate(() => ({
  map: window.__state.manifest.maps[window.__state.mapIdx].id,
  ord: window.__engine.state.vars.get("$story.ordinal"),
  cut: window.__cutscene?.isActive?.() ?? false,
  busy: window.__engineBridge?.isBusy?.() ?? null,
  engineEvents: JSON.parse(localStorage.getItem("engineEvents") ?? "[]"),
}));

try {
  await page.goto(`${BASE}?noEncounters=1`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("progressOrdinal", "43"); // the s820 terminal result
    // A real save here has already played the opening row.
    localStorage.setItem("engineEvents", JSON.stringify(["s780.auto.0"]));
  });
  await page.goto(`${BASE}?skipTitle=1&map=s780&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 15_000 });
  await page.waitForFunction(
    () => window.__engine.state.vars.get("$story.ordinal") === 43,
    null, { timeout: 5_000 },
  );
  await page.waitForTimeout(1200);
  const onEntry = await state();
  await shot("postgame-reunion-entry");

  if (!fired.includes("014a0024"))
    await fail(`the s780 reunion row did not fire (fired=${JSON.stringify(fired)})`);
  if (fired.includes("014a0000"))
    await fail(`the opening row replayed instead of being skipped (fired=${JSON.stringify(fired)})`);
  if (onEntry.ord !== 43) await fail(`ordinal on entry ${onEntry.ord}, expected 43`);
  if (!onEntry.engineEvents.includes("s780.auto.1500"))
    await fail(`the reunion row's fired marker was not persisted (${JSON.stringify(onEntry.engineEvents)})`);

  // Advance the authored reunion cutscene. __gameSpeed sub-steps the same frames
  // (the script is ~200 ops of SAY/WAIT/WALKTO); it does not skip content.
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const t0 = Date.now();
  let done = null;
  for (let i = 0; i < 900 && Date.now() - t0 < 20_000; i++) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(20);
    if (i % 25 === 0) {
      const s = await state();
      if (s.ord === 45) { done = s; break; }
      if (!s.cut && !s.busy && s.ord !== 43) { done = s; break; }
    }
  }
  const after = await state();
  const final = done ?? after;
  // The ordinal store precedes the browser fade/field load. Do not mistake
  // seeing 45 on the outgoing field for a finished transition.
  await page.waitForFunction(() =>
    window.__state.manifest.maps[window.__state.mapIdx].id === "s925",
    null, { timeout: 15_000 });
  const arrived = await state();
  await page.waitForTimeout(400);
  await shot("postgame-reunion-after");

  if (final.ord !== 45)
    await fail(`reunion did not reach the post-game ordinal 45 (got ${final.ord}, cut=${final.cut}, busy=${final.busy})`);
  if (!final.engineEvents.includes("s780.auto.1500"))
    await fail(`the reunion marker was lost (${JSON.stringify(final.engineEvents)})`);
  if (arrived.map !== "s925")
    await fail(`the reunion movie return must land on s925; got ${arrived.map}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, onEntry, final: arrived, fired }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
