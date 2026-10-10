// The battle-report screen's open/resource step, translated bit-exactly from
// the original pro/stfgtrep F0x80085B60 body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/fight-report-open.test.js runs the original through
// engine/native and compares the ordered context/pack/audio calls.
//
// F0x80085B60() builds the screen's menu/sound context (F0x8001FFA8), sets its
// origin to (0x280,0) and its pack to 0x07A00000, then loads the three report
// audio strings `[0x8005CCA8]+0x55 / +0x4E / +0x6A` through the shared resource
// table. This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

/** The pack the report menu/sound context is bound to. */
export const REPORT_OPEN_PACK = 0x07a00000;
/** The global whose value is the report string bank base. */
export const REPORT_OPEN_CONTEXT = 0x8005cca8;

export interface ReportOpenMemory {
    read32(addr: number): number;
}

export interface ReportOpenHost {
    /** F0x8001FFA8(&ctx): build the menu/sound context on the stack. */
    initContext(): void;
    /** ctx+slot(a1, a2): call one of the context's installed methods. */
    contextMethod(slot: number, args: number[]): void;
    /** [0x80044F5C](handle): resolve a pack handle to its pointer. */
    packResolve(handle: number): number;
    /** [0x80044F44](id): load one audio/resource string. */
    loadAudio(id: number): void;
}

/** F0x80085B60(): open the report screen's context and audio. */
export function reportScreenOpen(mem: ReportOpenMemory, host: ReportOpenHost): void {
    host.initContext();
    host.contextMethod(0x24, [0x280, 0]);
    const pack = host.packResolve(REPORT_OPEN_PACK);
    host.contextMethod(0x2c, [pack, 0]);
    const base = mem.read32(REPORT_OPEN_CONTEXT) | 0;
    host.loadAudio((base + 0x55) | 0);
    host.loadAudio((base + 0x4e) | 0);
    host.loadAudio((base + 0x6a) | 0);
}
