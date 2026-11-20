// ── the ambient tick (fieldstg F0x80089038) ────────────────────────────────
//
// The field engine's own per-frame pass over a stage's placement table: the
// SAME table the members above claim records from, but this is the renderer's
// code (fieldstg file 0x6388), not an overlay actor.  web/effects.js runs it
// once per rendered frame and draws what it resolves.
//
// The disc walks the table and applies THREE gates to each record before
// anything happens (fieldstg file 0x64bc-0x6550):
//
//   1. the LIVE active byte (record+0) -- `lbu $v0, ($s1)` / `beqz` at file
//      0x64bc: an inactive record neither animates nor draws, so its phase is
//      frozen until it is switched on;
//   2. the CAMERA CULL, four comparisons against the 0x1002 layer's screen
//      rect (`ctx+0x128` = EXE F0x8001E0C8, `{x, y, w, h}`):
//        X >= x0 - size && X <= x0 + w && Y >= y0 - size && Y <= y0 + h
//      (file 0x64f4-0x6550).  The record's size byte widens the LOW side
//      only -- the disc's own asymmetry.  A 0xFF (FIELDCOM) record is tested
//      at (X-0x32, Y-0x64); that adjustment is TEST-ONLY, the draw re-reads
//      the raw anchor (file 0x6774-0x67a0, and the walker's own field note).
//      A culled record does NOT advance its timer: an off-screen windmill is
//      frozen on the console, so its phase when it scrolls back in is the
//      phase it had when it left;
//   3. the animation-mode dispatch (record+5) -- modes 1/2/3 advance, 0 and
//      4+ draw without animating.

/** The ambient record as `point_sprites.json` carries it. */
export interface PointSpriteRecord {
    /** record+2; doubles as the cull radius. 0 terminates the table. */
    size: number;
    /** record+1, the atlas byte; 0xFF draws from FIELDCOM.BIN. */
    atlasFlag: number;
    /** the extractor's spelling of the 0xFF case (`"fieldcom"`). */
    atlas?: string;
    /** record+0 as the disc ships it. */
    active: number;
    /** record+5, the animation mode. */
    mode: number;
    /** record+6/+7, the loop bounds modes 1/2/3 cycle between. */
    min: number;
    max: number;
    /** record+8; the timer reload is `period << 8`. */
    period: number;
    x: number;
    y: number;
    /** record+14, the y-sort baseline (0 = the fixed pass). */
    ysort: number;
}

/** The per-record runtime web/effects.js keeps beside the table. */
export interface PointSpriteRuntime {
    sprite: number;
    ctr: number;
    dir: number;
    timer: number;
    active?: number;
    x?: number;
    y?: number;
    ysort?: number;
    /** record+5 override -- the s421 actor's write on the ordinary route. */
    mode?: number;
}

/** One prepared frame's rebase layers, in the order every consumer reads them. */
export interface PointSpriteFrame {
    /** The camera rect (the 0x1002 layer's screen rect); absent/null = no cull. */
    view?: { x: number; y: number; w: number; h: number } | null;
    /** Interpreter bytes on a native stage (F0x80089038's live table). */
    activeOverride?: readonly (number | null)[] | null;
    nativePos?: readonly ({ x: number; y: number; ysort: number } | null)[] | null;
    actorPos?: readonly ({ x: number; y: number; ysort?: number } | null)[] | null;
    liveMode?: readonly (number | null)[] | null;
}

/** Resolve one record's live state: interpreter overrides first, then the
 *  translated actor host's runtime, then the ROM table.  The draw and the tick
 *  read the same resolution, so they cannot disagree about a record. */
export function pointRecordLive(
    rec: PointSpriteRecord,
    st: PointSpriteRuntime | undefined,
    frame: PointSpriteFrame,
    i: number,
): { active: number; x: number; y: number; ysort: number; mode: number } {
    return {
        active: frame.activeOverride?.[i] ?? st?.active ?? rec.active,
        x: frame.actorPos?.[i]?.x ?? frame.nativePos?.[i]?.x ?? st?.x ?? rec.x,
        y: frame.actorPos?.[i]?.y ?? frame.nativePos?.[i]?.y ?? st?.y ?? rec.y,
        ysort: frame.actorPos?.[i]?.ysort ?? frame.nativePos?.[i]?.ysort ?? rec.ysort,
        mode: frame.liveMode?.[i] ?? st?.mode ?? rec.mode,
    };
}

