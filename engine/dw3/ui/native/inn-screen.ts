// The inn (hotel) rest screen: the resident class the innkeeper opens.
// Translated bit-exactly from the resident EXE (asm ~/ddw3/asm/dw2003/exe/fns.s):
//   F0x80011DAC  constructor  (fns.s L2413-2425)
//   F0x800119A8  handler      (fns.s L2152-2412): build, then update + draw
//   F0x800110E0  update       (fns.s L1538-2151): the 33-entry step switch
// Decoded reference: docs/research/ui/inn-rest-service-decoded-2026-08-13.md.
//
// Oracle: tests/lane-b/inn-screen.test.js runs the three originals through
// engine/native on resident.bin (with the real fold pair f13 / F0x80010FE0 and
// the real inn table D0x8003EDCC) and compares every call and memory word.
//
// Object (0xA0 bytes, 0x20 extra): +0x0C task state, +0x10 step, +0x14 the
// "refused" flag, +0x50 layer (constructor arg), +0x54 = 1, +0x58 inn table
// position, +0x5C selection (0 = stay, 1 = do not stay), +0x60 party count,
// +0x64 saved music id, +0x68 rest start clock, three four-word folds at +0x6C
// (header), +0x7C (prompt), +0x8C (refusal panel); values at +0x74/+0x84/+0x94.
// extra: +0x00 rest fade object, +0x04 inn name, +0x08 BIT total, +0x0C "BIT",
// +0x10 offer, +0x14 "Stay", +0x18 "Do not stay", +0x1C cursor icon.
//
// Steps (update, unsigned; any step not listed, and >= 33, opens the header):
//   0  header fold open, step++.
//   1  header done: name 0x114(bank, rec.name), BIT 0x118(0, BIT) + 0x148(1),
//      "BIT" 0x114(bank, 0x10), prompt fold open, step++.
//   2  prompt done: offer 0x114(bank, 0x11) + 0x118(1, rec.price), rows
//      0x114(bank, 0x12/0x13), cursor 0x80(1), step++.
//   3  Up (4) -> sel 0, else Down (6) -> sel 1 (pad word +0x3F4, then +0x3FC).
//      Changed -> SFX move, cursor 0x84(0xB8, 0x5F + 16*sel). Else Confirm
//      (0xD): SFX confirm; sel != 0 -> step 10; BIT < price*party -> step 10
//      and +0x14 = 1; else step 20. Else Cancel (0xE): SFX cancel, step 10.
//  10  prompt fold close, offer/rows 0x144(0), cursor 0x80(0), step++.
//  11  prompt done: +0x14 != 0 -> refusal fold open, step 30; else header
//      fold close, name/BIT/"BIT" 0x144(0), step++.
//  12  header done -> task state 3.
//  20  +0x64 = current music [0x80055C34], +0x68 = clock(), play 0x4004000D,
//      extra+0 = createFade(layer), fade 0x64(0, 0x14), step++.
//  21  fade state 2: folds +0x74/+0x84 = 0, all six texts 0x144(0), cursor
//      0x80(0), BIT -= price*party, rest effect F0x8001104C, step++.
//  22  clock() - start >= 0xF1: fade 0x64(1, 0x14), step++.
//  23  fade state 2: play the saved music, task state 3.
//  30  refusal fold done: offer 0x114(bank, 0x14), +0x14 = 0, step++.
//  31  Confirm: SFX 0x4001C, offer 0x144(0), refusal fold close, step++.
//  32  refusal fold done: prompt fold open, step 2.
//
// Host boundaries: F0x80014504 (class allocator), F0x8001AE38 (text),
// F0x8001B364 (icon), F0x8001F648 (draw context), F0x8001206C (fade object),
// F0x8001104C (the rest effect), the fold pair, the screen-id cell
// [0x8004B438], the party probe [0x8004B44C], the text-bank cell [0x80044F4C],
// the pack cell [0x80044F5C], the clock cell [0x8004DF98], the pad cells, the
// sound cell [0x80055C48] and every object method.

