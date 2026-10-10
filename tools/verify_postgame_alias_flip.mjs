// Journey 7 consumer: at story ordinal 45 an ordinary field DOOR whose step record
// names one of the 55 shadowed screens loads the post-game alias stage instead of the
// base one.
//
// Source (authority 2): fieldstg's screen-table loader (file 0xf460-0xf4ac) compares
// the master ordinal against 0x2d and re-bases the record walk; the walker mirrors it
// as screenRouter's `useAlt: () => ordinal === 0x2d` (engine/dw3/screen-routing.ts)
// over data/screen_table.json's 55 alt rows. Claim POST-CL-001.
//
// THE PRODUCER is the door itself, and that is the whole point. A door's own type-7
// step record is an op-1 warp whose params[0] is a SCREEN ID, not a stage: Qing Long
// City s421 carries two, both naming screen 0x29e (670), listed by the disc at
// pro/wstag421.s:1085-1087 (spawn 200,420, dir word 5) and :1091-1093 (spawn 440,516,
// dir word 3). Op 1 hands `params[0]` to the handoff `0x8008B770`
// (pro/fieldstg.s:5970, engine/systems/scene-step-ops.ts PLAYBACK_OPS[0]), which stores
// it on the new scene object (file 0x8a24:8a68-8a70) and whose phase-2 load walks the
// screen table for the first record carrying it: 12 bytes a record, first match wins,
// and the walk starts at the 55 alias records when the ordinal is 45 and at the 239
// base records otherwise (file 0xf4e4-:0xf4f4, base :f488 / alias :f4ac, one ordinal
// test at :f468/:f46c/:f478).
//
// NOT an exit event. There is no door-event system on the disc: the 0x044N door object
// is collision plus an open animation and carries no destination
// (docs/research/field/door-warp-decode.md), and the type-7 grid is the only warp
// trigger. s421's event 743 (flag_key 0135002b) ends in the same HANDOFF 670, but its
// only start_event call site in the whole overlay is the stage's own entry dispatcher,
// pro/wstag421.s:73 `jal 0x800853f8` with `li $a0,0x2e7` in the branch's delay slot at
// :72, which runs on scene phase 0 (:13-:19) and only when the master ordinal is 27
// (:a0-:a8). The check used to wait for that event on the door press and so could never
// pass; it now presses the door a player presses.
//
// WHY TWO DOORS, AND WHY NOTHING HERE IS A HARDCODED ANSWER. The rule is "the screen id
// the record names decides", not "s421 goes to the post-game tower", so one door cannot
// tell those apart — a game that had hardcoded s421 would pass a one-door check. Each
// case below is therefore a different stage, a different screen and a different arming
// facing, and every number the check asserts is read at run time out of the shipped
// artefacts: the tile and the facing the disc's cone demands from the type-7 grid
// (tools/verify-step-tile.mjs), the step record's own screen id, and that screen's base
// and alias stage from data/screen_table.json. Only the two (stage, destination) pairs
// are named here, and each pair is re-checked against the shipped row and record before
// anything is pressed.
//
//   Server: python3 -m http.server 8741 --directory web
//   Run:    .opencode/autonomy/check-browser tools/verify_postgame_alias_flip.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { SCREENS, doorTile } from "./verify-step-tile.mjs";

const BASE = process.env.ALIASFLIP_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.ALIASFLIP_SHOT || "/tmp/postgame-alias-flip";
// The two doors. Both are ungated op-1 tiles whose rectangle carries a single grid byte,
// so one facing cone row arms them and another refuses it. Their disc records are
// pro/wstag421.s:1085-1087 (0x029e0001) and pro/wstag201.s:1171-1173 (0x02720001).
const DOORS = [
  { stage: "s421", to: "s431" },
  { stage: "s201", to: "s206" },
];
// The disc's one test is an EQUALITY against 0x2d (file 0xf46c/:f478), so 44 is the
// nearest ordinal that must NOT flip and 45 the one that must.
const ORDINALS = [44, 45];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const results = [];

