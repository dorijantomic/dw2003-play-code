// The registration wizard's "Register account?" confirm panel, translated from
// the original pro/stplnmet bodies.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/wizard-confirm.test.js runs each original through engine/native
// and compares the ordered calls and the object memory.
//
//   F0x80085ECC confirmWidgetsBuild  prompt, name row, pack name, YES / NO, the
//                                    hint line and the cursor icon.
//   F0x80086074 confirmWidgetsBind   fill (or hide) the panel text and place the
//                                    cursor at YES or NO.
//   F0x800869C8 confirmTick          YES / NO input, then the registering
//                                    progress count, the "done" wait and the
//                                    closing fold.
//   F0x800862F0 confirmDraw          the panel's picture calls, the three pack
//                                    portraits and the registering progress bar.
//   F0x80086EB8 confirmPanelTick     first-frame build, then tick and draw.
//
// The progress bar is a Gouraud quad whose four corners are scaled by a matrix
// the panel builds from the progress count; the matrix helpers, the quad's
// ordering-table link and the primitive allocator are host boundaries.
//
// Object fields (panel object, 0xE4 bytes; ui block, 0x20 bytes):
//   +0x10 sub-state (0 asking, 1 registering, 2 waiting, 0x32 closing, 0x33
//   folding out, 0x64 accepted, 0xC8 backed out); +0x5C selected pack; +0x60
//   YES (0) or NO (1); +0x64/+0x68 blink frame and clock; +0x6C the typed name;
//   +0x70..+0x78 portrait frames; +0x7C portrait clock; +0x80 progress 0..0x64;
//   +0x84 scale vector; +0x94 rotation vector; +0x9C matrix; +0xBC/+0xCC the two
//   fold records (value at +8).

export interface ConfirmMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** Overlay data addresses the panel reads (pro/stplnmet). */
export interface ConfirmTables {
    /** Word cell: the portrait frame table (28 bytes a member). */
    frames: number;
    /** Word cell: the pack membership table (12 bytes a pack). */
    packs: number;
}

export const WIZARD_TABLES: ConfirmTables = { frames: 0x80089b90, packs: 0x80089b94 };
export const WIZARD_LANGUAGE_CELL = 0x8005cca8;

export interface ConfirmHost {
    createWidget(layer: number, kind: number, x: number, y: number): number;
    createIcon(layer: number, order: number, x: number, y: number): number;
    callMethod(target: number, slot: number, args: number[]): void;
    languageBank(id: number): number;
    padPressed(pad: number): number;
    padBit(pad: number, code: number): number;
    playSound(id: number): void;
    packHandle(id: number): number;
    frameCount(): number;
    /** [0x80089BA0](fold, open): start a panel fold. */
    foldStart(fold: number, open: number): void;
    /** [0x80089BA4](fold): nonzero once landed. */
    foldTick(fold: number): number;
    /** F0x80086E40(obj, on): show or hide the panel (the +0xDC method). */
    show(obj: number, on: number): void;
    drawInit(): void;
    draw74(x: number, y: number): void;
    draw7C(a: number, b: number): void;
    drawSprite(handle: number, clip: number, x: number, y: number): void;
    draw88(n: number): void;
    draw8C(a: number, b: number, c: number): void;
    draw94(a: number, b: number): void;
    /** F0x8002B65C(rotation, matrix): libgte RotMatrix. */
    rotMatrix(rotation: number, matrix: number): void;
    /** F0x8002B23C(matrix, scale): libgte ScaleMatrix. */
    scaleMatrix(matrix: number, scale: number): void;
    /** F0x8002B1DC(matrix, in, out): libgte ApplyMatrixSV. */
    applyMatrix(matrix: number, input: number, output: number): void;
    /** [0x8004DE10+0x17C](layer) then its +0x138(bucket): the ordering-table slot. */
    otSlot(layer: number, bucket: number): number;
    /** [0x8004DE10+0x158](): a fresh primitive block. */
    allocPrim(): number;
    /** [0x8004DF6C](end, 0xFF000000): submit the primitive whose end is `end` (prim + 0x24). */
    commitPrim(end: number): void;
    /** Scratch bytes the panel builds its quad in (0x40 bytes). */
    scratch(): number;
}

