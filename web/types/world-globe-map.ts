// Types only for web/world-globe-map.ts and the page web/world-globe.ts. Nothing here is emitted
// (node's strip mode erases it), so this file must never hold runtime code.

/** Which world map: the game's two servers. */
export type GlobeServer = "asuka" | "amaterasu";

/** A point in the map frame: original world-map picture pixels with the 16-row banner strip removed (0..392 x 0..336). */
export interface FramePoint {
  x: number;
  y: number;
}

/** Longitude / latitude in radians; longitude 0 faces the starting camera (three.js u = 0.5). */
export interface LonLat {
  lon: number;
  lat: number;
}

/** three.js sphere texture coordinates: u = 0..1 west to east, v = 0..1 south to north (uv.y). */
export interface SphereUv {
  u: number;
  v: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Where one flat map sits on the globe: a band around the equator, Mercator in latitude so shapes are not stretched. */
export interface MapBand {
  frameW: number;
  frameH: number;
  /** longitude of the frame centre, radians (Asuka 0, Amaterasu pi) */
  lonCentre: number;
  /** longitude covered by the map width, radians */
  lonSpan: number;
  /** half the map height in Mercator units (lonSpan * frameH / frameW / 2) */
  mercHalf: number;
}

/** One run of area pixels on one frame row: [y, x0, x1) */
export type AreaRun = [number, number, number];

/** One area of the game's world map (one patch the menu draws), from the area table. */
export interface GlobeArea {
  area: number;
  /** names of the places whose marker lies on this patch; empty when none does */
  names: string[];
  maps: string[];
  /** patch pixel centroid, frame px */
  centre: FramePoint;
  runs: AreaRun[];
}

/** One location marker the game draws on the map (centre of the icon), frame px. */
export interface GlobeMarker {
  loc: number;
  name: string;
  maps: string[];
  x: number;
  y: number;
  /** area whose patch holds the marker centre, or null */
  area: number | null;
}

/** The per-server data file web/assets/world-globe/<server>.json (written by the scratch tool export_web.py). */
export interface GlobeMapData {
  server: GlobeServer;
  /** picture file next to the json: the Gemini map, cleaned and cropped into the frame (the page draws GLOBE_TEXTURE instead) */
  image: string;
  frameW: number;
  frameH: number;
  /** picture px per frame px */
  imageScale: number;
  /** mean sea colour of the map's outer ring, 0..255 (the page no longer paints it: the globe texture holds the sea) */
  seaRgb: [number, number, number];
  /** land overlap (IoU) of the fitted Gemini map with the original */
  fitIou: number;
  areas: GlobeArea[];
  markers: GlobeMarker[];
}

/** One continent on the globe: a server's map data and where its frame sits. */
export interface GlobeContinent {
  data: GlobeMapData;
  band: MapBand;
}

/** What the pointer is over. */
export interface GlobeHit {
  /** the continent (server map) hit */
  server: GlobeServer;
  frame: FramePoint;
  area: GlobeArea | null;
  marker: GlobeMarker | null;
}

/** Where you stand, as the pause MAP screen knows it (web/menu/pure.ts mapHere + the server rule globeServerOfStage). */
export interface GlobeHereInput {
  /** the map's server, or null when the stage has no map (0x2D7 and up: MAP is refused) */
  server: GlobeServer | null;
  /** the marker record of your place: place + 1 (web/menu/pure.ts mapMarkerRecord) */
  record: number;
  /** the place name the disc page shows for that record ("" when none) */
  name: string;
  /** the record's icon top-left in status_ui.json screens.map.markers (map frame px), or null */
  icon: FramePoint | null;
}

/** Your place on the globe: the continent, the marker's frame point and where that lies on the sphere. */
export interface GlobePlace {
  server: GlobeServer;
  record: number;
  frame: FramePoint;
  lonLat: LonLat;
  /** the globe file's marker for the record, or null when the file has none (record 46) */
  marker: GlobeMarker | null;
}

/** The menu globe's camera: it looks at (lon, lat) from `dist` globe radii away (from the centre). */
export interface GlobeCamView {
  lon: number;
  lat: number;
  dist: number;
}

/** Which MAP screen the pause list's MAP row opens. */
export type MapScreenRoute = "globe" | "classic";

/** OPTIONS > GAME > Map screen, the value in force: "new" = the World Globe, "classic" = the disc's MAP page. */
export type MapScreenChoice = "classic" | "new";

/** The menu globe's assets: not asked for, loading, ready to draw, or failed (then the MAP row falls back to the disc's page). */
export type GlobeStageStatus = "idle" | "loading" | "ready" | "failed";

/** The one three.js globe as the MAP book sees it (web/world-globe-view.ts createGlobeStage); a fake in the node tests. */
export interface GlobeStageLike {
  /** start loading the assets and building the scene; the "you are here" marker goes on `here`'s place */
  open(here: GlobeHereInput): void;
  status(): GlobeStageStatus;
  /** your place once the assets are in (null before, or when the stage has no place) */
  place(): GlobePlace | null;
  /** render one frame for `view` and copy it into (x, y, w, h) of `ctx`; false when there is nothing to draw yet */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, view: GlobeCamView): boolean;
  /** the book shut: free the scene's GPU memory (the WebGL context is kept for the session) */
  close(): void;
}

// ---- the original map icons on the globe (web/world-globe-map.ts markerIcons, drawn by web/world-globe-view.ts) ----

/** One record of the disc's map marker table (status_ui.json screens.map.markers, one table for both servers): the place's
 *  record number (place + 1), the icon clip it draws and the clip's position (map frame px, top-left). */
export interface GlobeMarkerRecord {
  loc: number;
  clip: number;
  x: number;
  y: number;
}

/** One layer of a sheet clip: the source rect in the sheet picture and its offset from the clip's position. */
export interface IconLayer {
  x: number;
  y: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
}

/** One clip of a UI sheet (web/assets/ui/<pack>_sheet.json): its layers, drawn in order. */
export interface IconClip {
  layers: IconLayer[];
}

/** A UI sheet's clips by clip id. */
export type IconSheet = ReadonlyMap<number, IconClip>;

/** A sheet picture's size in px. */
export interface SheetSize {
  w: number;
  h: number;
}

/** A rectangle in px: the box a clip's layers cover, relative to the clip's position. */
export interface ClipBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One place marker as the globe draws it: the original map icon, centred where the disc draws it, sized like on the map. */
export interface GlobeMarkerIcon {
  server: GlobeServer;
  marker: GlobeMarker;
  /** the clip of the server's icon sheet (stwmp0icon Asuka, stwmp1icon Amaterasu) */
  clip: number;
  /** the clip's drawn box relative to the record's position, sheet px (= map frame px) */
  box: ClipBox;
  /** the icon box centre, map frame px */
  centre: FramePoint;
  lonLat: LonLat;
  /** the icon's size on the globe, globe radii: box px times the map's local scale there */
  size: { w: number; h: number };
}
