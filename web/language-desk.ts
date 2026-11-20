// web/language-desk.js — the boot language screen, laid out straight: seven rows exist,
// the pad reaches five of them, and the two side rows (USA and JPN) each mean something
// different from what their position suggests.
//
// The screen is cnty_sel, the "select language" screen that runs before the title. Its
// cursor table is seven bytes — 02 03 05 04 06 01 00 — one language index per row, and
// rows 0-4 are the PAL EFIGS in alphabetical order. Rows 5 (USA, on the right) and 6
// (JPN, on the left) live in a side pane whose mode word is written 0 once and never 1,
// so the pad never opens it (docs/research/ui/cnty_sel-full-decode-2026-08-05.md).
//
// What a row changes is a per-screen question, and this desk answers it per language
// against English, the build every number here comes from:
//   * the title menu draws one of seven clip trios (docs/research/ui/
//     stdwtitl-title-menu-2026-08-14.md "Which words, per language"); JPN, USA and
//     English share the 8, 9, 10 trio, and JPN's owner additionally builds a different
//     set of three screen objects, so the Japanese opening is not this sequence;
//   * the END card draws clip 0 for JPN, USA and English, and its own clip for FRA, ITA,
//     GER and SPN (docs/research/ui/end-screen-decoded-2026-08-14.md);
//   * the shared naming keyboard gives the Japanese language index three character
//     pages and every other language one, so its page arrows never appear
//     (docs/research/ui/card-folder-screens-layout.md "The shared name-entry keyboard");
//   * the name plate is picked by FIELD LENGTH, not language: ten boxes = clip 53,
//     five = clip 52 (Japanese names), eight = clip 55 (everybody else).
//
// So the USA row changes no decoded layout branch at all: same title trio, same END
// card, same single keyboard page, same eight-box plate. That is this page's headline,
// not a flaw. JPN is the interesting row, with exactly three branches.
//
// The module is DOM-free so node tests can import it; web/language-desk.html renders it.
// Nothing here is read by the game: the desk is a reference page behind
// F2 -> Extras -> Language desk (off by default), and with that switch off it does not
// exist anywhere in the game.

const CNTY_SEL = "docs/research/ui/cnty_sel-full-decode-2026-08-05.md";
const TITLE = "docs/research/ui/stdwtitl-title-menu-2026-08-14.md";
const END = "docs/research/ui/end-screen-decoded-2026-08-14.md";
const PLATE = "docs/research/ui/card-folder-screens-layout.md";

/** The seven cursor-row -> language-index bytes, in row order. */
export const ROW_TABLE = Object.freeze([2, 3, 5, 4, 6, 1, 0]);

/** The same table as the overlay prints it: `02 03 05 04 06 01 00`. */
export const CURSOR_BYTES = ROW_TABLE.map((b) => b.toString(16).padStart(2, "0")).join(" ");

/**
 * The seven rows the screen draws. `language` is the byte the row writes to the
 * language global (0 JPN, 1 USA, 2 ENG, 3 FRA, 4 ITA, 5 GER, 6 SPN); `code` is the
 * territory name the stage-select tool carries for that byte. Rows 5 and 6 are only
 * reachable through the side pane, which this build never opens.
 */
export const ROWS = Object.freeze([
  { row: 0, language: 2, name: "English", code: "ENG", reachable: true, side: null, source: CNTY_SEL },
  { row: 1, language: 3, name: "French", code: "FRA", reachable: true, side: null, source: CNTY_SEL },
  { row: 2, language: 5, name: "German", code: "GER", reachable: true, side: null, source: CNTY_SEL },
  { row: 3, language: 4, name: "Italian", code: "ITA", reachable: true, side: null, source: CNTY_SEL },
  { row: 4, language: 6, name: "Spanish", code: "SPN", reachable: true, side: null, source: CNTY_SEL },
  { row: 5, language: 1, name: "USA", code: "USA", reachable: false, side: "right", source: CNTY_SEL },
  { row: 6, language: 0, name: "Japanese", code: "JPN", reachable: false, side: "left", source: CNTY_SEL },
]);

/** The title menu's prompt / upper / lower clips, by language index. */
export const TITLE_CLIPS = Object.freeze({
  0: Object.freeze([8, 9, 10]),    // JPN — the same trio as English
  1: Object.freeze([8, 9, 10]),    // USA — the US disc carries clips 0..10 only
  2: Object.freeze([8, 9, 10]),    // ENG — the reference build
  3: Object.freeze([17, 18, 19]),  // FRA
  4: Object.freeze([11, 12, 13]),  // ITA
  5: Object.freeze([20, 21, 22]),  // GER
  6: Object.freeze([14, 15, 16]),  // SPN
});

/** The Japanese build's different opening: a flag and the decode it rests on. */
export const JPN_OPENING = Object.freeze({
  different: true,
  detail:
    "The title screen's owner builds a different set of three screen objects when the language is Japanese, " +
    "so the Japanese release's opening is not the same sequence. The variants were identified by constructor only and not read.",
  source: TITLE,
});

/** The END card's clip, by language index. */
export const END_CLIPS = Object.freeze([0, 0, 0, 2, 3, 1, 2]);

/** What each END clip reads, by language index. */
export const END_WORDS = Object.freeze(["END", "END", "END", "Fin", "Fine", "Ende", "Fin"]);

/** The shared naming keyboard's character-page count, by language index. */
export const NAMEDT_PAGES = Object.freeze({ 0: 3, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 });

/** The name-plate clip, by FIELD LENGTH (not by language). */
export const PLATE_CLIPS = Object.freeze({ 10: 53, 5: 52, 8: 55 });

const jpnBranches = Object.freeze([
  Object.freeze({
    kind: "opening",
    what: "A different opening sequence",
    detail: JPN_OPENING.detail,
    source: JPN_OPENING.source,
  }),
  Object.freeze({
    kind: "keyboard",
    what: "Three pages on the naming keyboard",
    detail:
      "The page count is set by F0x800884e8 before the keyboard is built: the Japanese language index gets three " +
      "character pages, every other language gets one, and the page arrows are drawn only for two or more.",
    source: PLATE,
  }),
  Object.freeze({
    kind: "plate",
    what: "The five-box name plate (clip 52)",
    detail:
      "The Japanese name set is short, so its plate is clip 52 with five boxes. Every other language falls back to " +
      "clip 55 with eight boxes; the ten-box clip 53 belongs to the ten-character folder name and is chosen by " +
      "field length, never by language.",
    source: PLATE,
  }),
]);

/**
 * The layout branches this language takes compared with English, the reference build.
 * Empty for English itself and for USA (the row changes nothing decoded). JPN returns
 * exactly the three above; FRA, ITA, GER and SPN each return their title trio and
 * their END card.
 */
export function branchesFor(language) {
  if (!Number.isInteger(language) || language < 0 || language > 6) return [];
  if (language === 0) return [...jpnBranches];
  if (language === 1 || language === 2) return [];
  const trio = TITLE_CLIPS[language];
  return [
    {
      kind: "title",
      what: "Its own three title-menu words",
      detail:
        `The title menu draws clips ${trio.join(", ")} for this language; English, USA and Japanese draw 8, 9, 10.`,
      clips: [...trio],
      source: TITLE,
    },
    {
      kind: "end",
      what: `Its own END card (clip ${END_CLIPS[language]}, "${END_WORDS[language]}")`,
      detail:
        `The END card is clip ${END_CLIPS[language]} for this language; English, USA and Japanese draw clip 0 (END).`,
      clip: END_CLIPS[language],
      source: END,
    },
  ];
}