const bankId = (mem: ConfirmMemory): number => ((mem.read32(WIZARD_LANGUAGE_CELL) | 0) + 0x8d) | 0;

/** F0x80085ECC(obj, ui): build the panel's widgets. */
export function confirmWidgetsBuild(
    mem: ConfirmMemory, obj: number, ui: number, host: ConfirmHost,
): void {
    const layer = () => mem.read32(obj + 0x54) | 0;
    const text = (slot: number, x: number, y: number, style: number): void => {
        const w = host.createWidget(layer(), 1, x, y);
        mem.write32(ui + slot, w);
        host.callMethod(w, 0x138, [style]);
    };
    text(0x0, 0x20, 0x1a, 4);
    text(0x4, 0x61, 0x42, 1);
    text(0x8, 0x40, 0x60, 1);
    text(0xc, 0x5a, 0xa9, 1);
    text(0x14, 0x6b, 0xb9, 1);
    text(0x18, 0x6b, 0xc7, 1);
    const cursor = host.createIcon(layer(), (mem.read32(obj + 0x58) | 0) - 2, 0x5a, 0xb9);
    mem.write32(ui + 0x1c, cursor);
    host.callMethod(cursor, 0x88, [1]);
    host.callMethod(mem.read32(ui + 0x1c) | 0, 0x80, [0]);
    text(0x10, 0xe3, 0xa9, 1);
}

/** F0x80086074(obj, ui, show): fill the panel text, or hide it. */
export function confirmWidgetsBind(
    mem: ConfirmMemory, obj: number, ui: number, show: number, host: ConfirmHost,
): void {
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bank = () => host.languageBank(bankId(mem));
    if (show !== 0) {
        host.callMethod(at(0), 0x114, [bank(), 0x15]);
        const name = mem.read32(obj + 0x6c) | 0;
        let blanks = 0;
        if (mem.read16(name) === 0x4081) {
            let p = name;
            do { p += 2; blanks += 1; } while (mem.read16(p) === 0x4081);
        }
        host.callMethod(at(4), 0x110, [name + blanks * 2]);
        host.callMethod(at(8), 0x114, [bank(), (mem.read32(obj + 0x5c) | 0) + 0xa]);
        host.callMethod(at(0xc), 0x114, [bank(), 0x16]);
        host.callMethod(at(0x14), 0x114, [bank(), 0x17]);
        host.callMethod(at(0x18), 0x114, [bank(), 0x18]);
        host.callMethod(at(0x1c), 0x84, [0x5a, (mem.read32(obj + 0x60) | 0) * 0xe + 0xb9]);
        host.callMethod(at(0x1c), 0x80, [1]);
        return;
    }
    for (const slot of [0x0, 0x4, 0x8, 0xc, 0x14, 0x18]) host.callMethod(at(slot), 0x144, [0]);
    host.callMethod(at(0x1c), 0x80, [0]);
    host.callMethod(at(0x10), 0x144, [0]);
}

