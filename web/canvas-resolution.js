// High-density field-canvas backing without changing logical game coordinates.
//
// Gameplay, UI, collision, and camera layout remain 640x480 -- an exact 2x of
// the game's own 320x240 screen (ledger UI-DISPLAY-EXTENT-001). It was 640x448
// until 2026-09-04, which is 224 lines: 16 short of the screen the disc draws,
// and a height no menu's own 320x240 layout divides into evenly. In HD asset mode
// the canvas backing store follows its displayed CSS size * devicePixelRatio,
// and one transform maps logical drawing coordinates into those device pixels.

export const FIELD_LOGICAL_WIDTH = 640;
export const FIELD_LOGICAL_HEIGHT = 480;
export const MAX_BACKING_DIMENSION = 4096;

export function computeCanvasBacking({
  hd,
  cssWidth,
  cssHeight,
  devicePixelRatio = 1,
  logicalWidth = FIELD_LOGICAL_WIDTH,
  logicalHeight = FIELD_LOGICAL_HEIGHT,
  maxDimension = MAX_BACKING_DIMENSION,
}) {
  if (!hd) return { width: logicalWidth, height: logicalHeight };

  const dpr = Math.max(1, Number(devicePixelRatio) || 1);
  let width = Math.max(logicalWidth, Math.round((cssWidth || logicalWidth) * dpr));
  let height = Math.max(logicalHeight, Math.round((cssHeight || logicalHeight) * dpr));
  const reduction = Math.min(1, maxDimension / Math.max(width, height));
  if (reduction < 1) {
    width = Math.max(logicalWidth, Math.round(width * reduction));
    height = Math.max(logicalHeight, Math.round(height * reduction));
  }
  return { width, height };
}

/** Convert a pointer in CSS pixels into the fixed field layout coordinate space. */
export function canvasEventToLogical(
  canvas,
  event,
  logicalWidth = FIELD_LOGICAL_WIDTH,
  logicalHeight = FIELD_LOGICAL_HEIGHT,
) {
  const rect = canvas.getBoundingClientRect();
  const contentWidth = canvas.clientWidth || rect.width || logicalWidth;
  const contentHeight = canvas.clientHeight || rect.height || logicalHeight;
  const x = event.clientX - rect.left - (canvas.clientLeft || 0);
  const y = event.clientY - rect.top - (canvas.clientTop || 0);
  return {
    x: x * logicalWidth / contentWidth,
    y: y * logicalHeight / contentHeight,
  };
}

// A screen that takes the whole framebuffer over (the post-fight report, the
// END card) is a native 320x240 image, and the original switches the display
// environment for it. It must fill whatever canvas it lands on — the same
// fit-and-centre rule the battle chrome uses (min(canvasW/320, canvasH/240)),
// not a scale of the caller's logical view size. Called with the transform
// reset so it is correct whether the caller was drawing in logical field space
// (the transform maps 640x480 -> device) or in device space (the battle owns
// the canvas at device resolution). Returns the scale.
export const NATIVE_SCREEN_W = 320;
export const NATIVE_SCREEN_H = 240;

export function fitNativeScreen(ctx, nativeW = NATIVE_SCREEN_W, nativeH = NATIVE_SCREEN_H) {
  const canvas = ctx && ctx.canvas;
  const w = canvas && canvas.width ? canvas.width : nativeW;
  const h = canvas && canvas.height ? canvas.height : nativeH;
  const scale = Math.min(w / nativeW, h / nativeH);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate((w - nativeW * scale) / 2, (h - nativeH * scale) / 2);
  ctx.scale(scale, scale);
  return scale;
}

export function createCanvasResolutionController(
  canvas,
  ctx,
  {
    logicalWidth = FIELD_LOGICAL_WIDTH,
    logicalHeight = FIELD_LOGICAL_HEIGHT,
    maxDimension = MAX_BACKING_DIMENSION,
  } = {},
) {
  const view = canvas.ownerDocument?.defaultView ?? globalThis;
  let dirty = true;
  let lastHd = null;
  let current = {
    width: canvas.width,
    height: canvas.height,
    scaleX: canvas.width / logicalWidth,
    scaleY: canvas.height / logicalHeight,
    hd: false,
  };

  const markDirty = () => { dirty = true; };
  const Observer = view.ResizeObserver ?? globalThis.ResizeObserver;
  const observer = Observer ? new Observer(markDirty) : null;
  observer?.observe(canvas);
  view.addEventListener?.("resize", markDirty);
  canvas.ownerDocument?.addEventListener?.("fullscreenchange", markDirty);

  function beginFrame(hd) {
    if (
      dirty
      || hd !== lastHd
      || canvas.width !== current.width
      || canvas.height !== current.height
    ) {
      const target = computeCanvasBacking({
        hd,
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        devicePixelRatio: view.devicePixelRatio,
        logicalWidth,
        logicalHeight,
        maxDimension,
      });
      if (canvas.width !== target.width) canvas.width = target.width;
      if (canvas.height !== target.height) canvas.height = target.height;
      current = {
        ...target,
        scaleX: target.width / logicalWidth,
        scaleY: target.height / logicalHeight,
        hd,
      };
      lastHd = hd;
      dirty = false;
    }

    // Canvas width/height changes reset all 2D state, and battle also uses this
    // shared context, so establish the field transform at every field frame.
    ctx.setTransform(current.scaleX, 0, 0, current.scaleY, 0, 0);
    // Native fallbacks and authentic pixel atlases stay nearest-neighbour.
    // web/assets.js temporarily enables smoothing only for density-tagged HD
    // sources, so one missing HD file cannot blur or bleed an entire UI.
    ctx.imageSmoothingEnabled = false;
    if (hd && "imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    return current;
  }

  function destroy() {
    observer?.disconnect();
    view.removeEventListener?.("resize", markDirty);
    canvas.ownerDocument?.removeEventListener?.("fullscreenchange", markDirty);
  }

  return {
    beginFrame,
    markDirty,
    snapshot: () => ({ ...current }),
    destroy,
  };
}
