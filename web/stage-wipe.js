// The ordinary stage-change wipe, translated from FIELDSTG F0x8008A5E4.
//
// Original, read-only, `~/ddw3/asm/dw2003/pro/fieldstg.s` file 0x7934 (RAM
// 0x8008A5E4; RAM = file + 0x80082CB0). The decompiled C is
// `exe-decomp/fieldstg_c/F0x8008a5e4.c`; the per-instruction reading is in
// `.bunny-scratch/wipe-report.md` and the player-facing reference capture is
// `docs/research/field/captures/warp-wipe-2026-09-13/`.
//
// What the player sees: the old field stays visible through a window centred on
// their own character while the rest of the screen is covered by a dark tile
// lattice that reaches full black after 8 frames; the window then shrinks to
// nothing over 32 frames, the stage loads, and the new field comes back around
// ONE black band that narrows toward the middle of the screen over 21 frames --
// the band starts the full 320 px wide and pulls in 8 px at each edge per frame,
// so the field reappears at the left and right and the band is gone at frame 21.

export const WIPE_W = 320;          // 0x140, the field viewport width
export const WIPE_H = 240;          // 0xF0, the field viewport height
export const WIPE_CENTER_X = 0xA0;  // fallback centre when no player entity
export const WIPE_CENTER_Y = 0x78;

// Close (state 0 -> 1): the window falls 0xA px wide and 7 px tall per frame
// out of a full 320x240, and the cover level rides +0x400 up to 0x8000.
export const WIPE_CLOSE_STEP_W = 0xA;
export const WIPE_CLOSE_STEP_H = 7;
export const WIPE_LEVEL_STEP = 0x400;
export const WIPE_LEVEL_MAX = 0x8000;
// 320 / 10 = 32 frames for the width to reach zero, which is what ends the
// close (the original tests `w <= 0`, not the level).
//
// ONE DIFFERENCE FROM THE CAPTURE, left as the original reads it. The rig
// capture (`docs/research/field/captures/warp-wipe-2026-09-13/`) shows the
// window HOLD at about 200 x 156 -- close frame 12 -- and then cut to black for
// the load, which that README lists under "What the capture does not settle".
// This model keeps shrinking to zero over the 32 frames the arithmetic gives.
// The hold is NOT decoded: state 1 has nothing between `unk54 -= 0xA` and the
// `unk54 <= 0` test that ends it, so the hold belongs to the load/fade handoff
// and is left alone rather than guessed at. The capture's other two
// measurements (230 x 177 at close frame 9, 200 x 156 at close frame 12) are
// both reproduced by this model and are asserted in tests/stage-wipe.test.js.
export const WIPE_CLOSE_FRAMES = WIPE_W / WIPE_CLOSE_STEP_W;   // 32

// Open (state 2): ONE full-height black band starts as the whole 320 px width
// and narrows by 8 px at each edge per frame until its inset `w` passes 0xA1,
// which is what fires the arrival. The band is the covered region -- the new
// field shows at the two sides (see `openCovered`).
export const WIPE_OPEN_STEP = 8;
export const WIPE_OPEN_END = 0xA1;
export const WIPE_OPEN_FRAMES =
    Math.ceil(WIPE_OPEN_END / WIPE_OPEN_STEP); // 21: w = 8, 16, ... 168

// The cover is laid down as 64x64 cells (`F0x80086060`, a 2x2 block of them per
// 128x128 tile, six tiles across the screen at 128-px steps in `F0x80086CE4`),
// each carrying the cover colour `level >> 8`. The rig capture shows the cover
// ALREADY FULLY BLACK at frame 9 -- by then the drawn colour is only 0x20 -- so
// the drawn colour has to be taken eight times over for the composite to be
// opaque there. What is READ is the colour (`s5 = level >> 8`, fieldstg file
// 0x3420) and the 2x2 subdivision (0x3484, `(s4 << 5) & 0x40`); the eight is
// the smallest multiplier consistent with the capture, and the exact blend is
// not read. Both ends of the ramp are pinned anyway: nothing at frame 1, opaque
// by frame 9.
export const WIPE_TILE = 64;
// FITTED TO THE CAPTURE, NOT READ. `WIPE_CELL_OVERLAY = 8` is the smallest
// multiplier of the drawn colour that makes the composite opaque where the
// capture is opaque; the original's blend mode on those quads is not decoded.
export const WIPE_CELL_OVERLAY = 8;
export const WIPE_SEAM_RGB = [16, 24, 48];

