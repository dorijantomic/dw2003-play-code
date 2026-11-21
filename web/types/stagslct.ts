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
