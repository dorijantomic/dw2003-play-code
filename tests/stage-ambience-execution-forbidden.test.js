// The field's stage ambience — a stage boots its own actors — must run as OUR
// translated code on the ORDINARY route, never through the PlayStation
// interpreter. This is the same proof tests/shop-execution-forbidden.test.js
// carries for the merchant and tests/lab-execution-forbidden.test.js for the
// digivolution screen, applied to the field surface named by
// tools/execution_forbidden_audit.mjs (`field`).
//
// Three things are asserted:
//
//   1. The translated ambience modules reach NO interpreter. Bundling the whole
//      set that web/stage-objects.js and web/effects.js drive pulls in no
//      engine/native/** module at all — not even the RAM buffer. A route that
//      linked the interpreter would add engine/native/runtime.ts and fail here;
//      the negative control below proves the check detects one when a graph does
//      link it.
//   2. The overlay is behind an explicit research switch. web/game.js defines
//      USE_NATIVE_STAGE from ?nativeStages and only calls enterNativeStage /
//      tickNativeStage inside `if (USE_NATIVE_STAGE)`, so no flag never boots it.
//   3. The adapter declares `execution: "translated"` and the browser verifier
//      (tools/verify_translated_field_ambience.mjs) aborts every
//      assets/native/** request and refuses any other mark.
//
// The translated actors' own decoded table is checked too: the shipped
// point-record actor table must carry s415's ride walker (0x32b), the member the
// browser verifier drives through the game's SETANIM route, as the SAME module
// the harness bundles.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import {
  loadPointRecordActors,
  pointRecordActorStages,
  hasPointRecordActor,
} from "../engine/systems/point-record-actor.ts";

/** The translated ambience modules the ordinary route runs. */
const AMBIENCE_ENTRIES = [
  "engine/systems/point-record-actor.ts",
  "engine/systems/falling-object.ts",
  "engine/systems/street-vehicles.ts",
  "engine/systems/street-screens.ts",
  "engine/systems/street-lights.ts",
  "engine/systems/stinger-popup.ts",
  "engine/systems/stage-fixed-sprite.ts",
  "engine/systems/stage-slot-player.ts",
  "engine/systems/stage-slot-ensemble.ts",
  "engine/systems/shape-annotator.ts",
  "engine/systems/draw-context.ts",
  "engine/systems/field-character.ts",
];

/** The engine/native modules a bundle of these entry points can reach. */
async function nativeInputs(entryPoints) {
  const result = await build({ entryPoints, outdir: "/tmp/stage-ambience-execution-forbidden",
    bundle: true, write: false, metafile: true, format: "esm" });
  return Object.keys(result.metafile.inputs)
    .filter((path) => path.startsWith("engine/native/"))
    .sort();
}

test("the field's stage-ambience modules reach no interpreter at all", async () => {
  const native = await nativeInputs(AMBIENCE_ENTRIES);
  assert.deepEqual(native, [],
    "the translated ambience must reach no engine/native module, not even the RAM buffer");
});

test("the interpreter check detects the interpreter when a graph links one", async () => {
  // Negative control: the research entry engine/native-entry.ts owns the
  // interpreter (the production barrel engine/index.ts no longer reaches one
  // after the 2026-10-06 bundle split). If the check above could not see
  // engine/native/runtime.ts, this assertion would not either.
  const flagged = await nativeInputs(["engine/native-entry.ts"]);
  assert.ok(flagged.includes("engine/native/runtime.ts"),
    `expected the interpreter in the research-entry graph, saw ${JSON.stringify(flagged)}`);
});

test("the overlay is behind an explicit research switch on the stage-entry path", () => {
  const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
  assert.match(game,
    /const USE_NATIVE_STAGE = new URLSearchParams\(location\.search\)\.has\("nativeStages"\)/,
    "web/game.js defines USE_NATIVE_STAGE from ?nativeStages");
  // The boot and the per-frame entry tick are both inside the guard; the
  // decision line the audit locates is the guarded `enterNativeStage(mapId, {`.
  assert.match(game, /if \(USE_NATIVE_STAGE\) \{\s*try \{\s*enterNativeStage\(mapId, \{/,
    "enterNativeStage(mapId, { is inside `if (USE_NATIVE_STAGE)`");
  assert.match(game, /if \(USE_NATIVE_STAGE\) \{[\s\S]*?tickNativeStage\(mapId\)/,
    "the first native tick is inside `if (USE_NATIVE_STAGE)`");
});

test("the ambience adapter declares translated execution and its browser check denies executable assets", () => {
  const adapter = readFileSync(new URL("../web/stage-objects.js", import.meta.url), "utf8");
  assert.match(adapter, /execution:\s*"translated"/, "web/stage-objects.js declares translated execution");
  // Its reference to the overlay driver is the stand-down read (`nativeStage`),
  // never a screen host, runtime, bridge or CPU.
  assert.doesNotMatch(adapter, /native-screen-host|native\/runtime|native\/bridge|native\/cpu/,
    "web/stage-objects.js must not link an interpreter host");
  // The ordinary-route verifier must abort every executable asset request, so a
  // production run that reached for assets/native/** would fail rather than pass.
  const verifier = readFileSync(new URL("../tools/verify_translated_field_ambience.mjs", import.meta.url), "utf8");
  assert.match(verifier, /assets\/native\/\*\*/, "the verifier intercepts assets/native/**");
  assert.match(verifier, /route\.abort\(\)/, "the verifier aborts executable asset requests");
  assert.match(verifier, /"translated"/, "the verifier refuses a screen that does not report translated execution");
});

test("the shipped ambience table carries the field's own stage actors, one module", () => {
  const table = JSON.parse(readFileSync(new URL("../web/assets/data/point_record_actors.json", import.meta.url), "utf8"));
  assert.ok(table.summary?.members > 0, "the extracted actor table is not empty");
  loadPointRecordActors(table);
  const stages = pointRecordActorStages();
  assert.ok(stages.includes("s415"), `point-record actor stages name s415, got ${stages.slice(0, 5).join(",")}...`);
  // s415 0x32b (dec 811) is the crevice ride's own actor, the member the browser
  // verifier drives; its machine is the ride walker.
  assert.ok(hasPointRecordActor("s415", 0x32b), "s415 0x32b is a ported actor");
  assert.equal(table.stages.s415["811"].machine, "ride-walker",
    "s415 0x32b is the ride-walker machine");
});
