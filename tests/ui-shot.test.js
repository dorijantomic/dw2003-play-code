// The screenshot helper refuses software renderers (tools/ui_shot.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { SHOT_DIR, rendererIsGpu } from "../tools/ui_shot.mjs";

test("AMD hardware strings pass; SwiftShader, llvmpipe, software and unknown strings fail", () => {
    assert.equal(rendererIsGpu("ANGLE (AMD, D3D12 (AMD Radeon RX 9060 XT), OpenGL 4.6)"), true);
    assert.equal(rendererIsGpu("D3D12 (AMD Radeon(TM) Graphics)"), true);
    assert.equal(rendererIsGpu("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)"), false);
    assert.equal(rendererIsGpu("llvmpipe (LLVM 15.0.7, 256 bits)"), false);
    assert.equal(rendererIsGpu("Software rasterizer AMD"), false);
    assert.equal(rendererIsGpu("Mesa Intel(R) UHD"), false);
    assert.equal(rendererIsGpu(""), false);
    assert.equal(rendererIsGpu(undefined), false);
});

test("screenshots go to the review folder the main session reads", () => {
    assert.equal(SHOT_DIR, "/home/dorij/ui-review/build/");
});
