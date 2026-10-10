// The training gym's boot chain and closing panel, translated from the original
// pro/stgtrain bodies (disassembled 2026-09-30; the m2c list omits F0x80083AC0).
//
// Oracle: tests/lane-b/gym-boot.test.js runs each original through engine/native and
// compares the ordered boundary calls and the fields.
//
//   F0x80083AC0 gymEntryCreate   overlay entry: factory(handler F0x80083930, 0x50, extra 4).
//   F0x80083930 gymBootTick      boot task. In state 0, a negative state or a state of 4 or more
//               it sets the display up (service +0x150 reset, +0x154(0x14000) packet bytes,
//               +0x174(0x140, 0xF0, 0, 0) region), registers three views through +0x16C
//               (rect, kind 3, priority): 0x1000 the full screen (its colour cleared to black
//               through view+0x12C), 0x1001 the 168x88 window at (0x7B, 0x53), and 0x1002 the
//               full screen; links 0x1001 under 0x1000 and 0x1002 under 0x1001 through +0x180
//               (id, parent, 1); builds the screen root F0x80085DD8 into extra word 0 and
//               advances itself; states 1..3 idle.
//   F0x80086174 gymPanelCreate   the closing panel: factory(handler F0x800860C0, 0x68, extra 0),
//               start method +0x64 = F0x80085EF4, layer +0x50 = 0x1000, bucket +0x54 = 6.
//
// The panel's start (F0x80085EF4), tick (F0x800860C0) and dim quad (F0x80085F7C) are
// instruction-for-instruction the fight report's fade (F0x80082F98 / F0x80083164 /
// F0x80083020 in pro/stfgtrep; every word equal once the jal target and the lui/addiu
// immediates are masked), so the port is native/fight-report-fade.ts reportFadeStart and
// reportFadeTick; tests/lane-b/gym-boot.test.js proves that against the gym addresses.
//
// The display-service calls are the same documented platform boundary as the fight
// report's: the canvas and the recorded picture calls replace the GPU packet buffers.
import type { ReportBootHost } from "./fight-report-boot.ts";

export const GYM_BOOT_HANDLER = 0x80083930;
export const GYM_BOOT_SIZE = 0x50;
export const GYM_BOOT_EXTRA = 4;
export const GYM_PANEL_HANDLER = 0x800860c0;
export const GYM_PANEL_SIZE = 0x68;
export const GYM_PANEL_START_ENTRY = 0x80085ef4;
export const GYM_PANEL_START_SLOT = 0x64;
export const GYM_PACKET_BYTES = 0x14000;
export const GYM_SCREEN = { width: 0x140, height: 0xf0 } as const;
export const GYM_WINDOW_VIEW = { x: 0x7b, y: 0x53, w: 0xa8, h: 0x58 } as const;
export const GYM_VIEWS = { screen: 0x1000, window: 0x1001, top: 0x1002 } as const;

export interface GymBootMemory {
  read32(addr: number): number;
  write32(addr: number, value: number): void;
}

export interface GymBootHost extends Omit<ReportBootHost, "advance"> {
  /** [0x8004DE10+0x180](id, parent, 1): link a registered view under another. */
  displayLink(id: number, parent: number, flag: number): void;
  /** F0x80085DD8(): build the screen root. */
  createRoot(): number;
  advance(): void;
}

/** F0x80083AC0(): the overlay entry constructor. */
export function gymEntryCreate(host: Pick<GymBootHost, "alloc">): number {
  return host.alloc(GYM_BOOT_HANDLER, GYM_BOOT_SIZE, GYM_BOOT_EXTRA);
}

/** F0x80083930(self, arr): the boot task's tick. */
export function gymBootTick(mem: GymBootMemory, self: number, arr: number, host: GymBootHost): void {
  const state = mem.read32(self + 0x0c) | 0;
  if (state !== 0 && state >= 0 && state < 4) return;
  host.displayReset();
  host.displayPacketSize(GYM_PACKET_BYTES);
  host.displayRegion(GYM_SCREEN.width, GYM_SCREEN.height, 0, 0);
  const full = { x: 0, y: 0, w: GYM_SCREEN.width, h: GYM_SCREEN.height };
  const view = host.displayView(full, 3, GYM_VIEWS.screen);
  host.viewColour(view, 0, 0, 0);
  host.displayView({ ...GYM_WINDOW_VIEW }, 3, GYM_VIEWS.window);
  host.displayLink(GYM_VIEWS.window, GYM_VIEWS.screen, 1);
  host.displayView({ ...full }, 3, GYM_VIEWS.top);
  host.displayLink(GYM_VIEWS.top, GYM_VIEWS.window, 1);
  mem.write32(arr, host.createRoot());
  host.advance();
}

/** F0x80086174(): the closing panel object. */
export function gymPanelCreate(
  mem: GymBootMemory, host: { alloc(handler: number, size: number, extra: number): number },
): number {
  const obj = host.alloc(GYM_PANEL_HANDLER, GYM_PANEL_SIZE, 0);
  mem.write32(obj + GYM_PANEL_START_SLOT, GYM_PANEL_START_ENTRY | 0);
  mem.write32(obj + 0x50, 0x1000);
  mem.write32(obj + 0x54, 6);
  return obj;
}
