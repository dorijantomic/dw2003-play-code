export interface SoundTestState {
  cursor: number;
  draw?: (ctx: CanvasRenderingContext2D, W: number, H: number) => void;
  handleKey?: (k: string) => boolean;
  hide?: () => void;
  open: boolean;
  /** the sample or track playing now; null when silent */
  playing: { kind: "sample"; name: string; key: string; } | { kind: "music"; track: string; } | null;
  ready: boolean;
  scroll: number;
  show?: () => void;
  soundCursor: number;
  soundScroll: number;
  stage: "categories" | "sounds";
  status: string;
  tick?: (held: Set<unknown>) => void;
}
