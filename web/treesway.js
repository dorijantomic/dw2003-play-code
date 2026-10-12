// EXPERIMENT: swaying trees.
//
// The trees on the overworld maps are not assets, they are pixels painted into the map
// picture, and the "walk-behind" foreground layer (_fg.png) is a pixel-for-pixel COPY of
// the canopies that must draw over the party. So to make a tree move, this module:
//   1. finds the canopies: connected blobs of the foreground layer that are mostly foliage
//      green (pipes, poles and roofs are left alone);
//   2. cuts them out into their own canvas (and leaves the rest of the foreground static);
//   3. paints over the original canopy pixels in the base picture with a plausible
//      "shaded ground" fill (a patch canvas), so no static ghost sits under the moving one;
//   4. each frame redraws the canopies in thin horizontal cells, each shifted sideways by a
//      slow wave of its world position, more toward the top of its tree, with extra push
//      as a wind gust passes (window.__grassGust, set by scenery2.js).
// Nothing in the map files is changed; switching the effect off restores the original.
const MIN_AREA = 450;        // smaller blobs are not trees
const GREEN_SHARE = 0.5;     // share of a blob's pixels that must be foliage green
const CELL_W = 24, CELL_H = 2;
const BLOCK = 4;             // resolution of the ground fill under a removed canopy

const stages = new Map();    // stageId -> built data | null (nothing to sway)

const isFoliage = (r, g, b) => g > 40 && g > r * 1.06 && g > b * 1.06;

function pixels(img) {
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    return { cv, cx, data: cx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
}

function build(stageId, fgImg, baseImg) {
    const t0 = performance.now();
    const fg = pixels(fgImg), W = fg.w, H = fg.h;
    if (baseImg.naturalWidth !== W || baseImg.naturalHeight !== H) return null;
    const d = fg.data;

    // 1. connected blobs of the foreground layer, with their foliage share
    const id = new Uint16Array(W * H);
    const comps = [null];                // [ { area, green, y0, y1 } ], index = blob id
    const stack = [];
    for (let s = 0, n = W * H; s < n; s++) {
        if (id[s] || d[s * 4 + 3] < 128) continue;
        const cid = comps.length;
        if (cid >= 65000) break;
        const c = { area: 0, green: 0, y0: H, y1: 0 };
        stack.length = 0; stack.push(s); id[s] = cid;
        while (stack.length) {
            const i = stack.pop(), x = i % W, y = (i / W) | 0, o = i * 4;
            c.area++; if (isFoliage(d[o], d[o + 1], d[o + 2])) c.green++;
            if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
            if (x > 0 && !id[i - 1] && d[(i - 1) * 4 + 3] >= 128) { id[i - 1] = cid; stack.push(i - 1); }
            if (x < W - 1 && !id[i + 1] && d[(i + 1) * 4 + 3] >= 128) { id[i + 1] = cid; stack.push(i + 1); }
            if (y > 0 && !id[i - W] && d[(i - W) * 4 + 3] >= 128) { id[i - W] = cid; stack.push(i - W); }
            if (y < H - 1 && !id[i + W] && d[(i + W) * 4 + 3] >= 128) { id[i + W] = cid; stack.push(i + W); }
        }
        comps.push(c);
    }
    const isTree = comps.map((c) => !!c && c.area >= MIN_AREA && c.green / c.area >= GREEN_SHARE);
    let treePx = 0;
    for (let i = 0, n = W * H; i < n; i++) if (id[i] && isTree[id[i]]) treePx++;
    if (treePx < MIN_AREA) return null;

    // 2. split the foreground into canopy pixels and everything else
    const tree = new ImageData(W, H), rest = new ImageData(W, H);
    const mask = new Uint8Array(W * H);
    const cols = Math.ceil(W / CELL_W), rows = Math.ceil(H / CELL_H);
    const occ = new Uint8Array(cols * rows);
    for (let i = 0, n = W * H; i < n; i++) {
        const o = i * 4;
        if (d[o + 3] < 8) continue;
        const dest = id[i] && isTree[id[i]] ? tree.data : rest.data;
        dest[o] = d[o]; dest[o + 1] = d[o + 1]; dest[o + 2] = d[o + 2]; dest[o + 3] = d[o + 3];
        if (dest === tree.data) { mask[i] = 1; occ[((i / W / CELL_H) | 0) * cols + (((i % W) / CELL_W) | 0)] = 1; }
    }
    const mk = (img) => { const cv = document.createElement("canvas"); cv.width = W; cv.height = H; cv.getContext("2d").putImageData(img, 0, 0); return cv; };
    const treeCv = mk(tree), restCv = mk(rest);

    // 3. fill the base picture under the removed canopies from the ground around them
    const base = pixels(baseImg).data;
    const bw = Math.ceil(W / BLOCK), bh = Math.ceil(H / BLOCK);
    const sum = new Float32Array(bw * bh * 3), cnt = new Uint16Array(bw * bh);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (mask[i] || base[i * 4 + 3] < 128) continue;
        const b = ((y / BLOCK) | 0) * bw + ((x / BLOCK) | 0);
        sum[b * 3] += base[i * 4]; sum[b * 3 + 1] += base[i * 4 + 1]; sum[b * 3 + 2] += base[i * 4 + 2]; cnt[b]++;
    }
    const col = new Float32Array(bw * bh * 3), known = new Uint8Array(bw * bh);
    for (let b = 0; b < bw * bh; b++) if (cnt[b] >= 3) { known[b] = 1; for (let k = 0; k < 3; k++) col[b * 3 + k] = sum[b * 3 + k] / cnt[b]; }
    for (let pass = 0; pass < 90; pass++) {              // grow the known colours inward
        const add = [];
        for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
            const b = by * bw + bx;
            if (known[b]) continue;
            let r = 0, g = 0, bl = 0, n = 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = bx + dx, ny = by + dy;
                if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
                const q = ny * bw + nx;
                if (known[q]) { r += col[q * 3]; g += col[q * 3 + 1]; bl += col[q * 3 + 2]; n++; }
            }
            if (n) add.push(b, r / n, g / n, bl / n);
        }
        if (!add.length) break;
        for (let k = 0; k < add.length; k += 4) { const b = add[k]; known[b] = 1; col[b * 3] = add[k + 1]; col[b * 3 + 1] = add[k + 2]; col[b * 3 + 2] = add[k + 3]; }
    }
    const patch = new ImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!mask[i]) continue;
        const b = ((y / BLOCK) | 0) * bw + ((x / BLOCK) | 0), o = i * 4;
        // a little darker than the surroundings: it is the shade under a canopy
        patch.data[o] = col[b * 3] * 0.78; patch.data[o + 1] = col[b * 3 + 1] * 0.8; patch.data[o + 2] = col[b * 3 + 2] * 0.78; patch.data[o + 3] = 255;
    }
    const out = { treeCv, restCv, patchCv: mk(patch), id, comps, isTree, occ, cols, rows, W, H };
    console.log(`treesway: ${stageId} -> ${comps.filter((c, i) => i && isTree[i]).length} canopies, ${treePx}px, built in ${Math.round(performance.now() - t0)}ms`);
    return out;
}

