// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

/** A point or a direction in the model's pose frame. */
export type FightVec3 = [number, number, number];

/** The clearance bars one model's sampled poses gave: per collider pair ("i:j"), the tightest
 *  separation over the clip, and the floor the whole body may dip to. */
export interface FightCollisionOut {
  /** "i:j" -> the tightest clearance sampled for that pair, null when no pose separated it */
  byPair: Map<string, number | null>;
  /** the tightest bar of all the pairs */
  floor: number;
  /** poses sampled */
  frames: number;
  /** how far colliders i and j may come, null when the pair was never separated */
  pairFloor?: (i: number, j: number) => number | null;
  /** the sample count that was asked for (frames only grow past it on a longer clip) */
  samples: number;
  /** which authored window the samples came from */
  source: string;
}

/** One move cue of the action stream (action-vm.ts): a slide to a spot, or back home, or to the contact point. */
export type FightMoveRec = { kind: "to"; x: number; y: number; z: number; tween: number; } | { kind: "home" | "contact"; tween: number; };

/** The hooks an action run reports back: a bone moved or turned this tick, the script switched table, a hit landed, the camera cue (setAction/setScript take them). */
export interface FightActionHooks {
  onMove?: (rec: FightMoveRec) => void;
  onRotate?: (rec: { x: number; y: number; z: number; }) => void;
  onMotion?: (motion: number) => void;
  onHit?: (hit: { type: number; words: number[]; }) => void;
  onAuxAction?: (aux: { mode: number; }) => void;
  onCamera?: (cue: { words: number[]; }) => void;
  setLunge?: (lunge: FightLungeRec) => void;
  /** op3: a visual effect to spawn (type, and the actor-relative spot) */
  onEffect?: (rec: { type: number; x: number; y: number; z: number; }) => void;
  /** op3 sub 1: an effect asset to preload */
  onEffectPreload?: (type: number) => void;
  /** op2 mode 5: a slot motion was armed (kind, its parameter, how far it travels) */
  onRamp?: (rec: { kind: number; param: number; dist: number; }) => void;
  /** op7: a slot overlay spawned or freed */
  onOverlay?: (rec: { type: number; duration: number; }) => void;
  /** op2 mode 1/2: a slot was shown or hidden */
  onVisibility?: (rec: { slot: number; visible: boolean; }) => void;
  /** op2 mode 6: a model id was assigned to a presentation slot */
  onModelAssign?: (rec: { slot: number; model: number; }) => void;
  /** op2 mode 9: a presentation slot was released */
  onSlotRelease?: (rec: { slot: number; }) => void;
}

/** What op6 reports: sub 0 carries the projectile id and its two vectors (negated into the model's frame), any other sub carries the raw operand words. */
export interface FightLungeRec {
  sub: number;
  id?: number;
  from?: FightVec3;
  to?: FightVec3;
  words?: number[];
}

/** One decoded record of an action script: the opcode and its operand words (the decoder fills every operand the opcode's handler reads). */
export interface FightScriptOp {
  op: number;
  words: number[];
  /** a deferred inline-blob op: the VM skips it */
  unknown?: boolean;
  /** op11 only (DW2 motion): hold until the bound table's playhead reaches this entry */
  untilEntry?: number;
}

/** The write target the action VM's slot motion drives: the actor's arena offset and which side it stands on. */
export interface FightMotionSlot {
  sideSign: number;
  getY(): number;
  getZ(): number;
  setY(v: number): void;
  setZ(v: number): void;
}

/** The knobs the motion-swap judge takes: the numbers of the target's own idle (precomputed), the bars to judge against, the slots to measure. */
export interface SwapJudgeOpts {
  own?: any;
  bars?: any;
  ownIdle?: { pen?: number; ankle?: number; step?: number; } | null;
  slots?: number[] | null;
  samples?: number;
  penFrames?: number;
}

/** The numbers a swap bake is judged on (measureSwap), plus the fill-only figures judgeFill adds afterwards. */
export interface SwapNumbers {
  covered?: number;
  step?: number;
  ankle?: number;
  groundBelow?: number;
  groundAbove?: number;
  pen?: number;
  speed?: number;
  motion?: number;
  hand?: number;
  energy?: number;
  frames?: number;
  range?: any[];
  table?: number | null;
  startRest?: number | null;
  endRest?: number | null;
  restIdle?: number | null;
  idleRange?: { pen: number | null; ankle: number | null; step: number | null; };
}

