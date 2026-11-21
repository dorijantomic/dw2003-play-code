// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

export interface UiCapturePart {
  /** the clip id without its sheet row ("57" of "57#3") */
  base: number;
  /** where the clip's pixels sit relative to the game's draw position */
  bx: number;
  by: number;
  /** drawClipWidth: the width the game reveals (a gauge fill), null when it drew the whole clip */
  drawW?: number | null;
  h: number;
  /** the pack and the whole id the clip was drawn from ("cmfont", "57#3") */
  id: string;
  /** the clip's sheet layers, piece rects relative to the draw position */
  layers?: UiRect[];
  pack: string;
  /** the context transform the game drew with, relative to the capture's own */
  rel: UiMatrix;
  row: number;
  /** rows the claim covers (a plate that stands for several sheet rows) */
  rows: number;
  w: number;
  /** the game's draw position, in native units */
  x: number;
  y: number;
}

/** One partner ring on the victory / experience page. */
export interface UiSheetRing {
  name: string;
  /** the level before the gain (p.up says whether the page shows lvTo instead) */
  lv: number;
  lvTo: number;
  /** the two ring arcs, as fractions */
  a: number;
  b: number;
  gain: number;
  up: boolean;
  /** the techniques / digivolutions the gain unlocked */
  learned: string[];
  digi: string[];
}

/** The line under a learned-technique / digivolution page: which partner it was and at what level. */
export interface UiLearnLine {
  kind: string;
  partner: string;
  lv: number;
}

export interface UiSheetDef {
  big: string;
  item?: { name: string; qty: string; };
  key: string;
  kind: string;
  layer: string;
  learn?: UiLearnLine;
  num?: number;
  page: string;
  part: string;
  rect: UiRect;
  /** the party's rings (the experience page) */
  rings?: UiSheetRing[];
  small: string;
  sx: number;
  sy: number;
  /** someone on the page levelled up */
  up?: boolean;
}

// --------------------------------------------------------------------------------- look C kit: descriptors and options (web/ui-c)
// The kit is a pure descriptor generator: base.js composes parts, list.js / parts.js build the DOM. Type the
// descriptor once here (parts.ts reads the members by `kind`) instead of repeating the shape per composer.

/** The native -> page px matrix of a draw call (the game's folds and slides ride in it; a scale-only matrix sets a / d alone). */
export interface UiMatrix {
  a: number;
  d: number;
  e?: number;
  f?: number;
}

/** A rect: native units (320 x 240) or page px, as the caller says. */
export interface UiRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One run of native text on the captured page: the string and where the game drew it, in native units. */
export interface UiRun {
  text: string;
  x: number;
  y: number;
  /** the width the game gave the run, when it gave one */
  w?: number;
  /** the face byte the run was drawn with */
  face?: number | null;
  [field: string]: unknown;
}

