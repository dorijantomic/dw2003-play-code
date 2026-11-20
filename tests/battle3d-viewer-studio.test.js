// setViewerStudio(false) (the glossary): isolated mode without the viewer's background, grid/axis lines and floor quad, see-through clear.
// battle3d.js needs WebGL, so this reads the source; the GPU run in the task report proves the picture.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSource } from "./helpers/source.js";

const src = readSource(new URL("../web/battle3d.js", import.meta.url));

test("setViewerStudio exists, defaults to true (the animation viewer is unchanged)", () => {
    assert.match(src, /B\$\.viewerStudio = true;/);
    assert.match(src, /setViewerStudio\(on\) \{ B\$\.viewerStudio = !!on; return B\$\.viewerStudio; \}/);
});

test("with the studio off: clear alpha 0, no neutral background quad, no grid, no floor quad shadow", () => {
    assert.match(src, /if \(B\$\.builtArena \|\| \(B\$\.isolatedMode && !B\$\.viewerStudio\)\) B\$\.gl\.clearColor\(0, 0, 0, 0\);/);
    assert.match(src, /if \(B\$\.viewerStudio\) drawQuad\(B\$\.gl, B\$\.texP, B\$\.IDENT_MVP, B\$\.skyBufs, B\$\.whiteTex, 1, \[0\.085/);
    assert.match(src, /if \(B\$\.isolatedMode && B\$\.viewerStudio\) B\$\.drawViewerGrid\(pv\);/);
    assert.match(src, /const studioOff = B\$\.isolatedMode && !B\$\.viewerStudio;/);
});
