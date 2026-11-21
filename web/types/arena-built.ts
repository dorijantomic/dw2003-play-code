export interface ArenaBuildInfo {
  /** the triangules/calls the renderer counted in the last frame */
  calls?: number;
  /** the foliage report web/built/place/foliage.ts leaves (per species and the mesh total) */
  foliage: ArenaFoliageInfo | null;
  /** how many instances each species slot currently holds */
  instances: Record<string, number>;
  keepOut: ArenaKeepOutInfo | null;
  /** per placement id: its report object, or true when it has none */
  layers?: Record<string, unknown>;
  missingLayers?: { error: string; id: string; stack: string; }[];
  pack: string;
  /** per piece kind, the meshes the placements made of it */
  pieces: Record<string, unknown[]>;
  /** the camera's projection-view matrix of the last frame */
  pv?: number[];
  triangles?: number;
}

/** What the arena viewer hands the build: its saved slot choices, when they changed, and the fighter keep-out. */
export interface ArenaBuiltOptions {
  slotChoices?: () => Record<string, unknown> | null;
  slotFileResetAt?: () => number;
  onSlotsChange?: (choices: Record<string, unknown>) => void;
  keepOut?: () => ArenaKeepOutState | null;
}

/** The fighters and eye rings a viewer has seen so far: what the placements have to keep clear of. */
export interface ArenaKeepOutState {
  /** one per fighter seen: its side, its world centre and its bounding radius */
  fighters: { c: number[]; r: number; side: string; }[];
  /** one per eye ring seen: [radius, height] */
  eyes?: number[][];
}

/** The keep-out the last place() was run with, as the viewer's report reads it. */
export interface ArenaKeepOutInfo {
  fightR: number;
  farthestFighter: number;
  fighters: { c: number[]; r: number; side: string; }[];
  rebuilds: number;
  rings: number[][];
  /** foliage stats carry their own numbers (ms, total...), so the report keeps them loose */
  [stat: string]: unknown;
}

export interface ArenaFoliageInfo {
  meshes: number;
  species: Record<string, { bands: { c: number[]; r: number; tris: number; }[]; box: unknown; cards: number; trisPerPlant: number; }>;
  triangles: number;
}
