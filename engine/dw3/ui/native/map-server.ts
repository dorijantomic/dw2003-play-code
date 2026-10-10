// The stage -> map-server selector, translated bit-exactly from the original
// pro/ststatus body F0x8009A670.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/map-server.test.js runs the original through
// engine/native and compares the returned value.
//
// Reads the current stage id from [0x80048D68] and returns 0 for a stage below
// 0x270, 1 for 0x270..0x2D6, or -1 for 0x2D7 and above. The caller uses the
// result to pick the map's server/level constants.
//
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

/** [0x80048D68]: the current stage id the selector reads. */
export const MAP_SERVER_STAGE_CELL = 0x80048d68;
/** The stage-id thresholds. */
export const MAP_SERVER_LOW = 0x270;
export const MAP_SERVER_HIGH = 0x2d7;

export interface MapServerMemory {
    read32(addr: number): number;
}

/**
 * F0x8009A670(): 0 below 0x270, 1 in 0x270..0x2D6, -1 at 0x2D7 and above.
 */
export function mapServerFromStage(mem: MapServerMemory): number {
    const stage = mem.read32(MAP_SERVER_STAGE_CELL) | 0;
    if (stage < MAP_SERVER_HIGH) return (stage < MAP_SERVER_LOW ? 0 : 1);
    return -1;
}
