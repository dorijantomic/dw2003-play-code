// setViewerStudio(false) (the glossary): isolated mode without the viewer's background, grid/axis lines and floor quad, see-through clear.
// battle3d.js needs WebGL, so this reads the source; the GPU run in the task report proves the picture.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../web/battle3d.js", import.meta.url), "utf8");

test("setViewerStudio exists, defaults to true (the animation viewer is unchanged)", () => {
    assert.match(src, /let viewerStudio = true;/);
    assert.match(src, /setViewerStudio\(on\) \{ viewerStudio = !!on; return viewerStudio; \}/);
});

test("with the studio off: clear alpha 0, no neutral background quad, no grid, no floor quad shadow", () => {
    assert.match(src, /if \(builtArena \|\| \(isolatedMode && !viewerStudio\)\) gl\.clearColor\(0, 0, 0, 0\);/);
    assert.match(src, /if \(viewerStudio\) drawQuad\(gl, texP, IDENT_MVP, skyBufs, whiteTex, 1, \[0\.085/);
    assert.match(src, /if \(isolatedMode && viewerStudio\) drawViewerGrid\(pv\);/);
    assert.match(src, /const studioOff = isolatedMode && !viewerStudio;/);
});
