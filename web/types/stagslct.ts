/** A launchable row's destination record (web/assets/data/stagslct_ui.json `destinations`). */
export interface StageDestination {
  type: string;
  stage?: number;
  kind?: string;
  name?: string;
}

/** Called with the map id ("s200") of the chosen row and the destination record behind it. */
export type StagePick = (mapId: string, destination: StageDestination) => void;

export interface StageSelectState {
  cursor: number;
  draw?: (ctx: CanvasRenderingContext2D, W: number, H: number) => void;
  handleKey?: (k: string) => boolean;
  hide?: () => void;
  onPick: StagePick | null;
  open: boolean;
  scroll: number;
  show?: (onPick: StagePick | null) => void;
}

/** One row of stagslct_ui.json `menuRows` (an `entry` can be picked; headings, rules and the category tags are only drawn). */
export interface StageMenuRow {
  index?: number;
  kind: string;
  /** the record's launch code as text ("0x1500") */
  type?: string;
  value?: number;
  overlay_label?: string;
  name_jp?: string;
}

/** The layout numbers of stagslct_ui.json `chrome` the screen reads (traced from the overlay's build routine). */
export interface StageChrome {
  header: { title: { x: number; y: number; }; extra?: { x: number; }[]; };
  list: { y_base: number; row_pitch: number; col_left_x: number; col_right_x: number; };
  cursor: { x: number; y_base: number; row_pitch: number; };
  footer: { y: number; slots_x: number[]; };
}

/** assets/data/stagslct_ui.json, the parts the screen reads. */
export interface StageSelectData {
  chrome?: StageChrome | null;
  menuRows?: StageMenuRow[];
  categories?: StageMenuRow[];
  destinations?: StageDestination[];
  identity: { cursor_glyph?: string; header_text_en: string; };
}
