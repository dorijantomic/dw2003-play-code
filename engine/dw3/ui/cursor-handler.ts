// The selection cursor's per-frame handler, translated from the resident EXE
// F0x8001B0A4 (installed at cursor +0x48 by F0x8001B364).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/cursor-handler-oracle.test.js runs the original through
// engine/native over frames 0..90 (init, the rest step, the four cycle steps and
// the wrap) and compares the whole cursor and child object plus the ordered call
// stream.
//
// DECODED: the accepted cursor-handler answer (2026-09-14), verified against
// exe-decomp/c/_asm/F0x8001b0a4.s. Claims: UI-CURSORCLASS-B364-001,
// UI-CURSOR-GLYPH-SEQUENCE-001, UI-WIDGETCLASS-AE38-CONSUMER-001,
// UI-WIDGETCLASS-AE38-READERS-001, UI-TASKOBJ-STATEMACHINE-001 (all
// partially_verified).
//
// The port moves no widget: the animation swaps the child's line-0 string
// between the five glyph strings in the table at 0x8004DCE0; position is only
// written by the dirty block.
//
//   F0x8001B0A4(self, block)   block = *(u32*)(self+0x24), child at block+0x0
//     state = self+0x0C
//       == 1 -> animation; == 2 or 3 -> return; else -> init
//     init: child = createTextElement((s16)+0x50, 1, (s16)+0x58, (s16)+0x5C)
//           when block+0x0 == 0; child+0x110(table[+0x6C]);
//           child+0x144((u8)+0x64); child+0x15C(+0x54); t = service();
//           self+0x70 = t; self+0x38(self)
//     anim: if +0x68 != 0: child+0x144((u8)+0x64); child+0x134((s16)+0x58,
//             (s16)+0x5C); child+0x138((u8)+0x60); +0x68 = 0
//           if +0x64 == 0 -> return
//           if +0x7C != 0: if +0x6C != 0 { +0x6C = 0; child+0x110(table[0]) }
//                          return
//           period = (+0x10 == 0) ? +0x74 : +0x78
//           if (service() - +0x70) / period == 0 -> return
//           t = service(); +0x70 = t
//           rest (+0x10 == 0): +0x6C = 1; child+0x110(table[1]); +0x10 = 1
//           cycle: +0x6C += 1; if +0x6C >= 5 { +0x6C = 0; +0x10 = 0 }
//                  child+0x110(table[+0x6C])
//
// The service is the resident tick counter F0x8001D6F4 (cell 0x8004DF98); it is
// called twice on a trigger frame (the decompiler prints one). The child calls
// reuse the translated setters; createTextElement is the translated ctor.

import {
    createTextElement,
    type CreateTextElementHost,
    type CreateTextElementMemory,
} from "./create-text-element.ts";
import {
    setWidgetString,
    type WidgetLineHost,
    type WidgetLineMemory,
} from "./text-widget-line.ts";
import {
    setTextElementFlagC1,
    setTextWidgetOrigin,
    set_unk_0x58_fns_8001a448,
    set_unk_0xc0_fns_8001a1f4,
    type TextElementMemory,
} from "./text-element-setters.ts";

export interface CursorHandlerMemory
    extends CreateTextElementMemory, WidgetLineMemory, TextElementMemory {}

export interface CursorHandlerHost extends CreateTextElementHost, WidgetLineHost {
    /** The resident tick counter (F0x8001D6F4). Called once per frame, twice per trigger. */
    service(): number;
    /** self+0x38: the host-served base advance method (F0x800142AC). */
    advanceState(self: number): void;
}

/** Object field offsets the handler reads or writes. */
export const CURSOR_HANDLER_FIELDS = {
    state: 0xc,
    phase: 0x10,
    block: 0x24,
    advance: 0x38,
    target: 0x50,
    order: 0x54,
    x: 0x58,
    y: 0x5c,
    colour: 0x60,
    visible: 0x64,
    dirty: 0x68,
    frame: 0x6c,
    stamp: 0x70,
    restTicks: 0x74,
    cycleTicks: 0x78,
    frozen: 0x7c,
} as const;
/** The five glyph-string table words at 0x8004DCE0. */
export const GLYPH_TABLE = 0x8004dce0;
export const GLYPH_COUNT = 5;
/** Child widget slots the handler calls. */
export const CHILD_SLOT = {
    string: 0x110,
    origin: 0x134,
    colour: 0x138,
    visible: 0x144,
    order: 0x15c,
} as const;