// The 0..255 darkness one cover level paints.
export function coverLevel(level) {
    return Math.min(255, ((level >> 8) & 0xff) * WIPE_CELL_OVERLAY);
}

// One close frame, counted from 1 the way the original counts it: the tick that
// initialises the object (w=0x140, h=0xF0, level=0) is also the tick that
// subtracts the first step, and it draws the cover at level 0.
export function closeFrame(frame) {
    const n = Math.max(0, Math.floor(frame));
    return {
        w: Math.max(0, WIPE_W - WIPE_CLOSE_STEP_W * n),
        h: Math.max(0, WIPE_H - WIPE_CLOSE_STEP_H * n),
        // The draw happens before the +0x400 bump, and the bump is skipped once
        // the level has reached 0x8000, so the darkest the close ever paints is
        // 31 * 0x400.
        level: Math.min(WIPE_LEVEL_STEP * Math.max(0, n - 1), WIPE_LEVEL_MAX),
        done: n >= WIPE_CLOSE_FRAMES,
    };
}

// The window the player sees the old field through. The original takes the
// centre (the player entity's screen position, or 160/120 with no player),
// subtracts half the width and half the height with the truncating-toward-zero
// divide, clamps the origin at 0 and then clips the size to the screen.
export function closeWindow(frame, centerX, centerY) {
    const { w, h } = closeFrame(frame);
    // `(v + ((u32)v >> 31)) >> 1`: a rounding-toward-zero halving.
    const half = (v) => (v + (v < 0 ? -1 : 0)) >> 1;
    const cx = centerX == null ? WIPE_CENTER_X : centerX;
    const cy = centerY == null ? WIPE_CENTER_Y : centerY;
    const x = Math.max(0, cx - half(w));
    const y = Math.max(0, cy - half(h));
    return {
        x,
        y,
        w: x + w >= WIPE_W + 1 ? WIPE_W - x : w,
        h: y + h >= WIPE_H + 1 ? WIPE_H - y : h,
    };
}

// One open frame: ONE black band, full height, covering the middle of the
// screen. Its left edge sits at `w` and its right edge at `320 - w`, so it
// narrows by 8 px at each edge per frame and is gone once `w` passes 160; the
// new field is what shows at the two sides.
//
// The band is the region the cover is painted IN, not the hole in it. In state 2
// the rect is set on the 0x1001 object (`unk110(w, 0)` at fieldstg file 0x7C18,
// `unk114((0xA0 - w) * 2, (0x78 - 0) * 2)` at 0x7C48-0x7C50) -- the SAME object
// the tile cover `F0x80086CE4(0x1001, 0x8000)` fills the screen through at
// 0x7CD8 -- whereas the close's rect goes on a 0x1002 object (0x7B44/0x7B4C),
// which is why there the rect is the window the field shows through. See
// `paintWipeCoverBand` / `paintWipeCoverAround` in web/game.js.
export function openFrame(frame) {
    const n = Math.max(0, Math.floor(frame));
    const w = WIPE_OPEN_STEP * n;
    return {
        w,
        bandX: w,
        bandW: Math.max(0, WIPE_W - 2 * w),
        bandH: WIPE_H,
        // The original pins the cover at its cap for the whole open.
        level: WIPE_LEVEL_MAX,
        done: w >= WIPE_OPEN_END,
    };
}

// The polarity as a predicate: is this native pixel covered by the cover on
// this open frame? It is the same rect `openFrame` reports, stated the way the
// player meets it, so a caller painting the band and a test asking "is the
// middle covered yet?" cannot drift apart.
export function openCovered(frame, x, y) {
    const f = openFrame(frame);
    if (f.bandW <= 0) return false;
    return x >= f.bandX && x < f.bandX + f.bandW && y >= 0 && y < f.bandH;
}

// The lattice colour for a cover level: the measured RGB at the cap, scaled by
// how far the level has come, so the lines only surface as the cover darkens.
export function seamRgb(level) {
    const t = Math.max(0, Math.min(1, (level >> 8) / (WIPE_LEVEL_MAX >> 8)));
    return WIPE_SEAM_RGB.map((c) => Math.round(c * t));
}

