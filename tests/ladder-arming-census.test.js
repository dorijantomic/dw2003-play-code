// CENSUS — the ladder arming system, every rail in the game.
//
// One shared system arms every ladder in the disc: the position step's step-load
// (pro/fieldstg.s:5501 `.L0x000055d8`) reads the type-7 grid byte under the player,
// splits it into `group = byte >> 5` (fieldstg.s:5519) and `step_idx = byte & 0x1f`
// (fieldstg.s:5520), keeps the group in `entity+0x60` (fieldstg.s:5521), and returns
// live only when that tile's own facing cone admits the player's facing —
//
//   .L0x00005648: lhu $v1, 0x8($v1)      the record's opcode   (fieldstg.s:5529)
//   .L0x00005650: slti $v0, $v1, 0x5      opcodes 0..4 go through the cone (:5531)
//   .L0x00005654: bnez $v0, .L0x00005684
//   .L0x00005684: addiu $a0, 0x7624       0x80097624, the cone table (:5544)
//   .L0x00005688: lw $v1, 0x60($s0)       the tile's group      (:5545)
//   .L0x0000568c: lw $v0, 0x60($s1)       the player entity's facing (:5546)
//   .L0x000056a4: sltu $v0, $zr, $v0      live = the cone byte is non-zero (:5552)
//
// Opcodes 2 and 3 are the ladder (the handlers at fieldstg.s:5799 `.L0x00005a80` and
// :5815 `.L0x00005ac0`), so an op-2/op-3 tile answers the button ONLY while the player
// faces inside that three-facing cone. That is why a ladder will not mount while you
// stand on its tile looking the wrong way, and it is the whole reason the old browser
// check failed.
//
// What this file pins, for every rail in the game and not for one stage:
//
//   1. CENSUS. The walker's member list equals the decoded list: every ladder rail end
//      the disc's own data arms is armed here too, and the three ends it does NOT arm are
//      named with the opcode their cell actually carries — an op-8 cutscene cell and an
//      op-6 party-slot cell are not ladder cells, so nothing mounts from them. (SETTLED
//      2026-10-14, this pass: the walker's step-load liveness is NOT narrower for ops 5
//      and 6 — the disc returns live for both without reading the cone at all
//      (fieldstg.s:565c-:5664 `slti $v0,$v1,0x7` / `bnez` with `li $v0,0x1` in the delay
//      slot), and `stepLive` returns true for both; lane-b/scene-step.test.js pins that
//      class split. `PLAYBACK_ACTIVE_OPS` correctly keeps them out, because their PLAYBACK
//      table entries (file 0x1e8) are the executor's epilogue 0x5bc8, verified against
//      web/assets/native/fieldstg.bin. The disc never reaches the press arm for them
//      anyway: their setup handlers return 0, so the driver's sub-state never leaves 0.)
//   2. THE MOUNT'S OWN FACING. `a1` of the mount call, which both mount bodies store
//      into `entity+0x60` (fieldstg.s:12601 bottom / :12644 top): op 2 hands over its
//      own group (:5808) and op 3 hands over 5 when the group is 1 and 3 otherwise — the
//      `li $a1,0x3` at :5819 is the `bne`'s DELAY SLOT and runs on both paths, so only
//      the fall-through :5820 changes it. The walker's climb sprite used to be a two-way
//      guess off the group (`group === 1 ? up-left : up-right`), which disagrees with the
//      disc on 309 of the 429 armed ends; this asserts the decoded word instead.
//   3. THE LET-GO FACING. Climbing down ends in the disc's mode 0x46, which stores zero
//      into that same `entity+0x60` (fieldstg.s:13983) — so you face down on the floor.
//      Climbing up ends in mode 0x45, which never stores +0x60, so you keep the facing
//      the head mount handed you and that tile is not armed until you turn.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createTriggerSystem } from "../engine/systems/trigger-system.ts";

// The decoded mount rule, written out here so this file also stands on its own: op 2
// hands the tile's own group to the mount, op 3 hands 5 when the group is exactly 1
// and 3 otherwise (pro/fieldstg.s:5808, :5818-:5820). The port reads the same word out
// of its own actor call, and the test below compares the two over all 429 armed ends.
function decodedMountFacing(op, group) {
  return op === 2 ? group : group === 1 ? 5 : 3;
}

