// The item-shop info band's label and per-member card widget builder, translated
// from pro/stitshop F0x80089A44.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/band-label-build-oracle.test.js stubs createTextElement on the
// original side and matches it with callbacks on the port, comparing the whole
// written block and the ordered call arguments.
//
// DECODED: exe-decomp/stitshop_c/F0x80089a44.c and the raw body at
// exe-decomp/stitshop_c/_asm/F0x80089a44.s (authority 2), cross-checked against
// docs/research/ui/shop-system-decompiled.md 3d ("Labels (F0x80089a44)").
//
// obj is the band object: +0x50 = target, +0x58 = mode (0 = BUY, 1 = SELL),
// +0x60 = party-member count. block receives the widget pointers:
//
//   block+0x00..+0x20  the band's nine labels (kind 1/3 createTextElement)
//   block+0x1C         the first description line, whose +0x160 method slot is
//                      called with 2 (F0x8001A450, set_unk_0xbf)
//   BUY only: block+0x24 + 0x2C*m records of eleven card widgets per member,
//             then block+0xA8 the prompt message text
//
// The y of the first nine labels shifts with the mode (base = mode*0x28); the
// per-member card grid is BUY-only. createTextElement and the +0x160 method are
// the host boundaries; both exist as engine/dw3 ports already.

export interface BandLabelMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface BandLabelHost {
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** The widget's +0x160 method, F0x8001A450 (set_unk_0xbf). */
    setWidgetFlagBF(widget: number, value: number): void;
}

// block slot, kind, x, y and whether the mode step (mode*2) shifts y. The
// original adds the step only to the first seven labels; the two description
// lines take the mode base alone.
export const BAND_LABELS: ReadonlyArray<readonly [number, number, number, number, boolean]> = [
    [0x00, 1, 0x25, 0x73, true],
    [0x04, 1, 0xa1, 0x75, true],
    [0x08, 1, 0xe1, 0x75, true],
    [0x0c, 1, 0xea, 0x75, true],
    [0x10, 1, 0x12a, 0x75, true],
    [0x14, 3, 0x11a, 0x8b, true],
    [0x18, 3, 0x117, 0x8b, true],
    [0x1c, 1, 0x14, 0xa1, false],
    [0x20, 1, 0x14, 0xaf, false],
];
/** BUY per-member card record: base slot 0x24, stride 0x2C, eleven widgets. */
export const BAND_CARD_BASE = 0x24;
export const BAND_CARD_STRIDE = 0x2c;
/** BUY per-member card widget x/y, relative to the record, in machine order. */
export const BAND_CARD_SLOTS: ReadonlyArray<readonly [number, number, number]> = [
    [0x00, 0x17, 0x9e],
    [0x04, 0x3c, 0xac],
    [0x08, 0x3c, 0xba],
    [0x0c, 0x39, 0xac],
    [0x10, 0x39, 0xba],
    [0x14, 0x5a, 0xac],
    [0x18, 0x5a, 0xba],
    [0x1c, 0x39, 0xc8],
    [0x20, 0x63, 0xc8],
    [0x24, 0x39, 0xd6],
    [0x28, 0x63, 0xd6],
];
/** BUY prompt message text slot, kind, x and y. */
export const BAND_PROMPT = { slot: 0xa8, kind: 1, x: 0x13, y: 0x87 } as const;

const s16 = (v: number): number => (v << 16) >> 16;

/** F0x80089A44(obj, block): build the band's labels and BUY card widgets. */
export function bandLabelBuild(
    mem: BandLabelMemory,
    obj: number,
    block: number,
    host: BandLabelHost,
): void {
    const target = s16(mem.read16(obj + 0x50));
    const mode = mem.read32(obj + 0x58) | 0;
    const base = Math.imul(mode, 0x28);
    const step = Math.imul(mode, 2);

    for (const [slot, kind, x, y, useStep] of BAND_LABELS) {
        const yy = s16(base + (useStep ? step : 0) + y);
        const widget = host.createTextElement(target, kind, x, yy) >>> 0;
        mem.write32(block + slot, widget);
        // The first description line (slot 0x1C) has its +0x160 method invoked
        // immediately, between the eighth and ninth label, as the original does.
        if (slot === 0x1c) {
            host.setWidgetFlagBF(widget, 2);
        }
    }

    if (mode !== 0) {
        return;
    }
    const count = mem.read32(obj + 0x60) | 0;
    if (count > 0) {
        let m = 0;
        do {
            const rec = block + BAND_CARD_BASE + Math.imul(m, BAND_CARD_STRIDE);
            const dx = Math.imul(m, 0x63);
            for (const [slot, x, y] of BAND_CARD_SLOTS) {
                mem.write32(rec + slot, host.createTextElement(target, 1, s16(dx + x), y) >>> 0);
            }
            m += 1;
            // The original re-reads the member count at the loop bottom.
        } while (m < (mem.read32(obj + 0x60) | 0));
    }
    mem.write32(
        block + BAND_PROMPT.slot,
        host.createTextElement(target, BAND_PROMPT.kind, BAND_PROMPT.x, BAND_PROMPT.y) >>> 0,
    );
}