// The frame counter. `dir` follows the shared fade: 1 closes, -1 opens. The
// counter is in original frames (60 per second), the same units the original's
// tables are authored in.
export function createWipeClock() {
    return { phase: null, t: 0, frame: 0 };
}

export function stepWipeClock(clock, dir, dt) {
    if (dir !== clock.phase) {
        clock.phase = dir;
        clock.t = 0;
        clock.frame = 0;
    }
    if (dir === 0) return clock;
    const cap = dir === 1 ? WIPE_CLOSE_FRAMES : WIPE_OPEN_FRAMES;
    clock.t = Math.min(clock.t + dt * 60, cap + 1);
    clock.frame = Math.min(Math.floor(clock.t), cap);
    return clock;
}

// The progress the shared fade runs on: 0 -> 1 across the close, 1 -> 0 across
// the open, so the stage swap still lands on `alpha >= 1` exactly when the
// window reaches zero.
export function wipeProgress(clock) {
    if (clock.phase === 1) return clock.frame / WIPE_CLOSE_FRAMES;
    if (clock.phase === -1) return 1 - clock.frame / WIPE_OPEN_FRAMES;
    return 0;
}

// ───────────────────────────────────────────────────────────────────────────
// The OTHER half of the same dispatch: the A28 checkerboard loading wipe,
// fieldstg F0x80089F7C.
//
// Read from the overlay ASSEMBLY (~/ddw3/asm/dw2003/pro/fieldstg.s file 0x72CC,
// RAM = file + 0x80082CB0), NOT from the lifted C
// (`exe-decomp/fieldstg_c/F0x80089f7c.c`, which merged the jump-table arms and
// dropped coprocessor words).  Every constant below is a `.word` in that file or
// a live read in the rig capture
// (docs/research/field/transition-wipe-live-capture-2026-10-06.md,
//  captures/wipe-capture-2026-10-06/a28/).  Nothing here is guessed.
//
// What it is: NOT a texture fade.  It is a GPU-packet sequence.  The state-0 arm
// builds a 30-cell grid of 8-byte {x,y} records, column-major, at 0x8009B900
// (asm 0x73D4-0x742C: `sw $v0,(v1)` with v0 = col<<6 and the pointer stepping
// 0x30 = six cells per column, so index = col*6 + row).  A 29-record schedule at
// 0x80097770 (asm 0x7540-0x7554: base + index*12) then walks the grid
// outside-in: each record slides ONE cell 40 px per step and stamps the 0x200
// sentinel when the cell crosses its limit (asm 0x7556-0x7660).  The same
// routine's draw arm (asm 0x76D4-0x78EC) emits one 64x40 quad per cell that is
// not 0x200.  The rig captured the schedule and the first two cells frame by
// frame; see `WIPE_SCHEDULE` and `checkerboardWalk` below.
//
// The dispatch that selects it (asm file 0x895C-.L0x00008974): the scene
// descriptor at 0x80099D80, `lw $v0,0x5C(v1)` / `beqz` -> A28 when +0x5C != 0,
// the A27 iris (F0x8008A5E4) otherwise.

// The grid: 5 columns x 6 rows of 64x40 cells over 320x240.
export const WIPE_A28_COLS = 5;
export const WIPE_A28_ROWS = 6;
export const WIPE_A28_CELLS = WIPE_A28_COLS * WIPE_A28_ROWS; // 30
export const WIPE_A28_CELL_W = 0x40; // 64
export const WIPE_A28_CELL_H = 0x28; // 40
// The sentinel a cell's x OR y takes when the record consumes it (asm 0x765C,
// `li $v1, 0x200`; the draw arm skips a cell whose x==0x200 or y==0x200).
export const WIPE_A28_SENTINEL = 0x200;
// The per-step slide unit: `delta = unk18C() * 0x28` (asm 0x7542-0x7544:
// `sll $v1,$v0,0x2` / `addu $v1,$v0` / `sll $a2,$v1,0x3` = v0*5*8 = v0*40).
// The capture measured 40 px/step with unk18C() == 1.  unk18C() itself is a
// function pointer at [0x8004DF9C]; its value in ordinary play is NOT measured
// beyond the captured runs, so the caller supplies delta.
export const WIPE_A28_STEP_UNIT = 0x28; // 40 px per unk18C() unit
// The grid pointer base and the schedule base (file offsets 0x18C50 / 0x14AC0).
export const WIPE_A28_GRID_BASE = 0x8009b900;
export const WIPE_A28_SCHEDULE_BASE = 0x80097770;
export const WIPE_A28_RECORD_STRIDE = 12; // {pointer:u32, mode:s32, limit:u32}

