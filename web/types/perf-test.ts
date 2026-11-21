// Types for web/perf-test.ts: the perf lab's environment, its recorder, and the rows it writes.

/** One measured distribution (web/perf-test.ts stats()): empty runs carry only n. */
export interface PerfStats {
  avg?: number;
  best?: number;
  median?: number;
  /** the sample count; 0 when nothing was measured */
  n: number;
  p95?: number;
  p99?: number;
  sum?: number;
  worst?: number;
}

/** The gl report of the page the lab runs in (web/perf-test.ts glInfo). */
export interface PerfTestEnv {
  error?: string;
  renderer: string | null;
  renderString?: string;
  unmaskedRenderer: string | null;
  unmaskedVendor: string | null;
  vendor: string | null;
  version: string | null;
  webgl2: boolean;
}

/** The canvas call probe of one scene (web/perf-test.ts probeCalls). */
export interface PerfCallProbe {
  battleLayerHiddenFrames: number;
  battleLayerMissingFrames: number;
  battleLayerShownFrames: number;
  drawImageBySource: { callsPerGameFrame: number | null; msPerGameFrame: number | null; source: string; }[];
  gameFrames: number;
  msPerGameFrame: Record<string, number | null>;
  /** 2D call counts per game frame, keyed "<method>_perGameFrame" */
  perGameFrame: Record<string, number | null>;
  seconds: number;
  unknownCanvasDrawImage: { calls: number; callsPerGameFrame: number | null; sourceSizes: { calls: number; size: string; }[]; };
  webglDrawImage: { calls: number; callsPerGameFrame: number | null; msPerCall: number | null; msPerGameFrame: number | null; sourceSizes: { calls: number; size: string; }[]; worstCallMs: number; };
}

/** One 3D hook of the battle renderer (per-game-frame call counts, web/perf-test.ts wraps them). */
export interface PerfHookRow {
  calls: number;
  ms: PerfStats;
  perGameFrame: number;
  sizeLast: number;
  totalMsPerGameFrame: number;
}

export interface PerfTestRun {
  /** the canvas contexts found at the start, as { kind, type, el } */
  /** el: a canvas or an offscreen one; the code reads width/height (and best-effort isConnected) off both */
  cat: { el: any; kind: string; type: string; }[];
  /** which kind of context each canvas returned, so drawImage can be blamed on the right one */
  ctxTypes: WeakMap<WeakKey, string>;
  frame: HTMLIFrameElement;
  frameTimes: number[];
  gcHooked: WeakSet<WeakKey>;
  gradients?: { n: number; };
  guard: { label: string; stalled: boolean; reason: string | null; t0: number; timer: ReturnType<typeof setInterval>; };
  /** the game's window */
  iw: any;
  lastRafAt: number;
  layerFrames: { shown: number; hidden: number; missing: number; };
  minStep: number;
  noPin?: boolean;
  prevT: number;
  rec: { upd: number[]; ren: number[]; gap: number[]; h3: Record<string, { ms: number[]; n: number[]; }>; last: number; };
  /** the /progress endpoint the lab posts to, "" when it reports nowhere */
  recv: string;
  saved?: unknown;
  stamps: number[];
  /** the auto-walk it runs when the walk checkbox is on */
  walk?: { held: string | null; timer: ReturnType<typeof setInterval>; } | null;
}

export interface PerfTestCounts {
  filterSet?: number;
}

// One OPTIONS state a scene runs in: the switch values it sets (web/perf-test.ts VARIANTS).
export interface PerfTestVariant {
  label: string;
  values: Record<string, boolean | string>;
}

// The per-scene extra options of measureScene(): the variant, the map it runs on, and fields added to its result row.
export interface PerfTestSceneExtra {
  fields?: Record<string, any>;
  map?: string;
  variant?: string;
}

/** The per-frame 2D call census of one scene (web/perf-test.ts censusStop). */
export interface PerfCensus {
  /** the calls per game frame, worst first */
  census: { key: string; perFrame: number; }[];
  frames: number;
  totalPerFrame: number;
}

export interface PerfTestResult {
  /** the ambience profile the game reports for the map (the game's own object) */
  ambienceProfile: any;
  battle3dHooks: Record<string, PerfHookRow>;
  battleState: { start: any; end: any; };
  canvasCallsPerGameFrame: PerfCallProbe | null;
  census?: PerfCensus;
  canvases: any[];
  devicePixelRatio: { page: number; gameWindow: number; };
  /** the game's effects switches at the end of the scene */
  fx: Record<string, boolean>;
  /** the switch the sweep forced off, null for a normal scene */
  fxOff: string | null;
  gameDrawPlusUpdateMs: PerfStats;
  gameFrameGapMs: PerfStats;
  gameFrames: number;
  gameRenderMs: PerfStats;
  gameUpdateMs: PerfStats;
  hasFocusEnd?: boolean;
  hasFocusStart?: boolean;
  id: string;
  label: string;
  minStepSeenMs?: number | null;
  quality: string;
  /** frames per second, null when no frame was seen */
  rafFps: number | null;
  rafFrameMs: PerfStats;
  rafFramesOver16_7: number;
  rafFramesOver33: number;
  rafFramesOver50: number;
  scene: string;
  spriteFilter: string;
  stalled?: boolean;
  stallReason?: string | null;
  /** the scene switches it turned off (scene.set) */
  switchesOff: string[];
  todForce: string | null;
  variant: string;
  variantLabel: string;
  visibilityEnd?: DocumentVisibilityState;
  visibilityStart?: DocumentVisibilityState;
  wallMs: number;
  /** the scene weather, null for a normal scene */
  weather: string | null;
}

export interface PerfTestResults {
  error?: string;
  groups: PerfTestGroup[];
  meta: PerfResultsMeta;
  notes: string[];
}

export interface PerfResultsMeta {
  autostart: boolean;
  browser: string;
  devicePixelRatio: number;
  finishedAt?: string;
  gl: PerfTestEnv;
  hardwareConcurrency: number;
  hasFocusAtStart: boolean;
  minRafStepSeenMs?: number;
  options: { assetMode: string; walking: boolean; dayPinned: boolean; };
  page: string;
  platform: string;
  screen: { w: number; h: number; availW: number; availH: number; };
  startedAt: string;
  timerPrecision: { minNonZeroStepMs: number; method: string; spinCalls: number; };
  timing: { warmMs: number; measureMs: number; probeMs: number; settleMs: number; };
  userAgent: string;
  /** the OPTIONS state each variant name sets */
  variants: Record<string, PerfTestVariant>;
  visibilityAtStart: DocumentVisibilityState;
  window: { innerW: number; innerH: number; };
}

export interface PerfTestGroup {
  canvasesAtStart?: any[];
  census?: PerfCensus["census"];
  censusFrames?: number;
  censusTotalPerFrame?: number;
  error: string;
  fxAtStart?: Record<string, boolean>;
  map: string;
  note: string;
  qualityAtStart?: string;
  scenes: PerfTestResult[];
  spriteFilterAtStart?: string;
}
