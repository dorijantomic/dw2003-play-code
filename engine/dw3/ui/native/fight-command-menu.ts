// The battle command menu's actor, menu model and draw, translated bit-exactly
// from the original pro/fightstg bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/fight-command-menu.test.js runs the original through
// engine/native and compares the ordered calls and fields.
//
//   F0x80093F9C commandMenuActorConstruct  build the 0x58+0x1C actor, wiring the
//                                          output slot to the caller.
//   F0x80093E44 commandMenuActorTick       the root tick: state 0 builds the menu
//                                          and the party name list; state 1
//                                          confirms the selection on the pad.
//   F0x80093CF4 commandMenuBuildNames      build the six party name widgets.
//   F0x8009B0C8 commandMenuCreate          build the 0xA8 menu from a config table.
//   F0x8009AF4C commandMenuStateMachine    the menu state machine (open, draw,
//                                          up/down selection, close).
//   F0x8009ADD4 commandMenuDraw            draw the menu rows with the sliding
//                                          highlight.
//   F0x8009AB74 jokeMenuActorConstruct     build the joke-list owner (tick
//                                          0x8009a898), which the sequencer's
//                                          sub-state 3 spawns instead.
//   FIGHTSTG_F0x8009A2DC jokeMenuBuildNames build that owner's six joke rows.
//   F0x8009A898 jokeMenuActorTick          open the same widget on the joke
//                                          config and confirm the chosen row.
//
// Every resident service, context, text-element constructor and object method is
// a host boundary; the port preserves the exact call order, guards and
// arithmetic. This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

import { PAD_BLOCK, PAD_CELL_PRESSED, PAD_CELL_REPEAT } from "../../../systems/pad-block.ts";

/** The actor object handler and geometry (the factory's F0x80014504 arguments). */
export const COMMAND_ACTOR_HANDLER = 0x80093e44;
export const COMMAND_ACTOR_SIZE = 0x58;
export const COMMAND_ACTOR_EXTRA = 0x1c;
/** The menu object handler and size. */
export const COMMAND_MENU_HANDLER = 0x8009af4c;
export const COMMAND_MENU_SIZE = 0xa8;
/** The menu's config table and the name-list resource bank. */
export const COMMAND_CONFIG = 0x800a34cc;
export const COMMAND_STRING_BASE = 0x8005cca8;
export const COMMAND_NAME_BANK = 0x7f;
/**
 * The joke list a confused acting Digimon is shown. It is not a second widget:
 * sequencer sub-state 3 (:16358-:16395) spawns a different owner
 * (FIGHTSTG_F0x8009AB74, tick 0x8009a898) which hands the SAME factory F0x8009B0C8
 * its own eight-word config (fightstg.s:24619-24620). The disc carries those eight
 * words identical to COMMAND_CONFIG's (fightstg.s:33919-33934 vs :34009-34019), so
 * the joke rows' icon, text anchors and marker land exactly where the command rows'
 * do; what differs is the row labels (0x6B + the shuffled joke index) and the
 * confirm, which the joke owner runs itself.
 */
export const COMMAND_JOKE_CONFIG = 0x800a3634;
/** The eight-entry table the joke owner shuffles in place; row label = entry + 0x6B. */
export const COMMAND_JOKE_PERM = 0x800a3624;
export const JOKE_LABEL_BASE = 0x6b;
export const JOKE_ROWS = 6;
/** The joke owner: F0x8009AB74 allocates tick 0x8009a898, size 0xc4, child array 0x1c. */
export const JOKE_ACTOR_HANDLER = 0x8009a898;
export const JOKE_ACTOR_SIZE = 0xc4;
export const JOKE_ACTOR_EXTRA = 0x1c;
/**
 * The battle workspace: [+0x08] is the active party slot and the party
 * combatant records start at +0x10, 0x20 bytes each. Both the name build
 * (fightstg.s L0x80093da0..0x80093db8: base + 0x10 + idx*0x20, then lbu +0x1c)
 * and the confirm gate (L0x80093eec..0x80093f04: base + idx*0x20, lbu +0x2c)
 * read the same byte: the active member's ailment bits (record +0x1c).
 */
