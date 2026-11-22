// web/gl-shared.js — the ONE three.js WebGL context of the field (water3d, grass3d and the
// underwater fishing inset all render into it, one after the other, inside the same frame;
// each consumer copies the canvas out at once, so nothing is left in it between uses).
//
// Why: every extra WebGL context is another D3D11 device queue in the browser GPU process;
// a lost GPU process (BindToCurrentSequence failed) took every tab down. One context, not three.
//
// Context loss: the first webglcontextlost marks the share lost; consumers get null and draw
// nothing (the field falls back to its 2D look). Never retried in a loop.
import * as THREE from "./lib3d/three.module.js";

let renderer = null;
let lost = false;
let failed = false;
let factory = null;     // tests only

/** The shared renderer sized w x h (device px), or null (no WebGL / lost). */
export function getSharedRenderer(w: number, h: number) {
    if (lost || failed) return null;
    if (!renderer) {
        try {
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            renderer = factory
                ? factory(canvas)
                : new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
            renderer.setPixelRatio(1);
            renderer.setSize(w, h, false);
            renderer.setClearColor(0x000000, 0);
            canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lost = true; });
            canvas.addEventListener("webglcontextrestored", () => { lost = false; });
        } catch (e) {
            console.warn("gl-shared: WebGL unavailable", e);
            renderer = null;
            failed = true;
            return null;
        }
    }
    if (renderer.getContext?.().isContextLost?.()) { lost = true; return null; }
    if (renderer.domElement.width !== w || renderer.domElement.height !== h) renderer.setSize(w, h, false);
    return renderer;
}

export function sharedLost() { return lost; }
export function sharedContextCount() { return renderer ? 1 : 0; }
export function __setSharedFactory(f: () => THREE.WebGLRenderer) { factory = f; renderer = null; lost = false; failed = false; }
