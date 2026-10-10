// The Digimon lab's boot chain, its closing fade and the root's four small methods,
// translated from the original pro/stgdglab bodies.
//
// Oracle: tests/lane-b/lab-boot.test.js runs each original through engine/native and compares
// the ordered boundary calls and the fields.
//
//   F0x80083040 labEntryCreate    overlay entry: factory(handler F0x80082F48, 0x50, extra 4).
//               (the m2c list omits it; disassembled 2026-10-01 from the overlay image)
//   F0x80082F48 labBootTick       boot task. In state 0, a negative state or a state of 4 or
//               more it resets the display service (+0x150), sizes the packet buffers (+0x154,
//               0xF000), sets the region (+0x174: 0x140 x 0xF0), registers one full-screen view
//               through +0x16C (rect, kind 3, priority 0x1000), clears its colour to black
//               through view+0x12C, builds the lab root F0x8008EFD0 into extra word 0 and
//               advances itself; states 1..3 idle.
//   F0x800832EC labFadeCreate     the closing panel: factory(handler F0x80083238, 0x68, extra 0),
//               start method +0x64 = F0x8008306C, layer +0x50 = 0x1000, bucket +0x54 = 6.
//   F0x8008306C / F0x80083238 / F0x800830F4 are the fight report's fade start, tick and dim quad
//               (native/fight-report-fade.ts); tests/lane-b/lab-boot.test.js proves that against
//               the lab addresses.
//   F0x8008EEA0 / F0x8008EEFC / F0x8008EF58 / F0x8008EF8C   root methods +0x68 / +0x6C / +0x70 /
//               +0x78: open and close the Select Action pane when it is live, report whether it
//               is live, and start the closing fade (30 frames toward full).
import type { ReportBootHost } from "./fight-report-boot.ts";

export const LAB_ENTRY = 0x80083040;
export const LAB_BOOT_HANDLER = 0x80082f48;
export const LAB_BOOT_SIZE = 0x50;
export const LAB_BOOT_EXTRA = 4;
export const LAB_FADE_HANDLER = 0x80083238;
export const LAB_FADE_SIZE = 0x68;
export const LAB_FADE_START_ENTRY = 0x8008306c;
export const LAB_FADE_START_SLOT = 0x64;
export const LAB_PACKET_BYTES = 0xf000;
export const LAB_SCREEN = { width: 0x140, height: 0xf0 } as const;
export const LAB_VIEW_PRIORITY = 0x1000;
export const LAB_FADE_FRAMES = 0x1e;

export interface LabBootMemory {
  read32(addr: number): number;
  write32(addr: number, value: number): void;
}

export interface LabBootHost extends Omit<ReportBootHost, "advance"> {
  /** F0x8008EFD0(): build the lab root. */
  createRoot(): number;
  advance(): void;
}

/** F0x80083040(): the overlay entry constructor. */
export function labEntryCreate(host: Pick<LabBootHost, "alloc">): number {
  return host.alloc(LAB_BOOT_HANDLER, LAB_BOOT_SIZE, LAB_BOOT_EXTRA);
}

/** F0x80082F48(self, arr): the boot task's tick. */
export function labBootTick(mem: LabBootMemory, self: number, arr: number, host: LabBootHost): void {
  const state = mem.read32(self + 0x0c) | 0;
  if (state !== 0 && state >= 0 && state < 4) return;
  host.displayReset();
  host.displayPacketSize(LAB_PACKET_BYTES);
  host.displayRegion(LAB_SCREEN.width, LAB_SCREEN.height, 0, 0);
  const view = host.displayView({ x: 0, y: 0, w: LAB_SCREEN.width, h: LAB_SCREEN.height }, 3, LAB_VIEW_PRIORITY);
  host.viewColour(view, 0, 0, 0);
  mem.write32(arr, host.createRoot());
  host.advance();
}

/** F0x800832EC(): the closing fade panel object. */
export function labFadeCreate(
  mem: LabBootMemory, host: { alloc(handler: number, size: number, extra: number): number },
): number {
  const obj = host.alloc(LAB_FADE_HANDLER, LAB_FADE_SIZE, 0);
  mem.write32(obj + LAB_FADE_START_SLOT, LAB_FADE_START_ENTRY | 0);
  mem.write32(obj + 0x50, 0x1000);
  mem.write32(obj + 0x54, 6);
  return obj;
}

export interface LabRootMethodHost {
  /** target+slot(target): an object method through its own table. */
  callMethod(target: number, slot: number, args: number[]): void;
  /** F0x800832EC(): the fade panel. */
  createFade(): number;
}

/** The Select Action pane the root holds in extra word 0, when it is live (state 1), else 0. */
function livePane(mem: LabBootMemory, root: number): number {
  const pane = mem.read32(mem.read32(root + 0x24)) >>> 0;
  return pane !== 0 && (mem.read32(pane + 0x0c) | 0) === 1 ? pane : 0;
}

/** F0x8008EEA0 (root +0x68): fold the live pane open again through its +0x114. */
export function labRootShowPane(mem: LabBootMemory, root: number, host: Pick<LabRootMethodHost, "callMethod">): number {
  const pane = livePane(mem, root);
  if (pane === 0) return 0;
  host.callMethod(pane, 0x114, []);
  return 1;
}

/** F0x8008EEFC (root +0x6C): fold the live pane shut through its +0x118. */
export function labRootHidePane(mem: LabBootMemory, root: number, host: Pick<LabRootMethodHost, "callMethod">): number {
  const pane = livePane(mem, root);
  if (pane === 0) return 0;
  host.callMethod(pane, 0x118, []);
  return 1;
}

/** F0x8008EF58 (root +0x70): 1 while the pane is live. */
export function labRootPaneLive(mem: LabBootMemory, root: number): number {
  return livePane(mem, root) !== 0 ? 1 : 0;
}

/** F0x8008EF8C (root +0x78): build the fade into extra word 2 and start it toward full over 30 frames. */
export function labRootStartFade(mem: LabBootMemory, root: number, host: LabRootMethodHost): void {
  const extra = mem.read32(root + 0x24) >>> 0;
  const fade = host.createFade() >>> 0;
  mem.write32(extra + 8, fade);
  host.callMethod(fade, LAB_FADE_START_SLOT, [0, LAB_FADE_FRAMES]);
}