export const COMMAND_FLAGS_BASE = 0x800a4460;
export const COMMAND_FLAGS_INDEX = 0x800a4468;
export const COMMAND_FLAGS_DRAW_SLOT = 0x2c;
export const COMMAND_FLAGS_CONFIRM_SLOT = 0x2c;
export const COMMAND_FLAG_NAME_A = 0x08;
export const COMMAND_FLAG_NAME_B = 0x20;
/** The current-update object the state machine repoints. */
export const COMMAND_TIME_OBJECT = 0x8004de10;
export const COMMAND_MENU_UPDATE = 0x8009abd8;
/** The pad and sound boundaries. */
export const COMMAND_PAD_READ_A = PAD_BLOCK + PAD_CELL_PRESSED;
export const COMMAND_PAD_READ_B = PAD_BLOCK + PAD_CELL_REPEAT;
export const COMMAND_CONFIRM_SOUND = 0x4001c;
export const COMMAND_MOVE_SOUND = 0x4001b;
/** The two draw packs and the row geometry. */
export const COMMAND_PACK_SELECT = 0x04550000;
export const COMMAND_ROW_X = 0x800;
export const COMMAND_FRAME_MAX = 0x14;

export interface CommandMenuMemory {
    read8(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** The joke owner reads its row labels as halfwords out of the overlay data. */
export interface CommandMenuMemory16 extends CommandMenuMemory {
    read16(addr: number): number;
}

export interface CommandMenuHost {
    /** F0x80014504(cb, size, extra): allocate the actor. */
    allocateActor(): number;
    /** F0x80014504(cb, size, extra): allocate the joke owner (a different tick). */
    allocateJokeActor(): number;
    /** F0x80014504(cb, size, 0): allocate the menu. */
    allocateMenu(): number;
    /** F0x8001AE38(target, kind, x, y): build a text widget. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** [0x80044F4C](id): the resource/name bank base. */
    resourceBase(id: number): number;
    /** [0x80044F5C](handle): resolve a pack handle to its pointer. */
    packResolve(handle: number): number;
    /** [0x8004B7D0+0x3F4](port), which is also the [0x8004BBC4] confirm word. */
    padReadA(port: number): number;
    /** [0x8004B7D0+0x3FC](port): the alternate pad word. */
    padReadB(port: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** [0x8004DE10+0x18C](): the frame delta the highlight uses. */
    frameDelta(): number;
    /** F0x8001F648(): build the stack draw context. */
    initDrawContext(): void;
    /** ctx+0x7C(x, y): set the draw layer. */
    setLayer(x: number, y: number): void;
    /** ctx+0x74(x, y): set the draw origin. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x88(n): set the palette row. */
    setPaletteRow(n: number): void;
    /** ctx+0x84(pack, id, x, y): draw a sprite. */
    drawSprite(pack: number, id: number, x: number, y: number): void;
    /** target+slot(a1, a2): an object method. */
    callMethod(target: number, slot: number, args: number[]): void;
}

/** F0x80093F9C(arg0, arg1): build the command-menu actor. */
export function commandMenuActorConstruct(
    mem: CommandMenuMemory,
    arg0: number,
    arg1: number,
    host: CommandMenuHost,
): number {
    const obj = host.allocateActor();
    mem.write32(obj + 0x54, arg1);
    mem.write32(arg1, 0xffffffff);
    mem.write32(obj + 0x50, arg0);
    return obj;
}

/** F0x8009B0C8(config): build the menu model from the config table. */
export function commandMenuCreate(
    mem: CommandMenuMemory,
    config: number,
    host: CommandMenuHost,
): number {
    const menu = host.allocateMenu();
    for (let i = 0; i < 8; i++) {
        mem.write32(menu + 0x58 + i * 4, mem.read32(config + i * 4) | 0);
    }
    return menu;
}

/** F0x80093CF4(obj): build the six party name widgets. */
export function commandMenuBuildNames(
    mem: CommandMenuMemory,
    obj: number,
    host: CommandMenuHost,
): void {
    const list = mem.read32(obj + 0x24) | 0;
    if ((mem.read32(list + 0x4) | 0) !== 0) return;
    const res = host.resourceBase((mem.read32(COMMAND_STRING_BASE) + COMMAND_NAME_BANK) | 0);
    for (let i = 0; i < 6; i++) {
        const y = s16((i * 0x13 + 0x6d) | 0);
        const widget = host.createTextElement(0x1005, 1, 0x24, y);
        mem.write32(list + 0x4 + i * 4, widget);
        host.callMethod(widget, 0x114, [res, (i + 1) | 0]);
    }
    const flags = mem.read8(COMMAND_FLAGS_BASE + ((mem.read32(COMMAND_FLAGS_INDEX) | 0) << 5) + COMMAND_FLAGS_DRAW_SLOT);
    if ((flags & COMMAND_FLAG_NAME_A) !== 0) {
        for (let i = 0; i < 3; i++) host.callMethod(mem.read32(list + 0x4 + i * 4) | 0, 0x138, [7]);
    }
    if ((flags & COMMAND_FLAG_NAME_B) !== 0) {
        host.callMethod(mem.read32(list + 0x0c) | 0, 0x138, [7]);
    }
}

/** F0x8009AB74(out, siblingA, siblingB): build the joke-list owner object. */
export function jokeMenuActorConstruct(
    mem: CommandMenuMemory,
    out: number,
    siblingA: number,
    siblingB: number,
    host: CommandMenuHost,
): number {
    const obj = host.allocateJokeActor();
    mem.write32(obj + 0x58, out);
    mem.write32(out, 0xffffffff);
    mem.write32(obj + 0x50, 0);   // the joke list always opens on its first row
    mem.write32(obj + 0x5c, siblingA);
    mem.write32(obj + 0x60, siblingB);
    return obj;
}

/**
 * FIGHTSTG_F0x8009A2DC(obj): the joke owner's six row text boxes.
 *
 * Same geometry as commandMenuBuildNames -- six widgets at x 0x24 (`li $a2, 0x24`,
 * fightstg.s:24244) and y 0x6d + 0x13*i (`lui $s1, 0x6d` at :24231, then
 * `lui $v0, 0x13` / `addu $s1, $v0` at :24258-24259) -- but the label is the
 * shuffled table's halfword plus 0x6b, added in the delay slot of the +0x114 call
 * (:24254, :24257), and there is NO ailment gate: the +0x138(7) grey calls
 * commandMenuBuildNames makes are absent, so no joke row is ever dimmed.
 */
export function jokeMenuBuildNames(
    mem: CommandMenuMemory16,
    obj: number,
    host: CommandMenuHost,
): void {
    const list = mem.read32(obj + 0x24) | 0;
    if ((mem.read32(list + 0x4) | 0) !== 0) return;
    const res = host.resourceBase((mem.read32(COMMAND_STRING_BASE) + COMMAND_NAME_BANK) | 0);
    for (let i = 0; i < JOKE_ROWS; i++) {
        const y = s16((i * 0x13 + 0x6d) | 0);
        const widget = host.createTextElement(0x1005, 1, 0x24, y);
        mem.write32(list + 0x4 + i * 4, widget);
        host.callMethod(widget, 0x114, [res, s16(mem.read16(COMMAND_JOKE_PERM + i * 2) + JOKE_LABEL_BASE)]);
    }
}

/**
 * F0x8009A898(obj, arg1): the joke-list owner tick.
 *
 * State 0 builds the menu from COMMAND_JOKE_CONFIG and the six rows, then advances
 * (fightstg.s:24618-24658). The eight-draw shuffle the original runs between the two
 * (:24630-24649) is data the caller owns: it writes the shuffled table to
 * COMMAND_JOKE_PERM, exactly where the original leaves it.
 *
 * State 1 reads the Circle press edge (:24667-24673), plays the confirm sound
 * (0x0004001C from `lui 0x4` + `ori 0x1c`, :24677-24679) and keeps the chosen row
 * at +0x54 (:24696-24700), then closes the menu, writes 1 into the menu's result
 * cell and closes the owner (:24717-24730). The original rolls
 * F0x800A1910 first and branches: on 0 it writes 0 to the result cell and closes
 * (:24685-24695), on nonzero it also builds the six flavour-line boxes
 * (:24701-24716). Neither is ported here: the threshold, the sequencer's result
 * mapping (0 to Attack, nonzero to the gag) and the pose icon F0x8009A3B4 /
 * reveal F0x8009A514 (state 2) belong to the caller, which rolls and turns the
 * result into the attack or the gag line. This port always takes the nonzero
 * branch's shape, because the caller is what decides which of the two it was.
 */
export function jokeMenuActorTick(
    mem: CommandMenuMemory16,
    obj: number,
    arg1: number,
    host: CommandMenuHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        if ((mem.read32(obj + 0x10) | 0) !== 0) return;   // the reveal object's arm
        if (((host.padReadA(0) | 0) & 0x2000) === 0) return;
        host.playSound(COMMAND_CONFIRM_SOUND);
        const menu = mem.read32(arg1) | 0;
        mem.write32(obj + 0x54, mem.read32(menu + 0x50) | 0);
        host.callMethod(menu, 0x28, [3]);
        mem.write32(menu + 0x54, 1);
        host.callMethod(obj, 0x28, [3]);
        return;
    }
    if (state >= 2) return;
    const menu = commandMenuCreate(mem, COMMAND_JOKE_CONFIG, host);
    mem.write32(arg1, menu);
    mem.write32(menu + 0x50, mem.read32(obj + 0x50) | 0);
    jokeMenuBuildNames(mem, obj, host);
    host.callMethod(obj, 0x38, []);
}

/** F0x80093E44(obj, arg1): the command-menu actor tick. */
export function commandMenuActorTick(
    mem: CommandMenuMemory,
    obj: number,
    arg1: number,
    host: CommandMenuHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        if (((host.padReadA(0) | 0) & 0x2000) === 0) return;
        host.playSound(COMMAND_CONFIRM_SOUND);
        const flags = mem.read8(COMMAND_FLAGS_BASE + ((mem.read32(COMMAND_FLAGS_INDEX) | 0) << 5) + COMMAND_FLAGS_CONFIRM_SLOT);
        const menu = mem.read32(arg1) | 0;
        if ((flags & COMMAND_FLAG_NAME_A) !== 0) {
            if ((mem.read32(menu + 0x50) | 0) < 3) return;
        }
        if ((flags & COMMAND_FLAG_NAME_B) !== 0) {
            if ((mem.read32(menu + 0x50) | 0) === 2) return;
        }
        mem.write32(mem.read32(obj + 0x54) | 0, mem.read32(menu + 0x50) | 0);
        host.callMethod(obj, 0x28, [3]);
        mem.write32(menu + 0x54, 1);
        return;
    }
    if (state === 2 || state === 3) return;

    const menu = commandMenuCreate(mem, COMMAND_CONFIG, host);
    mem.write32(arg1, menu);
    mem.write32(menu + 0x50, mem.read32(obj + 0x50) | 0);
    commandMenuBuildNames(mem, obj, host);
    host.callMethod(obj, 0x38, []);
}

/** F0x8009AF4C(obj): the command-menu state machine. */
export function commandMenuStateMachine(
    mem: CommandMenuMemory,
    obj: number,
    host: CommandMenuHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        const sub = mem.read32(obj + 0x10) | 0;
        let block = false;
        let skip3C = false;
        if (sub === 2) block = true;
        else if (sub < 3) block = sub < 0;
        else if (sub === 3) skip3C = true;
        else block = true;
        if (block) {
            mem.write32(COMMAND_TIME_OBJECT, COMMAND_MENU_UPDATE);
            mem.write32(COMMAND_TIME_OBJECT + 4, obj);
        }
        if (!skip3C) host.callMethod(obj, 0x3c, []);
        if ((mem.read32(obj + 0x68) | 0) !== -1) commandMenuDraw(mem, obj, host);
        if ((mem.read32(obj + 0x54) | 0) !== 0) return;

        const pad = (host.padReadB(0) | host.padReadA(0)) | 0;
        if ((pad & 0x10) !== 0) {
            if ((mem.read32(obj + 0x50) | 0) === 0) return;
            mem.write32(obj + 0x50, (mem.read32(obj + 0x50) - 1) | 0);
            host.playSound(COMMAND_MOVE_SOUND);
            return;
        }
        if ((pad & 0x40) !== 0) {
            if (mem.read32(obj + 0x50) === ((mem.read32(obj + 0x58) - 1) | 0)) return;
            mem.write32(obj + 0x50, (mem.read32(obj + 0x50) + 1) | 0);
            host.playSound(COMMAND_MOVE_SOUND);
            return;
        }
        return;
    }
    if (state === 2) return;
    if (state === 3) {
        mem.write32(COMMAND_TIME_OBJECT, 0);
        return;
    }
    host.callMethod(obj, 0x38, []);
}

