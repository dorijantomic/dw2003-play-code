// HD Remaster field maps drawn from tiles (always on in HD; game.js HD_MAPS).
//
// A whole HD map is up to 7680x5632 (90 MB PNG, 176 MB decoded) and the game used to load it, its
// _fg overlay and every neighbouring stage's in full.  tools/tile_hd_maps.py cuts each one into
// TILE x TILE lossless WebP tiles (plus a GUTTER of neighbour pixels so bilinear sampling at a tile
// edge reads the real neighbour) under assets-hd/map-tiles/<name>/<col>_<row>.webp.  Here only the
// tiles inside the view (plus one ring) are fetched and decoded (createImageBitmap, off the main
// thread), a bounded cache keeps the most recently drawn ones, and the rest are closed.
//
// The stage itself keeps its NATIVE image (state.mapImgs) for readiness, the layer split, the
// terrain effects and as the picture shown until the HD tiles are in, so the map appears at once.

const INDEX_URL = "assets-hd/map-tiles/index.json";
const MAX_TILES = 40;          // decoded tiles kept (1032x1032 RGBA ~4.3 MB each)
const MAX_INFLIGHT = 6;

let index = null;              // parsed index.json, {} when absent
let indexPromise = null;
const maps = new Map();        // name -> TiledMap
const cache = new Map();       // key -> entry {bmp, split: {ground, layer2}, used}; Map order = LRU
const queue = [];              // keys waiting to fetch, most wanted first
let inflight = 0;
let frame = 0;

// Test hooks (node has no fetch of local files, createImageBitmap or canvas).
const env = {
  load: async (url) => createImageBitmap(await (await fetch(url)).blob()),
  canvas: (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; },
  onTile: null,                // called after a tile lands (the game redraws every frame anyway)
};
export function setTileEnv(overrides) { Object.assign(env, overrides); }
export function resetTiles() {
  for (const e of cache.values()) e.bmp?.close?.();
  cache.clear(); maps.clear(); queue.length = 0; inflight = 0; index = null; indexPromise = null;
}

export function loadTileIndex(fetchJson = () => fetch(INDEX_URL, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))) {
  if (!indexPromise) {
    indexPromise = Promise.resolve().then(fetchJson).catch(() => null)
      .then((j) => { index = j && j.maps && j.tile ? j : {}; return index; });
  }
  return indexPromise;
}
export function tileIndexReady() { return index !== null; }

/** The tiled HD copy of assets/maps/<name>.png, or null (no index, or this map was not tiled). */
export function tiledMap(name) {
  if (!index || !index.maps || !index.maps[name]) return null;
  let t = maps.get(name);
  if (!t) maps.set(name, t = new TiledMap(name, index.maps[name], index.tile, index.gutter, index.scale));
  return t;
}

/** Call once per rendered frame (ages the cache). */
export function tickTiles() { frame++; }

/** Drop every tile of maps not in `keepNames` (stage change). */
export function retainTiledMaps(keepNames) {
  const keep = new Set(keepNames);
  for (const [key, e] of [...cache]) {
    if (!keep.has(e.map)) { e.bmp?.close?.(); cache.delete(key); }
  }
  for (let i = queue.length - 1; i >= 0; i--) if (!keep.has(queue[i].map)) queue.splice(i, 1);
}

export function tileStats() {
  let decoded = 0;
  for (const e of cache.values()) if (e.bmp) decoded++;
  return { cached: cache.size, decoded, queued: queue.length, inflight };
}

function pump() {
  while (inflight < MAX_INFLIGHT && queue.length) {
    const job = queue.shift();
    const e = cache.get(job.key);
    if (!e || e.bmp || e.state !== "queued") continue;
    e.state = "loading";
    inflight++;
    env.load(job.url).then((bmp) => {
      if (cache.get(job.key) === e) { e.bmp = bmp; e.state = "ready"; } else bmp?.close?.();
    }, () => {
      if (cache.get(job.key) === e) e.state = "failed";
    }).finally(() => { inflight--; env.onTile?.(); pump(); });
  }
}

function evict() {
  if (cache.size <= MAX_TILES) return;
  for (const [key, e] of cache) {                 // oldest first
    if (cache.size <= MAX_TILES) break;
    if (e.used >= frame - 1 || e.state === "loading") continue;   // on screen now, or mid-decode
    e.bmp?.close?.();
    cache.delete(key);
  }
}

