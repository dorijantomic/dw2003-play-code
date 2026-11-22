// How web/map-tiles.ts names a tile index, a tiled map and a cache entry.

/** One map of assets-hd/map-tiles/index.json: its size, its grid of tiles and the empty cells that were never cut. */
export interface TiledMapInfo {
  cols: number;
  h: number;
  rows: number;
  skip?: [number, number][] | undefined;
  w: number;
}

/** assets-hd/map-tiles/index.json: tile size, gutter, scale and every tiled map. */
export interface TileIndex {
  gutter: number;
  maps: Record<string, TiledMapInfo>;
  scale: number;
  tile: number;
}

/** What loadTileIndex() keeps: the parsed index, or an empty object when there is none. */
export type TileIndexState = TileIndex | { gutter?: undefined; maps?: undefined; scale?: undefined; tile?: undefined };

/** One cached tile: its decoded picture, the load state and the layer-split copies built from it. */
export interface MapTileEntry {
  bmp: ImageBitmap | null;
  map: string;
  split: Record<string, CanvasImageSource>;
  state: "queued" | "loading" | "ready" | "failed";
  used: number;
}

/** A tile waiting to be fetched. */
export interface MapTileJob {
  key: string;
  map: string;
  url: string;
}

/** The test hooks: how a tile is loaded, how a scratch canvas is made, and what runs after a tile lands. */
export interface MapTileEnv {
  canvas: (w: number, h: number) => HTMLCanvasElement;
  load: (url: string) => Promise<ImageBitmap>;
  onTile: (() => void) | null;
}