/** F0x8009ADD4(obj): draw the command menu rows. */
export function commandMenuDraw(
    mem: CommandMenuMemory,
    obj: number,
    host: CommandMenuHost,
): void {
    host.initDrawContext();
    host.setLayer(0x1005, 1);
    host.setOrigin(0x200, 0);
    const pack = host.packResolve(COMMAND_PACK_SELECT);
    const count = mem.read32(obj + 0x58) | 0;
    let y = mem.read32(obj + 0x70) | 0;
    if (count <= 0) return;
    for (let i = 0; i < count; i++) {
        const cell = obj + 0x80 + i * 4;
        const selected = (mem.read32(obj + 0x50) | 0) === i;
        let counter = mem.read32(cell) | 0;
        if (counter !== 0 || selected) {
            counter = (counter + host.frameDelta()) | 0;
            mem.write32(cell, counter);
            if (counter >= COMMAND_FRAME_MAX) {
                mem.write32(cell, selected ? (counter - COMMAND_FRAME_MAX) | 0 : 0);
            }
        }
        let frame = (mem.read32(cell) | 0) >> 2;
        if ((frame >>> 0) >= 5) frame = 0;
        host.setPaletteRow(frame);
        host.drawSprite(pack, mem.read32(obj + 0x68) | 0, mem.read32(obj + 0x6c) | 0, y);
        y = (y + (mem.read32(obj + 0x74) | 0)) | 0;
    }
}

