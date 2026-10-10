// Journey: every door in the Plains (s210) and in the house beside it (s220)
// opens again.
//
// Regression: commit b09463db made `activeExitAt` arm a door only when the disc's
// own playback executor (`0x800885d4`) answers the step tile under the player,
// on the reasoning that a stage with no step program has no step tiles and its
// door row "stands on its own". s210 and s220 both HAVE a step program on the
// disc, but tools/extract_story_steps.py never found it, so their type-7 grids
// named door records the walker did not have. All six s210 doors and both s220
// doors were dark: no arrow, no prompt, Enter did nothing.
//
//   s210 (Plains) stores its program pointer at file 0x17f8, s220 at 0x1344 --
//   both past the extractor's old 0x1200 init-scan window. The pointer reads out
//   to 11 and 3 records respectively, and every non-zero byte of each stage's
//   type-7 grid lands on one of them (s210: six op-1 doors at grid bytes
//   32/225/162/163/164/101, four op-8 cutscene steps at 6/7/8/9; s220: two op-1
//   doors at 96/33).
//
// The check plays it as a player does: it stands on one s210 door, turns until
// the arrow lights, presses Enter, and lands in s220 on the tile the far record
// names. Then it proves all eight doors of the two stages arm, from the scene
// records the game itself is running.
//
// Server: python3 -m http.server 8837 --directory web
// Run:    VERIFY_PORT=8837 tools/run-playwright.sh tools/verify_s210_doors.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { doorTile } from "./verify-step-tile.mjs";

const BASE = `${baseUrl(8837)}/`;
const OUT = process.env.S210_SHOT || ".bunny-scratch/s210-shot";
const A = "s210", B = "s220";
mkdirSync(OUT, { recursive: true });

// The tile a door row actually sits on, and what that tile demands of the player, is
// one shared reading of the shipped type-7 grid and FIELDSTG.PRO's facing cone --
// tools/verify-step-tile.mjs. It is not the rect's centre: a row's rect is the
// bounding box of its step cells, so for a 2x2 cluster the centre lands on the
// fourth cell, which may carry no byte at all (s210's s220 door is exactly that --
// px 704,608 is in the rect and is not a step tile).

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

