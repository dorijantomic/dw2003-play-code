import type { UiMatrix, UiRect } from "../ui-c/types.js";
/** The script the box reveals: one page per screen, each a list of lines. */
export interface TextboxDialogue {
  pages: string[][];
  /** the speaker's name, when the box shows one */
  name?: string;
}

/** Where the balloon sits this frame: screen position and the tail mode (0-3). */
export interface TextboxAnchor {
  x: number;
  y: number;
  mode: number;
}

export interface TextboxState {
  _key: string;
  advance?: () => void;
  /** per-frame () => {x, y, mode}, or null for the fixed layout */
  anchor: (() => TextboxAnchor) | null;
  currentPage?: () => string[];
  dialogue: TextboxDialogue | null;
  draw?: (ctx: CanvasRenderingContext2D, viewW: number, viewH: number) => void;
  isOpen?: () => boolean;
  isPageFullyShown?: () => boolean;
  onClose: (() => void) | null;
  open?: (dialogue: TextboxDialogue, onClose?: (() => void) | null, anchor?: (() => TextboxAnchor) | null) => void;
  /** seconds since the page opened */
  openT: number;
  pageIdx: number;
  pageLength?: () => number;
  /** characters of the page revealed so far (fractional) */
  shown: number;
  /** the reveal clock, in seconds */
  t: number;
  update?: (dt: number) => void;
}

/** The frame's box in native 320x240 units that look C's overlay draws (web/ui-c/message.ts composeTalk): body, name, typed lines and the more marker. */
export interface TextboxScene {
  body: UiRect | undefined;
  more: TextboxMore | null;
  name: string | null | undefined;
  runs: { text: string; x: number; y: number; kind: number; }[];
}

/** The "more" arrow's part descriptor, handed to composeTalk next to the captured parts. */
export interface TextboxMore {
  part: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rel: UiMatrix;
}
