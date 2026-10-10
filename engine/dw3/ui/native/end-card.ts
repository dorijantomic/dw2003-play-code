// The END card: the 128x40 "END / DIGIMON WORLD 3" card the title overlay raises,
// fades up, holds, waits for the player, fades back out and hands the machine on.
// Translated bit-exactly from the title overlay pro/stdwtitl (asm
// ~/ddw3/asm/dw2003/pro/stdwtitl.s, overlay load base 0x80082CB0; file offsets
// below are relative to it):
//   F0x80082E9C  create root      (0x01EC-0x0214): F0x80014504(0x80082D70, 0x50, 4)
//   F0x80082D70  root callback    (0x00C0-0x01E8): display setup + the sequence object
//   F0x8008483C  create sequence  (0x1B8C-0x1BB4): F0x80014504(0x80084628, 0x54, 0)
//   F0x80084628  sequence callback(0x1978-0x1B88): the six-state sub-state table
//   F0x8008453C  draw             (0x188C-0x1974): language -> clip, one sprite draw
// Decoded reference: docs/research/ui/end-screen-decoded-2026-08-14.md and
// docs/research/ui/boot-gap-2026-09-02.md rows D1-D7. The extracted data the card
// reads ships as web/assets/data/stdwtitl_ui.json (`end_screen`) and the screen
// pack web/assets/ui/endall_sheet.{png,json}.
//
// Oracle: tests/lane-b/end-card.test.js runs the four originals through
// engine/native on resident.bin + pro_stdwtitl.bin and compares every call and
// memory word, with the shared resident services supplied on BOTH sides by the
// existing translated ones (TranslatedTaskTree for the task factory and its four
// state methods, resetDisplayService / setDisplayPacketIndex / setDisplayRegion /
// registerDisplayView for the display setup, setRectColour for the view colour,
// and ShopDrawIntents for the 2-D draw context).
//
// Screen root (0x50 bytes, 4 extra): the base task object's state word at +0x0C.
// The setup runs on every frame whose state is <= 0 or >= 4, so it happens exactly
// once (the object starts at state 0 and +0x38 advances it to 1).
// Sequence object (0x54 bytes, no extra): +0x0C task state (0 on create, raised to
// 1 by its own +0x38 on the first callback), +0x10 sub-state, +0x50 the CLUT level
// (s16), +0x52 the timer (s16). Both halfwords are written with `sh`, so the
// guards below read them signed exactly as the original does.
//
// Frame callback (task state, signed):
//   <= 0, >= 4  the entry frame: +0x38, level = 15, timer = 0, stop every sound,
//               and return WITHOUT drawing.
//   2, 3        nothing: the card parks here (state 3 is what the last callback
//               leaves behind, so the scheduler retires it).
//   1          the six sub-states, gated by `sltiu 6` on +0x10 with the jump table
//               at overlay +0x20 (sub-state 0 and every sub-state >= 6 share the
//               default body at 0x800846C4):
//     0 / >= 6  fade in: one step per callback (timer >= 2 -> timer -= 2,
//               level -= 1); at level 0, +0x2C(1) and timer = 0
//     1         hold until timer >= 0x78, then +0x3C and timer = 0
//     2         while logical button 3 (the pad's Start bit) is HELD, timer jumps
//               to 0x4650; then hold until timer >= 0x4650, +0x3C, timer = 0
//     3         fade out: timer >= 2 -> timer -= 2, level += 1; at (s16)level
//               >= 0xF, +0x3C and timer = 0
//     4         hold until timer >= 0x3C, then +0x3C and timer = 0
//     5         [0x8004B440](0xE01, 0) — the first opening movie — then
//               +0x28(3): the card is done and the screen takes over
//     Common tail (overlay 0x1B50): timer += the frame delta [0x8004DF9C](), then
//     the draw. Each step is ONE level per callback, never a catch-up loop, so a
//     frame delta above 2 must not advance the card twice.
//
// Host boundaries: the task factory F0x80014504 and the four object methods
// (+0x28/+0x2C/+0x38/+0x3C, the shared screen-lifecycle family in
// exe-decomp/c/F0x800143dc.c), the display service object D0x8004DE10's +0x150,
// +0x154, +0x174 and +0x16C, the multi-line layout context F0x8001FFA8 (slots
// +0x24 and +0x2C; UI-TEXTCTX-FFA8-001), the view's rectangle-colour slot +0x12C,
// the pack resolver [0x80044F5C], the 2-D draw context F0x8001F648 (slots +0x74,
// +0x7C, +0x84, +0x88; UI-DRAWCTX-SLOTS-002), the frame delta [0x8004DF9C], the
// pad service D0x8004B7D0 (+0x3F4 the port word, +0x408 the logical-button bit),
// the stop-everything sound entry D0x80055C64 and the screen launcher
// [0x8004B440].