try {
  for (const d of DOORS) {
    for (const ordinal of ORDINALS) {
      const label = `${d.stage}->${d.to}@${ordinal}`;
      const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
      const errors = [];
      page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
      const fired = [];
      page.on("console", (m) => {
        const hit = m.text().match(/EVENT FIRED (\S+)/);
        if (hit) fired.push(hit[1]);
      });
      const shot = async (n) => writeFileSync(
        `${OUT}/${n}.png`,
        Buffer.from(
          (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
          "base64",
        ),
      );
      const state = () => page.evaluate(() => ({
        map: window.__state.manifest.maps[window.__state.mapIdx].id,
        x: Math.round(window.__state.x),
        y: Math.round(window.__state.y),
        dir: window.__state.dir,
        onExit: window.__state.onExit,
        ord: window.__engine.state.vars.get("$story.ordinal"),
        cut: window.__cutscene?.isActive?.() ?? false,
        busy: window.__engineBridge?.isBusy?.() ?? null,
      }));
      // Stand on a point and face a way, the way a player walks up to a door.
      const stand = (x, y, dir) => page.evaluate(([px, py, dd]) => {
        window.__tp(px, py);
        window.__state.dir = dd;
        window.__state.moving = false;
      }, [x, y, dir]);

      await page.goto(`${BASE}?noEncounters=1`);
      await page.evaluate((o) => {
        localStorage.clear();
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("progressOrdinal", String(o));
      }, ordinal);
      await page.goto(`${BASE}?skipTitle=1&map=${d.stage}&noEncounters=1`);
      await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 15_000 });
      await page.waitForTimeout(500);

      // The shipped scene row, read live at THIS ordinal: at 45 it must still name the
      // base stage, because on the disc nothing about the row decides anything.
      const door = await page.evaluate(([st, to]) => {
        const e = window.__state.scenes[st]?.exits?.find((x) => x.to === to) ?? null;
        return e ?? null;
      }, [d.stage, d.to]);
      if (!door) throw new Error(`${d.stage} has no exit to ${d.to}`);
      if (!door.grid) throw new Error(`${d.stage}'s exit to ${d.to} is not a grid tile`);
      if (door.gate) throw new Error(`${label}: the door is gated (${JSON.stringify(door.gate)})`);

      // The tile, the facing the disc's cone arms on it, and one facing it refuses.
      const tile = doorTile(d.stage, door);
      if (!tile) throw new Error(`${label}: no step tile inside the door's own rectangle`);
      if (!tile.armDir || !tile.blindDir) throw new Error(`${label}: the facing cone row is missing`);
      if (tile.record?.op !== 1) throw new Error(`${label}: tile selects op ${tile.record?.op}, not a warp`);

      // THE ANSWER, read rather than written: the record's own screen id, and that
      // screen's two stages. The disc's walk returns whichever record it starts on, so
      // 45 must land on the alias and 44 on the base.
      const SCREEN = tile.record.params[0];
      const row = SCREENS[String(SCREEN)];
      if (!row || row.alt?.stage == null)
        throw new Error(`${label}: screen ${SCREEN} (${JSON.stringify(row)}) carries no alias record`);
      if (`s${row.stage}` !== door.to)
        throw new Error(`${label}: the row names ${door.to} but screen ${SCREEN} is stage ${row.stage}`);
      const expectMap = `s${ordinal === 45 ? row.alt.stage : row.stage}`;

      // The disc's cone is ±1 around the grid byte's group: facing away from the door
      // must leave it dark. Without this the rest of the check would also pass on a
      // walker that armed every exit on its rectangle.
      await stand(tile.stand.x, tile.stand.y, tile.blindDir);
      await page.waitForTimeout(150);
      const blind = await state();
      if (blind.onExit)
        await fail(`${label}: the door armed while facing ${tile.blindDir} (${JSON.stringify(blind)})`);

      await stand(tile.stand.x, tile.stand.y, tile.armDir);
      await page.waitForTimeout(150);
      const onDoor = await state();
      if (!onDoor.onExit) await fail(`${label}: not on the door (${JSON.stringify(onDoor)})`);

      // Ordinary exit press -> the op-1 warp -> the screen-table walk.
      await page.keyboard.press("Enter");
      const t0 = Date.now();
      let landed = null;
      for (let i = 0; i < 80 && Date.now() - t0 < 10_000; i++) {
        await page.waitForTimeout(150);
        const s = await state();
        if (s.map === expectMap) { landed = s; break; }
        if (s.map !== d.stage) {
          await fail(`${label}: the door sent the player to ${s.map}, expected ${expectMap}`);
          landed = s;
          break;
        }
        await page.keyboard.press("Enter");
      }
      // An arrival scene may still be running; the walker's own gate for "you are here"
      // is the same one the press loop used.
      for (let i = 0; i < 40 && Date.now() - t0 < 20_000; i++) {
        const s = await state();
        if (s.map === expectMap && !s.cut && !s.busy) { landed = s; break; }
        await page.waitForTimeout(150);
      }
      if (!landed) landed = await state();
      await shot(`${label.replace(/[>]/g, "to")}`);

      if (landed.map !== expectMap)
        await fail(`${label}: landed on ${landed.map}, expected ${expectMap}`);
      // The spawn is the RECORD's own params[1]/[2]/[3] — the scene row is a build-time
      // projection of exactly those, which is why the row may be compared here.
      const wantSpawn = { x: tile.record.params[1], y: tile.record.params[2] };
      if (landed.x !== wantSpawn.x || landed.y !== wantSpawn.y)
        await fail(`${label}: landing ${landed.x},${landed.y}, expected ${wantSpawn.x},${wantSpawn.y}`);
      if (landed.dir !== door.dir)
        await fail(`${label}: facing ${landed.dir}, expected ${door.dir} (params[3] ${tile.record.params[3]})`);
      // The consumer world itself must be the matching variant: the alias stage has to
      // exist and carry its own scene, or the landing proves nothing.
      const consumerExit = await page.evaluate((m) =>
        window.__state.scenes[m]?.exits?.[0]?.to ?? null, expectMap);
      if (!consumerExit)
        await fail(`${label}: ${expectMap} has no scene of its own`);

      if (errors.length) await fail(`${label}: ${errors.length} page error(s)`);

      results.push({ label, door, tile, screen: SCREEN, base: row.stage, alias: row.alt.stage,
        expectMap, blind, onDoor, landed, fired, consumerExit });
      await page.close();
    }
  }
  // The two landings for each door must be DIFFERENT worlds, which is what makes this
  // the flip and not a rename.
  for (const d of DOORS) {
    const pair = results.filter((r) => r.label.startsWith(`${d.stage}->${d.to}@`));
    if (pair.length !== 2) continue;
    if (pair[0].landed.map === pair[1].landed.map)
      await fail(`${d.stage}->${d.to}: both ordinals landed on ${pair[0].landed.map}`);
  }
  console.log("RESULT", JSON.stringify({ ok: !failed, results }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);