// Play the quest scene steps' EDGE CASES in the real game (Chromium), the ones that only exist while the field is
// running: a scene cut short, a mid-scene map change, F2 "Quests" switched off under one, HD asset mode, and every step
// that needs a live map (fx, fade, shake, weather, time, lightning, chase, ghost, battle, warp).
//
// Companion to tests/quest-edge.test.js (the pure half) and ~/scratch-research/quest-fx2/EDGES.md (the audit itself).
//
// Server: python3 -m http.server 8770 --directory web      (build first: python3 tools/build_quests.py --with-drafts)
// Run:    tools/run-playwright.sh tools/verify_quest_edges.mjs
// Shots:  $QE_SHOT (default ~/scratch-research/quest-fx2/edge)
//
// Every scene is played through the game's own entry point (window.__playQuestScene), i.e. the same call quests.js makes
// for a quest's scene, on the Bridge (s205) with Cipher (npc 1005) standing on it. "hang" means the scene never reached
// its END opcode inside the budget -- for a quest that is a soft-locked conversation, so it counts as a failure.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.QE_ROOT || `${baseUrl(8770)}/`;
const OUT = process.env.QE_SHOT || `${process.env.HOME}/scratch-research/quest-fx2/edge`;
mkdirSync(OUT, { recursive: true });
const BROWSER = await chromium.launch({ headless: true });
const problems = [];
const notes = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };
const note = (msg) => { console.log("note", msg); notes.push(msg); };
let shotN = 0;
const results = [];

let page = null;
let shots = 0;

