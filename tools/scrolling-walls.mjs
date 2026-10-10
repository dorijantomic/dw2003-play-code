// The scrolling backdrop wall: which screens draw it, and how its phase is
// measured. Shared by tools/verify_scrolling_walls.mjs (which drives the
// browser) and tests/scrolling-wall-position.test.js (which drives the ports
// and the measurement), so the two cannot disagree about what "the wall is
// scrolling at the decoded rate" means.
//
// THE SHAPE (data/scrolling_walls.json, tools/extract_scroll_walls.py). Ten
// screens of the original draw the same wall: a counter that gains 1 only on
// frames where a companion toggle field is already set, reset before it can
// reach 0x60, and passed as BOTH x and y of the clip draw — the y arriving in
// the `move_ $a3, $a2` sitting in the jalr DELAY SLOT, which is the only reason
// the wall moves diagonally instead of sideways. That is 0.5 px per vertical
// blank = 25 px/s at PAL 50 Hz, so the 96 px period comes round every
// 96/25 = 3.84 s.
//
//   overlay    clip  counter toggle  wrap
//   ststatus   0x1d  +0x54   +0x58   pro/ststatus.s:23271
//   stitshop   0x14  +0x58   +0x5c   pro/stitshop.s:8959
//   stgdglab   0x37  +0x54   +0x58   pro/stgdglab.s:12386
//   stgmcard   0x1e  +0x58   +0x5c   pro/stgmcard.s:4957
//   stfgtrep   0x1e  +0x58   +0x5c   pro/stfgtrep.s:2042
//   stcrdabm   0x08  +0x58   +0x5c   pro/stcrdabm.s:1590
//   stcrddek   0x08  +0x58   +0x5c   pro/stcrddek.s:6293
//   stcrdshp   0x08  +0x58   +0x5c   pro/stcrdshp.s:5413
//   stgtrain   field +0x5c   +0x60   pro/stgtrain.s:1873   (clip from +0x58)
//   stdgname   0x24  +0x58   +0x5c   pro/stdgname.s:3545   (bound 0x5f)
//
// "frame" here is a VERTICAL BLANK of the console, not a browser frame: each
// screen counts blanks in its own fields, and the PAL blank is 1/50 s. The
// three card screens, the naming screen and the shop run shipped overlays, so
// the host that steps them converts a browser frame into blanks at that rate
// (engine/systems/native-vblank-clock.ts); the translated screens convert it
// through MenuDisplayClock (engine/dw3/ui/pad-words.ts).
//
// MEASURING THE PHASE. A wall that WRAPPED and a wall that was merely hidden
// behind an opaque window look identical in pixels, so a screen whose wall
// position the host can be asked for is read from its own picture calls: the
// (x, y) the screen actually asked for. A phase trace is a list of
// [seconds, x, y] samples in the order they were taken.
//
// The measurement counts the ADVANCE, not the number of +1 steps. That
// difference is the whole fix: a browser frame that ran long (a stalled tab, a
// machine shared with five other workers) makes NativeVblankClock catch up with
// two or three blanks at once, and the counter then steps +2 or +3 in one
// sample. The old reading counted only exact +1 steps and called a 0x5F -> 0x00
// wrap a "seam", so any skipped phase read as a wall that "never looped" at
// 22 px/s — a healthy wall reported as a game fault. Counting every pixel the
// counter moved keeps a frozen wall at advance 0 (still a failure), still
// measures the rate over the window, and still refuses a wall whose x and y
// differ, which is not this wall at all.

/** 96 phases: the counter is reset to 0 rather than ever holding 0x60. */
export const WALL_PERIOD = 0x60;

/** 25 px/s at PAL 50 Hz: one step every second blank, two blanks a second. */
export const WALL_RATE_PX_S = 25;

/** 96 px of travel at 25 px/s, and the loop time the pixel rows measure. */
export const WALL_LOOP_SEC = WALL_PERIOD / WALL_RATE_PX_S;

