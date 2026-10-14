// Every door in the game is reachable, measured over every shipped stage.
//
// Commit b09463db made `activeExitAt` (web/game.js) arm a door only when the disc's
// own playback executor answers the step tile under the player, on the reasoning that
// "a stage with no step program has no step tiles, so the row stands on its own".
// That reasoning is only true if a stage that HAS a program on the disc also HAS its
// program in `story_steps.json`.
//
// It did not. tools/extract_story_steps.py folded the `sw …,0x14(scene)` pointer store
// over only the first 0x1200 bytes of an overlay; s210 stores at file 0x17f8 and s220 at
// 0x1344, so both shipped `steps: []` while their type-7 grids named six and two door
// records respectively. All eight of those doors were dead: no arrow, no prompt, Enter
// did nothing. That is the regression this test locks shut.
//
// The rule, over every stage that ships an exit row:
//   * the row's rect contains a type-7 cell, AND
//   * `playback()` answers that cell with a HANDOFF op (1 the door, 9/10 the two dives,
//     14 the pad-style handoff), OR
//   * the stage has no step program at all, in which case there are no step tiles and the
//     row stands on its own (the rule in activeExitAt).
//
// A launch pad (op 13) is deliberately NOT a playback op — the disc runs it through the
// SETUP arm (`actor+0x158`), firing on contact — so a row carrying one counts as reached
// by its own contract, and this test says so rather than pretending the executor answers.
//
// `playback()` is called for all eight facings on each candidate cell, because a step
// tile is armed only inside its +/-1 cone: a row that arms on one facing and not another
// is a real fault, and the cone is the disc's own table, read from the shipped JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createTriggerSystem } from "../engine/systems/trigger-system.ts";
import { isLaunchExit } from "../engine/systems/launch-pad.ts";
import { fieldDirectionFromIndex } from "../engine/systems/field-movement.ts";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const STEPS = read("web/assets/data/story_steps.json").stages;
const GRIDS = read("web/assets/data/story_trigger_grids.json").stages;
const CONE = read("web/assets/data/scene/step_enable_table.json");
const SCREENS = read("web/assets/data/screen_table.json");
const SCENES = "web/assets/scenes";

/** The handoff opcodes `activeExitAt` accepts, from engine/systems/scene-step-ops.ts. */
const HANDOFF_OPS = new Set([1, 9, 10, 14]);

function loadScenes() {
  const out = {};
  for (const f of readdirSync(SCENES)) {
    if (!f.endsWith(".json")) continue;
    out[f.slice(0, -5)] = JSON.parse(readFileSync(`${SCENES}/${f}`, "utf8"));
  }
  return out;
}

/** A flag store that satisfies every gate in a program, as playbackRig does. */
function satisfiedFlags(prog) {
  const flags = new Map();
  for (const st of prog?.steps ?? []) {
    for (const [id, v] of [[st.cond_a, st.arg_a], [st.cond_b, st.arg_b]]) {
      if (id === 0xffff) continue;
      if (!flags.has(id)) flags.set(id, v);
    }
  }
  return flags;
}

function rigFor(stage) {
  const prog = STEPS[stage] ?? null;
  const grid = GRIDS[stage] ?? null;
  const flags = satisfiedFlags(prog);
  return createTriggerSystem({
    getProgram: () => prog,
    getGrid: () => grid,
    getEnableTable: () => CONE,
    getEventById: () => null,
    getEventByKey: () => null,
    flags: { get: (id) => flags.get(id) ?? 0, set() {} },
    done: () => false,
    markDone: () => {},
    playEvent: () => {},
  });
}

/** Every non-zero type-7 cell whose centre lies inside an exit row's rect. */
function stepCellsIn(grid, row) {
  const out = [];
  if (!grid) return out;
  const x0 = Math.floor(row.x / grid.cell), x1 = Math.floor((row.x + row.w - 1) / grid.cell);
  const y0 = Math.floor(row.y / grid.cell), y1 = Math.floor((row.y + row.h - 1) / grid.cell);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const b = grid.grid[ty * grid.w + tx] & 0xff;
      if (!b) continue;
      out.push({
        tx, ty,
        x: tx * grid.cell + Math.floor(grid.cell / 2),
        y: ty * grid.cell + Math.floor(grid.cell / 2),
        byte: b, step: b & 0x1f, group: (b >> 5) & 7,
      });
    }
  }
  return out;
}

