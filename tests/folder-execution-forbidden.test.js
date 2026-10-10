// The folder editor's own decisions must run as our translated code, never
// through the PlayStation interpreter. Two things are asserted here, both the
// shop's shape (tests/shop-execution-forbidden.test.js):
//
//   1. The controllers reach data memory and nothing else. Bundling the folder
//      session and every pro/stcrddek controller it composes pulls in
//      engine/native/memory.ts (the flat RAM buffer) and no interpreter,
//      decoder, bridge or executable loader. A route that linked the
//      interpreter would add engine/native/runtime.ts and fail here; the
//      negative control below proves the check detects an interpreter.
//   2. The adapter declares `execution: "translated"`, the mark every other
//      converted screen carries. tools/verify_translated_folder.mjs refuses a
//      screen that reports anything else, and it aborts every assets/native/**
//      request.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const FOLDER_CONTROLLERS = [
  "engine/dw3/ui/folder-session.ts",
  "engine/dw3/ui/native/folder-selection.ts",
  "engine/dw3/ui/native/folder-screen.ts",
  "engine/dw3/ui/native/folder-lifecycle.ts",
  "engine/dw3/ui/native/folder-picker-tick.ts",
  "engine/dw3/ui/native/folder-banks.ts",
  "engine/dw3/ui/native/folder-card-grid.ts",
  "engine/dw3/ui/native/folder-name-keyboard.ts",
  "engine/dw3/ui/folder-list-create.ts",
  "engine/dw3/ui/folder-list-row.ts",
  "engine/dw3/ui/folder-list-colours.ts",
];

/** The engine/native modules a bundle of these entry points can reach. */
async function nativeInputs(entryPoints) {
  const result = await build({ entryPoints, outdir: "/tmp/folder-execution-forbidden",
    bundle: true, write: false, metafile: true, format: "esm" });
  return Object.keys(result.metafile.inputs).filter((path) => path.startsWith("engine/native/"));
}

test("the folder controllers link data memory, never an interpreter", async () => {
  const native = await nativeInputs(FOLDER_CONTROLLERS);
  assert.deepEqual(native, ["engine/native/memory.ts"],
    "the folder controllers must reach only the data buffer, no runtime, bridge or loader");
});

test("the interpreter check detects the interpreter when a graph links one", async () => {
  // Negative control: engine/native-entry.ts is the reference interpreter host
  // and does reach the runtime. If the check above could not see
  // engine/native/runtime.ts, this assertion would not either.
  const flagged = await nativeInputs(["engine/native-entry.ts"]);
  assert.ok(flagged.includes("engine/native/runtime.ts"),
    `expected the interpreter in the reference-host graph, saw ${JSON.stringify(flagged)}`);
});

test("the folder adapter declares translated execution and links no interpreter host", () => {
  const source = readFileSync(new URL("../web/carddeck-translated.js", import.meta.url), "utf8");
  assert.match(source, /execution:\s*"translated"/, "carddeck-translated.js declares translated execution");
  assert.doesNotMatch(source, /native-screen-host|native\/runtime|native\/bridge|native\/cpu/,
    "carddeck-translated.js must not link an interpreter host");
});

test("web/game.js routes the ordinary folder editor at the translated adapter", () => {
  const source = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
  assert.match(source, /createCardDeckTranslated\(sfx\)/, "the translated folder adapter is built");
  assert.match(source, /GYM_PARAMS\.has\("nativeFolder"\)\s*\?\s*cardDeckNative\s*:\s*cardDeckTranslated/,
    "the native overlay is behind ?nativeFolder=1 and the ordinary route uses the translated adapter");
});