// The 29-record outside-in spiral schedule, read live from 0x80097770 with the
// fieldstg overlay resident:
// captures/wipe-capture-2026-10-06/a28/wipe-a28-sched-field.txt.  Each record is
// {pointer:u32, mode:s32, limit:u32}; `mode` is +1 or -1 and `limit` is the value
// the pointed-at WORD must reach for the record to be consumed.  The pointer is
// stored RAW (it is the disc's own address), because it is what decides which of
// the cell's two words slides: 15 of the 29 pointers land 4 bytes into their
// cell (`ptr - 0x8009B900 ≡ 4 (mod 8)`), so those records slide the cell's SECOND
// word.  The result is coherent: the top and bottom rows slide in x, the left and
// right columns slide in y -- every tile slides toward the middle and vanishes.
// The capture document's table named the cells by `floor((ptr-base)/8)`; that
// reads the right cell but assumes every slide is in x, which the raw pointers
// contradict.  Read the raw pointer (asm 0x7556-0x7565 does `*ptr += delta*mode`).
export const WIPE_SCHEDULE = [
    { ptr: 0x8009b9c0, mode: -1, limit: 192 }, { ptr: 0x8009b990, mode: -1, limit: 128 },
    { ptr: 0x8009b960, mode: -1, limit: 64 },  { ptr: 0x8009b930, mode: -1, limit: 0 },
    { ptr: 0x8009b904, mode: 1,  limit: 40 },  { ptr: 0x8009b90c, mode: 1,  limit: 80 },
    { ptr: 0x8009b914, mode: 1,  limit: 120 }, { ptr: 0x8009b91c, mode: 1,  limit: 160 },
    { ptr: 0x8009b924, mode: 1,  limit: 200 },
    { ptr: 0x8009b928, mode: 1,  limit: 64 },  { ptr: 0x8009b958, mode: 1,  limit: 128 },
    { ptr: 0x8009b988, mode: 1,  limit: 192 }, { ptr: 0x8009b9b8, mode: 1,  limit: 256 },
    { ptr: 0x8009b9ec, mode: -1, limit: 160 }, { ptr: 0x8009b9e4, mode: -1, limit: 120 },
    { ptr: 0x8009b9dc, mode: -1, limit: 80 },  { ptr: 0x8009b9d4, mode: -1, limit: 40 },
    { ptr: 0x8009b9c8, mode: -1, limit: 192 }, { ptr: 0x8009b998, mode: -1, limit: 128 },
    { ptr: 0x8009b968, mode: -1, limit: 64 },
    { ptr: 0x8009b93c, mode: 1,  limit: 80 },  { ptr: 0x8009b944, mode: 1,  limit: 120 },
    { ptr: 0x8009b94c, mode: 1,  limit: 160 }, { ptr: 0x8009b950, mode: 1,  limit: 128 },
    { ptr: 0x8009b980, mode: 1,  limit: 192 },
    { ptr: 0x8009b9b4, mode: -1, limit: 120 }, { ptr: 0x8009b9ac, mode: -1, limit: 80 },
    { ptr: 0x8009b9a0, mode: -1, limit: 192 },
    { ptr: 0x8009b974, mode: 1,  limit: 120 },
];

// cell(col,row) = (col*64, row*40); index = col*6 + row (column-major).
export function checkerboardCell(i) {
    const col = Math.floor(i / WIPE_A28_ROWS);
    const row = i % WIPE_A28_ROWS;
    return { col, row, x: col * WIPE_A28_CELL_W, y: row * WIPE_A28_CELL_H };
}