/** The vsync blit's data: the source rectangle, the two-entry ordering table and its four move packets. */
export const COMMAND_BLIT_RECT = 0x800a3654;
export const COMMAND_BLIT_PRIMS = 0x800a4718;
export const COMMAND_BLIT_OT = 0x800a4778;
/** The source x of the idle tile (13th cell of the 12-pixel strip). */
export const COMMAND_BLIT_IDLE_X = 0x90;
export const COMMAND_BLIT_FRAMES = 0xc;

export interface CommandMenuBlitMemory extends CommandMenuMemory {
    read16(addr: number): number;
    write16(addr: number, value: number): void;
}

/** The libgpu calls F0x8009ABD8 makes; each is a resident routine or the GPU itself. */
export interface CommandMenuBlitHost {
    /** F0x80028D8C BreakDraw(): -1 when a non-chained GPU transfer is running. */
    breakDraw(): number;
    /** F0x80025C8C ClearOTag(ot, n). */
    clearOTag(ot: number, count: number): void;
    /** F0x8002918C SetDrawMove(packet, rect, x, y). */
    setDrawMove(packet: number, rect: number, x: number, y: number): void;
    /** F0x80028E20(0): 0 once the GPU is idle, else -1 (the caller polls). */
    drawSync(mode: number): number;
    /** F0x80028E80 ContinueDraw(ot, saved): start the chain. */
    continueDraw(ot: number, saved: number): void;
}

