/** An axis-aligned box in world units, the shape the viewer's models report their bounds in. */
export interface CameraBounds {
  min: number[];
  max: number[];
}

/** A box as half-extents around a centre (what boxOf() returns and fitDistance() takes). */
export interface CameraBox {
  center: number[];
  half: number[];
}

/** The keys fly mode reads (WASD in the camera plane, Q/E world-down/up). */
export interface CameraFlyKeys {
  w?: boolean;
  a?: boolean;
  s?: boolean;
  d?: boolean;
  q?: boolean;
  e?: boolean;
}

/** The view as the URL carries it (?yaw=…&pitch=…): numbers when written, strings when read back. */
export interface CameraUrlState {
  yaw: number | string;
  pitch: number | string;
  dist: number | string;
  px: number | string;
  py: number | string;
  pz: number | string;
  fov: number | string;
  /** 1 = orthographic */
  ortho: number | string;
  /** 1 = the pivot locks to the model */
  lock: number | string;
}

export interface AnimViewerCamera {
  /** the last dYaw orbitBy() got, in degrees (the page reads it to tell a drag from a click) */
  _lastAzimuthDelta: number;
  allowFullPitch: boolean;
  /** degrees per second; 0 = off */
  autoOrbitSpeed: number;
  azimuthDeg?: () => number;
  /** forward/right/up, right from yaw alone so it stays finite at the poles */
  basis?: () => { forward: number[]; right: number[]; up: number[]; };
  boxOf?: (bounds: CameraBounds | null) => CameraBox | null;
  damping: number;
  dist: number;
  eye?: (out?: number[]) => number[];
  fitDistance?: (box: CameraBox, aspect?: number, padding?: number) => number;
  fly?: (keys: CameraFlyKeys | null, dt: number) => boolean;
  flyMode: boolean;
  flySpeed: number;
  fovDeg: number;
  frameBounds?: (bounds: CameraBounds, aspect?: number, opts?: { immediate?: boolean; padding?: number }) => boolean;
  /** frame several boxes at once (the clip's model and its projectiles) */
  frameUnion?: (list: CameraBounds[], aspect?: number, opts?: { immediate?: boolean; padding?: number }) => boolean;
  isFinite?: () => boolean;
  /** the largest bounds framed this frame, for "frame all" */
  lastBounds: CameraBounds | null;
  /** the point the pivot follows when locked to the Digimon; null = the pivot stays put */
  lockPoint: number[] | null;
  maxDist: number;
  minDist: number;
  orbitBy?: (dYawDeg: number, dPitchDeg?: number, opts?: { immediate?: boolean }) => { yaw: number; pitch: number; };
  orbitPixels?: (dx: number, dy: number, degPerPixel?: number) => { yaw: number; pitch: number; };
  ortho: boolean;
  padding: number;
  panPixels?: (dx: number, dy: number, viewportH?: number) => number[];
  pitch: number;
  pitchDeg?: () => number;
  pivot: number[];
  /** re-pivot on the nearest point under the cursor: the model box, else the ground plane */
  pivotAt?: (ndc: number[], aspect: number, bounds?: CameraBounds | null, groundY?: number | null) => number[] | null;
  /** world point -> NDC; null when behind the camera or non-finite */
  project?: (point: number[], aspect: number) => number[] | null;
  projection?: (aspect: number, nearFar?: number[] | null) => Float32Array;
  rayAt?: (ndc: number[], aspect: number) => number[];
  reset?: (bounds?: CameraBounds | null, aspect?: number) => boolean;
  setPreset?: (name: string, opts?: { immediate?: boolean }) => boolean;
  setState?: (s: Partial<CameraUrlState> | null) => boolean;
  /** the view as the URL carries it */
  state?: () => CameraUrlState;
  target?: () => number[];
  targetDist: number;
  targetPitch: number;
  targetPivot: number[];
  targetYaw: number;
  update?: (dt: number) => void;
  view?: () => { eye: number[]; look: number[]; up: number[]; fovDeg: number; ortho: boolean; };
  viewMatrix?: () => Float32Array;
  viewProjection?: (aspect: number) => Float32Array;
  yaw: number;
  /** dolly by factor (<1 = closer); with a cursor NDC the point under it stays under it */
  zoomBy?: (factor: number, cursorNdc?: number[] | null, aspect?: number) => number;
}

/** What the page may start the free camera at: a remembered pose right after `view()`, or nothing. */
export interface FreeCameraOptions {
  yaw?: number;
  pitch?: number;
  dist?: number;
  fovDeg?: number;
  ortho?: boolean;
  damping?: number;
  padding?: number;
  allowFullPitch?: boolean;
}
