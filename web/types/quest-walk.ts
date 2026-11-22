// How web/quest-walk.ts names a point, a grid source and a route.

/** A cell (column, row) or a point (x, y): always two numbers. */
export type QuestWalkPoint = [number, number];

/** What questGrid() reads: the engine's grid (with a decoded cells array) or the JSON one (blocked rows of 0 and 1). */
export interface QuestGridSource {
  blocked?: string[] | undefined;
  cell?: number | undefined;
  cells?: ArrayLike<number> | undefined;
  cols: number;
  rows: number;
}

/** questRoute()'s answer: the legs, and whether the last one is the asked-for spot. */
export interface QuestRouteResult {
  exact: boolean;
  legs: QuestWalkPoint[];
}

/** The post of a quest stand-in: where it should stand (numbers, or text that reads as one). */
export interface QuestStandInPost {
  x?: number | string | undefined;
  y?: number | string | undefined;
}
