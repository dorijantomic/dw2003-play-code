// web/screendim.js — the shared screen dim, drawn the way the hardware draws it.
//
// The arithmetic (the ramp, the level curve, the vignette's geometry) lives in
// engine/dw3/ui/screen-dim.ts and is decoded there. This file is only the
// compositing, because that needs a canvas.
//
// WHAT HAS TO BE RIGHT. A dim in this game SUBTRACTS light: the hardware's
// semi-transparency mode 2, `background minus foreground`, so the result is
//
//     max(0, c - k)
//
// per channel. Every screen here used to fill `rgba(0,0,0,a)` instead, which is
//
//     c * (1 - a)
//
// A bright area should stay bright much longer than that, and a dark area
// should reach black much sooner.
//
// HOW A 2D CANVAS SUBTRACTS. It has no subtract mode. It does have `darken`,
// which is min(c, k), and `difference`, which is |c - k|. Since min(c, k) is
// never greater than c, the absolute value is exact:
//
//     c - min(c, k) = max(0, c - k)
//
// So: build the dim layer on black (black subtracts nothing), take its minimum
// with a copy of the screen, then difference that copy back onto the screen.
// Two full-screen composites, both on the GPU, and no per-pixel JavaScript.

let layerCanvas = null;   // the dim shape, on black
let minCanvas = null;     // min(screen, dim)

function scratch(w, h) {
  if (!layerCanvas || layerCanvas.width !== w || layerCanvas.height !== h) {
    layerCanvas = document.createElement("canvas");
    minCanvas = document.createElement("canvas");
    layerCanvas.width = minCanvas.width = w;
    layerCanvas.height = minCanvas.height = h;
  }
  return [layerCanvas.getContext("2d"), minCanvas.getContext("2d")];
}

/**
 * Subtract whatever `paintLayer` draws from what is already on the canvas.
 *
 * Coordinates are the caller's own — a screen draws in native 320x240 under a
 * translate-and-scale transform, and this respects that transform, so a caller
 * never converts anything. Rotation is not supported and no screen dim uses it.
 *
 * `paintLayer` receives a context already filled black and already carrying the
 * caller's transform. Anything it leaves black subtracts nothing, so a shape
 * may be painted without masking the rest of the screen.
 */
export function subtractLayer(ctx, x, y, w, h, paintLayer) {
  if (w <= 0 || h <= 0) return;
  if (typeof document === "undefined") { paintLayer(ctx, w, h); return; }

  const m = typeof ctx.getTransform === "function"
    ? ctx.getTransform()
    : { a: 1, d: 1, e: 0, f: 0 };
  const dx = Math.floor(m.a * x + m.e);
  const dy = Math.floor(m.d * y + m.f);
  const dw = Math.max(1, Math.ceil(m.a * w));
  const dh = Math.max(1, Math.ceil(m.d * h));
  if (dx + dw <= 0 || dy + dh <= 0) return;

  const [layer, min] = scratch(dw, dh);

  // The layer carries the caller's transform, shifted so the region's top-left
  // lands on the layer's origin. paintLayer then works in native coordinates.
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.globalCompositeOperation = "source-over";
  layer.globalAlpha = 1;
  layer.fillStyle = "#000";
  layer.fillRect(0, 0, dw, dh);
  layer.setTransform(m.a, 0, 0, m.d, m.e - dx, m.f - dy);
  layer.imageSmoothingEnabled = false;
  paintLayer(layer, w, h);

  // min(screen, dim)
  min.setTransform(1, 0, 0, 1, 0, 0);
  min.globalCompositeOperation = "copy";
  min.globalAlpha = 1;
  min.imageSmoothingEnabled = false;
  min.drawImage(ctx.canvas, dx, dy, dw, dh, 0, 0, dw, dh);
  min.globalCompositeOperation = "darken";
  min.drawImage(layerCanvas, 0, 0);

  // screen - min(screen, dim)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = "difference";
  ctx.drawImage(minCanvas, dx, dy);
  ctx.restore();
}

/**
 * The colour of one dim level. On a real canvas the shape is painted in this
 * grey and then subtracted; where there is no canvas at all -- a headless test
 * importing a screen for its logic -- `subtractLayer` hands the caller's own
 * context to the painter, so the same call records this style and a test can
 * read the level back out of it.
 */
export function dimFillStyle(level) {
  const k = Math.max(0, Math.min(255, Math.round(level)));
  return `rgb(${k},${k},${k})`;
}

/**
 * The flat dim: one level subtracted from every pixel of the region. `level` is
 * 0..255, the published high byte of the ramp. `w` and `h` are the caller's own
 * coordinates — a screen passes its native 320 by 240.
 */
export function paintScreenDim(ctx, level, w, h) {
  const k = Math.max(0, Math.min(255, Math.round(level)));
  if (k <= 0) return;
  if (k >= 255) {
    // Fully subtracted is exactly black, and a plain fill is cheaper than two
    // composites for the frame that matters most — the one a screen change
    // waits on.
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
  subtractLayer(ctx, 0, 0, w, h, (layer) => {
    layer.fillStyle = dimFillStyle(k);
    layer.fillRect(0, 0, w, h);
  });
}

/**
 * The title screen's vignette: four shaded triangles fanned from the screen
 * centre to the four edges, the centre carrying `level` and both outer corners
 * carrying twice it. The picture darkens from its border inward.
 *
 * The centre point and the four edges come from the engine so the coordinates
 * live in one place. A canvas gradient across each triangle stands in for the
 * hardware's corner interpolation: that is an approximation of the shading, not
 * of the geometry and not of the subtraction.
 */
export function paintTitleVignette(ctx, level, centre, edges, edgeLevel, w, h) {
  const k = Math.max(0, Math.min(255, Math.round(level)));
  if (k <= 0) return;
  const outer = Math.max(0, Math.min(255, Math.round(edgeLevel)));
  subtractLayer(ctx, 0, 0, w, h, (layer) => {
    for (const [x1, y1, x2, y2] of edges) {
      // Both outer corners carry the same colour, so the shading runs along one
      // axis: from the shared centre vertex to the middle of the outer edge.
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const g = layer.createLinearGradient(centre.x, centre.y, mx, my);
      g.addColorStop(0, `rgb(${k},${k},${k})`);
      g.addColorStop(1, `rgb(${outer},${outer},${outer})`);
      layer.fillStyle = g;
      layer.beginPath();
      layer.moveTo(centre.x, centre.y);
      layer.lineTo(x1, y1);
      layer.lineTo(x2, y2);
      layer.closePath();
      layer.fill();
    }
  });
}