test("every shipped door row is answered by playback(), or its stage has no program", () => {
  const scenes = loadScenes();
  const dark = [];        // rows nothing can arm
  const partial = [];     // rows only some facings arm
  let rows = 0, armedRows = 0, noProgramRows = 0, launchRows = 0, gondolaRows = 0, stageCount = 0;

  for (const [mapId, scene] of Object.entries(scenes)) {
    if (!scene.exits?.length) continue;
    stageCount++;
    const stage = mapId.slice(1);
    const port = rigFor(stage);
    const prog = STEPS[stage];
    const grid = GRIDS[stage];
    for (const row of scene.exits) {
      rows++;
      const tag = `${mapId} -> ${row.to} (${row.x},${row.y},${row.w}x${row.h})`;

      // The disc's own escape hatch: no program means no step tiles, and the row
      // stands on its own. This is the case activeExitAt documents.
      if (!prog) {
        noProgramRows++;
        for (const facing of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const pb = port.playback(mapId, row.x + row.w / 2, row.y + row.h / 2, facing, true);
          if (pb !== null) {
            dark.push(`${tag}: stage has no program but playback answered ${JSON.stringify(pb)}`);
          }
        }
        armedRows++;
        continue;
      }

      // A launch pad is a SETUP op (actor+0x158), not a playback op: it fires when the
      // tile is walked onto, so activeExitAt returns the row before asking playback().
      if (isLaunchExit(row) || row.stepOp === 13) {
        launchRows++;
        armedRows++;
        continue;
      }

      // A gondola console is not a position step either: it is boarded on contact
      // (web/game.js:6357, once per visit) and its own exit-event performs the handoff
      // (startTransition's engine-first-refusal arm, web/game.js:4562). Its cells name
      // the op-8 step that RUNS that check — s410's gondola names step 1, which is
      // exactly `start_event(90)` — so expecting a playback op here would be expecting
      // the wrong mechanism. Assert the shape instead of skipping it silently.
      if (row.gondola) {
        gondolaRows++;
        const cell = stepCellsIn(grid, row)[0];
        assert.ok(cell, `s${stage} gondola to ${row.to} has no type-7 cell in its rect`);
        const step = STEPS[stage].steps[cell.step];
        assert.equal(step.op, 8,
          `s${stage} gondola to ${row.to} names step ${cell.step}, which is op ${step.op}, not the exit check`);
        assert.ok(STEPS[stage].events.some((e) => e.event_id === step.params[0]),
          `s${stage} gondola check starts event ${step.params[0]}, absent from its own table`);
        armedRows++;
        continue;
      }

      const cells = stepCellsIn(grid, row);
      if (!cells.length) {
        dark.push(`${tag}: no type-7 cell inside the row's own rect`);
        continue;
      }
      // Any cell the executor answers with a handoff op, on its own facing, reaches
      // the row. All eight facings are tried so a cone-only tile is caught.
      let reached = null, reachedOn = 0;
      for (const c of cells) {
        for (let facing = 0; facing < 8; facing++) {
          const pb = port.playback(mapId, c.x, c.y, facing, true);
          if (pb?.live && pb.op != null && HANDOFF_OPS.has(pb.op)) {
            reached ??= c;
            reachedOn++;
          }
        }
      }
      if (reached) {
        armedRows++;
        // The cone is +/-1, so a cell must arm on three of the eight facings. Fewer
        // means the row is reachable only by standing at a specific angle.
        if (reachedOn < 3) partial.push(`${tag}: cell ${reached.tx},${reached.ty} arms on only ${reachedOn} facings`);
      } else {
        dark.push(`${tag}: no cell answered with a handoff op ` +
                  `(${cells.length} candidate cell(s), ops ${[...new Set(cells.map((c) => c.step))].join(",")})`);
      }
    }
  }

  assert.ok(rows > 700, `expected the whole game's door table, saw ${rows} rows`);
  assert.deepEqual(dark, [], `doors nothing can arm:\n  ${dark.join("\n  ")}`);
  assert.deepEqual(partial, [], `doors only reachable at one angle:\n  ${partial.join("\n  ")}`);
  assert.equal(armedRows, rows, "every row must be accounted for");
  console.log(`  ${rows} door rows over ${stageCount} stages: ` +
              `${armedRows - noProgramRows - launchRows} armed by playback(), ` +
              `${launchRows} launch pads, ${gondolaRows} gondola consoles, ` +
              `${noProgramRows} on program-less stages`);
});