/** The pixel rows allow this much on the loop time (a shared machine). */
export const WALL_LOOP_TOLERANCE_SEC = 0.25;

/** The position rows allow on the rate, for the same reason. */
export const WALL_RATE_TOLERANCE_PX_S = 2;

/**
 * Every wall the check measures, one row per decoded member of
 * data/scrolling_walls.json. `overlay` is the join key the census test uses.
 *
 *   lab           the __labOpen route that shows the screen
 *   session       the window handle whose own picture calls carry the wall
 *   wallClip      the clip id to read, when the session is asked for one
 *   boxes         canvas-pixel sample boxes that must be BARE wall (the pixel
 *                 measurement). A row with no boxes is measured by position
 *                 alone — the authoritative reading — which is what the two
 *                 rows added on 2026-10-04 do, because no bare-wall box had
 *                 been mapped for them and a guessed one would be a guess.
 *   bare: false   the screen draws no wall at all, which is correct for it
 *   seedLab       open this first, when the screen needs something another lab
 *                 screen sets up (the naming screen needs a partner with a
 *                 roster slot; `__labOpen` seeds one for it itself)
 */
export const WALL_SCREENS = [
    // The START list over the live field: the original draws no wall here.
    { name: "pausehome", overlay: "ststatus", lab: "menu", bare: false },
    // A pause PAGE, which is the diamond room (captures/pause-items-which-one-2026-08-20.png).
    { name: "pausepage", overlay: "ststatus", lab: "status", boxes: [[240, 240, 120, 120], [80, 60, 120, 120]], wallClip: 0x1d, session: "__status" },
    { name: "shop", overlay: "stitshop", lab: "shop", boxes: [[40, 80, 120, 120], [40, 260, 120, 120]], wallClip: 0x14, session: "__shopTranslated" },
    { name: "dri", overlay: "stgdglab", lab: "dri", boxes: [[40, 250, 120, 120], [40, 80, 120, 120]], wallClip: 0x37, session: "__dri" },
    // The memory card's wall is on show ABOVE its own SAVE window; the old box
    // (360,210) sat inside that window, which is flat, so the row read as frozen.
    { name: "save", overlay: "stgmcard", lab: "save", boxes: [[160, 20, 120, 120], [400, 20, 120, 120]], wallClip: 0x1e, session: "__saveNative" },
    // The results screen. It was never measured before 2026-10-04: the 2026-08-14
    // census left it "checked by reading only" because the check had no row for
    // it. pro/stfgtrep.s:2042-2063 draws clip 0x1e at (counter, counter).
    { name: "fightreport", overlay: "stfgtrep", lab: "fightreport", wallClip: 0x1e, session: "__reportNative" },
    { name: "gym", overlay: "stgtrain", lab: "gym", boxes: [[500, 10, 120, 120], [400, 10, 120, 90]] },
    // THE THREE CARD SCREENS, settled 2026-10-04. Their strip at y=2 IS bare
    // wall: native (120,1) 150x6, past the "…u City" plate that ends at x=50,
    // and the capture shows nothing but the clip-0x08 mosaic across it
    // (docs/research/ui/captures/walls-cardalbum-strip-2026-10-04.png).
    { name: "cardalbum", overlay: "stcrdabm", lab: "cardalbum", boxes: [[240, 2, 300, 12]], wallClip: 0x08, session: "__cardAlbumNative" },
    { name: "carddeck", overlay: "stcrddek", lab: "carddeck", boxes: [[240, 2, 300, 12]], wallClip: 0x08, session: "__cardDeckNative" },
    { name: "cardshop", overlay: "stcrdshp", lab: "cardshop", boxes: [[240, 2, 300, 12]], wallClip: 0x08, session: "__cardShopNative" },
    // The naming screen, the tenth member. pro/stdgname.s:3545-3565 draws clip
    // 0x24 at (counter, counter) with its bound written 0x5f in the short form,
    // which is why the 2026-08-14 census (matching `slti $v0, $v1, 0x60`) never
    // saw it. It loads its tables before it draws anything, so the check waits
    // for its picture calls rather than for a fixed number of milliseconds.
    { name: "nameentry", overlay: "stdgname", lab: "nameentry", wallClip: 0x24, session: "__nameEntryNative" },
];

