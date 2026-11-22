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
  /** the face colour the run was drawn with (a CSS colour string), null when none */
  face?: string | null;
  /** the right edge the run is anchored to, when it is right-aligned */
  right?: number | null;
  /** the text widget kind the game drew the run with (1 = label, 3 = small label / number) */
  kind?: number;
  /** the colour table row of the game text (7 = dim) */
  clut?: number;
  /** the pen x of each character, when the run carries them (uifont.ts drawText) */
  glyphs?: { ch: string; x: number; }[];
}

/** The page transform of a claimed clip: an identity matrix (only translation-free placements accepted by applyRel). */
export type UiFooterRel = UiMatrix;

/** One link of the map book: from (x0, y0) to (x1, y1), and whether both ends are areas the player has seen. */
export type UiLinkSeg = readonly [number, number, number, number, boolean?];

/** A claimed capture clip as the screens hand it to the composers: a drawable part plus the clip's position, size, layers and row, its page transform and the part name the claim gave it. */
export type UiClaimedPart = { segs?: readonly UiLinkSeg[]; } & Omit<Partial<UiPart>, "part" | "rel"> & Partial<Omit<UiClaim, "part" | "layers">> & Partial<Omit<UiCapturePart, "x" | "y" | "w" | "h" | "bx" | "by" | "rel">> & { part: string; rel: UiFooterRel; x: number; y: number; w: number; h: number; bx: number; by: number };

/** One partner's progress record of the fight report (read-only look data). */
export interface UiReportProgress {
  index?: number;
  levelUp?: boolean;
  oldLevel?: number;
  newLevel?: number;
  ringA?: number;
  ringB?: number;
  xp?: number;
  /** the techniques learned (strings or { name }) */
  learnedTechs?: unknown;
  /** the digivolutions unlocked (strings or { name }) */
  unlocked?: unknown;
}

/** The read-only look data of the fight report (fightreport-translated.ts reportView). */
export interface UiReportView {
  progress?: UiReportProgress[];
  reward?: { droppedItem?: { name?: unknown; } | null; } | null;
  rows?: { levelUp?: boolean; target?: number; }[];
  partners?: { pos: number; name?: unknown; level?: number; preExp?: number; participated?: boolean; }[];
}

/** The fight report composer's options: the look data (the Data Burst victory) and the highlight's colour cycle. */
export interface UiReportCfg {
  view?: UiReportView | undefined;
  pulse?: ((row: number) => string) | undefined;
}

/** What the fight report composer reads: the frame's parts and runs, the visible stage when the scope has one. */
export type UiReportContext = UiScreenContext & { stage?: UiStage | undefined };

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
  tip: [number, number];
}

/**
 * One part of a composed screen: what base.js emits and parts.js builds. `kind` picks the members that matter
 * (text / plate / band / bar / svg / stripes / balloon / ring / dock / pop / node / wall / wash ...); the rest
 * stay unset. Every field is in native units unless the name says Dp (design px) or Vw / Vh (viewBox).
 */