export class TiledMap {
  constructor(name, info, tile, gutter, scale) {
    this.name = name;
    this.info = info;
    this.tile = tile; this.gutter = gutter; this.scale = scale;
    this.w = info.w / scale;                      // logical (native map pixel) size
    this.h = info.h / scale;
    this.skip = new Set((info.skip || []).map(([c, r]) => `${c}_${r}`));
    this.splitMask = null;                        // native-size canvas, white on layer-2-only pixels
  }

  /** The layer split (game.js buildGroundCover): a native-size mask, white where layer 2 shows. */
  setSplitMask(mask) {
    if (this.splitMask === mask) return;
    this.splitMask = mask;
    for (const e of cache.values()) if (e.map === this.name) e.split = {};
  }

  url(c, r) { return `assets-hd/map-tiles/${this.name}/${c}_${r}.webp`; }

  entry(c, r, want) {
    const key = `${this.name}/${c}_${r}`;
    let e = cache.get(key);
    if (!e) {
      e = { map: this.name, bmp: null, state: "queued", split: {}, used: frame };
      cache.set(key, e);
      queue.push({ key, url: this.url(c, r), map: this.name });
    } else {
      cache.delete(key); cache.set(key, e);       // most recent last
    }
    if (want) e.used = frame;
    return e;
  }

  // The tile with the split applied (kind "ground" erases the layer-2-only pixels, "layer2" keeps
  // only them), built once per tile from the native mask scaled up with no smoothing.
  splitTile(e, c, r, kind) {
    if (!kind) return e.bmp;
    if (!this.splitMask) return null;
    if (e.split[kind]) return e.split[kind];
    const { tile: T, gutter: G, scale: S } = this;
    const tw = e.bmp.width, th = e.bmp.height;
    const cv = env.canvas(tw, th);
    const g = cv.getContext("2d");
    g.drawImage(e.bmp, 0, 0);
    g.globalCompositeOperation = kind === "ground" ? "destination-out" : "destination-in";
    g.imageSmoothingEnabled = false;
    g.drawImage(this.splitMask, (c * T - G) / S, (r * T - G) / S, tw / S, th / S, 0, 0, tw, th);
    return (e.split[kind] = cv);
  }

  /**
   * Draw the part of the map inside the view.  (ox, oy) is where the map's top-left lands in the
   * current (logical) transform, (vx, vy, vw, vh) the visible rectangle in map pixels.
   * `kind`: null = the plain picture, "ground" / "layer2" = the split layers.
   * Returns true when every visible tile was drawn; false = the caller should draw its native
   * picture FIRST next time (this call drew the tiles that are ready).
   */
  draw(ctx, ox, oy, vx, vy, vw, vh, kind = null) {
    const { tile: T, gutter: G, scale: S, info } = this;
    const L = T / S;                              // tile size in map pixels
    const c0 = Math.max(0, Math.floor(vx / L)), c1 = Math.min(info.cols - 1, Math.floor((vx + vw - 1e-6) / L));
    const r0 = Math.max(0, Math.floor(vy / L)), r1 = Math.min(info.rows - 1, Math.floor((vy + vh - 1e-6) / L));
    const ready = [];
    let complete = true;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.skip.has(`${c}_${r}`)) continue;
        const e = this.entry(c, r, true);
        const src = e.bmp ? this.splitTile(e, c, r, kind) : null;
        if (src) ready.push([src, c, r]);
        else complete = false;
      }
    }
    // One ring around the view, so walking never waits on a tile.
    for (let r = r0 - 1; r <= r1 + 1; r++) {
      for (let c = c0 - 1; c <= c1 + 1; c++) {
        if (r >= r0 && r <= r1 && c >= c0 && c <= c1) continue;
        if (r < 0 || c < 0 || r >= info.rows || c >= info.cols || this.skip.has(`${c}_${r}`)) continue;
        this.entry(c, r, false);
      }
    }
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    for (const [src, c, r] of ready) {
      const tw = Math.min(T, info.w - c * T), th = Math.min(T, info.h - r * T);
      ctx.drawImage(src, G, G, tw, th, ox + c * L, oy + r * L, tw / S, th / S);
    }
    ctx.imageSmoothingEnabled = smoothing;
    pump();
    evict();
    return complete;
  }
}