function s16(value: number): number {
    return (value << 16) >> 16;
}

function pushGlyph(
    mem: CursorHandlerMemory,
    host: CursorHandlerHost,
    child: number,
    idx: number,
): void {
    const ptr = mem.read32((GLYPH_TABLE + Math.imul(idx, 4)) >>> 0) >>> 0;
    setWidgetString(mem, host, child, ptr);
}

/** F0x8001B0A4(self, block): the cursor's per-frame update. */
export function cursorHandler(
    mem: CursorHandlerMemory,
    host: CursorHandlerHost,
    self: number,
    block: number,
): void {
    const state = mem.read32(self + CURSOR_HANDLER_FIELDS.state) | 0;

    if (state > 1 && state < 4) return; // states 2 and 3

    if (state !== 1) {
        let child = mem.read32(block) >>> 0;
        if (child === 0) {
            child = createTextElement(
                mem,
                host,
                s16(mem.read16(self + CURSOR_HANDLER_FIELDS.target)),
                1,
                s16(mem.read16(self + CURSOR_HANDLER_FIELDS.x)),
                s16(mem.read16(self + CURSOR_HANDLER_FIELDS.y)),
            ) >>> 0;
            mem.write32(block, child);
        }
        pushGlyph(mem, host, child, mem.read32(self + CURSOR_HANDLER_FIELDS.frame) | 0);
        setTextElementFlagC1(mem, child, mem.read8(self + CURSOR_HANDLER_FIELDS.visible));
        set_unk_0x58_fns_8001a448(mem, child, mem.read32(self + CURSOR_HANDLER_FIELDS.order) | 0);
        const t = host.service() | 0;
        mem.write32(self + CURSOR_HANDLER_FIELDS.stamp, t);
        host.advanceState(self);
        return;
    }

    const child = mem.read32(block) >>> 0;

    if ((mem.read32(self + CURSOR_HANDLER_FIELDS.dirty) | 0) !== 0) {
        setTextElementFlagC1(mem, child, mem.read8(self + CURSOR_HANDLER_FIELDS.visible));
        setTextWidgetOrigin(
            mem,
            child,
            s16(mem.read16(self + CURSOR_HANDLER_FIELDS.x)),
            s16(mem.read16(self + CURSOR_HANDLER_FIELDS.y)),
        );
        set_unk_0xc0_fns_8001a1f4(mem, child, mem.read8(self + CURSOR_HANDLER_FIELDS.colour));
        mem.write32(self + CURSOR_HANDLER_FIELDS.dirty, 0);
    }

    if ((mem.read32(self + CURSOR_HANDLER_FIELDS.visible) | 0) === 0) return;

    if ((mem.read32(self + CURSOR_HANDLER_FIELDS.frozen) | 0) !== 0) {
        if ((mem.read32(self + CURSOR_HANDLER_FIELDS.frame) | 0) !== 0) {
            mem.write32(self + CURSOR_HANDLER_FIELDS.frame, 0);
            pushGlyph(mem, host, child, 0);
        }
        return;
    }

    const rest = (mem.read32(self + CURSOR_HANDLER_FIELDS.phase) | 0) === 0;
    const period = mem.read32(
        self + (rest ? CURSOR_HANDLER_FIELDS.restTicks : CURSOR_HANDLER_FIELDS.cycleTicks),
    ) | 0;
    const elapsed = (host.service() | 0) - (mem.read32(self + CURSOR_HANDLER_FIELDS.stamp) | 0);
    if (Math.trunc(elapsed / period) === 0) return;

    const t = host.service() | 0;
    mem.write32(self + CURSOR_HANDLER_FIELDS.stamp, t);

    if (rest) {
        mem.write32(self + CURSOR_HANDLER_FIELDS.frame, 1);
        pushGlyph(mem, host, child, 1);
        mem.write32(self + CURSOR_HANDLER_FIELDS.phase, 1);
        return;
    }

    let idx = (mem.read32(self + CURSOR_HANDLER_FIELDS.frame) | 0) + 1;
    mem.write32(self + CURSOR_HANDLER_FIELDS.frame, idx);
    if (!(idx < GLYPH_COUNT)) {
        idx = 0;
        mem.write32(self + CURSOR_HANDLER_FIELDS.frame, 0);
        mem.write32(self + CURSOR_HANDLER_FIELDS.phase, 0);
    }
    pushGlyph(mem, host, child, mem.read32(self + CURSOR_HANDLER_FIELDS.frame) | 0);
}
