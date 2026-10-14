// Text in the game's own internal character codes, for strings the disc does not carry (the extra-quests row and page).
//
// The codes are the ones the disc's text banks use (checked against every plain-text line of the dialogue files by
// tools/verify_dialogue_pack.mjs): digits 04..0d, capitals 0e.., lower case 28.., a space is the pair 01 01, and a few
// punctuation marks are 01 xx pairs or single bytes. Characters the game has no code for are left out, never guessed.

const PUNCT: Record<string, readonly number[]> = {
  " ": [0x01, 0x01], ".": [0x01, 0x05], ",": [0x01, 0x04], "'": [0x01, 0x13], "-": [0x01, 0x1a],
  ":": [0x01, 0x07], "\"": [0x01, 0x14], "!": [0xe7], "?": [0xe6],
};

/** One string as the game's character codes (no terminator). */
export function encodeGameText(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (ch >= "0" && ch <= "9") out.push(0x04 + (c - 0x30));
    else if (ch >= "A" && ch <= "Z") out.push(0x0e + (c - 0x41));
    else if (ch >= "a" && ch <= "z") out.push(0x28 + (c - 0x61));
    else if (ch === "’") out.push(...PUNCT["'"]!);
    else if (PUNCT[ch]) out.push(...PUNCT[ch]!);
  }
  return out;
}

/** A text bank image: u32 count, then count u32 offsets (relative to the bank), then NUL-terminated strings. */
export function buildTextBankImage(strings: readonly string[]): Uint8Array {
  const encoded = strings.map((s) => [...encodeGameText(s), 0]);
  const header = 4 + 4 * strings.length;
  const total = header + encoded.reduce((n, e) => n + e.length, 0) + 4;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, strings.length, true);
  let at = header;
  encoded.forEach((e, i) => {
    view.setUint32(4 + i * 4, at, true);
    bytes.set(e, at);
    at += e.length;
  });
  return bytes;
}
