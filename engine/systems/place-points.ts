// engine/systems/place-points.ts
//
// THE PLACES SYSTEM: a stage's exits re-aim per the place you entered from.
//
// The disc's `copyPlacePoints(slots, placePoints, place, placeArg)` is one body in
// 34 stage overlays (WS7 of docs/research/scripting/field-script-engine-verified.md;
// ledger `places-copy-place-points-family-2026-10-10`). On its first tick the
// stage's updateStage walks the overlay's NULL-terminated `placePoints` array for
// the entry whose `place` AND `placeArg` equal the incoming pair — `GAME.place` /
// `GAME.placeArg` (`D0x80048D34 +0x44/+0x46`), the route pair the previous stage's
// exit published — and copies that entry's point chain into consecutive StageSlots:
//
//   entry   = {s16 place; s16 placeArg; StagePoint *points}
//   point   = {u16 screen; u16 place; u16 placeArg; u16 x; u16 y; u16 dir;
//              StagePoint *next}
//
//   per point, into the slot: +0xA <- screen, +0xC <- x, +0xE <- y, +0x10 <- dir,
//   +0x14 <- place, +0x16 <- placeArg; then slot += 0x18 and point = next.
//
// The slot IS one of the stage's type-7 step records (the walker's exit rows, one
// per op-1 step), so point i lands on slot i — the trigger wedge whose grid byte's
// low 5 bits name step i. `dir` is the maze exit records' own four-way enum
// (0 = a hole out, 1 = south, 3 = west, 5 = north, 7 = east — see
// tools/extract_maze_exits.py), carried through as the NEXT stage's arrival facing.
//
// An incoming pair the table does not describe matches nothing and the disc
// returns without copying: the slots keep their static values standing, which is
// a real answer, not a failure. A pair of zeros is a real key: 12 of the 34
// tables carry a {0,0} default entry, and the producers publish (0,0) for an
// unkeyed door — so the default chain is what an ordinary entry gets.
//
// ── The producer half ──
//
// `GAME.place`/`GAME.placeArg` are written at exactly two sites in FIELDSTG
// (ledger `places-game-place-producers-2026-10-10`): the trigger set-off switch
// F0x800885d4, whose SLOT_EXIT arm publishes the taken StageSlot's own
// `place`/`placeArg` after `FIELDSTG_leaveField(slot->arg, -1, x<<8, y<<8, dir)`,
// and the field screen handler F0x8008aa10, whose leave arm publishes a SlotDest's
// `+0xA`/`+0xC`. The stores have no zero test, so taking a slot ALWAYS publishes
// that slot's pair, zeros included — which is why {@link placePointPair} returns a
// pair for every point, and the host attaches it to the aimed row as the row's
// `routeWords` so the existing route-pair commit publishes it verbatim.
//
// ── The updateStage variants (ledger `places-update-stage-variants-2026-10-10`) ──
//
// 25 overlays copy first and call `task->nextState(task)` after; 7 (825, 835, 840,
// 845, 850, 855, 860) call nextState first and copy after; 2 (635, 640) create
// their tile-animation task as `children[0]` first, then copy, then nextState. All
// three run the copy on the same state gate (`state == 0`, `state < 0` or
// `state >= 4`), so the ordering is only observable if the sibling call reads the
// slots — none of the three does. The variant is extracted into the asset and is
// carried here as data for the record, not as a behavioural branch.

/** One maze exit record, as the overlay stores it: the copy's source fields. */
export interface PlacePoint {
    /** Destination screen id (slot +0xA after the copy). */
    screen: number;
    /** Arrival position in the destination stage. */
    x: number;
    y: number;
    /** Arrival facing, the maze enum (0/1/3/5/7). */
    dir: number;
    /** The destination's own route pair, published when this slot is taken. */
    place: number;
    placeArg: number;
}

/** One `placePoints` entry: the key pair and the chain it copies. */
export interface PlacePointEntry {
    place: number;
    placeArg: number;
    /** The chain in COPY order: point i lands on slot i. */
    points: PlacePoint[];
}