const results = {};
let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const shot = async (n) => writeFileSync(
  `${OUT}/${n}.png`,
  Buffer.from(
    (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64",
  ),
);

const field = () => page.evaluate(() => ({
  map: window.__state.manifest.maps[window.__state.mapIdx].id,
  x: Math.round(window.__state.x), y: Math.round(window.__state.y),
  dir: window.__state.dir, onExit: window.__state.onExit,
  fade: window.__fade.dir,
  cut: window.__cutscene?.isActive?.() ?? false,
  tb: window.__textbox?.isOpen?.() ?? false,
}));

const settle = (map, timeout = 10_000) => page.waitForFunction(
  (m) => {
    const s = window.__state;
    return s && s.manifest.maps[s.mapIdx].id === m && window.__fade.dir === 0
      && !(window.__cutscene?.isActive?.() ?? false) && !(window.__textbox?.isOpen?.() ?? false);
  },
  map, { timeout },
);

/** Stand still on a tile and face a way — the field loop reads state.dir each frame. */
const face = (dir) => page.evaluate((d) => {
  window.__state.dir = d;
  window.__state.moving = false;
}, dir);

try {
  await page.goto(`${BASE}?skipTitle=1&map=${A}&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await settle(A);
  await page.waitForTimeout(300);

  // The scene records are the authority for where each door goes.
  const exits = await page.evaluate(([a, b]) => ({
    a: window.__state.scenes[a].exits,
    b: window.__state.scenes[b].exits,
    back: window.__state.scenes[b].exits.find((e) => e.to === a),
  }), [A, B]);
  if (!exits.a.length) throw new Error(`${A} has no exits`);
  if (!exits.back) throw new Error(`${B} has no exit back to ${A}`);

  // Every door of a stage must arm on the tile its own grid byte names, facing the
  // way that byte demands. Read one at a time: a door is per-tile, not per-rect, so
  // the centre of a wide rectangle is the only fixture that is inside every cell.
  const armAll = async (stage) => {
    const rows = await page.evaluate((s) => window.__state.scenes[s].exits, stage);
    const out = [];
    for (const row of rows) {
      const fac = doorTile(stage, row);
      if (!fac) { await fail(`${stage} door to ${row.to} has no step tile in its own rect`); continue; }
      const r = await page.evaluate(([x, y, d]) => {
        window.__tp(x, y);
        window.__state.dir = d;
        window.__state.moving = false;
        return { onExit: window.__state.onExit };
      }, [fac.stand.x, fac.stand.y, fac.armDir]);
      await page.waitForTimeout(60);
      const onExit = (await field()).onExit;
      out.push({ stage, to: row.to, at: `${fac.stand.x},${fac.stand.y}`, stepCells: fac.cells,
                 tileByte: fac.byte, step: fac.step, group: fac.group,
                 armDir: fac.armDir, onExit });
      if (!onExit) {
        await fail(`${stage} door to ${row.to} never arms on tile ${fac.stand.x},${fac.stand.y} facing ` +
                   `${fac.armDir} (grid byte ${fac.byte} -> step ${fac.step}, group ${fac.group})`);
      }
    }
    return out;
  };

  const armedS210 = await armAll(A);
  if (armedS210.length !== 6) await fail(`expected 6 doors in ${A}, found ${armedS210.length}`);
  results.armedDoors = armedS210;
  if (armedS210.some((r) => !r.onExit)) {
    console.log("RESULT", JSON.stringify({ ok: false, armedDoors: armedS210 }));
  }

  // --- The played crossing: stand on the s210 -> s220 door, turn, press Enter. ---
  const door = exits.a.find((e) => e.to === B);
  const fac = doorTile(A, door);
  if (!fac) throw new Error(`the ${A}->${B} door has no step tile in its own rect`);
  const cx = fac.stand.x, cy = fac.stand.y;

  // Face AWAY first: the disc arms a step tile only inside its +/-1 facing cone, so
  // the dark state is the real one and the turn is the thing being proved.
  const away = fac.blindDir;
  await page.evaluate(([x, y, d]) => {
    window.__tp(x, y);
    window.__state.dir = d;
    window.__state.moving = false;
  }, [cx, cy, away]);
  await page.waitForTimeout(200);
  const before = await field();
  await shot("s210-door-dark");
  results.beforeTurn = { at: `${before.x},${before.y}`, facing: away, onExit: before.onExit };
  if (before.onExit) await fail(`the ${A} door armed facing ${away}, outside its group-${fac.group} cone`);

  await face(fac.armDir);
  await page.waitForTimeout(200);
  const armed = await field();
  await shot("s210-door-armed");
  results.afterTurn = { at: `${armed.x},${armed.y}`, facing: fac.armDir, onExit: armed.onExit };
  if (!armed.onExit) await fail(`the ${A}->${B} door did not arm facing ${fac.armDir}`);

  // On a fresh save the disc does not let you through yet: the door's row is guarded
  // by the pre-download scene (decode-table s210 id 30 -- "walks resident actor 2 back
  // to (639,557) and plays esdmg200[9]", gated on partySizeEquals 0). Proving that
  // too is what separates "the door is alive" from "the door is merely armed": an
  // armed-but-dead row would show the arrow and then do nothing at all.
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (window.__cutscene?.isActive?.() ?? false) === true,
                             null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(2600);
  const guarded = await field();
  await shot("s210-door-partner-guard");
  results.partnerGuard = guarded;
  if (guarded.map !== A) await fail(`the empty-party guard let you out of ${A}: ${guarded.map}`);
  if (!guarded.cut && !guarded.tb)
    await fail(`no partner-data reminder played on the guarded door: ${JSON.stringify(guarded)}`);

  // Let the reminder finish before touching the door again, or the next Enter is
  // swallowed by its textbox instead of opening the door.
  for (let i = 0; i < 12; i++) {
    const s = await field();
    if (!s.cut && !s.tb && s.fade === 0) break;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }
  const quiet = await field();
  if (quiet.cut || quiet.tb || quiet.fade !== 0)
    await fail(`the partner reminder never finished: ${JSON.stringify(quiet)}`);

  // With the partner downloaded the same tile crosses. `partySizeEquals` reads the
  // ENGINE's party store (engine/core/state/party.ts:11, registered at
  // engine/dw3/dw3-config.ts:252), which the game loads once at boot from
  // `state.party` (web/game.js:3755) -- so the fixture has to write that store, not
  // the walker's roster.
  await page.evaluate(() => window.__engine.state.party.load({ members: [1, 2], lead: 1 }));
  await page.evaluate(([x, y, d]) => {
    window.__tp(x, y);
    window.__state.dir = d;
    window.__state.moving = false;
  }, [cx, cy, fac.armDir]);
  await page.waitForTimeout(200);
  const ready = await field();
  if (!ready.onExit) await fail(`the ${A}->${B} door stopped arming after the party was loaded`);
  await page.keyboard.press("Enter");
  await settle(B);
  await page.waitForTimeout(250);
  const arrived = await field();
  await shot("s210-door-arrived");
  results.arrival = arrived;
  if (arrived.map !== B) await fail(`the crossing did not reach ${B}: ${arrived.map}`);
  if (arrived.x !== door.spawnX || arrived.y !== door.spawnY)
    await fail(`landed ${arrived.x},${arrived.y}, the record names ${door.spawnX},${door.spawnY}`);

  // And the two s220 doors arm here, in the stage the crossing actually reached.
  const armedS220 = await armAll(B);
  results.armedDoors.push(...armedS220);
  if (armedS220.length !== 2) await fail(`expected 2 doors in ${B}, found ${armedS220.length}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, door: { to: door.to, spawnX: door.spawnX, spawnY: door.spawnY, dir: door.dir },
    tile: fac, results,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
