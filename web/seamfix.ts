// EXPERIMENT: seam fixes for the stitched 2D overworld maps.
//
// Some map pictures have pin-holes and hairline cracks: see-through pixels (alpha
// < 255) fully enclosed by picture, through which the frame's clear colour shows
// as a black dot or line. Big enclosed cut-outs are NOT seams (a sprite or the
// layer split fills them) and the big void around a room map is not either, so
// only two things count here:
//   * an enclosed hole of at most MAX_AREA pixels, and
//   * an enclosed crack no more than ~4 pixels wide (no pixel has a 5x5 window of
//     see-through around it).
// Each is filled from the colours around it into a PATCH canvas (the filler
// pixels only), which game.js draws over the ground. The map image itself is
// never touched, so the Effects panel can switch the fix on and off instantly.
const MAX_AREA = 80;       // any enclosed hole this small is a seam
const MAX_CRACK = 6000;    // a crack longer than this is treated as real art
const patches = new Map(); // stageId -> { canvas, regions, pixels } | null

export function seamPatchFor(stageId, img) {
    let p = patches.get(stageId);
    if (p !== undefined) return p;
    p = build(img);
    patches.set(stageId, p);
    if (p) console.log(`seamfix: ${stageId} -> ${p.regions} seams, ${p.pixels}px patched`);
    return p;
}

function build(img) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const src = cx.getImageData(0, 0, W, H).data;
    const hole = new Uint8Array(W * H);
    let any = false;
    for (let i = 0, n = W * H; i < n; i++) if (src[i * 4 + 3] < 128) { hole[i] = 1; any = true; }
    if (!any) return null;

    const seen = new Uint8Array(W * H);
    const stack = [];
    const fix = [];                     // pixel indices to fill
    let regions = 0;
    const thick = (i) => {              // is the 5x5 window around i all see-through?
        const x = i % W, y = (i / W) | 0;
        if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) return false;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!hole[i + dy * W + dx]) return false;
        return true;
    };
    for (let start = 0, n = W * H; start < n; start++) {
        if (!hole[start] || seen[start]) continue;
        const comp = [];
        let border = false, big = false;
        stack.length = 0; stack.push(start); seen[start] = 1;
        while (stack.length) {
            const i = stack.pop();
            if (!big) { comp.push(i); if (comp.length > MAX_CRACK) { big = true; comp.length = 0; } }
            const x = i % W, y = (i / W) | 0;
            if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
            if (x > 0 && hole[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
            if (x < W - 1 && hole[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
            if (y > 0 && hole[i - W] && !seen[i - W]) { seen[i - W] = 1; stack.push(i - W); }
            if (y < H - 1 && hole[i + W] && !seen[i + W]) { seen[i + W] = 1; stack.push(i + W); }
        }
        if (border || big) continue;
        if (comp.length > MAX_AREA && comp.some(thick)) continue;   // a real cut-out, not a crack
        regions++;
        for (const i of comp) fix.push(i);
    }
    if (!fix.length) return null;

    // Fill from the outside in: each pass paints the hole pixels that touch a known
    // colour with the average of their known neighbours (8-neighbourhood).
    const out = new Uint8ClampedArray(W * H * 4);
    const known = new Uint8Array(W * H);
    for (let i = 0, n = W * H; i < n; i++) if (!hole[i]) known[i] = 1;
    const col = (i) => (out[i * 4 + 3] ? out : src);
    let todo = fix;
    for (let pass = 0; pass < 40 && todo.length; pass++) {
        const rest = [], paint = [];
        for (const i of todo) {
            const x = i % W, y = (i / W) | 0;
            let r = 0, g = 0, b = 0, c = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const j = ny * W + nx;
                if (!known[j]) continue;
                const a = col(j);
                r += a[j * 4]; g += a[j * 4 + 1]; b += a[j * 4 + 2]; c++;
            }
            if (c) paint.push(i, r / c, g / c, b / c); else rest.push(i);
        }
        for (let k = 0; k < paint.length; k += 4) {
            const i = paint[k];
            out[i * 4] = paint[k + 1]; out[i * 4 + 1] = paint[k + 2]; out[i * 4 + 2] = paint[k + 3]; out[i * 4 + 3] = 255;
            known[i] = 1;
        }
        todo = rest;
    }
    const patch = document.createElement("canvas");
    patch.width = W; patch.height = H;
    patch.getContext("2d").putImageData(new ImageData(out, W, H), 0, 0);
    return { canvas: patch, regions, pixels: fix.length };
}

window.__seamPatchInfo = (id) => { const p = patches.get(id); return p ? { regions: p.regions, pixels: p.pixels } : p; };