/**
 * Read one wall phase trace.
 *
 * @param {Array<[number, number, number]>} samples [seconds, x, y] in order.
 * @returns {{phases: number, advance: number, wraps: number, skew: number,
 *            skipped: number, rate: number, span: number, stepped: boolean}}
 *   `advance` is every pixel the counter moved, a wrap counting as 96;
 *   `skipped` is how many samples were taken more than one step apart, which a
 *   long browser frame causes and which says nothing about the wall;
 *   `rate` is advance over the elapsed seconds.
 */
export function measureWallPhase(samples) {
    const phases = samples.filter(([, x, y]) => Number.isFinite(x) && Number.isFinite(y));
    let advance = 0;
    let wraps = 0;
    let skew = 0;
    let skipped = 0;
    for (let i = 1; i < phases.length; i++) {
        const [seconds, x, y] = phases[i];
        const [, px, py] = phases[i - 1];
        if (x !== y || px !== py) skew++;
        let delta = (x - px + WALL_PERIOD) % WALL_PERIOD;
        if (x < px) wraps++;
        if (delta !== 0 && delta !== 1) skipped++;
        advance += delta;
    }
    const span = phases.length > 1 ? phases[phases.length - 1][0] - phases[0][0] : 0;
    return {
        phases: phases.length,
        advance,
        wraps,
        skew,
        skipped,
        span,
        rate: span > 0 ? advance / span : 0,
        // A wall that was asked for at all and never moved.
        stepped: advance > 0,
    };
}

/**
 * The position reading's verdict. Every clause is one thing the disc does not
 * do: a wall whose x and y are different numbers, a wall that never moved, a
 * wall that moved at the monitor's rate instead of the console's, and a window
 * too short to hold a whole period (which would make the rate meaningless).
 *
 * @param {ReturnType<typeof measureWallPhase>} m
 * @param {number} [minSeconds] the shortest window the rate may be read over.
 * @returns {string[]} empty when the wall is scrolling as the disc scrolls it.
 */
export function wallPhaseFaults(m, minSeconds = WALL_LOOP_SEC) {
    const faults = [];
    if (m.phases === 0) return ["no wall draw was found at all"];
    if (m.skew > 0) faults.push(`${m.skew} sample(s) had x != y; the delay slot makes them one number`);
    if (!m.stepped) faults.push("the phase never moved");
    if (m.span < minSeconds) faults.push(`only ${m.span.toFixed(2)}s of samples; a 96 px period needs ${WALL_LOOP_SEC}s`);
    if (m.span >= minSeconds && Math.abs(m.rate - WALL_RATE_PX_S) > WALL_RATE_TOLERANCE_PX_S) {
        faults.push(`${m.rate.toFixed(1)} px/s over ${m.span.toFixed(2)}s; the disc moves it ${WALL_RATE_PX_S} px/s`);
    }
    if (m.span >= minSeconds && m.advance >= WALL_PERIOD && m.wraps < Math.floor(m.advance / WALL_PERIOD)) {
        faults.push(`${m.wraps} wrap(s) for ${m.advance} px of travel; every 96 px crosses 0x${(WALL_PERIOD - 1).toString(16)} -> 0x00 once`);
    }
    return faults;
}

/** The phase numbers, for the check's log and for a report. */
export function describeWallPhase(m) {
    return `phases=${m.phases} advance=${m.advance}px wraps=${m.wraps} ` +
        `skew=${m.skew} skipped=${m.skipped} rate=${m.rate.toFixed(1)}px/s`;
}
