import type { DataTexture, Mesh, Texture, Vector2 } from "../lib3d/three.module.js";

// Types shared by the small game files of one group: web/fieldcom.ts, web/gpu-pixel-filter.ts,
// web/screenpack.ts, web/water3d.ts, web/grass3d.ts, web/fishing-extras.ts, web/treesway.ts,
// web/extra-roster.ts, web/quest-ghost.ts, web/species-log.ts. Declarations only, nothing here is emitted.

// ---------------------------------------------------------------- web/fieldcom.ts

/** One layer of a FIELDCOM clip: the source rectangle on the sheet and where it lands relative to the anchor. */
export interface FieldcomLayer { x: number; y: number; w: number; h: number; dx: number; dy: number }

/** One directory id: its layers, and `semi` = -1 (blend off) or the tpage blend mode. */
export interface FieldcomClip { layers: FieldcomLayer[]; semi: number }

/** One sheet directory: clips by "id" or "id@clutRow". */
export type FieldcomDir = Record<string, FieldcomClip>;

/** One step of a glyph program: the sprite id and its delay in engine ticks. */
export interface FieldcomProgramStep { id: number; delay: number }

/** assets/ui/fieldcom.json: `dir0`, `dir1`... and the glyph programs by row. */
export interface FieldcomManifest {
  [dir: `dir${number}`]: FieldcomDir | undefined;
  programs?: Record<number, FieldcomProgramStep[] | undefined>;
}

/** A sparkle script step: [sprite id, duration] (id 0xff = jump to pair index `duration`). */
export type SparkleStep = [number, number];

// ---------------------------------------------------------------- web/screenpack.ts

/** One layer of a screen-pack clip: the source rectangle on the sheet and its offset inside the clip. `frame` is the cel number (tile frames only). */
export interface ScreenPackLayer { frame?: number; x: number; y: number; w: number; h: number; dx: number; dy: number }

/** One clip of a screen pack: back-to-front layers, the PS1 blend mode (`semi`, -1 = off) and whether any texel carries the STP bit. */
export interface ScreenPackClip { semi?: number; stp?: boolean; layers: ScreenPackLayer[] }

/** A pack's clips by id ("12", or "12#3" for palette row 3 of clip 12). */
export type ScreenPackIds = Record<string, ScreenPackClip | undefined>;

/** The whole `<name>_sheet.json`: the clips under `.ids` (ststat adds portraits and a backdrop beside them). */
export interface ScreenPackSheet {
  ids?: ScreenPackIds;
  [key: string]: ScreenPackClip | ScreenPackIds | undefined;
}

/** One loaded pack: filled in as the sheet image and its json arrive. */
export interface ScreenPack {
  name: string;
  img: HTMLImageElement | null;
  map: ScreenPackSheet | null;
  ids: ScreenPackIds | null;
  patterns: Record<string, CanvasPattern | null>;
}

// ---------------------------------------------------------------- web/water3d.ts

/** The textures and size of one stage's water: the map, the soft water mask, the shore-distance texture. */
export interface WaterStage {
  mapTex: Texture;
  maskTex: DataTexture;
  reflTex: DataTexture;
  maskData: Uint8Array;
  W: number;
  H: number;
}

/** The water shader's uniforms (what the fragment shader reads by name). */
export interface WaterUniforms {
  uMap: { value: Texture | null };
  uMask: { value: Texture | null };
  uCam: { value: Vector2 };
  uMapSize: { value: Vector2 };
  uTime: { value: number };
  uRefl: { value: Texture | null };
  uReflOn: { value: number };
}

// ---------------------------------------------------------------- web/grass3d.ts

/** One horizontal band of a stage's blades: its instanced mesh and the map rows it covers (for culling). */
export interface GrassBand { mesh: Mesh; y0: number; y1: number }

/** All the blades of one stage, in bands, and how many there are. */
export interface GrassStage { bands: GrassBand[]; count: number }

// ---------------------------------------------------------------- web/fishing-extras.ts