function get(stageId, fgImg, baseImg) {
    let b = stages.get(stageId);
    if (b === undefined) { b = build(stageId, fgImg, baseImg); stages.set(stageId, b); }
    return b;
}

// the filler for the original canopy pixels, drawn over the base picture (under every sprite)
export function drawTreePatch(ctx, stageId, fgImg, baseImg, camX, camY) {
    if (!(fgImg instanceof Image) || !(baseImg instanceof Image)) return false;
    const b = get(stageId, fgImg, baseImg);
    if (!b) return false;
    ctx.drawImage(b.patchCv, -camX, -camY);
    return true;
}

// the foreground layer, with the canopies swaying; false when this map has none
export function drawSwayingForeground(ctx, stageId, fgImg, baseImg, camX, camY, now, gust, calm = 1) {
    if (!(fgImg instanceof Image) || !(baseImg instanceof Image)) return false;
    const b = get(stageId, fgImg, baseImg);
    if (!b) return false;
    const t = now / 1000, VIEW_W = 320, VIEW_H = 240;
    ctx.drawImage(b.restCv, -camX, -camY);
    const cx0 = Math.max(0, Math.floor(camX / CELL_W)), cx1 = Math.min(b.cols - 1, Math.floor((camX + VIEW_W) / CELL_W) + 1);
    const ry0 = Math.max(0, Math.floor(camY / CELL_H)), ry1 = Math.min(b.rows - 1, Math.floor((camY + VIEW_H) / CELL_H) + 1);
    const amp = (0.7 + 0.5 * Math.sin(t * 0.21)) * calm;
    for (let r = ry0; r <= ry1; r++) {
        const y = r * CELL_H;
        for (let c = cx0; c <= cx1; c++) {
            if (!b.occ[r * b.cols + c]) continue;
            const x = c * CELL_W, mx = Math.min(b.W - 1, x + (CELL_W >> 1)), my = Math.min(b.H - 1, y);
            const cid = b.id[my * b.W + mx];
            const comp = cid && b.isTree[cid] ? b.comps[cid] : null;
            // 0 at the foot of a tree, 1 at its top: the canopy moves more than the trunk
            const top = comp ? Math.max(0, Math.min(1, (comp.y1 - y) / Math.max(24, comp.y1 - comp.y0))) : 0.5;
            const wave = Math.sin(t * 1.25 + x * 0.021 + y * 0.013) + 0.55 * Math.sin(t * 2.3 + x * 0.043 - y * 0.021);
            let shift = wave * amp * (0.25 + 0.75 * top);
            if (gust) { const gd = (x - gust.x) / 60; shift += Math.exp(-gd * gd) * gust.s * 2.6 * (0.3 + 0.7 * top); }
            shift = Math.round(shift * 2) / 2;
            ctx.drawImage(b.treeCv, x, y, CELL_W, CELL_H, x - camX + shift, y - camY, CELL_W, CELL_H);
        }
    }
    return true;
}
window.__treeSwayInfo = (id) => { const b = stages.get(id); return b ? { canopies: b.comps.filter((c, i) => i && b.isTree[i]).length } : b; };
