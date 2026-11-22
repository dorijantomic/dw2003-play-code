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

/** One colour of a CLUT row: [r, g, b, a]. */
export type UiClutColor = [number, number, number, number];

/** One CLUT row of a font kind: its colours in slot order. */
export type UiClutRow = UiClutColor[];

/** One font kind's CLUT rows, keyed by the row number. */
export interface UiClutKind {
  rows?: Record<string, UiClutRow | undefined>;
}

/** `uifont.json`'s `cluts`: the CLUT rows of every font kind, keyed by the kind number. */
export type UiClutTable = Record<string, UiClutKind | undefined>;

/** One glyph's rect on the sheet and its pen offsets (dx/dy to the cell, adv the advance after it). */
export interface UiFontGlyph {
  x: number;
  y: number;
  w: number;
  h: number;
  adv?: number;
  dx?: number;
  dy?: number;
}

/** One font kind's two glyph tables, keyed by the index of the charset entry. */
export interface UiFontFace {
  basic: Record<string, UiFontGlyph | undefined>;
  ext: Record<string, UiFontGlyph | undefined>;
}

/** A named icon's rect on the sheet. */
export interface UiFontIcon {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** assets/ui/uifont.json, the shipped font manifest. */
export interface UiFontManifest {
  chars: Record<string, UiGlyphEntry | undefined>;
  kinds: Record<string, UiFontFace | undefined>;
  cluts?: UiClutTable;
  icons?: Record<string, UiFontIcon | undefined>;
}

/** One glyph of a laid-out string: the character, the pen before it and its dx. */
export interface UiGlyphPen {
  ch: string;
  x: number;
  dx: number;
}
