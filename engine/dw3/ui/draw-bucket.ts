// Draw order inside one depth bucket.
//
// DECODED: docs/research/ui/screen-rendering-model.md section 3, read from the
// picture service `F0x8001ed6c` in checked decompilation (authority 3).
//
// Every drawn thing in this game is addressed as (render target, bucket). A
// bucket is one entry in an ordering list, and the service pushes each new
// primitive onto the FRONT of that list. The list is then walked from the
// front, so the most recently pushed primitive is drawn FIRST and ends up at
// the BACK.
//
// A canvas does the opposite: the last thing drawn lands on top. So a screen
// whose draw calls were transcribed from the original in source order comes out
// inverted -- silently, with no error, just the wrong picture in front.
//
// This queue restores the original's rule. Push in the order the original's
// code pushes; flush paints them back to front, so the FIRST pushed finishes on
// top.
//
// The one compensation the original already makes is INSIDE a single picture:
// the service walks a picture's own layer list backwards precisely to cancel
// this out, which is why a picture's layers come out front-to-back in file
// order. That is handled where a clip is drawn, and it is not this queue's job.

export interface DrawBucket<Ctx> {
  /** Queue one draw. The first thing queued ends up in front. */
  push(draw: (ctx: Ctx) => void): void;
  /** Paint everything queued, back to front, and empty the queue. */
  flush(ctx: Ctx): void;
  /** How many draws are waiting. */
  readonly length: number;
}

export function createDrawBucket<Ctx>(): DrawBucket<Ctx> {
  const queued: Array<(ctx: Ctx) => void> = [];
  return {
    push(draw) { queued.push(draw); },
    flush(ctx) {
      for (let i = queued.length - 1; i >= 0; i--) queued[i]!(ctx);
      queued.length = 0;
    },
    get length() { return queued.length; },
  };
}
