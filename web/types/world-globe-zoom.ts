// How web/world-globe-zoom.ts (the pure maths of the World Globe zoom), web/world-globe-places.ts (which screen each place
// shows) and web/world-globe-zoom-view.ts (the three.js objects) name their data. Type-only: nothing here is emitted.
import type { FramePoint, GlobeServer, LonLat, Point3 } from "./world-globe-map.js";

/** A z band [from, to] of the zoom value. */
export type ZoomBand = readonly [number, number];

/** What the zoom maths needs besides z: where the camera looks, the place zoomed into, its picture and its icon, the view. */
export interface ZoomInput {
  /** the point the camera looks at on the globe (turned by the player) */
  look: LonLat;
  /** the place's icon centre (the window's centre on the globe) */
  place: LonLat;
  /** the native map picture size (px) */
  mapW: number;
  mapH: number;
  /** "you are here" on the picture (native px), or null when there is no dot on this screen */
  spot: FramePoint | null;
  /** half the place icon's larger side on the globe (globe radii): the window's radius while it swaps with the icon */
  iconRadius: number;
  /** view width / height */
  aspect: number;
  /** vertical field of view (degrees) */
  fovDeg: number;
}

/** The plane touching the globe at a place: its point and unit east, north and outward normal. */
export interface TangentFrame {
  origin: Point3;
  east: Point3;
  north: Point3;
  normal: Point3;
}

/** The zoom camera: where it is, the point it looks at, its up. */
export interface ZoomCamera {
  camera: Point3;
  target: Point3;
  up: Point3;
  /** camera distance from the look point's plane point (globe radii) and its tilt from straight down (radians) */
  height: number;
  tilt: number;
}

/** Everything one zoom value sets. */
export interface ZoomState extends ZoomCamera {
  z: number;
  /** the window's plane (origin = the window circle's centre, on the globe at the place's icon) */
  frame: TangentFrame;
  near: number;
  far: number;
  /** globe radii per native map px (the picture's scale on the window plane) */
  scale: number;
  /** the window circle: centre and radius on the picture (native px), and its radius on the globe (globe radii) */
  centre: FramePoint;
  radius: number;
  worldRadius: number;
  /** the place icon's opacity and the window's: they swap over ZOOM_BANDS.swap and always add up to 1 */
  iconAlpha: number;
  windowAlpha: number;
  /** tint toward the globe palette once the real map shows (0 = true colours), and before it shows (the painted look) */
  tint: number;
  paint: number;
  /** blur of the painted look (texture LOD bias) */
  blur: number;
  /** globe fade to the background: 0 = full globe, 1 = gone */
  globeFade: number;
  /** the digital grid transition: its strength, the scan line's row on the picture (native px) and its soft width (px) */
  gridAmount: number;
  sweepY: number;
  sweepSoft: number;
}

/** One place the zoom can go into: its icon on the globe. */
export interface ZoomTarget {
  /** placeKey(server, record) */
  key: string;
  server: GlobeServer;
  record: number;
  /** the icon centre and half its larger side on the globe (globe radii) */
  lonLat: LonLat;
  iconRadius: number;
}

/** The zoom's view: where the camera looks, the zoom value, the place it goes into, and whether the player has turned yet
 *  (before the first turn the target is your own place). */
export interface ZoomView {
  look: LonLat;
  z: number;
  /** index into the targets list, -1 = none */
  target: number;
  turned: boolean;
}

/** What one step of the view needs besides the buttons. */
export interface ZoomStepEnv {
  targets: readonly ZoomTarget[];
  /** your own place's index (-1 = none) */
  home: number;
  aspect: number;
  fovDeg: number;
  /** is the target's picture in? (asking starts its load); the zoom stops before the swap until it is */
  ready: (target: number) => boolean;
}

/** One map of assets-hd/map-tiles/index.json as the zoom reads it, with the index's tile numbers. */
export interface ZoomTileInfo {
  name: string;
  /** HD picture size (px) */
  w: number;
  h: number;
  cols: number;
  rows: number;
  /** tiles never cut ("c_r") */
  skip: readonly string[];
  tile: number;
  gutter: number;
  /** HD px per native px */
  scale: number;
}

// ---- which screen each place shows (web/world-globe-places.ts) ----

/** One row of status_ui.json screens.map.walker_map: the PS1 stage, the server (0 Asuka, 1 Amaterasu) and the place. */
export interface WalkerMapRow {
  ps1: number;
  server: number;
  loc: number;
}

/** A map of web/assets/manifest.json as the places table reads it. */
export interface PlaceMapInfo {
  id: string;
  name: string;
  width: number;
  height: number;
}

/** A scene exit as the places table reads it (web/assets/scenes/<map>.json exits, plus the game's synthesized return door). */
export interface PlaceExit {
  to?: string | null;
  spawnX?: number | null;
  spawnY?: number | null;
  _entranceReturn?: boolean;
}

/** The scenes the places table reads: map id -> its exits. */
export type PlaceScenes = Readonly<Record<string, { exits?: readonly PlaceExit[] | null } | null | undefined>>;

/** How a place's main screen was picked. */
export type PlaceScreenRule = "open-air" | "no-open-air";

/** One place's main outdoor screen: the open-air stage of the place most other maps lead into (ties: lowest id); a place
 *  with no open-air stage uses the same rule over all its stages. */
export interface PlaceScreen {
  key: string;
  server: GlobeServer;
  record: number;
  /** the map id and its native picture size */
  map: string;
  w: number;
  h: number;
  /** every stage of the place (walker_map), and how many other maps lead into the picked one */
  stages: readonly string[];
  links: number;
  rule: PlaceScreenRule;
}

/** How your screen on the globe was found: you stand on it; you came in from it (the kept entry or the game's return door);
 *  its only door leads there (scene data); or nothing is known and it is your place's main screen. */
export type HereScreenHow = "current" | "entered" | "door" | "main";

/** Your screen on the globe and the "you are here" dot on it (null = not known). */
export interface HereScreen {
  key: string;
  map: string;
  w: number;
  h: number;
  spot: FramePoint | null;
  how: HereScreenHow;
}

/** The screen a zoom target's window shows: its map, native size, and the dot (only on your own screen). */
export interface TargetScreen {
  map: string;
  w: number;
  h: number;
  spot: FramePoint | null;
  /** your own place (your screen) or another place (its main screen) */
  mine: boolean;
}

/** What the zoom knows about the places: every place's main screen and yours. */
export interface GlobePlacesInput {
  screens: ReadonlyMap<string, PlaceScreen>;
  here: HereScreen | null;
}
