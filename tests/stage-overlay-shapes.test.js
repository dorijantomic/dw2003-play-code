// tests/stage-overlay-shapes.test.js
//
// The stage native-overlay SHAPE DRAW: the per-frame table of shapes a `wstag`
// overlay paints through the resident 2D draw-context service's shared emitter
// (F0x8001ED6C, the transient block's +0x84 slot). The table and the ordering
// bucket are authored data, so ONE shared draw runs every stage that has one.
//
// Decode: docs/research/field/draw-context-service-2026-10-04.md and the header
// of tools/extract_stage_overlay_shapes.py.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "web/assets/data/stage_overlay_shapes.json");
const TOOL = join(ROOT, "tools/extract_stage_overlay_shapes.py");
const EFFECTS = join(ROOT, "web/effects.js");
const GAME = join(ROOT, "web/game.js");

test("the overlay shape table is extracted, and carries Protocol Ruins", () => {
    assert.ok(existsSync(DATA), "stage_overlay_shapes.json must exist");
    const data = JSON.parse(readFileSync(DATA, "utf8"));
    // Protocol Ruins is the first check, and its Amaterasu twin shares the data.
    for (const id of ["s375", "s949"]) {
        const info = data[id];
        assert.ok(info, `${id} must carry an overlay shape table`);
        // 36 stamps of directory clip 0, all on one ordering bucket.
        assert.equal(info.shapes.length, 36, `${id}: 36 authored positions`);
        assert.equal(info.bucket, 12, `${id}: ordering-table bucket 12`);
        assert.equal(info.shift, 3, `${id}: the parallax shift`);
        assert.equal(info.baseX, 704, `${id}: the x reference`);
        assert.equal(info.baseY, 640, `${id}: the y reference`);
        assert.ok(info.shapes.every((s) => s.id === 0), `${id}: clip 0 only`);
        // The first three authored positions, straight off the table.
        assert.deepEqual(info.shapes.slice(0, 3), [
            { id: 0, x: 596, y: 399 },
            { id: 0, x: 809, y: 564 },
            { id: 0, x: 820, y: 832 },
        ]);
    }
});

test("the extractor recomputes the committed table (no disc: skipped)", () => {
    // The extractor reads ~/ddw3, which a CI box need not have. When it is not
    // there, the committed table is the only source, and the shape assertions
    // above still hold it to the decode.
    if (!existsSync(join(process.env.HOME || "", "ddw3/asm/dw2003/pro/wstag375.s"))) {
        return;
    }
    const out = execFileSync("python3", [TOOL, "--check"], { cwd: ROOT, encoding: "utf8" });
    assert.match(out, /up to date/, "the committed table must match the disc");
});

test("one shared draw runs the table, under the base map", () => {
    const effects = readFileSync(EFFECTS, "utf8");
    assert.match(effects, /export function drawStageOverlayShapes\(/,
        "effects.js exports the shared draw");
    assert.match(effects, /export function stageOverlayShapeProbe\(/,
        "effects.js exposes the table for verification");
    assert.match(effects, /stage_overlay_shapes\.json/, "effects.js loads the table");
    // The draw blits the stage's own sprite sheet through the same drawSprite
    // the pads and scenery use -- no invented primitive.
    const body = effects.slice(effects.indexOf("export function drawStageOverlayShapes("));
    assert.match(body.slice(0, 900), /drawSprite\(/, "the shapes blit real texels");
    const game = readFileSync(GAME, "utf8");
    // Called before the base map, so the map ground and every entity draw over
    // it -- the console's order for a bucket-12 drawable.
    const call = game.indexOf("drawStageOverlayShapes(ctx, m.id, camX, camY)");
    const map = game.indexOf("if (mapImg instanceof Image) {");
    assert.ok(call > 0, "game.js runs the shared draw");
    assert.ok(call < map, "it paints under the base map");
});

test("the tree reaction has ONE trigger: the player's action button", () => {
    // The disc builds Junior's kick actor (fieldstg F0x8008d244) from exactly
    // ONE site corpus-wide -- the tree manager's mode-2/phase-0 arm -- and the
    // manager's mode reaches 2 from the default field handler, on the action
    // button, gated by the TreeBoots flag. There is no scripted/NPC entry, so
    // the walker must not grow a second path either.
    const game = readFileSync(GAME, "utf8");
    const calls = [...game.matchAll(/startTreeKick\(/g)].length;
    assert.equal(calls, 1, "startTreeKick is called from one place (tryTreeKick)");
    const kick = readFileSync(join(ROOT, "engine/systems/tree-kick.ts"), "utf8");
    assert.ok(!/\bnpc\b/i.test(kick), "the tree manager has no NPC entry");
});
