// FIELD WALK BLEND. The walk cycle has 8 frames; the disc shows each one for its whole time and then
// snaps to the next. Here the last part of each frame's time fades the NEXT frame in over it
// (source-over, globalAlpha 0 to 1), so the snap lands on a picture that is already fully shown.
// Only frame times and alpha: no scaling, no smoothing, every drawn pixel is still a sprite pixel,
// and the clip time / frame table that drive position, speed and collision are not touched.
// TIME: the field clock (animTime) advances in whole 50 Hz ticks, the screen runs at 60 fps, and clip frames
// last 2..6 ticks. Read at whole ticks the weight only ever sees integer remaining times (a 2-tick frame
// never reaches its window, a 4-tick frame only 0.375), so the caller passes `subTick` = the seconds
// already elapsed inside the current tick (the field tick accumulator); the weight is then continuous.
// Standing (not moving) never calls this: it shows the single frame of its own clip.

export const WALK_TICK_RATE = 50;       // = FIELD_TICK_RATE (engine/systems/animation-controller)
export const WALK_BLEND_FRACTION = 0.4; // the last 40% of each frame's time is the fade

const MIRROR = { right: "left", "down-right": "down-left", "up-right": "up-left" };

/** Blend weight of the next frame: 0 until the last `fraction` of the frame, then a linear ramp to 1. */
export function blendWeight(remaining: number, duration: number, fraction = WALK_BLEND_FRACTION) {
    const win = duration * fraction;
    if (!(win > 0)) return 0;
    const w = (remaining - (duration - win)) / win;
    return w <= 0 ? 0 : w >= 1 ? 1 : w;
}

const OUT = { col: 0, mirror: false, bottom: 0, w: 0 };

/**
 * The frame to fade in over the current one, or null when nothing fades (single-frame clip, early part
 * of a frame). subTick = seconds into the current field tick (0 for clocks that advance by dt). Same lookup and same time arithmetic as engine clipFrame, so the current frame is the
 * one clipFrame returns. Returns one shared scratch object: read it at once, do not keep it.
 */
export function walkBlendNext(clips, clipId: (string | number) | null, dir: string | number, elapsedSeconds: number, subTick = 0) {
    if (!clips || clipId == null) return null;
    const entry = clips[String(clipId)];
    if (!entry) return null;
    const ms = MIRROR[dir];
    const mirror = !entry[dir] && !!ms && !!entry[ms];
    const perDir = entry[dir] ?? (ms && entry[ms]) ?? entry.down;
    if (!perDir) return null;
    const cols = perDir.cols, durs = perDir.durations;
    const n = cols.length;
    if (n <= 1) return null;
    let total = 0;
    for (let i = 0; i < n; i++) total += durs[i];
    if (!(total > 0)) return null;
    let remaining = elapsedSeconds * WALK_TICK_RATE % total;
    if (subTick > 0) {   // whole-tick clock: a sum of 0.02s steps lands a hair off the tick (3.9999999), so snap it
        const r = Math.round(remaining);
        if (Math.abs(remaining - r) < 1e-6) remaining = r % total;
    }
    for (let i = 0; i < n; i++) {
        const d = durs[i];
        if (remaining < d) {
            // sub-tick time moves only inside this frame (clamped), so the frame is still clipFrame's.
            const w = blendWeight(Math.min(remaining + subTick * WALK_TICK_RATE, d), d);
            if (w <= 0) return null;
            const j = i + 1 < n ? i + 1 : 0;
            if (cols[j] === cols[i]) return null;
            OUT.col = cols[j];
            OUT.mirror = mirror;
            OUT.bottom = perDir.bottoms?.[j] ?? 0;
            OUT.w = w;
            return OUT;
        }
        remaining -= d;
    }
    return null;
}