/** What applyMotion records on the model for a merged DW2 motion: the playlist table it was written to and the frame span. */
export interface Dw2MotionEntry {
  table: number;
  kind?: string | undefined;
  lo?: number | undefined;
  hi?: number | undefined;
  letter: string;
  /** playlist entry of the strike pose, or null */
  hit: number | null;
}

/** One DW2 motion as the generated motion file writes it: per-bone rotation keys (ch2), optional root translation (ch1), the playlist the keys play on. The swap gate adds `used` to the motions it passed. */
export interface Dw2Motion {
  /** bone index -> that bone's rotation keys: [frame, x, y, z, terminator] rows */
  keys?: Record<string, number[][]>;
  /** the root translation keys: one array for a v1 file, per-bone arrays for a v2 bake */
  ch1?: number[][] | Record<string | number, number[][]>;
  /** the motion's playlist entries (the table the keys hang on) */
  playlist?: any[];
  table?: number;
  kind?: string;
  lo?: number;
  hi?: number;
  /** v1 files: the bone the single ch1 array belongs to */
  rootBone?: number;
  /** the playlist entry of the strike pose */
  hit?: number | null;
  letter?: string;
  /** the swap gate judged this motion worth offering (web/anim-viewer-dw2motion.ts) */
  used?: boolean;
}

/** One node of the face-box scene: what to draw, the matrix it is drawn with, and the texture/tint (the box nodes take neither). */
/** A composed camera shot: eye and target points, the projection distance H and an optional roll (all PS1 integer units). */
export interface CamShot {
  eye: number[];
  target: number[];
  H: number;
  roll?: number;
}

export interface ShotNode {
  what: string;
  mvp: string;
  tex?: string;
  tint?: number[];
}

/** What the LOADOUT tab is asked for: the body's folder, its names, its species, its anim.json and the tables the caller loaded. */
export interface LoadoutQuery {
  folder?: any;
  names?: any[];
  species?: any[];
  anim?: any;
  techTable?: any;
  skills?: any;
  sounds?: any;
}

/** One action's contact payment: the damage total, how it splits into hits, and how a hit is paid. */
export interface ContactDamageSpec {
  total?: number;
  perHit?: number;
  hits?: number;
  hp?: number | null;
  pay?: any;
}

/** What a built cast tells the launch planner: the technique it serves, whether it is a volley, the tables to read, and the release frame. */
export interface LaunchSpec {
  tech?: any;
  volley?: boolean;
  tables?: number[] | null;
  frame?: number | null;
  forceSolver?: boolean;
}

/** What launchOps is given: this model's own spell sprite, its home line, the pack's flight words and the side it was authored on. */
export interface LaunchOpsSpec {
  sprite?: any;
  homeZ?: number;
  flight?: any;
  lane?: number;
  side?: string;
}

/** A body's own clip inventory: one record per owned action slot, plus its height and its throw verdict. */
export interface OwnClipInventory {
  slots?: Record<string, OwnClipRec>;
  height?: number;
  throws?: boolean;
  throwsWhy?: string[];
}

/** What one of a body's own action clips turned out to be: its slot, the tables it plays, what it launches and hits, how it travels. */
export interface OwnClipRec {
  slot?: number | null;
  /** the playlist tables the script binds */
  tables?: number[];
  /** op indexes of the op6 launches */
  launches?: number[];
  /** op indexes of the contact markers (op10 98/99) */
  contacts?: number[];
  /** every op10 marker: its op index and type */
  markers?: { at: number; type: number; }[];
  ramp4?: number;
  ramp5?: number;
  leap3?: number;
  dash8?: number;
  home7?: number;
  waits?: number;
  rootTravel?: number;
  returnsHome?: boolean;
}

/** One tick's aim: the arms' wrist points, or the body bone the shot leaves from (a head/chest cast). */
export interface FightAimOffsets {
  aim: { bone: number; point: number[] } | null;
  arms: { left: number[] | null; right: number[] | null };
  head?: number;
  lean?: number;
  root?: number[];
}

