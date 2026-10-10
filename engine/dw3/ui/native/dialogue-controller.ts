// The field conversation-box controller, translated from the fieldstg overlay
// (load base 0x80082CB0): F0x80088CA0 (cutscene SAY creator), F0x80088D38 (NPC
// talk creator), F0x80088B84 (controller tick) and F0x80088A84 (balloon anchor).
//
// Oracle: tests/lane-b/dialogue-controller.test.js runs the originals through
// engine/native on resident.bin + fieldstg.bin and compares memory writes and
// the ordered calls. Canonical doc:
// docs/research/ui/dialogue-window-placement-decoded-2026-07-02.md.
// Worklist: .dw3-research/screen-worklists-2026-10-01/dialogue.md.
//
// Task fields: +0xC task state, +0x28 / +0x38 base methods, +0x50 actor (the
// SAY creator) or NPC object (the talk creator), +0x54 line, +0x58 mode (balloon
// quadrant 0..3), +0x5C plain-window flag, +0x60 text pack. The tick's second
// argument is the cell that holds the child window handle.
//
// Host boundaries: F0x80014504 (task create), the projector [0x8009B3D4], the
// pack getters [0x80044F5C] / [0x80044F4C], the balloon EXE F0x8001CE44, the
// plain-window EXE F0x8001BE00 (ported in dialogue-plain-window.ts, boundary kept)
// and the child's vtable +0x68 re-anchor method.

export const CONTROLLER_TICK = 0x80088b84;
export const CONTROLLER_TASK_SIZE = 0x64;
export const SAY_CREATE = 0x80088ca0;
export const TALK_CREATE = 0x80088d38;
export const ANCHOR = 0x80088a84;
export const SAY_PACK_HANDLE_CELL = 0x80099dc8;
export const TALK_PACK_HANDLE_CELL = 0x80099dc4;
export const WINDOW_KIND = 0x1004;
export const ACTOR_QUIRK_ID = 0xd6;

