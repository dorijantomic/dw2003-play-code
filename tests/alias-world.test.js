import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = read("web/assets/manifest.json");
const maps = new Map(manifest.maps.map((m) => [m.id, m]));

test("all 55 final-ordinal alias stages reuse their shared base assets", () => {
  for (let stage = 920; stage <= 974; stage++) {
    const map = maps.get(`s${stage}`);
    assert.ok(map, `s${stage} missing from manifest`);
    assert.match(map.assetSource, /^s\d+$/);
    assert.equal(map.image, `assets/maps/${map.assetSource}.png`);
    if (map.collision) {
      assert.equal(map.collision, `assets/collision/${map.assetSource}.json`);
    }
  }
});

test("s920-s959 exits stay inside the decoded alias world", () => {
  for (let stage = 920; stage <= 959; stage++) {
    const scene = read(`web/assets/scenes/s${stage}.json`);
    for (const exit of scene.exits ?? []) {
      const dest = Number(exit.to.slice(1));
      const inSurfaceWorld = dest >= 920 && dest <= 959;
      const inAliasUnderground = exit.transition === "dive" && dest >= 960 && dest <= 969;
      assert.ok(inSurfaceWorld || inAliasUnderground,
        `s${stage} leaked to base-world destination ${exit.to}`);
    }
  }
});

test("s960-s974 self-warp pads are confirm-gated same-map wraps", () => {
  // Runtime-verified (rig capture, ordinal 45): the type-7 pads on these alias
  // underground/seabed/circuit stages are same-screen op-1 warps triggered by the
  // confirm-edge (input bit 0x2000), not automatic collision teleports — so they
  // are exposed as ordinary confirm exits that reposition within the same map and
  // cannot auto-loop. See docs/todo/2026-07-09-self-warp-maze-wiring.md.
  for (let stage = 960; stage <= 974; stage++) {
    const scene = read(`web/assets/scenes/s${stage}.json`);
    for (const exit of scene.exits ?? []) {
      assert.equal(exit.selfWarp, true, `s${stage} exit is not a self-warp`);
      assert.equal(exit.to, `s${stage}`, `s${stage} self-warp leaks to ${exit.to}`);
      assert.equal(exit.transition, "wrap");
      assert.equal(exit.grid, true);
      assert.equal(typeof exit.spawnX, "number");
      assert.equal(typeof exit.spawnY, "number");
      assert.equal(typeof exit.dir, "string");
    }
  }
});

test("decoded final-world dive controllers reach alias underground stages", () => {
  const dives = [];
  for (let stage = 920; stage <= 959; stage++) {
    const scene = read(`web/assets/scenes/s${stage}.json`);
    dives.push(...(scene.exits ?? []).filter((exit) => exit.transition === "dive"));
  }
  assert.equal(dives.length, 19);
  for (const exit of dives) {
    const dest = Number(exit.to.slice(1));
    assert.ok(dest >= 960 && dest <= 969, `dive leaked to ${exit.to}`);
    assert.ok(exit.stepOp === 9 || exit.stepOp === 10);
    assert.equal(exit.grid, true);
    assert.equal(typeof exit.dir, "string");
  }
});

test("ordinary-world dives retain their decoded progress gates", () => {
  const dives = [];
  for (const map of manifest.maps) {
    const stage = Number(map.id.slice(1));
    if (stage >= 920) continue;
    const scene = read(`web/assets/scenes/${map.id}.json`);
    dives.push(...(scene.exits ?? []).filter((exit) => exit.transition === "dive"));
  }
  // 137 as of 2026-07-27: +4 from stages that gained a step program when
  // extract_story_steps.py started reading the scene+0x14 pointer for stages
  // with no event table (98 -> 287 covered). All 137 satisfy the gate
  // invariants asserted below; only the count moved.
  assert.equal(dives.length, 137);
  for (const exit of dives) {
    assert.equal(exit.gate.flag, exit.stepOp === 9 ? 0x7094 : 0x7093);
    assert.equal(exit.gate.eq, 1);
    if (exit.gate.flag_b != null) {
      assert.equal(exit.gate.flag_b, 0x1a26);
      assert.equal(exit.gate.eq_b, 0);
    }
  }
});
