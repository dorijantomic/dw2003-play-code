// The options the text pens of web/uifont.ts take.

/** Which sheet a string is painted from: the font's own CLUT row, or a flat colour over the whole sheet. */
export interface UiFontPaintOpts {
  /** the CLUT row of the font sheet (the widget's +0xC0); the game's own text is kind 1, row 0 */
  clut?: number;
  /** a flat tint of the whole sheet instead of the CLUT row */
  color?: string | null;
  /** the font kind (web/uifont.ts kinds: 1 = the small game font) */
  kind?: number;
}

/** One character of the font manifest's charset: the basic ("b") or extended ("e") table, by index. */
export interface UiGlyphEntry {
  i: number;
  t: "b" | "e";
}

/** The cell and pen offsets a widget overrides a glyph's with (web/uifont.ts merges them over the font's own). */
export interface UiGlyphBox {
  /** the advance the pen takes after the glyph */
  adv?: number;
  dx?: number;
  dy?: number;
  h?: number;
  w?: number;
}

/** drawText()/layoutGlyphs() options: the pen, plus the scale and cell metrics of the widget it draws in. */
export interface UiTextDrawOpts extends UiFontPaintOpts {
  /** lay the run out so it ends at x instead of starting there */
  alignRight?: boolean;
  /** the advance the widget uses per glyph (null: the font's own) */
  cellWidth?: number | null;
  /** the widget's own pen offsets per glyph, read from its font resource (null: the font's own) */
  glyphMetrics?: ((key: UiGlyphEntry) => UiGlyphBox) | null;
  scale?: number;
}
