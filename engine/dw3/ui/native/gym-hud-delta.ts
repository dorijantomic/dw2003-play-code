// The gym screen's draw method, translated from the original pro/stgtrain F0x80084370
// (installed at the screen object's +0x110 by F0x80085DD8).
//
// Oracle: tests/lane-b/gym-hud-delta.test.js runs the original through engine/native with the
// party services, the text source and every widget method stubbed, and compares the ordered calls.
//
// What a player sees. Called with nothing it refills the left-hand partner panel from the
// roster (name, level, HP, MP, the six core stats and the seven element points). Called with a
// snapshot (the session passes the statistics it took when the workout began) it refills the
// same HP, MP, core and element numbers from the roster AFTER the workout and colours each one
// against the snapshot: green when it rose (colour 1), red when it fell (colour 5). HP and MP
// are coloured white (colour 0) when unchanged; the six core and seven element numbers keep
// their colour when unchanged.
import {
  gymHudTextFill, gymStatReadoutsFill, type GymHudHost, type GymHudMemory,
} from "../gym-hud.ts";

const s16 = (v: number): number => (v << 16) >> 16;

/** F0x80084370(screen, snapshot): refill the partner panel, optionally coloured against `snapshot`. */
export function gymHudDeltaFill(
  mem: GymHudMemory, screen: number, snapshot: number, host: GymHudHost, proj: number,
): void {
  const hud = mem.read32(screen + 0x24) >>> 0;
  if (snapshot === 0) {
    gymHudTextFill(mem, screen, hud, 1, host, proj);
    gymStatReadoutsFill(mem, screen, hud, 1, host, proj);
    return;
  }
  const w = (off: number): number => mem.read32(hud + off) >>> 0;
  const slot = host.rosterSlot(mem.read32(screen + 0x68) | 0) | 0;
  host.rosterHandle(slot);
  host.copyProjection(slot, proj);
  const now = (off: number): number => s16(mem.read16(proj + off));
  const was = (off: number): number => s16(mem.read16(snapshot + off));
  host.widgetSetLine0(w(0x0c), host.resolveText(0x10b), 2);
  host.widgetSetLineNumber(w(0x10), 0, now(4));
  host.widgetSetLineNumber(w(0x14), 0, now(6));
  host.widgetMeasure(w(0x10), 1);
  host.widgetMeasure(w(0x14), 1);
  host.widgetSetC0(w(0x14), was(6) < now(6) ? 1 : now(6) < was(6) ? 5 : 0);
  // The original indexes this label's widget with the loop counter left at 3: it lands on the
  // widget at +0x24 (the 0x43 text then overwrites it), not on +0x18 as in F0x80083D10.
  host.widgetSetLine0(w(0x24), host.resolveText(0x10b), 3);
  host.widgetSetLineNumber(w(0x1c), 0, now(8));
  host.widgetSetLineNumber(w(0x20), 0, now(0xa));
  host.widgetMeasure(w(0x1c), 1);
  host.widgetMeasure(w(0x20), 1);
  host.widgetSetC0(w(0x20), was(0xa) < now(0xa) ? 1 : now(0xa) < was(0xa) ? 5 : 0);
  for (const off of [0x24, 0x28]) host.widgetSetLine0(w(off), host.resolveText(0x10b), 0x43);
  if (now(0x26) !== 0) host.widgetSetC0(w(0x2c), 6);
  if (now(0x28) !== 0) host.widgetSetC0(w(0x30), 6);
  if (now(0x2a) !== 0) host.widgetSetC0(w(0x3c), 6);
  const rows = (first: number, count: number, projOff: number): void => {
    for (let i = 0; i < count; i++) {
      host.widgetSetLineNumber(w(first + 4 * i), 0, now(projOff + 2 * i));
      host.widgetMeasure(w(first + 4 * i), 1);
      const before = was(projOff + 2 * i);
      const after = now(projOff + 2 * i);
      if (before < after) host.widgetSetC0(w(first + 4 * i), 1);
      else if (after < before) host.widgetSetC0(w(first + 4 * i), 5);
    }
  };
  rows(0x2c, 6, 0x0c);
  rows(0x44, 7, 0x18);
}