/** F0x800869C8(obj, ui): one frame of the confirm state machine. */
export function confirmTick(
    mem: ConfirmMemory, obj: number, ui: number, host: ConfirmHost,
): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const bank = () => host.languageBank(bankId(mem));
    const pressed = (code: number) => (host.padPressed(0) >> host.padBit(0, code)) & 1;
    const showProgress = () => {
        host.callMethod(mem.read32(ui + 0x10) | 0, 0x118, [1, r(0x80)]);
        host.callMethod(mem.read32(ui + 0x10) | 0, 0x148, [1]);
    };
    const sub = r(0x10);

    if (sub === 0x32) {
        host.foldStart(obj + 0xbc, 0);
        host.foldStart(obj + 0xcc, 0);
        confirmWidgetsBind(mem, obj, ui, 0, host);
        w(0x10, r(0x10) + 1);
        return;
    }
    if (sub === 0x33) {
        host.foldTick(obj + 0xbc);
        if (host.foldTick(obj + 0xcc) !== 0) w(0xc, 3);
        return;
    }
    if (sub === 0x64 || sub === 0xc8) return;
    if (sub === 1) {
        const v = r(0x80) + 1;
        w(0x80, v);
        if (v >= 0x65) {
            w(0x80, 0x64);
            host.callMethod(mem.read32(ui + 0xc) | 0, 0x114, [bank(), 0x1e]);
            host.playSound(0x80045341);
            host.callMethod(obj, 0x3c, []);
        } else {
            host.playSound(0x800452c6);
        }
        showProgress();
        return;
    }
    if (sub === 2) {
        const v = r(0x14) + 1;
        w(0x14, v);
        if (v >= 0x79) w(0x10, 0x64);
        return;
    }

    // Asking: up and down pick YES or NO, confirm and back leave.
    const before = r(0x60);
    if (pressed(4) !== 0) w(0x60, 0);
    else if (pressed(6) !== 0) w(0x60, 1);
    if (before !== r(0x60)) {
        host.playSound(0x8004513e);
        host.callMethod(mem.read32(ui + 0x1c) | 0, 0x84, [0x5a, r(0x60) * 0xe + 0xb9]);
    }
    if (pressed(0xd) !== 0) {
        host.playSound(0x8004503c);
        if (r(0x60) === 0) {
            w(0x10, 1);
            w(0x80, 0);
            host.callMethod(mem.read32(ui + 0x14) | 0, 0x144, [0]);
            host.callMethod(mem.read32(ui + 0x18) | 0, 0x144, [0]);
            host.callMethod(mem.read32(ui + 0x1c) | 0, 0x80, [0]);
            host.callMethod(mem.read32(ui + 0xc) | 0, 0x114, [bank(), 0x1d]);
            host.callMethod(mem.read32(ui + 0x10) | 0, 0x114, [bank(), 0x19]);
            showProgress();
            return;
        }
        w(0x10, 0xc8);
        return;
    }
    if (pressed(0xe) !== 0) {
        host.playSound(0x800450bd);
        w(0x10, 0xc8);
    }
}