// The word a record points at: `(ptr - base) / 4` over the 60-word region
// (30 cells x 2 words).  Even word = the cell's x, odd word = its y.
export function checkerboardWordIndex(ptr) {
    return (ptr - WIPE_A28_GRID_BASE) / 4;
}
export function checkerboardRecordCell(rec) {
    return Math.floor(checkerboardWordIndex(rec.ptr) / 2);
}
export function checkerboardRecordAxis(rec) {
    return checkerboardWordIndex(rec.ptr) % 2 === 0 ? "x" : "y";
}

// The state-0 arm's grid: 60 words, cell i = words [2i, 2i+1] = {x, y}
// (asm 0x73D4-0x742C).
export function pristineCheckerboard() {
    const w = new Array(WIPE_A28_CELLS * 2).fill(0);
    for (let i = 0; i < WIPE_A28_CELLS; i++) {
        const c = checkerboardCell(i);
        w[2 * i] = c.x;
        w[2 * i + 1] = c.y;
    }
    return w;
}

// The live walk state: the 60-word grid plus the schedule cursor.
export function createCheckerboard() {
    return { grid: pristineCheckerboard(), index: 0, calls: 0, done: false };
}

// One call of the walk (asm 0x7554-0x7660).  `delta` is unk18C()*0x28.
//  - the gate at s0->+0x34 ([0x8004DE44]) can hold the walk for a call with no
//    step (asm 0x7554 `bnez $a0, .L0x000076d4`); its driver is host pacing and
//    is NOT decoded here, so it is an argument.
//  - mode != 0: *ptr += delta*mode; the record is consumed when the mode's
//    comparison fails -- mode>=0: *ptr >= limit; mode<0: *ptr <= limit -- at
//    which point *ptr <- 0x200 and the schedule advances (asm 0x7658-0x767C, the
//    callback arg0->unk44 = incTimer, F0x800142F4, which bumps [obj+0x18]).
//  - mode == 0: writes 0x200 to the singleton 0x8009B978 and bumps the phase
//    counter (asm 0x7684-0x76D0); no cell word moves.  (The captured schedule is
//    all non-zero modes; the zero terminator the 2026-09-13 note names is not in
//    this live read.)
export function stepCheckerboard(cb, delta, held = false) {
    if (cb.done) return { stepped: false, crossed: false, record: null };
    cb.calls += 1;
    if (held) return { stepped: false, crossed: false, record: cb.index };
    const idx = cb.index;
    const rec = WIPE_SCHEDULE[idx];
    if (rec.mode === 0) {
        cb.index += 1;
        if (cb.index >= WIPE_SCHEDULE.length) cb.done = true;
        return { stepped: false, crossed: false, record: idx };
    }
    const wi = checkerboardWordIndex(rec.ptr);
    cb.grid[wi] += delta * rec.mode;
    const crossed = rec.mode >= 0 ? cb.grid[wi] >= rec.limit : cb.grid[wi] <= rec.limit;
    if (crossed) {
        cb.grid[wi] = WIPE_A28_SENTINEL;
        cb.index += 1;
        if (cb.index >= WIPE_SCHEDULE.length) cb.done = true;
    }
    return { stepped: true, crossed, record: idx };
}

// The cell-emission order: the schedule order, one entry per consumed cell (the
// cells the walk makes vanish, in the order the 29 records consume them).
export function checkerboardWalk(delta) {
    const cb = createCheckerboard();
    const order = [];
    let guard = 0;
    while (!cb.done && guard++ < 10000) {
        const r = stepCheckerboard(cb, delta);
        if (r.crossed) order.push(checkerboardRecordCell(WIPE_SCHEDULE[r.record]));
    }
    return { grid: cb.grid, order, calls: cb.calls };
}

// The cells still drawn on this frame: every cell whose x AND y are not the
// sentinel (asm 0x7688-0x7694 `beq $v0,$s0` / `beq $v0,0x200` skip), each as a
// 64x40 quad at its current position.
export function checkerboardQuads(cb) {
    const out = [];
    for (let i = 0; i < WIPE_A28_CELLS; i++) {
        const x = cb.grid[2 * i];
        const y = cb.grid[2 * i + 1];
        if (x === WIPE_A28_SENTINEL || y === WIPE_A28_SENTINEL) continue;
        out.push({ cell: i, x, y, w: WIPE_A28_CELL_W, h: WIPE_A28_CELL_H });
    }
    return out;
}