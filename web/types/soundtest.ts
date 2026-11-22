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

/** One sound record of a category (soundtst_catalogue.json): its packed id as hex text, and its name. */
export interface SoundTestSound {
  id: string;
  name: string;
}

/** One VAB category of the catalogue. */
export interface SoundTestCategory {
  category?: number;
  name: string;
  archive_id?: number | string;
  sounds?: SoundTestSound[];
}

/** soundtst_catalogue.json as built by tools/build_soundtst_catalogue.py. */
export interface SoundTestCatalogue {
  categories: SoundTestCategory[];
}

/** One category of the catalogue and whether this build can sound it. */
export interface SoundTestPlayable {
  category: number;
  name: string;
  archiveId: number | string | undefined;
  count: number;
  hasBank: boolean;
  music: boolean;
  available: boolean;
}

/** One row the drawer sees. */
export interface SoundTestRow {
  index: number;
  name: string;
  id: string;
  text: string;
}

/** The sample player: the calls the screen makes on web/audio.ts createSfxPlayer. */
export interface SoundTestSfx {
  stop?: (name: string) => void;
  stopAll?: () => void;
  playBankSound?: (bank: string | null, name: string, opts: { sustain?: boolean }) => string | null | undefined;
}

/** The music player: the play/stop pair. */
export interface SoundTestMusic {
  play?: (track: string) => void;
  stop?: () => void;
}
