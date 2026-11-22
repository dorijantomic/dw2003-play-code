// Types shared by the files of the "rest-c" group (web/native-stage.ts, web/scenery3.ts, web/gpu-pixel-filter.ts, ...). Type-only: nothing here is emitted.
import type { NativeStageRuntime } from "../../engine/native/runtime.js";
import type { SceneryFx, SceneryProfile, SceneryScene } from "./scenery.js";

/** The sine table the stage overlays need (assets/native/exe_tables.json). */
export interface NativeExeTables {
  sin_table_base: number;
  halfwords: number[];
}

/** The native stage that is running now: its runtime, the shared point table in overlay memory, and the effects fired so far (id -> anim). */
export interface NativeStageCurrent {
  stageId: string;
  rt: NativeStageRuntime;
  pointTable: number;
  effects: Map<number, number>;
}

// ---- web/scenery3.ts: night light, window glow, rain lens, rain rings and the wildlife

/** The effect switches scenery3 reads on top of the shared ones. */
export interface Scenery3Fx extends SceneryFx {
  nightlight?: boolean | undefined;
  screenfx?: boolean | undefined;
  windows?: boolean | undefined;
}

/** The map profile as scenery3 reads it: the shared part, the biome flags and the map size. */
export interface Scenery3Profile extends SceneryProfile {
  bats?: boolean | undefined;
  coast?: boolean | undefined;
  h: number;
  swamp?: boolean | undefined;
  w: number;
}

/** The one scene object web/ambience.ts hands drawScenery3 (its AmbienceScene). */
export interface Scenery3Scene extends Omit<SceneryScene, "fx" | "p"> {
  fx: Scenery3Fx;
  p: Scenery3Profile;
}

/** A raindrop sliding down the lens. */
export interface Scenery3Lens { born: number; life: number; ph: number; r: number; x: number; y: number; }
/** A rain ring on the water. */
export interface Scenery3Ring { born: number; life: number; x: number; y: number; }
/** A frog: it sits at home (hx, hy), now and then hops to (tx, ty), set when a hop starts together with t0. */
export interface Scenery3Frog {
  croak: number;
  dir: number;
  hop: number;
  hx: number;
  hy: number;
  t0?: number | undefined;
  tx?: number | undefined;
  ty?: number | undefined;
  until: number;
  x: number;
  y: number;
}
/** A lizard on the sand. */
export interface Scenery3Lizard { dash: number; face: number; until: number; vx: number; vy: number; x: number; y: number; }
/** A gull patrolling over the water. */
export interface Scenery3Gull { cx: number; cy: number; flap: number; ph: number; rx: number; ry: number; sp: number; }
/** A bat around its home point. */
export interface Scenery3Bat { home: [number, number]; ph: number; vx: number; vy: number; x: number; y: number; }
