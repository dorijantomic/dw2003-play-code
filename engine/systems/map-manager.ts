// engine/systems/map-manager.ts
// Generic map placement geometry: nearest-actor query, rect hit-test, and facing helpers.
// Canonical home of these helpers (formerly duplicated in web/scene.js). DW3-free — pure
// geometry. The DW3-specific NPC
// variant selection (spawn-gate, chapter ladder) lives in engine/dw3/npc-manager.ts.

export type Facing = "up" | "down" | "left" | "right";
export type Dir8Facing = Facing | "up-left" | "up-right" | "down-left" | "down-right";

export function nearestNpc<T extends { x: number; y: number }>(
  npcs: T[], x: number, y: number, radius: number,
): T | null {
  let best: T | null = null, bestD = radius;
  for (const npc of npcs) {
    const d = Math.hypot(npc.x - x, npc.y - y);
    if (d <= bestD) { best = npc; bestD = d; }
  }
  return best;
}

/** Pick the closest actor in the player's forward interaction cone. */
export function nearestFacingNpc<T extends { x: number; y: number }>(
  npcs: T[], x: number, y: number, facing: string, radius = 48,
): T | null {
  const vectors: Record<string, [number, number]> = {
    up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
    "up-left": [-.707, -.707], "up-right": [.707, -.707],
    "down-left": [-.707, .707], "down-right": [.707, .707],
  };
  const [fx, fy] = vectors[facing] ?? [0, 1];
  let best: T | null = null, bestD = radius;
  for (const npc of npcs) {
    const dx = npc.x - x, dy = npc.y - y, d = Math.hypot(dx, dy);
    if (d > bestD || d === 0 || (dx * fx + dy * fy) / d < 0.35) continue;
    best = npc; bestD = d;
  }
  return best;
}

export interface Rect { x: number; y: number; w: number; h: number; }

/**
 * First actor whose native confirm box contains the point (fieldstg F0x8008E210):
 * half-width `hw` horizontally and `hw >> 1` vertically, searched in array
 * order. `halfWidthOf` returns null/undefined for an actor with no box, which is
 * skipped so the caller can fall back for it.
 */
export function boxTarget<T extends { x: number; y: number }>(
  npcs: T[], px: number, py: number,
  halfWidthOf: (npc: T) => number | null | undefined,
): T | null {
  for (const npc of npcs) {
    const hw = halfWidthOf(npc);
    if (hw == null) continue;
    if (Math.abs(px - npc.x) <= hw && Math.abs(py - npc.y) <= (hw >> 1)) return npc;
  }
  return null;
}

export function hitRect<T extends Rect>(rects: T[], x: number, y: number): T | null {
  for (const r of rects)
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
  return null;
}

// 8 equal 45°-wide sectors around `(fromX,fromY)`, matching the same 8-way DIR8 scheme SETANIM
// and player movement already use elsewhere (screen space, y-down): 0°=right, 90°=down,
// 180°=left, -90°=up, with a diagonal at each 45° in between. Index order matches
// `Math.round(angle/45°) mod 8` starting at "right".
const DIR8_SECTORS: Dir8Facing[] = [
  "right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right",
];

export function faceToward(fromX: number, fromY: number, toX: number, toY: number): Dir8Facing {
  const dx = toX - fromX, dy = toY - fromY;
  if (dx === 0 && dy === 0) return "down";
  const angle = Math.atan2(dy, dx);
  const idx = (Math.round(angle / (Math.PI / 4)) % 8 + 8) % 8;
  return DIR8_SECTORS[idx]!;
}