/** The walker's own ladder mount, as shipped — the one path that arms a ladder. */
function walkerLadderMount() {
  const game = readFileSync("web/game.js", "utf8");
  const from = game.indexOf("function startLadderClimb(");
  assert.ok(from > 0, "web/game.js still has startLadderClimb");
  return game.slice(from, game.indexOf("\n}\n", from) + 3);
}

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const STEPS = read("web/assets/data/story_steps.json").stages;
const GRIDS = read("web/assets/data/story_trigger_grids.json").stages;
const CONE = read("web/assets/data/scene/step_enable_table.json").rows;

const trigger = createTriggerSystem({
  getProgram: (mapId) => STEPS[mapId.replace(/^s/, "")] ?? null,
  getGrid: (mapId) => GRIDS[mapId.replace(/^s/, "")] ?? null,
  getEnableTable: () => ({ rows: CONE }),
  getEventById: () => null,
  getEventByKey: () => null,
  flags: { get: () => 1, set: () => {} },
  done: () => false,
  markDone: () => {},
  playEvent: () => {},
});

/** Every ladder rail end the shipped stages carry, with the cell's own grid byte. */
function census() {
  const out = [];
  for (const file of readdirSync("web/assets/scenes").filter((f) => f.endsWith(".json"))) {
    const stage = file.replace(/\.json$/, "");
    const scene = read(`web/assets/scenes/${file}`);
    const num = stage.replace(/^s/, "");
    const grid = GRIDS[num];
    const prog = STEPS[num];
    for (const [i, rail] of (scene.ladders ?? []).entries()) {
      const railKey = `${stage}#${i}`;
      for (const [end, pt] of [["bottom", rail.bottom], ["top", rail.top]]) {
        if (!grid || !prog) {
          out.push({ stage, railKey, railId: rail.id, end, pt, byte: null, op: null, live: [] });
          continue;
        }
        const cx = Math.floor(pt.x / grid.cell);
        const cy = Math.floor(pt.y / grid.cell);
        const byte = (grid.grid[cy * grid.w + cx] ?? 0) & 0xff;
        const group = (byte >> 5) & 7;
        const record = prog.steps[byte & 0x1f] ?? null;
        const live = [];
        for (let facing = 0; facing < 8; facing++) {
          const pb = trigger.playback(stage, pt.x, pt.y, facing, true);
          if (pb?.live && pb.op === (end === "top" ? 3 : 2)) live.push(facing);
        }
        out.push({ stage, railKey, railId: rail.id, end, pt, byte, group, record, live });
      }
    }
  }
  return out;
}
const ENDS = census();

test("the ladder census: 216 rails, 432 ends, and 429 of them armed by an op-2/op-3 tile", () => {
  const rails = new Set(ENDS.map((e) => e.railKey));
  assert.equal(rails.size, 216, "the game's ladder rails");
  assert.equal(ENDS.length, 432, "two ends each");
  const armed = ENDS.filter((e) => e.live.length > 0);
  assert.equal(armed.length, 429, "armed rail ends");
});

test("every armed end is armed by its OWN op-2/op-3 record, naming that endpoint", () => {
  for (const e of ENDS) {
    if (!e.live.length) continue;
    assert.equal(e.record?.op, e.end === "top" ? 3 : 2, `${e.stage} ladder ${e.railId} ${e.end} opcode`);
    assert.equal(e.record.params[0], e.railId, `${e.stage} ladder ${e.railId} ${e.end} rail id`);
    assert.equal(e.record.params[1], e.pt.x, `${e.stage} ladder ${e.railId} ${e.end} cell x`);
    assert.equal(e.record.params[2], e.pt.y, `${e.stage} ladder ${e.railId} ${e.end} cell y`);
    assert.ok(CONE[e.group][e.group], "a group always admits its own facing");
    assert.ok(e.live.includes(e.group), "and that is one of the armed facings");
  }
});

