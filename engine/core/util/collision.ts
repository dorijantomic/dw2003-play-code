// engine/core/util/collision.ts
// Generic grid-collision util (point/rect block tests + axis-separated movement).
// Ported verbatim from web/collision.js — pure Math/Uint8Array, no DOM. DW3-free.

export const CELL = 16;

export interface Grid {
  cell: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
  terrain?: Uint8Array[];
}

export interface GridJSON {
  cell?: number;
  cols: number;
  rows: number;
  blocked: string[];
  /** Original TMPK quadtree bins for the stage's registered type-0 sub, base64 encoded. */
  terrain?: string[];
}

export function createGrid(mapW: number, mapH: number, cell: number = CELL): Grid {
  const cols = Math.ceil(mapW / cell);
  const rows = Math.ceil(mapH / cell);
  return { cell, cols, rows, cells: new Uint8Array(cols * rows) };
}

function decodeBase64(value: string): Uint8Array {
  const raw = globalThis.atob(value);
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  let raw = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(raw);
}

export function fromJSON(obj: GridJSON): Grid {
  const { cols, rows } = obj;
  const cells = new Uint8Array(cols * rows);
  obj.blocked.forEach((rowStr, r) => {
    for (let c = 0; c < cols; c++) if (rowStr[c] === "1") cells[r * cols + c] = 1;
  });
  const result: Grid = {
    cell: obj.cell ?? CELL,
    cols,
    rows,
    cells,
  };
  if (obj.terrain) result.terrain = obj.terrain.map(decodeBase64);
  return result;
}

export function toJSON(grid: Grid): GridJSON {
  const blocked: string[] = [];
  for (let r = 0; r < grid.rows; r++) {
    let s = "";
    for (let c = 0; c < grid.cols; c++) s += grid.cells[r * grid.cols + c] ? "1" : "0";
    blocked.push(s);
  }
  const result: GridJSON = { cell: grid.cell ?? CELL, cols: grid.cols, rows: grid.rows, blocked };
  if (grid.terrain) result.terrain = grid.terrain.map(encodeBase64);
  return result;
}

export function setBlocked(grid: Grid, cx: number, cy: number, val: boolean | number): void {
  if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return;
  grid.cells[cy * grid.cols + cx] = val ? 1 : 0;
}

export function isBlocked(grid: Grid, x: number, y: number): boolean {
  const cell = grid.cell ?? CELL;
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return true;
  return grid.cells[cy * grid.cols + cx] === 1;
}

// Native F0x8008DE0C: while a traversal form carries a height (actor +0x64,
// non-zero only for Submarimon), a terrain tier can refuse the step. Raised
// tiers 2..6 pass when the height is AT OR OVER the tier; the mirror tiers
// 18..22 pass when it is underneath. It is the sub's dive/rise that changes the
// height, so the same cell is walkable once you are on the right side. Only the
// water form sets +0x64, so a walking Digimon is never gated. Terrain code 1
// and any other code are not gated.
const TERRAIN_MIN_HEIGHT: Record<number, number> = {
  2: 0x2000, 3: 0x3000, 4: 0x4000, 5: 0x5000, 6: 0x6000,
};
const TERRAIN_MAX_HEIGHT: Record<number, number> = {
  18: 0x6001, 19: 0x5001, 20: 0x4001, 21: 0x3001, 22: 0x2001,
};

/** The pure native gate on a raw terrain code + actor height. */
export function terrainHeightGate(code: number, height: number): boolean {
  if (height === 0 || (code & 0xff) === 1) return false;
  const c = code & 0xff;
  if (c in TERRAIN_MIN_HEIGHT) return height < TERRAIN_MIN_HEIGHT[c]!;
  if (c in TERRAIN_MAX_HEIGHT) return height >= TERRAIN_MAX_HEIGHT[c]!;
  return false;
}

/** Whether the terrain under (x,y) refuses a form whose height is `height`. */
export function terrainGateBlocks(grid: Grid, x: number, y: number, height: number): boolean {
  return terrainHeightGate(terrainCodeAt(grid, x, y), height);
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

/** Exact raw TMPK code (the stage's registered type-0 sub) under a map-space point (0 when no typed layer exists). */
export function terrainCodeAt(grid: Grid, x: number, y: number): number {
  const bins = grid.terrain;
  if (!bins || bins.length !== 6 || x < 0 || y < 0) return 0;
  const px = Math.floor(x);
  const py = Math.floor(y);
  const gridBin = bins[0]!;
  const gw = gridBin[0] ?? 0;
  const gh = gridBin[1] ?? 0;
  const tx = Math.floor(px / 128);
  const ty = Math.floor(py / 128);
  if (tx < 0 || ty < 0 || tx >= gw || ty >= gh) return 0;

  const quadrant = (bit: number) => (((py >> bit) & 1) << 1) | ((px >> bit) & 1);
  const l1 = bins[1]![((gridBin[2 + ty * gw + tx] ?? 0) * 4) + quadrant(6)] ?? 0;
  const l2 = u16(bins[2]!, l1 * 8 + quadrant(5) * 2);
  const l3 = u16(bins[3]!, l2 * 8 + quadrant(4) * 2);
  const l4 = u16(bins[4]!, l3 * 8 + quadrant(3) * 2);
  return bins[5]![l4 * 64 + (py & 7) * 8 + (px & 7)] ?? 0;
}

export function rectBlocked(grid: Grid, x0: number, y0: number, x1: number, y1: number): boolean {
  const cell = grid.cell ?? CELL;
  const c0 = Math.floor(x0 / cell), c1 = Math.floor(x1 / cell);
  const r0 = Math.floor(y0 / cell), r1 = Math.floor(y1 / cell);
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return true;
      if (grid.cells[r * grid.cols + c]) return true;
    }
  return false;
}

// (x, y) is the feet position; box.w/box.h define the foot rectangle.
// Axis-separated: lets the player slide along walls on diagonal input.
export function moveWithCollision(
  grid: Grid, x: number, y: number, dx: number, dy: number, box: { w: number; h: number },
): { x: number; y: number } {
  const free = (nx: number, ny: number) =>
    !rectBlocked(grid, nx - box.w / 2, ny - box.h, nx + box.w / 2, ny);
  if (dx !== 0 && free(x + dx, y)) x += dx;
  if (dy !== 0 && free(x, y + dy)) y += dy;
  return { x, y };
}