import { resetDisplayService, setDisplayPacketIndex, setDisplayRegion, registerDisplayView,
    type DisplayRegionHost, type DisplayViewHost } from "../../display-service.ts";
import { setRectColour } from "../../display-view.ts";

export const END_CARD_CREATE = 0x80082e9c;
export const END_CARD_ROOT_TICK = 0x80082d70;
export const END_CARD_SEQUENCE_CREATE = 0x8008483c;
export const END_CARD_SEQUENCE_TICK = 0x80084628;
export const END_CARD_DRAW = 0x8008453c;

/** The screen root's allocation (F0x80014504): size, extra block, scheduler key. */
export const END_CARD_ROOT_SIZE = 0x50;
export const END_CARD_ROOT_EXTRA = 4;
/**
 * F0x80014504 loads `$a3` with zero in its own `jal` delay slot
 * (exe/asm fns.s: F0x80014504, `.L0x80014510: move_ $a3, $zr`), so the scheduler
 * key is 0 for both of the card's objects however many arguments the caller
 * passes. F0x800143DC registers an object with D0x8004B7B4 only when that key
 * is non-zero, so neither is scheduled: the title overlay's dispatcher hands
 * both to the resident screen framework, which calls the root's +0x48 with its
 * extra block and then the child's.
 */
export const END_CARD_ROOT_KEY = 0;
/** The sequence object's allocation: no extra block, so the framework never
 *  passes it one, and no scheduler key. */
export const END_CARD_SEQUENCE_SIZE = 0x54;
export const END_CARD_SEQUENCE_EXTRA = 0;
export const END_CARD_SEQUENCE_KEY = 0;
/** The extra slot the root callback stores the sequence object in. */
export const END_CARD_SEQUENCE_SLOT = 0;

/** The dispatch word and the sub-state word of both objects. */
export const END_CARD_STATE = 0x0c;
export const END_CARD_SUB = 0x10;
/** The CLUT level and the timer, both s16 halfwords. */
export const END_CARD_LEVEL = 0x50;
export const END_CARD_TIMER = 0x52;

/** The fade: one level per callback, and the two ends of the ramp. */
export const END_CARD_LEVEL_MIN = 0x0;
export const END_CARD_LEVEL_MAX = 0x0f;
export const END_CARD_FADE_TICKS = 2;
/** The three holds. */
export const END_CARD_HOLD_AFTER_FADE_IN = 0x78;
export const END_CARD_WAIT_FOR_PLAYER = 0x4650;
export const END_CARD_HOLD_AFTER_FADE_OUT = 0x3c;
/** The logical button whose held bit ends the wait (the pad's Start bit). */
export const END_CARD_SKIP_BUTTON = 3;
/** The first opening movie the last sub-state asks the launcher for. */
export const END_CARD_LAUNCH = 0xe01;