/** The disc's camera cull (fieldstg file 0x64f4-0x6550).  A null view passes
 *  everything -- a caller with no camera (a lab) draws the whole stage. */
export function pointRecordInView(
    rec: PointSpriteRecord,
    x: number,
    y: number,
    view: { x: number; y: number; w: number; h: number } | null | undefined,
): boolean {
    if (!view) return true;
    const sx = rec.atlas === "fieldcom" ? x - 0x32 : x;
    const sy = rec.atlas === "fieldcom" ? y - 0x64 : y;
    return sx >= view.x - rec.size && sx <= view.x + view.w
        && sy >= view.y - rec.size && sy <= view.y + view.h;
}

/** One animation frame (F0x80089038's per-record body), gated.  `r.max === 0`
 *  records do not animate here: the disc's dispatch has no such test, but no
 *  shipped record carries mode 1-3 with max 0 (the extractor census), so the
 *  guard only keeps a malformed row inert. */
export function tickPointSpriteRecords(
    records: readonly PointSpriteRecord[],
    rt: readonly PointSpriteRuntime[],
    frame: PointSpriteFrame = {},
): void {
    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const st = rt[i];
        if (!r || !st) continue;
        const live = pointRecordLive(r, st, frame, i);
        if (!r.max || live.mode < 1 || live.mode > 3) continue;
        if (!live.active) continue;
        if (!pointRecordInView(r, live.x, live.y, frame.view)) continue;
        if (st.timer >= 0x100) {
            st.timer -= 0x100;
            continue;
        }
        st.timer = r.period << 8;
        if (live.mode === 1) {
            st.sprite = st.sprite >= r.max ? r.min : st.sprite + 1;
        } else if (live.mode === 2) {
            st.ctr = st.ctr >= r.max ? r.min : st.ctr + 1;
        } else {
            st.ctr += st.dir;
            if (st.ctr > r.max) { st.ctr = Math.max(r.min, r.max - 1); st.dir = -1; }
            else if (st.ctr < r.min) { st.ctr = Math.min(r.max, r.min + 1); st.dir = 1; }
        }
    }
}

// ── the flag-gated mode writer (wstag421's stage actor) ────────────────────
//
// ONE overlay actor of this family claims no record and runs no stepper: at
// stage entry it walks its own stage's point table and writes the ANIMATION
// MODE byte (record+5) of every record whose atlas byte (+1) equals `tag`,
// from `get_flag(flag) != 0` (wstag421.s file 0x38-0x98: `li $a0, 0x1a0a` /
// `lw $v0, -0x7534($v0)` = get_flag / `sltu $a1, $zr, $v0` / `sb $a1,
// 0x3($v1)`).  On the console Qing Long City's windmills and fans are frozen
// until flag 0x1a0a is set (the s435 flag-set script is its producer); the
// walker's ORDINARY route never ran this actor -- it only existed behind
// ?nativeStages -- so the windmills spun regardless of the flag.

/** One mined mode-gate row (`point_record_actors.json` `modeGates`). */
export interface PointModeGate {
    /** the record's atlas byte (+1) the write applies to. */
    tag: number;
    /** the flag the mode follows. */
    flag: number;
}

/** Apply the disc's stage-entry write: mode = get_flag(flag) ? 1 : 0 on every
 *  record carrying the tag.  Idempotent, so the caller may run it at each
 *  stage entry (which is when the original actor runs its state 0). */
export function applyPointModeGates(
    records: readonly PointSpriteRecord[],
    rt: readonly PointSpriteRuntime[],
    gates: readonly PointModeGate[],
    getFlag: ((id: number) => number) | null,
): void {
    if (!gates?.length) return;
    for (const gate of gates) {
        const mode = getFlag && getFlag(gate.flag) ? 1 : 0;
        for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            const st = rt[i];
            if (rec?.atlasFlag === gate.tag && st) st.mode = mode;
        }
    }
}