export interface ControllerMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ControllerHost {
    /** F0x80014504(tick, size, align): create the task, return its object. */
    createTask(tick: number, size: number, align: number): number;
    /** [0x80044F5C](handle): the SAY text pack getter. */
    sayPack(handle: number): number;
    /** [0x80044F4C](handle): the talk text pack getter. */
    talkPack(handle: number): number;
    /** [0x8009B3D4](&{x,y}): project in place (world to screen). */
    project(x: number, y: number): [number, number];
    /** F0x8001CE44(0x1004, x, y, pack, line, mode): the anchored balloon; returns its handle. */
    buildBalloon(kind: number, x: number, y: number, pack: number, line: number, mode: number): number;
    /** F0x8001BE00(0x1004, pack, line): the plain system window; returns its handle. */
    buildPlain(kind: number, pack: number, line: number): number;
    /** obj.method[slot](obj, ...args): +0x28 (set state), +0x38 (advance), child +0x68 (re-anchor). */
    callMethod(obj: number, slot: number, args: number[]): void;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

function create(mem: ControllerMemory, host: ControllerHost, actor: number, line: number): number {
    const task = u32(host.createTask(CONTROLLER_TICK, CONTROLLER_TASK_SIZE, 4));
    mem.write32(task + 0x50, actor);
    mem.write32(task + 0x54, line);
    return task;
}

/** F0x80088CA0(actor, line, mode, plainFlag): the cutscene SAY creator. */
export function dialogueSayCreate(mem: ControllerMemory, host: ControllerHost,
    actor: number, line: number, mode: number, plainFlag: number): number {
    const task = create(mem, host, actor, line);
    mem.write32(task + 0x58, mode);
    mem.write32(task + 0x5c, plainFlag);
    mem.write32(task + 0x60, host.sayPack(s32(mem.read32(SAY_PACK_HANDLE_CELL))));
    return task;
}

/**
 * F0x80088D38(npc, line): the NPC talk creator. The quadrant comes from the NPC
 * facing (+0x60, jump table 0x80082ED0: 3,4,5 below, all others above, including
 * values over 7) and the projected screen position of (npc+0x58, npc+0x5C):
 *   above: x >= 0xA0 -> 0, else 2; below: x >= 0xA0 -> 1, else 3 (signed compares);
 *   then flip vertically: 0 -> 1 when y < 0x79, 1 -> 0 when y >= 0xAC,
 *   2 -> 3 when y < 0x79, 3 -> 2 when y >= 0xAC. The plain flag +0x5C is 0.
 */
export function dialogueTalkCreate(mem: ControllerMemory, host: ControllerHost,
    npc: number, line: number): number {
    const task = create(mem, host, npc, line);
    mem.write32(task + 0x60, host.talkPack(s32(mem.read32(TALK_PACK_HANDLE_CELL))));
    const [sx, sy] = host.project(s32(mem.read32(npc + 0x58)), s32(mem.read32(npc + 0x5c)));
    const facing = u32(mem.read32(npc + 0x60));
    const below = facing === 3 || facing === 4 || facing === 5;
    let mode: number;
    if (below) mode = s32(sx) >= 0xa0 ? 1 : 3;
    else mode = s32(sx) >= 0xa0 ? 0 : 2;
    const y = s32(sy);
    if (mode === 0) { if (y < 0x79) mode = 1; }
    else if (mode === 1) { if (y >= 0xac) mode = 0; }
    else if (mode === 2) { if (y < 0x79) mode = 3; }
    else if (mode === 3) { if (y >= 0xac) mode = 2; }
    mem.write32(task + 0x58, mode);
    mem.write32(task + 0x5c, 0);
    return task;
}

/**
 * F0x80088A84(task): the balloon anchor point. Projects (actor+0x58, actor+0x5C)
 * (y less 21 first for actor id +4 == 0xD6), then x -11 for modes 2/3 else +11
 * and y -19 for modes 0/2 else -7. Returns [x, y] (the original stores two words).
 */
export function dialogueAnchor(mem: ControllerMemory, host: ControllerHost, task: number): [number, number] {
    const actor = u32(mem.read32(task + 0x50));
    const x0 = s32(mem.read32(actor + 0x58));
    let y0 = s32(mem.read32(actor + 0x5c));
    if (s32(mem.read32(actor + 4)) === ACTOR_QUIRK_ID) y0 = s32(y0 - 0x15);
    const [px, py] = host.project(x0, y0);
    const mode = s32(mem.read32(task + 0x58));
    const x = u32(mode - 2) < 2 ? s32(px - 0xb) : s32(px + 0xb);
    const y = mode === 0 || mode === 2 ? s32(py - 0x13) : s32(py - 7);
    return [x, y];
}

/** F0x80088B84(task, cell): the controller tick. */
export function dialogueControllerTick(mem: ControllerMemory, host: ControllerHost,
    task: number, cell: number): void {
    const state = s32(mem.read32(task + 0x0c));
    if (state !== 1) {
        if (state < 2 || state >= 4) {
            if (s32(mem.read32(task + 0x5c)) !== 0) {
                mem.write32(cell, host.buildPlain(WINDOW_KIND, s32(mem.read32(task + 0x60)), s32(mem.read32(task + 0x54))));
            } else {
                const [x, y] = dialogueAnchor(mem, host, task);
                mem.write32(cell, host.buildBalloon(WINDOW_KIND, s16(x), s16(y),
                    s32(mem.read32(task + 0x60)), s32(mem.read32(task + 0x54)), s32(mem.read32(task + 0x58))));
            }
            host.callMethod(task, 0x38, []);
        }
        return;
    }
    const child = u32(mem.read32(cell));
    if (child === 0) {
        host.callMethod(task, 0x28, [3]);
        return;
    }
    if (s32(mem.read32(task + 0x5c)) === 0) {
        const [x, y] = dialogueAnchor(mem, host, task);
        host.callMethod(child, 0x68, [x, y]);
    }
}