export interface UiPart {
  key: string;
  kind: string;
  part?: string | undefined;
  layer?: string | undefined;
  rect?: UiRect | undefined;
  sx?: number | undefined;
  sy?: number | undefined;
  // text
  role?: string | undefined;
  text?: string | undefined;
  sizeDp?: number | undefined;
  lineDp?: number | undefined;
  spacingDp?: number | undefined;
  maxDp?: number | undefined;
  color?: string | null | undefined;
  align?: string | undefined;
  cls?: string | undefined;
  // plate / band / wall
  shape?: string | undefined;
  edge?: string | undefined;
  body?: string | null | undefined;
  shadow?: number | undefined;
  underEdge?: string | undefined;
  tabW?: number | undefined;
  dividers?: number[] | undefined;
  full?: boolean | undefined;
  // svg / icon
  vw?: number | undefined;
  vh?: number | undefined;
  d?: string | undefined;
  fill?: string | undefined;
  rule?: string | undefined;
  svg?: string | null | undefined;
  // bar
  track?: string | undefined;
  ratio?: number | undefined;
  slant?: number | undefined;
  dir?: string | undefined;
  state?: string | undefined;
  // bracket
  arrows?: number[] | undefined;
  // stripes / type word
  scroll?: number | undefined;
  light?: string | undefined;
  dark?: string | undefined;
  vertical?: boolean | undefined;
  fit?: boolean | undefined;
  // balloon
  inner?: UiRect | undefined;
  tail?: UiBalloonTail | null | undefined;
  // ring
  variant?: string | undefined;
  menu?: boolean | undefined;
  act?: boolean | undefined;
  real?: number | undefined;
  eReal?: number | undefined;
  mpPrev?: number | null | undefined;
  hp?: number | undefined;
  mp?: number | undefined;
  dv?: number | undefined;
  dvFull?: boolean | undefined;
  down?: boolean | undefined;
  // command dock
  hub?: { x: number | undefined; y: number };
  k?: number | undefined;
  R?: number | undefined;
  dockR?: number | undefined;
  dock?: { x: number | undefined; y: number };
  words?: UiDockRow[] | undefined;
  on?: number | undefined;
  list?: boolean | undefined;
  scale?: number | undefined;
  title?: string | undefined;
  pager?: boolean | undefined;
  // damage pop / turn node
  n?: number | string | undefined;
  side?: string | undefined;
  /** the damage pop's own options (the pop part) */
  o?: UiPopOpts | undefined;
  evt?: string | undefined;
  turn?: string | undefined;
  letter?: string | undefined;
  nb?: boolean | undefined;
}

/**
 * Text options: what textPart takes, plus the members the kit's helpers may add (a run's role and size, an
 * explicit rect, the right edge / width a line is fitted into).
 */
export interface UiTextOpts {
  role?: string | undefined;
  sizeDp?: number | undefined;
  lineDp?: number | undefined;
  color?: string | null | undefined;
  align?: string | undefined;
  spacing?: number | undefined;
  maxDp?: number | undefined;
  rel?: UiMatrix | undefined;
  cls?: string | undefined;
  rect?: UiRect | undefined;
  right?: number | undefined;
  w?: number | undefined;
  wDp?: number | undefined;
}

/** Plate options: the shape name (parts.ts plateShape), edge / body colours, drop shadow and layer. */
export interface UiPlateOpts {
  part?: string | undefined;
  shape?: string | undefined;
  edge?: string | undefined;
  body?: string | null | undefined;
  shadow?: number | undefined;
  layer?: string | undefined;
  underEdge?: string | undefined;
}