/** One rare extra of a fishing area's table (data/authored/web/assets/data/fishing_extras.json). `chance` is in percent. */
export type FishExtraEntry =
  | { kind: "item"; key: string; item: number; name: string; tiers: number[]; chance: number; very_rare: boolean }
  | { kind: "bits"; key: string; bits: number; tiers: number[]; chance: number }
  | { kind: "hint"; key: string; hint: number; tiers: number[]; chance: number };

/** One fishing area: its words and its entries. */
export interface FishExtraArea { id: string; name: string; theme: string; flavour: string; entries: FishExtraEntry[] }

/** Which area a stage fishes, and its tier (1..4, how far the story is). */
export interface FishExtraStage { area: string; tier: number }

/** fishing_extras.json as the game reads it. */
export interface FishExtrasData {
  hints: string[];
  areas: FishExtraArea[];
  stages: Record<string, FishExtraStage>;
}

/** Where the "found once" flags are kept (localStorage, or a stand-in). */
export type FishFindsStorage = Pick<Storage, "getItem" | "setItem">;

/** One entry of the almanac's extras block: named once found ("???" before), with its percent. */
export interface FishExtrasEntryRow { key: string; found: boolean; label: string; percent: number | null }

/** One row of the almanac's extras block: a stage, its area and tier, the table's total percent and its entries. */
export interface FishExtrasRow { stage: string; area: string; tier: number; total: number; entries: FishExtrasEntryRow[] }

// ---------------------------------------------------------------- web/treesway.ts

/** One connected blob of the foreground layer: its pixel count, how many are foliage green, and its top and bottom rows. */
export interface TreeComp { area: number; green: number; y0: number; y1: number }

/** Everything built for one stage's swaying canopies. `comps` and `isTree` are indexed by blob id (comps[0] is a placeholder). */
export interface TreeStage {
  treeCv: HTMLCanvasElement;
  restCv: HTMLCanvasElement;
  patchCv: HTMLCanvasElement;
  id: Uint16Array;
  comps: (TreeComp | null)[];
  isTree: boolean[];
  occ: Uint8Array;
  cols: number;
  rows: number;
  W: number;
  H: number;
}

// ---------------------------------------------------------------- web/extra-roster.ts

/** One row of digimon.json (or of the extra species): the id is all the merge reads, the rest passes through. */
export interface ExtraDigimonRow { id: number; [field: string]: unknown }

/** One new partner (a starter row after the extras): its roster slot, ids and names. */
export interface ExtraStarter { slot: number; id: number; charId: number; name: string; formId: number; gearSlot: number }

/** extra_species.json: the extra rows, each line's extra unlock records by roster slot, and the new partners. */
export interface ExtraSpeciesData {
  digimon?: ExtraDigimonRow[];
  tree?: Record<string, unknown[]>;
  starters?: ExtraStarter[];
}

/** digimon.json as the merge reads it. */
export interface DigimonTableJson { digimon?: ExtraDigimonRow[] }

/** One digivolution line of evolutions.json. */
export interface ExtraEvolutionLine { slot: number; digimonId?: number; records: unknown[] }

/** evolutions.json as the merge reads it. */
export interface EvolutionsJson { lines?: ExtraEvolutionLine[] }

// ---------------------------------------------------------------- web/quest-ghost.ts

/** Who a ghost is drawn as: "player", or an NPC id. */
export type GhostKey = "player" | number;

/** How one ghosted actor is drawn: the alpha around its whole draw and the #rrggbb tint (null = fade only). */
export interface GhostLook { alpha: number; tint: string | null }

/** The actor whose draw closure is running now. */
export interface GhostDrawing { key: GhostKey | null; tint: string | null }

// ---------------------------------------------------------------- web/species-log.ts

/** Species name -> how many times (met, beaten) or 1 (owned). */
export type SpeciesCounts = Record<string, number>;

/** The three counts the log keeps in localStorage. */
export interface SpeciesLogState { v: 1; met: SpeciesCounts; beaten: SpeciesCounts; owned: SpeciesCounts }

/** Which of the three counts a note goes into. */
export type SpeciesLogField = "met" | "beaten" | "owned";

/** Where the log is kept (localStorage, or a stand-in). */
export type SpeciesLogStorage = Pick<Storage, "getItem" | "setItem">;
