// The three small screen task registrations, translated from their overlays'
// create thunks (authority-2 closures):
//   stagslct F0x80085EA4 -> F0x80014504(0x80084D9C, 0,    0)
//   shocktst F0x8008499C -> F0x80014504(0x80084714, 0x5C, 0x10)
//   soundtst F0x80084D48 -> F0x80014504(0x80084B2C, 0x74, 0x2C)
//
// F0x80014504 forces the fourth argument to zero and forwards to the task
// allocator (claims `resident-fourth-argument-zero-wrapper`,
// `native-controller-allocator-extra-state-division-corrected-2026-08-04`,
// `UI-TASKOBJ-STATEMACHINE-001`, all partially_verified): it allocates
// `selfSize` bytes, and only when `widgetSize != 0` allocates the child block
// at obj+0x24 with its count at obj+0x20, then installs the 10-slot method
// table. Each thunk returns the new object.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/task-registration-oracle.test.js runs each original thunk
// through engine/native with the allocator stubbed.

export interface TaskAllocHost {
    /** F0x80014504(handler, selfSize, widgetSize) -> the new task object. */
    allocTask(handler: number, selfSize: number, widgetSize: number): number;
}

/** stagslct stage-select menu (widgetSize 0: the tick's child block is a separate concern). */
export const STAGE_SELECT_MENU_TASK = { handler: 0x80084d9c, size: 0, widget: 0 } as const;
/** shocktst developer rumble-pattern screen. */
export const SHOCK_TEST_TASK = { handler: 0x80084714, size: 0x5c, widget: 0x10 } as const;
/** soundtst developer sound-list screen. */
export const SOUND_TEST_TASK = { handler: 0x80084b2c, size: 0x74, widget: 0x2c } as const;

/** F0x80085EA4(): register the stage-select menu task. */
export function stageSelectMenuCreate(host: TaskAllocHost): number {
    return host.allocTask(
        STAGE_SELECT_MENU_TASK.handler,
        STAGE_SELECT_MENU_TASK.size,
        STAGE_SELECT_MENU_TASK.widget,
    ) >>> 0;
}

/** F0x8008499C(): register the shock-test task. */
export function shockTestCreate(host: TaskAllocHost): number {
    return host.allocTask(
        SHOCK_TEST_TASK.handler,
        SHOCK_TEST_TASK.size,
        SHOCK_TEST_TASK.widget,
    ) >>> 0;
}

/** F0x80084D48(): register the sound-test task. */
export function soundTestCreate(host: TaskAllocHost): number {
    return host.allocTask(
        SOUND_TEST_TASK.handler,
        SOUND_TEST_TASK.size,
        SOUND_TEST_TASK.widget,
    ) >>> 0;
}
