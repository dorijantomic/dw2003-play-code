// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

/** One rotation key of a bone channel: the ch0/ch1/ch2 triple and the frame it holds from (30000 ends the channel). */
export type RetargetKey = number[];

/** A bake's numbers, as the ladder judges them (web/fight/motion-swap-gate.ts measureSwap). */
export interface RetargetNumbers {
  ankle?: number | null;
  groundAbove?: number | null;
  groundBelow?: number | null;
  hand?: number | null;
  motion?: number | null;
  pen?: number | null;
  speed?: number | null;
  step?: number | null;
}

/** A baked model's channel pair: ch1 is the position track, ch2 the rotation track. */
export interface RetargetChannels {
  ch1?: RetargetKey[];
  ch2: RetargetKey[];
}

/** A target bone the bake paired with a donor bone (world bake: the two rest points and how far apart). */
export interface RetargetPair {
  dist: number;
  /** the bone it maps to on the donor model */
  source: number;
  target: number;
  /** the vertex count of each side's part */
  verts: number[];
}

/** The numbers a bake was judged on; a role bake and a world bake fill different halves. */
export interface RetargetMetrics {
  /** how far the mesh's rest torso is off the box's middle */
  rootDisagree?: boolean;
  rootFix?: { source?: K16Rig["rootFix"]; target?: K16Rig["rootFix"] };
  rootNormalised?: boolean;
  /** the bones the donor has no chain for and the target's own idle moved */
  idleBones?: number;
  idleSpan?: number[] | null;
  ikClamped?: number | null;
  ikSolved?: number | null;
  jointsClamped?: number | null;
  mirrored?: boolean;
  neutralFrame?: number | null;
  reachClampShare?: number;
  reachMode?: string;
  reachPathFrames?: number;
  roots?: unknown;
  sizeRatio?: number;
  torso?: number[];
  travelMax?: number;
  /** the world bake's yaw pick between the two candidate solutions */
  yaw?: number;
  yawCost?: { 0: number | null; 180: number | null };
}

/** A retarget bake: the rebuilt rig, the numbers it was judged on, and the tag the ladder adds (which source rig and method produced it). */
export interface RetargetBake {
  clip?: string;
  covered?: number;
  frames?: number;
  ik?: boolean;
  /** the baked keys per target bone, the shape k16WorstStep() reads */
  keys?: Map<number, RetargetKey[]>;
  /** target bone -> donor bone, -1 for a bone the donor has nothing for */
  map?: number[];
  method?: string;
  metrics?: RetargetMetrics;
  /** whether the donor was mirrored across the model's own X plane */
  mirror?: boolean;
  /** the rebuilt model, carrying the baked playlist */
  model?: RetargetModel;
  notes?: string[];
  numbers?: RetargetNumbers;
  /** frame shift between the donor's clip and the target's */
  offset?: number;
  pairs?: RetargetPair[];
  roles?: RigRoles;
  /** the donor model the bones were taken from */
  source?: RetargetModel;
  /** the playlist table the bake was written into */
  table?: number;
}

/** The part of a rig the cast gate reads: a bone-map rig and a geometry rig both have it. */
export interface RigView {
  arms: RigChain[];
  box: { mn: number[]; mx: number[]; h: number; w: number; d: number; };
  legs: RigChain[];
  props: RigProp[];
}

/** The target and donor rigs a role bake paired up. */
export interface RigRoles {
  source: RigView;
  target: RigView;
}

export interface RetargetModel {
  /** the loaded model's bone records (web/fight/*: the asset decode, untyped) */
  bones: any;
  timeline?: any;
}

/** One role chain of a rig: which side it is on, which of the pair it is, and its bones (root first). */
export interface RigChain {
  chain: number[];
  /** 0 for the main pair, 1.. for the second pair the bone map names */
  ordinal?: number;
  side: string;
}

/** A weapon or other prop bone: which bone carries it and which side it hangs on. */
export interface RigProp {
  bone: number;
  side?: string;
}

export interface K16Rig {
  arms: RigChain[];
  /** the geometry's bounding box, in the model's own units */
  box: { mn: number[]; mx: number[]; h: number; w: number; d: number; };
  /** the bone of the cape, null when the model has none */
  cape: number | null;
  /** the bone the mesh is dominated by */
  dom: number | null;
  folder: string | null;
  head: number;
  legs: RigChain[];
  /** the bone of the mouth, null when the bone map does not name one */
  mouth: number | null;
  /** the model's bone count */
  n: number;
  /** the rest pose the geometry heuristics measured */
  pose: { rot: number[][]; pos: number[][] };
  props: RigProp[];
  roleBones?: number[];
  root: number;
  rootFix?: { legRoot: number; upperRoot: number; rawCarriesLegs: boolean; moved: boolean; };
  rootRaw?: number;
  roots: number[];
  sc: number | null;
  /** where the roles came from: the game's own bone map, or the geometry heuristics */
  source: "bonemap" | "geometry";
  tail: number[];
  torso: number | null;
  torsoRaw?: number;
  wings: RigChain[];
}

export interface RigSampleOut {
  aux?: unknown;
  loop_target?: unknown;
  value?: unknown;
}

export interface RigBasicsModel {
  /** the loaded model's bone records (web/fight/*: the asset decode, untyped) */
  bones: any;
  timeline?: any;
}

export interface RetargetWorldModel {
  /** the loaded model's bone records (web/fight/*: the asset decode, untyped) */
  bones: any;
  timeline?: any;
}
