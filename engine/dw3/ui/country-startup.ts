// cnty_sel F0x80082CE8, the lifecycle around the selection task.
// Original: asm/dw2003/pro/cnty_sel.s:21–127; UI-SCENE-OBJECT-IS-A-PHANTOM-2026-08-21
// identifies the apparent "scene" calls as audio services.
import { advance0 } from "./task-object.ts";
import type { TaskState } from "./task-object.ts";

export interface CountryDisplaySetup {
  packetBytes: number;
  width: number;
  height: number;
  textureOrigin: readonly [number, number];
  paletteOrigin: readonly [number, number];
  texture: number;
  rectangles: number;
  rectangleCount: number;
  target: number;
  clear: readonly [number, number, number];
}

export interface CountryStartupHost {
  audioPending(): number;
  /** Reset/configure the display, upload the atlas, and create its surface.
   * The browser fulfills this using the extracted atlas and canvas; packet
   * allocation and video-memory upload are platform operations, not game code.
   */
  prepareDisplay(setup: CountryDisplaySetup): void;
  createScreen(): void;
  playSound(id: number): void;
  stopSound(id: number): void;
}

export function countryScreenStartupTick(state: TaskState, host: CountryStartupHost): void {
  if (state.state0 === 1 || state.state0 === 2) return;
  if (state.state0 === 3) { host.stopSound(0x60840002); return; }
  if (host.audioPending() !== 0) return;
  host.prepareDisplay({
    packetBytes: 0xa000, width: 0x140, height: 0xf0,
    textureOrigin: [0x280, 0], paletteOrigin: [0, 0x1f0], texture: 0x08a30001,
    rectangles: 0x800843c0, rectangleCount: 3, target: 0x100, clear: [31, 31, 31],
  });
  host.createScreen();
  advance0(state);
  host.playSound(0x60840002);
}
