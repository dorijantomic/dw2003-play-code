// The card-battle screens (Card Album, folder editor, card duel) sit between two
// states, and this file pins both so neither can drift silently.
//
//   1. The screens' own translated logic is complete enough to run without any
//      PlayStation instruction. Bundling the album's controllers
//      (engine/dw3/ui/native/album-*.ts), its three newly ported leaves
//      (engine/dw3/ui/native/album-leaves.ts: pageMask, cellPaint, popup) and the
//      duel's translated controllers (card-battle-scene, duel-scene-handler,
//      duel-tick, duel-mode-machine, duel-create, card-battle-context, duel-view,
//      duel-view-queue, duel-queue, cardgame-draw) reaches NO interpreter module
//      at all -- not even the RAM buffer. A route that linked the interpreter
//      would add engine/native/runtime.ts; the negative control below proves the
//      check sees it when a graph does link one. This is the strongest form of
//      the shop/lab proof: those controllers reach engine/native/memory.ts, these
//      reach nothing under engine/native/.
//
//   2. The ORDINARY route is still interpreter-backed for all three screens. The
//      adapters web/cardalbum-native.js, web/carddeck-native.js and
//      web/cardduel-native.js boot the shipped overlays through
//      web/native-screen-host.js, and web/game.js selects them with no query flag.
//      That is the measured residue (tools/execution_forbidden_audit.mjs,
//      docs/research/systems/execution-forbidden-audit-2026-10-05.md: "Card
//      Album / Card folder editor / Card duel -- interpreter-reachable"). This
//      file asserts that residue is still visible, so a future cutover must flip
//      these assertions deliberately (adapter reports execution: "translated",
//      bundle reaches no interpreter) instead of the screen looking converted
//      while it still runs the original.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

/** The engine/native modules a bundle of these entry points can reach. */
async function nativeInputs(entryPoints) {
    const result = await build({ entryPoints, outdir: "/tmp/card-battle-execution-forbidden",
        bundle: true, write: false, metafile: true, format: "esm" });
    return Object.keys(result.metafile.inputs)
        .filter((path) => path.startsWith("engine/native/"))
        .sort();
}

const ALBUM_CONTROLLERS = [
    "engine/dw3/ui/native/album-lifecycle.ts",
    "engine/dw3/ui/native/album-tick.ts",
    "engine/dw3/ui/native/album-grid-object.ts",
    "engine/dw3/ui/native/album-grid.ts",
    "engine/dw3/ui/native/album-panel.ts",
    "engine/dw3/ui/native/album-cells-draw.ts",
    "engine/dw3/ui/native/album-banks.ts",
    "engine/dw3/ui/native/album-leaves.ts",
    "engine/dw3/ui/album-residue.ts",
];
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

test("the album and duel controllers link no interpreter at all", async () => {
    const native = await nativeInputs([...ALBUM_CONTROLLERS, ...DUEL_CONTROLLERS]);
    assert.deepEqual(native, [],
        "the card-battle screen controllers must reach no engine/native module, no interpreter");
});

test("the interpreter check detects the interpreter when a graph links one", async () => {
    // Negative control: bundling an interpreter module must surface it. This
    // pins the filter itself, independent of the production barrel, which since
    // the 2026-10-06 bundle split no longer reaches the interpreter (the
    // research entry engine/native-entry.ts does).
    const flagged = await nativeInputs(["engine/native/runtime.ts"]);
    assert.ok(flagged.includes("engine/native/runtime.ts") && flagged.includes("engine/native/mips.ts"),
        `expected the interpreter when bundling it, saw ${JSON.stringify(flagged)}`);
});

test("the three ordinary-route adapters still boot the shipped overlay through the interpreter host", () => {
    // The residue, asserted so it cannot disappear from the measurement without
    // the adapter actually being converted. Each adapter must import the native
    // screen host (the interpreter driver). The FOLDER editor and the DUEL are
    // still selected with no query flag; the ALBUM is now the translated screen
    // (below), and the same adapter stays as its ?nativeAlbum=1 reference.
    for (const file of ["web/cardalbum-native.js", "web/carddeck-native.js", "web/cardduel-native.js"]) {
        const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
        assert.match(source, /native-screen-host\.js/,
            `${file} boots the overlay through the native screen host`);
        assert.match(source, /openNativeScreen/, `${file} opens an interpreter-backed screen`);
    }
    // web/game.js selects the native adapter with no query flag (the ordinary
    // route) for the duel; the ?legacy*=1 rollbacks are hand-authored, not
    // translated. The album's and the folder editor's ordinary routes are the
    // translated screens, with the native adapters behind ?nativeAlbum=1 /
    // ?nativeFolder=1.
    const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
    assert.match(game, /const cardAlbum = GYM_PARAMS\.has\("legacyAlbum"\) \? cardAlbumLegacy\n\s*: GYM_PARAMS\.has\("nativeAlbum"\) \? cardAlbumNative : cardAlbumTranslated/,
        "the Card Album ordinary route is the translated screen");
    assert.match(game, /const cardDeck = GYM_PARAMS\.has\("legacyDeck"\) \? cardDeckLegacy\n\s*: GYM_PARAMS\.has\("nativeFolder"\) \? cardDeckNative : cardDeckTranslated/,
        "the folder editor ordinary route is the translated screen");
    assert.match(game, /const USE_NATIVE_DUEL = !GYM_PARAMS\.has\("legacyDuel"\)/,
        "the card duel ordinary route is the native adapter");
});

test("the album's three remaining leaves are ported", async () => {
    const mod = await import("../engine/dw3/ui/native/album-leaves.ts");
    for (const name of ["albumPageMask", "albumCellPaint", "albumMakePopup"]) {
        assert.equal(typeof mod[name], "function", `album-leaves exports ${name}`);
    }
    // The addresses the tick and lifecycle call, from the pro/stcrdabm overlay.
    assert.equal(mod.ALBUM_PAGE_CELLS, 12);
    assert.deepEqual(mod.ALBUM_SPECIAL_CARDS, [0x45, 0x70, 0x9b, 0xc6, 0xf1]);
});