/** One stage's `placePoints` table (web/assets/data/stage_place_points.json). */
export interface StagePlacePoints {
    entries: PlacePointEntry[];
}

/**
 * The copyPlacePoints port: the chain whose entry matches `(place, placeArg)`
 * exactly, in copy order, or null when no entry matches (the disc returns without
 * copying — the slots keep their static values).
 *
 * Both compares are the assembly's own: `lh` entry->place vs the `lhu` halfword,
 * then `lh` entry->placeArg, each a plain 32-bit register compare — equality on
 * the 16-bit values, which is what the shipped domains (0..30) make of it.
 */
export function copyPlacePoints(
    table: StagePlacePoints | undefined | null,
    place: number,
    placeArg: number,
): PlacePoint[] | null {
    const wantPlace = place & 0xffff;
    const wantArg = placeArg & 0xffff;
    for (const entry of table?.entries ?? []) {
        if ((entry.place & 0xffff) !== wantPlace) continue;
        if ((entry.placeArg & 0xffff) !== wantArg) continue;
        return entry.points;
    }
    return null;
}

/**
 * The pair a taken slot publishes — the SLOT_EXIT arm's two stores, verbatim.
 * Always a pair: the stores have no zero test, so a hole (0,0) is published as
 * (0,0), which is a real clear rather than "publish nothing".
 */
export function placePointPair(point: PlacePoint): { key: number; companion: number } {
    return { key: point.place & 0xffff, companion: point.placeArg & 0xffff };
}

/** The row shape the host aims; the walker's scene exit rows carry these fields. */
export interface PlaceAimRow {
    /** The step index this row sits at — its StageSlot index. */
    slot?: number;
    to?: string | null;
    spawnX?: number;
    spawnY?: number;
    dir?: string;
    /** The pair the taken slot publishes (read by the route-pair commit). */
    routeWords?: { d78: number; d7a: number };
    /** A placeholder self-warp; cleared once the chain re-aims the row. */
    selfWarp?: boolean;
    /** True once the chain has re-aimed this row (the slot was copied). */
    aimed?: boolean;
    /** The destination screen id, kept for the record. */
    screen?: number;
    [k: string]: unknown;
}

/**
 * Copy one chain onto the stage's exit rows — the host half of copyPlacePoints.
 *
 * Point i lands on the row whose `slot` is i (the row IS the StageSlot): the
 * row's destination, arrival position and facing are overwritten, and its
 * `routeWords` becomes the point's own pair so taking the row publishes the pair
 * the disc's SLOT_EXIT arm publishes. A row the chain does not cover is left
 * alone — the disc leaves the rest of the slots static.
 *
 * `pointDest` resolves a point to the host's destination id and facing name; a
 * null answer leaves that row's destination untouched. Returns a NEW array of
 * row objects in both cases — the input rows (the host's pristine base rows)
 * are never mutated, so an unmatched pair later falls back to them intact.
 */
export function aimPlacePoints(
    rows: readonly PlaceAimRow[],
    table: StagePlacePoints | undefined | null,
    place: number,
    placeArg: number,
    pointDest: (point: PlacePoint) => { to: string; dir: string } | null,
): PlaceAimRow[] {
    const points = copyPlacePoints(table, place, placeArg);
    const bySlot = new Map<number, PlacePoint>();
    (points ?? []).forEach((p, i) => bySlot.set(i, p));
    return rows.map((row) => {
        const point = row.slot !== undefined ? bySlot.get(row.slot) : undefined;
        if (!point) return { ...row };
        const dest = pointDest(point);
        if (!dest) return { ...row };
        return {
            ...row,
            to: dest.to,
            spawnX: point.x,
            spawnY: point.y,
            dir: dest.dir,
            routeWords: { d78: point.place & 0xffff, d7a: point.placeArg & 0xffff },
            selfWarp: false,
            aimed: true,
            screen: point.screen,
        };
    });
}