/** The visible stage in native units. */
export interface UiStage {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The balloon tail (C6): the body edge it hangs from, its base span along that edge and its tip. */
export interface UiBalloonTail {
  side: string;
  b0: number;
  b1: number;
  tip: number[];
}

/**
 * One part of a composed screen: what base.js emits and parts.js builds. `kind` picks the members that matter
 * (text / plate / band / bar / svg / stripes / balloon / ring / dock / pop / node / wall / wash ...); the rest
 * stay unset. Every field is in native units unless the name says Dp (design px) or Vw / Vh (viewBox).
 */
export interface UiPart {
  key: string;
  kind: string;
  part?: string;
  layer?: string;
  rect?: UiRect;
  sx?: number;
  sy?: number;
  // text
  role?: string;
  text?: string;
  sizeDp?: number;
  lineDp?: number;
  spacingDp?: number;
  maxDp?: number;
  color?: string | null;
  align?: string;
  cls?: string;
  // plate / band / wall
  shape?: string;
  edge?: string;
  body?: string | null;
  shadow?: number;
  underEdge?: string;
  tabW?: number;
  dividers?: number[];
  full?: boolean;
  // svg / icon
  vw?: number;
  vh?: number;
  d?: string;
  fill?: string;
  rule?: string;
  svg?: string;
  // bar
  track?: string;
  ratio?: number;
  slant?: number;
  dir?: string;
  state?: string;
  // bracket
  arrows?: number[];
  // stripes / type word
  scroll?: number;
  light?: string;
  dark?: string;
  vertical?: boolean;
  fit?: boolean;
  // balloon
  inner?: UiRect;
  tail?: UiBalloonTail | null;
  // ring
  variant?: string;
  menu?: boolean;
  act?: boolean;
  real?: number;
  eReal?: number;
  mpPrev?: number;
  hp?: number;
  mp?: number;
  dv?: number;
  dvFull?: boolean;
  down?: boolean;
  // command dock
  hub?: { x: number; y: number };
  k?: number;
  R?: number;
  dockR?: number;
  dock?: { x: number; y: number };
  words?: UiDockRow[];
  on?: number;
  list?: boolean;
  scale?: number;
  title?: string;
  pager?: boolean;
  // damage pop / turn node
  n?: number | string;
  side?: string;
  /** the damage pop's own options (the pop part) */
  o?: UiPopOpts;
  evt?: string;
  turn?: string;
  letter?: string;
  nb?: boolean;
}

/**
 * Text options: what textPart takes, plus the members the kit's helpers may add (a run's role and size, an
 * explicit rect, the right edge / width a line is fitted into).
 */
export interface UiTextOpts {
  role?: string;
  sizeDp?: number;
  lineDp?: number;
  color?: string | null;
  align?: string;
  spacing?: number;
  maxDp?: number;
  rel?: UiMatrix;
  cls?: string;
  rect?: UiRect;
  right?: number;
  w?: number;
  wDp?: number;
}

/** Plate options: the shape name (parts.ts plateShape), edge / body colours, drop shadow and layer. */
export interface UiPlateOpts {
  part?: string;
  shape?: string;
  edge?: string;
  body?: string | null;
  shadow?: number;
  layer?: string;
  underEdge?: string;
}

/** The HP / MP ring options: the live state the ring shows besides its numbers. */
export interface UiRingOpts {
  act?: boolean;
  real?: number;
  eReal?: number;
  mpPrev?: number;
}

/** One row of the command dock: its word, where it sits, its width and its chip / element / disabled state. */
export interface UiDockRow {
  t: string;
  x: number;
  y: number;
  maxDp: number;
  chip?: string;
  el?: string;
  r?: string;
  dis?: boolean;
}

/** The command dock options: a list of rows, its title and the L1 / R1 pager. */
export interface UiDockOpts {
  rows?: UiDockRow[];
  title?: string;
  pager?: boolean;
}

/** The generic composer's cfg: the wash behind the page, the faint word (where and how big) and the run roles. */
export interface GenericOpts {
  wash?: boolean;
  word?: string | null;
  wordX?: number;
  wordY?: number;
  /** the text options a run takes (its role and size) */
  roles?: (run: UiRun) => UiTextOpts;
}

/** A book screen's cfg (books.js): a free cursor instead of rows, the faint word, the dim clut row. */
export interface BookOpts {
  rows?: boolean;
  word?: string | null;
  dimClut?: boolean;
}

/** The talk box (C6): the opening outline lines, the balloon rect when the game draws no pieces, the speaker's name. */
export interface TalkOpts {
  lines?: { points: number[]; }[];
  body?: UiRect | null;
  tail?: UiBalloonTail | null;
  name?: string | null;
}

/** The sidebar page's cfg (pages.js composePausePage): the faint word, the wall override, the screen's own parts. */
export interface PausePageOpts {
  used?: Set<UiRun>;
  wall?: boolean;
  word?: string | null;
  wordAt?: { x: number; y: number; };
  wordDp?: number;
  /** the screen's own parts, composed after the page's */
  extra?: (parts: UiCapturePart[], runs: UiRun[], used: Set<UiRun>, out: UiPart[]) => void;
}

/** One bar quad of the place card (C6b): the game's rect and its paint colour (an rgb triple). */
export interface PlaceCardQuad {
  x: number;
  y: number;
  w: number;
  h: number;
  colour?: number[];
  color?: number[];
}

/** One name line of the place card: the area (above) or the place, at the game's pen. */
export interface PlaceCardName {
  text: string;
  x: number;
  y: number;
}

/** The place card's scene: the bars the game paints this frame and the two names. */
export interface PlaceCardScene {
  quads?: PlaceCardQuad[];
  names?: PlaceCardName[];
}

/** The damage pop: what the number is and how it reads. */
export interface UiPopOpts {
  kind?: string;
  tone?: string;
  tag?: string;
  status?: string;
  text?: string;
  evt?: string;
}