/** The display setup the root's own callback performs. */
export const END_CARD_PACKET_SIZE = 0xa000;
export const END_CARD_REGION_W = 0x140;
export const END_CARD_REGION_H = 0xf0;
/** The view descriptor 0x80087C4C: four s16 (0, 0, 320, 240). */
export const END_CARD_RECT = 0x80087c4c;
export const END_CARD_VIEW_POOL = 2;
export const END_CARD_VIEW_HANDLE = 0x100;
/** The colour the card asks its view for, where ordinary menus ask for none. */
export const END_CARD_VIEW_COLOUR = 0x1f;
/** The two handles of the end__all archive: the texture half and the sprite half. */
export const END_CARD_TEXTURE_HANDLE = 0x08a60001;
export const END_CARD_SPRITE_HANDLE = 0x08a60000;
/** The layout pair the root hands the texture context (+0x24). */
export const END_CARD_PAIR_X = 0x280;
export const END_CARD_PAIR_Y = 0;
/** The depth bucket (+0x7C) and the origin (+0x74) the draw writes. */
export const END_CARD_DRAW_BUCKET_TARGET = 0x100;
export const END_CARD_DRAW_BUCKET = 1;
export const END_CARD_DRAW_ORIGIN_X = 0x280;
export const END_CARD_DRAW_ORIGIN_Y = 0;

/** [0x8005CCA8]: the language the draw dispatches on. */
export const END_CARD_LANGUAGE = 0x8005cca8;
/** [0x8004DF9C](): the frame delta the timer accumulates. */
export const END_CARD_FRAME_DELTA = 0x8004df9c;
/** D0x80055C64: stop every sound (F0x80020204). */
export const END_CARD_STOP_SOUND = 0x80055c64;
/** [0x8004B440]: the resident screen launcher. */
export const END_CARD_LAUNCHER = 0x8004b440;

/**
 * The language dispatch of the draw, read from the overlay's seven-word table at
 * file offset 0 (0x80082CB0, stdwtitl.s L6-L1C). Each word is the address of a
 * four-instruction body that only stores a clip index into s0:
 *
 *   language  0    1    2    3    4    5    6    >= 7
 *   body       A    A    A    B    C    D    B    (gate `sltiu 0x7` fails)
 *   clip       0    0    0    2    3    1    2    0   (s0 starts at 0)
 *
 * with A = 0x80084584, B = 0x8008458C, C = 0x80084594, D = 0x8008459C. The out-of-
 * range case keeps the s0 the draw started with. The four pictures read END /
 * Ende / Fin / Fine, so this is the four-language table the pack shipped.
 */
export const END_CARD_CLIP_BY_LANGUAGE: readonly number[] = [0, 0, 0, 2, 3, 1, 2];

/** The clip a language byte takes. Anything the `sltiu 0x7` gate rejects keeps 0. */
export function endCardClipForLanguage(language: number): number {
    const word = language >>> 0;
    if (word >= END_CARD_CLIP_BY_LANGUAGE.length) return 0;
    return END_CARD_CLIP_BY_LANGUAGE[word]!;
}

