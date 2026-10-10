// The composed card duel must run our translated code, never a PlayStation
// instruction. tests/card-battle-execution-forbidden.test.js pins the duel's
// controllers (the strongest rule: they reach NO engine/native module at all).
// This file pins the composition built over them
// (engine/dw3/ui/duel-session.ts): the screen board, the scene handler's setup
// arm and the tick's queue services.
//
// The session holds its objects in the flat RAM buffer (engine/native/memory.ts)
// — the shop's data-memory rule, not the controllers' zero-module rule — but it
// must reach no runtime, mips core, bridge, decoder or executable loader. The
// negative control below proves the check sees engine/native/runtime.ts and
// engine/native/mips.ts whenever a graph links them.
//
// The ordinary duel route is NOT switched onto this session yet: the match
// itself (the nine mode updates, the effect-VM step block and the board view's
// method bodies) is still un-ported, so the session names each as a
// TranslatedGapError. web/cardduel-native.js therefore stays the ordinary route
// with no query flag, and this file asserts that residue so a future cutover
// flips it deliberately rather than the screen looking converted while it still
// runs the original.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const DUEL_CONTROLLERS = [
    "engine/dw3/ui/card-battle-scene.ts",
    "engine/dw3/ui/duel-scene-handler.ts",
    "engine/dw3/ui/duel-tick.ts",
    "engine/dw3/ui/duel-mode-machine.ts",
    "engine/dw3/ui/duel-create.ts",
    "engine/dw3/ui/card-battle-context.ts",
    "engine/dw3/ui/duel-view.ts",
    "engine/dw3/ui/duel-view-queue.ts",
    "engine/dw3/ui/duel-board-view.ts",
    "engine/dw3/ui/duel-pile-service.ts",
    "engine/dw3/ui/duel-effect-commit.ts",
    "engine/dw3/ui/duel-counter-service.ts",
    "engine/dw3/ui/duel-ai.ts",
    "engine/dw3/ui/duel-queue.ts",
    "engine/dw3/ui/cardgame-draw.ts",
];

async function nativeInputs(entryPoints) {
    const result = await build({ entryPoints, outdir: "/tmp/duel-session-execution-forbidden",
        bundle: true, write: false, metafile: true, format: "esm" });
    return Object.keys(result.metafile.inputs)
        .filter((path) => path.startsWith("engine/native/"))
        .sort();
}

test("the composed duel session links the data buffer, never an interpreter", async () => {
    const native = await nativeInputs([...DUEL_CONTROLLERS, "engine/dw3/ui/duel-session.ts"]);
    assert.deepEqual(native, ["engine/native/memory.ts"],
        "the composed duel may reach the flat data buffer, not a runtime, bridge or loader");
});

test("the interpreter check detects the interpreter when a graph links one", async () => {
    // Negative control: bundling the interpreter core must surface it, so the
    // assertion above fails if the session ever links the interpreter path.
    const flagged = await nativeInputs(["engine/native/runtime.ts"]);
    assert.ok(flagged.includes("engine/native/runtime.ts") && flagged.includes("engine/native/mips.ts"),
        `expected the interpreter when bundling it, saw ${JSON.stringify(flagged)}`);
});

test("the ordinary duel route still boots the shipped overlay through the interpreter host", () => {
    const source = readFileSync(new URL("../web/cardduel-native.js", import.meta.url), "utf8");
    assert.match(source, /native-screen-host\.js/, "the adapter boots the overlay through the host");
    assert.match(source, /openNativeScreen/, "the adapter opens an interpreter-backed screen");
    const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
    assert.match(game, /const USE_NATIVE_DUEL = !GYM_PARAMS\.has\("legacyDuel"\)/,
        "the card duel ordinary route is the native adapter, until the session can run a match");
});
