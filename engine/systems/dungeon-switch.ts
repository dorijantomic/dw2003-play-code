// engine/systems/dungeon-switch.ts
//
// The Bug-Maze switch commands (s745 / s746, "North Sector — Dark Dungeon").
//
// A Bug-Maze floor is covered in trap tiles: step on one and you are bounced back to the
// maze's reset point. The tiles are controlled by ONE stage-local pad object, and three
// step-tile events throw that object between its two layouts. Each stage ships the same
// three commands; every constant below is read straight out of the overlay.
//
// THE COMMAND HANDLER — wstag745 file offsets 0x244 / 0x2c4 / 0x344 (wstag746 is the same
// three bodies with object type 0x19 instead of 0x18):
//
//   obj = (*[0x8004b7bc])(objType, -1, -1)        # look up the single object of that type
//   if (!obj) return 0                            # no object -> silent no-op
//   if (obj+0x0c != state) play SWITCH02          # 0x80055c48(0x800410bd), only on a change
//   obj->vt[0x28](obj, state)                     # +0x28 = setState, stores state at +0x0c
//   obj+0x04 = arm                                # 8000/8001 write 0; 8002 writes 1
//   return 0
//
//   id 8000 -> state 1, arm 0     id 8001 -> state 2, arm 0     id 8002 -> state 1, arm 1
//
// THE PAD OBJECT'S OWN TICK — wstag745 file 0x000-0x1f4 (base 0x800a5de0):
//
//   state 0 (fresh): setState([0x8004b424] != 0 ? 2 : 1)   # restore the live layout
//   state 1: armed == 0 -> [0x8004b424] = 0                # layout A is the live one
//            armed != 0 and +0x10 == 5 -> setState(2), obj+0x04 = 0, play SWITCH02
//   state 2: build the layout-B pad art; [0x8004b424] = 1  # layout B is the live one
//
// So `[0x8004b424]` is the maze's LAYOUT latch: 1 while the pad sits in its second layout,
// 0 in its first. The latch survives a rebuild, which is why state 0 restores from it.
//
// WHAT IS PORTED AND WHAT IS NOT. The command (state + arm + the change sound) and the
// object's own state/latch machine are ported exactly. The pad ART the state-2 body builds
// (a GPU-prim run over layer 0x1002) is presentation and stays in the renderer's hands; the
// walker's trap-tile GEOMETRY (web/assets/scenes/*.json `trapPads`, tools/gen_trap_pads.py)
// is the static mask for one layout, and the per-layout tile sets are not decoded — so the
// latch is exposed for a later geometry pass rather than inventing two masks. This is
// named, not filled: see `DUNGEON_SWITCH_LATCH`.

/** The object registry key each stage's pad object carries (wstag745/746 allocator a3). */
export const DUNGEON_SWITCH_OBJECT_TYPE: Readonly<Record<string, number>> = {
    s745: 0x18,
    s746: 0x19,
};

/** `*[0x8004b424]` — the maze's live-layout latch (1 = second layout, 0 = first). */
export const DUNGEON_SWITCH_LATCH = 0x8004b424;

/** the packed SWITCH02 cue the handler plays when the state actually changes. */
export const DUNGEON_SWITCH_SOUND = "switch02";

export interface DungeonSwitchCommand {
    stage: string;
    eventId: number;
    /** the object-registry key looked up before anything is done. */
    objectType: number;
    /** the state written through obj->+0x28 (obj+0x0c). */
    state: 1 | 2;
    /** the word written to obj+0x04 — 1 means "armed", 0 means "thrown". */
    arm: 0 | 1;
}

/** The three commands each stage ships, read from the handler bodies. */
export const DUNGEON_SWITCH_COMMANDS: readonly DungeonSwitchCommand[] = (() => {
    const out: DungeonSwitchCommand[] = [];
    for (const [stage, objectType] of Object.entries(DUNGEON_SWITCH_OBJECT_TYPE)) {
        out.push(
            { stage, eventId: 8000, objectType, state: 1, arm: 0 },
            { stage, eventId: 8001, objectType, state: 2, arm: 0 },
            { stage, eventId: 8002, objectType, state: 1, arm: 1 },
        );
    }
    return out;
})();

/** The command a switch event carries, or null when it is not one of the six. */
export function dungeonSwitchCommand(stage: string, eventId: number): DungeonSwitchCommand | null {
    return DUNGEON_SWITCH_COMMANDS.find(c => c.stage === stage && c.eventId === eventId) ?? null;
}

/** The pad object's ported words: obj+0x0c, obj+0x04 and the pending sub-state obj+0x10. */
export interface PadSwitchObject {
    /** obj+0x0c — 0 fresh, 1 first layout, 2 second layout. */
    state: 0 | 1 | 2;
    /** obj+0x04 — 1 while a throw is pending. */
    arm: 0 | 1;
    /** obj+0x10 — the sub-state the armed state-1 tick compares against 5. */
    pending: number;
}

/** A fresh object, before its first tick. */
export function newPadSwitchObject(): PadSwitchObject {
    return { state: 0, arm: 0, pending: 0 };
}

export interface DungeonSwitchResult {
    object: PadSwitchObject;
    /** true when the handler heard a real change and plays the switch click. */
    playSwitch: boolean;
}

/**
 * The command handler: look the object up (the caller supplies it), play the click only when
 * the state actually changes, set the state, then write the arm word. Mirrors
 * wstag745 0x244 / 0x2c4 / 0x344 exactly, including the "only-on-change" sound.
 */
export function applyDungeonSwitchCommand(
    object: PadSwitchObject | null,
    cmd: DungeonSwitchCommand,
): DungeonSwitchResult | null {
    if (!object) return null; // (*[0x8004b7bc]) returned 0 -> silent no-op
    const playSwitch = object.state !== cmd.state;
    return { object: { ...object, state: cmd.state, arm: cmd.arm }, playSwitch };
}

/**
 * The pad object's own tick (wstag745 0x000-0x1f4), which decides the maze latch. `latch`
 * is the live `[0x8004b424]`. Returns the object's next words and the latch they leave.
 * The state-2 presentation run is not modelled (see the header); every state/latch write is.
 */
export function padSwitchObjectTick(
    object: PadSwitchObject,
    latch: number,
): { object: PadSwitchObject; latch: number; playSwitch: boolean } {
    let next = object;
    let nextLatch = latch;
    let playSwitch = false;
    if (object.state === 0) {
        next = { ...object, state: latch !== 0 ? 2 : 1 };
    } else if (object.state === 1) {
        if (object.arm === 0) {
            nextLatch = 0;                      // the "throw" landed: layout A is live
        } else if (object.pending === 5) {
            playSwitch = true;                  // the armed tick flips it over
            next = { ...object, state: 2, arm: 0 };
        }
    } else if (object.state === 2) {
        nextLatch = 1;                          // layout B is live
    }
    return { object: next, latch: nextLatch, playSwitch };
}