export interface EndCardMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface EndCardHost extends DisplayViewHost, DisplayRegionHost {
    /** target.method[slot](target, ...args). */
    callMethod(target: number, slot: number, args: number[]): number;
    /** F0x80014504(handler, size, extra, key): allocate and schedule a task object. */
    createTask(handler: number, size: number, extra: number, key: number): number;
    /** The caller's own 0x34-byte multi-line layout context (its stack local). */
    layoutBuffer(): number;
    /** The caller's own DRAWENV scratch (its stack local). */
    drawEnvScratch(): number;
    /** F0x8001FFA8: build the layout context and set its +0x24 pair. */
    layoutContext(ctx: number, pairX: number, pairY: number): void;
    /** The layout context's +0x2C: lay a pack's records out (F0x8001FE38). */
    layoutPackTexture(ctx: number, pack: number): void;
    /** [0x80044F5C](handle): resolve a pack handle. */
    resolvePack(handle: number): number;
    /** F0x8001F648: build the 2-D draw context; the address it returns is the ctx. */
    drawInit(): number;
    /** ctx.slot[off](ctx, ...args), the 2-D draw context's own method table. */
    drawCall(ctx: number, slot: number, args: number[]): void;
    /** [0x8004DF9C](): the frame delta. */
    frameDelta(): number;
    /** D0x8004B7D0+0x3F4(port): the pad's held word. */
    padRead(port: number): number;
    /** D0x8004B7D0+0x408(port, code): the bit a logical button code occupies. */
    padBit(port: number, code: number): number;
    /** D0x80055C64: stop every sound. */
    stopAllSound(): void;
    /** [0x8004B440](code, 0): ask the resident launcher for a screen. */
    launchScreen(code: number, arg: number): void;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

/** F0x80082E9C(): the screen root. F0x80014504(0x80082D70, 0x50, 4), scheduler key 0. */
export function endCardCreate(host: EndCardHost): number {
    return u32(host.createTask(
        END_CARD_ROOT_TICK, END_CARD_ROOT_SIZE, END_CARD_ROOT_EXTRA, END_CARD_ROOT_KEY,
    ));
}

/** F0x8008483C(): the sequence object. F0x80014504(0x80084628, 0x54, 0), key 0. */
export function endCardSequenceCreate(host: EndCardHost): number {
    return u32(host.createTask(
        END_CARD_SEQUENCE_TICK, END_CARD_SEQUENCE_SIZE, END_CARD_SEQUENCE_EXTRA, END_CARD_SEQUENCE_KEY,
    ));
}

/**
 * F0x80082D70(obj, extra): the screen root's own callback. It builds the whole
 * display arrangement the card draws into — the service reset, the packet budget,
 * the 320x240 region, the pack's texture layout, the display view and the view's
 * rectangle colour — then creates the sequence object, stores it in the caller's
 * extra slot and advances its own state. States 1, 2 and 3 do nothing, so the
 * setup runs once.
 */
export function endCardRootTick(mem: EndCardMemory, host: EndCardHost, obj: number, extra: number): void {
    const state = s32(mem.read32(obj + END_CARD_STATE));
    if (state >= 1 && state <= 3) return;
    resetDisplayService(mem, host);
    setDisplayPacketIndex(mem, host, END_CARD_PACKET_SIZE);
    setDisplayRegion(mem, host, END_CARD_REGION_W, END_CARD_REGION_H, 0, 0);
    const ctx = u32(host.layoutBuffer());
    host.layoutContext(ctx, END_CARD_PAIR_X, END_CARD_PAIR_Y);
    host.layoutPackTexture(ctx, host.resolvePack(END_CARD_TEXTURE_HANDLE));
    const view = registerDisplayView(
        mem, host, u32(host.drawEnvScratch()), END_CARD_RECT, END_CARD_VIEW_POOL, END_CARD_VIEW_HANDLE,
    ) | 0;
    setRectColour(mem, view, END_CARD_VIEW_COLOUR, END_CARD_VIEW_COLOUR, END_CARD_VIEW_COLOUR);
    mem.write32(extra + END_CARD_SEQUENCE_SLOT, endCardSequenceCreate(host));
    host.callMethod(u32(obj), 0x38, []);
}

/** F0x80084628(obj): one callback of the card's six-state sequence. */
export function endCardTick(mem: EndCardMemory, host: EndCardHost, obj: number): void {
    const state = s32(mem.read32(obj + END_CARD_STATE));
    if (state === 1) {
        endCardSequence(mem, host, obj);
        endCardTail(mem, host, obj);
        return;
    }
    if (state === 2 || state === 3) return;
    // The entry frame: raise the state, hide the card and silence the machine.
    host.callMethod(u32(obj), 0x38, []);
    mem.write16(obj + END_CARD_LEVEL, END_CARD_LEVEL_MAX);
    mem.write16(obj + END_CARD_TIMER, 0);
    host.stopAllSound();
}

/** Overlay 0x1B50: timer += frame delta, then the card's own draw. */
function endCardTail(mem: EndCardMemory, host: EndCardHost, obj: number): void {
    mem.write16(obj + END_CARD_TIMER,
        u32(mem.read16(obj + END_CARD_TIMER) + host.frameDelta()) & 0xffff);
    endCardDraw(mem, host, obj);
}

/** The sub-state table, its common `block_16` arm and its shared fall-through. */
function endCardSequence(mem: EndCardMemory, host: EndCardHost, obj: number): void {
    const sub = u32(mem.read32(obj + END_CARD_SUB));
    const call = (slot: number, args: number[] = []): number => host.callMethod(u32(obj), slot, args);
    // The `block_16` arm: a reached threshold advances the sub-state and clears
    // the timer; otherwise the sub-state does nothing this callback.
    const threshold = (reached: boolean): void => {
        if (!reached) return;
        call(0x3c);
        mem.write16(obj + END_CARD_TIMER, 0);
    };
    // `slti 0x2` on the signed timer: one level per callback, no catch-up.
    const fadeTick = (): boolean => s16(mem.read16(obj + END_CARD_TIMER)) < END_CARD_FADE_TICKS;
    switch (sub < 6 ? sub : 0) {
        case 0: {
            if (fadeTick()) break;
            mem.write16(obj + END_CARD_TIMER, (u32(mem.read16(obj + END_CARD_TIMER)) - END_CARD_FADE_TICKS) & 0xffff);
            const level = (u32(mem.read16(obj + END_CARD_LEVEL)) - 1) & 0xffff;
            mem.write16(obj + END_CARD_LEVEL, level);
            // The guard is `sll $v0, 0x10` + `bgtz` on the (u16) level
            // (stdwtitl.s L0x1A38-L0x1A40): it asks whether the sign-extended
            // level is POSITIVE, so level 0 and every level above 0x7FFF (the
            // underflow the walk can reach) raise the hold, and only 0x0001..0x7FFF
            // keeps fading.
            if (((level << 16) | 0) <= 0) {
                call(0x2c, [1]);
                mem.write16(obj + END_CARD_TIMER, 0);
            }
            break;
        }
        case 1:
            threshold(s16(mem.read16(obj + END_CARD_TIMER)) >= END_CARD_HOLD_AFTER_FADE_IN);
            break;
        case 2: {
            // The pad's held word first, then the bit its logical button code
            // occupies (stdwtitl.s L0x1A78-L0x1AA4: `lw $v0, 0x3f4($s0)` runs
            // before `lw $v1, 0x408($s0)`, and the test is `srav` + `andi 1`).
            const word = host.padRead(0) >>> 0;
            const bit = host.padBit(0, END_CARD_SKIP_BUTTON) | 0;
            if (((word >>> bit) & 1) !== 0) mem.write16(obj + END_CARD_TIMER, END_CARD_WAIT_FOR_PLAYER);
            threshold(s16(mem.read16(obj + END_CARD_TIMER)) >= END_CARD_WAIT_FOR_PLAYER);
            break;
        }
        case 3: {
            if (fadeTick()) break;
            mem.write16(obj + END_CARD_TIMER, (u32(mem.read16(obj + END_CARD_TIMER)) - END_CARD_FADE_TICKS) & 0xffff);
            const level = (u32(mem.read16(obj + END_CARD_LEVEL)) + 1) & 0xffff;
            mem.write16(obj + END_CARD_LEVEL, level);
            threshold(s16(level) >= END_CARD_LEVEL_MAX);
            break;
        }
        case 4:
            threshold(s16(mem.read16(obj + END_CARD_TIMER)) >= END_CARD_HOLD_AFTER_FADE_OUT);
            break;
        default: // 5
            host.launchScreen(END_CARD_LAUNCH, 0);
            call(0x28, [3]);
            break;
    }
}

/**
 * F0x8008453C(obj): the card's per-frame draw. The picture service's context is
 * rebuilt on the caller's stack, the depth bucket and origin are set, the CLUT row
 * offset is the card's level, and the sprite call resolves the end__all archive
 * and draws one of the four pictures at (0, 0) — the clip's own layer offset
 * carries the position.
 */
export function endCardDraw(mem: EndCardMemory, host: EndCardHost, obj: number): void {
    const clip = endCardClipForLanguage(mem.read32(END_CARD_LANGUAGE));
    const ctx = u32(host.drawInit());
    host.drawCall(ctx, 0x7c, [END_CARD_DRAW_BUCKET_TARGET, END_CARD_DRAW_BUCKET]);
    host.drawCall(ctx, 0x74, [END_CARD_DRAW_ORIGIN_X, END_CARD_DRAW_ORIGIN_Y]);
    host.drawCall(ctx, 0x88, [s16(mem.read16(obj + END_CARD_LEVEL))]);
    host.drawCall(ctx, 0x84, [host.resolvePack(END_CARD_SPRITE_HANDLE), clip, 0, 0]);
}