/**
 * F0x8009ABD8(menu): the callback the menu state machine installs at
 * [0x8004DE10] with the menu at [0x8004DE14]; the resident vsync handler
 * F0x8001D3F4 calls it once per vertical blank (fns.s L0x8001d470..0x8001d488).
 * It advances a 12-step counter at +0x7C, then queues two VRAM-to-VRAM moves
 * (one per display buffer, y and y + 0x100) of the 12x12 strip cell
 * x = counter*12 onto the selected row, and, when the selection changed since
 * the last blank (+0x78 != +0x50), two more moves of the idle cell x = 0x90
 * onto the previous row. The row origin is (+0x5C, +0x60 + row * +0x64).
 */
export function commandMenuVsyncBlit(
    mem: CommandMenuBlitMemory,
    menu: number,
    host: CommandMenuBlitHost,
): void {
    const saved = host.breakDraw() | 0;
    if (saved !== -1) {
        let counter = (mem.read32(menu + 0x7c) + 1) | 0;
        mem.write32(menu + 0x7c, counter);
        if (counter === COMMAND_BLIT_FRAMES) {
            mem.write32(menu + 0x7c, 0);
            counter = 0;
        }
        host.clearOTag(COMMAND_BLIT_OT, 2);
        let prim = COMMAND_BLIT_PRIMS;
        for (let pass = 0; pass < 4; pass += 2) {
            if (pass === 2 && (mem.read32(menu + 0x78) | 0) === (mem.read32(menu + 0x50) | 0)) break;
            let row: number;
            if (pass < 2) {
                mem.write16(COMMAND_BLIT_RECT, (((mem.read32(menu + 0x7c) | 0) * 12) & 0xffff));
                row = mem.read32(menu + 0x50) | 0;
            } else {
                mem.write16(COMMAND_BLIT_RECT, COMMAND_BLIT_IDLE_X);
                row = mem.read32(menu + 0x78) | 0;
            }
            const y = ((mem.read32(menu + 0x60) | 0) + Math.imul(row, mem.read32(menu + 0x64) | 0)) | 0;
            host.setDrawMove(prim, COMMAND_BLIT_RECT, mem.read32(menu + 0x5c) | 0, y);
            addPrim(mem, COMMAND_BLIT_OT, prim);
            host.setDrawMove(prim + 0x18, COMMAND_BLIT_RECT, mem.read32(menu + 0x5c) | 0, (y + 0x100) | 0);
            addPrim(mem, COMMAND_BLIT_OT, prim + 0x18);
            prim += 0x30;
        }
        while ((host.drawSync(0) | 0) !== 0) { /* the original polls until idle */ }
        host.continueDraw(COMMAND_BLIT_OT, saved);
    }
    mem.write32(menu + 0x78, mem.read32(menu + 0x50) | 0);
}

/** The inline AddPrim at fightstg.s L0x8009ad08..0x8009ad30. */
function addPrim(mem: CommandMenuMemory, ot: number, prim: number): void {
    mem.write32(prim, ((mem.read32(prim) & 0xff000000) | (mem.read32(ot) & 0xffffff)) >>> 0);
    mem.write32(ot, ((mem.read32(ot) & 0xff000000) | (prim & 0xffffff)) >>> 0);
}

function s16(value: number): number {
    return (value << 16) >> 16;
}
