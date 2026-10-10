// Software painter for the gym's sprite-actor primitives.
//
// The translated gym's two sprite actors (engine/dw3/ui/native/gym-actor.ts) emit what the
// console's GPU would draw: textured rectangles (code 0x64, 0x66 semi-transparent), textured
// quads (0x2C, 0x2E) and draw-mode packets, sampling the TRANIN pages the pack loader uploaded to
// VRAM. The session records them as `gymSprite` / `gymQuad` / `gymMode` picture calls; this file
// rasterises them from the session's VramMap (engine/native/vram.ts) into the canvas:
//   * 4-bit texels (texture-page colour depth 0) through a 16-colour CLUT row, 8-bit through a
//     256-colour row; a texel of value 0x0000 is transparent;
//   * a semi-transparent primitive blends only the texels whose stp bit (0x8000) is set, with the
//     page's blend mode abr = tpage bits 5-6: 0 back/2 + front/2, 1 back + front, 2 back - front,
//     3 back + front/4;
//   * the texture page of a rectangle is the last draw-mode packet in execution order (the session
//     gives the calls in that order; web/native-screen-render.js paints each bucket back to front).
// The rasteriser works in device pixels through the canvas transform, so it stays sharp at any
// scale and blends against what has really been painted.
const PAGE_W = 64;       // a texture page is 64 VRAM halfwords wide (256 four-bit texels)
const PAGE_H = 256;

/** The halfword at VRAM (x, y) from the most recent upload covering it, or -1. */
function vramHalf(vram, x, y) {
    const image = vram.find(x, y);
    if (!image) return -1;
    const i = ((y - image.y) * image.w + (x - image.x)) * 2;
    return image.pixels[i] | (image.pixels[i + 1] << 8);
}

export function createGymPrimPainter(getVram) {
    let tpage = 0;
    const stats = { sprites: 0, quads: 0, pixels: 0, skipped: 0 };

    /** The texel colour (a 16-bit value) for page-relative (u, v), or -1 for a missing texel. */
    function texel(vram, page, clut, u, v) {
        const depth = (page >> 7) & 3;
        const baseX = (page & 15) * PAGE_W;
        const baseY = ((page >> 4) & 1) * PAGE_H + ((page >> 11) & 1) * 512;
        const clutX = (clut & 0x3f) * 16;
        const clutY = (clut >> 6) & 0x1ff;
        let index;
        if (depth === 0) {
            const half = vramHalf(vram, baseX + (u >> 2), baseY + v);
            if (half < 0) return -1;
            index = (half >> ((u & 3) * 4)) & 15;
        } else if (depth === 1) {
            const half = vramHalf(vram, baseX + (u >> 1), baseY + v);
            if (half < 0) return -1;
            index = (half >> ((u & 1) * 8)) & 255;
        } else {
            return vramHalf(vram, baseX + u, baseY + v);
        }
        return vramHalf(vram, clutX + index, clutY);
    }

    function blend(back, front, mode) {
        switch (mode) {
            case 0: return (back + front) >> 1;
            case 1: return Math.min(255, back + front);
            case 2: return Math.max(0, back - front);
            default: return Math.min(255, back + (front >> 2));
        }
    }

    /**
     * Fill the device rectangle of a logical box. `sample(lx, ly)` -> colour half or -1 for a
     * transparent / missing texel. `semi` blends the stp-flagged texels with mode `abr`.
     */
    function fill(ctx, box, semi, abr, sample) {
        const m = ctx.getTransform();
        const sx = m.a, sy = m.d, tx = m.e, ty = m.f;
        const canvas = ctx.canvas;
        const x0 = Math.max(0, Math.floor(tx + box.x0 * sx)), x1 = Math.min(canvas.width, Math.ceil(tx + box.x1 * sx));
        const y0 = Math.max(0, Math.floor(ty + box.y0 * sy)), y1 = Math.min(canvas.height, Math.ceil(ty + box.y1 * sy));
        if (x1 <= x0 || y1 <= y0) { stats.skipped++; return; }
        const image = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
        const data = image.data;
        let painted = 0;
        for (let dy = y0; dy < y1; dy++) {
            const ly = (dy + 0.5 - ty) / sy;
            for (let dx = x0; dx < x1; dx++) {
                const lx = (dx + 0.5 - tx) / sx;
                const half = sample(lx, ly);
                if (half <= 0) continue; // missing or colour 0: transparent
                const o = ((dy - y0) * (x1 - x0) + (dx - x0)) * 4;
                const r = (half & 31) << 3, g = ((half >> 5) & 31) << 3, b = ((half >> 10) & 31) << 3;
                if (semi && (half & 0x8000)) {
                    data[o] = blend(data[o], r, abr);
                    data[o + 1] = blend(data[o + 1], g, abr);
                    data[o + 2] = blend(data[o + 2], b, abr);
                } else {
                    data[o] = r; data[o + 1] = g; data[o + 2] = b;
                }
                data[o + 3] = 255;
                painted++;
            }
        }
        ctx.putImageData(image, x0, y0);
        stats.pixels += painted;
    }

    const s16 = (v) => (v << 16) >> 16;

    return {
        stats,
        /** Forget the current texture page (a new frame starts). */
        beginFrame() { tpage = 0; },
        /** Paint one recorded gym primitive. */
        paint(ctx, call) {
            const vram = getVram();
            if (!vram) { stats.skipped++; return; }
            const a = call.args;
            if (call.method === "gymMode") { tpage = a[0] & 0xffff; return; }
            if (call.method === "gymSprite") {
                const [x, y, u, v, w, h, clut, code] = a;
                const X = s16(x), Y = s16(y);
                const page = tpage;
                const semi = code === 0x66;
                fill(ctx, { x0: X, y0: Y, x1: X + w, y1: Y + h }, semi, (page >> 5) & 3, (lx, ly) => {
                    const tu = (u + Math.floor(lx - X)) & 255;
                    const tv = (v + Math.floor(ly - Y)) & 255;
                    return texel(vram, page, clut, tu, tv);
                });
                stats.sprites++;
                return;
            }
            if (call.method === "gymQuad") {
                const xs = a.slice(0, 4).map(s16), ys = a.slice(4, 8).map(s16);
                const us = a.slice(8, 12), vs = a.slice(12, 16);
                const [clut, page, code] = [a[16], a[17], a[18]];
                const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
                if (maxX <= minX || maxY <= minY) { stats.skipped++; return; }
                const semi = code === 0x2e;
                // Corners 0 (top-left) and 3 (bottom-right) carry the texel rectangle.
                fill(ctx, { x0: minX, y0: minY, x1: maxX, y1: maxY }, semi, (page >> 5) & 3, (lx, ly) => {
                    const tx = (lx - minX) / (maxX - minX);
                    const ty = (ly - minY) / (maxY - minY);
                    const tu = Math.round(us[0] + tx * (us[3] - us[0])) & 255;
                    const tv = Math.round(vs[0] + ty * (vs[3] - vs[0])) & 255;
                    return texel(vram, page, clut, tu, tv);
                });
                stats.quads++;
            }
        },
    };
}