async function openGame({ hd = false } = {}) {
  if (page) { await page.close().catch(() => {}); page = null; }
  page = await BROWSER.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => { console.error("PAGEERROR", e.message); problems.push("pageerror: " + e.message); });
  page.on("console", (m) => { if (/quest scene|quest fx|quest prop|SCENEEVENT/i.test(m.text())) console.log("  console:", m.text().slice(0, 200)); });
  await page.addInitScript((mode) => {
    const put = (k, v) => { if (localStorage.getItem(k) == null) localStorage.setItem(k, v); };
    localStorage.setItem("assetMode", mode);
    put("engineSchema", "2");
    put("progressOrdinal", "3");
    put("playerName", "Junior");
    put("charId", "p005koet");
    put("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
    put("packId", "B");
    put("bits", "1000");
    put("inventory", "[]");
    if (localStorage.getItem("dw.fx.v1") == null) localStorage.setItem("dw.fx.v1", "{}");
  }, hd ? "hd" : "authentic");
  await page.goto(`${ROOT}index.html?skipTitle=1&map=s205&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started && window.__quests && window.__playQuestScene, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
}

const snap = () => page.evaluate(() => ({
  map: window.__state?.scenes ? (window.__quests?.where?.().lastMap ?? null) : null,
  x: Math.round(window.__state?.x ?? 0), y: Math.round(window.__state?.y ?? 0),
  cut: window.__cutscene?.isActive?.() ?? false,
  tb: window.__textbox?.isOpen?.() ?? false,
  ch: window.__choice?.isOpen?.() ?? false,
  battle: window.__battle?.isActive?.() ?? false,
  fx: window.__questFx?.state?.() ?? [],
  fade: window.__questFx?.fade?.() ?? 0,
  drive: window.__questFx?.drive?.() ?? null,
  sky: window.__questFx?.sky?.() ?? null,
  shake: window.__questFx?.shake?.()?.batch ?? null,
  shakeOff: window.__questFx?.shake?.()?.offset ?? { x: 0, y: 0 },
  ghosts: window.__state?._questGhosts ? [...window.__state._questGhosts.keys()] : null,
  propsApi: typeof window.__questProps,
  chaseApi: typeof window.__questChase,
  tod: typeof window.__todForce === "number" ? Math.round(window.__todForce * 1000) / 1000 : null,
}));

/** Start a scene and keep the promise; `wait` decides when it is over (the scene's own END, or the budget). */
async function startScene(steps, budgetMs = 9000, { resetOnHang = true, shotAt = [] } = {}) {
  const t0 = Date.now();
  const done = page.evaluate(async ([steps, budgetMs]) => {
    const t = Date.now();
    const r = await Promise.race([
      Promise.resolve(window.__playQuestScene(steps)).then((v) => ({ v })),
      new Promise((res) => setTimeout(() => res({ hang: true }), budgetMs)),
    ]);
    return { ...r, ms: Date.now() - t };
  }, [steps, budgetMs]);
  const samples = [];
  let over = null;
  const pending = [...shotAt];
  const poll = (async () => {
    while (!over) {
      try {
        const s = await snap();
        const t = Date.now() - t0;
        samples.push({ t, ...s });
        while (pending.length && t >= pending[0][0]) await shot(pending.shift()[1]);
        // A quest scene's lines are the game's own box: the player presses to read on, so do exactly that.
        if (s.tb) {
          await page.evaluate(() => document.activeElement?.blur?.());
          await page.keyboard.press("Enter");
        }
      } catch { break; }
      await new Promise((r) => setTimeout(r, 110));
    }
  })();
  const result = await done;
  over = true;
  await poll.catch(() => {});
  results.push({ steps, result, samples: samples.length });
  // A scene that never ends would leave the game in a cutscene for every later check: start those from a clean field.
  if (result.hang && resetOnHang) {
    note("a scene did not reach its end; reloading the field before the next check");
    await openGame();
    await page.waitForTimeout(500);
  }
  return { ...result, samples };
}

/** A scene that could not run (or that we interrupted) must not poison the next check: reload the field if it is busy. */
async function ensureIdle(where) {
  const s = await snap();
  if (s.cut || s.tb || s.ch || s.battle) {
    note(`reset after ${where}: the field was left busy (cut=${s.cut} tb=${s.tb} battle=${s.battle})`);
    await openGame();
    await page.waitForTimeout(600);
  }
}

const shot = async (tag) => {
  const el = await page.$("canvas#game");
  const name = `${String(++shots).padStart(2, "0")}-${tag}.png`;
  if (el) writeFileSync(`${OUT}/${name}`, await el.screenshot());
  return name;
};

/** The fx a scene left on the map, ignoring props (they are owned by the quest state, not by a scene). */
const sceneFx = (s) => (s.fx ?? []).filter((e) => !String(e.name).startsWith("prop:"));

try {
  await openGame();
  const at = await snap();
  console.log("  on", at.map, "at", at.x, at.y, "| props api:", at.propsApi, "| chase api:", at.chaseApi);
  expect(at.x > 0 && at.y > 0, "the field is live on the Bridge");
  const P = { x: at.x, y: at.y };
  const box = [P.x + 48, P.y - 8];

  // ---- 1. a plain scene: speech, a wait, and the same step twice ------------------------------------------------
  {
    const r = await startScene([{ say: null, text: "edge: one" }, { wait: 10 }, { say: null, text: "edge: two" }, { wait: 6 }]);
    expect(!r.hang, `a speech + wait scene reaches its end (${r.ms} ms)`);
    expect(r.samples.some((s) => s.tb), "the words were in the game's own box");
    expect(sceneFx(r.samples.at(-1)).length === 0, "nothing is left on the map");
  }
  await ensureIdle("a plain scene");

  // ---- 2. two scenes in a row -----------------------------------------------------------------------------------
  {
    const a = await startScene([{ say: null, text: "edge: first scene" }, { wait: 6 }]);
    const b = await startScene([{ say: null, text: "edge: second scene" }, { wait: 6 }]);
    expect(!a.hang && !b.hang, "two scenes play back to back, neither hangs");
  }

  // ---- 3. the same effect step twice, then wait and remove it ---------------------------------------------------
  {
    const r = await startScene([
      { fx: "crate", at: box, clip: "land" }, { fx: "crate", at: [box[0] + 14, box[1]] }, { wait: 30 },
      { fxwait: "crate" }, { fxremove: "crate", fade: 4 }, { say: null, text: "edge: the crate is gone" },
    ]);
    const live = r.samples.filter((s) => sceneFx(s).some((e) => e.name === "crate"));
    expect(!r.hang, "fx twice + fxwait + fxremove completes");
    expect(live.length > 0, "the crate was on screen");
    expect(sceneFx(r.samples.at(-1)).length === 0, "and it was gone at the end");
    expect(await page.evaluate(() => window.__questFx.state().length) === 0, "the live list is empty afterwards");
  }

  // ---- 4. an effect whose sheet does not exist is skipped, the scene goes on -------------------------------------
  {
    const r = await startScene([{ fx: "no-such-sheet-anywhere", at: box }, { say: null, text: "edge: after the missing sheet" }]);
    expect(!r.hang, "a missing sheet is skipped, not waited on");
    expect(r.samples.some((s) => s.tb), "the line after it was still spoken");
  }

  // ---- 5. fade: to black and back, with a shake and a lightning flash in the middle ----------------------------
  {
    const r = await startScene([
      { fade: "out", frames: 12 }, { wait: 40 }, { shake: 6, frames: 24 }, { lightning: 1 }, { wait: 20 },
      { fade: "in", frames: 12 }, { say: null, text: "edge: light again" },
    ], 12000, { shotAt: [[500, "fade-black"], [1300, "fade-back"]] });
    expect(!r.hang, "fade + shake + lightning complete");
    expect(r.samples.some((s) => s.fade > 0.9), "the screen went black");
    expect(r.samples.at(-1).fade === 0 || (await snap()).fade === 0, "and came back");
    expect(r.samples.some((s) => s.shake), "a shake batch ran");
    expect(r.samples.some((s) => s.shakeOff && (s.shakeOff.x !== 0 || s.shakeOff.y !== 0)), "the field really moved");
    expect(r.samples.at(-1).shake === null, "and the shake ended");
  }

  // ---- 6. weather on a map that never has it, then clear -------------------------------------------------------
  {
    const r = await startScene([
      { weather: "fog", strength: 1, frames: 12 }, { wait: 60 },
      { weather: "clear", frames: 8 }, { wait: 8 }, { say: null, text: "edge: the fog is gone" },
    ], 12000, { shotAt: [[1200, "fog-on-the-bridge"]] });
    expect(!r.hang, "fog on the Bridge completes");
    const fog = r.samples.find((s) => s.sky && s.sky.weather === "fog" && s.sky.weatherRamp >= 1);
    expect(!!fog, `the fog faded in on a map with no fog in its profile (${fog ? JSON.stringify(fog.sky) : "never reached ramp 1"})`);
    const afterFog = await snap();
    expect(afterFog.sky === null, "and the scene put the sky back when it ended");
  }

  // ---- 7. night in the middle of the day, then the day comes back ----------------------------------------------
  {
    const before = (await snap()).tod;
    const r = await startScene([{ time: "night", frames: 12 }, { wait: 90 }, { say: null, text: "edge: night" }], 12000,
      { shotAt: [[1500, "night-on-the-bridge"]] });
    expect(!r.hang, "a time step completes");
    const dark = r.samples.find((s) => s.sky && s.sky.time === "night" && s.sky.timeRamp >= 1);
    expect(!!dark, `the day slid to night (${dark ? dark.sky.todForce : "never arrived"})`);
    expect(dark && dark.sky.todForce > 0.7, "todForce reached the night phase");
    const after = await snap();
    expect(after.sky === null, "the override is gone once the scene ends");
    expect(after.tod === before, `the panel's own time pin is handed back (${before} -> ${after.tod})`);
  }

  // ---- 8. a warp to a map that does not exist is skipped, the scene goes on -------------------------------------
  {
    const r = await startScene([{ warp: { map: "s99999", at: [100, 100] } }, { say: null, text: "edge: still on the Bridge" }]);
    expect(!r.hang, "a warp with no map is skipped");
    expect(r.samples.at(-1).map === "s205", "and the player did not move");
  }

  // ---- 9. a battle screen that does not exist: the scene must go on, not sit there ------------------------------
  {
    const r = await startScene([{ battle: 999999 }, { say: null, text: "edge: after a fight that could not start" }], 12000);
    expect(!r.hang, "a battle screen with no party is skipped, not waited on (a lost fight is a title screen, a missing one must be nothing)");
    if (!r.hang) expect(r.samples.at(-1).map === "s205", "the field is still there afterwards");
  }

  // ---- 10. ghost: a faded, tinted figure for the rest of the scene ---------------------------------------------
  {
    const r = await startScene([{ ghost: 1005, alpha: 0.4, tint: "#9fc8ff" }, { wait: 20 }, { ghost: 1005, off: true }, { wait: 6 }], 8000);
    expect(!r.hang, "the ghost step completes");
    expect(r.samples.some((s) => Array.isArray(s.ghosts) && s.ghosts.includes(1005)), "the ghosted character is registered with the renderer");
    expect((await snap()).ghosts?.length === 0, "and restored when the scene ends");
  }

  // ---- 11. chase: the target runs, the player keeps control ----------------------------------------------------
  {
    const r = await startScene([{ chase: 1005, path: [[P.x + 60, P.y], [P.x + 120, P.y]], speed: 40, lose: 400, frames: 240 }, { say: null, text: "edge: caught up" }], 12000);
    expect(!r.hang, "a chase completes");
    expect(r.samples.some((s) => s.chaseApi === "function"), "the chase machine is installed in the game");
  }

  // ---- 12. a map change in the middle of a scene -----------------------------------------------------------------
  {
    const scene = startScene([{ weather: "fog", strength: 1, frames: 6 }, { wait: 600 }], 6000, { resetOnHang: false });
    await page.waitForTimeout(700);
    const mid = await snap();
    expect(!!mid.sky, "the scene's sky is up before the map change");
    await page.evaluate(() => {
      const idx = window.__state.manifest.maps.findIndex((m) => m.id === "s320");
      return window.__setMap(idx);
    });
    await page.waitForTimeout(1200);
    const after = await snap();
    expect(after.map === "s320", `the debug jump put the field on s320 (${after.map})`);
    expect(after.sky === null, "a map change takes the scene's weather with it (stage entry clears it)");
    expect((await page.evaluate(() => window.__questFx.state().length)) === 0, "and its effect art");
    scene.catch(() => {});
    await shot("after-map-change");
  }
  // reload: that scene was left mid-wait on another map
  await openGame();
  await page.waitForTimeout(600);

  // ---- 13. F2 -> Quests off while a scene is showing -----------------------------------------------------------
  {
    const scene = startScene([{ weather: "fog", strength: 1, frames: 6 }, { fx: "crate", at: box, clip: "land" }, { wait: 600 }], 6000, { resetOnHang: false });
    await page.waitForTimeout(900);
    const before = await snap();
    await page.evaluate(() => { window.__fx.quests = false; });
    await page.waitForTimeout(700);
    const after = await snap();
    // The scene is left running on purpose: the question is what the FIELD looks like after the switch, not whether the
    // conversation is cut. (A scene already talking is allowed to finish; the contract's cleanup rule is about what it
    // leaves behind.)
    note(`F2 Quests off mid-scene: ${before.fx.length} effect(s) before, ${after.fx.length} after; sky ${JSON.stringify(after.sky)}; scene still running: ${after.cut}`);
    await page.evaluate(() => { window.__fx.quests = true; });
    scene.catch(() => {});
  }
  await openGame();
  await page.waitForTimeout(600);

  // ---- 14. props: the layer exists and is fed by quest state ---------------------------------------------------
  {
    const s = await snap();
    expect(s.propsApi === "object", `web/quest-props.js is on the field (window.__questProps is ${s.propsApi})`);
    if (s.propsApi === "object") {
      const st = await page.evaluate(() => ({ n: window.__questProps.count(), rows: window.__questProps.state(), boxes: window.__questProps.boxes() }));
      note(`props layer: ${st.n} on the map, ${st.boxes.length} solid box(es)`);
      expect(Array.isArray(st.rows), "the prop list answers with an array");
    }
  }

  // ---- 15. HD asset mode: the same scene, at the same size ------------------------------------------------
  await openGame({ hd: true });
  {
    const s = await snap();
    const scale = await page.evaluate(() => ({ w: document.getElementById("game").width, h: document.getElementById("game").height }));
    console.log("  hd canvas", JSON.stringify(scale));
    const r = await startScene([{ fx: "crate", at: [s.x + 48, s.y - 8], clip: "land" }, { fxwait: "crate" }, { say: null, text: "edge: hd" }, { fxremove: "crate" }], 9000);
    expect(!r.hang, "the same scene plays in HD asset mode");
    expect(r.samples.some((x) => sceneFx(x).some((e) => e.name === "crate")), "the effect art is drawn in HD mode too");
    const mid = r.samples.find((x) => sceneFx(x).some((e) => e.name === "crate"));
    if (mid) await shot("hd-crate");
    expect((await page.evaluate(() => window.__questFx.fade())) === 0, "no fade is left over");
  }
} catch (e) {
  console.error("ERROR", e?.stack ?? e);
  problems.push("exception: " + (e?.message ?? e));
  try { await shot("error"); } catch { /* page gone */ }
} finally {
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ problems, notes, results }, null, 1));
  console.log(problems.length ? `PROBLEMS: ${problems.length}` : "ALL OK");
  for (const p of problems) console.log(" -", p);
  await BROWSER.close();
  process.exit(problems.length ? 1 : 0);
}
