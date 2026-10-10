// Journey 5 field piece: the dive -> undersea -> return chain.
//
// s330 (Central Sector — Central Park) carries a real op-10 water dive at
// (768,1056,64x32) -> s850 (Underground — Seabed) spawn (576,288), gated on
// flag 0x7093 (DE Sincerity / progress ordinal >= 15). s850 is a dive-form
// screen (Submarimon, sprite 327) and its own exit (512,256,128x64) warps back
// to s330 spawn (808,1060), where no marker runs, so the player is Junior again.
//
// The check seeds only the prerequisites (ordinal 30 opens the bank-0x70 dive
// predicate; item 16 is DE Sincerity), then uses ordinary input throughout:
// stand on the dive, press the interact key, let the authored dive demo play,
// arrive in the Seabed as Submarimon, TURN the sub until the exit marker lights,
// press the interact key on the return exit, and arrive back on the shore as
// Junior.
//
// The turn is the original's, not a convenience. Every op-9/10 dive in the game
// lands on a type-7 cell whose byte carries group 4 (measured: 157 of 157), and a
// step tile arms only while the player faces within ±1 of that group — the
// `cone[group][actor+0x60]` byte read at fieldstg.s:5688-56a4
// (`lw $v0,0x60($s1)` is the player's facing, the column index; `sll $v1,0x3` the
// group's row). Row 4 of the shipped table admits up-left/up/up-right, and the
// dive launcher lands you facing 0 = down (`sw $zr,0x60($s0)`, fieldstg.s:0xc778),
// so the marker stays dark until you turn the sub. The same fact is why
// tools/verify_door_roundtrip.mjs turns on the surface door before pressing.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_dive_roundtrip.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DIVE_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.DIVE_SHOT || "/tmp/dive-roundtrip";
const SURFACE = "s330", UNDERSEA = "s850";
const SUBMARIMON_SPRITE = 327;
const DIVE_GATE = 0x7093;
/** The disc's facing order — `actor+0x60`, the cone's column index. */
const FACINGS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
const CONE = JSON.parse(
  readFileSync(new URL("../web/assets/data/scene/step_enable_table.json", import.meta.url)),
).rows;
const GRIDS = JSON.parse(
  readFileSync(new URL("../web/assets/data/story_trigger_grids.json", import.meta.url)),
).stages;
mkdirSync(OUT, { recursive: true });

/**
 * The facings that arm the step tile at (x,y), and the grid facts behind them:
 * the tile's byte, its step index and the facing group the tile demands.
 */
function tileFacts(stage, x, y) {
  const grid = GRIDS[stage.slice(1)];
  const byte = grid.grid[Math.floor(y / grid.cell) * grid.w + Math.floor(x / grid.cell)] & 0xff;
  const group = (byte >> 5) & 7;
  return {
    byte, step: byte & 0x1f, group,
    allowed: FACINGS.filter((_, i) => CONE[group][i]),
  };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

let failed = null;
let handoff = null;
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
  x: Math.round(window.__state.x),
  y: Math.round(window.__state.y),
  dir: window.__state.dir,
  onExit: window.__state.onExit,
  fade: window.__fade.dir,
  cut: window.__cutscene?.isActive?.() ?? false,
  tb: window.__textbox?.isOpen?.() ?? false,
  demo: window.__state.diveDemo ? { mode: window.__state.diveDemo.mode, frame: window.__state.diveDemo.frame } : null,
  form: window.__state.diveForm?.spriteId ?? null,
  formName: window.__state.diveForm?.name ?? null,
  sub: window.__state.submarimon
    ? { height: window.__state.submarimon.heightFixed, facing: window.__state.submarimon.facing }
    : null,
}));

const inRect = (e, x, y) => x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h;

