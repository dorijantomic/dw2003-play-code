// Shared animated backdrop used by status-style full-screen UIs.
//
// This is the real status-menu diamond field: ststat clip 0x1d, scrolling
// down-right at the decoded PAL rate implemented by drawPackBackdrop(). Keep
// the asset, fallback colour, clock, and renderer together so screens cannot
// drift into visually similar but independently implemented backgrounds.
import { loadPack, drawPackBackdrop } from "./screenpack.js";

const STATUS_BACKDROP_CLIP = 0x1d;
const STATUS_BACKDROP_FILL = "rgb(0,0,24)";

export function createStatusBackdrop() {
  const pack = loadPack("ststat");
  let time = 0;

  return {
    update(dt) {
      if (Number.isFinite(dt) && dt > 0) time += dt;
    },
    reset() { time = 0; },
    time: () => time,
    draw(ctx, viewW, viewH) {
      ctx.fillStyle = STATUS_BACKDROP_FILL;
      ctx.fillRect(0, 0, viewW, viewH);
      return drawPackBackdrop(ctx, pack, STATUS_BACKDROP_CLIP, viewW, viewH, time);
    },
  };
}
