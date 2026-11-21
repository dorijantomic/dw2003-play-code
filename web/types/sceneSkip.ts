/** One beat of the story spine the skipper lists (debug_spine.json): its master ordinal and the scenes it carries. */
export interface SceneSkipBeat {
  ordinal: number;
  ordHex: string;
  stage: string;
  name: string;
  /** the flags this beat clears so its scenes can fire again */
  clearFlags: string[];
  /** the actors to talk to after the jump */
  sayActors: string[];
  eventCount?: number;
}

/** What jump() reports: why it did not move, or the beat it landed on. */
export interface SceneSkipJump {
  ok: boolean;
  why?: string;
  beat?: SceneSkipBeat;
  ordinal?: number;
}

export interface SceneSkipState {
  drawOverlay?: (ctx: CanvasRenderingContext2D, W: number, H: number) => void;
  enabled: boolean;
  handleKey?: (k: string) => boolean;
  jump?: (i: number, ordOverride?: number) => SceneSkipJump;
  list?: () => SceneSkipBeat[];
  msg: string | null;
  ordAdj: number;
  ready: boolean;
  sel: number;
  spine: SceneSkipBeat[];
  talkActors?: (i: number) => string[];
  toggle?: () => void;
  top: number;
}