export const INN_SCREEN_CTOR = 0x80011dac;
export const INN_SCREEN_HANDLER = 0x800119a8;
export const INN_SCREEN_UPDATE = 0x800110e0;
export const INN_SCREEN_REST = 0x8001104c;
export const INN_SCREEN_SIZE = 0xa0;
export const INN_SCREEN_EXTRA = 0x20;
export const INN_TABLE = 0x8003edcc;
export const INN_BIT_TOTAL = 0x80048da0;
export const INN_MUSIC_CURRENT = 0x80055c34;
export const INN_TEXT_GLOBAL = 0x8005cca8;
export const INN_TEXT_BANK_BASE = 0x5c;
export const INN_WINDOW_PACK = 0x02860000;
export const INN_SFX_MOVE = 0x8004513e;
export const INN_SFX_CONFIRM = 0x8004503c;
export const INN_SFX_CANCEL = 0x800450bd;
export const INN_SFX_REFUSAL_OK = 0x0004001c;
export const INN_REST_MUSIC = 0x4004000d;
export const INN_FOLD_HEADER = 0x6c;
export const INN_FOLD_PROMPT = 0x7c;
export const INN_FOLD_REFUSAL = 0x8c;

export interface InnScreenMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface InnScreenHost {
    /** target.method[slot](target, ...args). */
    callMethod(target: number, slot: number, args: number[]): number;
    /** F0x80014504(handler, size, extra): allocate a screen object. */
    allocObject(handler: number, size: number, extra: number): number;
    /** F0x8001AE38(layer, kind, x, y): create a text element. */
    createText(layer: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(layer, kind, x, y): spawn the cursor icon. */
    spawnIcon(layer: number, kind: number, x: number, y: number): number;
    /** [0x8004B438](): the current screen id. */
    screenId(): number;
    /** [0x80048D34+0x2718](slot): party member probe, >= 0 when present. */
    partyProbe(slot: number): number;
    /** [0x80044F4C](bank): resolve a text bank. */
    textBank(bank: number): number;
    /** [0x80044F5C](handle): resolve a graphics pack handle. */
    lookup(handle: number): number;
    /** f13(fold, direction): begin a window fold (plays its SFX). */
    foldStart(fold: number, direction: number): void;
    /** F0x80010FE0(fold): advance a fold, nonzero when done. */
    foldTick(fold: number): number;
    padRead(port: number): number;
    padAlt(port: number): number;
    padShift(port: number, button: number): number;
    /** [0x80055C48](id): play a packed sound or music id. */
    playSound(id: number): void;
    /** [0x8004DE10+0x188](): the frame clock. */
    clock(): number;
    /** F0x8001206C(layer): create the rest fade object. */
    createFade(layer: number): number;
    /** F0x8001104C(): the rest effect (full HP/MP, penalties cleared). */
    rest(): void;
    /** F0x8001F648(ctx): fill a draw context, return a handle to it. */
    drawInit(): number;
    drawCall(ctx: number, slot: number, args: number[]): void;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

/** F0x80011DAC(layer): allocate the inn screen and store its layer. */
export function innScreenCreate(mem: InnScreenMemory, layer: number, host: InnScreenHost): number {
    const obj = u32(host.allocObject(INN_SCREEN_HANDLER, INN_SCREEN_SIZE, INN_SCREEN_EXTRA));
    mem.write32(obj + 0x50, u32(layer));
    mem.write32(obj + 0x54, 1);
    return obj;
}

/** F0x800119A8(obj, extra): one frame of the inn screen. */
export function innScreenHandler(mem: InnScreenMemory, obj: number, extra: number, host: InnScreenHost): void {
    const taskState = s32(mem.read32(obj + 0x0c));
    if (taskState === 1) {
        innScreenUpdate(mem, obj, extra, host);
        innScreenDraw(mem, obj, host);
        return;
    }
    if (taskState >= 2 && taskState < 4) return;

    host.callMethod(obj, 0x38, []);
    const id = s32(host.screenId());
    let pos = 0;
    if (mem.read32(INN_TABLE) !== 0) {
        let p = INN_TABLE;
        for (;;) {
            const v = s32(mem.read32(p));
            p = u32(p + 8);
            if (id === v) break;
            pos++;
            if (mem.read32(p) === 0) break;
        }
    }
    mem.write32(obj + 0x58, u32(pos));
    for (let slot = 0; slot < 3; slot++) {
        if (s32(host.partyProbe(slot)) >= 0) mem.write32(obj + 0x60, u32(mem.read32(obj + 0x60) + 1));
    }
    const layer = (): number => s16(mem.read32(obj + 0x50));
    const texts: [number, number, number][] = [
        [1, 0x1d, 0x14], [3, 0x117, 0x17], [3, 0x11a, 0x17],
        [1, 0x79, 0x34], [1, 0xc5, 0x5f], [1, 0xc5, 0x6f],
    ];
    texts.forEach(([kind, x, y], i) => mem.write32(extra + 4 + 4 * i, u32(host.createText(layer(), kind, x, y))));
    const icon = u32(host.spawnIcon(layer(), 0, 0xb8, 0x5f));
    mem.write32(extra + 0x1c, icon);
    host.callMethod(icon, 0x80, [0]);
    mem.write32(obj + INN_FOLD_HEADER, 10);
    mem.write32(obj + INN_FOLD_PROMPT, 10);
    mem.write32(obj + INN_FOLD_REFUSAL, 10);
}

/** F0x800110E0(obj, extra): the inn screen's step switch. */
export function innScreenUpdate(mem: InnScreenMemory, obj: number, extra: number, host: InnScreenHost): void {
    const setStep = (v: number): void => mem.write32(obj + 0x10, u32(v));
    const advance = (): void => setStep(mem.read32(obj + 0x10) + 1);
    const w = (off: number): number => u32(mem.read32(extra + off));
    const bank = (): number => host.textBank(u32(mem.read32(INN_TEXT_GLOBAL) + INN_TEXT_BANK_BASE));
    const record = (): number => u32(INN_TABLE + u32(mem.read32(obj + 0x58) << 3));
    const nameIndex = (): number => s16(mem.read32(record() + 4));
    const price = (): number => mem.read32(record() + 4) >> 16;
    const total = (): number => Math.imul(price(), mem.read32(obj + 0x60));
    const pressed = (button: number, alt: boolean): number => {
        const word = alt ? host.padAlt(0) : host.padRead(0);
        const shift = host.padShift(0, button);
        return (s32(word) >> (shift & 31)) & 1;
    };

    const step = u32(mem.read32(obj + 0x10));
    switch (step < 0x21 ? step : 0) {
        case 1: {
            if (host.foldTick(obj + INN_FOLD_HEADER) === 0) return;
            const b = bank();
            host.callMethod(w(4), 0x114, [b, nameIndex()]);
            host.callMethod(w(8), 0x118, [0, s32(mem.read32(INN_BIT_TOTAL))]);
            host.callMethod(w(8), 0x148, [1]);
            const b2 = bank();
            host.callMethod(w(0xc), 0x114, [b2, 0x10]);
            host.foldStart(obj + INN_FOLD_PROMPT, 1);
            advance();
            return;
        }
        case 2: {
            if (host.foldTick(obj + INN_FOLD_PROMPT) === 0) return;
            host.callMethod(w(0x10), 0x114, [bank(), 0x11]);
            host.callMethod(w(0x10), 0x118, [1, price()]);
            host.callMethod(w(0x14), 0x114, [bank(), 0x12]);
            host.callMethod(w(0x18), 0x114, [bank(), 0x13]);
            host.callMethod(w(0x1c), 0x80, [1]);
            advance();
            return;
        }
        case 3: {
            const old = u32(mem.read32(obj + 0x5c));
            if (pressed(4, false) || pressed(4, true)) {
                mem.write32(obj + 0x5c, 0);
            } else if (pressed(6, false) || pressed(6, true)) {
                mem.write32(obj + 0x5c, 1);
            }
            if (old !== u32(mem.read32(obj + 0x5c))) {
                host.playSound(INN_SFX_MOVE);
                const sel = mem.read32(obj + 0x5c);
                host.callMethod(w(0x1c), 0x84, [0xb8, s32((sel << 4) + 0x5f)]);
                return;
            }
            if (pressed(0xd, false)) {
                host.playSound(INN_SFX_CONFIRM);
                if (mem.read32(obj + 0x5c) !== 0) return setStep(10);
                const cost = total();
                if (s32(mem.read32(INN_BIT_TOTAL)) < s32(cost)) {
                    setStep(10);
                    mem.write32(obj + 0x14, 1);
                    return;
                }
                return setStep(0x14);
            }
            if (pressed(0xe, false)) {
                host.playSound(INN_SFX_CANCEL);
                setStep(10);
            }
            return;
        }
        case 10:
            host.foldStart(obj + INN_FOLD_PROMPT, 0);
            for (const off of [0x10, 0x14, 0x18]) host.callMethod(w(off), 0x144, [0]);
            host.callMethod(w(0x1c), 0x80, [0]);
            advance();
            return;
        case 11:
            if (host.foldTick(obj + INN_FOLD_PROMPT) === 0) return;
            if (mem.read32(obj + 0x14) !== 0) {
                host.foldStart(obj + INN_FOLD_REFUSAL, 1);
                return setStep(0x1e);
            }
            host.foldStart(obj + INN_FOLD_HEADER, 0);
            for (const off of [4, 8, 0xc]) host.callMethod(w(off), 0x144, [0]);
            advance();
            return;
        case 12:
            if (host.foldTick(obj + INN_FOLD_HEADER) !== 0) mem.write32(obj + 0x0c, 3);
            return;
        case 20: {
            mem.write32(obj + 0x64, u32(mem.read32(INN_MUSIC_CURRENT)));
            mem.write32(obj + 0x68, u32(host.clock()));
            host.playSound(INN_REST_MUSIC);
            const fade = u32(host.createFade(mem.read32(obj + 0x50)));
            mem.write32(extra, fade);
            host.callMethod(fade, 0x64, [0, 0x14]);
            advance();
            return;
        }
        case 21:
            if (s32(mem.read32(w(0) + 0x0c)) !== 2) return;
            mem.write32(obj + 0x74, 0);
            mem.write32(obj + 0x84, 0);
            for (const off of [4, 8, 0xc, 0x10, 0x14, 0x18]) host.callMethod(w(off), 0x144, [0]);
            host.callMethod(w(0x1c), 0x80, [0]);
            mem.write32(INN_BIT_TOTAL, u32(mem.read32(INN_BIT_TOTAL) - total()));
            host.rest();
            advance();
            return;
        case 22:
            if (s32(u32(host.clock()) - mem.read32(obj + 0x68)) < 0xf1) return;
            host.callMethod(w(0), 0x64, [1, 0x14]);
            advance();
            return;
        case 23:
            if (s32(mem.read32(w(0) + 0x0c)) !== 2) return;
            host.playSound(u32(mem.read32(obj + 0x64)));
            mem.write32(obj + 0x0c, 3);
            return;
        case 30:
            if (host.foldTick(obj + INN_FOLD_REFUSAL) === 0) return;
            host.callMethod(w(0x10), 0x114, [bank(), 0x14]);
            mem.write32(obj + 0x14, 0);
            advance();
            return;
        case 31:
            if (!pressed(0xd, false)) return;
            host.playSound(INN_SFX_REFUSAL_OK);
            host.callMethod(w(0x10), 0x144, [0]);
            host.foldStart(obj + INN_FOLD_REFUSAL, 0);
            advance();
            return;
        case 32:
            if (host.foldTick(obj + INN_FOLD_REFUSAL) === 0) return;
            host.foldStart(obj + INN_FOLD_PROMPT, 1);
            setStep(2);
            return;
        default: // steps 0, 4..9, 13..19, 24..29 and >= 33 share one jump-table target
            host.foldStart(obj + INN_FOLD_HEADER, 1);
            advance();
            return;
    }
}

/** The draw tail of F0x800119A8 (fns.s L2236-2410), run every task-state-1 frame. */
export function innScreenDraw(mem: InnScreenMemory, obj: number, host: InnScreenHost): void {
    const ctx = host.drawInit();
    host.drawCall(ctx, 0x74, [0x140, 0]);
    host.drawCall(ctx, 0x7c, [s32(mem.read32(obj + 0x50)), s32(mem.read32(obj + 0x54))]);
    host.drawCall(ctx, 0x98, [0]);
    const fold = (off: number): number => s32(mem.read32(obj + off));
    const piece = (clip: number, x: number, y: number): void =>
        host.drawCall(ctx, 0x84, [host.lookup(INN_WINDOW_PACK), clip, x, y]);
    const scale = (v: number, ax: number, ay: number): void => {
        host.drawCall(ctx, 0x8c, [v, 0x1000, 0x1000]);
        host.drawCall(ctx, 0x94, [ax, ay]);
    };

    let v = fold(0x74);
    if (v !== 0) {
        if (v !== 0x1000) scale(v, 0x57, 0x19);
        piece(0x41, 0x16, 0x12);
        if (fold(0x74) !== 0x1000) host.drawCall(ctx, 0x94, [0x140, 0x18]);
        piece(0x42, 0xd6, 0x0f);
    }
    v = fold(0x84);
    if (v !== 0) {
        if (v !== 0x1000) scale(v, 0x140, 0x41);
        piece(0x43, 0x4c, 0x2e);
        if (fold(0x84) !== 0x1000) host.drawCall(ctx, 0x94, [0x140, 0x6d]);
        piece(0x44, 0xaf, 0x59);
    }
    v = fold(0x94);
    if (v !== 0) {
        if (v !== 0x1000) scale(v, 0x140, 0x41);
        piece(0x43, 0x4c, 0x2e);
    }
}
