// web/gunslinger-switch.js
//
// The Undersea Base ROOM-PHASE SWITCH (s810, the Gunslinger 1F teleport puzzle) —
// the two native events that swap the room's active type-7 trigger map and its
// 24-byte step program. This is the runtime half of the "gunslinger" native-event
// family in engine/systems/native-event-families.ts; the decoded DATA both events
// swap to is web/assets/data/stage_layout_variants.json, lifted by
// tools/extract_stage_layout_variants.py.
//
// THE TWO EVENT BODIES — wstag810.s file offsets 0xc4c (event 9000) and 0xcb0
// (event 9001). Each is a pure transaction over the persistent field latch
// `D0x80048d34+0x26e4` (RAM 0x8004b418), and each registers a type-7 resource and
// installs its paired step program at scene_struct+0x14 (RAM 0x80099d94):
//
//   9000  acts only when the latch is NON-zero (`beqz`):  register(7, 0x06ed0003)
//         + [0x80099d94] = 0x800a7aac + latch = 0
//   9001  acts only when the latch IS zero (`bnez`):      register(7, 0x06ed0004)
//         + [0x80099d94] = 0x800a7dac + latch = 0x20
//
// So the pair is inverse: they alternate, and the latch (0 / 0x20) is the room's
// phase word. Both return 0. The stage initializer (wstag810.s file 0xe0c) runs
// the matching half at entry, gated by the new-map latch +0x26d8 and this same
// +0x26e4 — that init-time choice is a global written outside the stage data and
// is NOT modelled here (see gunslingerLatchIsSecondLayout).
//
// WHICH CELL REACHES WHICH LAYOUT — the decode this file exists to make runnable.
// The step program is indexed by the type-7 trigger byte under the player's feet
// (`byte & 0x1f`, fieldstg.s:5624). Each layout's program carries exactly one
// op-8 `start_event` that throws the switch:
//
//   layout 0 (grid 0x06ed0003 + program 0x800a7aac, file 0x1ccc):
//       index 31 -> start_event(9001) -> layout 1   (byte 0x1f, group 0)
//   layout 1 (grid 0x06ed0004 + program 0x800a7dac, file 0x1fcc):
//       index 21 -> start_event(9000) -> layout 0   (byte 0xb5, group 5)
//
// Layout 1's program is the 23-record tail of layout 0's 55-record table starting
// at file 0x1fcc (`0x800a7dac - 0x800a7aac = 0x300` = 32 records), so its index 21
// is the same physical record as layout 0's index 53 — the `start_event(9000)`
// that throws the room back. That is why the trigger bytes differ (31 vs 21):
// each grid addresses the shared switch record through its own program base.

/**
 * The constants each swap event carries, read from its overlay body.
 * @typedef {object} GunslingerSwitchCommand
 * @property {string} stage
 * @property {number} eventId
 * @property {boolean} needsLatchNonZero  the body's own branch direction
 * @property {0|1} layout                 index into the stage's extracted layouts
 * @property {number} latchAfter          the value the body writes afterwards
 */

/** @type {readonly GunslingerSwitchCommand[]} */
export const GUNSLINGER_SWITCHES = [
    // file 0xc4c: `lui $a1,0x6ed` / `ori $a1,0x3`; `sw v0,-0x626c(v1)` = 0x800a7aac; latch 0
    { stage: "s810", eventId: 9000, needsLatchNonZero: true, layout: 0, latchAfter: 0 },
    // file 0xcb0: `lui $a1,0x6ed` / `ori $a1,0x4`; `sw v0,-0x626c(v1)` = 0x800a7dac; latch 0x20
    { stage: "s810", eventId: 9001, needsLatchNonZero: false, layout: 1, latchAfter: 0x20 },
];

/** The swap event a native event id carries on a stage, or null. */
export function gunslingerSwitchCommand(stage, eventId) {
    return GUNSLINGER_SWITCHES.find(
        (c) => c.stage === stage && c.eventId === eventId) ?? null;
}

/**
 * One application of a swap event body: does it act, what latch does it leave, and
 * which layout does it install. Mirrors the branch and the two stores exactly; a
 * gate that fails is the body's own early return — it registers nothing.
 */
export function applyGunslingerSwitch(latch, cmd) {
    const acts = cmd.needsLatchNonZero ? latch !== 0 : latch === 0;
    if (!acts) return { fires: false, latch, layout: null };
    return { fires: true, latch: cmd.latchAfter, layout: cmd.layout };
}

/**
 * The layout the room is in, given the persistent latch. The disc's own stage
 * initializer (wstag810.s file 0xe0c) is the authority, and it is NOT a pure
 * function of this word alone — it reads the new-map latch `+0x26d8` first. That
 * global is written by the fieldstg map-change branch (fieldstg.s:0x4880), which
 * is outside the stage data, so it is not modelled here. The initial layout is
 * instead taken from the step program the room is already pointing at: a
 * re-entered room keeps the phase the last swap left it in, and the first visit
 * starts in layout 0.
 */
export function gunslingerLatchIsSecondLayout(latch) {
    return latch !== 0;
}
