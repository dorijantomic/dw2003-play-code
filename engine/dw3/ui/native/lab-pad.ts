// The lab screens read the pad through the resident pad service the same way every time: fetch a
// word (pressed 0x3F4, held 0x3F8 or auto-repeat 0x3FC), ask the logical-button map for the bit
// (0x408), shift and mask. The call ORDER is part of the contract (the word first, then the bit),
// so every lab port reads through these helpers.
export interface LabPadHost {
  padPressed(): number;
  padHeld(): number;
  padRepeat(): number;
  padBit(logical: number): number;
}

type Word = "padPressed" | "padHeld" | "padRepeat";

/** (host.<word>() >> host.padBit(button)) & 1, in the original's call order. */
export function padBitOf(host: LabPadHost, word: Word, button: number): boolean {
  const value = host[word]() | 0;
  const shift = host.padBit(button) | 0;
  return ((value >> shift) & 1) !== 0;
}
