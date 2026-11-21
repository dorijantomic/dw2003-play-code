// Types for web/arena-viewer-tools.ts: the arena viewer's TUNING panel.

export interface ArenaToolsParams {
  geminiSpires?: boolean;
  /** the multiplier the light colour controls write the uLightColor uniform through */
  lightStrength?: number;
  /** the sky mode the panel sets: "auto", "day" or "night" */
  skyTime?: string;
}

export interface ArenaToolsEntry {
  /** vendor objects: the lil-gui controllers the entry is driven by (web/lib3d/lil-gui.esm.js, untyped) */
  ctls?: any[];
  /** whether the entry is a direction (azimuth/elevation) rather than one number */
  dir?: boolean;
  folder?: string;
  id: string;
  /** "num", "vec", "color": what kind of uniform value the entry holds */
  kind: string;
  mats?: string[];
  name?: string;
  /** the value the panel started from: a number, a THREE Color/Vector or a number[] — one per uniform kind */
  start?: any;
  sub?: string;
  targets?: ArenaUniform[];
}

/** The one member of a shader uniform these tools read and write: its value. */
export interface ArenaUniform {
  /** a number, THREE.Color, THREE.Vector3 or THREE.Vector4, whichever the shader declares */
  value?: any;
}