/** F0x800862F0(obj): the panel's picture calls and the progress bar. */
export function confirmDraw(mem: ConfirmMemory, obj: number, host: ConfirmHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const pack = (id: number) => host.packHandle(id);
    const frames = () => mem.read32(WIZARD_TABLES.frames) | 0;
    const members = (mem.read32(WIZARD_TABLES.packs) | 0) + r(0x5c) * 0xc;

    host.drawInit();
    host.draw74(0x280, 0x100);
    if (host.frameCount() - r(0x68) >= 5) {
        w(0x68, host.frameCount());
        const v = r(0x64) + 1;
        w(0x64, v);
        if (v >= 0xe) w(0x64, 0);
    }
    const foldA = r(0xc4);
    if (foldA !== 0) {
        if (foldA !== 0x1000) {
            host.draw8C(foldA, 0x1000, 0x1000);
            host.draw94(0x37, 0x42);
        }
        host.draw7C(r(0x54), r(0x58));
        host.draw88(r(0x64));
        host.drawSprite(pack(0x028a0000), 6, 0x37, 0x2f);
        host.draw88(0);
        host.drawSprite(pack(0x028a0000), 2, 0x37, 0x2f);
    }
    if (host.frameCount() - r(0x7c) >= 0xd) {
        w(0x7c, host.frameCount());
        for (let i = 0; i < 3; i++) {
            const idx = r(0x70 + i * 4) + 1;
            w(0x70 + i * 4, idx);
            const member = mem.read32(members + i * 4) | 0;
            if (idx >= 8 || (mem.read32(frames() + member * 0x1c + idx * 4) | 0) === -1) w(0x70 + i * 4, 0);
        }
    }
    const foldB = r(0xd4);
    if (foldB !== 0) {
        host.draw7C(r(0x54), r(0x58));
        if (foldB === 0x1000) {
            host.draw74(0x140, 0x100);
            for (let i = 0; i < 3; i++) {
                const member = mem.read32(members + i * 4) | 0;
                const clip = mem.read32(frames() + member * 0x1c + r(0x70 + i * 4) * 4) | 0;
                host.drawSprite(pack(0x07700000), clip, 0x57 + i * 0x38, 0x6c);
            }
        }
        host.draw74(0x280, 0x100);
        const scale = r(0xd4);
        if (scale !== 0x1000) {
            host.draw8C(0x1000, scale, 0x1000);
            host.draw94(0xa0, 0x78);
        }
        host.draw7C(r(0x54), r(0x58) - 1);
        host.drawSprite(pack(0x028a0000), 0xa, 0x37, 0x59);
        host.draw7C(r(0x54), r(0x58));
        host.drawSprite(pack(0x028a0000), 9, 0x37, 0x59);
        if (r(0xd4) !== 0x1000) host.draw94(0xa0, 0xbe);
        host.drawSprite(pack(0x028a0000), 1, 0, 0xa2);
    }
    if (((r(0x10) - 1) >>> 0) < 2) {
        host.draw7C(r(0x54), r(0x58) - 1);
        host.drawSprite(pack(0x028a0000), 0x37, 0x51, 0xbf);
        const progress = r(0x80);
        w(0x8c, 0x1000);
        w(0x88, 0x1000);
        w(0x84, progress === 0x64 ? 0x1000 : progress * 0x29);
        host.rotMatrix(obj + 0x94, obj + 0x9c);
        host.scaleMatrix(obj + 0x9c, obj + 0x84);
        const slot = host.otSlot(r(0x54), r(0x58) - 1);
        const prim = host.allocPrim();
        // A four-corner Gouraud primitive: command 0x38, eight words.
        const p8 = (off: number, v: number) => mem.write16(prim + off, v);
        const byte = (off: number, v: number) => {
            const word = prim + (off & ~1);
            const cur = mem.read16(word);
            mem.write16(word, off & 1 ? (cur & 0xff) | (v << 8) : (cur & 0xff00) | v);
        };
        byte(3, 8);
        byte(7, 0x38);
        byte(0xe, 0xde);
        byte(0x1e, 0xde);
        for (const [off, c] of [
            [4, [0x7f, 0x32, 0xf2]], [0xc, [0xd1, 0x2f, 0xde]],
            [0x14, [0x7f, 0x32, 0xf2]], [0x1c, [0xd1, 0x2f, 0xde]],
        ] as const) {
            byte(off, c[0]); byte(off + 1, c[1]);
            if (off !== 0xc && off !== 0x1c) byte(off + 2, c[2]);
        }
        const scratch = host.scratch();
        const vin = scratch + 0x20;
        const vout = scratch;
        const corners: Array<[number, number]> = [[0, 0xbc], [0x98, 0xbc], [0, 0xc8], [0x98, 0xc8]];
        corners.forEach(([x, y], i) => {
            mem.write16(vin + i * 8, x);
            mem.write16(vin + i * 8 + 2, y);
            mem.write16(vin + i * 8 + 4, 0);
        });
        for (let i = 0; i < 4; i++) {
            host.applyMatrix(obj + 0x9c, vin + i * 8, vout + i * 8);
            mem.write16(vout + i * 8, (mem.read16(vout + i * 8) + 0x54) & 0xffff);
            mem.write16(vout + i * 8 + 2, (mem.read16(vout + i * 8 + 2) + 6) & 0xffff);
        }
        for (const [k, off] of [[0, 8], [1, 0x10], [2, 0x18], [3, 0x20]] as const) {
            p8(off, mem.read16(vout + k * 8));
            p8(off + 2, mem.read16(vout + k * 8 + 2));
        }
        // Link the primitive at the front of the ordering-table slot.
        mem.write32(prim, ((mem.read32(prim) & 0xff000000) | (mem.read32(slot) & 0xffffff)) | 0);
        mem.write32(slot, ((mem.read32(slot) & 0xff000000) | (prim & 0xffffff)) | 0);
        host.commitPrim(prim + 0x24);
    }
}

/** F0x80086EB8(obj, ui): first-frame build, then tick and draw. */
export function confirmPanelTick(
    mem: ConfirmMemory, obj: number, ui: number, host: ConfirmHost,
): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 1) {
        confirmTick(mem, obj, ui, host);
        confirmDraw(mem, obj, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.callMethod(obj, 0x38, []);
    confirmWidgetsBuild(mem, obj, ui, host);
    mem.write32(obj + 0xbc, 0xa);
    mem.write32(obj + 0xc4, 0x1000);
    mem.write32(obj + 0xcc, 0xa);
    mem.write32(obj + 0xd4, 0x1000);
    host.show(obj, 1);
}