/** The HP / MP ring options: the live state the ring shows besides its numbers. */
export interface UiRingOpts {
  act?: boolean | undefined;
  real?: number | undefined;
  eReal?: number | undefined;
  mpPrev?: number | null | undefined;
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

/** One row of an arc list (the techniques, the items, the Tag partners): the word, the chip, the element, the right-hand text, the cost and whether the game's marker is on it. */
export interface UiDockListRow {
  t: string;
  chip?: string;
  el?: string;
  r?: string;
  dis?: boolean;
  on: boolean;
  cost?: number;
}

/** The command dock options: a list of rows, its title and the L1 / R1 pager. */
export interface UiDockOpts {
  rows?: UiDockListRow[];
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
  extra?: (parts: UiClaimedPart[], runs: UiRun[], used: Set<UiRun>, out: UiPart[]) => void;
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
export interface PlaceCardNameLine {
  text: string;
  x: number;
  y: number;
}

/** The place card's scene: the bars the game paints this frame and the two names. */
export interface PlaceCardScene {
  quads?: PlaceCardQuad[];
  names?: PlaceCardNameLine[];
}

/** The damage pop: what the number is and how it reads. */
export interface UiPopOpts {
  kind?: string | undefined;
  tone?: string | undefined;
  tag?: string | undefined;
  status?: string | undefined;
  text?: string | undefined;
  evt?: string | undefined;
}

/** The three containers of a scope's layer, bottom to top (the art canvas sits between under and over). */
export type UiLayerName = "under" | "over" | "text";

/** One draw call of a translated session's recorded picture list (engine ShopDrawCall): the method and its numbers. */
export interface UiDrawCall {
  method: string;
  args: number[];
}

/** What the game's claims table says about one clip (claims.ts): the part it becomes and where, plus the options the capture reads. */
export interface UiClaim {
  part: string;
  layer: string;
  shape?: string;
  /** a clip that is a list panel: its row count */
  rows?: number;
  /** the capture hands the part the clip's sheet layers */
  layers?: boolean;
  /** the clip's own pixels stay on the art canvas under the part */
  keepArt?: boolean;
  /** [w, h] sizes of the little pictures inside the frame that stay the game's pixels */
  artSizes?: readonly (readonly [number, number])[];
  /** native px cut off the clip's bounds on each side ([left, top, right, bottom]): the area that stays pixels */
  artInset?: readonly [number, number, number, number];
  side?: string;
  state?: string;
  box?: readonly [number, number, number, number];
}

/** The numbers a battle ring shows (the party member's live values): HP / MP, the DV gauge, name and level. */
export interface UiRingValues {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  gauge?: number;
  maxGauge?: number;
  name?: string;
  level?: number | string;
}

/** One enemy of the battle HUD (the owner's read-only data). */
export interface UiBattleFoe {
  name?: unknown;
  level?: unknown;
  hp: number;
  maxHp: number;
}

/** The read-only hit note of the battle (battle.ts noteHit): the blow the pop may take its flags from. */
export interface UiBattleHit {
  kind?: string;
  hit?: boolean;
  dmg?: number;
  eff?: number;
  crit?: boolean;
  seq?: number;
}

/** What the battle owner hands the HUD as the "battleData" part (battle/core/hud.ts): the ring numbers plus the state the menus and the enemy block read. */
export interface UiBattleData extends UiRingValues {
  /** the game's battle state (6 = the enemy acts, 13 / 15 = the DV / DNA pickers, ...) */
  st: number;
  hpReal?: number;
  eHpReal?: number;
  hitNote?: UiBattleHit | null;
  pFirst?: boolean;
  /** the enemy's place on the screen (fractions), when the renderer knows it */
  eScr?: { x: number; topY: number; footY: number; } | null;
  /** false = no picture in the close-up this frame */
  face?: boolean;
  enemy?: UiBattleFoe;
  foes?: UiBattleFoe[];
  others?: UiRingValues[];
  techTop?: number;
  techs?: { name: string; element?: unknown; cost: number; }[];
  free?: boolean;
  itemTop?: number;
  items?: { name: string; qty: number; }[];
}

/** The enemy's HP bar as the owner hands it to partHook: `full` is the bar's full width (not the part-is-full-screen flag), the colour pair is optional. */
export interface UiHpBarHook {
  full: number;
  colors?: readonly [string, string];
}

/** A damage / heal / miss / counter / status pop typed from the game's own line (battlehud.ts classifyPop). */
export interface UiPopClass {
  kind: string;
  side: string;
  n: number;
  tone?: string;
  tag?: string;
  status?: string;
  evt: string;
}

/** The two ring sizes of the battle HUD: the main ring (the active partner) and the mini rings. */
export type UiRingVariant = "main" | "mini";

/** The ring's core text row: [x, y, w, lineHeight, size] in design px inside the ring's own box. */
export type UiRingTextRow = readonly [number, number, number, number, number];

/** One ring size in design px (see base.ts RING): box side, the arcs' [radius, width], the core disc radius, the text rows. */
export interface UiRingShape {
  vb: number;
  dvR: number;
  hp: readonly number[];
  mp: readonly number[];
  core: number;
  ticks: number;
  text: Readonly<Record<string, UiRingTextRow>>;
}

/** Where the command dock hangs: the ring's centre and radius (native), or a scale of the default radius. */
export interface UiDockHub {
  cx: number;
  cy: number;
  R?: number;
  k?: number;
}

/** A part the game paints with plain canvas calls (partHook): the native rect and the owner's own data, whatever the part needs. */
export interface UiHookPart {
  part: string;
  x: number;
  y: number;
  w: number;
  h: number;
  // ETS item 42: the owner's own data (a bar's ratio, a map's links ...) is read by the composer of that part by name
  [field: string]: unknown;
}

/** A clip the capture scope claimed (part and layer from the claim) or a part an owner handed to partHook. */
export interface UiScopeClaimed {
  pack: string | null;
  id: string;
  part: string;
}

/** A clip the capture scope did not claim: it is art; `flat` = big enough to be a plate that is missing from claims.ts. */
export interface UiScopeUnclaimed {
  pack: string | null;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  listed: boolean;
  flat: boolean;
}

/** One open capture scope (capture.ts): what the clip hooks recorded between begin() and end(). */
export interface UiCaptureScope {
  key: string;
  ctx: CanvasRenderingContext2D;
  m0: Required<UiMatrix>;
  getArt: () => CanvasRenderingContext2D | null;
  parts: UiClaimedPart[];
  runs: UiRun[];
  unclaimed: UiScopeUnclaimed[];
  claimed: UiScopeClaimed[];
  arts: number;
  inArt: boolean;
  domText: number;
  texts: boolean;
}

/** What the screens hand a composer: the claimed clips of the frame (in draw order) and the text runs of the scope. */
export interface UiScreenContext {
  parts: UiClaimedPart[];
  runs: UiRun[];
}

/** A screen composer: the frame's claimed clips and runs in, the part descriptors (native space, paint order) out. */
export type UiCompose = { compose(c: UiScreenContext): UiPart[]; }["compose"];

/** The pause screen that is up: its id and the composer that builds it. */
export interface UiPauseScreen {
  id: string;
  compose: UiCompose;
}

// The four parts that have their own builders (parts.ts): a part of that kind always carries these members (base.ts builds it with them).

/** A battle ring (kind "ring", base.ringPart). */
export interface UiRingPart extends UiPart {
  part: string;
  variant: string;
  menu: boolean;
  hp: number;
  mp: number;
  dv: number;
  dvFull: boolean;
  down: boolean;
  readonly mpPrev?: number | undefined;
}

/** The command dock (kind "dock", base.dockPart). */
export interface UiDockPart extends UiPart {
  part: string;
  rect: UiRect;
  hub: { x: number; y: number };
  dock: { x: number; y: number };
  words: UiDockRow[];
  on: number;
}

/** The damage pop (kind "pop", base.popPart). */
export interface UiPopPart extends UiPart {
  part: string;
  side: string;
}

/** A turn-arc node (kind "node", base.turnNode). */
export interface UiNodePart extends UiPart {
  part: string;
  side: string;
  turn: string;
  letter: string;
}

/** The visible stage in native units plus what the screens hand a composer: the context a scope's `compose` receives. */
export type UiScopeContext = UiScreenContext & { stage: UiStage };

/**
 * A screen composer. Declared as a method inside an object type so its parameter is checked both ways (the bivariance hack): the screens
 * name the part of the context they read (a pause page needs claimed parts, the place card only its runs) and are still accepted here.
 */
export type UiComposer = { compose(c: UiScopeContext): UiPart[]; }["compose"];

/** The options of a capture scope (index.ts scope): whether look C is on for it, its composer, the dim, the clip slit, the texts flag. */
export interface UiScopeOpts {
  enable?: boolean | undefined;
  compose?: UiComposer | undefined;
  dim?: number | undefined;
  /** a native rect the whole layer is cut to (the place card slit) */
  clip?: UiRect | null | undefined;
  /** the scope sits over the battle (its own HUD): never covered */
  top?: boolean | undefined;
  /** the scope also takes plain drawText() calls as runs */
  texts?: boolean | undefined;
}