test("the two stages the extractor used to lose carry their real programs", () => {
  // The regression's two subjects, pinned by what the disc's own grid says about them.
  // s210's type-7 grid names steps 0..5 as op-1 doors and 6..9 as op-8 cutscene steps;
  // s220's names 0..1 as op-1 doors. Both programs come from the `scene+0x14` store at
  // file 0x17f8 and 0x1344, past the old 0x1200 init-scan window.
  assert.deepEqual(STEPS["210"].steps.map((s) => s.op), [1, 1, 1, 1, 1, 1, 8, 8, 8, 8, 0]);
  assert.deepEqual(STEPS["220"].steps.map((s) => s.op), [1, 1, 0]);

  // Every non-zero byte of each grid must land on a record that exists.
  for (const stage of ["210", "220"]) {
    const prog = STEPS[stage].steps;
    const grid = GRIDS[stage];
    for (let i = 0; i < grid.grid.length; i++) {
      const b = grid.grid[i] & 0xff;
      if (!b) continue;
      const idx = b & 0x1f;
      assert.ok(idx < prog.length,
        `s${stage} cell ${i % grid.w},${Math.floor(i / grid.w)} names step ${idx}, ` +
        `past the ${prog.length}-record program`);
    }
  }

  // Every op-8 record names an event in the stage's OWN event table, so shipping them
  // cannot fire a scene the stage does not have. (The reason the decode doc keeps
  // `gen_scenes.tail_step_program`'s reconstruction out of story_steps.json.)
  for (const stage of ["210", "220"]) {
    const ids = new Set(STEPS[stage].events.map((e) => e.event_id));
    for (const [i, s] of STEPS[stage].steps.entries()) {
      if (s.op !== 8) continue;
      assert.ok(ids.has(s.params[0]),
        `s${stage} step ${i} starts event ${s.params[0]}, which its own table does not have`);
    }
  }
});

// Where you end up FACING when a door opens.
//
// A door record's `params[3]` is the arriving actor's char+0x60 facing index,
// copied in unmapped: the handoff stores the record's word at scene_obj+0x6c
// (fieldstg.s:0x8aa0) and the spawn reads 0x6c straight into char+0x60
// (fieldstg.s:0xe758 / :0xe760) — the two position words beside it are the only
// ones `sra 8`-ed back on. char+0x60 is the 0-7 order
// engine/systems/field-movement.ts `fieldDirectionFromIndex` holds.
//
// `tools/wstag_extract.py` read it through a four-entry table
// ({1:"down",3:"left",5:"up",7:"right"}) that named 1/3/5/7 a step clockwise and
// read 0/2/4/6 as "down", so 776 door rows shipped the wrong arrival facing. This
// test is the cross-check that cannot be satisfied by both sides being wrong
// together: the expected name comes from the ENGINE's table and the record's own
// raw word, and the shipped `dir` comes from the generator's Python one.
//
// Rows whose facing cannot be attributed to a step record are counted and
// reported, never silently passed: the wrap-maze exit records carry their own
// four-way enum (1=south, 3=west, 5=north, 7=east — docs/research/field/
// route-pair-underground-network-2026-07-27.md), and s260's tower exits are
// recovered from an inline compiled payload.
test("every shipped door row faces the way its own record's facing word says", () => {
  const scenes = loadScenes();
  const FACING_OPS = new Set([1, 9, 10, 13, 14]);
  const wrong = [];
  const unattributed = [];
  let rows = 0, checked = 0;

  for (const [mapId, scene] of Object.entries(scenes)) {
    const stage = mapId.slice(1);
    const prog = STEPS[stage]?.steps ?? [];
    // Ordinal 0x2d onward the loader resolves a screen id through the s9xx shadow
    // records (gen_scenes.stage_for_screen's alias_world), so a destination can be
    // either stage.
    const alias = Number(stage) >= 920;
    for (const row of scene.exits ?? []) {
      // A self-warp row's facing is the maze enum's, not char+0x60's.
      if (row.selfWarp) continue;
      // A HANDOFF warp with no cell of its own (the s790 dive) has no spawn facing.
      if (row.spawnX == null) continue;
      rows++;
      const dest = (screen) => {
        const e = SCREENS[String(screen)];
        if (!e) return null;
        if (alias && e.alt?.stage != null) return e.alt.stage;
        return e.stage ?? null;
      };
      const cands = prog.filter((s) => FACING_OPS.has(s.op)
        && s.params[1] === row.spawnX && s.params[2] === row.spawnY
        && `s${dest(s.params[0])}` === row.to);
      if (!cands.length) {
        unattributed.push(`${mapId} -> ${row.to} (${row.spawnX},${row.spawnY})`);
        continue;
      }
      const words = new Set(cands.map((s) => s.params[3] & 7));
      assert.equal(words.size, 1,
        `${mapId} -> ${row.to} (${row.spawnX},${row.spawnY}) matches ` +
        `${cands.length} records carrying ${[...words].join("/")} — the arrival ` +
        `facing would be ambiguous`);
      const word = [...words][0];
      checked++;
      if (row.dir !== fieldDirectionFromIndex(word)) {
        wrong.push(`${mapId} -> ${row.to} (${row.spawnX},${row.spawnY}): ` +
          `record facing word ${word} is "${fieldDirectionFromIndex(word)}", ` +
          `row ships "${row.dir}"`);
      }
    }
  }

  assert.deepEqual(wrong, [], `door arrivals facing the wrong way:\n  ${wrong.join("\n  ")}`);
  // 754 positioned rows, not 787: the 34 place-carrying stages now ship their
  // own StageSlots as self-warp placeholders (skipped above) and their doors'
  // real destinations and facings live in the scene's placePoints table, aimed
  // at runtime per the incoming place pair (engine/systems/place-points.ts).
  assert.ok(rows > 750, `expected the whole game's door table, saw ${rows} positioned rows`);
  assert.ok(checked / rows > 0.95,
    `${checked} of ${rows} rows could be traced to a step record — the rest: ` +
    `${unattributed.join(", ")}`);
  console.log(`  ${checked} of ${rows} positioned door rows carry their own record's ` +
    `facing word; ${rows - checked} carry the wrap-maze enum or a compiled payload`);
});

