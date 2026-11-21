export interface ChoicePrompt {
  /** the callback the picked row goes to, null while the box is down */
  _onSelect: ((index: number) => void) | null;
  confirm?: () => void;
  cursorIdx: number;
  draw?: (ctx: CanvasRenderingContext2D, viewW: number, viewH: number) => void;
  isOpen?: () => boolean;
  moveDown?: () => void;
  moveUp?: () => void;
  open?: (prompt: string, options: string[], onSelect: (index: number) => void) => void;
  options: string[];
  prompt: string;
}

/** One line of text the Yes / No box draws: the prompt, an option row, or the [enter] cursor row. */
export interface ChoiceRun {
  text: string;
  x: number;
  y: number;
  kind: number;
}
