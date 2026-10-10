// The Card Album's own decisions must run as our translated code, never through
// the PlayStation interpreter. Three things are asserted, and all must hold:
//
//   1. The screen's composed session reaches data memory and nothing else.
//      Bundling engine/dw3/ui/album-session.ts pulls in engine/native/memory.ts
//      (the flat RAM buffer) and no interpreter, decoder, bridge or executable
//      loader. A route that linked the interpreter would add
//      engine/native/runtime.ts and fail here; the negative control below proves
//      the check detects an interpreter when a graph does link one.
//   2. The adapter (web/cardalbum-translated.js) declares `execution:
//      "translated"`, the mark every other converted screen carries, and links
//      no interpreter host. The browser verifier
//      (tools/verify_translated_album.mjs) refuses a screen that reports
//      anything else, and it also aborts every assets/native/** request.
//   3. The ordinary route is the translated screen; the shipped overlay is the
//      explicit research reference behind ?nativeAlbum=1.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

/** The engine/native modules a bundle of these entry points can reach. */
async function nativeInputs(entryPoints) {
  const result = await build({ entryPoints, outdir: "/tmp/album-execution-forbidden",
    bundle: true, write: false, metafile: true, format: "esm" });
  return Object.keys(result.metafile.inputs)
    .filter((path) => path.startsWith("engine/native/")).sort();
}

test("the album session links data memory, never an interpreter", async () => {
  const native = await nativeInputs(["engine/dw3/ui/album-session.ts"]);
  assert.deepEqual(native, ["engine/native/memory.ts"],
    "the album session must reach only the data buffer, no runtime, bridge or loader");
});

test("the interpreter check detects the interpreter when a graph links one", async () => {
  // Negative control: bundling an interpreter module must surface it. This
  // pins the filter itself, independent of the production barrel, which since
  // the 2026-10-06 bundle split no longer reaches the interpreter (engine/index.ts
  // exports no engine/native/**; the research entry engine/native-entry.ts does).
  const flagged = await nativeInputs(["engine/native/runtime.ts"]);
  assert.ok(flagged.includes("engine/native/runtime.ts") && flagged.includes("engine/native/mips.ts"),
    `expected the interpreter when bundling it, saw ${JSON.stringify(flagged)}`);
});

test("the album adapter declares translated execution and links no interpreter host", () => {
  const source = readFileSync(new URL("../web/cardalbum-translated.js", import.meta.url), "utf8");
  assert.match(source, /execution:\s*"translated"/, "the album adapter declares translated execution");
  assert.doesNotMatch(source, /native-screen-host|native\/runtime|native\/bridge|native\/cpu/,
    "the album adapter must not link an interpreter host");
});

test("the album's ordinary route is the translated screen, the reference behind ?nativeAlbum=1", () => {
  const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
  assert.match(game, /const cardAlbum = GYM_PARAMS\.has\("legacyAlbum"\) \? cardAlbumLegacy/,
    "the album route branches on the flags");
  assert.match(game, /GYM_PARAMS\.has\("nativeAlbum"\) \? cardAlbumNative : cardAlbumTranslated/,
    "the ordinary route is the translated screen; ?nativeAlbum=1 is the reference");
  const reference = readFileSync(new URL("../web/cardalbum-native.js", import.meta.url), "utf8");
  assert.match(reference, /openNativeScreen/, "the reference still boots the shipped overlay");
});