export interface FightPlan {
  aimStart: number;
  apex: any;
  apexBack: number;
  apexUp: number;
  baseFrame: number;
  cls: any;
  drive: number;
  flight: number;
  floorY: any;
  follow: number;
  frames: any[];
  H: any;
  /** the hand point the class's casts measured: every member is optional (a class with no hand point falls back to rel) */
  hand: { height?: number; forward?: number; lateral?: number; source?: string | null | undefined; quantile?: string; unit?: string; };
  head: any;
  headScale?: number;
  headSites: any;
  isArm: any;
  mode: any;
  muzzleTargets: any;
  aimPoint?: any[];
  aimPoints?: any[];
  ok: true;
  origins: any;
  overshoot: any;
  rel: { height: number; forward: number; lateral: number; source: any; quantile: string; unit: string; };
  release: number;
  restTip: any;
  return: number;
  rootCap: number | null;
  setSwing?: any;
  shared: any;
  sites: any;
  size: any;
  swing: { base: number; cap: number; scale: number; };
  targets: any;
  ticks: number;
  torso: any[];
  windup: number;
  wu: any;
}

export interface FightMetrics {
  aimAfter?: any[];
  axisAim: number;
  bones: number;
  footPlant?: number;
  headHub?: boolean;
  ikClamped: number;
  jointsClamped: number;
  reachPull?: any[];
  unreachable: number;
}

export interface FightSkeleton {
  num_bones?: number | null;
  bones: any;
  timeline?: any;
}

/** A bone's baked channels: ch1 translation rows and ch2 rotation rows, [frame, x/y/z, terminator]. */
export interface FightChannels {
  ch1?: number[][];
  ch2?: number[][];
}

export interface FightGate {
  aim: boolean;
  body?: boolean;
  clearance: boolean;
  gap: boolean;
  ground: boolean;
  headPitch?: boolean;
  idle?: boolean;
  /** how far the target is above the head bar (a head cast jumps); compare with HEAD_CAST_JUMP.p90 */
  jump?: boolean;
  motion: boolean;
  reachable: boolean;
}

export interface Dw2FightCh2 {
  ch2?: number[][];
}

export interface Dw2FightCh1 {
  ch1?: number[][];
}

export interface MotionTreeContext {
  arms: any[];
  cap?: (b: any, floor: any, ceil: any) => number;
  cloud: any;
  D: number;
  ep: any;
  fN: number;
  H: number;
  head: any;
  hips: any;
  kids: any[][];
  legs: any[];
  mainRoot: any;
  model: any;
  n: unknown;
  notes: unknown[];
  order: unknown[];
  own: Map<any, any>;
  par: unknown;
  plan: unknown;
  Pr: unknown[];
  quad: boolean;
  rig: unknown;
  spine: unknown[];
  tail: unknown[];
  torso: unknown;
  upper: unknown[];
  W: number;
  wings: unknown[];
  Wr: unknown[];
}

export interface MotionBonesOut {
  bones: any;
  timeline?: any;
}

/** One donor row of ANIM_DONOR_GAPS: how a clip the model lacks is built, from which donor body, on which of the model's own tables. */
export interface DonorRow {
  /** method: "borrow-tables" | "own-table-body" | "spell-table-body" | "retarget" */
  m: string;
  /** the donor model folder */
  d: string;
  /** the model's own timeline tables that carry the body, in order */
  t: number[];
  /** the donor's motion arm is on the other side (the arm motion must be mirrored) */
  h?: string;
}

/** The size classes the anatomy table and the measured constants speak in, smallest first. */
export type SizeClassName = "tiny" | "small" | "medium" | "large" | "giant";

/** One model's anatomy record (digimon-anatomy/anatomy-data.ts): the short keys are explained at the top of that file. */
export interface AnatomyRec {
  n: string;
  alias: string[];
  t: string;
  tags: string[];
  plan: string;
  fam: string;
  size: SizeClassName;
  legs: number;
  wings: number;
  /** [side, kind, builtIn] per arm */
  arm: [string, string, boolean][];
  tail: string | null;
  /** [mouthAttack, horns, description] */
  head: [boolean, boolean, string];
  /** [where, kind, what] per weapon */
  armament: [string, string, string][];
  side: string | null;
  /** normalized technique name -> [emitterMode, style, bodyPartAnnotation] */
  tech: Record<string, [string, string, string]>;
  conf: number;
}

/** One launch site of a body: [id, part, count, kind, primary 0|1, mouth 0|1]. */
export type EmitterRow = [string, string, number, string, number, number];