// A bug-maze trap pad (s745/s746/s820) bounces the player to the one destination
// every act-13 record on the stage shares. `trapPads.reset.dir` is the facing the
// bounce drops them facing, and it comes out of the SAME char+0x60 word a door
// arrival does -- fieldstg.s file 0x8a24 stores the record's params[3] at
// scene_obj+0x6c and the arriving actor's spawn copies that into char+0x60
// (fieldstg.s:0xe758 / :0xe760, unmasked). So it is asserted against the
// record's own word, through the engine's table -- the generator's table and the
// engine's are independent implementations, so both being wrong cannot pass.
// It is NOT the wrap-maze enum (gen_scenes.MAZE_DIR_NAMES), which names every
// odd word a quarter turn out and belongs to a different structure entirely.
test("every shipped trap pad drops the player facing the way its act-13 record says", () => {
  const scenes = loadScenes();
  const seen = [];
  const wrong = [];

  for (const [mapId, scene] of Object.entries(scenes)) {
    const pads = scene.trapPads;
    if (!pads) continue;
    const stage = mapId.slice(1);
    const recs = (STEPS[stage]?.steps ?? []).filter((s) => s.op === 13);
    assert.ok(recs.length > 0,
      `${mapId} ships a trapPads block but story_steps.json has no act-13 record`);
    // One destination across every act-13 record is what makes this a bug-maze
    // reset rather than a launch pad (gen_scenes._single_dest_trap_maze).
    const dests = new Set(recs.map((s) => `${s.params[1]},${s.params[2]},${s.params[3] & 7}`));
    assert.equal(dests.size, 1,
      `${mapId}: ${dests.size} distinct act-13 destinations (${[...dests].join(" / ")}) -- ` +
      `the reset facing would be ambiguous`);
    const [[x, y, word]] = [[...dests][0].split(",")];
    assert.equal(`${pads.reset.x},${pads.reset.y}`, `${x},${y}`,
      `${mapId}: the shipped reset point is not the act-13 record's destination`);
    seen.push(`${mapId} x${recs.length} word ${word} -> ${fieldDirectionFromIndex(word)}`);
    if (pads.reset.dir !== fieldDirectionFromIndex(word)) {
      wrong.push(`${mapId}: record facing word ${word} is ` +
        `"${fieldDirectionFromIndex(word)}", row ships "${pads.reset.dir}"`);
    }
    // The mask still has to be a whole trap stage: a reset-only block would mean
    // the tile-type run stopped matching the record count.
    assert.ok(pads.mask.length === pads.rows && pads.mask[0].length === pads.cols,
      `${mapId}: mask is not ${pads.cols}x${pads.rows}`);
    assert.ok(pads.mask.some((r) => r.includes("1")), `${mapId}: mask has no trap cell`);
  }

  assert.deepEqual(wrong, [], `trap pads bouncing the wrong way:\n  ${wrong.join("\n  ")}`);
  assert.deepEqual(seen.sort(), [
    "s745 x18 word 7 -> down-right",
    "s746 x19 word 7 -> down-right",
    "s820 x1 word 3 -> up-left",
  ], `the shipped bug-maze trap pads changed:\n  ${seen.sort().join("\n  ")}`);
  console.log(`  ${seen.length} trap-pad resets carry their act-13 record's facing word`);
});