test("the three unarmed ends sit on cells whose opcode is not the ladder's", () => {
  const unarmed = ENDS.filter((e) => !e.live.length);
  assert.deepEqual(
    unarmed.map((e) => `${e.stage} ladder ${e.railId} ${e.end} carries op ${e.record?.op}`).sort(),
    [
      "s535 ladder 5 bottom carries op 8",
      "s538 ladder 5 bottom carries op 8",
      "s540 ladder 6 top carries op 6",
    ],
    "op 8 is a cutscene cell and op 6 a party-slot cell, so neither mounts a ladder",
  );
});

test("a ladder tile is armed ONLY while the player faces inside its own cone", () => {
  for (const e of ENDS) {
    if (!e.live.length) continue; // the three unarmed ends are not ladder tiles at all
    for (let facing = 0; facing < 8; facing++) {
      const inCone = !!CONE[e.group][facing];
      if (inCone) assert.ok(e.live.includes(facing), `${e.stage} ${e.end} facing ${facing} in cone ${e.group}`);
      else assert.ok(!e.live.includes(facing), `${e.stage} ${e.end} facing ${facing} outside cone ${e.group}`);
    }
    assert.equal(e.live.length, 3, `${e.stage} ${e.end}: a cone row is three facings wide`);
  }
});

test("every ladder in the game mounts you looking up-left or up-right, and its two ends agree", async () => {
  const { execPlaybackOp, ladderMountFacing } = await import("../engine/systems/scene-step-ops.ts");
  const shape = {};
  let wrong = 0;
  for (const e of ENDS) {
    if (!e.live.length) continue;
    const effect = execPlaybackOp(e.record.op, e.group, e.record.params);
    const facing = ladderMountFacing(effect);
    assert.equal(facing, decodedMountFacing(e.record.op, e.group), `${e.stage} ${e.end}: the mount's own a1`);
    assert.ok(facing === 3 || facing === 5, `${e.stage} ${e.end}: a ladder mounts facing up`);
    const key = `${e.end} tile group ${e.group} -> facing ${facing}`;
    shape[key] = (shape[key] ?? 0) + 1;
    // The walker's old rule, kept here only to measure how far off it was.
    if ((e.group === 1 ? 3 : 5) !== facing) wrong++;
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(shape).sort()),
    {
      "bottom tile group 3 -> facing 3": 94,
      "bottom tile group 5 -> facing 5": 120,
      "top tile group 1 -> facing 5": 119,
      "top tile group 7 -> facing 3": 96,
    },
    "only these four shapes exist in the shipped stages",
  );
  assert.equal(wrong, 309, "the old two-way guess mirrored 309 of the 429 armed ends the wrong way");
});

test("in every rail in the game the foot stays armed for the climb back up and the head does not", async () => {
  const { execPlaybackOp } = await import("../engine/systems/scene-step-ops.ts");
  // The foot's own cone admits the facing its op-2 mount hands over (the cone row
  // always contains its own index), so you can go straight back up. The head's cone
  // never admits the facing its op-3 mount hands over, so coming off the top leaves
  // the head unarmed until you turn. Both hold for all 429 armed ends, which is what
  // makes tools/verify_ladder_climb.mjs's stage-specific checks general.
  for (const e of ENDS) {
    if (!e.live.length) continue;
    const facing = execPlaybackOp(e.record.op, e.group, e.record.params).actorCall.args[0];
    if (e.end === "bottom") assert.ok(e.live.includes(facing), `${e.stage} bottom: foot armed for ${facing}`);
    else assert.ok(!e.live.includes(facing), `${e.stage} top: head still armed for ${facing}`);
  }
});