/** One technique's shot rule: [mode, emitter ids, shot count]. */
export type ShotRule = [string, string[], number];

/** One arm's measured equipment: [class, confidence 1|0, source, bone, attachment, [L/F, W/F, T/W, L/W, cube/F, area/(F*TW)]]. */
export type ArmEquipRow = [string, number, string, number, string, [number, number, number, number, number, number]];

/** One entry of a playlist table: the frame it shows (0x8000 loops back to loop_target, 0xffff ends), the loop target, the blend source frame. */
export interface FightTimelineRow {
  value: number;
  loop_target: number;
  aux: number | null;
}

/** One key of a bone channel: three values and the frame they sit on (30000 ends the channel). */
export type FightChanRow = [number, number, number, number];

/** A bone's authored channels: ch1 translation, ch2 rotation (PS1 units), ch3 scale (4096 = 1.0). */
export interface FightBoneAnim {
  ch1?: FightChanRow[];
  ch2?: FightChanRow[];
  ch3?: FightChanRow[];
}

/** One bone of a loaded battle model: its parent slot, its mesh and its channels. */
export interface FightBone {
  parent_slot?: number | null;
  verts?: FightVec3[];
  faces?: number[][];
  anim?: FightBoneAnim;
}

/** One entry of a model's timeline: the playlist table of that index. */
export interface FightTimelineEntry {
  table?: FightTimelineRow[];
}

/** One clip's frame span in the model's clip list. */
export interface FightClipSpan {
  index: number;
  present: boolean;
  start_frame: number;
  end_frame: number;
  loop_count: number;
}

/** A loaded battle model (assets/battle/models/<folder>/anim.json) with the extras the fight code attaches to it. */
export interface FightModel {
  folder?: string;
  num_bones?: number | null;
  /** how many cast bakes applyCastBake() has already written onto this live model */
  __castBakes?: number;
  /** the DW2 motions merged into this model, by DW2 letter (dw2-motion.ts applyMotion) */
  dw2Motion?: Record<string, Dw2MotionEntry>;
  /** set once applyDw2Motion has merged the model's generated file */
  __dw2Applied?: boolean;
  total_frames?: number;
  clips?: FightClipSpan[];
  bones: FightBone[];
  timeline?: (FightTimelineEntry | undefined)[];
  /** the action scripts by clip number */
  actions?: Record<number, FightScript | undefined>;
}

/** One clip's action script: its decoded ops, and what a built script adds (which side authored it, how it was made). */
export interface FightScript {
  ops: FightScriptOp[];
  side?: string;
  synthesized?: boolean;
  camAuthored?: string;
  buildKind?: string;
  /** a heal/support script with none of the attack records (clip-fallback buildSelfScript) */
  selfCast?: boolean;
  /** a script the cast solver baked: its solver report rides along */
  solved?: boolean;
  solver?: Record<string, any>;
  /** a script built from the own clip of the model: which slot and why */
  ownClip?: Record<string, any>;
  /** a script whose body was swapped for a DW2 motion */
  dw2Motion?: Record<string, any>;
}

/** One model's bone map record (digimon-bonemap.ts): which bone is which body part; the short keys are explained at the top of that file. */
export interface BoneMapRec {
  /** root bone */
  r: number;
  /** every root bone */
  ro: number[];
  /** torso */
  t: number;
  /** head */
  h: number;
  /** mouth */
  m: number;
  /** eyes */
  e: number;
  /** arm chains, shoulder..hand/prop */
  aL: number[];
  aR: number[];
  /** extra arm chains of a multi-armed design */
  aLe?: number[][];
  aRe?: number[][];
  /** leg chains, hip..foot */
  lL: number[];
  lR: number[];
  lL2?: number[][];
  lR2?: number[][];
  /** wing chains (may be empty) */
  wL: number[];
  wR: number[];
  /** tail chain (may be empty) */
  tl: number[];
  /** locomotion bones */
  loc: number[];
  /** firing bone per emitter mode */
  f: Record<string, number>;
  /** both-arms list [left, right] when both exist */
  fb?: number[];
  /** wing tips (all wings, outer first) */
  wb?: number[];
  /** the design's dominant (weapon) side */
  dom: string | null;
  /** rest-pose arm mirror error (0 = mirror-perfect) */
  sy: number;
  /** side confidence: "high" | "medium" | "low" */
  sc: string;
}
