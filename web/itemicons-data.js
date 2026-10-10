// web/itemicons-data.js — item icon-class (Unknown1.f4 "family") → CMFONTCS
// clip id. Pure data, import-safe under node for tests.
//
// Decoded 2026-07-10 on the Windows PCSX-Redux rig: rewrote the family byte
// (item record +9, base 0x80041838, stride 12) of the 8 on-screen Suzaku Item
// Shop entries through values 2..29 and pixel-matched every rendered icon
// against the extracted cmfont sheet — zero-SAD matches for all 28 values.
// Flat +72 EXCEPT families 13/14, which map down to clips 73/72.
export const FAMILY_TO_CLIP = {
  2: 74, 3: 75, 4: 76, 5: 77, 6: 78, 7: 79, 8: 80, 9: 81, 10: 82, 11: 83,
  12: 84, 13: 73, 14: 72, 15: 85, 16: 86, 17: 87, 18: 88, 19: 89, 20: 90,
  21: 91, 22: 92, 23: 93, 24: 94, 25: 95, 26: 96, 27: 97, 28: 98, 29: 99,
};

// 129781 -> "129'781" — the real BIT display separator (rig-verified).
export function formatBits(n) {
  const s = String(Math.max(0, Math.floor(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}