test("op 2 hands its own group over, op 3 folds 1 to 5 and everything else to 3", async () => {
  const { execPlaybackOp } = await import("../engine/systems/scene-step-ops.ts");
  // fieldstg.s:5818 `bne $v0,$v1` / :5819 `li $a1,0x3` (delay slot, both paths) /
  // :5820 `li $a1,0x5` (group == 1 only). op 2 is fieldstg.s:5808 `lw $a1,0x60($s0)`.
  assert.equal(execPlaybackOp(2, 3, [3, 0, 0]).actorCall.args[0], 3, "op 2 hands its group over");
  assert.equal(execPlaybackOp(2, 5, [3, 0, 0]).actorCall.args[0], 5);
  assert.equal(execPlaybackOp(3, 1, [3, 0, 0]).actorCall.args[0], 5, "op 3, group 1 -> 5");
  assert.equal(execPlaybackOp(3, 7, [3, 0, 0]).actorCall.args[0], 3, "op 3, any other group -> 3");
});

test("the walker's ladder mount reads that facing instead of guessing it from the group", () => {
  const mount = walkerLadderMount();
  assert.match(mount, /ladderMountFacing\(pb\.effect\)/,
    "startLadderClimb takes the facing from the port's actor call");
  assert.doesNotMatch(mount, /pb\.group === 1/,
    "and no longer picks the sprite side with a two-way guess off the grid byte");
});

test("letting go of the rails at the foot faces you down, and at the head keeps the mount's facing", () => {
  const game = readFileSync("web/game.js", "utf8");
  const from = game.indexOf("function tickClimb(");
  const tick = game.slice(from, game.indexOf("\n}\n", from) + 3);
  // fieldstg.s:13983 `sw $zr,0x60($s0)` in mode 0x46 (the climb-down completion),
  // and mode 0x45 at :13986 which never stores +0x60 at all.
  assert.match(tick, /done === "bottom"\) state\.dir = fieldDirectionFromIndex\(0\)/,
    "climbing down leaves the player facing down, as the disc's mode 0x46 does");
  assert.doesNotMatch(tick, /done === "top"\) state\.dir/,
    "climbing up does not touch the facing, because mode 0x45 does not either");
});

test("the climb runs on the rail x, the FOOT endpoint's x, whichever end you mounted from", async () => {
  const { ladderClimbPlan } = await import("../engine/systems/scene-step-ops.ts");
  const mount = walkerLadderMount();
  // The disc's rail axis: the bottom mount never moves x (mode 0x43, file 0xd8ec,
  // never touches entity+0x50), while the head mount's step-on mode 0x44 (file
  // 0xd950) computes x = head cell ± 16 by the side word (fieldstg.s:13927-13932).
  // Every shipped head cell sits one cell (13..18 px, 123× exactly 16) to one side
  // of the foot column, with the mount facing's sign agreeing with that side on all
  // 215 op-3 tops, so head.x ± 16 lands back on the rail within 3 px. Pinning to
  // pt.x instead left the head-mounted climb 15-17 px off the rail until the foot
  // exit snapped it back (the operator's "it is to the left or right of the ladder
  // until you are about to leave it").
  const bottom = { x: 432, y: 374 };
  const topLeft = { x: 417, y: 320 }; // s381: head cell LEFT of the rail (facing 3, side 1)
  const topRight = { x: 200, y: 236 }; // s235: head cell RIGHT of the rail (facing 5, side 0)
  assert.equal(ladderClimbPlan(bottom, topLeft, 3, true, 32).railX, 432,
    "the foot mount runs on the foot cell's own x");
  assert.equal(ladderClimbPlan(bottom, topLeft, 3, false, 32).railX, 417 + 16,
    "the head mount lands on the rail from the head cell (side 1)");
  assert.equal(ladderClimbPlan({ x: 184, y: 306 }, topRight, 5, false, 48).railX, 200 - 16,
    "and from the other side (side 0)");
  assert.match(mount, /ladderClimbPlan\(L\.bottom, L\.top, facing, fromBottom, recordHeight\)/,
    "the mount takes the rail from the decoded plan, not from the pressed endpoint");
  assert.doesNotMatch(mount, /x: pt\.x/,
    "the climb no longer pins x to whichever endpoint was mounted");

  const game = readFileSync("web/game.js", "utf8");
  const from = game.indexOf("function tickClimb(");
  const tick = game.slice(from, game.indexOf("\n}\n", from) + 3);
  assert.match(tick, /state\.x = c\.x;/,
    "tickClimb holds that rail x for the whole climb; only the dismount sets state.x = land.x");
});

