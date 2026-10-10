// The battle-report screen's chrome painter, translated bit-exactly from the
// original pro/stfgtrep F0x80084C20 body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/fight-report-chrome.test.js runs the original through
// engine/native and compares the ordered draw intents and the screen fields.
//
// F0x80084C20(obj) draws the report screen's chrome twice per frame:
//   - when obj+0x74 is set, a two-tick-blinking banner: every 5 timebase units
//     it advances obj+0x7C 0..4 and draws the 0x02860000 banner sprite 0xA at
//     (0x123,0xD0);
//   - the shared 0x079F0000 chrome strip: a 0x60-step scroll counter at
//     obj+0x58 (advanced every other call, wrapping to 0) drawn as sprite 0x1E,
//     the obj+0x88 sprite 0x21 (scaled/positioned unless it is already 0x1000)
//     and the obj+0x98 sprite 0x1D (scaled/positioned unless 0x1000).
//
// The shared stack draw context (F0x8001F648) and its methods are host
// boundaries; the port preserves the exact call order and arguments. This is
// lane B (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts
// barrel and data/translated_functions.json.

/** The blinking banner pack (first chrome draw). */
export const REPORT_BANNER_PACK = 0x02860000;
/** The shared report chrome pack (scroll strip, side blocks). */
export const REPORT_CHROME_PACK = 0x079f0000;
/** The timebase counter the banner blink reads ([0x8004DE10+0x188]). */
export const REPORT_TIMEBASE_SLOT = 0x8004df98;

export interface ReportChromeMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ReportChromeHost {
    /** [0x8004DE10+0x188](): the frame/timebase counter. */
    timebase(): number;
    /** F0x8001F648(&ctx): the shared stack draw context. */
    initDrawContext(): void;
    /** ctx+0x74: set the draw origin. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x7C: set the draw layer. */
    setLayer(x: number, y: number): void;
    /** ctx+0x88: the one-argument context method the banner uses. */
    m_0x88(value: number): void;
    /** ctx+0x84: draw a sprite (subPtr, spriteId, x, y). */
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** ctx+0x8C: set the draw scale. */
    setScale(sx: number, sy: number, sz: number): void;
    /** ctx+0x94: set the draw position. */
    setPos(x: number, y: number): void;
    /** [0x80044F5C](handle): resolve a pack handle to its pointer. */
    packResolve(handle: number): number;
}

/** F0x80084C20(obj): draw the report screen chrome. */
export function reportChromeDraw(
    mem: ReportChromeMemory,
    obj: number,
    host: ReportChromeHost,
): void {
    if (mem.read32(obj + 0x74) !== 0) {
        if (((host.timebase() | 0) - (mem.read32(obj + 0x78) | 0)) >= 5) {
            mem.write32(obj + 0x78, host.timebase());
            const frame = (mem.read32(obj + 0x7c) + 1) | 0;
            mem.write32(obj + 0x7c, frame >= 5 ? 0 : frame);
        }
        host.initDrawContext();
        host.setOrigin(0x140, 0);
        host.setLayer(mem.read32(obj + 0x50) | 0, (mem.read32(obj + 0x54) - 2) | 0);
        host.m_0x88(mem.read32(obj + 0x7c) | 0);
        host.drawSprite(host.packResolve(REPORT_BANNER_PACK), 0x0a, 0x123, 0xd0);
    }

    host.initDrawContext();
    host.setOrigin(0x280, 0);
    host.setLayer(mem.read32(obj + 0x50) | 0, mem.read32(obj + 0x54) | 0);

    if (mem.read32(obj + 0x5c) !== 0) {
        const next = (mem.read32(obj + 0x58) + 1) | 0;
        mem.write32(obj + 0x58, next < 0x60 ? next : 0);
        mem.write32(obj + 0x5c, 0);
    } else {
        mem.write32(obj + 0x5c, 1);
    }

    const scroll = mem.read32(obj + 0x58) | 0;
    host.drawSprite(host.packResolve(REPORT_CHROME_PACK), 0x1e, scroll, scroll);
    host.setLayer(mem.read32(obj + 0x50) | 0, (mem.read32(obj + 0x54) - 1) | 0);

    const left = mem.read32(obj + 0x88) | 0;
    if (left !== 0) {
        if (left !== 0x1000) {
            host.setScale(left, 0x1000, 0x1000);
            host.setPos(0, 0x18);
        }
        host.drawSprite(host.packResolve(REPORT_CHROME_PACK), 0x21, 0, 0x0f);
    }

    const right = mem.read32(obj + 0x98) | 0;
    if (right !== 0) {
        host.setScale(0x1000, right, 0x1000);
        if (right !== 0x1000) host.setPos(0xa0, 0xce);
        host.drawSprite(host.packResolve(REPORT_CHROME_PACK), 0x1d, 0x0b, 0xbc);
    }
}