try {
  await page.goto(`${BASE}?skipTitle=1&map=${SURFACE}&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 15_000 });
  await page.waitForFunction(
    (m) => window.__state.manifest.maps[window.__state.mapIdx].id === m
      && window.__fade.dir === 0 && !(window.__cutscene?.isActive?.() ?? false),
    SURFACE, { timeout: 10_000 },
  );
  await page.waitForTimeout(300);

  // Prerequisite only: the dive predicate is a bank-0x70 ordinal range, and the
  // egg item is what a player would have used to unlock it.
  const gate = await page.evaluate((flag) => {
    const s = window.__state;
    window.__engine.state.vars.set("$story.ordinal", 30);
    if (!s.inventory.some((i) => i.id === 16)) s.inventory.push({ id: 16, qty: 1 });
    return { flag: window.__storyFlags.get(flag), ordinal: window.__engine.state.vars.get("$story.ordinal") };
  }, DIVE_GATE);
  if (gate.flag !== 1) await fail(`dive gate flag 0x7093 did not open at ordinal ${gate.ordinal}`);

  const doors = await page.evaluate(([a, b]) => {
    const ea = window.__state.scenes[a].exits.find((e) => e.to === b && e.stepOp === 10);
    const eb = window.__state.scenes[b].exits.find((e) => e.to === a);
    return { dive: ea, back: eb };
  }, [SURFACE, UNDERSEA]);
  if (!doors.dive) throw new Error(`${SURFACE} has no op-10 dive to ${UNDERSEA}`);
  if (!doors.back) throw new Error(`${UNDERSEA} has no exit back to ${SURFACE}`);
  if (!doors.dive.grid || !doors.back.grid) await fail("a dive exit is not grid-placed");
  if (doors.back._entranceReturn) await fail("the return exit is synthesized, not the scene's own");

  const before = await field();
  if (before.form !== null || before.sub !== null)
    await fail(`surface starts with a form: ${JSON.stringify(before)}`);

  // Fixture: stand on the water dive.
  await page.evaluate((d) => window.__tp(d.x + d.w / 2, d.y + d.h / 2), doors.dive);
  await page.waitForTimeout(250);
  const onDive = await field();
  await shot("dive-surface-on-trigger");
  if (!onDive.onExit) await fail(`not on the ${SURFACE} dive after __tp: ${JSON.stringify(onDive)}`);

  // Cross: the authored demo plays first, then the ordinary stage change.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const during = await field();
  await shot("dive-demo-playing");
  if (during.map !== SURFACE) await fail(`left ${SURFACE} before the demo was seen: ${during.map}`);
  if (!during.demo) await fail("the dive demo did not start (diveDemo null after the press)");
  const demoMode = during.demo?.mode ?? null;

  // ── THE FAR END IS THE ORDINARY STAGE WIPE (field-gap D12) ───────────────
  // The decode's fourth step waits for the demo to finish and hands the screen
  // to the GENERIC stage change, which owns the tile wipe and the location
  // title (dive-demo doc § 0 and § 2.3; the capture's "cyan tile border" at
  // f270 and "tile wipe" at f300). The walker ran a plain black fade here
  // until 2026-10-02 (db48e931 made the fade clock the decoded wipe); this
  // recorder pins the handoff to that wipe, so a regression back to a cut —
  // or a wipe that fires before the demo ends — is caught.
  await page.evaluate(() => {
    window.__wipeTrace = [];
    window.__demoEndAt = null;
    const tick = () => {
      const s = window.__state;
      if (s) {
        if (!s.diveDemo && window.__demoEndAt === null) window.__demoEndAt = performance.now();
        const w = s.wipe;
        if (w && (w.phase === 1 || w.phase === -1)) {
          const last = window.__wipeTrace[window.__wipeTrace.length - 1];
          if (!last || last.phase !== w.phase || last.frame !== w.frame)
            window.__wipeTrace.push({ phase: w.phase, frame: w.frame, t: performance.now() });
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.waitForFunction(
    (m) => window.__state.manifest.maps[window.__state.mapIdx].id === m
      && window.__fade.dir === 0 && !(window.__cutscene?.isActive?.() ?? false),
    UNDERSEA, { timeout: 10_000 },
  );
  {
    const { trace, demoEndAt } = await page.evaluate(() => ({
      trace: window.__wipeTrace, demoEndAt: window.__demoEndAt,
    }));
    const closes = trace.filter((r) => r.phase === 1);
    const opens = trace.filter((r) => r.phase === -1);
    const maxClose = closes.length ? Math.max(...closes.map((r) => r.frame)) : -1;
    handoff = {
      closeSamples: closes.length, maxCloseFrame: maxClose, openSamples: opens.length,
      firstCloseAfterDemoEnd: closes.length && demoEndAt !== null ? closes[0].t >= demoEndAt : null,
    };
    if (!closes.length)
      await fail("the dive handed off without the ordinary stage wipe (no close phase after the demo)");
    else {
      if (demoEndAt !== null && closes[0].t < demoEndAt - 100)
        await fail(`the wipe closed before the demo ended (${Math.round(demoEndAt - closes[0].t)} ms early)`);
      if (maxClose < 24)
        await fail(`the handoff's close stopped at frame ${maxClose}, short of the decoded 32`);
    }
    if (!opens.length)
      await fail("the handoff never reopened the wipe over the new stage (no open phase)");
  }
  await page.waitForTimeout(250);
  const atSea = await field();
  await shot("dive-undersea-arrival");
  if (atSea.map !== UNDERSEA) await fail(`dive reached ${atSea.map}, expected ${UNDERSEA}`);
  if (atSea.x !== doors.dive.spawnX || atSea.y !== doors.dive.spawnY)
    await fail(`undersea landing ${atSea.x},${atSea.y}, expected ${doors.dive.spawnX},${doors.dive.spawnY}`);
  // NOT the row's `dir`. An op-9/10 dive never reads params[3] as the arrival
  // facing: the launcher zeroes char+0x60 itself (`sw $zr,0x60($s0)`,
  // fieldstg.s:0xc778) before handing the payload to F0x8008C078, so the record's
  // facing word is inert for this op and the arrival is always index 0 = down.
  // This assertion used to compare against the row and passed only because the
  // generator's four-entry table happened to name word 1 "down"; the row now reads
  // "down-left" (char+0x60's word 1) and the arrival is still down, which is the
  // disc's own reading.
  if (atSea.dir !== "down")
    await fail(`undersea facing ${atSea.dir}, but a dive always arrives facing 0 = down`);
  if (atSea.form !== SUBMARIMON_SPRITE) await fail(`undersea form ${atSea.form}, expected ${SUBMARIMON_SPRITE}`);
  if (!atSea.sub) await fail("the Submarimon buoyancy state is missing undersea");

  // You land ON the return tile, facing down, and the tile stays dark: the dive
  // launcher hands you over facing 0 (`sw $zr,0x60($s0)`, fieldstg.s:0xc778) while
  // every dive destination in the game is a group-4 marker, and row 4 of the cone
  // admits up-left/up/up-right. The old assertion here ("the arrival is on the
  // return exit") asked for a state the disc never produces.
  const seaTile = tileFacts(UNDERSEA, doors.dive.spawnX, doors.dive.spawnY);
  if (seaTile.group !== 4)
    await fail(`the undersea landing tile is group ${seaTile.group}, not the group's usual 4`);
  if (atSea.sub.facing !== FACINGS.indexOf(atSea.dir))
    await fail(`the sub's own facing ${atSea.sub.facing} does not match the drawn facing ${atSea.dir}`);
  if (seaTile.allowed.includes(atSea.dir))
    await fail(`the landing tile armed while facing ${atSea.dir}; its cone is {${seaTile.allowed}}`);
  if (atSea.onExit)
    await fail("the return exit armed on arrival, outside the tile's facing cone");

  // Turn the sub until the marker arms. The sub turns with LEFT/RIGHT rather than
  // being steered (F0x8008e45c file 0xb944-0xb994: pad 0x80 rotates -1 and pad
  // 0x20 rotates +1, both &7, once every 8 field ticks), so hold a turn key and
  // let go the moment the facing enters the tile's cone.
  let turned = null;
  for (const key of ["ArrowLeft", "ArrowRight"]) {
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        (allowed) => allowed.includes(window.__state.dir) && window.__state.onExit,
        seaTile.allowed, { timeout: 3_000, polling: 40 },
      );
      turned = { key, ...(await field()) };
      break;
    } catch { /* this turn direction did not reach the cone; try the other */ }
    await page.keyboard.up(key);
    await page.waitForTimeout(80);
  }
  await page.keyboard.up("ArrowLeft").catch(() => {});
  await page.keyboard.up("ArrowRight").catch(() => {});
  await page.waitForTimeout(120);
  await shot("dive-undersea-turned");
  if (!turned) await fail(`turning the sub never armed the return exit (cone {${seaTile.allowed}})`);
  else {
    if (!turned.onExit) await fail(`facing ${turned.dir} the exit is still dark: ${JSON.stringify(turned)}`);
    if (turned.x !== atSea.x || turned.y !== atSea.y)
      await fail(`turning the sub moved it ${turned.x},${turned.y} from ${atSea.x},${atSea.y}`);
  }

  // Return through the Seabed's own exit, which must not be depth-gated (the
  // native warp trigger is positional; only the talk probe is depth-gated).
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (m) => window.__state.manifest.maps[window.__state.mapIdx].id === m
      && window.__fade.dir === 0 && !(window.__cutscene?.isActive?.() ?? false),
    SURFACE, { timeout: 8_000 },
  );
  await page.waitForTimeout(250);
  const back = await field();
  await shot("dive-surface-return");
  if (back.map !== SURFACE) await fail(`return reached ${back.map}, expected ${SURFACE}`);
  if (back.x !== doors.back.spawnX || back.y !== doors.back.spawnY)
    await fail(`return landing ${back.x},${back.y}, expected ${doors.back.spawnX},${doors.back.spawnY}`);
  if (back.dir !== doors.back.dir) await fail(`return facing ${back.dir}, expected ${doors.back.dir}`);
  if (back.form !== null) await fail(`surface form did not revert: ${back.form}`);
  if (back.sub !== null) await fail("the Submarimon state survived the return to the surface");
  if (!inRect(doors.dive, back.x, back.y))
    await fail(`return landing ${back.x},${back.y} is outside the dive it left from`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, gate, doors, before, onDive, during: { map: during.map, demo: during.demo },
    demoMode, handoff,
    atSea, seaTile, turned: turned && { key: turned.key, dir: turned.dir, onExit: turned.onExit },
    back,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
